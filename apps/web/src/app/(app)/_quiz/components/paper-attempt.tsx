"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import { useProgress } from "./progress-provider";
import type { AptReviewEntry } from "../data";
import { redirectToLogin } from "@/lib/auth/redirect";
import { refreshStreakBadge } from "@/lib/streak-client";
import { useAttemptDraft } from "@/lib/attempt-draft";
import { apiFetch } from "@/lib/api-fetch";

/**
 * Owns ONE topic paper's attempt. Each QuestionCard reads/writes its slice here
 * instead of holding private state, so the end-of-paper Submit bar can grade the
 * whole paper at once.
 *
 * NOTHING is graded while the paper is open. Picking an option only records the
 * choice locally — answers can be changed freely and no verdict (or colour)
 * appears until Submit. That is what makes it a paper rather than a quiz show:
 * you answer, you hand it in, then you find out.
 *
 * Opening a hint at any point before submitting forfeits that question's mark.
 * (It used to be "before answering", which only meant anything while answers
 * locked on selection; now that they don't, opening a hint always leaves room to
 * change the answer, so it always costs the mark.)
 *
 * Submit is gated on a COMPLETE paper. Handing in a half-finished one scores the
 * blanks as zero, which is almost never what the learner meant — they lost their
 * place, not their nerve. `submit()` refuses below `total`, and the bar offers a
 * jump to the first gap rather than a disabled button with no explanation.
 *
 * Answers survive the tab closing: `useAttemptDraft` mirrors the in-progress
 * state to localStorage and clears it the moment the paper is graded. Hint
 * flags ride along in the same state, so a restored draft keeps the forfeits it
 * had already incurred — reloading is not a way to un-open a hint.
 *
 * A topic that the learner already submitted (per the global progress seed)
 * starts in review mode. After a fresh submit we flip to review mode and push
 * the graded result into the global provider (live nav score + review on revisit).
 */
export type QState = {
  selectedKey: string | null;
  hintUsed: boolean; // opened a hint before submitting → no mark
  hintOpen: boolean; // hint is currently revealed
};

const EMPTY: QState = {
  selectedKey: null,
  hintUsed: false,
  hintOpen: false,
};

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
  toggleHint: (questionId: string) => void;
  submit: () => void;
  retake: () => void;
};

const AttemptContext = createContext<AttemptValue | null>(null);

export function PaperAttemptProvider({
  topicId,
  questionIds,
  children,
}: {
  topicId: string;
  questionIds: string[];
  children: React.ReactNode;
}) {
  const progress = useProgress();
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

  const getState = useCallback(
    (questionId: string) => states[questionId] ?? EMPTY,
    [states]
  );

  // In-progress answers (and hint flags) are mirrored to localStorage while the
  // paper is open, and dropped once it is graded — see `useAttemptDraft`.
  const { clearDraft } = useAttemptDraft<QState>({
    scope: "screening",
    topicId,
    states,
    questionIds,
    onRestore: setStates,
    enabled: !submitted,
  });

  const patch = useCallback((questionId: string, next: Partial<QState>) => {
    setStates((prev) => ({
      ...prev,
      [questionId]: { ...EMPTY, ...prev[questionId], ...next },
    }));
  }, []);

  // Purely local: no request, no verdict. Re-picking simply replaces the choice.
  const select = useCallback(
    (questionId: string, key: string) => {
      if (!progress?.signedIn) { redirectToLogin(); return; }
      if (submitted) return;
      patch(questionId, { selectedKey: key });
    },
    [submitted, patch, progress?.signedIn]
  );

  const toggleHint = useCallback(
    (questionId: string) => {
      if (!progress?.signedIn) { redirectToLogin(); return; }
      const cur = statesRef.current[questionId] ?? EMPTY;
      const opening = !cur.hintOpen;
      // Penalize the first reveal made while the paper is still open — after
      // submitting, hints are just part of the review and cost nothing.
      const hintUsed = cur.hintUsed || (opening && !submitted);
      patch(questionId, { hintOpen: opening, hintUsed });
    },
    [submitted, patch, progress?.signedIn]
  );

  const submit = useCallback(() => {
    if (!progress?.signedIn) { redirectToLogin(); return; }
    if (submitting || submitted) return;
    // The real gate. The button is disabled too, but that is presentation — a
    // keyboard activation or a stale render must not be able to hand in a
    // partial paper, because the blanks would be graded as wrong.
    const answered = questionIds.filter((id) => statesRef.current[id]?.selectedKey).length;
    if (answered < questionIds.length) return;
    setSubmitting(true);
    setError(null);
    const answers = questionIds
      .map((id) => ({ id, st: statesRef.current[id] ?? EMPTY }))
      .filter((x) => x.st.selectedKey !== null)
      .map((x) => ({
        questionId: x.id,
        selectedKey: x.st.selectedKey as string,
        hintUsed: x.st.hintUsed,
      }));
    void (async () => {
      try {
        const res = await apiFetch("/api/screening/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topicId, answers }),
        });
        if (!res.ok) throw new Error("submit failed");
        const data = (await res.json()) as {
          score: number;
          total: number;
          review: Array<
            AptReviewEntry & { questionId: string; selectedKey: string | null }
          >;
        };
        const reviewMap: Record<string, AptReviewEntry> = {};
        for (const r of data.review) {
          if (r.selectedKey === null) continue; // only answered questions get a row
          reviewMap[r.questionId] = {
            selectedKey: r.selectedKey,
            isCorrect: r.isCorrect,
            awarded: r.awarded,
            hintUsed: r.hintUsed,
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
        // Submitting a test can extend the streak (today became active) — refresh
        // the navbar flame in place from the authoritative value, no reload.
        void refreshStreakBadge();
      } catch {
        setError("Couldn't submit the test. Please try again.");
      } finally {
        setSubmitting(false);
      }
    })();
  }, [submitting, submitted, questionIds, topicId, progress, clearDraft]);

  // Start a fresh attempt — clears local answers and re-opens the test. The
  // stored mark stays until the next submit replaces it.
  const retake = useCallback(() => {
    setStates({});
    setSubmitted(false);
    setResult(null);
    setError(null);
    // The cleared paper is the new draft; drop whatever the last attempt left.
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
      toggleHint,
      submit,
      retake,
    }),
    [topicId, questionIds.length, answeredCount, firstUnansweredId, complete, submitted, result, submitting, error, getState, select, toggleHint, submit, retake]
  );

  return <AttemptContext.Provider value={value}>{children}</AttemptContext.Provider>;
}

export function usePaperAttempt() {
  const ctx = useContext(AttemptContext);
  if (!ctx) throw new Error("usePaperAttempt must be used within PaperAttemptProvider");
  return ctx;
}
