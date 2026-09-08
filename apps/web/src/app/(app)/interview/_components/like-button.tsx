"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Heart } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";

/**
 * Optimistic like toggle. Used both inside card links (where it must not
 * trigger navigation) and on the detail page. Signed-out users are bounced to
 * /login instead of firing the request.
 */
export function LikeButton({
  experienceId,
  initialLiked,
  initialCount,
  signedIn,
  size = "sm",
}: {
  experienceId: string;
  initialLiked: boolean;
  initialCount: number;
  signedIn: boolean;
  size?: "sm" | "lg";
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [pending, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);

  async function toggle(e: React.MouseEvent) {
    // Inside a card link: never let the click bubble into navigation.
    e.preventDefault();
    e.stopPropagation();
    if (!signedIn) {
      startTransition(() => router.push("/login"));
      return;
    }
    if (busy) return;

    // Optimistic flip, reconciled with the server's authoritative count.
    const prevLiked = liked;
    const prevCount = count;
    const nextLiked = !liked;
    setLiked(nextLiked);
    setCount((c) => c + (nextLiked ? 1 : -1));
    setBusy(true);
    try {
      const res = await apiFetch(`/api/interview/${experienceId}/like`, { method: "POST" });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { liked: boolean; likeCount: number };
      setLiked(data.liked);
      setCount(data.likeCount);
    } catch {
      // Roll back to the pre-click state on failure.
      setLiked(prevLiked);
      setCount(prevCount);
    } finally {
      setBusy(false);
    }
  }

  const lg = size === "lg";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={liked}
      aria-label={liked ? "Unlike" : "Like"}
      title={signedIn ? (liked ? "Unlike" : "Like") : "Sign in to like"}
      disabled={pending}
      className={`group/like inline-flex items-center gap-1.5 rounded-full transition-colors ${
        lg ? "glass-pill px-4 py-2 text-sm" : "px-1 text-sm"
      } ${liked ? "text-rose-500 dark:text-rose-400" : "text-muted hover:text-rose-500"}`}
    >
      <Heart
        className={`${lg ? "h-5 w-5" : "h-4 w-4"} transition-transform group-active/like:scale-90 ${
          liked ? "fill-current" : ""
        }`}
      />
      <span className="tabular-nums font-medium">{count}</span>
    </button>
  );
}
