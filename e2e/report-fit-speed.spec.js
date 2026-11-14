import { test, expect } from '@playwright/test';

/* The fit line's count of every student's sheets (speed assessment R1).
   A tick used to lay the whole class out again in one task straight after
   the click (28 layouts for Demo Mode's 27 students). Each student's
   layout is now kept by what it reads: a tick put back, or a change for
   one student, lays out only what changed. Counted, not timed. */

test.setTimeout(120_000);

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  // Every student's layout, counted, with the time of the last one.
  await page.evaluate(() => {
    window.__layouts = 0;
    window.__lastLayout = performance.now();
    const layoutWith = ReportOne.layoutWith;
    ReportOne.layoutWith = function (m) {
      const lay = layoutWith(m);
      return function () {
        window.__layouts++;
        window.__lastLayout = performance.now();
        return lay.apply(this, arguments);
      };
    };
  });
  await quiet(page);
  return errors;
}

/* Waits until no layout has run for a second and the fit line is in. */
async function quiet(page) {
  await page.waitForFunction(() => performance.now() - window.__lastLayout > 1000, null, { timeout: 60000 });
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
}

async function counted(page, act) {
  await page.evaluate(() => (window.__layouts = 0));
  await act();
  await page.evaluate(() => (window.__lastLayout = performance.now()));
  await quiet(page);
  return page.evaluate(() => window.__layouts);
}

const part = page => page.locator('#studio-palette [data-action="oneSwitch"]').first();

test('a tick lays the class out once, and the tick put back lays out nothing', async ({ page }) => {
  const errors = await open(page);
  const key = await part(page).getAttribute('data-part');
  const sw = page.locator('#studio-palette [data-action="oneSwitch"][data-part="' + key + '"]');
  const students = await page.evaluate(() => getStudents('sci8').length);
  // A part turned off moves to Add a Part, folded shut: the button's own click.
  const tick = () => sw.evaluate(b => b.click());
  // Off: the canvas and every student for the fit line.
  expect(await counted(page, tick)).toBe(students + 1);
  const fitOff = await page.locator('#studio-fit').textContent();
  // On again. (The class's attendance and Student Voice arrive after it
  // opens and redraw the page: what was laid out before they came is not
  // used again, so this tick may lay the class out too.)
  await counted(page, tick);
  // Off again: every layout is the one kept from the first tick.
  expect(await counted(page, tick)).toBe(0);
  await expect(page.locator('#studio-fit')).toHaveText(fitOff);
  expect(errors).toEqual([]);
});

test('a change for one student lays out that student only', async ({ page }) => {
  const errors = await open(page);
  await page.locator('#studio-palette [data-action="oneScope"][data-value="student"]').click();
  await quiet(page);
  // Hidden for this student: their canvas and their line in the fit.
  expect(await counted(page, () => part(page).click())).toBe(2);
  await expect(page.locator('#studio-palette .one-scope-note')).toContainText('1 change for');
  expect(errors).toEqual([]);
});

/* Next and Previous Student (R5) draw the panel and the sheet, never the
   whole tab; a student shown before is not laid out again. */
test('Next Student redraws the sheet, not the tab', async ({ page }) => {
  const errors = await open(page);
  await page.evaluate(() => {
    window.__tabs = 0;
    const count = ms => ms.forEach(m => m.addedNodes.forEach(n => n.id === 'studio' && window.__tabs++));
    new MutationObserver(count).observe(document.getElementById('report-output'), { childList: true });
  });
  const name = () => page.locator('#rb-preview .sheet-student').first().getAttribute('data-sid');
  const first = await name();
  expect(await counted(page, () => page.getByRole('button', { name: 'Next Student' }).click())).toBe(1);
  await expect.poll(name).not.toBe(first);
  // Back: the layout kept from before.
  expect(await counted(page, () => page.getByRole('button', { name: 'Previous Student' }).click())).toBe(0);
  await expect.poll(name).toBe(first);
  expect(await page.evaluate(() => window.__tabs)).toBe(0);
  expect(errors).toEqual([]);
});

/* Everyone, One Student and the Print dialog (R7) are changes of view:
   the class is laid out the first time only. */
test('Everyone a second time, and the Print dialog, lay out no student again', async ({ page }) => {
  const errors = await open(page);
  const view = v => page.locator('[data-action="studioView"][data-view="' + v + '"]').click();
  const sheets = () => page.locator('#rb-preview .sheet-student').evaluateAll(els => els.map(e => e.outerHTML));
  const students = await page.evaluate(() => getStudents('sci8').length);
  expect(await counted(page, () => view('all'))).toBe(students);
  const first = await sheets();
  await counted(page, () => view('one'));
  expect(await counted(page, () => view('all'))).toBe(0);
  // The same pages as the first time.
  expect(await sheets()).toEqual(first);
  await counted(page, () => view('one'));
  expect(await counted(page, () => page.locator('#tb-print-btn').click())).toBe(0);
  await expect(page.locator('#issue-title')).toHaveText('Print ' + students + ' Reports');
  await page.locator('[data-issue="cancel"]').click();
  expect(errors).toEqual([]);
});
