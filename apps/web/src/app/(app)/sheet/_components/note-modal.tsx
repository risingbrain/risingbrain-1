"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, Loader2, X } from "lucide-react";
import {
  RichTextEditor,
  type RichTextEditorHandle,
} from "@/components/editor/rich-text-editor";
import { apiFetch } from "@/lib/api-fetch";

type SaveStatus = "idle" | "unsaved" | "saving" | "saved";

const AUTOSAVE_MS = 2000;

/**
 * Floating, glass-themed note editor built on the shared `RichTextEditor` — the
 * same surface the interview composer uses, so formatting behaves identically in
 * both places. The editor's HTML is persisted as the note `content` via GET/PUT.
 *
 * Underline IS offered here, unlike in the composer: a note is stored as HTML and
 * read back as HTML, so the styling survives. An interview body is converted to
 * markdown, which has no underline.
 *
 * Auto-saves 2s after the user stops typing — but only once they've actually
 * edited (opening a note never writes a row), and an emptied note deactivates the
 * row rather than storing an empty entry. Pending edits are flushed on close.
 */
export function NoteModal({
  problemId,
  title,
  onClose,
  onSaved,
}: {
  problemId: string;
  title: string;
  onClose: () => void;
  onSaved: (hasNote: boolean) => void;
}) {
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [initialHtml, setInitialHtml] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [words, setWords] = useState(0);
  const [status, setStatus] = useState<SaveStatus>("idle");

  // dirty = the user has edited since the last successful save (gates autosave
  // so we never persist an untouched/empty note).
  const dirtyRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Loading is derived from the fetched content so the editor mounts in the SAME
  // render the content arrives in — it takes its initial value as a prop, and
  // mounting it empty first would leave it empty.
  const loading = initialHtml === null;

  useEffect(() => setMounted(true), []);

  const countWords = useCallback(() => {
    const text = editorRef.current?.getText().trim() ?? "";
    setWords(text ? text.split(/\s+/).length : 0);
  }, []);

  // Persist the current editor content. An empty/whitespace-only note sends ""
  // so the API deletes the row instead of storing an empty entry.
  const persist = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    // An editor holding only empty paragraphs still reports HTML, so the text is
    // what decides whether there is a note — otherwise clearing one would store
    // "<p></p>" forever instead of deactivating the row.
    const content = editor.getText().trim() ? editor.getHTML() : "";
    setStatus("saving");
    try {
      const res = await apiFetch(`/api/sheet/notes/${problemId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      // A non-2xx (e.g. session expired → 401, or rate-limited → 429) still
      // resolves the fetch. Treat it as a failure so we don't clear the dirty
      // flag / "has note" dot and falsely report "Saved".
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      const data = (await res.json()) as { hasNote?: boolean };
      onSaved(Boolean(data.hasNote));
      dirtyRef.current = false;
      setStatus("saved");
    } catch {
      setStatus("unsaved"); // keep dirty so a later flush retries
    }
  }, [problemId, onSaved]);

  // Debounced autosave — armed only by real edits.
  const scheduleAutosave = useCallback(() => {
    dirtyRef.current = true;
    setStatus("unsaved");
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      void persist();
    }, AUTOSAVE_MS);
  }, [persist]);

  const handleInput = useCallback(() => {
    countWords();
    scheduleAutosave();
  }, [countWords, scheduleAutosave]);

  // Flush any pending edit, then close.
  const handleClose = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (dirtyRef.current) await persist();
    onClose();
  }, [persist, onClose]);

  // Fetch the existing note content.
  useEffect(() => {
    let active = true;
    fetch(`/api/sheet/notes/${problemId}`)
      .then((r) => (r.ok ? r.json() : { content: "" }))
      .then((d: { content?: string }) => {
        if (active) setInitialHtml(d.content ?? "");
      })
      .catch(() => {
        if (active) setInitialHtml("");
      });
    return () => {
      active = false;
    };
  }, [problemId]);

  // The editor is mounted with `initialHTML` once the fetch resolves, so there is
  // nothing to seed by hand. Seeding via `content` also means TipTap never emits
  // an update for it, so loading a note can't arm autosave.
  useEffect(() => {
    if (initialHtml !== null) countWords();
  }, [initialHtml, countWords]);

  // Esc closes (flushing first) + lock body scroll. Clear any pending timer on
  // unmount so a late autosave can't fire after the modal is gone.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") void handleClose();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [handleClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="animate-in fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={() => void handleClose()}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Note for ${title}`}
        onClick={(e) => e.stopPropagation()}
        className="glass flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl sm:rounded-3xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            <p className="text-[11px] font-medium uppercase tracking-wide text-accent">Note</p>
            <h3 className="truncate text-base font-semibold text-foreground">{title}</h3>
          </div>
          <button
            type="button"
            onClick={() => void handleClose()}
            aria-label="Close"
            className="glass-pill grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* The "page" — the shared writing surface */}
        <div className="flex-1 overflow-y-auto bg-surface/40 p-4 sm:p-5">
          {loading ? (
            <div className="mx-auto max-w-3xl">
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                Loading note…
              </div>
              <div className="space-y-3" aria-hidden>
                <div className="h-3.5 w-2/3 animate-pulse rounded-full bg-surface-2" />
                <div className="h-3.5 w-full animate-pulse rounded-full bg-surface-2" />
                <div className="h-3.5 w-5/6 animate-pulse rounded-full bg-surface-2" />
                <div className="h-3.5 w-3/4 animate-pulse rounded-full bg-surface-2" />
              </div>
            </div>
          ) : (
            <div className="mx-auto max-w-3xl">
              <RichTextEditor
                ref={editorRef}
                initialHTML={initialHtml ?? ""}
                onUpdate={handleInput}
                ariaLabel="Note body"
                placeholder="Jot your approach, edge cases, complexity, and gotchas…"
                // Notes are stored and read back as HTML, so underline survives.
                allowUnderline
                minHeightClass="min-h-[240px] sm:min-h-[320px]"
                autoFocus
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3.5">
          <div className="flex items-center gap-3">
            <span className="text-xs tabular-nums text-muted">
              {words} {words === 1 ? "word" : "words"}
            </span>
            <SaveIndicator status={status} />
          </div>
          <button
            type="button"
            onClick={() => void handleClose()}
            className="btn-glow inline-flex items-center gap-1.5 rounded-full bg-rb-green-500 px-4 py-2 text-xs font-semibold text-black transition-opacity"
          >
            Done
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  if (status === "saving") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted">
        <Loader2 className="h-3 w-3 animate-spin" /> Saving…
      </span>
    );
  }
  if (status === "saved") {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-accent">
        <Check className="h-3 w-3" /> Saved
      </span>
    );
  }
  // unsaved
  return <span className="text-xs text-muted">Unsaved changes…</span>;
}
