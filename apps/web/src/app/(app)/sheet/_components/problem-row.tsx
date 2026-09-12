"use client";

import { useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { DifficultyBadge } from "./difficulty-badge";
import { NoteModal } from "./note-modal";
import { useCelebrate } from "./celebration";
import { useReportSolved, useSheetBookmarkReport, useSheetSignedIn } from "./sheet-progress";
import { redirectToLogin } from "@/lib/auth/redirect";
import { persistJSON } from "@/lib/persist";
import { refreshStreakBadge } from "@/lib/streak-client";
import { logoSources } from "@/lib/company-logos";
import type { ProblemStatusValue, SheetProblem } from "./types";

const MAX_COMPANIES = 3;

/** LeetCode brand mark (single-path, inherits `currentColor`). */
function LeetCodeIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M13.483 0a1.374 1.374 0 0 0-.961.438L7.116 6.226l-3.854 4.126a5.266 5.266 0 0 0-1.209 2.104 5.35 5.35 0 0 0-.125.513 5.527 5.527 0 0 0 .062 2.362 5.83 5.83 0 0 0 .349 1.017 5.938 5.938 0 0 0 1.271 1.818l4.277 4.193.039.038c2.248 2.165 5.852 2.133 8.063-.074l2.396-2.392c.54-.54.54-1.414.003-1.955a1.378 1.378 0 0 0-1.951-.003l-2.396 2.392a3.021 3.021 0 0 1-4.205.038l-.02-.019-4.276-4.193c-.652-.64-.972-1.469-.948-2.263a2.68 2.68 0 0 1 .066-.523 2.545 2.545 0 0 1 .619-1.164L9.13 8.114c1.058-1.134 3.204-1.27 4.43-.063l3.501 3.444c.539.53 1.42.527 1.957-.01a1.378 1.378 0 0 0-.01-1.953l-3.501-3.443c-.585-.575-1.243-1.001-1.96-1.263l2.527-2.732a1.374 1.374 0 0 0-.011-1.892A1.374 1.374 0 0 0 13.483 0zm-2.866 12.815a1.38 1.38 0 0 0-1.38 1.382 1.38 1.38 0 0 0 1.38 1.382H20.79a1.38 1.38 0 0 0 1.38-1.382 1.38 1.38 0 0 0-1.38-1.382z" />
    </svg>
  );
}

/** GeeksforGeeks brand mark (single-path, inherits `currentColor`). */
function GfgIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M21.45 14.315c-.143.28-.334.532-.565.745a3.691 3.691 0 0 1-1.104.695 4.51 4.51 0 0 1-3.116-.016 3.79 3.79 0 0 1-2.135-2.078 3.571 3.571 0 0 1-.13-.353h7.418a4.26 4.26 0 0 1-.368 1.008zm-11.99-.654a3.793 3.793 0 0 1-2.134 2.078 4.51 4.51 0 0 1-3.117.016 3.7 3.7 0 0 1-1.104-.695 2.652 2.652 0 0 1-.564-.745 4.221 4.221 0 0 1-.368-1.006H9.59c-.038.12-.08.238-.13.352zm14.501-1.758a3.849 3.849 0 0 0-.082-.475l-9.634-.008a3.932 3.932 0 0 1 1.143-2.348c.363-.35.79-.625 1.26-.809a3.97 3.97 0 0 1 4.484.957l1.521-1.49a5.7 5.7 0 0 0-1.922-1.357 6.283 6.283 0 0 0-2.544-.49 6.35 6.35 0 0 0-2.405.457 6.007 6.007 0 0 0-1.963 1.276 6.142 6.142 0 0 0-1.325 1.94 5.862 5.862 0 0 0-.466 1.864h-.063a5.857 5.857 0 0 0-.467-1.865 6.13 6.13 0 0 0-1.325-1.939A6 6 0 0 0 8.21 6.34a6.698 6.698 0 0 0-4.949.031A5.708 5.708 0 0 0 1.34 7.73l1.52 1.49a4.166 4.166 0 0 1 4.484-.958c.47.184.898.46 1.26.81.368.36.66.792.859 1.268.146.344.242.708.285 1.08l-9.635.008A4.714 4.714 0 0 0 0 12.457a6.493 6.493 0 0 0 .345 2.127 4.927 4.927 0 0 0 1.08 1.783c.528.56 1.17 1 1.88 1.293a6.454 6.454 0 0 0 2.504.457c.824.005 1.64-.15 2.404-.457a5.986 5.986 0 0 0 1.964-1.277 6.116 6.116 0 0 0 1.686-3.076h.273a6.13 6.13 0 0 0 1.686 3.077 5.99 5.99 0 0 0 1.964 1.276 6.345 6.345 0 0 0 2.405.457 6.45 6.45 0 0 0 2.502-.457 5.42 5.42 0 0 0 1.882-1.293 4.928 4.928 0 0 0 1.08-1.783A6.52 6.52 0 0 0 24 12.457a4.757 4.757 0 0 0-.039-.554z" />
    </svg>
  );
}

/** YouTube brand mark (rounded badge + play triangle, inherits `currentColor`). */
function YouTubeIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  );
}

/** Bookmark ribbon — solid when saved, outlined otherwise. */
function BookmarkIcon({ filled, className = "" }: { filled: boolean; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M6 3.5h12a1 1 0 0 1 1 1V21l-7-4.2L5 21V4.5a1 1 0 0 1 1-1z" />
    </svg>
  );
}

/** Note — a document with text lines (dot accent indicates an existing note). */
function NoteIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h3.5" />
    </svg>
  );
}

/** A company monogram tile — used when no logo URL exists or the image fails. */
function CompanyMonogram({ name }: { name: string }) {
  return (
    <span
      title={name}
      aria-label={name}
      className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold uppercase text-muted ring-1 ring-border"
    >
      {name.charAt(0)}
    </span>
  );
}

/** A small company logo chip on a white tile (visible in light + dark). Walks a
 * favicon fallback chain derived from the brand domain and shows a monogram only
 * if every source fails (or no domain can be resolved). */
function CompanyChip({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  const sources = useMemo(() => logoSources(logoUrl), [logoUrl]);
  const [idx, setIdx] = useState(0);
  const current = sources[idx];

  if (!current) return <CompanyMonogram name={name} />;

  return (
    <span
      title={name}
      className="grid h-6 w-6 place-items-center overflow-hidden rounded-full bg-white ring-1 ring-border"
    >
      {/* Plain <img> on purpose: logos come from many external hosts, so we
          avoid next/image remotePatterns config. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        key={current}
        src={current}
        alt={name}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setIdx((i) => i + 1)}
        className="h-4 w-4 object-contain"
      />
    </span>
  );
}

/**
 * Always renders an icon slot. When `href` is provided it becomes a link with
 * full brand colour; when absent it renders as a dimmed, non-interactive span.
 */
function ResourceSlot({
  href,
  label,
  children,
}: {
  href: string | null | undefined;
  label: string;
  children: React.ReactNode;
}) {
  const base = "glass-pill grid h-8 w-8 place-items-center rounded-lg transition-all";
  if (href) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        title={label}
        className={`${base} hover:scale-105`}
      >
        {children}
      </a>
    );
  }
  return (
    <span
      title={`${label} — not available`}
      aria-hidden
      className={`${base} cursor-default opacity-20`}
    >
      {children}
    </span>
  );
}

/**
 * A single practice-sheet row: a true two-way solve toggle, title/reference,
 * difficulty, companies, resource links and a floating note editor.
 */
export function ProblemRow({
  problem,
  index,
  bookmarked,
  solved,
}: {
  problem: SheetProblem;
  index: number;
  // Live bookmark state, owned by SheetSelector's bookmarked-id set so it stays
  // the single source of truth (no divergence from a local copy across
  // filter-driven unmount/remount).
  bookmarked: boolean;
  // Live solved state, owned by SheetSelector's solvedIds set — the single
  // source of truth for both the checkmark and every derived count. Kept as a
  // prop (not local state) so a filter-driven remount can't reset it back to
  // the stale SSR snapshot while the totals stay updated.
  solved: boolean;
}) {
  const [toggling, setToggling] = useState(false);
  const [pop, setPop] = useState(false);
  const [hasNote, setHasNote] = useState(problem.hasNote);
  const [noteOpen, setNoteOpen] = useState(false);
  const [bookmarking, setBookmarking] = useState(false);
  const reportSolved = useReportSolved();
  const reportBookmark = useSheetBookmarkReport();
  const signedIn = useSheetSignedIn();
  const celebrate = useCelebrate();

  async function toggleBookmark() {
    if (!signedIn) { redirectToLogin(); return; }
    if (bookmarking) return;
    const next = !bookmarked;

    // Optimistic update — write straight to the source-of-truth set so the icon
    // and the "bookmarked only" filter both react instantly.
    reportBookmark(problem.id, next);
    setBookmarking(true);

    // Resilient write (retries + keepalive) so a slow/flaky network doesn't
    // silently drop it; revert only if the server never confirmed.
    const ok = await persistJSON("/api/sheet/bookmark", {
      problemId: problem.id,
      bookmarked: next,
    });
    if (!ok) reportBookmark(problem.id, !next);
    setBookmarking(false);
  }

  async function toggleStatus() {
    if (!signedIn) { redirectToLogin(); return; }
    if (toggling) return;

    // A true toggle derived from the CURRENT solved state.
    const nextSolved = !solved;
    const nextStatus: ProblemStatusValue = nextSolved ? "SOLVED" : "NOT_STARTED";

    // Optimistic: flip the single source of truth so the checkmark AND every
    // derived count (pattern/topic/sheet/difficulty/streak) move as one.
    reportSolved(problem.id, nextSolved);
    if (nextSolved) {
      setPop(true); // springy pop only when completing
      // Same centred confetti burst a cleared subcategory gets. Fired here rather
      // than from an effect so it lands on the click, not a render later; the
      // provider still lets a grander tier (pattern/topic/sheet) supersede it if
      // this same click happened to finish one.
      celebrate("problem");
    }
    setToggling(true);

    // One resilient request (retries + keepalive) — the write survives a slow
    // connection or a mid-request page refresh, so the DB and the UI stay in
    // agreement. Revert the optimistic flip only if it never confirmed.
    const ok = await persistJSON("/api/sheet/progress", {
      problemId: problem.id,
      status: nextStatus,
    });
    if (!ok) reportSolved(problem.id, solved);
    else void refreshStreakBadge(); // reconcile the flame with the authoritative streak
    setToggling(false);
  }

  const companies = problem.companies;
  const visible = companies.slice(0, MAX_COMPANIES);
  const overflow = companies.length - visible.length;

  return (
    <div
      className={`group/row transition-colors hover:bg-surface-2 ${
        solved ? "bg-rb-green-500/[0.04]" : ""
      }`}
    >
      <div className="flex items-center gap-3 px-3 py-4 sm:px-4 sm:py-5">
        {/* Status toggle — both directions */}
        <button
          type="button"
          onClick={toggleStatus}
          aria-pressed={solved}
          title={solved ? "Completed — click to undo" : "Mark complete"}
          aria-label={solved ? "Completed, click to mark as not started" : "Mark complete"}
          onAnimationEnd={() => setPop(false)}
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border transition-all ${
            pop ? "animate-solve" : ""
          } ${
            solved
              ? "border-rb-green-500 bg-rb-green-500 text-black hover:bg-rb-green-600"
              : "border-border text-transparent hover:border-rb-green-500/60 hover:text-rb-green-500/40"
          }`}
        >
          {toggling ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-muted" />
          ) : (
            <Check className="h-3.5 w-3.5" strokeWidth={3} />
          )}
        </button>

        {/* Index */}
        <span className="hidden w-6 shrink-0 text-right text-xs tabular-nums text-muted sm:block">
          {index}
        </span>

        {/* Title. The `reference` ("LC 167") badge that used to sit here was
            removed; `reference` is still loaded because search matches on it. */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {problem.leetcodeUrl ? (
            <a
              href={problem.leetcodeUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={`truncate text-base font-medium transition-colors hover:text-accent ${
                solved ? "text-muted line-through decoration-rb-green-500/50" : "text-foreground"
              }`}
            >
              {problem.title}
            </a>
          ) : (
            <span
              className={`truncate text-base font-medium ${
                solved ? "text-muted line-through decoration-rb-green-500/50" : "text-foreground"
              }`}
            >
              {problem.title}
            </span>
          )}
        </div>

        {/* Difficulty */}
        <div className="hidden shrink-0 sm:block">
          <DifficultyBadge difficulty={problem.difficulty} />
        </div>

        {/* Companies */}
        <div className="hidden shrink-0 items-center gap-1.5 md:flex">
          {visible.map((c) => (
            <CompanyChip key={c.name} name={c.name} logoUrl={c.logoUrl} />
          ))}
          {overflow > 0 && (
            <span className="grid h-6 w-6 place-items-center rounded-full bg-surface-2 text-[10px] font-semibold text-muted ring-1 ring-border">
              +{overflow}
            </span>
          )}
        </div>

        {/* Resource links — always shown; dimmed when the URL is unavailable */}
        <div className="flex shrink-0 items-center gap-1">
          <ResourceSlot href={problem.leetcodeUrl} label="Open on LeetCode">
            <LeetCodeIcon className={`h-3.5 w-3.5 ${problem.leetcodeUrl ? "text-[#FFA116]" : "text-muted"}`} />
          </ResourceSlot>
          <ResourceSlot href={problem.gfgUrl} label="Open on GeeksforGeeks">
            <GfgIcon className={`h-4 w-4 ${problem.gfgUrl ? "text-[#2F8D46]" : "text-muted"}`} />
          </ResourceSlot>
          <ResourceSlot href={problem.youtubeUrl} label="Watch the walkthrough">
            <YouTubeIcon className={`h-4 w-4 ${problem.youtubeUrl ? "text-[#FF0000]" : "text-muted"}`} />
          </ResourceSlot>

          {/* Bookmark toggle */}
          <button
            type="button"
            onClick={toggleBookmark}
            aria-pressed={bookmarked}
            aria-label={bookmarked ? "Remove bookmark" : "Bookmark"}
            title={bookmarked ? "Remove bookmark" : "Bookmark for later"}
            className={`glass-pill grid h-8 w-8 place-items-center rounded-lg transition-all hover:scale-105 ${
              bookmarked ? "text-accent" : "text-muted hover:text-accent"
            }`}
          >
            <BookmarkIcon filled={bookmarked} className="h-4 w-4" />
          </button>

          {/* Note trigger */}
          <button
            type="button"
            onClick={() => { if (!signedIn) { redirectToLogin(); return; } setNoteOpen(true); }}
            aria-label={hasNote ? "Edit note" : "Add note"}
            title={hasNote ? "Edit note" : "Add note"}
            className={`glass-pill relative grid h-8 w-8 place-items-center rounded-lg transition-all hover:scale-105 ${
              hasNote ? "text-accent" : "text-muted hover:text-accent"
            }`}
          >
            <NoteIcon className="h-4 w-4" />
            {hasNote && (
              <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-rb-green-500 ring-2 ring-background" />
            )}
          </button>
        </div>
      </div>

      {noteOpen && (
        <NoteModal
          problemId={problem.id}
          title={problem.title}
          onClose={() => setNoteOpen(false)}
          onSaved={(exists) => setHasNote(exists)}
        />
      )}
    </div>
  );
}
