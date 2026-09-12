import { DAY_MS, keyOf } from "@/lib/ist";

/**
 * The streak walk itself — pure, and deliberately free of any server import.
 *
 * WHY ITS OWN MODULE. `lib/streak.ts` reaches for Prisma (and through it
 * `server-only`), which makes it unloadable from a test runner. The arithmetic
 * below is the part worth pinning down, so it lives where it can be imported on
 * its own. See `tests/streak.test.ts`.
 *
 * WHY IT IS SHARED. The navbar flame, the sheet calendar badge and the profile
 * stat each used to carry their own copy of this walk, and they drifted: two
 * counted activity of any kind, the third counted DSA solves only, so /sheet
 * reported a smaller streak than the flame directly above it. One function, one
 * definition — practice anywhere on the site keeps the streak alive.
 *
 * Callers decide WHICH days go in the set; this only decides how they are
 * counted. Pass every active day (not one section's) unless you genuinely mean
 * to show a section-scoped number, and label it if you do.
 */

/**
 * Consecutive IST days with activity, ending today or yesterday.
 *
 * `days` holds `YYYY-MM-DD` keys; `today` is an IST calendar date in
 * UTC-midnight space (what `istToday` returns). Starting at yesterday when today
 * is absent is what stops a live streak reading as broken before the user has
 * had a chance to practise today.
 */
export function computeStreak(days: Set<string>, today: Date): number {
  if (days.size === 0) return 0;
  let probe = days.has(keyOf(today)) ? today : new Date(today.getTime() - DAY_MS);
  let streak = 0;
  while (days.has(keyOf(probe))) {
    streak += 1;
    probe = new Date(probe.getTime() - DAY_MS);
  }
  return streak;
}

/** Longest run of consecutive days anywhere in `days`. Same set, same rules. */
export function computeLongestStreak(days: Set<string>): number {
  let longest = 0;
  let run = 0;
  let prevKey: string | null = null;
  // `YYYY-MM-DD` sorts lexicographically into chronological order.
  for (const k of [...days].sort()) {
    if (prevKey && (Date.parse(k) - Date.parse(prevKey)) / DAY_MS === 1) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
    prevKey = k;
  }
  return longest;
}

/** One `ActivityDay` row, as the streak query selects it. */
export type ActivityDayRow = { day: Date; count: number; dsaCount: number };

/** The live snapshot every activity display reads. See `StreakSnapshot`. */
export type ActivitySnapshot = {
  streak: number;
  todayCount: number;
  todayDsaCount: number;
};

/**
 * Shape the day rows into the snapshot. Pure, so the "which row is today" pick
 * is testable — that pick is what the sheet calendar's today square now depends
 * on, in place of the browser's old (and wrong) local estimate.
 */
export function buildSnapshot(rows: ActivityDayRow[], today: Date): ActivitySnapshot {
  const todayKey = keyOf(today);
  const todayRow = rows.find((r) => keyOf(r.day) === todayKey);
  return {
    streak: computeStreak(new Set(rows.map((r) => keyOf(r.day))), today),
    todayCount: todayRow?.count ?? 0,
    todayDsaCount: todayRow?.dsaCount ?? 0,
  };
}
