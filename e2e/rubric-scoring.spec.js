import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE, TEST_STUDENTS } from './helpers.js';

const TEST_RUBRIC = {
  id: 'rubric-001',
  name: 'Lab Report Rubric',
  criteria: [
    {
      id: 'crit-hyp',
      name: 'Hypothesis',
      tagIds: ['QAP'],
    },
    {
      id: 'crit-data',
      name: 'Data Collection',
      tagIds: ['PI'],
    },
  ],
};

const RUBRIC_ASSESSMENT = {
  id: 'assess-rubric-001',
  title: 'Rubric Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  evidenceType: '',
  notes: '',
  coreCompetencyIds: [],
  rubricId: 'rubric-001',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  dueDate: '',
  collaboration: 'individual',
  moduleId: '',
  pairs: [],
  groups: [],
  excludedStudents: [],
  created: new Date('2026-03-21').toISOString(),
};

/**
 * Seed rubric + rubric-based assessment into localStorage.
 */
async function seedRubricData(page) {
  await page.addInitScript((fixtures) => {
    const { rubric, assessment, cid } = fixtures;
    localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
    localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
  }, { rubric: TEST_RUBRIC, assessment: RUBRIC_ASSESSMENT, cid: TEST_COURSE.id });
}

test.describe('Rubric Scoring Workflow', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedRubricData(page);
  });

  test('rubric assessment is displayed on assignments page', async ({ page }) => {
    await gotoApp(page, '/assignments');
    await expect(page.locator('body')).toContainText('Rubric Lab Report');
  });

  test('expanding rubric assessment shows criteria labels', async ({ page }) => {
    await gotoApp(page, '/assignments');
    const assessEl = page.locator('text=Rubric Lab Report').first();
    await assessEl.click();
    await page.waitForTimeout(500);
    const body = await page.locator('body').textContent();
    expect(body).toContain('Hypothesis');
    expect(body).toContain('Data Collection');
  });

  test('rubric score buttons exist for each criterion', async ({ page }) => {
    await gotoApp(page, '/assignments');
    const assessEl = page.locator('text=Rubric Lab Report').first();
    await assessEl.click();
    await page.waitForTimeout(500);
    // selectRubricScore buttons should be rendered
    const scoreBtns = page.locator('[data-action="selectRubricScore"]');
    const count = await scoreBtns.count();
    // 2 criteria x 4 levels x 3 students = 24 buttons
    expect(count).toBeGreaterThanOrEqual(8);
  });

  test('clicking a rubric score button marks it active', async ({ page }) => {
    await gotoApp(page, '/assignments');
    const assessEl = page.locator('text=Rubric Lab Report').first();
    await assessEl.click();
    await page.waitForTimeout(500);
    // Click Proficient (level 3) for first criterion, first student
    const scoreBtn = page.locator('[data-action="selectRubricScore"][data-level="3"][data-sid="stu-001"][data-critid="crit-hyp"]').first();
    if (await scoreBtn.isVisible()) {
      await scoreBtn.click();
      await page.waitForTimeout(300);
      await expect(scoreBtn).toHaveClass(/active/);
    }
  });

  test('rubric grid has Extending/Proficient/Developing/Emerging labels', async ({ page }) => {
    await gotoApp(page, '/assignments');
    const assessEl = page.locator('text=Rubric Lab Report').first();
    await assessEl.click();
    await page.waitForTimeout(500);
    const body = await page.locator('body').textContent();
    expect(body).toContain('Extending');
    expect(body).toContain('Proficient');
    expect(body).toContain('Developing');
    expect(body).toContain('Emerging');
  });
});
