/**
 * Standalone seeder for the Domain section (SQL / DBMS / OS / CN / OOPS notes).
 *
 * Reseeds ONLY `domain_topics` and the practice questions that cascade with it —
 * clears and reloads them from seed/domain-*.json (+ the MCQs in
 * seed/domain-*-quiz.json), leaving every other table untouched. Run it
 * after re-extracting the source PDFs so you don't have to reseed the whole
 * database:
 *
 *   bun run db:seed-domain          (from packages/database, or via turbo)
 *
 * The same logic is invoked by the full `db:seed` (see prisma/seed.ts →
 * seedDomain), so the two never drift.
 */
import { PrismaClient } from "../generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { seedDomain } from "./domain-loader";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  console.log("🌱 Seeding Domain topics…");
  const { topics, withExample, questions } = await seedDomain(prisma);
  console.log(
    `✅ Domain seed complete: ${topics} topics (${withExample} with a code example), ` +
      `${questions} practice questions.`
  );
}

main()
  .catch((e) => {
    console.error("❌ Domain seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
