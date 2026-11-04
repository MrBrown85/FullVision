/**
 * Page Studio's words (step 4 group 3 #63): "to the Page 3", folder counts
 * with no word for what they count, a Start of Term of "—" in the
 * Proficiency table where Progress in One Area printed the first piece's
 * level, a "Focus area (biggest change)" that changed 0.0, and "black" in
 * lower case in the print dialog.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'studio-words';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Mateo', lastName: 'Alvarez' };
const text = html =>
  String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

function seed() {
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [
      { id: 's1', name: 'Questioning', tags: [{ id: 't1', label: 'Questioning' }] },
      { id: 's2', name: 'Evaluating', tags: [{ id: 't2', label: 'Evaluating' }] },
    ],
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  // One piece on each competency: too few dated scores for a start.
  _cache.assessments[CID] = [
    { id: 'lab', title: 'Lab 1 Observations', date: '2026-10-27', tagIds: ['t1'] },
    { id: 'quiz', title: 'Quiz', date: '2026-10-28', tagIds: ['t2'] },
  ];
  _cache.scores[CID] = {
    [SID]: [
      { assessmentId: 'lab', tagId: 't1', score: 2.33, date: '2026-10-27' },
      { assessmentId: 'quiz', tagId: 't2', score: 3, date: '2026-10-28' },
    ],
  };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}

describe('Page Studio words', () => {
  afterEach(() => delete COURSES[CID]);

  it('names a side as a sentence does', () => {
    expect(ReportStudio.sideWhere(0)).toBe('the Front');
    expect(ReportStudio.sideWhere(1)).toBe('the Back');
    expect(ReportStudio.sideWhere(2)).toBe('Page 3');
  });

  it('the Proficiency table starts a competency where Progress in One Area does', () => {
    seed();
    const prog = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
    const start = prog.match(/Start of term (\d\.\d)/)[1];
    const table = text(ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, { word: false }));
    expect(table).toMatch(new RegExp('Questioning ' + start.replace('.', '\\.') + ' '));
    expect(table).not.toMatch(/Questioning — /);
  });

  it('a focus area with no change is not called the biggest change', () => {
    seed();
    const prog = text(ReportBlocks.renderBlockProgress(CID, STUDENT, {}, {}));
    expect(prog).toContain('Focus area (lowest now)');
    expect(prog).not.toContain('biggest change');
  });
});
