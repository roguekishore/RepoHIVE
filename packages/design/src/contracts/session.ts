/** `GET /api/auth/session`. Signed out is a normal answer, not an error. */
export interface Session {
  readonly signedIn: boolean;
  readonly email?: string;
}

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

/** The one error body of the account and index endpoints. `code` is stable, `message` is safe to show. */
export interface ApiError {
  readonly code: string;
  readonly message: string;
}

/** What an action returns: it does not throw for an answer the server gave, only for a network failure. */
export type ActionResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ApiError };
