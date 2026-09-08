/**
 * DSA-only updater — applies packages/database/seed/dsa.json to the database
 * WITHOUT running the full seed (which wipes quizzes, domain, courses,
 * interviews and companies via clearContent()).
 *
 * Use this when you already have data in the DB and only want to refresh /
 * extend the DSA sheets (e.g. after adding the SBC sheet).
 *
 *   bun run scripts/update-dsa.ts            # upsert + prune rows absent from JSON
 *   bun run scripts/update-dsa.ts --no-prune # upsert only, never delete
 *   bun run scripts/update-dsa.ts --dry-run  # run for real against the DB, inside a
 *                                             # transaction that is always rolled back —
 *                                             # prints the exact same diff/prune summary
 *                                             # with nothing committed. Combine with
 *                                             # --no-prune to preview upserts only.
 *
 * Why upsert (not delete + recreate): UserProblemProgress and UserProblemNote
 * FK to DsaProblem.id (cuid) with onDelete: Cascade. We upsert every row by its
 * stable slug so ids never change — so existing user progress, bookmarks and
 * notes are preserved. Only Dsa* and Company tables are touched.
 *
 * Slug rules mirror prisma/seed.ts exactly (same iteration order + uniqueSlug),
 * so slugs line up with whatever a full seed produced.
 *
 * ── Why this is written as read → diff → batch-write ────────────────────────
 * The obvious shape — `await prisma.x.upsert()` inside the nested JSON loops —
 * costs one blocking network round trip PER ROW: 39 companies + 191
 * sheet/topic/pattern + 623 problems + a delete/insert pair per problem for its
 * company tags ≈ 2000 sequential round trips. Against a hosted Postgres at
 * ~50ms RTT that is ~100s of pure latency, almost all of it spent re-writing
 * rows that were already identical.
 *
 * So instead each level does: ONE findMany of what's there, an in-memory diff,
 * then `createMany` for new rows and a bounded-concurrency batch of updates for
 * the rows that actually drifted. A re-run with an unchanged dsa.json touches
 * nothing and costs ~10 queries; a run that adds a sheet costs a handful more.
 * Company tags are reconciled the same way — only for problems whose tag set
 * changed — instead of being dropped and rebuilt for all 623 every time.
 */
import { PrismaClient, Difficulty, Prisma } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

import dsaData from "../seed/dsa.json";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const PRUNE = !process.argv.includes("--no-prune");
const DRY_RUN = process.argv.includes("--dry-run");

/** The subset of the client every function below actually calls — satisfied by
 * both the real PrismaClient and an interactive-transaction client, so the
 * whole pipeline can run unmodified against either. */
type Db = Pick<
  PrismaClient,
  "company" | "dsaSheet" | "dsaTopic" | "dsaPattern" | "dsaProblem" | "problemCompany"
>;

/** Thrown at the end of a dry-run transaction to force Prisma to roll it back
 * without treating the run itself as an error. */
class DryRunRollback extends Error {}

/**
 * How many UPDATEs we let run at once. There is no single-statement bulk update
 * in Prisma, so changed rows go out concurrently instead — the pg pool (10 by
 * default) is the real ceiling, this just stops us queueing thousands of
 * promises against it at once.
 */
const UPDATE_CONCURRENCY = 16;
/** Rows per createMany. Well under Postgres's 65535 bind-parameter cap. */
const INSERT_CHUNK = 1000;

// ---- helpers (kept in sync with prisma/seed.ts) ----
function slugify(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function toDifficulty(v: string | undefined): Difficulty {
  const up = (v ?? "MEDIUM").toUpperCase();
  if (up === "EASY") return Difficulty.EASY;
  if (up === "HARD") return Difficulty.HARD;
  return Difficulty.MEDIUM;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Run `fn` over every item, at most `UPDATE_CONCURRENCY` in flight. */
async function inBatches<T>(items: T[], fn: (item: T) => Promise<unknown>): Promise<void> {
  for (const batch of chunk(items, UPDATE_CONCURRENCY)) await Promise.all(batch.map(fn));
}

type Fields = Record<string, unknown>;
/** A row we want in the DB: `key` is its natural key, `fields` is what we'd write. */
type Desired<F extends Fields> = { key: string; fields: F };

// Written as `type` (not `interface`) on purpose: only a type alias picks up the
// implicit index signature that satisfies `F extends Fields` in `diffRows`.
type TopicFields = {
  sheetId: string;
  slug: string;
  name: string;
  description: string | null;
  order: number;
};
type PatternFields = {
  topicId: string;
  slug: string;
  name: string;
  strategy: string | null;
  identification: string | null;
  order: number;
};
type ProblemFields = {
  patternId: string;
  slug: string;
  title: string;
  reference: string | null;
  difficulty: Difficulty;
  leetcodeUrl: string | null;
  gfgUrl: string | null;
  youtubeUrl: string | null;
  order: number;
};

/**
 * Split desired rows against what's already stored. A row that exists and whose
 * every written field already matches produces no work at all — that's what
 * makes an unchanged re-run nearly free.
 */
function diffRows<F extends Fields>(
  desired: Desired<F>[],
  existing: Map<string, { id: string } & Fields>
): { creates: Desired<F>[]; updates: { id: string; fields: F }[]; unchanged: number } {
  const creates: Desired<F>[] = [];
  const updates: { id: string; fields: F }[] = [];
  let unchanged = 0;

  for (const row of desired) {
    const current = existing.get(row.key);
    if (!current) {
      creates.push(row);
      continue;
    }
    const drifted = Object.keys(row.fields).some((k) => current[k] !== row.fields[k]);
    if (drifted) updates.push({ id: current.id, fields: row.fields });
    else unchanged++;
  }
  return { creates, updates, unchanged };
}

/**
 * Collapse rows that share a natural key, first occurrence winning.
 *
 * A per-row `upsert` loop absorbs a duplicate key silently (the second write
 * just updates the first row). `createMany` does not — it would send both rows
 * and take a unique-constraint violation. dsa.json has exactly one such case
 * today ("PayPal" and "Paypal" both slugify to `paypal`), and it is the kind of
 * typo that recurs, so guard the whole shape rather than that one pair.
 */
function dedupe<F extends Fields>(rows: Desired<F>[], label: string): Desired<F>[] {
  const byKey = new Map<string, Desired<F>>();
  const collisions: string[] = [];
  for (const row of rows) {
    if (byKey.has(row.key)) collisions.push(row.key);
    else byKey.set(row.key, row);
  }
  if (collisions.length)
    console.log(`   ⚠ ${label}: ${collisions.length} duplicate key(s) collapsed: ${[...new Set(collisions)].join(", ")}`);
  return [...byKey.values()];
}

/**
 * The ids of exactly the rows dsa.json asked for — the "seen" set that prune
 * spares. It must come from the desired keys, NOT from `map.values()`: after an
 * insert we refetch the whole table, so the map also holds rows that are no
 * longer in the JSON and are precisely what prune is meant to remove.
 *
 * A missing key means an insert silently didn't land. Throw rather than hand a
 * short list to a `deleteMany` that cascades user progress.
 */
function resolveIds<F extends Fields>(
  desired: Desired<F>[],
  ids: Map<string, string>,
  label: string
): string[] {
  return desired.map((row) => {
    const id = ids.get(row.key);
    if (!id) throw new Error(`${label}: no id for "${row.key}" after write — aborting before prune`);
    return id;
  });
}

function summarise(label: string, n: { creates: unknown[]; updates: unknown[]; unchanged: number }) {
  console.log(
    `   ${label.padEnd(9)} +${n.creates.length} new, ~${n.updates.length} changed, ${n.unchanged} unchanged`
  );
}

// Brand domains → Clearbit logos (must match prisma/seed.ts COMPANY_DOMAINS).
const COMPANY_DOMAINS: Record<string, string> = {
  Adobe: "adobe.com",
  Amazon: "amazon.com",
  Apple: "apple.com",
  Atlassian: "atlassian.com",
  Bloomberg: "bloomberg.com",
  ByteDance: "bytedance.com",
  "DE Shaw": "deshaw.com",
  Facebook: "facebook.com",
  Flipkart: "flipkart.com",
  Freshworks: "freshworks.com",
  "Goldman Sachs": "goldmansachs.com",
  Google: "google.com",
  Intuit: "intuit.com",
  Accenture: "accenture.com",
  Capgemini: "capgemini.com",
  Cognizant: "cognizant.com",
  HCL: "hcltech.com",
  Infosys: "infosys.com",
  TCS: "tcs.com",
  Wipro: "wipro.com",
  LinkedIn: "linkedin.com",
  Meta: "meta.com",
  Microsoft: "microsoft.com",
  "Morgan Stanley": "morganstanley.com",
  Myntra: "myntra.com",
  Ola: "olacabs.com",
  Oracle: "oracle.com",
  PayPal: "paypal.com",
  Paytm: "paytm.com",
  PhonePe: "phonepe.com",
  Samsung: "samsung.com",
  "Sumo Logic": "sumologic.com",
  Swiggy: "swiggy.com",
  Uber: "uber.com",
  Walmart: "walmart.com",
  Zoho: "zoho.com",
  Zomato: "zomato.com",
};

function logoFor(name: string, sourceLogo?: string): string | null {
  const domain = COMPANY_DOMAINS[name];
  if (domain) return `https://logo.clearbit.com/${domain}`;
  return sourceLogo ?? null;
}

// ---- JSON types (subset of seed.ts) ----
type DsaProblemJson = {
  id: string;
  title: string;
  reference?: string;
  difficulty?: string;
  leetcodeUrl?: string;
  gfgUrl?: string;
  youtubeUrl?: string;
  companies?: { name: string; logo?: string }[];
};
type DsaSubtopicJson = {
  name: string;
  order?: number;
  strategy?: string;
  identification?: string;
  problems: DsaProblemJson[];
};
type DsaTopicJson = { name: string; description?: string; subtopics: DsaSubtopicJson[] };
type DsaSheetJson = {
  name: string;
  description?: string;
  order?: number;
  topics: DsaTopicJson[];
};

const sheets = (dsaData as { sheets: DsaSheetJson[] }).sheets;

async function upsertCompanies(db: Db): Promise<Map<string, string>> {
  const names = new Map<string, string | undefined>();
  for (const sheet of sheets)
    for (const topic of sheet.topics)
      for (const sub of topic.subtopics)
        for (const p of sub.problems)
          for (const c of p.companies ?? []) if (!names.has(c.name)) names.set(c.name, c.logo);

  const desired = dedupe(
    [...names].map(([name, logo]) => ({
      key: slugify(name),
      fields: { name, logoUrl: logoFor(name, logo) },
    })),
    "companies"
  );

  const existing = await db.company.findMany({
    select: { id: true, slug: true, name: true, logoUrl: true },
  });
  const bySlug = new Map(existing.map((c) => [c.slug, c]));

  const { creates, updates, unchanged } = diffRows(desired, bySlug);
  for (const rows of chunk(creates, INSERT_CHUNK))
    await db.company.createMany({ data: rows.map((r) => ({ slug: r.key, ...r.fields })) });
  await inBatches(updates, (u) => db.company.update({ where: { id: u.id }, data: u.fields }));
  summarise("companies", { creates, updates, unchanged });

  // Only refetch when we inserted — otherwise the read above already has every id.
  const all = creates.length
    ? await db.company.findMany({ select: { id: true, slug: true } })
    : existing;
  const idBySlug = new Map(all.map((c) => [c.slug, c.id]));

  // Key by the name as written in the JSON, but resolve through the slug — so a
  // problem tagged "PayPal" and one tagged "Paypal" both reach the one row. The
  // old per-name map dropped whichever spelling lost the upsert race, silently
  // leaving those problems untagged.
  return new Map([...names.keys()].map((name) => [name, idBySlug.get(slugify(name))!]));
}

async function updateDsa(db: Db, companyIds: Map<string, string>) {
  // ---- sheets ----
  const desiredSheets = dedupe(
    sheets.map((sheet, i) => ({
      key: slugify(sheet.name),
      fields: {
        name: sheet.name,
        description: sheet.description ?? null,
        order: sheet.order ?? i,
      },
    })),
    "sheets"
  );

  const sheetRows = await db.dsaSheet.findMany({
    select: { id: true, slug: true, name: true, description: true, order: true },
  });
  const sheetDiff = diffRows(desiredSheets, new Map(sheetRows.map((r) => [r.slug, r])));
  // isPublished is intentionally absent from `fields`: it's a DB default on create
  // and an admin toggle after that, so a re-run must never clobber it.
  for (const rows of chunk(sheetDiff.creates, INSERT_CHUNK))
    await db.dsaSheet.createMany({ data: rows.map((r) => ({ slug: r.key, ...r.fields })) });
  await inBatches(sheetDiff.updates, (u) =>
    db.dsaSheet.update({ where: { id: u.id }, data: u.fields })
  );
  summarise("sheets", sheetDiff);

  const sheetIds = new Map(
    (sheetDiff.creates.length
      ? await db.dsaSheet.findMany({ select: { id: true, slug: true } })
      : sheetRows
    ).map((r) => [r.slug, r.id])
  );

  // ---- topics (keyed by sheet + slug, matching the @@unique) ----
  const desiredTopicRows: Desired<TopicFields>[] = [];
  for (const sheet of sheets) {
    const sheetId = sheetIds.get(slugify(sheet.name))!;
    for (const [topicIdx, topic] of sheet.topics.entries()) {
      const slug = `${slugify(topic.name)}-${topicIdx}`;
      desiredTopicRows.push({
        key: `${sheetId} ${slug}`,
        fields: {
          sheetId,
          slug,
          name: topic.name,
          description: topic.description ?? null,
          order: topicIdx,
        },
      });
    }
  }

  const desiredTopics = dedupe(desiredTopicRows, "topics");

  const topicRows = await db.dsaTopic.findMany({
    select: { id: true, sheetId: true, slug: true, name: true, description: true, order: true },
  });
  const topicDiff = diffRows(
    desiredTopics,
    new Map(topicRows.map((r) => [`${r.sheetId} ${r.slug}`, r]))
  );
  for (const rows of chunk(topicDiff.creates, INSERT_CHUNK))
    await db.dsaTopic.createMany({ data: rows.map((r) => r.fields) });
  await inBatches(topicDiff.updates, (u) =>
    db.dsaTopic.update({ where: { id: u.id }, data: u.fields })
  );
  summarise("topics", topicDiff);

  const topicIds = new Map(
    (topicDiff.creates.length
      ? await db.dsaTopic.findMany({ select: { id: true, sheetId: true, slug: true } })
      : topicRows
    ).map((r) => [`${r.sheetId} ${r.slug}`, r.id])
  );

  // ---- patterns ----
  const desiredPatternRows: Desired<PatternFields>[] = [];
  for (const sheet of sheets) {
    const sheetId = sheetIds.get(slugify(sheet.name))!;
    for (const [topicIdx, topic] of sheet.topics.entries()) {
      const topicId = topicIds.get(`${sheetId} ${slugify(topic.name)}-${topicIdx}`)!;
      for (const [patternIdx, sub] of topic.subtopics.entries()) {
        const slug = `${slugify(sub.name)}-${patternIdx}`;
        desiredPatternRows.push({
          key: `${topicId} ${slug}`,
          fields: {
            topicId,
            slug,
            name: sub.name,
            strategy: sub.strategy ?? null,
            identification: sub.identification ?? null,
            order: sub.order ?? patternIdx,
          },
        });
      }
    }
  }

  const desiredPatterns = dedupe(desiredPatternRows, "patterns");

  const patternRows = await db.dsaPattern.findMany({
    select: {
      id: true,
      topicId: true,
      slug: true,
      name: true,
      strategy: true,
      identification: true,
      order: true,
    },
  });
  const patternDiff = diffRows(
    desiredPatterns,
    new Map(patternRows.map((r) => [`${r.topicId} ${r.slug}`, r]))
  );
  for (const rows of chunk(patternDiff.creates, INSERT_CHUNK))
    await db.dsaPattern.createMany({ data: rows.map((r) => r.fields) });
  await inBatches(patternDiff.updates, (u) =>
    db.dsaPattern.update({ where: { id: u.id }, data: u.fields })
  );
  summarise("patterns", patternDiff);

  const patternIds = new Map(
    (patternDiff.creates.length
      ? await db.dsaPattern.findMany({ select: { id: true, topicId: true, slug: true } })
      : patternRows
    ).map((r) => [`${r.topicId} ${r.slug}`, r.id])
  );

  // ---- problems ----
  // Mirror seed.ts's cross-pattern slug de-dup. This walks the JSON in exactly the
  // same nested order as seed.ts, so the nth duplicate id gets the same `-n` suffix
  // it would have got there — the slugs are what user progress is anchored to.
  const usedSlugs = new Set<string>();
  const uniqueSlug = (id: string): string => {
    let slug = id;
    let n = 2;
    while (usedSlugs.has(slug)) slug = `${id}-${n++}`;
    usedSlugs.add(slug);
    return slug;
  };

  const desiredProblemRows: Desired<ProblemFields>[] = [];
  /** problem slug → the company ids it should be tagged with. */
  const wantedTags = new Map<string, string[]>();

  for (const sheet of sheets) {
    const sheetId = sheetIds.get(slugify(sheet.name))!;
    for (const [topicIdx, topic] of sheet.topics.entries()) {
      const topicId = topicIds.get(`${sheetId} ${slugify(topic.name)}-${topicIdx}`)!;
      for (const [patternIdx, sub] of topic.subtopics.entries()) {
        const patternId = patternIds.get(`${topicId} ${slugify(sub.name)}-${patternIdx}`)!;
        for (const [problemIdx, p] of sub.problems.entries()) {
          const slug = uniqueSlug(p.id);
          desiredProblemRows.push({
            key: slug,
            fields: {
              // patternId is a written field so a problem that moved to another
              // pattern in the JSON gets re-parented rather than duplicated.
              patternId,
              slug,
              title: p.title,
              reference: p.reference ?? null,
              difficulty: toDifficulty(p.difficulty),
              leetcodeUrl: p.leetcodeUrl ?? null,
              gfgUrl: p.gfgUrl ?? null,
              youtubeUrl: p.youtubeUrl ?? null,
              order: problemIdx,
            },
          });
          // Distinct ids: two spellings of one company now resolve to the same
          // row, and a repeated id would make the set comparison below never match.
          const tags = [
            ...new Set(
              (p.companies ?? [])
                .map((c) => companyIds.get(c.name))
                .filter((id): id is string => Boolean(id))
            ),
          ];
          wantedTags.set(slug, tags);
        }
      }
    }
  }

  const desiredProblems = dedupe(desiredProblemRows, "problems");

  const problemRows = await db.dsaProblem.findMany({
    select: {
      id: true,
      patternId: true,
      slug: true,
      title: true,
      reference: true,
      difficulty: true,
      leetcodeUrl: true,
      gfgUrl: true,
      youtubeUrl: true,
      order: true,
    },
  });
  const problemDiff = diffRows(desiredProblems, new Map(problemRows.map((r) => [r.slug, r])));
  for (const rows of chunk(problemDiff.creates, INSERT_CHUNK))
    await db.dsaProblem.createMany({ data: rows.map((r) => r.fields) });
  await inBatches(problemDiff.updates, (u) =>
    db.dsaProblem.update({ where: { id: u.id }, data: u.fields })
  );
  summarise("problems", problemDiff);

  const problemIds = new Map(
    (problemDiff.creates.length
      ? await db.dsaProblem.findMany({ select: { id: true, slug: true } })
      : problemRows
    ).map((r) => [r.slug, r.id])
  );

  // ---- company tags ----
  // The join table carries no user data, so a changed problem can be rebuilt
  // wholesale. What we must NOT do is rebuild every problem: that was a
  // delete + insert per problem (~1160 round trips) on every run, to land on
  // exactly the same rows. Compare the sets first and touch only the drift.
  const seenProblemIds = resolveIds(desiredProblems, problemIds, "problems");
  const existingTags = await db.problemCompany.findMany({
    select: { problemId: true, companyId: true },
  });
  const tagsByProblem = new Map<string, Set<string>>();
  for (const t of existingTags) {
    const set = tagsByProblem.get(t.problemId) ?? new Set<string>();
    set.add(t.companyId);
    tagsByProblem.set(t.problemId, set);
  }

  const staleProblemIds: string[] = [];
  const freshPairs: { problemId: string; companyId: string }[] = [];
  for (const [slug, wanted] of wantedTags) {
    const problemId = problemIds.get(slug)!;
    const current = tagsByProblem.get(problemId) ?? new Set<string>();
    const same = wanted.length === current.size && wanted.every((id) => current.has(id));
    if (same) continue;
    staleProblemIds.push(problemId);
    for (const companyId of wanted) freshPairs.push({ problemId, companyId });
  }

  if (staleProblemIds.length) {
    await db.problemCompany.deleteMany({ where: { problemId: { in: staleProblemIds } } });
    for (const rows of chunk(freshPairs, INSERT_CHUNK))
      await db.problemCompany.createMany({ data: rows, skipDuplicates: true });
  }
  console.log(
    `   tags      ${staleProblemIds.length} problems retagged (${freshPairs.length} links), ` +
      `${wantedTags.size - staleProblemIds.length} unchanged`
  );

  if (!PRUNE) {
    console.log("  prune: skipped (--no-prune)");
    return;
  }

  // Remove Dsa* rows no longer present in dsa.json. Deleting a sheet/topic/
  // pattern cascades to its children; a not-seen parent only has not-seen
  // children, so deleting parents first is safe. Deleting a problem cascades
  // its progress/notes — but only for problems that truly no longer exist.
  const seenSheets = resolveIds(desiredSheets, sheetIds, "sheets");
  const seenTopics = resolveIds(desiredTopics, topicIds, "topics");
  const seenPatterns = resolveIds(desiredPatterns, patternIds, "patterns");

  // `notIn: []` matches every row, so an empty seen-set would delete the table.
  // That can only happen if dsa.json arrived empty/malformed — refuse instead.
  if (!seenSheets.length || !seenTopics.length || !seenPatterns.length || !seenProblemIds.length)
    throw new Error("refusing to prune: dsa.json produced an empty level");

  const delSheets = await db.dsaSheet.deleteMany({ where: { id: { notIn: seenSheets } } });
  const delTopics = await db.dsaTopic.deleteMany({ where: { id: { notIn: seenTopics } } });
  const delPatterns = await db.dsaPattern.deleteMany({
    where: { id: { notIn: seenPatterns } },
  });
  const delProblems = await db.dsaProblem.deleteMany({
    where: { id: { notIn: seenProblemIds } },
  });
  console.log(
    `   pruned: ${delSheets.count} sheets, ${delTopics.count} topics, ${delPatterns.count} patterns, ${delProblems.count} problems (their progress/notes cascaded)`,
  );
}

async function run(db: Db) {
  const companyIds = await upsertCompanies(db);
  await updateDsa(db, companyIds);
}

async function main() {
  const startedAt = Date.now();
  console.log(
    `🔄 Updating DSA content from seed/dsa.json (prune=${PRUNE}${DRY_RUN ? ", DRY RUN — will roll back" : ""})…`
  );

  if (DRY_RUN) {
    // Run the real pipeline against a real interactive transaction, then force
    // a rollback — every finding/query/constraint is genuine, nothing is kept.
    await prisma
      .$transaction(
        async (tx: Prisma.TransactionClient) => {
          await run(tx);
          throw new DryRunRollback();
        },
        // Generous timeout: a dry run does the same hundreds of reads/writes as
        // a real run, all held open in one transaction instead of committed
        // incrementally, so the default 5s interactive-transaction timeout is
        // too tight for a full dsa.json.
        { timeout: 60_000 }
      )
      .catch((e) => {
        if (!(e instanceof DryRunRollback)) throw e;
      });
    console.log("🧪 Dry run rolled back — no changes were committed.");
  } else {
    await run(prisma);
  }

  console.log(
    `✅ DSA update complete in ${((Date.now() - startedAt) / 1000).toFixed(1)}s. ` +
      `(quizzes, domain, courses, interviews, users untouched)`
  );
}

main()
  .catch((e) => {
    console.error("❌ DSA update failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
