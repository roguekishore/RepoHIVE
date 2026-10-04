/** Plain-language copy for intake rejection codes. */
export function intakeRejectionMessage(code: string, serverMessage?: string): string {
  if (serverMessage !== undefined && serverMessage.trim().length > 0) {
    return serverMessage;
  }
  switch (code) {
    case "PRIVATE":
      return "This repository is private. RepoHIVE indexes public repositories only.";
    case "ARCHIVED":
      return "This repository is archived.";
    case "EMPTY":
      return "This repository has no Java sources to index.";
    case "TOO_LARGE":
      return "This repository is too large for the current tier.";
    case "ORCHESTRATOR_START_FAILED":
      return "The index could not be started. Your request was not charged.";
    case "INFLIGHT_CAP":
    case "BUSY":
      return "The indexer is busy. Try again in a few minutes.";
    default:
      return "This index request was rejected.";
  }
}
