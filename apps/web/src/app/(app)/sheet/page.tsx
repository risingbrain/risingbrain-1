import type { Metadata } from "next";
import { getDsaCatalog } from "./_data";
import { hubMetadata } from "./_seo";
import { SheetView } from "./_view";

export async function generateMetadata(): Promise<Metadata> {
  return hubMetadata(await getDsaCatalog());
}

/** `/sheet` — the hub: every published sheet, opening on the first one. */
export default function SheetPage() {
  return <SheetView />;
}
