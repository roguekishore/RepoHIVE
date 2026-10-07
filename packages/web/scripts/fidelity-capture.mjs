#!/usr/bin/env node
// Fidelity capture.
//
// For each screen, state and width this writes ONE composite PNG: a two-by-two grid, the built app on the left and the
// reference artifact on the right, light above dark. Chrome draws the composite itself (a generated local page lays the
// four shots out and Chrome captures it), so checking a screen costs a few images, not dozens.
//
// No dependency: it drives the installed Chrome over the DevTools protocol with Node's built-in fetch and WebSocket
// (Node 22 or newer; the repository uses 24). Chrome is found from --chrome, CHROME_PATH or the usual install paths.
//
//   node packages/web/scripts/fidelity-capture.mjs --task w3 --config <shots.json> [--only dashboard[/state]]
//   node packages/web/scripts/fidelity-capture.mjs --task s0 --preset frame        (the existing app frame)
//
// Output: <run>/captures/<task>/<screen>-<state>-<width>.png, where <run> is --run, REPOHIVE_RUN_DIR, or the `_run`
// folder beside the worktree (D:\PROJECTS\REPOHIVE\wt-p3\_run). Start the built app first, in the background:
// `next start --port <yours>` in packages/web, and pass --origin http://localhost:<port> (default :3100).
//
// Config (JSON, or an .mjs whose default export is the same object):
//   {
//     "origin": "http://localhost:3101",            // optional; the built app
//     "settleMs": 600,                              // optional; wait after load and after each step
//     "shots": [{
//       "screen": "dashboard", "state": "filtered-empty",
//       "widths": [1440, 390],                      // optional; default both
//       "fullPage": false,                          // optional; capture the whole document (landing)
//       "motion": "reduce",                         // optional; "reduce" (default, deterministic) or "no-preference"
//       "built":    { "path": "/repos", "steps": [ ... ] },
//       "artifact": { "file": "screens.html", "hash": "repos", "steps": [ ... ] }
//     }]
//   }
//
// Steps run in order on that side after it loads, in both themes:
//   { "click": "<selector>" }  or { "click": { "x": 10, "y": 20 } }      a real mouse click at the element's centre
//   { "hover": "<selector>" }  or { "hover": { "x": 10, "y": 20 } }      a real mouse move
//   { "type": ["<selector>", "text"] }                                   focus, then insert the text
//   { "setValue": ["<selector>", "0.7"] }                                set .value, fire input and change
//   { "press": "Enter" }                                                 a key (Enter, Escape, Tab, ArrowDown, ...)
//   { "scroll": 800 }  or  { "scroll": ["<selector>", 800] }             window or element scrollTop
//   { "eval": "<js>" }                                                   run JS in the page (awaited)
//   { "waitFor": "<selector>" }  { "wait": 300 }
// The artifact's drivers (the hash and steps that put it in each state) are listed per screen in _run/ref/index.md.

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const WIDTHS = { 1440: 900, 390: 844 };
const THEMES = ["light", "dark"];
const MAX_FULL_PAGE_HEIGHT = 8000;

/** Built-in presets, so a gate can run without a config file. */
const PRESETS = {
  // The existing app frame: the old dashboard shell against the artifact's frame around its Repositories page.
  frame: {
    shots: [
      {
        screen: "frame",
        state: "legacy",
        built: { path: "/" },
        artifact: { file: "screens.html", hash: "repos" },
      },
    ],
  },
};

export function slug(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";
}

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) args[key] = true;
    else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function findChrome(explicit) {
  const candidates = [
    explicit,
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ];
  const found = candidates.find((c) => typeof c === "string" && c.length > 0 && existsSync(c));
  if (found === undefined) throw new Error("Chrome not found: pass --chrome <path> or set CHROME_PATH");
  return found;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A minimal DevTools protocol client over the browser-level WebSocket, with flattened sessions. */
class Cdp {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve());
      this.ws.addEventListener("error", () => reject(new Error("DevTools WebSocket failed to open")));
    });
    this.ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const entry = this.pending.get(message.id);
        if (entry === undefined) return;
        this.pending.delete(message.id);
        if (message.error) entry.reject(new Error(`${entry.method}: ${message.error.message}`));
        else entry.resolve(message.result ?? {});
        return;
      }
      for (const listener of [...this.listeners]) listener(message);
    });
  }

  send(method, params = {}, sessionId) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = { id, method, params };
    if (sessionId !== undefined) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify(payload));
    });
  }

  /** Resolves on the next event with this method (and session); register before sending the command that causes it. */
  once(method, sessionId, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners = this.listeners.filter((l) => l !== listener);
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
      const listener = (message) => {
        if (message.method !== method || message.sessionId !== sessionId) return;
        clearTimeout(timer);
        this.listeners = this.listeners.filter((l) => l !== listener);
        resolve(message.params);
      };
      this.listeners.push(listener);
    });
  }

  close() {
    this.ws.close();
  }
}

async function launchChrome(chromePath) {
  const userDataDir = mkdtempSync(path.join(tmpdir(), "rh-capture-"));
  const child = spawn(
    chromePath,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${userDataDir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--hide-scrollbars",
      "--force-color-profile=srgb",
      "--allow-file-access-from-files",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  const portFile = path.join(userDataDir, "DevToolsActivePort");
  let port;
  for (let i = 0; i < 100 && port === undefined; i += 1) {
    if (existsSync(portFile)) {
      const first = readFileSync(portFile, "utf8").split("\n")[0]?.trim();
      if (first) port = Number(first);
    }
    if (port === undefined) await sleep(100);
  }
  if (port === undefined) {
    child.kill();
    throw new Error("Chrome did not publish a DevTools port");
  }
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const cdp = new Cdp(version.webSocketDebuggerUrl);
  await cdp.ready;
  return {
    cdp,
    async close() {
      try {
        await cdp.send("Browser.close");
      } catch {
        // Chrome may drop the socket as it exits.
      }
      cdp.close();
      child.kill();
      for (let i = 0; i < 10; i += 1) {
        try {
          rmSync(userDataDir, { recursive: true, force: true });
          break;
        } catch {
          await sleep(200);
        }
      }
    },
  };
}

async function openPage(cdp, { width, height, theme, motion }) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  const send = (method, params) => cdp.send(method, params, sessionId);
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 500,
  });
  await send("Emulation.setEmulatedMedia", {
    features: [
      { name: "prefers-color-scheme", value: theme },
      { name: "prefers-reduced-motion", value: motion },
    ],
  });
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) {
      throw new Error(`page script failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
    }
    return result.result?.value;
  };
  return {
    sessionId,
    send,
    evaluate,
    async navigate(url) {
      const loaded = cdp.once("Page.loadEventFired", sessionId, 30000);
      await send("Page.navigate", { url });
      await loaded;
      await evaluate(
        "Promise.race([document.fonts ? document.fonts.ready.then(() => true) : true, new Promise(r => setTimeout(r, 8000))])",
      );
    },
    async close() {
      try {
        await cdp.send("Target.closeTarget", { targetId });
      } catch {
        // Already gone.
      }
    },
  };
}

const centreOf = (selector) =>
  `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) throw new Error("no element for ${selector.replace(/"/g, '\\"')}"); el.scrollIntoView({ block: "nearest", inline: "nearest" }); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`;

async function pointFor(page, target) {
  return typeof target === "string" ? page.evaluate(centreOf(target)) : target;
}

const KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
};

async function runStep(page, step, settleMs) {
  if ("click" in step) {
    const { x, y } = await pointFor(page, step.click);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await page.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
    await page.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
  } else if ("hover" in step) {
    const { x, y } = await pointFor(page, step.hover);
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  } else if ("type" in step) {
    const [selector, text] = step.type;
    await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
    await page.send("Input.insertText", { text });
  } else if ("setValue" in step) {
    const [selector, value] = step.setValue;
    await page.evaluate(
      `(() => { const el = document.querySelector(${JSON.stringify(selector)}); const set = Object.getOwnPropertyDescriptor(el.constructor.prototype, "value").set; set.call(el, ${JSON.stringify(String(value))}); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); })()`,
    );
  } else if ("press" in step) {
    const key = KEYS[step.press] ?? { key: step.press, code: step.press };
    await page.send("Input.dispatchKeyEvent", { type: key.text ? "keyDown" : "rawKeyDown", ...key });
    await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...key });
  } else if ("scroll" in step) {
    if (Array.isArray(step.scroll)) {
      await page.evaluate(`document.querySelector(${JSON.stringify(step.scroll[0])}).scrollTop = ${Number(step.scroll[1])}`);
    } else await page.evaluate(`window.scrollTo(0, ${Number(step.scroll)})`);
  } else if ("eval" in step) {
    await page.evaluate(step.eval);
  } else if ("waitFor" in step) {
    const selector = JSON.stringify(step.waitFor);
    await page.evaluate(
      `new Promise((resolve, reject) => { const end = Date.now() + 10000; (function poll() { if (document.querySelector(${selector})) resolve(true); else if (Date.now() > end) reject(new Error("timed out waiting for " + ${selector})); else setTimeout(poll, 50); })(); })`,
    );
  } else if ("wait" in step) {
    await sleep(Number(step.wait));
  } else {
    throw new Error(`unknown step: ${JSON.stringify(step)}`);
  }
  await sleep(Math.min(settleMs, 300));
}

/** Captures one side (built or artifact) in one theme at one width, and returns the PNG path. */
async function captureSide({ cdp, side, shot, width, theme, origin, runDir, settleMs, rawDir }) {
  const height = WIDTHS[width] ?? 900;
  const spec = shot[side] ?? {};
  const motion = shot.motion ?? "reduce";
  const page = await openPage(cdp, { width, height, theme, motion });
  try {
    let url;
    if (side === "built") url = new URL(spec.path ?? "/", origin).href;
    else {
      const file = path.resolve(runDir, "ref", spec.file ?? "screens.html");
      if (!existsSync(file)) throw new Error(`artifact file not found: ${file}`);
      url = `${pathToFileURL(file).href}${spec.hash ? `#${spec.hash}` : ""}`;
    }
    await page.navigate(url);
    // The artifact paints its theme from the data-theme attribute as well as the media query.
    if (side === "artifact") await page.evaluate(`document.documentElement.setAttribute("data-theme", ${JSON.stringify(theme)})`);
    if (spec.waitFor) await runStep(page, { waitFor: spec.waitFor }, settleMs);
    await sleep(settleMs);
    for (const step of spec.steps ?? []) await runStep(page, step, settleMs);
    await sleep(settleMs);
    const dark = await page.evaluate('matchMedia("(prefers-color-scheme: dark)").matches');
    if (dark !== (theme === "dark")) throw new Error(`${side} ${theme}: the emulated colour scheme did not apply`);
    const params = { format: "png" };
    if (shot.fullPage) {
      const metrics = await page.send("Page.getLayoutMetrics");
      const contentHeight = Math.min(MAX_FULL_PAGE_HEIGHT, Math.ceil(metrics.cssContentSize?.height ?? metrics.contentSize.height));
      params.captureBeyondViewport = true;
      params.clip = { x: 0, y: 0, width, height: contentHeight, scale: 1 };
    }
    const { data } = await page.send("Page.captureScreenshot", params);
    const file = path.join(rawDir, `${slug(shot.screen)}-${slug(shot.state)}-${width}-${side}-${theme}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    return file;
  } finally {
    await page.close();
  }
}

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function compositeHtml({ title, width, cells }) {
  const columnWidth = width >= 1000 ? 808 : width;
  const gap = 8;
  const total = columnWidth * 2 + gap * 3;
  const figures = cells
    .map(
      (cell) =>
        `<figure><figcaption>${esc(cell.label)}</figcaption><img src="${pathToFileURL(cell.file).href}" alt="${esc(cell.label)}"></figure>`,
    )
    .join("");
  return `<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><style>
html,body{margin:0;background:#777}body{width:${total}px;padding:${gap}px;box-sizing:border-box;font:600 12px/16px system-ui,sans-serif;color:#fff}
.grid{display:grid;grid-template-columns:${columnWidth}px ${columnWidth}px;gap:${gap}px;align-items:start}
figure{margin:0;display:grid;gap:4px}figcaption{padding-left:2px}
img{display:block;width:${columnWidth}px;height:auto;background:#fff}
</style><div class="grid">${figures}</div>`;
}

async function writeComposite({ cdp, shot, width, files, outFile, rawDir }) {
  const cells = [
    { label: "built · light", file: files.built.light },
    { label: "artifact · light", file: files.artifact.light },
    { label: "built · dark", file: files.built.dark },
    { label: "artifact · dark", file: files.artifact.dark },
  ];
  const htmlFile = path.join(rawDir, `${slug(shot.screen)}-${slug(shot.state)}-${width}.composite.html`);
  const columnWidth = width >= 1000 ? 808 : width;
  const total = columnWidth * 2 + 8 * 3;
  writeFileSync(htmlFile, compositeHtml({ title: `${shot.screen} ${shot.state} ${width}`, width, cells }));
  const page = await openPage(cdp, { width: total, height: 200, theme: "light", motion: "reduce" });
  try {
    await page.navigate(pathToFileURL(htmlFile).href);
    await page.evaluate("Promise.all([...document.images].map((img) => img.decode().catch(() => {})))");
    const height = await page.evaluate("Math.ceil(document.documentElement.scrollHeight)");
    await page.send("Emulation.setDeviceMetricsOverride", { width: total, height, deviceScaleFactor: 1, mobile: false });
    const { data } = await page.send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: total, height, scale: 1 },
    });
    writeFileSync(outFile, Buffer.from(data, "base64"));
  } finally {
    await page.close();
  }
}

async function loadConfig(args) {
  if (typeof args.preset === "string") {
    const preset = PRESETS[args.preset];
    if (preset === undefined) throw new Error(`unknown preset ${args.preset}; known: ${Object.keys(PRESETS).join(", ")}`);
    return preset;
  }
  if (typeof args.config !== "string") throw new Error("pass --config <file> or --preset <name> (see the header of this script)");
  const file = path.resolve(args.config);
  if (file.endsWith(".mjs") || file.endsWith(".js")) return (await import(pathToFileURL(file).href)).default;
  return JSON.parse(readFileSync(file, "utf8"));
}

export async function main(argv) {
  const args = parseArgs(argv);
  if (args.help || argv.length === 0) {
    console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).map((l) => l.slice(3)).join("\n"));
    return 0;
  }
  if (typeof args.task !== "string") throw new Error("--task <name> is required (it names the output folder)");
  const config = await loadConfig(args);
  const runDir = path.resolve(
    typeof args.run === "string" ? args.run : (process.env.REPOHIVE_RUN_DIR ?? path.join(REPO_ROOT, "..", "_run")),
  );
  const origin = args.origin ?? config.origin ?? process.env.CAPTURE_ORIGIN ?? "http://localhost:3100";
  const settleMs = Number(config.settleMs ?? 600);
  const outDir = typeof args.out === "string" ? path.resolve(args.out) : path.join(runDir, "captures", slug(args.task));
  mkdirSync(outDir, { recursive: true });
  const rawDir = mkdtempSync(path.join(tmpdir(), "rh-capture-raw-"));
  const only = typeof args.only === "string" ? args.only.split("/") : undefined;
  const widthsArg = typeof args.widths === "string" ? args.widths.split(",").map(Number) : undefined;

  const shots = (config.shots ?? []).filter(
    (s) => only === undefined || (slug(s.screen) === slug(only[0]) && (only[1] === undefined || slug(s.state) === slug(only[1]))),
  );
  if (shots.length === 0) throw new Error("no shots matched");

  const chrome = await launchChrome(findChrome(args.chrome));
  const written = [];
  try {
    for (const shot of shots) {
      for (const width of widthsArg ?? shot.widths ?? Object.keys(WIDTHS).map(Number)) {
        const jobs = [];
        for (const side of ["built", "artifact"]) for (const theme of THEMES) jobs.push({ side, theme });
        const results = await Promise.all(
          jobs.map((job) => captureSide({ cdp: chrome.cdp, ...job, shot, width, origin, runDir, settleMs, rawDir })),
        );
        const files = { built: {}, artifact: {} };
        jobs.forEach((job, i) => {
          files[job.side][job.theme] = results[i];
        });
        const outFile = path.join(outDir, `${slug(shot.screen)}-${slug(shot.state)}-${width}.png`);
        await writeComposite({ cdp: chrome.cdp, shot, width, files, outFile, rawDir });
        written.push(outFile);
        console.log(`wrote ${outFile}`);
      }
    }
  } finally {
    await chrome.close();
    if (args.keep) cpSync(rawDir, path.join(outDir, "raw"), { recursive: true });
    rmSync(rawDir, { recursive: true, force: true });
  }
  console.log(`${written.length} composite(s) in ${outDir}`);
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
