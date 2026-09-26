/**
 * Session lifecycle (Node runtime). Redis is the live fast path; the Session row
 * is the durable record AND the fallback when Redis is unreachable. Enforces ONE
 * active session per user and rotates the refresh token on every use with reuse
 * detection. See docs/ARCHITECTURE.md §1.
 *
 * Redis-outage policy: Redis is a cache, never the sole authority. Every write is
 * best-effort and every read falls back to Postgres, so login/refresh keep working
 * while Redis is down. Reuse detection is delegated to the DB (`refreshHash` is
 * `@unique` and rotates on every use), so degrading to the DB path does not weaken
 * it — a replayed token matches no live row either way. The rotation grace window
 * is mirrored onto the row for the same reason (see `rtPrevKey` below): anything
 * that exists ONLY in Redis is a feature that silently switches off during an
 * outage, and a grace window that switches off is a mass logout.
 */
import { prisma } from "@/lib/db";
import { redis, redisTry } from "./redis";
import { signAccessToken } from "./jwt";
import { generateRefreshToken, sha256 } from "./crypto";
import { REFRESH_TTL_SECONDS, REFRESH_GRACE_SECONDS, type AppRole } from "./constants";

const sessionKey = (sid: string) => `session:${sid}`;
const userSidKey = (userId: string) => `user:${userId}:sid`;
const rtKey = (hash: string) => `rt:${hash}`;
/**
 * Just-rotated refresh hashes, kept for REFRESH_GRACE_SECONDS so two requests that
 * race with the same token both succeed instead of one being treated as a replay.
 *
 * This is the FAST path only. The same window is mirrored onto the session row
 * (`prevRefreshHash` / `prevRefreshExpiresAt`), because a Redis-only grace window
 * disappears exactly when it is needed most: with Redis down every refresh race
 * fell through to the strict DB lookup, found nothing, and hard logged the user
 * out — and races are guaranteed, since the edge proxy's refresh bounce runs
 * concurrently with SessionKeepAlive's ping.
 */
const rtPrevKey = (hash: string) => `rtprev:${hash}`;

interface RedisSession {
  userId: string;
  role: AppRole;
  refreshHash: string;
  /** Whether the client's auth cookies should persist across browser restarts. */
  persistent: boolean;
}

export interface IssuedTokens {
  accessToken: string;
  /**
   * The new refresh token, or `null` for "leave the refresh cookie alone".
   *
   * `null` is returned when a refresh lands inside the rotation grace window —
   * i.e. a concurrent request already rotated this session. That request's token
   * is the live one and its `Set-Cookie` is in flight to the same browser, so
   * minting yet another token here would be a race over which one the jar ends up
   * with. Writing no refresh cookie makes the outcome order-independent: whatever
   * the winner set is what survives. See `rotateSession`.
   */
  refreshToken: string | null;
  sid: string;
  /** Mirrors the session's persistence choice so cookie helpers can honor it. */
  persistent: boolean;
}

/**
 * Thrown by `rotateSession` when the backing stores are unreachable, as opposed to
 * the token being invalid. The distinction matters at the HTTP layer: `null` means
 * "sign in again" (clear the cookies), while this means "we couldn't tell — keep
 * your cookies and try again shortly". Conflating the two logs people out of a
 * perfectly good session every time Postgres hiccups.
 */
export class SessionUnavailableError extends Error {
  constructor(cause?: unknown) {
    super("Session store temporarily unavailable");
    this.name = "SessionUnavailableError";
    this.cause = cause;
  }
}

async function writeRedisSession(sid: string, data: RedisSession) {
  const ttl = REFRESH_TTL_SECONDS;
  await redisTry(() =>
    redis
      .multi()
      .set(sessionKey(sid), JSON.stringify(data), "EX", ttl)
      .set(userSidKey(data.userId), sid, "EX", ttl)
      .set(rtKey(data.refreshHash), sid, "EX", ttl)
      .exec()
  );
}

/** Revoke a single session everywhere (durable DB record + Redis live state). */
export async function revokeSession(sid: string): Promise<void> {
  // DB first: it's the authority, so a revoke must stick even with Redis down.
  await prisma.session
    .update({ where: { id: sid }, data: { revokedAt: new Date() } })
    .catch(() => undefined); // best-effort; row may already be gone

  const raw = await redisTry(() => redis.get(sessionKey(sid)));
  await redisTry(async () => {
    const pipeline = redis.multi().del(sessionKey(sid));
    if (raw) {
      const data = JSON.parse(raw) as RedisSession;
      pipeline.del(rtKey(data.refreshHash)).del(rtPrevKey(data.refreshHash));
      const current = await redis.get(userSidKey(data.userId));
      if (current === sid) pipeline.del(userSidKey(data.userId));
    }
    return pipeline.exec();
  });
}

/**
 * Revoke every session for a user — marks all open DB rows revoked AND clears the
 * live Redis session/refresh index. Used after a password reset so existing logins
 * can't outlive the credential change.
 */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  // Find live sids from the DB, not Redis, so a Redis outage can't cause a
  // password reset to silently leave sessions alive.
  const rows = await prisma.session.findMany({
    where: { userId, revokedAt: null },
    select: { id: true },
  });
  await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  for (const row of rows) await revokeSession(row.id);
  await redisTry(() => redis.del(userSidKey(userId)));
}

/** Create a brand-new session, revoking any prior one (single active login). */
export async function createSession(params: {
  userId: string;
  role: AppRole;
  userAgent?: string | null;
  ip?: string | null;
  /** "Remember me": persist cookies across browser restarts. Defaults to true. */
  persistent?: boolean;
}): Promise<IssuedTokens> {
  const { userId, role, userAgent, ip, persistent = true } = params;

  // One-login-per-user. Driven off the DB so it still holds with Redis down;
  // revokeAllUserSessions also clears whatever Redis state is reachable.
  await revokeAllUserSessions(userId);

  const refreshToken = generateRefreshToken();
  const refreshHash = await sha256(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TTL_SECONDS * 1000);

  const row = await prisma.session.create({
    data: {
      userId,
      refreshHash,
      userAgent: userAgent ?? null,
      ip: ip ?? null,
      expiresAt,
    },
  });
  const sid = row.id;

  await writeRedisSession(sid, { userId, role, refreshHash, persistent });
  const accessToken = await signAccessToken({ sub: userId, role, sid });

  return { accessToken, refreshToken, sid, persistent };
}

/**
 * Waits between attempts when the session store is slow to answer.
 *
 * Sized for a COLD START, not a blip: the app runs on Vercel functions and the
 * stores on Railway, reached over the public internet. The first request after
 * a quiet spell (every morning) pays a fresh function, fresh TCP + TLS to both
 * stores, and — if the service was idle — a store waking up. Two tries 150ms
 * apart (what this used to be) routinely gave up before the store answered,
 * and a refresh that gives up renders the page signed-out for a user who is
 * signed in. A refresh happens at most once per ~12 minutes per user, so
 * waiting a few seconds here is cheap; ordinary page queries are unaffected.
 */
const STORE_RETRY_DELAYS_MS = [200, 500, 1_000, 2_000];
/** Total time a session READ may spend (attempts + waits) before "unavailable". */
const STORE_READ_BUDGET_MS = 6_000;
/**
 * Cap on ONE read attempt, so a single hung query (a dead pooled socket) can't
 * eat the whole budget — a retry on a fresh connection usually answers at once.
 */
const STORE_ATTEMPT_TIMEOUT_MS = 3_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Reject if `promise` hasn't settled within `ms`, always clearing the timer. */
async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`session store read timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A Postgres read whose FAILURE must never be mistaken for "no such session".
 *
 * Everything in `rotateSession` hinges on that distinction: a completed query
 * returning nothing means the token is dead (clear cookies, sign in again), while
 * an exception means we simply could not ask. Letting the exception escape raw
 * turns the refresh endpoint into a 500, and a 500 is what the client and the
 * proxy read as "broken" rather than "retry shortly".
 *
 * This is not hypothetical: a rotated database password meant the running
 * container could not authenticate at all, and every refresh answered 500 —
 * indistinguishable, from the outside, from the session being gone.
 *
 * Retried with backoff inside STORE_READ_BUDGET_MS (see STORE_RETRY_DELAYS_MS).
 * Each attempt is also capped (STORE_ATTEMPT_TIMEOUT_MS, and never past the
 * budget), so a connection that hangs can't hold the request past it. That is
 * safe for READS only — an abandoned read has no side effects. Writes are never
 * raced against a timer; see the rotation below.
 */
async function dbRead<T>(op: () => Promise<T>, what: string): Promise<T> {
  const deadline = Date.now() + STORE_READ_BUDGET_MS;
  let lastErr: unknown;
  for (let attempt = 0; ; attempt++) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) break;
    try {
      return await withDeadline(op(), Math.min(remaining, STORE_ATTEMPT_TIMEOUT_MS));
    } catch (err) {
      lastErr = err;
    }
    const wait = STORE_RETRY_DELAYS_MS[attempt];
    if (wait === undefined || Date.now() + wait >= deadline) break;
    await sleep(wait);
  }
  console.error(`[auth] session lookup (${what}) failed:`, lastErr);
  throw new SessionUnavailableError(lastErr);
}

/**
 * Was this token rotated away moments ago by a concurrent request? A burst of
 * refreshes from one navigation legitimately presents the same token more than
 * once, and those callers must be served rather than logged out.
 *
 * Redis first (cheap), then Postgres — the DB copy is what makes this work during
 * a Redis outage, which is precisely when refresh races are most likely to be fatal.
 */
async function resolveGrace(
  presentedHash: string
): Promise<{ sid: string; data: RedisSession } | null> {
  const graceSid = await redisTry(() => redis.get(rtPrevKey(presentedHash)));
  if (graceSid) {
    const raw = await redisTry(() => redis.get(sessionKey(graceSid)));
    if (raw) {
      const cached = JSON.parse(raw) as RedisSession;
      return { sid: graceSid, data: { ...cached, persistent: cached.persistent ?? true } };
    }
  }

  const now = new Date();
  const row = await dbRead(
    () =>
      prisma.session.findFirst({
        where: {
          prevRefreshHash: presentedHash,
          prevRefreshExpiresAt: { gt: now },
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true, userId: true, refreshHash: true, user: { select: { role: true } } },
      }),
    "grace window"
  );
  if (!row) return null;

  return {
    sid: row.id,
    data: {
      userId: row.userId,
      role: row.user.role as AppRole,
      refreshHash: row.refreshHash,
      persistent: true,
    },
  };
}

/**
 * The answer for a caller whose token was already rotated away: a fresh access
 * token and NO refresh cookie, so the winner's cookie is what the browser keeps.
 */
async function serveWithinGrace(
  sid: string,
  data: RedisSession,
  reason = "refresh race"
): Promise<IssuedTokens> {
  console.warn(`[auth] ${reason} on session ${sid} — serving access token, refresh cookie untouched`);
  // Keep the session's activity timestamp honest without touching the hash.
  // Best-effort: this is a nicety, and failing it must not fail the refresh.
  await prisma.session
    .updateMany({ where: { id: sid, revokedAt: null }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
  const accessToken = await signAccessToken({ sub: data.userId, role: data.role, sid });
  return { accessToken, refreshToken: null, sid, persistent: data.persistent };
}

/**
 * Validate + rotate a refresh token. Returns fresh tokens, or null if the token
 * is invalid / expired / reused (caller should clear cookies and force re-login).
 *
 * CONCURRENCY. Refreshes are not occasional — they arrive in bursts. `/domain`
 * and `/screening` are parallel routes, so ONE navigation with a lapsed access
 * token sends the page request and the `@nav` slot request through the edge proxy
 * at the same instant, and both bounce here; SessionKeepAlive can add a third.
 * Only the first can rotate; the rest land in the grace window, and what they do
 * there decides whether the session survives:
 *
 *   - Re-rotating (what this used to do) makes every burst mint N tokens whose
 *     `Set-Cookie` headers race. The jar keeps one arbitrary winner and the rest
 *     are orphaned, so each burst pushes the session another generation along —
 *     and the grace index only remembers ONE generation. A 3-way burst can leave
 *     the browser holding a token nothing recognises: a hard logout.
 *   - Issuing an access token and NOT touching the refresh cookie (what it does
 *     now) is order-independent. Exactly one token is ever live, whichever
 *     response lands last, and a burst of any size converges.
 */
export async function rotateSession(
  rawRefreshToken: string,
  meta?: { userAgent?: string | null; ip?: string | null }
): Promise<IssuedTokens | null> {
  const presentedHash = await sha256(rawRefreshToken);

  // --- Resolve the session: Redis fast path, Postgres fallback. ---
  // The Postgres lookup starts NOW, alongside Redis, instead of after Redis has
  // given up. On a cold start Redis alone can spend its whole connect allowance
  // (~3s) failing, and a sequential fallback then began its own cold connect only
  // afterwards — the two waits added up past the point the user saw a signed-out
  // page. Racing them costs one extra indexed read per refresh (~once per 12
  // minutes per user). The result is only used if Redis doesn't answer; the
  // `.catch` keeps an unused failure from surfacing as an unhandled rejection.
  const dbLookup = dbRead(
    () =>
      prisma.session.findUnique({
        where: { refreshHash: presentedHash },
        select: {
          id: true,
          userId: true,
          revokedAt: true,
          expiresAt: true,
          user: { select: { role: true } },
        },
      }),
    "refresh hash"
  );
  dbLookup.catch(() => undefined);
  let sid: string | null = null;
  let data: RedisSession | null = null;
  let fromRedis = false;
  /** Resolved through the grace window → a concurrent request already rotated. */
  let viaGrace = false;

  const cachedSid = await redisTry(() => redis.get(rtKey(presentedHash)));
  if (cachedSid) {
    const raw = await redisTry(() => redis.get(sessionKey(cachedSid)));
    if (raw) {
      const cached = JSON.parse(raw) as RedisSession;
      // The cached hash must match the presented one. A mismatch means the cache
      // is INCONSISTENT (a rotation whose `rt:` retire landed but whose session
      // write didn't, say) — not proof of token theft, and the cache is not the
      // authority on that question. Drop the stale pointer and let the Postgres
      // path below decide; a genuinely replayed token matches no live row there
      // and is rejected anyway. Revoking here instead used to log a user out over
      // a half-applied Redis pipeline.
      if (cached.refreshHash !== presentedHash) {
        await redisTry(() => redis.del(rtKey(presentedHash)));
      } else {
        sid = cachedSid;
        // Sessions created before "remember me" existed have no flag → persistent.
        data = { ...cached, persistent: cached.persistent ?? true };
        fromRedis = true;
      }
    }
  }

  if (!data) {
    // Redis missed or was unreachable. The DB row is authoritative, so a cache
    // gap can't log anyone out; a genuinely reused/rotated token still finds no
    // live row here and is correctly rejected below.
    const row = await dbLookup;
    if (row && !row.revokedAt && row.expiresAt > new Date()) {
      sid = row.id;
      data = {
        userId: row.userId,
        role: row.user.role as AppRole,
        refreshHash: presentedHash,
        // Not persisted on the row; assume "remember me" so a Redis outage
        // doesn't silently downgrade a long-lived login to a session cookie.
        persistent: true,
      };
    }
  }

  if (!data) {
    const graced = await resolveGrace(presentedHash);
    if (graced) {
      sid = graced.sid;
      data = graced.data;
      viaGrace = true;
    }
  }

  if (!data) return null;

  // --- Grace hit: serve an access token, leave the refresh token alone. -------
  // Another request already rotated this session microseconds ago and its
  // `Set-Cookie` is on its way to the same browser. Minting a competing token
  // here is what turned a harmless burst into a logout (see the header comment).
  if (viaGrace) return serveWithinGrace(sid!, data);

  // --- Rotate: mint a new refresh token, swap the rt index, update the row. ---
  const newRefreshToken = generateRefreshToken();
  const newHash = await sha256(newRefreshToken);

  // COMPARE-AND-SWAP. `refreshHash: presentedHash` in the WHERE is what makes a
  // burst safe: Postgres locks the row, so of N concurrent rotations exactly ONE
  // sees the hash it presented and updates; the rest match zero rows and fall into
  // the grace path below. Without it, all N read the same hash, all N wrote, and
  // all N returned a different token — the browser kept one arbitrarily and the
  // others were orphaned. The row's `prevRefreshHash` then pointed at the ORIGINAL
  // token, so an orphaned one matched nothing on its next use: the hard logout.
  //
  // `revokedAt: null` makes the DB the final authority for the other case: a
  // session revoked while Redis was down (so its cache entry lingered) matches
  // zero rows here and is rejected even on the Redis hit path.
  //
  // `dbFailed` is tracked separately from `rotatedInDb` because the two mean very
  // different things. A completed query reporting 0 rows is a verdict: the session
  // is gone. An exception is NOT a verdict — Neon suspends its compute when idle,
  // so "Connection terminated unexpectedly" on the first write after a lull is a
  // routine event. Treating that as "session invalid" is what turned a momentary
  // blip into a permanent logout.
  let rotatedInDb = false;
  let dbFailed = false;
  let lastErr: unknown;
  // Retried on the same cold-start backoff as reads (a dropped pooled socket
  // usually succeeds at once on a fresh connection; a waking store takes longer).
  // Unlike reads, an attempt is NEVER abandoned on a timer: a write we stopped
  // waiting for can still commit, rotating the row to a token this response never
  // delivers — the browser would keep the old one, which outlives only the 60s
  // grace window. Each attempt is bounded by the pool's own connect timeout.
  for (let attempt = 1; attempt <= STORE_RETRY_DELAYS_MS.length; attempt++) {
    try {
      const { count } = await prisma.session.updateMany({
        where: { id: sid!, refreshHash: presentedHash, revokedAt: null },
        data: {
          refreshHash: newHash,
          // Retire the superseded hash into the DURABLE grace window, mirroring
          // the Redis `rtprev:` write below. This is the copy that keeps refresh
          // races survivable while Redis is unreachable.
          prevRefreshHash: presentedHash,
          prevRefreshExpiresAt: new Date(Date.now() + REFRESH_GRACE_SECONDS * 1000),
          lastUsedAt: new Date(),
          expiresAt: new Date(Date.now() + REFRESH_TTL_SECONDS * 1000),
          userAgent: meta?.userAgent ?? undefined,
          ip: meta?.ip ?? undefined,
        },
      });
      rotatedInDb = count > 0;
      dbFailed = false;
      break;
    } catch (err) {
      lastErr = err;
      dbFailed = true;
      if (attempt < STORE_RETRY_DELAYS_MS.length) await sleep(STORE_RETRY_DELAYS_MS[attempt - 1]!);
    }
  }

  if (dbFailed) {
    console.error("[auth] session rotate: database write failed:", lastErr);
    // Redis already authenticated this token, so the session is real — let the
    // user through on the cached identity rather than logging them out over a
    // write we can retry on the next rotation.
    //
    // But serve it the SAME way as a grace hit: an access token, and the refresh
    // cookie left exactly as it is. Handing back a NEW refresh token here (what
    // this used to do) is what made the blip fatal instead of survivable — the
    // durable row still holds the old hash with no `prevRefreshHash`, so once
    // Postgres recovered the next rotation lost the compare-and-swap, found
    // nothing in either grace store, and revoked the session. One transient write
    // failure guaranteed a hard logout ~12 minutes later; now it costs nothing
    // beyond a refresh cycle.
    if (fromRedis) return serveWithinGrace(sid!, data, "database write failed");
  }

  if (!rotatedInDb) {
    // Revoke ONLY on a definitive verdict. After a DB failure we know nothing
    // about the session, so surface it as "unavailable" — the caller keeps the
    // user's cookies and retries, instead of destroying a session that was fine.
    if (dbFailed) throw new SessionUnavailableError(lastErr);

    // Zero rows means one of two very different things: we LOST the compare-and-swap
    // to a concurrent refresh, or the session is genuinely gone. Ask the grace
    // window before concluding the latter — losing a race is the common case under
    // load, and treating it as "session invalid" is the logout this all exists to
    // prevent.
    const graced = await resolveGrace(presentedHash);
    if (graced) return serveWithinGrace(graced.sid, graced.data);

    await revokeSession(sid!);
    return null;
  }

  // Retire the superseded hash into the short grace index instead of deleting it
  // outright, so requests already in flight with it are served rather than logged
  // out. Ordered before `writeRedisSession` so there is no instant where the old
  // hash is gone and the new one isn't yet indexed.
  await redisTry(() =>
    redis
      .multi()
      .del(rtKey(presentedHash))
      .set(rtPrevKey(presentedHash), sid!, "EX", REFRESH_GRACE_SECONDS)
      .exec()
  );
  await writeRedisSession(sid!, { ...data, refreshHash: newHash });

  const accessToken = await signAccessToken({ sub: data.userId, role: data.role, sid: sid! });
  return { accessToken, refreshToken: newRefreshToken, sid: sid!, persistent: data.persistent };
}
