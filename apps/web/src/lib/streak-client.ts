"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api-fetch";

/**
 * The live activity snapshot, client side.
 *
 * ONE WRITER, ONE DEFINITION. Every streak/heatmap display on the page reads the
 * value the SERVER computed, refreshed here after each write. Displays used to
 * estimate their own updates from local state and it went wrong in both
 * directions: the navbar flame was knocked down to a DSA-only count on every
 * solve, and today's calendar square went DOWN when the user un-ticked a problem
 * they had solved a month earlier. The browser cannot do this arithmetic
 * correctly — the sheet page ships no `solvedAt`, so it cannot tell a solve made
 * today from one made last year. So it doesn't try.
 */

const ACTIVITY_EVENT = "rb:activity-updated";

export type ActivitySnapshot = {
  streak: number;
  todayCount: number;
  todayDsaCount: number;
};

/** Subscribe to snapshot updates, seeding from the server-rendered value. */
function useSnapshotField<T>(initial: T, pick: (s: ActivitySnapshot) => T): T {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    const handler = (e: Event) => setValue(pick((e as CustomEvent<ActivitySnapshot>).detail));
    window.addEventListener(ACTIVITY_EVENT, handler);
    return () => window.removeEventListener(ACTIVITY_EVENT, handler);
    // `pick` is a literal at every call site; re-subscribing on it would churn
    // the listener on each render for no gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return value;
}

/** The streak flame's number — the navbar badge and the sheet calendar badge. */
export function useLiveStreak(initial: number): number {
  return useSnapshotField(initial, (s) => s.streak);
}

/** DSA solves logged today. Drives today's square on the sheet calendar. */
export function useLiveTodayDsaCount(initial: number): number {
  return useSnapshotField(initial, (s) => s.todayDsaCount);
}

/**
 * Pull the authoritative snapshot and broadcast it, after the user records
 * activity (solving a problem, submitting a test) so every display updates
 * without a page reload.
 *
 * Best-effort: a failed refresh leaves whatever is already on screen. Fetches
 * `/api/streak`, which is per-user and never cached.
 */
export async function refreshActivity(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const res = await apiFetch("/api/streak", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as Partial<ActivitySnapshot> & { streak: number | null };
    if (typeof data.streak !== "number") return;

    const detail: ActivitySnapshot = {
      streak: data.streak,
      todayCount: data.todayCount ?? 0,
      todayDsaCount: data.todayDsaCount ?? 0,
    };
    window.dispatchEvent(new CustomEvent(ACTIVITY_EVENT, { detail }));
  } catch {
    /* transient — the displays keep their current values */
  }
}
