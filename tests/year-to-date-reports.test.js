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
    expect(t).toContain('Questioning 2.0 · 50% Developing 3.0 · 75% Proficient +1.0');
    expect(t).toContain('Overall 2.0 · C- 50% Developing 3.0 · B 75% Proficient');
  });

  it('Assignment Grades: the Course Grade and the category grade are the year to date, matching the list', () => {
    setActiveTerm(CID, 2);
    const t = text(
      ReportBlocks.renderBlockGradeTable(CID, STUDENT, { organize: 'category', range: 'all' }, { termId: 'term-2' }),
    );
    expect(t).toContain('Course Grade 3.0 · B 75%');
    expect(t).toContain('Labs 100% of grade · 3.0 · B 75%');
    expect(t).toContain('October Lab');
    expect(t).toContain('December Lab');
  });

  it("Assignment Grades leaves out work dated after the report's end", () => {
    setActiveTerm(CID, 1);
    const t = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { range: 'all' }, { termId: 'term-1' }));
    expect(t).toContain('October Lab');
    expect(t).not.toContain('December Lab');
    expect(t).toContain('Course Grade 2.0 · C- 50%');
  });

  it('the Quick Report lists the year to date and prints its Course Grade', () => {
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

  it('the phone report sent to the student carries the year-to-date grade', () => {
    setActiveTerm(CID, 2);
    const snap = PhoneReports.snapshot(CID, STUDENT, { termId: 'term-2', termLabel: 'Report 2' });
    expect(snap.overall.text).toBe('3.0 · B 75%');
    expect(snap.skills[0].text).toBe('3.0 · 75%');
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
