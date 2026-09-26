"use client";

import { useEffect, useRef, useState } from "react";

type CountUpProps = {
  /** Final numeric value to count up to. */
  value: number;
  /** Text appended after the number, e.g. "k+", "%", "+". */
  suffix?: string;
  /** Text placed before the number. */
  prefix?: string;
  /** Animation duration in ms. */
  duration?: number;
  className?: string;
};

/**
 * Counts a number up from zero when it first scrolls into view. Uses
 * requestAnimationFrame (the same technique already used elsewhere in the app)
 * and an easeOutCubic curve so it decelerates into the final value.
 *
 * Respects `prefers-reduced-motion`: jumps straight to the final value.
 */
export function CountUp({
  value,
  suffix = "",
  prefix = "",
  duration = 1100,
  className = "",
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [display, setDisplay] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    const run = () => {
      if (started.current) return;
      started.current = true;

      if (reduce || typeof requestAnimationFrame === "undefined") {
        setDisplay(value);
        return;
      }

      let start: number | null = null;
      const step = (ts: number) => {
        if (start === null) start = ts;
        const p = Math.min((ts - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        setDisplay(Math.round(value * eased));
        if (p < 1) requestAnimationFrame(step);
        else setDisplay(value);
      };
      requestAnimationFrame(step);
    };

    if (typeof IntersectionObserver === "undefined") {
      run();
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          run();
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [value, duration]);

  // The animated digits start at 0, which is also what the server HTML would
  // contain — so crawlers and screen readers used to read "0 problems". The
  // final value rides along as sr-only text; the animation is aria-hidden.
  return (
    <span ref={ref} className={className}>
      <span className="sr-only">
        {prefix}
        {value.toLocaleString()}
        {suffix}
      </span>
      <span aria-hidden>
        {prefix}
        {display.toLocaleString()}
        {suffix}
      </span>
    </span>
  );
}
