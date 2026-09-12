"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { TopicPager, type PagerLink } from "@/components/notes/topic-pager";
import { useSelectedSubject } from "./selected-subject";
import { SUBJECT_BY_SLUG, domainTopicHref } from "../_categories";

/**
 * Domain adapter for the shared `<TopicPager>` — the mirror of Screening's
 * `<PaperPager>`, differing only in the shape it flattens.
 *
 * No query and no props: `SelectedSubjectProvider` (rendered in `workspace.tsx`
 * around BOTH the `@nav` slot and the content) already holds the whole index, so
 * the sequence here is the same array the index rail renders, in the same order.
 *
 * Domain nests one level deeper than Screening — subject → group → topic — and
 * its slugs are unique only WITHIN a subject (SQL and DBMS both publish a
 * "views"), so a topic is located by the pair, exactly as `domainTopicHref` and
 * the table's `@@unique([subject, slug])` already treat it.
 */
export function DomainTopicPager() {
  const pathname = usePathname();
  const ctx = useSelectedSubject();
  const subjects = ctx?.subjects;

  const model = useMemo(() => {
    if (!subjects?.length) return null;

    // `/domain/<subject>/<slug>` states both halves of the address outright.
    const activeSubject = SUBJECT_BY_SLUG[pathname.split("/")[2] ?? ""];
    const activeSlug = pathname.split("/")[3] ?? "";
    if (!activeSubject || !activeSlug) return null;

    // The whole section's sequence, in the order the index renders it: subjects
    // in display order, groups in `groupOrder`, topics in `order`.
    const flat = subjects.flatMap((s) =>
      s.groups.flatMap((g) =>
        g.topics.map((t) => ({
          slug: t.slug,
          title: t.title,
          subject: s.subject,
          subjectLabel: s.label,
          groupLabel: g.label,
        }))
      )
    );

    const i = flat.findIndex((t) => t.subject === activeSubject && t.slug === activeSlug);
    // Slug not in the published index (a stale bookmark, an unpublished topic).
    if (i === -1) return null;

    const current = flat[i]!;
    const toLink = (step: -1 | 1): PagerLink | null => {
      const t = flat[i + step];
      if (!t) return null;
      const crossesScope = t.subject !== current.subject;
      return {
        href: domainTopicHref(t.subject, t.slug),
        title: t.title,
        // Within a subject the group is enough context; leaving the subject
        // behind is the thing worth naming, so the subject leads there.
        scope: crossesScope ? `${t.subjectLabel} · ${t.groupLabel}` : t.groupLabel,
        crossesScope,
      };
    };

    // Position is counted WITHIN the open subject (across its groups), because
    // that is exactly the list the index is showing.
    const siblings = flat.filter((t) => t.subject === current.subject);

    return {
      prev: toLink(-1),
      next: toLink(1),
      position: {
        index: siblings.findIndex((t) => t.slug === activeSlug) + 1,
        total: siblings.length,
        scope: current.subjectLabel,
      },
      endLabel: current.subjectLabel,
    };
  }, [subjects, pathname]);

  if (!model) return null;

  return (
    <TopicPager
      prev={model.prev}
      next={model.next}
      position={model.position}
      endLabel={model.endLabel}
    />
  );
}
