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

// Nov 3 sweep (step 4 group 3 #17): ↓ scrolled the dialog and left the
// focus on the same criterion, so the next 3 scored it again.
test('↓ and ↑ move between criteria, and the keys score the one reached', async ({ page }) => {
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
  const crit = i => page.locator('#grader-overlay .grdt-crit[data-critid="crit-' + i + '"]');
  await crit(0).focus();
  await page.keyboard.press('2');
  await page.keyboard.press('ArrowDown');
  await expect(crit(1)).toBeFocused();
  await page.keyboard.press('3');
  for (let i = 2; i <= 7; i++) await page.keyboard.press('ArrowDown');
  await expect(crit(7)).toBeFocused();
  await expect(crit(7)).toBeInViewport();
  await page.keyboard.press('ArrowDown');
  await expect(crit(7)).toBeFocused();
  await page.keyboard.press('ArrowUp');
  await expect(crit(6)).toBeFocused();
  const levels = await page.evaluate(
    cid =>
      ['crit-0', 'crit-1'].map(k => {
        const e = (getScores(cid)['stu-001'] || []).find(x => x.assessmentId === 'assess-tall' && x.tagId === k);
        return e ? e.score : null;
      }),
    TEST_COURSE.id,
  );
  expect(levels).toEqual([2, 3]);
});
