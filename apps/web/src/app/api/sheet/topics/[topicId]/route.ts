import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/current-user";

/**
 * GET /api/sheet/topics/[topicId]
 *
 * Lazy-loaded problem details for a single topic. The sheet page only ships a
 * lightweight skeleton (topic names + counts); the heavy per-problem payload
 * (titles, links, companies) is fetched here on hover/expand. The response is
 * merged with THIS user's progress + note presence so each row renders fully.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ topicId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { topicId } = await params;

  const patterns = await prisma.dsaPattern.findMany({
    where: { topicId },
    orderBy: { order: "asc" },
    select: {
      id: true,
      name: true,
      strategy: true,
      identification: true,
      problems: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          slug: true,
          title: true,
          reference: true,
          difficulty: true,
          leetcodeUrl: true,
          gfgUrl: true,
          youtubeUrl: true,
          hint: true,
          companies: {
            select: { company: { select: { name: true, logoUrl: true } } },
          },
        },
      },
    },
  });

  const problemIds = patterns.flatMap((p) => p.problems.map((pr) => pr.id));

  // Two small lookups keyed on this user's identity + just these problem ids.
  const [progress, notes] = await Promise.all([
    problemIds.length
      ? prisma.userProblemProgress.findMany({
          where: { userId: user.id, problemId: { in: problemIds } },
          select: { problemId: true, status: true, isBookmarked: true },
        })
      : Promise.resolve([]),
    problemIds.length
      ? prisma.userProblemNote.findMany({
          where: { userId: user.id, problemId: { in: problemIds }, isActive: true },
          select: { problemId: true },
        })
      : Promise.resolve([]),
  ]);

  const statusByProblem = new Map(progress.map((p) => [p.problemId, p.status]));
  const bookmarkByProblem = new Map(progress.map((p) => [p.problemId, p.isBookmarked]));
  const noteProblems = new Set(notes.map((n) => n.problemId));

  const result = patterns.map((pattern) => ({
    id: pattern.id,
    name: pattern.name,
    strategy: pattern.strategy,
    identification: pattern.identification,
    problems: pattern.problems.map((pr) => ({
      id: pr.id,
      slug: pr.slug,
      title: pr.title,
      reference: pr.reference,
      difficulty: pr.difficulty,
      leetcodeUrl: pr.leetcodeUrl,
      gfgUrl: pr.gfgUrl,
      youtubeUrl: pr.youtubeUrl,
      hint: pr.hint,
      companies: pr.companies.map((c) => ({
        name: c.company.name,
        logoUrl: c.company.logoUrl,
      })),
      status: statusByProblem.get(pr.id) ?? "NOT_STARTED",
      hasNote: noteProblems.has(pr.id),
      isBookmarked: bookmarkByProblem.get(pr.id) ?? false,
    })),
  }));

  return NextResponse.json({ patterns: result });
}
