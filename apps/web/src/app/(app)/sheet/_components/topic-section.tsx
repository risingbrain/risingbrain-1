"use client";

import { useState } from "react";
import { ChevronDown, Lightbulb, Target } from "lucide-react";
import { ProblemRow } from "./problem-row";
import { useCelebrate, useCompletionEffect } from "./celebration";
import { useRecordSheetPosition } from "./sheet-progress";
import type { SheetPattern } from "./types";

/**
 * A single category (topic) rendered flat: a heading + progress bar, then all
 * of its subcategories (patterns) listed directly — all expanded by default.
 * Patterns and problems are provided up-front from SSR; no lazy fetching needed.
 */
export function TopicSection({
  topicId,
  name,
  description,
  problemCount,
  solvedCount,
  patterns,
  visibleProblemIds = null,
  bookmarkedIds,
  solvedIds,
  forceExpanded = false,
  resumePatternId = null,
}: {
  topicId: string;
  name: string;
  description?: string | null;
  problemCount: number;
  solvedCount: number;
  patterns: SheetPattern[];
  // When non-null, only problems whose id is in this set are rendered; progress
  // counts still reflect the full set. `null` means no filter (show everything).
  visibleProblemIds?: Set<string> | null;
  // Live bookmarked-problem ids — the single source of truth for each row's
  // bookmark display.
  bookmarkedIds: Set<string>;
  // Live solved-problem ids — the single source of truth for each row's
  // checkmark and for every derived solved count.
  solvedIds: Set<string>;
  forceExpanded?: boolean;
  // The sheet's saved "continue here" pattern — it mounts expanded.
  resumePatternId?: string | null;
}) {
  const pct = problemCount > 0 ? Math.round((solvedCount / problemCount) * 100) : 0;
  const complete = problemCount > 0 && solvedCount >= problemCount;

  const celebrate = useCelebrate();
  useCompletionEffect(complete, () => celebrate("topic"));

  // Hide the whole topic when a filter is active and none of its problems match.
  // (Placed after all hooks so hook order stays stable across renders.)
  const hasVisible =
    !visibleProblemIds ||
    patterns.some((p) => p.problems.some((pr) => visibleProblemIds.has(pr.id)));
  if (!hasVisible) return null;

  return (
    <section data-topic-id={topicId} className="py-8 first:pt-2">
      {/* Category header — heading + progress bar, no card, no toggle. */}
      <div className="flex flex-col gap-2 px-1">
        <div className="flex items-center gap-2.5">
          <h3 className="text-xl font-bold tracking-tight text-foreground sm:text-2xl">{name}</h3>
          {complete && (
            <span className="shrink-0 rounded-full bg-rb-green-500/15 px-2 py-0.5 text-[10px] font-semibold text-accent">
              Done
            </span>
          )}
          <span className="ml-auto shrink-0 text-xs font-medium text-muted">
            {problemCount} {problemCount === 1 ? "problem" : "problems"}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <div className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-rb-green-500 transition-[width] duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 text-xs font-medium tabular-nums text-muted">
            {solvedCount} / {problemCount}
          </span>
        </div>

        {description && (
          <p className="text-sm leading-relaxed text-muted">{description}</p>
        )}
      </div>

      {/* Subcategories (patterns) */}
      <div className="mt-4 space-y-4">
        {patterns.map((pattern) => (
          <PatternBlock
            key={pattern.id}
            pattern={pattern}
            visibleProblemIds={visibleProblemIds}
            bookmarkedIds={bookmarkedIds}
            solvedIds={solvedIds}
            forceExpanded={forceExpanded}
            defaultOpen={pattern.id === resumePatternId}
          />
        ))}
      </div>
    </section>
  );
}

function PatternBlock({
  pattern,
  visibleProblemIds = null,
  bookmarkedIds,
  solvedIds,
  forceExpanded = false,
  defaultOpen = false,
}: {
  pattern: SheetPattern;
  visibleProblemIds?: Set<string> | null;
  bookmarkedIds: Set<string>;
  solvedIds: Set<string>;
  forceExpanded?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const recordPosition = useRecordSheetPosition();
  // When a search is active, show content regardless of the local toggle state.
  const isOpen = open || forceExpanded;
  // Progress is DERIVED from the lifted solvedIds set — always against the FULL
  // problem set so a filter never shrinks the denominator (which would fire a
  // false "Done" / celebration), and a remount can't reset it to a stale value.
  const total = pattern.problems.length;
  const solved = pattern.problems.reduce((n, p) => n + (solvedIds.has(p.id) ? 1 : 0), 0);
  const done = total > 0 && solved >= total;

  const celebrate = useCelebrate();
  useCompletionEffect(done, () => celebrate("pattern"));

  // Only the matching problems are rendered; counts above stay on the full set.
  const visibleProblems = visibleProblemIds
    ? pattern.problems.filter((p) => visibleProblemIds.has(p.id))
    : pattern.problems;

  // Drop the whole pattern when a filter is active and nothing in it matches.
  if (visibleProblemIds && visibleProblems.length === 0) return null;

  return (
    // Any click inside — expanding it, a problem link, solve, bookmark, note —
    // marks this as where the visitor is working (capture phase, so it fires
    // even for links and buttons that stop propagation). `data-pattern-id` is
    // the resume scroll target; `data-flash` is the brief "you're here" ring.
    <div
      data-pattern-id={pattern.id}
      onClickCapture={() => recordPosition(pattern.id)}
      className="overflow-hidden rounded-2xl bg-surface-2/40 ring-1 ring-border/50 transition-shadow duration-500 data-[flash]:ring-2 data-[flash]:ring-rb-green-500/70"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-3 px-4 py-5 text-left transition-colors hover:bg-surface-2/70 sm:px-5 sm:py-6"
      >
        <span
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full bg-rb-green-500/15 text-accent transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        >
          <ChevronDown className="h-4 w-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold text-foreground">{pattern.name}</h4>
            {done && (
              <span className="shrink-0 rounded-full bg-rb-green-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
                Done
              </span>
            )}
          </div>
          {!isOpen && pattern.identification && (
            <p className="truncate text-xs text-muted">{pattern.identification}</p>
          )}
        </div>
        <CircleProgress solved={solved} total={total} />
      </button>

      {/* Collapsed patterns still ship their text in the server HTML — hidden,
          but present — so search engines can index every problem name and the
          pattern strategy. Rendering nothing here (as before) left the sheet
          pages with no problem titles at all in the crawled HTML. Plain markup
          only: the interactive rows mount when the pattern is opened. */}
      {!isOpen && (
        <div hidden>
          {pattern.strategy && <p>{pattern.strategy}</p>}
          <ul>
            {visibleProblems.map((problem) => (
              <li key={problem.id}>{problem.title}</li>
            ))}
          </ul>
        </div>
      )}

      {isOpen && (
        <div className="animate-in">
          {(pattern.identification || pattern.strategy) && (
            <div className="flex flex-col gap-1.5 px-4 pb-3 sm:px-5">
              {pattern.identification && (
                <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
                  <Target className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  <span>{pattern.identification}</span>
                </p>
              )}
              {pattern.strategy && (
                <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                  <span>{pattern.strategy}</span>
                </p>
              )}
            </div>
          )}
          <div className="divide-y divide-border border-t border-border">
            {visibleProblems.map((problem, i) => (
              <ProblemRow
                key={problem.id}
                problem={problem}
                index={i + 1}
                bookmarked={bookmarkedIds.has(problem.id)}
                solved={solvedIds.has(problem.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function CircleProgress({ solved, total }: { solved: number; total: number }) {
  const size = 48;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const pct = total > 0 ? Math.min(1, solved / total) : 0;
  const offset = circumference * (1 - pct);

  return (
    <span
      className="relative grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
      title={`${solved} of ${total} solved`}
    >
      <svg width={size} height={size} className="-rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className="stroke-surface-2"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="stroke-rb-green-500 transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute text-[10px] font-semibold leading-none tabular-nums text-foreground">
        {solved}/{total}
      </span>
    </span>
  );
}
