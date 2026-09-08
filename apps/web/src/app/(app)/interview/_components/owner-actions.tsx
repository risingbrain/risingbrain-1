"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2, TriangleAlert, X } from "lucide-react";
import { Composer, type ExperienceDraft } from "./composer";
import { apiFetch } from "@/lib/api-fetch";

/**
 * Edit / delete controls, rendered only for the author of an experience.
 *
 * The draft is fetched on demand rather than shipped with the page: converting
 * the stored markdown back to editor HTML is real work, and almost every view of
 * a post is a read. Server-side authorship is re-checked by the endpoint, so
 * hiding these buttons is presentation, not access control.
 */
export function OwnerActions({ experienceId }: { experienceId: string }) {
  const router = useRouter();
  const [draft, setDraft] = useState<ExperienceDraft | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function openEditor() {
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch(`/api/interview/${experienceId}`, { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      setDraft((await res.json()) as ExperienceDraft);
    } catch {
      setError("Couldn't open the editor. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function remove() {
    setError(null);
    setDeleting(true);
    try {
      const res = await apiFetch(`/api/interview/${experienceId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      setConfirming(false);
      // Back to the feed — the post no longer resolves.
      router.push("/interview");
      router.refresh();
    } catch {
      setError("Couldn't delete this experience. Please try again.");
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void openEditor()}
          disabled={loading}
          className="glass-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground disabled:opacity-60"
        >
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Pencil className="h-3.5 w-3.5" />
          )}
          Edit
        </button>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="glass-pill inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-rose-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Delete
        </button>
      </div>

      {error && (
        <p className="mt-2 text-xs text-rose-600 dark:text-rose-300" role="alert">
          {error}
        </p>
      )}

      {draft && (
        <Composer
          initial={draft}
          onClose={() => setDraft(null)}
          onSaved={() => setDraft(null)}
        />
      )}

      {confirming && (
        <ConfirmDelete
          busy={deleting}
          onCancel={() => !deleting && setConfirming(false)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  );
}

function ConfirmDelete({
  busy,
  onCancel,
  onConfirm,
}: {
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="animate-in fixed inset-0 z-[110] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onCancel}
      role="presentation"
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="delete-experience-title"
        onClick={(e) => e.stopPropagation()}
        className="glass w-full max-w-md overflow-hidden rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-rose-500/15 text-rose-500 ring-1 ring-rose-500/20">
              <TriangleAlert className="h-5 w-5" />
            </span>
            <h3 id="delete-experience-title" className="text-base font-semibold text-foreground">
              Delete this experience?
            </h3>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel"
            className="glass-pill grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="px-5 py-5 text-sm leading-relaxed text-muted">
          It will be removed from the feed and its link will stop working. Replies
          people left on it are kept, so nothing anyone else wrote is lost.
        </p>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            className="glass-pill rounded-full px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            Keep it
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-full bg-rose-500 px-4 py-2 text-sm font-semibold text-white transition-opacity disabled:opacity-70"
          >
            {busy ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Deleting…
              </>
            ) : (
              <>
                <Trash2 className="h-4 w-4" /> Delete
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
