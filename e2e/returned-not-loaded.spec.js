import { test, expect } from '@playwright/test';

/* Every teacher page in a class that holds grades whose Draft and Returned
   rows have not loaded yet (a signed-in teacher's first draw of a session,
   or offline): the data layer then refuses to call any grade returned.
   Nothing may throw into a draw, a click or a promise, nothing may stay
   busy, and once the rows load each page draws what it draws when loaded
   from the start (student page build plan S2; the S2 reviews).

   The pages are walked from the router (Router.routes()), and Reports'
   tabs from its own list, so a new page or tab is covered without anyone
   remembering it. Demo Mode's Science 8; the rows "not loaded" is the data
   layer's own refusal, put in place for the test. */
test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(180000);

const HELD = { student_page_enabled: true, return_grades: 'on_return' };

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(
    () => typeof getAssessments === 'function' && getAssessments('sci8').length > 0 && getStudents('sci8').length > 0,
  );
  await page.evaluate(cfg => {
    saveCourseConfig('sci8', Object.assign({}, getCourseConfig('sci8'), cfg));
    window.__prints = 0;
    window.print = function () {
      window.__prints++;
    };
    window.__real = window.getReturnedScores;
  }, HELD);
}
const notLoaded = page =>
  page.evaluate(() => {
    // The data layer's own refusal, with its code (shared/data.js, RETURNED_NOT_LOADED).
    window.getReturnedScores = function () {
      throw Object.assign(
        new Error(
          'This class holds grades until they are returned, and which of its grades are returned has not loaded.',
        ),
        { code: 'RETURNED_NOT_LOADED' },
      );
    };
    clearProfCache();
  });
// The rows arrive: the data layer redraws the page on screen, as it does after the first load of a class's rows.
const loaded = page =>
  page.evaluate(() => {
    window.getReturnedScores = window.__real;
    _invalidateAndRerender();
  });

/* Every address to walk: each route, and each of Reports' tabs. */
const addresses = page =>
  page.evaluate(() => {
    const out = [];
    Router.routes().forEach(route => {
      if (route === '/reports') {
        PageReports._helpers.tabs
          .filter(t => !t.hidden)
          .forEach(t =>
            out.push('/reports?course=sci8&tab=' + t.id + (t.id === 'questionnaire' ? '&student=st1' : '')),
          );
      } else if (route === '/student') out.push('/student?id=st1&course=sci8');
      else out.push(route + '?course=sci8');
    });
    return out;
  });

const go = async (page, address) => {
  await page.evaluate(a => window.Router.navigate(a), address);
  await page.waitForTimeout(700);
};
/* What the page shows: its main area and its toolbar, as text. Less the
   class's shared next step, which Generate picks from the stories it has
   told least this session, so a second drawing is another one by design. */
const shown = page =>
  page.evaluate(() =>
    ['main', 'page-toolbar-mount']
      .map(id => (document.getElementById(id) || { innerText: '' }).innerText)
      .join('\n')
      .split('\n')
      .filter(line => !/^Shared next step:/.test(line))
      .join('\n'),
  );
// A button left busy: turned off while it says it is working ("Sending…", "Updating…").
const busy = page =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll('button'))
      .filter(b => b.disabled || b.getAttribute('aria-busy') === 'true')
      .map(b => b.innerText.trim())
      .filter(t => /…$/.test(t)),
  );

test('every page and every Reports tab: nothing throws or stays busy, and each draws once the rows load', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message).slice(0, 160)));
  await demo(page);
  const list = await addresses(page);
  expect(list.length).toBeGreaterThanOrEqual(8);
  // As each page draws with the rows loaded from the start.
  const expected = {};
  for (const address of list) {
    await go(page, address);
    expected[address] = await shown(page);
  }
  expect(errors).toEqual([]);
  for (const address of list) {
    await go(page, '/dashboard?course=sci8');
    await notLoaded(page);
    await go(page, address);
    // A page that fails its first draw is a page error (teacher/router.js throws it again, outside the navigation).
    expect(errors, address + ' not loaded').toEqual([]);
    expect(await busy(page), address + ' not loaded').toEqual([]);
    if (address.indexOf('/reports') === 0) {
      // Reports reads returned grades: it waits with the class's loading line.
      await expect(page.locator('#report-output .report-waiting'), address).toHaveText('Loading this class…');
    } else {
      // Every other page shows the teacher's own work: the same with the rows missing as with them loaded.
      expect(await shown(page), address + ' not loaded').toBe(expected[address]);
    }
    await loaded(page);
    await page.waitForTimeout(700);
    expect(errors, address + ' loaded').toEqual([]);
    expect(await busy(page), address + ' loaded').toEqual([]);
    expect(await shown(page), address + ' once loaded').toBe(expected[address]);
  }
});

test('the walk sees a page that fails its first draw', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await demo(page);
  await page.evaluate(() => {
    const real = PageGradebook.init;
    PageGradebook.init = function () {
      PageGradebook.init = real;
      throw new Error('a first draw that failed (a test)');
    };
  });
  await go(page, '/gradebook?course=sci8');
  // The app goes on: the address is the gradebook's, and the next page draws.
  expect(page.url()).toContain('/gradebook');
  expect(errors).toEqual(['a first draw that failed (a test)']);
  await go(page, '/dashboard?course=sci8');
  expect(errors.length).toBe(1);
});

test('a fault while the returned grades are worked out is not taken for loading: it surfaces', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e.message)));
  await demo(page);
  await page.evaluate(() => {
    Grader.setPoints('sci8', 'st1', 'sci8q2', 1);
    GradeState.returnedScores = function () {
      throw new TypeError("Cannot read properties of undefined (reading 'returned_copy')");
    };
    clearProfCache();
    _returnedSets = {};
  });
  await go(page, '/reports?course=sci8&tab=progress');
  await expect(page.locator('#report-output .report-waiting')).toHaveCount(0);
  expect(errors.some(m => /returned_copy/.test(m))).toBe(true);
});

test.describe('Reports and Assignments while the rows load', () => {
  test('Progress Reports waits with the class’s loading line, Print does nothing, then the reports draw', async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await demo(page);
    await notLoaded(page);
    await go(page, '/reports?course=sci8&tab=progress');
    await expect(page.locator('#report-output .report-waiting')).toHaveText('Loading this class…');
    await expect(page.locator('.report-sheet')).toHaveCount(0);
    await page.getByRole('button', { name: 'Print Reports' }).click();
    await expect(page.locator('#issue-overlay')).toHaveCount(0);
    expect(await page.evaluate(() => window.__prints)).toBe(0);
    await loaded(page);
    await expect(page.locator('.report-sheet').first()).toBeVisible();
    await expect(page.locator('#report-output .report-waiting')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('the Term Questionnaire waits, then draws the student', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await demo(page);
    await go(page, '/gradebook?course=sci8');
    await notLoaded(page);
    await go(page, '/reports?course=sci8&tab=questionnaire&student=st1');
    await expect(page.locator('#report-output .report-waiting')).toHaveText('Loading this class…');
    await loaded(page);
    await expect(page.locator('.qn-name')).toHaveText('Cece Adeyemi');
    expect(errors).toEqual([]);
  });

  test('Sent to Phones: waiting, then the panel; Send works once the rows are in', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await demo(page);
    await go(page, '/reports?course=sci8&tab=progress');
    await page.getByRole('button', { name: 'Sent to Phones' }).click();
    await expect(page.getByRole('button', { name: 'Send to Phones and Print Slips' })).toBeVisible();
    await notLoaded(page);
    await page.evaluate(() => PageReports.renderReports());
    await expect(page.locator('#report-output .report-waiting')).toHaveText('Loading this class…');
    await loaded(page);
    const send = page.getByRole('button', { name: 'Send to Phones and Print Slips' });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.locator('.pp-row')).toHaveCount(27);
    expect(await busy(page)).toEqual([]);
    expect(errors).toEqual([]);
  });

  test('Assignments draws, the Printed marks wait, and come back with the page’s redraw', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await demo(page);
    const sid = await page.evaluate(() => {
      var cid = 'sci8';
      var sid = sortStudents(getStudents(cid), 'lastName').find(s =>
        (getScores(cid)[s.id] || []).some(e => e.assessmentId === 'sci8a4' && e.score > 0),
      ).id;
      RubricPrint.markPrinted(cid, 'sci8a4', [sid]);
      return sid;
    });
    await notLoaded(page);
    await go(page, '/assignments?course=sci8');
    const card = page.locator('#ac-sci8a4');
    await card.waitFor();
    if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
    const mark = card.locator('[data-rp-mark-sid="' + sid + '"]').first();
    await expect(mark).toBeAttached();
    await expect(mark).toBeHidden();
    // Print Rubrics does not open while the handout cannot be worked out.
    await card.locator('[data-action="printRubrics"]').first().click();
    await expect(page.getByRole('dialog', { name: 'Print Rubrics' })).toHaveCount(0);
    await loaded(page);
    await expect(page.locator('#ac-sci8a4 [data-rp-mark-sid="' + sid + '"]').first()).toContainText('Printed');
    expect(errors).toEqual([]);
  });
});

test.describe('Sent to Phones pressed while the rows are not loaded (S2-F2)', () => {
  const sent = page =>
    page.evaluate(() => (JSON.parse(localStorage.getItem('gb-phone-reports-sci8') || '[]') || []).length);
  const msg = page => page.evaluate(() => (document.querySelector('.pp-msg') || { innerText: '' }).innerText);

  test('Send does nothing and never stays on Sending…; once loaded it sends', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await demo(page);
    await go(page, '/reports?course=sci8&tab=progress');
    await page.getByRole('button', { name: 'Sent to Phones' }).click();
    const send = page.getByRole('button', { name: 'Send to Phones and Print Slips' });
    await expect(send).toBeVisible();
    await notLoaded(page);
    await send.click();
    await page.waitForTimeout(800);
    expect(await sent(page)).toBe(0);
    expect(await msg(page)).not.toContain('Sending…');
    expect(await busy(page)).toEqual([]);
    await loaded(page);
    await page.evaluate(() => PageReports.renderReports());
    await page.getByRole('button', { name: 'Send to Phones and Print Slips' }).click();
    await expect(page.locator('.pp-row')).toHaveCount(27);
    expect(await sent(page)).toBe(1);
    expect(errors).toEqual([]);
  });

  test('Update Issued Copy does nothing and never stays on Updating…; once loaded it updates', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e.message)));
    await demo(page);
    await go(page, '/reports?course=sci8&tab=progress');
    await page.getByRole('button', { name: 'Sent to Phones' }).click();
    await page.getByRole('button', { name: 'Send to Phones and Print Slips' }).click();
    await expect(page.locator('.pp-row')).toHaveCount(27);
    const update = page.getByRole('button', { name: 'Update Issued Copy' });
    await expect(update).toBeVisible();
    await notLoaded(page);
    await update.click();
    await page.waitForTimeout(600);
    expect(await msg(page)).not.toContain('Updating…');
    expect(errors).toEqual([]);
    await loaded(page);
    await page.evaluate(() => PageReports.renderReports());
    await page.getByRole('button', { name: 'Update Issued Copy' }).click();
    await expect(page.locator('.pp-msg')).toContainText('Updated.');
    expect(errors).toEqual([]);
  });
});
