/**
 * `VIEWS_VERSION` as a constant (import `@repohive/views/views-version`). Reads
 * `dist/views-version.json` when imported, so keep it out of bundled code that
 * does not need it; the main entry exports `getViewsVersion()` for that.
 */
import { getViewsVersion } from "./views-version.js";

export const VIEWS_VERSION: string = getViewsVersion();
