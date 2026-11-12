import { test, expect } from '@playwright/test';

/* One Report (teacher/report-one.js; DECISIONS, "One Report", 2026-11-12):
   Progress Reports as one list of parts, behind ?onereport=1. Demo Mode's
   Science 8. The student is picked by name: in One Student view the canvas
   otherwise moves to whichever report the class fit finds longest, and
   that depends on the machine's fonts. */

const NAME = 'Cece Adeyemi';

/* A font wider than any a teacher's machine prints in (see
   e2e/quick-report-columns.spec.js): every layout check runs in the
   machine's fonts and again in this. */
const WIDE_FONT = `.report-sheet, .report-sheet * {
  font-family: Verdana, 'DejaVu Sans', sans-serif !important;
  letter-spacing: 0.03em !important;
}`;

async function openOne(page, setup, wide) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  if (wide) await page.addStyleTag({ content: WIDE_FONT });
  await page.evaluate(() => localStorage.setItem('fv-one-report', '1'));
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  if (setup) {
    await page.evaluate(id => {
      saveReportConfig('sci8', Object.assign({}, getReportConfig('sci8'), { one: ReportOne.fromSetup(id) }));
    }, setup);
    await page.evaluate(r => window.Router.navigate(r), '/dashboard');
    await page.evaluate(r => window.Router.navigate(r), '/reports');
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('#studio.studio-one')).toBeVisible();
  }
  await page.getByRole('button', { name: 'Select students' }).click();
  const list = page.locator('#picker-dropdown');
  await list.getByRole('button', { name: 'Deselect All' }).click();
  await list.locator('.student-picker-item', { hasText: NAME }).click();
  await page.getByRole('button', { name: 'Select students' }).click();
  await expect(page.locator('#rb-preview .sheet-student')).toContainText(NAME);
  return errors;
}

/* Each side of the student's report: its label, the parts on it and how
   far its content runs past its foot (0 when it fits). */
async function sides(page) {
  return page.locator('#rb-preview .sheet-student .sheet-zoom').evaluateAll(zooms =>
    zooms.map(z => {
      const body = z.querySelector('.sheet-body');
      return {
        label: z.querySelector('.sheet-label').textContent,
        parts: Array.from(z.querySelectorAll('.sheet-cell[data-part]'), c => c.dataset.part),
        past: body ? Math.max(0, body.scrollHeight - body.clientHeight) : 0,
        blank: !!z.querySelector('.sheet-blank-side'),
        feedback: !!z.querySelector('.fb-sheet'),
      };
    }),
  );
}

for (const wide of [false, true]) {
  const font = wide ? ' (a wider font)' : '';

  test('a class on the Quick Report opens with its own parts, in its own order' + font, async ({ page }) => {
    const errors = await openOne(page, null, wide);
    const s = await sides(page);
    const parts = s.flatMap(x => x.parts);
    expect(parts[0]).toBe('header');
    expect(parts).toContain('assessments');
    expect(parts).toContain('course-grade');
    expect(parts).not.toContain('proficiency');
    // Nothing was saved by opening the screen.
    expect(await page.evaluate(() => 'one' in (getReportConfig('sci8') || {}))).toBe(false);
    s.forEach(x => expect(x.past, x.label).toBe(0));
    expect(errors).toEqual([]);
  });

  test('every Setup fits its sides; the list starts where it is and carries on' + font, async ({ page }) => {
    for (const setup of ['grades', 'report-card', 'interim-update', 'conference-pack']) {
      const errors = await openOne(page, setup, wide);
      const s = await sides(page);
      s.forEach(x => expect(x.past, setup + ' · ' + x.label).toBe(0));
      // A student's sides are whole sheets.
      expect(s.length % 2, setup).toBe(0);
      expect(errors, setup).toEqual([]);
    }
    // The Report Card's list of assessments begins on the front, under the
    // parts before it, and goes on under "(continued)".
    await openOne(page, 'report-card', wide);
    const s = await sides(page);
    const withList = s.filter(x => x.parts.includes('assessments'));
    expect(withList.length).toBeGreaterThan(1);
    expect(withList[0].parts[0]).toBe('header');
    const titles = await page
      .locator('#rb-preview .sheet-cell[data-part="assessments"] .report-block-title')
      .allTextContents();
    expect(titles[0]).toBe('Assessments');
    expect(titles[1]).toBe('Assessments (continued)');
    // Every assessment prints once.
    const rows = await page.locator('#rb-preview .sheet-cell[data-part="assessments"] .gr-row[data-row]').count();
    const listed = await page.evaluate(name => {
      const st = getStudents('sci8').find(x => x.firstName + ' ' + x.lastName === name);
      return ReportOne.rowsOf(
        ReportOne.fromSetup('report-card'),
        'assessments',
        'sci8',
        st,
        ReportBlocks.reportContext(),
      ).length;
    }, NAME);
    expect(rows).toBe(listed);
  });

  test('the response slip docks at the foot of the report’s last side' + font, async ({ page }) => {
    await openOne(page, 'report-card', wide);
    const s = await sides(page);
    const report = s.filter(x => x.parts.length);
    const last = report[report.length - 1];
    expect(last.parts[last.parts.length - 1]).toBe('parent-response');
    // At the foot: nothing prints under it, and it reaches the foot of its side.
    const gap = await page.locator('#rb-preview .sheet-row.sheet-pinned').evaluate(row => {
      const body = row.closest('.sheet-body').getBoundingClientRect();
      return Math.round(body.bottom - row.getBoundingClientRect().bottom);
    });
    expect(Math.abs(gap)).toBeLessThanOrEqual(1);
    // No side is left blank for it: only the last side of the last sheet may be.
    s.slice(0, -1).forEach(x => expect(x.blank, x.label).toBe(false));
  });
}

test('leaving an assessment off the list changes the page and no grade', async ({ page }) => {
  await openOne(page, 'grades', false);
  const before = await page.evaluate(name => {
    const st = getStudents('sci8').find(x => x.firstName + ' ' + x.lastName === name);
    const m = ReportOne.modelFor(getReportConfig('sci8'));
    const rows = ReportOne.rowsOf(m, 'assessments', 'sci8', st, ReportBlocks.reportContext());
    const grade = document.querySelector('#rb-preview .gr-term-grade').textContent;
    saveReportConfig(
      'sci8',
      Object.assign({}, getReportConfig('sci8'), { one: ReportOne.setRemoved(m, 'assessments', rows[0].key, true) }),
    );
    return { first: rows[0], count: rows.length, grade };
  }, NAME);
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#rb-preview .sheet-student')).toContainText(NAME);
  const list = page.locator('#rb-preview .sheet-cell[data-part="assessments"] .gr-row[data-row]');
  await expect(list).toHaveCount(before.count - 1);
  await expect(page.locator(`#rb-preview .gr-row[data-row="${before.first.key}"]`)).toHaveCount(0);
  await expect(page.locator('#rb-preview .gr-term-grade')).toHaveText(before.grade);
});

test('with the switch off, Progress Reports is the screen it was', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0);
  await page.evaluate(() => localStorage.removeItem('fv-one-report'));
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('#studio.studio-one')).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Quick Report' })).toHaveAttribute('aria-checked', 'true');
});
