import Link from "next/link";
import { Inbox, Search, ShieldBan, Star } from "lucide-react";
import { FeedbackStatus } from "@risingbrain/database/enums";
import { cn } from "@risingbrain/ui/cn";
import { Avatar } from "@/components/marketing/primitives";
import { timeAgo } from "@/app/(app)/interview/_lib/format";
import { FEEDBACK_MAX_RATING, RATING_LABELS } from "@/lib/feedback";
import { getFeedbackInbox, parseInboxParams, INBOX_TABS, type InboxItem } from "./_data";
import { FeedbackActions } from "./_components/feedback-actions";
import { FeedbackBody } from "./_components/feedback-body";

/**
 * The feedback inbox — everything sent from the floating widget.
 *
 * Reading a note here is a real action, not a UI nicety: an author may hold only
 * a couple of UNREAD notes at once (`lib/feedback.ts`), so clearing this list is
 * what lets people keep talking to us. That is why the unread tab leads and its
 * badge stays coloured everywhere.
 *
 * Server-rendered like the interview queue, for the same reason: the bodies are
 * markdown, and rendering them here reuses the app's own render pipeline instead
 * of shipping a second markdown renderer to the browser.
 */

const TAB_LABEL: Record<(typeof INBOX_TABS)[number], string> = {
  [FeedbackStatus.NEW]: "Unread",
  [FeedbackStatus.VIEWED]: "Read",
};

export default async function AdminFeedbackPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseInboxParams(await searchParams);
  const inbox = await getFeedbackInbox(params);

  /** Build an inbox URL, keeping the current filter unless it is overridden. */
  const href = (updates: Partial<{ status: string; q: string; page: number }>) => {
    const sp = new URLSearchParams();
    const next = { status: params.status, q: params.q, page: 1, ...updates };
    if (next.status !== FeedbackStatus.NEW) sp.set("status", next.status);
    if (next.q) sp.set("q", next.q);
    if (next.page > 1) sp.set("page", String(next.page));
    const qs = sp.toString();
    return qs ? `/admin/feedback?${qs}` : "/admin/feedback";
  };

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
      <p className="max-w-prose text-sm leading-relaxed text-muted">
        Everything users send from the feedback button. Marking a note read clears it out of here{" "}
        <span className="text-foreground">and frees up the author&rsquo;s send limit</span> — they
        can only have a couple of unread notes open at a time. Delete anything not worth keeping.
      </p>

      {/* Status tabs. Links, not buttons — the inbox is a server read, so each
          tab is a real URL you can bookmark, share and reload. */}
      <div className="mt-5 flex flex-wrap gap-1.5">
        {INBOX_TABS.map((s) => {
          const active = params.status === s;
          const count = inbox.counts[s];
          return (
            <Link
              key={s}
              href={href({ status: s })}
              // `ScrollportReset` handles the scroll for the whole section.
              scroll={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                active
                  ? "bg-rb-green-500/15 text-brand ring-1 ring-rb-green-500/30"
                  : "text-muted hover:bg-surface-2 hover:text-foreground",
              )}
            >
              {TAB_LABEL[s]}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums",
                  // The unread badge is the one number that means "there is work
                  // to do", so it keeps its colour on the inactive tab too.
                  s === FeedbackStatus.NEW && count > 0
                    ? "bg-amber-500/20 text-amber-600 dark:text-amber-300"
                    : "bg-surface-2 text-muted",
                )}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Search — a GET form so it works without JS and lands on a plain URL. */}
      <form action="/admin/feedback" method="get" className="mt-4 flex gap-2">
        {params.status !== FeedbackStatus.NEW && (
          <input type="hidden" name="status" value={params.status} />
        )}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            name="q"
            defaultValue={params.q}
            type="search"
            placeholder="Search the text, or an author's name or email…"
            aria-label="Search feedback"
            className="w-full rounded-xl border border-border bg-surface/60 py-2.5 pl-10 pr-3.5 text-sm text-foreground outline-none placeholder:text-muted/70 focus:border-rb-green-500/60 focus:ring-2 focus:ring-rb-green-500/20"
          />
        </div>
        <button
          type="submit"
          className="btn-glow inline-flex items-center gap-1.5 rounded-xl bg-rb-green-500 px-5 text-sm font-semibold text-black"
        >
          <Search className="h-4 w-4" /> Search
        </button>
      </form>

      {/* Inbox */}
      <div className="mt-5 space-y-4">
        {inbox.items.map((item) => (
          <FeedbackCard key={item.id} item={item} />
        ))}

        {inbox.items.length === 0 && (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border px-4 py-14 text-center">
            <Inbox className="mb-3 h-7 w-7 text-muted" />
            <p className="text-sm font-medium text-foreground">
              {params.q
                ? "Nothing matches that search."
                : params.status === FeedbackStatus.NEW
                  ? "Inbox zero — everything has been read."
                  : "Nothing has been marked read yet."}
            </p>
            {params.q && (
              <Link
                href={href({ q: "" })}
                scroll={false}
                className="mt-2 text-sm font-medium text-accent hover:underline"
              >
                Clear search
              </Link>
            )}
          </div>
        )}
      </div>

      {/* Pagination */}
      {inbox.totalPages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
          <PagerLink href={href({ page: inbox.page - 1 })} disabled={inbox.page <= 1}>
            Prev
          </PagerLink>
          <span className="text-sm text-muted">
            Page <span className="font-semibold tabular-nums text-foreground">{inbox.page}</span> of{" "}
            <span className="tabular-nums">{inbox.totalPages}</span>
          </span>
          <PagerLink
            href={href({ page: inbox.page + 1 })}
            disabled={inbox.page >= inbox.totalPages}
          >
            Next
          </PagerLink>
        </nav>
      )}
    </div>
  );
}

function FeedbackCard({ item }: { item: InboxItem }) {
  const authorName = item.user.name ?? "Anonymous";
  const blocked = Boolean(item.user.disabledAt);

  return (
    <article className="glass rounded-3xl p-5">
      {/* Author first: a note is only actionable if you know who is stuck. */}
      <div className="flex flex-wrap items-center gap-3">
        <Avatar name={authorName} src={item.user.image ?? undefined} className="h-9 w-9 text-[11px]" />
        <div className="min-w-0 leading-tight">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <span className="truncate">{authorName}</span>
            {blocked && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-500 ring-1 ring-rose-500/30">
                <ShieldBan className="h-3 w-3" /> Blocked
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted">{item.user.email}</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          {item.rating !== null && <RatingBadge rating={item.rating} />}
          <p className="text-xs text-muted">Sent {timeAgo(item.createdAt)}</p>
        </div>
      </div>

      {/* The note itself. Short by nature, so it is shown in full rather than
          hidden behind a disclosure the way a whole interview write-up is. A
          rating-only submission has no body — the stars above ARE the message,
          so nothing is rendered rather than an empty panel. */}
      {item.body.trim() && (
        <div className="mt-4 rounded-2xl border border-border bg-surface/40 px-4 py-3">
          <FeedbackBody body={item.body} />
        </div>
      )}

      {item.reviewedAt && (
        <p className="mt-3 rounded-xl bg-surface-2/60 px-3.5 py-2.5 text-xs leading-relaxed text-muted">
          Read {timeAgo(item.reviewedAt)}
          {item.reviewedBy && <> by {item.reviewedBy.name ?? item.reviewedBy.email}</>}
        </p>
      )}

      <FeedbackActions id={item.id} status={item.status} authorEmail={item.user.email} />
    </article>
  );
}

/**
 * The score, as filled stars plus its word. Stars alone are hard to count at a
 * glance in a list; the label is what makes a card scannable.
 */
function RatingBadge({ rating }: { rating: number }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-1 ring-1 ring-amber-500/20"
      title={`${rating} of ${FEEDBACK_MAX_RATING} — ${RATING_LABELS[rating] ?? ""}`}
    >
      <span className="flex items-center gap-0.5" aria-hidden>
        {Array.from({ length: FEEDBACK_MAX_RATING }, (_, i) => (
          <Star
            key={i}
            className={`h-3 w-3 ${i < rating ? "fill-amber-400 text-amber-400" : "text-muted/40"}`}
          />
        ))}
      </span>
      <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-300">
        {rating}/{FEEDBACK_MAX_RATING}
      </span>
      <span className="sr-only">
        Rated {rating} out of {FEEDBACK_MAX_RATING}
      </span>
    </span>
  );
}

function PagerLink({
  href,
  disabled,
  children,
}: {
  href: string;
  disabled: boolean;
  children: React.ReactNode;
}) {
  if (disabled) {
    return (
      <span className="glass-pill rounded-full px-4 py-2 text-sm font-medium text-muted opacity-40">
        {children}
      </span>
    );
  }
  return (
    <Link
      href={href}
      // The router's post-navigation scroll is what broke this page: see
      // `ScrollportReset` in the admin layout, which does it properly instead.
      scroll={false}
      className="glass-pill glass-hover rounded-full px-4 py-2 text-sm font-medium text-foreground"
    >
      {children}
    </Link>
  );
}
