/**
 * Give every long Domain topic a usable section structure — and therefore an
 * "On this page" rail.
 *
 * SEPARATE from `repair-domain-notes.ts` on purpose. That script REPAIRS: it
 * proves it changed no words. This one AUTHORS: it adds heading text that was
 * not in the source, and promotes existing sentences to headings. Different
 * guarantee, so a different script and a different check — here the assertion is
 * that nothing is REMOVED or reordered, with every addition declared up front.
 *
 * Only SQL needs it; CN, DBMS and OS already carry 3+ sections everywhere, and
 * OOPS is extracted from its course PDFs with the headings intact
 * (`oops_pdf_extract.py`).
 *
 * SQL (85 topics, 82 with no rail) is machine-uniform — every topic is
 * `## Source data` → rule → definition → `## Problem` → query → result figure —
 * so the two unnamed parts get named:
 *
 *     ## Source data — Pattern N     (already there)
 *     ## What it does                (NEW — the definition after the rule)
 *     ## Problem                     (already there)
 *     ## Result                      (NEW — the figure after the query)
 *
 *   bun run packages/database/scripts/add-domain-sections.ts            # preview
 *   bun run packages/database/scripts/add-domain-sections.ts --write    # seed
 *   bun run packages/database/scripts/add-domain-sections.ts --write --db
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const seedPath = (f: string) => join(HERE, "..", "seed", f);

type Topic = { slug: string; title: string; notes: string };

/** Everything this run added, so the check below can subtract it again. */
const added: string[] = [];

// ---------------------------------------------------------------- SQL

function sqlSections(notes: string): string {
  let out = notes;

  // "## What it does" — the definition paragraph sits directly after the rule
  // that closes the shared source-data preamble.
  if (!/^## What it does\s*$/m.test(out)) {
    out = out.replace(/^---[ \t]*$\n\n(?=\S)/m, () => {
      added.push("What it does");
      return "---\n\n## What it does\n\n";
    });
  }

  // "## Result" — the figure after the query. Only when the topic ends on one.
  if (!/^## Result\s*$/m.test(out)) {
    out = out.replace(/\n\n(!\[[^\]]*\]\([^)]*\)[ \t]*)$/, (_m, fig: string) => {
      added.push("Result");
      return `\n\n## Result\n\n${fig}`;
    });
  }
  return out;
}

// ---------------------------------------------------------------- checking

/** The reader's text as one comparable stream: letters and digits only. */
function stream(md: string): string {
  return md
    .replace(/^\|\s*-{3,}\s*(\|\s*-{3,}\s*)*\|?$/gm, " ")
    .replace(/[|•]/g, " ")
    .replace(/^\s*[-*]\s+/gm, " ")
    .replace(/^#{1,6}\s+/gm, " ")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/**
 * Can `after` be reduced to `before` by removing exactly the headings this run
 * introduced?
 *
 * Every occurrence of an inserted heading is tried, not just the first: "Result"
 * is also an ordinary word in SQL prose ("excluded from the result"), so
 * subtracting the first match removes the author's sentence and leaves a stream
 * that looks corrupted. Searching all positions and accepting any that reconciles
 * keeps the check strict — a genuinely dropped clause still has no position that
 * works — while tolerating a heading whose words already appear in the text.
 *
 * Promoting a sentence to a heading needs no declaration: its words are still
 * there. Only invented text does.
 */
function reducesTo(after: string, before: string, inserted: string[]): boolean {
  if (inserted.length === 0) return after === before;
  const [first, ...rest] = inserted;
  const t = stream(first!);
  if (!t) return reducesTo(after, before, rest);
  for (let at = after.indexOf(t); at !== -1; at = after.indexOf(t, at + 1)) {
    if (reducesTo(after.slice(0, at) + after.slice(at + t.length), before, rest)) return true;
  }
  return false;
}

function assertNoLoss(before: string, after: string, inserted: string[], label: string) {
  if (!reducesTo(stream(after), stream(before), inserted)) {
    throw new Error(`Text lost or reordered in ${label}`);
  }
}

// ---------------------------------------------------------------- run

const WRITE = process.argv.includes("--write");
const SYNC = process.argv.includes("--db");
const FILES: { file: string; subject: string; fn: (n: string) => string }[] = [
  { file: "domain-sql.json", subject: "SQL", fn: sqlSections },
];

const changedBySubject = new Map<string, Topic[]>();

for (const { file, subject, fn } of FILES) {
  const topics = JSON.parse(readFileSync(seedPath(file), "utf8")) as Topic[];
  const changed: Topic[] = [];
  let railBefore = 0;
  let railAfter = 0;

  for (const t of topics) {
    const countH2 = (s: string) => (s.match(/^##\s+\S/gm) ?? []).length;
    const before = countH2(t.notes);
    added.length = 0;
    const next = fn(t.notes);
    assertNoLoss(t.notes, next, [...added], `${subject} · ${t.title}`);
    const after = countH2(next);

    railBefore += before >= 3 ? 1 : 0;
    railAfter += after >= 3 ? 1 : 0;
    if (next !== t.notes) {
      t.notes = next;
      changed.push(t);
    }
  }

  console.log(
    `${subject}: ${changed.length}/${topics.length} topics updated · ` +
      `rail ${railBefore} → ${railAfter} of ${topics.length}`,
  );
  changedBySubject.set(subject, changed);
  if (WRITE && changed.length > 0) {
    writeFileSync(seedPath(file), JSON.stringify(topics, null, 2) + "\n");
    console.log(`  📝 wrote seed/${file}`);
  }
}

if (!WRITE) {
  console.log("\n(preview only — pass --write to update the seed, --db to sync rows)");
}

if (WRITE && SYNC) {
  const { PrismaClient } = await import("../generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const { notesForTopic } = await import("./domain-loader");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  let updated = 0;
  for (const [subject, changed] of changedBySubject) {
    for (const t of changed) {
      // Same fold the loader applies, so an appended code example survives.
      await prisma.domainTopic.update({
        where: { subject_slug: { subject: subject as "SQL", slug: t.slug } },
        data: { notes: notesForTopic(t as Parameters<typeof notesForTopic>[0]) },
      });
      updated++;
    }
  }
  console.log(`\n🗄  Database: ${updated} row(s) updated (changed topics only).`);
  await prisma.$disconnect();
}
