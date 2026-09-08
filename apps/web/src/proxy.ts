/**
 * Edge proxy (Next.js 16's replacement for `middleware`) — the FIRST
 * access-control layer. Verifies the access JWT with pure crypto (no DB/Redis)
 * and applies the RBAC route map. Unauthorized requests are redirected before
 * any page renders. Server Components apply the second layer (gating data +
 * `getNavForRole`). See docs/ARCHITECTURE.md §2.
 *
 * It is ALSO where an expired access token gets silently renewed. That has to
 * happen on every page, not just gated ones: `ROUTE_ACCESS` only guards /admin,
 * /profile and /notes, so the entire signed-in surface (/sheet, /domain, …) is
 * "allowed" for an anonymous visitor. Renewing only on a denied route meant a user
 * whose 15-minute access cookie had lapsed was rendered a signed-out navbar on the
 * main app — with a perfectly good 90-day refresh token sitting in their cookie jar.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { COOKIES, REFRESH_ATTEMPT_COOKIE } from "@/lib/auth/constants";
import { verifyAccessToken } from "@/lib/auth/jwt";
import { checkRouteAccess } from "@/lib/rbac";

const AUTH_PAGES = ["/login", "/signup"];

/**
 * Bounce through /api/auth/refresh (Node runtime + Redis) and come back to
 * `pathname`, so the page renders signed-in on the very first paint.
 *
 * `soft` marks a request for a page the visitor may read anonymously: if the
 * refresh turns out to be dead we want them back on that page, signed out, NOT
 * shoved to /login. Gated routes stay hard — /login is the right destination there.
 *
 * The one-shot marker cookie makes this loop-proof. If the rotate succeeds but the
 * new cookie never sticks (Secure cookies over plain http, say), the marker is
 * present on the way back and we render signed-out instead of redirecting forever.
 */
function refreshThenReturn(req: NextRequest, pathname: string, soft: boolean) {
  const url = new URL("/api/auth/refresh", req.url);
  url.searchParams.set("redirect", pathname + req.nextUrl.search);
  if (soft) url.searchParams.set("soft", "1");

  const res = NextResponse.redirect(url);
  res.cookies.set(REFRESH_ATTEMPT_COOKIE, "1", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 10,
  });
  return res;
}

export default async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  const token = req.cookies.get(COOKIES.ACCESS)?.value;
  const claims = token ? await verifyAccessToken(token) : null;
  const role = claims?.role ?? null;

  // A live session we can restore: refresh cookie present, access token gone or
  // expired. Only for real GET navigations — redirecting a Server Action POST
  // would drop its payload, and prefetches are speculative (renewing on them would
  // rotate the token constantly for no one's benefit).
  const isPrefetch =
    req.headers.get("next-router-prefetch") === "1" || req.headers.get("purpose") === "prefetch";
  const recoverable =
    !role &&
    req.method === "GET" &&
    !isPrefetch &&
    Boolean(req.cookies.get(COOKIES.REFRESH)?.value) &&
    !req.cookies.get(REFRESH_ATTEMPT_COOKIE);

  // Signed-in users shouldn't see the login/signup pages.
  if (role && AUTH_PAGES.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/sheet", req.url));
  }

  const access = checkRouteAccess(pathname, role);

  if (access.allowed) {
    // Publicly readable, but this visitor has a restorable session — renew it now
    // so per-user chrome (navbar, streak, progress) isn't missing on arrival.
    // Skipped on the auth pages: someone deliberately opening /login while holding
    // a stale token should get the form, not be bounced to /sheet.
    if (recoverable && !AUTH_PAGES.some((p) => pathname.startsWith(p))) {
      return refreshThenReturn(req, pathname, true);
    }
    return NextResponse.next();
  }

  // A denied PREFETCH must never be answered with a redirect. It is a guess about
  // where the user might click, and the router can serve that answer on the real
  // click — so sending /login here logs out someone whose refresh cookie is alive
  // and simply was not renewed, because renewal is deliberately skipped on
  // prefetches (see `recoverable` above). That combination is reachable only on a
  // gated prefix, and /admin is the one that also prefetches six siblings from its
  // own nav, so 15 idle minutes there was enough to strand a live session.
  //
  // 204 means "no prefetch data": the router caches nothing, and the real
  // navigation arrives as a non-prefetch GET, which IS `recoverable` and repairs
  // itself. Applies to `forbidden` too — a speculative request must not be able to
  // drive the user anywhere, including /?forbidden=1.
  if (isPrefetch) return new NextResponse(null, { status: 204 });

  if (access.reason === "unauthenticated") {
    // Expired/absent access token but a live refresh cookie? Rotate and bounce
    // back instead of logging the user out. The refresh route clears cookies and
    // sends to /login when the refresh token is genuinely dead, so this can't loop.
    if (recoverable) return refreshThenReturn(req, pathname, false);

    const url = new URL("/login", req.url);
    url.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(url);
  }

  // Forbidden (signed in but lacking the role/subscription).
  const url = new URL("/", req.url);
  url.searchParams.set("forbidden", "1");
  return NextResponse.redirect(url);
}

export const config = {
  // Run on everything except API routes, Next internals, and static assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
