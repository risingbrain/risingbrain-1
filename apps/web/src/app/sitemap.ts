import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db";
import { absoluteUrl } from "@/lib/seo";
import { routeForKind } from "./(app)/_quiz/routes";
import type { AptKind } from "./(app)/_quiz/data";
import { domainTopicHref } from "./(app)/domain/_categories";

// Regenerate hourly (ISR) so content published after a deploy still gets into
// the sitemap for Google to discover, without a rebuild.
export const revalidate = 3600;

/**
 * /sitemap.xml — the public URL map for search engines: the static hubs plus
 * every real content page (each DSA sheet, screening/puzzle topic, domain topic
 * and PUBLISHED interview experience).
 *
 * `/domain`, `/screening` and `/puzzles` are deliberately absent: they only
 * redirect to their first topic, and a sitemap should list final URLs — the
 * topic pages below are the content.
 *
 * Each DB source is fetched independently and degrades to nothing on failure,
 * so one transient error can't drop the rest (or fail the build).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: absoluteUrl("/"), changeFrequency: "weekly", priority: 1 },
    { url: absoluteUrl("/sheet"), changeFrequency: "weekly", priority: 0.9 },
    { url: absoluteUrl("/interview"), changeFrequency: "daily", priority: 0.8 },
    { url: absoluteUrl("/courses"), changeFrequency: "monthly", priority: 0.5 },
  ];

  const safe = <T,>(p: Promise<T[]>) => p.catch(() => [] as T[]);

  const [sheets, quizTopics, domainTopics, experiences] = await Promise.all([
    safe(
      prisma.dsaSheet.findMany({
        where: { isPublished: true },
        orderBy: { order: "asc" },
        select: { slug: true, updatedAt: true },
      }),
    ),
    safe(
      prisma.quizTopic.findMany({
        select: { slug: true, category: { select: { kind: true } } },
      }),
    ),
    safe(
      prisma.domainTopic.findMany({
        where: { isPublished: true },
        select: { subject: true, slug: true, updatedAt: true },
      }),
    ),
    safe(
      prisma.interviewExperience.findMany({
        where: { status: "PUBLISHED" },
        select: { slug: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 5000,
      }),
    ),
  ]);

  return [
    ...staticRoutes,
    ...sheets.map((s) => ({
      url: absoluteUrl(`/sheet/${s.slug}`),
      lastModified: s.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.9,
    })),
    ...quizTopics.map((t) => ({
      url: absoluteUrl(`${routeForKind(t.category.kind as AptKind).basePath}/${t.slug}`),
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...domainTopics.map((t) => ({
      url: absoluteUrl(domainTopicHref(t.subject, t.slug)),
      lastModified: t.updatedAt,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
    ...experiences.map((e) => ({
      url: absoluteUrl(`/interview/${e.slug}`),
      lastModified: e.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
