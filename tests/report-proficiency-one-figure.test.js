/**
 * The Report Card printed two overall figures in a Letter class: the
 * Proficiency block's Overall was the competencies rolled up as a %
 * ("Overall 92%") while the Back's Course Grade was the category-weighted
 * grade ("C+ 70%"). Its legend said "out of 4" under a table of percents,
 * and a rubric piece could be named as both the best and the lowest work
 * (step 4 group 2 #2).
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'report-one-figure';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Zoe', lastName: 'Chen' };
const text = html =>
  String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function seed(gradingSystem) {
  COURSES[CID] = { id: CID, name: 'Socials 11', gradingSystem };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [
      { id: 's1', name: 'Evidence', tags: [{ id: 't1', label: 'Evidence' }] },
      { id: 's2', name: 'Inquiry', tags: [{ id: 't2', label: 'Inquiry' }] },
    ],
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [
    { id: 'proj', name: 'Projects', weight: 50 },
    { id: 'test', name: 'Tests', weight: 50 },
  ];
  _cache.assessments[CID] = [
    // One piece scored on both competencies: the top of Evidence, the
    // bottom of Inquiry.
    { id: 'inq', title: 'Local History Inquiry', date: '2026-10-20', tagIds: ['t1', 't2'], categoryId: 'proj' },
    { id: 'quiz', title: 'Unit Quiz', date: '2026-10-21', tagIds: ['t1'], categoryId: 'proj' },
    // Points work on no competency pulls the course grade down.
    {
      id: 'test',
      title: 'Unit Test',
      date: '2026-10-22',
      tagIds: [],
      scoreMode: 'points',
      maxPoints: 10,
      categoryId: 'test',
    },
  ];
  _cache.scores[CID] = {
    [SID]: [
      { assessmentId: 'inq', tagId: 't1', score: 4, date: '2026-10-20' },
      { assessmentId: 'inq', tagId: 't2', score: 2, date: '2026-10-20' },
      { assessmentId: 'quiz', tagId: 't1', score: 3, date: '2026-10-21' },
      { assessmentId: 'test', tagId: null, score: 3, points: 3, date: '2026-10-22' },
    ],
  };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}
const overallRow = html =>
  text(html.slice(html.indexOf('report-prof-overall'), html.indexOf('</tr>', html.indexOf('report-prof-overall'))));

describe('one overall figure on the report', () => {
  afterEach(() => delete COURSES[CID]);

  it('a Letter class prints the course grade as the Overall, the figure the Back prints', () => {
    seed('letter');
    const course = studentGradeSummary(CID, SID).text;
    const html = ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {});
    expect(course).toMatch(/%$/);
    // The competencies alone would be well above the course grade.
    expect(formatLevel(CID, getOverallProficiency(CID, SID))).not.toBe(course.split(' ').pop());
    expect(overallRow(html)).toContain('Overall');
    expect(overallRow(html)).toContain(course);
    expect(overallRow(html)).not.toContain(formatLevel(CID, getOverallProficiency(CID, SID)));
    const back = ReportBlocks.renderBlockGradeTable(CID, STUDENT, {}, {});
    expect(text(back)).toContain('Course Grade ' + course);
  });

  it('a Both class prints the level and the course grade, as the Back does', () => {
    seed('both');
    const html = ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, { word: false });
    expect(overallRow(html)).toContain(studentGradeSummary(CID, SID).text);
  });

  it('a Proficiency class still rolls its competencies up', () => {
    seed('proficiency');
    const html = ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, { word: false });
    expect(overallRow(html)).toContain(formatLevel(CID, getOverallProficiency(CID, SID)));
  });

  it('a Letter class legend gives each level as a % and does not say out of 4', () => {
    seed('letter');
    const t = text(ReportBlocks.renderReportBlock('legend', CID, STUDENT, {}, {}));
    expect(t).not.toContain('out of 4');
    expect(t).toContain(formatLevel(CID, 3) + ' · Proficient');
    seed('proficiency');
    expect(text(ReportBlocks.renderReportBlock('legend', CID, STUDENT, {}, {}))).toContain(
      'BC Proficiency Scale, out of 4',
    );
  });

  it('a piece named as best work is not named as lowest work too', () => {
    seed('proficiency');
    const t = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
    expect(t).toContain('Best work: Local History Inquiry');
    expect(t).not.toMatch(/Lowest work: Local History Inquiry/);
  });
});

/* Best Work and Lowest Work gave a piece's mark on one competency
   (Pendulum Lab Report 4.0) while Assignment Grades gave its whole mark
   (3.0), and Complete/Incomplete work printed as 4.0 (step 4 group 2 #3). */
describe('best and lowest work print the mark Assignment Grades prints', () => {
  afterEach(() => delete COURSES[CID]);

  it('names a piece at its whole mark and leaves out Complete/Incomplete work', () => {
    seed('proficiency');
    _cache.assessments[CID].push({
      id: 'safety',
      title: 'Safety Contract',
      date: '2026-10-01',
      tagIds: ['t1'],
      scoreMode: 'complete',
      categoryId: 'proj',
    });
    _cache.scores[CID][SID].push({ assessmentId: 'safety', tagId: 't1', score: 4, date: '2026-10-01' });
    clearProfCache();
    const t = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}));
    const back = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { word: false }, {}));
    // The Inquiry is 4 on Evidence and 2 on Inquiry: 3.0 as a whole.
    expect(back).toContain('Local History Inquiry 3.0 / 4');
    expect(t).toMatch(/Best work: Local History Inquiry \(Oct 20\)( and Unit Quiz \(Oct 21\))?, 3\.0 \/ 4\./);
    expect(t).not.toContain('Safety Contract');
    expect(t).not.toContain('4.0 / 4');
  });

  it('a Letter class names a piece at the % Assignment Grades prints', () => {
    seed('letter');
    const back = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, { score: false, word: false }, {}));
    const pct = back.match(/Local History Inquiry (\d+%)/)[1];
    expect(text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}))).toContain('Local History Inquiry (Oct 20)');
    expect(text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {}))).toMatch(
      new RegExp('Best work: [^.]*, ' + pct + '\\.'),
    );
  });
});
