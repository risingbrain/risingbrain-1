import { prisma } from "@/lib/db";

/**
 * Full DSA tree for the admin editor — UNLIKE the public `getDsaCatalog()` this
 * is NOT cached and includes unpublished sheets + every editable field, so the
 * editor always sees live, complete data. Ordered top-to-bottom at every level.
 */
export async function getAdminDsaTree() {
  return prisma.dsaSheet.findMany({
    orderBy: { order: "asc" },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      order: true,
      isPublished: true,
      topics: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          order: true,
          patterns: {
            orderBy: { order: "asc" },
            select: {
              id: true,
              slug: true,
              name: true,
              strategy: true,
              identification: true,
              order: true,
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
                  order: true,
                  companies: { select: { companyId: true } },
                },
              },
            },
          },
        },
      },
    },
  });
}

export async function getAllCompanies() {
  return prisma.company.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, logoUrl: true },
  });
}

export type AdminDsaTree = Awaited<ReturnType<typeof getAdminDsaTree>>;
export type AdminSheet = AdminDsaTree[number];
export type AdminTopic = AdminSheet["topics"][number];
export type AdminPattern = AdminTopic["patterns"][number];
export type AdminProblem = AdminPattern["problems"][number];
export type AdminCompany = Awaited<ReturnType<typeof getAllCompanies>>[number];
