-- BrightBridge PH: curriculum-demand analytics for the Searchable/Custom
-- Topics feature. NOT YET APPLIED -- run manually in the Supabase SQL
-- Editor only after approval.
--
-- Smallest safe schema change: reuses the existing usage_logs.topic
-- column as-is, and adds two nullable columns so we can later answer
-- (at end of school year, via a report built from this raw data --
-- no dashboard is built in this change):
--   - Which custom topics were requested most often, for which grades
--     and subjects?
--   - Which are alternate names for topics already in the JSON catalog?
--   - Which recurring custom topics should be added next year?
--
-- No RPC signature changes and no changes to the reservation/finalization
-- security model -- see the accompanying design note. topic_source and
-- quarter are tagged via a plain follow-up PATCH in generate.js
-- (informational only, never affects quota or security), the same
-- pattern already used by the existing failure-path PATCH.

alter table public.usage_logs
  add column if not exists topic_source text,
  add column if not exists quarter text;

alter table public.usage_logs
  add constraint usage_logs_topic_source_check
  check (topic_source is null or topic_source in ('catalog', 'custom'));

-- Mirrors the exact <option> values in index.html's #quarter <select> --
-- generate.js validates against this same allowlist before ever reaching
-- this table (see ALLOWED_QUARTERS), so this constraint is a defense-in-
-- depth backstop, not the primary gate.
alter table public.usage_logs
  add constraint usage_logs_quarter_check
  check (quarter is null or quarter in ('Quarter 1', 'Quarter 2', 'Quarter 3', 'Quarter 4'));

-- Historical rows predate this feature entirely -- NULL in both new
-- columns is expected and correct, not a bug. No backfill is possible or
-- attempted (we have no way to know, after the fact, whether an old topic
-- string came from the catalog or was typed in via the old bare
-- "type your own" fallback input).

create index if not exists usage_logs_topic_source_idx
  on public.usage_logs (topic_source)
  where topic_source = 'custom';
