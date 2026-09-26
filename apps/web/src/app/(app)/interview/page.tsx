import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Building2, MessageSquareQuote, Sparkles, Trophy } from "lucide-react";
import { getCurrentUser } from "@/lib/auth/current-user";
import { PublishStatus } from "@risingbrain/database/enums";
import { Container, Eyebrow } from "@/components/marketing/primitives";
import { CountUp } from "@/components/motion/count-up";
import { Reveal } from "@/components/motion/reveal";
import { InterviewFeed } from "./_components/interview-feed";
import { MySubmissions } from "./_components/my-submissions";
import { getInterviewFeed, getMySubmissions, parseFeedParams } from "./_data";

export const metadata: Metadata = pageMetadata({
  title: "Interview Experiences",
  description:
    "Real interview experiences from real candidates — what was asked, what worked, and what they'd do differently. Learn from wins and lessons across companies.",
  path: "/interview",
});

export default async function InterviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseFeedParams(await searchParams);
  const current = await getCurrentUser();
  const signedIn = Boolean(current);

  // Only a signed-in author can have submissions of their own to chase up, so
  // the second query is skipped entirely for everyone else.
  const [feed, mySubmissions] = await Promise.all([
    getInterviewFeed(params, current?.id ?? null),
    current ? getMySubmissions(current.id) : Promise.resolve([]),
  ]);

  // One open submission per author (enforced by `POST /api/interview`). Finding
  // it here means the feed can say so BEFORE the composer is opened, instead of
  // letting someone write a second write-up and meet a 409 at the end of it.
  const pending = mySubmissions.find((s) => s.status === PublishStatus.PENDING_REVIEW) ?? null;

  const stats: { icon: typeof Building2; label: string; value: number }[] = [
    { icon: MessageSquareQuote, label: "experiences", value: feed.globalTotal },
    { icon: Building2, label: "companies", value: feed.stats.companies },
    { icon: Trophy, label: "selected", value: feed.stats.selected },
  ];

  return (
    <main className="flex-1">
      <Container tight>
        <section className="relative py-14 sm:py-20">
          {/* Soft brand spotlight behind the heading. */}
          <div
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-0 -z-10 h-72 w-[44rem] max-w-full -translate-x-1/2 rounded-full bg-rb-green-500/10 blur-3xl"
          />

          <div className="stagger mx-auto mb-10 max-w-2xl text-center">
            <Eyebrow>
              <Sparkles className="h-3.5 w-3.5" /> Interview experiences
            </Eyebrow>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
              Learn from <span className="text-gradient">real interviews</span>
            </h1>
            <p className="mx-auto mt-4 max-w-xl text-muted">
              Honest, round-by-round write-ups from candidates who sat in the
              hot seat — the questions, the verdicts, and the tips that actually
              move the needle.
            </p>

            {/* Stat pills — only meaningful once there's content to summarize. */}
            {feed.globalTotal > 0 && (
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                {stats.map((s) => {
                  const Icon = s.icon;
                  return (
                    <div
                      key={s.label}
                      className="glass-pill inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm"
                    >
                      <Icon className="h-4 w-4 text-accent" />
                      <span className="font-semibold tabular-nums text-foreground">
                        <CountUp value={s.value} />
                      </span>
                      <span className="text-muted">{s.label}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <MySubmissions submissions={mySubmissions} />

          <Reveal>
            <InterviewFeed
            experiences={feed.experiences}
            signedIn={signedIn}
            pendingSubmission={pending ? { slug: pending.slug, title: pending.title } : null}
            datasetEmpty={feed.globalTotal === 0}
            filters={params}
            page={feed.page}
            totalPages={feed.totalPages}
            filteredTotal={feed.filteredTotal}
            globalTotal={feed.globalTotal}
            />
          </Reveal>
        </section>
      </Container>
    </main>
  );
}
