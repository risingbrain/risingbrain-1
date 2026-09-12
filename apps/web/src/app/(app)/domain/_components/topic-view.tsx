import { ReadingTabs, ReadingTabProvider } from "@/components/notes/reading-tabs";
import { NotesToc } from "@/components/notes/notes-toc";
import { extractToc } from "@/lib/markdown-toc";
import { NotesMarkdown } from "./notes-markdown";
import { PracticeAttemptProvider } from "./practice-attempt";
import { DomainQuestionCard } from "./question-card";
import { SubmitBar, TopRetakeButton } from "./submit-bar";
import { TopicProgressBar } from "./topic-progress-bar";
import { TopicSummary } from "./topic-summary";
import { DomainTopicPager } from "./topic-pager";
import type { DomainTopicDetail } from "../_data";

/**
 * One topic's content pane — rendered by the `[topicId]` segment, so it only ever
 * holds the topic in the URL (the lazy split). A header (subject → group → title)
 * over a Notes | Practice switch. The markdown is rendered on the SERVER; the
 * client JS is the tab toggle, the practice attempt and the contents rail.
 *
 * LAYOUT. Two columns, centred in the pane:
 *
 *   [ reading sheet — grows ]  [ On this page — 14rem, xl and up ]
 *
 * The row is capped and centred rather than left to fill, because filling looked
 * broken at width: the prose keeps its own measure (see `--prose-measure`), so a
 * sheet stretched across a 2000px pane put ~600px of text against ~700px of empty
 * space, all of it on the right. Whitespace split evenly either side reads as a
 * margin; the same amount on one side reads as a bug.
 *
 * The ladder, so the numbers are checkable:
 *
 *   ≥1280  row 70rem = sheet 54rem + gap + rail 14rem
 *   <1280  row 54rem, rail hidden, sheet takes it all
 *   ≤1080  pane is narrower than the cap, so the sheet simply fills the pane
 *
 * 54rem is chosen against the measure, not picked: 38rem of text plus the sheet's
 * own padding, leaving enough for tables, code and diagrams — which are read
 * across rather than along — to run visibly wider than the paragraphs.
 */
export function TopicView({ topic }: { topic: DomainTopicDetail }) {
  const questions = topic.questions;
  // Read from the markdown source, so the rail server-renders with the notes.
  const toc = extractToc(topic.notes);

  const practice =
    questions.length > 0 ? (
      <>
        {/* Questions — paper style */}
        <ol className="divide-y divide-border/60">
          {questions.map((q, i) => (
            <li key={q.id}>
              <DomainQuestionCard question={q} index={i + 1} />
            </li>
          ))}
        </ol>
        <SubmitBar />
      </>
    ) : null;

  return (
    // The whole topic shares one attempt, so the header's Retake button can react
    // to submission state alongside the questions and the SubmitBar. The tab
    // provider wraps the rail too — it hides itself while Practice is open.
    <PracticeAttemptProvider topicId={topic.id} questionIds={questions.map((q) => q.id)}>
      <ReadingTabProvider>
        {/* Horizontal gutters come from the page <Container>, the scrollbar gutter
            from the pane in `workspace.tsx`; only the bottom gutter is ours, so
            the sheet's last edge isn't flush against the scroll end. */}
        <div className="mb-10 flex items-start gap-8">
          <article className="reading-surface min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-9">
            {/* Header */}
            <header className="mb-8 border-b border-reading-border pb-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-accent">
                {topic.subjectLabel} · {topic.groupLabel}
              </p>
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                {/* A step above the prose's own h1 so the topic title still reads
                    as the page's title once the notes below carry headings. */}
                <h1 className="max-w-[24ch] text-[1.7rem] font-bold leading-[1.15] tracking-tight text-balance text-foreground sm:text-[2rem]">
                  {topic.title}
                </h1>
                <TopRetakeButton />
              </div>
              {topic.summary ? <TopicSummary summary={topic.summary} /> : null}
              <TopicProgressBar topicId={topic.id} total={questions.length} />
            </header>

            <ReadingTabs
              notes={<NotesMarkdown source={topic.notes} />}
              practice={practice}
              questionCount={questions.length}
            />

            {/* Foot of the sheet, OUTSIDE the tabs on purpose: a learner who has
                read the notes and doesn't want the practice set should still be
                able to move on without going back to the index. */}
            <DomainTopicPager />
          </article>

          <NotesToc items={toc} />
        </div>
      </ReadingTabProvider>
    </PracticeAttemptProvider>
  );
}
