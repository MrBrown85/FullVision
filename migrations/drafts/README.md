# Draft migrations: report forms, Phase 4 groundwork

Drafts for review. **Nothing here has been run anywhere.** They live in
`migrations/drafts/` so CI's drift check (which reads only
`migrations/*.sql`) does not count them as unapplied. When one is approved:
test it on a Supabase branch or inside `begin … rollback`, move it to
`migrations/` with its date, apply it, and only then merge the client code
that calls its RPCs (`shared/data.js` reports a missing RPC once and drops
the write, so a client ahead of the database loses work quietly).

| File                  | Adds                                                                                                                        | Needed by                                                                   |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `report_template.sql` | `report_template`: a teacher's saved forms, with `save_report_template`, `list_report_templates`, `delete_report_template`. | Edit Layout's library (today on the device only; `gb-report-templates`).    |
| `report_issue.sql`    | `report_issue` and `report_issue_student`: a fixed copy of every issued report, with create / list / get / delete RPCs.     | Issue Reports (today in the browser's IndexedDB only); reprints; Send.      |
| `guardian.sql`        | `guardian`: who a report goes home to, with consent, plus `upsert_guardian`, `delete_guardian`, `list_course_guardians`.    | Send (Phase 4). Nothing in the app reads it until the policy check is done. |

Order: `report_template`, then `report_issue`, then `guardian`. None depends on another; the order is by how soon each is useful.

## What to look at

1. **Who can read what.** Every table has RLS on, and every policy resolves
   to the signed-in teacher: `report_template.teacher_id = auth.uid()`,
   `report_issue.course_id` through `fv_owns_course`,
   `report_issue_student` through its issue's course, `guardian` through the
   student's `teacher_id`. All RPCs are SECURITY INVOKER, so RLS applies
   inside them too, and each still checks ownership explicitly so a bad id
   raises `P0002` instead of returning nothing. `anon` can run none of them.
2. **Idempotency.** Every write takes `p_idempotency_key` and goes through
   `fv_idem_check` / `fv_idem_store`, as every write RPC does.
3. **Data residency.** Everything stays in the `gradebook-prod` project in
   `ca-central-1`. Issued copies are stored as HTML in Postgres
   (`report_issue_student.html`, roughly 15–40 KB per student per issue).
   Six issues a year for a class of 30 is about 6 MB; at that size Postgres
   is fine. If it grows, the same row can hold a Storage object path instead.
4. **Retention.** Issued copies are records: they are kept until the course
   is purged (the existing 30-day soft-delete purge cascades through
   `course_id`). A teacher can delete an issue by hand. Guardians cascade
   with their student. Templates cascade with the teacher.
5. **The form's shape.** `report_template.form` and `report_issue.form` are
   checked only for being a JSON object with a `front` array; the full
   shape (`ReportSheets.normalizeForm`) stays on the client, as
   `report_config.blocks_config` does today. A server validator would have to
   know every block id and change with each new block.
6. **Consent.** `guardian.consent_at` and `consent_source` record that a
   guardian agreed to receive reports by email, and how. `upsert_guardian`
   never sets consent on its own: the client passes it when a form or the
   roster import says so. Send must refuse any guardian with no consent.

## Client work that follows each

- `report_template`: `shared/data.js` wrappers (`v2.saveReportTemplate`,
  `listReportTemplates`, `deleteReportTemplate`); `ReportSheets.templates()`
  reads the server list when signed in and the device list in Demo Mode.
- `report_issue`: `v2.createReportIssue`, `listReportIssues`,
  `getReportIssue`, `deleteReportIssue`; `report-issues.js` writes the
  server row when signed in and keeps IndexedDB as the cache.
- `guardian`: `v2.upsertGuardian`, `deleteGuardian`, `listCourseGuardians`;
  a Guardians section in Class Management's student editor; a guardian
  email column in the CSV roster import. All of that waits for the policy
  check.
