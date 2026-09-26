/**
 * Pure auth constants — safe to import from the edge middleware (no env access,
 * no Node-only modules). See docs/ARCHITECTURE.md §1.
 */

export const COOKIES = {
  /** Short-lived access JWT, sent on every request. */
  ACCESS: "rb_at",
  /** Long-lived rotating refresh token. */
  REFRESH: "rb_rt",
} as const;

/**
 * Parse a duration like "900", "30s", "15m", "2h", "7d" into seconds. Returns
 * `fallback` for anything unparseable so a typo in .env can never produce a
 * zero-second (instantly-expiring) token.
 */
function seconds(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const m = /^(\d+)\s*([smhd]?)$/.exec(raw.trim());
  if (!m) return fallback;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n * { "": 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2] as "" | "s" | "m" | "h" | "d"];
}

/**
 * Access-token lifetime (default 15 minutes). Deliberately short: it is the
 * revocation latency of the whole system — a banned user or a role change takes
 * effect within one TTL, because nothing but the signature is checked per request.
 * Expiry is invisible to users, silently rotated by the proxy + SessionKeepAlive.
 *
 * Read from `process.env` directly (like jwt.ts reads AUTH_SECRET) to keep this
 * module edge-safe — importing ./env would pull Node-only config into the proxy.
 */
export const ACCESS_TTL_SECONDS = seconds(process.env.ACCESS_TOKEN_TTL, 15 * 60);

/**
 * Refresh-token lifetime (default 90 days) — the real "how long am I logged in"
 * number. It is a *sliding* window: every rotation pushes it out by the full TTL,
 * so this is the maximum IDLE time before a user must sign in again, not a cap on
 * total session age. An active user is never logged out by it.
 */
export const REFRESH_TTL_SECONDS = seconds(
  process.env.REFRESH_TOKEN_TTL_DAYS && `${process.env.REFRESH_TOKEN_TTL_DAYS}d`,
  90 * 24 * 60 * 60
);

/**
 * Grace period during which the immediately-previous refresh token still works.
 *
 * Rotation-on-every-use races with itself: two tabs (or a proxy refresh and a
 * SessionKeepAlive ping) can present the SAME token within a few hundred ms, and
 * without a grace window the loser resolves to "unknown token" and gets hard
 * logged out. The old hash therefore lingers in Redis for this long, mapped to the
 * session, so a racing request re-rotates instead of being killed.
 *
 * The tradeoff is that a stolen refresh token stays replayable for this window —
 * standard practice (Auth0 calls it rotation leeway); keep it small.
 */
export const REFRESH_GRACE_SECONDS = 60;

/**
 * Path the refresh cookie is scoped to. Site-wide ("/") so the edge proxy can
 * detect a recoverable session on an expired access token and silently refresh
 * instead of logging the user out. It stays HttpOnly + Secure, so it is never
 * exposed to JS.
 *
 * SameSite is `lax`, NOT `strict`: a strict cookie is withheld on every top-level
 * navigation that originates off-site, so a user arriving from Google/WhatsApp/an
 * email link would present no refresh token at all and be shown a signed-out page
 * despite having a live session. `lax` still withholds it from cross-site POSTs
 * (the CSRF vector), and the refresh endpoint only ever rotates the caller's own
 * session and validates its redirect target locally.
 */
export const REFRESH_COOKIE_PATH = "/";

/**
 * One-shot marker the proxy sets while it bounces a request through
 * /api/auth/refresh, so a refresh that succeeds but whose cookie fails to stick
 * (e.g. Secure cookies over plain http) degrades to "render signed out" instead of
 * an infinite redirect loop.
 */
export const REFRESH_ATTEMPT_COOKIE = "rb_ref";

/**
 * "This page was rendered signed-out, but the visitor may still have a live
 * session" — set when a renewal couldn't reach the session store (or was skipped
 * because one had just failed), cleared by any successful renewal.
 *
 * Deliberately readable from JS (NOT HttpOnly) and carries no secret: it is the
 * only way the persistent client shell can learn that the page it just received
 * doesn't match the signed-in navbar it is still showing. In-app navigation
 * re-renders the page but NOT the layout, so without this a failed renewal left
 * "logged in" chrome over a signed-out, progress-less page until a manual reload.
 * SessionKeepAlive watches for it, renews once the store is back, and redraws.
 */
export const AUTH_RECOVER_COOKIE = "rb_recover";
/** How long the recovery marker lives — long enough to outlast a cold store. */
export const AUTH_RECOVER_MAX_AGE_SECONDS = 5 * 60;

export type AppRole = "NORMAL" | "STUDENT" | "SUBSCRIBER" | "ADMIN";

/** Claims carried by the access token. */
export interface AccessClaims {
  sub: string; // user id
  role: AppRole;
  sid: string; // session id
}
