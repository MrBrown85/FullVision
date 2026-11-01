# FullVision and MyEducation BC: integration design

Written 2026-10-17. Design only. No code was written and the `~/FullVision` checkout was not touched.

Sources: a read-only walk through MyEd BC (Staff view, SD36, Aspen release 20261.7.334) in the built-in browser; the Ministry's _Using the Competency Based Gradebook v2.9_ and _Traditional Gradebook v2.2_ guides; the Aspen help site; one MyEd Quick Report CSV found on OneDrive (header row only); the FullVision schema and RPC surface in `~/FullVision`.

No student names, numbers, grades or comments appear in this document. "Student A" is a placeholder.

## 0. Summary

MyEd BC gives a teacher three things FullVision can use without any district agreement: a roster list it can export as CSV, a Scores page with "Post Columns" where term levels and comments are typed cell by cell, and a Post Grades button that only the teacher presses. Everything the teacher does there is by hand, in one browser tab, with auto-save per cell and a comment pop-up that enforces a district-set character limit.

The integration fits that shape:

1. **Files.** Import the Quick Report CSV as exported. Match on Pupil #. Read the course from the section code. Export a sheet in MyEd's row order.
2. **Clipboard.** One paste box that recognises a MyEd roster, timetable or comment list. A photo of a printed list goes through the same parser after OCR.
3. **Extension.** A Chrome extension scoped to `myeducation.gov.bc.ca` that reads the roster and the Post Columns grid, fills each student's level and comment after a review step, and reads the grid back to confirm. It never posts.
4. **District.** Aspen's API and scheduled exports feed the same tables later.

Three things in the walk-through change the design more than anything else:

- **Aspen allows one tab per login.** Opening the Scores page in a second tab produced a "Multiple Sessions Detected" page. The extension has to work inside the tab the teacher already has open. It can never open its own.
- **The Scores grid shows names, not Pupil #, by default.** The roster page shows Pupil #. The extension therefore reads the roster first, builds a name-to-number map for that section, and uses it on the grid. Any name that is not unique in the section is flagged, never guessed.
- **MyEd's K-9 scale has four proficiency values and no plus or minus.** FullVision's +/− levels must collapse to the four MyEd codes before anything goes to MyEd. The teacher reports the entry list as `EXT`, `PRF`, `DEV`, `BEG` plus `IE` for insufficient evidence; the scale name says `EMG` (§1.5). The nuance can live in the comment.

## 1. What MyEd's pages look like

### 1.1 Verified live

**Home (Pages tab).** A "Teacher Classes" widget lists each section as `COURSE-SECTION - DESCRIPTION`, for example `MEN--08--Y-01 - EN ENGLISH LANGUAGE ARTS 8 YEAR LONG`. Each row has three columns: Classes Not Meeting, Grades, Email. The row's link opens the roster. The Grades icon opens the section Details page and then the grade input page. Every link is a `javascript:goPreLoad(...)` call that rewrites a Struts URL, so the pages are server-rendered forms, not an SPA.

**Section identifier.** The string `MEN--08--Y-01` is the only course identity a teacher sees. It splits as:

| Part                               | Example                                    | Meaning                                                                                                                       |
| ---------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Ministry course code, 7 characters | `MEN--08`, `MSS--10`, `MPHIL12`, `MWH--12` | `M` + subject code padded with dashes to 4 characters + 2-digit grade. This is the key into FullVision's BC curriculum index. |
| Schedule type                      | `Y` or `S`                                 | Year-long or semester                                                                                                         |
| Optional label                     | `BAND` in `MSS--10--Y-BAND-01`             | District or school free text                                                                                                  |
| Section number                     | `01`                                       | Two digits                                                                                                                    |

The class list page confirms the related fields: Term is `FY` for year-long and `S1` for first-semester sections. The school year appears in the page header as `2026-2027` and in every breadcrumb as `Class List :: 2026-2027 - MEN--08--Y-01 - ...`.

**Gradebook > Class List.** Columns: checkbox, Course, Description, Clssrm, Schedule (`A(1)`, `B(1-2)`), Term (`FY`, `S1`), Weighting (`Total points`), Gradebook. Side tabs for a selected section: Details, Roster, Seating Chart, Groups, Curricular Competencies, Categories, Assignments, Scores.

**Details.** Fields: Course Nickname, Description, Classroom, Schedule, Schedule term, Team, House, Average Mode (Gradebook Default, Categories only, Categories and assignments, Total points, Category total points), Averages grade scale, Portal Notes, "Classes linked for assignments and categories", Drop mode. The grade scale list is the one piece of reporting vocabulary visible to a teacher. SD36's current scales are named `K-9 2023 English EMG-DEV-PRF-EXT`, `K-9 2023 French ÉM-VA-CA-AP` and `10-12 2023 %-LG`. Older scales are prefixed `ZZ` (for example `ZZ EMG-DEV-PRF-EXT`, `ZZ Provincial Mark Scale Final Marks`). This is the strongest evidence that K-9 Learning Updates take the four codes `EMG`, `DEV`, `PRF`, `EXT`, and 10-12 take a percent plus a letter.

**Roster.** A list with a filter menu (Enrolled, Withdrawn, All Records), a field-set menu, Quick Report and Quick Chart menus, and a search box. Default columns:

| Column        | Format                                                                                      |
| ------------- | ------------------------------------------------------------------------------------------- |
| checkbox      | `selectedOids`, value is an Aspen OID (3 letters + 11 alphanumerics)                        |
| Pupil #       | 7 digits. The district student number.                                                      |
| Name          | `Last, First`, legal names                                                                  |
| YOG           | 4-digit year of graduation                                                                  |
| Homeroom      | short code such as a room number or `GYM3`                                                  |
| Info          | a `[X]` link to a pop-up                                                                    |
| Roster Status | `Enrolled`, `Enrolled on M/D/YYYY`, or `Transferred on M/D/YYYY from DESCRIPTION (SECTION)` |

Rows are sorted by last name. The section I looked at had 22 enrolled students. Field sets available to this teacher: `Default Fields`, `SD36 Designations`, `SD36 Student Emails`, `SD36 Usual Last/First Name + Alerts`, `SD36 Usual Last/First Name Fields`, `Contact`, `Teams Import`. The field set decides which columns the CSV export has. `SD36 Designations` and the Usual-name sets are exactly what FullVision's roster wants (designations array, preferred name). `Teams Import` shows the district already expects teachers to export this list into another tool.

Reports menu on the roster: Learning Update, Report Cards (five variants), Quick Chart, Quick Report, My Job Queue. Quick Report offers `Create Quick Report...`, `Web Page (HTML)`, `TXT`, `CSV`, `Microsoft Word (DOC)`. Options menu: Send Email, Show Selected, Omit Selected.

**Curricular Competencies and Rubric Rating Scales** were empty for this section ("No matching records"). This teacher does not use MyEd's competency gradebook, so FullVision owns the competency layer and MyEd only ever receives one level and one comment per student per term.

**Scores (grade input).** URL `staffGradeInputContainer.do?navkey=gradebook.classes.list.input`. Toolbar controls, all `<select>`s that submit the form and reload the page on change:

| Control       | Options seen                             |
| ------------- | ---------------------------------------- |
| Students      | All                                      |
| Grade Columns | All, Averages, **Post Columns - Course** |
| Term          | All, Q1, Q2, Q3, Q4                      |
| Display       | Grade, Color, Due Date, Grade Change     |
| Status        | Enrolled / Withdrawn radios              |
| Class         | the teacher's five sections              |

Buttons: record navigation (first, previous, Find, next, last), Add Assignment. Side-tab leaves under Scores: Student, Assignment. The grid lists students as `Last, First` (a link) plus YOG. There is no Pupil # column by default. A "manage field sets" button exists for the student columns, so a Pupil # column can probably be added, but I could not test it. Hidden form fields include `assignmentOid`, `cellAuditEnabled`, `studentFieldSetOid`, `standardViewColumnFieldSetOid` and the Struts `TOKEN`.

Terms are `Q1` to `Q4` even for year-long sections, so SD36 reports quarterly in MyEd terms. FullVision's Report 1 to 6 must map onto these.

**Multiple sessions.** Opening the Scores page in a second tab of the same browser profile returned a page titled "Multiple Sessions Detected" instead of the grid. The first tab kept working.

### 1.2 From the Ministry guides and Aspen help, not seen live

The classifier that gates this session would not let me change the Grade Columns dropdown, so the Post Columns view itself is described from the documentation. Treat every item here as "confirm on the first live run".

- **Post Columns view.** Grade Columns = `Post Columns - Term` (the guides' name; SD36 shows `Post Columns - Course`) plus a Term. Columns are the transcript definition's columns for that term: a term grade, in SD36 probably a work habits column, and a comment column. Column headers carry a pushpin: black before the posting window (enter but not post), green with a triangle during the window (enter and post), red with a square after Post Grades has been pressed. Whether a red column can be reposted is a school setting.
- **Entering a level.** Type the code into the cell, or press Ctrl+L in the cell for the valid values. The cell turns yellow with "Saving, Please Wait…" above the grid and clears when saved. The guides say not to touch the next cell until the yellow clears. Ctrl+D fills a value down to every student below. Ctrl+K reverts a cell.
- **Entering a comment.** Click the notepad icon in the comment cell. An "Edit Text Comment" pop-up opens with a text area, a character count and limit at the bottom right, a comment-bank triangle, Save, and save-and-move arrows to the previous or next student. Over the limit, the count turns red, the cell turns red, an error shows at the top of the grid, and the comment is not saved. The limit comes from the transcript definition and is set by the district or school. One district guide recommends 2000; SD36's actual number is unknown.
- **Comments and the Standards toggle.** The competency guide says term comments "MUST be entered using the 'Traditional' toggle". The extension must check which toggle is active before touching a comment.
- **Comment bank.** District, school and teacher banks with `{{variable}}` tokens. Ctrl+L in a comment cell opens the pick list. The extension must never send a bare number or short code into a comment cell, because the pick list treats it as a code.
- **Post Grades.** A button at the top of the Scores page, visible only while the school's posting window is open. The pop-up confirms the section and asks for the Grade Term and the grades to post. OK posts to transcripts, turns the pushpin red, and sets a green check in the home widget's Posted column. Repeat per class via the Class dropdown.
- **Update Post Columns.** A three-step wizard that copies gradebook averages into the post columns. Not used by FullVision; the teacher's levels come from FullVision, not MyEd averages.

### 1.3 Quick Report CSV format

One real export was on OneDrive (a 2022 contact list; I read the header line and masked bytes only). Format:

- UTF-8 with a byte order mark. The wizard has an option to drop the BOM.
- CRLF line endings.
- Header row with the field-set labels exactly as shown on screen, for example `Pupil #`.
- Fields quoted only when they contain a comma, so `"Last, First"` is quoted and a 7-digit number is not.
- One row per record in the list. A contact field set produces one row per student-contact pair, so the same Pupil # can repeat. The importer must group by Pupil #.

The 2022 file's header was `S LegalFirst, S LegalLast, Pupil #, Student Email, Relationship, Name, LegalLast, LegalFirst, Parent Email`. Columns that start with `S ` are the student's; the unprefixed `Name`, `LegalLast`, `LegalFirst` are the contact's. A Default Fields export would be `Pupil #, Name, YOG, Homeroom, Roster Status` or close to it, and `SD36 Designations` adds designation codes.

### 1.4 Still unknown

| Question                                                                     | Why it matters                                             | How to settle it                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Exact column labels in `Post Columns - Course` for a K-9 and a 10-12 section | Extension selectors and the export sheet layout            | **Blocked until the school opens Q1 posting.** On Oct 17 the view was empty for every section and the Update Post Columns wizard listed no grade term and no post control. The transcript definitions (§1.5) give the labels in the meantime.                                                        |
| The comment character limit for SD36's K-9 and 10-12 transcript definitions  | AI comment length target                                   | Still open. Needs a live post column; the transcript detail shows comments as plain text, not a field.                                                                                                                                                                                               |
| Whether a level is typed or chosen from a list                               | Fill logic                                                 | Still open for the mechanics. Teacher-reported (Oct 17): grades 8-9 take `EXT`, `PRF`, `DEV`, `BEG`, `IE`; grades 10-12 take a whole-number percent. See §1.5 on the `BEG` vs `EMG` question.                                                                                                        |
| Whether the Scores grid can show Pupil # via its student field set           | Removes the name-matching step                             | **Settled: no.** The student side of the Scores grid is fixed to Name and YOG. The field-set button there manages grade-column sets only (All, Averages, Post Columns - Course, all dynamic). The extension must match by name against a roster read from the Roster page, which does carry Pupil #. |
| Whether SD36 has a work habits column in the post columns                    | Whether FullVision's work habits rating has a home in MyEd | **Settled for last year's definitions: no.** Both the 10-12 and the K-9 transcript definitions carry only a mark and a comment per term, plus Final, Blended Mark and Provincial Exam Mark (§1.5). Work habits, if reported at all, go inside the comment.                                           |
| Posting window dates for Q1 to Q4                                            | Readiness check timing                                     | Still open. Not visible to a teacher account anywhere checked; ask the office or watch for the post columns to appear.                                                                                                                                                                               |
| Whether SD36-managed Chrome allows an unlisted extension                     | Whether layer 3 can ship at all for district devices       | Ask the SD36 IT desk; see §6                                                                                                                                                                                                                                                                         |

### 1.5 Verified on Oct 17, evening: transcript definitions and post-column state

Checked read-only, from the Scores page and from the Student tab's Transcript list. Nothing was posted or saved.

**No post columns exist yet.** With Grade Columns set to `Post Columns - Course`, the grid for every section shows only Name and YOG, for Term = All and for Q1. The `Update Post Columns...` wizard (`updatePostColumns0.do`, step 1 of 3) offers an empty Grade Term list and an empty "Grades to update" list. So the school has not created Q1 post controls. Every §1.4 row that needs a live post column waits for that.

**The Scores page's Options menu** is: Add Assignment (Ctrl+A), Edit Remarks (Ctrl+M), Exempt Current Cell (Ctrl+E), Fill-Down Values (Ctrl+D), Lookup (Ctrl+L), MYP Grade Calculation, Post Grades..., Prepopulate Rubric Scores, Remove Footnote (Ctrl+Shift+L), Revert Current Cell (Ctrl+K), Update Post Columns.... `Post Grades...` and `Update Post Columns...` are the two the extension must never trigger. Reports on that page include `BC Marks Verification with Comments`, `Gradebook Sheet`, `Progress Reports - Term Average` and `Students Missing Self Assessment Document`.

**Transcript definitions in use at SD36** (the Transcript list's definition menu): `3 Term` and `4 Term` variants of `10-12 2023 English %-LG`, `10-12 2023 French %-LG`, `K-9 2023 English EMG-DEV-PRF-EXT`, `K-9 2023 French ÉM-VA-CA-AP`; `Comment Only Courses` (Quarterly, Single Term, Trimesters); `International Baccalaureate` and `International Baccalaureate - 24`. Grandview Heights courses sit on the `4 Term` definitions.

**10-12 columns** (from a 2025-26 record on `4 Term 10-12 2023 English %-LG`): header fields Final, Blended Mark, Provincial Exam Mark, Credit; then under "Grades and Comments", per term: `Q1` → `Q1 Mark`, `Q1 Comment`; the same for Q2, Q3, Q4. Marks are whole-number percents (the record showed values like 88 and 52 for terms and 70 for Final). No letter column, no work habits column. The letter in `%-LG` is derived by MyEd from the percent, so FullVision supplies the percent only.

**K-9 columns** (from a 2025-26 record on `3 Term K-9 2023 English EMG-DEV-PRF-EXT`, at a different school): Final holds a level code (`EXT`); per term: `Tri 1` → `Term 1 Mark`, `Term 1 Comment`, and so on for Tri 2 and Tri 3. Marks are the level codes (`EXT`, `PRF` seen). The 4-term K-9 definition that Grandview uses should follow the same shape with `Q1`..`Q4`; confirm the labels when Q1 post columns appear.

**Level codes, 8-9.** The teacher reports the entry list as `EXT`, `PRF`, `DEV`, `BEG`, `IE`. The grade scale and transcript definition names say `EMG`. Records seen so far show only `EXT` and `PRF`. Before the fill logic is written, confirm from a live Ctrl+L lookup whether the emerging code is `EMG` or `BEG`, and that `IE` (insufficient evidence) is an accepted value. FullVision should store the MyEd code as text and map through a small table rather than hard-coding either spelling.

**Transcript list mechanics**, useful for the clipboard parser and for a future "last term's comments" read: the list has a Filter menu (Current Year, All Records), a Field Set menu (`Default Fields`, `Dates`, `Default Fields + BC`, `SD36 Default + Name`, `SD36 Student Progress Report`, `SD36 BC School Sports - Student Transcript List`), a Sort menu and a transcript-definition menu. Both the filter and the definition choice persist per user. Columns in the default view: Year, Grade, School > Name, SchoolCourse > CrsNo, MasterSchedule > Course, MasterSchedule > SecNo, CourseDesc, Final, Prov Exam, Blended, Credit, MasterSchedule > Teacher, TransDef > Name, RubricDef > Name. Quick Report → CSV exists here too, so a teacher can export a student's history. Records from other schools and districts show, which means the provincial record follows the student; the extension must never read beyond the current section's needs.

**Student list** (Student tab, "Students In My Classes"): default columns UsualLast, UsualFirst, Gen Ident, Gender, Pupil #, Alerts, Photo, QuickStatus, Grade, YOG, EnrStatus, Homeroom, HR Teacher, Designation, HomePhone, DOB, PEN. This is a second place to read Pupil # with usual names, and it carries far more than the import needs; the CSV import should accept this file but keep only the columns in §2.1.

## 2. Layer 1: files

### 2.1 CSV import

Replace the current `import_roster_csv` client path (header detection, name-only dedupe) with a MyEd-aware importer. The existing RPC already matches on student number first, then email, then full name, so most of the work is in the client and in two schema changes.

**Detection.** A file is a MyEd export when the header contains `Pupil #` (any field set) or the trio `Name`, `YOG`, `Roster Status`. Strip the BOM. Accept CRLF or LF.

**Column mapping.** Known labels and where they land:

| MyEd label                                                       | FullVision field                                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `Pupil #`                                                        | `student.student_number` (match key)                                                                                                      |
| `Name` as `Last, First`                                          | `last_name`, `first_name` (legal)                                                                                                         |
| `LegalLast`, `LegalFirst`, `S LegalLast`, `S LegalFirst`         | same, legal                                                                                                                               |
| `Usual First`, `Usual Last` or the SD36 usual-name labels        | `preferred_name` (and a new `usual_last_name`)                                                                                            |
| `YOG`                                                            | new `student.yog`                                                                                                                         |
| `Homeroom`                                                       | new `student.homeroom`                                                                                                                    |
| `Student Email`                                                  | `email`                                                                                                                                   |
| `Roster Status`                                                  | `enrollment.sis_status`; `Transferred on …` and `Enrolled on …` keep the date in `sis_enrolled_on`                                        |
| designation codes from `SD36 Designations`                       | `enrollment.designations[]`, mapped through `BC_DESIGNATIONS` in `shared/constants.js`; unknown codes kept as-is and shown to the teacher |
| contact columns (`Relationship`, `Parent Email`, contact `Name`) | ignored, with a note in the preview that contacts were skipped                                                                            |

Unknown labels go to a one-time mapping dialog whose choices are saved per header fingerprint, so the second class with the same field set imports in one click.

**Section and course.** The file itself does not carry the section code; the roster page does. The import dialog asks for it with a text box that accepts a pasted `MEN--08--Y-01 - EN ENGLISH LANGUAGE ARTS 8 YEAR LONG` line, or a filename like `MEN--08--Y-01.csv`. From the first 7 characters the wizard proposes the BC curriculum course (the index in `curriculum_data.js` keys on course name and grade; add a small code-to-course table, one row per Ministry code the index covers). The teacher confirms. The section string, the Ministry code, the schedule type and the school year are stored on the course (§4.2).

**Preview.** One row per Pupil # with a verdict: New, Already in this class, In another class (link to the same person; no duplicate record), Withdrawn in MyEd, Missing from this file (currently enrolled in FullVision but not in the export). The teacher chooses whether missing students are withdrawn. Withdrawal uses `withdraw_enrollment`, never `delete_student`.

**Commit.** One call to a new `import_sis_roster` RPC (§4.4) with the rows and the section identity. It is idempotent on the file's content hash so a double click or an offline retry cannot enrol twice.

### 2.2 Export sheet in MyEd order

A per-class, per-term sheet with exactly the columns the teacher types into MyEd, in MyEd's row order (sorted by legal last name, then first name, Enrolled only):

`Pupil #`, `Name (Last, First)`, `Level` (as the MyEd code), `Work habits` (if SD36 has that column), `Comment`, `Characters`, `Over limit?`

Formats: CSV, and a print layout matching MyEd's own "Grade Input Sheet" report so a teacher can type from paper. The sheet uses the same `learning_update` rows the extension uses (§4.3), so the three layers never disagree.

## 3. Layer 2: clipboard

One text area labelled "Paste anything from MyEd" on the roster screen. The parser tries detectors in order and shows which one matched:

1. **Roster table.** Lines matching `^\d{7}\t` or `^\d{7}\s{2,}`, with `Last, First` and a 4-digit YOG. Copying the roster list from the browser gives tab-separated cells; copying from a PDF gives runs of spaces. Both handled. Output is the same row shape as §2.1.
2. **Section header.** A line matching the section regex from §1.1. Used to set the course identity if the roster rows follow it.
3. **Timetable.** Lines of `MEN--08--Y-01` plus a block like `A(1)`. Creates one class per section, each pointing at its curriculum course, with no students yet.
4. **Last term's comments.** Pairs of a `Last, First` name line followed by a paragraph. Lands as a prior-term `learning_update` comment for voice training (§5) and as "previous comment" context on the student page. Pupil # is resolved by name against the class roster; unresolved names are listed, not guessed.

**Photo.** A photo or PDF scan of a printed class list goes through a vision model with a prompt that returns the same table shape as detector 1. Names and numbers in the photo are student data, so the call goes through the same server function as the AI comments (§5.4) and the photo is discarded after parsing. The teacher reviews the parsed table before anything is saved, because OCR of 7-digit numbers is the one place a wrong match is likely.

## 4. Schema and RPC changes

Everything below is additive. No existing column changes meaning. All writes stay behind public RPCs with RLS on every table, matching the current rule.

### 4.1 Organization above teacher

```
organization        id uuid, kind text ('district' | 'school'), name text,
                    parent_id uuid null, sis_code text null (district number or school code),
                    created_at
teacher_organization teacher_id, organization_id, role text ('member' | 'admin' | 'principal'),
                    primary key (teacher_id, organization_id)
```

Nothing in layers 1 to 3 requires a row here. The point is that `course`, `student` and `learning_update` get a nullable `organization_id` now, so a district connection (layer 4) can own records that a teacher's connection created, and so a principal view can select by school without a migration that touches every row. A teacher with no organization keeps today's behaviour.

### 4.2 Course identity and terms

```
course + sis_section_code text     -- 'MEN--08--Y-01'
       + sis_course_code  text     -- 'MEN--08'  (first 7 chars)
       + sis_schedule     text     -- 'Y' | 'S'
       + sis_term_code    text     -- 'FY' | 'S1' | 'S2'
       + school_year      text     -- '2026-2027'
       + sis_section_oid  text     -- Aspen OID, only from the extension or API
       + sis_source       text     -- 'csv' | 'paste' | 'extension' | 'api' | null
       + organization_id  uuid null

reporting_term      id uuid, course_id uuid, ordinal int, label text ('Q1'),
                    sis_term_code text, starts_on date, ends_on date,
                    posting_opens date null, posting_closes date null,
                    unique (course_id, ordinal)
```

`term_rating.term` stays the integer it is today. `reporting_term.ordinal` equals that integer, so existing term questionnaires attach to a term by `(course_id, ordinal)` without a data migration. The gradebook term filter the comparison doc asked for reads `starts_on` and `ends_on` from the same table, so one piece of work serves both needs.

### 4.3 Students, enrollments and learning updates

```
student   + legal_first_name text, legal_last_name text, usual_last_name text,
          + yog smallint, homeroom text, sis_student_oid text, organization_id uuid null
          + unique index on (teacher_id, student_number) where student_number is not null

enrollment + sis_status text ('enrolled' | 'withdrawn' | 'transferred' | null)
           + sis_enrolled_on date, sis_last_seen_at timestamptz

learning_update
    id uuid, enrollment_id uuid, reporting_term_id uuid,
    level_code text          -- MyEd code as entered: 'EXT' | 'PRF' | 'DEV' | 'BEG' or 'EMG' | 'IE' | whole-number percent as text
    level_source text        -- 'calc' | 'override' | 'manual'
    work_habits text null
    comment text
    comment_source text      -- 'teacher' | 'ai_draft' | 'ai_edited'
    comment_limit int        -- the MyEd limit in force when written
    status text              -- 'draft' | 'ready' | 'filled' | 'verified' | 'mismatch' | 'posted'
    evidence_hash text       -- hash of the evidence snapshot the draft came from
    myed_filled_at, myed_verified_at timestamptz
    myed_verified_level text, myed_verified_comment_hash text
    posted_confirmed_at timestamptz
    updated_at
    unique (enrollment_id, reporting_term_id)

learning_update_audit   same shape as term_rating_audit

sis_import   id, teacher_id, course_id, source text, content_hash text,
             rows int, created int, matched int, withdrawn int, created_at
```

`learning_update` is the one table all four layers read and write. The export sheet reads it. The extension fills from it and writes the verify result back to it. The district API, when it exists, reads it to push grades and writes `posted_confirmed_at` when the SIS confirms. The `evidence_hash` lets the readiness check say "the draft is older than the evidence".

Student number is the match key everywhere. Today's uniqueness is per teacher. When an organization exists, a second partial unique index on `(organization_id, student_number)` lets two teachers in the same school share one person record through a later `relink_student` pass.

### 4.4 RPCs

| RPC                                                                                                                | Purpose                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `import_sis_roster(p_course_id, p_source, p_section jsonb, p_rows jsonb, p_withdraw_missing bool, p_content_hash)` | Replaces the client-side CSV path. Match order: student*number, then email, then legal full name. Sets the course's `sis*\*`fields on first use. Writes a`sis_import`row. Idempotent on`(teacher_id, p_content_hash)`. |
| `upsert_reporting_terms(p_course_id, p_terms jsonb)`                                                               | Creates Q1 to Q4 or S1 terms with dates.                                                                                                                                                                               |
| `list_learning_updates(p_course_id, p_term_ordinal)`                                                               | Rows in MyEd order with the student's number, legal name, current level from `calc.js` logic as already computed client-side, and the stored draft.                                                                    |
| `save_learning_update(p_enrollment_id, p_term_ordinal, p_patch jsonb)`                                             | Teacher edits. Audited.                                                                                                                                                                                                |
| `save_learning_update_batch(p_course_id, p_term_ordinal, p_rows jsonb)`                                            | AI drafts land in one call.                                                                                                                                                                                            |
| `record_myed_fill(p_items jsonb)`                                                                                  | From the extension: per enrollment, what was written, what was read back, the status. Server computes `verified` or `mismatch`.                                                                                        |
| `get_learning_update_export(p_course_id, p_term_ordinal)`                                                          | The export sheet, server-sorted.                                                                                                                                                                                       |
| `attach_sis_identity(p_course_id, p_section jsonb)`                                                                | Extension or paste sets the section fields without a roster import.                                                                                                                                                    |

`import_roster_csv` and `import_teams_class` stay for now and are removed once the new path has a term of use.

### 4.5 Where levels come from

The level in a `learning_update` row is computed, not typed, unless overridden. For a proficiency class it is the course-level roll-up that `studentGradeSummary` in the live `calc.js` already returns, collapsed to four codes: any `+` or `−` is dropped. For a letter class it is the percent and letter from the same function, with the class's rounding setting. A `section_override` with a reason already exists per competency; a course-level override belongs on the `learning_update` row itself (`level_source = 'override'`), with the reason in the audit row.

## 5. AI comment pipeline

### 5.1 Inputs per student

All from tables that exist today, except the voice profile.

- Course name, grade, term label, and the MyEd character limit for this section.
- Each competency (`section`) with its current level and trend, and the one or two assessments that moved it most.
- Observations in the term: body, sentiment, tags. These are the richest input and the most likely to contain other students' names.
- The term questionnaire: work habits and participation ratings, social traits, strength tags, growth-area tags, and any narrative the teacher already started.
- Goals and reflections the student wrote, with confidence.
- Any `section_override` reason.
- Designation flags only as booleans: `has_iep`, `is_modified`, `language_support`. Never the code list.
- Pronouns from the roster.
- The teacher's voice profile: three to five past comments the teacher wrote, de-identified, plus a few preferences (opening style, whether to name next steps, banned phrases). Stored once per teacher.

### 5.2 De-identification, before anything leaves the server

Done in the server function, not the browser, so it cannot be skipped.

1. The student becomes `{{STUDENT}}`. First name, last name, preferred name and every case and possessive form are replaced in every text field, including observations and goals.
2. Pronouns become tokens: `{{THEY}}`, `{{THEM}}`, `{{THEIR}}`, `{{THEIRS}}`, with capitalised variants. The model writes with tokens; the client substitutes.
3. Student number, email, date of birth, homeroom and YOG are never included.
4. Every other name on the class roster, in any form, becomes `a classmate`. Observations such as "worked with Student B" survive without identifying Student B.
5. A final pass removes anything that still looks like an email, a 7-digit number or a phone number.
6. The prompt sends competency names and evidence, never the raw assessment titles if the teacher marked them private.

What the model sees is a de-identified evidence sheet for one student in one course. What is stored about the call is a row in `ai_generation` with the teacher, course, term, model, token counts, cost and the hash of the de-identified prompt. The prompt text itself is not stored.

### 5.3 Output shape

The model returns JSON, not prose:

```
{ "strengths": ["…", "…"], "growth": ["…"], "support": ["…"], "next_step": "…" | null }
```

Each entry is one sentence written with the tokens. The client assembles the comment in the Ministry's strengths, growth, support order, substitutes name and pronouns, and counts characters against `comment_limit`.

### 5.4 Fitting the limit

The target is 90% of the MyEd limit after substitution, because the real name is usually longer than the token. If the assembled comment is over the limit, the function asks the model once more to shorten to a stated number of characters, keeping the three parts. If it is still over, the client drops the `next_step`, then the second strengths sentence, and shows the teacher what was cut. Nothing is trimmed mid-sentence.

### 5.5 Where it runs

A Netlify function or Supabase Edge Function holding the Anthropic API key. The browser never holds the key. The function takes a course and term, builds one request per student, runs them with modest concurrency, and writes drafts with `save_learning_update_batch`. Model choice per the current API reference, defaulting to the most capable model for drafts and a cheaper one for translations and shortening. The teacher sees drafts arrive student by student, each marked `ai_draft` until edited.

### 5.6 The rest of the AI layer

- **IEP-aware wording.** When `has_iep` or `is_modified` is true, the prompt switches to the Ministry's wording for reporting against IEP goals, and the readiness check asks the teacher to confirm the goals before drafting. The goals themselves come from the `goal` table.
- **Translation for families.** A second call from the final English comment into the family's language, labelled as machine translation on the printed report. Translations never go to MyEd. The language comes from a new `student.home_language` field the teacher sets, never inferred.
- **Readiness check.** Two weeks before `posting_opens`, a page that lists per student: competencies with no evidence this term, students with no observations, drafts older than their evidence, comments over the limit, students in MyEd but not in FullVision and the reverse. Pure SQL plus `calc.js`; no model call.

## 6. Layer 3: the browser extension

### 6.1 Shape

Manifest V3. Three parts:

- **Content script**, injected only on `https://myeducation.gov.bc.ca/aspen/rosterList.do*` and `https://myeducation.gov.bc.ca/aspen/staffGradeInputContainer.do*`. It reads the DOM and types into cells. It has no network access of its own.
- **Service worker**, which talks to FullVision's Supabase RPCs with the teacher's FullVision session and relays results to the content script.
- **Side panel UI**, where the teacher reviews what will be written and watches the ticks appear.

Permissions requested: `host_permissions` for `https://myeducation.gov.bc.ca/aspen/*` and `https://fullvision.ca/*`, plus `storage` and `sidePanel`. Not requested: `tabs`, `webRequest`, `cookies`, `scripting` on all URLs, `history`, `downloads`. The manifest's CSP forbids remote code. The extension ships with pinned selectors and a MyEd release number; if the page's release string differs from what it was tested against it switches to read-only and says so.

**Sign-in.** The teacher signs in to FullVision in a normal tab. The FullVision page hands the extension a short-lived session token through `externally_connectable` messaging; the token lives in `chrome.storage.session`, which clears when the browser closes. The extension never sees, asks for or stores a MyEd password. It works only while the teacher is already signed in to MyEd in that tab.

### 6.2 Reading the roster

On the roster page the content script parses the list rows into the §2.1 row shape and the breadcrumb into the section identity, and reads the active filter so a Withdrawn view is not mistaken for the class. The side panel shows the same preview as the CSV importer and the teacher clicks Apply. This is the only roster path that captures the Aspen section OID and student OIDs, which the district layer later needs.

### 6.3 Filling the Post Columns

Preconditions the extension checks and refuses to continue without:

- Grade Columns is `Post Columns - Course` and a single Term is selected.
- Status is Enrolled. The Traditional toggle, not Standards, is active.
- The term's columns show a green pushpin. A black pin means the window is not open; a red pin means grades were already posted and the extension asks whether the teacher really wants to overwrite.
- The section in the breadcrumb matches the FullVision class the teacher picked.
- Every grid row resolves to exactly one Pupil # through the roster map from §6.2, or through a Pupil # column if the grid shows one.

The review step lists every student with four columns: FullVision level, MyEd current level, FullVision comment (with its character count against the limit the extension read from the first comment pop-up), MyEd current comment. Cells that would not change are greyed. Rows with any conflict are unticked. The teacher ticks what to write and presses Fill.

Fill runs one cell at a time, in grid order:

1. Focus the term grade cell, set the code, send the same key and change events a keystroke sends, blur.
2. Wait until the "Saving, Please Wait…" banner is gone and the cell's background is no longer the saving colour. Give up on a cell after a fixed wait and stop the run.
3. For the comment, click the notepad icon, wait for the Edit Text Comment pop-up, set the text area, read the count and limit the pop-up shows, refuse if over, click the pop-up's Save. Never the arrows, never Ctrl+D, never Ctrl+L.
4. Pause briefly between students so the page is never busier than a fast typist.

A visible banner at the top of the MyEd page says "FullVision is filling this grid. Don't type until it finishes." and has a Stop button. The teacher's keyboard input during a run stops the run.

### 6.4 Verify

After the last cell, the extension reloads the Scores page (same tab, same URL, same dropdown values) and reads every row again. For each student it compares the level code and a normalised comment hash to what it wrote, and shows a tick, a flag with both values, or "not written" for untouched rows. It sends the per-student result to `record_myed_fill`. The side panel then says, in one line, "N verified. Press Post Grades in MyEd when you are ready." The extension has no code path that locates or clicks the Post Grades button.

### 6.5 Failure modes and what the extension does

| Failure                                                  | Behaviour                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| MyEd release string changed, selectors do not match      | Read-only mode; nothing is written; message names the release                                       |
| "Multiple Sessions Detected" or the login page appears   | Stop; tell the teacher to use their existing tab                                                    |
| Session times out mid-run                                | Stop; the completed cells are already auto-saved by MyEd; verify on the next run                    |
| A cell never clears its saving state                     | Stop; mark that student "unknown"; verify reload shows the truth                                    |
| Comment over the limit the pop-up shows                  | Skip that student; show the count; the teacher shortens in FullVision                               |
| Name not unique in the section, or not on the roster map | Row unticked and flagged; never guessed                                                             |
| Student in MyEd not in FullVision                        | Listed as "no data"; untouched                                                                      |
| Student in FullVision but withdrawn in MyEd              | Listed; untouched; offered as a withdrawal in FullVision                                            |
| Red pushpin (already posted)                             | Asks before any write, once per run                                                                 |
| Standards toggle active                                  | Refuses to write comments; explains the Ministry rule                                               |
| The pick list opens because a comment looked like a code | Prevented by never writing a comment under 20 characters or purely numeric                          |
| Teacher types during a run                               | Stops at once                                                                                       |
| Browser closes mid-run                                   | Nothing to undo; MyEd kept what it saved; FullVision shows those students as "filled, not verified" |

### 6.6 What makes it safe

- It only reads the pages the teacher has open and only writes the cells the teacher could type into. It does not send a single request to MyEd that the page itself does not send.
- It runs only on two MyEd URLs and only when the teacher opens the side panel and presses Fill.
- It keeps nothing from MyEd except the roster fields the teacher chose to import and the verify result. No page HTML is stored or sent anywhere.
- No MyEd credential is ever seen. The FullVision token is session-scoped.
- It cannot post. There is no code for it, and the review document (§7) says so.
- Every run is logged in FullVision with who, which class, which term, how many cells, and the verify result.

## 7. The privacy story for a district technology lead

**One sentence.** FullVision's MyEd integration only does what the teacher could do by hand: it reads the class list the teacher can already export, and it types the level and comment the teacher already wrote into the boxes the teacher already types into, and the teacher still presses Post.

**What personal information is involved, and where it goes**

| Data                                                                       | Source                             | Stored where                                                                                                | Leaves Canada?                                                              |
| -------------------------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Pupil #, legal and usual names, YOG, homeroom, designations, roster status | MyEd roster, chosen by the teacher | Supabase `gradebook-prod`, ca-central-1, encrypted at rest, RLS per teacher                                 | No                                                                          |
| Levels, comments, evidence (scores, observations, goals)                   | The teacher, in FullVision         | Same                                                                                                        | No                                                                          |
| De-identified evidence sheet for comment drafting                          | Built server-side                  | Not stored; sent to the model provider for the duration of the request; prompt hash and token counts logged | Yes, with no direct identifiers (see below)                                 |
| Photo of a printed list                                                    | The teacher                        | Not stored; parsed and discarded                                                                            | Yes, with identifiers; opt-in per use and off by default in the School tier |
| MyEd session or password                                                   | Never collected                    | Nowhere                                                                                                     | No                                                                          |

**Why the model call is defensible under FOIPPA.** Section 30.1 of BC's Freedom of Information and Protection of Privacy Act and the 2021 amendments allow personal information to be stored or accessed outside Canada under conditions a public body sets in its privacy impact assessment. FullVision's position is simpler: the model never receives personal information in identifiable form. The evidence sheet has no name, number, email, birthdate, homeroom or classmate names, and the teacher's own words are the only free text. A district PIA still has to say that, which is why the de-identification is server-side and testable, and why FullVision will give a district the de-identification code and a sample sheet to inspect. The photo OCR path is the exception; it is opt-in and documented as such.

**Controls the TL will ask about**

- Teacher-only accounts; no student or parent login; closed signup or district SSO for the School tier.
- Every table under row-level security keyed to the signed-in teacher; every write through an audited RPC; the write-path audit of October 2026 is on file.
- Soft delete and a 30-day purge for classes; withdrawal rather than deletion for students once this design lands; full export so a teacher or district can leave with their data.
- The extension's manifest and source are open to the district for review. It requests two hosts and no broad permissions.
- Posting remains a human act inside MyEd, so MyEd's own audit of who posted what is unchanged.
- The teacher sees exactly what will be written before it is written, and what was read back after.
- Logs of every fill run, kept with the teacher's data and deleted with it.

**What FullVision does not claim.** It is not a MyEd integration in the district's sense; there is no API connection and no data flows from MyEd to FullVision without the teacher acting. Layer 4 would be that, and would start with the district, not the teacher.

## 8. Layer 4: district connection, designed now, built later

When a district pays, the same tables take a different feed:

- Aspen's OneRoster or district-scheduled exports populate `organization`, `course.sis_*`, `student.sis_student_oid` and `enrollment.sis_status` on a schedule. `sis_source = 'api'`. The teacher's roster becomes read-mostly with a "the district's list differs" notice instead of a merge dialog.
- Grade return, if the district enables it, reads `learning_update` rows with status `ready` and writes `posted_confirmed_at`. The extension and the export sheet keep working for teachers whose district has not enabled it.
- `organization_id` on every record is what lets a district administrator see completion across teachers without any row being re-keyed.

Nothing in layers 1 to 3 has to change for this. That is the test of the data model.

## 9. Build order and sizes

Sizes are working days for one person with Claude Code, excluding the posting-window test runs that only real reporting dates allow.

| #   | Piece                                                                                                                                                             | Size            | Depends on                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------------------------- |
| 1   | Schema: `reporting_term`, `organization`, course and student `sis_*` fields, `learning_update` and audit, `sis_import`, student-number unique index, RPCs in §4.4 | 4               | the checkout being brought up to main first |
| 2   | Layer 1 CSV import with field-set mapping, section parsing, course pick, preview and withdraw-missing; drop the name-only dedupe                                  | 3               | 1                                           |
| 3   | Learning Update page in FullVision: per term, per student, level from `calc.js`, comment editor with the character count, status, MyEd-order export sheet         | 4               | 1                                           |
| 4   | Reporting-term filter in the gradebook, reusing `reporting_term` dates                                                                                            | 2               | 1                                           |
| 5   | AI drafts: server function, de-identification with tests, voice profile, output shape, limit fitting                                                              | 5               | 3                                           |
| 6   | Layer 2 clipboard parser for roster, section and timetable; comments paste                                                                                        | 2               | 2                                           |
| 7   | Readiness check page                                                                                                                                              | 2               | 3, 4                                        |
| 8   | Extension: roster read and apply                                                                                                                                  | 3               | 2                                           |
| 9   | Extension: Post Columns review, fill, verify, logging                                                                                                             | 6               | 3, 8, plus the §1.4 answers                 |
| 10  | Live test of 9 across one real posting window with two or three teachers                                                                                          | 5 calendar days | a posting window                            |
| 11  | IEP wording, translation, photo OCR                                                                                                                               | 3               | 5                                           |
| 12  | District layer                                                                                                                                                    | later           | a paying district                           |

Total before the district layer: about 34 working days. Items 2 to 4 are the "this term" work from the roadmap. Item 9 cannot be finished until the §1.4 questions are answered on a live Post Columns page.

## 10. Questions only you can answer

1. The §1.4 table: once the school creates Q1 post columns, one screenshot each of a K-9 and a 10-12 section's Post Columns header row (names covered), the comment pop-up's limit, and what Ctrl+L offers in a term grade cell. Oct 17: no post columns exist yet; the transcript definitions in §1.5 stand in for the labels.
2. Does SD36 management of Chrome on teacher laptops allow an unlisted or developer-mode extension, or only Web Store extensions on an allow list? This decides whether layer 3 is a Web Store listing from day one.
3. Should FullVision's `+` and `−` be dropped silently when collapsing to EMG, DEV, PRF, EXT, or should the draft comment mention "approaching" and "strong" so the nuance survives?
4. Answered Oct 17: 10-12 classes take a whole-number percent only; the letter is MyEd's own (§1.5).
5. Answered Oct 17 for last year's definitions: no work habits column (§1.5). Work habits can only go inside the comment.
6. May your own past Learning Update comments be used as the voice sample, and would you paste a term's worth into the comments parser to seed it?
7. Which family languages matter for translation at your school, so the first release covers the right three or four?
8. Do you want the readiness check to also flag students with no evidence in a competency, or only missing comments and over-limit comments, for the first release?
9. The reporting terms table also gives the gradebook its term filter. Is "all time" still the default view, or does the current term become the default once terms exist?
10. Before any of this is built, the checkout needs to come up to main. Should that happen in a fresh session before item 1, and do you want the 26 uncommitted files stashed or discarded?
