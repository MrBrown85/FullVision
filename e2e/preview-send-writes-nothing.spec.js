/**
 * View as Student shows Send My Work as the student's page does, and writes nothing. Demo Mode,
 * Science 8, 1440 x 900. A piece that takes photos shows Send My Work on its card; it opens the
 * student's Check and Send screen; a photo, a note and Send reach no function and no RPC, change no
 * stored work, and leave the teacher's data as it was. The roster's selected student is the one shown.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

test('Send My Work in the preview: Check and Send, a photo, a note and Send write nothing', async ({ page }) => {
  const asked = [];
  page.on('request', r => {
    if (/functions\/v1\/|\/rest\/v1\/rpc\//.test(r.url())) asked.push(r.url());
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    const cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a21');
  });
  await page.evaluate(() => {
    setCourseSendWork('sci8', { send_work: true });
    saveAssessmentStudentWork('sci8', 'sci8a21', {
      students_send: 'photos',
      after_due: 'keep',
      accept_until: null,
      group_work: 'each',
      students_see_markup: true,
    });
  });
  await page.goto('/assignments');
  const title = await page.evaluate(() => getAssessments(getActiveCourse()).find(a => a.id === 'sci8a21').title);
  const card = page.locator('.assess-card', { hasText: title }).first();
  await card.locator('.assess-bar, .assess-head, h3, .assess-title').first().click();
  const open = page.locator('.assess-card.open').first();
  await open.locator('[data-action="toggleCardMenu"]').first().click();
  await open.locator('.assess-menu:not([hidden]) [data-action="viewAsStudent"]').click();
  const overlay = page.locator('#preview-student');
  await expect(overlay.locator('[data-act="send-open"][data-piece="sci8a21"]')).toBeVisible();
  await shot(page, '1-card-send-my-work');

  const before = await page.evaluate(() => ({
    ls: JSON.stringify(Object.entries(localStorage).sort()),
    work: JSON.stringify(getCourseSubmissions('sci8')),
  }));
  const asked0 = asked.length;

  await overlay.locator('[data-act="send-open"][data-piece="sci8a21"]').click();
  await expect(overlay.locator('#sp-send-title')).toBeVisible();
  await shot(page, '2-check-and-send');
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 900;
    c.height = 700;
    const g = c.getContext('2d');
    for (let i = 0; i < 4000; i++) {
      g.fillStyle = 'hsl(' + ((i * 37) % 360) + ',70%,' + (20 + ((i * 13) % 60)) + '%)';
      g.fillRect((i * 97) % 900, (i * 53) % 700, 30, 30);
    }
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
    const input = document.querySelector('#preview-student .sp-send-input');
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'work.jpg', { type: 'image/jpeg' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(overlay.locator('.sp-send-page, .sp-send-pages img').first()).toBeVisible({ timeout: 10000 });
  await overlay.locator('#sp-send-note').fill('Here is my work.');
  await overlay.locator('[data-act="send-go"]').click();
  await expect(overlay.locator('.sp-send')).toContainText('Nothing is sent', { timeout: 10000 });
  await shot(page, '3-after-send');

  expect(asked).toHaveLength(asked0);
  const after = await page.evaluate(() => ({
    ls: JSON.stringify(Object.entries(localStorage).sort()),
    work: JSON.stringify(getCourseSubmissions('sci8')),
  }));
  expect(after).toEqual(before);

  // Back to the card, still Send My Work: the teacher's copy is as it was.
  await overlay.locator('[data-act="send-done"], [data-act="send-back"]').first().click();
  await expect(overlay.locator('[data-act="send-open"][data-piece="sci8a21"]')).toBeVisible();

  // The Bulletins tab and its presses ask nothing either.
  await overlay.locator('[data-act="tab"][data-tab="bulletins"]:visible').first().click();
  const react = overlay.locator('[data-act="bulletin-react"]').first();
  if (await react.count()) await expect(react).toBeDisabled(); // a reaction cannot be pressed here
  expect(asked).toHaveLength(asked0);
});

test('View as Student opens the student selected in the roster', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    const cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  await page.goto('/assignments');
  const rows = page.locator('#gb-roster-list .student-row');
  const n = await rows.count();
  const row = rows.nth(Math.min(3, n - 1));
  const sid = await row.getAttribute('data-sid');
  await row.click();
  await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveAttribute('data-sid', sid);
  const card = page.locator('.assess-card', { hasText: 'Cell Microscope Lab' }).first();
  await card.locator('.assess-bar, .assess-head, h3, .assess-title').first().click();
  const open = page.locator('.assess-card.open').first();
  await open.locator('[data-action="toggleCardMenu"]').first().click();
  await open.locator('.assess-menu:not([hidden]) [data-action="viewAsStudent"]').click();
  const name = await page.evaluate(id => {
    const s = getStudents(getActiveCourse()).find(x => x.id === id);
    return s.preferred || s.firstName;
  }, sid);
  await expect(page.locator('#preview-student')).toContainText('Previewing as');
  await expect(page.locator('#preview-student #ps-title')).toContainText(name);
});
