"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Trophy } from "lucide-react";

/**
 * Four escalating completion celebrations, all pure-CSS (no deps), rendered in a
 * single fixed portal overlay so they never affect layout and never block clicks:
 *
 *  - "problem" (one problem ticked off) → the same centred confetti burst as a
 *                                         cleared subcategory.
 *  - "pattern" (a subcategory cleared)  → a small confetti burst, centred.
 *  - "topic"  (a whole category done)  → a larger multicolour burst, centred.
 *  - "sheet"  (the entire sheet done)  → full-screen confetti rain + a trophy card.
 *
 * When one toggle completes several tiers at once (last problem finishes the
 * pattern AND the topic AND the sheet), the grandest tier wins — which is also
 * what keeps the per-problem fleck from firing alongside a real completion.
 */

type Variant = "problem" | "pattern" | "topic" | "sheet";

const RANK: Record<Variant, number> = { problem: 0, pattern: 1, topic: 2, sheet: 3 };
// How long the overlay stays mounted (ms) — must cover the longest animation.
// "problem" mirrors "pattern" because they render the identical burst.
const DURATION: Record<Variant, number> = {
  problem: 1500,
  pattern: 1500,
  topic: 2200,
  sheet: 3600,
};

const CelebrationContext = createContext<(variant: Variant) => void>(() => {});

export function useCelebrate() {
  return useContext(CelebrationContext);
}

/**
 * Fires `onComplete` only on a false→true transition of `isComplete` — never on
 * mount (so an already-finished item doesn't celebrate when it first renders).
 */
export function useCompletionEffect(isComplete: boolean, onComplete: () => void) {
  const prev = useRef(isComplete);
  const cb = useRef(onComplete);
  cb.current = onComplete;

  useEffect(() => {
    if (isComplete && !prev.current) cb.current();
    prev.current = isComplete;
  }, [isComplete]);
}

type Active = { variant: Variant; id: number };

export function CelebrationProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<Active | null>(null);
  const idRef = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const celebrate = useCallback((variant: Variant) => {
    setActive((cur) => {
      // Keep the grander celebration if one is already showing/queued this tick,
      // so a click that finishes the pattern (or topic, or sheet) as well as the
      // problem plays one burst at the grandest tier rather than several.
      if (cur && RANK[cur.variant] > RANK[variant]) return cur;
      idRef.current += 1;
      return { variant, id: idRef.current };
    });
  }, []);

  useEffect(() => {
    if (!active) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setActive(null), DURATION[active.variant]);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [active]);

  return (
    <CelebrationContext.Provider value={celebrate}>
      {children}
      <CelebrationOverlay active={active} />
    </CelebrationContext.Provider>
  );
}

function CelebrationOverlay({ active }: { active: Active | null }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !active) return null;
  // `key` remounts the burst each time so its CSS animations replay.
  return createPortal(
    <Celebration key={active.id} variant={active.variant} />,
    document.body
  );
}

const PALETTE = ["#35a45c", "#7fcf9c", "#1b6240", "#5ad17f", "#f5c451", "#ffffff"];

type Piece = {
  bg: string;
  size: number;
  delay: number;
  duration: number;
  rot: number;
  round: boolean;
  // burst
  tx?: number;
  ty?: number;
  // fall
  left?: number;
  drift?: number;
};

function makePieces(variant: Variant): Piece[] {
  if (variant === "sheet") {
    return Array.from({ length: 80 }, (_, i) => ({
      bg: PALETTE[i % PALETTE.length]!,
      size: 7 + Math.random() * 7,
      delay: Math.random() * 0.6,
      duration: 2 + Math.random() * 1.1,
      rot: Math.random() * 720 - 360,
      round: i % 3 === 0,
      left: Math.random() * 100,
      drift: Math.random() * 80 - 40,
    }));
  }

  // "problem" and "pattern" share one burst: ticking off a single question gets
  // the same celebration as clearing a subcategory.
  const count = variant === "topic" ? 32 : 18;
  const spread = variant === "topic" ? 340 : 190;
  return Array.from({ length: count }, (_, i) => {
    const angle = Math.random() * Math.PI * 2;
    const dist = spread * (0.3 + Math.random() * 0.7);
    return {
      bg: PALETTE[i % PALETTE.length]!,
      size: 7 + Math.random() * 6,
      delay: Math.random() * 0.08,
      duration: 0.9 + Math.random() * 0.5,
      rot: Math.random() * 540 - 270,
      round: i % 3 === 0,
      tx: Math.cos(angle) * dist,
      ty: Math.sin(angle) * dist - 50, // bias the spray upward
    };
  });
}

function Celebration({ variant }: { variant: Variant }) {
  const pieces = useMemo(() => makePieces(variant), [variant]);
  // Every burst is centred on the viewport; the overlay is `fixed inset-0`, so
  // these are plain percentages with no scroll maths.
  const burstLeft = "50%";
  const burstTop = variant === "topic" ? "50%" : "56%";

  return (
    <div className="pointer-events-none fixed inset-0 z-[120] overflow-hidden">
      <style>{`
        @keyframes rb-burst {
          0%   { transform: translate(-50%, -50%) translate(0, 0) rotate(0deg); opacity: 1; }
          100% { transform: translate(-50%, -50%) translate(var(--tx), var(--ty)) rotate(var(--rot)); opacity: 0; }
        }
        @keyframes rb-fall {
          0%   { transform: translateY(-12vh) translateX(0) rotate(0deg); opacity: 0; }
          8%   { opacity: 1; }
          100% { transform: translateY(112vh) translateX(var(--drift)) rotate(var(--rot)); opacity: 0.9; }
        }
        @keyframes rb-pop {
          0%   { transform: translate(-50%, -50%) scale(0.6); opacity: 0; }
          14%  { transform: translate(-50%, -50%) scale(1.08); opacity: 1; }
          82%  { transform: translate(-50%, -50%) scale(1); opacity: 1; }
          100% { transform: translate(-50%, -50%) scale(0.98); opacity: 0; }
        }
        @keyframes rb-glow {
          0%   { opacity: 0; transform: translate(-50%, -50%) scale(0.7); }
          25%  { opacity: 1; }
          100% { opacity: 0; transform: translate(-50%, -50%) scale(1.4); }
        }
        @media (prefers-reduced-motion: reduce) {
          .rb-celebrate [data-confetti] { display: none; }
        }
      `}</style>

      <div className="rb-celebrate absolute inset-0">
        {variant === "sheet" && (
          <div
            aria-hidden
            className="absolute left-1/2 top-1/2 h-[60vmin] w-[60vmin] rounded-full bg-rb-green-500/25 blur-3xl"
            style={{ animation: "rb-glow 3.4s ease-out forwards" }}
          />
        )}

        {pieces.map((p, i) => {
          const isFall = variant === "sheet";
          const style = isFall
            ? ({
                position: "absolute",
                top: 0,
                left: `${p.left}%`,
                width: p.size,
                height: p.round ? p.size : p.size * 0.55,
                background: p.bg,
                borderRadius: p.round ? "9999px" : "2px",
                "--drift": `${p.drift}px`,
                "--rot": `${p.rot}deg`,
                animation: `rb-fall ${p.duration}s linear ${p.delay}s forwards`,
              } as React.CSSProperties)
            : ({
                position: "absolute",
                left: burstLeft,
                top: burstTop,
                width: p.size,
                height: p.round ? p.size : p.size * 0.55,
                background: p.bg,
                borderRadius: p.round ? "9999px" : "2px",
                "--tx": `${p.tx}px`,
                "--ty": `${p.ty}px`,
                "--rot": `${p.rot}deg`,
                animation: `rb-burst ${p.duration}s cubic-bezier(.15,.6,.4,1) ${p.delay}s forwards`,
              } as React.CSSProperties);
          return <span key={i} data-confetti style={style} />;
        })}

        {variant === "sheet" && (
          <span
            className="absolute left-1/2 top-1/2 text-amber-400 drop-shadow-2xl"
            style={{ animation: "rb-pop 3.4s ease-out forwards" }}
          >
            <Trophy className="h-20 w-20 sm:h-28 sm:w-28" strokeWidth={1.5} />
          </span>
        )}
      </div>
    </div>
  );
}
