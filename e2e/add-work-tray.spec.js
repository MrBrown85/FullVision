/**
 * Add Work for the Class, B3 (docs/plans/add-work-for-class-plan.md): files
 * matched by name, and the Waiting tray. Demo Mode, Science 8, Cell
 * Microscope Lab (shared/seed-data.js), at 1366 x 900.
 *
 * Six real photos chosen at once through the tray's Choose Files…, five
 * named for students in different ways and one that matches nobody. The
 * five land on their students; the sixth waits, and is placed from the tray
 * with Choose a Student. Add Work; then each student holds exactly the page
 * that was named for them, checked by its fingerprint.
 */
import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.use({ viewport: { width: 1366, height: 900 } });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const SAMPLES = path.resolve(__dirname, '../assets/sample-work');
const PHOTOS = [
  'cell-lab-cece-1.jpg',
  'cell-lab-fatima-1.jpg',
  'cell-lab-jas-1.jpg',
  'cell-lab-liam-1.jpg',
  'cell-lab-mateo-1.jpg',
  'cell-lab-noor-1.jpg',
].map(f => fs.readFileSync(path.join(SAMPLES, f)));
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

test('a pile of named files lands on its students; the one that matches nobody is placed from the tray', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  // Send Work on, and six students with nothing in, named as a teacher might.
  const six = await page.evaluate(LAB => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    const a = getAssessments(cid).find(x => x.id === LAB);
    return AddWorkClass.students(cid, a)
      .filter(st => !getStudentSubmission(cid, st.id, LAB))
      .slice(0, 6)
      .map(st => ({ id: st.id, first: displayNameFirst(st), last: st.lastName, full: displayNameWithLast(st) }));
  }, LAB);
  expect(six.length).toBe(6);
  const named = [
    s => s.first + ' ' + s.last + '.jpg',
    s => s.last.toLowerCase() + '_' + s.first.toLowerCase() + '.jpg',
    s => s.last + ', ' + s.first + '.jpg',
    s => 'Scan ' + s.first.toUpperCase() + ' ' + s.last.toUpperCase() + ' 1.jpg',
    s => s.first + '-' + s.last + ' final.jpg',
  ];
  const files = six.slice(0, 5).map((s, i) => ({ name: named[i](s), mimeType: 'image/jpeg', buffer: PHOTOS[i] }));
  files.push({ name: 'SCAN0017.jpg', mimeType: 'image/jpeg', buffer: PHOTOS[5] });

  await page.goto('/assignments');
  await page.waitForSelector('#dock-mount nav');
  const card = page.locator('#ac-' + LAB);
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await card.locator('.assess-more-btn').click();
  await card.locator('.assess-add-class-btn').click();

  const awc = page.locator('#add-work-class-overlay');
  const tray = awc.locator('.awt-tray');
  await expect(tray.locator('.awt-drop-title')).toHaveText('Drop the Scan, a Folder or Files');
  // Choose Files… opens the tray's chooser.
  const chooser = page.waitForEvent('filechooser');
  await tray.getByRole('button', { name: 'Choose Files…' }).click();
  await (await chooser).setFiles(files);

  const row = sid => awc.locator('.awc-row[data-awc-target="' + sid + '"]');
  for (let i = 0; i < 5; i++) {
    await expect(row(six[i].id).locator('.awc-file-name')).toHaveText(files[i].name, { timeout: 20000 });
  }
  await expect(awc.locator('.awc-primary')).toHaveText('Add Work for 5 Students');
  const waiting = tray.locator('.awt-item');
  await expect(waiting).toHaveCount(1);
  await expect(waiting.locator('.awt-file-name')).toHaveText('SCAN0017.jpg');
  await expect(waiting.locator('.awt-why')).toHaveText('No name in the file name.');
  await expect(awc.locator('.awc-count')).toContainText('5 ready to add · 1 file waiting');
  await expect(row(six[5].id).locator('.awc-chip')).toHaveCount(0);
  await shot(page, 'add-work-tray-waiting');

  // Choose a Student, type part of the name, Return.
  await waiting.getByRole('button', { name: 'Choose a Student' }).click();
  const find = waiting.locator('.awt-find');
  await expect(find).toBeFocused();
  await find.fill(six[5].full.slice(0, 4));
  await expect(waiting.locator('.awt-option').first()).toHaveText(six[5].full);
  await find.press('Enter');
  await expect(tray.locator('.awt-item')).toHaveCount(0);
  await expect(row(six[5].id).locator('.awc-file-name')).toHaveText('SCAN0017.jpg');
  await expect(awc.locator('.awc-primary')).toHaveText('Add Work for 6 Students');

  // The fingerprint each photo will have once shrunk, worked out the same way.
  const expected = await page.evaluate(
    async buffers => {
      const out = [];
      for (const b of buffers) {
        const f = new File([new Uint8Array(b)], 'x.jpg', { type: 'image/jpeg' });
        const got = await AddWorkFiles.prepare([f]);
        out.push(got.pages[0].hash);
      }
      return out;
    },
    PHOTOS.map(b => [...b]),
  );

  await awc.locator('.awc-primary').click();
  await expect(awc.locator('.awc-done-title')).toHaveText('Added Work for 6 Students', { timeout: 20000 });
  await shot(page, 'add-work-tray-done');

  const kept = await page.evaluate(
    ({ ids, LAB }) =>
      ids.map(sid => {
        const sub = getStudentSubmission(getActiveCourse(), sid, LAB);
        return { n: sub ? sub.files.length : 0, hash: sub && sub.files[0] && sub.files[0].sha256 };
      }),
    { ids: six.map(s => s.id), LAB },
  );
  expect(kept.map(k => k.n)).toEqual([1, 1, 1, 1, 1, 1]);
  expect(new Set(expected).size).toBe(6);
  expect(kept.map(k => k.hash)).toEqual(expected);
  expect(errors).toEqual([]);
});
