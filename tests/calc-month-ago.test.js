/**
 * My Learning's "Up from Developing a month ago" and which Next Step applies
 * (shared/calc.js: monthAgoDate, skillMonthChange, gradeMonthChange,
 * nextStepLevel; docs/plans/student-page-build-plan.md S13; grade math, for
 * Colin's review).
 *
 * The rule: both grades come from returned work only, by the calculation
 * every grade uses. "A month ago" is the year to date as of the day 30 days
 * before today, read the way a report reads the year to date as of its
 * term's end: work dated on or before that day counts, later work does not.
 * "Today" is always an argument; no test reads the clock.
 */
import './setup.js';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = 'month-class';
const ME = 'month-priya';
const TOP = 'month-maya';
const TODAY = '2026-11-10'; // a month ago is Oct 11

const lv = (value, modifier) => ({ value, modifier: modifier || 0, comment: null });
const levels = tags => ({
  score: { value: null, modifier: 0, comment: null, status: null },
  tag_scores: Object.entries(tags).map(([tag_id, r]) => Object.assign({ tag_id }, r)),
  rubric_scores: [],
});
const points = value => ({
  score: { value, modifier: 0, comment: null, status: null },
  tag_scores: [],
  rubric_scores: [],
});
const back = { is_draft: false, returned_at: '2026-11-01T18:00:00Z' };
const draft = { is_draft: true };
const piece = (id, title, date, extra) =>
  Object.assign({ id, title, date, dueDate: date, type: 'summative', weight: 1, tagIds: [] }, extra);

/* A class in the cache. `cells` { sid: { aid: cell } }; every graded piece
   is returned unless `returns` says otherwise ({ aid: { sid: row } }). */
function seed({ system, gradeLevel, sections, assessments, cells, returns, statuses, categories, config }) {
  localStorage.clear();
  clearClass(CID);
  const scores = _gradebookCellsToScoreCache(CID, assessments, cells).scores;
  const rows = {};
  Object.keys(cells).forEach(sid =>
    Object.keys(cells[sid]).forEach(aid => {
      rows[aid] = rows[aid] || {};
      rows[aid][sid] = (returns && returns[aid] && returns[aid][sid]) || back;
    }),
  );
  seedClass(CID, {
    students: [
      { id: ME, firstName: 'Priya', lastName: 'Shah' },
      { id: TOP, firstName: 'Maya', lastName: 'Chen' },
    ],
    assessments,
    scores,
    statuses: statuses || {},
    learningMaps: {
      subjects: [{ id: 'subj', name: 'Course' }],
      competencyGroups: [],
      sections: sections.map(([id, name]) => ({ id, name, subject: 'subj', tags: [{ id: 't-' + id, label: name }] })),
    },
    categories: categories || [],
    courseConfigs: Object.assign({ student_page_enabled: true, return_grades: 'on_return' }, config),
    gradeReturns: rows,
  });
  COURSES[CID] = { id: CID, name: 'Course', block: 'A', gradingSystem: system, gradeLevel: gradeLevel || '8' };
  delete _returnedSets[CID];
  clearProfCache();
}

const returnedLevel = sec => withReturnedOnly(() => getSectionProficiency(CID, ME, sec));

/* ── Humanities 8, a Proficiency class (boards "My Learning (Proficiency
   Class)", "One Skill", "One Skill, Top Step") ─────────────────────────
   Evidence, One Skill's How It's Going: Sep 21 Developing, Oct 5 Proficient
   minus, Oct 19 Proficient, Nov 3 Proficient plus. Inquiry Proficient on
   Oct 19. Perspective Developing on Oct 30. Maya has Evidence at Extending. */
const HUM_SECTIONS = [
  ['ev', 'Evidence'],
  ['inq', 'Inquiry'],
  ['per', 'Perspective'],
];
const HUM_PIECES = [
  piece('e1', 'Feudalism in Medieval England', '2026-09-21', { tagIds: ['t-ev'] }),
  piece('e2', 'Magna Carta', '2026-10-05', { tagIds: ['t-ev'] }),
  piece('e3', 'The King: Evidence and Reputation', '2026-10-19', { tagIds: ['t-ev', 't-inq'] }),
  piece('e4', 'Assessing the Medieval Church', '2026-11-03', { tagIds: ['t-ev'] }),
  piece('p1', 'Points of View', '2026-10-30', { tagIds: ['t-per'] }),
];
function humCells(extra) {
  return Object.assign(
    {
      [ME]: {
        e1: levels({ 't-ev': lv(2) }),
        e2: levels({ 't-ev': lv(3, -1) }),
        e3: levels({ 't-ev': lv(3), 't-inq': lv(3) }),
        e4: levels({ 't-ev': lv(3, 1) }),
        p1: levels({ 't-per': lv(2) }),
      },
      [TOP]: {
        e2: levels({ 't-ev': lv(3) }),
        e3: levels({ 't-ev': lv(4) }),
        e4: levels({ 't-ev': lv(4) }),
      },
    },
    extra,
  );
}
function humanities(opts) {
  opts = opts || {};
  seed({
    system: opts.system || 'proficiency',
    sections: HUM_SECTIONS,
    assessments: structuredClone(opts.assessments || HUM_PIECES),
    cells: opts.cells || humCells(),
    returns: opts.returns,
    statuses: opts.statuses,
    config: opts.config,
  });
}

afterAll(() => clearClass(CID));

describe('monthAgoDate: the day a month ago is', () => {
  it('30 days before today, across a month and a year', () => {
    expect(monthAgoDate('2026-11-10')).toBe('2026-10-11');
    expect(monthAgoDate('2026-03-01')).toBe('2026-01-30');
    expect(monthAgoDate('2028-03-01')).toBe('2028-01-31'); // a leap year
    expect(monthAgoDate('2027-01-15')).toBe('2026-12-16');
  });
  it('null for anything that is not a real day, so nothing is compared', () => {
    ['', null, undefined, 'today', '2026-02-30', '2026-13-01', '2026-11-10T08:00:00Z', 20261110].forEach(bad => {
      expect(monthAgoDate(bad)).toBeNull();
    });
    humanities();
    expect(skillMonthChange(CID, ME, 'ev', '2026-02-30')).toBeNull();
    expect(gradeMonthChange(CID, ME, undefined)).toBeNull();
  });
});

describe('a Proficiency class: the boards’ worked example', () => {
  beforeEach(() => humanities());

  it('One Skill’s Evidence (Sep 21 Developing, Oct 5 Proficient −, Oct 19 Proficient, Nov 3 Proficient +) is up from Developing a month ago', () => {
    const c = skillMonthChange(CID, ME, 'ev', TODAY);
    // A month ago (Oct 11): Sep 21's 2 and Oct 5's 2.67 average 2.33, Developing.
    expect(c.then).toBeCloseTo((2 + 8 / 3) / 2, 10);
    // Now: all four average 2.75, Proficient.
    expect(c.now).toBeCloseTo((2 + 8 / 3 + 3 + 10 / 3) / 4, 10);
    expect(c).toMatchObject({ from: 'Developing', dir: 1, since: '2026-10-11' });
    // Now is the level My Learning shows for the skill.
    expect(c.now).toBe(returnedLevel('ev'));
  });

  it('My Learning: You’re at Proficient (Evidence 2.75, Inquiry 3, Perspective 2), up from Developing a month ago (Evidence 2.33 alone)', () => {
    const g = gradeMonthChange(CID, ME, TODAY);
    expect(g.now).toBeCloseTo((2.75 + 3 + 2) / 3, 10);
    expect(levelWord(CID, g.now)).toBe('Proficient');
    expect(g.then).toBeCloseTo((2 + 8 / 3) / 2, 10);
    expect(g).toMatchObject({ from: 'Developing', dir: 1 });
    expect(g.now).toBe(withReturnedOnly(() => getOverallProficiency(CID, ME)));
  });

  it('a skill first marked after a month ago has no comparison (Perspective, first on Oct 30)', () => {
    expect(skillMonthChange(CID, ME, 'per', TODAY)).toBeNull();
    expect(skillMonthChange(CID, ME, 'inq', TODAY)).toBeNull();
  });

  it('a month ago is the same level the class showed with only the work dated on or before that day', () => {
    const then = skillMonthChange(CID, ME, 'ev', TODAY).then;
    const overallThen = gradeMonthChange(CID, ME, TODAY).then;
    const early = HUM_PIECES.filter(p => p.date <= '2026-10-11');
    const cells = humCells();
    Object.keys(cells).forEach(sid =>
      Object.keys(cells[sid]).forEach(aid => {
        if (!early.some(p => p.id === aid)) delete cells[sid][aid];
      }),
    );
    humanities({ assessments: early, cells });
    expect(then).toBe(returnedLevel('ev'));
    expect(overallThen).toBe(withReturnedOnly(() => getOverallProficiency(CID, ME)));
  });

  it('nothing a teacher sees moves: every grade after the call is the grade before it', () => {
    const before = [getSectionProficiency(CID, ME, 'ev'), getOverallProficiency(CID, ME), returnedLevel('ev')];
    skillMonthChange(CID, ME, 'ev', TODAY);
    gradeMonthChange(CID, ME, TODAY);
    expect([getSectionProficiency(CID, ME, 'ev'), getOverallProficiency(CID, ME), returnedLevel('ev')]).toEqual(before);
    expect(getActiveTerm(CID)).toBeNull();
  });

  it('two different todays give two different months (no cached number is shared)', () => {
    expect(skillMonthChange(CID, ME, 'ev', TODAY).then).toBeCloseTo(7 / 3, 10);
    // Oct 25: a month ago is Sep 25, when only Sep 21's Developing was in.
    const c = skillMonthChange(CID, ME, 'ev', '2026-10-25');
    expect(c.then).toBe(2);
    expect(c.now).toBe(returnedLevel('ev'));
  });
});

describe('Next Step: which level’s step applies', () => {
  beforeEach(() => humanities());

  it('My Learning’s Next Step: Perspective at Developing takes the Developing step', () => {
    expect(nextStepLevel(CID, ME, 'per')).toEqual({ level: 2, key: 'Developing', top: false });
  });
  it('One Skill’s Evidence at Proficient (2.75) takes the Proficient step', () => {
    expect(nextStepLevel(CID, ME, 'ev')).toEqual({ level: 3, key: 'Proficient', top: false });
  });
  it('One Skill, Top Step: Evidence at Extending (3, 4, 4: 3.67) has no step, You’ve Reached the Top Step', () => {
    expect(nextStepLevel(CID, TOP, 'ev')).toEqual({ level: 4, key: 'Extending', top: true });
  });
  it('a skill with nothing returned has no Next Step', () => {
    expect(nextStepLevel(CID, TOP, 'per')).toBeNull();
  });
  it('the level is the one the skill’s word shows (levelWord), from returned work only', () => {
    // Perspective at Developing returned; a draft at Extending is not seen.
    humanities({
      assessments: [...HUM_PIECES, piece('p2', 'Perspectives Essay', '2026-11-06', { tagIds: ['t-per'] })],
      cells: humCells({ [ME]: { ...humCells()[ME], p2: levels({ 't-per': lv(4) }) } }),
      returns: { p2: { [ME]: draft } },
    });
    expect(nextStepLevel(CID, ME, 'per').key).toBe('Developing');
    expect(getSectionProficiency(CID, ME, 'per')).toBe(3); // the teacher's view, the draft in
  });
  it('a hand-set section level is the level the step follows, as the skill shows it', () => {
    humanities();
    _cache.overrides[CID] = { [ME]: { per: { level: 4, reason: 'Conference', date: '2026-11-05', calculated: 2 } } };
    clearProfCache();
    expect(nextStepLevel(CID, ME, 'per')).toEqual({ level: 4, key: 'Extending', top: true });
  });
});

describe('a draft changes nothing', () => {
  it('a draft dated before a month ago, and one after, are in neither grade', () => {
    const plain = (humanities(), skillMonthChange(CID, ME, 'ev', TODAY));
    const withDrafts = [
      ...HUM_PIECES,
      piece('d0', 'Early Draft', '2026-09-01', { tagIds: ['t-ev'] }),
      piece('d1', 'Late Draft', '2026-11-08', { tagIds: ['t-ev'] }),
    ];
    const cells = humCells({
      [ME]: { ...humCells()[ME], d0: levels({ 't-ev': lv(4) }), d1: levels({ 't-ev': lv(1) }) },
    });
    humanities({ assessments: withDrafts, cells, returns: { d0: { [ME]: draft }, d1: { [ME]: draft } } });
    expect(skillMonthChange(CID, ME, 'ev', TODAY)).toEqual(plain);
    expect(gradeMonthChange(CID, ME, TODAY).then).toBeCloseTo(7 / 3, 10);
    // Returned, the early one moves a month ago (so the test above can fail).
    humanities({ assessments: withDrafts, cells, returns: { d1: { [ME]: draft } } });
    expect(skillMonthChange(CID, ME, 'ev', TODAY).then).toBeCloseTo((4 + 2 + 8 / 3) / 3, 10);
  });

  it('nothing returned a month ago: the only earlier work is a draft, so no comparison', () => {
    humanities({ returns: { e1: { [ME]: draft }, e2: { [ME]: draft } } });
    expect(skillMonthChange(CID, ME, 'ev', TODAY)).toBeNull();
    expect(gradeMonthChange(CID, ME, TODAY)).toBeNull();
  });

  it('nothing returned now either: no comparison and no Next Step', () => {
    const none = {};
    HUM_PIECES.forEach(p => (none[p.id] = { [ME]: draft }));
    humanities({ returns: none });
    expect(skillMonthChange(CID, ME, 'ev', TODAY)).toBeNull();
    expect(gradeMonthChange(CID, ME, TODAY)).toBeNull();
    expect(nextStepLevel(CID, ME, 'ev')).toBeNull();
  });
});

describe('Missing, Excused and Late (DECISIONS: Missing wins everywhere; never drafts)', () => {
  it('Missing on Oct 5’s piece counts no level, now and a month ago (Sep 21’s 2 alone then)', () => {
    humanities({ statuses: { [ME + ':e2']: 'NS' } });
    const c = skillMonthChange(CID, ME, 'ev', TODAY);
    expect(c.then).toBe(2);
    expect(c.now).toBeCloseTo((2 + 3 + 10 / 3) / 3, 10);
    expect(c).toMatchObject({ from: 'Developing', dir: 1 });
  });
  it('Missing on the only earlier piece: nothing a month ago, so no comparison', () => {
    humanities({ statuses: { [ME + ':e1']: 'NS', [ME + ':e2']: 'NS' } });
    expect(skillMonthChange(CID, ME, 'ev', TODAY)).toBeNull();
  });
  it('Excused is left out, as Missing is in a Proficiency class', () => {
    humanities({ statuses: { [ME + ':e2']: 'EXC' } });
    expect(skillMonthChange(CID, ME, 'ev', TODAY).then).toBe(2);
  });
  it('Late counts like any returned grade', () => {
    humanities({ statuses: { [ME + ':e2']: 'LATE' } });
    expect(skillMonthChange(CID, ME, 'ev', TODAY).then).toBeCloseTo(7 / 3, 10);
  });
});

describe('the 30-day edge', () => {
  const edge = date => {
    humanities({
      assessments: [
        piece('e1', 'Feudalism in Medieval England', '2026-09-21', { tagIds: ['t-ev'] }),
        piece('x', 'On the Edge', date, { tagIds: ['t-ev'] }),
      ],
      cells: { [ME]: { e1: levels({ 't-ev': lv(2) }), x: levels({ 't-ev': lv(4) }) } },
    });
    return skillMonthChange(CID, ME, 'ev', TODAY);
  };
  it('work dated exactly 30 days ago (Oct 11) counts a month ago', () => {
    expect(edge('2026-10-11').then).toBe(3);
  });
  it('work dated 29 days ago (Oct 12) does not', () => {
    const c = edge('2026-10-12');
    expect(c.then).toBe(2);
    expect(c).toMatchObject({ now: 3, from: 'Developing', dir: 1 });
  });
  it('undated work counts in both, as it does in a report', () => {
    expect(edge('').then).toBe(3);
  });
});

describe('the class’s calculation method', () => {
  it('Decaying Average (65%): 2.43 a month ago, Developing; 3.15 now, Proficient', () => {
    humanities({ config: { calcMethod: 'decayingAvg', decayWeight: 0.65 } });
    const c = skillMonthChange(CID, ME, 'ev', TODAY);
    const then = 2 * 0.35 + (8 / 3) * 0.65;
    const now = (then * 0.35 + 3 * 0.65) * 0.35 + (10 / 3) * 0.65;
    expect(c.then).toBeCloseTo(then, 10);
    expect(c.now).toBeCloseTo(now, 10);
    expect(c).toMatchObject({ from: 'Developing', dir: 1 });
  });
  it('Count Only the Most Recent 3: 2.33 a month ago (two pieces); 3.0 now (Oct 5, Oct 19, Nov 3)', () => {
    humanities({ config: { recentScoreLimit: 3 } });
    const c = skillMonthChange(CID, ME, 'ev', TODAY);
    expect(c.then).toBeCloseTo(7 / 3, 10);
    expect(c.now).toBeCloseTo((8 / 3 + 3 + 10 / 3) / 3, 10);
  });
  it('Most Recent Score: Proficient − then, Proficient + now: the same word, so dir 0', () => {
    humanities({ config: { calcMethod: 'mostRecent' } });
    const c = skillMonthChange(CID, ME, 'ev', TODAY);
    expect(c.then).toBeCloseTo(8 / 3, 10);
    expect(c.now).toBeCloseTo(10 / 3, 10);
    expect(c).toMatchObject({ from: 'Proficient', dir: 0 });
  });
  it('going down: Most Recent Score with a Developing piece on Nov 3', () => {
    humanities({
      config: { calcMethod: 'mostRecent' },
      cells: humCells({ [ME]: { ...humCells()[ME], e4: levels({ 't-ev': lv(2) }) } }),
    });
    expect(skillMonthChange(CID, ME, 'ev', TODAY)).toMatchObject({ from: 'Proficient', dir: -1 });
  });
});

describe('reading as of a day', () => {
  it('puts back what was in view, also when the read throws', () => {
    humanities();
    expect(_readAsOfDate(CID, '2026-10-11', () => getActiveTerm(CID).endsOn)).toBe('2026-10-11');
    expect(getActiveTerm(CID)).toBeNull();
    expect(() =>
      _readAsOfDate(CID, '2026-10-11', () => {
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(getActiveTerm(CID)).toBeNull();
    expect(getSectionProficiency(CID, ME, 'ev')).toBeCloseTo(2.75, 10);
  });
});

describe('a report in view is left as it was', () => {
  it('the grades are the year so far, and the term in view is put back', () => {
    humanities({
      config: {
        reportingTerms: [
          { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-10-15' },
          { ordinal: 2, label: 'Term 2', starts_on: '2026-10-16', ends_on: '2027-01-29' },
        ],
      },
    });
    const yearSoFar = skillMonthChange(CID, ME, 'ev', TODAY);
    setActiveTerm(CID, 1);
    try {
      expect(skillMonthChange(CID, ME, 'ev', TODAY)).toEqual(yearSoFar);
      expect(nextStepLevel(CID, ME, 'ev').key).toBe('Proficient');
      expect(getActiveTerm(CID).ordinal).toBe(1);
      // Term 1's own Evidence (Sep 21, Oct 5): unchanged by the call.
      expect(getSectionProficiency(CID, ME, 'ev')).toBeCloseTo(7 / 3, 10);
    } finally {
      setActiveTerm(CID, null);
    }
  });
});

/* ── Socials 10, a Letter class (boards "My Learning (Letter Grade Class)"
   and "Falling Grade, 3 Missing") ─────────────────────────────────────── */
const SOC_CATS = [
  { id: 'pq', name: 'Practice Questions', weight: 40, displayOrder: 0 },
  { id: 'ce', name: 'Current Events', weight: 20, displayOrder: 1 },
  { id: 'te', name: 'Tests', weight: 40, displayOrder: 2 },
];
const pts = (id, title, date, max, cat) =>
  piece(id, title, date, { scoreMode: 'points', maxPoints: max, categoryId: cat, tagIds: ['t-ev'] });
function socials(assessments, mine, statuses, system) {
  seed({
    system: system || 'letter',
    gradeLevel: '10',
    sections: [['ev', 'Evidence']],
    assessments,
    cells: { [ME]: mine },
    statuses,
    categories: structuredClone(SOC_CATS),
  });
}

describe('a Letter class', () => {
  it('B 78% (Practice 84%, Current Events 70%, Tests 76%), up from C+ (70%) a month ago', () => {
    socials(
      [
        pts('q1', 'Practice Questions 1', '2026-10-01', 10, 'pq'),
        pts('c1', 'Current Events 1', '2026-10-05', 10, 'ce'),
        pts('t1', 'Unit 1 Test', '2026-10-08', 10, 'te'),
        pts('q2', 'Practice Questions 2', '2026-10-30', 15, 'pq'),
        pts('t2', 'Unit 2 Test: Trigonometry', '2026-11-04', 40, 'te'),
      ],
      { q1: points(7), c1: points(7), t1: points(7), q2: points(14), t2: points(31) },
    );
    const g = gradeMonthChange(CID, ME, TODAY);
    // A month ago: 7/10 in each category, 70%: C+.
    expect(g.then).toBe(70);
    // Now: 40% × 21/25 (84) + 20% × 7/10 (70) + 40% × 38/50 (76) = 78: B.
    expect(g.now).toBe(78);
    expect(g).toMatchObject({ from: 'C+', dir: 1 });
    expect(withReturnedOnly(() => getCourseLetterData(CID, ME)).S).toBe('B');
  });

  it('Falling Grade, 3 Missing: IE 49% (Practice 64%, Current Events 25%, Tests 46%), down from C (60%) a month ago', () => {
    socials(
      [
        pts('q1', 'Practice Questions 1', '2026-10-01', 20, 'pq'),
        pts('c1', 'Current Events 1', '2026-10-05', 10, 'ce'),
        pts('t1', 'Unit 1 Test', '2026-10-08', 100, 'te'),
        pts('c3', 'Current Events 3', '2026-10-12', 5, 'ce'),
        pts('c5', 'Current Events 5', '2026-10-26', 5, 'ce'),
        pts('q4', 'Practice Questions 4.2', '2026-10-30', 5, 'pq'),
      ],
      { q1: points(16), c1: points(5), t1: points(46) },
      { [ME + ':c3']: 'NS', [ME + ':c5']: 'NS', [ME + ':q4']: 'NS' },
    );
    const g = gradeMonthChange(CID, ME, TODAY);
    // A month ago (Oct 11): 40% × 80 + 20% × 50 + 40% × 46 = 60.4, shown 60%: C.
    expect(g.then).toBe(60);
    // Now each Missing piece counts 0: 40% × 16/25 + 20% × 5/20 + 40% × 46 = 49: IE.
    expect(g.now).toBe(49);
    expect(g).toMatchObject({ from: 'C', dir: -1 });
    expect(withReturnedOnly(() => getCourseLetterData(CID, ME)).S).toBe('IE');
  });

  it('Missing on work dated before a month ago counts 0 in both', () => {
    socials(
      [pts('q1', 'Practice Questions 1', '2026-10-01', 10, 'pq'), pts('q0', 'Practice 0', '2026-09-20', 10, 'pq')],
      { q1: points(8) },
      { [ME + ':q0']: 'NS' },
    );
    const g = gradeMonthChange(CID, ME, TODAY);
    expect(g.then).toBe(40);
    expect(g.now).toBe(40);
    // 40% is IE while the course runs (no reporting dates here).
    expect(g).toMatchObject({ from: 'IE', dir: 0 });
  });

  it('the same letter is no change, though the % moved (B 74% to B 80%)', () => {
    socials(
      [
        pts('q1', 'Practice Questions 1', '2026-10-01', 50, 'pq'),
        pts('q2', 'Practice Questions 2', '2026-10-30', 50, 'pq'),
      ],
      { q1: points(37), q2: points(43) },
    );
    expect(gradeMonthChange(CID, ME, TODAY)).toMatchObject({ then: 74, now: 80, from: 'B', dir: 0 });
  });

  it('nothing returned a month ago in a Letter class: no comparison', () => {
    socials([pts('q2', 'Practice Questions 2', '2026-10-30', 10, 'pq')], { q2: points(9) });
    expect(gradeMonthChange(CID, ME, TODAY)).toBeNull();
    expect(skillMonthChange(CID, ME, 'ev', TODAY)).toBeNull();
  });

  it('a skill reads as its %, so 67% to 83% is up though both are Proficient’s level (Most Recent: 3− then, 3+ now)', () => {
    humanities({ system: 'letter', config: { calcMethod: 'mostRecent' } });
    const c = skillMonthChange(CID, ME, 'ev', TODAY);
    expect(c).toMatchObject({ from: '67%', dir: 1 });
  });

  it('a skill in a Letter class reads as its %', () => {
    socials(
      [
        pts('q1', 'Practice Questions 1', '2026-10-01', 10, 'pq'),
        pts('q2', 'Practice Questions 2', '2026-10-30', 10, 'pq'),
      ],
      { q1: points(5), q2: points(10) },
    );
    const c = skillMonthChange(CID, ME, 'ev', TODAY);
    expect(c.from).toBe(formatLevel(CID, c.then));
    expect(c.from).toMatch(/%$/);
    expect(c.dir).toBe(1);
  });

  it('a Letter class’s Next Step still follows the skill’s level (Falling Grade’s Next Step: Perspective)', () => {
    socials([pts('q1', 'Practice Questions 1', '2026-10-01', 10, 'pq')], { q1: points(6) });
    const v = withReturnedOnly(() => getSectionProficiency(CID, ME, 'ev'));
    expect(nextStepLevel(CID, ME, 'ev').level).toBe(Math.round(v));
  });
});

describe('a Letter and Skills class (board "Letter and Skills")', () => {
  /* Life Sciences 11: Data Patterns Proficient on Oct 1 and Extending on
     Nov 2; Scientific Argument Proficient − on Oct 6 and Developing on Nov 5.
     Each level counts as its % (Counts As, level ÷ 4: 3 is 75%, 3− 66.7%). */
  const SCI = [
    piece('s1', 'Cell Data', '2026-10-01', { tagIds: ['t-dp'] }),
    piece('s2', 'Claim and Evidence', '2026-10-06', { tagIds: ['t-sa'] }),
    piece('s3', 'Population Graphs', '2026-11-02', { tagIds: ['t-dp'] }),
    piece('s4', 'Vaccine Argument', '2026-11-05', { tagIds: ['t-sa'] }),
  ];
  beforeEach(() =>
    seed({
      system: 'both',
      gradeLevel: '11',
      sections: [
        ['dp', 'Data Patterns'],
        ['sa', 'Scientific Argument'],
      ],
      assessments: structuredClone(SCI),
      cells: {
        [ME]: {
          s1: levels({ 't-dp': lv(3) }),
          s2: levels({ 't-sa': lv(3, -1) }),
          s3: levels({ 't-dp': lv(4) }),
          s4: levels({ 't-sa': lv(2) }),
        },
      },
    }),
  );

  it('leads with the letter: B 73% ((75 + 66.7 + 100 + 50) / 4), up from C+ 71% ((75 + 66.7) / 2) a month ago', () => {
    const g = gradeMonthChange(CID, ME, TODAY);
    expect(g).toMatchObject({ now: 73, then: 71, from: 'C+', dir: 1 });
    expect(withReturnedOnly(() => getCourseLetterData(CID, ME)).S).toBe('B');
  });
  it('each skill by its word: Data Patterns up from Proficient (3 to 3.5, Extending)', () => {
    expect(skillMonthChange(CID, ME, 'dp', TODAY)).toMatchObject({ then: 3, now: 3.5, from: 'Proficient', dir: 1 });
  });
  it('Next Step: Scientific Argument at Developing ((2.67 + 2) / 2) takes the Developing step', () => {
    expect(nextStepLevel(CID, ME, 'sa')).toEqual({ level: 2, key: 'Developing', top: false });
    expect(skillMonthChange(CID, ME, 'sa', TODAY)).toMatchObject({ from: 'Proficient', dir: -1 });
  });
});
