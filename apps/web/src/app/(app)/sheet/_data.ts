import { cacheLife, cacheTag } from "next/cache";
import { prisma, ProblemStatus } from "@/lib/db";
import { CACHE_TAGS } from "@/lib/cache";
import { addDays, istDayKey, istToday, keyOf } from "@/lib/ist";
import { computeLongestStreak, computeStreak } from "@/lib/streak-days";

/**
 * The full published DSA sheet tree — sheets → topics → patterns → problems →
 * companies. This is SHARED, seeded content: identical for every user and only
 * changes on a re-seed, so it is cached cross-request and tagged for on-demand
 * revalidation (see /api/admin/revalidate). It reads NO cookies and NO per-user
 * data — progress, bookmarks and notes are layered on per request in the page.
 */
export async function getDsaCatalog() {
  "use cache";
  cacheLife("hours");
  cacheTag(CACHE_TAGS.dsaCatalog);

  return prisma.dsaSheet.findMany({
    where: { isPublished: true },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      description: true,
      topics: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          name: true,
          description: true,
          patterns: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              name: true,
              strategy: true,
              identification: true,
              problems: {
                orderBy: { order: "asc" },
                select: {
                  id: true,
                  slug: true,
                  title: true,
                  reference: true,
                  difficulty: true,
                  leetcodeUrl: true,
                  gfgUrl: true,
                  youtubeUrl: true,
                  companies: {
                    select: { company: { select: { name: true, logoUrl: true } } },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

export type DsaCatalog = Awaited<ReturnType<typeof getDsaCatalog>>;

/**
 * Server-side activity data for the DSA Sheet route's calendar widget.
 *
 * Unlike the profile heatmap (which combines DSA + aptitude), this is scoped to
 * SHEET activity ONLY — DSA solves — read from the pre-aggregated `ActivityDay`
 * table (`dsaCount`), bucketed by IST calendar day. It powers the month-by-month
 * "solve streak" calendar in the sheet hero's right rail.
 */

const pad = (n: number) => String(n).padStart(2, "0");

// How many trailing months the calendar can page back through (incl. current).
const NUM_MONTHS = 6;

const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export type SheetDayCell = {
  key: string; // YYYY-MM-DD (IST)
  day: number; // day of month (1..N)
  count: number; // DSA solves logged that day
  level: 0 | 1 | 2 | 3 | 4;
  isToday: boolean;
  future: boolean;
};

export type SheetMonth = {
  key: string; // YYYY-MM
  label: string; // "June 2026"
  leading: number; // blank cells before day 1 (0=Sun .. 6=Sat)
  cells: SheetDayCell[];
};

export type SheetActivity = {
  months: SheetMonth[]; // chronological, oldest -> current (length NUM_MONTHS)
  currentStreak: number;
  longestStreak: number;
  totalSolved: number; // all-time DSA solves
  todayKey: string;
  joinedKey: string; // IST day the user's account was created (YYYY-MM-DD)
};

export function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

export async function getSheetActivity(userId: string): Promise<SheetActivity> {
  const now = new Date();
  const today = istToday(now);
  const todayKey = keyOf(today);
  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth();

  // Streaks need a longer look-back than the visible 6-month window; a single
  // 400-day scan of ActivityDay covers both the calendar and the streak. Days
  // are stored at UTC-midnight of the IST calendar date, so compare against a
  // UTC-midnight lower bound.
  const since = addDays(today, -400);

  // Every active day, not just the DSA ones: the CALENDAR below is DSA-only
  // (this is the DSA sheet), but the STREAK counts practice anywhere on the site
  // — aptitude, domain, DSA — so it matches the navbar flame instead of showing
  // a second, smaller number beside it. One scan still serves both.
  const [activityRows, totalSolved, user] = await Promise.all([
    prisma.activityDay.findMany({
      where: { userId, day: { gte: since }, count: { gt: 0 } },
      select: { day: true, dsaCount: true },
    }),
    prisma.userProblemProgress.count({ where: { userId, status: ProblemStatus.SOLVED } }),
    prisma.user.findUnique({ where: { id: userId }, select: { createdAt: true } }),
  ]);

  const joinedKey = user ? istDayKey(user.createdAt) : todayKey;

  // ---- Daily DSA-solve counts, keyed by IST day ----------------------------
  // Only days that actually carry a DSA solve reach the calendar; a day the user
  // spent on aptitude alone would otherwise paint a green square with a count of
  // zero behind it.
  const counts = new Map<string, number>();
  for (const r of activityRows) {
    if (r.dsaCount > 0) counts.set(keyOf(r.day), r.dsaCount);
  }

  // ---- One block per visible month -----------------------------------------
  const months: SheetMonth[] = [];
  for (let i = NUM_MONTHS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(currentYear, currentMonth - i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const leading = new Date(Date.UTC(y, m, 1)).getUTCDay(); // 0=Sun
    const cells: SheetDayCell[] = [];
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(y, m, day));
      const k = keyOf(date);
      const future = date.getTime() > today.getTime();
      const count = counts.get(k) ?? 0;
      cells.push({
        key: k,
        day,
        count,
        level: future ? 0 : levelFor(count),
        isToday: k === todayKey,
        future,
      });
    }
    months.push({ key: `${y}-${pad(m + 1)}`, label: `${MONTHS_LONG[m]} ${y}`, leading, cells });
  }

  // ---- Streaks from the recent window (days with activity of ANY kind) -----
  // Deliberately NOT `counts.keys()` (which is DSA-only): this is the same
  // definition `lib/streak.ts` uses for the navbar flame, so the two agree.
  const streakDays = new Set<string>(activityRows.map((r) => keyOf(r.day)));
  const currentStreak = computeStreak(streakDays, today);
  const longestStreak = computeLongestStreak(streakDays);

  return { months, currentStreak, longestStreak, totalSolved, todayKey, joinedKey };
}
