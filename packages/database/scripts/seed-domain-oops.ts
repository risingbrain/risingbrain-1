/**
 * Standalone seeder for the OOPS subject of the Domain section.
 *
 * Reseeds ONLY the `OOPS` rows of `domain_topics` (and, by cascade, their practice
 * questions) — clears and reloads them from seed/domain-oops.json (one topic per
 * course module: notes + the "Mini Project" tab) and seed/domain-oops-quiz.json
 * (the Practice MCQs), leaving the other subjects and every other table untouched:
 *
 *   bun run db:seed-domain-oops              (from packages/database, or via turbo)
 *   bun run db:seed-domain-oops -- --clear   (delete the OOPS rows and stop)
 *
 * `--clear` is the "wipe it before I rewrite the content" step: it removes every
 * OOPS topic without reloading, so the section reads empty until the next seed.
 * A plain run already clears before it inserts, so you only need --clear when the
 * seed JSON isn't ready yet.
 *
 * DESTRUCTIVE within its scope: because questions cascade with their topic, any
 * learner answers recorded against the OLD OOPS questions go with them.
 *
 * Both seed files are GENERATED from the course PDFs — edit the extractor, not
 * the JSON:
 *
 *   python3 scripts/oops_pdf_extract.py --src <pdf dir>   # PDFs → seed + figures
 *   python3 scripts/oops_pdf_verify.py  --src <pdf dir>   # prove nothing was lost
 *   (cd ../../apps/web && bun run gen:figures)             # size the new figures
 *
 * Needs the `miniProject` column (migration 20261002120000_domain_mini_project) —
 * run `bun run db:migrate-deploy` first on an existing database.
 *
 * Shares seedDomainSubject() with the full `db:seed`, so the two never drift.
 */
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { seedDomainSubject } from "./domain-loader";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  if (process.argv.includes("--clear")) {
    const { count } = await prisma.domainTopic.deleteMany({ where: { subject: "OOPS" } });
    console.log(`🧹 Cleared ${count} OOPS domain topics (their questions cascaded).`);
    return;
  }
  console.log("🌱 Seeding Domain topics for OOPS…");
  const { topics, withExample, questions } = await seedDomainSubject(prisma, "OOPS");
  console.log(
    `✅ OOPS domain seed complete: ${topics} topics (${withExample} with a code example), ` +
      `${questions} practice questions.`
  );
}

main()
  .catch((e) => {
    console.error("❌ OOPS domain seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
