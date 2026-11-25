/**
 * A file drop on the Inbox tile while Roll Call shows (D5 of
 * docs/plans/dashboard-inbox-plan.md; boards E1 and E1b). Demo Mode, Science
 * 8, the student page and Send Work on.
 *
 * Drops are made in the page with a DataTransfer (a real drag from Finder
 * cannot be automated). A folder is a DataTransferItem whose
 * webkitGetAsEntry gives a made-up directory entry, as the tray's own unit
 * test does it. The files go into Add Work for the Class's tray by the same
 * call as a drop on that page; nothing is saved until Add Work is pressed.
 */
import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';
import fs from 'fs';
import path from 'path';

test.beforeEach(({ page }) => demoStudentPageOff(page));

const LIGHT = 'sci8a21';
const CELL = 'sci8a1';
const SHOTS = process.env.FV_SHOTS || '';
const shot = async (page, name) => {
  if (!SHOTS) return;
  await page.waitForFunction(() => {
    const el = document.getElementById('app-loading');
    return (
      !el ||
      getComputedStyle(el).display === 'none' ||
      getComputedStyle(el).visibility === 'hidden' ||
      +getComputedStyle(el).opacity === 0
    );
  });
  await page.waitForTimeout(400);
  await page.screenshot({ path: SHOTS + '/' + name + '.png' });
};

test.use({ viewport: { width: 1280, height: 800 } });

/* The tile on Roll Call: in To Grade the targets take a held file (their own spec,
   e2e/dashboard-inbox-empty.spec.js); in Roll Call the cover does. */
async function open(page, { sendWork = true, tile = true } = {}) {
  await page.addInitScript(EXPIRING);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  // With no tile (Bulletins is on since B1g): a signed-in class whose server has not answered list_bulletins, or
  // whose read failed, draws no Bulletins slot (e2e/dashboard-bulletins-late.spec.js); Demo Mode always has one.
  if (!tile)
    await page.evaluate(() => {
      DashBulletins.html = () => '';
      PageDashboard.render();
    });
  await page.evaluate(sendWork => {
    if (!sendWork) return;
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    DashInbox.setView(cid, 'rollcall');
    PageDashboard.render();
  }, sendWork);
  if (sendWork) await page.locator('#dash-inbox .dash-inbox-rollcall').waitFor();
}

// Two students with nothing in for the piece, and a photo named for each, kept on window.__files.
async function namedFiles(page, aid) {
  return page.evaluate(async aid => {
    const cid = getActiveCourse();
    const a = getAssessments(cid).find(x => x.id === aid);
    const two = AddWorkClass.students(cid, a)
      .filter(st => !getStudentSubmission(cid, st.id, aid))
      .slice(0, 2);
    const photos = ['cell-lab-cece-1.jpg', 'cell-lab-jas-1.jpg'];
    window.__files = [];
    for (let i = 0; i < two.length; i++) {
      const blob = await fetch('/assets/sample-work/' + photos[i]).then(r => r.blob());
      window.__files.push(
        new File([blob], displayNameFirst(two[i]) + ' ' + two[i].lastName + '.jpg', { type: 'image/jpeg' }),
      );
    }
    return two.map((st, i) => ({ id: st.id, name: window.__files[i].name }));
  }, aid);
}

// The class's work, as stored: unchanged until Add Work is pressed.
const stored = page => page.evaluate(() => JSON.stringify(getCourseSubmissions(getActiveCourse()).submissions));

/* A drag event at an element, carrying window.__files (or text). As a
   browser hands a drag over, its types, files and items can be read only
   while the event is being handled and read as empty after it: anything
   that reads the drop late finds nothing. */
async function drag(page, selector, type, { text = false } = {}) {
  return page.evaluate(
    ({ selector, type, text }) => {
      const real = new DataTransfer();
      if (text) real.setData('text/plain', 'Some words');
      else window.__files.forEach(f => real.items.add(f));
      const el = document.querySelector(selector);
      // At the middle of the element, as a pointer would be.
      const r = el.getBoundingClientRect();
      const at = { clientX: Math.round(r.left + r.width / 2), clientY: Math.round(r.top + r.height / 2) };
      const ev = new DragEvent(type, Object.assign({ bubbles: true, cancelable: true }, at));
      Object.defineProperty(ev, 'dataTransfer', { value: window.__expiring(real) });
      el.dispatchEvent(ev);
      ev.dataTransfer.end();
      return ev.defaultPrevented;
    },
    { selector, type, text },
  );
}
// The page's helper for drops that expire once handled.
const EXPIRING = () => {
  window.__expiring = real => {
    let live = true;
    let effect = 'none';
    return {
      get types() {
        return live ? real.types : [];
      },
      get files() {
        return live ? real.files : [];
      },
      get items() {
        return live ? real.items : [];
      },
      get dropEffect() {
        return effect;
      },
      set dropEffect(v) {
        effect = v;
      },
      getData: k => (live ? real.getData(k) : ''),
      end() {
        live = false;
      },
    };
  };
};

const coverShown = page =>
  page.evaluate(() => {
    const c = document.querySelector('.dash-inbox-drop-cover');
    if (!c) return 'none';
    const s = getComputedStyle(c);
    return s.display !== 'none' && s.visibility !== 'hidden' && c.getBoundingClientRect().height > 0;
  });

const chips = (page, sid) =>
  page.locator('#add-work-class-overlay .awc-row[data-awc-target="' + sid + '"] .awc-file-name');

test('files dropped on the tile while Roll Call shows open Add Work with each under its student, and nothing saved', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page);
  await expect(page.locator('.dash-inbox-rollcall').first()).toBeVisible();
  // At rest the cover is in the tile and out of sight.
  expect(await coverShown(page)).toBe(false);
  const two = await namedFiles(page, LIGHT);
  expect(two.length).toBe(2);
  const before = await stored(page);

  // Held over the tile: one cover naming the newest piece taking work.
  await drag(page, '.dash-inbox-rollcall', 'dragenter');
  expect(await drag(page, '.dash-inbox-rollcall', 'dragover')).toBe(true);
  expect(await coverShown(page)).toBe(true);
  await expect(page.locator('.dash-inbox-drop-cover-title')).toHaveText('Drop to Add to Light Refraction Lab');
  await expect(page.locator('.dash-inbox-drop-cover-hint')).toHaveText(
    'Photos or PDFs. Files are matched to students by name.',
  );
  // Crossing from one child to another: the cover does not blink.
  await drag(page, '.dash-inbox-drop-cover', 'dragenter');
  await drag(page, '.dash-inbox-rollcall', 'dragleave');
  expect(await coverShown(page)).toBe(true);
  await shot(page, 'inbox-drop-cover');

  expect(await drag(page, '.dash-inbox-drop-cover', 'drop')).toBe(true);
  const awc = page.locator('#add-work-class-overlay');
  await expect(awc).toBeVisible();
  await expect(awc).toContainText('Light Refraction Lab');
  for (const s of two) await expect(chips(page, s.id)).toHaveText(s.name, { timeout: 20000 });
  await expect(awc.locator('.awt-item')).toHaveCount(0);
  // The cover went with the drop.
  expect(await coverShown(page)).toBe(false);
  // Nothing saved: the class's work is as it was.
  expect(await stored(page)).toBe(before);
  await shot(page, 'inbox-drop-add-work');

  // Add Work: each student then holds the one page named for them.
  await expect(awc.locator('.awc-primary')).toHaveText('Add Work for 2 Students');
  await awc.locator('.awc-primary').click();
  await expect(awc.locator('.awc-done-title')).toHaveText('Added Work for 2 Students', { timeout: 30000 });
  const kept = await page.evaluate(
    ({ ids, aid }) => ids.map(sid => (getStudentSubmission(getActiveCourse(), sid, aid) || { files: [] }).files.length),
    { ids: two.map(s => s.id), aid: LIGHT },
  );
  expect(kept).toEqual([1, 1]);
  expect(errors).toEqual([]);
});

test('a dropped folder lands its files', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page);
  const two = await namedFiles(page, LIGHT);
  const before = await stored(page);
  await page.evaluate(() => {
    const fileEntry = f => ({ isFile: true, isDirectory: false, name: f.name, file: ok => ok(f) });
    const dirEntry = (name, children) => {
      let given = false;
      return {
        isFile: false,
        isDirectory: true,
        name,
        createReader: () => ({
          readEntries: ok => {
            ok(given ? [] : children);
            given = true;
          },
        }),
      };
    };
    const root = dirEntry('Period 2', [
      fileEntry(window.__files[0]),
      dirEntry('more', [fileEntry(window.__files[1])]),
      fileEntry(new File(['x'], '.DS_Store')),
    ]);
    // A folder item that, like a browser's, gives its entry only during the event.
    const real = {
      types: ['Files'],
      files: [new File([], 'Period 2')],
      items: [{ kind: 'file', webkitGetAsEntry: () => root }],
      getData: () => '',
    };
    const fire = type => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: window.__expiring(real) });
      document.querySelector('.dash-inbox-rollcall').dispatchEvent(ev);
      ev.dataTransfer.end();
    };
    fire('dragenter');
    fire('dragover');
    fire('drop');
  });
  for (const s of two) await expect(chips(page, s.id)).toHaveText(s.name, { timeout: 20000 });
  await expect(page.locator('#add-work-class-overlay .awt-item')).toHaveCount(0);
  expect(await stored(page)).toBe(before);
});

test('a drag of plain text shows no cover and does nothing', async ({ page }) => {
  await open(page);
  expect(await drag(page, '.dash-inbox-rollcall', 'dragenter', { text: true })).toBe(false);
  expect(await drag(page, '.dash-inbox-rollcall', 'dragover', { text: true })).toBe(false);
  expect(await coverShown(page)).toBe(false);
  expect(await drag(page, '.dash-inbox-rollcall', 'drop', { text: true })).toBe(false);
  await expect(page.locator('#add-work-class-overlay')).toHaveCount(0);
});

test('a drag that leaves the tile, or ends elsewhere, takes the cover away', async ({ page }) => {
  await open(page);
  await namedFiles(page, LIGHT);
  await drag(page, '.dash-inbox-rollcall', 'dragenter');
  expect(await coverShown(page)).toBe(true);
  await drag(page, '.dash-inbox-drop-cover', 'dragleave');
  expect(await coverShown(page)).toBe(false);
  await drag(page, '.dash-inbox-rollcall', 'dragenter');
  expect(await coverShown(page)).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event('dragend', { bubbles: true })));
  expect(await coverShown(page)).toBe(false);
  await drag(page, '.dash-inbox-rollcall', 'dragenter');
  await page.keyboard.press('Escape');
  expect(await coverShown(page)).toBe(false);
});

test('with the Bulletins tile showing a file over it is refused, the cover is as before, and the 30-second tick leaves the cover alone', async ({
  page,
}) => {
  await page.clock.install();
  await open(page);
  await expect(page.locator('.dash-bulletins-tile')).toBeVisible();
  await expect(page.locator('.dash-bulletins-row')).toHaveCount(3);
  await namedFiles(page, LIGHT);
  // Held over the Inbox: the cover shows, as before.
  await drag(page, '.dash-inbox-rollcall', 'dragenter');
  expect(await drag(page, '.dash-inbox-rollcall', 'dragover')).toBe(true);
  expect(await coverShown(page)).toBe(true);
  // Held over the Bulletins tile: a near miss, refused (the browser does not open the file in the app's place).
  expect(await drag(page, '.dash-bulletins-tile', 'dragover')).toBe(true);
  // The tile's 30-second read runs mid-drag: the cover stays and the tile is not drawn out from under it.
  await page.evaluate(() => {
    window.__tileNode = document.querySelector('.dash-bulletins-tile');
    window.__renders = 0;
    const render = PageDashboard.render;
    PageDashboard.render = function () {
      window.__renders++;
      return render.apply(this, arguments);
    };
  });
  await page.clock.fastForward(31000);
  expect(await coverShown(page)).toBe(true);
  expect(await page.evaluate(() => window.__renders)).toBe(0);
  expect(await page.evaluate(() => window.__tileNode === document.querySelector('.dash-bulletins-tile'))).toBe(true);
  // Let go over the tile: refused, nothing opens, and the cover goes with the drag.
  expect(await drag(page, '.dash-bulletins-tile', 'drop')).toBe(true);
  await expect(page.locator('#add-work-class-overlay')).toHaveCount(0);
  expect(await coverShown(page)).toBe(false);
});

test('with Send Work off there is no Inbox, and a file dropped on the Dashboard is left alone', async ({ page }) => {
  await open(page, { sendWork: false });
  await expect(page.locator('#dash-inbox')).toHaveCount(0);
  await expect(page.locator('.dash-inbox-drop-cover')).toHaveCount(0);
  await namedFiles(page, LIGHT);
  for (const sel of ['.dash-glance', '#main']) {
    expect(await drag(page, sel, 'dragover')).toBe(false);
    expect(await drag(page, sel, 'drop')).toBe(false);
  }
  await expect(page.locator('#add-work-class-overlay')).toHaveCount(0);
});

test('a file let go just outside the tile is refused, so the browser does not open it', async ({ page }) => {
  await open(page);
  await namedFiles(page, LIGHT);
  for (const sel of ['.dash-glance', '.dash-row-comp', '.dash-row']) {
    expect(await drag(page, sel, 'dragover')).toBe(true);
    expect(await drag(page, sel, 'drop')).toBe(true);
  }
  // The class list left of the tile, about 13 px from it (D9): a near miss lands there.
  for (const sel of ['#sidebar-mount .student-row', '#sidebar-mount']) {
    expect(await drag(page, sel, 'dragover'), sel).toBe(true);
    expect(await drag(page, sel, 'drop'), sel).toBe(true);
  }
  // The dock across the top is left as it is.
  expect(await drag(page, '#dock-mount', 'dragover')).toBe(false);
  await expect(page.locator('#add-work-class-overlay')).toHaveCount(0);
  // Leaving the Dashboard takes its page listeners with it.
  await page
    .locator('a, button', { hasText: /^Assignments$/ })
    .first()
    .click();
  await page.waitForURL(/\/assignments/);
  expect(await drag(page, '#main', 'dragover')).toBe(false);
});

test('dragenter accepts files at once, so a release in the first instant still drops', async ({ page }) => {
  await open(page);
  const two = await namedFiles(page, LIGHT);
  expect(await drag(page, '.dash-inbox-rollcall', 'dragenter')).toBe(true);
  // Straight to the drop, with no dragover between.
  expect(await drag(page, '.dash-inbox-rollcall', 'drop')).toBe(true);
  for (const s of two) await expect(chips(page, s.id)).toHaveText(s.name, { timeout: 20000 });
});

/* Real drops. Chromium's own drag (Input.dispatchDragEvent over CDP) carries
   files from disk the way a drag from Finder does: the browser's own
   protected DataTransfer, and a file box takes it with no script. */
const SAMPLE_PHOTO = path.resolve(__dirname, '../assets/sample-work/cell-lab-cece-1.jpg');
async function realDrop(page, locator, file) {
  const box = await locator.boundingBox();
  const x = Math.round(box.x + box.width / 2);
  const y = Math.round(box.y + box.height / 2);
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: [file], dragOperationsMask: 1 };
  for (const type of ['dragEnter', 'dragOver', 'drop']) await cdp.send('Input.dispatchDragEvent', { type, x, y, data });
  await cdp.detach();
}

test('a real drop of a photo on the tile opens Add Work with it placed', async ({ page }) => {
  await open(page);
  // A copy named for a student with nothing in for Light Refraction Lab.
  const st = await page.evaluate(() => {
    const cid = getActiveCourse();
    const a = getAssessments(cid).find(x => x.id === 'sci8a21');
    const s = AddWorkClass.students(cid, a).find(x => !getStudentSubmission(cid, x.id, 'sci8a21'));
    return { id: s.id, name: displayNameFirst(s) + ' ' + s.lastName };
  });
  const dir = test.info().outputPath('drop');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, st.name + '.jpg');
  fs.copyFileSync(SAMPLE_PHOTO, file);
  await realDrop(page, page.locator('.dash-inbox-rollcall').first(), file);
  await expect(chips(page, st.id)).toHaveText(st.name + '.jpg', { timeout: 20000 });
  expect(await coverShown(page)).toBe(false);
});

test('a real drop on the top bar is refused: the page stays', async ({ page }) => {
  await open(page);
  const url = page.url();
  await realDrop(page, page.locator('.dash-glance'), SAMPLE_PHOTO);
  await page.waitForTimeout(300);
  expect(page.url()).toBe(url);
  await expect(page.locator('#dash-inbox')).toBeVisible();
});

test('a real drop on the class list beside the tile is refused: the page stays', async ({ page }) => {
  await open(page);
  const url = page.url();
  const list = page.locator('#sidebar-mount');
  await expect(list).toBeVisible();
  await realDrop(page, list, SAMPLE_PHOTO);
  await page.waitForTimeout(300);
  expect(page.url()).toBe(url);
  await expect(page.locator('#dash-inbox')).toBeVisible();
});

test('the grader opened over the Dashboard still takes a photo dropped on its Choose Files', async ({ page }) => {
  await open(page);
  const sid = await page.evaluate(() => {
    const cid = getActiveCourse();
    const a = getAssessments(cid).find(x => x.id === 'sci8a21');
    const s = AddWorkClass.students(cid, a).find(x => !getStudentSubmission(cid, x.id, 'sci8a21'));
    PageAssignments.openGrader(cid, 'sci8a21', s.id, {});
    return s.id;
  });
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog.locator('.grader-addwork')).toBeVisible();
  // The tile is still on the page behind the grader.
  await expect(page.locator('#dash-inbox')).toHaveCount(1);
  await realDrop(page, dialog.locator('.grader-work-files'), SAMPLE_PHOTO);
  await expect(dialog.locator('.grader-work-at')).toHaveText('Page 1 of 1', { timeout: 15000 });
  const n = await page.evaluate(
    sid => (getStudentSubmission(getActiveCourse(), sid, 'sci8a21') || { files: [] }).files.length,
    sid,
  );
  expect(n).toBe(1);
});

// Counts the drag and drop listeners on the document, as added and taken off.
const COUNT_LISTENERS = () => {
  const live = new Set();
  const add = EventTarget.prototype.addEventListener;
  const remove = EventTarget.prototype.removeEventListener;
  const key = (t, type, fn, o) =>
    type + '|' + (typeof o === 'boolean' ? o : !!(o && o.capture)) + '|' + (fn && (fn.__k || (fn.__k = Math.random())));
  EventTarget.prototype.addEventListener = function (type, fn, o) {
    if (this === document && (type === 'dragover' || type === 'drop')) live.add(key(this, type, fn, o));
    return add.call(this, type, fn, o);
  };
  EventTarget.prototype.removeEventListener = function (type, fn, o) {
    if (this === document && (type === 'dragover' || type === 'drop')) live.delete(key(this, type, fn, o));
    return remove.call(this, type, fn, o);
  };
  window.__dragListeners = () => {
    const out = { dragover: 0, drop: 0 };
    live.forEach(k => out[k.split('|')[0]]++);
    return out;
  };
};

async function classSettingsListeners(page, sendWork) {
  await page.addInitScript(COUNT_LISTENERS);
  await open(page, { sendWork });
  await page.getByRole('button', { name: 'Class Settings' }).first().click();
  await page.locator('[data-action="cmRestoreBackup"]').waitFor();
  await page.waitForTimeout(100);
  return page.evaluate(() => window.__dragListeners());
}

test('in Class Settings the drag and drop listeners are the same as after a Dashboard with no Inbox', async ({
  browser,
}) => {
  const on = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const off = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const withTile = await classSettingsListeners(on, true);
  const without = await classSettingsListeners(off, false);
  expect(withTile).toEqual(without);
  await on.close();
  await off.close();
});

test("Restore from Backup's file box still takes a dropped file after a Dashboard with the Inbox", async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Class Settings' }).first().click();
  await page.locator('[data-action="cmRestoreBackup"]').click();
  const box = page.locator('#cm-restore-file');
  await expect(box).toBeVisible();
  const dir = test.info().outputPath('backup');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'class-backup.json');
  fs.writeFileSync(file, '{}');
  await realDrop(page, box, file);
  await expect.poll(() => box.evaluate(el => el.files.length)).toBe(1);
});
