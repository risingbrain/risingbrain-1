import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { getQuizTopicBySlug, getTopicSlugById } from "../../_quiz/data";
import { Paper } from "../../_quiz/components/paper";
import { PUZZLES_ROUTE, routeForKind } from "../../_quiz/routes";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const paper = await getQuizTopicBySlug(slug);
  // Unknown / legacy / foreign slugs redirect or 404 below — keep the layout's.
  if (!paper || !PUZZLES_ROUTE.kinds.includes(paper.kind)) return {};
  const n = paper.questions.length;
  return pageMetadata({
    title: `${paper.topicName} Puzzles with Solutions`,
    description: `${n} ${paper.topicName.toLowerCase()} interview puzzle${n === 1 ? "" : "s"} (${paper.categoryName}) with hints and worked solutions — practice the reasoning interviewers test.`,
    path: `${PUZZLES_ROUTE.basePath}/${paper.topicSlug}`,
  });
}

/**
 * One topic's paper, addressed by SLUG. This segment is fetched lazily — only
 * when a topic is navigated to (warmed on hover by the nav's prefetch). It loads
 * ONLY this topic's questions, never the whole bank.
 */
export default async function PuzzlesTopicPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const paper = await getQuizTopicBySlug(slug);

  if (!paper) {
    // Topic URLs used to carry the primary key. A bookmark from that era still
    // resolves — as an id, not a slug — so canonicalise it instead of 404ing.
    const legacy = await getTopicSlugById(slug);
    // Redirect within this route; if the topic actually belongs to the sibling
    // one, the check below bounces it again on the next request.
    if (legacy) redirect(`${PUZZLES_ROUTE.basePath}/${legacy}`);
    notFound();
  }

  // A topic belonging to the sibling route (an old bookmark from before puzzles
  // were split out) renders the right paper under the wrong nav — send it where
  // it lives now instead.
  if (!PUZZLES_ROUTE.kinds.includes(paper.kind)) {
    redirect(`${routeForKind(paper.kind).basePath}/${paper.topicSlug}`);
  }

  return <Paper paper={paper} />;
}
