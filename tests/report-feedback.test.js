/**
 * The data behind the Quick Report's Feedback Pages (teacher/report-feedback.js):
 * which assessments get a card, what each card carries, the student's
 * observations and the term comment.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const F = ReportFeedback;
const CID = 'f1111111-1111-4111-8111-111111111111';
const SID = 'f3333333-3333-4333-8333-333333333333';
const ST = { id: SID, firstName: 'Ada', lastName: 'Lovelace' };
const RUBRIC = 'f5555555-5555-4555-8555-555555555551';
const RUBRIC_SP = 'f5555555-5555-4555-8555-555555555552';
const RUBRIC_ADV = 'f5555555-5555-4555-8555-555555555553';
const CRIT_A = 'f6666666-6666-4666-8666-666666666661';
const CRIT_B = 'f6666666-6666-4666-8666-666666666662';
const CRIT_SP = 'f6666666-6666-4666-8666-666666666663';
const CRIT_ADV = 'f6666666-6666-4666-8666-666666666664';
const TAG_1 = 'f8888888-8888-4888-8888-888888888881';
const TAG_2 = 'f8888888-8888-4888-8888-888888888882';

const LEVELS = { 4: 'Four.', 3: 'Three.', 2: 'Two.', 1: 'One.' };

// Each assessment is named for what it tests; dates set the order.
const WORK = [
  { id: 'score-only', title: 'Score Only', date: '2026-09-10', categoryId: 'c2', scoreMode: 'points', maxPoints: 10 },
  { id: 'points', title: 'Energy Quiz', date: '2026-10-01', categoryId: 'c2', scoreMode: 'points', maxPoints: 20 },
  { id: 'done', title: 'Reading Log', date: '2026-10-02', categoryId: 'c1', scoreMode: 'complete' },
  { id: 'not-done', title: 'Exit Slip', date: '2026-10-02', categoryId: 'c1', scoreMode: 'complete' },
  { id: 'rubric', title: 'Cell Lab', date: '2026-10-03', categoryId: 'c1', tagIds: [TAG_1, TAG_2], rubricId: RUBRIC },
  { id: 'tags', title: 'Lab Write-Up', date: '2026-10-05', categoryId: 'c1', tagIds: [TAG_1, TAG_2] },
  { id: 'missing', title: 'Poster', date: '2026-10-06', categoryId: 'c1', tagIds: [TAG_1] },
  { id: 'excused', title: 'Field Trip', date: '2026-10-07', categoryId: 'c1', tagIds: [TAG_1] },
  { id: 'unscored', title: 'Not Marked', date: '2026-10-08', categoryId: 'c1', tagIds: [TAG_1] },
  { id: 'single', title: 'Speech', date: '2026-10-09', categoryId: 'c1', tagIds: [], rubricId: RUBRIC_SP },
  { id: 'advanced', title: 'Model Build', date: '2026-10-10', categoryId: 'c1', tagIds: [], rubricId: RUBRIC_ADV },
  { id: 'dibels', title: 'Fall Benchmark', date: '2026-10-11', scoreMode: 'dibels' },
];

function entry(aid, tagId, score, extra) {
  return Object.assign({ id: aid + ':' + tagId, assessmentId: aid, tagId: tagId, score: score, note: '' }, extra);
}

function comment(id, aid, text, date) {
  return {
    id: id,
    text: text,
    dims: [],
    created: date + 'T15:00:00.000Z',
    date: date,
    assignmentContext: { assessmentId: aid, assessmentTitle: '' },
  };
}

function seed() {
  saveStudents(CID, [{ id: SID, firstName: 'Ada', lastName: 'Lovelace' }]);
  saveCategories(CID, [
    { id: 'c1', name: 'Labs', weight: 50 },
    { id: 'c2', name: 'Quizzes', weight: 50 },
  ]);
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [
      { id: 'sec1', name: 'Inquiry', tags: [{ id: TAG_1, label: 'Questioning', code: 'QAP' }] },
      { id: 'sec2', name: 'Planning', tags: [{ id: TAG_2, label: 'Planning' }] },
    ],
    _customized: true,
    _flatVersion: 2,
  };
  saveRubrics(CID, [
    {
      id: RUBRIC,
      name: 'Lab Rubric',
      criteria: [
        { id: CRIT_A, name: 'Inquiry', tagIds: [TAG_1, TAG_2], levels: LEVELS },
        { id: CRIT_B, name: 'Communication', tagIds: [], levels: LEVELS },
      ],
    },
    {
      id: RUBRIC_SP,
      name: 'Speech Rubric',
      style: 'single_point',
      criteria: [{ id: CRIT_SP, name: 'Delivery', tagIds: [], levels: { 3: 'Speaks clearly.' } }],
    },
    {
      id: RUBRIC_ADV,
      name: 'Build Rubric',
      style: 'advanced',
      criteria: [
        {
          id: CRIT_ADV,
          name: 'Design',
          tagIds: [],
          levels: LEVELS,
          checks: [
            { id: 'k4', level: 4, label: 'Tests two designs', displayOrder: 0 },
            { id: 'k3b', level: 3, label: 'Labels parts', displayOrder: 1 },
            { id: 'k3a', level: 3, label: 'Draws a plan', displayOrder: 0 },
            { id: 'k2', level: 2, label: 'Builds a model', displayOrder: 0 },
          ],
        },
      ],
    },
  ]);
  saveAssessments(CID, WORK);
  saveScores(CID, {
    [SID]: [
      entry('score-only', '', 8),
      entry('points', '', 16),
      entry('done', '', 1, { note: 'Neat and on time.' }),
      entry('not-done', '', 0),
      entry('rubric', TAG_1, 3, { mod: 1, critNote: 'Ask a sharper question.' }),
      entry('rubric', TAG_2, 3, { mod: 1, critNote: 'Ask a sharper question.' }),
      entry('rubric', CRIT_B, 2),
      entry('tags', TAG_1, 3),
      entry('tags', TAG_2, 0, { critNote: 'Plan before you start.' }),
      entry('single', CRIT_SP, 3, { critNote: 'Slow down.', critBeyond: 'Used a prop.' }),
      entry('advanced', CRIT_ADV, 3),
    ],
  });
  saveAssignmentStatuses(CID, { [SID + ':rubric']: 'LATE', [SID + ':missing']: 'NS', [SID + ':excused']: 'EXC' });
  setRubricCheck(CID, SID, 'advanced', 'k3a', true);
  saveQuickObs(CID, {
    [SID]: [
      comment('o2', 'points', 'Show the units.', '2026-10-04'),
      comment('o1', 'points', 'Check question 3.', '2026-10-02'),
      comment('o3', 'excused', 'Joined the next trip instead.', '2026-10-08'),
      comment('o4', 'dibels', 'Read with expression.', '2026-10-11'),
      {
        id: 'ob-late',
        text: 'Helped a partner fix the circuit.',
        dims: ['collaboration', 'tag:Kindness'],
        competencyId: TAG_1,
        created: '2026-10-12T18:00:00.000Z',
        date: '2026-10-12',
      },
      {
        id: 'ob-early',
        text: 'Asked why the leaf changed colour.',
        dims: [],
        created: '2026-09-15T18:00:00.000Z',
        date: '2026-09-15',
      },
      { id: 'ob-old', text: 'Last spring.', dims: [], created: '2026-03-01T18:00:00.000Z', date: '2026-03-01' },
    ],
  });
}

const FIELDS = [
  'students',
  'categories',
  'assessments',
  'scores',
  'rubrics',
  'rubricChecks',
  'statuses',
  'observations',
  'termRatings',
  'courseConfigs',
  'learningMaps',
];

beforeEach(() => {
  localStorage.clear();
  FIELDS.forEach(f => {
    if (_cache[f]) delete _cache[f][CID];
  });
  if (typeof COURSES === 'undefined') globalThis.COURSES = {};
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  seed();
  clearProfCache();
});

afterEach(() => {
  delete COURSES[CID];
  setActiveTerm(CID, null);
  clearProfCache();
});

function byId(items) {
  const out = {};
  items.forEach(i => (out[i.id] = i));
  return out;
}

describe('forStudent: which assessments get a card', () => {
  it('keeps work with a rubric or written feedback, oldest first', () => {
    expect(F.forStudent(CID, ST).map(i => i.id)).toEqual([
      'points',
      'done',
      'rubric',
      'tags',
      'excused',
      'single',
      'advanced',
    ]);
  });

  it('leaves out score-only work, Missing work with nothing written, unscored work and DIBELS', () => {
    const ids = F.forStudent(CID, ST).map(i => i.id);
    ['score-only', 'not-done', 'missing', 'unscored', 'dibels'].forEach(id => expect(ids).not.toContain(id));
  });

  it('runs newest first on request', () => {
    expect(F.forStudent(CID, ST, { order: 'newest' }).map(i => i.id)[0]).toBe('advanced');
  });

  it('keeps to the active term', () => {
    saveCourseConfig(CID, {
      reportingTerms: [{ ordinal: 1, label: 'Term 1', starts_on: '2026-10-03', ends_on: '2026-10-06' }],
    });
    setActiveTerm(CID, 1);
    expect(F.forStudent(CID, ST).map(i => i.id)).toEqual(['rubric', 'tags']);
  });
});

describe('forStudent: what a card carries', () => {
  it('points work: the score, out of, percent and the comments with their dates', () => {
    const item = byId(F.forStudent(CID, ST)).points;
    expect(item).toMatchObject({
      title: 'Energy Quiz',
      date: 'Oct 1',
      dateIso: '2026-10-01',
      category: 'Quizzes',
      kind: 'points',
      status: '',
      score: '16',
      outOf: '20',
      percent: '80%',
      rubric: null,
    });
    expect(item.feedback).toEqual([
      { text: 'Check question 3.', date: 'Oct 2', dateIso: '2026-10-02' },
      { text: 'Show the units.', date: 'Oct 4', dateIso: '2026-10-04' },
    ]);
    expect(item.grade.text).toBeTruthy();
    expect(item.grade.text).toBe(item.grade.word);
  });

  it('Complete/Incomplete work: the mark, and the score comment as feedback', () => {
    const item = byId(F.forStudent(CID, ST)).done;
    expect(item).toMatchObject({ kind: 'complete', mark: 'complete', grade: { text: 'Complete', word: '' } });
    expect(item.feedback).toEqual([{ text: 'Neat and on time.', date: '', dateIso: '' }]);
  });

  it('Incomplete work with a comment is kept, marked incomplete', () => {
    const scores = getScores(CID);
    scores[SID].find(e => e.assessmentId === 'not-done').note = 'Hand it in Monday.';
    saveScores(CID, scores);
    const item = byId(F.forStudent(CID, ST))['not-done'];
    expect(item).toMatchObject({ kind: 'complete', mark: 'incomplete', grade: { text: 'Incomplete' } });
  });

  it('a standard rubric: every row with its descriptors, level, ± and comment, Late status', () => {
    const item = byId(F.forStudent(CID, ST)).rubric;
    expect(item.kind).toBe('rubric');
    expect(item.status).toBe('Late');
    expect(item.feedback).toEqual([]);
    expect(item.rubric).toMatchObject({ name: 'Lab Rubric', style: 'standard', levelOrder: [4, 3, 2, 1] });
    expect(item.rubric.rows).toHaveLength(2);
    expect(item.rubric.rows[0]).toEqual({
      criterionId: CRIT_A,
      name: 'Inquiry',
      // A competency with no code shows its name (Print Rubrics' rule).
      codes: ['QAP', 'Planning'],
      levels: { 4: 'Four.', 3: 'Three.', 2: 'Two.', 1: 'One.' },
      level: 3,
      mod: 1,
      mixed: false,
      comment: 'Ask a sharper question.',
      beyond: '',
      checks: null,
    });
    expect(item.rubric.rows[1]).toMatchObject({ name: 'Communication', level: 2, mod: 0, comment: '' });
  });

  it('follows the class’s Rubric Levels order', () => {
    saveCourseConfig(CID, { levelOrder: 'asc' });
    expect(byId(F.forStudent(CID, ST)).rubric.rubric.levelOrder).toEqual([1, 2, 3, 4]);
  });

  it('a single-point rubric: Work On is the comment, Went Beyond its own field', () => {
    const item = byId(F.forStudent(CID, ST)).single;
    expect(item.rubric.style).toBe('single_point');
    expect(item.rubric.rows[0]).toMatchObject({
      name: 'Delivery',
      level: 3,
      comment: 'Slow down.',
      beyond: 'Used a prop.',
      checks: null,
    });
    expect(item.rubric.rows[0].levels[3]).toBe('Speaks clearly.');
  });

  it('an Advanced Rubric: every checkbox at every level, ticked and unticked, in display order', () => {
    const item = byId(F.forStudent(CID, ST)).advanced;
    expect(item.rubric.style).toBe('advanced');
    expect(item.rubric.rows[0].checks).toEqual({
      4: [{ id: 'k4', label: 'Tests two designs', ticked: false }],
      3: [
        { id: 'k3a', label: 'Draws a plan', ticked: true },
        { id: 'k3b', label: 'Labels parts', ticked: false },
      ],
      2: [{ id: 'k2', label: 'Builds a model', ticked: false }],
      1: [],
    });
  });

  it('a Tag Rubric: a row per competency with the general wording and the competency comment', () => {
    const item = byId(F.forStudent(CID, ST)).tags;
    expect(item.kind).toBe('tags');
    expect(item.rubric.name).toBe('Tag Rubric');
    expect(item.rubric.rows.map(r => r.name)).toEqual(['Questioning', 'Planning']);
    expect(item.rubric.rows[0]).toMatchObject({ level: 3, comment: '', checks: null });
    expect(item.rubric.rows[0].levels[3]).toBe(RubricPrint.GENERAL_LEVELS[3]);
    expect(item.rubric.rows[1]).toMatchObject({ level: 0, comment: 'Plan before you start.' });
    expect(item.grade).toEqual({ text: 'Proficient', word: 'Proficient', letter: '' });
  });

  it('a General Rubric: one Overall row for work with no competencies', () => {
    saveAssessments(
      CID,
      WORK.concat([{ id: 'general', title: 'Reading Check', date: '2026-10-04', categoryId: 'c1', tagIds: [] }]),
    );
    const scores = getScores(CID);
    scores[SID].push(entry('general', UNLINKED_TAG_ID, 4));
    saveScores(CID, scores);
    clearProfCache();
    const item = byId(F.forStudent(CID, ST)).general;
    expect(item.kind).toBe('general');
    expect(item.rubric.rows.map(r => r.name)).toEqual(['Overall']);
    expect(item.grade.text).toBe('Extending');
  });

  it('Excused work with a comment: the status, no grade', () => {
    const item = byId(F.forStudent(CID, ST)).excused;
    expect(item).toMatchObject({ status: 'Excused', grade: null });
    expect(item.feedback.map(f => f.text)).toEqual(['Joined the next trip instead.']);
  });
});

describe('forStudent: the grade follows the class setting', () => {
  it('Proficiency: the proficiency word', () => {
    const items = byId(F.forStudent(CID, ST));
    expect(items.tags.grade.text).toBe('Proficient');
    expect(items.rubric.grade.word).toBeTruthy();
  });

  it('Letter: the letter and percent, no proficiency word', () => {
    COURSES[CID].gradingSystem = 'letter';
    clearProfCache();
    const items = byId(F.forStudent(CID, ST));
    expect(items.points.grade).toEqual({ text: 'B 80%', word: '', letter: 'B 80%' });
    expect(items.tags.grade).toEqual({ text: 'B 75%', word: '', letter: 'B 75%' });
    // Rubric columns keep their proficiency names in any class.
    expect(items.rubric.rubric.levelOrder).toEqual([4, 3, 2, 1]);
  });

  it('Both: the word and the letter', () => {
    COURSES[CID].gradingSystem = 'both';
    clearProfCache();
    expect(byId(F.forStudent(CID, ST)).tags.grade).toEqual({
      text: 'Proficient · B 75%',
      word: 'Proficient',
      letter: 'B 75%',
    });
  });
});

describe('observations', () => {
  it('lists the student’s observations, oldest first, with their tags, and leaves assignment comments to their card', () => {
    expect(F.observations(CID, ST)).toEqual([
      { id: 'ob-old', date: 'Mar 1', dateIso: '2026-03-01', text: 'Last spring.', tags: [] },
      {
        id: 'ob-early',
        date: 'Sep 15',
        dateIso: '2026-09-15',
        text: 'Asked why the leaf changed colour.',
        tags: [],
      },
      {
        id: 'ob-late',
        date: 'Oct 12',
        dateIso: '2026-10-12',
        text: 'Helped a partner fix the circuit.',
        tags: ['Questioning', resolveTag('collaboration').label, 'Kindness'],
      },
    ]);
  });

  it('keeps to the report’s term', () => {
    saveCourseConfig(CID, {
      reportingTerms: [
        { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-30' },
        { ordinal: 2, label: 'Term 2', starts_on: '2026-12-01', ends_on: '2027-03-15' },
      ],
    });
    expect(F.observations(CID, ST, 'term-1').map(o => o.id)).toEqual(['ob-early', 'ob-late']);
    expect(F.observations(CID, ST, 'term-2')).toEqual([]);
    // No such report term: the term in view, else all time.
    setActiveTerm(CID, 1);
    expect(F.observations(CID, ST, 'term-9').map(o => o.id)).toEqual(['ob-early', 'ob-late']);
  });
});

describe('termComment', () => {
  it('reads the Term Questionnaire comment as plain text, a paragraph per line', () => {
    saveTermRatings(CID, { [SID]: { 'term-1': { narrative: 'Ada works hard.\n\nShe asks good questions.' } } });
    expect(F.termComment(CID, ST, 'term-1')).toBe('Ada works hard.\nShe asks good questions.');
    expect(F.termComment(CID, ST, 'term-2')).toBe('');
  });

  it('turns a comment from the old editor’s HTML into plain text', () => {
    saveTermRatings(CID, {
      [SID]: { 'term-1': { narrative: '<p>Ada &amp; Alan <b>built</b> it.</p><p>Next: test it.</p>' } },
    });
    expect(F.termComment(CID, ST, 'term-1')).toBe('Ada & Alan built it.\nNext: test it.');
  });
});
