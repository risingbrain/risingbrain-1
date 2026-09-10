"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ListTodo,
  Database,
  MessageSquareText,
  NotebookPen,
  ShieldCheck,
  Users,
} from "lucide-react";
import { cn } from "@risingbrain/ui/cn";

const TABS = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard, exact: true },
  { href: "/admin/sheets", label: "Sheets", icon: ListTodo },
  { href: "/admin/domain", label: "Domain", icon: Database },
  { href: "/admin/screening", label: "Screening", icon: NotebookPen },
  { href: "/admin/interview", label: "Interviews", icon: ShieldCheck },
  { href: "/admin/feedback", label: "Feedback", icon: MessageSquareText },
  { href: "/admin/users", label: "Users", icon: Users },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1.5">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href);
        const Icon = t.icon;
        return (
          <Link
            key={t.href}
            href={t.href}
            // All seven tabs are in the viewport at once, so the default
            // viewport-prefetch fires six extra RSC requests on every admin page
            // render. This is a LOAD saving, not the fix for the logout that came
            // out of it — the proxy is what makes a denied prefetch harmless (see
            // the isPrefetch branch in proxy.ts).
            prefetch={false}
            // `ScrollportReset` in the layout owns the scroll after a section
            // switch; the router's own version shifts the fixed shell instead.
            scroll={false}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
              active
                ? "bg-rb-green-500/15 text-brand ring-1 ring-rb-green-500/30"
                : "text-muted hover:bg-surface-2 hover:text-foreground",
            )}
          >
            <Icon className="h-4 w-4" /> {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
