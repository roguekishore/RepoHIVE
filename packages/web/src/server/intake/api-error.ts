/** One JSON error shape with stable codes across intake and auth. */
export interface ApiErrorBody {
  readonly code: string;
  readonly message: string;
}

export const INTAKE_BUSY_RETRY_SECONDS = 120;

export function quotaMessage(code: string): string {
  switch (code) {
    case "PRECHECK_ACCOUNT_LIMIT":
      return "Too many index checks for your account this hour. Try again later.";
    case "PRECHECK_IP_LIMIT":
      return "Too many index checks from your network this hour. Try again later.";
    case "QUOTA_ACCOUNT":
      return "You have used today's index requests for your account.";
    case "QUOTA_IP":
      return "Too many index requests from your network today.";
    case "INFLIGHT":
      return "You already have an index running. Wait for it to finish.";
    default:
      return "The request could not be accepted.";
  }
}
