/**
 * The Step Functions definition (hosting-4 Requirement 11.12): `deploy/terraform/main/state-machine.asl.json`,
 * read as the file Terraform fills in. Structure only; nothing here runs a state machine.
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
  readonly Choices?: readonly { readonly Next: string }[];
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

/** The control operation a Task calls through the control function, if it is one. */
function controlOp(state: State): string | undefined {
  if (state.Type !== "Task" || state.Resource !== "arn:aws:states:::lambda:invoke") {
    return undefined;
  }
  const payload = state.Arguments?.Payload;
  if (typeof payload !== "object" || payload === null) {
    return undefined;
  }
  const arn = state.Arguments?.FunctionName;
  return arn === "${control_function_arn}" ? String((payload as Record<string, unknown>).op) : undefined;
}

/** Every path from `from` to a state satisfying `isEnd`, with whether `mark` was seen on it (visited, then checked). */
function pathsEndWithoutMark(
  from: string,
  isEnd: (name: string) => boolean,
  mark: (name: string, state: State) => boolean,
): string[] {
  const bad: string[] = [];
  const seen = new Set<string>();
  const walk = (name: string, marked: boolean, trail: readonly string[]): void => {
    const state = states[name];
    assert.ok(state, `state ${name} exists`);
    const nowMarked = marked || mark(name, state);
    const key = `${name}|${nowMarked}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    if (isEnd(name)) {
      if (!nowMarked) {
        bad.push([...trail, name].join(" > "));
      }
      return;
    }
    for (const next of successors(state)) {
      walk(next, nowMarked, [...trail, name]);
    }
  };
  walk(from, false, []);
  return bad;
}

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
    for (const name of ["RunFargateL", "RunFargateXL"]) {
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

  test("every path ends by calling inspect or failIfOpen", () => {
    const calls = (_name: string, state: State): boolean => {
      const op = controlOp(state);
      return op === "inspect" || op === "failIfOpen";
    };
    const isEnd = (name: string): boolean => states[name]?.Type === "Succeed" || states[name]?.Type === "Fail";
    assert.deepEqual(pathsEndWithoutMark(definition.StartAt, isEnd, calls), []);
    // Every state that ends the execution is reached, and the ones that succeed are reached only after the ledger spoke.
    const ends = Object.entries(states).filter(([, state]) => state.Type === "Succeed" || state.Type === "Fail");
    assert.deepEqual(ends.map(([name]) => name).sort(), ["FailControl", "FailSystem", "FailUnexpected", "Succeed"]);
  });

  test("failIfOpen is called only with the codes the requirements name", () => {
    const codes = new Set<string>();
    for (const state of Object.values(states)) {
      if (controlOp(state) === "failIfOpen") {
        codes.add(String((state.Arguments?.Payload as Record<string, unknown>).code));
      }
    }
    assert.deepEqual([...codes].sort(), [
      "retier-limit",
      "runtime-error",
      "runtime-not-started",
      "runtime-timeout",
      "slot-wait-timeout",
    ]);
  });

  test("a Fargate run, whatever its outcome, stops stray tasks on failure and releases the slot", () => {
    for (const name of ["RunFargateL", "RunFargateXL"]) {
      const released = pathsEndWithoutMark(
        name,
        (n) => n === "InspectAfterRun",
        (n) => n === "ReleaseSlot",
      );
      assert.deepEqual(released, [], `${name} reaches InspectAfterRun without releasing the slot`);
      // Both failure kinds go through the task cleanup.
      const catches = (states[name] as State).Catch ?? [];
      assert.deepEqual(
        catches.map((c) => c.Next),
        ["ListRunningTasks", "ListRunningTasks"],
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
    assert.equal(controlOp(states.ReleaseSlot as State), "releaseSlot");
  });

  test("the Fargate path waits 60 s between slot attempts and gives up after 20 minutes", () => {
    assert.equal((states.WaitForSlot as State).Type, "Wait");
    assert.equal((states.WaitForSlot as unknown as { Seconds: number }).Seconds, 60);
    const choices = JSON.stringify(states.CheckSlot);
    assert.match(choices, /\$slotAttempts >= 20/);
    assert.equal((states.CheckSlot as State).Default, "WaitForSlot");
  });

  test("every placeholder in the file is passed by state-machine.tf", () => {
    const tf = readFileSync(`${mainRoot}state-machine.tf`, "utf8");
    const used = new Set([...raw.matchAll(/\$\{(\w+)\}/g)].map((m) => m[1] as string));
    assert.ok(used.size > 0);
    for (const name of used) {
      assert.match(tf, new RegExp(`^\\s*${name}\\s*=`, "m"), `state-machine.tf does not pass ${name}`);
    }
  });
});
