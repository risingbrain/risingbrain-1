"use client";

import { useMemo, useState, type SVGProps } from "react";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { useLiveStreak, useLiveTodayDsaCount } from "@/lib/streak-client";
import type { SheetActivity } from "../_data";

/**
 * Attractive month calendar for the DSA sheet hero — shows how active the user
 * has been solving sheet problems. Each day cell is tinted by how many problems
 * were solved that IST day; today is ringed; a flame badge tracks the live solve
 * streak. Pages back through the trailing months the server provided.
 *
 * Lives under the ProgressPanel in the hero's right rail. Both live numbers —
 * the streak and today's solve count — come from the SERVER via
 * `refreshActivity()`, never from local arithmetic; see `lib/streak-client.ts`
 * for why the browser cannot compute either of them correctly.
 */

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

// Tile color per activity level (rb-green-500 = #35a45c). A solved day is drawn as
// the logo tile filling the whole cell, so this is the tile's own fill and it is the
// only thing carrying the day's intensity — hence the ramp runs on alpha, letting the
// cell beneath show through on a quiet day and going fully saturated on a heavy one.
const BRAIN_COLOR = [
  "",
  "rgba(53,164,92,0.50)",
  "rgba(53,164,92,0.72)",
  "rgba(53,164,92,0.92)",
  "#35a45c",
] as const;

/**
 * The RisingBrain logo — the whole mark, tile included — for a day the user solved
 * something. It fills the day cell edge to edge, so the block IS the logo.
 *
 * This is `src/app/icon.svg` verbatim: the same 32x32 tile, the same `rx="7"` corner,
 * the same nine paths translated by (4,4), the same 2.4 stroke with round caps and
 * joins. Nothing is redrawn or simplified, so the calendar shows the actual logo
 * rather than a lookalike. (Note `<Brain />` from lucide-react is a DIFFERENT, newer
 * drawing with open lobes — it is not the brand mark, and it is what used to be here.)
 *
 * The one substitution: the tile's `fill="#35a45c"` becomes `currentColor`, so callers
 * tint it via `style={{ color }}` and the BRAIN_COLOR ramp carries the solve count. The
 * brain itself stays black, exactly as the logo draws it on every other surface.
 *
 * Because the cell is square and this viewBox is square, `rx="7"` resolves to 21.875%
 * of the cell — which is why the cell is given `rounded-[21.875%]` rather than the
 * `rounded-lg` the other day states use. Matching them keeps the corners flush, with
 * no cell background showing past the tile.
 */
function BrainMarkIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden {...props}>
      <rect width="32" height="32" rx="7" fill="currentColor" />
      <g
        transform="translate(4 4)"
        fill="none"
        stroke="#000000"
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
        <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
        <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4" />
        <path d="M17.599 6.5a3 3 0 0 0 .399-1.375" />
        <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5" />
        <path d="M3.477 10.896a4 4 0 0 1 .585-.396" />
        <path d="M19.938 10.5a4 4 0 0 1 .585.396" />
        <path d="M6 18a4 4 0 0 1-1.967-.516" />
        <path d="M19.967 17.484A4 4 0 0 1 18 18" />
      </g>
    </svg>
  );
}

/** Exact Twemoji 😢 crying face (U+1F622) — pixel-faithful recreation. */
function RegretFace() {
  return (
    <svg viewBox="0 0 36 36" className="w-full h-full" xmlns="http://www.w3.org/2000/svg">
      {/* face */}
      <path fill="#FFCC4D" d="M36 18c0 9.941-8.059 18-18 18-9.94 0-18-8.059-18-18C0 8.06 8.06 0 18 0c9.941 0 18 8.06 18 18"/>
      {/* eyes */}
      <ellipse fill="#664500" cx="11.5" cy="17" rx="2.5" ry="3.5"/>
      <ellipse fill="#664500" cx="24.5" cy="17" rx="2.5" ry="3.5"/>
      {/* brows + mouth */}
      <path fill="#664500" d="M5.999 13.5c-.208 0-.419-.065-.599-.2-.442-.331-.531-.958-.2-1.4 3.262-4.35 7.616-4.4 7.8-4.4.552 0 1 .448 1 1 0 .551-.445.998-.996 1-.155.002-3.568.086-6.204 3.6-.196.262-.497.4-.801.4zm24.002 0c-.305 0-.604-.138-.801-.4-2.641-3.521-6.061-3.599-6.206-3.6-.55-.006-.994-.456-.991-1.005.003-.551.447-.995.997-.995.184 0 4.537.05 7.8 4.4.332.442.242 1.069-.2 1.4-.18.135-.39.2-.599.2zm-6.516 14.879C23.474 28.335 22.34 24 18 24s-5.474 4.335-5.485 4.379c-.053.213.044.431.232.544.188.112.433.086.596-.06C13.352 28.855 14.356 28 18 28c3.59 0 4.617.83 4.656.863.095.09.219.137.344.137.084 0 .169-.021.246-.064.196-.112.294-.339.239-.557z"/>
      {/* teardrop */}
      <path fill="#5DADEC" d="M16 31c0 2.762-2.238 5-5 5s-5-2.238-5-5 4-10 5-10 5 7.238 5 10z"/>
    </svg>
  );
}

// Mirror of the server's intensity bucketing (kept local so this client
// component never imports the prisma-backed `_data` module at runtime).
function levelFor(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

function prettyDate(key: string) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function SheetCalendar({ activity }: { activity: SheetActivity }) {
  const { months } = activity;
  const lastIdx = months.length - 1;
  const [idx, setIdx] = useState(lastIdx);
  const isCurrentMonth = idx === lastIdx;
  const month = months[idx]!;

  // Today's solve count, authoritative. Seeded from the server-rendered cell and
  // replaced whenever `refreshActivity()` reports a new one.
  //
  // This REPLACES a `todayDelta` prop that was `solvedIds.size` minus the page's
  // initial solved total — a session-wide net across every problem, applied as
  // though it were today's. Un-ticking a problem solved last month therefore
  // dropped today's square, and solving then un-ticking one today left the square
  // at zero while the server had (correctly, it is append-only) banked the day.
  // The page ships no `solvedAt`, so the browser has no way to tell those apart.
  const ssrToday = months[lastIdx]?.cells.find((c) => c.isToday)?.count ?? 0;
  const todayCount = useLiveTodayDsaCount(ssrToday);

  const { cells, activeDays, solved } = useMemo(() => {
    let activeDays = 0;
    let solved = 0;
    const cells = month.cells.map((c) => {
      const count = isCurrentMonth && c.isToday ? todayCount : c.count;
      if (count > 0) {
        activeDays += 1;
        solved += count;
      }
      return { ...c, count, level: c.future ? 0 : levelFor(count) };
    });
    return { cells, activeDays, solved };
  }, [month, isCurrentMonth, todayCount]);

  // Live streak, straight from the server. This used to be derived locally from
  // `todayDelta`, which was wrong in both directions — `todayDelta` is a
  // whole-session net across every problem, so un-ticking one solved last month
  // retracted today's streak, and the base it adjusted was DSA-only. The value
  // now counts practice anywhere on the site and is refreshed by
  // `refreshActivity()` after each toggle, so this badge and the navbar flame
  // are always the same number.
  const streak = useLiveStreak(activity.currentStreak);

  return (
    <div className="mx-auto w-full min-w-0 max-w-[22rem] flex-1 lg:mx-0">
      {/* Header: live streak badge + month pager */}
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            className={`grid h-9 w-9 place-items-center rounded-xl transition-colors ${
              streak > 0
                ? "bg-rb-green-500/15 text-brand ring-1 ring-inset ring-rb-green-500/30"
                : "bg-surface-2 text-muted"
            }`}
          >
            <Flame className="h-[18px] w-[18px]" />
          </span>
          <div className="leading-tight">
            <div className="text-lg font-bold tabular-nums text-foreground">
              {streak}
              <span className="ml-1 text-xs font-medium text-muted">
                day{streak === 1 ? "" : "s"}
              </span>
            </div>
            <div className="text-[11px] font-medium text-muted">solve streak</div>
          </div>
        </div>

        <div className="glass-pill flex items-center gap-0.5 rounded-xl p-0.5">
          <button
            type="button"
            onClick={() => setIdx((i) => Math.max(0, i - 1))}
            disabled={idx === 0}
            aria-label="Previous month"
            className="grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[6.5rem] text-center text-sm font-semibold text-foreground">
            {month.label}
          </span>
          <button
            type="button"
            onClick={() => setIdx((i) => Math.min(lastIdx, i + 1))}
            disabled={isCurrentMonth}
            aria-label="Next month"
            className="grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-muted"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Weekday header */}
      <div className="mb-1 grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w, i) => (
          <div
            key={i}
            className="text-center text-[10px] font-semibold uppercase tracking-wide text-muted/80"
          >
            {w}
          </div>
        ))}
      </div>

      {/* Day grid — emoji fills each square cell */}
      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: month.leading }).map((_, i) => (
          <div key={`pad-${i}`} aria-hidden />
        ))}
        {cells.map((c) => {
          // A solved day is the logo tile, edge to edge — so it drops the inset
          // padding and takes the mark's own corner radius instead of `rounded-lg`.
          // Every other state stays an inset chip inside a rounded cell, which is
          // what makes an active day read as solid and a missed one as empty.
          const solved = !c.future && c.count > 0;
          return (
            <div
              key={c.key}
              title={
                c.future
                  ? prettyDate(c.key)
                  : c.count === 0
                    ? `No solves on ${prettyDate(c.key)}`
                    : `${c.count} solved on ${prettyDate(c.key)}`
              }
              className={`relative aspect-square transition-all ${
                solved ? "rounded-[21.875%]" : "rounded-lg p-[2px]"
              } ${
                c.future
                  ? "opacity-25"
                  : `bg-surface-2/50 ring-1 ring-inset ring-border/30 hover:scale-[1.08] ${
                      c.isToday ? "ring-2 ring-rb-green-300" : ""
                    }`
              }`}
            >
              {c.future ? (
                /* future days: show the date number so the calendar remains navigable */
                <div className="flex h-full items-center justify-center">
                  <span className="text-[10px] font-semibold tabular-nums text-muted">{c.day}</span>
                </div>
              ) : solved ? (
                <BrainMarkIcon
                  className="h-full w-full"
                  style={{ color: BRAIN_COLOR[c.level] }}
                />
              ) : c.key >= activity.joinedKey ? (
                /* past day with no solves, but account existed — show regret face,
                   inset so it reads as an empty day next to the solid logo tiles */
                <div className="flex h-full w-full items-center justify-center">
                  <div className="h-[70%] w-[70%]">
                    <RegretFace />
                  </div>
                </div>
              ) : null /* day before account was created — show nothing */}
            </div>
          );
        })}
      </div>

      {/* Footer: summary + brain-colour intensity legend */}
      <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2.5">
        <p className="text-xs text-muted">
          <span className="font-semibold text-foreground">{activeDays}</span> active{" "}
          {activeDays === 1 ? "day" : "days"} ·{" "}
          <span className="font-semibold text-foreground">{solved}</span> solved
        </p>
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted/80">
          <span>Less</span>
          <div className="flex items-center gap-1">
            {([1, 2, 3, 4] as const).map((level) => (
              /* Squares, matching the logo tile's corner — the legend shows the same
                 shape the grid does. */
              <span
                key={level}
                className="h-3 w-3 rounded-[21.875%] ring-1 ring-inset ring-border/30"
                style={{ background: BRAIN_COLOR[level] }}
              />
            ))}
          </div>
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
