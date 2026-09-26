import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDsaCatalog } from "../_data";
import { sheetMetadata } from "../_seo";
import { SheetView } from "../_view";

type Params = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const sheet = (await getDsaCatalog()).find((s) => s.slug === slug);
  return sheet ? sheetMetadata(sheet) : {};
}

/**
 * `/sheet/<slug>` — one sheet's own indexable page (title, canonical, JSON-LD).
 * Same screen as the hub, opened on this sheet; switching tabs stays client-side.
 */
export default async function SheetSlugPage({ params }: Params) {
  const { slug } = await params;
  const catalog = await getDsaCatalog();
  if (!catalog.some((s) => s.slug === slug)) notFound();
  return <SheetView activeSlug={slug} />;
}
