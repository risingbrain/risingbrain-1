/**
 * One-off repair: un-mangle Domain topics whose prose was turned into GFM tables
 * by the PDF-extraction formatter.
 *
 * `format-domain-notes.py` converts the flat text left behind by PDF extraction
 * into real markdown, and part of that is recognising a "flattened table" — a run
 * of blocks that used to be table cells — and rebuilding it. In five DBMS topics
 * that heuristic fired on ordinary prose and bullet lists inside the "Common
 * confusion" sections, and column-wrapped them into two-column tables. The result
 * renders as a table whose header is a whole sentence and whose cells break words
 * in half ("Generali | zation", "a plain file | - | based"), with the reader
 * scrolling sideways through their own paragraph.
 *
 * The formatter guarantees the WORD SEQUENCE is preserved, which is what makes
 * this recoverable: the original text is still there, just cut at fixed columns
 * and redistributed into cells. Each replacement below re-joins one such table
 * back into the paragraphs and bullets it was made from, and the script asserts
 * the word sequence is unchanged — the same guarantee, in reverse.
 *
 * Re-running is a no-op: a block that no longer matches is reported and skipped.
 *
 * A second pass fixes a related leftover from the same extraction: bullet points
 * that arrived as ordinary paragraphs beginning with a literal "•" glyph. They
 * look like a list and read like a list, but they are not one — so they get
 * paragraph spacing instead of list spacing, no hanging indent on wrapped lines,
 * and none of the marker styling. Consecutive ones are re-joined into a real
 * markdown list.
 *
 *   bun run packages/database/scripts/repair-domain-notes.ts          # seed only
 *   bun run packages/database/scripts/repair-domain-notes.ts --db     # + database
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const seedPath = (file: string) => join(HERE, "..", "seed", file);

/** Seed file → the `DomainSubject` its rows carry, for the `--db` sync. */
const FILES: Record<string, string> = {
  "domain-dbms.json": "DBMS",
  "domain-os.json": "OS",
  "domain-cn.json": "CN",
  "domain-sql.json": "SQL",
  "domain-oops.json": "OOPS",
};

interface Repair {
  file: keyof typeof FILES | string;
  slug: string;
  /**
   * Text the repair is allowed to DELETE, declared so the word-stream check can
   * account for it. Only ever scaffolding the extractor invented — a header row
   * repeated mid-table at a page break, or a stray "o" left behind by a bullet
   * glyph. Never prose.
   */
  drops?: string[];
  /** The mangled table, verbatim. */
  from: string;
  /** The prose/list it was made from. */
  to: string;
}

const REPAIRS: Repair[] = [
  // --- Rows where two cells were run together and the row left one short. ----
  // Each is one row of an otherwise-intact table, so the split point is not a
  // guess: the surrounding rows show exactly where the column boundary sits.
  {
    file: "domain-cn.json",
    slug: "what-is-packet-switching-how-is-it-different-from-circuit-switching",
    from: "| Data split into packets Dedicated connection |  |",
    to: "| Data split into packets | Dedicated connection |",
  },
  {
    file: "domain-cn.json",
    slug: "explain-all-seven-layers-of-the-osi-model",
    from: "| Application User services |  |\n| Presentation Data formatting |  |",
    to: "| Application | User services |\n| Presentation | Data formatting |",
  },
  {
    file: "domain-cn.json",
    slug: "which-networking-devices-work-at-each-osi-layer",
    from: "| Repeater Layer 1 |  |",
    to: "| Repeater | Layer 1 |",
  },
  {
    file: "domain-cn.json",
    slug: "which-networking-devices-work-at-each-osi-layer",
    from: "| Firewall Layer 3\u20137 (depending on type) |  |",
    to: "| Firewall | Layer 3\u20137 (depending on type) |",
  },
  {
    // Plus a header row repeated mid-table where the source PDF broke the page.
    file: "domain-cn.json",
    slug: "osi-model-vs-tcpip-model",
    from: `| Application Application |  |
| Presentation Application |  |
| OSI Model | TCP/IP Model |
| Session | Application |`,
    to: `| Application | Application |
| Presentation | Application |
| Session | Application |`,
    drops: ["OSI Model TCP/IP Model"],
  },
  {
    // Two tables merged into one by the extractor: the layer mapping, then the
    // "Major Differences" comparison, with a repeated header between them.
    file: "domain-cn.json",
    slug: "compare-the-osi-model-and-tcpip-model",
    from: `| Application Application |  |
| Presentation Application |  |
| Session | Application |
| Transport | Transport |
| OSI Model | TCP/IP Model |
| Network | Internet |
| Data Link | Network Access |
| Physical | Network Access |
| Major Differences |  |
| OSI Model | TCP/IP Model |
| 7 Layers | 4 Layers |`,
    to: `| Application | Application |
| Presentation | Application |
| Session | Application |
| Transport | Transport |
| Network | Internet |
| Data Link | Network Access |
| Physical | Network Access |

**Major Differences**

| OSI Model | TCP/IP Model |
| --- | --- |
| 7 Layers | 4 Layers |`,
    drops: ["OSI Model TCP/IP Model"],
  },
  {
    file: "domain-cn.json",
    slug: "compare-tcp-and-udp",
    from: "| Acknowledgments Yes | No |  |",
    to: "| Acknowledgments | Yes | No |",
  },
  {
    file: "domain-cn.json",
    slug: "what-is-flow-control-and-congestion-control",
    from: "| Prevents buffer overflow Prevents congestion |  |",
    to: "| Prevents buffer overflow | Prevents congestion |",
  },
  {
    // The table's headers were stranded in the sentence above it.
    file: "domain-cn.json",
    slug: "what-are-sockets-and-port-numbers",
    from: `**For example** Service Default Port

| HTTP | 80 |
| --- | --- |
| HTTPS 443 |  |
| FTP | 21 |`,
    to: `**For example**

| Service | Default Port |
| --- | --- |
| HTTP | 80 |
| HTTPS | 443 |
| FTP | 21 |`,
  },
  {
    // Continuation of the same port table after a figure, plus a stray "Socket"
    // cell that is really the lead-in to the sentence after it.
    file: "domain-cn.json",
    slug: "what-are-sockets-and-port-numbers",
    from: `| SSH | 22 |
| --- | --- |
| SMTP 25 |  |
| DNS | 53 |
| Socket |  |

**A socket consists of** IP Address

Port Number`,
    to: `| SSH | 22 |
| --- | --- |
| SMTP | 25 |
| DNS | 53 |

**Socket**

**A socket consists of**

- IP Address
- Port Number`,
  },
  {
    // Not a table at all — a bullet list whose "o" glyphs became a column, with
    // two following headings swept into it.
    file: "domain-cn.json",
    slug: "what-is-a-firewall",
    from: `## 3. The packet is either

| o | Allowed |
| --- | --- |
| o | Blocked |
| o | Logged for monitoring |
| Types of Firewalls |  |
| Packet Filtering Firewall |  |`,
    to: `3. The packet is either:

- Allowed
- Blocked
- Logged for monitoring

**Types of Firewalls**

**Packet Filtering Firewall**`,
    drops: ["o", "o", "o"],
  },
  {
    file: "domain-cn.json",
    slug: "what-is-the-difference-between-public-ip-and-private-ip",
    from: "| Used on the Internet Used inside LANs |  |",
    to: "| Used on the Internet | Used inside LANs |",
  },
  {
    file: "domain-os.json",
    slug: "explain-shortest-job-first-sjf-and-shortest-remaining-time-first-srtf",
    from: `| Runs until completion Can be interrupted |  |
| SJF | SRTF |
| Lower overhead | Higher overhead |`,
    to: `| Runs until completion | Can be interrupted |
| Lower overhead | Higher overhead |`,
    drops: ["SJF SRTF"],
  },
  {
    file: "domain-os.json",
    slug: "what-are-the-four-necessary-conditions-for-deadlock",
    from: "| Mutual Exclusion Resource cannot be shared |  |",
    to: "| Mutual Exclusion | Resource cannot be shared |",
  },
  {
    file: "domain-dbms.json",
    slug: "dbms-vs-rdbms",
    from: `| Learners treat "DBMS" and "RDBMS" as two competing things you pick between. They're not | — |
| --- | --- |
| RDBMS is a subtype of DBMS. Every RDBMS is a DBMS; not every DBMS is relational (a plain file | - |
| based or key-value store isn't). Saying "we used a DBMS, not an RDBMS" is like saying "I drove a |  |
| vehicle, not a car." |  |`,
    to: `Learners treat "DBMS" and "RDBMS" as two competing things you pick between. They're not — RDBMS is a subtype of DBMS. Every RDBMS is a DBMS; not every DBMS is relational (a plain file-based or key-value store isn't). Saying "we used a DBMS, not an RDBMS" is like saying "I drove a vehicle, not a car."`,
  },
  {
    file: "domain-dbms.json",
    slug: "entities-attributes-and-relationships",
    from: `| • | A fact about one thing → attribute (ellipse hanging off a box) |
| --- | --- |
| • | A fact that involves two things → relationship (diamond between two boxes) |`,
    to: `- A fact about one thing → attribute (ellipse hanging off a box)
- A fact that involves two things → relationship (diamond between two boxes)`,
  },
  {
    file: "domain-dbms.json",
    slug: "cardinality-and-er-notation",
    from: `| So don't argue about which one is right. Just say the direction out loud | — "one instructor |
| --- | --- |
| teaches many courses" | — and the confusion disappears. |

| Second thing people mix up: | how many vs is it required . |
| --- | --- |
| • | Cardinality = how many? (one, or many) |

| • | Participation = is it compulsory? (must have one, or can have none) |
| --- | --- |
| A student might have | zero lockers. Still 1:1 for cardinality — but optional for participation. |
| Intervie | wers like this one, because most candidates treat them as the same thing. |`,
    to: `So don't argue about which one is right. Just say the direction out loud — "one instructor teaches many courses" — and the confusion disappears.

Second thing people mix up: how many vs is it required.

- Cardinality = how many? (one, or many)
- Participation = is it compulsory? (must have one, or can have none)

A student might have zero lockers. Still 1:1 for cardinality — but optional for participation. Interviewers like this one, because most candidates treat them as the same thing.`,
  },
  {
    file: "domain-dbms.json",
    slug: "weak-entities-generalization-and-specialization",
    from: `| • Enrollment points to Student, but if it has its own enrollment ID, it can identify itself. | Not |
| --- | --- |
|  | weak. |
| • | Grade cannot identify itself at all. Weak. |
| Generali | zation vs specialization is the other muddle, and here's the honest answer: they |
| produce | the exact same drawing. The only difference is which direction you were thinking. |`,
    to: `- Enrollment points to Student, but if it has its own enrollment ID, it can identify itself. Not weak.
- Grade cannot identify itself at all. Weak.

Generalization vs specialization is the other muddle, and here's the honest answer: they produce the exact same drawing. The only difference is which direction you were thinking.`,
  },
  {
    // A different shape of the same damage: ONE four-row comparison was split
    // into two tables, with the middle row left stranded as a bare paragraph
    // ("Includes utilities and user interface Handles hardware interactions" —
    // two cells run together) and the row after it promoted to a second header.
    file: "domain-os.json",
    slug: "what-is-the-difference-between-the-kernel-and-an-operating-system",
    from: `| Operating System | Kernel |
| --- | --- |
| Complete system software | Core component |

Includes utilities and user interface Handles hardware interactions

| Provides services to users | Provides services to applications |
| --- | --- |
| Larger in scope | Smaller but critical |`,
    to: `| Operating System | Kernel |
| --- | --- |
| Complete system software | Core component |
| Includes utilities and user interface | Handles hardware interactions |
| Provides services to users | Provides services to applications |
| Larger in scope | Smaller but critical |`,
  },
  {
    file: "domain-dbms.json",
    slug: "concurrency-problems",
    from: `| • | Did a row you already read change? → non-repeatable read |
| --- | --- |
| • | Did a new row turn up in your result? → phantom read |`,
    to: `- Did a row you already read change? → non-repeatable read
- Did a new row turn up in your result? → phantom read`,
  },
];

/**
 * The words a reader actually sees, with the table scaffolding and list markers
 * stripped. Used for the human-readable diff when the check below fails.
 */
function words(markdown: string): string[] {
  return markdown
    .replace(/^\|\s*-{3,}\s*(\|\s*-{3,}\s*)*\|?$/gm, " ") // table delimiter rows
    .replace(/[|•]/g, " ") // cell walls and the bullet glyph
    .replace(/^\s*-\s+/gm, " ") // markdown list markers
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

/**
 * The reader's text as one comparable stream: letters and digits only.
 *
 * This is the actual assertion, and it is deliberately blind to two things the
 * repair is ALLOWED to change — whitespace and punctuation — because the mangling
 * cut words at fixed columns and put the pieces in different cells. A hyphen
 * landed in a cell of its own between "file" and "based", so re-joining correctly
 * yields "file-based" where the mangled version had two separate words; likewise
 * "required ." closes up to "required.". Nothing else can move: dropping a
 * clause, duplicating one, or reordering a sentence all change this stream.
 */
/**
 * Does `after` equal `before` once the declared drops are removed?
 *
 * Each drop is searched at EVERY position it occurs, not just the first: these
 * deletions are duplicated header rows, so the text being removed appears twice
 * by definition, and removing the wrong copy leaves a stream that differs from
 * the repair's actual output. Trying each position and accepting any that
 * reconciles keeps the check strict — an undeclared deletion still has no
 * position that works — without needing to know which copy the edit removed.
 */
function streamMatches(before: string, after: string, drops: string[]): boolean {
  if (drops.length === 0) return before === after;
  const [first, ...rest] = drops;
  const d = stream(first!);
  if (!d) return streamMatches(before, after, rest);
  for (let at = before.indexOf(d); at !== -1; at = before.indexOf(d, at + 1)) {
    if (streamMatches(before.slice(0, at) + before.slice(at + d.length), after, rest)) return true;
  }
  return false;
}

function stream(markdown: string): string {
  return words(markdown).join("").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Turn runs of `• …` paragraphs into one markdown list.
 *
 * The glyph is kept out of the output entirely — `- ` is the marker now, and
 * `.notes-prose` styles it. A run is any group of bullet paragraphs separated
 * only by blank lines; a non-bullet paragraph ends the run, so two lists split by
 * a sentence stay two lists.
 */
function liftLiteralBullets(notes: string): string {
  const lines = notes.split("\n");
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    if (!/^\s*•\s+\S/.test(lines[i]!)) {
      out.push(lines[i]!);
      i++;
      continue;
    }
    // Collect the run, stepping over the blank lines between items.
    const items: string[] = [];
    while (i < lines.length) {
      const line = lines[i]!;
      if (/^\s*•\s+\S/.test(line)) {
        items.push("- " + line.replace(/^\s*•\s+/, "").trimEnd());
        i++;
      } else if (line.trim() === "" && /^\s*•\s+\S/.test(lines[i + 1] ?? "")) {
        i++; // blank line INSIDE the run
      } else {
        break;
      }
    }
    // A blank line before and after keeps the list a block of its own — without
    // it, a list butted against a paragraph is parsed as part of that paragraph.
    if (out.length > 0 && out[out.length - 1]!.trim() !== "") out.push("");
    out.push(...items, "");
    if (lines[i]?.trim() === "") i++;
  }
  return out.join("\n");
}

/**
 * `##` headings that are captions, not sections.
 *
 * Kept as an explicit list rather than a heuristic, because the obvious rules
 * ("short", "starts lowercase") flag the real ones: `Hook`, `Recap`, `Step 1`,
 * `Types`, `Rules`, `Note` and `Tip` are all genuine sections in this corpus —
 * `Hook`/`Recap` are the spine of the Domain teaching shape. Nine bad ones out
 * of 1,016 does not justify a rule that would demote the good ones too.
 *
 * Keyed by heading text; a topic slug narrows it where the same word is a real
 * heading elsewhere.
 */
const CAPTION_H2: { slug?: string; text: string }[] = [
  { slug: "what-are-sockets-and-port-numbers", text: "IP" },
  { slug: "what-are-sockets-and-port-numbers", text: "Port" },
  { slug: "what-are-sockets-and-port-numbers", text: "chapter covered" },
  { slug: "what-is-icmp-and-where-is-it-used", text: "protocols" },
  { slug: "explain-what-happens-internally-when-you-type-a-url-in-a-browser", text: "preparation" },
  { slug: "what-is-the-difference-between-public-ip-and-private-ip", text: "Router" },
  { slug: "what-is-a-system-call-explain-how-user-programs-interact-with-the-os", text: "Examples include" },
  { slug: "explain-monitors-and-condition-variables", text: "Two common operations are" },
];

/**
 * Demote caption headings to bold lead-in paragraphs.
 *
 * EVERY `###` in this corpus is one — "Example", "Examples include", "Device",
 * "Organizations can centrally manage" — a phrase introducing the list, table or
 * one-line answer directly beneath it. The extractor promoted them because they
 * sat alone on their own line in the PDF. They are not sections, and treating
 * them as such put 70 entries like "Example" into the "On this page" rail and
 * set a one-line sentence under a heading three sizes larger than it.
 *
 * `**Bold**` is what they were: a label. It keeps the emphasis, keeps every
 * word, and takes them out of the document outline.
 */
function demoteCaptions(notes: string, slug: string): string {
  let out = notes.replace(/^###\s+(.+?)\s*$/gm, (_, text: string) => `**${text.trim()}**`);
  for (const caption of CAPTION_H2) {
    if (caption.slug && caption.slug !== slug) continue;
    const escaped = caption.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`^##\\s+${escaped}\\s*$`, "gm"), `**${caption.text}**`);
  }
  return out;
}

type Topic = { slug: string; title: string; notes: string };

/** Every seed file we touch, loaded once and written back once. */
const loaded = new Map<string, Topic[]>();
const dirty = new Set<string>();
function load(file: string): Topic[] {
  if (!loaded.has(file)) loaded.set(file, JSON.parse(readFileSync(seedPath(file), "utf8")));
  return loaded.get(file)!;
}

// --- pass 1: mangled tables -> the prose and lists they were made from --------
console.log("Un-mangling tables:");
let repaired = 0;
let skipped = 0;

for (const repair of REPAIRS) {
  const topic = load(repair.file).find((t) => t.slug === repair.slug);
  if (!topic) throw new Error(`No topic "${repair.slug}" in ${repair.file}`);

  if (!topic.notes.includes(repair.from)) {
    console.log(`  ⏭  ${topic.title} — already repaired (block not found)`);
    skipped++;
    continue;
  }

  const fixed = topic.notes.replace(repair.from, repair.to);
  if (!streamMatches(stream(topic.notes), stream(fixed), repair.drops ?? [])) {
    const before = words(topic.notes);
    const after = words(fixed);
    const at = Math.max(0, before.findIndex((w, i) => after[i] !== w));
    throw new Error(
      `Text changed in "${topic.title}" around word ${at}:\n` +
        `  before: …${before.slice(Math.max(0, at - 8), at + 8).join(" ")}…\n` +
        `  after:  …${after.slice(Math.max(0, at - 8), at + 8).join(" ")}…`,
    );
  }

  topic.notes = fixed;
  dirty.add(repair.file);
  repaired++;
  console.log(`  ✅ ${topic.title}`);
}
console.log(`   ${repaired} table(s) repaired, ${skipped} already clean.`);

// --- pass 2: literal "•" paragraphs -> real markdown lists --------------------
console.log("\nLifting literal bullet glyphs into lists:");
let bulletTopics = 0;
for (const file of Object.keys(FILES)) {
  for (const topic of load(file)) {
    if (!/^\s*•\s+\S/m.test(topic.notes)) continue;
    const lifted = liftLiteralBullets(topic.notes);
    if (stream(topic.notes) !== stream(lifted)) {
      throw new Error(`Text changed while lifting bullets in "${topic.title}"`);
    }
    const count = (topic.notes.match(/^\s*•\s+\S/gm) ?? []).length;
    topic.notes = lifted;
    dirty.add(file);
    bulletTopics++;
    console.log(`  ✅ ${topic.title} — ${count} bullet(s)`);
  }
}
console.log(`   ${bulletTopics} topic(s) delisted.`);

// --- pass 3: caption headings -> bold lead-ins --------------------------------
console.log("\nDemoting caption headings:");
let demoted = 0;
for (const file of Object.keys(FILES)) {
  for (const topic of load(file)) {
    const fixed = demoteCaptions(topic.notes, topic.slug);
    if (fixed === topic.notes) continue;
    if (stream(topic.notes) !== stream(fixed)) {
      throw new Error(`Text changed while demoting captions in "${topic.title}"`);
    }
    const n =
      (topic.notes.match(/^###\s+\S/gm) ?? []).length +
      (fixed.match(/^##\s+\S/gm) ?? []).length * 0;
    topic.notes = fixed;
    dirty.add(file);
    demoted++;
    console.log(`  ✅ ${topic.title.slice(0, 55)} — ${n || 1} caption(s)`);
  }
}
console.log(`   ${demoted} topic(s) cleaned.`);

for (const file of dirty) {
  writeFileSync(seedPath(file), JSON.stringify(load(file), null, 2) + "\n");
  console.log(`\n📝 Rewrote seed/${file}.`);
}

// --- optionally push the repaired notes to the live rows ---------------------
//
// Syncs by DIFF, not by the repair list: pass 2 rewrites more topics than pass 1
// names, and a fix that lands in the seed but not in the database is a fix the
// reader never sees. Only rows whose notes actually differ are written.
if (process.argv.includes("--db")) {
  const { PrismaClient } = await import("../generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  // The row's notes are NOT always the seed file's notes: the loader appends an
  // inline code example as a final "## Example" section. Writing the raw seed
  // string here would silently delete it — that happened once. Reusing the
  // loader's own transform is what stops the two drifting.
  const { notesForTopic } = await import("./domain-loader");
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  let updated = 0;
  let missing = 0;
  let current = 0;

  for (const [file, subject] of Object.entries(FILES)) {
    // Re-read from disk so a re-run still syncs when the seed was already clean.
    const topics = JSON.parse(readFileSync(seedPath(file), "utf8")) as Topic[];
    const live = await prisma.domainTopic.findMany({
      where: { subject: subject as "DBMS" },
      select: { slug: true, notes: true },
    });
    const liveBySlug = new Map(live.map((r) => [r.slug, r.notes]));

    for (const topic of topics) {
      if (!liveBySlug.has(topic.slug)) {
        console.log(`  ⚠  ${topic.title} — no row in the database (seed not run?)`);
        missing++;
        continue;
      }
      const rowNotes = notesForTopic(topic as Parameters<typeof notesForTopic>[0]);
      if (liveBySlug.get(topic.slug) === rowNotes) {
        current++;
        continue;
      }
      await prisma.domainTopic.update({
        where: { subject_slug: { subject: subject as "DBMS", slug: topic.slug } },
        data: { notes: rowNotes },
      });
      console.log(`  🗄  ${subject} · ${topic.title}`);
      updated++;
    }
  }

  console.log(
    `\n🗄  Database: ${updated} row(s) updated, ${current} already current` +
      (missing ? `, ${missing} missing` : "") + ".",
  );
  await prisma.$disconnect();
}
