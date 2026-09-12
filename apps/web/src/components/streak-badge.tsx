"use client";

import { Flame } from "lucide-react";
import { useLiveStreak } from "@/lib/streak-client";

/**
 * Animated streak flame for the navbar.
 *  - Streak 0 (broken)  → a dull, grey, static flame.
 *  - As the streak grows, the flame warms (amber → orange → red), the glow
 *    intensifies and the flicker animation speeds up.
 */

type Tier = { color: string; glow: number; speed: number };

// index 0 is the "broken" state; 1..5 escalate with streak length.
const TIERS: Tier[] = [
  { color: "#9ca3af", glow: 0, speed: 0 }, // 0 — dull grey
  { color: "#fbbf24", glow: 5, speed: 2.2 }, // 1–2
  { color: "#f59e0b", glow: 8, speed: 1.8 }, // 3–6
  { color: "#fb923c", glow: 12, speed: 1.4 }, // 7–13
  { color: "#f97316", glow: 16, speed: 1.1 }, // 14–29
  { color: "#ef4444", glow: 22, speed: 0.85 }, // 30+
];

function tierFor(streak: number): number {
  if (streak <= 0) return 0;
  if (streak < 3) return 1;
  if (streak < 7) return 2;
  if (streak < 14) return 3;
  if (streak < 30) return 4;
  return 5;
}

export function StreakBadge({ streak: initialStreak }: { streak: number }) {
  const streak = useLiveStreak(initialStreak);

  const broken = streak <= 0;
  const t = TIERS[tierFor(streak)]!;

  const title = broken
    ? "Streak broken — practice today to start a new one"
    : `${streak}-day streak — keep it going!`;

  return (
    <div
      className={`glass-pill flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 ${
        broken ? "opacity-70" : ""
      }`}
      title={title}
      aria-label={title}
    >
      <style>{`
        @keyframes streak-flicker {
          0%, 100% { transform: scale(1) rotate(-2deg); filter: drop-shadow(0 0 var(--g) var(--c)); }
          40%      { transform: scale(1.12) rotate(2deg); filter: drop-shadow(0 0 calc(var(--g) * 1.7) var(--c)); }
          70%      { transform: scale(1.04) rotate(-1deg); filter: drop-shadow(0 0 calc(var(--g) * 1.2) var(--c)); }
        }
        @media (prefers-reduced-motion: reduce) {
          .streak-flame { animation: none !important; }
        }
      `}</style>

      <Flame
        className="streak-flame h-4 w-4"
        strokeWidth={2.25}
        style={
          {
            color: t.color,
            fill: broken ? "none" : t.color,
            "--g": `${t.glow}px`,
            "--c": t.color,
            filter: broken ? "none" : `drop-shadow(0 0 ${t.glow}px ${t.color})`,
            animation: broken ? "none" : `streak-flicker ${t.speed}s ease-in-out infinite`,
            transformOrigin: "center bottom",
          } as React.CSSProperties
        }
      />
      <span
        className="text-sm font-bold tabular-nums"
        style={{ color: broken ? undefined : t.color }}
      >
        {streak}
      </span>
    </div>
  );
}
