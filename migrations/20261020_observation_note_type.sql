-- A fourth observation type, Note (docs/DECISIONS.md, "Observations
-- (2026-10-18)", item 13). The client offers it beside Strength, Growth and
-- Concern, but the live database limits observation.sentiment and
-- observation_template.default_sentiment to the three old values through
-- check constraints that schema.sql never recorded (found on the live
-- database on 2026-10-20). Without this change, every Note a signed-in
-- teacher saves fails at create_observation / update_observation /
-- upsert_observation_template with a check violation, and the sync dot
-- turns red.
--
-- The constraints are widened, not dropped: a typo'd type is still refused.
-- No data changes. No function reads the type's value.

alter table public.observation
  drop constraint if exists observation_sentiment_check;
alter table public.observation
  add constraint observation_sentiment_check
  check (sentiment is null or sentiment = any (array['strength', 'growth', 'concern', 'note']));

alter table public.observation_template
  drop constraint if exists observation_template_default_sentiment_check;
alter table public.observation_template
  add constraint observation_template_default_sentiment_check
  check (default_sentiment is null or default_sentiment = any (array['strength', 'growth', 'concern', 'note']));
