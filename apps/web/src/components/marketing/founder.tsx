import Image from "next/image";
import { ExternalLink, Rocket, Users, type LucideIcon } from "lucide-react";
import { Container, Eyebrow, GlassCard } from "./primitives";
import { InstagramIcon, LinkedInIcon, YouTubeIcon } from "./brand-icons";
import { Reveal } from "@/components/motion/reveal";

/**
 * Brand colours, reusing the exact pair the Community cards use so LinkedIn
 * blue means one thing across the page.
 *
 * Each `accent` holds both states. At rest the icon takes the lightened brand
 * tone, because the true brand hex (#0a66c2 especially) goes muddy against a
 * frosted chip on a dark photo. The full-strength hex is saved for hover, where
 * it fills the chip and border with a white icon on top.
 */
const socials = [
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/company/risingbrain/",
    Icon: LinkedInIcon,
    accent: "text-[#5a96d8] hover:border-[#0a66c2] hover:bg-[#0a66c2] hover:text-white",
  },
  {
    label: "YouTube",
    href: "https://www.youtube.com/@rbanjalikumari",
    Icon: YouTubeIcon,
    accent: "text-[#e25555] hover:border-[#ff0000] hover:bg-[#ff0000] hover:text-white",
  },
  {
    label: "Instagram",
    href: "https://www.instagram.com/rbanjali.codes/",
    Icon: InstagramIcon,
    accent: "text-[#d1568a] hover:border-[#e1306c] hover:bg-[#e1306c] hover:text-white",
  },
];

/** Where she worked before RisingBrain — the section's strongest trust signal,
 *  so it gets its own labelled row rather than three 12px pills. */
const previously = ["Walmart Global Tech", "Morgan Stanley", "Nagarro"];

/**
 * Two metrics, not three.
 *
 * The third cell used to read "Top tech / Placements" — a phrase sitting in a
 * slot the other two fill with numbers, so the eye expects three figures and
 * finds two. A 2-up of real, sourced numbers reads stronger than a 3-up padded
 * with a label. If there's a genuine placement count, this goes back to three.
 */
const metrics: [LucideIcon, string, string][] = [
  [Users, "100+", "Mentored 1:1"],
  [Rocket, "450K+", "Community reached"],
];

/**
 * Meet the founder.
 *
 * Rebuilt from a centred-avatar layout. The old version put a 128px circular
 * portrait in a tinted box beside two paragraphs of muted body text — which
 * made the human face the smallest element in the one section whose entire job
 * is to introduce a person. The source image is 1400×1600, so it can carry a
 * full-bleed editorial crop instead.
 *
 * Changes worth knowing:
 *  - Portrait runs the full height of the card, with a scrim carrying the name,
 *    role and socials over it. One block instead of four stacked centred ones.
 *  - Portrait frame follows the source's 7:8 aspect below `lg` rather than a
 *    flat min-height, and the crop is pinned to the face (50% / 30%). The file
 *    is already cropped to 7:8 around the subject, so below `lg` object-cover
 *    shows it whole; the position only bites in the taller `lg` column, where
 *    50% keeps the face centred and holds both the mic and the gesturing hand
 *    inside the narrower frame.
 *  - `ex-Walmart` etc. were 12px muted pills AND repeated verbatim in the first
 *    prose paragraph. They're now a single labelled "Previously" row, and the
 *    prose no longer re-lists them.
 *  - Copy is first-person, in Anjali's own words.
 *  - Scroll-reveal on the card, matching Stats / Reviews / FAQ.
 */
export function Founder() {
  return (
    <Container>
      <section id="founder" className="py-16">
        <Reveal>
          <GlassCard className="overflow-hidden p-0">
            <div className="grid gap-0 lg:grid-cols-[0.85fr_1.15fr]">
              {/* Portrait — full-bleed, with the identity block scrimmed over
                  the base so the photo isn't competing with a caption below it. */}
              <div className="relative aspect-[7/8] max-h-[30rem] sm:max-h-[34rem] lg:aspect-auto lg:max-h-none lg:min-h-full">
                <Image
                  src="/team/anjali-kumari.jpg"
                  alt="Anjali Kumari, founder of RisingBrain"
                  fill
                  sizes="(min-width: 1024px) 42vw, 100vw"
                  className="object-cover object-[50%_30%]"
                  priority
                />
                {/* Scrim: opaque at the base, clear by mid-frame, so the text
                    stays legible without greying out the whole portrait. */}
                <div
                  aria-hidden
                  className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/45 via-45% to-transparent"
                />
                <div className="absolute inset-x-0 bottom-0 p-6 sm:p-8">
                  <div className="text-xl font-bold text-white">Anjali Kumari</div>
                  <div className="mt-0.5 text-sm text-rb-green-400">
                    Founder &amp; CEO, RisingBrain
                  </div>
                  <div className="mt-4 flex gap-2">
                    {socials.map((s) => (
                      <a
                        key={s.label}
                        href={s.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label={`Anjali on ${s.label}`}
                        className={`grid h-10 w-10 place-items-center rounded-xl border border-white/20 bg-white/10 backdrop-blur transition-colors ${s.accent}`}
                      >
                        <s.Icon className="h-4 w-4" />
                      </a>
                    ))}
                  </div>
                </div>
              </div>

              {/* Story column. */}
              <div className="p-8 sm:p-10">
                <Eyebrow>
                  <span className="h-1.5 w-1.5 rounded-full bg-rb-green-400" />
                  Meet the founder
                </Eyebrow>

                <h2 className="mt-4 text-2xl font-bold sm:text-3xl">
                  Hi, I&apos;m <span className="text-gradient">Anjali</span> 👋
                </h2>

                <div className="mt-4 space-y-3 text-sm leading-relaxed text-muted">
                  <p>I&apos;m a software engineer and the founder of RisingBrain.</p>
                  <p>
                    I started RisingBrain because I know how confusing interview preparation can
                    feel when you don&apos;t have a clear roadmap. I wanted to build the kind of
                    platform I wished I had when I was preparing — simple, structured, practical,
                    and accessible to everyone.
                  </p>
                  <p>
                    What started with sharing what I learned has grown into a community of{" "}
                    <strong className="text-foreground">450K+</strong> learners across LinkedIn,
                    YouTube, and Instagram, along with mentoring{" "}
                    <strong className="text-foreground">100+ engineers</strong> 1:1.
                  </p>
                  <p>
                    Today, I&apos;m building RisingBrain with one goal: help you prepare smarter,
                    build confidence, and become interview-ready.
                  </p>
                </div>

                {/* Credentials, promoted out of 12px muted pills. */}
                <div className="mt-6 border-t border-border pt-5">
                  <div className="text-[11px] uppercase tracking-wider text-muted">Previously</div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {previously.map((c, i) => (
                      <span key={c} className="flex items-center gap-3">
                        {i > 0 && <span aria-hidden className="text-border">·</span>}
                        <span className="text-sm font-semibold">{c}</span>
                      </span>
                    ))}
                  </div>
                </div>

                <div className="mt-6 grid grid-cols-2 gap-3">
                  {metrics.map(([Icon, num, label]) => (
                    <div key={label} className="glass-pill rounded-2xl px-4 py-3">
                      <Icon className="h-4 w-4 text-accent" />
                      <div className="mt-1.5 text-lg font-bold tabular-nums">{num}</div>
                      <div className="text-[11px] text-muted">{label}</div>
                    </div>
                  ))}
                </div>

                <a
                  href="https://www.linkedin.com/company/risingbrain/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-glow mt-6 inline-flex items-center gap-2 rounded-2xl px-5 py-2.5 text-sm font-semibold"
                >
                  Connect with Anjali <ExternalLink className="h-4 w-4" />
                </a>
              </div>
            </div>
          </GlassCard>
        </Reveal>
      </section>
    </Container>
  );
}
