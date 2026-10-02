/**
 * Node module-resolution hook for the `@/*` -> `src/*` alias (tsconfig.json's
 * `paths`), so scripts run with plain `node` (worker, local orchestrator
 * child, e2e-spawned processes) resolve the same imports Next.js and Vitest
 * already do. Register with `node --import ./scripts/register-aliases.mjs`.
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = pathToFileURL(path.join(webRoot, "src") + path.sep).href;

const EXTENSIONS = ["", ".ts", ".tsx", "/index.ts"];

async function resolveWithExtensions(base, nextResolve, context) {
  let lastError;
  for (const extension of EXTENSIONS) {
    try {
      return await nextResolve(base + extension, context);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith("@/")) {
    return resolveWithExtensions(new URL(specifier.slice(2), srcRoot).href, nextResolve, context);
  }
  // Extensionless relative imports (`./schema`, `../lib/x`): Next.js and Vitest
  // resolve these; plain Node ESM requires an explicit extension. Only probe
  // relative specifiers with no extension already, so package imports and
  // node: builtins go through the default resolver untouched.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    try {
      return await nextResolve(specifier, context);
    } catch (error) {
      return resolveWithExtensions(specifier, nextResolve, context);
    }
  }
  return nextResolve(specifier, context);
}
