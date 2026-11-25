import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';
import { jumpTo } from './phone-jump.js';

/* Phone grading of Group work (Group grading). Demo Mode, Science 8: the
   Science Fair Proposal (a rubric) is made Group work with three groups of
   four. The progress line has a segment for each group; ⋯ lists the members, each
   with their own Late, Missing and Excused and Grade Separately; a member
   graded separately gets their own card after their group. */

test.beforeEach(({ page }) => demoStudentPageOff(page));

async function open(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const info = await page.evaluate(() => {
    const cid = Object.keys(COURSES)[0];
    const list = getAssessments(cid);
    const a = list.find(x => x.title === 'Science Fair Proposal');
    // An ungraded group: Demo Mode's students each have their own grade here.
    const sc = getScores(cid);
    Object.keys(sc).forEach(sid => (sc[sid] = sc[sid].filter(e => e.assessmentId !== a.id)));
    saveScores(cid, sc);
    const ids = sortStudents(getStudents(cid), 'alpha').map(s => s.id);
    a.collaboration = 'group';
    a.groups = [ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 12)];
    saveAssessments(cid, list);
    return { cid, aid: a.id, ids, total: ids.length };
  });
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('text=Science Fair Proposal').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  return info;
}

test('a card per group, and grading it fills every member', async ({ page }) => {
  const info = await open(page);
  // A segment of the progress line for each group, then each student in none.
  await expect(page.locator('#m-grade-progress .m-prog-seg')).toHaveCount(3 + info.total - 12);
  await expect(page.locator('#m-nav-bar-grade-swiper .m-nav-title-text')).toHaveText('Group 1');
  const card = page.locator('.m-swiper-card').first();
  await expect(card.locator('.m-overall-label')).toHaveText('Comment for the Group');
  // Who is in it, and each member's status, are under ⋯, not on the card.
  await expect(card.locator('.m-group-member, .m-status-row, .m-grade-student-header')).toHaveCount(0);

  await card.locator('.m-score-btn[data-score="4"]').first().click();
  const levels = await page.evaluate(
    ({ cid, aid, ids }) =>
      ids.slice(0, 4).map(sid =>
        (getScores(cid)[sid] || [])
          .filter(e => e.assessmentId === aid)
          .map(e => e.tagId + ':' + e.score)
          .sort()
          .join(','),
      ),
    info,
  );
  expect(levels[0]).toContain(':4');
  expect(levels.slice(1)).toEqual([levels[0], levels[0], levels[0]]);
});

test('Grade Separately from the sheet, and Back to Group Grade', async ({ page }) => {
  const info = await open(page);
  const card = page.locator('.m-swiper-card').first();
  // Each member's Grade Separately is in the grader's ⋯ sheet.
  await page.locator('#m-nav-bar-grade-swiper .m-grade-more').click();
  const sheet = page.locator('#m-sheet-container .m-more-sheet');
  await expect(sheet.locator('.m-more-member-name')).toHaveCount(4);
  await sheet.locator(`[data-action="m-grade-separate"][data-sid="${info.ids[1]}"]`).click();
  await expect(page.locator('#m-grade-progress .m-prog-seg').nth(1)).toHaveAttribute('data-sid', info.ids[1]);
  await expect(card.locator('.m-grade-chip', { hasText: 'Graded Separately' })).toBeVisible();
  // The member's own card, after the group's, says so and offers Back to Group Grade under ⋯.
  await jumpTo(page, 1);
  const own = page.locator('.m-swiper-card').nth(1);
  await expect(own.locator('.m-grade-chip')).toHaveText('Graded Separately');
  await page.locator('#m-nav-bar-grade-swiper .m-grade-more').click();
  await page.locator('#m-sheet-container [data-action="m-grade-rejoin"]').click();
  await expect(page.locator('.m-group-sheet')).toContainText('Back to Group Grade?');
  await page.locator('.m-group-sheet-btn', { hasText: 'Back to Group Grade' }).click();
  await expect(page.locator('.m-grade-chip', { hasText: 'Graded Separately' })).toHaveCount(0);
  // The class list is a card per group again: the second is Group 2.
  await page.locator('#m-nav-bar-grade-swiper .m-nav-title-btn').click();
  await expect(page.locator('#m-sheet-container .m-roster-row').nth(1)).toHaveText('Group 2');
});

test('Missing stays per student', async ({ page }) => {
  const info = await open(page);
  const card = page.locator('.m-swiper-card').first();
  await card.locator('.m-score-btn[data-score="3"]').first().click();
  // Each member's Missing, Excused and Late are in the grader's More sheet.
  await page.locator('#m-nav-bar-grade-swiper .m-grade-more').click();
  await page.locator(`#m-sheet-container .m-status-pill[data-val="NS"][data-sid="${info.ids[3]}"]`).click();
  // The card says it as one chip, with whose it is.
  await expect(card.locator('.m-grade-chip-ns')).toHaveText(/: Missing$/);
  const cleared = await page.evaluate(
    ({ cid, aid, ids }) => (getScores(cid)[ids[3]] || []).some(e => e.assessmentId === aid && e.score > 0),
    info,
  );
  expect(cleared).toBe(false);
});
