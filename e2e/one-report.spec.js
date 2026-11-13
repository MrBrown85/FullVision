import { test, expect } from '@playwright/test';

/* One Report (teacher/report-one.js; DECISIONS, "One Report", 2026-11-12):
   Progress Reports as one list of parts, the screen for every class. Demo
   Mode's Science 8. The student is picked by name: in One Student view the canvas
   otherwise moves to whichever report the class fit finds longest, and
   that depends on the machine's fonts. */

const NAME = 'Cece Adeyemi';

/* Every change here lays the whole class out again (27 students, their
   Feedback Pages too) for the fit line, and a GitHub runner is several
   times slower than a teacher's machine: main's first run of this file
   timed out at the default 30 seconds on tests that take 4 to 9 seconds
   on a Mac (Nov 12). */
test.setTimeout(120_000);

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

test('a class opens straight on One Report, with no mode switch on the screen', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports?course=sci8&tab=progress');
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await expect(page.locator('#studio-palette [data-action="oneSwitch"]').first()).toBeVisible();
  for (const name of ['Quick Report', 'Custom']) await expect(page.getByRole('radio', { name })).toHaveCount(0);
  await expect(page.locator('#tb-save-template')).toHaveCount(0);
  await expect(page.locator('#report-sides')).toHaveCount(0);
  expect(errors).toEqual([]);
});

/* The screen itself: the panel, the page's controls, the comment. */
test.describe('working on the report', () => {
  const part = (page, key) => page.locator(`#rb-preview .sheet-cell[data-part="${key}"]`);

  test('a switch in the panel takes a part off the page and Undo puts it back', async ({ page }) => {
    const errors = await openOne(page, 'report-card', false);
    await expect(part(page, 'legend')).toHaveCount(1);
    const sw = page.locator('#studio-palette [data-action="oneSwitch"][data-part="legend"]');
    await expect(sw).toHaveAttribute('aria-checked', 'true');
    await sw.click();
    await expect(part(page, 'legend')).toHaveCount(0);
    expect(await page.evaluate(() => getReportConfig('sci8').one.parts.includes('legend'))).toBe(false);
    // Only the model is saved: the old screen's settings are never written.
    const saved = await page.evaluate(() => Object.keys(getReportConfig('sci8')));
    ['progressMode', 'gradeReport', 'form', 'preset'].forEach(key => expect(saved).not.toContain(key));
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(part(page, 'legend')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test('Hide on the page, and a row left off, for the class', async ({ page }) => {
    await openOne(page, 'report-card', false);
    await part(page, 'legend').hover();
    await page.locator('#rb-preview .one-hide[data-part="legend"]').click();
    await expect(part(page, 'legend')).toHaveCount(0);
    // A row of Proficiency, by the name it prints.
    const row = page.locator('#rb-preview .sheet-cell[data-part="proficiency"] [data-row]').first();
    const name = await row.getAttribute('data-row');
    await row.hover();
    await page.locator(`#rb-preview .one-rm[data-part="proficiency"][data-row="${name}"]`).click();
    await expect(page.locator(`#rb-preview .sheet-cell[data-part="proficiency"] [data-row="${name}"]`)).toHaveCount(0);
    expect(await page.evaluate(() => getReportConfig('sci8').one.removed.proficiency)).toEqual([name]);
    // Nothing the page added prints.
    await page.emulateMedia({ media: 'print' });
    for (const el of await page.locator('#rb-preview .no-print').all()) await expect(el).toBeHidden();
  });

  test('Changes Apply To a student keeps the change for that student only', async ({ page }) => {
    await openOne(page, 'report-card', false);
    await page.locator('#studio-palette [data-action="oneScope"]').nth(1).click();
    await page.locator('#studio-palette [data-action="oneSwitch"][data-part="legend"]').click();
    await expect(part(page, 'legend')).toHaveCount(0);
    const saved = await page.evaluate(() => getReportConfig('sci8').one);
    expect(saved.parts).toContain('legend');
    expect(Object.values(saved.perStudent)).toEqual([{ on: [], off: ['legend'], removed: {} }]);
  });

  test('the comment is edited on the page; the change is asked about, and never prints unsaved', async ({ page }) => {
    await openOne(page, 'report-card', false);
    const comment = page.locator('#rb-preview [aria-label="Edit Cece’s comment"]');
    const before = await page.evaluate(name => {
      const st = getStudents('sci8').find(x => x.firstName + ' ' + x.lastName === name);
      return getStudentTermRating('sci8', st.id, ReportBlocks.reportContext().termId).narrative;
    }, NAME);
    await comment.click();
    const box = page.locator('.one-ce-text');
    await box.press('End');
    await box.pressSequentially(' She asks good questions.');
    await page.locator('#studio-fit').click();
    const ask = page.getByRole('alertdialog');
    await expect(ask).toContainText('Save your changes to Cece’s comment?');
    await ask.getByRole('button', { name: 'Keep Editing' }).click();
    await page.locator('.one-ce-text').press('Escape');
    // The draft is still unsaved: Print Reports asks first and prints nothing.
    await page.locator('#tb-print-btn').click();
    await expect(page.getByRole('alertdialog')).toContainText('Save or discard before printing.');
    await expect(page.locator('#issue-overlay')).toHaveCount(0);
    await page.getByRole('alertdialog').getByRole('button', { name: 'Save' }).click();
    const after = await page.evaluate(name => {
      const st = getStudents('sci8').find(x => x.firstName + ' ' + x.lastName === name);
      return getStudentTermRating('sci8', st.id, ReportBlocks.reportContext().termId).narrative;
    }, NAME);
    expect(after).not.toBe(before);
    expect(after).toContain('She asks good questions.');
    await expect(part(page, 'teacher-narrative')).toContainText('She asks good questions.');
  });

  /* Page Studio moved blocks with Move Up, Move Down and dragging on the
     page; One Report moves a part in the panel. */
  test('a part moves up and down in the panel, by keyboard and by dragging, and prints in its new place', async ({
    page,
  }) => {
    const errors = await openOne(page, 'report-card', false);
    const order = () => page.evaluate(() => getReportConfig('sci8').one.parts);
    const printed = () =>
      page
        .locator('#rb-preview .sheet-student .sheet-cell[data-part]')
        .evaluateAll(cells => [...new Set(cells.map(c => c.dataset.part))]);
    const before = await order();
    const at = before.indexOf('teacher-narrative');
    // The keyboard: the part's handle and the up arrow.
    const handle = page.locator('#studio-palette [data-action="oneDrag"][data-part="teacher-narrative"]');
    await handle.focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(order).toEqual(
      before
        .slice(0, at - 1)
        .concat('teacher-narrative', before[at - 1])
        .concat(before.slice(at + 1)),
    );
    await expect(page.locator('#studio-live')).toContainText('Teacher Comment, ');
    expect((await printed()).indexOf('teacher-narrative')).toBeLessThan((await printed()).indexOf(before[at - 1]));
    await page.keyboard.press('ArrowDown');
    await expect.poll(order).toEqual(before);
    // Dragging: the comment held by its handle and let go over the
    // Proficiency Legend's row lands above it.
    const legend = page.locator('#studio-palette .one-onlist > .one-item[data-part="legend"]');
    const from = await handle.boundingBox();
    const to = await legend.boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++)
      await page.mouse.move(from.x + from.width / 2, from.y + ((to.y + 4 - from.y) * i) / 8 + from.height / 2);
    await page.mouse.up();
    await expect
      .poll(async () => {
        const o = await order();
        return o.indexOf('teacher-narrative') < o.indexOf('legend');
      })
      .toBe(true);
    const now = await printed();
    expect(now.indexOf('teacher-narrative')).toBeLessThan(now.indexOf('legend'));
    // The letterhead stays first and the response last.
    expect((await order())[0]).toBe('header');
    expect((await order()).slice(-1)).toEqual(['parent-response']);
    expect(errors).toEqual([]);
  });

  /* Page Studio's templates; One Report's Setups, from the panel's menu. */
  test('a Setup from the menu sets the parts, and Undo puts the report back', async ({ page }) => {
    await openOne(page, 'report-card', false);
    await expect(part(page, 'parent-response')).toHaveCount(1);
    await page.locator('#studio-palette [data-action="oneSetupMenu"]').click();
    const menu = page.getByRole('menu', { name: 'Setups' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitemradio', { name: /^Report Card/ })).toHaveAttribute('aria-checked', 'true');
    await menu.getByRole('menuitemradio', { name: /^Interim Update/ }).click();
    await expect(part(page, 'parent-response')).toHaveCount(0);
    await expect(part(page, 'assessments')).toHaveCount(0);
    expect(await page.evaluate(() => getReportConfig('sci8').one.setup)).toBe('interim-update');
    await expect(page.locator('#studio-palette .one-setup-name')).toHaveText('Interim Update');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(part(page, 'parent-response')).toHaveCount(1);
    expect(await page.evaluate(() => getReportConfig('sci8').one.setup)).toBe('report-card');
  });

  test('Choose Assessments leaves one off and the dialog closes with Escape', async ({ page }) => {
    await openOne(page, 'report-card', false);
    await page.locator('#studio-palette [data-action="oneOpen"][data-part="assessments"]').click();
    await page.locator('#studio-palette [data-action="oneChoose"]').click();
    const dialog = page.getByRole('dialog', { name: 'Choose Assessments' });
    await expect(dialog).toBeVisible();
    const before = await page.locator('#rb-preview .gr-row[data-row]').count();
    await dialog.getByRole('switch').first().click();
    await expect(page.locator('#rb-preview .gr-row[data-row]')).toHaveCount(before - 1);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });
});
