/**
 * My Learning on a student's own device equals Preview as Student.
 *
 * For each class in the matrix below, one source of truth is written once, in
 * the database's own shapes (rows as student_submit.page and get_class_bundle
 * read them), and taken through both doors:
 *
 * - Preview as Student: the teacher's cache built from those rows by
 *   shared/data.js's own loaders (_canonicalLearningMapToCache,
 *   _canonicalRubricRowsToCache, _gradebookCellsToScoreCache), then
 *   StudentView.fromCache(cid, sid, { learning: true }).view.learning.
 * - The student's device: student_submit.page's reply for the same class
 *   (StudentView.reply is that reply field for field, tests/student-view.test.js;
 *   `learning` is written here as E9's SQL builds it, with what the edge must
 *   drop), sent through the student-submit edge function's real handler
 *   (supabase/functions/student-submit/card-routes.ts), then read by
 *   s/student-data.js and drawn by shared/student-view.js in a context of
 *   their own, as on a phone.
 *
 * Every figure, word and list My Learning holds must be equal. `learning` is
 * written as 2026111201's SQL builds it (E9 with grade_level and
 * rubric_tags).
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import BANK_STEPS from '../supabase/functions/_shared/bank-steps.json' with { type: 'json' };
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readCardKey } from '../supabase/functions/_shared/card-key.ts';
import { makeHandler } from '../supabase/functions/student-submit/handler.ts';
import { FAKE_KEY } from './helpers/card-key-fake.js';
import { clearClass, seedClass } from './helpers/pin-save-paths.js';
import { openStudentPage } from './helpers/student-page-context.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(ROOT, file), 'utf-8');
const NOW = '2026-11-12T20:00:00.000Z';
const KEY = await readCardKey(FAKE_KEY);
const SESSION = 'a'.repeat(64);

const u = n => '7e570000-0000-4000-8000-' + String(n).padStart(12, '0');
const CID = u(1);
const S1 = u(2);
const S2 = u(3);
const SUBJ = u(10);
const SEC1 = u(11);
const SEC2 = u(12);
const SEC3 = u(13);
const T1 = u(21);
const T2 = u(22);
const T3 = u(23);
const GRP = u(15);
const R1 = u(31);
const R2 = u(32);
const C1 = u(41);
const C2 = u(42);
const C3 = u(43);
const K1 = u(51);
const K2 = u(52);
const CAT_TESTS = u(61);
const CAT_PROJ = u(62);
const CAT_PRAC = u(63);
const MOD = u(70);
const A = {
  essay: u(101),
  lab: u(102),
  quick: u(103),
  contract: u(104),
  missing: u(105),
  excused: u(106),
  late: u(107),
  micro: u(108),
  draft: u(109),
  reflect: u(110),
  overall: u(111),
  quiz2: u(112),
  future: u(113),
  entered: u(114),
};

// A skill from the BC bank, so the edge's Next Step sentences are in play.
const BANK = Object.keys(BANK_STEPS.ids).find(id => !BANK_STEPS.sensitive.includes(id));

/* ── The class, in the database's shapes ─────────────────────── */

// The learning map as get_class_bundle and E9 send it (a section name with brackets and over 20 letters, as many are).
const SUBJECTS = [
  {
    id: SUBJ,
    name: 'History 12',
    display_order: 0,
    sections: [
      {
        id: SEC1,
        name: 'Using Evidence (Primary and Secondary Sources)',
        display_order: 0,
        competency_group_id: GRP,
        tags: [
          {
            id: T1,
            code: 'EV',
            label: 'Use Evidence',
            i_can_text: 'Use evidence from primary and secondary sources.',
            i_can_statements: ['I can name where a source comes from.', 'I can weigh what it shows.'],
            bank_id: BANK,
            display_order: 0,
          },
        ],
      },
      {
        id: SEC2,
        name: 'Significance',
        display_order: 1,
        competency_group_id: GRP,
        tags: [
          {
            id: T2,
            code: 'SIG',
            label: 'Historical Significance',
            i_can_text: null,
            i_can_statements: [],
            bank_id: null,
            display_order: 0,
          },
        ],
      },
      {
        id: SEC3,
        name: 'Cause and Consequence',
        display_order: 2,
        competency_group_id: null,
        tags: [
          {
            id: T3,
            code: 'CC',
            label: 'Cause and Consequence',
            i_can_text: null,
            i_can_statements: ['I can say why it happened.'],
            bank_id: null,
            display_order: 0,
          },
        ],
      },
    ],
  },
];
const GROUPS = [
  { id: GRP, name: 'Thinking Like a Historian', color: '#336699', display_order: 0, counts_as_one: true },
];
const CATEGORIES = [
  { id: CAT_TESTS, name: 'Tests', weight: 40, display_order: 0, calc_mode: 'points' },
  { id: CAT_PROJ, name: 'Projects', weight: 60, display_order: 1, calc_mode: 'percent' },
  { id: CAT_PRAC, name: 'Practice', weight: 0, display_order: 2, calc_mode: 'points' },
];

const LEVELS = { 1: 'Starting out', 2: 'On the way', 3: 'Got it', 4: 'Beyond it' };
const criterionRow = (id, rubric, name, order) => ({
  id,
  rubric_id: rubric,
  name,
  weight: 1,
  display_order: order,
  level_1_value: 1,
  level_2_value: 2,
  level_3_value: 3,
  level_4_value: 4,
  level_1_descriptor: LEVELS[1],
  level_2_descriptor: LEVELS[2],
  level_3_descriptor: LEVELS[3],
  level_4_descriptor: LEVELS[4],
});
function rubricRows(opts) {
  return {
    rubrics: [
      { id: R1, name: 'Source Analysis', style: 'standard', created_at: '2026-09-01T00:00:00Z' },
      { id: R2, name: 'Essay Skills', style: 'advanced', created_at: '2026-09-02T00:00:00Z' },
    ],
    criteria: [
      criterionRow(C1, R1, 'Sourcing', 0),
      criterionRow(C2, R1, 'Corroborating', 1),
      criterionRow(C3, R2, 'Argument', 0),
    ],
    // Each criterion's competencies; with wholeRubric, Essay Skills scores Significance as a whole instead.
    criterionTags: opts.wholeRubric
      ? [
          { criterion_id: C1, tag_id: T1 },
          { criterion_id: C2, tag_id: T1 },
        ]
      : [
          { criterion_id: C1, tag_id: T1 },
          { criterion_id: C2, tag_id: T3 },
          { criterion_id: C3, tag_id: T2 },
        ],
    checks: [
      { id: K1, criterion_id: C3, level: 3, label: 'States a claim', display_order: 0 },
      { id: K2, criterion_id: C3, level: 4, label: 'Answers the other side', display_order: 1 },
    ],
    rubricTags: opts.wholeRubric ? [{ rubric_id: R2, tag_id: T2 }] : [],
  };
}

/* When the teacher made each piece (assessment.created_at, the server's clock,
   to the microsecond as the route sends it). Most pieces were made a few days
   before their date; some were entered late (Field Trip Form, Changed
   Reflection, Primary Source Analysis) and some early (Overall Piece, Future
   Quiz), so the order they were made in is not the order of their dates. */
const MADE = {
  [A.essay]: '2026-09-28T16:02:11.123456+00:00',
  [A.lab]: '2026-10-01T15:40:00.5+00:00',
  [A.quick]: '2026-10-10T19:12:45.000001+00:00',
  [A.contract]: '2026-09-02T14:00:00+00:00',
  [A.missing]: '2026-10-12T17:30:00+00:00',
  [A.excused]: '2026-10-20T21:05:00+00:00',
  [A.late]: '2026-10-14T16:00:00+00:00',
  [A.micro]: '2026-10-15T16:00:00+00:00',
  [A.draft]: '2026-10-19T16:00:00+00:00',
  [A.reflect]: '2026-11-01T18:20:00+00:00',
  [A.overall]: '2026-08-30T12:00:00+00:00',
  [A.quiz2]: '2026-10-22T15:00:00+00:00',
  [A.future]: '2026-11-05T15:00:00+00:00',
  [A.entered]: '2026-11-01T18:45:30.25+00:00',
};
// The teacher's assessments (the client's shape, as a class load leaves them).
const piece = (id, title, date, extra) =>
  Object.assign(
    { id, title, date, dueDate: date, type: 'summative', weight: 1, tagIds: [], created_at: MADE[id] || null },
    extra,
  );
const FULL = [
  piece(A.essay, 'DBQ Essay', '2026-10-01', { tagIds: [T1, T2], categoryId: CAT_PROJ, moduleId: MOD }),
  piece(A.lab, 'Source Analysis 1', '2026-10-05', { tagIds: [T1, T3], rubricId: R1, categoryId: CAT_PROJ }),
  piece(A.quick, 'Quick Check', '2026-10-10', {
    scoreMode: 'points',
    maxPoints: 10,
    tagIds: [T1],
    categoryId: CAT_TESTS,
  }),
  piece(A.contract, 'Course Outline Signed', '2026-09-10', { scoreMode: 'complete', categoryId: CAT_PRAC }),
  piece(A.missing, 'Unit Test', '2026-10-12', {
    scoreMode: 'points',
    maxPoints: 20,
    tagIds: [T3],
    categoryId: CAT_TESTS,
  }),
  piece(A.excused, 'Field Trip Form', '2026-10-14', { scoreMode: 'complete', categoryId: CAT_PRAC }),
  piece(A.late, 'Timeline', '2026-10-16', { tagIds: [T3], categoryId: CAT_PROJ }),
  piece(A.micro, 'Argument Paragraph', '2026-10-18', { tagIds: [T2], rubricId: R2, categoryId: CAT_PROJ }),
  piece(A.draft, 'Draft Poster', '2026-10-20', { tagIds: [T1, T2], categoryId: CAT_PROJ }),
  piece(A.reflect, 'Changed Reflection', '2026-10-08', { tagIds: [T2], categoryId: CAT_PROJ }),
  piece(A.overall, 'Overall Piece', '2026-10-03', { categoryId: CAT_PRAC }),
  piece(A.quiz2, 'Map Quiz', '2026-10-22', { scoreMode: 'points', maxPoints: 10, tagIds: [T1], categoryId: CAT_TESTS }),
  piece(A.future, 'Future Quiz', '2026-12-01', { tagIds: [T1], categoryId: CAT_TESTS }),
  // Dated Oct 10, the same day as Quick Check, but entered on Nov 1: it counts by its date.
  piece(A.entered, 'Primary Source Analysis', '2026-10-10', { tagIds: [T1], categoryId: CAT_PROJ }),
];

const lv = (value, modifier, comment) => ({ value, modifier: modifier || 0, comment: comment || null });
const cv = (value, modifier, comment) => ({ value, modifier: modifier || 0, comment: comment || null, beyond: null });
const copy = parts =>
  Object.assign({ v: 1, value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] }, parts);

// The teacher's working scores for the student, and for another student (who must never show).
const WORKING = {
  [A.essay]: { comment: 'Well argued.', tags: { [T1]: lv(3, 1), [T2]: lv(4) } },
  [A.lab]: { comment: 'Good sourcing.', criteria: { [C1]: cv(4), [C2]: cv(2, 0, 'Check the date.') } },
  [A.quick]: { value: 8 },
  [A.contract]: { value: 1 },
  [A.missing]: { status: 'NS' },
  [A.excused]: { status: 'EXC' },
  [A.late]: { tags: { [T3]: lv(2) }, status: 'LATE' },
  [A.micro]: { criteria: { [C3]: cv(4, 0, 'DRAFT-SECRET sharp') }, checks: [K1, K2] },
  [A.draft]: { comment: 'DRAFT-SECRET poster', tags: { [T1]: lv(1), [T2]: lv(1) } },
  [A.reflect]: { comment: 'DRAFT-SECRET reflection', tags: { [T2]: lv(1) } },
  [A.overall]: { value: 3, comment: 'A solid piece.' },
  [A.quiz2]: { value: 9 },
  [A.entered]: { comment: 'Good use of the letter.', tags: { [T1]: lv(2) } },
};
const OTHER = {
  [A.essay]: { tags: { [T1]: lv(1), [T2]: lv(1) } },
  [A.quick]: { value: 1 },
};
const ROWS = {
  [A.essay]: { is_draft: false, returned_at: '2026-10-05T18:00:00Z' },
  [A.lab]: { is_draft: false, returned_at: '2026-10-08T18:00:00Z' },
  [A.quick]: { is_draft: false, returned_at: '2026-10-11T18:00:00Z' },
  [A.contract]: { is_draft: false, returned_at: '2026-09-20T18:00:00Z' },
  [A.missing]: { is_draft: false, returned_at: '2026-10-20T18:00:00Z' },
  [A.late]: { is_draft: false, returned_at: '2026-10-25T18:00:00Z' },
  [A.micro]: {
    is_draft: true,
    returned_at: '2026-10-28T18:00:00Z',
    returned_copy: copy({ criteria: { [C3]: cv(3) }, checks: [K1] }),
  },
  [A.draft]: { is_draft: true },
  [A.reflect]: {
    is_draft: true,
    returned_at: '2026-10-09T18:00:00Z',
    returned_copy: copy({ comment: 'Good start.', tags: { [T2]: lv(3) } }),
  },
  [A.overall]: { is_draft: false, returned_at: '2026-10-22T18:00:00Z' },
  [A.quiz2]: { is_draft: false, returned_at: '2026-10-23T18:00:00Z' },
  [A.entered]: { is_draft: false, returned_at: '2026-11-02T18:00:00Z' },
};
const NONE_BACK = Object.fromEntries(Object.keys(ROWS).map(k => [k, { is_draft: true }]));

function cellOf(w) {
  return {
    score: {
      value: w.value == null ? null : w.value,
      modifier: w.modifier || 0,
      comment: w.comment || null,
      status: w.status || null,
    },
    tag_scores: Object.entries(w.tags || {}).map(([tag_id, r]) => Object.assign({ tag_id }, r)),
    rubric_scores: Object.entries(w.criteria || {}).map(([criterion_id, r]) => Object.assign({ criterion_id }, r)),
  };
}

/* One class of the matrix: { system, gradeLevel, roundPercent (true,
   false or null: never chosen), terms, overrides, working, rows,
   assessments, wholeRubric, calcMethod }. Seeds the teacher's cache from
   the rows and returns the database's `page` reply for S1. */
function makeClass(opts) {
  const o = Object.assign(
    {
      system: 'both',
      gradeLevel: '12',
      roundPercent: true,
      terms: null,
      overrides: {},
      working: WORKING,
      rows: ROWS,
      assessments: FULL,
      wholeRubric: false,
      calcMethod: 'mostRecent',
    },
    opts,
  );
  localStorage.clear();
  clearClass(CID);
  const assessments = structuredClone(o.assessments);
  const ids = new Set(assessments.map(a => a.id));
  const only = byId => Object.fromEntries(Object.entries(byId).filter(([k]) => ids.has(k)));
  const working = only(o.working);
  const rows = only(o.rows);
  const cells = { [S1]: {}, [S2]: {} };
  const statuses = {};
  const checks = {};
  Object.entries(working).forEach(([aid, w]) => {
    cells[S1][aid] = cellOf(w);
    if (w.status) statuses[S1 + ':' + aid] = w.status;
    if (w.checks) checks[S1 + ':' + aid] = w.checks.slice();
  });
  Object.entries(only(OTHER)).forEach(([aid, w]) => (cells[S2][aid] = cellOf(w)));
  const r = rubricRows(o);
  const config = { student_page_enabled: true, return_grades: 'on_return', calcMethod: o.calcMethod };
  if (typeof o.roundPercent === 'boolean') config.roundPercent = o.roundPercent;
  if (o.terms) config.reportingTerms = structuredClone(o.terms);
  const returns = {};
  Object.entries(rows).forEach(([aid, row]) => (returns[aid] = { [S1]: structuredClone(row) }));
  const course = { id: CID, name: 'History 12', block: 'A', gradingSystem: o.system, gradeLevel: o.gradeLevel };
  COURSES[CID] = course;
  const map = _canonicalLearningMapToCache(CID, { subjects: SUBJECTS, competency_groups: GROUPS });
  seedClass(CID, {
    students: [
      { id: S1, firstName: 'Jordan', lastName: 'Lee' },
      { id: S2, firstName: 'Avery', lastName: 'Kim' },
    ],
    assessments,
    scores: _gradebookCellsToScoreCache(CID, assessments, cells).scores,
    statuses,
    rubrics: _canonicalRubricRowsToCache(r.rubrics, r.criteria, r.criterionTags, r.checks, r.rubricTags),
    rubricChecks: checks,
    learningMaps: map,
    courseConfigs: config,
    gradeReturns: returns,
    categories: CATEGORIES.map(k => ({
      id: k.id,
      name: k.name,
      weight: k.weight,
      displayOrder: k.display_order,
      calcMode: k.calc_mode,
    })),
    modules: [{ id: MOD, name: 'Unit 1: Confederation' }],
    overrides: Object.keys(o.overrides).length ? { [S1]: structuredClone(o.overrides) } : {},
  });
  COURSES[CID] = course;
  delete _returnedSets[CID];
  clearProfCache();
  return { opts: o, rubric: r };
}

/* student_submit.page's reply for S1 as the database sends it to the edge,
   with Show My Learning on: E9's learning block, written from the same rows,
   with what the edge must drop beside it (the teacher's reason, a tag's
   source_text, the teacher's id and name, another student's rows). */
function databaseReply(klass, shape) {
  const o = klass.opts;
  const page = StudentView.reply(CID, S1);
  delete page.course.id;
  page.course.teacher_name = 'Colin Brown';
  const byId = Object.fromEntries(o.assessments.map(a => [a.id, a]));
  page.assessments.forEach(a => {
    a.category_id = (byId[a.id] && byId[a.id].categoryId) || null;
  });
  page.show_my_learning = true;
  page.learning = {
    course: {
      grading_system: o.system,
      calc_method: o.calcMethod,
      decay_weight: null,
      recent_score_limit: null,
      grading_scale: null,
      category_weights: null,
      round_percent: typeof o.roundPercent === 'boolean' ? o.roundPercent : null,
      level_order: 'desc',
      reporting_terms: o.terms ? structuredClone(o.terms) : null,
      timezone: 'America/Vancouver',
      folders_count_as_one: true,
      courses_count_equally: false,
      // 2026111201: the class's grade level.
      grade_level: o.gradeLevel,
      // Not on E9's list: the edge drops it.
      teacher_id: u(900),
    },
    // 2026111201: the competencies each listed rubric scores as a whole.
    rubric_tags: klass.rubric.rubricTags.reduce((out, x) => {
      (out[x.rubric_id] = out[x.rubric_id] || []).push(x.tag_id);
      return out;
    }, {}),
    categories: CATEGORIES.map(k => Object.assign({ course_id: CID }, k)),
    section_overrides: Object.fromEntries(
      Object.entries(o.overrides).map(([sec, x]) => [sec, { level: x.level, date: x.date, reason: x.reason }]),
    ),
    competency_groups: structuredClone(GROUPS),
    subjects: JSON.parse(
      JSON.stringify(SUBJECTS, (k, v) =>
        k === 'tags' ? v.map(t => Object.assign({ source_text: 'Ministry words' }, t)) : v,
      ),
    ),
    scores: [{ enrollment_id: S2, value: 1 }],
  };
  // page as live is today, before 2026111201: neither of that file's two keys.
  if (shape === 'live') {
    delete page.learning.course.grade_level;
    delete page.learning.rubric_tags;
  }
  return page;
}

// The page as the phone gets it: through the edge function's own handler.
async function throughEdge(dbReply) {
  const handle = makeHandler({
    region: 'ca-central-1',
    ipKey: 'test-key',
    cardKey: KEY,
    log: () => {},
    db: {
      open: async () => ({ ok: true }),
      verify: async () => ({ ok: true }),
      check: async () => ({ ok: true }),
      submit: async () => ({ ok: true }),
      async call(text) {
        if (!text.startsWith('select student_submit.page(')) throw new Error('unexpected ' + text);
        return JSON.parse(JSON.stringify(dbReply));
      },
    },
  });
  const res = await handle(
    new Request('https://x.supabase.co/functions/v1/student-submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://fullvision.ca',
        'cf-connecting-ip': '203.0.113.7',
      },
      body: JSON.stringify({ route: 'page', session: SESSION, enrollment_id: S1 }),
    }),
  );
  expect(res.status).toBe(200);
  return res.text();
}

/* The student's side: the scripts s/index.html names, then constants.js,
   calc.js and student-view.js, as the page fetches them for My Learning. */
function phone() {
  const page = openStudentPage();
  ['shared/constants.js', 'shared/calc.js', 'shared/student-view.js'].forEach(f =>
    vm.runInContext(read(f), page.ctx, { filename: f }),
  );
  return {
    page,
    learning(text) {
      page.ctx.__reply = JSON.parse(text);
      return JSON.parse(
        page.run(
          'StudentData.use(StudentData.fromServer(__reply)); JSON.stringify(StudentView.fromPage(__reply, StudentData.page()).learning)',
        ),
      );
    },
  };
}

const preview = () => StudentView.fromCache(CID, S1, { learning: true }).view.learning;

async function compare(opts, device, shape) {
  const klass = makeClass(opts);
  const want = preview();
  const text = await throughEdge(databaseReply(klass, shape));
  // Nothing of another student, no teacher's reason, no draft's words reach the phone.
  expect(text).not.toContain(S2);
  expect(text).not.toMatch(/DRAFT-SECRET|Colin Brown|Ministry words|teacher_id/);
  const got = (device || phone()).learning(text);
  return { want, got, text };
}

const ENDED = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-02', ends_on: '2026-10-31' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-11-01', ends_on: '2026-11-10' },
];
const OPEN_TERMS = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-02', ends_on: '2026-10-31' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-11-01', ends_on: '2027-01-29' },
];
// Under 50% from returned work.
const LOW = Object.assign({}, WORKING, {
  [A.essay]: { tags: { [T1]: lv(1), [T2]: lv(1) } },
  [A.lab]: { criteria: { [C1]: cv(1), [C2]: cv(1) } },
  [A.quick]: { value: 1 },
  [A.quiz2]: { value: 0 },
  [A.late]: { tags: { [T3]: lv(1) }, status: 'LATE' },
  [A.overall]: { value: 1 },
});
const POINTS_ONLY = FULL.filter(a => a.scoreMode === 'points');
const OVERRIDE = { [SEC2]: { level: 1, reason: 'DRAFT-SECRET talked it over', date: '2026-11-01T18:00:00Z' } };

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterAll(() => {
  vi.useRealTimers();
  clearClass(CID);
});

describe('My Learning on a student’s device equals Preview as Student', () => {
  for (const system of ['proficiency', 'both', 'letter']) {
    describe('a ' + system + ' class', () => {
      it('weighted categories; points, Complete, competency and rubric work; Missing, Excused, Late; drafts', async () => {
        const { want, got } = await compare({ system });
        expect(want.empty).toBeFalsy();
        // Rubric work counts toward its competencies on both sides.
        const skills = want.groups.flatMap(g => g.skills);
        expect(skills.find(s => s.id === SEC3)).toBeTruthy();
        expect(got).toEqual(want);
      });

      it('a level set by hand', async () => {
        const { want, got } = await compare({ system, overrides: OVERRIDE });
        expect(want.groups.flatMap(g => g.skills).find(s => s.id === SEC2).level).toBe(1);
        expect(got).toEqual(want);
      });

      it('nothing returned yet', async () => {
        const { want, got } = await compare({ system, rows: NONE_BACK });
        expect(got).toEqual(want);
      });

      it('reporting terms, the last not yet over', async () => {
        const { want, got } = await compare({ system, terms: OPEN_TERMS, working: LOW });
        expect(got).toEqual(want);
      });
    });
  }

  for (const system of ['both', 'letter']) {
    it('a ' + system + ' class with points work only', async () => {
      const { want, got } = await compare({ system, assessments: POINTS_ONLY });
      expect(got).toEqual(want);
    });

    it('a ' + system + ' class whose last reporting term has ended, under 50%: F, as the teacher sees', async () => {
      const { want, got } = await compare({ system, terms: ENDED, working: LOW });
      expect(want.overall.letter.grade).toBe('F');
      expect(got).toEqual(want);
    });

    it('a ' + system + ' class at grade 8 whose rounding was never chosen', async () => {
      const { want, got } = await compare({ system, gradeLevel: '8', roundPercent: null });
      expect(got).toEqual(want);
    });

    // F2: with rounding never chosen, a grade 10–12 class shows a whole %, which
    // the device knows from learning.course.grade_level (2026111201).
    it('a ' + system + ' class at grade 12 whose rounding was never chosen', async () => {
      const { want, got } = await compare({ system, gradeLevel: '12', roundPercent: null });
      expect(got.categories.find(k => k.id === CAT_PROJ).text).toBe('C+ 69%');
      expect(got).toEqual(want);
    });

    // The same class with page as live is today (no grade_level): the device shows one decimal (Projects).
    // Projects holds Primary Source Analysis (entered late, PR 1273), so it reads C+ 69%, not the B 73% it read before.
    it(
      'a ' +
        system +
        ' class at grade 12 whose rounding was never chosen, with page as it is before 2026111201, differs',
      async () => {
        const { want, got } = await compare({ system, gradeLevel: '12', roundPercent: null }, null, 'live');
        const projects = view => view.categories.find(k => k.id === CAT_PROJ).text;
        expect(projects(want)).toBe('C+ 69%');
        expect(projects(got)).toBe('C+ 69.4%');
        expect(got).not.toEqual(want);
      },
    );
  }

  // A rubric that scores a competency as a whole (rubric_tag) counts toward it
  // on the device from learning.rubric_tags (2026111201).
  it('a rubric that scores a competency as a whole', async () => {
    const { want, got } = await compare({ system: 'letter', wholeRubric: true });
    expect(want.groups.flatMap(g => g.skills).find(s => s.id === SEC2).pieces.length).toBeGreaterThan(0);
    expect(got).toEqual(want);
  });

  // The same with page as live is today (no rubric_tags): the whole-rubric work counts toward nothing.
  it('a rubric that scores a competency as a whole, with page as it is before 2026111201, differs', async () => {
    const { want, got } = await compare({ system: 'letter', wholeRubric: true }, null, 'live');
    const titles = skills => skills.find(s => s.id === SEC2).pieces.map(p => p.title);
    expect(titles(want.groups.flatMap(g => g.skills))).toContain('Argument Paragraph');
    expect(titles(got.groups.flatMap(g => g.skills))).not.toContain('Argument Paragraph');
  });

  /* The review of PR 1268: a piece dated Oct 10 but entered on Nov 1 (Primary
     Source Analysis, Developing) counts by its date, before the Map Quiz of
     Oct 22, not as the newest piece. Most Recent reads the skill from the Map
     Quiz on both sides. Before the device's score entries carried the piece's
     date, the device read it from the piece entered last. */
  it('a Letter class with a piece entered late: Most Recent goes by its date, as in Preview', async () => {
    const { want, got } = await compare({ system: 'letter' });
    const evidence = want.groups.flatMap(g => g.skills).find(s => s.id === SEC1);
    expect(evidence.pieces[0].title).toBe('Map Quiz');
    expect(evidence.text).not.toBe('50%');
    expect(got).toEqual(want);
  });

  it('a Proficiency class with a piece entered late: the same level and Next Step as in Preview', async () => {
    const { want, got } = await compare({ system: 'proficiency' });
    const evidence = want.groups.flatMap(g => g.skills).find(s => s.id === SEC1);
    expect(evidence.level).toBe(4);
    expect(evidence.text).toBe('Extending');
    expect(got.groups.flatMap(g => g.skills).find(s => s.id === SEC1)).toEqual(evidence);
    expect(got.next).toEqual(want.next);
    expect(got).toEqual(want);
  });

  /* The review of PR 1268, minor: a grade returned on work dated after today.
     The server's page leaves that work out (date_assigned on or before the
     class's today), so the student does not see it; Preview as Student now
     leaves it out too. The teacher's own grade, outside Preview, still counts it. */
  it('a returned grade on work dated after today: Preview leaves it out, as the student’s page does', async () => {
    const working = Object.assign({}, WORKING, { [A.future]: { tags: { [T1]: lv(1) } } });
    const rows = Object.assign({}, ROWS, { [A.future]: { is_draft: false, returned_at: '2026-11-10T18:00:00Z' } });
    const { want, got, text } = await compare({ system: 'letter', working, rows });
    expect(text).not.toContain(A.future);
    expect(got).toEqual(want);
    // Outside Preview the teacher's returned-only grade still counts the piece, before and after Preview ran.
    const teacher = withReturnedOnly(() => studentGradeSummary(CID, S1));
    // The same class with no grade on that piece: what the student sees.
    makeClass({ system: 'letter' });
    const without = withReturnedOnly(() => studentGradeSummary(CID, S1)).text;
    expect(teacher.text).not.toBe(without);
    expect(want.overall.text).toBe(without);
  });

  it('switching classes in one tab: the second class reads as in a fresh tab', async () => {
    const device = phone();
    await compare({ system: 'letter' }, device);
    device.page.run('StudentData.use(null)');
    // Another class, as Switching Classes opens it: the same page key ('class'), other work and scores.
    const { want, got } = await compare(
      { system: 'letter', assessments: FULL.filter(a => a.id !== A.quick && a.id !== A.quiz2), working: LOW },
      device,
    );
    expect(got).toEqual(want);
  });
});
