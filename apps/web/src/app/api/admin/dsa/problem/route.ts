import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma, Difficulty } from "@/lib/db";
import { CACHE_TAGS } from "@/lib/cache";
import { requireAdmin, parse, writeErrorResponse } from "../../_guard";
import { dsaProblemCreate, dsaProblemUpdate, idPayload } from "@/lib/admin/schemas";
import { uniqueSlug } from "@/lib/admin/slug";

const bust = () => revalidateTag(CACHE_TAGS.dsaCatalog, { expire: 0 });

/**
 * POST create · PATCH update · DELETE. `companyIds` reconciles the ProblemCompany
 * join (replace-all on update). The problem `slug` is generated once and left
 * immutable — it's a stable external reference for progress/notes/heatmap.
 */
export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (guard.error) return guard.error;
  const parsed = await parse(req, dsaProblemCreate);
  if (parsed.error) return parsed.error;
  const d = parsed.data;

  try {
    const [siblingCount, allSlugs] = await Promise.all([
      prisma.dsaProblem.count({ where: { patternId: d.patternId } }),
      prisma.dsaProblem.findMany({ select: { slug: true } }),
    ]);
    const created = await prisma.dsaProblem.create({
      data: {
        patternId: d.patternId,
        title: d.title,
        slug: uniqueSlug(d.title, allSlugs.map((s) => s.slug)),
        reference: d.reference ?? null,
        difficulty: d.difficulty ?? Difficulty.MEDIUM,
        leetcodeUrl: d.leetcodeUrl ?? null,
        gfgUrl: d.gfgUrl ?? null,
        youtubeUrl: d.youtubeUrl ?? null,
        hint: d.hint ?? null,
        order: d.order ?? siblingCount,
        ...(d.companyIds?.length && {
          companies: { create: d.companyIds.map((id) => ({ company: { connect: { id } } })) },
        }),
      },
      select: { id: true },
    });
    bust();
    return NextResponse.json({ ok: true, id: created.id });
  } catch (e) {
    return writeErrorResponse(e, "dsa-problem-create");
  }
}

export async function PATCH(req: Request) {
  const guard = await requireAdmin(req);
  if (guard.error) return guard.error;
  const parsed = await parse(req, dsaProblemUpdate);
  if (parsed.error) return parsed.error;
  const { id, companyIds, ...d } = parsed.data;

  try {
    await prisma.$transaction(async (tx) => {
      await tx.dsaProblem.update({
        where: { id },
        data: {
          ...(d.title !== undefined && { title: d.title }),
          ...(d.reference !== undefined && { reference: d.reference ?? null }),
          ...(d.difficulty !== undefined && { difficulty: d.difficulty }),
          ...(d.leetcodeUrl !== undefined && { leetcodeUrl: d.leetcodeUrl ?? null }),
          ...(d.gfgUrl !== undefined && { gfgUrl: d.gfgUrl ?? null }),
          ...(d.youtubeUrl !== undefined && { youtubeUrl: d.youtubeUrl ?? null }),
          ...(d.hint !== undefined && { hint: d.hint }),
          ...(d.order !== undefined && { order: d.order }),
        },
      });
      // Reconcile companies only when the field is present (replace-all).
      if (companyIds !== undefined) {
        await tx.problemCompany.deleteMany({ where: { problemId: id } });
        if (companyIds.length) {
          await tx.problemCompany.createMany({
            data: companyIds.map((companyId) => ({ problemId: id, companyId })),
            skipDuplicates: true,
          });
        }
      }
    });
    bust();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return writeErrorResponse(e, "dsa-problem-update");
  }
}

export async function DELETE(req: Request) {
  const guard = await requireAdmin(req);
  if (guard.error) return guard.error;
  const parsed = await parse(req, idPayload);
  if (parsed.error) return parsed.error;

  try {
    await prisma.dsaProblem.delete({ where: { id: parsed.data.id } });
    bust();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return writeErrorResponse(e, "dsa-problem-delete");
  }
}
