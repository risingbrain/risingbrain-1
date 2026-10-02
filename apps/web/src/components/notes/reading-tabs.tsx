"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { BookOpen, Hammer, PenLine } from "lucide-react";

/**
 * The Notes | Practice [| Mini Project] switch, shared by Domain topics and
 * Screening papers.
 *
 * The two sections had a byte-for-byte copy of this each — same sliding pill,
 * same panels, same geometry comment — which is two places to fix a tab bug and
 * two places for the two surfaces to drift apart. They are the same control over
 * the same pair of panels, so they are one component now.
 *
 * Lands on **Notes** (theory, diagrams, worked examples) and flips to
 * **Practice** (the graded MCQs) — "first the notes, then the questions". Both
 * panels are rendered once and toggled with `hidden`, never unmounted, so an
 * in-flight attempt (selected options, verdicts) survives switching back and
 * forth. It sits inside each section's attempt provider, so the panels' client
 * children keep their context.
 *
 * A third tab, **Mini Project**, appears only when a `project` panel is passed —
 * a Domain topic with a hands-on design challenge (OOPS's Boss Challenges). It
 * comes last on purpose: read, test yourself, then build. Screening never passes
 * one, so its bar stays two-up.
 *
 * With only one panel's worth of content — a topic with no practice set, or a
 * Puzzles paper with no notes — the bar is omitted and that panel renders alone.
 *
 * The active tab is published through `ReadingTabProvider` because something
 * OUTSIDE this component needs it: the "On this page" rail lists the notes'
 * sections, and those sections are `hidden` while Practice is open — a contents
 * list pointing at nothing is worse than none, so the rail hides itself instead.
 */

export type ReadingTab = "notes" | "practice" | "project";

const ReadingTabContext = createContext<{
  tab: ReadingTab;
  setTab: (t: ReadingTab) => void;
} | null>(null);

/**
 * The active tab. Defaults to "notes" outside a provider — the safe answer, since
 * a page with no tab bar is showing its notes.
 */
export function useReadingTab(): ReadingTab {
  return useContext(ReadingTabContext)?.tab ?? "notes";
}

export function ReadingTabProvider({
  children,
  initial = "notes",
}: {
  children: ReactNode;
  /** Screening's Puzzles have questions but no theory, so they open on Practice. */
  initial?: ReadingTab;
}) {
  const [tab, setTab] = useState<ReadingTab>(initial);
  return (
    <ReadingTabContext.Provider value={{ tab, setTab }}>{children}</ReadingTabContext.Provider>
  );
}

export function ReadingTabs({
  notes,
  practice,
  questionCount,
  project = null,
}: {
  notes: ReactNode | null;
  practice: ReactNode | null;
  questionCount: number;
  /** The "Mini Project" panel. Omitted (Screening, most Domain subjects) = no tab. */
  project?: ReactNode | null;
}) {
  const ctx = useContext(ReadingTabContext);
  const tab = ctx?.tab ?? "notes";
  const setTab = ctx?.setTab ?? (() => {});

  const panels: { id: ReadingTab; label: string; icon: ReactNode; body: ReactNode }[] = [];
  if (notes != null) {
    panels.push({ id: "notes", label: "Notes", icon: <BookOpen className="h-4 w-4" />, body: notes });
  }
  if (practice != null && questionCount > 0) {
    panels.push({
      id: "practice",
      label: `Practice · ${questionCount}`,
      icon: <PenLine className="h-4 w-4" />,
      body: practice,
    });
  }
  if (project != null) {
    panels.push({ id: "project", label: "Mini Project", icon: <Hammer className="h-4 w-4" />, body: project });
  }

  if (panels.length === 0) return null;
  if (panels.length === 1) return <>{panels[0]!.body}</>;

  // A tab that has no panel here (e.g. "project" on a topic without one) falls
  // back to the first, so the bar never shows nothing selected.
  const active = Math.max(
    0,
    panels.findIndex((p) => p.id === tab)
  );
  const n = panels.length;

  return (
    <>
      <div
        role="tablist"
        aria-label="Topic view"
        className="relative mb-6 inline-grid max-w-full rounded-xl bg-surface-2 p-1"
        style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}
      >
        {/* Sliding green pill marking the active tab. It's one element that
            translates between the cells rather than a background on each
            button, so the selection visibly *moves* instead of blinking. The
            grid is gapless with p-1, so a cell is exactly `100%/n - 0.5rem/n`
            wide, and translating by whole multiples of the pill's OWN width
            lands it precisely on cell k. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-1 left-1 rounded-lg bg-rb-green-500/15 shadow-[0_2px_10px_rgba(53,164,92,0.22)] ring-1 ring-inset ring-rb-green-500/35 transition-transform duration-300 ease-out motion-reduce:transition-none"
          style={{
            width: `calc((100% - 0.5rem) / ${n})`,
            transform: `translateX(${active * 100}%)`,
          }}
        />
        {panels.map((p, i) => (
          <TabButton
            key={p.id}
            active={i === active}
            onClick={() => setTab(p.id)}
            icon={p.icon}
            label={p.label}
          />
        ))}
      </div>

      {panels.map((p, i) => (
        <div key={p.id} role="tabpanel" hidden={i !== active}>
          {p.body}
        </div>
      ))}
    </>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative z-10 flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-semibold transition-colors sm:px-3.5 ${
        active ? "text-brand" : "text-muted hover:text-foreground"
      }`}
    >
      {/* `relative z-10` lifts the label above the absolutely-positioned pill —
          a positioned sibling would otherwise paint over static content.
          Icons drop below `sm`: three labelled tabs only fit a phone-width
          sheet as words alone. */}
      <span
        className={`hidden transition-transform duration-300 ease-out motion-reduce:transition-none sm:inline ${
          active ? "scale-110" : "scale-100"
        }`}
      >
        {icon}
      </span>
      {label}
    </button>
  );
}
