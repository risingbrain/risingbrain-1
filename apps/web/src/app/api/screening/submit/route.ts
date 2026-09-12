import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { checkWriteLimit } from "@/lib/auth/rate-limit";
import { recordActivity } from "@/lib/activity";

/**
 * POST /api/screening/submit
 *
 * Grades and stores a whole topic's test. The client sends every answered
 * question with its chosen key and whether a hint was opened BEFORE answering.
 * The server is authoritative: it recomputes correctness, applies the scoring
 * rule (a mark is earned only when correct AND no hint was used), and persists:
 *
 *  - one `UserQuizProgress` row per answered question. Re-attempts UPSERT each
 *    answered row and mark any previously-answered-but-now-skipped rows
 *    `isActive: false` (non-destructive — rows are never deleted),
 *  - a single `UserQuizTopicScore` (the stored "mark", upserted/replaced).
 *
 * It returns the full review payload (answer keys, explanations, hints, per-
 * question outcomes) so the paper can flip into review mode.
 */
type IncomingAnswer = { questionId: string; selectedKey: string; hintUsed: boolean };

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to submit." }, { status: 401 });
  }

  const limited = await checkWriteLimit(request, user.id);
  if (limited) return limited;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { topicId, answers } = (body ?? {}) as { topicId?: unknown; answers?: unknown };
  if (typeof topicId !== "string" || !topicId.trim()) {
    return NextResponse.json({ error: "topicId is required." }, { status: 400 });
  }
  if (!Array.isArray(answers)) {
    return NextResponse.json({ error: "answers must be an array." }, { status: 400 });
  }

  // Normalize + validate incoming answers.
  const incoming = new Map<string, IncomingAnswer>();
  for (const a of answers) {
    const { questionId, selectedKey, hintUsed } = (a ?? {}) as Partial<IncomingAnswer>;
    if (typeof questionId === "string" && typeof selectedKey === "string" && selectedKey) {
      incoming.set(questionId, { questionId, selectedKey, hintUsed: Boolean(hintUsed) });
    }
  }

  // Load the topic's questions (server-side keys). This also scopes grading to
  // questions that actually belong to the topic.
  const questions = await prisma.quizQuestion.findMany({
    where: { topicId },
    orderBy: { order: "asc" },
    select: { id: true, answerKey: true, explanation: true, hint: true },
  });
  if (questions.length === 0) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  // Graded over every question in the paper, because the SCORE is out of the
  // whole set — a skipped question is a question worth zero, not one that isn't
  // on the paper. What goes back over the wire is narrowed below.
  const graded = questions.map((q) => {
    const ans = incoming.get(q.id);
    const selectedKey = ans?.selectedKey ?? null;
    const hintUsed = ans?.hintUsed ?? false;
    const isCorrect = selectedKey !== null && selectedKey === q.answerKey;
    const awarded = isCorrect && !hintUsed;
    return {
      questionId: q.id,
      answerKey: q.answerKey,
      explanation: q.explanation ?? undefined,
      hint: q.hint ?? undefined,
      selectedKey,
      isCorrect,
      awarded,
      hintUsed,
    };
  });

  // A key (and its hint) is only ever disclosed for a question this learner
  // actually answered. Returning the full set leaked the entire paper's answer key
  // to anyone who POSTed `{ topicId, answers: [] }`, and let someone answer one
  // question and read the rest of the keys out of DevTools. The client already
  // discards the unanswered entries (paper-attempt.tsx), so nothing visible changes.
  const review = graded.filter((r) => r.selectedKey !== null);

  // Nothing answered (or nothing that belongs to this paper). The submit button is
  // disabled at zero, so this is never a real attempt — and recording it would
  // overwrite a learner's stored mark with 0/total.
  if (review.length === 0) {
    return NextResponse.json(
      { error: "Answer at least one question before submitting." },
      { status: 400 }
    );
  }

  const total = questions.length;
  const score = graded.reduce((s, r) => s + (r.awarded ? 1 : 0), 0);

  // Rows only for answered questions (skips don't pollute the heatmap/streak).
  const answeredRows = review.map((r) => ({
    userId: user.id,
    questionId: r.questionId,
    selectedKey: r.selectedKey as string,
    isCorrect: r.isCorrect,
    hintUsed: r.hintUsed,
    awarded: r.awarded,
  }));

  const topicQuestionIds = questions.map((q) => q.id);
  const answeredIds = answeredRows.map((r) => r.questionId);
  const answeredSet = new Set(answeredIds);
  const skippedIds = topicQuestionIds.filter((id) => !answeredSet.has(id));

  // Which answers are brand-new (never recorded before)? Only these count as
  // fresh activity for the heatmap — re-answering an existing question doesn't.
  const priorRows = await prisma.userQuizProgress.findMany({
    where: { userId: user.id, questionId: { in: topicQuestionIds } },
    select: { questionId: true },
  });
  const priorIds = new Set(priorRows.map((r) => r.questionId));
  const newlyAnsweredIds = answeredIds.filter((id) => !priorIds.has(id));

  // Replace this topic's prior attempt atomically — non-destructively. Answered
  // questions are upserted (isActive: true); previously-answered questions the
  // learner skipped this time are flipped inactive rather than deleted, so
  // "only the current attempt counts" holds without ever removing a row.
  // `answeredAt` is intentionally left untouched on update so a question's first
  // solve date (which the heatmap keys on) is preserved across re-attempts.
  await prisma.$transaction([
    ...answeredRows.map((row) =>
      prisma.userQuizProgress.upsert({
        where: { userId_questionId: { userId: user.id, questionId: row.questionId } },
        create: { ...row, isActive: true },
        update: {
          selectedKey: row.selectedKey,
          isCorrect: row.isCorrect,
          hintUsed: row.hintUsed,
          awarded: row.awarded,
          isActive: true,
        },
      })
    ),
    ...(skippedIds.length
      ? [
          prisma.userQuizProgress.updateMany({
            where: { userId: user.id, questionId: { in: skippedIds }, isActive: true },
            data: { isActive: false },
          }),
        ]
      : []),
    prisma.userQuizTopicScore.upsert({
      where: { userId_topicId: { userId: user.id, topicId } },
      create: { userId: user.id, topicId, score, total },
      update: { score, total, submittedAt: new Date() },
    }),
  ]);

  // Log fresh answers to the heatmap/streak. Best-effort in the sense that
  // recordActivity swallows its own failures — but it IS awaited, so it sits on
  // the response path rather than being fire-and-forget.
  await recordActivity({
    userId: user.id,
    kind: "mcq",
    referenceIds: newlyAnsweredIds,
    // Reaching here means a test was submitted. A retake breaks no new ground
    // (newlyAnsweredIds is empty) but is still a day's practice, so it keeps the
    // streak alive rather than recording nothing at all.
    countRevision: true,
  });

  return NextResponse.json({ score, total, review });
}
