import { BookOpen, Layers, ListChecks } from "lucide-react";
import { getCurrentUser, getCurrentUserProfileForChrome } from "@/lib/auth/current-user";
import { Container } from "@/components/marketing/primitives";
import { CountUp } from "@/components/motion/count-up";
import { prisma } from "@/lib/db";
import { JsonLd } from "@/components/structured-data";
import { SheetSelector } from "./_components/sheet-selector";
import type {
  SheetMeta,
  SheetPattern,
  SheetProblem,
  DifficultyValue,
  ProblemStatusValue,
} from "./_components/types";
import type { DifficultyStat } from "./_components/progress-panel";
import { getDsaCatalog, getSheetActivity, type SheetActivity } from "./_data";
import { sheetJsonLd } from "./_seo";

function StatPill({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: number | string;
  label: string;
}) {
  return (
    <span className="glass-pill inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm">
      <span className="text-accent">{icon}</span>
      <span className="font-semibold tabular-nums text-foreground">
        {typeof value === "number" ? <CountUp value={value} /> : value}
      </span>
      <span className="text-muted">{label}</span>
    </span>
  );
}

/**
 * The DSA sheet screen, shared by `/sheet` (the hub — opens on the first sheet)
 * and `/sheet/[slug]` (one sheet's own indexable page — opens on that sheet).
 * The callers own metadata and 404 handling; `activeSlug` must already exist.
 */
export async function SheetView({ activeSlug }: { activeSlug?: string }) {
  const user = await getCurrentUser();

  // The sheet tree (sheets → topics → patterns → problems → companies) is shared,
  // seeded content — identical for everyone — so it comes from a cross-request
  // cache. Per-user data (activity, profile, and progress/notes/bookmarks below)
  // is always read fresh for the signed-in user and layered on top.
  const [sheetsRaw, activity, profile] = await Promise.all([
    getDsaCatalog(),
    user ? getSheetActivity(user.id) : (null as SheetActivity | null),
    // Chrome variant: this profile only supplies the greeting's first name, so a
    // transient DB error should cost the greeting, not the whole page.
    user ? getCurrentUserProfileForChrome() : null,
  ]);

  // Collect every problem ID so we can fetch user data in one batch.
  const allProblemIds = sheetsRaw.flatMap((s) =>
    s.topics.flatMap((t) =>
      t.patterns.flatMap((p) => p.problems.map((pr) => pr.id))
    )
  );

  // User progress + notes — one round-trip for all problems at once.
  const [progressRows, noteRows] = user && allProblemIds.length
    ? await Promise.all([
        prisma.userProblemProgress.findMany({
          where: { userId: user.id, problemId: { in: allProblemIds } },
          select: { problemId: true, status: true, isBookmarked: true },
        }),
        prisma.userProblemNote.findMany({
          where: { userId: user.id, problemId: { in: allProblemIds }, isActive: true },
          select: { problemId: true },
        }),
      ])
    : [[], []] as [
        { problemId: string; status: string; isBookmarked: boolean }[],
        { problemId: string }[],
      ];

  const statusMap = new Map(progressRows.map((p) => [p.problemId, p.status as ProblemStatusValue]));
  const bookmarkMap = new Map(progressRows.map((p) => [p.problemId, p.isBookmarked]));
  const noteSet = new Set(noteRows.map((n) => n.problemId));

  // Build the serialisable SheetMeta tree and aggregate difficulty stats in one pass.
  const difficultyStats: DifficultyStat = {
    EASY: { solved: 0, total: 0 },
    MEDIUM: { solved: 0, total: 0 },
    HARD: { solved: 0, total: 0 },
  };

  const sheetData: SheetMeta[] = sheetsRaw.map((sheet) => ({
    id: sheet.id,
    slug: sheet.slug,
    name: sheet.name,
    description: sheet.description,
    topics: sheet.topics.map((topic) => {
      let topicSolved = 0;
      let topicTotal = 0;

      const patterns: SheetPattern[] = topic.patterns.map((pattern) => ({
        id: pattern.id,
        name: pattern.name,
        strategy: pattern.strategy,
        identification: pattern.identification,
        problems: pattern.problems.map((pr): SheetProblem => {
          const status = statusMap.get(pr.id) ?? "NOT_STARTED";
          const isSolved = status === "SOLVED";
          const diff = pr.difficulty as DifficultyValue;

          topicTotal++;
          difficultyStats[diff].total++;
          if (isSolved) {
            topicSolved++;
            difficultyStats[diff].solved++;
          }

          return {
            id: pr.id,
            slug: pr.slug,
            title: pr.title,
            reference: pr.reference,
            difficulty: diff,
            leetcodeUrl: pr.leetcodeUrl,
            gfgUrl: pr.gfgUrl,
            youtubeUrl: pr.youtubeUrl,
            companies: pr.companies.map((c) => ({
              name: c.company.name,
              logoUrl: c.company.logoUrl,
            })),
            status,
            hasNote: noteSet.has(pr.id),
            isBookmarked: bookmarkMap.get(pr.id) ?? false,
          };
        }),
      }));

      return {
        id: topic.id,
        name: topic.name,
        description: topic.description,
        problemCount: topicTotal,
        solvedCount: topicSolved,
        patterns,
      };
    }),
  }));

  const totalTopics = sheetsRaw.reduce((s, sh) => s + sh.topics.length, 0);
  const totalProblems = allProblemIds.length;
  const firstName = profile?.name?.trim().split(/\s+/)[0] ?? null;
  const activeSheet = sheetsRaw.find((s) => s.slug === activeSlug);

  return (
    <main className="flex-1">
      {sheetJsonLd(sheetsRaw, activeSheet).map((data, i) => (
        <JsonLd key={i} data={data} />
      ))}
      <Container tight className="py-8 sm:py-12">
        <SheetSelector
          sheets={sheetData}
          initialSheetId={activeSheet?.id}
          difficulty={difficultyStats}
          activity={activity}
          greetingName={firstName}
          signedIn={!!user}
          header={
            <section key="sheet-header" className="relative pb-6">
              <div
                aria-hidden
                className="pointer-events-none absolute left-1/2 top-0 -z-10 h-72 w-[44rem] max-w-full -translate-x-1/2 rounded-full bg-rb-green-500/10 blur-3xl"
              />
              <div className="animate-in lg:flex lg:items-end lg:justify-between lg:gap-8">
                <div className="max-w-2xl">
                  {/* The page's one <h1>: the eyebrow carries the words people
                      search for ("DSA sheet"), the display line the pitch. It is
                      the same on every sheet URL on purpose — this header is
                      rendered once on the server, while tab switches happen on
                      the client, so a per-sheet name here would go stale. The
                      active sheet's name is the <h2> in the selector below. */}
                  <h1 className="text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
                    <span className="mb-3 block text-sm font-semibold text-accent">
                      DSA Sheet
                    </span>
                    Learn patterns,
                    <span className="block text-gradient">not the problem</span>
                  </h1>
                  <p className="mt-3 text-muted">
                    Pattern Wise goes topic by topic. Last Minute 100 is the
                    short version for when the interview is close.
                  </p>
                </div>
                {/* Content counts sit to the RIGHT of the heading on wide screens
                    so the top row uses the full width instead of leaving the
                    top-right empty. */}
                <div className="mt-6 flex flex-wrap gap-2.5 lg:mt-0 lg:shrink-0">
                  {/* Explicit keys: this JSX is built in a SERVER component and
                      handed to the client `SheetSelector` as the `header` prop.
                      Crossing the RSC boundary turns these static siblings into
                      a dynamic children array, so React runs key validation on
                      them and warns ("passed a child from SheetPage") even
                      though they'd need no keys in a normal client tree. */}
                  <StatPill
                    key="sheets"
                    icon={<BookOpen className="h-4 w-4" />}
                    value={sheetsRaw.length}
                    label="sheets"
                  />
                  <StatPill
                    key="topics"
                    icon={<Layers className="h-4 w-4" />}
                    value={totalTopics}
                    label="topics"
                  />
                  <StatPill
                    key="problems"
                    icon={<ListChecks className="h-4 w-4" />}
                    value={totalProblems}
                    label="problems"
                  />
                </div>
              </div>
            </section>
          }
        />
      </Container>
    </main>
  );
}
