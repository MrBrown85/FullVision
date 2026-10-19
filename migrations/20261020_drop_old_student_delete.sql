-- Drop the old student delete and withdraw RPCs (2026-10-20).
--
-- What broke: 20261019_withdraw_students made withdrawal the way a student
-- leaves a class, with delete_withdrawn_student as the only hard delete and
-- only for a student already withdrawn. It left delete_student and
-- withdraw_enrollment in place so tabs still running the previous client
-- kept working during the deploy. While delete_student exists, any
-- authenticated call can still hard-delete an enrolled student, every class
-- they are in, with one request.
--
-- What it does: drops public.delete_student(uuid) and
-- public.withdraw_enrollment(uuid). Nothing in the client, in another
-- function body or in pg_depend refers to either (checked on gradebook-prod
-- before this ran). withdraw_student, reenrol_student and
-- delete_withdrawn_student are unchanged.
--
-- A tab of the old client that calls either one now gets a "function not
-- found" error: the write goes to that tab's dead letter, shows on the sync
-- dot, and is dropped after one more try on the next page load, which also
-- loads the new client.

drop function if exists public.delete_student(uuid);
drop function if exists public.withdraw_enrollment(uuid);
