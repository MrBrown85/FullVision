# Design Decisions — Final

All 49 answers from `decisions.html`, with implementation notes showing how each lands in the design docs. Generated from the questionnaire export on 2026-04-19.

Answers that diverge from my recommendation are **highlighted**. Answers that matched my rec are recorded as-is.

---

## Tier 1 — Infrastructure blockers

| # | Question | Answer | Impact |
|---|---|---|---|
| 1 | Tech stack | **A** — Supabase full stack (Postgres + Auth + Storage + RLS + PostgREST/RPC) | No changes; all design docs already assume this. |
| 2 | Fresh Supabase project | **A** — Fresh project `fullvision-v2`; old stays read-only | Operational note added. |
| 3 | Code location | **A** — Same repo; tag old main as `legacy-v1`; rebuild on fresh branch → new main | Operational note added. |
| 4 | ObservationTemplate creation | **B** — Seeded defaults + teacher can add custom (not edit/delete seeds) ⚠️ differs from REC | **Pass B §10.4 updated**: new write path added for `createCustomObservationTemplate(course_id, body, defaults)`. Seeds are immutable and flagged (`is_seed = true`); teacher-added templates are mutable. `ObservationTemplate.is_seed boolean` added to ERD. |
| 5 | Sign-up gating | **A** — Open self-serve after email verification | Matches Pass C §1. |
| 6 | Email deliverability | **B** — Custom domain SMTP via Supabase | Operational: DNS records (SPF, DKIM, DMARC) for `fullvision.ca`. Documented. |
| 7 | Custom domain ownership | **E (Other)** — owns `fullvision.ca` + `fullvision.netlify.com` (Netlify subdomain) | Primary domain: `fullvision.ca`. Netlify deploy URL stays as fallback. |
| 8 | CI/CD pipeline | **A** — Netlify auto-deploy from git push; branch previews | Matches ops plan. |

---

## Tier 2 — Math that affects grades

| # | Question | Answer | Impact |
|---|---|---|---|
| 9 | Per-tag contribution | **A** — 1 averaged contribution per assessment per section | Matches Pass D §1.5. No change. |
| 10 | Decaying-avg direction | **A** — New dominates: `avg = avg × (1 − dw) + new × dw` | Matches Pass D. User note reaffirms `decayingAvg` is one of multiple `calc_method` options (average / median / mode / mostRecent / highest / decayingAvg). |
| 11 | No-category letter-mode fallback | **A** — Block letter mode until ≥1 category exists | Matches Pass D §1.4 REC. **UI impact**: course-create wizard now prompts "create a category first" if teacher picks `grading_system = letter` without categories. |
| 12 | Rubric with zero criteria linked to tag | **A** — NOT_APPLICABLE, contributes nothing | Matches Pass D §1.2. No change. |
| 13 | Points-mode normalization | **A** — Store raw points; normalize at read time: `(value / max_points) × 4` | Matches Pass D §1.1. |
| 14 | Display rounding | **C** — Both 1 decimal (2.7 / 78.6%) ⚠️ differs from REC | **Pass D §1.4 updated**: percentage rounded to 1 decimal, not whole. Affects gradebook, dashboard, report displays. |
| 15 | Decaying-avg chronological field | **A** — `Assessment.date_assigned` | Matches Pass D §1.5. |
| 16 | Empty category handling | **A** — Drop from calc; renormalize remaining weights | Matches Pass D §1.4. |

---

## Tier 3 — Behavioral defaults

| # | Question | Answer | Impact |
|---|---|---|---|
| 17 | At-risk threshold | **A** — Fixed app-wide: proficiency < 2.0 OR letter % < 60% ⚠️ differs from REC | **Pass D §2.3 updated**: threshold is fixed, not teacher-configurable. Simpler implementation; can revisit later. |
| 18 | Category weights sum | **D + note** — "Don't allow users to exceed 100%" ⚠️ user's note overrides the option letter | **ERD updated**: Category.weight description notes the hard-cap at 100. UI enforces cap on input change (typing a value that would push sum over 100 is rejected or auto-clamped). Teacher cannot save a configuration that sums > 100. |
| 19 | grading_system auto-default | **A** — Grade 8–9 → proficiency; 10–12 → letter; toggle visible | Matches REC. |
| 20 | Per-section calc_method override | **A** — Course-wide only for v1 | Matches REC. |
| 21 | Focus Areas ranking | **A** — Lowest-N sections; zero-evidence first | Matches REC. |
| 22 | Timezone handling | **A** — Per-course TZ; defaults to browser TZ on create | Matches REC. `Course.timezone text` added to ERD. |
| 23 | Gradebook Tab direction | **A** — Right (next assignment, same student) | Matches REC. |
| 24 | Legacy grading-scale UI | **A** — Remove controls entirely | Spec-vs-UI diff finalized. |
| 25 | Legacy summative/formative toggle | **A** — Replace with Category dropdown | Spec-vs-UI diff finalized. |
| 26 | Legacy category-weights controls | **A** — Remove; Categories in dedicated panel | Spec-vs-UI diff finalized. |
| 27 | Course duplicate scope | **A** — Structure only (no students, no scores, no observations) | Matches Pass B §2.4. |

---

## Tier 4 — Quality features

| # | Question | Answer | Impact |
|---|---|---|---|
| 28 | Audit log | **A** — `ScoreAudit` + `TermRatingAudit`; 2-year retention | **ERD updated**: two new entities added. **Pass B updated**: Score and TermRating write paths append to audit tables inside the same transaction. |
| 29 | Soft-delete for Teacher | **A** — `deleted_at` + 30-day grace + scheduled cleanup | **ERD updated**: `Teacher.deleted_at timestamp nullable`. **Pass C §5 updated**: delete-account flips `deleted_at`, queues cleanup job. Scheduled Supabase function runs daily to hard-delete teachers where `deleted_at < now() - interval '30 days'`. |
| 30 | Multi-session caps | **A** — Unlimited | Matches Pass C. |
| 31 | Data export | **A** — JSON in settings + offered at delete | Matches REC. |
| 32 | Rate limiting | **A** — Supabase defaults | Matches REC. |
| 33 | Offline / PWA behavior | **B** — Full offline with write queue and sync ⚠️ differs from REC | **Major architectural addition**. Write queue in localStorage for offline writes; sync-on-reconnect; last-write-wins conflict resolution (matches existing Pass B upsert semantics). **Flagged as separate workstream** in a new `offline-sync.md` design doc (stub created; full spec to follow during implementation). |
| 34 | Error monitoring | **A** — Sentry | User note ("Playwright") interpreted as: E2E testing via Playwright is separate. Sentry remains the answer for runtime error capture. |
| 35 | Backup strategy | **A** — Managed daily + weekly manual JSON | User has Supabase Pro → PITR (Point-In-Time-Recovery) enabled; retention 7 days. Weekly JSON export to local machine is belt-and-suspenders. |
| 36 | Analytics | **A** — None in v1 | Matches REC. |
| 37 | Testing | **A** — Critical paths only (auth + scoring + Pass D computations + persistence) | Matches REC. Existing Playwright config reused for E2E on critical flows. |

---

## Pass A — surviving open questions

| # | Question | Answer | Impact |
|---|---|---|---|
| 38 | CustomTag vs Tag | **A** — Permanently distinct | Matches REC. |
| 39 | Term identifier | **A** — Int 1–6 | Matches REC. |
| 40 | Rubric scope | **A** — Course-scoped; duplicated on course duplicate | Matches REC. |
| 41 | Student ownership | **A** — Teacher-owned (`Student.teacher_id` FK) | Matches REC. |
| 42 | Student data carry-forward across years | **B** — No carry-forward; each course is its own sandbox ⚠️ differs from REC | **Pass D §2.2 updated**: student profile shows only THIS course's data. Teacher-owned Student still allows the DB-level shared record, but UI scopes all reads to the active course's Enrollment. Historical panel deferred to v2+. |

---

## Product / content decisions

### 43. Demo seed content

| Sub-question | Answer | Decision |
|---|---|---|
| a. Grade + subject | **B** | Grade 8 Humanities (proficiency-focused class showcasing the competency pipeline) |
| b. Student count | **C** | 20–30 (full secondary class) |
| c. Assessment mix | **A** | ~8 assessments, mix of rubric + direct-scored, varied completion |
| d. Dataset personality | **A** | Realistic bell curve |
| e. Extras | **A** | Yes — observations + 1 completed term rating |

**Implementation**: Build a `demo-seed.json` file in the client bundle matching this spec. ~1–2 days of product work during implementation. Seed also used for the "Welcome Class" auto-seed (Q47).

### 44. Report blocks

Selected: **10 blocks**
- ✓ Header
- ✓ Academic Summary
- ✓ Section Outcomes
- ✓ Focus Areas
- ✓ Completion (late work, NS count, excused)
- ✓ Learner Dimensions
- ✓ Teacher Narrative
- ✓ Observations
- ✓ Assessment list (every assessment with score and category)
- ✓ Signature block (teacher + optional principal)

Excluded (not in v1): Cover page, Strengths, Attendance, Goals.

**Impact on Pass D §2.6**: Report payload schema finalized to these 10 blocks.

### 45. First-run onboarding

**D** — Auto-seed a "Welcome Class" with sample students + assessments on first sign-in. ⚠️ differs from REC.

**Pass C §1.3 updated**: after first verified sign-in creates Teacher + TeacherPreference, the bootstrap flow also seeds a Welcome Class from the demo-seed JSON (same content as the demo mode seed per Q47). Teacher sees a populated gradebook immediately. They can delete the Welcome Class anytime.

### 46. Term rating narrative auto-generate

**B + note** — Template-based merge-field narrative. User note: *"This will be written later. It is already significant and attached to a different repo."*

**Interpreted as**: the auto-generate feature is **deferred to a separate implementation workstream** (not in v1 of this rebuild). For v1, the UI button is present but either (a) hidden, or (b) wired to a "coming soon" modal per Q46 option E semantics. **Recommend hiding the button in v1** to avoid the dead-end UX.

### 47. Welcome class content

**A** — Same seed as demo class (use Q43 answers).

One seed file, two use cases. Saves a content-building effort.

---

## Operational setup

| # | Question | Answer | Impact |
|---|---|---|---|
| 48 | Old-site parking | **A** — Subdomain `legacy.fullvision.app` → adjusted to `legacy.fullvision.ca` given domain ownership | DNS record pointing to the current Netlify deploy; old site stays accessible as reference. |
| 49 | Env var strategy | **A** — Separate `.env` files per environment; never coexist | Operational note. |

---

## Material design-doc changes being applied

- **`erd.md` (Pass A)**:
  - `Teacher.deleted_at timestamp nullable` added
  - `ScoreAudit` entity added (8 cols)
  - `TermRatingAudit` entity added (6 cols)
  - `ObservationTemplate.is_seed boolean` added (per Q4)

- **`erd.md`** (folded from the former `erd-amendment-pass-d.md` on 2026-04-19):
  - `Course.timezone text` added (per Q22)
  - Category weights cap documented (per Q18)
  - Legacy UI migration decisions logged (Q24, Q25, Q26)

- **`write-paths.md` (Pass B)**:
  - §10.4 updated: new teacher-editable-template CRUD paths
  - §9 scoring paths: write to `ScoreAudit` inside the transaction
  - §13 term-rating save: write to `TermRatingAudit`
  - Delete-account: soft-delete, queue cleanup

- **`auth-lifecycle.md` (Pass C)**:
  - §1.3 first-verified-sign-in: auto-seed Welcome Class
  - §5 delete-account: soft-delete flow, 30-day grace, cleanup job

- **`read-paths.md` (Pass D)**:
  - §1.4 display rounding: both 1 decimal (2.7 / 78.6%)
  - §1.4 letter-mode: block without categories
  - §2.2 student profile: course-scoped (no carry-forward)
  - §2.3 at-risk threshold: fixed app-wide (<2.0 or <60%)
  - §2.5 term-rating narrative: auto-generate deferred to external workstream

- **New: `offline-sync.md`** stub — placeholder for the full offline architecture (Q33 = B).

---

## Remaining open items

None of the 49 questions left truly unanswered. The following are **implementation-time decisions** that surface when code starts:

1. **Q33 offline spec** — write-queue data structure, conflict resolution UI when reconnecting after a network gap, "pending sync" indicator. First real code decision in the rebuild.
2. **Q46 narrative auto-generate workstream** — deferred to the "other repo" the user mentioned. Not in v1 scope.
3. **Demo seed content authoring** — the actual JSON file with 20–30 fake students, 8 assessments, realistic scores. Product-design work, not engineering.

---

## Next step

Implementation can now start. Recommended kickoff order:

1. Create `fullvision-v2` Supabase project + apply schema migrations ([erd.md](erd.md) is now the single source of truth — the Pass D amendment was folded in on 2026-04-19).
2. Tag current main as `legacy-v1` in git; cut fresh branch for rebuild.
3. Wire auth (Pass C §1–§2 sign-up/sign-in including email verification via custom domain SMTP).
4. Implement Pass B write paths in dependency order (Course → Student → Enrollment → Assessment → Score).
5. Implement Pass D read paths and computation primitives.
6. Build the category-management UI (new feature per Q25, Q26).
7. Wire existing UI components (gradebook, dashboard, reports) to the new API.
8. Offline write queue (Q33) as a dedicated workstream after core is stable.
