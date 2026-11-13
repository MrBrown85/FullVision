import { test, expect } from '@playwright/test';

/* Progress Reports, One Student view: the Zoom control
   (teacher/report-one-zoom.js), a sheet's two sides in one row, Previous
   and Next Student and Hide Panels (teacher/report-one-head.js). Demo
   Mode's Science 8 on the Report Card, Legal paper, in the owner's window
   (1,916 x 1,100): Cece's report is three sheets. */

// Every render lays the class out again for the fit line; a GitHub runner
// is several times slower than a Mac.
test.setTimeout(120_000);
test.use({ viewport: { width: 1916, height: 1100 } });

const NAME = 'Cece';

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.clock.setFixedTime(new Date('2026-11-13T10:00:00'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await page.evaluate(() => {
    saveReportConfig('sci8', Object.assign({}, getReportConfig('sci8'), { one: ReportOne.fromSetup('report-card') }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  // Every size at once: the app's reduced-motion rule still leaves each
  // transition a frame long, and the page clock is fixed.
  await page.addStyleTag({ content: '#rb-preview, #rb-preview * { transition: none !important; }' });
  await page.getByRole('radio', { name: 'Legal' }).click();
  await page.locator('#gb-roster-list .student-row', { hasText: NAME }).first().click();
  await expect(page.locator('#rb-preview .report-sheet[data-paper="legal"]').first()).toBeVisible();
  await expect(page.locator('#studio-fit')).toContainText('for the class', { timeout: 30000 });
  await expect(page.locator('#studio-fit')).toContainText(NAME);
  return errors;
}

async function pick(page, name) {
  await page.locator('#studio-zoom-btn').click();
  await page.getByRole('menuitemradio', { name, exact: true }).click();
  await expect(page.locator('#studio-zoom-btn')).toHaveAttribute('aria-label', 'Zoom: ' + name);
}

// Two frames, for the layout to land.
const settle = page =>
  page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));

// Each side's box, and the preview's.
async function layout(page) {
  await settle(page);
  return page.evaluate(() => {
    const p = document.getElementById('rb-preview');
    const r = p.getBoundingClientRect();
    return {
      pane: { left: r.left, top: r.top, right: r.left + p.clientWidth, bottom: r.top + p.clientHeight },
      scrollW: p.scrollWidth,
      clientW: p.clientWidth,
      zoom: parseFloat(p.style.getPropertyValue('--sheet-zoom')),
      sides: [...p.querySelectorAll('.sheet-student > .sheet-zoom')].map(z => {
        const b = z.getBoundingClientRect();
        const s = z.querySelector('.report-sheet, .sheet-blank, .fb-sheet') || z;
        const sb = s.getBoundingClientRect();
        return { left: b.left, top: Math.round(b.top), right: b.right, bottom: sb.bottom };
      }),
    };
  });
}
const perRow = l => l.sides.filter(s => s.top === l.sides[0].top).length;

test('Automatic puts a sheet’s two sides in one row; the choice survives a reload', async ({ page }) => {
  const errors = await open(page);
  await expect(page.locator('#studio-zoom-btn')).toHaveText('Automatic');
  const l = await layout(page);
  expect(l.sides.length).toBeGreaterThanOrEqual(4);
  expect(l.sides[0].top).toBe(l.sides[1].top);
  expect(l.sides[1].right).toBeLessThanOrEqual(l.pane.right + 0.5);

  await pick(page, '75%');
  await page.reload();
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio-zoom-btn')).toHaveText('75%');
  await expect.poll(async () => (await layout(page)).zoom).toBe(0.75);
  expect(errors).toEqual([]);
});

test('All Pages shows every side inside the pane, a sheet’s front and back in one row', async ({ page }) => {
  await open(page);
  await pick(page, 'All Pages');
  const l = await layout(page);
  for (const s of l.sides) {
    expect(s.left).toBeGreaterThanOrEqual(l.pane.left - 0.5);
    expect(s.right).toBeLessThanOrEqual(l.pane.right + 0.5);
    expect(s.bottom).toBeLessThanOrEqual(l.pane.bottom + 0.5);
  }
  expect(l.scrollW).toBeLessThanOrEqual(l.clientW);
  expect(l.sides[0].top).toBe(l.sides[1].top);
  expect(l.sides[2].top).toBe(l.sides[3].top);
  // Two sides of one sheet sit closer than two sheets.
  const inSheet = l.sides[1].left - l.sides[0].right;
  const between = l.sides[2].left - l.sides[1].right;
  if (l.sides[2].top === l.sides[1].top) expect(inSheet).toBeLessThan(between);
});

test('Zoom Out puts more sides in a row, in whole sheets; Zoom In past the pane scrolls sideways', async ({ page }) => {
  await open(page);
  const start = perRow(await layout(page));
  const out = page.getByRole('button', { name: 'Zoom Out' });
  let more = start;
  for (let i = 0; i < 8 && more <= start && (await out.isEnabled()); i++) {
    await out.click();
    more = perRow(await layout(page));
  }
  expect(more).toBeGreaterThan(start);
  expect(more % 2).toBe(0);
  expect(await page.locator('#studio-zoom-btn').textContent()).toMatch(/^\d+%$/);

  // In a narrower window, past the pane's width.
  await page.setViewportSize({ width: 1300, height: 1000 });
  await pick(page, '150%');
  await expect(page.getByRole('button', { name: 'Zoom In' })).toBeDisabled();
  const l = await layout(page);
  expect(l.scrollW).toBeGreaterThan(l.clientW);
  expect(l.sides[0].left).toBeGreaterThanOrEqual(l.pane.left - 0.5);
});

test('the zoom changes neither the fit line nor what prints; a comment edited at 50% saves', async ({ page }) => {
  await open(page);
  const fit = await page.locator('#studio-fit').textContent();
  const printed = async () => {
    await page.emulateMedia({ media: 'print' });
    await settle(page);
    const box = await page
      .locator('#rb-preview .sheet-zoom .report-sheet')
      .first()
      .evaluate(el => {
        const r = el.getBoundingClientRect();
        const z = el.closest('.sheet-zoom').getBoundingClientRect();
        return { transform: getComputedStyle(el).transform, w: r.width, h: r.height, zw: z.width, zh: z.height };
      });
    await page.emulateMedia({ media: 'screen' });
    return box;
  };
  const auto = await printed();
  await pick(page, '50%');
  expect(await printed()).toEqual(auto);
  await pick(page, '125%');
  expect(await printed()).toEqual(auto);
  await expect(page.locator('#studio-fit')).toHaveText(fit);

  await pick(page, '50%');
  const comment = page.locator('#rb-preview [aria-label="Edit Cece’s comment"]');
  await comment.click();
  const box = page.locator('.one-ce-text');
  await box.press('End');
  await box.pressSequentially(' She asks good questions.');
  await page.locator('#studio-fit').click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#rb-preview .sheet-cell[data-part="teacher-narrative"]')).toContainText(
    'She asks good questions.',
  );
  await expect(page.locator('#studio-zoom-btn')).toHaveText('50%');
  await expect(page.locator('#studio-fit')).toHaveText(fit);

  // At 125% a part hides from the page, and a row is left off.
  await pick(page, '125%');
  const legend = page.locator('#rb-preview .sheet-cell[data-part="legend"]');
  await legend.scrollIntoViewIfNeeded();
  await legend.hover();
  await page.locator('#rb-preview .one-hide[data-part="legend"]').click();
  await expect(legend).toHaveCount(0);
  const row = page.locator('#rb-preview .sheet-cell[data-part="proficiency"] [data-row]').first();
  const name = await row.getAttribute('data-row');
  await row.scrollIntoViewIfNeeded();
  await row.hover();
  await page.locator(`#rb-preview .one-rm[data-part="proficiency"][data-row="${name}"]`).click();
  await expect(page.locator(`#rb-preview .sheet-cell[data-part="proficiency"] [data-row="${name}"]`)).toHaveCount(0);
  await expect(page.locator('#studio-zoom-btn')).toHaveText('125%');
});

test('Ctrl and the scroll wheel zoom the pages, not the browser; the menu works from the keyboard', async ({
  page,
}) => {
  await open(page);
  const before = await page.evaluate(() => [window.visualViewport.scale, window.devicePixelRatio]);
  const z0 = (await layout(page)).zoom;
  const sheet = await page.locator('#rb-preview .sheet-zoom').first().boundingBox();
  await page.mouse.move(sheet.x + sheet.width / 2, sheet.y + 200);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, 200);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await layout(page)).zoom).toBeLessThan(z0);
  await expect(page.locator('#studio-zoom-btn')).toHaveText(/^\d+%$/);
  expect(await page.evaluate(() => [window.visualViewport.scale, window.devicePixelRatio])).toEqual(before);
  // Plain scrolling still scrolls.
  await page.mouse.wheel(0, 300);
  await expect.poll(() => page.locator('#rb-preview').evaluate(p => p.scrollTop)).toBeGreaterThan(0);

  const btn = page.locator('#studio-zoom-btn');
  await btn.focus();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#studio-zoom-menu')).toBeVisible();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Fit Width' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#studio-zoom-menu')).toBeHidden();
  await expect(btn).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#studio-zoom-menu')).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(btn).toHaveAttribute('aria-label', /Zoom: /);
  await expect(page.locator('#studio-zoom-menu')).toBeHidden();
});

test('Previous and Next Student follow the rail, its search included', async ({ page }) => {
  await open(page);
  const rows = () =>
    page
      .locator('#gb-roster-list .student-row')
      .evaluateAll(list =>
        list
          .filter(r => r.style.display !== 'none')
          .map(r => ({ sid: r.dataset.sid, name: r.querySelector('.student-row-name').textContent.trim() })),
      );
  const all = await rows();
  const first = (await page.locator('#gb-roster-list .student-row.selected').getAttribute('data-sid')) || '';
  const at = all.findIndex(r => r.sid === first);
  const next = page.getByRole('button', { name: 'Next Student' });
  await next.click();
  await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveAttribute('data-sid', all[at + 1].sid);
  await expect(page.locator('#studio-fit')).toContainText(all[at + 1].name.split(' ')[0]);
  // Left and Right with the focus on an arrow.
  await page.getByRole('button', { name: 'Next Student' }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveAttribute('data-sid', all[at].sid);
  await expect(page.getByRole('button', { name: 'Previous Student' })).toBeFocused();

  // At the end of the list Next stays where it is, as the questionnaire's Previous does at its start.
  const last = all[all.length - 1];
  await page.locator(`#gb-roster-list .student-row[data-sid="${last.sid}"]`).click();
  await expect(page.locator('#studio-fit')).toContainText(last.name.split(' ')[0]);
  await page.getByRole('button', { name: 'Next Student' }).click();
  await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveAttribute('data-sid', last.sid);

  // With a search typed in the rail, Next stays inside the results.
  await page.locator('#gb-roster-search').fill('an');
  const found = await rows();
  expect(found.length).toBeGreaterThan(1);
  expect(found.length).toBeLessThan(all.length);
  await page.locator(`#gb-roster-list .student-row[data-sid="${found[0].sid}"]`).click();
  for (let i = 1; i < found.length; i++) {
    await page.getByRole('button', { name: 'Next Student' }).click();
    await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveAttribute('data-sid', found[i].sid);
  }
  await expect(page.getByRole('button', { name: 'Previous Student' })).toBeVisible();
  await page.locator('.studio-view [data-view="all"]').click();
  await expect(page.getByRole('button', { name: 'Previous Student' })).toBeHidden();
  await expect(page.locator('#studio-zoom')).toBeHidden();
});

test('Hide Panels gives the pages the width; Show Panels brings both panels back as they were', async ({ page }) => {
  // Short enough for the parts panel to scroll.
  await page.setViewportSize({ width: 1916, height: 640 });
  await open(page);
  await pick(page, 'All Pages');
  const before = await layout(page);
  await page.locator('#studio-palette').evaluate(p => (p.scrollTop = 120));
  const paletteTop = await page.locator('#studio-palette').evaluate(p => p.scrollTop);
  expect(paletteTop).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Hide Panels' }).click();
  await expect(page.locator('#studio-palette')).toBeHidden();
  await expect(page.locator('#gb-sidebar')).toBeHidden();
  await expect.poll(async () => (await layout(page)).clientW, { timeout: 5000 }).toBeGreaterThan(before.clientW);
  await expect.poll(async () => (await layout(page)).zoom, { timeout: 5000 }).toBeGreaterThan(before.zoom);
  // Next still works with the rail out of sight.
  const sid = await page.locator('#gb-roster-list .student-row.selected').getAttribute('data-sid');
  await page.getByRole('button', { name: 'Next Student' }).click();
  await expect(page.locator('#gb-roster-list .student-row.selected')).not.toHaveAttribute('data-sid', sid);
  await page.getByRole('button', { name: 'Previous Student' }).click();
  await expect(page.locator('#gb-roster-list .student-row.selected')).toHaveAttribute('data-sid', sid);

  await page.getByRole('button', { name: 'Show Panels' }).click();
  await expect(page.locator('#studio-palette')).toBeVisible();
  await expect(page.locator('#gb-sidebar')).toBeVisible();
  await expect.poll(() => page.locator('#studio-palette').evaluate(p => p.scrollTop)).toBe(paletteTop);
  await expect.poll(async () => (await layout(page)).zoom, { timeout: 5000 }).toBe(before.zoom);
  await expect(page.getByRole('button', { name: 'Hide Panels' })).toBeVisible();
});

test('one pair of Previous and Next at any width, and both step the same way', async ({ page }) => {
  await open(page);
  const visible = name =>
    page
      .getByRole('button', { name, exact: true })
      .evaluateAll(list => list.filter(b => b.getClientRects().length).length);
  const selected = () => page.locator('#gb-roster-list .student-row.selected').getAttribute('data-sid');
  const order = await page.locator('#gb-roster-list .student-row').evaluateAll(list => list.map(r => r.dataset.sid));
  for (const width of [1916, 900]) {
    await page.setViewportSize({ width, height: 1100 });
    await expect.poll(() => visible('Previous Student')).toBe(1);
    expect(await visible('Next Student')).toBe(1);
    const from = await selected();
    await page.getByRole('button', { name: 'Next Student', exact: true }).filter({ visible: true }).click();
    await expect.poll(selected).toBe(order[order.indexOf(from) + 1]);
  }
  // Panels hidden at full width: still one pair.
  await page.setViewportSize({ width: 1916, height: 1100 });
  await page.getByRole('button', { name: 'Hide Panels' }).click();
  await expect.poll(() => visible('Previous Student')).toBe(1);
  expect(await visible('Next Student')).toBe(1);
});
