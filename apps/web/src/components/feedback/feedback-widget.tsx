"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { MessageSquarePlus, X } from "lucide-react";
import type { FeedbackQuota } from "@/lib/feedback";
import { FeedbackPanel } from "./feedback-panel";
import { RatingStars } from "./rating-stars";
import { apiFetch } from "@/lib/api-fetch";

/**
 * The floating "send feedback" button, plus the one-time nudge that asks for a
 * first impression.
 *
 * Mounted once by the signed-in app shell rather than per page, so the way to
 * report a broken page is always in the same corner of the screen — that is the
 * point of the shape: a fixed circular target the eye stops having to look for
 * after the first time.
 *
 * The nudge is the other half. Nobody clicks an unprompted feedback button, and
 * asking on arrival gets you an opinion about a page someone has looked at for
 * four seconds. So it waits for evidence that they have actually USED the
 * product (see `useExploredEnough`), asks once, and then never asks again.
 */
export function FeedbackWidget({ userId }: { userId: string }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  /** Star clicked on the nudge, carried into the panel so it isn't asked twice. */
  const [seedRating, setSeedRating] = useState(0);

  // The admin surface has its own inbox for exactly this content, and its
  // managers already fill the bottom-right corner with their own controls.
  const suppressed = pathname.startsWith("/admin");

  const { nudging, retire } = useOneTimeNudge(userId, suppressed || open);

  const openPanel = useCallback(
    (rating: number) => {
      setSeedRating(rating);
      setOpen(true);
      // Opening the panel answers the nudge either way — leaving it up behind a
      // modal it launched would ask the same question twice.
      retire();
    },
    [retire],
  );

  if (suppressed) return null;

  return (
    <>
      {nudging && <NudgeCard onPick={openPanel} onDismiss={retire} />}

      <button
        type="button"
        onClick={() => openPanel(0)}
        aria-label="Send feedback"
        title="Send feedback"
        className="btn-glow group fixed bottom-5 right-5 z-40 grid h-13 w-13 place-items-center rounded-full bg-rb-green-500 text-black shadow-lg shadow-rb-green-500/25 transition-transform hover:scale-105 active:scale-95 sm:bottom-6 sm:right-6"
      >
        {/* While the nudge is up the button is the thing being pointed at, so it
            carries the motion: one soft halo, no looping bounce. */}
        {nudging && (
          <span
            aria-hidden
            className="fb-ring absolute inset-0 animate-ping rounded-full bg-rb-green-500/40"
          />
        )}
        <MessageSquarePlus className={`relative h-5 w-5 ${nudging ? "fb-attention" : ""}`} />
        {/* Label on hover only — the button has to stay a circle at rest, so the
            name of the thing lives beside it rather than inside it. */}
        <span className="glass pointer-events-none absolute right-full mr-3 hidden whitespace-nowrap rounded-lg px-2.5 py-1.5 text-xs font-semibold text-foreground opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 sm:block">
          Send feedback
        </span>
      </button>

      {open && (
        <FeedbackPanel
          initialRating={seedRating}
          onClose={() => setOpen(false)}
          onSent={retire}
        />
      )}
    </>
  );
}

/**
 * The nudge itself: a card that rises out of the button it belongs to.
 *
 * It asks with STARS rather than a "give feedback" button, because a star is one
 * tap and a blank editor is a chore — and a tapped star is already a complete
 * answer, so the panel it opens is a chance to say more rather than the price of
 * being heard.
 */
function NudgeCard({
  onPick,
  onDismiss,
}: {
  onPick: (rating: number) => void;
  onDismiss: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="How is it going?"
      className="fb-nudge glass fixed bottom-24 right-5 z-40 w-[min(19rem,calc(100vw-2.5rem))] rounded-3xl p-4 shadow-xl sm:bottom-26 sm:right-6"
    >
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-lg text-muted transition-colors hover:text-foreground"
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <p className="pr-6 text-sm font-semibold text-foreground">
        How is RisingBrain going so far?
      </p>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        You&rsquo;ve been at it a while now — one tap tells us how it&rsquo;s working out. We
        only ask this once.
      </p>

      <div className="mt-3">
        <RatingStars value={0} onChange={onPick} size="lg" label="Rate RisingBrain" />
      </div>

      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          onClick={() => onPick(0)}
          className="text-xs font-medium text-accent transition-opacity hover:opacity-80"
        >
          Write something instead
        </button>
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs font-medium text-muted transition-colors hover:text-foreground"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// When to ask
// ---------------------------------------------------------------------------

/**
 * Active seconds on the site before the nudge is allowed to appear — 15 minutes.
 * Long enough that whoever answers has genuinely worked through something and
 * has an opinion worth having, rather than a reaction to a page they just
 * landed on.
 */
const EXPLORE_SECONDS = 15 * 60;
/** …and distinct pages visited. Time alone can just be an abandoned tab. */
const EXPLORE_PAGES = 3;
/** How often the timer ticks. Coarse on purpose — this is not a stopwatch. */
const TICK_MS = 15_000;

const seenKey = (userId: string) => `rb:feedback-nudge:${userId}`;
const PROGRESS_KEY = "rb:feedback-explore";

/**
 * "Has this person actually used the product yet?"
 *
 * Two signals, both required: time with the tab actually VISIBLE (a background
 * tab left open all afternoon is not exploration) and how many distinct pages
 * they have opened. Progress lives in `sessionStorage`, so a reload mid-session
 * doesn't reset the count, but a fresh visit next week starts the clock over
 * rather than firing the nudge on the first click.
 */
function useExploredEnough(paused: boolean): boolean {
  const pathname = usePathname();
  const [explored, setExplored] = useState(false);

  const read = () => {
    try {
      const raw = sessionStorage.getItem(PROGRESS_KEY);
      const parsed = raw ? (JSON.parse(raw) as { seconds?: number; paths?: string[] }) : null;
      return { seconds: parsed?.seconds ?? 0, paths: parsed?.paths ?? [] };
    } catch {
      return { seconds: 0, paths: [] as string[] };
    }
  };

  const write = (seconds: number, paths: string[]) => {
    try {
      sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ seconds, paths }));
    } catch {
      /* private mode / quota — the nudge simply never fires */
    }
  };

  // Count the page. Capped: we only need to know it passed EXPLORE_PAGES, and an
  // unbounded list would grow for the whole session.
  useEffect(() => {
    if (paused) return;
    const { seconds, paths } = read();
    const next = paths.includes(pathname) ? paths : [...paths, pathname].slice(0, EXPLORE_PAGES);
    write(seconds, next);
    if (seconds >= EXPLORE_SECONDS && next.length >= EXPLORE_PAGES) setExplored(true);
  }, [pathname, paused]);

  // Count the time.
  useEffect(() => {
    if (paused || explored) return;
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const { seconds, paths } = read();
      const next = seconds + TICK_MS / 1000;
      write(next, paths);
      if (next >= EXPLORE_SECONDS && paths.length >= EXPLORE_PAGES) setExplored(true);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [paused, explored]);

  return explored;
}

/**
 * The full "ask once" decision: explored enough (local), never asked before
 * (localStorage, per account) AND never actually sent feedback (server, because
 * a browser they have never used has no local record of it).
 *
 * `retire()` closes the question for good — it is called on dismiss, on opening
 * the panel, and on a successful send, so every path out of the nudge is final.
 */
function useOneTimeNudge(userId: string, paused: boolean): { nudging: boolean; retire: () => void } {
  const explored = useExploredEnough(paused);
  const [nudging, setNudging] = useState(false);
  const asked = useRef(false);

  const retire = useCallback(() => {
    setNudging(false);
    asked.current = true;
    try {
      localStorage.setItem(seenKey(userId), "1");
    } catch {
      /* private mode — worst case they see it once more next session */
    }
  }, [userId]);

  useEffect(() => {
    if (!explored || paused || asked.current) return;
    try {
      if (localStorage.getItem(seenKey(userId))) {
        asked.current = true;
        return;
      }
    } catch {
      /* unreadable storage: fall through to the server check, which is the
         authoritative half anyway */
    }

    asked.current = true; // one attempt per mount, whatever the answer
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/feedback");
        if (!res.ok) return;
        const quota = (await res.json()) as FeedbackQuota;
        // Someone who has already told us something doesn't get asked for a
        // first impression, and someone who is out of slots would only be shown
        // a wall — neither is a good moment to interrupt.
        if (!cancelled && !quota.hasEverSent && quota.remaining > 0) setNudging(true);
      } catch {
        /* offline — try again next session */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [explored, paused, userId]);

  return { nudging, retire };
}
