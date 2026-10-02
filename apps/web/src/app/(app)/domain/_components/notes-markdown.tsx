import { isValidElement, type ReactNode } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { NotesFigure } from "@/components/notes-figure";
import { createHeadingIds } from "@/lib/markdown-toc";

/**
 * Renders a Domain topic's `notes` markdown — theory, diagrams and worked code
 * examples, all in the one body — into the topic view. Server Component: no
 * client JS is shipped for the content.
 *
 * - `remark-gfm` → GitHub tables / strikethrough / task-lists.
 * - `##`/`###` headings get ids, so the "On this page" rail can link into them.
 *   The ids come from `createHeadingIds()`, the SAME generator `extractToc()`
 *   uses, walked in the same order — that is what keeps the rail's links and the
 *   document's anchors in agreement when a title repeats.
 * - Diagram `<img>`s point at `/study-notes/<subject>/<topic-slug>/fig-N.png`
 *   (static assets under `public/`, extracted from the source PDFs by
 *   packages/database/scripts/extract-sql-pdf.py and friends). The DB holds only
 *   markdown with those relative paths, so swapping to a CDN later is a base-path
 *   change. `NotesFigure` sizes each one from its own intrinsic dimensions.
 *
 * Styling lives in `globals.css` under `.notes-prose` (shared with Screening).
 */

/** The visible text of a rendered heading, for slugging. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return "";
}

function buildComponents(): Components {
  // One generator per render, consumed in document order by the heading
  // renderers below — react-markdown walks the tree depth-first, so the call
  // order here matches the line order `extractToc` reads.
  const nextId = createHeadingIds();

  return {
    // Wrap tables so wide reference grids scroll inside the card instead of
    // forcing the whole view to overflow horizontally.
    table: ({ children }) => (
      <div className="table-wrap">
        <table>{children}</table>
      </div>
    ),
    img: NotesFigure,
    h2: ({ children }) => <h2 id={nextId(textOf(children))}>{children}</h2>,
    h3: ({ children }) => <h3 id={nextId(textOf(children))}>{children}</h3>,
  };
}

export function NotesMarkdown({
  source,
  variant = "notes",
}: {
  source: string;
  /** "prompt" sets a practice question's prompt: the card's type, tight blocks. */
  variant?: "notes" | "prompt";
}) {
  return (
    <div className={variant === "prompt" ? "notes-prose notes-prompt" : "notes-prose"}>
      <Markdown remarkPlugins={[remarkGfm]} components={buildComponents()}>
        {source}
      </Markdown>
    </div>
  );
}