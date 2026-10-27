/**
 * Applied globally from `next.config.ts`. The API server sends the same three headers on its own responses
 * (`packages/server/src/auth/security-headers.ts`); keep them equal.
 */
export const APP_SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
] as const;
