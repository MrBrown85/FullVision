import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Assessment cards: a grip, the title and chips; the open card adds
// Competencies | Rubric, Print Rubrics and edit / duplicate / delete.
const RUBRIC = {
  id: 'rubric-card',
  name: 'Lab Report Rubric',
  criteria: [{ id: 'crit-hyp', name: 'Hypothesis', tagIds: ['QAP'] }],
};
const ASSESSMENT = {
  id: 'assess-card',
  title: 'Rubric Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP'],
  rubricId: 'rubric-card',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

test('a card opens to Competencies | Rubric and its actions', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(
    ({ rubric, assessment, cid }) => {
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
    },
    { rubric: RUBRIC, assessment: ASSESSMENT, cid: TEST_COURSE.id },
  );
  await gotoApp(page, '/assignments');

  const card = page.locator('#ac-assess-card');
  await expect(card.locator('.assess-grip')).toBeVisible();
  await expect(card.locator('.rubric-badge')).toHaveText('Lab Report Rubric');

  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await expect(card).toHaveClass(/open/);
  const view = card.locator('.rubric-view-toggle .rubric-view-btn');
  await expect(view).toHaveText(['Criteria', 'Rubric']);
  await expect(card.locator('.rubric-print-btn')).toHaveText('Print Rubrics');
  await expect(card.locator('.assess-header-action-btn')).toHaveCount(3);
  await expect(card.locator('.assess-header-actions')).toHaveCSS('opacity', '1');

  await view.filter({ hasText: 'Criteria' }).click();
  await expect(view.filter({ hasText: 'Criteria' })).toHaveAttribute('aria-pressed', 'true');
});
