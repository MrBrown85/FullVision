import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Nov 3 sweep (step 4 group 3 #18): a student's fill menu (⌄) stayed open on
// Escape, opened upward over the row above near the foot of the window (so
// it looked like the other student's), and Clear's toast said "Row filled".
const RUBRIC = {
  id: 'rubric-fill',
  name: 'Lab Report Rubric',
  criteria: [
    { id: 'crit-hyp', name: 'Hypothesis', tagIds: ['QAP'] },
    { id: 'crit-data', name: 'Data Collection', tagIds: ['PI'] },
  ],
};
const ASSESSMENT = {
  id: 'assess-fill',
  title: 'Rubric Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  rubricId: 'rubric-fill',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

test('the row fill menu opens under its row, closes on Escape, and Clear says Row cleared', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 520 });
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
  const card = page.locator('#ac-assess-fill');
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  const student = card.locator('.rsg-student').last();
  await student.locator('.rsg-level.l3').first().click();
  const btn = student.locator('.row-fill-btn');
  const menu = btn.locator('.col-fill-menu');

  // Put the student's head just above the foot of the window.
  await btn.evaluate(el => {
    let p = el.parentElement;
    while (p && !(/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight))
      p = p.parentElement;
    const sc = p || document.scrollingElement;
    sc.scrollTop += el.getBoundingClientRect().bottom - (window.innerHeight - 40);
  });
  expect(await btn.evaluate(el => window.innerHeight - el.getBoundingClientRect().bottom)).toBeLessThan(80);
  await btn.click();
  await expect(menu).toBeVisible();
  const [trigBottom, menuTop] = await btn.evaluate(el => [
    el.getBoundingClientRect().bottom,
    el.querySelector('.col-fill-menu').getBoundingClientRect().top,
  ]);
  expect(menuTop).toBeGreaterThanOrEqual(trigBottom);
  expect(await menu.evaluate(el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(520);

  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();

  await btn.click();
  await menu.locator('.col-fill-option[data-score="0"]').click();
  await expect(page.locator('#undo-toast')).toContainText('Row cleared');
  await expect(student.locator('.rsg-level.active')).toHaveCount(0);
});
