import { test, expect } from '@playwright/test';

// B4, Sticker Sheets for Scanning, in Demo Mode: opened from Class Settings ›
// Student Page beside the student cards. A sheet holds 80 stickers; a
// sticker's QR picture reads back, through the app's own reader
// (ScanLabelRead, jsQR), as that student's code; New Code asks first, makes a
// new code, and the old one is listed as retired.

// Set SCAN_LABELS_SHOTS to a folder to save a picture of the screen.
const SHOTS = process.env.SCAN_LABELS_SHOTS || '';

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(
    () => {
      var cid = typeof getActiveCourse === 'function' && getActiveCourse();
      return !!cid && getStudents(cid).length > 0;
    },
    null,
    { timeout: 15000 },
  );
  return page.evaluate(() => {
    var cid = getActiveCourse();
    var students = sortStudents(getStudents(cid), 'lastName');
    return {
      cid,
      count: students.length,
      first: { id: students[0].id, first: (students[0].preferred || students[0].firstName || '').trim() },
    };
  });
}

// The first sticker's QR on the screen, drawn as a picture and read by ScanLabelRead.
async function readFirstSticker(page) {
  return page.evaluate(async () => {
    var svg = document.querySelector('.sl-paper .sl-cell .sl-qr');
    var text = new XMLSerializer().serializeToString(svg);
    if (!/xmlns=/.test(text)) text = text.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
    var img = new Image();
    await new Promise((ok, no) => {
      img.onload = ok;
      img.onerror = no;
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(text);
    });
    // About the size it is on a scanned page (0.44 inch at 182 dots per inch), on white.
    var c = document.createElement('canvas');
    c.width = c.height = 200;
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 200, 200);
    ctx.drawImage(img, 60, 60, 80, 80);
    var px = ctx.getImageData(0, 0, 200, 200);
    return ScanLabelRead.read({ width: 200, height: 200, data: px.data });
  });
}

test('Sticker Sheets: 80 stickers, a sticker reads back as the student, and New Code retires the old one', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const at = await demo(page);
  await page.evaluate(cid => setStudentPageSwitch(cid, true), at.cid);
  await page.goto('/dashboard?manage=student-page');

  await page.locator('.sc-card').getByRole('button', { name: 'Print Sticker Sheets' }).click();
  const screen = page.getByRole('dialog', { name: 'Sticker Sheets for Scanning' });
  await expect(screen).toBeVisible();
  await expect(screen.getByRole('button', { name: 'Print ' + at.count + ' Sheets' })).toBeEnabled();
  await expect(screen.locator('.sl-nav-words')).toContainText('Sheet 1 of ' + at.count);
  await expect(screen).toContainText('It is not the student’s card code and can’t be used to sign in.');

  // One student's sheet: 80 stickers, each with the student's first name.
  await expect(screen.locator('.sl-paper .sl-cell')).toHaveCount(80);
  await expect(screen.locator('.sl-paper .sl-name').first()).toContainText(at.first.first);

  if (SHOTS) await screen.screenshot({ path: SHOTS + '/scan-labels-screen.png' });

  // jsQR is fetched only now, when a sticker is read.
  expect(await page.evaluate(() => ScanLabelRead.loaded())).toBe(false);
  const listed = await page.evaluate(cid => listScanLabels(cid), at.cid);
  const live = listed.data.labels.find(l => l.enrollment_id === at.first.id && !l.retired);
  expect(live.code).toMatch(/^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/);
  expect(await readFirstSticker(page)).toEqual({ code: live.code, upsideDown: false, turn: 0 });

  // Printing: one sheet per student, 80 stickers each.
  await page.evaluate(() => {
    window.__sheets = null;
    window.print = () => {
      var root = document.getElementById('scan-labels-root');
      window.__sheets = Array.from(root.querySelectorAll('.sl-sheet')).map(s => s.querySelectorAll('.sl-cell').length);
    };
  });
  await screen.getByRole('button', { name: 'Print ' + at.count + ' Sheets' }).click();
  await page.waitForFunction(() => !!window.__sheets);
  expect(await page.evaluate(() => window.__sheets)).toEqual(Array(at.count).fill(80));

  // Lost a sheet: New Code asks first, then the new sheet shows.
  await screen.getByRole('button', { name: 'New Code for ' + at.first.first }).click();
  const ask = page.getByRole('dialog', { name: 'New Code for ' + at.first.first + '?' });
  await expect(ask).toContainText('old stickers stop working');
  await ask.getByRole('button', { name: 'Make New Code' }).click();
  await expect(screen).toContainText(at.first.first + ' has a new code.');
  await expect(screen.getByRole('button', { name: 'Print ' + at.first.first + '’s Sheet' })).toBeVisible();

  const after = await page.evaluate(cid => listScanLabels(cid), at.cid);
  const mine = after.data.labels.filter(l => l.enrollment_id === at.first.id);
  expect(mine).toContainEqual({ enrollment_id: at.first.id, code: live.code, retired: true });
  const fresh = mine.find(l => !l.retired);
  expect(fresh.code).not.toBe(live.code);
  expect(await readFirstSticker(page)).toEqual({ code: fresh.code, upsideDown: false, turn: 0 });

  // Escape closes the screen.
  await page.keyboard.press('Escape');
  await expect(screen).toHaveCount(0);
  expect(errors).toEqual([]);
});
