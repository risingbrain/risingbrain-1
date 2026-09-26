"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bookmark, CircleCheckBig, Search, X } from "lucide-react";
import { Difficulty } from "@risingbrain/database/enums";
import { TopicSection } from "./topic-section";
import { difficultyLabel } from "./difficulty-badge";
import {
  DifficultyFilter,
  type DifficultyFilterValue,
  type DifficultyOption,
} from "./difficulty-filter";
import { CelebrationProvider, useCelebrate } from "./celebration";
import {
  SheetBookmarkContext,
  SheetGuestContext,
  SheetPositionContext,
  SheetSolvedContext,
  useSheetSignedIn,
} from "./sheet-progress";
import { writePositionCookie, type ResumeState } from "./resume-cookie";
import { type DifficultyStat } from "./progress-panel";
import { SheetStats } from "./sheet-stats";
import type { SheetActivity } from "../_data";
import type { DifficultyValue, SheetMeta } from "./types";

/** Where a restored pattern's top edge should land in its scroller, in px. */
const PANE_OFFSET = 16; // desktop: inside the `.app-scrollport` pane
const WINDOW_OFFSET = 72; // below `lg`: clears the sticky ~57px mobile header
/** How long an initial restore is defended against being scrolled away. */
const RESTORE_GUARD_MS = 2000;
/** Any of these means the visitor is steering — stop defending the restore. */
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Brings a pattern block to the top of whatever is scrolling it, then flashes a
 * highlight ring so the visitor sees where they resumed. Returns a cleanup.
 *
 * NOT `scrollIntoView()`: on desktop the page scrolls inside the shell's
 * `.app-scrollport` pane, and scrollIntoView also aligns every ancestor
 * scroller — including the viewport — which shoves the fixed shell off screen
 * (see admin/_components/scrollport-reset.tsx). So scroll the one box that owns
 * the scroll: the pane on desktop, the window below `lg` (where the pane is
 * `overflow: visible` and a sticky ~57px header sits on top).
 *
 * `guard` (the initial restore) keeps the position for a short while after.
 * Arriving by client-side navigation, Next's router resets the document to the
 * top (`html.scrollTop = 0` in layout-router's scroll-and-focus handler) a few
 * ms AFTER this runs — a race against the streamed page commit, so it only bit
 * sometimes, and only below `lg`, where the document is the scroller. Late
 * layout shifts can move the target too. So while guarding, any scroll that
 * leaves the pattern off its mark is undone — until the visitor scrolls, taps
 * or presses a key themselves, or the window closes. Tab switches (`smooth`)
 * don't guard: nothing races them, and re-aligning would fight the animation.
 */
function scrollToPattern(patternId: string, smooth: boolean, guard: boolean): () => void {
  const el = document.querySelector<HTMLElement>(`[data-pattern-id="${CSS.escape(patternId)}"]`);
  if (!el) return () => {};
  const found = el.closest<HTMLElement>(".app-scrollport");
  const pane = found && getComputedStyle(found).overflowY !== "visible" ? found : null;
  const offset = pane ? PANE_OFFSET : WINDOW_OFFSET;
  const distanceFromMark = () =>
    el.getBoundingClientRect().top - (pane ? pane.getBoundingClientRect().top : 0) - offset;
  const align = (behavior: ScrollBehavior) => {
    if (pane) pane.scrollTo({ top: pane.scrollTop + distanceFromMark(), behavior });
    else window.scrollTo({ top: window.scrollY + distanceFromMark(), behavior });
  };

  align(smooth ? "smooth" : "instant");
  el.dataset.flash = "";
  const unflash = window.setTimeout(() => delete el.dataset.flash, 1600);
  if (!guard) return () => window.clearTimeout(unflash);

  const scroller: HTMLElement | Window = pane ?? window;
  const onScroll = () => {
    if (Math.abs(distanceFromMark()) > 48) align("instant");
  };
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    window.clearTimeout(timer);
    scroller.removeEventListener("scroll", onScroll);
    for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, stop, true);
  };
  const timer = window.setTimeout(stop, RESTORE_GUARD_MS);
  scroller.addEventListener("scroll", onScroll, { passive: true });
  for (const type of USER_SCROLL_EVENTS) {
    window.addEventListener(type, stop, { capture: true, passive: true });
  }
  return () => {
    stop();
    window.clearTimeout(unflash);
  };
}

/**
 * Client shell for the practice sheets. Owns the live "solved per topic" map so
 * toggling a problem instantly updates that topic's bar, the active sheet's
 * progress bar AND the sheet tab's count — all scoped strictly per sheet.
 *
 * Wrapped in CelebrationProvider so the (single, portal-rendered) completion
 * confetti for patterns/topics/sheets can be triggered from anywhere below.
 */
export function SheetSelector({
  sheets,
  difficulty,
  activity,
  greetingName,
  signedIn = false,
  header,
  initialSheetId,
  resume,
  resumeOwner,
}: {
  sheets: SheetMeta[];
  difficulty: DifficultyStat;
  activity?: SheetActivity | null;
  greetingName?: string | null;
  signedIn?: boolean;
  header?: React.ReactNode;
  /** Sheet to open on first render (URL or resume cookie); defaults to the first. */
  initialSheetId?: string;
  /** Per-sheet last-worked pattern from the resume cookies (server-resolved). */
  resume?: ResumeState;
  /** Owner stamp to write into the resume cookies (hash of user id / guest). */
  resumeOwner?: string;
}) {
  return (
    <CelebrationProvider>
      <SheetGuestContext.Provider value={signedIn}>
        <SheetSelectorInner
          sheets={sheets}
          difficulty={difficulty}
          activity={activity}
          greetingName={greetingName}
          header={header}
          initialSheetId={initialSheetId}
          resume={resume}
          resumeOwner={resumeOwner}
        />
      </SheetGuestContext.Provider>
    </CelebrationProvider>
  );
}

function SheetSelectorInner({
  sheets,
  difficulty,
  activity,
  greetingName,
  header,
  initialSheetId,
  resume,
  resumeOwner,
}: {
  sheets: SheetMeta[];
  difficulty: DifficultyStat;
  activity?: SheetActivity | null;
  greetingName?: string | null;
  header?: React.ReactNode;
  initialSheetId?: string;
  resume?: ResumeState;
  resumeOwner?: string;
}) {
  const [activeId, setActiveId] = useState(initialSheetId ?? sheets[0]?.id ?? "");

  // ---- Resume ("continue where you left off") ------------------------------
  // sheetId → last pattern worked in, seeded from the per-sheet cookies and kept
  // live so switching back to a sheet in this visit reopens its latest pattern.
  const [positions, setPositions] = useState<Record<string, string>>(() => ({
    ...resume?.patterns,
  }));
  // The pattern to scroll to after the next render: the active sheet's saved
  // pattern on first load (instant — it should feel like it opened there), and
  // the target sheet's on a tab switch (smooth). `n` re-triggers the effect.
  const [scrollTarget, setScrollTarget] = useState<
    { patternId: string; smooth: boolean; n: number } | null
  >(() => {
    const id = resume?.patterns[initialSheetId ?? sheets[0]?.id ?? ""];
    return id ? { patternId: id, smooth: false, n: 0 } : null;
  });
  useEffect(() => {
    if (!scrollTarget) return;
    let cleanup = () => {};
    const frame = requestAnimationFrame(() => {
      // Only the first-load restore (not a tab switch) needs defending.
      cleanup = scrollToPattern(scrollTarget.patternId, scrollTarget.smooth, !scrollTarget.smooth);
    });
    return () => {
      cancelAnimationFrame(frame);
      cleanup();
    };
  }, [scrollTarget]);

  // Opened on the bare /sheet hub but resumed onto a sheet: make the address
  // bar name it, exactly as a tab click would.
  useEffect(() => {
    if (!resume?.sheetId || window.location.pathname !== "/sheet") return;
    const slug = sheets.find((s) => s.id === resume.sheetId)?.slug;
    if (slug) window.history.replaceState(null, "", `/sheet/${slug}`);
  }, [resume, sheets]);
  const [searchQuery, setSearchQuery] = useState("");
  const [bookmarkOnly, setBookmarkOnly] = useState(false);
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilterValue>("ALL");
  const celebrate = useCelebrate();
  const signedIn = useSheetSignedIn();

  // Clear search whenever the user switches to a different sheet. The bookmark
  // filter is a persistent mode, so it survives sheet switches on purpose.
  useEffect(() => { setSearchQuery(""); }, [activeId]);

  // Live set of bookmarked problem ids (across all sheets), seeded from the SSR
  // snapshot and kept in sync as rows toggle, so the "bookmarked only" filter
  // reacts instantly without a reload.
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(() => {
    const init = new Set<string>();
    for (const sheet of sheets) {
      for (const topic of sheet.topics) {
        for (const pattern of topic.patterns) {
          for (const p of pattern.problems) if (p.isBookmarked) init.add(p.id);
        }
      }
    }
    return init;
  });

  const reportBookmark = useCallback((problemId: string, bookmarked: boolean) => {
    setBookmarkedIds((prev) => {
      if (bookmarked === prev.has(problemId)) return prev;
      const next = new Set(prev);
      if (bookmarked) next.add(problemId);
      else next.delete(problemId);
      return next;
    });
  }, []);

  // Live set of solved problem ids (across all sheets), seeded from the SSR
  // snapshot — THE single source of truth for solved state. Every solved count
  // below is DERIVED from it, so the row checkmarks and the totals can never
  // drift apart (the bug where a filter-driven remount reset a checkmark while
  // the totals stayed updated).
  const [solvedIds, setSolvedIds] = useState<Set<string>>(() => {
    const init = new Set<string>();
    for (const sheet of sheets)
      for (const topic of sheet.topics)
        for (const pattern of topic.patterns)
          for (const p of pattern.problems) if (p.status === "SOLVED") init.add(p.id);
    return init;
  });

  const reportSolved = useCallback((problemId: string, solved: boolean) => {
    setSolvedIds((prev) => {
      if (solved === prev.has(problemId)) return prev;
      const next = new Set(prev);
      if (solved) next.add(problemId);
      else next.delete(problemId);
      return next;
    });
  }, []);

  // problemId → { topicId, difficulty }, built once from the (static) tree so the
  // solved set can be bucketed into per-topic and per-difficulty counts.
  const problemMeta = useMemo(() => {
    const map = new Map<string, { topicId: string; difficulty: DifficultyValue }>();
    for (const sheet of sheets)
      for (const topic of sheet.topics)
        for (const pattern of topic.patterns)
          for (const p of pattern.problems)
            map.set(p.id, { topicId: topic.id, difficulty: p.difficulty });
    return map;
  }, [sheets]);

  // Solved count per topic — derived from the source-of-truth set.
  const solvedByTopic = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const sheet of sheets) for (const topic of sheet.topics) counts[topic.id] = 0;
    for (const id of solvedIds) {
      const meta = problemMeta.get(id);
      if (meta) counts[meta.topicId] = (counts[meta.topicId] ?? 0) + 1;
    }
    return counts;
  }, [sheets, solvedIds, problemMeta]);

  // Combined difficulty stats for the right-rail panel — totals are static (from
  // the SSR snapshot), solved counts derived from the set.
  const diffStat = useMemo<DifficultyStat>(() => {
    const stat: DifficultyStat = {
      EASY: { solved: 0, total: difficulty.EASY.total },
      MEDIUM: { solved: 0, total: difficulty.MEDIUM.total },
      HARD: { solved: 0, total: difficulty.HARD.total },
    };
    for (const id of solvedIds) {
      const meta = problemMeta.get(id);
      if (meta) stat[meta.difficulty].solved += 1;
    }
    return stat;
  }, [difficulty, solvedIds, problemMeta]);

  // NOTE: this component deliberately publishes NO live activity numbers. It
  // used to derive a `todayDelta` (`solvedIds.size` minus the page's initial
  // solved total) and feed it to the calendar's today cell, plus broadcast its
  // own streak estimate to the navbar flame. Both were wrong: the delta is a
  // session-wide net over every problem, so un-ticking month-old work dropped
  // today's square and retracted the streak, and the streak estimate was
  // DSA-only so it knocked an all-activity 6 down to 1 on the first solve.
  // `refreshActivity()` in problem-row refetches the authoritative snapshot
  // after every toggle, so the server is the single writer for both.

  // Per-sheet aggregates (totals are static; solved is live).
  const stats = useMemo(() => {
    const map = new Map<string, { total: number; solved: number }>();
    for (const sheet of sheets) {
      let total = 0;
      let solved = 0;
      for (const topic of sheet.topics) {
        total += topic.problemCount;
        solved += solvedByTopic[topic.id] ?? 0;
      }
      map.set(sheet.id, { total, solved });
    }
    return map;
  }, [sheets, solvedByTopic]);

  // Fire the grand "sheet complete" celebration when any sheet first reaches
  // 100%. Seeded with sheets already complete on mount so they don't fire, and
  // keyed per sheet so switching tabs never triggers a false celebration.
  const completedSheets = useRef<Set<string> | null>(null);
  if (completedSheets.current === null) {
    const seed = new Set<string>();
    for (const [id, s] of stats) if (s.total > 0 && s.solved >= s.total) seed.add(id);
    completedSheets.current = seed;
  }
  useEffect(() => {
    const done = completedSheets.current!;
    for (const [id, s] of stats) {
      const isComplete = s.total > 0 && s.solved >= s.total;
      if (isComplete && !done.has(id)) {
        done.add(id);
        celebrate("sheet");
      } else if (!isComplete) {
        done.delete(id);
      }
    }
  }, [stats, celebrate]);

  const active = sheets.find((s) => s.id === activeId) ?? sheets[0];

  // Any click inside a pattern saves it as this sheet's resume point — its own
  // cookie per sheet, so each sheet resumes independently.
  const activeSlug = active?.slug;
  const activeSheetId = active?.id;
  const recordPosition = useCallback(
    (patternId: string) => {
      if (!activeSlug || !activeSheetId || !resumeOwner) return;
      writePositionCookie(activeSlug, { owner: resumeOwner, patternId, at: Date.now() });
      setPositions((prev) =>
        prev[activeSheetId] === patternId ? prev : { ...prev, [activeSheetId]: patternId },
      );
    },
    [activeSlug, activeSheetId, resumeOwner],
  );

  // Difficulty options are derived from the DB-loaded tree, never hardcoded: we
  // count the problems in the active sheet per difficulty and offer only the
  // ones that actually occur. Ordering follows the schema's own `Difficulty`
  // enum (easiest → hardest), with any value the frontend doesn't know about
  // appended rather than dropped.
  const difficultyOptions = useMemo<DifficultyOption[]>(() => {
    if (!active) return [];
    const counts = new Map<DifficultyValue, number>();
    for (const topic of active.topics)
      for (const pattern of topic.patterns)
        for (const p of pattern.problems)
          counts.set(p.difficulty, (counts.get(p.difficulty) ?? 0) + 1);

    const order = Object.values(Difficulty) as string[];
    const rank = (d: string) => {
      const i = order.indexOf(d);
      return i === -1 ? order.length : i;
    };
    return [...counts.entries()]
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([value, count]) => ({ value, count }));
  }, [active]);

  // A sheet may not contain every difficulty — fall back to "All" rather than
  // showing an empty list after a sheet switch.
  useEffect(() => {
    if (difficultyFilter !== "ALL" && !difficultyOptions.some((o) => o.value === difficultyFilter)) {
      setDifficultyFilter("ALL");
    }
  }, [difficultyOptions, difficultyFilter]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const filterActive = !!trimmedQuery || bookmarkOnly || difficultyFilter !== "ALL";

  // The set of problem ids in the active sheet matching the active filters
  // (search title/reference AND bookmark AND difficulty compose with AND).
  // `null` means no
  // filter — render everything. We compute *visibility* rather than rebuilding
  // the data tree so progress denominators always reflect the full set, never
  // the filtered subset (a filtered tree would corrupt the pattern/topic bars
  // and fire false completion celebrations).
  const visibleProblemIds = useMemo<Set<string> | null>(() => {
    if (!active || !filterActive) return null;
    const ids = new Set<string>();
    for (const topic of active.topics) {
      for (const pattern of topic.patterns) {
        for (const p of pattern.problems) {
          const matchesQuery =
            !trimmedQuery ||
            p.title.toLowerCase().includes(trimmedQuery) ||
            (p.reference?.toLowerCase().includes(trimmedQuery) ?? false);
          const matchesBookmark = !bookmarkOnly || bookmarkedIds.has(p.id);
          const matchesDifficulty =
            difficultyFilter === "ALL" || p.difficulty === difficultyFilter;
          if (matchesQuery && matchesBookmark && matchesDifficulty) ids.add(p.id);
        }
      }
    }
    return ids;
  }, [active, filterActive, trimmedQuery, bookmarkOnly, bookmarkedIds, difficultyFilter]);

  // Number of problems matching the active filters (used for the result count).
  const matchCount = visibleProblemIds?.size ?? 0;

  // How many problems in the active sheet are bookmarked (drives the toggle badge).
  const activeBookmarkCount = useMemo(() => {
    if (!active) return 0;
    let n = 0;
    for (const topic of active.topics) {
      for (const pattern of topic.patterns) {
        for (const p of pattern.problems) if (bookmarkedIds.has(p.id)) n++;
      }
    }
    return n;
  }, [active, bookmarkedIds]);

  if (!active) {
    return <p className="py-12 text-center text-sm text-muted">No sheets published yet.</p>;
  }

  const activeStat = stats.get(active.id) ?? { total: 0, solved: 0 };
  const activePct =
    activeStat.total > 0 ? Math.round((activeStat.solved / activeStat.total) * 100) : 0;

  return (
    <SheetSolvedContext.Provider value={reportSolved}>
    <SheetBookmarkContext.Provider value={reportBookmark}>
    <SheetPositionContext.Provider value={recordPosition}>
      {/* Three-column shell: center content + a sticky right progress rail. */}
      <div className="xl:flex xl:items-start xl:gap-6">
        <div className="min-w-0 xl:flex-1">
          {header}

          {/* Progress + calendar shown inline below xl; the sticky rail on the
              right takes over at xl and up. */}
          <div className="mt-4 xl:hidden">
            <SheetStats
              difficulty={diffStat}
              activity={activity}
              greetingName={greetingName}
            />
          </div>

      {/* Sheet selector — segmented control (full width) */}
      <div
        role="tablist"
        aria-label="Choose a sheet"
        className="mt-8 flex flex-wrap gap-3"
      >
        {sheets.map((sheet, i) => {
          const s = stats.get(sheet.id) ?? { total: 0, solved: 0 };
          const isActive = sheet.id === active.id;
          const href = `/sheet/${sheet.slug}`;
          return (
            // A real link to the sheet's own page, so crawlers can discover
            // every sheet URL. A plain click still switches in place (no server
            // round-trip) and just swaps the address bar to match; modified
            // clicks (new tab/window) fall through to the browser.
            <a
              key={sheet.id}
              href={href}
              role="tab"
              aria-selected={isActive}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                setActiveId(sheet.id);
                window.history.replaceState(null, "", href);
                const saved = positions[sheet.id];
                if (saved && sheet.id !== active.id) {
                  setScrollTarget((t) => ({ patternId: saved, smooth: true, n: (t?.n ?? 0) + 1 }));
                }
              }}
              className={`group flex items-center gap-3 rounded-2xl px-6 py-4 text-left transition-all ${
                isActive
                  ? "bg-rb-green-500/15 text-brand ring-1 ring-rb-green-500/40"
                  : "glass-pill text-muted hover:text-foreground"
              }`}
            >
              {/* Sheet position number (1-based), not a percentage. */}
              <span
                className={`grid h-10 w-10 shrink-0 place-items-center rounded-full text-sm font-bold tabular-nums ${
                  isActive ? "bg-rb-green-500 text-black" : "bg-surface-2 text-muted"
                }`}
              >
                {i + 1}
              </span>
              <span className="flex flex-col">
                <span
                  className={`text-base font-semibold ${isActive ? "text-brand" : "text-foreground"}`}
                >
                  {sheet.name}
                </span>
                <span className="text-xs font-medium text-muted">
                  {s.solved} / {s.total} solved
                </span>
              </span>
            </a>
          );
        })}
      </div>

      {/* Active sheet header + per-sheet progress */}
      <div className="glass mt-6 rounded-3xl p-6 sm:p-7">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-bold tracking-tight">{active.name}</h2>
            {active.description && (
              <p className="mt-2 text-sm leading-relaxed text-muted">{active.description}</p>
            )}
          </div>
          <span className="glass-pill inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium text-accent">
            <CircleCheckBig className="h-4 w-4" />
            {active.topics.length} topics
          </span>
        </div>

        <div className="mt-5 flex items-center gap-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full rounded-full bg-rb-green-500 transition-[width] duration-700 ease-out"
              style={{ width: `${activePct}%` }}
            />
          </div>
          <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
            {activeStat.solved} / {activeStat.total}
          </span>
          <span className="shrink-0 text-sm font-bold tabular-nums text-gradient">
            {activePct}%
          </span>
        </div>
      </div>

      {/* Search bar + difficulty filter + bookmark filter */}
      <div className="mt-5 flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search problems…"
            className="glass w-full rounded-2xl py-3 pl-10 pr-10 text-sm text-foreground placeholder:text-muted outline-none focus:ring-1 focus:ring-rb-green-500/40"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              aria-label="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-0.5 text-muted transition-colors hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        {/* Difficulty filter — sits between the search box and the bookmark
            toggle. Only worth showing when the sheet spans more than one
            difficulty. */}
        {difficultyOptions.length > 1 && (
          <DifficultyFilter
            options={difficultyOptions}
            value={difficultyFilter}
            total={activeStat.total}
            onChange={setDifficultyFilter}
          />
        )}

        {/* Bookmarked-only toggle (signed-in users only — guests have no bookmarks) */}
        {signedIn && (
          <button
            type="button"
            onClick={() => setBookmarkOnly((v) => !v)}
            aria-pressed={bookmarkOnly}
            title={bookmarkOnly ? "Show all problems" : "Show bookmarked only"}
            className={`flex shrink-0 items-center gap-2 rounded-2xl px-4 py-3 text-sm font-medium transition-all ${
              bookmarkOnly
                ? "bg-rb-green-500/15 text-brand ring-1 ring-rb-green-500/40"
                : "glass text-muted hover:text-foreground"
            }`}
          >
            <Bookmark className={`h-4 w-4 ${bookmarkOnly ? "fill-current" : ""}`} />
            <span className="hidden sm:inline">Bookmarked</span>
            {activeBookmarkCount > 0 && (
              <span
                className={`grid h-5 min-w-[1.25rem] place-items-center rounded-full px-1 text-[10px] font-bold tabular-nums ${
                  bookmarkOnly ? "bg-rb-green-500 text-black" : "bg-surface-2 text-muted"
                }`}
              >
                {activeBookmarkCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* Filter result count — shown only when there are matches; the empty
          case is handled by the single empty-state block below. */}
      {filterActive && matchCount > 0 && (
        <p className="mt-2.5 px-1 text-xs text-muted">
          {`${matchCount} problem${matchCount === 1 ? "" : "s"} found`}
          {difficultyFilter !== "ALL" && ` · ${difficultyLabel(difficultyFilter)}`}
          {bookmarkOnly && " · bookmarked"}
        </p>
      )}

      {/* Topics for the active sheet */}
      <div className="mt-4 divide-y divide-border/70 pb-24">
        {active.topics.map((topic) => (
          <TopicSection
            key={topic.id}
            topicId={topic.id}
            name={topic.name}
            description={topic.description}
            problemCount={topic.problemCount}
            solvedCount={solvedByTopic[topic.id] ?? 0}
            patterns={topic.patterns}
            visibleProblemIds={visibleProblemIds}
            bookmarkedIds={bookmarkedIds}
            solvedIds={solvedIds}
            forceExpanded={filterActive}
            resumePatternId={positions[active.id] ?? null}
          />
        ))}
        {filterActive && matchCount === 0 && (
          <div className="py-16 text-center text-sm text-muted">
            {bookmarkOnly && !trimmedQuery && difficultyFilter === "ALL" ? (
              <>
                No bookmarked problems in this sheet yet.
                <br />
                Tap the <Bookmark className="inline h-3.5 w-3.5 align-text-bottom" /> on any
                problem to save it for later.
              </>
            ) : !trimmedQuery && difficultyFilter !== "ALL" ? (
              <>
                No {difficultyLabel(difficultyFilter).toLowerCase()}
                {bookmarkOnly ? " bookmarked" : ""} problems in this sheet.
              </>
            ) : (
              <>No problems match &ldquo;{searchQuery}&rdquo;</>
            )}
          </div>
        )}
      </div>
        </div>

        {/* Sticky right progress rail (xl and up). The sticky offset matches the
            Container's top padding (sm:py-12 = 3rem) so the rail is already at its
            pinned position at scroll 0 — no initial drift. Scrolls internally only
            if it ever exceeds the viewport height. */}
        <aside className="sticky top-12 hidden h-fit max-h-[calc(100vh-4rem)] overflow-y-auto xl:block xl:w-[360px] xl:shrink-0">
          <SheetStats
            variant="rail"
            difficulty={diffStat}
            activity={activity}
            greetingName={greetingName}
          />
        </aside>
      </div>
    </SheetPositionContext.Provider>
    </SheetBookmarkContext.Provider>
    </SheetSolvedContext.Provider>
  );
}
