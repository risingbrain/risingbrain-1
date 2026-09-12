import { QuestionCard } from "./question-card";
import { TopicProgressBar } from "./topic-progress-bar";
import { PaperAttemptProvider } from "./paper-attempt";
import { NotesMarkdown } from "./notes-markdown";
import { SubmitBar, TopRetakeButton } from "./submit-bar";
import { PaperPager } from "./paper-pager";
import { ReadingTabs, ReadingTabProvider } from "@/components/notes/reading-tabs";
import { NotesToc } from "@/components/notes/notes-toc";
import { extractToc } from "@/lib/markdown-toc";
import type { AptPaper } from "../data";

/**
 * One topic's exam paper. Rendered by the `[topicId]` segment — so it only ever
 * holds the questions for the topic in the URL (the lazy split). The header bar
 * and per-question dots stay live via the shared progress provider.
 *
 * Inside the header, the body is a Notes | Practice switch (`ReadingTabs`): the
 * learner lands on the topic's notes (theory + diagrams, rendered from markdown
 * held in `QuizTopic.theory`) and flips to the graded questions when ready.
 *
 * A topic may have either side alone. Quant/reasoning topics with no theory open
 * straight on Practice; the puzzle bank is the mirror image — content-only, with
 * the statement, diagram, hint and answer all in `theory` and NO questions at
 * all, so `ReadingTabs` drops the Practice tab and it reads as a single page.
 *
 * LAYOUT AND SHEET are shared with the Domain topic view, deliberately — see the
 * note there. The two sections are the same activity (read the material, answer
 * on it), and a learner moving between them should not have to re-learn where
 * the content starts or where the contents list lives.
 */
export function Paper({ paper }: { paper: AptPaper }) {
  const hasNotes = Boolean(paper.theory);
  /** Puzzles are content-only: notes carry the statement, hint and answer. */
  const hasQuestions = paper.questions.length > 0;
  // Read from the markdown source, so the rail server-renders with the notes.
  const toc = paper.theory ? extractToc(paper.theory) : [];

  const practice = (
    <>
      {/* Questions — paper style */}
      <ol className="divide-y divide-border/60">
        {paper.questions.map((q, i) => (
          <li key={q.id}>
            <QuestionCard
              question={{
                id: q.id,
                prompt: q.prompt,
                options: q.options,
                difficulty: q.difficulty,
                hint: q.hint,
              }}
              index={i + 1}
            />
          </li>
        ))}
      </ol>
      <SubmitBar />
    </>
  );

  return (
    // Whole paper shares one attempt so the header's Retake button can react to
    // submission state alongside the questions and bottom SubmitBar.
    <PaperAttemptProvider
      topicId={paper.topicId}
      questionIds={paper.questions.map((q) => q.id)}
    >
      <ReadingTabProvider initial={hasNotes ? "notes" : "practice"}>
        {/* Horizontal gutters come from the page <Container>, the scrollbar
            gutter from the pane in `workspace.tsx`; only the bottom gutter is
            ours, so the sheet's last edge isn't flush against the scroll end. */}
        <div className="mb-10 flex items-start gap-8">
          <div className="reading-surface min-w-0 flex-1 px-5 py-6 sm:px-8 sm:py-8 lg:px-10 lg:py-9">
            {/* Header */}
            <header className="mb-8 border-b border-reading-border pb-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.09em] text-accent">
                {paper.categoryName}
              </p>
              <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
                {/* A step above the notes' own h1, so the paper title still reads
                    as the page's title once the theory below carries headings. */}
                <h3 className="max-w-[24ch] text-[1.7rem] font-bold leading-[1.15] tracking-tight text-balance text-foreground sm:text-[2rem]">
                  {paper.topicName}
                </h3>
                {/* Content-only topics (the puzzle bank) carry no graded
                    questions, so the count, the Retake button and the progress
                    bar would all render as an empty "0 questions" shell. Show
                    the whole cluster only when there is something to grade. */}
                {hasQuestions ? (
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="text-sm text-muted">
                      {paper.questions.length} question{paper.questions.length === 1 ? "" : "s"}
                    </span>
                    <TopRetakeButton />
                  </div>
                ) : null}
              </div>
              {hasQuestions ? (
                <TopicProgressBar topicId={paper.topicId} total={paper.questions.length} />
              ) : null}
            </header>

            <ReadingTabs
              questionCount={paper.questions.length}
              notes={
                paper.theory ? (
                  <NotesMarkdown
                    source={paper.theory}
                    // Puzzles carry their answer in the notes; the other kinds
                    // grade it, so only this one gets the solution panel.
                    highlightAnswers={paper.kind === "PUZZLE"}
                  />
                ) : null
              }
              practice={practice}
            />

            {/* Foot of the sheet, OUTSIDE the tabs on purpose: a learner who has
                read the notes and doesn't want the practice set should still be
                able to move on without going back to the index. */}
            <PaperPager />
          </div>

          <NotesToc items={toc} />
        </div>
      </ReadingTabProvider>
    </PaperAttemptProvider>
  );
}
