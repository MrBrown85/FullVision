import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, gotoApp, TEST_COURSE } from './helpers.js';

// A grade that reads "No Letter Grade" or "IE" (the report's reporting basis,
// Generate plan PR 3) never cuts off the student's name beside it: the name
// stays whole at every column width, the grade ends in an ellipsis instead,
// and the full text is on hover.
test.beforeEach(async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page);
  await seedScores(page, { 'stu-001': { 'assess-001': { QAP: 3 } } });
  await gotoApp(page, '/gradebook');
});

/* Alice on Language Goals for the report in view, in a Letter class. */
async function onGoals(page, mode) {
  await page.evaluate(
    ([cid, gradingSystem]) => {
      COURSES[cid].gradingSystem = gradingSystem;
      window.viewedReportTerm = () => 'term-1';
      upsertTermRating(cid, 'stu-001', 'term-1', { reportingBasis: 'language_goals', ieDeadline: null });
      clearProfCache();
      PageGradebook.render();
    },
    [TEST_COURSE.id, mode],
  );
}

/* Squeezes the row headers to `px` and measures Alice's name and grade. */
const measure = (page, px) =>
  page.evaluate(w => {
    document.querySelectorAll('.gb-grid-rowhead').forEach(r => (r.style.width = w + 'px'));
    const row = [...document.querySelectorAll('.gb-grid-rowhead')].find(r => /Alice/.test(r.textContent));
    const name = row.querySelector('.gb-grid-rowhead-name');
    // The basis is the letter's line: the last one in a Both class.
    const text = [...row.querySelectorAll('.gb-grade-text')].pop();
    return {
      nameCut: name.scrollWidth > name.clientWidth + 1,
      gradeCut: text.scrollWidth > text.clientWidth + 1,
      title: text.getAttribute('title') || text.parentElement.getAttribute('title'),
      overflow: getComputedStyle(text).textOverflow,
    };
  }, px);

for (const mode of ['letter', 'both']) {
  test(`No Letter Grade shortens, the name never does (${mode} class)`, async ({ page }) => {
    await onGoals(page, mode);
    for (const px of [320, 220, 170, 140]) {
      const m = await measure(page, px);
      expect(m.nameCut, px + 'px').toBe(false);
      expect(m.title).toBe('No Letter Grade');
      expect(m.overflow).toBe('ellipsis');
    }
    // Narrow enough, the grade is the one that gives way.
    expect((await measure(page, 140)).gradeCut).toBe(true);
  });
}

test('the Competencies view keeps the name whole too', async ({ page }) => {
  await onGoals(page, 'letter');
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  await expect(page.locator('.gb-grid-rowhead-comp').first()).toBeVisible();
  for (const px of [260, 170, 140]) {
    const m = await measure(page, px);
    expect(m.nameCut, px + 'px').toBe(false);
    expect(m.title).toBe('No Letter Grade');
  }
});
