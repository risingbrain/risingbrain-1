import { prisma } from "@/lib/db";
import { DAY_MS, istToday } from "@/lib/ist";
import { buildSnapshot } from "@/lib/streak-days";

/**
 * Current practice streak (consecutive IST days with activity, ending today or
 * yesterday). Reads the pre-aggregated `ActivityDay` table — one row per active
 * day — instead of scanning the raw progress tables, so the navbar flame (which
 * renders on EVERY page) costs a single small indexed range scan.
 */

/**
 * Returns the streak count, or `null` when the activity can't be loaded (a
 * transient DB error). The navbar renders the flame on every page, so a hiccup
 * must NOT throw and take the page down — and `null` lets the caller HIDE the
 * badge entirely rather than show a misleading "broken streak". A real `0` (user
 * signed in, no activity yet) is still a valid value that shows the dull flame.
 */
/**
 * The badge renders on every page, so it gets a hard time budget as well as an
 * error guard. Without one, an unreachable serverless Postgres would block the
 * whole page for the pool's full connect timeout before this returned null —
 * failing soft but arriving far too late to matter.
 */
const STREAK_BUDGET_MS = 2_500;

/**
 * Everything a live activity display needs, from the one scan that was already
 * being made.
 *
 * `todayDsaCount` exists because the sheet calendar cannot work it out itself:
 * the page ships `{ problemId, status, isBookmarked }` per problem and no
 * `solvedAt`, so the browser cannot tell a problem first solved TODAY from one
 * solved last year. It used to guess with a session-wide net of the solved count,
 * which meant un-ticking month-old work made today's square go down. The server
 * knows the real number; this hands it over.
 */
export type StreakSnapshot = {
  /** Consecutive IST days with activity of any kind. */
  streak: number;
  /** Total contributions logged today — the streak is alive iff this is > 0. */
  todayCount: number;
  /** DSA solves logged today; what the sheet calendar paints on today's square. */
  todayDsaCount: number;
};

/**
 * Returns null when the activity can't be loaded, exactly as before — the caller
 * hides the badge rather than showing a misleading "broken streak".
 */
export async function getStreakSnapshot(userId: string): Promise<StreakSnapshot | null> {
  const since = new Date(Date.now() - 400 * DAY_MS);

  let rows: { day: Date; count: number; dsaCount: number }[];
  try {
    rows = await Promise.race([
      prisma.activityDay.findMany({
        where: { userId, day: { gte: since }, count: { gt: 0 } },
        // `count`/`dsaCount` ride along on the scan the streak already needed —
        // same rows, same index, no extra query.
        select: { day: true, count: true, dsaCount: true },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("streak lookup timed out")), STREAK_BUDGET_MS)
      ),
    ]);
  } catch (err) {
    console.error("[streak] failed to load activity, hiding the badge:", err);
    return null;
  }

  return buildSnapshot(rows, istToday(new Date()));
}

/** Just the number — the navbar flame's server-render path. */
export async function getCurrentStreak(userId: string): Promise<number | null> {
  return (await getStreakSnapshot(userId))?.streak ?? null;
}
