import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/db";
import { CACHE_TAGS } from "@/lib/cache";
import { requireAdmin, parse, writeErrorResponse } from "../../_guard";
import { domainTopicCreate, domainTopicUpdate, idPayload } from "@/lib/admin/schemas";
import { uniqueSlug } from "@/lib/admin/slug";

const bust = () => revalidateTag(CACHE_TAGS.domainCatalog, { expire: 0 });

/** POST create · PATCH update · DELETE for the unified DomainTopic table. */
export async function POST(req: Request) {
  const guard = await requireAdmin(req);
  if (guard.error) return guard.error;
  const parsed = await parse(req, domainTopicCreate);
  if (parsed.error) return parsed.error;
  const d = parsed.data;

  try {
    // Slug is unique per subject.
    const siblings = await prisma.domainTopic.findMany({
      where: { subject: d.subject },
      select: { slug: true },
    });
    const count = await prisma.domainTopic.count({ where: { subject: d.subject } });
    const created = await prisma.domainTopic.create({
      data: {
        subject: d.subject,
        title: d.title,
        slug: uniqueSlug(d.title, siblings.map((s) => s.slug)),
        groupLabel: d.groupLabel,
        groupOrder: d.groupOrder ?? 0,
        summary: d.summary ?? null,
        notes: d.notes,
        miniProject: d.miniProject ?? null,
        order: d.order ?? count,
        isPublished: d.isPublished ?? true,
      },
      select: { id: true },
    });
    bust();
    return NextResponse.json({ ok: true, id: created.id });
  } catch (e) {
    return writeErrorResponse(e, "domain-topic-create");
  }
}

export async function PATCH(req: Request) {
  const guard = await requireAdmin(req);
  if (guard.error) return guard.error;
  const parsed = await parse(req, domainTopicUpdate);
  if (parsed.error) return parsed.error;
  const { id, ...d } = parsed.data;

  try {
    await prisma.domainTopic.update({
      where: { id },
      data: {
        ...(d.subject !== undefined && { subject: d.subject }),
        ...(d.title !== undefined && { title: d.title }),
        ...(d.groupLabel !== undefined && { groupLabel: d.groupLabel }),
        ...(d.groupOrder !== undefined && { groupOrder: d.groupOrder }),
        ...(d.summary !== undefined && { summary: d.summary ?? null }),
        ...(d.notes !== undefined && { notes: d.notes }),
        ...(d.miniProject !== undefined && { miniProject: d.miniProject }),
        ...(d.order !== undefined && { order: d.order }),
        ...(d.isPublished !== undefined && { isPublished: d.isPublished }),
      },
    });
    bust();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return writeErrorResponse(e, "domain-topic-update");
  }
}

export async function DELETE(req: Request) {
  const guard = await requireAdmin(req);
  if (guard.error) return guard.error;
  const parsed = await parse(req, idPayload);
  if (parsed.error) return parsed.error;

  try {
    await prisma.domainTopic.delete({ where: { id: parsed.data.id } });
    bust();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return writeErrorResponse(e, "domain-topic-delete");
  }
}
