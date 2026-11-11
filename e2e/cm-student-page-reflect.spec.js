import { test, expect } from '@playwright/test';

// S10 follow-up: Class Settings › Student Page has the Reflect on Feedback
// switch, in Demo Mode, behind the build switch, off at first. Off, the
// Dashboard has no Questions From Students; on, Jordan's question from the
// sample shows there and a student's page offers Reflect on Feedback on
// returned work. Nothing reaches a server. NIGHT_SHOTS=dir saves pictures.

const CID = 'sci8';
const SHOTS = process.env.NIGHT_SHOTS || '';

test('Reflect on Feedback: off at first, on shows the reflection screens, off again hides them', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  const requests = [];
  page.on('request', req => {
    if (/supabase\.co/.test(req.url())) requests.push(req.url());
  });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(cid => getStudents(cid).length > 0, CID, { timeout: 15000 });
  await page.evaluate(cid => setStudentPageSwitch(cid, true, 'on_return'), CID);

  await page.goto('/dashboard?manage=student-page');
  await expect(page.getByRole('tab', { name: 'Student Page' })).toHaveAttribute('aria-selected', 'true');
  const row = page.locator('.sp-card .sp-reflect');
  const sw = row.getByRole('switch', { name: 'Reflect on Feedback' });
  await expect(sw).not.toBeChecked();
  await expect(row.locator('#sp-reflect-hint')).toHaveText(
    'After you return work, students can say if it made sense, ask you a question and make a plan for next time.',
  );
  await expect(page.locator('.sp-card .sp-row-title')).toHaveText([
    'Return Grades',
    'Send Work',
    // Demo Mode's sample has photos, so Keep Photos Until shows with Send Work off (ruling 108's follow-up).
    'Keep Photos Until',
    'Reflect on Feedback',
    'Show My Learning',
  ]);
  expect(await page.evaluate(cid => StudentView.fromCache(cid, 'st1').view.reflectOn, CID)).toBe(false);

  await sw.check();
  await expect(sw).toBeChecked();
  await expect(sw).toBeFocused();
  expect(await page.evaluate(cid => getReflectOnFeedback(cid), CID)).toBe(true);
  expect(await page.evaluate(cid => StudentView.fromCache(cid, 'st1').view.reflectOn, CID)).toBe(true);
  if (SHOTS) {
    await expect(page.locator('#app-loading')).toHaveCount(0, { timeout: 15000 });
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: SHOTS + '/S10-reflect-switch-on-1366.png' });
  }

  // The Dashboard's Questions From Students shows Jordan's question.
  await page.goto('/dashboard');
  await expect(page.locator('#dash-questions')).toContainText('How do I know which cell is which?');

  // Off again: gone.
  await page.goto('/dashboard?manage=student-page');
  await page.locator('.sp-card .sp-reflect').getByRole('switch', { name: 'Reflect on Feedback' }).uncheck();
  await page.goto('/dashboard');
  await page.waitForSelector('#main .dash-glance', { timeout: 10000 });
  await expect(page.locator('#dash-questions')).toHaveCount(0);

  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
});
