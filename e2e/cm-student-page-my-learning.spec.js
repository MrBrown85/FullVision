import { test, expect } from '@playwright/test';

// S13-F1: Class Settings › Student Page has Show My Learning and See What
// They'd See, in Demo Mode, behind the build switch. Off, the My Learning
// tab in Preview as Student shows nothing of a grade; See What They'd See
// shows My Learning as it would be, and saves nothing; on, Preview shows My
// Learning, and a reload keeps it on. SHOTS=dir saves a picture of each.

const SHOTS = process.env.SHOTS || '';
async function shot(page, name) {
  if (!SHOTS) return;
  await expect(page.locator('#app-loading')).toHaveCount(0, { timeout: 15000 });
  await page.screenshot({ path: SHOTS + '/' + name + '.png' });
}

test('Show My Learning: off shows no grade, See What They’d See, on, and a reload keeps it', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(
    () => {
      var cid = typeof getActiveCourse === 'function' && getActiveCourse();
      return !!cid && getStudents(cid).length > 0 && getAllTags(cid).length > 0;
    },
    null,
    { timeout: 15000 },
  );
  const at = await page.evaluate(() => {
    var cid = getActiveCourse();
    setStudentPageSwitch(cid, true);
    var st = sortStudents(getStudents(cid), 'lastName')[0];
    return { cid: cid, name: displayNameWithLast(st) };
  });
  await page.goto('/dashboard?manage=student-page');
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveAttribute('aria-selected', 'true');

  const row = page.locator('.sp-card .sp-learning');
  const sw = row.getByRole('switch', { name: 'Show My Learning' });
  await expect(sw).not.toBeChecked();
  await expect(row.locator('#sp-learning-hint')).toHaveText(
    'Students see their skills, their grade and how it changes over the term.',
  );
  await expect(row.locator('#sp-learning-would')).toContainText("only from work you've returned.");
  await expect(row.locator('#sp-learning-device')).toHaveText(
    "Students' own phones and Chromebooks can't show My Learning yet, even with this on. For now only Preview as Student shows it.",
  );
  await row.scrollIntoViewIfNeeded();
  await shot(page, 'S13-F1-class-settings-off-1366');

  // Off: Open Preview's My Learning tab says so, with no grade.
  await page.getByRole('button', { name: 'Open Preview' }).click();
  let dialog = page.getByRole('dialog', { name: 'Previewing as ' + at.name });
  await expect(dialog).toBeVisible();
  let screen = dialog.locator('.ps-screen');
  await screen.locator('.sp-tabs-bottom').getByRole('button', { name: 'My Learning' }).click();
  await expect(screen.getByText('Your teacher hasn’t turned on My Learning for this class.')).toBeVisible();
  await expect(screen.locator('.sp-ml')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Back to Class Settings' }).click();
  await expect(dialog).toHaveCount(0);

  // See What They'd See: My Learning as it would be, on its tab; nothing saved.
  const see = row.getByRole('button', { name: "See What They'd See" });
  await see.click();
  dialog = page.getByRole('dialog', { name: 'Previewing as ' + at.name });
  await expect(dialog).toBeVisible();
  screen = dialog.locator('.ps-screen');
  await expect(screen.locator('.sp-ml')).toBeVisible();
  await expect(screen.locator('.sp-ml-title')).toHaveText('My Learning');
  await shot(page, 'S13-F1-see-what-theyd-see-1366');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(see).toBeFocused();
  expect(await page.evaluate(cid => StudentView.learningOn(cid), at.cid)).toBe(false);
  await expect(sw).not.toBeChecked();

  // On: kept in the class's settings, and Preview shows My Learning.
  await sw.click();
  await expect(sw).toBeChecked();
  expect(await page.evaluate(cid => getCourseConfig(cid).show_my_learning, at.cid)).toBe(true);
  await shot(page, 'S13-F1-class-settings-on-1366');

  // A reload keeps it on, on the same tab.
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('switch', { name: 'Show My Learning' })).toBeChecked();
  expect(await page.evaluate(cid => StudentView.learningOn(cid), at.cid)).toBe(true);
  await page.getByRole('button', { name: 'Open Preview' }).click();
  dialog = page.getByRole('dialog', { name: 'Previewing as ' + at.name });
  screen = dialog.locator('.ps-screen');
  await screen.locator('.sp-tabs-bottom').getByRole('button', { name: 'My Learning' }).click();
  await expect(screen.locator('.sp-ml')).toBeVisible();
  await dialog.getByRole('button', { name: 'Back to Class Settings' }).click();

  // Off again: the tab is off once more.
  await page.getByRole('switch', { name: 'Show My Learning' }).click();
  await expect(page.getByRole('switch', { name: 'Show My Learning' })).not.toBeChecked();
  expect(await page.evaluate(cid => StudentView.learningOn(cid), at.cid)).toBe(false);
  expect(errors).toEqual([]);
});
