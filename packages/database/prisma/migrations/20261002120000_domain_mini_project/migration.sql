-- Domain topics: a third "Mini Project" tab beside Notes | Practice.
--
-- Nullable on purpose: only subjects whose source material ships a hands-on
-- design challenge (OOPS, from its "Boss Challenge" sections) fill it, and a
-- null value means the tab is not rendered. Adding a nullable column with no
-- default is a metadata-only change in Postgres — no table rewrite, no backfill.
ALTER TABLE "domain_topics" ADD COLUMN "miniProject" TEXT;
