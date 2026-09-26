import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { pageMetadata } from "@/lib/seo";
import { getDomainTopic } from "../../_data";
import { SUBJECT_BY_SLUG, domainTopicHref } from "../../_categories";
import { TopicView } from "../../_components/topic-view";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ subject: string; slug: string }>;
}): Promise<Metadata> {
  const { subject: subjectSlug, slug } = await params;
  const subject = SUBJECT_BY_SLUG[subjectSlug];
  const topic = subject ? await getDomainTopic(subject, slug) : null;
  if (!topic) return {};
  return pageMetadata({
    title: `${topic.title} in ${topic.subjectLabel} — Notes & Interview Questions`,
    description:
      topic.summary ??
      `${topic.title} (${topic.subjectLabel}) explained for interviews — focused notes, worked examples and ${topic.questions.length} practice MCQs.`,
    path: domainTopicHref(topic.subject, topic.slug),
  });
}

/**
 * One topic's content, addressed by `<subject>/<slug>`. This segment is fetched
 * lazily — only when a topic is navigated to (warmed on hover by the nav's
 * prefetch). It loads ONLY this topic's notes + practice questions, never the
 * whole subject. Reads no cookies → fully prefetchable (the learner's marks come
 * from the layout-seeded provider).
 */
export default async function DomainTopicPage({
  params,
}: {
  params: Promise<{ subject: string; slug: string }>;
}) {
  const { subject: subjectSlug, slug } = await params;

  const subject = SUBJECT_BY_SLUG[subjectSlug];
  if (!subject) notFound();

  const topic = await getDomainTopic(subject, slug);
  if (!topic) notFound();

  return <TopicView topic={topic} />;
}
