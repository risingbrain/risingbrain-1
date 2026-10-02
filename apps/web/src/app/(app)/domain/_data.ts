import { cacheLife, cacheTag } from "next/cache";
import type { DomainSubject } from "@risingbrain/database/enums";
import { prisma } from "@/lib/db";
import { CACHE_TAGS } from "@/lib/cache";
import { SUBJECT_META, SUBJECT_ORDER } from "./_categories";

/**
 * Loaders for the Domain workspace (core-CS subjects: OOPS / SQL / DBMS / OS / CN).
 *
 * Split like Screening so we never ship every topic's body up front:
 *  - `getDomainIndex` — light: the subjects that have published topics, each with
 *    its nav groups (title + slug + summary + question count only). Feeds the
 *    tabs, `@nav` slot and mobile picker. DATA-DRIVEN — a subject appears only
 *    once it has content.
 *  - `getDomainTopic` — heavy: ONE topic's notes markdown and its practice
 *    questions, fetched per-route when navigated to (lazy). Never the answer
 *    keys — grading happens server-side in `/api/domain/submit`, so a key only
 *    ever reaches the client in the review payload of a set the learner has
 *    already submitted.
 *
 * Both are SHARED, seeded, cookie-free content (identical for everyone, changes
 * only on a re-seed), so — like the DSA/quiz catalogs — they use `"use cache"`
 * with the `domainCatalog` tag for cross-request caching + on-demand revalidation
 * (see /api/admin/revalidate). Per-user graded state comes from
 * `getDomainProgressSeed` below, which is deliberately NOT cached.
 */

export type DomainNavTopic = {
  id: string;
  slug: string;
  title: string;
  summary: string | null;
};
export type DomainNavGroup = { label: string; order: number; topics: DomainNavTopic[] };
export type DomainSubjectIndex = {
  subject: DomainSubject;
  label: string;
  blurb: string;
  groups: DomainNavGroup[];
  total: number;
};

/** Light index — the populated subjects and their grouped topic names. Cached. */
export async function getDomainIndex(): Promise<{ subjects: DomainSubjectIndex[]; total: number }> {
  "use cache";
  cacheLife("hours");
  cacheTag(CACHE_TAGS.domainCatalog);

  const rows = await prisma.domainTopic.findMany({
    where: { isPublished: true },
    orderBy: [{ subject: "asc" }, { groupOrder: "asc" }, { order: "asc" }],
    select: {
      id: true,
      slug: true,
      title: true,
      summary: true,
      subject: true,
      groupLabel: true,
      groupOrder: true,
    },
  });

  // Bucket rows → subject → group, preserving DB order.
  const bySubject = new Map<DomainSubject, Map<string, DomainNavGroup>>();
  for (const r of rows) {
    let groups = bySubject.get(r.subject);
    if (!groups) {
      groups = new Map();
      bySubject.set(r.subject, groups);
    }
    let group = groups.get(r.groupLabel);
    if (!group) {
      group = { label: r.groupLabel, order: r.groupOrder, topics: [] };
      groups.set(r.groupLabel, group);
    }
    group.topics.push({
      id: r.id,
      slug: r.slug,
      title: r.title,
      summary: r.summary,
    });
  }

  // Emit in the configured display order; only subjects that actually have topics.
  const subjects: DomainSubjectIndex[] = [];
  for (const subject of SUBJECT_ORDER) {
    const groups = bySubject.get(subject);
    if (!groups || groups.size === 0) continue;
    const meta = SUBJECT_META[subject];
    const groupList = [...groups.values()].sort((a, b) => a.order - b.order);
    subjects.push({
      subject,
      label: meta.label,
      blurb: meta.blurb,
      groups: groupList,
      total: groupList.reduce((s, g) => s + g.topics.length, 0),
    });
  }

  return { subjects, total: subjects.reduce((s, x) => s + x.total, 0) };
}

/** First topic in display order — `/domain` redirects here so it's never empty. */
export async function getFirstTopic(): Promise<{ subject: DomainSubject; slug: string } | null> {
  const { subjects } = await getDomainIndex();
  for (const s of subjects) {
    for (const g of s.groups) {
      if (g.topics[0]) return { subject: s.subject, slug: g.topics[0].slug };
    }
  }
  return null;
}

/** First topic of ONE subject — `/domain/<subject>` opens straight into it. */
export async function getFirstTopicOfSubject(subject: DomainSubject): Promise<string | null> {
  const { subjects } = await getDomainIndex();
  const s = subjects.find((x) => x.subject === subject);
  for (const g of s?.groups ?? []) {
    if (g.topics[0]) return g.topics[0].slug;
  }
  return null;
}

/**
 * Resolve a legacy `/domain/<cuid>` link to its subject + slug.
 *
 * Topic URLs carried the primary key before this route was nested, and those ids
 * are not even stable — a domain reseed deletes and recreates every row — so the
 * lookup may well miss. It costs one indexed read to avoid 404ing a live link.
 */
export async function getTopicLocationById(
  id: string
): Promise<{ subject: DomainSubject; slug: string } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(CACHE_TAGS.domainCatalog);

  const t = await prisma.domainTopic.findFirst({
    where: { id, isPublished: true },
    select: { subject: true, slug: true },
  });
  return t;
}

export type DomainOption = { key: string; label: string };

export type DomainPracticeQuestion = {
  id: string;
  prompt: string;
  options: DomainOption[];
  difficulty: "EASY" | "MEDIUM" | "HARD" | null;
};

export type DomainTopicDetail = {
  id: string;
  slug: string;
  title: string;
  subject: DomainSubject;
  subjectLabel: string;
  groupLabel: string;
  summary: string | null;
  notes: string;
  /** Markdown for the "Mini Project" tab; null = the topic has none (no tab). */
  miniProject: string | null;
  questions: DomainPracticeQuestion[];
};

/**
 * Per-topic loader — only this topic's notes, mini project and questions ship, and NO answer
 * key. It reads no cookies (the learner's marks come from the client provider),
 * so the `[subject]/[slug]` segment is statically prefetchable: hovering a nav
 * item warms and caches the content, making the click feel instant.
 *
 * Addressed by (subject, slug) — the pair the table already declares unique.
 * Slugs repeat across subjects ("views" is both a SQL and a DBMS topic), which is
 * precisely why the subject is in the URL.
 */
export async function getDomainTopic(
  subject: DomainSubject,
  slug: string
): Promise<DomainTopicDetail | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(CACHE_TAGS.domainCatalog);

  const t = await prisma.domainTopic.findFirst({
    where: { subject, slug, isPublished: true },
    select: {
      id: true,
      slug: true,
      title: true,
      subject: true,
      groupLabel: true,
      summary: true,
      notes: true,
      miniProject: true,
      questions: {
        orderBy: { order: "asc" },
        select: { id: true, prompt: true, options: true, difficulty: true },
      },
    },
  });
  if (!t) return null;

  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    subject: t.subject,
    subjectLabel: SUBJECT_META[t.subject].label,
    groupLabel: t.groupLabel,
    summary: t.summary,
    notes: t.notes,
    miniProject: t.miniProject,
    questions: t.questions.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      options: (q.options as unknown as DomainOption[]) ?? [],
      difficulty: q.difficulty,
    })),
  };
}

/** A submitted question's full outcome — only exists once a practice set is graded. */
export type DomainReviewEntry = {
  selectedKey: string;
  isCorrect: boolean;
  answerKey: string;
  explanation: string | null;
};

export type DomainProgressSeed = {
  /** Per-question review, keyed by questionId. Present only for submitted topics. */
  reviewByQuestion: Record<string, DomainReviewEntry>;
  /** The stored mark per submitted topic — drives the nav counters and score bar. */
  submittedTopics: Record<string, { score: number; total: number }>;
};

/**
 * The signed-in learner's graded Domain state in two queries, seeded once into
 * the client provider by the layout. Rows exist ONLY after a practice set is
 * submitted, so shipping answer keys/explanations here is fine (the learner has
 * earned them) — and it keeps `[topicId]` cookie-free → fully prefetchable.
 *
 * Separate from Screening's `getProgressSeed`: these are different tables and a
 * learner's aptitude score is not their domain score (see DomainQuestion).
 */
export async function getDomainProgressSeed(userId: string): Promise<DomainProgressSeed> {
  const [rows, scores] = await Promise.all([
    prisma.userDomainQuizProgress.findMany({
      where: { userId, isActive: true },
      select: {
        questionId: true,
        selectedKey: true,
        isCorrect: true,
        question: { select: { answerKey: true, explanation: true } },
      },
    }),
    prisma.userDomainTopicScore.findMany({
      where: { userId },
      select: { topicId: true, score: true, total: true },
    }),
  ]);

  const reviewByQuestion: Record<string, DomainReviewEntry> = {};
  for (const r of rows) {
    reviewByQuestion[r.questionId] = {
      selectedKey: r.selectedKey,
      isCorrect: r.isCorrect,
      answerKey: r.question.answerKey,
      explanation: r.question.explanation,
    };
  }
  const submittedTopics: Record<string, { score: number; total: number }> = {};
  for (const s of scores) submittedTopics[s.topicId] = { score: s.score, total: s.total };

  return { reviewByQuestion, submittedTopics };
}
