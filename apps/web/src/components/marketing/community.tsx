import { ExternalLink, Play } from "lucide-react";
import { Container, Eyebrow, GlassCard } from "./primitives";
import { InstagramIcon, LinkedInIcon, YouTubeIcon } from "./brand-icons";

const socials = [
  {
    label: "LinkedIn",
    handle: "150k+ followers",
    href: "https://www.linkedin.com/company/risingbrain/",
    Icon: LinkedInIcon,
    accent: "from-[#0a66c2]/30 to-[#0a66c2]/5 text-[#5a96d8]",
  },
  {
    label: "YouTube",
    handle: "RisingBrain · 40k+ subs",
    href: "https://www.youtube.com/@rbanjalikumari",
    Icon: YouTubeIcon,
    accent: "from-[#ff0000]/30 to-[#ff0000]/5 text-[#e25555]",
  },
  {
    label: "Instagram",
    handle: "@rbanjali.codes . 255k+",
    href: "https://www.instagram.com/rbanjali.codes/",
    Icon: InstagramIcon,
    accent: "from-[#e1306c]/30 to-[#e1306c]/5 text-[#d1568a]",
  },
];

export function Community() {
  return (
    <Container>
      <section id="community" className="py-16">
        <div className="mb-8 text-center">
          <div className="mb-4">
            <Eyebrow>
              <Play className="h-4 w-4" />
              Join the family
            </Eyebrow>
          </div>
          <h2 className="text-2xl font-bold sm:text-3xl">
            Learn with the <span className="text-gradient">RisingBrain community</span>
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">
            Free daily DSA breakdowns, placement strategy and a community that keeps you
            accountable. Pick your platform and follow along.
          </p>
        </div>
        <div className="grid gap-5 sm:grid-cols-3">
          {socials.map((s) => (
            <a key={s.label} href={s.href} target="_blank" rel="noopener noreferrer">
              <GlassCard hover className="h-full p-6">
                <div
                  className={`mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-gradient-to-br ${s.accent}`}
                >
                  <s.Icon className="h-6 w-6" />
                </div>
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold">{s.label}</h3>
                  <ExternalLink className="h-4 w-4 text-muted" />
                </div>
                <p className="mt-1 text-sm text-muted">{s.handle}</p>
              </GlassCard>
            </a>
          ))}
        </div>
      </section>
    </Container>
  );
}
