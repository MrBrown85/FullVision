-- A typed 0 on points work is now a score (2026-10-16,
-- docs/grading-compliance-plan.md 1.5). Until now the client cleared a
-- points cell by sending 0, so every points score of 0 already stored is a
-- cleared cell, not a 0. Clear those values so they don't turn into zeros.
-- Complete/Incomplete work is untouched: there 0 has always meant
-- Incomplete. The rows are kept (they may carry a status or comment) with
-- value set to null, which the client reads as no score. The old values are
-- backed up first. Safe to run again.
create schema if not exists fv_backup;

create table if not exists fv_backup.points_zero_20261016 as
select s.* from public.score s where false;

insert into fv_backup.points_zero_20261016
select s.*
  from public.score s
  join public.assessment a on a.id = s.assessment_id
 where a.score_mode = 'points' and s.value = 0
   and not exists (select 1 from fv_backup.points_zero_20261016 b where b.id = s.id);

update public.score s
   set value = null, updated_at = now()
  from public.assessment a
 where a.id = s.assessment_id and a.score_mode = 'points' and s.value = 0;
