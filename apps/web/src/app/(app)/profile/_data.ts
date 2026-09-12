import { prisma, ProblemStatus } from "@/lib/db";
import { addDays, istToday, keyOf } from "@/lib/ist";
import { computeLongestStreak, computeStreak } from "@/lib/streak-days";

/**
 * Server-side data for the profile dashboard:
 *  - a month-divided activity heatmap for a SELECTED calendar year (Jan–Dec),
 *    read from the pre-aggregated `ActivityDay` table (DSA + aptitude counts)
 *    bucketed by IST calendar day. A year switcher lets the user view past years.
 *  - per-section solved/total counts (DSA, Screening, Domain) split by difficulty
 *    where the section has one. Domain used to be absent because its topics were
 *    read-only notes; it now carries graded practice sets (`UserDomainQuizProgress`)
 *    that feed the same heatmap, so leaving it out meant a learner could answer
 *    domain questions all week and see no domain progress anywhere.
 *  - current/longest streaks derived from recent activity (the denormalised User
 *    columns are not maintained yet).
 */

// The year the platform went live. The year switcher always offers every year
// from here up to the current year (it auto-extends as the app keeps running).
const APP_LAUNCH_YEAR = 2025;
const pad = (n: number) => String(n).padStart(2, "0");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export type HeatCell = {
  key: string;
  count: number;
  dsa: number;
  apt: number;
  level: 0 | 1 | 2 | 3 | 4;
};

// One month's days laid out as week columns (rows = Sun..Sat), padded to 6
// columns so every month block is the same width; null = padding/blank day.
export type MonthBlock = {
  key: string;
  label: string;
  weeks: (HeatCell | null)[][];
};

export type SectionStat = {
  key: "dsa" | "aptitude" | "domain";
  label: string;
  solved: number;
  total: number;
  byDifficulty:
    | { label: "Easy" | "Medium" | "Hard"; solved: number; total: number }[]
    | null;
};

function level(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count <= 2) return 1;
  if (count <= 5) return 2;
  if (count <= 9) return 3;
  return 4;
}

export async function getProfileData(userId: string, year?: number) {
  const now = new Date();
  const today = istToday(now);
  const currentYear = today.getUTCFullYear();
  const currentMonth = today.getUTCMonth();
  const explicitYear = !!(year && year >= 2000 && year <= currentYear);
  const selectedYear = explicitYear ? year! : currentYear;

  // Default view: a trailing 12-month window ending with the current month, so
  // today sits at the end and no future days show. Selecting a year switches to
  // that full calendar year (Jan–Dec).
  // ActivityDay.day is stored at UTC-midnight of the IST calendar date, so the
  // window bounds are plain UTC-midnight dates (no IST offset applied here).
  const monthList: { y: number; m: number }[] = [];
  let windowStart: Date;
  let windowEnd: Date;
  if (explicitYear) {
    for (let m = 0; m < 12; m++) monthList.push({ y: selectedYear, m });
    windowStart = new Date(Date.UTC(selectedYear, 0, 1));
    windowEnd = new Date(Date.UTC(selectedYear + 1, 0, 1));
  } else {
    for (let i = 11; i >= 0; i--) {
      const d = new Date(Date.UTC(currentYear, currentMonth - i, 1));
      monthList.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
    }
    const first = monthList[0]!;
    windowStart = new Date(Date.UTC(first.y, first.m, 1));
    windowEnd = new Date(Date.UTC(currentYear, currentMonth + 1, 1));
  }
  const streakSince = addDays(today, -400);

  const [
    windowRows,
    streakRows,
    dsaTotalsRows,
    dsaSolvedRows,
    quizTotal,
    quizSolved,
    domainTotal,
    domainSolved,
    firstActivity,
  ] = await Promise.all([
    // Heatmap cells for the selected window (DSA + aptitude, pre-aggregated).
    prisma.activityDay.findMany({
      where: { userId, day: { gte: windowStart, lt: windowEnd } },
      select: { day: true, count: true, dsaCount: true, mcqCount: true },
    }),
    // A longer look-back for the streak (independent of the selected year).
    prisma.activityDay.findMany({
      where: { userId, day: { gte: streakSince }, count: { gt: 0 } },
      select: { day: true },
    }),
    prisma.dsaProblem.groupBy({ by: ["difficulty"], _count: { _all: true } }),
    prisma.userProblemProgress.findMany({
      where: { userId, status: ProblemStatus.SOLVED },
      select: { problem: { select: { difficulty: true } } },
    }),
    prisma.quizQuestion.count(),
    // Aptitude "solved" = marks earned (correct without a hint), counted only for
    // submitted tests. Mirrors the per-question `awarded` flag. Excludes rows
    // deactivated by a later re-attempt.
    prisma.userQuizProgress.count({ where: { userId, awarded: true, isActive: true } }),
    // Domain practice. Counted against the CURRENT attempt only (`isActive`),
    // matching how Screening and the domain submit route treat re-attempts.
    prisma.domainQuestion.count(),
    prisma.userDomainQuizProgress.count({ where: { userId, isCorrect: true, isActive: true } }),
    // Earliest recorded activity day — drives the year switcher's lower bound.
    prisma.activityDay.findFirst({
      where: { userId, count: { gt: 0 } },
      orderBy: { day: "asc" },
      select: { day: true },
    }),
  ]);

  // ---- Heatmap counts for the selected year, keyed by IST day --------------
  const counts = new Map<string, { count: number; dsa: number; apt: number }>();
  for (const r of windowRows) {
    counts.set(keyOf(r.day), { count: r.count, dsa: r.dsaCount, apt: r.mcqCount });
  }

  // ---- Month blocks for the window, each padded to 6 columns ---------------
  const months: MonthBlock[] = [];
  for (const { y, m } of monthList) {
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const monthWeeks: (HeatCell | null)[][] = [];
    let col: (HeatCell | null)[] = new Array(7).fill(null);
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(Date.UTC(y, m, day));
      const wd = date.getUTCDay();
      if (wd === 0 && day !== 1) {
        monthWeeks.push(col);
        col = new Array(7).fill(null);
      }
      if (date.getTime() > today.getTime()) {
        col[wd] = null; // future day — blank
      } else {
        const k = keyOf(date);
        const c = counts.get(k);
        col[wd] = {
          key: k,
          count: c?.count ?? 0,
          dsa: c?.dsa ?? 0,
          apt: c?.apt ?? 0,
          level: level(c?.count ?? 0),
        };
      }
    }
    monthWeeks.push(col);
    while (monthWeeks.length < 6) monthWeeks.push(new Array(7).fill(null));
    months.push({ key: `${y}-${pad(m + 1)}`, label: MONTHS[m]!, weeks: monthWeeks });
  }

  const totalContributions = [...counts.values()].reduce((s, v) => s + v.count, 0);
  const activeDays = counts.size;

  // ---- Streaks from the recent window --------------------------------------
  const streakDays = new Set<string>(streakRows.map((r) => keyOf(r.day)));
  const currentStreak = computeStreak(streakDays, today);
  const longestStreak = computeLongestStreak(streakDays);

  // ---- Available years for the switcher ------------------------------------
  // From the app launch year (or the user's even-earlier first activity, just in
  // case) up to the current year, newest first. Auto-grows each calendar year.
  let earliest = Math.min(APP_LAUNCH_YEAR, currentYear);
  if (firstActivity) {
    // ActivityDay.day is UTC-midnight of the IST calendar date, so its UTC year
    // is already the IST year.
    const yy = firstActivity.day.getUTCFullYear();
    if (yy < earliest) earliest = yy;
  }
  const availableYears: number[] = [];
  for (let y = currentYear; y >= earliest; y--) availableYears.push(y);

  // ---- Section dashboard ----------------------------------------------------
  const dsaTotal = { EASY: 0, MEDIUM: 0, HARD: 0 } as Record<string, number>;
  for (const r of dsaTotalsRows) dsaTotal[r.difficulty] = r._count._all;
  const dsaSolved = { EASY: 0, MEDIUM: 0, HARD: 0 } as Record<string, number>;
  for (const r of dsaSolvedRows) {
    dsaSolved[r.problem.difficulty] = (dsaSolved[r.problem.difficulty] ?? 0) + 1;
  }
  const sections: SectionStat[] = [
    {
      key: "dsa",
      label: "DSA Sheets",
      solved: dsaSolved.EASY! + dsaSolved.MEDIUM! + dsaSolved.HARD!,
      total: dsaTotal.EASY! + dsaTotal.MEDIUM! + dsaTotal.HARD!,
      byDifficulty: [
        { label: "Easy", solved: dsaSolved.EASY!, total: dsaTotal.EASY! },
        { label: "Medium", solved: dsaSolved.MEDIUM!, total: dsaTotal.MEDIUM! },
        { label: "Hard", solved: dsaSolved.HARD!, total: dsaTotal.HARD! },
      ],
    },
    {
      key: "aptitude",
      label: "Screening",
      solved: quizSolved,
      total: quizTotal,
      byDifficulty: null,
    },
    {
      key: "domain",
      label: "Domain",
      solved: domainSolved,
      total: domainTotal,
      byDifficulty: null,
    },
  ];

  const totalSolved = sections.reduce((s, x) => s + x.solved, 0);
  const totalProblems = sections.reduce((s, x) => s + x.total, 0);

  return {
    heatmap: {
      months,
      year: selectedYear,
      rolling: !explicitYear,
      availableYears,
      totalContributions,
      activeDays,
      currentStreak,
      longestStreak,
    },
    sections,
    totalSolved,
    totalProblems,
  };
}
