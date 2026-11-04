import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Nov 3 sweep (step 4 group 2 #16): → in the rubric grader changed the
// student but kept the dialog scrolled, so the new name was off screen and
// a teacher could score the wrong student. It now opens at the top.
const CRITERIA = ['Hypothesis', 'Materials', 'Method', 'Data', 'Graphs', 'Analysis', 'Error', 'Conclusions'];
const RUBRIC = {
  id: 'rubric-tall',
  name: 'Pendulum Rubric',
  criteria: CRITERIA.map((name, i) => ({ id: 'crit-' + i, name, tagIds: [i % 2 ? 'PI' : 'QAP'] })),
};
const ASSESSMENT = {
  id: 'assess-tall',
  title: 'Pendulum Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  rubricId: 'rubric-tall',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

test('stepping to the next student shows the grader from the top', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
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
  await page.evaluate(cid => PageAssignments.openGrader(cid, 'assess-tall', 'stu-001'), TEST_COURSE.id);
  const scroller = page.locator('#grader-overlay .grader-scroll');
  const name = page.locator('#grader-overlay .grader-student');
  const first = await name.textContent();
  const last = page.locator('#grader-overlay .grdt-crit[data-critid="crit-7"]');
  await last.focus();
  await last.scrollIntoViewIfNeeded();
  expect(await scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(0);

  await page.keyboard.press('ArrowRight');
  await expect(name).not.toHaveText(first);
  expect(await scroller.evaluate(el => el.scrollTop)).toBe(0);
  await expect(name).toBeInViewport();
  await expect(last).toBeFocused();

  await scroller.evaluate(el => (el.scrollTop = el.scrollHeight));
  await page.locator('#grader-overlay [data-grader="prev"]').evaluate(el => el.click());
  await expect(name).toHaveText(first);
  expect(await scroller.evaluate(el => el.scrollTop)).toBe(0);
});
