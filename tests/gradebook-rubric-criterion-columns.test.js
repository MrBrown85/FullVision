/**
 * Rubric columns in the Competencies gradebook (2026-10-18). A rubric
 * assessment whose three criteria each feed two competencies showed six
 * identical-looking columns. "Rubric columns: Criteria" shows one column per
 * criterion instead; rubricCriterionColumns lists them with the score keys
 * each criterion stores under. The first key is the one the cell shows.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CID = 'course-rubric-cols';
const RUBRIC = 'rub-lab';

const rubric = {
  id: RUBRIC,
  name: 'Lab Investigation Rubric',
  criteria: [
    { id: 'crit-inquiry', name: 'Scientific Inquiry', tagIds: ['QAP', 'PI'], levels: {} },
    { id: 'crit-data', name: 'Data & Analysis', tagIds: ['IP', 'EM'], levels: {} },
    { id: 'crit-neat', name: 'Neatness', tagIds: [], levels: {} },
  ],
};
const labAssessment = { id: 'a-lab', title: 'Lab', tagIds: ['QAP', 'PI', 'IP', 'EM'], rubricId: RUBRIC };

beforeEach(() => {
  _cache.rubrics[CID] = [rubric];
});
afterEach(() => {
  delete _cache.rubrics[CID];
});

describe('rubricCriterionColumns', () => {
  it('lists one column per criterion with its score keys', () => {
    const cols = rubricCriterionColumns(labAssessment, CID);
    expect(cols.map(c => c.criterion.name)).toEqual(['Scientific Inquiry', 'Data & Analysis', 'Neatness']);
    // A criterion's score is kept under the criterion's own id.
    expect(cols.map(c => c.keys)).toEqual([['crit-inquiry'], ['crit-data'], ['crit-neat']]);
  });

  it('shows a criterion under its own key', () => {
    const cols = rubricCriterionColumns(labAssessment, CID);
    expect(cols[0].keys[0]).toBe('crit-inquiry');
    expect(cols[2].keys[0]).toBe('crit-neat');
  });

  it('gives fewer columns than one per competency', () => {
    expect(rubricCriterionColumns(labAssessment, CID).length).toBe(3);
    expect(rubricCompetencyIds(CID, labAssessment)).toEqual(['QAP', 'PI', 'IP', 'EM']);
  });

  it('is empty for an assessment with no rubric', () => {
    expect(rubricCriterionColumns({ id: 'a-quiz', tagIds: ['QAP'] }, CID)).toEqual([]);
  });

  it('is empty for a points assessment, even with a rubric', () => {
    expect(rubricCriterionColumns({ ...labAssessment, scoreMode: 'points', maxPoints: 20 }, CID)).toEqual([]);
  });

  it('is empty when the rubric is gone or no class is given', () => {
    expect(rubricCriterionColumns({ id: 'a', rubricId: 'missing', tagIds: ['QAP'] }, CID)).toEqual([]);
    expect(rubricCriterionColumns(labAssessment)).toEqual([]);
  });

  it('skips a criterion with no id', () => {
    _cache.rubrics[CID] = [{ id: RUBRIC, criteria: [{ name: 'Broken', tagIds: ['QAP'] }, rubric.criteria[0]] }];
    expect(rubricCriterionColumns(labAssessment, CID).map(c => c.criterion.id)).toEqual(['crit-inquiry']);
  });
});

describe('the Competencies view uses them', () => {
  const src = readFileSync(resolve(root, 'teacher/page-gradebook.js'), 'utf-8');

  it('remembers the choice per class and defaults to competencies', () => {
    expect(src).toContain(
      "localStorage.getItem('gb_rubricColumns_' + cid) === 'criteria' ? 'criteria' : 'competencies'",
    );
  });

  it('builds criterion columns from rubricCriterionColumns', () => {
    expect(src).toContain('rubricCriterionColumns(a, cid)');
    expect(src).toContain('tagId: c.keys[0]');
  });

  it('scores every key of a criterion cell', () => {
    expect(src).toContain('data-tids=');
    expect(src.match(/_cellScoreKeys\(td\)/g).length).toBeGreaterThanOrEqual(2);
  });
});
