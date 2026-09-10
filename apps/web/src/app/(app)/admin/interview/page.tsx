import Link from "next/link";
import {
  ExternalLink,
  Inbox,
  Layers,
  MessageCircle,
  Search,
  ShieldBan,
  ThumbsUp,
} from "lucide-react";
import { PublishStatus } from "@risingbrain/database/enums";
import { cn } from "@risingbrain/ui/cn";
import { Avatar } from "@/components/marketing/primitives";
import { ExperienceBody } from "@/app/(app)/interview/_components/experience-body";
import {
  DIFFICULTY_META,
  REVIEW_STATUS_META,
  VERDICT_META,
  monogram,
  timeAgo,
} from "@/app/(app)/interview/_lib/format";
import { getReviewQueue, parseQueueParams, QUEUE_TABS, type QueueItem } from "./_data";
import { ReviewActions } from "./_components/review-actions";

/**
 * The interview approval queue.
 *
 * `/interview` accepts a write-up from anyone with an account, so nothing posted
 * there is publicly readable until it is approved here. Each card carries the
 * whole submission — metadata, tags and the full body — because a moderator
 * cannot rule on a post they can only see 180 characters of.
 *
 * Server-rendered on purpose: the body is markdown, and rendering it here reuses
 * the reader's own `ExperienceBody` pipeline (same sanitisation, same styles)
 * instead of shipping a second markdown renderer to the browser. Only the ruling
 * buttons are a client island.
 */

const TAB_LABEL: Record<(typeof QUEUE_TABS)[number], string> = {
  [PublishStatus.PENDING_REVIEW]: "Pending",
  [PublishStatus.PUBLISHED]: "Published",
  [PublishStatus.REJECTED]: "Rejected",
  [PublishStatus.ARCHIVED]: "Archived",
};

export default async function AdminInterviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = parseQueueParams(await searchParams);
  const queue = await getReviewQueue(params);

  /** Build a queue URL, keeping the current filter unless it is overridden. */
  const href = (updates: Partial<{ status: string; q: string; page: number }>) => {
    const sp = new URLSearchParams();
    const next = { status: params.status, q: params.q, page: 1, ...updates };
    if (next.status !== PublishStatus.PENDING_REVIEW) sp.set("status", next.status);
    if (next.q) sp.set("q", next.q);
    if (next.page > 1) sp.set("page", String(next.page));
    const qs = sp.toString();
    return qs ? `/admin/interview?${qs}` : "/admin/interview";
  };

  return (
    <div className="mx-auto max-w-4xl px-4 pb-10 pt-6 sm:px-6">
      <p className="max-w-prose text-sm leading-relaxed text-muted">
        Every experience submitted on <span className="text-foreground">/interview</span> waits here
        before it reaches the feed. Approve it, send it back with a note, remove it, or block the
        account behind it. Editing a post puts it back in this queue.
      </p>

      {/* Status tabs. Links, not buttons — the queue is a server read, so each
          tab is a real URL you can bookmark, share and reload. */}
      <div className="mt-5 flex flex-wrap gap-1.5">
        {QUEUE_TABS.map((s) => {
          const active = params.status === s;
          const count = queue.counts[s];
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
                  // The pending badge is the one number that means "there is work
                  // to do", so it keeps its colour on the inactive tabs too.
                  s === PublishStatus.PENDING_REVIEW && count > 0
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
      <form action="/admin/interview" method="get" className="mt-4 flex gap-2">
        {params.status !== PublishStatus.PENDING_REVIEW && (
          <input type="hidden" name="status" value={params.status} />
        )}
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            name="q"
            defaultValue={params.q}
            type="search"
            placeholder="Company, role, title or author email…"
            aria-label="Search submissions"
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

      {/* Queue */}
      <div className="mt-5 space-y-4">
        {queue.items.map((item) => (
          <SubmissionCard key={item.id} item={item} />
        ))}

        {queue.items.length === 0 && (
          <div className="grid place-items-center rounded-2xl border border-dashed border-border px-4 py-14 text-center">
            <Inbox className="mb-3 h-7 w-7 text-muted" />
            <p className="text-sm font-medium text-foreground">
              {params.q
                ? "Nothing matches that search."
                : params.status === PublishStatus.PENDING_REVIEW
                  ? "The queue is empty — everything has been reviewed."
                  : `No ${TAB_LABEL[params.status].toLowerCase()} experiences.`}
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
      {queue.totalPages > 1 && (
        <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
          <PagerLink href={href({ page: queue.page - 1 })} disabled={queue.page <= 1}>
            Prev
          </PagerLink>
          <span className="text-sm text-muted">
            Page <span className="font-semibold tabular-nums text-foreground">{queue.page}</span> of{" "}
            <span className="tabular-nums">{queue.totalPages}</span>
          </span>
          <PagerLink
            href={href({ page: queue.page + 1 })}
            disabled={queue.page >= queue.totalPages}
          >
            Next
          </PagerLink>
        </nav>
      )}
    </div>
  );
}

function SubmissionCard({ item }: { item: QueueItem }) {
  const verdict = VERDICT_META[item.verdict];
  const difficulty = DIFFICULTY_META[item.difficulty];
  const review = REVIEW_STATUS_META[item.status];
  const VerdictIcon = verdict.icon;
  const authorName = item.author.name ?? "Anonymous";
  const blocked = Boolean(item.author.disabledAt);
  const edited = item.updatedAt.getTime() - item.createdAt.getTime() > 60_000;

  return (
    <article className="glass rounded-3xl p-5">
      {/* Company / role / verdict */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-rb-green-400/25 to-rb-green-600/10 text-sm font-bold text-accent ring-1 ring-rb-green-500/20">
            {monogram(item.company)}
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-semibold leading-tight text-foreground">{item.company}</h2>
            <p className="truncate text-sm text-muted">{item.role}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${review.pill}`}>
            {review.label}
          </span>
          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold ${verdict.pill}`}>
            <VerdictIcon className="h-3.5 w-3.5" />
            {verdict.label}
          </span>
        </div>
      </div>

      <h3 className="mt-4 font-semibold leading-snug text-foreground">{item.title}</h3>
      {item.excerpt && (
        <p className="mt-1.5 text-sm leading-relaxed text-muted">{item.excerpt}</p>
      )}

      {/* Meta chips */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${difficulty.pill}`}>
          {difficulty.label}
        </span>
        <span className="glass-pill inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-muted">
          <Layers className="h-3 w-3" />
          {item.roundsCount} {item.roundsCount === 1 ? "round" : "rounds"}
        </span>
        <span className="glass-pill inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-muted">
          <ThumbsUp className="h-3 w-3" />
          {item.likeCount}
        </span>
        <span className="glass-pill inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium text-muted">
          <MessageCircle className="h-3 w-3" />
          {item._count.comments}
        </span>
        {item.tags.map((t) => (
          <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-muted">
            {t}
          </span>
        ))}
      </div>

      {/* Author */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3.5">
        <Avatar name={authorName} src={item.author.image ?? undefined} className="h-8 w-8 text-[10px]" />
        <div className="min-w-0 leading-tight">
          <p className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <span className="truncate">{authorName}</span>
            {blocked && (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-500 ring-1 ring-rose-500/30">
                <ShieldBan className="h-3 w-3" /> Blocked
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted">{item.author.email}</p>
        </div>
        <p className="ml-auto text-xs text-muted">
          Submitted {timeAgo(item.createdAt)}
          {edited && <> · edited {timeAgo(item.updatedAt)}</>}
        </p>
      </div>

      {/* Previous ruling, when there is one. */}
      {item.reviewedAt && (
        <p className="mt-3 rounded-xl bg-surface-2/60 px-3.5 py-2.5 text-xs leading-relaxed text-muted">
          Last reviewed {timeAgo(item.reviewedAt)}
          {item.reviewedBy && <> by {item.reviewedBy.name ?? item.reviewedBy.email}</>}
          {item.reviewNote && (
            <>
              {" "}
              — <span className="text-foreground">“{item.reviewNote}”</span>
            </>
          )}
        </p>
      )}

      {/* The write-up itself. Collapsed by default so the queue stays scannable;
          `<details>` keeps that behaviour without any client JS. */}
      <details className="group mt-3">
        <summary className="glass-pill inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full px-3.5 py-1.5 text-xs font-medium text-accent">
          <span className="group-open:hidden">Read the full write-up</span>
          <span className="hidden group-open:inline">Hide the write-up</span>
        </summary>
        {/* `-mt-4` trims `ExperienceBody`'s own `mt-8`, which is sized for the
            reading page's header, not for a collapsed panel. */}
        <div className="-mt-4 max-h-[28rem] overflow-y-auto rounded-2xl border border-border bg-surface/40 px-4 pb-4">
          <ExperienceBody body={item.body} />
        </div>
      </details>

      {item.status === PublishStatus.PUBLISHED && (
        <Link
          href={`/interview/${item.slug}`}
          target="_blank"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-accent"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open on the feed
        </Link>
      )}

      <ReviewActions
        id={item.id}
        status={item.status}
        authorEmail={item.author.email}
        authorBlocked={blocked}
        authorIsAdmin={item.author.role === "ADMIN"}
      />
    </article>
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
      // See `ScrollportReset` in the admin layout — the router's own
      // post-navigation scroll shifts the fixed shell off-screen here.
      scroll={false}
      className="glass-pill glass-hover rounded-full px-4 py-2 text-sm font-medium text-foreground"
    >
      {children}
    </Link>
  );
}
