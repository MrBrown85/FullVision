import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Assessment cards: a grip, the title and chips; the open card adds
// Set Everyone To and a ⋯ menu with Class Results, Print Rubrics, Grade by,
// Edit Assessment, Duplicate and Delete (the AssignmentsPage board).
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

test('a card opens to Set Everyone To and a ⋯ menu that holds its actions', async ({ page }) => {
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
  await expect(card.locator('.assess-header-actions')).toHaveCSS('opacity', '1');
  await expect(card.locator('.assess-setto-btn')).toHaveText('Set Everyone To');
  const more = card.locator('.assess-more-btn');
  await expect(more).toHaveAttribute('aria-label', 'More for ' + ASSESSMENT.title);
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const menu = card.locator('.assess-more .assess-menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Class Results',
    'Print Rubrics',
    'Grade by Competencies',
    'Edit Assessment',
    'Duplicate',
    'Delete…',
  ]);
  // Esc closes it and goes back to ⋯.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  await more.click();
  await menu.getByRole('menuitem', { name: 'Grade by Competencies' }).click();
  await expect(menu).toBeHidden();
  await more.click();
  await expect(menu.getByRole('menuitem', { name: 'Grade by Rubric' })).toBeVisible();
});
