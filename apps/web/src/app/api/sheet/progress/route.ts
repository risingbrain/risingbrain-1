import { NextResponse } from "next/server";
import { prisma, ProblemStatus } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { recordActivity } from "@/lib/activity";
import { istDayKey } from "@/lib/ist";
import { checkWriteLimit, isConflict, isUnknownReference } from "../_guards";

const VALID = new Set<string>(Object.values(ProblemStatus));

/**
 * POST /api/sheet/progress  { problemId, status }
 *
 * Toggles a problem's solve status for the current user. `solvedAt` records the
 * FIRST solve and is then preserved — including through un-marking — so history
 * never moves to "today". The activity log below depends on that.
 */
export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limited = await checkWriteLimit(req, user.id);
  if (limited) return limited;

  let body: { problemId?: unknown; status?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const problemId = typeof body.problemId === "string" ? body.problemId : "";
  const status = typeof body.status === "string" ? body.status : "";

  if (!problemId || !VALID.has(status)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const typedStatus = status as ProblemStatus;
  // First-ever solve? Used to log heatmap/streak activity exactly once per
  // problem (toggling SOLVED off/on must not double-count).
  let firstSolve = false;
  // Did THIS problem already bank today? `solvedAt` survives un-marking, so a
  // problem first solved today keeps a today timestamp even after it is
  // un-ticked. Without this, ticking it again would count as a fresh revision
  // and a learner flicking one checkbox on and off would inflate today's heatmap
  // square by one per click.
  let alreadyBankedToday = false;

  try {
    // `solvedAt` records the *first* time the problem was solved. Preserve any
    // existing timestamp so toggling SOLVED off/on (or revisiting) never
    // rewrites history — which would otherwise move the solve to "today" in the
    // streak/heatmap. Only stamp a fresh time on the first solve.
    const existing = await prisma.userProblemProgress.findUnique({
      where: { userId_problemId: { userId: user.id, problemId } },
      select: { solvedAt: true },
    });
    firstSolve = !existing?.solvedAt && typedStatus === ProblemStatus.SOLVED;
    alreadyBankedToday =
      !!existing?.solvedAt && istDayKey(existing.solvedAt) === istDayKey(new Date());
    const solvedAt =
      existing?.solvedAt ?? (typedStatus === ProblemStatus.SOLVED ? new Date() : null);

    try {
      await prisma.userProblemProgress.upsert({
        where: { userId_problemId: { userId: user.id, problemId } },
        create: { userId: user.id, problemId, status: typedStatus, solvedAt },
        update: { status: typedStatus, solvedAt },
      });
    } catch (e) {
      // Concurrent first-insert lost the race — the row exists now, so update it.
      if (!isConflict(e)) throw e;
      await prisma.userProblemProgress.update({
        where: { userId_problemId: { userId: user.id, problemId } },
        data: { status: typedStatus, solvedAt },
      });
    }
  } catch (e) {
    // Unknown problemId → FK violation. Treat as a bad request, not a 500.
    if (isUnknownReference(e)) {
      return NextResponse.json({ error: "Unknown problem" }, { status: 400 });
    }
    console.error("sheet/progress upsert failed", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }

  // Log the solve to the heatmap/streak. Best-effort in the sense that
  // recordActivity swallows its own failures — but it IS awaited, so it sits on
  // the response path rather than being fire-and-forget.
  //
  // A FIRST solve counts as new work (one audit row, one heatmap contribution).
  // Re-solving a problem last solved on an EARLIER day counts as revision: no
  // audit row and no new contribution, but the day is marked active so revising
  // keeps the streak alive. Re-ticking one first solved TODAY adds nothing — the
  // day is already banked by that solve, and counting it again would let a
  // checkbox toggled repeatedly run today's square up on its own. Un-solving is
  // not activity, so only SOLVED reaches this at all.
  if (typedStatus === ProblemStatus.SOLVED && !alreadyBankedToday) {
    await recordActivity({
      userId: user.id,
      kind: "dsa",
      referenceIds: firstSolve ? [problemId] : [],
      countRevision: true,
    });
  }

  return NextResponse.json({ ok: true, status: typedStatus });
}
