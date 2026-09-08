"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Loader2,
  MessageSquarePlus,
  Send,
  TriangleAlert,
  X,
} from "lucide-react";
import { FEEDBACK_PENDING_LIMIT, type FeedbackQuota } from "@/lib/feedback";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/editor/rich-text-editor";
import { RatingStars } from "./rating-stars";
import { apiFetch } from "@/lib/api-fetch";

/**
 * The feedback composer — the modal behind the floating button and behind a
 * star clicked on the nudge.
 *
 * It writes through the SAME editor the interview composer and the note modal
 * use, so someone who has written one of those already knows this surface, and
 * the body lands in the database as markdown like every other user-authored body
 * in the app.
 *
 * A user may hold at most `FEEDBACK_PENDING_LIMIT` UNREAD notes. That ceiling is
 * enforced by `POST /api/feedback`; what this adds is saying so BEFORE they
 * write — the quota is fetched when the panel opens, and when it is used up the
 * editor is replaced by the explanation, rather than letting someone type out a
 * paragraph and lose it to a 429.
 */

type Phase = "loading" | "writing" | "blocked" | "sent";

export function FeedbackPanel({
  onClose,
  initialRating = 0,
  /** Called once feedback is actually filed — retires the one-time nudge. */
  onSent,
}: {
  onClose: () => void;
  initialRating?: number;
  onSent?: () => void;
}) {
  const router = useRouter();
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [quota, setQuota] = useState<FeedbackQuota | null>(null);
  const [rating, setRating] = useState(initialRating);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc closes + lock body scroll while open (same contract as the composer).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !sending) onClose();
    }
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose, sending]);

  // Quota first: whether there is an editor to render at all depends on it.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch("/api/feedback");
        if (res.status === 401) {
          router.push("/login");
          return;
        }
        const data = (await res.json()) as FeedbackQuota;
        if (cancelled) return;
        setQuota(data);
        setPhase(data.remaining > 0 ? "writing" : "blocked");
      } catch {
        if (cancelled) return;
        // A quota we couldn't read is not a reason to refuse the write — the
        // server checks it again anyway, and failing closed here would hide the
        // form over a network blip.
        setPhase("writing");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function send() {
    setError(null);
    const editor = editorRef.current;
    const html = editor?.getHTML() ?? "";
    const hasText = Boolean((editor?.getText() ?? "").trim());
    // A lone star is a valid submission; an empty one isn't. Mirrors the check
    // the route makes, so the two can't disagree about what "empty" means.
    if (!hasText && rating === 0) {
      setError("Leave a rating or write something first.");
      return;
    }

    setSending(true);
    try {
      const res = await apiFetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: hasText ? html : "", rating: rating || null }),
      });
      if (res.status === 401) {
        router.push("/login");
        return;
      }
      const data = (await res.json()) as Partial<FeedbackQuota> & {
        id?: string;
        error?: string;
      };
      setSending(false);

      if (res.status === 429) {
        // Raced past the pre-check (or the panel was left open while the quota
        // changed) — swap to the same explanation the pre-check shows.
        if (typeof data.remaining === "number") setQuota(data as FeedbackQuota);
        setPhase("blocked");
        return;
      }
      if (!res.ok || !data.id) {
        setError(data.error ?? "Something went wrong. Please try again.");
        return;
      }
      if (typeof data.remaining === "number") setQuota(data as FeedbackQuota);
      onSent?.();
      setPhase("sent");
    } catch {
      setSending(false);
      setError("Network error. Please try again.");
    }
  }

  return createPortal(
    <div
      className="animate-in fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={() => !sending && onClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Send feedback"
        onClick={(e) => e.stopPropagation()}
        className="glass flex max-h-[94vh] w-full max-w-lg flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-rb-green-500/15 text-accent ring-1 ring-rb-green-500/20">
              <MessageSquarePlus className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-accent">
                Feedback
              </p>
              <h3 className="text-base font-semibold text-foreground">Tell us what to fix</h3>
            </div>
          </div>
          <button
            type="button"
            onClick={() => !sending && onClose()}
            aria-label="Close"
            className="glass-pill grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {phase === "loading" && (
          <div className="grid place-items-center px-6 py-16">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </div>
        )}

        {phase === "blocked" && <LimitNotice quota={quota} onClose={onClose} />}

        {phase === "sent" && <SentReceipt quota={quota} onClose={onClose} />}

        {phase === "writing" && (
          <>
            <div className="flex-1 space-y-4 overflow-y-auto bg-surface/30 px-5 py-5">
              {/* Rating first: it is one tap, it is optional, and asking for it
                  after a paragraph has been written is asking someone who is
                  already done. */}
              <div className="rounded-2xl border border-border bg-surface/40 px-4 py-3.5">
                <p className="mb-1.5 text-center text-xs font-medium text-muted">
                  How is RisingBrain working out for you?
                  <span className="ml-1 font-normal text-muted/70">· optional</span>
                </p>
                <RatingStars value={rating} onChange={setRating} />
              </div>

              <div>
                <p className="mb-1.5 text-sm leading-relaxed text-muted">
                  A bug, something confusing, or a feature you wish existed — it all lands in
                  front of the team.
                </p>
                <RichTextEditor
                  ref={editorRef}
                  ariaLabel="Your feedback"
                  placeholder="What happened, and what did you expect instead?"
                  minHeightClass="min-h-[160px]"
                  autoFocus
                />
              </div>

              {quota && (
                <p className="text-xs text-muted">
                  {quota.remaining} of {quota.limit} slots left — you can send up to{" "}
                  {FEEDBACK_PENDING_LIMIT} at a time, and they free up once we have read them.
                </p>
              )}
              {error && (
                <p
                  role="alert"
                  className="rounded-xl bg-rose-500/10 px-3.5 py-2.5 text-sm text-rose-600 ring-1 ring-rose-500/20 dark:text-rose-300"
                >
                  {error}
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
              <button
                type="button"
                onClick={() => !sending && onClose()}
                className="glass-pill rounded-full px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void send()}
                disabled={sending}
                className="btn-glow inline-flex items-center gap-1.5 rounded-full bg-rb-green-500 px-5 py-2 text-sm font-semibold text-black transition-opacity disabled:opacity-70"
              >
                {sending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Send className="h-4 w-4" /> Send feedback
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The rate-limit warning. It replaces the editor rather than sitting above a
 * disabled one: the useful thing to communicate is not "the button is off" but
 * *why*, and that the block lifts on its own once the queue is read.
 */
function LimitNotice({ quota, onClose }: { quota: FeedbackQuota | null; onClose: () => void }) {
  const limit = quota?.limit ?? FEEDBACK_PENDING_LIMIT;
  return (
    <div className="px-6 py-10 text-center sm:px-10">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-amber-500/15 text-amber-500 ring-1 ring-amber-500/20">
        <TriangleAlert className="h-7 w-7" />
      </span>
      <h3 className="mt-6 text-xl font-bold tracking-tight text-foreground">
        You&rsquo;ve hit your feedback limit
      </h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        You have {quota?.pending ?? limit} pieces of feedback waiting to be read, which is the
        maximum of {limit}. This isn&rsquo;t a timeout — as soon as the team reads what you
        already sent, your slots come back and you can write again.
      </p>
      <button
        type="button"
        onClick={onClose}
        className="glass-pill mt-7 inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-foreground"
      >
        Got it
      </button>
    </div>
  );
}

function SentReceipt({ quota, onClose }: { quota: FeedbackQuota | null; onClose: () => void }) {
  return (
    <div className="px-6 py-10 text-center sm:px-10">
      <span className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-rb-green-500/15 text-accent ring-1 ring-rb-green-500/20">
        <CheckCircle2 className="h-7 w-7" />
      </span>
      <h3 className="mt-6 text-xl font-bold tracking-tight text-foreground">Thanks — got it</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
        Your feedback is in front of the team.{" "}
        {quota?.remaining === 0
          ? "That was your last open slot — you can send more once we've read these."
          : `You can send ${quota?.remaining ?? ""} more while these are unread.`}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="btn-glow mt-7 inline-flex items-center gap-2 rounded-full bg-rb-green-500 px-6 py-2.5 text-sm font-semibold text-black"
      >
        Done
      </button>
    </div>
  );
}
