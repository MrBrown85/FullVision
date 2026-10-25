/**
 * Reports: Page Studio and the printed reports (teacher/report-studio.js,
 * report-sheets.js, report-blocks.js, page-reports.js). Demo Mode's Science 8
 * class, 27 students. The palette, the pages on their grid at paper size,
 * the fit line, drag and drop with the live placeholder, resize by the
 * handles, the keyboard, the block toolbar with its Options popover and
 * Leave Off, + Page, block options, templates, Print Reports with its saved
 * copy, and page counts from Chromium's print engine.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

/* Fit, page counts and the grid depend on text width. The app's font stack
   is the system font: SF Pro on a Mac, DejaVu Sans (much wider) on the Linux
   CI runner, where the longest report spills to a second sheet. Arial is on
   macOS and Windows, and Linux renders it with the metric-identical
   Liberation Sans, so these tests lay out the same everywhere. */
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    // Init scripts run before <html> exists: set the font as soon as it does.
    new MutationObserver((_, observer) => {
      if (!document.documentElement) return;
      document.documentElement.style.setProperty('--font-base', "Arial, 'Liberation Sans', sans-serif");
      observer.disconnect();
    }).observe(document, { childList: true });
  });
});

const STUDENTS = 27;
const COL = 61; // one column and its gutter, px, on a Letter page
const ROW = 20;

/* The Studio on the Report Card starter, settled on the longest report. */
async function openStudio(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.goto(page.url().replace(/#.*/, '#/reports'));
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  await expect(page.locator('.report-sheet')).toHaveCount(2);
}

/* Everyone: every student's pages on the canvas, which is what prints. */
async function showEveryone(page) {
  await page.locator('.studio-view [data-view="all"]').click();
  await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 2);
}

/* A template from the palette's Templates tab. */
async function applyTemplate(page, id) {
  await page.locator('[data-action="studioTab"][data-tab="templates"]').click();
  await page.locator(`[data-action="studioTemplate"][data-starter="${id}"]`).click();
  await page.locator('[data-action="studioTab"][data-tab="blocks"]').click();
}

async function overflowing(page) {
  return page.locator('.report-sheet').evaluateAll(sheets => {
    // The selected block's handles overhang it by design: not overflow.
    const handles = [...document.querySelectorAll('.studio-handle')];
    handles.forEach(h => (h.style.display = 'none'));
    try {
      return sheets
        .filter(s => {
          const body = s.querySelector('.sheet-body');
          const cells = [...s.querySelectorAll('.sheet-body > .sheet-cell')];
          return (
            (body && (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1)) ||
            cells.some(c => c.scrollWidth > c.clientWidth + 1)
          );
        })
        .map(s => s.querySelector('.sheet-footer')?.textContent || '?');
    } finally {
      handles.forEach(h => (h.style.display = ''));
    }
  });
}

/* Two placed blocks on one page never overlap. */
async function overlapping(page) {
  return page.locator('.report-sheet').evaluateAll(sheets =>
    sheets.flatMap(s => {
      const cells = [...s.querySelectorAll('.sheet-body > .sheet-cell:not(.sheet-off)')].map(c => ({
        id: c.dataset.block,
        r: c.getBoundingClientRect(),
      }));
      const out = [];
      cells.forEach((a, i) =>
        cells.slice(i + 1).forEach(b => {
          if (
            a.r.left < b.r.right - 1 &&
            b.r.left < a.r.right - 1 &&
            a.r.top < b.r.bottom - 1 &&
            b.r.top < a.r.bottom - 1
          )
            out.push(a.id + ' / ' + b.id);
        }),
      );
      return out;
    }),
  );
}

/* Saves a form for Demo Mode's class as a teacher's earlier session would
   have, then opens the Studio on it. */
async function openWithForm(page, makeForm) {
  await openStudio(page);
  await page.evaluate(makeForm);
  await page.reload();
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('.report-sheet').first()).toBeVisible();
}

const palette = page => page.locator('#studio-palette');
const bar = page => page.locator('.studio-bar');
const popover = page => page.locator('#studio-pop');
const cellOf = (page, id) => page.locator(`.sheet-body > .sheet-cell[data-block="${id}"]`).first();

/* Selects a block on the page and opens its Options popover. */
async function openOptions(page, id) {
  await cellOf(page, id).click();
  await expect(bar(page)).toBeVisible();
  await bar(page).locator('[data-action="studioOptions"]').click();
  await expect(popover(page)).toBeVisible();
  return popover(page);
}

/* The canvas scale and a page body's box, for pointing at grid cells. */
async function zoom(page) {
  return page.evaluate(() => parseFloat(document.getElementById('rb-preview').style.getPropertyValue('--sheet-zoom')));
}
async function body(page, index) {
  const loc = page.locator(`.sheet-zoom[data-page="${index}"] .sheet-body`);
  await loc.scrollIntoViewIfNeeded();
  return loc.boundingBox();
}

/* The palette and the canvas scroll; a point is only reachable on screen. */
async function center(locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/* Presses at `from`, moves past the pick-up threshold, then to `to`. */
async function dragStart(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(120);
}

/* Chromium writes one "/Type /Page" object per page (and one "/Type /Pages"
   tree node, which the trailing character class excludes). */
function countPages(pdf) {
  const text = pdf.toString('latin1');
  return (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

function pageBoxes(pdf) {
  const text = pdf.toString('latin1');
  return [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+(\d+)\s+(\d+)\s*\]/g)].map(m => [Number(m[1]), Number(m[2])]);
}

async function printToPdf(page) {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  return pdf;
}

test.describe('Page Studio', () => {
  test.setTimeout(90_000);

  test('opens on the longest report, two pages side by side, with the palette, the fit line and no third pane', async ({
    page,
  }) => {
    await openStudio(page);
    await expect(page.locator('#studio > *')).toHaveCount(2);
    await expect(page.locator('#studio-inspector')).toHaveCount(0);
    // 18 with Attendance (Term Questionnaire totals, 2026-10-24).
    await expect(page.locator('.studio-palette .studio-blk')).toHaveCount(18);
    await expect(page.locator('.studio-blk.placed')).toHaveCount(7);
    await expect(page.locator('.studio-palette')).not.toContainText('Letterhead');
    await expect(page.locator('.sheet-label').first()).toHaveText('Page 1 of 2');
    // The longest report in the class: Ethan Dubois has the fullest Next Steps.
    await expect(page.locator('.report-sheet').first().locator('.sheet-footer')).toContainText(
      'Ethan Dubois · Page 1 of 2',
    );
    await expect(page.locator('#studio-fit')).toHaveText('Fits for 27 of 27 students');
    // Nothing else is written on the canvas.
    await expect(page.locator('.studio-head')).toHaveText(/^Fits for 27 of 27 studentsOne StudentEveryone$/);
    await expect(page.locator('.studio-page-add')).toHaveText('+ Page');
    // No setup list, no presets, no Class Summary, no Issue.
    await expect(page.locator('.rb-setup, [data-action="rbApplyPreset"], .rb-preset-btn')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Class Summary' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Print Reports' })).toBeVisible();
    expect(await overflowing(page)).toEqual([]);
    expect(await overlapping(page)).toEqual([]);
  });

  test('every block owns its rectangle on the page grid', async ({ page }) => {
    await openStudio(page);
    const front = page.locator('.report-sheet').first();
    const cells = front.locator('.sheet-body > .sheet-cell');
    await expect(cells).toHaveCount(5);
    const rects = await cells.evaluateAll(els =>
      els.map(el => {
        const cs = getComputedStyle(el);
        return {
          id: el.dataset.block,
          x: +el.dataset.x,
          y: +el.dataset.y,
          w: +el.dataset.w,
          h: +el.dataset.h,
          position: cs.position,
          top: parseFloat(cs.top),
          width: el.offsetWidth,
        };
      }),
    );
    expect(rects.map(r => r.id)).toEqual([
      'header',
      'academic-summary',
      'teacher-narrative',
      'competency-table',
      'next-steps',
    ]);
    for (const r of rects) {
      expect(r.position).toBe('absolute');
      expect(r.top).toBe(r.y * 20);
      expect(r.width).toBe(720);
    }
    // The comment keeps its eight rows, ruled where the words stop.
    const comment = rects.find(r => r.id === 'teacher-narrative');
    expect(comment.h).toBe(8);
    await expect(front.locator('.sheet-cell[data-block="teacher-narrative"] .report-ruled-fill')).toHaveCount(1);
    expect(
      await front.locator('.sheet-cell[data-block="teacher-narrative"]').evaluate(el => el.offsetHeight),
    ).toBeGreaterThanOrEqual(160);
  });

  test('every student is one sheet, front and back, nothing pushed and nothing overflows', async ({ page }) => {
    await openStudio(page);
    await showEveryone(page);
    await expect(page.locator('#studio-fit')).toHaveText('Fits for 27 of 27 students');
    await expect(page.locator('.sheet-overflow')).toHaveCount(0);
    await expect(page.locator('.sheet-cell.sheet-pushed')).toHaveCount(0);
    const sheets = await page.locator('.sheet-student').evaluateAll(els => els.map(el => el.dataset.sheets));
    expect(sheets.every(n => n === '1')).toBe(true);
    // A thumbnail opens that student.
    await page.locator('.sheet-student[data-sid="st2"]').click();
    await expect(page.locator('.report-sheet')).toHaveCount(2);
    await expect(page.locator('.report-sheet').first().locator('.report-student-name')).toHaveText('Noor Al-Rashid');
  });

  test('the back carries the dispositions, the legend and the response docked at the bottom, wording intact', async ({
    page,
  }) => {
    await openStudio(page);
    const back = page.locator('.report-sheet').nth(1);
    await expect(back.locator('.report-learner-profile')).toHaveCount(1);
    await expect(back.locator('.report-legend')).toHaveCount(1);
    await expect(back.locator('.sheet-pinned .report-parent-response')).toHaveCount(1);
    await expect(back.locator('.sheet-pinned')).toContainText('I have reviewed this report with my child');
    await expect(back.locator('.sheet-pinned')).toContainText('I would like to schedule a meeting with the teacher');
    await expect(back.locator('.sheet-pinned')).toContainText(
      'Please review this report with your child and return this section to the school.',
    );
  });

  test('a click selects a block and shows its toolbar; × removes it; the palette puts it back', async ({ page }) => {
    await openStudio(page);
    const legend = cellOf(page, 'legend');
    await legend.click();
    await expect(legend).toHaveClass(/studio-sel/);
    await expect(page.locator('.studio-handle')).toHaveCount(3);
    await expect(bar(page)).toHaveText('Leave Off Ethan×');
    await cellOf(page, 'competency-table').click();
    await expect(bar(page)).toHaveText('Options ▾Leave Off Ethan×');
    // The letterhead: Options only, no handles.
    await cellOf(page, 'header').click();
    await expect(bar(page)).toHaveText('Options ▾');
    await expect(page.locator('.studio-handle')).toHaveCount(0);
    // The comment has no options: Leave Off and ×.
    await cellOf(page, 'teacher-narrative').click();
    await expect(bar(page)).toHaveText('Leave Off Ethan×');
    // Remove the legend; it is back in the palette.
    await legend.click();
    await bar(page).locator('[data-action="studioRemove"]').click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(0);
    await expect(page.locator('[data-action="studioBlock"][data-block="legend"]')).not.toHaveClass(/placed/);
    await expect(page.locator('#studio-live')).toHaveText('Proficiency Legend removed from the report.');
    // A palette click puts it at the first free row of the last page: under the dispositions.
    await page.locator('[data-action="studioBlock"][data-block="legend"]').click();
    await expect(legend).toHaveAttribute('data-y', '15');
    await expect(legend).toHaveClass(/studio-sel/);
    await expect(page.locator('[data-action="studioBlock"][data-block="legend"]')).toHaveClass(/placed/);
    expect(await overlapping(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
    // The form is the class's: it survives a reload.
    await page.locator('[data-action="studioBlock"][data-block="observations"]').click();
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('[data-action="studioBlock"][data-block="observations"]')).toHaveClass(/placed/);
  });

  test('the Conference Pack cuts its grade table at rows, says it pushes past the page, and Everyone outlines the pushed block', async ({
    page,
  }) => {
    await openStudio(page);
    await applyTemplate(page, 'conference-pack');
    await expect(
      page.locator('.report-block-title', { hasText: 'Assignment Grades (continued)' }).first(),
    ).toBeVisible();
    await expect(page.locator('.report-sheet').nth(1).locator('.sheet-pinned .report-parent-response')).toHaveCount(1);
    expect(await overflowing(page)).toEqual([]);
    expect(await overlapping(page)).toEqual([]);
    const link = page.locator('#studio-fit .studio-fit-link');
    await expect(link).toHaveText('Pushes past the page for 27 students');
    // The link opens Everyone: two sheets each (this term's grades), none overflowing, the pushed table outlined.
    await link.click();
    await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 4, { timeout: 30_000 });
    await expect(page.locator('.report-sheet.sheet-overflow')).toHaveCount(0);
    const marked = page.locator('.sheet-student[data-sid="st1"] .sheet-cell.sheet-pushed');
    expect(await marked.count()).toBeGreaterThan(0);
    expect(await marked.first().evaluate(el => getComputedStyle(el).outlineStyle)).toBe('solid');
    await applyTemplate(page, 'report-card');
    await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 2, { timeout: 30_000 });
  });

  test('Black ink turns the levels black', async ({ page }) => {
    await openStudio(page);
    const chip = page.locator('#rb-preview .report-section-chip-value').first();
    const before = await chip.evaluate(el => getComputedStyle(el).color);
    await page.getByRole('radio', { name: 'Black' }).click();
    await expect(page.locator('#rb-preview')).toHaveClass(/report-photocopy/);
    expect(await chip.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    await page.getByRole('radio', { name: 'Colour' }).click();
    expect(await chip.evaluate(el => getComputedStyle(el).color)).toBe(before);
  });

  test('Print Reports saves a copy of every report and lists it as Printed', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('button', { name: 'Print Reports' }).click();
    const dialog = page.locator('#issue-overlay');
    await expect(dialog).toContainText('Print 27 Reports');
    await expect(dialog).toContainText('27 students · 1 sheet each');
    await expect(dialog).toContainText('Letter, 2-sided, flip on long edge');
    await expect(dialog).not.toContainText(/Issue/);
    await expect(dialog.locator('[data-issue="go"]')).toHaveText('Print');
    await dialog.locator('[data-issue="go"]').click();
    await expect(dialog).toHaveCount(0);
    const copies = page.locator('#report-copy');
    await expect(copies).toBeVisible();
    await expect(copies.locator('option').nth(1)).toHaveText(/^Printed /);
    await copies.selectOption({ index: 1 });
    await expect(page.locator('.report-sheet')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'Print This Copy' })).toBeVisible();
    await copies.selectOption({ index: 0 });
    await expect(page.getByRole('button', { name: 'Print Reports' })).toBeVisible();
  });

  test('Print Reports sets the name on the reports: preferred or first, always the last name', async ({ page }) => {
    await openStudio(page);
    await showEveryone(page);
    const jas = page.locator('.report-student-name', { hasText: 'Gill' });
    await expect(jas.first()).toHaveText('Jas Gill');
    await page.getByRole('button', { name: 'Print Reports' }).click();
    const dialog = page.locator('#issue-overlay');
    await expect(dialog.getByRole('group', { name: 'Name' })).toBeVisible();
    await expect(dialog.getByRole('radio', { name: /Preferred Name/ })).toBeChecked();
    await dialog.getByRole('radio', { name: 'First Name', exact: true }).check();
    await expect(jas.first()).toHaveText('Jasper Gill');
    await dialog.locator('[data-issue="cancel"]').click();
    await expect(dialog).toHaveCount(0);
    // It is the Letterhead's option, so it stays chosen.
    await page.getByRole('button', { name: 'Print Reports' }).click();
    await expect(dialog.getByRole('radio', { name: 'First Name', exact: true })).toBeChecked();
  });

  test('the comment box says how the draft sits in its box, as it is typed', async ({ page }) => {
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/app\.html/, { timeout: 15000 });
    await page.goto(page.url().replace(/#.*/, '#/reports'));
    const fit = page.locator('#tq-fit-text');
    await expect(fit).toContainText(/^Fits\. \d+ lines?; room for \d+ more\.$/);
    const editor = page.locator('#tq-narrative');
    await editor.click();
    await page.keyboard.press('End');
    for (let i = 0; i < 12; i++)
      await page.keyboard.type(
        ' She keeps asking questions that move the whole class forward and writes it all down with care.',
      );
    await expect(fit).toContainText(/\d+ lines, \d+ past the box; what is under it moves down\. Nothing is cut\./);
    await page.getByRole('button', { name: 'See the Page' }).click();
    await expect(page.getByRole('tab', { name: 'Progress Reports' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#picker-label')).toHaveText('Cece Adeyemi');
    // The long comment grows its box and pushes what is under it on; nothing is cut.
    await expect(page.locator('.report-sheet').first().locator('.sheet-footer')).toContainText(
      'Cece Adeyemi · Page 1 of',
    );
    expect(await overflowing(page)).toEqual([]);
  });

  test('on a phone the pages fit the width and the palette opens from a button', async ({ page }) => {
    await openStudio(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(400);
    const box = await page.locator('.report-sheet').first().boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    await expect(page.locator('#studio-palette')).toBeHidden();
    await page.getByRole('button', { name: 'Blocks', exact: true }).click();
    await expect(page.locator('#studio-palette')).toBeVisible();
    await page.getByRole('button', { name: 'Blocks', exact: true }).click();
    await expect(page.locator('#studio-palette')).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  });
});

test.describe('Page Studio on the grid', () => {
  test.setTimeout(90_000);

  test('a half-width Assignment Grades table drops what its half cannot hold and spills nowhere', async ({ page }) => {
    await openWithForm(page, () => {
      const cid = getActiveCourse();
      let f = ReportSheets.form();
      f = ReportSheets.resize(f, 'competency-table', { w: 6 });
      f = ReportSheets.place(f, 'grade-table', { page: 0, x: 6, y: 19, w: 6, h: 13 });
      saveReportConfig(cid, { ...(getReportConfig(cid) || {}), form: f });
    });
    const front = page.locator('.report-sheet').first();
    const cell = front.locator('.sheet-cell[data-block="grade-table"]').first();
    await expect(cell).toHaveAttribute('data-w', '6');
    expect(await cell.evaluate(el => el.offsetWidth)).toBe(354);
    const table = cell.locator('table.report-grade-table');
    await expect(table.locator('th.col-area')).toBeHidden();
    await expect(table.locator('th.col-category')).toBeHidden();
    await expect(table.locator('th.col-date')).toBeVisible();
    // Half width: title, date and level.
    await expect(table.locator('th.col-score')).toBeHidden();
    await expect(table.locator('th', { hasText: 'Proficiency' })).toBeVisible();
    expect(await table.evaluate(t => t.scrollWidth <= t.parentElement.clientWidth + 1)).toBe(true);
    expect(await overflowing(page)).toEqual([]);
    expect(await overlapping(page)).toEqual([]);
  });

  test('a v4 form saved before the grid opens on it: spans become columns and nothing overlaps', async ({ page }) => {
    await openWithForm(page, () => {
      const cid = getActiveCourse();
      const form = {
        v: 4,
        id: 'report-card',
        name: 'Report Card',
        type: 'standard',
        pagesPerStudent: 'auto',
        pinned: 'parent-response',
        pages: [
          {
            rows: [
              { cells: [{ block: 'header', span: 12 }] },
              { cells: [{ block: 'academic-summary', span: 12 }] },
              { cells: [{ block: 'teacher-narrative', span: 12, height: 'fixed', lines: 6 }] },
              {
                cells: [
                  { block: 'competency-table', span: 8 },
                  { block: 'legend', span: 4 },
                ],
              },
            ],
          },
          { rows: [{ cells: [{ block: 'learner-dimensions', span: 12 }] }, { cells: [{ block: 'parent-response' }] }] },
        ],
        perStudent: {},
      };
      saveReportConfig(cid, { ...(getReportConfig(cid) || {}), form });
    });
    const front = page.locator('.report-sheet').first();
    await expect(front.locator('.sheet-cell[data-block="competency-table"]')).toHaveAttribute('data-w', '8');
    await expect(front.locator('.sheet-cell[data-block="legend"]')).toHaveAttribute('data-x', '8');
    expect(await overlapping(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
    // Stored as v5, where the blocks landed.
    const saved = await page.evaluate(() => getReportConfig(getActiveCourse()).form);
    expect(saved.v).toBe(5);
    expect(saved.pages[0].blocks.find(b => b.block === 'legend')).toMatchObject({ x: 8, w: 4 });
  });

  test('Legal gives the same layout more rows: the docked response sits lower', async ({ page }) => {
    await openStudio(page);
    const response = page.locator('.report-sheet').nth(1).locator('.sheet-pinned');
    const letterY = Number(await response.getAttribute('data-y'));
    expect(letterY).toBe(21);
    await page.getByRole('radio', { name: 'Legal' }).click();
    await expect(page.locator('.report-sheet').first()).toHaveAttribute('data-paper', 'legal');
    const legalY = Number(await page.locator('.report-sheet').nth(1).locator('.sheet-pinned').getAttribute('data-y'));
    expect(legalY).toBeGreaterThan(letterY + 10);
    await expect(
      page.locator('.report-sheet').first().locator('.sheet-cell[data-block="competency-table"]'),
    ).toHaveAttribute('data-y', '19');
    await page.getByRole('radio', { name: 'Letter' }).click();
  });
});

test.describe('Page Studio hands on the page', () => {
  test.setTimeout(90_000);

  test('a block dragged from the palette lands in the cell under the pointer, with the grid, the ghost and the placeholder showing', async ({
    page,
  }) => {
    await openStudio(page);
    // Take the legend off the back, then drag it back under the dispositions.
    await cellOf(page, 'legend').click();
    await bar(page).locator('[data-action="studioRemove"]').click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(0);
    const k = await zoom(page);
    const back = await body(page, 1);
    const from = await center(page.locator('[data-action="studioBlock"][data-block="legend"]'));
    // The pointer holds the block 24 px in and 16 px down; row 15, column 0.
    await dragStart(page, from, { x: back.x + 24 * k + 8, y: back.y + (15 * ROW + 16) * k + 4 });
    await expect(page.locator('#studio')).toHaveClass(/studio-grid-on/);
    await expect(page.locator('.studio-ghost .report-legend')).toHaveCount(1);
    await expect(page.locator('.sheet-zoom[data-page="1"] .studio-place')).toHaveCount(1);
    await expect(page.locator('.studio-place')).toHaveCSS('top', '300px');
    // Nothing is written on the placeholder.
    await expect(page.locator('.studio-place')).toHaveText('');
    // The response is docked under it, not shoved: nothing slides.
    await page.mouse.up();
    await expect(page.locator('.studio-ghost')).toHaveCount(0);
    await expect(page.locator('.studio-place')).toHaveCount(0);
    await expect(page.locator('#studio')).not.toHaveClass(/studio-grid-on/);
    const legend = cellOf(page, 'legend');
    await expect(legend).toHaveAttribute('data-y', '15');
    await expect(legend).toHaveAttribute('data-x', '0');
    await expect(legend).toHaveClass(/studio-sel/);
    await expect(page.locator('#studio-live')).toHaveText(
      'Proficiency Legend, page 2, columns 1 to 12, rows 16 to 21.',
    );
    await expect(page.locator('#studio-fit')).toHaveText('Fits for 27 of 27 students');
    expect(await overlapping(page)).toEqual([]);
  });

  test('the competency table moves beside the comment and both sit on the front; blocks under it slide while it is held', async ({
    page,
  }) => {
    await openStudio(page);
    const k = await zoom(page);
    // Half the comment and the table: drag each right-edge handle six columns left.
    await cellOf(page, 'teacher-narrative').click();
    let e = await center(page.locator('.studio-h-e'));
    await page.mouse.move(e.x, e.y);
    await page.mouse.down();
    await page.mouse.move(e.x - 6 * COL * k, e.y, { steps: 8 });
    await expect(page.locator('.studio-chip')).toHaveText('6 × 8');
    await page.mouse.up();
    await expect(cellOf(page, 'teacher-narrative')).toHaveAttribute('data-w', '6');
    await expect(page.locator('#studio-live')).toHaveText('Teacher Comment, page 1, columns 1 to 6, rows 12 to 19.');
    await cellOf(page, 'competency-table').click();
    e = await center(page.locator('.studio-h-e'));
    await page.mouse.move(e.x, e.y);
    await page.mouse.down();
    await page.mouse.move(e.x - 6 * COL * k, e.y, { steps: 8 });
    await page.mouse.up();
    await expect(cellOf(page, 'competency-table')).toHaveAttribute('data-w', '6');
    // Drag the competency table up beside it: grab it 10 px in, drop at column 6, row 11.
    const front = await body(page, 0);
    const t = await cellOf(page, 'competency-table').boundingBox();
    await dragStart(
      page,
      { x: t.x + 10, y: t.y + 10 },
      { x: front.x + 6 * COL * k + 10, y: front.y + 11 * ROW * k + 10 },
    );
    await expect(page.locator('.studio-ghost .report-competency-table')).toHaveCount(1);
    await expect(page.locator('.sheet-zoom[data-page="0"] .studio-place')).toHaveCSS('left', '366px');
    await page.mouse.up();
    const table = cellOf(page, 'competency-table');
    await expect(table).toHaveAttribute('data-x', '6');
    await expect(table).toHaveAttribute('data-y', '11');
    await expect(table).toHaveAttribute('data-w', '6');
    await expect(page.locator('.sheet-zoom[data-page="0"] .sheet-cell[data-block="teacher-narrative"]')).toHaveCount(1);
    await expect(page.locator('.sheet-zoom[data-page="0"] .sheet-cell[data-block="competency-table"]')).toHaveCount(1);
    expect(await overlapping(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
    // Held over the comment's rows, the blocks under it slide down to show the shove.
    const t2 = await table.boundingBox();
    await dragStart(page, { x: t2.x + 10, y: t2.y + 10 }, { x: front.x + 10, y: front.y + 11 * ROW * k + 10 });
    expect(await page.locator('.sheet-cell[data-shove]').count()).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.studio-ghost')).toHaveCount(0);
    await expect(page.locator('.sheet-cell[data-shove]')).toHaveCount(0);
    await expect(table).toHaveAttribute('data-x', '6');
  });

  test('the comment’s bottom edge drags to 12 rows and the lines fill it', async ({ page }) => {
    await openStudio(page);
    const k = await zoom(page);
    await cellOf(page, 'teacher-narrative').click();
    const s = await center(page.locator('.studio-h-s'));
    await page.mouse.move(s.x, s.y);
    await page.mouse.down();
    await page.mouse.move(s.x, s.y + 4 * ROW * k, { steps: 8 });
    await expect(page.locator('.studio-chip')).toHaveText('12 × 12');
    await expect(page.locator('#studio')).toHaveClass(/studio-grid-on/);
    await page.mouse.up();
    const comment = cellOf(page, 'teacher-narrative');
    await expect(comment).toHaveAttribute('data-h', '12');
    expect(await comment.evaluate(el => el.offsetHeight)).toBe(240);
    const ruled = comment.locator('.report-ruled-fill');
    expect(await ruled.evaluate(el => el.offsetHeight)).toBeGreaterThan(60);
    await expect(cellOf(page, 'competency-table')).toHaveAttribute('data-y', '23');
    expect(await overlapping(page)).toEqual([]);
  });

  test('the Options popover unchecks Evidence Count and closes with Escape', async ({ page }) => {
    await openStudio(page);
    await expect(page.locator('.report-sheet .report-ct th.report-ct-evidence')).toHaveCount(1);
    const pop = await openOptions(page, 'competency-table');
    await expect(pop).toHaveAttribute('role', 'dialog');
    await pop.getByLabel('Evidence Count').uncheck();
    await expect(page.locator('.report-sheet .report-ct th.report-ct-evidence')).toHaveCount(0);
    // Still open for the next choice; Escape closes it and focus returns to the button.
    await expect(popover(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await expect(bar(page).locator('[data-action="studioOptions"]')).toBeFocused();
    // A click elsewhere closes it too.
    await bar(page).locator('[data-action="studioOptions"]').click();
    await expect(popover(page)).toBeVisible();
    await page.locator('.studio-head').click();
    await expect(popover(page)).toHaveCount(0);
  });

  test('Leave Off hides a block for the previewed student only, and keeps its place as a dashed box', async ({
    page,
  }) => {
    await openStudio(page);
    const sid = await page.locator('.sheet-student').first().getAttribute('data-sid');
    await cellOf(page, 'teacher-narrative').click();
    const off = bar(page).locator('[data-action="studioLeaveOff"]');
    await expect(off).toHaveText('Leave Off Ethan');
    await off.click();
    await expect(bar(page).locator('[data-action="studioLeaveOff"]')).toHaveAttribute('aria-pressed', 'true');
    const cell = cellOf(page, 'teacher-narrative');
    await expect(cell).toHaveClass(/sheet-off/);
    await expect(cell.locator('.report-comment-box')).toHaveCount(0);
    // Everyone: this student has no comment box; Noor still has hers.
    await showEveryone(page);
    await expect(page.locator(`.sheet-student[data-sid="${sid}"] .report-comment-box`)).toHaveCount(0);
    await expect(page.locator('.sheet-student[data-sid="st2"] .report-comment-box')).toHaveCount(1);
    await expect(page.locator('.sheet-cell.sheet-off')).toHaveCount(1);
    // Back on the student: the toggle brings it back.
    await page.locator(`.sheet-student[data-sid="${sid}"]`).click();
    await cellOf(page, 'teacher-narrative').click();
    await bar(page).locator('[data-action="studioLeaveOff"]').click();
    await expect(cellOf(page, 'teacher-narrative').locator('.report-comment-box')).toHaveCount(1);
  });

  test('+ Page adds an empty page with Empty · Remove, which takes it away', async ({ page }) => {
    await openStudio(page);
    await page.locator('.studio-page-add').click();
    await expect(page.locator('.report-sheet')).toHaveCount(4);
    await expect(page.locator('.sheet-label').nth(2)).toHaveText('Page 3 of 4');
    const empty = page.locator('.studio-page-empty');
    await expect(empty).toHaveText('Empty · Remove');
    await expect(empty).toHaveCount(1);
    // The form has the page; a palette click lands on it.
    await page.locator('[data-action="studioBlock"][data-block="core-competencies"]').click();
    await expect(page.locator('.sheet-zoom[data-page="2"] .sheet-cell[data-block="core-competencies"]')).toHaveCount(1);
    await expect(page.locator('.studio-page-empty')).toHaveCount(0);
    await bar(page).locator('[data-action="studioRemove"]').click();
    await expect(page.locator('.studio-page-empty')).toHaveCount(1);
    await page.locator('.studio-page-empty').click();
    await expect(page.locator('.report-sheet')).toHaveCount(2);
  });

  test('the keyboard moves a focused block one cell, resizes it with Shift, and removes it with Delete', async ({
    page,
  }) => {
    await openStudio(page);
    await cellOf(page, 'teacher-narrative').focus();
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#studio-live')).toHaveText('Teacher Comment, page 1, columns 1 to 12, rows 13 to 20.');
    await expect(cellOf(page, 'teacher-narrative')).toHaveAttribute('data-y', '12');
    await expect(cellOf(page, 'teacher-narrative')).toBeFocused();
    // What was under it moved down.
    await expect(cellOf(page, 'competency-table')).toHaveAttribute('data-y', '20');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.locator('#studio-live')).toHaveText('Teacher Comment, page 1, columns 1 to 11, rows 13 to 20.');
    await expect(cellOf(page, 'teacher-narrative')).toHaveAttribute('data-w', '11');
    await page.keyboard.press('ArrowRight');
    await expect(cellOf(page, 'teacher-narrative')).toHaveAttribute('data-x', '1');
    await page.keyboard.press('Delete');
    await expect(page.locator('.sheet-cell[data-block="teacher-narrative"]')).toHaveCount(0);
    await expect(page.locator('#studio-live')).toHaveText('Teacher Comment removed from the report.');
  });

  test('a block dropped on the grey field comes off the report', async ({ page }) => {
    await openStudio(page);
    const legend = cellOf(page, 'legend');
    // The legend is on the back page, below the fold beside the student list (#372).
    await legend.scrollIntoViewIfNeeded();
    const b = await legend.boundingBox();
    const field = await page.locator('#rb-preview').boundingBox();
    await dragStart(page, { x: b.x + 10, y: b.y + 10 }, { x: field.x + 8, y: field.y + field.height / 2 });
    await expect(page.locator('.studio-ghost')).toHaveClass(/out/);
    await expect(page.locator('.studio-place')).toHaveCount(0);
    await page.mouse.up();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(0);
    await expect(page.locator('[data-action="studioBlock"][data-block="legend"]')).not.toHaveClass(/placed/);
  });
});

test.describe('Page Studio blocks worth the paper', () => {
  test.setTimeout(90_000);

  test('the palette offers the new blocks and no longer the old charts', async ({ page }) => {
    await openStudio(page);
    for (const id of ['term-glance', 'growth', 'missing-work', 'support-home'])
      await expect(palette(page).locator(`[data-block="${id}"]`)).toHaveCount(1);
    for (const id of ['section-outcomes', 'score-distribution', 'section-chart'])
      await expect(palette(page).locator(`[data-block="${id}"]`)).toHaveCount(0);
    await expect(palette(page)).toContainText('Ways to Support at Home');
    await expect(palette(page)).toContainText('This Term at a Glance');
    await expect(palette(page)).toContainText('Growth Since Last Report');
  });

  test('Growth and Next Steps always says something: Keep going for a student with nothing under Proficient', async ({
    page,
  }) => {
    await openStudio(page);
    await showEveryone(page);
    const steps = page.locator('.sheet-student[data-sid="st1"] .report-next-steps');
    await expect(steps).toContainText('Keep going');
    await expect(page.locator('.sheet-student .report-next-steps')).toHaveCount(STUDENTS);
    await expect(page.locator('#studio-fit')).toHaveText('Fits for 27 of 27 students');
  });

  test('the new blocks print the class’s data, at full and half width, and spill nowhere', async ({ page }) => {
    await openWithForm(page, () => {
      const cid = getActiveCourse();
      let f = ReportSheets.addPage(ReportSheets.form());
      f = ReportSheets.place(f, 'term-glance', { page: 2, x: 0, y: 0, w: 12, h: 5 });
      f = ReportSheets.place(f, 'growth', { page: 2, x: 0, y: 5, w: 6, h: 10 });
      f = ReportSheets.place(f, 'support-home', { page: 2, x: 6, y: 5, w: 6, h: 10 });
      saveReportConfig(cid, { ...(getReportConfig(cid) || {}), form: f });
    });
    const third = page.locator('.sheet-zoom[data-page="2"] .report-sheet');
    const glance = third.locator('.report-term-glance');
    await expect(glance).toContainText('This Term at a Glance');
    await expect(glance.locator('.report-glance-fig')).toHaveCount(6);
    await expect(glance).toContainText('Assessed');
    await expect(glance).toContainText('Strongest');
    const growth = third.locator('.report-growth');
    await expect(growth.locator('thead')).toContainText('Term 1');
    await expect(growth.locator('thead')).toContainText('Term 2');
    await expect(growth.locator('tbody tr')).not.toHaveCount(0);
    await expect(third.locator('.report-support-home li').first()).toHaveText(/^Ask Ethan to show you how he can /);
    expect(await overflowing(page)).toEqual([]);
    expect(await overlapping(page)).toEqual([]);
    // Your Own Line, from the popover.
    const pop = await openOptions(page, 'support-home');
    await pop.getByLabel('Your Own Line').fill('Read together for twenty minutes each night.');
    await pop.getByLabel('Your Own Line').dispatchEvent('change');
    await expect(third.locator('.report-support-home li').last()).toHaveText(
      'Read together for twenty minutes each night.',
    );
  });

  test('Assignment Grades shows this term by default, the last ten or all on request', async ({ page }) => {
    await openWithForm(page, () => {
      const cid = getActiveCourse();
      const f = ReportSheets.place(ReportSheets.addPage(ReportSheets.form()), 'grade-table', {
        page: 2,
        x: 0,
        y: 0,
        w: 12,
        h: 20,
      });
      saveReportConfig(cid, { ...(getReportConfig(cid) || {}), form: f });
    });
    const rows = () => page.locator('.sheet-cell[data-block="grade-table"] table.report-grade-table tbody tr');
    const term = await rows().count();
    expect(term).toBeGreaterThan(10);
    let pop = await openOptions(page, 'grade-table');
    await expect(pop.getByRole('radio', { name: 'This Term' })).toHaveAttribute('aria-checked', 'true');
    await pop.getByRole('radio', { name: 'Last 10' }).click();
    await expect(rows()).toHaveCount(10);
    pop = await openOptions(page, 'grade-table');
    await pop.getByRole('radio', { name: 'All', exact: true }).click();
    expect(await rows().count()).toBeGreaterThan(term);
    expect(await overflowing(page)).toEqual([]);
  });

  test('the legend is two by two at half width', async ({ page }) => {
    await openWithForm(page, () => {
      const cid = getActiveCourse();
      const f = ReportSheets.resize(ReportSheets.form(), 'legend', { w: 6 });
      saveReportConfig(cid, { ...(getReportConfig(cid) || {}), form: f });
    });
    const tops = await page
      .locator('.sheet-cell[data-block="legend"] .report-legend-item')
      .evaluateAll(els => els.map(el => Math.round(el.getBoundingClientRect().top)));
    expect(tops).toHaveLength(4);
    expect(tops[0]).toBe(tops[1]);
    expect(tops[2]).toBe(tops[3]);
    expect(tops[2]).toBeGreaterThan(tops[0]);
  });

  test('a comment with nothing under it rules lines to the foot of its page', async ({ page }) => {
    await openStudio(page);
    await applyTemplate(page, 'interim-update');
    await cellOf(page, 'legend').click();
    await bar(page).locator('[data-action="studioRemove"]').click();
    await cellOf(page, 'next-steps').click();
    await bar(page).locator('[data-action="studioRemove"]').click();
    const comment = cellOf(page, 'teacher-narrative');
    await expect(comment).toHaveAttribute('data-h', '35');
    expect(await comment.locator('.report-ruled-fill').evaluate(el => el.offsetHeight)).toBeGreaterThan(400);
    expect(await overflowing(page)).toEqual([]);
  });
});

test.describe('Page Studio options', () => {
  test.setTimeout(90_000);

  test('Show checkboxes change the competency table and the letterhead', async ({ page }) => {
    await openStudio(page);
    let pop = await openOptions(page, 'competency-table');
    await pop.getByLabel('Assignment Names').check();
    await expect(page.locator('.report-sheet .report-ct .report-ct-note').first()).toBeVisible();
    // The letterhead's student number.
    const meta = page.locator('.report-sheet .report-header-meta').first();
    await expect(meta).toContainText('Student No.');
    pop = await openOptions(page, 'header');
    await pop.getByLabel('Student Number').uncheck();
    await expect(page.locator('.report-sheet .report-header-meta').first()).not.toContainText('Student No.');
    // The choices are the class's: they survive a reload.
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('.report-sheet .report-header-meta').first()).not.toContainText('Student No.');
    await expect(page.locator('.report-sheet .report-ct .report-ct-note').first()).toBeVisible();
  });

  test('dispositions show descriptions when asked; Growth and Next Steps takes 0–3 I-can statements', async ({
    page,
  }) => {
    await openStudio(page);
    await expect(page.locator('.report-sheet .report-dim-note')).toHaveCount(0);
    let pop = await openOptions(page, 'learner-dimensions');
    await pop.getByLabel('Descriptions').check();
    await expect(page.locator('.report-sheet .report-dim-note').first()).toBeVisible();
    await expect(popover(page).getByRole('radiogroup', { name: 'I-can Statements' })).toHaveCount(0);
    pop = await openOptions(page, 'next-steps');
    const group = pop.getByRole('radiogroup', { name: 'I-can Statements' });
    await expect(group.getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true');
    await group.getByRole('radio', { name: 'None' }).click();
    // A choice closes the popover; the block shows the change.
    await expect(popover(page)).toHaveCount(0);
    await expect(page.locator('.report-sheet .report-next-steps .report-ican-list')).toHaveCount(0);
  });

  test('the no-evidence rule is a choice in the popover', async ({ page }) => {
    await openStudio(page);
    const pop = await openOptions(page, 'competency-table');
    const rule = pop.getByRole('radiogroup', { name: 'When a student has no evidence' });
    await expect(rule.getByRole('radio', { name: 'Show “No Evidence”' })).toHaveAttribute('aria-checked', 'true');
    await rule.getByRole('radio', { name: 'Hide Row' }).click();
    await expect(popover(page)).toHaveCount(0);
    const again = await openOptions(page, 'competency-table');
    await expect(again.getByRole('radio', { name: 'Hide Row' })).toHaveAttribute('aria-checked', 'true');
  });

  test('a text block prints what the teacher writes', async ({ page }) => {
    await openStudio(page);
    await page.locator('[data-action="studioBlock"][data-block="text-block"]').scrollIntoViewIfNeeded();
    await page.locator('[data-action="studioBlock"][data-block="text-block"]').click();
    // The back is full: the block takes a new page.
    await expect(page.locator('.sheet-zoom[data-page="2"] .sheet-cell[data-block="text-block"]')).toHaveCount(1);
    await expect(cellOf(page, 'text-block')).toHaveClass(/studio-sel/);
    let pop = await openOptions(page, 'text-block');
    await pop.getByLabel('Title').fill('Upcoming Dates');
    await pop.getByLabel('Title').dispatchEvent('change');
    pop = popover(page);
    await pop.getByLabel('Text', { exact: true }).fill('Science fair: Nov 30.\nConferences: Dec 4.');
    await pop.getByLabel('Text', { exact: true }).dispatchEvent('change');
    const block = page.locator('.report-sheet .report-text-block');
    await expect(block).toContainText('Upcoming Dates');
    await expect(block).toContainText('Conferences: Dec 4.');
  });

  test('Pages per student: 1 cuts the back and names what does not fit', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('radio', { name: '1', exact: true }).click();
    await expect(page.getByRole('radio', { name: '1', exact: true })).toHaveAttribute('aria-checked', 'true');
    const front = page.locator('.report-sheet').first();
    await expect(page.locator('.report-sheet').nth(1)).toHaveClass(/sheet-blank-side/);
    await expect(front.locator('.sheet-capped')).toHaveText(
      'Doesn’t fit · Learning Dispositions, Proficiency Legend, Parent / Guardian Response',
    );
    await expect(page.locator('#studio-fit')).toHaveText('Cut for 27 students');
    await page.getByRole('radio', { name: 'Auto' }).click();
    await expect(page.locator('.sheet-capped')).toHaveCount(0);
    await expect(page.locator('.report-sheet').nth(1).locator('.sheet-pinned .report-parent-response')).toHaveCount(1);
    await expect(page.locator('#studio-fit')).toHaveText('Fits for 27 of 27 students');
  });
});

test.describe('Page Studio templates', () => {
  test.setTimeout(90_000);

  test('a starter applies, and Undo puts the layout back', async ({ page }) => {
    await openStudio(page);
    await palette(page).getByRole('tab', { name: 'Templates' }).click();
    await expect(palette(page)).toContainText('Your Templates');
    await expect(palette(page)).toContainText('None yet');
    await palette(page).getByRole('button', { name: 'Interim Update', exact: true }).click();
    await expect(page.locator('.report-sheet .report-learner-profile')).toHaveCount(0);
    await expect(page.locator('#undo-toast')).toContainText('Applied Interim Update');
    await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.report-sheet .report-learner-profile')).toHaveCount(1);
  });

  test('Save as Template keeps the layout under a name; it applies later and deletes with Undo', async ({ page }) => {
    await openStudio(page);
    // Change the layout: add Core Competencies.
    await page.locator('[data-action="studioBlock"][data-block="core-competencies"]').scrollIntoViewIfNeeded();
    await page.locator('[data-action="studioBlock"][data-block="core-competencies"]').click();
    await expect(page.locator('.sheet-cell[data-block="core-competencies"]')).toHaveCount(1);
    // Save it.
    await page.getByRole('button', { name: 'Save as Template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save as Template' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').fill('Science 8 with Core Competencies');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      palette(page).getByRole('button', { name: 'Science 8 with Core Competencies', exact: true }),
    ).toBeVisible();
    // Apply a starter, then the saved one.
    await palette(page).getByRole('button', { name: 'Report Card', exact: true }).click();
    await expect(page.locator('.sheet-cell[data-block="core-competencies"]')).toHaveCount(0);
    await palette(page).getByRole('button', { name: 'Science 8 with Core Competencies', exact: true }).click();
    await expect(page.locator('.sheet-cell[data-block="core-competencies"]')).toHaveCount(1);
    // It is kept: still listed after a reload.
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await palette(page).getByRole('tab', { name: 'Templates' }).click();
    await expect(
      palette(page).getByRole('button', { name: 'Science 8 with Core Competencies', exact: true }),
    ).toBeVisible();
    // Delete, then Undo.
    await palette(page).getByRole('button', { name: 'Delete Science 8 with Core Competencies' }).click();
    await expect(
      palette(page).getByRole('button', { name: 'Science 8 with Core Competencies', exact: true }),
    ).toHaveCount(0);
    await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(
      palette(page).getByRole('button', { name: 'Science 8 with Core Competencies', exact: true }),
    ).toBeVisible();
  });

  test('the dialog cancels with Escape and needs a name', async ({ page }) => {
    await openStudio(page);
    await page.getByRole('button', { name: 'Save as Template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save as Template' });
    await expect(dialog.getByLabel('Name')).toBeFocused();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save as Template' })).toBeFocused();
  });
});

test('below 1240 px wide, Save as Template is in the Templates tab and the toolbar fits', async ({ page }) => {
  await openStudio(page);
  await page.setViewportSize({ width: 1100, height: 800 });
  await expect(page.locator('#tb-save-template')).toBeHidden();
  const right = await page.locator('#tb-print-btn').evaluate(el => el.getBoundingClientRect().right);
  expect(right).toBeLessThanOrEqual(1100);
  await palette(page).getByRole('tab', { name: 'Templates' }).click();
  await palette(page).getByRole('button', { name: 'Save as Template' }).click();
  await expect(page.getByRole('dialog', { name: 'Save as Template' })).toBeVisible();
});

test.describe('Printed progress reports', () => {
  test.setTimeout(90_000);

  test('the Report Card prints two Letter pages per student', async ({ page }) => {
    await openStudio(page);
    await showEveryone(page);
    const pdf = await printToPdf(page);
    expect(countPages(pdf)).toBe(STUDENTS * 2);
    for (const [w, h] of pageBoxes(pdf)) {
      expect([w, h]).toEqual([612, 792]);
    }
  });

  test('the Interim Update prints one side per student, with its back left blank for duplex', async ({ page }) => {
    await openStudio(page);
    await applyTemplate(page, 'interim-update');
    await showEveryone(page);
    expect(countPages(await printToPdf(page))).toBe(STUDENTS * 2);
    await expect(page.locator('.report-sheet .report-legend')).toHaveCount(STUDENTS);
  });

  test('the letterhead names the class, block, report, term dates and student number', async ({ page }) => {
    await openStudio(page);
    const header = page.locator('.report-sheet, .report-student').first().locator('.report-header');
    await expect(header.locator('.report-course-title')).toHaveText('Science 8 · Block A');
    await expect(header.locator('.report-student-name')).toHaveText('Ethan Dubois');
    const meta = header.locator('.report-header-meta');
    await expect(meta.locator('.report-period')).toHaveText(
      await page.locator('#report-period option:checked').innerText(),
    );
    await expect(meta).toContainText(/\w{3} \d{1,2} – \w{3} \d{1,2}, \d{4}/);
    await expect(meta).toContainText(/Student No\. STU-\d+/);
    await expect(page.locator('.report-sheet').first().locator('.sheet-footer')).toContainText(
      'Ethan Dubois · Page 1 of 2',
    );
  });

  test('levels print as dots and a word in black', async ({ page }) => {
    await openStudio(page);
    const chip = page.locator('#rb-preview .report-section-chip-value').first();
    const dim = page.locator('#rb-preview .report-learner-dim-value').first();
    await expect(chip).toContainText(/[●○]{4}/);
    await expect(dim).toContainText(/[●○]{4}/);
    await page.emulateMedia({ media: 'print' });
    expect(await chip.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    expect(await dim.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    await page.emulateMedia({ media: 'screen' });
  });

  test('Legal paper prints a 14 in page and is remembered for the class on this device', async ({ page }) => {
    await openStudio(page);
    await showEveryone(page);
    await page.getByRole('radio', { name: 'Legal' }).click();
    const pdf = await printToPdf(page);
    const boxes = pageBoxes(pdf);
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toEqual([612, 1008]);
    expect(countPages(pdf)).toBeLessThanOrEqual(STUDENTS * 2);

    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.getByRole('radio', { name: 'Legal' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Letter' }).click();
    for (const box of pageBoxes(await printToPdf(page))) expect(box).toEqual([612, 792]);
  });

  test('a dimension the teacher did not rate is left off the printed report', async ({ page }) => {
    await openStudio(page);
    await expect(page.locator('#rb-preview')).not.toContainText('Not Assessed');
  });
});
