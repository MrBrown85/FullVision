/**
 * A rubric piece's own % (Colin, 2026-11-03; Nov 3 bug sweep, step 4 group
 * 2 #1). Local History Inquiry is the only work in Projects, on the BC
 * Letter Bands (3- = 73, 4 = 100). Its criteria are 3- and 4, so its
 * category counts (73 + 100) / 2 = 86.5%, "A 87%". Its row on the Quick
 * Report and in Assignment Grades, and its gradebook cell, averaged the
 * levels first (3.33 = 3+ = 86%). Every reader now prints the category's
 * math for the piece, from calc.js assessmentCellValue.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'rubric-piece-pct';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Zoe', lastName: 'Chen' };

const rubric = {
  id: 'rub-1',
  name: 'Inquiry Project',
  criteria: [
    { id: 'crit-inquiry', name: 'Inquiry', tagIds: ['t1'], levels: {} },
    { id: 'crit-evidence', name: 'Evidence', tagIds: ['t2'], levels: {} },
  ],
};
const inquiry = {
  id: 'lhi',
  title: 'Local History Inquiry',
  date: '2026-10-01',
  categoryId: 'cat-proj',
  tagIds: ['t1', 't2'],
  rubricId: 'rub-1',
};
const plain = { id: 'quiz', title: 'Map Quiz', date: '2026-10-02', categoryId: 'cat-quiz', tagIds: ['t1'] };
const sc = (assessmentId, tagId, score, extra) => ({ assessmentId, tagId, score, date: '2026-10-05', ...extra });

function seed(mode) {
  COURSES[CID] = { id: CID, name: 'Social Studies 10', gradeLevel: '10', gradingSystem: mode };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [
      { id: 'sec-1', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] },
      { id: 'sec-2', name: 'Evidence', tags: [{ id: 't2', label: 'Evidence' }] },
    ],
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [
    { id: 'cat-proj', name: 'Projects', weight: 50 },
    { id: 'cat-quiz', name: 'Quizzes', weight: 50 },
  ];
  _cache.assessments[CID] = [inquiry, plain];
  _cache.scores[CID] = {
    [SID]: [sc('lhi', 'crit-inquiry', 3, { mod: -1 }), sc('lhi', 'crit-evidence', 4), sc('quiz', 't1', 3, { mod: 1 })],
  };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [rubric];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = {
    calcMethod: 'average',
    gradingScale: { boundaries: DEFAULT_GRADING_SCALE.boundaries, percents: { ...BC_LETTER_BAND_PERCENTS } },
  };
  clearProfCache();
}
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('a rubric piece alone in its category', () => {
  afterEach(() => delete COURSES[CID]);

  it('shows the category’s % in its cell, its Quick Report row and Assignment Grades', () => {
    seed('letter');
    const projects = getCategories(CID).find(c => c.id === 'cat-proj');
    expect(assessmentGroupGrade(CID, SID, [inquiry], categoryCalcMode(projects)).text).toBe('A 87%');

    const cell = assessmentCellValue(CID, SID, inquiry);
    expect(cell.value).toBeCloseTo(10 / 3, 9);
    expect(cell.percent).toBeCloseTo(86.5, 9);
    expect(cell).toMatchObject({ kind: 'level', percentText: '87%', text: '87%' });

    const row = GradeReport.rows(CID, STUDENT).find(r => r.id === 'lhi');
    expect(row).toMatchObject({ score: '3.3', outOf: '4', percent: '87%' });
    expect(GradeReport.categorySummary(CID, STUDENT).find(c => c.name === 'Projects').grade).toBe('A 87%');

    // The printed graded rubric's Overall.
    expect(RubricPrint.sheetData(CID, 'lhi', SID).overall).toMatchObject({ text: '87%' });

    const grades = text(ReportBlocks.renderBlockGradeTable(CID, STUDENT, {}));
    expect(grades).toContain('Local History Inquiry 3.3 / 4 \u00B7 87%');
  });

  it('a Both class pairs the level with the same %', () => {
    seed('both');
    expect(assessmentCellValue(CID, SID, inquiry)).toMatchObject({ text: '3.3 · 87%', percentText: '87%' });
  });

  it('other proficiency work keeps the % its level counts as', () => {
    seed('letter');
    // 3+ on the BC Letter Bands is 86.
    expect(assessmentCellValue(CID, SID, plain)).toMatchObject({ percentText: '86%', text: '86%' });
    expect(formatLevel(CID, 10 / 3)).toBe('86%');
  });
});
