/**
 * Session renewal against a COLD session store — the morning after a quiet night.
 *
 * Production runs on Vercel functions with Postgres and Redis on Railway, reached
 * over the public internet. The first renewal of the day meets a fresh function,
 * fresh TCP + TLS to both stores and possibly a store still waking up. Renewal
 * used to give Postgres two tries 150ms apart, AFTER Redis had spent its own
 * connect allowance failing; when that ran out the page rendered signed-out for a
 * signed-in user ("logged in, but my progress is gone").
 *
 * These pin the fix: a store that answers within a few seconds is waited for, a
 * hung attempt doesn't burn the whole budget, Postgres is consulted in parallel
 * with a slow Redis, a write is retried but never abandoned mid-flight — and the
 * edge proxy flags the pages that still render signed-out so the client can
 * recover.
 */
import { describe, expect, test, mock, beforeEach } from "bun:test";
import { SignJWT } from "jose";
import { createFakePrisma } from "./support/fake-prisma";

process.env.AUTH_SECRET = "test-secret-for-authflow-verification-only";

const db = createFakePrisma();

/**
 * Redis that is reachable-but-useless (always misses). `redisDelayMs` slows only
 * the NEXT call — the session lookup — like a cold connection that is warm after.
 */
let redisDelayMs = 0;
const slowRedis = {
  redis: new Proxy({}, { get: () => () => Promise.reject(new Error("redis unused")) }),
  redisTry: async () => {
    const delay = redisDelayMs;
    redisDelayMs = 0;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    return null;
  },
  redisAttempt: async () => ({ ok: false as const, error: new Error("redis down") }),
};

mock.module("@/lib/db", () => ({ prisma: db.prisma }));
mock.module("./redis", () => slowRedis);
mock.module(require.resolve("../src/lib/auth/redis.ts"), () => slowRedis);

const { createSession, rotateSession } = await import("../src/lib/auth/session");
const { NextRequest } = await import("next/server");
const { COOKIES, REFRESH_ATTEMPT_COOKIE, AUTH_RECOVER_COOKIE } = await import(
  "../src/lib/auth/constants"
);
const proxy = (await import("../src/proxy")).default;

type Session = typeof db.prisma.session;

/** Make `method` fail its first `times` calls (a store still waking up), then work. */
function failFirst<K extends keyof Session>(method: K, times: number, how: "reject" | "hang" = "reject") {
  const real = db.prisma.session[method] as (...a: unknown[]) => Promise<unknown>;
  let calls = 0;
  (db.prisma.session as Record<string, unknown>)[method] = (...args: unknown[]) => {
    calls += 1;
    if (calls <= times) {
      return how === "hang"
        ? new Promise(() => {}) // never settles — a dead pooled socket
        : Promise.reject(new Error("Connection terminated unexpectedly"));
    }
    return real(...args);
  };
  return () => {
    (db.prisma.session as Record<string, unknown>)[method] = real;
    return calls;
  };
}

beforeEach(() => {
  db.reset();
  redisDelayMs = 0;
});

async function newSession(): Promise<string> {
  const tokens = await createSession({ userId: "user-1", role: "NORMAL" });
  return tokens.refreshToken as string;
}

describe("renewal waits for a store that is waking up", () => {
  test("reads that fail a few times and then answer still renew the session", async () => {
    const token = await newSession();
    const restore = failFirst("findUnique", 3);
    try {
      const result = await rotateSession(token);
      expect(result).not.toBeNull();
      expect(result!.refreshToken).not.toBeNull(); // a real rotation, not a degraded answer
    } finally {
      expect(restore()).toBeGreaterThanOrEqual(4);
    }
  });

  test("a hung first read doesn't burn the whole budget — the retry answers", async () => {
    const token = await newSession();
    const restore = failFirst("findUnique", 1, "hang");
    const started = Date.now();
    try {
      const result = await rotateSession(token);
      expect(result).not.toBeNull();
      // Capped per attempt (~3s), well inside the overall budget.
      expect(Date.now() - started).toBeLessThan(5_000);
    } finally {
      restore();
    }
  }, 10_000);

  test("a rotation write that fails twice is retried and rotates exactly once", async () => {
    const token = await newSession();
    const restore = failFirst("updateMany", 2);
    let rotated: string;
    try {
      const result = await rotateSession(token);
      expect(result).not.toBeNull();
      expect(result!.refreshToken).not.toBeNull();
      rotated = result!.refreshToken as string;
    } finally {
      restore();
    }
    // The token the browser now holds keeps working…
    const next = await rotateSession(rotated);
    expect(next).not.toBeNull();
    expect(next!.refreshToken).not.toBeNull();
    // …and exactly one rotation happened for the retried write: the row moved one
    // generation per successful call, never two.
    expect(db.rows).toHaveLength(1);
  });

  test("a store that stays down past the budget is 'unavailable', never 'signed out'", async () => {
    const token = await newSession();
    const restoreA = failFirst("findUnique", 1_000);
    const restoreB = failFirst("findFirst", 1_000);
    try {
      let threw: unknown;
      try {
        await rotateSession(token);
      } catch (err) {
        threw = err;
      }
      expect((threw as Error)?.name).toBe("SessionUnavailableError");
    } finally {
      restoreA();
      restoreB();
    }
  }, 15_000);
});

describe("Postgres is consulted in parallel with a slow Redis", () => {
  test("a slow Redis miss and a slow Postgres answer overlap instead of adding up", async () => {
    const token = await newSession();
    redisDelayMs = 800;
    const real = db.prisma.session.findUnique;
    db.prisma.session.findUnique = (async (args: Parameters<typeof real>[0]) => {
      await new Promise((r) => setTimeout(r, 800));
      return real(args);
    }) as typeof real;
    const started = Date.now();
    try {
      const result = await rotateSession(token);
      expect(result).not.toBeNull();
      // Sequential would be ≥1600ms; overlapped is ~800ms.
      expect(Date.now() - started).toBeLessThan(1_400);
    } finally {
      db.prisma.session.findUnique = real;
    }
  });
});

describe("edge proxy flags pages that render signed-out for a live session", () => {
  const secret = new TextEncoder().encode(process.env.AUTH_SECRET);

  const expiredToken = () => {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ role: "NORMAL", sid: "sid-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuedAt(now - 3600)
      .setExpirationTime(now - 60)
      .sign(secret);
  };

  const request = (cookies: string[], prefetch = false) => {
    const headers = new Headers({ cookie: cookies.join("; ") });
    if (prefetch) headers.set("next-router-prefetch", "1");
    return new NextRequest(new URL("/sheet", "https://risingbrain.test"), { headers });
  };
  const recoverCookie = (res: Response) =>
    (res.headers.get("set-cookie") ?? "").split(/,(?=\s*\w+=)/).find((c) => c.trim().startsWith(`${AUTH_RECOVER_COOKIE}=`));

  test("renewal skipped because one just failed → page is flagged for recovery", async () => {
    const res = await proxy(
      request([
        `${COOKIES.ACCESS}=${await expiredToken()}`,
        `${COOKIES.REFRESH}=live-refresh-token`,
        `${REFRESH_ATTEMPT_COOKIE}=1`,
      ]),
    );
    expect(res.headers.get("location")).toBeNull(); // renders, no redirect loop
    const flag = recoverCookie(res);
    expect(flag).toBeDefined();
    expect(flag).not.toMatch(/HttpOnly/i); // the client shell must be able to read it
  });

  test("a normal lapsed navigation still renews instead of flagging", async () => {
    const res = await proxy(
      request([`${COOKIES.ACCESS}=${await expiredToken()}`, `${COOKIES.REFRESH}=live-refresh-token`]),
    );
    expect(res.headers.get("location")).toContain("/api/auth/refresh");
    expect(recoverCookie(res)).toBeUndefined();
  });

  test("prefetches and visitors without a session are never flagged", async () => {
    const prefetch = await proxy(
      request(
        [`${COOKIES.REFRESH}=live-refresh-token`, `${REFRESH_ATTEMPT_COOKIE}=1`],
        true,
      ),
    );
    expect(recoverCookie(prefetch)).toBeUndefined();

    const anonymous = await proxy(request([`${REFRESH_ATTEMPT_COOKIE}=1`]));
    expect(recoverCookie(anonymous)).toBeUndefined();
  });
});
