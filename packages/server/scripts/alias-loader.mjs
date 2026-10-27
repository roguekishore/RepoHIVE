/**
 * Node module-resolution hook for extensionless relative imports (`./schema`, `../lib/x`). Vitest resolves these;
 * plain Node ESM requires an explicit extension. Register with `node --import ./scripts/register-aliases.mjs` so the
 * server, the worker and the local-job child resolve the same imports the tests do.
 */
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
  // Only probe relative specifiers with no extension already, so package imports and node: builtins go through the
  // default resolver untouched.
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-zA-Z0-9]+$/.test(specifier)) {
    try {
      return await nextResolve(specifier, context);
    } catch (error) {
      return resolveWithExtensions(specifier, nextResolve, context);
    }
  }
  return nextResolve(specifier, context);
}
