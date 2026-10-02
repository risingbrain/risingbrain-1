import { prisma } from "@/lib/db";

/**
 * All Domain topics for the admin editor — NOT cached, includes unpublished rows
 * and the full markdown `notes` and `miniProject` bodies. Ordered by subject → group →
 * order so the sidebar can group them without re-sorting. The public
 * `getDomainIndex()`/`getDomainTopic()` loaders stay cached + published-only.
 */
export async function getAdminDomainTopics() {
  return prisma.domainTopic.findMany({
    orderBy: [{ subject: "asc" }, { groupOrder: "asc" }, { order: "asc" }],
    select: {
      id: true,
      subject: true,
      slug: true,
      title: true,
      groupLabel: true,
      groupOrder: true,
      summary: true,
      notes: true,
      miniProject: true,
      order: true,
      isPublished: true,
    },
  });
}

export type AdminDomainTopic = Awaited<ReturnType<typeof getAdminDomainTopics>>[number];
