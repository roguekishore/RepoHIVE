/**
 * The Step Functions definition: `deploy/terraform/main/state-machine.asl.json`, read as the file Terraform fills
 * in. Structure only; nothing here runs a state machine. The machine routes one run by tier and runs it; the job's
 * ledger, the large-job slot, retier, restart-once and the failure codes belong to the server.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, test } from "node:test";
import { TIER_TIMEOUT_MS } from "./tiers.js";

// dist/state-machine.test.js -> packages/indexer/dist -> repository root
const mainRoot = fileURLToPath(new URL("../../../deploy/terraform/main/", import.meta.url));

interface Catcher {
  readonly ErrorEquals: readonly string[];
  readonly Next: string;
  readonly Assign?: Record<string, unknown>;
}
interface Retrier {
  readonly ErrorEquals: readonly string[];
  readonly IntervalSeconds?: number;
  readonly BackoffRate?: number;
  readonly MaxAttempts?: number;
}
interface State {
  readonly Type: string;
  readonly Resource?: string;
  readonly Arguments?: Record<string, unknown>;
  readonly Next?: string;
  readonly End?: boolean;
  readonly Default?: string;
  readonly Choices?: readonly { readonly Condition?: string; readonly Next: string }[];
  readonly Retry?: readonly Retrier[];
  readonly Catch?: readonly Catcher[];
  readonly TimeoutSeconds?: number;
  readonly ItemProcessor?: { readonly StartAt: string; readonly States: Record<string, State> };
}
interface Definition {
  readonly QueryLanguage: string;
  readonly TimeoutSeconds: number;
  readonly StartAt: string;
  readonly States: Record<string, State>;
}

const raw = readFileSync(`${mainRoot}state-machine.asl.json`, "utf8");
const definition = JSON.parse(raw) as Definition;
const states = definition.States;

function successors(state: State): string[] {
  return [
    ...(state.Next === undefined ? [] : [state.Next]),
    ...(state.Default === undefined ? [] : [state.Default]),
    ...(state.Choices ?? []).map((c) => c.Next),
    ...(state.Catch ?? []).map((c) => c.Next),
  ];
}

/** The type of every state that ends the execution reached from `from`. */
function endsReachedFrom(from: string): string[] {
  const ends = new Set<string>();
  const seen = new Set<string>();
  const queue = [from];
  while (queue.length > 0) {
    const name = queue.pop() as string;
    if (seen.has(name)) continue;
    seen.add(name);
    const state = states[name] as State;
    if (state.Type === "Succeed" || state.Type === "Fail") ends.add(`${name}:${state.Type}`);
    queue.push(...successors(state));
  }
  return [...ends].sort();
}

const FARGATE = ["RunFargateL", "RunFargateXL"] as const;
const RUNS = ["RunLambda", ...FARGATE] as const;

describe("state machine definition", () => {
  test("is JSONata, has the 3,600 s overall timeout, and every reference resolves", () => {
    assert.equal(definition.QueryLanguage, "JSONata");
    assert.equal(definition.TimeoutSeconds, 3600);
    assert.ok(states[definition.StartAt]);
    for (const [name, state] of Object.entries(states)) {
      for (const next of successors(state)) {
        assert.ok(states[next], `${name} points at ${next}, which does not exist`);
      }
      if (state.Type !== "Choice" && state.Type !== "Succeed" && state.Type !== "Fail") {
        assert.ok(state.Next !== undefined || state.End === true, `${name} has no Next`);
      }
    }
  });

  test("every state is reachable from the start", () => {
    const reached = new Set<string>();
    const queue = [definition.StartAt];
    while (queue.length > 0) {
      const name = queue.pop() as string;
      if (reached.has(name)) continue;
      reached.add(name);
      queue.push(...successors(states[name] as State));
    }
    assert.deepEqual(
      Object.keys(states).filter((name) => !reached.has(name)),
      [],
    );
    // The Map's inline processor, too.
    const inner = (states.StopRunningTasks as State).ItemProcessor;
    assert.ok(inner);
    const innerReached = new Set<string>();
    const innerQueue = [inner.StartAt];
    while (innerQueue.length > 0) {
      const name = innerQueue.pop() as string;
      if (innerReached.has(name)) continue;
      innerReached.add(name);
      innerQueue.push(...successors(inner.States[name] as State));
    }
    assert.deepEqual(Object.keys(inner.States).filter((name) => !innerReached.has(name)), []);
  });

  test("routes by tier: S and M to Lambda, L and XL to Fargate, anything else fails", () => {
    const route = states.RouteTier as State;
    assert.equal(route.Type, "Choice");
    const next = (tier: string): string | undefined =>
      route.Choices?.find((c) => c.Condition?.includes(`$job.tier = '${tier}'`))?.Next;
    assert.equal(next("S"), "RunLambda");
    assert.equal(next("M"), "RunLambda");
    assert.equal(next("L"), "RunFargateL");
    assert.equal(next("XL"), "RunFargateXL");
    assert.equal(route.Default, "FailUnknownTier");
  });

  test("holds no ledger, control function or slot: the server owns the job", () => {
    assert.doesNotMatch(raw, /control_function_arn|acquireSlot|releaseSlot|failIfOpen/);
    assert.deepEqual(
      Object.keys(states).filter((name) => /slot|ledger|inspect|decide|failopen|retier|restart/i.test(name)),
      [],
    );
    const lambdas = Object.values(states).filter((s) => s.Resource === "arn:aws:states:::lambda:invoke");
    assert.equal(lambdas.length, 1);
    assert.equal(lambdas[0]?.Arguments?.FunctionName, "${indexer_function_arn}");
    // The job input goes to the runtime exactly as the server sent it.
    assert.equal(lambdas[0]?.Arguments?.Payload, "{% $job %}");
    assert.equal((states.Init as State & { Assign?: Record<string, unknown> }).Assign?.job, "{% $states.input %}");
    assert.equal(states.Init?.Next, "RouteTier");
    assert.equal(definition.StartAt, "Init");
  });

  test("retries name only Lambda throttling on the Lambda path and ECS capacity errors on the Fargate path", () => {
    const retried: Record<string, readonly Retrier[]> = {};
    const collect = (all: Record<string, State>): void => {
      for (const [name, state] of Object.entries(all)) {
        if (state.Retry !== undefined) retried[name] = state.Retry;
        if (state.ItemProcessor !== undefined) collect(state.ItemProcessor.States);
      }
    };
    collect(states);
    assert.deepEqual(Object.keys(retried).sort(), ["RunFargateL", "RunFargateXL", "RunLambda"]);
    assert.deepEqual(retried.RunLambda, [
      { ErrorEquals: ["Lambda.TooManyRequestsException"], IntervalSeconds: 5, BackoffRate: 2, MaxAttempts: 3 },
    ]);
    for (const name of FARGATE) {
      assert.deepEqual(retried[name], [
        { ErrorEquals: ["ECS.AmazonECSException"], IntervalSeconds: 30, BackoffRate: 2, MaxAttempts: 3 },
      ]);
    }
  });

  test("the run timeouts follow the tier table", () => {
    // Lambda: the tier timeout plus 30 s, for S and M alike.
    assert.equal(TIER_TIMEOUT_MS.S, TIER_TIMEOUT_MS.M);
    assert.equal(states.RunLambda?.TimeoutSeconds, TIER_TIMEOUT_MS.S / 1000 + 30);
    assert.equal(states.RunLambda?.TimeoutSeconds, 330);
    // Fargate: the tier timeout plus 180 s for provisioning and the image pull, and the job's own limit.
    for (const [name, tier] of [
      ["RunFargateL", "L"],
      ["RunFargateXL", "XL"],
    ] as const) {
      const state = states[name] as State;
      assert.equal(state.Resource, "arn:aws:states:::ecs:runTask.sync");
      assert.equal(state.TimeoutSeconds, TIER_TIMEOUT_MS[tier] / 1000 + 180);
      const overrides = (state.Arguments?.Overrides as { ContainerOverrides: { Environment: { Name: string; Value: string }[] }[] })
        .ContainerOverrides;
      const env = Object.fromEntries((overrides[0]?.Environment ?? []).map((e) => [e.Name, e.Value]));
      assert.equal(env.REPOHIVE_TIME_LIMIT_MS, String(TIER_TIMEOUT_MS[tier]));
      assert.ok(env.REPOHIVE_JOB_INPUT?.includes("$job"));
      assert.equal(state.Arguments?.StartedBy, undefined);
      assert.equal(state.Arguments?.Group, "{% 'job-' & $job.jobId %}");
    }
    assert.equal(TIER_TIMEOUT_MS.L, 600_000);
    assert.equal(TIER_TIMEOUT_MS.XL, 900_000);
  });

  test("the run that ends cleanly succeeds; every error ends the execution as FAILED", () => {
    for (const name of RUNS) {
      assert.equal((states[name] as State).Next, "Succeed", `${name} goes to Succeed when the run returns`);
    }
    // Succeed is reached from the three runs and from nothing else.
    const into = Object.entries(states)
      .filter(([, state]) => successors(state).includes("Succeed"))
      .map(([name]) => name)
      .sort();
    assert.deepEqual(into, [...RUNS].sort());
    // Whatever a run's error handling goes through, it can only end in a Fail state.
    for (const name of RUNS) {
      for (const catcher of (states[name] as State).Catch ?? []) {
        assert.deepEqual(catcher.ErrorEquals, ["States.ALL"]);
        assert.equal(catcher.Assign?.failure, "{% $states.errorOutput %}", `${name} keeps the run's error`);
        assert.deepEqual(
          endsReachedFrom(catcher.Next).map((e) => e.split(":")[1]),
          ["Fail"],
          `${name}'s error path must end in Fail only`,
        );
      }
    }
    const ends = Object.entries(states).filter(([, state]) => state.Type === "Succeed" || state.Type === "Fail");
    assert.deepEqual(ends.map(([name]) => name).sort(), ["FailRun", "FailUnknownTier", "Succeed"]);
  });

  test("a failed Fargate run stops stray tasks, and every cleanup step still ends in FailRun", () => {
    for (const name of FARGATE) {
      const catches = (states[name] as State).Catch ?? [];
      assert.deepEqual(
        catches.map((c) => c.Next),
        ["ListRunningTasks"],
      );
    }
    const list = states.ListRunningTasks as State;
    assert.equal(list.Resource, "arn:aws:states:::aws-sdk:ecs:listTasks");
    assert.equal(list.Arguments?.Family, "${task_definition_family}");
    assert.equal(list.Next, "AnyRunningTasks");
    const describe = states.DescribeRunningTasks as State;
    assert.equal(describe.Resource, "arn:aws:states:::aws-sdk:ecs:describeTasks");
    assert.equal(describe.Next, "StopRunningTasks");
    const stop = (states.StopRunningTasks as State).ItemProcessor?.States.StopTask;
    assert.equal(stop?.Resource, "arn:aws:states:::aws-sdk:ecs:stopTask");
    // Neither a failure of the cleanup nor its success may let the execution end any other way.
    for (const name of ["ListRunningTasks", "AnyRunningTasks", "DescribeRunningTasks", "StopRunningTasks"]) {
      assert.deepEqual(endsReachedFrom(name), ["FailRun:Fail"], `${name} must lead only to FailRun`);
    }
    // The failure the run caught is what the execution fails with.
    const fail = states.FailRun as State & { Error?: string; Cause?: string };
    assert.match(String(fail.Error), /\$failure\.Error/);
    assert.match(String(fail.Cause), /\$failure\.Cause/);
  });

  test("every placeholder in the file is passed by state-machine.tf", () => {
    const tf = readFileSync(`${mainRoot}state-machine.tf`, "utf8");
    const used = new Set([...raw.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1] as string));
    assert.ok(used.size > 0);
    for (const name of used) {
      assert.match(tf, new RegExp(`^\\s*${name}\\s*=`, "m"), `state-machine.tf does not pass ${name}`);
    }
    // The control function is gone: nothing may still pass it.
    assert.doesNotMatch(tf, /control_function/);
  });
});
