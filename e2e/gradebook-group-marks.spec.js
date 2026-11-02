import { test, expect } from '@playwright/test';

/* The gradebook on Pair and Group work (Group grading): the column says
   Group after its date, a member graded separately gets an S after their
   score, and the key explains S only in a class where someone has one.
   Demo Mode, Science 8: the Science Fair Proposal is made Group work. */

async function setUp(page, separate) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  const info = await page.evaluate(separate => {
    const list = getAssessments('sci8');
    const a = list.find(x => x.title === 'Science Fair Proposal');
    const ids = sortStudents(getStudents('sci8'), 'lastName').map(s => s.id);
    a.collaboration = 'group';
    a.groups = [ids.slice(0, 4), ids.slice(4, 8)];
    saveAssessments('sci8', list);
    if (separate) setGradedSeparately('sci8', a.id, ids[1], true);
    return { aid: a.id, ids };
  }, separate);
  await page.goto('/gradebook?course=sci8');
  return info;
}

test('Group in the header, S on a member graded separately, and the key', async ({ page }) => {
  const info = await setUp(page, true);
  await expect(page.locator(`.gb-grid-colhead[data-aid="${info.aid}"] .gb-scores-assess-meta`)).toContainText(
    '· Group',
  );
  const cell = sid => page.locator(`.gb-scores-cell[data-sid="${sid}"][data-aid="${info.aid}"]`);
  await expect(cell(info.ids[1]).locator('.gb-separate')).toHaveText('S');
  await expect(cell(info.ids[1]).locator('.gb-separate')).toHaveAttribute('title', 'Graded Separately');
  await expect(cell(info.ids[0]).locator('.gb-separate')).toHaveCount(0);
  await expect(page.locator('.gb-key')).toContainText('Graded Separately');
});

test('no Graded Separately in the key when nobody is', async ({ page }) => {
  await setUp(page, false);
  await expect(page.locator('.gb-key')).toContainText('Late');
  await expect(page.locator('.gb-key')).not.toContainText('Graded Separately');
});
