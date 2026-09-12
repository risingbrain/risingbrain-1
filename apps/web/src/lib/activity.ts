/**
 * Activity logging — the write side of the streak/heatmap system.
 *
 * Every meaningful "task done" (a first DSA solve, a newly-answered aptitude
 * question, later course completions) is recorded here so the heatmap and
 * streak can be read from the pre-aggregated `ActivityDay` table (one row per
 * user per IST day) instead of re-scanning the raw progress tables on every
 * navbar render. It appends an audit `Submission` per event and bumps the day's
 * counters atomically.
 *
 * Best-effort by design: a logging failure must NEVER fail the user's actual
 * write (solving a problem must succeed even if the heatmap bump hiccups), so
 * everything here is wrapped in a swallow-and-log guard.
 */
import { prisma } from "@/lib/db";
// Straight from the generated enums, NOT re-exported through `@/lib/db`: that
// module is `server-only`, and the session test suites replace it wholesale with
// a `{ prisma }` stub — pulling the enum through it made this module unloadable
// under `bun test`. The enum entry point has no server dependency.
import { SubmissionType } from "@risingbrain/database/enums";
import { istToday } from "@/lib/ist";

export type ActivityKind = "dsa" | "mcq" | "course";

const SUBMISSION_TYPE: Record<ActivityKind, SubmissionType> = {
  dsa: SubmissionType.DSA_PROBLEM,
  mcq: SubmissionType.MCQ,
  course: SubmissionType.COURSE_LESSON,
};

const COUNT_COLUMN: Record<ActivityKind, "dsaCount" | "mcqCount" | "courseCount"> = {
  dsa: "dsaCount",
  mcq: "mcqCount",
  course: "courseCount",
};

function isConflict(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    "code" in e &&
    (e as { code?: unknown }).code === "P2002"
  );
}

export type RecordActivityParams = {
  userId: string;
  kind: ActivityKind;
  referenceIds: string[];
  /** When the activity happened (defaults to now). Used to pick the IST day. */
  at?: Date;
  /**
   * Mark the day active even when `referenceIds` is empty — i.e. this was a
   * retake or a re-solve. Pass it from any endpoint where reaching the call at
   * all means the learner did something.
   */
  countRevision?: boolean;
};

/** The slice of the client this needs — the seam `tests/activity.test.ts` fills. */
export type ActivityDb = {
  submission: { createMany: (args: { data: unknown[] }) => Promise<unknown> };
  activityDay: {
    updateMany: (args: { where: unknown; data: unknown }) => Promise<{ count: number }>;
    create: (args: { data: unknown }) => Promise<unknown>;
  };
};

/**
 * Record one or more same-kind events for a user on a given IST day.
 * `referenceIds` are the ids of the things acted on (problem/question/lesson);
 * one `Submission` row is written per id and the day's counters go up by the
 * number of ids.
 *
 * REVISION. `countRevision` covers the case where the learner did real work but
 * broke no new ground — retaking a test they have already answered, re-solving a
 * problem to revise. Those carry no new reference ids, so without it the day
 * records NOTHING and a user who practised all day still loses their streak. In
 * that case the day is bumped by exactly one (the session, not the twenty
 * questions in it) and no `Submission` audit rows are written, since nothing new
 * was submitted. The per-kind column moves with `count`, keeping the
 * `count = dsa + mcq + course` invariant the schema documents.
 */
export function recordActivity(params: RecordActivityParams): Promise<void> {
  return recordActivityWith(prisma as unknown as ActivityDb, params);
}

/**
 * The implementation, with the client injected.
 *
 * Exported ONLY so the streak's write path can be tested without a database.
 * Mocking the `@/lib/db` module instead would be process-global under `bun test`
 * and would clobber the session tests, which mock the same specifier.
 */
export async function recordActivityWith(
  prisma: ActivityDb,
  params: RecordActivityParams
): Promise<void> {
  const { userId, kind, referenceIds, countRevision = false } = params;
  const isNew = referenceIds.length > 0;
  if (!isNew && !countRevision) return;
  // New work counts per item; a revision counts once for the whole submission.
  const n = isNew ? referenceIds.length : 1;

  const day = istToday(params.at ?? new Date());

  // ORDER MATTERS. The day counters go first and the audit log second, in their
  // own guards, because only the FIRST one carries the streak. They are not in a
  // transaction (the counter path below has its own concurrency handling that
  // doesn't compose inside one), so either can fail alone — and when the audit
  // insert was in front, a failure there meant the day never got recorded at
  // all. The user saw their solve succeed, the flame kept yesterday's number
  // because the walk starts at yesterday, and the streak silently died overnight
  // with no way to tell it had. A missing audit row costs nothing the learner
  // can see; a missing ActivityDay row costs them their streak.
  try {
    const column = COUNT_COLUMN[kind];

    // Atomically bump the day's counters. Update-first avoids a create race; if
    // the row doesn't exist yet we create it, and a lost create race (P2002)
    // falls back to the same atomic increment.
    const increment = { count: { increment: n }, [column]: { increment: n } };
    const updated = await prisma.activityDay.updateMany({ where: { userId, day }, data: increment });
    if (updated.count === 0) {
      try {
        await prisma.activityDay.create({
          data: {
            userId,
            day,
            count: n,
            dsaCount: kind === "dsa" ? n : 0,
            mcqCount: kind === "mcq" ? n : 0,
            courseCount: kind === "course" ? n : 0,
          },
        });
      } catch (e) {
        if (!isConflict(e)) throw e;
        await prisma.activityDay.updateMany({ where: { userId, day }, data: increment });
      }
    }
  } catch (err) {
    // Never let a logging failure break the user's real write — but this one IS
    // the streak, so it is logged loudly enough to alert on. If this fires, that
    // user's day is gone and they will lose their streak tomorrow.
    console.error("[activity] STREAK AT RISK — day not recorded", { userId, kind, n, day }, err);
  }

  // Audit log, best-effort and deliberately after the counters. Only for
  // genuinely new work: a revision has no new reference to log, and inventing
  // one would corrupt the trail.
  if (!isNew) return;
  try {
    await prisma.submission.createMany({
      data: referenceIds.map((referenceId) => ({
        userId,
        type: SUBMISSION_TYPE[kind],
        referenceId,
      })),
    });
  } catch (err) {
    console.error("[activity] audit log failed (streak unaffected)", { userId, kind, n }, err);
  }
}
