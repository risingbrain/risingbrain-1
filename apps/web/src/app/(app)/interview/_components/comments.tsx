"use client";

import Link from "next/link";
import { useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { Avatar } from "@/components/marketing/primitives";
import type { CommentItem } from "../_lib/types";
import { apiFetch } from "@/lib/api-fetch";

/**
 * Comments island for the detail page. Renders the existing thread and, for
 * signed-in users, a composer that appends the new comment optimistically on
 * success. Signed-out visitors see a sign-in prompt instead.
 */
export function Comments({
  experienceId,
  initialComments,
  signedIn,
}: {
  experienceId: string;
  initialComments: CommentItem[];
  signedIn: boolean;
}) {
  const [comments, setComments] = useState<CommentItem[]>(initialComments);
  const [body, setBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const text = body.trim();
    if (!text || posting) return;
    setError(null);
    setPosting(true);
    try {
      const res = await apiFetch(`/api/interview/${experienceId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: text }),
      });
      const data = (await res.json()) as { comment?: CommentItem; error?: string };
      if (!res.ok || !data.comment) {
        setError(data.error ?? "Could not post your comment.");
        return;
      }
      setComments((c) => [...c, data.comment!]);
      setBody("");
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setPosting(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="mb-5 flex items-center gap-2 text-lg font-semibold text-foreground">
        <MessageCircle className="h-5 w-5 text-accent" />
        Discussion
        <span className="text-sm font-normal text-muted">({comments.length})</span>
      </h2>

      {/* Composer */}
      {signedIn ? (
        <div className="glass mb-6 rounded-2xl p-4">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            placeholder="Add a thoughtful question or share a tip…"
            className="w-full resize-y rounded-xl border border-border bg-surface/60 px-3.5 py-2.5 text-sm text-foreground outline-none transition-colors placeholder:text-muted focus:border-rb-green-500/50 focus:ring-2 focus:ring-rb-green-500/20"
          />
          {error && (
            <p className="mt-2 text-sm text-rose-600 dark:text-rose-300">{error}</p>
          )}
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={posting || !body.trim()}
              className="btn-glow inline-flex items-center gap-1.5 rounded-full bg-rb-green-500 px-4 py-2 text-sm font-semibold text-black transition-opacity disabled:opacity-60"
            >
              {posting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Posting…
                </>
              ) : (
                <>
                  <Send className="h-4 w-4" /> Post comment
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <div className="glass mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-4">
          <p className="text-sm text-muted">Sign in to join the discussion.</p>
          <Link
            href="/login"
            className="btn-glow rounded-full bg-rb-green-500 px-4 py-2 text-sm font-semibold text-black"
          >
            Sign in to comment
          </Link>
        </div>
      )}

      {/* Thread */}
      {comments.length === 0 ? (
        <p className="text-sm text-muted">No comments yet — be the first to respond.</p>
      ) : (
        <ul className="space-y-4">
          {comments.map((c) => {
            const name = c.author.name ?? "Anonymous";
            return (
              <li key={c.id} className="glass rounded-2xl p-4">
                <div className="mb-2 flex items-center gap-2.5">
                  <Avatar name={name} src={c.author.image ?? undefined} className="h-8 w-8 text-[11px]" />
                  <div className="leading-tight">
                    <p className="text-sm font-medium text-foreground">{name}</p>
                    <p className="text-[11px] text-muted">{c.createdAtLabel}</p>
                  </div>
                </div>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {c.body}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
