"use client";

import { useMemo } from "react";
import { usePathname } from "next/navigation";
import { TopicPager, type PagerLink } from "@/components/notes/topic-pager";
import { useSelectedCategory } from "./selected-category";

/**
 * Screening / Puzzles adapter for the shared `<TopicPager>`.
 *
 * No query and no props: `SelectedCategoryProvider` (rendered in `workspace.tsx`
 * around BOTH the `@nav` slot and the paper) already holds the whole index, so
 * flattening it here gives a sequence guaranteed to match the index rail — the
 * pager and the nav read the same array, in the same order.
 *
 * `basePath` is read off the URL rather than threaded down: the two routes built
 * on this workspace are `/screening/<slug>` and `/puzzles/<slug>`, so the first
 * segment IS the base path, and taking it from there keeps this component
 * prop-free and the provider untouched.
 */
export function PaperPager() {
  const pathname = usePathname();
  const ctx = useSelectedCategory();
  const categories = ctx?.categories;

  const model = useMemo(() => {
    if (!categories?.length) return null;

    const basePath = `/${pathname.split("/")[1] ?? ""}`;
    const activeSlug = pathname.split("/")[2] ?? "";

    // The route's full sequence, in the order the index renders it.
    const flat = categories.flatMap((c) =>
      c.topics.map((t) => ({
        slug: t.slug,
        title: t.name,
        categoryId: c.id,
        categoryName: c.name,
      }))
    );

    const i = flat.findIndex((t) => t.slug === activeSlug);
    // Slug not in this route's index — a stale bookmark, or a puzzle URL still
    // pointing at /screening (see `routeForKind`). Render nothing rather than a
    // pager for a sequence this page isn't in.
    if (i === -1) return null;

    const current = flat[i]!;
    const toLink = (step: -1 | 1): PagerLink | null => {
      const t = flat[i + step];
      if (!t) return null;
      return {
        href: `${basePath}/${t.slug}`,
        title: t.title,
        scope: t.categoryName,
        crossesScope: t.categoryId !== current.categoryId,
      };
    };

    // Position is counted WITHIN the open category, because that is the list the
    // index is showing — a number counted across the whole route would not match
    // anything on screen.
    const siblings = flat.filter((t) => t.categoryId === current.categoryId);

    return {
      prev: toLink(-1),
      next: toLink(1),
      position: {
        index: siblings.findIndex((t) => t.slug === activeSlug) + 1,
        total: siblings.length,
        scope: current.categoryName,
      },
      endLabel: current.categoryName,
    };
  }, [categories, pathname]);

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
