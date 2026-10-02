"use client";

import type { ReactNode } from "react";
import { CheckCircle2, Sparkles, XCircle, type LucideIcon } from "lucide-react";
import { useDomainProgress } from "./progress-provider";
import { usePracticeAttempt } from "./practice-attempt";
import type { DomainPracticeQuestion } from "../_data";

const DIFFICULTY_STYLE: Record<string, string> = {
  EASY: "text-rb-green-500 bg-rb-green-500/10 ring-rb-green-500/20",
  MEDIUM: "text-amber-500 bg-amber-500/10 ring-amber-500/20",
  HARD: "text-rose-500 bg-rose-500/10 ring-rose-500/20",
};

/**
 * A single MCQ in a topic's Practice tab. While the set is open it ships the
 * prompt and options only — never the answer — and picking an option just marks
 * it as chosen: no verdict, no colour, and the choice can be changed as often as
 * the learner likes. Only on submit does the card flip to review mode, where the
 * correct answer and the explanation are revealed.
 *
 * Visually the twin of Screening's `question-card.tsx`, minus its hint affordance
 * — domain questions explain themselves after grading instead.
 *
 * `prompt` is the question already rendered from markdown on the server (a C++
 * listing or a diagram can lead an OOPS question); without it the raw string is
 * shown as before. Options and explanations are short strings, so their only
 * markup — `inline code` — is handled here by `withInlineCode`.
 */
export function DomainQuestionCard({
  question,
  index,
  prompt: renderedPrompt,
}: {
  question: DomainPracticeQuestion;
  index: number;
  prompt?: ReactNode;
}) {
  const { id, prompt, options, difficulty } = question;
  const attempt = usePracticeAttempt();
  const progress = useDomainProgress();

  const reviewMode = attempt.submitted;
  const review = progress?.getReview(id); // present only for answered, submitted Qs
  const st = attempt.getState(id);

  // ---- per-question status dot ---------------------------------------------
  // Before submit the dot only says "answered / not answered" — it must not leak
  // whether the choice was right.
  let dot: "correct" | "wrong" | "answered" | "none" = "none";
  if (reviewMode) {
    if (review) dot = review.isCorrect ? "correct" : "wrong";
  } else if (st.selectedKey) {
    dot = "answered";
  }

  function optionClass(key: string) {
    if (reviewMode) {
      if (!review) return "border-border bg-surface-2 text-muted opacity-60";
      if (key === review.answerKey)
        return "border-emerald-500/60 bg-emerald-500/12 text-foreground ring-1 ring-emerald-500/40";
      if (key === review.selectedKey)
        return "border-rose-500/60 bg-rose-500/12 text-foreground ring-1 ring-rose-500/40";
      return "border-border bg-surface-2 text-muted opacity-60";
    }
    // attempt mode — "chosen", never "right" or "wrong"
    return st.selectedKey === key
      ? "border-rb-green-500/60 bg-rb-green-500/10 text-foreground ring-1 ring-rb-green-500/40"
      : "border-border bg-surface-2 text-muted hover:border-rb-green-500/40 hover:text-foreground cursor-pointer";
  }

  function optionIcon(key: string): LucideIcon | null {
    if (reviewMode && review) {
      if (key === review.answerKey) return CheckCircle2;
      if (key === review.selectedKey) return XCircle;
      return null;
    }
    return null;
  }

  return (
    <div data-question-id={id} className="py-5">
      <div className="flex items-start gap-3">
        <span className="shrink-0 text-sm font-bold tabular-nums text-accent">{index}.</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            {renderedPrompt ? (
              <div className="min-w-0 flex-1">{renderedPrompt}</div>
            ) : (
              <p className="whitespace-pre-line text-sm font-medium leading-relaxed text-foreground sm:text-[15px]">
                {prompt}
              </p>
            )}
            <div className="flex shrink-0 items-center gap-2">
              {difficulty ? (
                <span
                  className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 ${
                    DIFFICULTY_STYLE[difficulty] ?? ""
                  }`}
                >
                  {difficulty}
                </span>
              ) : null}
              <StatusDot status={dot} />
            </div>
          </div>

          {/* Options */}
          <fieldset
            className="mt-3 grid gap-2 sm:grid-cols-2"
            disabled={reviewMode}
          >
            <legend className="sr-only">Choose an answer</legend>
            {options.map((o) => {
              const Icon = optionIcon(o.key);
              const highlighted =
                (reviewMode && review && o.key === review.answerKey) ||
                (!reviewMode && st.selectedKey === o.key);
              return (
                <button
                  key={o.key}
                  type="button"
                  onClick={() => attempt.select(id, o.key)}
                  aria-pressed={st.selectedKey === o.key}
                  className={`flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left text-sm transition-all ${optionClass(
                    o.key
                  )}`}
                >
                  <span
                    className={`mt-px grid h-5 w-5 shrink-0 place-items-center rounded-md font-mono text-[11px] font-bold uppercase ${
                      highlighted ? "bg-rb-green-500/25 text-accent" : "bg-background/60 text-muted"
                    }`}
                  >
                    {o.key}
                  </span>
                  <span className="min-w-0 flex-1 leading-relaxed">{withInlineCode(o.label)}</span>
                  {Icon ? (
                    <Icon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        Icon === CheckCircle2 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    />
                  ) : null}
                </button>
              );
            })}
          </fieldset>

          {/* Explanation — review only. The chosen option's green/red mark already
              conveys the verdict, so no separate correct/incorrect chip. */}
          {reviewMode && review?.explanation ? (
            <div className="mt-3 rounded-xl border border-rb-green-500/25 bg-rb-green-500/[0.07] px-3 py-3">
              <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-accent">
                <Sparkles className="h-3.5 w-3.5" /> Explanation
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed text-muted">
                {withInlineCode(review.explanation)}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Per-question status indicator:
 *  - green tick          → correct        (review only)
 *  - filled rose dot     → incorrect      (review only)
 *  - filled accent dot   → answered, not yet submitted — no verdict implied
 *  - blank outlined dot  → not yet answered / skipped
 */
function StatusDot({ status }: { status: "correct" | "wrong" | "answered" | "none" }) {
  if (status === "correct") {
    return (
      <span title="Correct" className="text-emerald-500">
        <CheckCircle2 className="h-5 w-5" />
      </span>
    );
  }
  if (status === "wrong") {
    return (
      <span title="Incorrect" className="grid h-5 w-5 place-items-center" aria-label="Incorrect">
        <span className="h-3 w-3 rounded-full bg-rose-500" />
      </span>
    );
  }
  if (status === "answered") {
    return (
      <span title="Answered" className="grid h-5 w-5 place-items-center" aria-label="Answered">
        <span className="h-3 w-3 rounded-full bg-rb-green-500/70" />
      </span>
    );
  }
  return (
    <span title="Not answered" className="grid h-5 w-5 place-items-center" aria-label="Not answered">
      <span className="h-3 w-3 rounded-full border-2 border-border" />
    </span>
  );
}

/**
 * `a` and `b` → <code>a</code> and <code>b</code>. Backticks are the one piece
 * of markdown an option label or an explanation carries; anything without them
 * (every CN / DBMS / OS question) comes back as the same plain string.
 */
function withInlineCode(text: string): ReactNode {
  if (!text.includes("`")) return text;
  return text.split(/(`[^`]+`)/g).map((part, i) =>
    part.length > 2 && part.startsWith("`") && part.endsWith("`") ? (
      <code
        key={i}
        className="rounded bg-background/70 px-1 py-px font-mono text-[0.88em] text-foreground"
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      part
    )
  );
}
