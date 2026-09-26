import type { Metadata } from "next";
import { SITE_NAME, absoluteUrl, pageMetadata } from "@/lib/seo";
import type { DsaCatalog } from "./_data";

/**
 * SEO for the DSA sheet routes — titles/descriptions built from the live catalog
 * (so problem counts never go stale) and the JSON-LD blocks for the page.
 *
 *   /sheet          hub: every published sheet, opens on the first
 *   /sheet/<slug>   one sheet's own indexable page
 */

type CatalogSheet = DsaCatalog[number];

const problemCount = (sheet: CatalogSheet) =>
  sheet.topics.reduce((n, t) => n + t.patterns.reduce((m, p) => m + p.problems.length, 0), 0);

export const sheetPath = (slug: string) => `/sheet/${slug}`;

export function hubMetadata(catalog: DsaCatalog): Metadata {
  const total = catalog.reduce((n, s) => n + problemCount(s), 0);
  const names = catalog.map((s) => s.name).join(", ");
  return pageMetadata({
    title: `DSA Sheet — ${total}+ Pattern-Wise LeetCode & GFG Problems (Free)`,
    description: `Free, pattern-first DSA sheets (${names}) — ${total}+ LeetCode and GeeksforGeeks problems grouped by topic and pattern, with video solutions, company tags and progress tracking.`,
    path: "/sheet",
  });
}

export function sheetMetadata(sheet: CatalogSheet): Metadata {
  const total = problemCount(sheet);
  const topics = sheet.topics.length;
  return pageMetadata({
    title: `${sheet.name} — Free DSA Sheet (${total} Problems)`,
    description:
      `${sheet.description ? `${sheet.description.replace(/\s+$/, "").replace(/\.?$/, ".")} ` : ""}` +
      `${total} DSA problems across ${topics} topics, grouped by pattern with LeetCode/GFG links and video solutions.`,
    path: sheetPath(sheet.slug),
  });
}

/**
 * Structured data: a breadcrumb trail on every sheet URL, plus
 *  - hub:        an ItemList of the sheets (each links to its own page)
 *  - sheet page: a free Course describing that sheet
 */
export function sheetJsonLd(
  catalog: DsaCatalog,
  active: CatalogSheet | undefined,
): Record<string, unknown>[] {
  const crumbs = [
    { name: "Home", url: absoluteUrl("/") },
    { name: "DSA Sheets", url: absoluteUrl("/sheet") },
    ...(active ? [{ name: active.name, url: absoluteUrl(sheetPath(active.slug)) }] : []),
  ];
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: crumbs.map((c, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: c.name,
      item: c.url,
    })),
  };

  if (!active) {
    return [
      breadcrumb,
      {
        "@context": "https://schema.org",
        "@type": "ItemList",
        name: "RisingBrain DSA Sheets",
        itemListElement: catalog.map((s, i) => ({
          "@type": "ListItem",
          position: i + 1,
          name: s.name,
          url: absoluteUrl(sheetPath(s.slug)),
        })),
      },
    ];
  }

  return [
    breadcrumb,
    {
      "@context": "https://schema.org",
      "@type": "Course",
      name: `${active.name} — DSA Sheet`,
      description:
        active.description ??
        `${problemCount(active)} pattern-wise DSA problems for coding interview preparation.`,
      url: absoluteUrl(sheetPath(active.slug)),
      inLanguage: "en",
      isAccessibleForFree: true,
      teaches: active.topics.map((t) => t.name),
      provider: { "@type": "Organization", name: SITE_NAME, url: absoluteUrl("/") },
    },
  ];
}
