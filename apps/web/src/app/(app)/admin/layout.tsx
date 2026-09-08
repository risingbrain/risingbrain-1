import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/auth/current-user";
import { AdminNav } from "./_components/admin-nav";

export const metadata: Metadata = {
  title: "Admin",
  robots: { index: false, follow: false }, // management surface — keep out of search
};

/**
 * ADMIN-only content-management shell. The edge proxy already gates `/admin`
 * (`ROUTE_ACCESS` + `proxy.ts`), but we re-check here as defense-in-depth: a
 * Server Component must never trust that an upstream layer ran. `getCurrentUser`
 * is pure crypto (no DB), so this is cheap. Non-admins get a 404 (don't reveal
 * the surface exists).
 *
 * SCROLL MODEL (desktop): like /domain and /screening, this route fills the shell's
 * center column rather than scrolling it — `data-fills-scrollport` opts in (see the
 * rule of the same name in globals.css). That's what gives the managers' list and
 * editor panels a definite height so each can scroll on its own; without it the
 * shared page-enter wrapper sizes to content and both panels lose their height.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  // "No token" and "not an admin" are different questions and must not share an
  // answer. `getCurrentUser` is access-token-only, so a lapsed 15-minute cookie
  // reads as null here — collapsing both into notFound() rendered a 404 at an
  // admin who was still signed in, whenever a request reached this layout without
  // the proxy having renewed first. 404-to-hide-the-surface still applies to a
  // VERIFIED non-admin below.
  if (!user) redirect("/login?callbackUrl=/admin");
  if (user.role !== "ADMIN") notFound();

  return (
    <div data-fills-scrollport className="flex h-full min-h-0 flex-1 flex-col">
      {/* Section header + tabs stay put; only the content below them scrolls. */}
      <div className="shrink-0 border-b border-border px-4 pb-3.5 pt-5 sm:px-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-accent">
          Content management
        </p>
        <h1 className="mt-0.5 text-xl font-bold tracking-tight text-foreground">Admin</h1>
        <div className="mt-4">
          <AdminNav />
        </div>
      </div>
      {/* The scrollport for pages that are plain documents (Overview, Users). The
          tree managers fill this box exactly and scroll inside their own panels,
          so this never doubles up on them. Without it, opting into
          `data-fills-scrollport` above would leave those pages clipped — the shell
          no longer scrolls on this route. */}
      <div className="pane-scroll min-h-0 flex-1 lg:overflow-y-auto">{children}</div>
    </div>
  );
}
