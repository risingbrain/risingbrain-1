import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";
import { checkWriteLimit } from "@/lib/auth/rate-limit";
import { recordActivity } from "@/lib/activity";

/**
 * POST /api/domain/submit
 *
 * Grades and stores a whole Domain topic's practice set. The client sends every
 * answered question with its chosen key; the server is authoritative — it
 * recomputes correctness and persists:
 *
 *  - one `UserDomainQuizProgress` row per answered question. Re-attempts UPSERT
 *    each answered row and mark any previously-answered-but-now-skipped rows
 *    `isActive: false` (non-destructive — rows are never deleted),
 *  - a single `UserDomainTopicScore` (the stored "mark", upserted/replaced).
 *
 * It returns the review payload (answer keys, explanations, per-question outcomes)
 * so the panel can flip into review mode — for the ANSWERED questions only. A key
 * the learner did not play for is a key they have not earned the right to see.
 *
 * Scoring is simply "correct answers": unlike Screening there are no hints to
 * forfeit a mark, because the source material explains each answer instead of
 * nudging toward it (see DomainQuestion in schema.prisma).
 */
type IncomingAnswer = { questionId: string; selectedKey: string };

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
    const { questionId, selectedKey } = (a ?? {}) as Partial<IncomingAnswer>;
    if (typeof questionId === "string" && typeof selectedKey === "string" && selectedKey) {
      incoming.set(questionId, { questionId, selectedKey });
    }
  }

  // Load the topic's questions (server-side keys). This also scopes grading to
  // questions that actually belong to the topic.
  const questions = await prisma.domainQuestion.findMany({
    where: { topicId },
    orderBy: { order: "asc" },
    select: { id: true, answerKey: true, explanation: true },
  });
  if (questions.length === 0) {
    return NextResponse.json({ error: "Topic not found." }, { status: 404 });
  }

  // Graded over every question in the topic, because the SCORE is out of the
  // whole set — a skipped question is a question worth zero, not one that isn't
  // on the paper. What goes back over the wire is narrowed below.
  const graded = questions.map((q) => {
    const selectedKey = incoming.get(q.id)?.selectedKey ?? null;
    return {
      questionId: q.id,
      answerKey: q.answerKey,
      explanation: q.explanation ?? undefined,
      selectedKey,
      isCorrect: selectedKey !== null && selectedKey === q.answerKey,
    };
  });

  // A key is only ever disclosed for a question this learner actually answered.
  // Returning the full set leaked the entire topic's answer key to anyone who
  // POSTed `{ topicId, answers: [] }` — and, less obviously, let someone answer
  // one question of twenty and read the other nineteen keys out of DevTools. The
  // client already discards the unanswered entries (practice-attempt.tsx), so
  // this changes nothing it can see.
  const review = graded.filter((r) => r.selectedKey !== null);

  // Nothing answered (or nothing that belongs to this topic). The submit button is
  // disabled at zero, so this is never a real attempt — and recording it would
  // overwrite a learner's stored mark with 0/total.
  if (review.length === 0) {
    return NextResponse.json(
      { error: "Answer at least one question before submitting." },
      { status: 400 }
    );
  }

  const total = questions.length;
  const score = graded.reduce((s, r) => s + (r.isCorrect ? 1 : 0), 0);

  // Rows only for answered questions (skips don't pollute the heatmap/streak).
  const answeredRows = review.map((r) => ({
    userId: user.id,
    questionId: r.questionId,
    selectedKey: r.selectedKey as string,
    isCorrect: r.isCorrect,
  }));

  const topicQuestionIds = questions.map((q) => q.id);
  const answeredIds = answeredRows.map((r) => r.questionId);
  const answeredSet = new Set(answeredIds);
  const skippedIds = topicQuestionIds.filter((id) => !answeredSet.has(id));

  // Which answers are brand-new (never recorded before)? Only these count as
  // fresh activity for the heatmap — re-answering an existing question doesn't.
  const priorRows = await prisma.userDomainQuizProgress.findMany({
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
      prisma.userDomainQuizProgress.upsert({
        where: { userId_questionId: { userId: user.id, questionId: row.questionId } },
        create: { ...row, isActive: true },
        update: { selectedKey: row.selectedKey, isCorrect: row.isCorrect, isActive: true },
      })
    ),
    ...(skippedIds.length
      ? [
          prisma.userDomainQuizProgress.updateMany({
            where: { userId: user.id, questionId: { in: skippedIds }, isActive: true },
            data: { isActive: false },
          }),
        ]
      : []),
    prisma.userDomainTopicScore.upsert({
      where: { userId_topicId: { userId: user.id, topicId } },
      create: { userId: user.id, topicId, score, total },
      update: { score, total, submittedAt: new Date() },
    }),
  ]);

  // Log fresh answers to the heatmap/streak. Best-effort in the sense that
  // recordActivity swallows its own failures — but it IS awaited, so it sits on
  // the response path rather than being fire-and-forget. A domain question is an
  // MCQ like a screening one, so it lands in the same `mcqCount` column rather
  // than inventing a fourth activity kind.
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
