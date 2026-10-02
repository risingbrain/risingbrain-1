/**
 * Shared loader for the Domain section, used by the full seed (prisma/seed.ts), the
 * standalone `db:seed-domain` (scripts/seed-domain.ts) and the per-subject
 * `db:seed-domain-sql` (scripts/seed-domain-sql.ts) so they can never drift.
 *
 * Data sources:
 *   - seed/domain-*.json        — topics + markdown notes per subject (and, for
 *                                 OOPS, the "Mini Project" tab's `miniProject`)
 *   - seed/domain-*-quiz.json   — the practice MCQs, keyed by topic slug
 *
 * The code examples used to live in their own `DomainTopic.example` column behind
 * a second tab; that column is gone, so a topic's inline `example` is APPENDED to
 * its notes as a final "## Example" section — the content survives, the topic
 * just reads top to bottom now.
 *
 * Clears `domain_topics` and reloads it; safe to run repeatedly. `seedDomainSubject()`
 * narrows that to a single subject. Questions cascade with their topic, so
 * deleting the topics clears the old questions too.
 */
import type { PrismaClient, DomainSubject } from "../generated/prisma/client";
import oopsData from "../seed/domain-oops.json";
import dbmsData from "../seed/domain-dbms.json";
import osData from "../seed/domain-os.json";
import cnData from "../seed/domain-cn.json";
import sqlData from "../seed/domain-sql.json";
import dbmsQuiz from "../seed/domain-dbms-quiz.json";
import cnQuiz from "../seed/domain-cn-quiz.json";
import osQuiz from "../seed/domain-os-quiz.json";
import oopsQuiz from "../seed/domain-oops-quiz.json";

// One entry per subject file. Add a subject by dropping its seed JSON in and
// listing it here — the loader, index and UI are all data-driven from this.
const SUBJECT_FILES = [oopsData, dbmsData, osData, cnData, sqlData];

// Practice questions, one file per subject that has them. A subject without a
// quiz file simply shows its notes with no Practice tab.
const QUIZ_FILES = [dbmsQuiz, cnQuiz, osQuiz, oopsQuiz];

export type DomainTopicJson = {
  subject: string;
  groupLabel: string;
  phase?: number;
  groupOrder?: number;
  order: number;
  slug: string;
  title: string;
  summary?: string;
  notes: string;
  /** Inline copy-ready code (SQL), appended to the notes as "## Example". */
  example?: string | null;
  /**
   * Markdown for the "Mini Project" tab — a hands-on design challenge. Only OOPS
   * has these (its modules' Boss Challenges); absent/null means no tab.
   */
  miniProject?: string | null;
  /** Figure count, informational — the figure paths live inline in `notes`. */
  figures?: number;
};

type DomainQuestionJson = {
  subject: string;
  /** `DomainTopic.slug` this question belongs to. */
  topicSlug: string;
  order: number;
  prompt: string;
  options: Array<{ key: string; label: string }>;
  answerKey: string;
  explanation?: string | null;
  difficulty?: string | null;
};

/**
 * Retry a DB op through transient connection drops. Hosted Postgres (Neon) auto-
 * suspends its compute when idle, so the first few ops after a pause can fail
 * with ETIMEDOUT / "Connection terminated" while it cold-starts.
 */
async function withRetry<T>(fn: () => Promise<T>, label: string, tries = 6): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= tries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < tries) await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw new Error(`${label} failed after ${tries} attempts: ${String(lastErr)}`);
}

/**
 * The `notes` a topic's ROW carries, which is not the same string as the one in
 * the seed file: an inline code example is appended as a final "## Example"
 * section (see the file header — there is no `example` column any more).
 *
 * Exported because anything that writes `domain_topics.notes` from the seed has
 * to apply this same fold, or it silently drops the example. `repair-domain-notes.ts`
 * is the other such writer.
 */
export function notesForTopic(t: DomainTopicJson): string {
  const example = t.example;
  return example ? `${t.notes.trimEnd()}\n\n## Example\n\n${example.trim()}\n` : t.notes;
}

/** Map one seed-JSON topic onto a `domain_topics` row. */
function toRow(t: DomainTopicJson) {
  const notes = notesForTopic(t);
  return {
    subject: t.subject as DomainSubject,
    slug: t.slug,
    title: t.title,
    groupLabel: t.groupLabel,
    groupOrder: t.groupOrder ?? t.phase ?? 0,
    summary: t.summary ?? null,
    notes,
    miniProject: t.miniProject?.trim() ? t.miniProject : null,
    order: t.order,
  };
}

/** Does this topic ship a code example? Reporting only. */
function hasExample(t: DomainTopicJson): boolean {
  return Boolean(t.example);
}

/**
 * Fail the seed on a duplicate (subject, slug).
 *
 * That pair is the topic's PUBLIC URL (`/domain/<subject>/<slug>`) and the table's
 * unique key, so a collision is an authoring mistake in the seed JSON. Reported
 * here, by name, rather than left to surface as a Prisma unique-violation — and
 * never auto-numbered, which would silently hand a topic a URL nobody chose.
 *
 * Reuse ACROSS subjects is fine and expected: "views" is both a SQL and a DBMS
 * topic, and the subject segment keeps them apart.
 */
function assertUniqueSlugs(data: ReturnType<typeof toRow>[]) {
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const t of data) {
    const key = `${t.subject}/${t.slug}`;
    if (seen.has(key)) dupes.push(key);
    seen.add(key);
  }
  if (dupes.length) {
    throw new Error(
      `Duplicate topic slug(s) in the seed JSON: ${[...new Set(dupes)].join(", ")}. ` +
        `Slugs are URLs — rename one in seed/domain-<subject>.json.`
    );
  }
}

/** Insert in small batches so a single dropped connection retries cheaply. */
async function insertRows(prisma: PrismaClient, data: ReturnType<typeof toRow>[]) {
  assertUniqueSlugs(data);
  for (let i = 0; i < data.length; i += 10) {
    const batch = data.slice(i, i + 10);
    await withRetry(() => prisma.domainTopic.createMany({ data: batch }), `insert batch @${i}`);
  }
}

/**
 * Load the practice questions for the topics just inserted. Resolves each
 * question's `topicSlug` against the rows in the DB, so a question whose topic
 * was renamed or dropped is reported rather than silently lost.
 */
async function insertQuestions(
  prisma: PrismaClient,
  subjects: DomainSubject[]
): Promise<number> {
  const questions = (QUIZ_FILES.flat() as DomainQuestionJson[]).filter((q) =>
    subjects.includes(q.subject as DomainSubject)
  );
  if (questions.length === 0) return 0;

  const topics = await withRetry(
    () =>
      prisma.domainTopic.findMany({
        where: { subject: { in: subjects } },
        select: { id: true, slug: true, subject: true },
      }),
    "load topic ids"
  );
  // Keyed by subject AND slug, matching `DomainTopic`'s `@@unique([subject, slug])`.
  // Slugs are only unique WITHIN a subject — "views" already exists under both SQL
  // and DBMS — so a slug-only map silently kept whichever row came last and
  // attached questions to the wrong subject's topic, without tripping the
  // unknown-slug warning below.
  const topicKey = (subject: string, slug: string) => `${subject}\u0000${slug}`;
  const idByKey = new Map(topics.map((t) => [topicKey(t.subject, t.slug), t.id]));

  const rows = [];
  for (const q of questions) {
    const topicId = idByKey.get(topicKey(q.subject, q.topicSlug));
    if (!topicId) {
      console.warn(
        `⚠️  question for unknown topic "${q.subject}/${q.topicSlug}" — skipped`
      );
      continue;
    }
    rows.push({
      topicId,
      prompt: q.prompt,
      options: q.options,
      answerKey: q.answerKey,
      explanation: q.explanation ?? null,
      difficulty: (q.difficulty ?? null) as never,
      order: q.order,
    });
  }

  for (let i = 0; i < rows.length; i += 20) {
    const batch = rows.slice(i, i + 20);
    await withRetry(
      () => prisma.domainQuestion.createMany({ data: batch }),
      `insert questions @${i}`
    );
  }
  return rows.length;
}

export async function seedDomain(
  prisma: PrismaClient
): Promise<{ topics: number; withExample: number; questions: number }> {
  const topics = SUBJECT_FILES.flat() as DomainTopicJson[];

  // Warm the connection (cold-start safe) before mutating.
  await withRetry(() => prisma.domainTopic.count(), "warm-up");
  await withRetry(() => prisma.domainTopic.deleteMany(), "clear domain_topics");

  const data = topics.map(toRow);
  await insertRows(prisma, data);
  const subjects = [...new Set(data.map((d) => d.subject))];
  const questions = await insertQuestions(prisma, subjects);
  return { topics: topics.length, withExample: topics.filter(hasExample).length, questions };
}

/**
 * Reseed ONE subject in place — clears only that subject's rows and reloads them,
 * leaving the other subjects (and every other table) untouched. Backs
 * `db:seed-domain-sql`, so re-extracting one PDF doesn't disturb the rest.
 */
export async function seedDomainSubject(
  prisma: PrismaClient,
  subject: DomainSubject
): Promise<{ topics: number; withExample: number; questions: number }> {
  const topics = (SUBJECT_FILES.flat() as DomainTopicJson[]).filter((t) => t.subject === subject);
  if (topics.length === 0) throw new Error(`No seed topics found for subject ${subject}`);

  await withRetry(() => prisma.domainTopic.count(), "warm-up");
  // Questions cascade with their topic, so this clears the subject's old
  // practice sets as well. A learner's answers cascade too — the questions they
  // referred to no longer exist after a content reseed.
  await withRetry(
    () => prisma.domainTopic.deleteMany({ where: { subject } }),
    `clear domain_topics (${subject})`
  );

  const data = topics.map(toRow);
  await insertRows(prisma, data);
  const questions = await insertQuestions(prisma, [subject]);
  return { topics: topics.length, withExample: topics.filter(hasExample).length, questions };
}
