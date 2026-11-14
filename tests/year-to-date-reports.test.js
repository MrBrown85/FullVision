/**
 * A report's grade is the year to date as of the report's end date (Colin,
 * 2026-11-03, decision 15). Teachers grade cumulatively; a reporting term is
 * a checkpoint, not a fresh start. Colin's example from the term-scoping
 * audit: Mean, one competency, a 2 in October and a 4 in December. Report 1
 * (to Nov 27) is 2.0; Report 2 (to Jan 29) is 3.0, not Term 2's 4.0 alone;
 * the gradebook is 3.0. Every report surface reads it: the Academic Summary,
 * Proficiency, Assignment Grades' Course Grade and category grade, the Quick
 * Report, Generate's facts and the phone report.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// No DOM here: every block 50px tall, every text 7px a character.
const fakeStage = () => ({
  innerHTML: '',
  firstChild: { offsetHeight: 50 },
  querySelectorAll() {
    return [...this.innerHTML.matchAll(/class="gr-measure"[^>]*>([^<]*)</g)].map(m => ({
      offsetWidth: m[1].length * 7,
    }));
  },
});

const CID = 'ytd-reports';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Noor', lastName: 'Khan', pronouns: 'she/her' };
const TERMS = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-02', ends_on: '2026-11-27' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-11-30', ends_on: '2027-01-29' },
];

function seed(gradingSystem) {
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: gradingSystem || 'both', gradeLevel: '8' };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [{ id: 'sec', name: 'Questioning', tags: [{ id: 't1', label: 'Questioning' }] }],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [{ id: 'cat', name: 'Labs', weight: 100 }];
  _cache.assessments[CID] = [
    { id: 'oct', title: 'October Lab', date: '2026-10-15', tagIds: ['t1'], categoryId: 'cat', type: 'summative' },
    { id: 'dec', title: 'December Lab', date: '2026-12-10', tagIds: ['t1'], categoryId: 'cat', type: 'summative' },
  ];
  _cache.scores[CID] = {
    [SID]: [
      { assessmentId: 'oct', tagId: 't1', score: 2, date: '2026-10-15', type: 'summative' },
      { assessmentId: 'dec', tagId: 't1', score: 4, date: '2026-12-10', type: 'summative' },
    ],
  };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average', reportingTerms: TERMS };
  clearProfCache();
}
const text = html =>
  String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

describe('a report reads the year to date as of its end (decision 15)', () => {
  const was = globalThis.courseToday;
  beforeEach(() => {
    localStorage.clear();
    globalThis.courseToday = () => '2027-02-10';
    seed();
  });
  afterEach(() => {
    setActiveTerm(CID, null);
    globalThis.courseToday = was;
    delete COURSES[CID];
  });

  it('the gradebook is 3.0, Report 1 is 2.0 and Report 2 is 3.0', () => {
    expect(studentGradeSummary(CID, SID).text).toBe('3.0 · B 75%');
    setActiveTerm(CID, 1);
    expect(studentGradeSummary(CID, SID, 'term-1').text).toBe('2.0 · C- 50%');
    setActiveTerm(CID, 2);
    expect(studentGradeSummary(CID, SID, 'term-2').text).toBe('3.0 · B 75%');
  });

  it('Proficiency prints Now as the year to date, and Report 1 beside it', () => {
    setActiveTerm(CID, 2);
    const t = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, { termId: 'term-2' }, {}));
    // Then: Report 1, the year to date to Nov 27. Now: the year to date to Jan 29.
    // A Both class: the proficiency and the %, no figure out of 4 (DECISIONS, "Student-facing levels are proficiencies").
    expect(t).toContain('Questioning Developing · 50% Proficient · 75% ↑ Up');
    expect(t).toContain('Overall Developing · C- 50% Proficient · B 75%');
  });

  it('Assessments by category: the Course Grade and the category grade are the year to date, matching the list', () => {
    setActiveTerm(CID, 2);
    const stage = fakeStage();
    const t = text(GradeReport.listPart(CID, STUDENT, { organize: 'category' }, stage).html);
    expect(text(GradeReport.termHtml(CID, STUDENT, { termId: 'term-2' }))).toContain('Course Grade Proficient · B 75%');
    expect(t).toContain('Labs 100% of grade · Proficient · B 75%');
    expect(t).toContain('October Lab');
    expect(t).toContain('December Lab');
  });

  it("Assessments by month leave out work dated after the report's end", () => {
    setActiveTerm(CID, 1);
    const stage = fakeStage();
    const t = text(GradeReport.listPart(CID, STUDENT, { organize: 'month', columns: 'two' }, stage).html);
    expect(t).toContain('October Lab');
    expect(t).not.toContain('December Lab');
    expect(text(GradeReport.termHtml(CID, STUDENT, { termId: 'term-1' }))).toContain(
      'Course Grade Developing · C- 50%',
    );
  });

  it('the Assessments list lists the year to date and the Course Grade line prints', () => {
    setActiveTerm(CID, 2);
    expect(GradeReport.rows(CID, STUDENT).map(r => r.title)).toEqual(['October Lab', 'December Lab']);
    const cats = GradeReport.categorySummary(CID, STUDENT);
    expect(cats[0].grade).toContain('75%');
  });

  it("Generate's facts read the year to date; the trend stays inside the term", () => {
    setActiveTerm(CID, 2);
    const f = CommentBank.facts(CID, STUDENT, 'term-2');
    expect(f.overall).toBe(3);
    expect(f.work.map(w => w.id)).toEqual(['oct', 'dec']);
    expect(f.grade.pieces.map(p => p.id)).toEqual(['oct', 'dec']);
    expect(f.grade.termPieces.map(p => p.id)).toEqual(['dec']);
    const c = f.comps[0];
    expect(c.level).toBe(3);
    expect(c.scores.map(s => s.id)).toEqual(['oct', 'dec']);
    expect(c.termScores.map(s => s.id)).toEqual(['dec']);
  });

  it('the final report is the whole year, and its F is decided on the whole year', () => {
    _cache.scores[CID][SID] = [
      { assessmentId: 'oct', tagId: 't1', score: 1, date: '2026-10-15', type: 'summative' },
      { assessmentId: 'dec', tagId: 't1', score: 2, date: '2026-12-10', type: 'summative' },
    ];
    clearProfCache();
    setActiveTerm(CID, 2); // the last term: the course has ended
    expect(getCourseLetterData(CID, SID).R).toBe(37.5);
    expect(studentGradeSummary(CID, SID, 'term-2').text).toContain('F 37.5%');
  });

  it('undated work counts in every report', () => {
    _cache.assessments[CID].push({ id: 'und', title: 'Undated Lab', tagIds: ['t1'], categoryId: 'cat' });
    _cache.scores[CID][SID].push({ assessmentId: 'und', tagId: 't1', score: 4, type: 'summative' });
    clearProfCache();
    setActiveTerm(CID, 1);
    expect(getSectionProficiency(CID, SID, 'sec')).toBe(3); // the 2 and the undated 4
  });
});

describe("Missing Work lists anything still Missing up to the report's end (decision 17)", () => {
  const was = globalThis.courseToday;
  beforeEach(() => {
    localStorage.clear();
    globalThis.courseToday = () => '2027-02-10';
    seed('letter');
    _cache.assessments[CID].push(
      { id: 'sep', title: 'September Quiz', date: '2026-09-20', tagIds: ['t1'], categoryId: 'cat' },
      { id: 'feb', title: 'February Quiz', date: '2027-02-05', tagIds: ['t1'], categoryId: 'cat' },
      { id: 'und', title: 'Undated Poster', tagIds: ['t1'], categoryId: 'cat' },
    );
    _cache.statuses[CID] = { [SID + ':sep']: 'NS', [SID + ':feb']: 'NS', [SID + ':und']: 'NS' };
    clearProfCache();
  });
  afterEach(() => {
    setActiveTerm(CID, null);
    globalThis.courseToday = was;
    delete COURSES[CID];
  });

  it('Only Missing Work on Report 2 lists a Term 1 piece still Missing, not work after the end', () => {
    setActiveTerm(CID, 2);
    const stage = fakeStage();
    const t = text(GradeReport.listPart(CID, STUDENT, { missingOnly: true }, stage).html);
    expect(t).toContain('September Quiz');
    expect(t).toContain('Undated Poster');
    expect(t).not.toContain('February Quiz');
    expect(t).not.toContain('None');
  });

  it('Report 1 lists only what was assigned up to its end', () => {
    setActiveTerm(CID, 1);
    const t = GradeReport.rows(CID, STUDENT, { missingOnly: true }).map(r => r.title);
    expect(t).toEqual(expect.arrayContaining(['September Quiz', 'Undated Poster']));
  });

  it('This Term at a Glance, the questionnaire, Generate and the Assessments list count the same work', () => {
    setActiveTerm(CID, 2);
    const glance = text(ReportBlocks.renderBlockTermGlance(CID, STUDENT));
    expect(glance).toMatch(/2 Missing/);
    expect(ReportQuestionnaire.notHandedIn(CID, SID).sort()).toEqual(['September Quiz', 'Undated Poster']);
    const f = CommentBank.facts(CID, STUDENT, 'term-2');
    expect(f.record.missing).toBe(2);
    expect(f.notHandedIn.count).toBe(2);
    const quick = GradeReport.rows(CID, STUDENT).filter(r => r.note === 'Missing');
    expect(quick.map(r => r.title).sort()).toEqual(['September Quiz', 'Undated Poster']);
  });
});

describe('growth compares the year to date at the last report with now (decision 18)', () => {
  const was = globalThis.courseToday;
  beforeEach(() => {
    localStorage.clear();
    globalThis.courseToday = () => '2027-02-10';
    seed('proficiency');
  });
  afterEach(() => {
    setActiveTerm(CID, null);
    globalThis.courseToday = was;
    delete COURSES[CID];
  });

  it('Growth Since Last Report: Report 1 2.0 beside Report 2 3.0, up', () => {
    setActiveTerm(CID, 2);
    const html = ReportBlocks.renderBlockGrowth(CID, STUDENT);
    const t = text(html);
    expect(t).toContain('Competency Report 1 Report 2');
    expect(t).toMatch(/Questioning .*Developing .*Proficient/);
    expect(html).toContain('aria-label="Up"');
    expect(getActiveTerm(CID).ordinal).toBe(2);
  });

  it('Proficiency and Progress in One Area say "Report 1" and "since Report 1"', () => {
    setActiveTerm(CID, 2);
    const prof = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, { termId: 'term-2' }, {}));
    expect(prof).toContain('Competency Report 1 Now');
    const progress = text(ReportBlocks.renderBlockProgress(CID, STUDENT, { termId: 'term-2' }, {}));
    expect(progress).toContain('Report 1 Developing');
    expect(progress).toContain('Now Proficient (↑ Up since Report 1)');
  });

  it("Start of Term is measured inside the report's own term", () => {
    // Report 1 has no report before it: Start of Term, from Term 1's work.
    setActiveTerm(CID, 1);
    const r1 = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, { termId: 'term-1' }, {}));
    expect(r1).toContain('Competency Start of Term Now');
    // On Report 2, even a form saved with Start of Term compares with Report
    // 1's year to date (2.0), not Term 2's first piece (the 4), so a student
    // who went 2 → 3 never prints a fall.
    setActiveTerm(CID, 2);
    const r2 = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, { termId: 'term-2' }, { compare: 'start' }));
    expect(r2).toContain('Competency Report 1 Now');
    expect(r2).toContain('Questioning Developing Proficient ↑ Up');
  });

  it('the dashboard arrow: the year to date at Report 1 beside the year so far', () => {
    globalThis.courseToday = () => '2027-01-10'; // in Term 2: Report 1 is the last report
    expect(getActiveTerm(CID)).toBeNull();
    expect(classGradeChange(CID, [SID])).toEqual({ text: '▲ 1.0', dir: 1, since: 'Report 1' });
    // Before Report 1 has ended there is nothing to compare with.
    globalThis.courseToday = () => '2026-11-15';
    expect(classGradeChange(CID, [SID])).toBeNull();
  });
});

describe("Generate's next step needs 2 scored pieces, counted year to date (decision 20)", () => {
  beforeEach(() => {
    localStorage.clear();
    seed('proficiency');
  });
  afterEach(() => {
    setActiveTerm(CID, null);
    delete COURSES[CID];
  });

  it('one piece in Term 1 and one in Term 2 are enough on Report 2', () => {
    setActiveTerm(CID, 2);
    const f = CommentBank.facts(CID, STUDENT, 'term-2');
    expect(f.comps[0].termScores).toHaveLength(1); // Term 2 alone would be too little
    expect(f.comps[0].scores).toHaveLength(2);
    expect(CommentBank.nextStepOf(f.comps).id).toBe('sec');
  });

  it('one piece is not enough', () => {
    setActiveTerm(CID, 1);
    const f = CommentBank.facts(CID, STUDENT, 'term-1');
    expect(f.comps[0].scores).toHaveLength(1);
    expect(CommentBank.nextStepOf(f.comps)).toBeNull();
  });
});

/* Review follow-ups (2026-11-03). */

describe('review follow-ups', () => {
  const was = globalThis.courseToday;
  const lab = (id, date) => ({ id, title: id, date, tagIds: ['t1'], categoryId: 'cat', type: 'summative' });
  const sc = (id, v, date) => ({ assessmentId: id, tagId: 't1', score: v, date, type: 'summative' });
  beforeEach(() => {
    localStorage.clear();
    globalThis.courseToday = () => '2027-02-10';
    seed('proficiency');
  });
  afterEach(() => {
    setActiveTerm(CID, null);
    globalThis.courseToday = was;
    delete COURSES[CID];
  });

  it("1. Generate's growth agrees with Growth Since Last Report: 4,4,4,4 then 1,1,2,2 is a fall", () => {
    const dates = [
      '2026-09-10',
      '2026-09-30',
      '2026-10-20',
      '2026-11-10',
      '2026-12-01',
      '2026-12-15',
      '2027-01-05',
      '2027-01-25',
    ];
    const vals = [4, 4, 4, 4, 1, 1, 2, 2];
    _cache.assessments[CID] = dates.map((d, i) => lab('a' + i, d));
    _cache.scores[CID] = { [SID]: dates.map((d, i) => sc('a' + i, vals[i], d)) };
    clearProfCache();
    setActiveTerm(CID, 2);
    expect(ReportBlocks.renderBlockGrowth(CID, STUDENT)).toContain('aria-label="Down"');
    const f = CommentBank.facts(CID, STUDENT, 'term-2');
    const c = f.comps[0];
    expect(c.since).toBe('Report 1');
    expect(c.start).toBe(4);
    expect(c.now).toBe(c.level);
    expect(c.now).toBeLessThan(c.start);
    expect(CommentBank.improvedComp(c)).toBe(false);
    expect(CommentBank.context(f, {}).rise).toBe('');
  });

  it('1. on the first report Generate keeps the term window', () => {
    setActiveTerm(CID, 1);
    const c = CommentBank.facts(CID, STUDENT, 'term-1').comps[0];
    expect(c.since).toBe('');
  });

  it('2. an override applies only to reports ending on or after its date; the year so far always', () => {
    _cache.overrides[CID] = { [SID]: { sec: { level: 4, reason: 'Portfolio', date: '2027-01-20' } } };
    clearProfCache();
    expect(getSectionProficiency(CID, SID, 'sec')).toBe(4);
    setActiveTerm(CID, 1);
    expect(getSectionProficiency(CID, SID, 'sec')).toBe(2);
    expect(text(ReportBlocks.renderBlockSectionOutcomes(CID, STUDENT))).not.toContain('Teacher override');
    setActiveTerm(CID, 2);
    expect(getSectionProficiency(CID, SID, 'sec')).toBe(4);
    // An undated override applies everywhere.
    _cache.overrides[CID] = { [SID]: { sec: { level: 4, reason: 'Portfolio' } } };
    clearProfCache();
    setActiveTerm(CID, 1);
    expect(getSectionProficiency(CID, SID, 'sec')).toBe(4);
  });

  it('4. Start of Term on a later report compares with the last report', () => {
    setActiveTerm(CID, 2);
    const t = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, { termId: 'term-2' }, { compare: 'start' }));
    expect(t).toContain('Questioning Developing Proficient ↑ Up');
    expect(text(ReportBlocks.renderBlockProgress(CID, STUDENT, { termId: 'term-2' }, {}))).toContain(
      '(↑ Up since Report 1)',
    );
  });

  it('5. a score on a deleted assessment counts on a report as it does in the gradebook', () => {
    _cache.scores[CID][SID].push(sc('gone', 1, '2026-10-20'));
    clearProfCache();
    const yearSoFar = getSectionProficiency(CID, SID, 'sec');
    setActiveTerm(CID, 2);
    expect(getSectionProficiency(CID, SID, 'sec')).toBe(yearSoFar);
  });

  it('6. Progress in One Area falls back to the start of the term when Report 1 had no level for it', () => {
    // A second competency first assessed in Term 2.
    _cache.learningMaps[CID].sections.push({ id: 'sec2', name: 'Planning', tags: [{ id: 't2', label: 'Planning' }] });
    _cache.assessments[CID].push({ id: 'p1', title: 'Plan', date: '2026-12-12', tagIds: ['t2'], categoryId: 'cat' });
    _cache.scores[CID][SID].push({ assessmentId: 'p1', tagId: 't2', score: 2, date: '2026-12-12' });
    clearProfCache();
    setActiveTerm(CID, 2);
    const t = text(ReportBlocks.renderBlockProgress(CID, STUDENT, { termId: 'term-2' }, { area: 'lowest' }));
    expect(t).toContain('Progress: Planning');
    expect(t).toContain('Start of term Developing');
    expect(t).not.toContain('since Report 1');
    expect(t).not.toContain('—');
  });
});

it('7. Strongest still needs 3 pieces, counted year to date', () => {
  const pts = n => Array.from({ length: n }, (_, i) => ({ id: 'w' + i, v: 3, d: '2026-10-0' + (i + 1) }));
  const comps = [
    { id: 'a', level: 3.8, scores: pts(3) },
    { id: 'b', level: 2.5, scores: pts(3) },
  ];
  expect(CommentBank.strongestOf(comps).map(c => c.id)).toEqual(['a']);
  comps[0].scores = pts(2);
  expect(CommentBank.strongestOf(comps)).toEqual([]);
});
