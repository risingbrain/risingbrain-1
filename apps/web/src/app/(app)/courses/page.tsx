import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import Link from "next/link";
import { BadgeCheck, GraduationCap, Layers, Users, Video } from "lucide-react";
import { Container } from "@/components/marketing/primitives";

export const metadata: Metadata = pageMetadata({
  title: "Courses — Coming soon",
  description:
    "Founder-led, structured video courses are on the way. Curated curriculum, hands-on modules and mentorship — launching soon on RisingBrain.",
  path: "/courses",
});

const HIGHLIGHTS = [
  { icon: Layers, label: "Structured curriculum" },
  { icon: Video, label: "Hands-on video modules" },
  { icon: Users, label: "Mentor support" },
  { icon: BadgeCheck, label: "Completion certificates" },
];

export default function CoursesPage() {
  return (
    /* Full-bleed coming-soon that fills the whole viewport.
       HEIGHT: the ambient background is `absolute inset-0`, so it is exactly as
       tall as this `<main>` — if main doesn't fill the screen, the glow stops
       short. `flex-1` alone only fills at `lg`, where the shell is
       `fixed inset-0` and so has a definite height to grow into. Below `lg` the
       shell is normal flow with no height, `flex-1` resolves to content height,
       and the background covered only the top ~3/4 of the screen. Hence the
       explicit min-height under lg (viewport minus the sticky mobile header),
       dropped again at lg where flex-1 does the job. `not-found.tsx` and
       `error.tsx` solve the same problem with a plain `min-h-screen`, which
       works there only because they render outside this shell.

       OVERFLOW: `overflow-hidden` deliberately lives on the ambient layer below,
       NOT here. On `main` it combined with `justify-center` to clip the heading
       on short viewports — centered content that outgrows its box spills past
       both edges, and with overflow hidden there was no way to scroll to it. */
    <main className="relative isolate flex min-h-[calc(100svh-4.25rem)] flex-1 flex-col items-center justify-center py-20 text-center lg:min-h-0">
      {/* Full-page ambient background */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 overflow-hidden"
      >
        {/* Glow sizes are PERCENTAGES of this layer, not fixed rem heights. The
            top glow used to be `h-[40rem]` — 640px — so on any viewport taller
            than that it simply stopped, leaving the bottom of the page flat.
            That was the "background only covers 3/4 of the page": main and this
            layer were both full height, but the glow inside them was not. */}
        <div className="absolute left-1/2 top-0 h-[70%] min-h-[30rem] w-[85%] min-w-[40rem] max-w-none -translate-x-1/2 rounded-full bg-rb-green-500/10 blur-3xl" />
        {/* `rb-green-600` is NOT a defined token (the scale is 900/800/700/500/
            400/300), so this blob previously rendered nothing at all and the
            bottom-left corner stayed dead. Uses 700 — the nearest real step. */}
        <div className="absolute -bottom-32 -left-24 h-[55%] min-h-[22rem] w-[55%] min-w-[22rem] rounded-full bg-rb-green-700/15 blur-3xl" />
        <div className="absolute -bottom-24 -right-24 h-[50%] min-h-[20rem] w-[50%] min-w-[20rem] rounded-full bg-rb-green-400/10 blur-3xl" />
        {/* Subtle dot grid, faded toward the edges. Mask pushed out to 90% so the
            dots survive nearer the bottom instead of vanishing at 75%. */}
        <div
          className="absolute inset-0 opacity-[0.35] [mask-image:radial-gradient(ellipse_at_center,black,transparent_90%)]"
          style={{
            backgroundImage:
              "radial-gradient(circle, color-mix(in oklab, var(--rb-green-500) 22%, transparent) 1px, transparent 1.5px)",
            backgroundSize: "26px 26px",
          }}
        />
      </div>

      {/* `Container tight` = the same responsive gutters every other signed-in
          page uses (px-4 → sm:px-5 → lg:px-6). This page previously hard-coded a
          flat `px-6`, so its content sat on different edges than /sheet,
          /screening, /domain and /interview at every breakpoint below lg. */}
      <Container tight>
        <div className="animate-in mx-auto flex w-full max-w-3xl flex-col items-center">
          <span className="grid h-20 w-20 place-items-center rounded-3xl bg-gradient-to-br from-rb-green-400/25 to-rb-green-600/10 text-accent ring-1 ring-rb-green-500/20">
            <GraduationCap className="h-9 w-9" />
          </span>

          <div className="mt-7">
            <span className="glass-pill inline-flex items-center rounded-full px-6 py-3 text-base font-semibold uppercase tracking-wide text-accent sm:text-lg">
              Coming soon
            </span>
          </div>

          <h1 className="mt-6 text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Courses are <span className="text-gradient">on the way</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted sm:text-lg">
            We&apos;re building founder-led, structured video courses — curated
            curriculum, hands-on modules and mentorship, all in the same focused
            RisingBrain experience. Sit tight, it&apos;s worth the wait.
          </p>

          {/* What's coming — fills the page with intent */}
          <ul className="stagger mt-9 flex flex-wrap items-center justify-center gap-2.5">
            {HIGHLIGHTS.map(({ icon: Icon, label }) => (
              <li
                key={label}
                className="glass-pill inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-foreground"
              >
                <Icon className="h-4 w-4 text-accent" />
                {label}
              </li>
            ))}
          </ul>

          <div className="mt-10 flex justify-center">
            <Link
              href="/sheet"
              className="btn-glow inline-flex items-center gap-2 rounded-2xl px-6 py-3 text-sm font-semibold"
            >
              Start with DSA Sheets
            </Link>
          </div>
        </div>
      </Container>
    </main>
  );
}
