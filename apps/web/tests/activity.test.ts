/**
 * The write side of the streak — `recordActivity`.
 *
 * The failure this file exists to prevent: a learner practises, the UI confirms
 * it, and the streak dies overnight because no `ActivityDay` row was ever
 * written. It is invisible when it happens, because the streak walk starts at
 * YESTERDAY when today is absent — so the flame keeps showing the old number and
 * looks perfectly healthy right up until midnight.
 *
 * These tests pin the two things that protect against it: a retake still marks
 * the day, and a failing audit-log insert cannot take the day down with it.
 */
import { describe, expect, test, beforeEach, mock } from "bun:test";
import { istDayKey, istToday, keyOf } from "@/lib/ist";

// `@/lib/activity` reaches `@/lib/db`, which is marked `server-only` — a package
// that only resolves inside the Next build. Stubbing it is inert for every other
// suite. Note we do NOT mock `@/lib/db` itself: `mock.module` is process-global
// under `bun test`, and the session suites mock that same specifier — clobbering
// it there is what broke them. Hence the injected client below instead.
mock.module("server-only", () => ({}));

type DayRow = {
  userId: string;
  day: Date;
  count: number;
  dsaCount: number;
  mcqCount: number;
  courseCount: number;
};

const days = new Map<string, DayRow>();
const submissions: { userId: string; type: string; referenceId: string }[] = [];
/** Flip on to simulate the audit-log insert failing while the DB is otherwise fine. */
let submissionsFail = false;

const rowKey = (userId: string, day: Date) => `${userId}|${keyOf(day)}`;

const applyIncrement = (row: DayRow, data: Record<string, { increment: number }>) => {
  for (const [field, op] of Object.entries(data)) {
    row[field as keyof DayRow] = ((row[field as keyof DayRow] as number) + op.increment) as never;
  }
};

const { recordActivityWith } = await import("@/lib/activity");
type ActivityDb = Parameters<typeof recordActivityWith>[0];

const fakePrisma = {
  submission: {
    createMany: async ({ data }: { data: typeof submissions }) => {
      if (submissionsFail) throw new Error("submissions table unavailable");
      submissions.push(...data);
      return { count: data.length };
    },
  },
  activityDay: {
    updateMany: async ({
      where,
      data,
    }: {
      where: { userId: string; day: Date };
      data: Record<string, { increment: number }>;
    }) => {
      const row = days.get(rowKey(where.userId, where.day));
      if (!row) return { count: 0 };
      applyIncrement(row, data);
      return { count: 1 };
    },
    create: async ({ data }: { data: DayRow }) => {
      days.set(rowKey(data.userId, data.day), { ...data });
      return data;
    },
  },
};

/** Bind the injected fake once, so each test reads like a plain call. */
const recordActivity = (params: Parameters<typeof recordActivityWith>[1]) =>
  recordActivityWith(fakePrisma as unknown as ActivityDb, params);

const TODAY = istToday(new Date());
const today = () => days.get(rowKey("u1", TODAY));

beforeEach(() => {
  days.clear();
  submissions.length = 0;
  submissionsFail = false;
});

describe("new work", () => {
  test("a first solve creates the day and an audit row", async () => {
    await recordActivity({ userId: "u1", kind: "dsa", referenceIds: ["p1"] });

    expect(today()?.count).toBe(1);
    expect(today()?.dsaCount).toBe(1);
    expect(submissions).toHaveLength(1);
  });

  test("several new answers count once each", async () => {
    await recordActivity({ userId: "u1", kind: "mcq", referenceIds: ["q1", "q2", "q3"] });

    expect(today()?.count).toBe(3);
    expect(today()?.mcqCount).toBe(3);
    expect(submissions).toHaveLength(3);
  });

  test("a second batch increments the existing day rather than replacing it", async () => {
    await recordActivity({ userId: "u1", kind: "dsa", referenceIds: ["p1"] });
    await recordActivity({ userId: "u1", kind: "mcq", referenceIds: ["q1"] });

    expect(today()?.count).toBe(2);
    expect(today()?.dsaCount).toBe(1);
    expect(today()?.mcqCount).toBe(1);
  });
});

describe("revision keeps the streak alive", () => {
  test("a retake with nothing new still marks the day active", async () => {
    // The exact case that used to record NOTHING: every question already
    // answered, so `newlyAnsweredIds` is empty.
    await recordActivity({
      userId: "u1",
      kind: "mcq",
      referenceIds: [],
      countRevision: true,
    });

    expect(today()?.count).toBe(1);
  });

  test("a revision writes no audit row — nothing new was submitted", async () => {
    await recordActivity({ userId: "u1", kind: "mcq", referenceIds: [], countRevision: true });
    expect(submissions).toHaveLength(0);
  });

  test("a revision counts once for the session, not once per question", async () => {
    await recordActivity({ userId: "u1", kind: "mcq", referenceIds: [], countRevision: true });
    expect(today()?.count).toBe(1);
    expect(today()?.mcqCount).toBe(1);
  });

  test("without countRevision an empty batch is still a no-op", async () => {
    await recordActivity({ userId: "u1", kind: "mcq", referenceIds: [] });
    expect(today()).toBeUndefined();
    expect(submissions).toHaveLength(0);
  });
});

describe("a failing audit log cannot cost the streak", () => {
  test("the day is still recorded when the Submission insert throws", async () => {
    submissionsFail = true;

    await recordActivity({ userId: "u1", kind: "dsa", referenceIds: ["p1"] });

    // This is the regression guard. With the audit insert running FIRST (as it
    // used to), its failure aborted the whole function and the day was lost —
    // the learner's streak then died overnight with no visible warning.
    expect(today()?.count).toBe(1);
    expect(today()?.dsaCount).toBe(1);
    expect(submissions).toHaveLength(0);
  });

  test("it never throws into the caller's request", async () => {
    submissionsFail = true;
    expect(
      recordActivity({ userId: "u1", kind: "dsa", referenceIds: ["p1"] })
    ).resolves.toBeUndefined();
  });
});

describe("day bucketing", () => {
  test("activity is filed under the IST day of `at`, not the server's date", async () => {
    // 22:00 UTC on 11 Sep is already 03:30 IST on 12 Sep.
    const lateUtc = new Date("2026-09-11T22:00:00Z");
    await recordActivity({ userId: "u1", kind: "dsa", referenceIds: ["p1"], at: lateUtc });

    const filed = [...days.values()][0]!;
    expect(keyOf(filed.day)).toBe("2026-09-12");
  });
});

/**
 * The DSA route's decision about WHETHER to call `recordActivity` at all.
 *
 * `progress/route.ts` needs a live DB, so the rule it applies is restated here
 * against the same helper it uses. The rule exists because `solvedAt` survives
 * un-marking: a problem first solved today keeps a today timestamp even after
 * being un-ticked, so without the guard, re-ticking it counted as a fresh
 * revision and one checkbox flicked on and off ran today's square up per click.
 */
describe("DSA re-solve guard (progress/route.ts rule)", () => {
  const shouldRecord = (status: "SOLVED" | "NOT_STARTED", solvedAt: Date | null, now: Date) => {
    const alreadyBankedToday = !!solvedAt && istDayKey(solvedAt) === istDayKey(now);
    return status === "SOLVED" && !alreadyBankedToday;
  };

  const NOW = new Date("2026-09-12T09:00:00Z");
  const EARLIER_TODAY = new Date("2026-09-12T04:00:00Z");
  const LAST_MONTH = new Date("2026-08-03T09:00:00Z");

  test("a first-ever solve records", () => {
    expect(shouldRecord("SOLVED", null, NOW)).toBe(true);
  });

  test("re-solving something last solved on an earlier day records (revision)", () => {
    expect(shouldRecord("SOLVED", LAST_MONTH, NOW)).toBe(true);
  });

  test("re-ticking something first solved TODAY does not record", () => {
    // The regression this guard fixes — the day is already banked by that solve.
    expect(shouldRecord("SOLVED", EARLIER_TODAY, NOW)).toBe(false);
  });

  test("un-marking never records, whatever the history", () => {
    expect(shouldRecord("NOT_STARTED", null, NOW)).toBe(false);
    expect(shouldRecord("NOT_STARTED", EARLIER_TODAY, NOW)).toBe(false);
    expect(shouldRecord("NOT_STARTED", LAST_MONTH, NOW)).toBe(false);
  });

  test("toggling one problem off and on all day banks the day exactly once", async () => {
    let solvedAt: Date | null = null;
    let calls = 0;

    // on → off → on → off → on
    for (const status of ["SOLVED", "NOT_STARTED", "SOLVED", "NOT_STARTED", "SOLVED"] as const) {
      if (shouldRecord(status, solvedAt, NOW)) {
        calls += 1;
        await recordActivity({ userId: "u1", kind: "dsa", referenceIds: [], countRevision: true });
      }
      solvedAt = solvedAt ?? (status === "SOLVED" ? NOW : null); // stamped once, then preserved
    }

    expect(calls).toBe(1);
    expect(today()?.count).toBe(1);
  });
});
