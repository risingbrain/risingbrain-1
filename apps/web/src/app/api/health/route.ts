import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { redis, redisAttempt } from "@/lib/auth/redis";

// Always run on request — this endpoint exists to exercise the live connections.
export const dynamic = "force-dynamic";

/** Don't let a hung store hold the probe open; report it as down instead. */
const PROBE_TIMEOUT_MS = 8_000;

async function timed(probe: () => Promise<unknown>): Promise<{ ok: boolean; ms: number }> {
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      probe(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), PROBE_TIMEOUT_MS);
      }),
    ]);
    return { ok: true, ms: Date.now() - started };
  } catch {
    return { ok: false, ms: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GET /api/health — liveness + keep-warm probe.
 *
 * The app runs on Vercel functions and Postgres/Redis on Railway, reached over
 * the public internet. After a quiet spell the first request pays a cold
 * function, fresh TCP + TLS to both stores, and possibly a store waking up —
 * which is exactly when a session renewal can time out and a signed-in user
 * sees a signed-out page. An uptime monitor hitting this every ~5 minutes keeps
 * a function instance, its pooled connections and the stores warm, and doubles
 * as an alert when a store is actually down.
 *
 * Postgres is required (503 without it); Redis is reported but optional, since
 * auth degrades to Postgres when it's unreachable. Exposes nothing beyond
 * up/down and timings.
 */
export async function GET() {
  const [db, cache] = await Promise.all([
    timed(() => prisma.$queryRaw`SELECT 1`),
    timed(async () => {
      const r = await redisAttempt(() => redis.ping());
      if (!r.ok) throw r.error;
    }),
  ]);
  return NextResponse.json(
    { ok: db.ok, postgres: db, redis: cache },
    { status: db.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}
