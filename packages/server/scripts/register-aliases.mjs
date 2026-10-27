/**
 * Entry point for `node --import ./scripts/register-aliases.mjs`: installs
 * the `@/*` resolution hook from `alias-loader.mjs` for the rest of the process.
 */
import { register } from "node:module";

register("./alias-loader.mjs", import.meta.url);
