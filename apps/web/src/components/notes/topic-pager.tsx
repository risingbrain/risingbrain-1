"use client";

import Link, { useLinkStatus } from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, ArrowRight, CheckCircle2, CornerDownRight, Loader2 } from "lucide-react";

/**
 * Prev / next pager for the foot of a study page — shared by Domain topics and
 * the Screening / Puzzles papers, exactly like the `ReadingTabs` switch above it.
 *
 * WHY IT EXISTS. Both sections put their whole sequence in a left index, and the
 * index is the ONLY way through it: finish a topic and you have to go back to the
 * rail and find the next line yourself. This is the "you are here, here is what
 * follows" control that a reading surface is expected to end with.
 *
 * WHAT IT IS NOT. It holds no data of its own and runs no query. Each section
 * feeds it a `prev`/`next` pair flattened from the SAME index the nav renders
 * from (both already sit in a client context that spans the parallel-route
 * boundary), so the two can never disagree about what comes next.
 *
 * SEQUENCE. The pager walks the whole route, not just the open category/subject
 * — stopping at a category edge would only move the dead end rather than remove
 * it, and both sections' selected-category providers already re-point the tabs
 * and the index off the URL when a link lands in a different one. A step that
 * does cross that boundary is never silent: `crossesScope` promotes the eyebrow
 * so the target's new category is announced on the button before it's clicked.
 */

export type PagerLink = {
  href: string;
  title: string;
  /** Group / category the target sits in — the small line above the title. */
  scope: string;
  /** True when the target leaves the currently-open category or subject. */
  crossesScope: boolean;
};

/** "Topic 8 of 24 · DBMS" — position WITHIN the open category, which is what the index shows. */
export type PagerPosition = { index: number; total: number; scope: string };

/**
 * A card's contents. Split out so it can call `useLinkStatus` — which only
 * reports on the <Link> it renders inside — and dim the card it belongs to while
 * that navigation is in flight, the same instant feedback the index rows give.
 */
function PagerCardBody({ link, dir }: { link: PagerLink; dir: "prev" | "next" }) {
  const { pending } = useLinkStatus();
  const Arrow = dir === "prev" ? ArrowLeft : ArrowRight;
  const alignEnd = dir === "next";

  return (
    // `flex-1` matters: the card is a flex row, so without it this column shrinks
    // to its content and there is no width for the `next` side to align against.
    //
    // Right-alignment is done with `text-right` + `flex-row-reverse` on the rows
    // below, NOT with `items-end` here. `align-items: flex-end` sizes every child
    // to its own max-content, which lets a long line push straight out of the card
    // and defeats the truncation — so each row instead takes `w-full` and clips
    // inside it.
    <span
      className={`flex min-w-0 flex-1 flex-col gap-1 transition-opacity ${
        pending ? "opacity-60" : ""
      } ${alignEnd ? "sm:text-right" : ""}`}
    >
      {/* Direction label + arrow. The arrow leads on `prev` and trails on `next`,
          so the pair reads outward from the middle of the row. */}
      <span
        className={`flex w-full min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted ${
          alignEnd ? "sm:flex-row-reverse" : ""
        }`}
      >
        {pending ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" aria-label="Loading" />
        ) : (
          <Arrow
            className={`h-3.5 w-3.5 shrink-0 transition-transform group-hover/pager:text-accent ${
              dir === "prev"
                ? "group-hover/pager:-translate-x-0.5"
                : "group-hover/pager:translate-x-0.5"
            }`}
          />
        )}
        {dir === "prev" ? "Previous" : "Next"}
      </span>

      {/* Where it lands. A step that stays inside the open category is quiet
          context; one that leaves it is the thing the learner most needs to see,
          so it takes the accent and a marker rather than reading as more of the
          same. */}
      <span
        className={`flex w-full min-w-0 items-center gap-1 text-[11px] font-medium uppercase tracking-wider ${
          link.crossesScope ? "text-accent" : "text-muted/80"
        } ${alignEnd ? "sm:flex-row-reverse" : ""}`}
      >
        {link.crossesScope ? <CornerDownRight className="h-3 w-3 shrink-0" /> : null}
        {/* `min-w-0` is what lets this shrink past its content and ellipsize —
            a cross-subject scope ("Operating Systems · Module 1 — Foundations…")
            is far wider than half a sheet. */}
        <span className="min-w-0 truncate">{link.scope}</span>
      </span>

      {/* Two lines maximum: topic titles run long, and a card that grows with its
          title makes the pair uneven. `line-clamp-2` keeps the row symmetrical
          and the full title is still on the link's accessible name. */}
      <span className="line-clamp-2 w-full min-w-0 text-sm font-semibold text-foreground group-hover/pager:text-brand">
        {link.title}
      </span>
    </span>
  );
}

function PagerCard({
  link,
  dir,
  className = "",
}: {
  link: PagerLink;
  dir: "prev" | "next";
  className?: string;
}) {
  const router = useRouter();
  return (
    <Link
      href={link.href}
      // Same navigation contract as the index rows: no eager prefetch for every
      // pager on every page, but warm the route the moment a pointer lands on it,
      // so the click itself is instant.
      prefetch={false}
      scroll={false}
      onPointerEnter={() => router.prefetch(link.href)}
      onClick={(e) => scrollPaneToTop(e.currentTarget)}
      aria-label={`${dir === "prev" ? "Previous" : "Next"} topic: ${link.title} (${link.scope})`}
      // `h-full` so a one-line title next to a two-line one still gives the pair
      // a level bottom edge — the grid stretches the cell, the card fills it.
      className={`group/pager flex h-full min-w-0 rounded-xl border border-reading-border px-4 py-3.5 transition-colors hover:border-rb-green-500/55 hover:bg-rb-green-500/[0.04] focus-visible:border-rb-green-500/55 ${className}`}
    >
      <PagerCardBody link={link} dir={dir} />
    </Link>
  );
}

/**
 * The pager sits at the BOTTOM of a pane that owns its own scrollport (see the
 * `pane-scroll` wrapper in each section's workspace), and the index links pass
 * `scroll={false}` because a page-level scroll would be wrong there. Left alone
 * that combination lands the learner at the bottom of the topic they just opened.
 * So put them back at the top explicitly: the pane on desktop, the window on
 * mobile, where the pane doesn't scroll and the page does.
 */
function scrollPaneToTop(el: HTMLElement) {
  el.closest(".pane-scroll")?.scrollTo({ top: 0 });
  window.scrollTo({ top: 0 });
}

export function TopicPager({
  prev,
  next,
  position,
  endLabel,
}: {
  prev: PagerLink | null;
  next: PagerLink | null;
  position: PagerPosition | null;
  /** Named in the end-of-sequence card, e.g. "Computer Networks". */
  endLabel: string;
}) {
  // A section with a single topic, or a slug that isn't in the index (a stale
  // bookmark, or the /screening → /puzzles redirect), has nothing to page to.
  if (!prev && !next) return null;

  return (
    <nav
      aria-label="Topic navigation"
      className="mt-8 border-t border-reading-border pt-6"
    >
      {/* Next leads on mobile — it's the button wanted almost every time, and a
          stacked pair puts whatever comes first under the thumb. The grid restores
          reading order (prev left, next right) from `sm` up. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {prev ? (
          <PagerCard link={prev} dir="prev" className="order-2 sm:order-1" />
        ) : (
          // Holds the column so `next` stays on the right edge instead of sliding
          // across on the first topic. Nothing to hold on mobile, where the pair
          // is stacked and full-width.
          <div className="order-2 hidden sm:order-1 sm:block" aria-hidden />
        )}

        {next ? (
          <PagerCard link={next} dir="next" className="order-1 sm:order-2" />
        ) : (
          /* End of the sequence. A blank half-row here reads as a bug rather than
             as an ending, and "there is no next" is worth saying once the learner
             has worked all the way to it. Not a link — every route out of here
             (the index, the tabs) is already on screen. */
          <div className="order-1 flex items-center gap-3 rounded-xl border border-rb-green-500/25 bg-rb-green-500/[0.06] px-4 py-3.5 sm:order-2">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-brand" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-foreground">
                End of {endLabel}
              </span>
              <span className="block text-xs text-muted">
                You&rsquo;ve reached the last topic. Pick another from the index.
              </span>
            </span>
          </div>
        )}
      </div>

      {position ? (
        <p className="mt-3 text-center text-xs tabular-nums text-muted">
          Topic {position.index} of {position.total} · {position.scope}
        </p>
      ) : null}
    </nav>
  );
}
