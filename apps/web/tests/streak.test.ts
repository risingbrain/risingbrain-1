/**
 * The streak walk.
 *
 * This logic used to be copy-pasted into three files — the navbar flame, the
 * sheet calendar badge and the profile stat — and they drifted: two counted
 * activity of any kind, the third counted DSA solves only, so /sheet showed a
 * smaller streak than the flame rendered directly above it. The walk now lives
 * once in `lib/streak-days.ts` and these tests pin its behaviour so a future caller
 * can't quietly reintroduce a second definition.
 */
import { describe, expect, test } from "bun:test";
import { buildSnapshot, computeLongestStreak, computeStreak } from "@/lib/streak-days";
import { istToday, keyOf, addDays } from "@/lib/ist";

/** An IST "today" fixed in UTC-midnight space, the shape `istToday` returns. */
const TODAY = istToday(new Date("2026-09-12T09:00:00Z"));

/** Day keys for `offsets` days back from TODAY (0 = today, 1 = yesterday). */
const daysBack = (...offsets: number[]) =>
  new Set(offsets.map((n) => keyOf(addDays(TODAY, -n))));

describe("computeStreak", () => {
  test("no activity at all is 0, not a crash", () => {
    expect(computeStreak(new Set(), TODAY)).toBe(0);
  });

  test("counts consecutive days ending today", () => {
    expect(computeStreak(daysBack(0, 1, 2, 3), TODAY)).toBe(4);
  });

  test("a day not yet practised does NOT break a live streak", () => {
    // The user practised yesterday and the two days before, but hasn't opened
    // the app today. That is a 3-day streak still alive, not a broken one.
    expect(computeStreak(daysBack(1, 2, 3), TODAY)).toBe(3);
  });

  test("a gap two days back does break it", () => {
    // Today and yesterday, then nothing until four days ago.
    expect(computeStreak(daysBack(0, 1, 4, 5, 6), TODAY)).toBe(2);
  });

  test("today alone is 1", () => {
    expect(computeStreak(daysBack(0), TODAY)).toBe(1);
  });

  test("activity that stopped two days ago is broken", () => {
    expect(computeStreak(daysBack(2, 3, 4), TODAY)).toBe(0);
  });

  test("future-dated days are ignored rather than counted", () => {
    const days = new Set([...daysBack(0, 1), keyOf(addDays(TODAY, 1))]);
    expect(computeStreak(days, TODAY)).toBe(2);
  });

  test("crosses a month boundary", () => {
    const oct1 = istToday(new Date("2026-10-01T09:00:00Z"));
    const days = new Set(
      [0, 1, 2, 3].map((n) => keyOf(addDays(oct1, -n))) // Oct 1 back into Sep
    );
    expect(computeStreak(days, oct1)).toBe(4);
  });
});

describe("computeLongestStreak", () => {
  test("empty is 0", () => {
    expect(computeLongestStreak(new Set())).toBe(0);
  });

  test("a lone day is 1", () => {
    expect(computeLongestStreak(daysBack(5))).toBe(1);
  });

  test("finds the longest run, not the most recent one", () => {
    // A 2-day run now, a 5-day run a fortnight ago.
    const days = daysBack(0, 1, 14, 15, 16, 17, 18);
    expect(computeLongestStreak(days)).toBe(5);
  });

  test("is order-independent (Set iteration order must not matter)", () => {
    const shuffled = new Set([...daysBack(3, 0, 2, 1)]);
    expect(computeLongestStreak(shuffled)).toBe(4);
  });
});

describe("streak definition is section-agnostic", () => {
  /**
   * The bug this whole change fixes: a learner who does aptitude on some days
   * and DSA on others has ONE streak. Feeding the shared walk the union of
   * active days — which is what every caller now does — must return the full
   * run, not the length of either section's own run.
   */
  test("alternating MCQ and DSA days form one unbroken streak", () => {
    const dsaDays = [0, 2, 4];
    const mcqDays = [1, 3];
    const anyActivity = daysBack(...dsaDays, ...mcqDays);

    expect(computeStreak(anyActivity, TODAY)).toBe(5);
    // What the old sheet-only view reported, for contrast.
    expect(computeStreak(daysBack(...dsaDays), TODAY)).toBe(1);
  });
});

describe("buildSnapshot — what the live displays read", () => {
  const row = (offset: number, count: number, dsaCount: number) => ({
    day: addDays(TODAY, -offset),
    count,
    dsaCount,
  });

  test("picks today's row for both counts", () => {
    const s = buildSnapshot([row(0, 5, 3), row(1, 2, 2)], TODAY);
    expect(s.todayCount).toBe(5);
    expect(s.todayDsaCount).toBe(3);
    expect(s.streak).toBe(2);
  });

  test("no row for today means zero counts, but the streak survives", () => {
    // Practised yesterday and the day before, nothing yet today. The streak is
    // still alive at 2 — and todayCount 0 is exactly how a caller can tell that
    // today is NOT yet banked, which the bare number cannot express.
    const s = buildSnapshot([row(1, 4, 4), row(2, 1, 1)], TODAY);
    expect(s.todayCount).toBe(0);
    expect(s.todayDsaCount).toBe(0);
    expect(s.streak).toBe(2);
  });

  test("a day of pure MCQ practice banks the streak with no DSA solves", () => {
    // The sheet calendar paints 0 on today's square while the flame reads 1 —
    // correct: the square is DSA-only, the streak is not.
    const s = buildSnapshot([row(0, 6, 0)], TODAY);
    expect(s.todayDsaCount).toBe(0);
    expect(s.todayCount).toBe(6);
    expect(s.streak).toBe(1);
  });

  test("no activity at all is all zeroes", () => {
    expect(buildSnapshot([], TODAY)).toEqual({ streak: 0, todayCount: 0, todayDsaCount: 0 });
  });
});
