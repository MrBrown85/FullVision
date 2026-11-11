/**
 * One student's page, built from the teacher's cache (shared/student-view.js;
 * docs/plans/student-page-build-plan.md 1.9 and S4-T1).
 *
 * 1. The plan's test: the page built by student-view.js from a class in the
 *    cache equals the page built from the server's `page` reply for the
 *    same class, drawn on the student's side (s/student-data.js and
 *    calc.js in a context of their own, as on a phone). The server's reply
 *    is written out below from student_submit.page and _returned_grade
 *    (migrations/2026110904_student_sessions_page.sql), field by field. In
 *    every grading style: Proficiency, Letter, Both.
 * 2. A draft is never in it: not its level, not its comment, not a tick,
 *    not a number worked out from it.
 * 3. Every grade made a draft changes nothing in it, through the app's own
 *    score writers.
 * 4. Every state in tests/fixtures/grade-state-cases.json (the cases the
 *    SQL triggers also run): the grade the page gives is the file's.
 * 5. Not loaded answers not ready: no throw, no grades, never all work.
 * 6. The file reads grades only through the seam.
 */
import './setup.js';
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn, seedClass, clearClass } from './helpers/pin-save-paths.js';
import { openStudentPage } from './helpers/student-page-context.js';
import { parseHTML } from 'linkedom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFileSync(resolve(ROOT, file), 'utf-8');
const NOW = '2026-11-10T20:00:00.000Z';

const CID = 'sv-class';
const S1 = 'sv-jordan';
const S2 = 'sv-avery';

/* ── The class ─────────────────────────────────────────────── */

const LEVELS = { 1: 'Starting out', 2: 'On the way', 3: 'Got it', 4: 'Beyond it' };
const LEARNING_MAP = {
  sections: [
    {
      id: 'sec1',
      name: 'Questioning',
      tags: [
        {
          id: 't1',
          label: 'Questioning and Predicting',
          code: 'QP',
          // As the class has them: the reply keeps a blank and the spaces; the page shows neither.
          i_can_statements: ['I can ask a question that can be tested.', '', ' I can say what I expect. '],
        },
      ],
    },
    { id: 'sec2', name: 'Communicating', tags: [{ id: 't2', label: 'Communicating', code: 'COM' }] },
  ],
};
const RUBRICS = [
  {
    id: 'r1',
    name: 'Lab Report',
    style: 'standard',
    criteria: [
      { id: 'c1', name: 'Method', tagIds: ['t1'], levels: LEVELS, weight: 1, checks: [] },
      { id: 'c2', name: 'Labelled Drawing', tagIds: ['t1'], levels: LEVELS, weight: 1, checks: [] },
    ],
  },
  {
    id: 'r2',
    name: 'Microscope Skills',
    style: 'advanced',
    criteria: [
      {
        id: 'c3',
        name: 'Focusing',
        tagIds: ['t2'],
        levels: LEVELS,
        weight: 1,
        checks: [
          { id: 'k1', level: 3, label: 'Finds the cell', displayOrder: 0 },
          { id: 'k2', level: 4, label: 'Sharp at high power', displayOrder: 0 },
        ],
      },
    ],
  },
];
const piece = (id, title, date, extra) =>
  Object.assign({ id, title, date, dueDate: date, type: 'summative', weight: 1, tagIds: [] }, extra);
const ASSESSMENTS = [
  piece('a-undated', 'Undated Notes', '', { tagIds: ['t1'] }),
  piece('a-future', 'Future Quiz', '2026-12-01', { tagIds: ['t1'] }),
  piece('a-draft', 'Draft Poster', '2026-10-20', { tagIds: ['t1', 't2'] }),
  piece('a-essay', 'Returned Essay', '2026-10-01', {
    tagIds: ['t1', 't2'],
    description: 'Explain how a cell gets what it needs.',
    moduleId: 'm1',
    categoryId: 'k-proj',
    coreCompetencyIds: ['CRT', 'COM'],
  }),
  piece('a-lab', 'Lab Report', '2026-10-05', { tagIds: ['t1'], rubricId: 'r1', moduleId: 'm1' }),
  piece('a-reflect', 'Changed Reflection', '2026-10-08', { tagIds: ['t2'] }),
  piece('a-quick', 'Quick Check', '2026-10-10', {
    scoreMode: 'points',
    maxPoints: 10,
    tagIds: ['t1'],
    categoryId: 'k-tests',
  }),
  piece('a-contract', 'Safety Contract', '2026-09-10', { scoreMode: 'complete', tagIds: [], categoryId: 'k-prac' }),
  piece('a-missing', 'Cell Quiz', '2026-10-12', { scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] }),
  piece('a-excused', 'Field Trip Form', '2026-10-14', { scoreMode: 'complete', tagIds: [] }),
  piece('a-late', 'Late Lab', '2026-10-16', { tagIds: ['t1'] }),
  piece('a-micro', 'Microscope Lab', '2026-10-18', { tagIds: ['t2'], rubricId: 'r2' }),
  piece('a-bench', 'Reading Benchmark', '2026-10-02', { scoreMode: 'dibels', tagIds: [], categoryId: 'k-tests' }),
  piece('a-overall', 'Overall Piece', '2026-10-03', { tagIds: [] }),
];

// The class's categories (weights total 100) and its one unit (S4-M1's category and module names).
const CATEGORIES = [
  { id: 'k-tests', name: 'Tests', weight: 40, displayOrder: 0 },
  { id: 'k-proj', name: 'Projects', weight: 60, displayOrder: 1 },
  { id: 'k-prac', name: 'Practice', weight: 0, displayOrder: 2 },
];
const MODULES = [{ id: 'm1', name: 'Unit 1: Cells' }];
// The teacher's name as typed at sign-up (bootstrap_teacher's display_name).
const TEACHER = 'Colin Brown';

// The words a draft holds. None may reach the page.
const SECRET = /DRAFT-SECRET/;
const lv = (value, modifier, comment) => ({ value, modifier: modifier || 0, comment: comment || null });
const cv = (value, modifier, comment, beyond) => ({
  value,
  modifier: modifier || 0,
  comment: comment || null,
  beyond: beyond || null,
});
const copy = parts =>
  Object.assign({ v: 1, value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] }, parts);

/* What the score tables hold for Jordan: { aid: { value, modifier,
   comment, status, tags, criteria, checks } }, and each grade_return row. */
const WORKING = {
  'a-draft': { comment: 'DRAFT-SECRET poster', tags: { t1: lv(1), t2: lv(1) } },
  'a-essay': { comment: 'Well argued.', tags: { t1: lv(3, 1), t2: lv(4) } },
  'a-lab': { comment: 'Careful focusing.', criteria: { c1: cv(3), c2: cv(2, 0, 'Label the axes.') } },
  'a-reflect': { comment: 'DRAFT-SECRET reflection', tags: { t2: lv(1) } },
  'a-quick': { value: 8 },
  'a-contract': { value: 1 },
  'a-missing': { value: 7, status: 'NS' },
  'a-excused': { status: 'EXC' },
  'a-late': { tags: { t1: lv(2) }, status: 'LATE' },
  'a-micro': { criteria: { c3: cv(4, 0, 'DRAFT-SECRET sharp') }, checks: ['k1', 'k2'] },
  'a-overall': { value: 3, comment: 'A solid piece.' },
};
const ROWS = {
  'a-draft': { is_draft: true },
  'a-essay': { is_draft: false, returned_at: '2026-11-05T18:00:00Z', seen_at: '2026-11-06T18:00:00Z' },
  'a-lab': { is_draft: false, returned_at: '2026-11-04T18:00:00Z' },
  'a-reflect': {
    is_draft: true,
    returned_at: '2026-11-01T18:00:00Z',
    returned_copy: copy({ comment: 'Good start.', tags: { t2: lv(3) } }),
  },
  'a-quick': {
    is_draft: false,
    returned_at: '2026-11-08T18:00:00Z',
    previous_copy: copy({ value: 6 }),
    updated_at: '2026-11-08T18:00:00Z',
    seen_at: '2026-11-02T18:00:00Z',
  },
  'a-contract': { is_draft: false, returned_at: '2026-09-20T18:00:00Z', seen_at: '2026-09-21T18:00:00Z' },
  'a-missing': { is_draft: false, returned_at: '2026-10-20T18:00:00Z' },
  'a-late': { is_draft: false, returned_at: '2026-10-25T18:00:00Z' },
  'a-micro': {
    is_draft: true,
    returned_at: '2026-10-28T18:00:00Z',
    returned_copy: copy({ criteria: { c3: cv(3) }, checks: ['k1'] }),
  },
  'a-overall': { is_draft: false, returned_at: '2026-10-22T18:00:00Z' },
};

// One cell as the server sends it in a class load, for the data layer's own loader.
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

const HELD = { student_page_enabled: true, return_grades: 'on_return' };

/* What Preview draws from: the server's page with no piece's seen_at,
   updated_at or previous, so a teacher never learns what the student has
   opened (Colin's ruling 116; shared/student-view.js, unopened). */
function unopened(page) {
  const out = JSON.parse(JSON.stringify(page));
  out.assessments.forEach(a => Object.assign(a, { updated_at: null, seen_at: null, previous: null }));
  return out;
}

function seed(gradingSystem, working, rows) {
  working = working || WORKING;
  rows = rows || ROWS;
  localStorage.clear();
  clearClass(CID);
  const cells = { [S1]: {} };
  const statuses = {};
  const checks = {};
  Object.entries(working).forEach(([aid, w]) => {
    cells[S1][aid] = cellOf(w);
    if (w.status) statuses[S1 + ':' + aid] = w.status;
    if (w.checks) checks[S1 + ':' + aid] = w.checks.slice();
  });
  const assessments = structuredClone(ASSESSMENTS);
  const scores = _gradebookCellsToScoreCache(CID, assessments, cells).scores;
  const returns = {};
  Object.entries(rows).forEach(([aid, row]) => (returns[aid] = { [S1]: structuredClone(row) }));
  seedClass(CID, {
    students: [
      { id: S1, firstName: 'Jordan', lastName: 'Lee' },
      { id: S2, firstName: 'Avery', lastName: 'Kim' },
    ],
    assessments,
    scores,
    statuses,
    rubrics: structuredClone(RUBRICS),
    rubricChecks: checks,
    learningMaps: structuredClone(LEARNING_MAP),
    courseConfigs: structuredClone(HELD),
    gradeReturns: returns,
    categories: structuredClone(CATEGORIES),
    modules: structuredClone(MODULES),
  });
  _cache.config = Object.assign({}, _cache.config || {}, { displayName: TEACHER });
  COURSES[CID] = { id: CID, name: 'Science 9', block: 'B', gradingSystem, gradeLevel: '9' };
  delete _returnedSets[CID];
  clearProfCache();
}

/* ── The server's reply for the same class ─────────────────── */

/* student_submit.page for Jordan, written out by hand from the SQL. Listed
   once its date has come (the future quiz is not), undated first, then
   oldest first. rubrics: only those the listed work uses, by id. grade:
   _returned_grade (nothing never returned; returned_copy while a draft
   waits; the working copy otherwise; nothing under Missing or Excused),
   cut to what the piece is scored by (_grade_copy_in_use). */
function serverPage(gradingSystem) {
  const criterion = (id, name, tagIds, checks) => ({
    id,
    name,
    weight: 1,
    level_1_value: 1,
    level_2_value: 2,
    level_3_value: 3,
    level_4_value: 4,
    level_1_descriptor: LEVELS[1],
    level_2_descriptor: LEVELS[2],
    level_3_descriptor: LEVELS[3],
    level_4_descriptor: LEVELS[4],
    tag_ids: tagIds,
    checks: checks || [],
  });
  const row = (id, extra) => {
    const a = ASSESSMENTS.find(x => x.id === id);
    return Object.assign(
      {
        id,
        title: a.title,
        date: a.date || null,
        due_date: a.dueDate || null,
        created_at: null,
        score_mode: a.scoreMode || 'proficiency',
        max_points: a.maxPoints == null ? null : a.maxPoints,
        weight: 1,
        rubric_id: a.rubricId || null,
        tag_ids: a.tagIds.slice().sort(),
        description: null,
        module_name: null,
        category_name: null,
        category_percent: null,
        core_competencies: [],
        status: null,
        returned_at: null,
        updated_at: null,
        seen_at: null,
        grade: null,
        previous: null,
      },
      extra,
    );
  };
  return {
    ok: true,
    v: 1,
    student: { enrollment_id: S1, first_name: 'Jordan' },
    course: {
      name: 'Science 9',
      block: 'B',
      grading_system: gradingSystem,
      grading_scale: getGradingScale(CID),
      teacher_name: TEACHER,
    },
    tags: {
      t1: {
        label: 'Questioning and Predicting',
        code: 'QP',
        i_can: ['I can ask a question that can be tested.', '', ' I can say what I expect. '],
      },
      t2: { label: 'Communicating', code: 'COM', i_can: [] },
    },
    rubrics: [
      {
        id: 'r1',
        name: 'Lab Report',
        style: 'standard',
        criteria: [criterion('c1', 'Method', ['t1']), criterion('c2', 'Labelled Drawing', ['t1'])],
      },
      {
        id: 'r2',
        name: 'Microscope Skills',
        style: 'advanced',
        criteria: [
          criterion(
            'c3',
            'Focusing',
            ['t2'],
            [
              { id: 'k1', level: 3, label: 'Finds the cell' },
              { id: 'k2', level: 4, label: 'Sharp at high power' },
            ],
          ),
        ],
      },
    ],
    assessments: [
      row('a-undated'),
      row('a-contract', {
        category_name: 'Practice',
        category_percent: 0,
        returned_at: ROWS['a-contract'].returned_at,
        seen_at: ROWS['a-contract'].seen_at,
        grade: copy({ value: 1 }),
      }),
      row('a-essay', {
        description: 'Explain how a cell gets what it needs.',
        module_name: 'Unit 1: Cells',
        category_name: 'Projects',
        // A percent only where "counts 60% of your grade" is true: not in a Proficiency class.
        category_percent: gradingSystem === 'proficiency' ? null : 60,
        core_competencies: [
          { id: 'COM', name: 'Communicating' },
          { id: 'CRT', name: 'Critical & Reflective Thinking' },
        ],
        returned_at: ROWS['a-essay'].returned_at,
        seen_at: ROWS['a-essay'].seen_at,
        grade: copy({ comment: 'Well argued.', tags: { t1: lv(3, 1), t2: lv(4) } }),
      }),
      row('a-bench', { category_name: 'Tests' }),
      row('a-overall', {
        returned_at: ROWS['a-overall'].returned_at,
        grade: copy({ value: 3, comment: 'A solid piece.' }),
      }),
      row('a-lab', {
        module_name: 'Unit 1: Cells',
        returned_at: ROWS['a-lab'].returned_at,
        grade: copy({ comment: 'Careful focusing.', criteria: { c1: cv(3), c2: cv(2, 0, 'Label the axes.') } }),
      }),
      row('a-reflect', {
        returned_at: ROWS['a-reflect'].returned_at,
        grade: copy({ comment: 'Good start.', tags: { t2: lv(3) } }),
      }),
      row('a-quick', {
        category_name: 'Tests',
        category_percent: gradingSystem === 'proficiency' ? null : 40,
        returned_at: ROWS['a-quick'].returned_at,
        updated_at: ROWS['a-quick'].updated_at,
        seen_at: ROWS['a-quick'].seen_at,
        grade: copy({ value: 8 }),
        previous: copy({ value: 6 }),
      }),
      row('a-missing', { status: 'NS', returned_at: ROWS['a-missing'].returned_at }),
      row('a-excused', { status: 'EXC' }),
      row('a-late', { status: 'LATE', returned_at: ROWS['a-late'].returned_at, grade: copy({ tags: { t1: lv(2) } }) }),
      row('a-micro', {
        returned_at: ROWS['a-micro'].returned_at,
        grade: copy({ criteria: { c3: cv(3) }, checks: ['k1'] }),
      }),
      row('a-draft'),
    ],
  };
}

/* ── The student's side: s/student-data.js and calc.js, on their own ── */

/* The page a phone draws from a reply: a context holding the scripts
   s/index.html names, then constants.js and calc.js (fetched before the
   list opens) and student-view.js. */
function studentSide() {
  const page = openStudentPage();
  ['shared/constants.js', 'shared/calc.js', 'shared/student-view.js'].forEach(f =>
    vm.runInContext(read(f), page.ctx, { filename: f }),
  );
  return {
    page,
    // The view of a reply, as the student page draws it, and the page s/student-data.js keeps.
    view(reply) {
      page.ctx.__reply = JSON.parse(JSON.stringify(reply));
      return JSON.parse(
        page.run(
          'StudentData.use(StudentData.fromServer(__reply)); JSON.stringify(StudentView.fromPage(__reply, StudentData.page()))',
        ),
      );
    },
    kept(reply) {
      page.ctx.__reply = JSON.parse(JSON.stringify(reply));
      return JSON.parse(page.run('JSON.stringify(StudentData.fromServer(__reply))'));
    },
  };
}

const STYLES = ['proficiency', 'letter', 'both'];

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
});
afterAll(() => {
  vi.useRealTimers();
  clearClass(CID);
});

/* ── 1. The plan's test ─────────────────────────────────────── */

describe.each(STYLES)('a %s class: the page from the cache is the page from the server', system => {
  let side;
  beforeEach(() => {
    seed(system);
    side = side || studentSide();
  });

  it('the reply is the server’s, field for field', () => {
    const got = StudentView.reply(CID, S1);
    const sent = serverPage(system);
    // The server sends no class id; Preview keeps one so the page has a key.
    expect(got.course.id).toBe(CID);
    delete got.course.id;
    expect(got).toEqual(sent);
  });

  it('what the student page keeps of it is the same', () => {
    const got = StudentView.reply(CID, S1);
    delete got.course.id;
    expect(side.kept(got)).toEqual(side.kept(serverPage(system)));
  });

  it('what the page draws is the same, every result worked out by calc.js', () => {
    const cache = StudentView.fromCache(CID, S1);
    expect(cache.ready).toBe(true);
    // Preview draws the page as a student who has opened nothing sees it (ruling 116).
    const phone = side.view(unopened(serverPage(system)));
    expect(cache.view).toEqual(phone);
  });

  it('each piece reads as it should', () => {
    const { view } = StudentView.fromCache(CID, S1);
    const by = Object.fromEntries(view.work.map(p => [p.id, p]));
    // Not on the page: work not yet dated, and the reading benchmark.
    expect(by['a-future']).toBeUndefined();
    expect(by['a-bench']).toBeUndefined();
    expect(by['a-undated'].kind).toBe('due');
    // A draft never returned reads exactly as work never graded.
    expect(by['a-draft']).toEqual(Object.assign({}, by['a-draft'], { kind: 'due', returnedAt: '' }));
    expect(by['a-draft'].result).toEqual({ kind: 'none', text: '', word: '' });
    expect(by['a-draft'].comment).toBe('');
    expect(by['a-draft'].competencies).toEqual([]);
    // Returned, in the class's style, worded by calc.js.
    const essay = withReturnedOnly(() =>
      assessmentCellValue(
        CID,
        S1,
        getAssessments(CID).find(a => a.id === 'a-essay'),
      ),
    );
    expect(by['a-essay'].result).toEqual({
      kind: 'level',
      text: essay.text,
      word: levelWord(CID, essay.value),
      level: essay.level,
    });
    expect(by['a-essay'].competencies).toEqual([
      { id: 't1', name: 'Questioning and Predicting', level: 3, text: scoreLevelText(3, 1), comment: '' },
      { id: 't2', name: 'Communicating', level: 4, text: scoreLevelText(4, 0), comment: '' },
    ]);
    expect(by['a-quick'].result).toEqual({
      kind: 'points',
      text: formatPoints(8) + ' / ' + formatPoints(10),
      word: '',
      level: pointsToProf(8, 10, getGradingScale(CID)),
      points: formatPoints(8),
      outOf: formatPoints(10),
      percent: formatPointsPercent(8, 10),
      bar: 80,
    });
    // Preview: no Updated mark, and every returned piece unopened, whatever
    // the student has opened (ruling 116). The student's own page still
    // marks them: below, the same reply drawn by the phone.
    expect(by['a-quick'].updated).toBe(false);
    expect(by['a-contract'].result.text).toBe('Complete');
    expect(by['a-contract'].unseen).toBe(true);
    const own = Object.fromEntries(side.view(serverPage(system)).work.map(p => [p.id, p]));
    expect(own['a-quick'].updated).toBe(true);
    expect(own['a-contract'].unseen).toBe(false);
    // A draft over a returned grade: the returned grade, its comment and ticks.
    expect(by['a-reflect'].comment).toBe('Good start.');
    expect(by['a-reflect'].competencies.map(c => c.level)).toEqual([3]);
    expect(by['a-micro'].rubric.rows[0].level).toBe(3);
    expect(by['a-micro'].rubric.rows[0].checks.map(k => [k.id, k.ticked])).toEqual([
      ['k1', true],
      ['k2', false],
    ]);
    // Rubric rows, with the criterion's comment.
    expect(by['a-lab'].rubric.rows.map(r => [r.name, r.level, r.comment])).toEqual([
      ['Method', 3, ''],
      ['Labelled Drawing', 2, 'Label the axes.'],
    ]);
    // Missing and Excused stand in place of a result; a grade returned before is not given.
    expect(by['a-missing']).toMatchObject({ kind: 'missing', returnedAt: '', result: { kind: 'none' } });
    expect(by['a-excused'].kind).toBe('excused');
    expect(by['a-late']).toMatchObject({ kind: 'back', late: true });
    expect(by['a-overall'].result.kind).toBe('level');
    expect(view.counts).toEqual({ toDo: 2, sent: 0, back: 8, missing: 1 });
    // What Changed, on the student's own page: what they have not opened, and the update.
    expect(
      side
        .view(serverPage(system))
        .changes.map(c => [c.id, c.why])
        .sort(),
    ).toEqual(
      [
        ['a-lab', 'back'],
        ['a-late', 'back'],
        ['a-micro', 'back'],
        ['a-overall', 'back'],
        ['a-quick', 'updated'],
        ['a-reflect', 'back'],
      ].sort(),
    );
    // In Preview: every returned piece, as if none were opened (ruling 116).
    expect(view.changes.map(c => [c.id, c.why]).sort()).toEqual(
      ['a-contract', 'a-essay', 'a-lab', 'a-late', 'a-micro', 'a-overall', 'a-quick', 'a-reflect'].map(id => [
        id,
        'back',
      ]),
    );
  });
});

describe('what Your Feedback and The Whole Rubric draw (S4-F3), the same through both doors', () => {
  beforeEach(() => seed('proficiency'));

  it('each criterion: the level given by name, what it means here, what the next level asks, every level marked', () => {
    const { view } = StudentView.fromCache(CID, S1);
    const lab = view.work.find(p => p.id === 'a-lab');
    const [method, drawing] = lab.rubric.rows;
    expect([method.levelName, method.descriptor]).toEqual([scoreLevelText(3, 0), LEVELS[3]]);
    expect(method.next).toEqual({ level: 4, name: scoreLevelText(4, 0), descriptor: LEVELS[4], checks: [] });
    expect(drawing.next.name).toBe(scoreLevelText(3, 0));
    expect(method.goal).toBe(LEVELS[3]);
    expect(method.whole.map(l => [l.level, l.name, l.descriptor, l.you])).toEqual([
      [1, scoreLevelText(1, 0), LEVELS[1], false],
      [2, scoreLevelText(2, 0), LEVELS[2], false],
      [3, scoreLevelText(3, 0), LEVELS[3], true],
      [4, scoreLevelText(4, 0), LEVELS[4], false],
    ]);
    expect(view.levels).toEqual([1, 2, 3, 4].map(l => ({ level: l, name: scoreLevelText(l, 0) })));
  });

  it('an Advanced Rubric: the boxes ticked in the grade returned, and the next level’s boxes not ticked', () => {
    const { view } = StudentView.fromCache(CID, S1);
    const row = view.work.find(p => p.id === 'a-micro').rubric.rows[0];
    // The returned copy ticks k1 at Proficient; the draft over it ticks k2 too, and is not here.
    expect(row.shown.map(k => k.id)).toEqual(['k1']);
    expect(row.next.checks.map(k => k.id)).toEqual(['k2']);
  });

  it('work not back yet: what it is graded on by name, and no level, comment or rubric level anywhere', () => {
    const { view } = StudentView.fromCache(CID, S1);
    const draft = view.work.find(p => p.id === 'a-draft');
    expect(draft.gradedOn).toEqual([
      // Each with its I Can lines (S4-M1), blanks left out and trimmed.
      {
        id: 't1',
        name: 'Questioning and Predicting',
        iCan: ['I can ask a question that can be tested.', 'I can say what I expect.'],
      },
      { id: 't2', name: 'Communicating', iCan: [] },
    ]);
    expect(JSON.stringify(draft)).not.toMatch(SECRET);
    expect(draft.rubric).toBeNull();
  });
});

/* ── 2. A draft is never in it ──────────────────────────────── */

describe('a draft is nowhere on the page', () => {
  beforeEach(() => seed('both'));

  it('not its words, its level, a tick or a number worked out from it', () => {
    const out = StudentView.fromCache(CID, S1);
    const text = JSON.stringify(out);
    expect(text).not.toMatch(SECRET);
    const by = Object.fromEntries(out.view.work.map(p => [p.id, p]));
    // The draft tick k2 and level 4 on the microscope lab are not given.
    expect(out.reply.assessments.find(a => a.id === 'a-micro').grade.checks).toEqual(['k1']);
    // The result is the returned grade's, not the draft's.
    const returnedOnly = withReturnedOnly(() =>
      assessmentCellValue(
        CID,
        S1,
        getAssessments(CID).find(a => a.id === 'a-reflect'),
      ),
    );
    const allWork = assessmentCellValue(
      CID,
      S1,
      getAssessments(CID).find(a => a.id === 'a-reflect'),
    );
    expect(allWork.text).not.toBe(returnedOnly.text);
    expect(by['a-reflect'].result.text).toBe(returnedOnly.text);
    expect(by['a-draft'].result.text).toBe('');
  });

  /* A grade the server sent by mistake (no return date, or under Missing or
     Excused) is not drawn: not its comment, a level or a tick. These are
     build's own guards; the reply's twin in s/student-data.js feeds only
     the result line. */
  const mistaken = extra => {
    const page = serverPage('proficiency');
    const lab = page.assessments.find(a => a.id === 'a-lab');
    Object.assign(lab, {
      grade: copy({ comment: 'DRAFT-SECRET lab', criteria: { c1: cv(4, 0, 'DRAFT-SECRET c1') } }),
      returned_at: '2026-11-04T18:00:00Z',
      status: null,
      ...extra,
    });
    const piece = StudentView.build(page, CID, () => null).work.find(p => p.id === 'a-lab');
    return piece;
  };

  it.each([
    ['never returned', { returned_at: null }],
    ['Missing', { status: 'NS' }],
    ['Excused', { status: 'EXC' }],
  ])('a grade sent on a piece %s is not drawn', (name, extra) => {
    const piece = mistaken(extra);
    expect(JSON.stringify(piece)).not.toMatch(SECRET);
    expect(piece.comment).toBe('');
    expect((piece.rubric ? piece.rubric.rows : []).every(r => !r.level)).toBe(true);
    // The same piece, returned, is drawn: the test can fail.
    expect(JSON.stringify(mistaken({}))).toMatch(SECRET);
  });
});

/* ── 3. Making a grade a draft changes nothing ──────────────── */

describe('every returned grade made a draft changes nothing on the page', () => {
  const returned = Object.keys(ROWS).filter(aid => ROWS[aid].returned_at && !ROWS[aid].is_draft);

  it.each(STYLES)('in a %s class', system => {
    seed(system);
    const before = StudentView.fromCache(CID, S1);
    expect(before.ready).toBe(true);
    returned.forEach(aid => {
      const a = getAssessments(CID).find(x => x.id === aid);
      // The way a teacher changes a grade: the app's own writers.
      if (isPointsScored(a)) setPointsScore(CID, S1, aid, isCompletionScored(a) ? 0 : 1);
      else
        (getScores(CID)[S1] || [])
          .filter(e => e.assessmentId === aid)
          .forEach(e => upsertScore(CID, S1, aid, e.tagId, 1, a.date || '', scoreTypeFor(a), '', 0));
      saveScoreComment(CID, S1, aid, 'DRAFT-SECRET changed');
      // Now a draft over the returned grade (Missing shows its status, never Draft).
      expect(GradeState.stateOf(CID, S1, aid), aid).toBe(getAssignmentStatus(CID, S1, aid) === 'NS' ? null : 'draft');
    });
    clearProfCache();
    const after = StudentView.fromCache(CID, S1);
    expect(JSON.stringify(after)).not.toMatch(SECRET);
    expect(after).toEqual(before);
  });
});

/* ── 4. Every state in the shared cases ─────────────────────── */

const SUITE = JSON.parse(readFileSync(join(ROOT, 'tests', 'fixtures', 'grade-state-cases.json'), 'utf-8'));
const COPY_OF = { criteria: { c1: 'c3', c2: 'c4' }, checks: { k1: 'k3', k2: 'k4' } };

/* The file's steps, as tests/returned-check-ids.test.js runs them: each
   student's working copy, status and row. `onCheck` is called at each
   expect with the state there. */
function runCase(c, onCheck) {
  let klass = Object.assign({}, c.class);
  const scoring = { criteria: ['c1', 'c2'], checks: ['k1', 'k2'], on: { k1: 'c1', k2: 'c2' }, tags: ['t1', 't2'] };
  const cells = {};
  let clock = Date.parse('2026-11-03T17:00:00Z');
  const cell = sid =>
    cells[sid] ||
    (cells[sid] = {
      grade: { value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] },
      status: null,
      row: null,
    });
  const write = (sid, change) => {
    const it = cell(sid);
    const before = structuredClone(it.grade);
    change(it);
    it.row = GradeState.afterWrite(klass, it.row, before, it.grade, new Date(clock).toISOString());
  };
  c.steps.forEach((step, i) => {
    clock += 60000;
    const now = new Date(clock).toISOString();
    const sid = step.student || 's1';
    if (step.expect) return onCheck(step.expect, step.expect.for || 's1', { cells, klass, scoring }, i + 1);
    switch (step.do) {
      case 'level':
        return write(sid, x => {
          const was = x.grade.tags[step.tag] || {};
          x.grade.tags[step.tag] = {
            value: step.value,
            modifier: step.modifier || 0,
            comment: step.comment === undefined ? was.comment || null : step.comment,
          };
        });
      case 'criterion':
        return write(sid, x => {
          const was = x.grade.criteria[step.criterion] || {};
          x.grade.criteria[step.criterion] = {
            value: step.value,
            modifier: step.modifier || 0,
            comment: step.comment === undefined ? was.comment || null : step.comment,
            beyond: step.beyond === undefined ? was.beyond || null : step.beyond,
          };
        });
      case 'score':
        return write(sid, x => {
          x.grade.value = step.value;
          x.grade.modifier = step.modifier || 0;
        });
      case 'tick':
        return write(sid, x => {
          const others = x.grade.checks.filter(id => id !== step.check);
          x.grade.checks = step.on ? others.concat(step.check) : others;
        });
      case 'comment':
        return write(sid, x => (x.grade.comment = step.text));
      case 'clear':
        return write(sid, x => {
          x.grade.value = null;
          x.grade.modifier = 0;
          x.grade.tags = {};
          x.grade.criteria = {};
        });
      case 'note':
        return;
      case 'status':
        cell(sid).status = step.status;
        return;
      case 'seen':
        cell(sid).row = GradeState.afterSeen(cell(sid).row, now);
        return;
      case 'return':
        (step.students || [sid]).forEach(s => (cell(s).row = GradeState.afterReturn(cell(s).row, cell(s).grade, now)));
        return;
      case 'class': {
        const was = klass;
        klass = { student_page: step.student_page, return_grades: step.return_grades };
        const rows = { work: {} };
        Object.keys(cells).forEach(s => (rows.work[s] = cells[s].row));
        const out = GradeState.afterSettingChange(was, klass, rows, s => cells[s].grade, now);
        Object.keys(cells).forEach(s => (cells[s].row = (out.work || {})[s] || null));
        return;
      }
      case 'move_rubric':
        scoring.criteria = scoring.criteria.map(id => COPY_OF.criteria[id] || id);
        scoring.checks = scoring.checks.map(id => COPY_OF.checks[id] || id);
        scoring.on = Object.fromEntries(
          Object.entries(scoring.on).map(([k, cr]) => [COPY_OF.checks[k], COPY_OF.criteria[cr]]),
        );
        Object.values(cells).forEach(x => {
          x.grade.criteria = Object.fromEntries(
            Object.entries(x.grade.criteria).map(([id, r]) => [COPY_OF.criteria[id] || id, r]),
          );
          x.grade.checks = x.grade.checks.map(id => COPY_OF.checks[id] || id);
          x.row = GradeState.afterMove(x.row, COPY_OF.criteria, COPY_OF.checks);
        });
        return;
      case 'delete': {
        const gone =
          step.what === 'check'
            ? [step.id]
            : step.what === 'criterion'
              ? scoring.checks.filter(k => scoring.on[k] === step.id)
              : [];
        if (step.what === 'criterion') scoring.criteria = scoring.criteria.filter(id => id !== step.id);
        if (step.what === 'tag') scoring.tags = scoring.tags.filter(id => id !== step.id);
        scoring.checks = scoring.checks.filter(id => !gone.includes(id));
        Object.values(cells).forEach(x => {
          const before = structuredClone(x.grade);
          if (step.what === 'criterion')
            x.grade.criteria = Object.fromEntries(Object.entries(x.grade.criteria).filter(([id]) => id !== step.id));
          if (step.what === 'tag')
            x.grade.tags = Object.fromEntries(Object.entries(x.grade.tags).filter(([id]) => id !== step.id));
          x.grade.checks = x.grade.checks.filter(id => !gone.includes(id));
          x.row = GradeState.afterWrite(klass, x.row, before, x.grade, now);
        });
        return;
      }
      default:
        throw new Error('A step this runner does not know: ' + JSON.stringify(step));
    }
  });
}

/* One case's state at one check, put in the cache the way a class load
   puts it there: the piece, the class's competencies or rubric as the
   work is scored now, every student's working copy, status, ticks and
   row. */
const CASE_CID = 'sv-case';
const CASE_AID = 'work';
function seedCase(work, state) {
  const { cells, klass, scoring } = state;
  const a = {
    id: CASE_AID,
    title: 'The Work',
    date: '2026-10-01',
    dueDate: '2026-10-01',
    type: 'summative',
    weight: 1,
  };
  if (work === 'competencies') a.tagIds = ['t1', 't2'];
  if (work === 'rubric') Object.assign(a, { tagIds: ['t1'], rubricId: 'rub' });
  if (work === 'points') Object.assign(a, { scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] });
  const rubric = {
    id: 'rub',
    name: 'Rubric',
    criteria: scoring.criteria.map(id => ({
      id,
      name: 'Criterion ' + id,
      tagIds: ['t1'],
      levels: {},
      weight: 1,
      checks: scoring.checks.filter(k => scoring.on[k] === id).map(k => ({ id: k, level: 3, label: 'Box ' + k })),
    })),
  };
  const tags = work === 'competencies' ? scoring.tags : ['t1'];
  const map = { sections: tags.map(id => ({ id: 'sec-' + id, name: id, tags: [{ id, label: 'Tag ' + id }] })) };
  const sids = Object.keys(cells);
  const scoreCells = {};
  const statuses = {};
  const checks = {};
  const rows = { [CASE_AID]: {} };
  sids.forEach(sid => {
    const x = cells[sid];
    scoreCells[sid] = {
      [CASE_AID]: {
        score: { value: x.grade.value, modifier: x.grade.modifier, comment: x.grade.comment, status: x.status },
        tag_scores: Object.entries(x.grade.tags).map(([tag_id, r]) => Object.assign({ tag_id }, r)),
        rubric_scores: Object.entries(x.grade.criteria).map(([criterion_id, r]) => Object.assign({ criterion_id }, r)),
      },
    };
    if (x.status) statuses[sid + ':' + CASE_AID] = x.status;
    if (x.grade.checks.length) checks[sid + ':' + CASE_AID] = x.grade.checks.slice();
    if (x.row) rows[CASE_AID][sid] = structuredClone(x.row);
  });
  localStorage.clear();
  clearClass(CASE_CID);
  const assessments = [a];
  seedClass(CASE_CID, {
    students: sids.map(id => ({ id, firstName: id, lastName: 'Case' })),
    assessments,
    rubrics: [rubric],
    learningMaps: map,
    statuses,
    rubricChecks: checks,
    courseConfigs: { student_page_enabled: klass.student_page === true, return_grades: klass.return_grades || null },
    gradeReturns: rows,
  });
  _cache.scores[CASE_CID] = _gradebookCellsToScoreCache(CASE_CID, assessments, scoreCells).scores;
  COURSES[CASE_CID] = { id: CASE_CID, name: 'Case', gradingSystem: 'proficiency' };
  delete _returnedSets[CASE_CID];
  clearProfCache();
}

/* An Overall level on competency work, as both sides show it. The server
   sends it as the copy's value with no competency rows; the cache holds it
   under the work's first competency (the loader's fallbackTag rule), so the
   copy built from the cache has it there. The page draws it under the
   first competency either way (s/student-data.js, entriesFrom; build()'s
   competency rows), so the two are compared as shown. */
function asShown(grade, work) {
  if (
    work !== 'competencies' ||
    !grade ||
    grade.value == null ||
    Object.keys(grade.tags || {}).length ||
    Object.keys(grade.criteria || {}).length
  )
    return grade;
  return Object.assign({}, grade, {
    value: null,
    modifier: 0,
    tags: { t1: { value: grade.value, modifier: grade.modifier || 0, comment: null } },
  });
}

describe('every state the SQL triggers also run: the page gives what the file says', () => {
  let side;
  afterAll(() => clearClass(CASE_CID));

  SUITE.cases
    .filter(c => c.work !== 'dibels')
    .forEach(c => {
      it(c.name, () => {
        let checked = 0;
        runCase(c, (want, sid, state, at) => {
          if (!('student' in want) && !('previous' in want) && !('status' in want)) return;
          seedCase(c.work, state);
          // The server's page, field for field (StudentView.reply), drawn
          // as the student's own page draws it: Preview hides Updated
          // (ruling 116), the student's page does not.
          const out = StudentView.fromCache(CASE_CID, sid);
          expect(out.ready, 'step ' + at).toBe(true);
          const sent = StudentView.reply(CASE_CID, sid);
          const piece = sent.assessments.find(x => x.id === CASE_AID);
          if ('student' in want)
            expect(asShown(piece.grade, c.work), 'step ' + at + ': the grade given').toEqual(
              asShown(want.student, c.work),
            );
          if ('previous' in want)
            expect(asShown(piece.previous, c.work), 'step ' + at + ': the grade before').toEqual(
              asShown(want.previous, c.work),
            );
          if ('status' in want) expect(piece.status, 'step ' + at + ': the status').toBe(want.status);
          // Marked Updated only where the file says the page marks it.
          const drawn = (side = side || studentSide()).view(sent).work.find(p => p.id === CASE_AID);
          expect(out.view.work.find(p => p.id === CASE_AID).updated, 'step ' + at + ': Preview').toBe(false);
          if (drawn.updated) expect(want.updated, 'step ' + at + ': Updated').toBe(true);
          // Nothing the student is not given is drawn: no result without a grade.
          if (!piece.grade) expect(drawn.result.kind, 'step ' + at).toBe('none');
          checked++;
        });
        expect(checked).toBeGreaterThan(0);
      });
    });
});

/* ── 5. Not loaded answers not ready ────────────────────────── */

describe('a signed-in class whose Draft and Returned rows have not loaded', () => {
  let session;
  beforeEach(() => {
    seed('proficiency');
    session = signIn();
    delete _gradeReturnsLoadedFor[CID];
    _setServerStudentPage(CID, true);
    delete _returnedSets[CID];
  });
  afterEach(() => {
    session.signOut();
    delete _serverStudentPage[CID];
    localStorage.removeItem('gb-bundle-meta-' + CID);
  });

  it('is not ready: nothing thrown, no grade, never every score', () => {
    expect(() => getReturnedScores(CID)).toThrow(expect.objectContaining({ code: 'RETURNED_NOT_LOADED' }));
    expect(StudentView.ready(CID)).toBe(false);
    expect(StudentView.reply(CID, S1)).toBeNull();
    expect(StudentView.fromCache(CID, S1)).toEqual({ ready: false });
    // Once the rows load, the page is there.
    _loadGradeReturns(CID, structuredClone(_cache.gradeReturns[CID] || {}));
    expect(StudentView.fromCache(CID, S1).ready).toBe(true);
  });

  it('a fault that is not "not loaded" is thrown, not waited out', () => {
    const real = globalThis.getReturnedScores;
    globalThis.getReturnedScores = () => {
      throw new Error('a fault');
    };
    try {
      expect(() => StudentView.fromCache(CID, S1)).toThrow('a fault');
    } finally {
      globalThis.getReturnedScores = real;
    }
  });
});

describe('a class with no grade_return rows yet (grades from before the rule was kept)', () => {
  it('a grade there before the switch went on counts as returned, dated by the piece', () => {
    seed('proficiency', WORKING, {});
    // With no rows nothing is a draft: the working copy is what was returned.
    const { reply } = StudentView.fromCache(CID, S1);
    const essay = reply.assessments.find(a => a.id === 'a-essay');
    expect(essay.returned_at).toBe('2026-10-01');
    expect(essay.grade).toEqual(copy({ comment: 'Well argued.', tags: { t1: lv(3, 1), t2: lv(4) } }));
    expect(reply.assessments.find(a => a.id === 'a-undated').returned_at).toBeNull();
  });

  it('and still counts once a draft is saved over it, which makes a row with no return date', () => {
    seed('proficiency', WORKING, {});
    // When I Return Them: the change waits as a draft over the grade from before.
    upsertScore(CID, S1, 'a-essay', 't1', 1, '2026-10-01', 'summative', '', 0);
    expect(getGradeReturn(CID, S1, 'a-essay')).toMatchObject({ is_draft: true });
    expect(getGradeReturn(CID, S1, 'a-essay').returned_at).toBeUndefined();
    const { reply, view } = StudentView.fromCache(CID, S1);
    const essay = reply.assessments.find(a => a.id === 'a-essay');
    expect(essay.returned_at).toBe('2026-10-01');
    expect(essay.grade).toEqual(copy({ comment: 'Well argued.', tags: { t1: lv(3, 1), t2: lv(4) } }));
    expect(view.work.find(p => p.id === 'a-essay').kind).toBe('back');
  });
});

/* ── 6. The seam ────────────────────────────────────────────── */

describe('shared/student-view.js reads grades only through the seam', () => {
  const SOURCE = read('shared/student-view.js');
  /* The data layer's readers of a score, comment, note or tick on all work
     (the list tests/report-score-seam.test.js keeps report files from), and
     the cache itself. */
  const FORBIDDEN = [
    'getScores',
    'getPointsScore',
    'getCompletionMark',
    'getScoreComment',
    'getScoreReportNote',
    'getTagComment',
    'getRubricCriterionComment',
    'getRubricCriterionBeyond',
    'getRubricChecks',
    'getRubricCheckIds',
    'isRubricCheckOn',
    'hasScoreOrFeedback',
    'getGradeReturns',
    '_cache',
    'studentCopy',
    'returnedScores',
    'setActiveTerm',
  ];
  const code = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it.each(FORBIDDEN)('names no %s', name => {
    expect(code).not.toMatch(new RegExp('(^|[^\\w.$])' + name.replace('$', '\\$') + '\\s*[(\\[.]'));
  });

  it('reads the returned set, the returned ticks and works results out on returned grades only', () => {
    expect(code).toMatch(/getReturnedScores\(cid\)/);
    expect(code).toMatch(/getReturnedRubricCheckIds\(cid, sid, a\.id\)/);
    expect(code).toMatch(/withReturnedOnly\(function/);
  });

  it('formats no grade itself', () => {
    expect(code).not.toMatch(/toFixed|Math\.round|\+ '%'/);
  });

  it('works out every result inside withReturnedOnly', () => {
    seed('proficiency');
    const real = globalThis.assessmentCellValue;
    const sets = [];
    globalThis.assessmentCellValue = (...args) => (sets.push(_scoreSet), real(...args));
    try {
      StudentView.fromCache(CID, S1);
    } finally {
      globalThis.assessmentCellValue = real;
    }
    expect(sets.length).toBeGreaterThan(0);
    expect([...new Set(sets)]).toEqual(['returned']);
  });
});

/* ── 7. What the server also tells (S4-M1, S4-W1) ──────────────
   The nine keys of migrations/local-test/s4-m1-contract.md: the page draws
   each where it is sent, draws nothing of it where it is not (the function
   on main does not pass them yet, PR 1050), and reads a wrong type as none. */

// The same reply with the nine keys taken out: what a phone gets until the function passes them.
function withoutNew(reply) {
  const out = JSON.parse(JSON.stringify(reply));
  delete out.course.teacher_name;
  (out.classes || []).forEach(c => delete c.to_do);
  Object.values(out.tags).forEach(t => delete t.i_can);
  out.rubrics.forEach(r => r.criteria.forEach(c => delete c.tag_ids));
  out.assessments.forEach(a =>
    ['description', 'module_name', 'category_name', 'category_percent', 'core_competencies'].forEach(k => delete a[k]),
  );
  return out;
}

const NEW_PARTS = [
  '.sp-piece-unit',
  '.sp-piece-category',
  '.sp-piece-about',
  '.sp-graded-on-ican',
  '.sp-core',
  '.sp-piece-from',
  '.sp-fb-from',
  '.sp-fb-category',
  '.sp-fb-toward',
  '.sp-from-mark',
];

// A document to draw into (tests run with no DOM of their own).
const DOC = parseHTML('<!doctype html><html><body></body></html>').document;

// What one choice of the student's draws, from a view, as an element to look in.
function drawn(view, ui) {
  const box = DOC.createElement('div');
  box.innerHTML = StudentPageView.html(view, ui);
  return box;
}
const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const cardIn = (box, id) => [...box.querySelectorAll('.sp-piece')].find(c => c.getAttribute('data-piece') === id);

// The choices that show every part: To Do, Back, Your Feedback on four pieces, All Assignments.
const UIS = [
  { tab: 'assignments', segment: 'todo' },
  { tab: 'assignments', segment: 'back' },
  { tab: 'assignments', segment: 'back', feedback: 'a-essay', pick: 'a-essay' },
  { tab: 'assignments', segment: 'back', feedback: 'a-lab', pick: 'a-lab' },
  { tab: 'assignments', segment: 'back', feedback: 'a-quick', pick: 'a-quick' },
  { tab: 'assignments', segment: 'back', feedback: 'a-contract', pick: 'a-contract' },
  { tab: 'assignments', all: true },
];

// The page a phone draws for a reply and a choice: s/student-data.js, student-view.js and page-view.js on their own.
function phoneHtml(side, reply, ui) {
  side.page.ctx.__reply = JSON.parse(JSON.stringify(reply));
  side.page.ctx.__ui = ui;
  return side.page.run(
    'StudentData.use(StudentData.fromServer(__reply)); StudentPageView.html(StudentView.fromPage(__reply, StudentData.page()), __ui)',
  );
}

describe.each(STYLES)('a %s class: Preview as Student and the real page draw the same HTML (S4-W1)', system => {
  let side;
  beforeEach(() => {
    seed(system);
    side = side || studentSide();
  });

  it.each(UIS.map(ui => [JSON.stringify(ui), ui]))('for %s', (_, ui) => {
    const { view } = StudentView.fromCache(CID, S1);
    expect(StudentPageView.html(view, ui)).toBe(phoneHtml(side, unopened(serverPage(system)), ui));
  });
});

describe('the parts the server now sends, drawn (S4-W1)', () => {
  beforeEach(() => seed('letter'));

  it('the teacher’s name as sent, never made into "Mr.": over the comment, on Your Feedback, and in what changed', () => {
    const { view } = StudentView.fromCache(CID, S1);
    expect(view.course.teacherName).toBe('Colin Brown');
    const essay = cardIn(drawn(view, UIS[1]), 'a-essay');
    expect(words(essay.querySelector('.sp-piece-from .sp-from-mark'))).toBe('CB');
    expect(words(essay.querySelector('.sp-piece-from span:last-child'))).toBe('Colin Brown');
    expect(essay.querySelector('.sp-from-mark').getAttribute('aria-hidden')).toBe('true');
    expect(words(drawn(view, UIS[2]).querySelector('.sp-fb-from span:last-child'))).toBe('From Colin Brown');
    expect(words(drawn(view, UIS[6]).querySelector('.sp-since-line'))).toBe(
      // Preview: every returned piece as unopened, none Updated (ruling 116).
      'Colin Brown returned 8 pieces.',
    );
    expect(StudentPageView.html(view, UIS[2])).not.toMatch(/Mr\.|Ms\./);
  });

  it('the unit, and the category with what it counts as the class is set up', () => {
    const { view } = StudentView.fromCache(CID, S1);
    expect(words(cardIn(drawn(view, UIS[1]), 'a-essay').querySelector('.sp-piece-unit'))).toBe('Unit 1: Cells');
    expect(words(drawn(view, UIS[2]).querySelector('.sp-fb-category'))).toBe('Projects · counts 60% of your grade');
    expect(words(drawn(view, UIS[4]).querySelector('.sp-fb-category'))).toBe('Tests · counts 40% of your grade');
    expect(words(drawn(view, UIS[5]).querySelector('.sp-fb-category'))).toBe(
      'Practice · doesn’t count toward your grade',
    );
    // A piece with no category says nothing of one.
    expect(drawn(view, UIS[3]).querySelector('.sp-fb-category')).toBeNull();
  });

  it('in a Proficiency class a weighted category shows its name alone; one that weighs 0 still says so', () => {
    seed('proficiency');
    const { view } = StudentView.fromCache(CID, S1);
    expect(words(drawn(view, UIS[2]).querySelector('.sp-fb-category'))).toBe('Projects');
    expect(words(drawn(view, UIS[5]).querySelector('.sp-fb-category'))).toBe(
      'Practice · doesn’t count toward your grade',
    );
  });

  it('a percent only where the class’s weights total 100', () => {
    _cache.categories[CID][0].weight = 30; // Tests 30, Projects 60, Practice 0: 90 in all
    const reply = StudentView.reply(CID, S1);
    const by = Object.fromEntries(reply.assessments.map(a => [a.id, a]));
    expect(by['a-essay'].category_percent).toBeNull();
    expect(by['a-quick'].category_percent).toBeNull();
    expect(by['a-contract'].category_percent).toBe(0);
    expect(by['a-bench'].category_percent).toBeNull();
    expect(by['a-lab']).toMatchObject({ category_name: null, category_percent: null });
  });

  it('each rubric row says what it counts toward; work not back yet lists its I Can lines and Core Competencies', () => {
    _cache.assessments[CID].find(a => a.id === 'a-draft').coreCompetencyIds = ['PAR', 'COM'];
    const { view } = StudentView.fromCache(CID, S1);
    expect(
      [...drawn(view, UIS[3]).querySelectorAll('.sp-fb-criterion')].map(c => words(c.querySelector('.sp-fb-toward'))),
    ).toEqual(['Counts toward Questioning and Predicting', 'Counts toward Questioning and Predicting']);
    const draft = cardIn(drawn(view, UIS[0]), 'a-draft');
    expect([...draft.querySelectorAll('.sp-graded-on-ican')].map(words)).toEqual([
      'I can ask a question that can be tested.',
      'I can say what I expect.',
    ]);
    expect(words(draft.querySelector('.sp-core .sp-graded-on-title'))).toBe('Core Competencies');
    expect([...draft.querySelectorAll('.sp-core-name')].map(words)).toEqual([
      'Communicating',
      'Personal Awareness & Responsibility',
    ]);
    // Only work still to do carries its Description, category name, I Can lines and Core Competencies.
    const back = drawn(view, UIS[1]);
    ['.sp-piece-about', '.sp-piece-category', '.sp-graded-on-ican', '.sp-core'].forEach(sel =>
      expect(back.querySelector(sel)).toBeNull(),
    );
  });

  it('none of it draws when the server does not send the keys: the page is as it was', () => {
    const side = studentSide();
    const reply = withoutNew(serverPage('letter'));
    UIS.forEach(ui => {
      const box = DOC.createElement('div');
      box.innerHTML = phoneHtml(side, reply, ui);
      NEW_PARTS.forEach(sel => expect(box.querySelector(sel), sel).toBeNull());
    });
    // And the line of what changed is the one with no name.
    const box = DOC.createElement('div');
    box.innerHTML = phoneHtml(side, reply, UIS[6]);
    expect(words(box.querySelector('.sp-since-line'))).toBe('5 pieces came back and 1 result was updated.');
  });

  it('a key of the wrong type reads as none: no throw, nothing drawn, the rest of the page as it was', () => {
    const side = studentSide();
    const good = withoutNew(serverPage('letter'));
    const bad = JSON.parse(JSON.stringify(good));
    bad.course.teacher_name = 42;
    bad.classes = [{ enrollment_id: S1, course: { name: 'Science 9', block: 'B' }, to_do: '3' }];
    good.classes = [{ enrollment_id: S1, course: { name: 'Science 9', block: 'B' } }];
    Object.values(bad.tags).forEach(t => (t.i_can = 'I can ask.'));
    bad.rubrics.forEach(r => r.criteria.forEach(c => (c.tag_ids = 't1')));
    bad.assessments.forEach(a =>
      Object.assign(a, {
        description: ['Read this'],
        module_name: { name: 'Unit 1' },
        category_name: 7,
        category_percent: '40',
        core_competencies: 'COM',
      }),
    );
    UIS.forEach(ui => expect(phoneHtml(side, bad, ui)).toBe(phoneHtml(side, good, ui)));
    side.page.ctx.__reply = bad;
    const kept = JSON.parse(side.page.run('JSON.stringify(StudentData.fromServer(__reply))'));
    expect(kept.course.teacherName).toBe('');
    expect(kept.classes[0].toDo).toBeNull();
    expect(kept.assessments[0]).toMatchObject({
      description: '',
      moduleName: '',
      categoryName: '',
      categoryPercent: null,
      coreCompetencies: [],
    });
    expect(kept.rubrics[0].criteria[0].tagIds).toEqual([]);
  });

  it('a negative percent, and Core Competency entries of the wrong shape, are left out', () => {
    const reply = serverPage('letter');
    const essay = reply.assessments.find(a => a.id === 'a-essay');
    essay.category_percent = -5;
    essay.core_competencies = [{ id: 'COM', name: 'Communicating' }, null, { id: 'CT' }, 'CRT', { id: 3, name: 'X' }];
    const p = StudentView.build(reply, CID, null).work.find(x => x.id === 'a-essay');
    expect(p.category).toEqual({ name: 'Projects', percent: null });
    expect(p.coreCompetencies).toEqual([{ id: 'COM', name: 'Communicating' }]);
  });
});

describe('fromCache’s learning option (Preview’s See What They’d See, S13-F1)', () => {
  it('works My Learning out for this view only: the class’s switch is neither read as on nor changed', () => {
    seed('proficiency');
    const before = getCourseConfig;
    expect(StudentView.learningOn(CID)).toBe(false);
    expect(StudentView.fromCache(CID, S1).view.learning).toBeNull();
    const shown = StudentView.fromCache(CID, S1, { learning: true });
    expect(shown.view.learning).not.toBeNull();
    expect(shown.view.learning.mode).toBe('proficiency');
    expect(getCourseConfig).toBe(before);
    expect(getCourseConfig(CID).show_my_learning).toBeUndefined();
    expect(StudentView.fromCache(CID, S1).view.learning).toBeNull();
  });
});

/* ── Preview never shows what the student has opened (ruling 116) ──
   DECISIONS, "Student page build rulings (2026-11-10)" 10: when a student
   opens a piece is not shown to teachers. The same returned work, opened
   by the student or not, draws the same Preview on every screen. */
describe('Preview as Student: a returned piece looks the same whether or not the student opened it', () => {
  // Nothing opened: no seen_at, so under As Soon As I Save no change is marked Updated either.
  const NOT_OPENED = Object.fromEntries(
    Object.entries(ROWS).map(([aid, row]) => {
      const r = { ...row };
      delete r.seen_at;
      if (aid === 'a-quick') {
        delete r.previous_copy;
        delete r.updated_at;
      }
      return [aid, r];
    }),
  );
  // Every returned piece opened, after it came back.
  const ALL_OPENED = Object.fromEntries(
    Object.entries(ROWS).map(([aid, row]) => [
      aid,
      row.returned_at ? { ...row, seen_at: '2026-11-09T18:00:00Z' } : { ...row },
    ]),
  );
  const previewHtml = rows => {
    seed('proficiency', null, rows);
    const { view } = StudentView.fromCache(CID, S1);
    return UIS.map(ui => StudentPageView.html(view, ui));
  };

  it('opened, opened with an update, or never opened: the same HTML on every screen', () => {
    const never = previewHtml(NOT_OPENED);
    expect(previewHtml(ROWS)).toEqual(never);
    expect(previewHtml(ALL_OPENED)).toEqual(never);
  });

  it('the student’s own page still tells them what they have not opened', () => {
    const side = studentSide();
    seed('proficiency', null, NOT_OPENED);
    const never = side.view(StudentView.reply(CID, S1));
    seed('proficiency', null, ALL_OPENED);
    const opened = side.view(StudentView.reply(CID, S1));
    expect(never.changes.length).toBeGreaterThan(0);
    expect(opened.changes).toEqual([]);
    expect(opened.work.filter(p => p.unseen)).toEqual([]);
  });
});
