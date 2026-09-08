/**
 * The edge proxy's handling of PREFETCH requests on gated routes.
 *
 * A prefetch is a guess about where the user might click, and the router can
 * serve its answer on the real click. The proxy therefore refuses to renew a
 * lapsed access token on one (renewing on speculation would rotate the refresh
 * token constantly) — but for a while it still applied the "unauthenticated →
 * /login" rule to those same requests. On /admin, whose nav prefetched six
 * sibling routes, that meant 15 idle minutes was enough to hand the router a
 * cached /login for every tab, logging out an admin whose refresh cookie was
 * perfectly alive.
 *
 * These tests pin both halves: a denied prefetch resolves to nothing, and the
 * real navigation behind it still behaves exactly as before.
 */
import { describe, expect, test } from "bun:test";
import { SignJWT } from "jose";

process.env.AUTH_SECRET = "test-secret-for-authflow-verification-only";

const { NextRequest } = await import("next/server");
const { COOKIES, REFRESH_ATTEMPT_COOKIE } = await import("../src/lib/auth/constants");
const proxy = (await import("../src/proxy")).default;

const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

/** A signed access token, valid or already expired, for the given role. */
async function accessToken(role: string, { expired = false } = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ role, sid: "sid-1" })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("user-1")
    .setIssuedAt(expired ? now - 3600 : now)
    .setExpirationTime(expired ? now - 60 : now + 900)
    .sign(secret);
}

type Opts = {
  access?: string;
  refresh?: string;
  attempt?: boolean;
  /** "header" = next-router-prefetch, "purpose" = the older purpose: prefetch. */
  prefetch?: "header" | "purpose";
  method?: string;
};

function request(pathname: string, opts: Opts = {}) {
  const jar: string[] = [];
  if (opts.access) jar.push(`${COOKIES.ACCESS}=${opts.access}`);
  if (opts.refresh) jar.push(`${COOKIES.REFRESH}=${opts.refresh}`);
  if (opts.attempt) jar.push(`${REFRESH_ATTEMPT_COOKIE}=1`);

  const headers = new Headers();
  if (jar.length) headers.set("cookie", jar.join("; "));
  if (opts.prefetch === "header") headers.set("next-router-prefetch", "1");
  if (opts.prefetch === "purpose") headers.set("purpose", "prefetch");

  return new NextRequest(new URL(pathname, "https://risingbrain.test"), {
    method: opts.method ?? "GET",
    headers,
  });
}

/** Where a response sends the browser, or null when it sends it nowhere. */
const locationOf = (res: Response) => res.headers.get("location");

describe("a denied prefetch is never turned into a redirect", () => {
  test("lapsed access token + live refresh cookie on /admin resolves to nothing", async () => {
    const res = await proxy(
      request("/admin/users", {
        access: await accessToken("ADMIN", { expired: true }),
        refresh: "live-refresh-token",
        prefetch: "header",
      }),
    );

    expect(res.status).toBe(204);
    expect(locationOf(res)).toBeNull();
  });

  test("the same request via the older `purpose: prefetch` header", async () => {
    const res = await proxy(
      request("/admin/users", {
        access: await accessToken("ADMIN", { expired: true }),
        refresh: "live-refresh-token",
        prefetch: "purpose",
      }),
    );

    expect(res.status).toBe(204);
    expect(locationOf(res)).toBeNull();
  });

  test("no cookies at all still resolves to nothing, not /login", async () => {
    // Even with no session to recover, caching a /login payload against an
    // /admin href is wrong: it would drive the click too.
    const res = await proxy(request("/admin", { prefetch: "header" }));

    expect(res.status).toBe(204);
    expect(locationOf(res)).toBeNull();
  });

  test("FORBIDDEN is covered too — a non-admin prefetch isn't sent to /?forbidden=1", async () => {
    const res = await proxy(
      request("/admin", { access: await accessToken("NORMAL"), prefetch: "header" }),
    );

    expect(res.status).toBe(204);
    expect(locationOf(res)).toBeNull();
  });

  test("the in-flight refresh marker doesn't change the answer", async () => {
    // `attempt` suppresses `recoverable`, which is the other way to reach the
    // denial branch with a live session.
    const res = await proxy(
      request("/notes", {
        access: await accessToken("NORMAL", { expired: true }),
        refresh: "live-refresh-token",
        attempt: true,
        prefetch: "header",
      }),
    );

    expect(res.status).toBe(204);
    expect(locationOf(res)).toBeNull();
  });
});

describe("real navigations are unchanged", () => {
  test("a lapsed token on /admin is bounced through the refresh route", async () => {
    const res = await proxy(
      request("/admin/users", {
        access: await accessToken("ADMIN", { expired: true }),
        refresh: "live-refresh-token",
      }),
    );

    const location = locationOf(res);
    expect(location).toContain("/api/auth/refresh");
    expect(location).toContain("redirect=%2Fadmin%2Fusers");
    // Hard bounce (no soft=1): /login is the right destination on a gated route
    // if the refresh token turns out to be dead.
    expect(location).not.toContain("soft=1");
  });

  test("no session on /admin still goes to /login with a callback", async () => {
    const res = await proxy(request("/admin"));

    const location = locationOf(res);
    expect(location).toContain("/login");
    expect(location).toContain("callbackUrl=%2Fadmin");
  });

  test("a non-admin on /admin still goes to /?forbidden=1", async () => {
    const res = await proxy(request("/admin", { access: await accessToken("NORMAL") }));

    expect(locationOf(res)).toContain("forbidden=1");
  });
});

describe("everything else keeps working", () => {
  test("a valid admin prefetch passes through", async () => {
    const res = await proxy(
      request("/admin/users", { access: await accessToken("ADMIN"), prefetch: "header" }),
    );

    expect(res.status).toBe(200);
    expect(locationOf(res)).toBeNull();
  });

  test("a prefetch of a PUBLIC route passes through, lapsed token and all", async () => {
    // Public routes never reach the denial branch, so the 204 must not apply —
    // these pages render fine for an anonymous visitor.
    const res = await proxy(
      request("/sheet", {
        access: await accessToken("NORMAL", { expired: true }),
        refresh: "live-refresh-token",
        prefetch: "header",
      }),
    );

    expect(res.status).toBe(200);
    expect(locationOf(res)).toBeNull();
  });

  test("a real navigation to a public route still renews opportunistically", async () => {
    const res = await proxy(
      request("/sheet", {
        access: await accessToken("NORMAL", { expired: true }),
        refresh: "live-refresh-token",
      }),
    );

    const location = locationOf(res);
    expect(location).toContain("/api/auth/refresh");
    expect(location).toContain("soft=1");
  });
});
