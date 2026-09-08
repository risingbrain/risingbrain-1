/**
 * Client-side `fetch` for our own `/api/*` routes, with one-shot session recovery.
 *
 * The access token lives 15 minutes and is renewed silently — but only on page
 * navigations, by the edge proxy, whose matcher deliberately excludes `/api`
 * (see `app/api/admin/_guard.ts`). `SessionKeepAlive` covers the gap on a ~12
 * minute tick, and only while the tab is visible. So any API call a user makes
 * after reading a page for a while, or right after re-focusing a backgrounded
 * tab, can arrive with a lapsed token and be answered 401 — a screening paper
 * that took longer than the TTL to fill in, a sheet note, a solve toggle.
 *
 * Nothing was recovering those. A 401 is not a verdict here: the refresh cookie
 * is good for 30 days, so the fix is to rotate once and send the request again.
 * A genuinely dead session fails the rotate too, so the original 401 is what
 * surfaces — this costs one extra round trip, never a retry loop.
 */

/**
 * The in-flight rotation, shared by every caller.
 *
 * Without this, a page that fires several writes at once (or a component that
 * retries) would POST /api/auth/refresh once per request. That burst is
 * survivable — the rotation grace window exists for exactly this shape, see
 * `lib/auth/session.ts` — but it is pointless work, and one rotation is all that
 * is needed to repair the jar for every waiting caller.
 */
let renewal: Promise<boolean> | null = null;

function renewSession(): Promise<boolean> {
  renewal ??= fetch("/api/auth/refresh", { method: "POST", cache: "no-store" })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      renewal = null;
    });
  return renewal;
}

/** `fetch`, but a 401 gets one session rotation and one replay. */
export async function apiFetch(input: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;
  if (!(await renewSession())) return res;
  return fetch(input, init);
}
