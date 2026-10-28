import { test, expect } from '@playwright/test';
import {
  mockAuth,
  seedCourse,
  seedStudents,
  seedAssessments,
  seedScores,
  gotoApp,
  TEST_ASSESSMENT,
  TEST_COURSE,
} from './helpers.js';

// A Scores cell shows one value for an assessment with several competencies
// (their average). Opening the cell and leaving it without a change must not
// write that average back over each competency's own score and +/−.
const TWO_COMPETENCIES = { ...TEST_ASSESSMENT, tagIds: ['QAP', 'PI'] };

function entry(tagId, score, mod) {
  return {
    id: 'seed-stu-001-' + tagId,
    assessmentId: 'assess-001',
    tagId: tagId,
    score: score,
    mod: mod,
    date: '2026-03-20',
    type: 'summative',
    note: '',
    created: '2026-03-20T00:00:00.000Z',
  };
}

const storedScores = page =>
  page.evaluate(cid => {
    var all = JSON.parse(localStorage.getItem('gb-scores-' + cid) || '{}');
    return (all['stu-001'] || [])
      .filter(e => e.assessmentId === 'assess-001')
      .map(e => [e.tagId, e.score, e.mod || 0])
      .sort();
  }, TEST_COURSE.id);

test.describe('Gradebook Scores cell editing', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page, [TWO_COMPETENCIES]);
    await seedScores(page, { 'stu-001': [entry('QAP', 3, -1), entry('PI', 3, 1)] });
    await gotoApp(page, '/gradebook');
  });

  test('leaving a cell unchanged keeps each competency score and its +/−', async ({ page }) => {
    const cell = page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]');
    // A click opens the grader dialog; the typed editor is Edit score.
    await cell.click({ button: 'right' });
    await page.locator('.gb-ctx-item[data-ctx="editCell"]').click();
    await expect(cell.locator('.gb-scores-input')).toBeFocused();
    await page.locator('.gb-toolbar').click({ position: { x: 5, y: 5 } });
    await expect(cell.locator('.gb-scores-input')).toHaveCount(0);
    expect(await storedScores(page)).toEqual([
      ['PI', 3, 1],
      ['QAP', 3, -1],
    ]);
  });

  test('typing a new value still scores every competency', async ({ page }) => {
    const cell = page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-001"]');
    // A click opens the grader dialog; the typed editor is Edit score.
    await cell.click({ button: 'right' });
    await page.locator('.gb-ctx-item[data-ctx="editCell"]').click();
    await cell.locator('.gb-scores-input').fill('2');
    await cell.locator('.gb-scores-input').press('Enter');
    await expect
      .poll(() => storedScores(page))
      .toEqual([
        ['PI', 2, 0],
        ['QAP', 2, 0],
      ]);
  });
});
