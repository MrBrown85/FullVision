/**
 * Split a Scan on the phone (Add Work for the Class, B7): Demo Mode,
 * Science 8, Cell Microscope Lab, 375 x 812.
 *
 * A made-up six-page PDF (tests/fixtures/pdf-fixtures.mjs: a black box and
 * "Page n" on each page, so every page's picture differs) goes in two ways:
 * - Choose a File, from the Grade tab's row menu (the iPhone's path: Mail,
 *   Save to Files, then Choose a File);
 * - shared to the installed app (Android): a multipart POST to the share
 *   target, answered by the service worker, which opens the phone app on
 *   the screen with the scan.
 * Each run cuts the scan into pieces of 2, names pieces, adds, and checks
 * which student got which pages (by each page's fingerprint), that no file
 * name was kept, and that the shared scan no longer waits in the worker.
 * A share while signed out keeps nothing and says so.
 */
import { test, expect } from '@playwright/test';
import { pagesPdf } from '../tests/fixtures/pdf-fixtures.mjs';

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

const LAB = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);
const SCAN = { name: 'Block C 2026-11-17 0832.pdf', mimeType: 'application/pdf', buffer: Buffer.from(pagesPdf(6)) };

async function openPhone(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => typeof getAssessments === 'function' && getAssessments('sci8').length > 0);
  // The student page and Send Work on, so the Lab takes work.
  await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
  });
  await page.reload();
  await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
}

// Two students of the Lab: one with nothing in, one who already sent work.
async function twoStudents(page) {
  return page.evaluate(LAB => {
    const cid = getActiveCourse();
    const a = getAssessments(cid).find(x => x.id === LAB);
    const list = AddWorkClass.students(cid, a);
    const name = st => AddWorkSplitModel.full(st);
    const none = list.find(st => !getStudentSubmission(cid, st.id, LAB));
    const some = list.find(st => {
      const sub = getStudentSubmission(cid, st.id, LAB);
      return sub && !sub.on_paper && (sub.files || []).length;
    });
    const one = name(some).slice(0, 1);
    return {
      none: { id: none.id, name: name(none) },
      some: {
        id: some.id,
        name: name(some),
        had: getStudentSubmission(cid, some.id, LAB).files.map(f => f.sha256),
        letter: one,
        fits: AddWorkSplitModel.matches(list, one, {}).length,
      },
    };
  }, LAB);
}

const scanHashes = page =>
  page.evaluate(() =>
    MSplitScan._state()
      .m.pages()
      .map(p => p.page.hash),
  );

const filed = (page, sid) =>
  page.evaluate(
    ({ sid, LAB }) => (getStudentSubmission(getActiveCourse(), sid, LAB) || { files: [] }).files.map(f => f.sha256),
    { sid, LAB },
  );

// Name two pieces, check them, add them, and check who got which pages.
async function splitNameAndAdd(page, who) {
  const ss = page.locator('#m-splitscan');
  await expect(ss.locator('.m-ss-card')).toHaveCount(6, { timeout: 20000 });
  await expect(ss.locator('.m-ss-line')).toHaveText('6 pages make 6 pieces of 1.');
  await ss.getByRole('button', { name: 'One more page per student' }).click();
  await expect(ss.locator('.m-ss-card')).toHaveCount(3);
  await expect(ss.locator('.m-ss-line')).toHaveText('6 pages make 3 pieces of 2.');
  await expect(ss.locator('.m-ss-range')).toHaveText([
    'Piece 1 · Pages 1–2',
    'Piece 2 · Pages 3–4',
    'Piece 3 · Pages 5–6',
  ]);
  await expect(ss).not.toContainText('Block C');
  const hashes = await scanHashes(page);
  expect(new Set(hashes).size).toBe(6);

  // Piece 1: almost the whole name and Return. One student fits: taken.
  const first = ss.locator('#m-ss-name-0');
  await first.fill(who.none.name.slice(0, -1));
  await first.press('Enter');
  await expect(first).toHaveValue(who.none.name);
  await expect(ss.locator('#m-ss-name-1')).toBeFocused();

  // Piece 3: Return in an empty box takes no one.
  const third = ss.locator('#m-ss-name-2');
  await third.focus();
  await third.press('Enter');
  await expect(ss.locator('.m-ss-card').nth(2)).not.toHaveClass(/is-named/);

  // Piece 2: one letter. Several students fit, so Return takes no one; a tap does.
  const second = ss.locator('#m-ss-name-1');
  await second.fill(who.some.letter);
  if (who.some.fits > 1) {
    await second.press('Enter');
    await expect(ss.locator('.m-ss-card').nth(1)).not.toHaveClass(/is-named/);
  }
  await ss.locator('#m-ss-fits-1 .m-ss-fit', { hasText: who.some.name }).click();
  await expect(second).toHaveValue(who.some.name);
  await expect(ss.locator('.m-ss-card').nth(1).locator('.m-ss-card-note')).toHaveText('Already has work in');
  await expect(ss.locator('.m-ss-tally')).toContainText('2 named');
  await shot(page, 'B7-phone-split-named');

  await ss.getByRole('button', { name: 'Check the 2 Pieces' }).click();
  await expect(ss.locator('.m-ss-row')).toHaveCount(2);
  const someRow = ss.locator('.m-ss-row[data-sid="' + who.some.id + '"]');
  await expect(someRow.locator('.m-ss-choice')).toHaveText(['Add as More Pages', 'Replace Them', 'Skip']);
  await expect(someRow.locator('.m-ss-choice.is-on')).toHaveText('Add as More Pages');
  await expect(ss.locator('.m-ss-row[data-sid="' + who.none.id + '"] .m-ss-choice')).toHaveCount(0);
  await expect(ss.locator('.m-ss-hint')).toContainText(['1 piece has no name yet. They stay on the scan.']);
  await shot(page, 'B7-phone-split-check');

  await ss.getByRole('button', { name: 'Add Work for 2 Students' }).click();
  await expect(ss.locator('.m-ss-done')).toHaveText('Work added for 2 students.');

  // Who got which pages: pages 1–2 to the student with nothing in; pages
  // 3–4 after the other student's own; pages 5–6 to no one.
  expect(await filed(page, who.none.id)).toEqual(hashes.slice(0, 2));
  expect(await filed(page, who.some.id)).toEqual(who.some.had.concat(hashes.slice(2, 4)));
  const queued = await page.evaluate(async () => {
    await PhotoQueue.ready();
    return JSON.stringify(PhotoQueue.pages());
  });
  expect(queued).not.toContain('Block C');
  expect(queued).not.toContain('.pdf');

  // The unnamed piece stays on the scan; leaving asks first.
  await ss.getByRole('button', { name: 'Back to the Pieces' }).click();
  await expect(ss.locator('.m-ss-card')).toHaveCount(1);
  await expect(ss.locator('.m-ss-range')).toHaveText('Piece 1 · Pages 5–6');
  await ss.locator('.m-ss-cancel').click();
  await expect(ss.locator('.m-ss-ask-title')).toHaveText('Leave without using this scan?');
  await expect(ss.locator('.m-ss-ask-text')).toHaveText('1 piece is waiting.');
  await ss.getByRole('button', { name: 'Leave', exact: true }).click();
  await expect(ss).toHaveCount(0);
}

// The service worker in charge of this page (the share target needs it).
async function withWorker(page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
}

// What Android's share sheet sends: a multipart POST of the file to the share target.
async function share(page) {
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.id = 'fake-share';
    form.method = 'POST';
    form.enctype = 'multipart/form-data';
    form.action = '/teacher-mobile/share-scan';
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'scan';
    form.appendChild(input);
    document.body.appendChild(form);
  });
  await page.locator('#fake-share input').setInputFiles(SCAN);
  await page.evaluate(() => document.getElementById('fake-share').submit());
}

test('Choose a File: a six-page scan is split, two pieces named and added to the right students', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openPhone(page);
  const who = await twoStudents(page);

  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('.m-seg-btn[data-val="all"]').click();
  await page.locator('#m-grade-list .m-tg-more[data-aid="' + LAB + '"]').click();
  await page.getByRole('button', { name: /Split a Scan/ }).click();
  const ss = page.locator('#m-splitscan');
  await expect(ss.locator('.m-ss-title')).toHaveText('Split the Scan');
  await expect(ss.locator('[data-ss="piece"][aria-pressed="true"]')).toHaveAttribute('data-aid', LAB);
  await expect(ss.locator('.m-ss-foot .m-ss-hint')).toHaveText(
    'On an iPhone, open the scan in Mail, choose Save to Files, then choose it here.',
  );
  await shot(page, 'B7-phone-split-pick');
  await ss.locator('.m-ss-input').setInputFiles(SCAN);
  await splitNameAndAdd(page, who);
  expect(errors).toEqual([]);
});

test('A scan shared to the app opens Split the Scan with it, and nothing waits afterwards', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openPhone(page);
  await withWorker(page);
  const who = await twoStudents(page);
  const first = await page.evaluate(() => MSplitScanModel.assessments(getActiveCourse())[0].a.id);

  await share(page);
  await page.waitForURL(/\/teacher-mobile\/$/);
  const ss = page.locator('#m-splitscan');
  await expect(ss.locator('.m-ss-foot .m-ss-hint')).toHaveText('The shared scan is ready.');
  // The assessment with the most students Not In is picked first.
  await expect(ss.locator('[data-ss="piece"][aria-pressed="true"]')).toHaveAttribute('data-aid', first);
  // Taken: the worker holds it no longer.
  expect(await page.evaluate(() => MSharedScan.held())).toBe(false);
  await ss.locator('[data-ss="piece"][data-aid="' + LAB + '"]').click();
  await ss.getByRole('button', { name: 'Split the Scan' }).click();
  await splitNameAndAdd(page, who);
  expect(await page.evaluate(() => MSharedScan.held())).toBe(false);
  expect(errors).toEqual([]);
});

test('A scan shared while signed out is not kept', async ({ page }) => {
  await page.goto('/login.html');
  await withWorker(page);
  await share(page);
  await page.waitForURL(/\/teacher-mobile\//);
  await expect(page.locator('#m-auth-error')).toHaveText('Sign in, then share the scan again.');
  await expect(page.locator('#m-splitscan')).toHaveCount(0);
  expect(await page.evaluate(() => MSharedScan.held())).toBe(false);
});

test('While another class loads, Start, an assessment and a file do nothing', async ({ page }) => {
  await openPhone(page);
  // Two classes in the picker, and a class load that waits until told.
  await page.evaluate(() => {
    const cid = getActiveCourse();
    window.getPickerCourses = () => [
      { id: cid, name: 'Science 8' },
      { id: 'other', name: 'Other Class' },
    ];
    window.switchActiveCourse = () => new Promise(r => (window.__finishSwitch = r));
    window.__scan = new File(['%PDF-1.4'], 'scan.pdf', { type: 'application/pdf' });
    MSplitScan.open(cid, 'sci8a1', { file: window.__scan });
  });
  const ss = page.locator('#m-splitscan');
  const start = ss.getByRole('button', { name: 'Split the Scan' });
  await expect(start).toBeEnabled();
  await ss.locator('[data-ss="class"][data-cid="other"]').click();
  await expect(start).toBeDisabled();
  const during = await page.evaluate(() => {
    // Pressed anyway (a tap that lands as the button turns off), another
    // assessment chosen, and a file chosen: none begins reading.
    const btn = document.querySelector('#m-splitscan [data-ss="start"]');
    btn.removeAttribute('disabled');
    btn.click();
    const other = [...document.querySelectorAll('#m-splitscan [data-ss="piece"]')].find(
      b => b.getAttribute('aria-pressed') !== 'true',
    );
    if (other) other.click();
    const chose = MSplitScan.choose(window.__scan);
    const s = MSplitScan._state();
    return { phase: s.phase, aid: s.aid, chose };
  });
  expect(during).toEqual({ phase: 'pick', aid: 'sci8a1', chose: false });
  // The load is overtaken by another: the screen answers again, on its own class.
  await page.evaluate(() => window.__finishSwitch(false));
  await expect(start).toBeEnabled();
  expect(await page.evaluate(() => MSplitScan._state().phase)).toBe('pick');
  await page.evaluate(() => MSplitScan.close());
});
