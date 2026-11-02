import { test, expect } from '@playwright/test';

/* Phone grading of Group work (Group grading). Demo Mode, Science 8: the
   Science Fair Proposal (a rubric) is made Group work with three groups of
   four. The strip shows G1, G2 …; a group's card lists its members with
   their own M | EXC | LATE and a ⋯ sheet with Grade Separately; a member
   graded separately gets their own card after their group. */

async function open(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
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
  const thumbs = page.locator('#m-thumb-strip .m-thumb');
  await expect(thumbs.nth(0)).toHaveText('G1');
  await expect(thumbs.nth(2)).toHaveText('G3');
  await expect(thumbs).toHaveCount(3 + info.total - 12);
  await expect(page.locator('#m-nav-bar-grade-swiper')).toContainText('Group 1 · 1 of ' + (3 + info.total - 12));
  const card = page.locator('.m-swiper-card').first();
  await expect(card.locator('.m-group-title')).toHaveText('Group 1');
  await expect(card.locator('.m-group-member')).toHaveCount(4);
  await expect(card.locator('.m-status-row')).toHaveCount(0);

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
  await card.locator('.m-group-more').nth(1).click();
  await expect(page.locator('.m-group-sheet')).toContainText('Grade Separately');
  await page.locator('.m-group-sheet-btn', { hasText: 'Grade Separately' }).click();
  await expect(page.locator('#m-thumb-strip .m-thumb').nth(1)).toHaveAttribute('data-sid', info.ids[1]);
  await expect(card.locator('.m-group-member').nth(1)).toContainText('Graded Separately');
  const own = page.locator('.m-swiper-card').nth(1);
  await expect(own.locator('.m-group-separate-text')).toHaveText('Graded Separately From Group 1');
  await own.locator('.m-group-back').click();
  await expect(page.locator('.m-group-sheet')).toContainText('Back to Group Grade?');
  await page.locator('.m-group-sheet-btn', { hasText: 'Back to Group Grade' }).click();
  await expect(page.locator('.m-group-separate')).toHaveCount(0);
  await expect(page.locator('#m-thumb-strip .m-thumb').nth(1)).toHaveText('G2');
});

test('Missing stays per student', async ({ page }) => {
  const info = await open(page);
  const card = page.locator('.m-swiper-card').first();
  await card.locator('.m-score-btn[data-score="3"]').first().click();
  await page.locator(`.m-group-pill[data-val="NS"][data-sid="${info.ids[3]}"]`).click();
  await expect(page.locator(`.m-group-pill[data-val="NS"][data-sid="${info.ids[3]}"]`)).toHaveClass(/m-status-active/);
  const cleared = await page.evaluate(
    ({ cid, aid, ids }) => (getScores(cid)[ids[3]] || []).some(e => e.assessmentId === aid && e.score > 0),
    info,
  );
  expect(cleared).toBe(false);
});
