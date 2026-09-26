import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo";
import { Suspense } from "react";
import { Container } from "@/components/marketing/primitives";
import { getCurrentUser } from "@/lib/auth/current-user";
import { QuizWorkspace } from "../_quiz/components/workspace";
import { QuizWorkspaceSkeleton } from "../_quiz/components/workspace-skeleton";
import { PUZZLES_ROUTE } from "../_quiz/routes";

export const metadata: Metadata = pageMetadata({
  title: "Interview Puzzles with Solutions",
  description: "Classic interview puzzles — logic, deduction, weighing, binary tricks and optimisation — with worked solutions and diagrams.",
  path: "/puzzles",
});

/**
 * `/puzzles` shell. Uses a parallel route: the `@nav` slot (left index) and the
 * `children` slot (the `[topicId]` paper) render side by side and stream
 * independently. This layout persists across topic navigations, so the live
 * progress provider is seeded ONCE here and the per-topic paper loads lazily.
 *
 * The workspace itself is shared with the sibling quiz route — see
 * `_quiz/routes.ts` for what differs between them.
 *
 * Publicly accessible — guests can read all questions, but interactive actions
 * (selecting answers, hints, submitting) redirect to /login via paper-attempt.tsx.
 *
 * SCROLL MODEL (desktop): this route fills the shell's center column and scrolls
 * its two panes independently — the topic index and the paper each own a
 * scrollport, so neither drags the other out of view. `data-fills-scrollport` is
 * what opts into that (see the rule of the same name in globals.css); without it
 * the shared page-enter wrapper sizes to content and both panes lose their
 * height, collapsing back to one page-level scroll.
 */
export default async function PuzzlesLayout({
  children,
  nav,
}: {
  children: React.ReactNode;
  nav: React.ReactNode;
}) {
  const user = await getCurrentUser();

  return (
    <main data-fills-scrollport className="flex-1 lg:flex lg:min-h-0 lg:flex-col">
      {/* On desktop the panes fill the shell, so a full `py-8` bottom gutter is
          just dead space under them — trim it and give the rows the height. */}
      <Container
        tight
        className="py-6 sm:py-8 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:pt-5 lg:pb-3"
      >
        <Suspense fallback={<QuizWorkspaceSkeleton />}>
          <QuizWorkspace
            profileId={user?.id ?? null}
            kinds={PUZZLES_ROUTE.kinds}
            basePath={PUZZLES_ROUTE.basePath}
            emptyLabel={PUZZLES_ROUTE.emptyLabel}
            nav={nav}
          >
            {children}
          </QuizWorkspace>
        </Suspense>
      </Container>
    </main>
  );
}
