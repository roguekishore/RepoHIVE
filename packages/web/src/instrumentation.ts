/**
 * Next.js calls `register` once when a server instance starts. The Node.js
 * runtime validates the configuration (hosting-3 Requirement 1.1); the edge
 * runtime (the middleware) has nothing to check.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateConfigAtStartup } = await import("./lib/hosting/startup");
    validateConfigAtStartup();
  }
}
