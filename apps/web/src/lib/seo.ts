import type { Metadata } from "next";

/**
 * Shared SEO constants — single source of truth for the site's canonical URL,
 * name, description and keywords. Consumed by the root metadata, sitemap,
 * robots, web manifest and JSON-LD structured data so they never drift.
 *
 * `siteUrl` comes from APP_URL (set to the real production domain in prod — it
 * powers `metadataBase`, canonical links, Open Graph URLs and the sitemap).
 */
export const SITE_NAME = "RisingBrain";

export const siteUrl = new URL(process.env.APP_URL || "http://localhost:3000");

export const SITE_DESCRIPTION =
  "Founder-led, pattern-first placement platform: curated DSA sheets, SQL practice, aptitude & logical reasoning, real interview experiences and courses — everything you need to crack your dream product company, from any college.";

export const SITE_KEYWORDS = [
  "DSA sheets",
  "coding interview preparation",
  "LeetCode patterns",
  "SQL practice",
  "aptitude test",
  "logical reasoning",
  "placement preparation",
  "interview experiences",
  "system design",
  "product company interview",
  "data structures and algorithms",
  "RisingBrain",
];

/** Absolute URL for a site-relative path. */
export const absoluteUrl = (path = "/"): string => new URL(path, siteUrl).toString();

/**
 * Per-page SEO metadata: title, description, a self-referencing canonical and
 * matching Open Graph / Twitter tags.
 *
 * Every indexable page should build its metadata through this. Next merges
 * metadata SHALLOWLY, so a page that sets only `title` inherits the parent's
 * whole `openGraph` / `alternates` objects — which is how every section page
 * used to advertise the homepage as its canonical URL and link-preview.
 *
 * `title` is the bare page title; the root layout's template appends the brand
 * to <title>, and the social tags get the same branded string here (templates
 * don't apply to `openGraph.title`). Pass `absoluteTitle` to skip the suffix.
 */
export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
}: {
  title: string;
  description: string;
  path: string;
  absoluteTitle?: boolean;
}): Metadata {
  const fullTitle = absoluteTitle ? title : `${title} — ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: SITE_NAME,
      locale: "en_US",
      url: path,
      title: fullTitle,
      description,
    },
    twitter: { card: "summary_large_image", title: fullTitle, description },
  };
}
