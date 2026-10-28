/**
 * Reports: Page Studio and the printed reports (teacher/report-studio.js,
 * report-sheets.js, report-blocks.js, page-reports.js). Demo Mode's Science 8
 * class, 27 students. The palette, the Front and Back as rows at paper
 * size, the fit line, the selected block's card (Lines, Size, Move,
 * Options, Leave Off, Remove), Undo, Sides, + Page, templates, Print
 * Reports with its saved copy, and page counts from Chromium's print engine.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

/* Fit and page counts depend on text width. The app's font stack is the
   system font: SF Pro on a Mac, DejaVu Sans (much wider) on the Linux CI
   runner. Arial is on macOS and Windows, and Linux renders it with the
   metric-identical Liberation Sans, so these tests lay out the same
   everywhere. */
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

/* The Studio on the Report Card starter, on the longest report. */
async function openStudio(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(r => window.Router.navigate(r), '/reports');
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
  return page.locator('.report-sheet').evaluateAll(sheets =>
    sheets
      .filter(s => {
        const body = s.querySelector('.sheet-body');
        const cells = [...s.querySelectorAll('.sheet-cell')];
        return (
          (body && (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1)) ||
          cells.some(c => c.scrollWidth > c.clientWidth + 1)
        );
      })
      .map(s => s.querySelector('.sheet-label, .report-student-name')?.textContent || '?'),
  );
}

/* Two placed blocks on one page never overlap. */
async function overlapping(page) {
  return page.locator('.report-sheet').evaluateAll(sheets =>
    sheets.flatMap(s => {
      const cells = [...s.querySelectorAll('.sheet-cell:not(.sheet-off)')].map(c => ({
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

/* The rows of a side as "block" or "a+b" strings. */
async function rowsOf(page, side) {
  return page
    .locator(`.sheet-zoom[data-side="${side}"] .sheet-row`)
    .evaluateAll(rows =>
      rows.map(r =>
        [...r.querySelectorAll('.sheet-cell')]
          .map(c => c.dataset.block + (c.dataset.size === 'half' ? '/half' : ''))
          .join('+'),
      ),
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
const cellOf = (page, id) => page.locator(`.sheet-cell[data-block="${id}"]`).first();
const undo = page => page.locator('#undo-toast').getByRole('button', { name: 'Undo' });
/* The previewed student (the longest report), as the letterhead names them. */
const previewName = page => page.locator('.report-sheet').first().locator('.report-student-name').innerText();
const firstName = async page => (await previewName(page)).split(' ')[0];

/* Selects a block on the page and opens its Options popover. */
async function openOptions(page, id) {
  await cellOf(page, id).click();
  await expect(bar(page)).toBeVisible();
  await bar(page).locator('[data-action="studioOptions"]').click();
  await expect(popover(page)).toBeVisible();
  return popover(page);
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

  test('opens on the longest report, Front and Back side by side, with the palette, the fit line and no third pane', async ({
    page,
  }) => {
    await openStudio(page);
    await expect(page.locator('#studio > *')).toHaveCount(2);
    await expect(page.locator('#studio-inspector')).toHaveCount(0);
    await expect(page.locator('.studio-palette .studio-blk')).toHaveCount(16);
    await expect(page.locator('.studio-blk.placed')).toHaveCount(7);
    await expect(page.locator('.studio-palette')).not.toContainText('Letterhead');
    // No size badges, no grid, no handles.
    await expect(page.locator('.studio-sz, .studio-handle, .studio-grip')).toHaveCount(0);
    await expect(page.locator('.sheet-label').nth(0)).toHaveText('Front');
    await expect(page.locator('.sheet-label').nth(1)).toHaveText('Back');
    // The longest report in the class, not the first on the roster.
    await expect(page.locator('.report-sheet').first().locator('.report-student-name')).not.toHaveText('Cece Adeyemi');
    await expect(page.locator('#studio-fit')).toHaveText('1 sheet for all 27 students');
    await expect(page.locator('.studio-head')).toHaveText(/^1 sheet for all 27 studentsOne StudentEveryone$/);
    await expect(page.locator('.studio-page-add')).toHaveText('+ Page');
    // Sides, not Pages, in the toolbar.
    await expect(page.getByRole('radiogroup', { name: 'Sides' })).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Front and Back' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#report-pages')).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Class Summary' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Print Reports' })).toBeVisible();
    expect(await overflowing(page)).toEqual([]);
    expect(await overlapping(page)).toEqual([]);
  });

  test('the Report Card is rows: the Front ends in a Side by Side pair, the Back docks the Response at the bottom', async ({
    page,
  }) => {
    await openStudio(page);
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    expect(await rowsOf(page, 1)).toEqual(['grade-table', 'parent-response']);
    // Row cells are 720 wide, pair cells 354; no cell is absolutely placed.
    const widths = await page
      .locator('.sheet-zoom[data-side="0"] .sheet-cell')
      .evaluateAll(cells => cells.map(c => [c.dataset.block, c.offsetWidth, getComputedStyle(c).position]));
    expect(widths).toEqual([
      ['header', 720, 'relative'],
      ['proficiency', 720, 'relative'],
      ['legend', 720, 'relative'],
      ['teacher-narrative', 720, 'relative'],
      ['term-attendance', 354, 'relative'],
      ['missing-work', 354, 'relative'],
    ]);
    const back = page.locator('.sheet-zoom[data-side="1"] .report-sheet');
    await expect(back.locator('.sheet-pinned .report-parent-response')).toHaveCount(1);
    const docked = await back.locator('.sheet-pinned').evaluate(el => {
      const body = el.closest('.sheet-body').getBoundingClientRect();
      return Math.round(body.bottom - el.getBoundingClientRect().bottom);
    });
    expect(docked).toBe(0);
    await expect(back.locator('.sheet-pinned')).toContainText('I have reviewed this report with my child');
    await expect(back.locator('.sheet-pinned')).toContainText(
      'Please review this report with your child and return this section to the school.',
    );
    // No running footer; no Page 1 of 2.
    await expect(page.locator('.sheet-footer')).toHaveCount(0);
  });

  test('every student is one sheet, nothing continues and nothing overflows; a thumbnail opens that student', async ({
    page,
  }) => {
    await openStudio(page);
    await showEveryone(page);
    await expect(page.locator('#studio-fit')).toHaveText('1 sheet for all 27 students');
    await expect(page.locator('.sheet-overflow')).toHaveCount(0);
    const sheets = await page.locator('.sheet-student').evaluateAll(els => els.map(el => el.dataset.sheets));
    expect(sheets.every(n => n === '1')).toBe(true);
    expect(await overflowing(page)).toEqual([]);
    await page.locator('.sheet-student[data-sid="st2"]').click();
    await expect(page.locator('.report-sheet')).toHaveCount(2);
    await expect(page.locator('.report-sheet').first().locator('.report-student-name')).toHaveText('Noor Al-Rashid');
  });

  test('a click selects a block and shows its card in the gutter; Remove takes it off with Undo; the palette finds it or adds it', async ({
    page,
  }) => {
    await openStudio(page);
    const legend = cellOf(page, 'legend');
    await legend.click();
    await expect(legend).toHaveClass(/studio-sel/);
    await expect(bar(page)).toContainText('On the Front');
    await expect(bar(page).locator('.studio-bar-name')).toHaveText('Proficiency Legend');
    await expect(bar(page)).toContainText('Size');
    await expect(bar(page).getByRole('radio', { name: 'Row' })).toHaveAttribute('aria-checked', 'true');
    await expect(bar(page).getByRole('button', { name: 'Move Up' })).toBeEnabled();
    await expect(bar(page).getByRole('button', { name: 'Move Down' })).toBeEnabled();
    await expect(bar(page).getByRole('button', { name: 'Move to Back' })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Leave Off ' + (await firstName(page)) })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Remove' })).toBeVisible();
    await expect(bar(page).locator('[data-action="studioOptions"]')).toHaveCount(0);
    // The card sits to the right of the pages, level with the block.
    const cardBox = await bar(page).boundingBox();
    const pageRight = await page
      .locator('.sheet-zoom')
      .evaluateAll(els => Math.max(...els.map(e => e.getBoundingClientRect().right)));
    const legendBox = await legend.boundingBox();
    expect(cardBox.x).toBeGreaterThan(pageRight);
    expect(Math.abs(cardBox.y - legendBox.y)).toBeLessThan(4);
    // The letterhead: Options and a line, nothing to move.
    await cellOf(page, 'header').click();
    await expect(bar(page)).toContainText('Always first on the Front');
    await expect(bar(page).locator('[data-action="studioOptions"]')).toHaveCount(1);
    await expect(bar(page).getByRole('button', { name: 'Remove' })).toHaveCount(0);
    // The Response: Comment Lines, always last.
    await cellOf(page, 'parent-response').click();
    await expect(bar(page)).toContainText('On the Back');
    await expect(bar(page)).toContainText('Always last on the Back');
    await expect(bar(page)).toContainText('Comment Lines');
    // Remove the legend: Undo offered; the palette untick; Undo puts it back.
    await legend.click();
    await bar(page).getByRole('button', { name: 'Remove' }).click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(0);
    await expect(page.locator('[data-action="studioBlock"][data-block="legend"]')).not.toHaveClass(/placed/);
    await expect(page.locator('#studio-live')).toHaveText('Proficiency Legend removed from the report.');
    await expect(page.locator('#undo-toast')).toContainText('Removed Proficiency Legend');
    await undo(page).click();
    expect(await rowsOf(page, 0)).toContain('legend');
    // The palette finds a block on the report (never removes it).
    await page.locator('[data-action="studioBlock"][data-block="legend"]').click();
    await expect(legend).toHaveClass(/studio-sel/);
    expect(await rowsOf(page, 0)).toContain('legend');
    // A block from the palette lands in its own row at the end of the Front when it has room.
    await page.locator('[data-action="studioBlock"][data-block="support-home"]').click();
    expect((await rowsOf(page, 0)).slice(-1)).toEqual(['support-home']);
    await expect(cellOf(page, 'support-home')).toHaveClass(/studio-sel/);
    await expect(page.locator('#undo-toast')).toContainText('Added Ways to Support at Home');
    await expect(page.locator('[data-action="studioBlock"][data-block="support-home"]')).toHaveClass(/placed/);
    expect(await overlapping(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
    // The form is the class's: it survives a reload.
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('[data-action="studioBlock"][data-block="support-home"]')).toHaveClass(/placed/);
  });

  test('a block with no room on either side is greyed in the palette with the reason; one the Front cannot hold goes to the Back', async ({
    page,
  }) => {
    await openStudio(page);
    // Reflection: My Habits is about 630px: no side has that room.
    const habits = page.locator('[data-action="studioBlock"][data-block="student-reflection-habits"]');
    await habits.scrollIntoViewIfNeeded();
    await expect(habits).toHaveClass(/nofit/);
    await expect(habits).toContainText('No room on either side');
    await expect(habits).toHaveAttribute('aria-disabled', 'true');
    await habits.click({ force: true });
    await expect(page.locator('.sheet-cell[data-block="student-reflection-habits"]')).toHaveCount(0);
    // Take the grades off the Back: the reflection now has room there, not on the Front.
    await cellOf(page, 'grade-table').click();
    await bar(page).getByRole('button', { name: 'Remove' }).click();
    await expect(habits).not.toHaveClass(/nofit/);
    await habits.click({ force: true });
    expect(await rowsOf(page, 1)).toEqual(['student-reflection-habits', 'parent-response']);
    await expect(page.locator('#undo-toast')).toContainText(
      'Added Reflection: My Habits to the Back. The Front is full',
    );
    expect(await overflowing(page)).toEqual([]);
  });

  test('Side by Side pairs a block with its lone Side by Side neighbour; Row splits the pair; the pair takes the taller height', async ({
    page,
  }) => {
    await openStudio(page);
    await cellOf(page, 'legend').click();
    await bar(page).getByRole('radio', { name: 'Side by Side' }).click();
    expect(await rowsOf(page, 0)).toContain('legend/half');
    await expect(cellOf(page, 'legend')).toHaveCSS('width', '354px');
    await expect(page.locator('#undo-toast')).toContainText('Proficiency Legend: Side by Side');
    await cellOf(page, 'proficiency').click();
    await bar(page).getByRole('radio', { name: 'Side by Side' }).click();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency/half+legend/half',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    const heights = await page
      .locator('.sheet-row')
      .nth(1)
      .locator('.sheet-cell')
      .evaluateAll(cells => cells.map(c => c.offsetHeight));
    expect(heights[0]).toBe(heights[1]);
    expect(await overlapping(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
    await cellOf(page, 'proficiency').click();
    await bar(page).getByRole('radio', { name: 'Row' }).click();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend/half',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
  });

  test('Move Up, Move Down and Move to Back move a block’s row, each with Undo; the keyboard moves and removes too', async ({
    page,
  }) => {
    await openStudio(page);
    await cellOf(page, 'teacher-narrative').click();
    await bar(page).getByRole('button', { name: 'Move Up' }).click();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'teacher-narrative',
      'legend',
      'term-attendance/half+missing-work/half',
    ]);
    await expect(page.locator('#undo-toast')).toContainText('Moved Teacher Comment up');
    await undo(page).click();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    await cellOf(page, 'legend').click();
    await bar(page).getByRole('button', { name: 'Move to Back' }).click();
    expect(await rowsOf(page, 1)).toEqual(['grade-table', 'legend', 'parent-response']);
    await expect(page.locator('#studio-live')).toHaveText('Proficiency Legend, Back, row 2 of 3.');
    await cellOf(page, 'legend').click();
    await expect(bar(page)).toContainText('On the Back');
    await expect(bar(page).getByRole('button', { name: 'Move to Front' })).toBeVisible();
    await expect(bar(page).getByRole('button', { name: 'Move Down' })).toBeDisabled();
    // The keyboard.
    await cellOf(page, 'teacher-narrative').focus();
    await page.keyboard.press('ArrowUp');
    await expect(page.locator('#studio-live')).toHaveText('Teacher Comment, Front, row 2 of 4.');
    await expect(cellOf(page, 'teacher-narrative')).toBeFocused();
    await page.keyboard.press('Delete');
    await expect(page.locator('.sheet-cell[data-block="teacher-narrative"]')).toHaveCount(0);
    await expect(page.locator('#studio-live')).toHaveText('Teacher Comment removed from the report.');
  });

  test('Lines sets the comment’s ruled room for a student with no comment and the questionnaire’s box', async ({
    page,
  }) => {
    await openStudio(page);
    await cellOf(page, 'teacher-narrative').click();
    await expect(bar(page).locator('.studio-bar-step b')).toHaveText('10');
    await bar(page).getByRole('button', { name: 'More lines' }).click();
    await expect(bar(page).locator('.studio-bar-step b')).toHaveText('11');
    await expect(page.locator('#undo-toast')).toContainText('Teacher Comment: 11 lines');
    // Leave Ethan's comment off: nothing prints; the box for a student with
    // no comment is the lines.
    const room = await page.evaluate(() => {
      const st = getStudents(getActiveCourse())[0];
      const ctx = ReportBlocks.reportContext();
      ctx.narrativeOverride = '';
      return ReportSheets.describeStudent(getActiveCourse(), st, ctx, {
        form: getReportConfig(getActiveCourse()).form,
      });
    });
    expect(room.noComment).toBe(true);
    expect(room.room).toBe(11);
    const box = await page.evaluate(() => {
      const st = getStudents(getActiveCourse())[0];
      const ctx = ReportBlocks.reportContext();
      ctx.narrativeOverride = '';
      const html = ReportBlocks.renderReportBlock('teacher-narrative', getActiveCourse(), st, ctx, {});
      return html;
    });
    expect(box).toBe('');
    await bar(page).getByRole('button', { name: 'Fewer lines' }).click();
    await expect(bar(page).locator('.studio-bar-step b')).toHaveText('10');
  });

  test('Sides: Front Only folds the Back onto the Front and the fit line says what that costs; Undo puts the Back back', async ({
    page,
  }) => {
    await openStudio(page);
    await page.getByRole('radio', { name: 'Front Only' }).click();
    await expect(page.getByRole('radio', { name: 'Front Only' })).toHaveAttribute('aria-checked', 'true');
    // Too much for one side: the Response docks, the rows past the limit
    // continue on a side of their own for this student.
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
      'parent-response',
    ]);
    await expect(page.locator('.sheet-zoom').nth(1).locator('.sheet-cell[data-block="grade-table"]')).toHaveCount(1);
    await expect(page.locator('.sheet-label').nth(0)).toHaveText('Front');
    await expect(page.locator('.sheet-label').nth(1)).toHaveText('Continued');
    await expect(page.locator('#studio-fit .studio-fit-link')).toHaveText('Continues on the back for 27 students');
    expect(await overflowing(page)).toEqual([]);
    await undo(page).click();
    await expect(page.getByRole('radio', { name: 'Front and Back' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#studio-fit')).toHaveText('1 sheet for all 27 students');
    // Interim Update is one side: the fit line says so.
    await applyTemplate(page, 'interim-update');
    await expect(page.locator('#studio-fit')).toHaveText('Front only · 1 page for all 27 students');
    await expect(page.locator('.sheet-label').nth(1)).toHaveText('Blank');
  });

  test('the Conference Pack’s grade table does not fit its side: it continues for every student', async ({ page }) => {
    await openStudio(page);
    await applyTemplate(page, 'conference-pack');
    // Every assessment as rows: more than the back holds above the Response,
    // so it continues (a block taller than a side would print after the report).
    await expect(page.locator('.sheet-label').nth(2)).toHaveText(/^(Continued|After the Report)$/);
    await expect(page.locator('.report-grades .report-prof-meta').first()).toContainText('All ·');
    await expect(page.locator('.sheet-zoom[data-side="1"] .sheet-pinned .report-parent-response')).toHaveCount(1);
    expect(await overflowing(page)).toEqual([]);
    expect(await overlapping(page)).toEqual([]);
    await expect(page.locator('#studio-fit .studio-fit-link')).toHaveText(/^\d sheets for 27 students$/);
    await page.locator('#studio-fit .studio-fit-link').click();
    await expect(page.locator('.studio-view [data-view="all"]')).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.report-sheet.sheet-overflow')).toHaveCount(0);
    await applyTemplate(page, 'report-card');
    await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 2, { timeout: 30_000 });
  });

  test('Black ink turns the levels black', async ({ page }) => {
    await openStudio(page);
    const level = page.locator('#rb-preview .report-prof td.report-prof-n').first();
    const before = await level.evaluate(el => getComputedStyle(el).color);
    await page.getByRole('radio', { name: 'Black' }).click();
    await expect(page.locator('#rb-preview')).toHaveClass(/report-photocopy/);
    expect(await level.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    await page.getByRole('radio', { name: 'Colour' }).click();
    expect(await level.evaluate(el => getComputedStyle(el).color)).toBe(before);
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
    await page.getByRole('button', { name: 'Print Reports' }).click();
    await expect(dialog.getByRole('radio', { name: 'First Name', exact: true })).toBeChecked();
  });

  test('the comment box says how the draft sits in its lines, as it is typed; a long comment continues, nothing is cut', async ({
    page,
  }) => {
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.evaluate(r => window.Router.navigate(r), '/reports');
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
    await expect(page.locator('.report-sheet').first().locator('.report-student-name')).toHaveText('Cece Adeyemi');
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
  });

  test('a v5 grid form saved before the rows opens on them: same-row halves become a pair, nothing overlaps', async ({
    page,
  }) => {
    await openWithForm(page, () => {
      const cid = getActiveCourse();
      const rc = Object.assign({}, getReportConfig(cid) || {});
      rc.form = {
        v: 5,
        id: 'report-card',
        name: 'Report Card',
        pages: [
          {
            blocks: [
              { block: 'header', x: 0, y: 0, w: 12 },
              { block: 'teacher-narrative', x: 0, y: 5, w: 12, h: 13 },
              { block: 'proficiency', x: 0, y: 18, w: 6, h: 13 },
              { block: 'legend', x: 6, y: 18, w: 6, h: 6 },
            ],
          },
          { blocks: [{ block: 'parent-response', x: 0, y: 30, w: 12, h: 10 }] },
        ],
        pinned: 'parent-response',
        perStudent: {},
      };
      saveReportConfig(cid, rc);
    });
    expect(await rowsOf(page, 0)).toEqual(['header', 'teacher-narrative', 'proficiency/half+legend/half']);
    expect(await rowsOf(page, 1)).toEqual(['parent-response']);
    await cellOf(page, 'teacher-narrative').click();
    await expect(bar(page).locator('.studio-bar-step b')).toHaveText('10');
    expect(await overlapping(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
  });

  test('Legal gives the same rows a taller side', async ({ page }) => {
    await openStudio(page);
    const letter = await page
      .locator('.sheet-zoom[data-side="1"] .sheet-pinned')
      .evaluate(el =>
        Math.round(el.getBoundingClientRect().top - el.closest('.sheet-body').getBoundingClientRect().top),
      );
    await page.getByRole('radio', { name: 'Legal' }).click();
    await expect(page.locator('.report-sheet[data-paper="legal"]')).toHaveCount(2);
    const legal = await page
      .locator('.sheet-zoom[data-side="1"] .sheet-pinned')
      .evaluate(el =>
        Math.round(el.getBoundingClientRect().top - el.closest('.sheet-body').getBoundingClientRect().top),
      );
    expect(legal - letter).toBeGreaterThan(170);
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    await page.getByRole('radio', { name: 'Letter' }).click();
  });

  test('the Options popover unchecks Assessed Count and closes with Escape', async ({ page }) => {
    await openStudio(page);
    await expect(page.locator('.report-sheet .report-prof thead th')).toHaveCount(5);
    const pop = await openOptions(page, 'proficiency');
    await expect(pop).toHaveAttribute('role', 'dialog');
    await pop.getByLabel('Assessed Count').uncheck();
    await expect(page.locator('.report-sheet .report-prof thead th')).toHaveCount(4);
    await expect(page.locator('#undo-toast')).toContainText('Changed Proficiency options');
    await expect(popover(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(popover(page)).toHaveCount(0);
    await expect(bar(page).locator('[data-action="studioOptions"]')).toBeFocused();
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
    const first = await firstName(page);
    await expect(off).toHaveText('Leave Off ' + first);
    await off.click();
    await expect(page.locator('#undo-toast')).toContainText('Left off Teacher Comment for ' + first);
    await expect(bar(page).locator('[data-action="studioLeaveOff"]')).toHaveAttribute('aria-pressed', 'true');
    const cell = cellOf(page, 'teacher-narrative');
    await expect(cell).toHaveClass(/sheet-off/);
    await expect(cell.locator('.report-comment-box')).toHaveCount(0);
    await showEveryone(page);
    await expect(page.locator(`.sheet-student[data-sid="${sid}"] .report-comment-box`)).toHaveCount(0);
    await expect(page.locator('.sheet-student[data-sid="st2"] .report-comment-box')).toHaveCount(1);
    await expect(page.locator('.sheet-cell.sheet-off')).toHaveCount(1);
    await page.locator(`.sheet-student[data-sid="${sid}"]`).click();
    await cellOf(page, 'teacher-narrative').click();
    await bar(page).locator('[data-action="studioLeaveOff"]').click();
    await expect(cellOf(page, 'teacher-narrative').locator('.report-comment-box')).toHaveCount(1);
  });

  test('+ Page adds an empty side with Empty · Remove, which takes it away', async ({ page }) => {
    await openStudio(page);
    await page.locator('.studio-page-add').click();
    await expect(page.locator('.report-sheet')).toHaveCount(4);
    await expect(page.locator('.sheet-label').nth(2)).toHaveText('Page 3');
    await expect(page.locator('.sheet-label').nth(3)).toHaveText('Blank');
    const empty = page.locator('.studio-page-empty');
    await expect(empty).toHaveText('Empty · Remove');
    await expect(empty).toHaveCount(1);
    await cellOf(page, 'legend').click();
    await bar(page).getByRole('button', { name: 'Move to Back' }).click();
    expect(await rowsOf(page, 1)).toContain('legend');
    await expect(page.locator('.studio-page-empty')).toHaveCount(1);
    await page.locator('.studio-page-empty').click();
    await expect(page.locator('.report-sheet')).toHaveCount(2);
    await expect(page.locator('#undo-toast')).toContainText('Removed the empty page');
  });

  test('the palette offers the new blocks and no longer the old charts', async ({ page }) => {
    await openStudio(page);
    for (const id of ['support-home', 'term-glance', 'proficiency', 'missing-work', 'term-attendance', 'text-block']) {
      await expect(page.locator(`[data-action="studioBlock"][data-block="${id}"]`)).toHaveCount(1);
    }
    for (const id of [
      'section-outcomes',
      'score-distribution',
      'section-chart',
      'academic-summary',
      'competency-table',
      'growth',
    ]) {
      await expect(page.locator(`[data-action="studioBlock"][data-block="${id}"]`)).toHaveCount(0);
    }
  });

  test('a text block prints what the teacher writes', async ({ page }) => {
    await openStudio(page);
    await page.locator('[data-action="studioBlock"][data-block="text-block"]').click();
    await expect(cellOf(page, 'text-block')).toHaveClass(/sheet-empty/);
    const pop = await openOptions(page, 'text-block');
    await pop.getByLabel('Title').fill('Science Fair');
    await pop.getByLabel('Title').blur();
    await pop.getByLabel('Text').fill('Projects are due Nov 30.\nBring a tri-fold board.');
    await pop.getByLabel('Text').blur();
    await expect(cellOf(page, 'text-block')).toContainText('Science Fair');
    await expect(cellOf(page, 'text-block')).toContainText('Bring a tri-fold board.');
    expect(await overflowing(page)).toEqual([]);
  });

  test('a starter applies, and Undo puts the layout back', async ({ page }) => {
    await openStudio(page);
    await palette(page).getByRole('tab', { name: 'Templates' }).click();
    await expect(palette(page)).toContainText('Your Templates');
    await expect(palette(page)).toContainText('None yet');
    await palette(page).getByRole('button', { name: 'Interim Update', exact: true }).click();
    await expect(page.locator('.report-sheet .report-grades')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Front Only' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#undo-toast')).toContainText('Applied Interim Update');
    await undo(page).click();
    await expect(page.locator('.report-sheet .report-grades')).toHaveCount(1);
    await expect(page.getByRole('radio', { name: 'Front and Back' })).toHaveAttribute('aria-checked', 'true');
  });

  test('Save as Template keeps the layout under a name; it applies later and deletes with Undo', async ({ page }) => {
    await openStudio(page);
    await page.locator('[data-action="studioBlock"][data-block="support-home"]').scrollIntoViewIfNeeded();
    await page.locator('[data-action="studioBlock"][data-block="support-home"]').click();
    await expect(page.locator('.sheet-cell[data-block="support-home"]')).toHaveCount(1);
    await page.getByRole('button', { name: 'Save as Template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save as Template' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').fill('Science 8 with Support at Home');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      palette(page).getByRole('button', { name: 'Science 8 with Support at Home', exact: true }),
    ).toBeVisible();
    await palette(page).getByRole('button', { name: 'Report Card', exact: true }).click();
    await expect(page.locator('.sheet-cell[data-block="support-home"]')).toHaveCount(0);
    await palette(page).getByRole('button', { name: 'Science 8 with Support at Home', exact: true }).click();
    await expect(page.locator('.sheet-cell[data-block="support-home"]')).toHaveCount(1);
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await palette(page).getByRole('tab', { name: 'Templates' }).click();
    await expect(
      palette(page).getByRole('button', { name: 'Science 8 with Support at Home', exact: true }),
    ).toBeVisible();
    await palette(page).getByRole('button', { name: 'Delete Science 8 with Support at Home' }).click();
    await expect(
      palette(page).getByRole('button', { name: 'Science 8 with Support at Home', exact: true }),
    ).toHaveCount(0);
    await undo(page).click();
    await expect(
      palette(page).getByRole('button', { name: 'Science 8 with Support at Home', exact: true }),
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

test.describe('Hands on the page', () => {
  test.setTimeout(90_000);

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
    await page.waitForTimeout(220);
  }
  /* A point just under a block's top edge: the gap above it. */
  async function gapAbove(page, id) {
    const b = await cellOf(page, id).boundingBox();
    return { x: b.x + 60, y: b.y + 6 };
  }

  test('a block dragged from the palette lands in the gap under the pointer; the ghost and the line show while it is held, rows slide', async ({
    page,
  }) => {
    await openStudio(page);
    const from = await center(page.locator('[data-action="studioBlock"][data-block="term-glance"]'));
    const to = await gapAbove(page, 'teacher-narrative');
    await dragStart(page, from, to);
    await expect(page.locator('.studio-ghost')).toBeVisible();
    await expect(page.locator('.studio-ghost .report-glance')).toHaveCount(1);
    await expect(page.locator('.sheet-zoom[data-side="0"] .studio-drop-line')).toHaveCount(1);
    // The comment and the rows under it slide down; the legend stays.
    const slid = await page
      .locator('.sheet-zoom[data-side="0"] .sheet-row[data-slide]')
      .evaluateAll(rows => rows.map(r => r.querySelector('.sheet-cell').dataset.block));
    expect(slid).toEqual(['teacher-narrative', 'term-attendance']);
    expect(await cellOf(page, 'teacher-narrative').evaluate(el => el.closest('.sheet-row').style.transform)).toMatch(
      /translateY\(\d+px\)/,
    );
    await page.mouse.up();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend',
      'term-glance',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    await expect(page.locator('.studio-ghost, .studio-drop-line, .sheet-row[data-slide]')).toHaveCount(0);
    await expect(cellOf(page, 'term-glance')).toHaveClass(/studio-sel/);
    await expect(page.locator('#studio-live')).toHaveText('This Term at a Glance, Front, row 4 of 6.');
    await expect(page.locator('#undo-toast')).toContainText('Added This Term at a Glance');
    expect(await overlapping(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
  });

  test('a block on the page moves to another gap; Escape lets go; a drop off the page changes nothing', async ({
    page,
  }) => {
    await openStudio(page);
    const from = await center(cellOf(page, 'teacher-narrative'));
    const to = await gapAbove(page, 'proficiency');
    await dragStart(page, from, to);
    await expect(cellOf(page, 'teacher-narrative')).toHaveClass(/studio-held/);
    await page.mouse.up();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'teacher-narrative',
      'proficiency',
      'legend',
      'term-attendance/half+missing-work/half',
    ]);
    await expect(page.locator('#undo-toast')).toContainText('Moved Teacher Comment');
    // Escape.
    await dragStart(page, await center(cellOf(page, 'legend')), await gapAbove(page, 'proficiency'));
    await page.keyboard.press('Escape');
    await page.mouse.up();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'teacher-narrative',
      'proficiency',
      'legend',
      'term-attendance/half+missing-work/half',
    ]);
    await expect(page.locator('#studio-live')).toHaveText('Let go.');
    // Off the page: let go, nothing removed.
    const head = page.locator('.studio-head');
    const hb = await head.boundingBox();
    await dragStart(page, await center(cellOf(page, 'legend')), { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 });
    await page.mouse.up();
    expect(await rowsOf(page, 0)).toContain('legend');
    expect(await overlapping(page)).toEqual([]);
  });

  test('dropped on the empty half beside a lone Side by Side block, a block pairs with it; the slot shows while held', async ({
    page,
  }) => {
    await openStudio(page);
    await cellOf(page, 'legend').click();
    await bar(page).getByRole('radio', { name: 'Side by Side' }).click();
    const legend = await cellOf(page, 'legend').boundingBox();
    const from = await center(page.locator('[data-action="studioBlock"][data-block="term-glance"]'));
    await dragStart(page, from, { x: legend.x + legend.width + 40, y: legend.y + legend.height / 2 });
    await expect(page.locator('.studio-drop-slot')).toHaveCount(1);
    await expect(page.locator('.studio-drop-line')).toHaveCount(0);
    await page.mouse.up();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend/half+term-glance/half',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    await expect(page.locator('#undo-toast')).toContainText('Put This Term at a Glance beside Proficiency Legend');
    await expect(page.locator('#studio-live')).toHaveText(
      'This Term at a Glance, Front, row 3 of 5, beside Proficiency Legend.',
    );
    // A pair offers no beside target: a drop over it lands in a gap.
    const pair = await cellOf(page, 'term-glance').boundingBox();
    await dragStart(page, await center(page.locator('[data-action="studioBlock"][data-block="next-steps"]')), {
      x: pair.x + 40,
      y: pair.y + pair.height / 2,
    });
    await expect(page.locator('.studio-drop-slot')).toHaveCount(0);
    await expect(page.locator('.studio-drop-line')).toHaveCount(1);
    await page.mouse.up();
    expect(await overlapping(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
  });

  test('a drop on a Front with no room for every student lands on the Back, and the toast says so', async ({
    page,
  }) => {
    await openStudio(page);
    // Make room on the Back (the grades fill it) and fill the Front: Core
    // Competencies takes most of what is left there.
    await cellOf(page, 'grade-table').click();
    await bar(page).getByRole('button', { name: 'Remove' }).click();
    await page.locator('[data-action="studioBlock"][data-block="core-competencies"]').click();
    expect(await rowsOf(page, 0)).toContain('core-competencies');
    // Growth and Next Steps no longer has room there: dropped on the Front, it goes to the Back.
    const from = await center(page.locator('[data-action="studioBlock"][data-block="next-steps"]'));
    await dragStart(page, from, await gapAbove(page, 'legend'));
    await page.mouse.up();
    expect(await rowsOf(page, 0)).not.toContain('next-steps');
    expect(await rowsOf(page, 1)).toEqual(['next-steps', 'parent-response']);
    await expect(page.locator('#undo-toast')).toContainText(
      'Added Growth and Next Steps to the Back. The Front is full',
    );
    await expect(page.locator('#studio-fit')).toHaveText('1 sheet for all 27 students');
    await undo(page).click();
    expect(await rowsOf(page, 1)).toEqual(['parent-response']);
  });

  test('holding the pointer on a block in the palette shows it at print size for the previewed student', async ({
    page,
  }) => {
    await openStudio(page);
    const btn = page.locator('[data-action="studioBlock"][data-block="observations"]');
    await btn.hover();
    const peek = page.locator('#studio-peek');
    await expect(peek).toBeVisible();
    await expect(peek).toContainText('Observations for ' + (await previewName(page)) + ', at print size');
    await expect(peek.locator('.report-learner-profile, .report-block-box').first()).toBeVisible();
    const box = await peek.locator('.studio-peek-box').boundingBox();
    expect(box.height).toBeGreaterThan(60);
    const pal = await page.locator('#studio-palette').boundingBox();
    expect(box.x).toBeGreaterThan(pal.x + pal.width);
    await page.locator('.studio-head').hover();
    await expect(peek).toHaveCount(0);
  });

  test('the letterhead and the Response cannot be picked up', async ({ page }) => {
    await openStudio(page);
    await dragStart(page, await center(cellOf(page, 'parent-response')), await gapAbove(page, 'proficiency'));
    await expect(page.locator('.studio-ghost')).toHaveCount(0);
    await page.mouse.up();
    expect(await rowsOf(page, 1)).toEqual(['grade-table', 'parent-response']);
    await dragStart(page, await center(cellOf(page, 'header')), await gapAbove(page, 'legend'));
    await expect(page.locator('.studio-ghost')).toHaveCount(0);
    await page.mouse.up();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
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

  test('the letterhead names the class, block, report, term dates and student number; no footer', async ({ page }) => {
    await openStudio(page);
    const header = page.locator('.report-sheet').first().locator('.report-header');
    await expect(header.locator('.report-course-title')).toHaveText(/^Science 8 · Block A · .+/);
    await expect(header.locator('.report-student-name')).toHaveText(/\w+ \w+/);
    await expect(header.locator('.report-course-title')).toContainText(
      await page.locator('#report-period option:checked').innerText(),
    );
    const meta = header.locator('.report-header-meta');
    await expect(meta).toContainText(/Term\w{3} \d{1,2}(, \d{4})? – \w{3} \d{1,2}, \d{4}/);
    await expect(meta).toContainText(/Student No\.STU-\d+/);
    await expect(page.locator('.sheet-footer')).toHaveCount(0);
    // The letterhead sits near the top: 24px of padding.
    const top = await page
      .locator('.report-sheet')
      .first()
      .locator('.sheet-body')
      .evaluate(el => el.offsetTop);
    expect(Math.round(top)).toBe(24);
  });

  test('levels print as figures and a word, in black, with no dots', async ({ page }) => {
    await openStudio(page);
    const level = page.locator('#rb-preview .report-prof td.report-prof-n').first();
    await expect(level).toContainText(/^\d\.\d (Emerging|Developing|Proficient|Extending)$/);
    await expect(page.locator('#rb-preview .report-proficiency').first()).not.toContainText(/[●○]/);
    await expect(page.locator('#rb-preview .report-legend').first()).not.toContainText(/[●○]/);
    await expect(page.locator('#rb-preview .report-legend')).toContainText('1 · Emerging');
    await expect(page.locator('#rb-preview .report-legend')).toContainText('BC Proficiency Scale, out of 4');
    await page.emulateMedia({ media: 'print' });
    expect(await level.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
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
