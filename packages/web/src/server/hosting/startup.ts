/**
 * Start-up check, run by `src/instrumentation.ts`
 * in the Node.js runtime only: a missing or invalid setting stops the server
 * before it serves a request, naming the variable.
 */
import { ConfigError, getAppConfig } from "./config";

export function validateConfigAtStartup(): void {
  try {
    getAppConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(`repohive: refusing to start: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}
