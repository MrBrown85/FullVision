import { test, expect } from '@playwright/test';

// S8-F1, the one-week reminder (Colin's ruling 102), in Demo Mode. Science
// 8's sample work has photos (Cell Microscope Lab) and its Keep Photos Until
// is End of Year, June 30, so the day is set to June 25. With the build
// switch and Send Work on, the line is at the top of the Dashboard and of
// Class Settings › Student Page; Change the Date opens Keep Photos Until;
// Dismiss hides it on both. With either off nothing shows. Nothing reaches a server.

const CID = 'sci8';
const LINE =
  "Photos of student work in Science 8 are deleted on June 30. Grades, comments and Mark Up stay. Deleted photos can't come back.";
// Screenshots for Colin, only when NIGHT_SHOTS names a folder.
const SHOTS = process.env.NIGHT_SHOTS || '';

async function openDemo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(cid => getCourseSubmissions(cid).submissions.length === 16, CID, { timeout: 15000 });
}

// The build switch and Send Work on (the sample starts both off).
async function turnOn(page) {
  await page.evaluate(cid => {
    setStudentPageSwitch(cid, true, 'on_return');
    var all = getCourseSubmissions(cid);
    all.course = Object.assign({}, all.course, { send_work: true });
    saveDemoStudentWork(cid, all);
  }, CID);
}

async function dashboard(page) {
  await page.goto('/dashboard');
  await page.waitForSelector('#main .dash-glance', { timeout: 10000 });
  await expect(page.locator('.app-loading')).toHaveCount(0, { timeout: 10000 });
}

test.describe('The photo reminder (Demo Mode)', () => {
  let requests;
  test.beforeEach(async ({ page }) => {
    requests = [];
    page.on('request', req => {
      if (/supabase\.co/.test(req.url())) requests.push(req.url());
    });
    await page.clock.setFixedTime(new Date('2027-06-25T10:00:00'));
    await page.setViewportSize({ width: 1366, height: 900 });
    await openDemo(page);
  });
  test.afterEach(() => {
    expect(requests).toEqual([]);
  });

  test('with the build switch off the Dashboard has no reminder; with photos kept it shows with Send Work off too', async ({
    page,
  }) => {
    await dashboard(page);
    await expect(page.locator('.photo-reminder')).toHaveCount(0);
    // Send Work off, the sample's photos kept: still deleted on June 30 (ruling 108's follow-up).
    await page.evaluate(cid => setStudentPageSwitch(cid, true, 'on_return'), CID);
    expect(await page.evaluate(cid => getCourseSendWork(cid).send_work, CID)).toBe(false);
    await dashboard(page);
    await expect(page.locator('#dash-photo-reminder .photo-reminder-text')).toHaveText(LINE);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/S8-keep-photos-send-work-off-dashboard-1366.png' });
    await page.locator('#dash-photo-reminder').getByRole('button', { name: 'Change the Date' }).click();
    await expect(page.locator('#sp-keep-end_of_year')).toBeFocused();
    await expect(page.locator('#sp-send-switch')).not.toBeChecked();
    if (SHOTS) await page.screenshot({ path: SHOTS + '/S8-keep-photos-send-work-off-class-settings-1366.png' });
  });

  test('a week before June 30 it shows on both screens; Change the Date and Dismiss work', async ({ page }) => {
    await turnOn(page);
    await dashboard(page);
    const line = page.locator('#dash-photo-reminder');
    await expect(line.locator('.photo-reminder-text')).toHaveText(LINE);
    await expect(line.getByRole('button', { name: 'Change the Date' })).toBeVisible();
    await expect(line.getByRole('button', { name: 'Dismiss' })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: SHOTS + '/S8-F1-reminder-dashboard-1366.png' });

    await line.getByRole('button', { name: 'Change the Date' }).click();
    await expect(page.getByRole('tab', { name: /^Student Page/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#sp-keep-end_of_year')).toBeFocused();
    const there = page.locator('#sp-photo-reminder');
    await expect(there.locator('.photo-reminder-text')).toHaveText(LINE);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/S8-F1-reminder-class-settings-1366.png' });

    await there.getByRole('button', { name: 'Dismiss' }).click();
    await expect(page.locator('.photo-reminder')).toHaveCount(0);
    await dashboard(page);
    await expect(page.locator('.photo-reminder')).toHaveCount(0);
  });

  test('on a phone-width window the line and its buttons fit', async ({ page }) => {
    await turnOn(page);
    await page.setViewportSize({ width: 375, height: 812 });
    await dashboard(page);
    const line = page.locator('#dash-photo-reminder');
    await expect(line).toBeVisible();
    const box = await line.boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(375);
    if (SHOTS) await page.screenshot({ path: SHOTS + '/S8-F1-reminder-dashboard-375.png' });
  });
});
