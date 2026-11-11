import { test, expect } from '@playwright/test';

/* Group grading in the grader dialog (Group grading, shared/data.js).
   Demo Mode, Science 8: the Science Fair Proposal (a rubric) is made Group
   work with three groups of four. A member's gradebook cell opens their
   group; grading it fills every member; Grade Separately takes one member
   out and Back to Group Grade puts them back; Missing stays per student. */

test.use({ viewport: { width: 1440, height: 1000 } });

async function setUp(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const info = await page.evaluate(() => {
    const list = getAssessments('sci8');
    const a = list.find(x => x.title === 'Science Fair Proposal');
    // An ungraded group: Demo Mode's students each have their own grade here.
    const sc = getScores('sci8');
    Object.keys(sc).forEach(sid => (sc[sid] = sc[sid].filter(e => e.assessmentId !== a.id)));
    saveScores('sci8', sc);
    const ids = sortStudents(getStudents('sci8'), 'lastName').map(s => s.id);
    a.collaboration = 'group';
    a.groups = [ids.slice(0, 4), ids.slice(4, 8), ids.slice(8, 12)];
    saveAssessments('sci8', list);
    return {
      aid: a.id,
      ids,
      names: ids.slice(0, 4).map(id => displayNameWithLast(getStudents('sci8').find(s => s.id === id))),
    };
  });
  await page.goto('/gradebook?course=sci8');
  return info;
}

async function openCell(page, info, sid) {
  await page.locator(`.gb-scores-cell[data-sid="${sid}"][data-aid="${info.aid}"]`).click();
  await expect(page.locator('#grader-overlay .grader-dialog')).toBeVisible();
}

const levelsOf = (page, info, sid) =>
  page.evaluate(
    ({ aid, sid }) =>
      (getScores('sci8')[sid] || [])
        .filter(e => e.assessmentId === aid)
        .map(e => e.tagId + ':' + e.score)
        .sort()
        .join(','),
    { aid: info.aid, sid },
  );

test('a member’s cell opens their group, and grading it fills every member', async ({ page }) => {
  const info = await setUp(page);
  await openCell(page, info, info.ids[2]);
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog.locator('.grader-student')).toHaveText('Group 1');
  await expect(dialog.locator('.grader-members-title')).toHaveText('Students in This Group');
  await expect(dialog.locator('.grader-member-name')).toHaveText(info.names);
  await expect(dialog.locator('.grader-hint')).toHaveText('← → change group · Esc closes');
  await expect(dialog.locator('.grader-student-row .grader-status')).toBeHidden();
  await expect(dialog.locator('.grader-report-note')).toBeHidden();

  await dialog.locator('.grdt-tile[data-action="graderLevel"][data-level="4"]').first().click();
  const first = await levelsOf(page, info, info.ids[0]);
  expect(first).toContain(':4');
  for (const sid of info.ids.slice(1, 4)) expect(await levelsOf(page, info, sid)).toBe(first);
  expect(await levelsOf(page, info, info.ids[4])).not.toBe(first);

  await page.keyboard.press('Escape');
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
});

test('Grade Separately and Back to Group Grade', async ({ page }) => {
  const info = await setUp(page);
  await openCell(page, info, info.ids[0]);
  const dialog = page.locator('#grader-overlay .grader-dialog');
  const noor = dialog.locator('.grader-member').nth(1);
  await noor.locator('.grader-member-more').click();
  await expect(noor.locator('.grader-member-menu')).toBeVisible();
  await noor.getByRole('menuitem', { name: 'Grade Separately' }).click();
  await expect(noor.locator('.grader-member-separate')).toContainText('Graded Separately');
  await expect(noor.locator('.grader-member-back')).toHaveText('Back to Group Grade');

  // The group's grade no longer reaches her.
  const before = await levelsOf(page, info, info.ids[1]);
  await dialog.locator('.grdt-tile[data-action="graderLevel"][data-level="1"]').first().click();
  expect(await levelsOf(page, info, info.ids[1])).toBe(before);
  const group = await levelsOf(page, info, info.ids[0]);
  expect(group).not.toBe(before);

  // Her name opens her own grader, with the line and the button.
  await noor.locator('button.grader-member-name').click();
  await expect(dialog.locator('.grader-student')).toHaveText(info.names[1]);
  await expect(dialog.locator('.grader-separate-line')).toContainText('Graded Separately From Group 1');
  await expect(dialog.locator('.grader-hint')).toHaveText('← → change student · Esc closes');
  await dialog.locator('.grader-separate-line .grader-member-back').click();
  await expect(page.locator('.confirm-overlay')).toContainText('Back to Group Grade?');
  await page.locator('.confirm-overlay').getByRole('button', { name: 'Back to Group Grade' }).click();
  await expect(dialog.locator('.grader-student')).toHaveText('Group 1');
  expect(await levelsOf(page, info, info.ids[1])).toBe(group);
});

test('Missing stays per student, and → steps group by group', async ({ page }) => {
  const info = await setUp(page);
  await openCell(page, info, info.ids[0]);
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await dialog.locator('.grdt-tile[data-action="graderLevel"][data-level="4"]').first().click();
  const sam = dialog.locator('.grader-member').nth(3);
  await sam.locator('[data-status="NS"]').click();
  await expect(sam.locator('[data-status="NS"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await levelsOf(page, info, info.ids[3])).not.toContain(':4');
  expect(await levelsOf(page, info, info.ids[0])).toContain(':4');

  await dialog.locator('[data-grader="next"]').click();
  await expect(dialog.locator('.grader-student')).toHaveText('Group 2');
  await dialog.locator('[data-grader="prev"]').click();
  await expect(dialog.locator('.grader-student')).toHaveText('Group 1');
});

test('from the gradebook, → follows the rows on screen', async ({ page }) => {
  const info = await setUp(page);
  // Rows on screen: a member of Group 3, then one of Group 1.
  await page.evaluate(({ aid, ids }) => {
    PageAssignments.openGrader('sci8', aid, ids[8], { studentIds: [ids[8], ids[0]] });
  }, info);
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog.locator('.grader-student')).toHaveText('Group 3');
  await expect(dialog.locator('[data-grader="prev"]')).toBeDisabled();
  await dialog.locator('[data-grader="next"]').click();
  await expect(dialog.locator('.grader-student')).toHaveText('Group 1');
  await expect(dialog.locator('[data-grader="next"]')).toBeDisabled();
});

// The footer's grade is the group's, and a member graded separately keeps
// her own beside her name, after the group's grade changes.
test("a member graded separately keeps her own grade; the footer shows the group's", async ({ page }) => {
  const info = await setUp(page);
  await openCell(page, info, info.ids[0]);
  const dialog = page.locator('#grader-overlay .grader-dialog');
  const foot = dialog.locator('.grader-foot .grader-grade');
  await dialog.locator('.grdt-tile[data-action="graderLevel"][data-level="3"]').first().click();
  const noor = dialog.locator('.grader-member').nth(1);
  await noor.locator('.grader-member-more').click();
  await noor.getByRole('menuitem', { name: 'Grade Separately' }).click();
  const hers = await noor.locator('.grader-member-separate .grader-grade').textContent();
  await expect(foot).toHaveText(hers);
  await dialog.locator('.grdt-tile[data-action="graderLevel"][data-level="1"]').first().click();
  await expect(noor.locator('.grader-member-separate .grader-grade')).toHaveText(hers);
  await expect(foot).not.toHaveText(hers);
  await expect(foot).toHaveText(/^Emerging/);
});
