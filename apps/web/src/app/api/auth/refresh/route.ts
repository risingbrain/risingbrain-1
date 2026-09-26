import { NextResponse } from "next/server";
import { rotateSession, SessionUnavailableError } from "@/lib/auth/session";
import {
  setAuthCookies,
  clearAuthCookies,
  readRefreshCookie,
  markSessionForRecovery,
} from "@/lib/auth/cookies";
import { safeRedirectPath } from "@/lib/auth/safe-redirect";
import { env } from "@/lib/env";

/**
 * Exchanges a valid refresh token for a fresh access token (and rotates the
 * refresh token). Called by the client when the access token expires.
 */
export async function POST(req: Request) {
  const refresh = await readRefreshCookie();
  if (!refresh) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let tokens;
  try {
    tokens = await rotateSession(refresh, {
      userAgent: req.headers.get("user-agent"),
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    });
  } catch (err) {
    if (err instanceof SessionUnavailableError) {
      // Store unreachable — we can't say the session is invalid, so KEEP the
      // cookies and let the caller retry. 503 also tells SessionKeepAlive to stay
      // armed (only a 401 stops its polling).
      return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 });
    }
    throw err;
  }

  if (!tokens) {
    await clearAuthCookies();
    return NextResponse.json({ error: "Session expired" }, { status: 401 });
  }

  await setAuthCookies(tokens);
  return NextResponse.json({ ok: true });
}

/**
 * Redirecting variant used by the edge proxy: when a page request arrives with
 * an expired access token but a live refresh token, the proxy bounces here. We
 * rotate the session, set fresh cookies and 302 back to the original page — so
 * the user never sees a logout.
 *
 * `soft=1` means the proxy was renewing opportunistically on a page the visitor is
 * allowed to read anonymously. A dead refresh token then just means "browse signed
 * out" — sending them to /login would be a worse experience than the stale navbar
 * we were trying to fix. Without it (a genuinely gated route) failure goes to /login.
 *
 * Every redirect below is based on `env.APP_URL`, NOT on `req.url`. Under
 * `output: "standalone"` the server binds to `process.env.HOSTNAME` (which Docker
 * sets to the container id, and our Dockerfile pins to 0.0.0.0) and Next runs with
 * `trustHostHeader: false`, so it ignores the incoming Host header and `req.url`
 * resolves to `http://0.0.0.0:3000/...`. The proxy gets away with `req.url` because
 * Next rewrites same-origin *middleware* redirects to a relative Location; a route
 * handler emits its Location verbatim, so using `url.origin` here sent real users
 * to http://0.0.0.0:3000. `url` is still parsed below, but only for searchParams.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const target = safeRedirectPath(url.searchParams.get("redirect"));
  const soft = url.searchParams.get("soft") === "1";

  const refresh = await readRefreshCookie();
  let tokens;
  try {
    tokens = refresh
      ? await rotateSession(refresh, {
          userAgent: req.headers.get("user-agent"),
          ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
        })
      : null;
  } catch (err) {
    if (err instanceof SessionUnavailableError) {
      // Can't verify right now: send them back to the page WITH their cookies
      // intact. The proxy's 10s attempt marker stops this from looping, and the
      // next navigation retries once the store recovers.
      console.error("[auth] refresh unavailable, preserving session cookies:", err);
      // The page we send them back to will render signed-out. Flag it so the
      // client shell renews and redraws once the store answers, instead of
      // leaving signed-in chrome over an empty page (see AUTH_RECOVER_COOKIE).
      await markSessionForRecovery();
      return NextResponse.redirect(new URL(target, env.APP_URL));
    }
    throw err;
  }

  if (!tokens) {
    // Clears the refresh cookie too, so the proxy sees nothing to recover and
    // won't bounce this visitor here again.
    await clearAuthCookies();
    if (soft) {
      // Genuinely signed out now — but an in-app navigation keeps the layout it
      // already had, so the navbar would go on saying "signed in". The flag makes
      // the client redraw once so chrome and page agree.
      await markSessionForRecovery();
      return NextResponse.redirect(new URL(target, env.APP_URL));
    }
    const login = new URL("/login", env.APP_URL);
    login.searchParams.set("callbackUrl", target);
    return NextResponse.redirect(login);
  }

  await setAuthCookies(tokens);
  // The proxy's one-shot marker is deliberately NOT cleared here. It is the only
  // thing standing between us and an infinite redirect loop when a rotate succeeds
  // but its cookie never sticks (Secure cookies over plain http, a proxy stripping
  // Set-Cookie): the marker has to still be there on the way back for the proxy to
  // notice and render signed-out instead of bouncing again. It expires on its own
  // in 10s, and a valid access token makes it irrelevant long before that.
  return NextResponse.redirect(new URL(target, env.APP_URL));
}
