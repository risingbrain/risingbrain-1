"use client";

import { apiFetch } from "@/lib/api-fetch";

/**
 * Refresh the navbar streak flame from the server's AUTHORITATIVE value after
 * the user records activity (solving a problem, submitting an aptitude test),
 * so it updates without a page reload — and can't drift from an optimistic
 * client-side estimate.
 *
 * Fetches `/api/streak` (per-user, never cached) and broadcasts the result via
 * the same `rb:streak-updated` event the badge already listens for. Best-effort:
 * a failed refresh leaves whatever the badge already shows.
 */
export async function refreshStreakBadge(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const res = await apiFetch("/api/streak", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { streak: number | null };
    if (typeof data.streak === "number") {
      window.dispatchEvent(new CustomEvent("rb:streak-updated", { detail: { streak: data.streak } }));
    }
  } catch {
    /* transient — the badge keeps its current value */
  }
}
