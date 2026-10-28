import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// The grade editor draws an Advanced Rubric as tiles holding each level's
// checkboxes. Ticking every box of a level suggests and sets it; a level
// picked by hand stays, and the note under the criterion says so.
const RUBRIC = {
  id: 'rub-adv',
  name: 'Lab Skills Rubric',
  style: 'advanced',
  criteria: [
    {
      id: 'crit-safe',
      name: 'Safety',
      tagIds: ['QAP'],
      weight: 1,
      levels: { 4: 'Leads safe practice', 3: 'Follows every step', 2: 'Needs reminders', 1: 'Many reminders' },
      checks: [
        { id: 'k4a', level: 4, label: 'Reminds others', displayOrder: 0 },
        { id: 'k3a', level: 3, label: 'Goggles on', displayOrder: 0 },
        { id: 'k3b', level: 3, label: 'Cleans the station', displayOrder: 1 },
        { id: 'k2a', level: 2, label: 'Needs one reminder', displayOrder: 0 },
      ],
    },
  ],
};
const ASSESSMENT = {
  id: 'assess-adv',
  title: 'Density Lab',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP'],
  rubricId: 'rub-adv',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

test('Advanced Rubric tiles tick, suggest and keep a hand-picked level', async ({ page }) => {
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
  await gotoApp(page, '/gradebook');
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-adv"]').click();

  const crit = page.locator('#grader-overlay .grdt-crit[data-critid="crit-safe"]');
  await expect(crit.locator('.grdt-advice')).toContainText('No Level Suggested Yet');

  await crit.locator('input[data-checkid="k3a"]').check();
  await crit.locator('input[data-checkid="k3b"]').check();
  await expect(crit.locator('.grdt-advice')).toContainText('Suggested: Proficient');
  await expect(crit.locator('.grdt-tile.is-chosen')).toContainText('Proficient');

  await crit.locator('.grdt-pick', { hasText: 'Pick Extending' }).click();
  await expect(crit.locator('.grdt-tile.is-chosen')).toContainText('Extending');
  await expect(crit.locator('.grdt-advice')).toContainText('You picked Extending');
  await expect(crit.locator('.grdt-tile.is-suggested')).toContainText('Goggles on');
});
