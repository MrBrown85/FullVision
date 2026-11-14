import { test, expect } from '@playwright/test';

/* Progress Reports, Everyone view: the Zoom control (teacher/report-one-zoom.js).
   Whole Class is the Fit Map exactly as it was; a percent draws each
   student's block larger, for screen only, because Print Reports prints
   from this view. Demo Mode's Science 8 on the Report Card, Legal paper,
   1,916 x 1,100, All Students picked. */

// Every render lays the whole class out; a GitHub runner is slower than a Mac.
test.setTimeout(150_000);
test.use({ viewport: { width: 1916, height: 1100 } });

/* The Fit Map on origin/main (d60b4b9c), read from a run of main in this
   window: the first student's block and first side, and the scale. Tops
   are left out: they follow the name's font. */
const MAIN = {
  blockWidth: 232,
  sideLeftInBlock: 6,
  sideWidth: 106.08,
  sideHeight: 174.72, // Legal: 14 in at 13%
  transform: 'matrix(0.13, 0, 0, 0.13, 0, 0)',
};

async function openEveryone(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await page.evaluate(() => {
    saveReportConfig('sci8', Object.assign({}, getReportConfig('sci8'), { one: ReportOne.fromSetup('report-card') }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await page.getByRole('radio', { name: 'Legal' }).click();
  await page.locator('.studio-view [data-view="all"]').click();
  await expect(page.locator('#rb-preview.report-fitmap > .sheet-student').first()).toBeVisible({ timeout: 30000 });
  await expect(page.locator('#studio-fit')).toContainText('for the class', { timeout: 30000 });
  return errors;
}

async function pick(page, name) {
  await page.locator('#studio-zoom-btn').click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(page.locator('#studio-zoom-btn')).toHaveAttribute('aria-label', 'Zoom: ' + name);
}

const settle = page =>
  page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));

// Each student's block and sides, in order.
async function blocks(page) {
  await settle(page);
  return page.evaluate(() =>
    [...document.querySelectorAll('#rb-preview > .sheet-student')].map(b => {
      const r = b.getBoundingClientRect();
      return {
        sid: b.dataset.sid,
        box: { left: r.left, top: Math.round(r.top), right: r.right, bottom: r.bottom, width: r.width },
        sides: [...b.querySelectorAll(':scope > .sheet-zoom')].map(z => {
          const s = z.getBoundingClientRect();
          return {
            left: s.left,
            top: Math.round(s.top),
            right: s.right,
            bottom: s.bottom,
            width: s.width,
            height: s.height,
          };
        }),
        transform: getComputedStyle(b.querySelector('.report-sheet')).transform,
      };
    }),
  );
}
const perRow = list => list.filter(b => b.box.top === list[0].box.top).length;

test('Whole Class is the Fit Map as it was on main', async ({ page }) => {
  const errors = await openEveryone(page);
  await expect(page.locator('#studio-zoom')).toBeVisible();
  await expect(page.locator('#studio-zoom-btn')).toHaveText('Whole Class');
  await expect(page.getByRole('button', { name: 'Zoom Out' })).toBeDisabled();
  await expect(page.locator('#rb-preview')).not.toHaveClass(/fit-zoom/);
  const [first] = await blocks(page);
  expect(first.box.width).toBeCloseTo(MAIN.blockWidth, 2);
  expect(first.sides[0].left - first.box.left).toBeCloseTo(MAIN.sideLeftInBlock, 2);
  expect(first.sides[0].width).toBeCloseTo(MAIN.sideWidth, 2);
  expect(first.sides[0].height).toBeCloseTo(MAIN.sideHeight, 2);
  expect(first.transform).toBe(MAIN.transform);
  await expect(page.getByRole('button', { name: 'Next Student' })).toBeHidden();
  expect(errors).toEqual([]);
});

test('50% shows fewer students a row, whole blocks, a sheet’s sides side by side; remembered apart from One Student', async ({
  page,
}) => {
  await openEveryone(page);
  const fit = await page.locator('#studio-fit').textContent();
  const order = (await blocks(page)).map(b => b.sid);
  const whole = perRow(await blocks(page));
  await pick(page, '50%');
  const list = await blocks(page);
  expect(perRow(list)).toBeLessThan(whole);
  expect(list.map(b => b.sid)).toEqual(order);
  for (const b of list) {
    for (const s of b.sides) {
      expect(s.top).toBeGreaterThanOrEqual(b.box.top);
      expect(s.bottom).toBeLessThanOrEqual(b.box.bottom + 0.5);
      expect(s.left).toBeGreaterThanOrEqual(b.box.left - 0.5);
      expect(s.right).toBeLessThanOrEqual(b.box.right + 0.5);
    }
    for (let i = 0; i + 1 < b.sides.length; i += 2) expect(b.sides[i].top).toBe(b.sides[i + 1].top);
  }
  expect(list[0].transform).toBe('matrix(0.5, 0, 0, 0.5, 0, 0)');
  await expect(page.locator('#studio-fit')).toHaveText(fit);

  await page.reload();
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio-zoom-btn')).toHaveText(/./);
  await page.locator('.studio-view [data-view="one"]').click();
  await expect(page.locator('#studio-zoom-btn')).toHaveText('Automatic');
  await page.locator('.studio-view [data-view="all"]').click();
  await expect(page.locator('#studio-zoom-btn')).toHaveText('50%');
  await expect(page.locator('#rb-preview')).toHaveClass(/fit-zoom/);
});

test('a click on a student at 50% opens them, as it does at Whole Class; Hide Panels works here', async ({ page }) => {
  await openEveryone(page);
  await pick(page, '50%');
  await page.getByRole('button', { name: 'Hide Panels' }).click();
  await expect(page.locator('#studio-palette')).toBeHidden();
  await page.getByRole('button', { name: 'Show Panels' }).click();
  await expect(page.locator('#studio-palette')).toBeVisible();
  const second = page.locator('#rb-preview > .sheet-student').nth(1);
  const name = (await second.locator('.sheet-student-name').textContent()).trim();
  await second.locator('.sheet-student-head').click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await expect(page.locator('.studio-view [data-view="one"]')).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#studio-fit')).toContainText('for ' + name.split(' ')[0]);
});

test('what prints is the same at 50% as at Whole Class: the sheets, and the printed copy’s HTML', async ({ page }) => {
  await openEveryone(page);
  const printed = async () => {
    await page.emulateMedia({ media: 'print' });
    await settle(page);
    const out = await page.locator('#rb-preview .report-sheet').evaluateAll(list =>
      list.slice(0, 3).map(el => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        const z = el.closest('.sheet-zoom').getBoundingClientRect();
        return {
          transform: cs.transform,
          box: [r.left, r.top, r.width, r.height],
          wrap: [z.left, z.top, z.width, z.height],
          breakAfter: cs.breakAfter,
          pageBreakAfter: cs.pageBreakAfter,
          outline: cs.outlineWidth,
        };
      }),
    );
    await page.emulateMedia({ media: 'screen' });
    return out;
  };
  const whole = await printed();
  await pick(page, '50%');
  expect(await printed()).toEqual(whole);
  await pick(page, '75%');
  expect(await printed()).toEqual(whole);

  // Print Reports saves a copy, then prints: the copy's HTML is the same at 50%.
  await page.evaluate(() => {
    window.__copies = [];
    window.print = () => {};
    const issue = ReportIssues.issue;
    ReportIssues.issue = function (opts) {
      window.__copies.push(JSON.stringify(opts.students));
      return issue.apply(this, arguments);
    };
  });
  const printOnce = async () => {
    await page.getByRole('button', { name: 'Print Reports' }).click();
    await page.locator('#issue-overlay [data-issue="go"]').click();
    await expect(page.locator('#issue-overlay')).toHaveCount(0);
  };
  await pick(page, 'Whole Class');
  await printOnce();
  await pick(page, '50%');
  await printOnce();
  const copies = await page.evaluate(() => window.__copies);
  expect(copies).toHaveLength(2);
  expect(copies[1]).toBe(copies[0]);
  expect(copies[0]).not.toContain('fit-zoom');
  expect(copies[0]).not.toContain('--fit-zoom');
});

// The first three sheets as they are this instant: no frame is waited for.
const sheetsNow = () =>
  [...document.querySelectorAll('#rb-preview .report-sheet')].slice(0, 3).map(el => {
    const r = el.getBoundingClientRect();
    return { transform: getComputedStyle(el).transform, box: [r.left, r.top, r.width, r.height] };
  });

/* The hard way, as Cmd+P straight after a zoom: 75% picked and the print
   media switched on at once, with no frame between. The app's reduced-motion
   rule gives every property a 0.01 ms transition, and a running transition
   outranks !important, so a sheet used to keep its screen scale until the
   next frame. Print now turns transitions off: the very first read is the
   print state. */
test('print wins at once, with no frame between a zoom and the print media', async ({ page }) => {
  await openEveryone(page);
  await page.emulateMedia({ media: 'print' });
  await settle(page);
  const whole = await page.evaluate(sheetsNow);
  await page.emulateMedia({ media: 'screen' });
  await settle(page);
  expect(whole[0].transform).toBe('none');

  await page.locator('#studio-zoom-btn').click();
  await page.getByRole('menuitemradio', { name: '75%', exact: true }).click();
  await page.emulateMedia({ media: 'print' });
  const first = await page.evaluate(sheetsNow);
  expect(first.map(x => x.transform)).toEqual(['none', 'none', 'none']);
  await settle(page);
  expect(await page.evaluate(sheetsNow)).toEqual(whole);
});

/* The real path: Print Reports at 75%, with window.print replaced by a
   recorder of the first three sheets at the instant it is called, under
   print media switched on just before the print starts (as the browser
   does). The same as at Whole Class. */
test('Print Reports at 75% prints what it prints at Whole Class', async ({ page }) => {
  await openEveryone(page);
  await page.evaluate(src => {
    const read = new Function('return (' + src + ')')();
    window.__atPrint = [];
    window.print = () => window.__atPrint.push(read());
  }, sheetsNow.toString());
  const printReports = async () => {
    await page.getByRole('button', { name: 'Print Reports' }).click();
    await expect(page.locator('#issue-overlay [data-issue="go"]')).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.querySelector('#issue-overlay [data-issue="go"]').click());
    await expect.poll(() => page.evaluate(() => window.__atPrint.length), { timeout: 30000 }).toBeGreaterThan(0);
    const got = await page.evaluate(() => window.__atPrint.splice(0));
    await page.emulateMedia({ media: 'screen' });
    await settle(page);
    return got[0];
  };
  const whole = await printReports();
  expect(whole[0].transform).toBe('none');
  await pick(page, '75%');
  expect(await printReports()).toEqual(whole);
});
