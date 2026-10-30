/**
 * A synthetic class for the evaluation scripts' tests (plan PR 14), in the
 * class-file shape the scripts read: what get_class_bundle returns, its
 * gradebook.course the class's course row. Every name and mark here is
 * invented.
 */

const CID = 'e0000000-0000-4000-8000-000000000001';
const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');

export const STUDENTS = [
  { first: 'Noor', last: 'Haddad', pronouns: 'she/her' },
  { first: 'Mateo', last: 'Reyes', pronouns: 'he/him' },
  { first: 'Priya', last: 'Sandhu', pronouns: '' },
  { first: 'Owen', last: 'Fraser', pronouns: 'he/him' },
  { first: 'Lena', last: 'Okafor', pronouns: 'they/them' },
];

/* Seven assignments in Report 1's term, each scored on one or two of the
   four competencies; titles keep their lesson numbers, as History 12's do. */
export const ASSIGNMENTS = [
  { title: '1.1 Causes of the War', date: '2026-09-10', tags: [0, 1] },
  { title: 'Current Events: Week 1', date: '2026-09-14', tags: [2] },
  { title: 'Current Events: Week 2', date: '2026-09-21', tags: [2] },
  { title: 'Current Events: Week 3', date: '2026-09-28', tags: [2] },
  { title: 'Primary Source Analysis', date: '2026-10-02', tags: [1, 3] },
  { title: 'Lesson 4: Treaty Debate', date: '2026-10-09', tags: [0, 3] },
  { title: 'What Does the Poster Show, and What Does It Hide?', date: '2026-10-16', tags: [1, 2] },
];

const SECTIONS = ['Significance', 'Evidence', 'Continuity and Change', 'Perspective'];

/* Levels per student per assignment (0 = no mark); 'NS' = labelled Missing. */
const MARKS = [
  [4, 3, 4, 4, 4, 4, 3],
  [3, 'NS', 'NS', 'NS', 3, 3, 2],
  [2, 2, 3, 2, 2, 3, 3],
  [3, 3, 3, 'NS', 4, 3, 3],
  [2, 1, 2, 2, 2, 2, 1],
];

export function syntheticClass() {
  const students = STUDENTS.map((s, i) => ({
    enrollment_id: id(100 + i),
    student_id: id(200 + i),
    first_name: s.first,
    last_name: s.last,
    pronouns: s.pronouns,
    roster_position: i + 1,
    designations: [],
    enrolled_at: '2026-09-03',
  }));
  const tagIds = SECTIONS.map((_, i) => id(400 + i));
  const assessments = ASSIGNMENTS.map((a, i) => ({
    id: id(300 + i),
    title: a.title,
    description: '',
    category_id: id(500),
    score_mode: 'proficiency',
    max_points: null,
    weight: 1,
    evidence_type: '',
    rubric_id: null,
    module_id: null,
    collab_mode: null,
    collab_config: {},
    has_rubric: false,
    date_assigned: a.date,
    due_date: a.date,
    display_order: i,
    tag_ids: a.tags.map(t => tagIds[t]),
  }));
  const scoreRows = [];
  const tagRows = [];
  MARKS.forEach((row, si) =>
    row.forEach((m, ai) => {
      if (m === 'NS') {
        scoreRows.push([si, ai, null, 'NS', '']);
        return;
      }
      if (!m) return;
      scoreRows.push([si, ai, m, null, '']);
      ASSIGNMENTS[ai].tags.forEach(t => tagRows.push([si, ai, t, m, 0]));
    }),
  );
  const course = {
    id: CID,
    name: 'History 12',
    grade_level: '12',
    grading_system: 'letter',
    calc_method: 'average',
    late_work_policy: '',
    reporting_terms: [{ ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-20' }],
  };
  const bundle = {
    bundle_schema: 2,
    version: 1,
    gradebook: {
      course,
      students,
      assessments,
      categories: [{ id: id(500), name: 'Assignments', weight: 100, display_order: 0 }],
      modules: [],
      tag_index: tagIds,
      criterion_index: [],
      score_rows: scoreRows,
      tag_rows: tagRows,
      criterion_rows: [],
    },
    learning_map: {
      competency_groups: [],
      subjects: [
        {
          id: id(600),
          name: 'History 12',
          display_order: 0,
          sections: SECTIONS.map((name, i) => ({
            id: id(700 + i),
            name,
            display_order: i,
            competency_group_id: null,
            tags: [{ id: tagIds[i], code: 'H' + (i + 1), label: name, i_can_text: '', display_order: 0 }],
          })),
        },
      ],
    },
    rubrics: { rubrics: [], criteria: [], criterion_tags: [] },
    observations: { observations: [], total: 0 },
    profiles: [],
    term_ratings: [],
    report_config: null,
    custom_tags: [],
    course_config: { reporting_terms: course.reporting_terms },
  };
  return bundle;
}
