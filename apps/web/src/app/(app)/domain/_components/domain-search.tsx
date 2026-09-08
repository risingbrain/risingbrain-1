"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Search, X } from "lucide-react";
import type { DomainSubject } from "@risingbrain/database/enums";
import { domainTopicHref } from "../_categories";
import { apiFetch } from "@/lib/api-fetch";

type Suggestion = {
  id: string;
  slug: string;
  subject: DomainSubject;
  title: string;
  subjectLabel: string;
  groupLabel: string;
  summary: string | null;
};

/**
 * Server-side topic search for the Domain workspace.
 *
 * The input is debounced (250ms) and every keystroke query is answered by the
 * `/api/domain/search` route — ALL matching/ranking happens on the SERVER against
 * the DB, so topic bodies never ship to the browser just to be searched. An
 * in-flight request is aborted when a newer one starts (no out-of-order results),
 * and picking a suggestion navigates to `/domain/<subject>/<slug>` (prefetched on hover).
 */
export function DomainSearch() {
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced, cancellable fetch against the server search route.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/domain/search?q=${encodeURIComponent(q)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) throw new Error("search failed");
        const data = (await res.json()) as { results: Suggestion[] };
        setResults(data.results);
        setActive(0);
        setOpen(true);
      } catch (err) {
        if ((err as Error).name !== "AbortError") setResults([]);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [query]);

  // Close on outside click.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  function go(s: Suggestion) {
    setOpen(false);
    setQuery("");
    router.push(domainTopicHref(s.subject, s.slug));
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = results[active];
      if (s) go(s);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  const showPanel = open && query.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative w-full sm:max-w-md">
      <div className="glass-pill flex items-center gap-2 rounded-xl px-3.5 py-2.5">
        <Search className="h-4 w-4 shrink-0 text-muted" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length && setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search topics — e.g. polymorphism, SOLID…"
          aria-label="Search Domain topics"
          aria-expanded={showPanel}
          aria-controls={listId}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
        />
        {loading ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted" aria-label="Searching" />
        ) : query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setResults([]);
            }}
            aria-label="Clear search"
            className="shrink-0 text-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {showPanel ? (
        <ul
          id={listId}
          role="listbox"
          className="glass absolute z-30 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl p-1.5 shadow-xl"
        >
          {results.length === 0 && !loading ? (
            <li className="px-3 py-4 text-center text-sm text-muted">No topics match “{query}”.</li>
          ) : (
            results.map((s, i) => (
              <li key={s.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => {
                    setActive(i);
                    router.prefetch(domainTopicHref(s.subject, s.slug));
                  }}
                  onClick={() => go(s)}
                  className={`flex w-full flex-col gap-0.5 rounded-xl px-3 py-2 text-left transition-colors ${
                    i === active ? "bg-rb-green-500/15" : "hover:bg-surface-2"
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {s.title}
                    </span>
                    <span className="shrink-0 rounded-full bg-surface-2 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                      {s.subjectLabel}
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted">{s.groupLabel}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}
