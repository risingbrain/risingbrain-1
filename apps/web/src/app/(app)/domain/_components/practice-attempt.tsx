"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { useDomainProgress } from "./progress-provider";
import type { DomainReviewEntry } from "../_data";
import { redirectToLogin } from "@/lib/auth/redirect";
import { refreshStreakBadge } from "@/lib/streak-client";
import { useAttemptDraft } from "@/lib/attempt-draft";
import { apiFetch } from "@/lib/api-fetch";

/**
 * Owns ONE topic's practice attempt. Each question card reads/writes its slice
 * here instead of holding private state, so the Submit bar can grade the whole
 * set at once.
 *
 * NOTHING is graded while answering. Picking an option only records the choice
 * locally — the learner can change any answer as many times as they like, and no
 * verdict (and no colour) appears until they press Submit. That is the whole
 * point of a paper: you answer, you hand it in, then you find out.
 *
 * Submit is gated on a COMPLETE set. A half-finished paper handed in scores the
 * blanks as zero, which is almost never what the learner meant — they lost their
 * place, not their nerve. `submit()` refuses below `total`, and the bar offers a
 * jump to the first gap instead of a disabled button with no explanation.
 *
 * Answers survive the tab closing: `useAttemptDraft` mirrors the in-progress
 * state to localStorage and clears it the moment the set is graded.
 *
 * A topic the learner already submitted (per the progress seed) starts in review
 * mode. After a fresh submit we flip to review mode and push the graded result
 * into the global provider (live nav score + review on revisit).
 *
 * The Screening twin is `screening/_components/paper-attempt.tsx`; this one has
 * no hint state, since domain questions carry an explanation instead of a hint.
 */
export type QState = {
  selectedKey: string | null;
};

const EMPTY: QState = { selectedKey: null };

type AttemptValue = {
  topicId: string;
  total: number;
  answeredCount: number;
  /** First question with no answer yet — drives "jump to it". Null when complete. */
  firstUnansweredId: string | null;
  /** Every question answered, so Submit is allowed. */
  complete: boolean;
  submitted: boolean;
  result: { score: number; total: number } | null;
  submitting: boolean;
  error: string | null;
  getState: (questionId: string) => QState;
  select: (questionId: string, key: string) => void;
  submit: () => void;
  retake: () => void;
};

const AttemptContext = createContext<AttemptValue | null>(null);

export function PracticeAttemptProvider({
  topicId,
  questionIds,
  children,
}: {
  topicId: string;
  questionIds: string[];
  children: React.ReactNode;
}) {
  const progress = useDomainProgress();
  const seededScore = progress?.getTopicScore(topicId);

  const [states, setStates] = useState<Record<string, QState>>({});
  // Submitted if it was already graded (seed) or graded this session.
  const [submitted, setSubmitted] = useState<boolean>(Boolean(seededScore));
  const [result, setResult] = useState<{ score: number; total: number } | null>(
    seededScore ?? null
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep a ref of states so `submit` reads the latest without being a dependency.
  const statesRef = useRef(states);
  statesRef.current = states;

  const getState = useCallback((questionId: string) => states[questionId] ?? EMPTY, [states]);

  // In-progress answers are mirrored to localStorage while the set is open, and
  // dropped once it is graded — see `useAttemptDraft`.
  const { clearDraft } = useAttemptDraft<QState>({
    scope: "domain",
    topicId,
    states,
    questionIds,
    onRestore: setStates,
    enabled: !submitted,
  });

  const patch = useCallback((questionId: string, next: Partial<QState>) => {
    setStates((prev) => ({ ...prev, [questionId]: { ...EMPTY, ...prev[questionId], ...next } }));
  }, []);

  // Purely local: no request, no verdict. Re-picking simply replaces the choice.
  const select = useCallback(
    (questionId: string, key: string) => {
      if (!progress?.signedIn) {
        redirectToLogin();
        return;
      }
      if (submitted) return;
      patch(questionId, { selectedKey: key });
    },
    [submitted, patch, progress?.signedIn]
  );

  const submit = useCallback(() => {
    if (!progress?.signedIn) {
      redirectToLogin();
      return;
    }
    if (submitting || submitted) return;
    // The real gate. The button is disabled too, but that is presentation — a
    // keyboard activation or a stale render must not be able to hand in a
    // partial set, because the blanks would be graded as wrong.
    const answered = questionIds.filter((id) => statesRef.current[id]?.selectedKey).length;
    if (answered < questionIds.length) return;
    setSubmitting(true);
    setError(null);
    const answers = questionIds
      .map((id) => ({ id, st: statesRef.current[id] ?? EMPTY }))
      .filter((x) => x.st.selectedKey !== null)
      .map((x) => ({ questionId: x.id, selectedKey: x.st.selectedKey as string }));
    void (async () => {
      try {
        const res = await apiFetch("/api/domain/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topicId, answers }),
        });
        if (!res.ok) throw new Error("submit failed");
        const data = (await res.json()) as {
          score: number;
          total: number;
          review: Array<DomainReviewEntry & { questionId: string; selectedKey: string | null }>;
        };
        const reviewMap: Record<string, DomainReviewEntry> = {};
        for (const r of data.review) {
          if (r.selectedKey === null) continue; // only answered questions get a row
          reviewMap[r.questionId] = {
            selectedKey: r.selectedKey,
            isCorrect: r.isCorrect,
            answerKey: r.answerKey,
            explanation: r.explanation ?? null,
          };
        }
        progress?.applySubmission(
          topicId,
          { score: data.score, total: data.total },
          reviewMap,
          questionIds
        );
        setResult({ score: data.score, total: data.total });
        setSubmitted(true);
        // Graded now, so the draft can only contradict the stored result.
        clearDraft();
        // Submitting can extend the streak (today became active) — refresh the
        // navbar flame in place from the authoritative value, no reload.
        void refreshStreakBadge();
      } catch {
        setError("Couldn't submit your answers. Please try again.");
      } finally {
        setSubmitting(false);
      }
    })();
  }, [submitting, submitted, questionIds, topicId, progress, clearDraft]);

  // Start a fresh attempt — clears local answers and re-opens the set. The
  // stored mark stays until the next submit replaces it.
  const retake = useCallback(() => {
    setStates({});
    setSubmitted(false);
    setResult(null);
    setError(null);
    // The cleared set is the new draft; drop whatever the last attempt left.
    clearDraft();
  }, [clearDraft]);

  const answeredCount = useMemo(
    () => questionIds.reduce((n, id) => n + (states[id]?.selectedKey ? 1 : 0), 0),
    [questionIds, states]
  );
  const firstUnansweredId = useMemo(
    () => questionIds.find((id) => !states[id]?.selectedKey) ?? null,
    [questionIds, states]
  );
  const complete = questionIds.length > 0 && answeredCount === questionIds.length;

  const value = useMemo<AttemptValue>(
    () => ({
      topicId,
      total: questionIds.length,
      answeredCount,
      firstUnansweredId,
      complete,
      submitted,
      result,
      submitting,
      error,
      getState,
      select,
      submit,
      retake,
    }),
    [
      topicId,
      questionIds.length,
      answeredCount,
      firstUnansweredId,
      complete,
      submitted,
      result,
      submitting,
      error,
      getState,
      select,
      submit,
      retake,
    ]
  );

  return <AttemptContext.Provider value={value}>{children}</AttemptContext.Provider>;
}

export function usePracticeAttempt() {
  const ctx = useContext(AttemptContext);
  if (!ctx) throw new Error("usePracticeAttempt must be used within PracticeAttemptProvider");
  return ctx;
}
