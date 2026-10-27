import { GET as accountJobsGet } from "./account-jobs";
import { GET as sessionGet } from "./auth-session";
import { POST as signInPost } from "./auth-sign-in";
import { POST as signOutPost } from "./auth-sign-out";
import { POST as signUpPost } from "./auth-sign-up";
import { GET as healthzGet } from "./healthz";
import { POST as indexPost } from "./index-request";
import { GET as jobEventsGet } from "./job-events";
import { GET as jobGet } from "./job";
import { GET as latestGet } from "./local-latest";
import { GET as snapshotGet } from "./local-snapshot";
import { GET as quotaGet } from "./quota";
import { GET as repoGet } from "./repo";
import { GET as reposGet } from "./repos";
import type { Route } from "./router";

/** Every endpoint the server answers. `:name` matches one segment; a trailing `*name` matches the rest. */
export const ROUTES: readonly Route[] = [
  { method: "GET", pattern: "/healthz", handler: healthzGet },
  { method: "GET", pattern: "/api/auth/session", handler: sessionGet },
  { method: "POST", pattern: "/api/auth/sign-in", handler: signInPost },
  { method: "POST", pattern: "/api/auth/sign-up", handler: signUpPost },
  { method: "POST", pattern: "/api/auth/sign-out", handler: signOutPost },
  { method: "POST", pattern: "/api/index", handler: indexPost },
  { method: "GET", pattern: "/api/account/jobs", handler: accountJobsGet },
  { method: "GET", pattern: "/api/jobs/:jobId", handler: jobGet },
  { method: "GET", pattern: "/api/jobs/:jobId/events", handler: jobEventsGet },
  { method: "GET", pattern: "/api/quota", handler: quotaGet },
  { method: "GET", pattern: "/api/repos", handler: reposGet },
  { method: "GET", pattern: "/api/repos/:owner/:repo", handler: repoGet },
  // Local mode only: the hosted site serves these from CloudFront, and the handlers answer 404 there.
  { method: "GET", pattern: "/r/*path", handler: latestGet },
  { method: "GET", pattern: "/s/*path", handler: snapshotGet },
];
