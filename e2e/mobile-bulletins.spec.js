/**
 * Bulletins on the phone (slice B1f, docs/plans/bulletins-plan.md; boards
 * T1 to T4): Demo Mode, Science 8, 390 x 844, with the build flag
 * `bulletins` set on this browser (fv-build-bulletins). Post a Photo takes a
 * made-up picture through the camera's file input (shared/photo-shrink.js
 * makes it smaller in the browser) and it shows first in the feed; nothing
 * is sent. With the flag off the phone has its three tabs as before.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openPhone(page, { flag = true, tab = '' } = {}) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.evaluate(
    ({ flag, tab }) => {
      if (flag) localStorage.setItem('fv-build-bulletins', '1');
      else localStorage.removeItem('fv-build-bulletins');
      if (tab) localStorage.setItem('td-mobile-tab', tab);
    },
    { flag, tab },
  );
  await page.reload();
  await expect(page.locator('#m-tab-bar')).toBeVisible();
}

async function openTab(page) {
  await page.locator('.m-tab-item[data-tab="bulletins"]').click();
  await expect(page.locator('#m-screen-bulletins')).toBeVisible();
}

// A picture of a board, drawn in the page: a real JPEG for the camera's input.
async function boardPhoto(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 1000;
    const g = c.getContext('2d');
    g.fillStyle = '#2f4f3a';
    g.fillRect(0, 0, 1600, 1000);
    g.fillStyle = '#fff';
    g.font = 'bold 90px sans-serif';
    g.fillText('If… then… because…', 80, 200);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  return { name: 'board.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

// What is out of sight at rest: no sheet, no camera screen, no file input showing.
async function atRest(page) {
  return page.evaluate(() => ({
    camera: !!document.getElementById('m-bulletin-camera'),
    sheet: !!document.querySelector('#m-sheet-container .m-sheet'),
    backdrop: getComputedStyle(document.getElementById('m-sheet-backdrop')).display,
    inputs: [...document.querySelectorAll('input[type=file]')].filter(i => getComputedStyle(i).display !== 'none')
      .length,
  }));
}

test('the fourth tab is last; Post a Photo shows the photo, a caption and the faces reminder, then posts it first', async ({
  page,
}) => {
  await openPhone(page);
  const tabs = page.locator('#m-tab-bar .m-tab-item');
  await expect(tabs).toHaveCount(4);
  expect(await tabs.evaluateAll(els => els.map(e => e.getAttribute('data-tab')))).toEqual([
    'students',
    'observe',
    'grade',
    'bulletins',
  ]);
  await expect(tabs.nth(3)).toBeVisible();
  await openTab(page);
  await expect(page.locator('#m-screen-bulletins .m-title-large')).toHaveText('Bulletins');
  await expect(page.locator('.m-bulletin-card').first()).toBeVisible();
  expect(await atRest(page)).toEqual({ camera: false, sheet: false, backdrop: 'none', inputs: 0 });

  await page.locator('[data-m-bulletin="photo"]').click();
  const cam = page.locator('#m-bulletin-camera');
  await expect(cam).toBeVisible();
  await expect(cam.locator('.m-addwork-shutter')).toBeVisible();
  await expect(cam).toContainText('Posts to Science 8: every student’s phone.');
  const input = cam.locator('input[type=file]');
  await expect(input).toHaveAttribute('capture', 'environment');
  await expect(input).toBeHidden();
  await input.setInputFiles(await boardPhoto(page));
  await expect(cam.locator('.m-bulletin-shot-img')).toBeVisible({ timeout: 15000 });
  await expect(cam.locator('#m-bulletin-caption')).toBeVisible();
  await expect(cam).toContainText('Check the photo for students’ faces before you post.');
  await expect(cam.locator('.m-bulletin-retake')).toBeVisible();
  await cam.locator('#m-bulletin-caption').fill('Tonight’s question');
  await cam.locator('[data-m-bulletin-cam="post"]').click();
  await expect(cam).toHaveCount(0);

  const first = page.locator('.m-bulletin-card').first();
  await expect(first.locator('.m-bulletin-kind')).toHaveText('Photo of the Board');
  await expect(first.locator('.m-bulletin-time')).toHaveText('Just Now');
  await expect(first.locator('.m-bulletin-words')).toHaveText('Tonight’s question');
  await expect(first.locator('.m-bulletin-photo img')).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(first.locator('.m-bulletin-seen')).toHaveText('Not Seen Yet');
  expect(await atRest(page)).toEqual({ camera: false, sheet: false, backdrop: 'none', inputs: 0 });
});

test('Write a Bulletin posts a reminder with its last day and its assignment', async ({ page }) => {
  await openPhone(page);
  await openTab(page);
  await page.locator('[data-m-bulletin="write"]').click();
  const sheet = page.locator('#m-bulletin-write');
  await expect(sheet).toBeVisible();
  // Quick Poll and Whiteboard are not offered.
  await expect(sheet.locator('[data-m-bulletin="kind"]')).toHaveText(['Announcement', 'Reminder']);
  await sheet.locator('[data-m-bulletin="kind"][data-kind="reminder"]').click();
  await sheet.locator('#m-bulletin-words').fill('Bring your signed lab safety form on Thursday.');
  const until = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  });
  await sheet.locator('#m-bulletin-until').fill(until);
  const aid = await page.evaluate(() => getAssessments(getActiveCourse())[0].id);
  await sheet.locator('#m-bulletin-linked').selectOption(aid);
  await sheet.locator('#m-bulletin-react').check();
  await sheet.locator('[data-m-bulletin="post"]').click();
  await expect(page.locator('#m-sheet-container .m-sheet')).toHaveCount(0);

  const card = page.locator('.m-bulletin-card', { hasText: 'Bring your signed lab safety form' });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.m-bulletin-kind')).toHaveText(/^Reminder · Until /);
  const kept = await page.evaluate(
    () => getBulletins(getActiveCourse()).filter(b => b.body === 'Bring your signed lab safety form on Thursday.')[0],
  );
  expect(kept).toMatchObject({
    kind: 'reminder',
    pinned: true,
    pinned_until: until,
    assessment_id: aid,
    reactions_on: true,
  });
});

test('who has seen it: the sheet lists the students not seen first, with Show It Again, and Done closes it', async ({
  page,
}) => {
  await openPhone(page);
  await openTab(page);
  const seen = page.locator('.m-bulletin-seen', { hasText: 'Not Seen' }).first();
  const label = await seen.innerText();
  const n = Number(/(\d+) Not Seen/.exec(label)[1]);
  await seen.click();
  const sheet = page.locator('#m-bulletin-seen-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.m-bulletin-sec')).toHaveText('Not Seen Yet · ' + n);
  await expect(sheet.locator('.m-bulletin-names').first().locator('.m-cell')).toHaveCount(n);
  await expect(sheet.locator('[data-m-bulletin="again"]')).toHaveText('Show It Again on These ' + n + ' Phones');
  await expect(sheet.locator('[data-m-bulletin="show-seen"]')).toHaveText(/^Show Who Has Seen It \(\d+\)$/);
  await sheet.locator('[data-m-bulletin="again"]').click();
  await expect(sheet.locator('[data-m-bulletin="again"]')).toBeDisabled();
  await sheet.locator('[data-m-bulletin="close"]').click();
  await expect(page.locator('#m-sheet-container .m-sheet')).toHaveCount(0);
  await expect(page.locator('#m-sheet-backdrop')).toBeHidden();
});

test('nothing scrolls sideways at 320 px: the feed, Post a Photo and Write a Bulletin', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openPhone(page);
  await openTab(page);
  const wide = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await wide()).toBeLessThanOrEqual(320);
  await page.locator('[data-m-bulletin="photo"]').click();
  await page.locator('#m-bulletin-camera input[type=file]').setInputFiles(await boardPhoto(page));
  await expect(page.locator('#m-bulletin-caption')).toBeVisible({ timeout: 15000 });
  expect(await wide()).toBeLessThanOrEqual(320);
  await page.locator('#m-bulletin-camera [data-m-bulletin-cam="close"]').click();
  await page.locator('[data-m-bulletin="write"]').click();
  await page.locator('#m-bulletin-write [data-m-bulletin="kind"][data-kind="reminder"]').click();
  await page.locator('#m-bulletin-write [data-m-bulletin="add-link"]').click();
  expect(await wide()).toBeLessThanOrEqual(320);
});

test('with the flag off: three tabs, no Bulletins anywhere, and a remembered Bulletins opens on Students', async ({
  page,
}) => {
  await openPhone(page, { flag: false, tab: 'bulletins' });
  await expect(page.locator('#m-tab-bar .m-tab-item:visible')).toHaveCount(3);
  const button = page.locator('.m-tab-item[data-tab="bulletins"]');
  await expect(button).toBeHidden();
  expect(await button.evaluate(el => getComputedStyle(el).display)).toBe('none');
  await expect(page.locator('.m-tab-item[data-tab="students"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#m-screen-bulletins')).toHaveCount(0);
  await expect(page.locator('[class*="m-bulletin-"]:not(.m-bulletin-tab), [id^="m-bulletin-"]')).toHaveCount(0);
});
