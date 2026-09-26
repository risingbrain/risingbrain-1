"use client";

import { useEffect } from "react";
import { AUTH_RECOVER_COOKIE } from "@/lib/auth/constants";

/**
 * Silently rotates the access token in the background while the user is active,
 * so it never expires mid-session. Mounted only when a session cookie is present
 * (see RootLayout). Stops pinging once the session is gone (401).
 *
 * `stale` means the server saw a refresh cookie but no usable access token — the
 * session is recoverable and needs renewing NOW, not in 12 minutes. The edge proxy
 * normally repairs this before the page renders; this covers what it can't (a
 * request it doesn't match, a non-GET entry, a rotate whose cookie didn't stick)
 * so a signed-in user is never left looking logged out for a whole interval.
 *
 * EVERY rotation here is a real refresh-token rotation, so uncoordinated pings are
 * not free: each one invalidates the token the other tabs (and the edge proxy's
 * in-flight bounce) are holding. This used to fire on every single tab focus, in
 * every tab, which meant a user alt-tabbing between two tabs generated a steady
 * stream of rotation races — survivable only because of the rotation grace window,
 * and a hard logout whenever that window was unavailable. So the work is gated
 * twice: a `localStorage` timestamp shared by every tab decides whether a rotation
 * is DUE at all, and a Web Lock makes sure only one tab performs it.
 */

/** How long an access token is left alone before we renew it (TTL is 15m). */
const REFRESH_INTERVAL_MS = 12 * 60 * 1000;
/** Cheap wall-clock check; the network call is gated by the timestamps above. */
const TICK_MS = 60 * 1000;

/** Per-tab latch so a recovery reload can never become a reload loop. */
const RELOADED_KEY = "rb:session-recovered";
/** Cross-tab: when any tab last completed a rotation. */
const LAST_REFRESH_KEY = "rb:session-refreshed-at";
/** Cross-tab: only the holder may rotate. */
const LOCK_NAME = "rb:session-refresh";

function lastRefreshAt(): number {
  try {
    return Number(localStorage.getItem(LAST_REFRESH_KEY)) || 0;
  } catch {
    return 0; // private mode / storage disabled — degrade to per-tab behaviour
  }
}

function markRefreshed() {
  try {
    localStorage.setItem(LAST_REFRESH_KEY, String(Date.now()));
  } catch {
    /* ignore */
  }
}

type Outcome =
  /** Rotated; cookies are fresh. */
  | "ok"
  /** The refresh token is genuinely dead — stop pinging. */
  | "expired"
  /** Not due, or another tab is doing it. */
  | "skipped"
  /** Offline, or the store was unavailable (503) — stay armed and retry. */
  | "failed";

async function rotate(): Promise<Outcome> {
  try {
    const res = await fetch("/api/auth/refresh", { method: "POST", cache: "no-store" });
    if (res.ok) {
      markRefreshed();
      return "ok";
    }
    // Only a 401 is a verdict. A 503 means the session store couldn't be reached,
    // which says nothing about whether the session is still good.
    return res.status === 401 ? "expired" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Rotate at most once across every open tab. `minGapMs` is how recently another
 * tab must have rotated for this call to be unnecessary.
 */
async function rotateOnce(minGapMs: number): Promise<Outcome> {
  const run = async (): Promise<Outcome> =>
    Date.now() - lastRefreshAt() < minGapMs ? "skipped" : rotate();

  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return run(); // Safari < 15.4 and friends: timestamp gate only

  // `ifAvailable` so a tab that loses the lock returns immediately instead of
  // queueing up a redundant rotation behind the winner.
  const outcome = await locks.request(LOCK_NAME, { ifAvailable: true }, (lock) =>
    lock ? run() : Promise.resolve<Outcome>("skipped")
  );
  return outcome ?? "skipped";
}

/**
 * A renewal that is never skipped on the "renewed recently" timestamp — that
 * stamp is also set as a baseline when a tab first loads, so gating recovery on
 * it (as `rotateOnce` does) returned "skipped" without renewing anything, and
 * the page reloaded still signed-out. Here the cross-tab lock is WAITED for
 * (not `ifAvailable`), and the network call is skipped only if another tab
 * actually completed a renewal after this one started waiting.
 */
async function rotateForRecovery(): Promise<Outcome> {
  const startedAt = Date.now();
  const run = (): Promise<Outcome> =>
    lastRefreshAt() >= startedAt ? Promise.resolve<Outcome>("skipped") : rotate();
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return run();
  return (await locks.request(LOCK_NAME, run)) ?? "failed";
}

/**
 * Recovery backoff while the server says a page was rendered signed-out for a
 * possibly-live session (see AUTH_RECOVER_COOKIE). Front-loaded because the
 * usual cause is a store still waking up; then settles to one try a minute.
 */
const RECOVERY_BACKOFF_MS = [0, 2_000, 5_000, 10_000, 20_000, 40_000, 60_000];

function hasRecoverMarker(): boolean {
  return document.cookie.split("; ").some((c) => c.startsWith(`${AUTH_RECOVER_COOKIE}=`));
}

function clearRecoverMarker() {
  document.cookie = `${AUTH_RECOVER_COOKIE}=; Max-Age=0; Path=/`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function untilVisible(): Promise<void> {
  if (document.visibilityState === "visible") return Promise.resolve();
  return new Promise((resolve) => {
    const on = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", on);
      resolve();
    };
    document.addEventListener("visibilitychange", on);
  });
}

/**
 * How often to look for the server's recovery flag. A local string read — no
 * network — so it can be frequent. Polled rather than checked "after each
 * navigation" because there is no reliable moment for that: with a loading
 * skeleton the router switches the URL before the page request is even sent,
 * so the flag (set on that response) arrives only afterwards.
 */
const FLAG_POLL_MS = 1_000;

/** One recovery loop per tab, however many triggers fire. */
let recovering = false;

/**
 * The page on screen was rendered without the visitor's identity (the renewal
 * that should have preceded it couldn't reach the session store, or the tab
 * rendered after its access cookie lapsed). Keep renewing until the store gives
 * a verdict, then reload ONCE so the navbar and the page are redrawn together
 * from the real session state:
 *
 *  - renewed ("ok"), or another tab already did ("skipped") → signed in again;
 *  - the session is genuinely gone ("expired") → consistently signed out,
 *    instead of a stale signed-in navbar over a signed-out page.
 *
 * A reload (not `router.refresh()`) on purpose: client state seeded from the
 * signed-out render — the sheet's solved set, the domain/screening progress
 * providers — only re-seeds on a fresh mount.
 *
 * Loop-proof: the per-tab latch is set before reloading and only cleared by a
 * render that needed no recovery, so a renewal whose cookie never sticks costs
 * one reload, not an endless cycle.
 */
async function recoverSession(isStopped: () => boolean) {
  if (recovering) return;
  recovering = true;
  try {
    for (let attempt = 0; !isStopped(); attempt++) {
      const wait = RECOVERY_BACKOFF_MS[Math.min(attempt, RECOVERY_BACKOFF_MS.length - 1)]!;
      if (wait) await sleep(wait);
      // Don't burn attempts (or reload) in a hidden tab; pick up on return.
      await untilVisible();
      if (isStopped()) return;

      const outcome = await rotateForRecovery();
      if (outcome === "failed") continue; // store still unreachable — back off

      const flagged = hasRecoverMarker();
      clearRecoverMarker();
      // Session gone and nothing on screen claims otherwise (a full page load
      // already rendered the navbar signed-out too) — nothing to redraw.
      if (outcome === "expired" && !flagged) return;
      if (sessionStorage.getItem(RELOADED_KEY)) return; // already redrew for this lapse
      sessionStorage.setItem(RELOADED_KEY, "1");
      window.location.reload();
      return;
    }
  } finally {
    recovering = false;
  }
}

export function SessionKeepAlive({ stale = false }: { stale?: boolean }) {
  useEffect(() => {
    let stopped = false;
    let unmounted = false;
    const isStopped = () => stopped || unmounted;

    if (!stale && !hasRecoverMarker()) {
      // Rendered with a healthy session: arm the latch again so a lapse later in
      // this tab's life still gets its one recovery reload.
      sessionStorage.removeItem(RELOADED_KEY);
      // First tab of a new browser session — start the clock from "we are known
      // good right now", so simply focusing the tab doesn't rotate immediately.
      if (lastRefreshAt() === 0) markRefreshed();
    } else {
      // Rendered without the visitor's identity although a session cookie is
      // present — the refresh cookie survived but the access cookie had lapsed,
      // or the server flagged a renewal it couldn't complete. Recover now rather
      // than on the next 12-minute tick.
      void recoverSession(isStopped);
    }

    // A short tick reading a cheap timestamp, rather than a 12-minute timer:
    // browsers throttle timers in background tabs, so a long interval silently
    // drifts past the access token's expiry.
    const tick = () => {
      if (isStopped() || document.visibilityState !== "visible") return;
      void rotateOnce(REFRESH_INTERVAL_MS).then((outcome) => {
        if (outcome === "expired") stopped = true;
      });
    };

    const interval = setInterval(tick, TICK_MS);
    // In-app navigation re-renders the page but not this (persistent) shell, so
    // the only sign that a page came back signed-out is the server's flag.
    const watch = setInterval(() => {
      if (!unmounted && hasRecoverMarker()) void recoverSession(() => unmounted);
    }, FLAG_POLL_MS);
    // Returning to a backgrounded tab is the most likely moment to be near
    // expiry — check immediately on re-focus (the gate decides if it's due), and
    // pick up any recovery flagged while the tab was away.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (hasRecoverMarker()) void recoverSession(isStopped);
      else tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      stopped = true;
      unmounted = true;
      clearInterval(interval);
      clearInterval(watch);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [stale]);

  return null;
}
