import { test, expect } from '@playwright/test';

/* The Assignments page lists Pair and Group work one group at a time
   (Group grading): a block named for the group with its members' statuses
   and ⋯ menus, one set of grading rows, and a member graded separately as
   their own block after the group. Demo Mode, Science 8: the Science Fair
   Proposal (a rubric) is made Group work with three groups of four. */

test.use({ viewport: { width: 1440, height: 1000 } });

async function setUp(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  const info = await page.evaluate(() => {
    const list = getAssessments('sci8');
    const a = list.find(x => x.title === 'Science Fair Proposal');
    const ids = sortStudents(getStudents('sci8'), 'lastName').map(s => s.id);
    a.collaboration = 'group';
    a.groups = [ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 12)];
    saveAssessments('sci8', list);
    return { aid: a.id, ids, total: ids.length };
  });
  await page.goto('/assignments?course=sci8');
  await page.locator(`[data-action="toggleAssess"][data-aid="${info.aid}"]`).click();
  return info;
}

test('one block per group, then the students in no group', async ({ page }) => {
  const info = await setUp(page);
  const card = page.locator(`#ac-${info.aid}`);
  const names = card.locator('.rsg-student > .rsg-student-head .rsg-student-name');
  await expect(names.nth(0)).toHaveText('Group 1');
  await expect(names.nth(1)).toHaveText('Group 2');
  await expect(names.nth(2)).toHaveText('Group 3');
  await expect(names).toHaveCount(3 + info.total - 12);
  const g1 = card.locator('.rsg-student').first();
  await expect(g1.locator('.rsg-group-member')).toHaveCount(4);
  await expect(g1.locator('.rsg-overall-comment')).toHaveAttribute('placeholder', 'Add an overall comment for Group 1');

  // A level in the group's rows fills every member.
  await g1.locator('.rsg-criterion-row .rsg-level.l4').first().click();
  const levels = await page.evaluate(
    ({ aid, ids }) =>
      ids.slice(0, 5).map(sid =>
        (getScores('sci8')[sid] || [])
          .filter(e => e.assessmentId === aid)
          .map(e => e.tagId + ':' + e.score)
          .sort()
          .join(','),
      ),
    info,
  );
  expect(levels[0]).toContain(':4');
  expect(levels.slice(1, 4)).toEqual([levels[0], levels[0], levels[0]]);
  expect(levels[4]).not.toBe(levels[0]);
});

test('Grade Separately from the strip, and Back to Group Grade', async ({ page }) => {
  const info = await setUp(page);
  const card = page.locator(`#ac-${info.aid}`);
  const member = card.locator('.rsg-group-member').nth(1);
  await member.locator('.grader-member-more').click();
  await member.getByRole('menuitem', { name: 'Grade Separately' }).click();
  await expect(card.locator('.rsg-group-member').nth(1)).toContainText('Graded Separately');
  const second = card.locator('.rsg-student').nth(1);
  await expect(second.locator('.rsg-separate-note')).toHaveText('Graded Separately From Group 1');
  await second.locator('.grader-member-back').click();
  await page.locator('.confirm-overlay').getByRole('button', { name: 'Back to Group Grade' }).click();
  await expect(card.locator('.rsg-separate-note')).toHaveCount(0);
  await expect(card.locator('.rsg-student').nth(1).locator('.rsg-student-name').first()).toHaveText('Group 2');
});
