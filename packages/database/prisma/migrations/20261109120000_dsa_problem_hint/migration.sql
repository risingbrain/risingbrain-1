-- DSA problems: an optional hint, revealed on demand in the sheet.
--
-- Nullable with no default, so this is a metadata-only change in Postgres:
-- no table rewrite, no backfill. A null hint means the sheet shows the hint
-- button dimmed.
ALTER TABLE "dsa_problems" ADD COLUMN "hint" TEXT;
