import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { getQuizTopicBySlug, getTopicSlugById } from "../../_quiz/data";
import { Paper } from "../../_quiz/components/paper";
import { SCREENING_ROUTE, routeForKind } from "../../_quiz/routes";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const paper = await getQuizTopicBySlug(slug);
  // Unknown / legacy / foreign slugs redirect or 404 below — keep the layout's.
  if (!paper || !SCREENING_ROUTE.kinds.includes(paper.kind)) return {};
  const n = paper.questions.length;
  return pageMetadata({
    title: `${paper.topicName} — ${paper.categoryName} Questions & Formulas`,
    description: `Practice ${n} ${paper.topicName.toLowerCase()} question${n === 1 ? "" : "s"} for placement aptitude tests, with key formulas, crisp theory and hints.`,
    path: `${SCREENING_ROUTE.basePath}/${paper.topicSlug}`,
  });
}

/**
 * One topic's paper, addressed by SLUG. This segment is fetched lazily — only
 * when a topic is navigated to (warmed on hover by the nav's prefetch). It loads
 * ONLY this topic's questions, never the whole bank.
 */
export default async function ScreeningTopicPage({
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
    if (legacy) redirect(`${SCREENING_ROUTE.basePath}/${legacy}`);
    notFound();
  }

  // A topic belonging to the sibling route (an old bookmark from before puzzles
  // were split out) renders the right paper under the wrong nav — send it where
  // it lives now instead.
  if (!SCREENING_ROUTE.kinds.includes(paper.kind)) {
    redirect(`${routeForKind(paper.kind).basePath}/${paper.topicSlug}`);
  }

  return <Paper paper={paper} />;
}
