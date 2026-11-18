/**
 * The Inbox's All Caught Up and a file drop on the tile (D5 of
 * docs/plans/dashboard-inbox-plan.md; boards E1 and E1b), behind the dashRow
 * switch. Demo Mode, Science 8, the student page and Send Work on.
 *
 * Drops are made in the page with a DataTransfer (a real drag from Finder
 * cannot be automated). A folder is a DataTransferItem whose
 * webkitGetAsEntry gives a made-up directory entry, as the tray's own unit
 * test does it. The files go into Add Work for the Class's tray by the same
 * call as a drop on that page; nothing is saved until Add Work is pressed.
 */
import { test, expect } from '@playwright/test';

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

async function open(page, { flag = true, bulletins = false, caughtUp = false } = {}) {
  await page.addInitScript(
    ([flag, bulletins]) => {
      try {
        if (flag) localStorage.setItem('fv-build-dashRow', '1');
        if (bulletins) {
          localStorage.setItem('fv-build-bulletins', '1');
          window.DashBulletins = {
            html: () =>
              '<section class="dash-bulletins-stub" style="flex:1;background:var(--surface);border-radius:12px"></section>',
          };
        }
      } catch (e) {
        /* storage blocked */
      }
    },
    [flag, bulletins],
  );
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-glance').waitFor();
  await page.evaluate(caughtUp => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    work.course.send_work = true;
    saveDemoStudentWork(cid, work);
    if (caughtUp) {
      // Every piece of work waiting is assessed: nothing is left to grade.
      const ids = getStudents(cid).map(s => s.id);
      getAssessments(cid).forEach(a =>
        GraderWork.workCounts(cid, a.id, ids).ids.tograde.forEach(sid =>
          Grader.setOverallComment(cid, sid, a.id, 'Seen.'),
        ),
      );
    }
    PageDashboard.render();
  }, caughtUp);
  if (flag) await page.locator('#dash-inbox').waitFor();
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

// A drag event at an element, carrying window.__files (or text).
async function drag(page, selector, type, { text = false } = {}) {
  return page.evaluate(
    ({ selector, type, text }) => {
      const dt = new DataTransfer();
      if (text) dt.setData('text/plain', 'Some words');
      else window.__files.forEach(f => dt.items.add(f));
      const ev = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true });
      document.querySelector(selector).dispatchEvent(ev);
      return ev.defaultPrevented;
    },
    { selector, type, text },
  );
}

const coverShown = page =>
  page.evaluate(() => {
    const c = document.querySelector('.dash-inbox-drop-cover');
    if (!c) return 'none';
    const s = getComputedStyle(c);
    return s.display !== 'none' && s.visibility !== 'hidden' && c.getBoundingClientRect().height > 0;
  });

const chips = (page, sid) =>
  page.locator('#add-work-class-overlay .awc-row[data-awc-target="' + sid + '"] .awc-file-name');

test('files dropped on the tile while By Assessment shows open Add Work with each under its student, and nothing saved', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await open(page);
  await expect(page.locator('.dash-inbox-row').first()).toBeVisible();
  // At rest the cover is in the tile and out of sight.
  expect(await coverShown(page)).toBe(false);
  const two = await namedFiles(page, LIGHT);
  expect(two.length).toBe(2);
  const before = await stored(page);

  // Held over the tile: one cover naming the newest piece taking work.
  await drag(page, '.dash-inbox-row', 'dragenter');
  expect(await drag(page, '.dash-inbox-row', 'dragover')).toBe(true);
  expect(await coverShown(page)).toBe(true);
  await expect(page.locator('.dash-inbox-drop-cover-title')).toHaveText('Drop to Add to Light Refraction Lab');
  await expect(page.locator('.dash-inbox-drop-cover-hint')).toHaveText(
    'Photos or PDFs. Files are matched to students by name.',
  );
  // Crossing from one child to another: the cover does not blink.
  await drag(page, '.dash-inbox-drop-cover', 'dragenter');
  await drag(page, '.dash-inbox-row', 'dragleave');
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

test('All Caught Up: the drop area adds to the piece chosen in Add Work For', async ({ page }) => {
  test.setTimeout(60_000);
  await open(page, { caughtUp: true });
  const home = page.locator('#dash-inbox-caught');
  await expect(home).toContainText('All Caught Up');
  await expect(home.locator('.dash-inbox-drop-area')).toContainText('Drop the Scan, a Folder or Files');
  await expect(home.locator('.dash-inbox-drop-area')).toContainText(
    'Photos or PDFs. Files are matched to students by name.',
  );
  await expect(home.locator('.dash-inbox-drop-pick')).toHaveText([
    'Choose Files…',
    'Choose a Folder…',
    'Split a Scan…',
  ]);
  // The list's whole space: no rows under it.
  await expect(page.locator('.dash-inbox-row')).toHaveCount(0);
  // Grey and dashed at rest: Add Work's own drop area.
  const look = await home
    .locator('.dash-inbox-drop-area')
    .evaluate(el => ({ style: getComputedStyle(el).borderTopStyle, awt: el.classList.contains('awt-drop') }));
  expect(look).toEqual({ style: 'dashed', awt: true });
  await expect(home.locator('.dash-inbox-drop-area svg')).toBeVisible();
  // The two quiet lines.
  await expect(home).toContainText(/Light Refraction Lab: \d+ assessed, not returned Return Them →/);
  await expect(home).toContainText(/Next taking work: .+ · \d+ not in yet Work Wall →/);
  // Everything fits in the 510 px tile.
  const fits = await page.evaluate(() => {
    const list = document.getElementById('dash-inbox-list');
    return list.scrollHeight <= list.clientHeight + 1;
  });
  expect(fits).toBe(true);
  expect(await coverShown(page)).toBe(false);
  await shot(page, 'inbox-caught-up-510');

  await page.locator('.dash-inbox-drop-select').selectOption(CELL);
  const two = await namedFiles(page, CELL);
  const before = await stored(page);
  await drag(page, '.dash-inbox-drop-area', 'dragenter');
  await drag(page, '.dash-inbox-drop-area', 'dragover');
  await expect(page.locator('.dash-inbox-drop-cover-title')).toHaveText('Drop to Add to Cell Microscope Lab');
  // Blue while files are held over it.
  await expect(page.locator('.dash-inbox-drop-area')).toHaveClass(/is-over/);
  await drag(page, '.dash-inbox-drop-cover', 'drop');
  const awc = page.locator('#add-work-class-overlay');
  await expect(awc).toContainText('Cell Microscope Lab');
  for (const s of two) await expect(chips(page, s.id)).toHaveText(s.name, { timeout: 20000 });
  expect(await stored(page)).toBe(before);
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
    const dt = {
      types: ['Files'],
      files: [new File([], 'Period 2')],
      items: [{ kind: 'file', webkitGetAsEntry: () => root }],
      dropEffect: 'none',
    };
    const mk = type => {
      const ev = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(ev, 'dataTransfer', { value: dt });
      return ev;
    };
    const row = document.querySelector('.dash-inbox-row');
    row.dispatchEvent(mk('dragenter'));
    row.dispatchEvent(mk('dragover'));
    row.dispatchEvent(mk('drop'));
  });
  for (const s of two) await expect(chips(page, s.id)).toHaveText(s.name, { timeout: 20000 });
  await expect(page.locator('#add-work-class-overlay .awt-item')).toHaveCount(0);
  expect(await stored(page)).toBe(before);
});

test('a drag of plain text shows no cover and does nothing', async ({ page }) => {
  await open(page);
  expect(await drag(page, '.dash-inbox-row', 'dragenter', { text: true })).toBe(false);
  expect(await drag(page, '.dash-inbox-row', 'dragover', { text: true })).toBe(false);
  expect(await coverShown(page)).toBe(false);
  expect(await drag(page, '.dash-inbox-row', 'drop', { text: true })).toBe(false);
  await expect(page.locator('#add-work-class-overlay')).toHaveCount(0);
});

test('a drag that leaves the tile, or ends elsewhere, takes the cover away', async ({ page }) => {
  await open(page);
  await namedFiles(page, LIGHT);
  await drag(page, '.dash-inbox-row', 'dragenter');
  expect(await coverShown(page)).toBe(true);
  await drag(page, '.dash-inbox-drop-cover', 'dragleave');
  expect(await coverShown(page)).toBe(false);
  await drag(page, '.dash-inbox-row', 'dragenter');
  expect(await coverShown(page)).toBe(true);
  await page.evaluate(() => document.dispatchEvent(new Event('dragend', { bubbles: true })));
  expect(await coverShown(page)).toBe(false);
  await drag(page, '.dash-inbox-row', 'dragenter');
  await page.keyboard.press('Escape');
  expect(await coverShown(page)).toBe(false);
});

test('each of the three buttons opens Add Work and its file chooser', async ({ page }) => {
  await open(page, { caughtUp: true });
  const awc = page.locator('#add-work-class-overlay');
  for (const [label, multiple] of [
    ['Choose Files…', true],
    ['Choose a Folder…', true],
    ['Split a Scan…', false],
  ]) {
    const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
    await page.locator('#dash-inbox').getByRole('button', { name: label }).click();
    const c = await chooser;
    expect(c.isMultiple()).toBe(multiple);
    await expect(awc).toContainText('Light Refraction Lab');
    await page.evaluate(() => AddWorkClass.close());
    await expect(awc).toHaveCount(0);
  }
  // With the keyboard alone: Tab to Choose Files… and press Enter.
  await page.locator('.dash-inbox-drop-select').focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.dash-inbox-drop-pick').first()).toBeFocused();
  const chooser = page.waitForEvent('filechooser', { timeout: 5000 });
  await page.keyboard.press('Enter');
  await chooser;
  await expect(awc).toBeVisible();
});

test('beside Bulletins (299 px) All Caught Up fits with no scrolling and its icon hidden', async ({ page }) => {
  await open(page, { bulletins: true, caughtUp: true });
  expect(Math.round(await page.locator('#dash-inbox').evaluate(el => el.getBoundingClientRect().height))).toBe(299);
  const m = await page.evaluate(() => {
    const list = document.getElementById('dash-inbox-list');
    const lb = list.getBoundingClientRect();
    const kids = [...document.querySelectorAll('#dash-inbox-caught > *')].map(el => el.getBoundingClientRect());
    return {
      scrolls: list.scrollHeight > list.clientHeight + 1,
      inside: kids.every(r => r.top >= lb.top - 0.5 && r.bottom <= lb.bottom + 0.5),
      icon: getComputedStyle(document.querySelector('.dash-inbox-drop-area svg')).display,
    };
  });
  expect(m).toEqual({ scrolls: false, inside: true, icon: 'none' });
  await expect(page.locator('#dash-inbox-caught')).toContainText('Next taking work');
  await shot(page, 'inbox-caught-up-299');
});

test('with the switch off there is no Inbox, and a file dropped on the Dashboard is left alone', async ({ page }) => {
  await open(page, { flag: false });
  await expect(page.locator('#dash-inbox')).toHaveCount(0);
  await expect(page.locator('.dash-inbox-drop-cover')).toHaveCount(0);
  await namedFiles(page, LIGHT);
  for (const sel of ['.dash-glance', '#main']) {
    expect(await drag(page, sel, 'dragover')).toBe(false);
    expect(await drag(page, sel, 'drop')).toBe(false);
  }
  await expect(page.locator('#add-work-class-overlay')).toHaveCount(0);
});

test('at 390 px All Caught Up wraps and nothing goes sideways', async ({ page }) => {
  // A phone opens the phone app; Switch to Desktop is how the Dashboard shows at this width.
  await page.addInitScript(() => localStorage.setItem('td-mobile-pref', 'desktop'));
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page, { caughtUp: true });
  await page.locator('#dash-inbox').scrollIntoViewIfNeeded();
  const m = await page.evaluate(() => {
    const tile = document.getElementById('dash-inbox');
    const tb = tile.getBoundingClientRect();
    const list = document.getElementById('dash-inbox-list');
    const all = [...tile.querySelectorAll('#dash-inbox-caught *')].map(el => el.getBoundingClientRect());
    return {
      inside: all.every(r => r.width === 0 || (r.left >= tb.left - 0.5 && r.right <= tb.right + 0.5)),
      sideways: list.scrollWidth - list.clientWidth,
    };
  });
  expect(m).toEqual({ inside: true, sideways: 0 });
  await shot(page, 'inbox-caught-up-390');
});
