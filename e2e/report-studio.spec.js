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

/* Progress Reports as a new class opens it: the Grade Report. */
async function openGrade(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  await expect(page.locator('.report-sheet')).toHaveCount(2);
}

/* Build Your Own as a new report opens it: the name and Assignment Grades. */
async function openFresh(page) {
  await openGrade(page);
  await page.getByRole('radio', { name: 'Custom' }).click();
  await expect(page.locator('.studio-blk.placed')).toHaveCount(1);
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
}

/* The Studio on the Report Card starter, on the longest report. */
async function openStudio(page) {
  await openFresh(page);
  await applyTemplate(page, 'report-card');
  await expect(page.locator('.sheet-cell[data-block="parent-response"]')).toHaveCount(1);
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

/* Sheets whose body or a cell overflows, named by student and block. */
async function overflowing(page) {
  return page.locator('.report-sheet').evaluateAll(sheets =>
    sheets.flatMap(s => {
      const who = s.closest('.sheet-student')?.querySelector('.sheet-student-name')?.textContent || '?';
      const body = s.querySelector('.sheet-body');
      const out = [];
      if (body && (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1)) {
        out.push(who + ' · body ' + body.scrollHeight + '/' + body.clientHeight);
      }
      [...s.querySelectorAll('.sheet-cell')].forEach(c => {
        if (c.scrollWidth > c.clientWidth + 1)
          out.push(who + ' · ' + c.dataset.block + ' ' + c.scrollWidth + '/' + c.clientWidth);
      });
      return out;
    }),
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

/* Every Demo student's six habits rated, so Learning Dispositions prints
   for everyone (Demo Mode has none rated, as the questionnaire canvas
   shows, and an unrated student prints no block). */
async function rateEveryone(page) {
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const habits = { completes: 4, ready: 3, others: 4, part: 3, feedback: 3, devices: 4 };
    getStudents(cid).forEach(s => upsertTermRating(cid, s.id, ReportBlocks.getTermId(), { habits }));
  });
  await page.reload();
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('.report-sheet').first()).toBeVisible();
}

const palette = page => page.locator('#studio-palette');
const bar = page => page.locator('.studio-bar');
const popover = page => page.locator('#studio-pop');
const cellOf = (page, id) => page.locator(`#rb-preview .sheet-cell[data-block="${id}"]`).first();
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

  test('a new report is the name and Assignment Grades in one column', async ({ page }) => {
    await openFresh(page);
    await expect(page.locator('.studio-blk.placed')).toHaveCount(1);
    await expect(page.locator('.studio-blk.placed')).toHaveAttribute('data-block', 'grade-table');
    await expect(page.locator('.sheet-body .sheet-cell[data-block]')).toHaveCount(2);
    await expect(page.locator('.report-grades-cols')).toHaveCount(0);
  });

  test('opens on the longest report, Front and Back side by side, with the palette, the fit line and no third pane', async ({
    page,
  }) => {
    await openStudio(page);
    await expect(page.locator('#studio > *')).toHaveCount(2);
    await expect(page.locator('#studio-inspector')).toHaveCount(0);
    await expect(page.locator('.studio-palette .studio-blk')).toHaveCount(15);
    await expect(page.locator('.studio-blk.placed')).toHaveCount(8);
    await expect(page.locator('.studio-palette')).not.toContainText('Letterhead');
    // No size badges, no grid, no handles.
    await expect(page.locator('.studio-sz, .studio-handle, .studio-grip')).toHaveCount(0);
    await expect(page.locator('.sheet-label').nth(0)).toHaveText('Front');
    await expect(page.locator('.sheet-label').nth(1)).toHaveText('Back');
    // The longest report in the class.
    await expect(page.locator('.report-sheet').first().locator('.report-student-name')).toHaveText(/\w+ \w+/);
    await expect(page.locator('#studio-fit')).toHaveText('1 sheet for all 27 students');
    await expect(page.locator('.studio-head')).toHaveText(
      /^1 sheet for all 27 studentsPaperLetterLegalSidesFront OnlyFront and BackInkBlackColour│One StudentEveryone$/,
    );
    await expect(page.locator('.studio-page-add')).toHaveText('+ Page');
    // Sides, not Pages, over the canvas.
    await expect(page.locator('.studio-head').getByRole('radiogroup', { name: 'Sides' })).toBeVisible();
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
      'missing-work/half',
    ]);
    expect(await rowsOf(page, 1)).toEqual(['self-assessment', 'grade-table', 'parent-response']);
    // Row cells are 720 wide, pair cells 354; no cell is absolutely placed.
    const widths = await page
      .locator('.sheet-zoom[data-side="0"] .sheet-cell')
      .evaluateAll(cells => cells.map(c => [c.dataset.block, c.offsetWidth, getComputedStyle(c).position]));
    expect(widths).toEqual([
      ['header', 720, 'relative'],
      ['proficiency', 720, 'relative'],
      ['legend', 720, 'relative'],
      ['teacher-narrative', 720, 'relative'],
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

  test('a click selects a block and shows its card in the gutter; Remove takes it off with Undo; the palette removes it or adds it', async ({
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
    // Clicking a placed block in the palette takes it off; Undo puts it back.
    await page.locator('[data-action="studioBlock"][data-block="legend"]').click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(0);
    await expect(page.locator('#undo-toast')).toContainText('Removed Proficiency Legend');
    await undo(page).click();
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
    await expect(habits).toContainText('No room on either side. Add a page or remove a block.');
    await expect(habits).toHaveAttribute('aria-disabled', 'true');
    await habits.click({ force: true });
    await expect(page.locator('.sheet-cell[data-block="student-reflection-habits"]')).toHaveCount(0);
    // Take the grades and the self-assessment off the Back: the reflection
    // now has room there, not on the Front.
    await cellOf(page, 'grade-table').click();
    await bar(page).getByRole('button', { name: 'Remove' }).click();
    await cellOf(page, 'self-assessment').click();
    await bar(page).getByRole('button', { name: 'Remove' }).click();
    await expect(habits).not.toHaveClass(/nofit/);
    await habits.click({ force: true });
    expect(await rowsOf(page, 1)).toEqual(['student-reflection-habits', 'parent-response']);
    await expect(page.locator('#undo-toast')).toContainText(
      'Added Reflection: My Habits to the Back. The Front is full',
    );
    expect(await overflowing(page)).toEqual([]);
  });

  test('Side by Side pairs a block with a lone Side by Side neighbour of a similar height, never an uneven one; Row splits the pair', async ({
    page,
  }) => {
    await openStudio(page);
    const side = async (id, name) => {
      await cellOf(page, id).click();
      await bar(page).getByRole('radio', { name }).click();
    };
    // Missing Work moves up under the legend.
    await cellOf(page, 'missing-work').click();
    await bar(page).getByRole('button', { name: 'Move Up' }).click();
    // The legend goes Side by Side alone: Missing Work below it already has a partner (Attendance, empty here).
    await side('legend', 'Side by Side');
    await expect(page.locator('#undo-toast')).toContainText('Proficiency Legend: Side by Side');
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend/half',
      'missing-work/half',
      'teacher-narrative',
    ]);
    // Proficiency at Side by Side is three times the legend's height: it stays alone.
    await side('proficiency', 'Side by Side');
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency/half',
      'legend/half',
      'missing-work/half',
      'teacher-narrative',
    ]);
    // Missing Work leaves its partner, then goes Side by Side next to the legend: the two are close in height.
    await side('missing-work', 'Row');
    await side('missing-work', 'Side by Side');
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency/half',
      'legend/half+missing-work/half',
      'term-attendance/half',
      'teacher-narrative',
    ]);
    await expect(cellOf(page, 'legend')).toHaveCSS('width', '354px');
    const heights = await page
      .locator('#rb-preview .sheet-zoom[data-side="0"] .sheet-row')
      .nth(2)
      .locator('.sheet-cell')
      .evaluateAll(cells => cells.map(c => c.offsetHeight));
    expect(heights[0]).toBe(heights[1]);
    expect(await overlapping(page)).toEqual([]);
    expect(await overflowing(page)).toEqual([]);
    // Row splits the pair; the partner stays at Side by Side under it.
    await side('legend', 'Row');
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency/half',
      'legend',
      'missing-work/half',
      'term-attendance/half',
      'teacher-narrative',
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
      'missing-work/half',
    ]);
    await expect(page.locator('#undo-toast')).toContainText('Moved Teacher Comment up');
    await undo(page).click();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'missing-work/half',
    ]);
    await cellOf(page, 'legend').click();
    await bar(page).getByRole('button', { name: 'Move to Back' }).click();
    expect(await rowsOf(page, 1)).toEqual(['self-assessment', 'grade-table', 'legend', 'parent-response']);
    await expect(page.locator('#studio-live')).toHaveText('Proficiency Legend, Back, row 3 of 4.');
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
    const front = await rowsOf(page, 0);
    expect(front.slice(0, 5)).toEqual(['header', 'proficiency', 'legend', 'teacher-narrative', 'missing-work/half']);
    expect(front[front.length - 1]).toBe('parent-response');
    expect(front).not.toContain('grade-table');
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
    await rateEveryone(page);
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

  test('the paper stays white with dark ink in dark mode; the screen around it goes dark', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openStudio(page);
    const sheet = page.locator('#rb-preview .report-sheet').first();
    expect(await sheet.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 255, 255)');
    for (const sel of ['.report-student-name', '.report-proficiency', '.report-comment-box']) {
      const colors = await sheet
        .locator(sel)
        .first()
        .evaluate(el => {
          const box = el.closest('.report-block-box') || el;
          return [getComputedStyle(el).color, getComputedStyle(box).backgroundColor];
        });
      expect(colors[0]).toMatch(/^rgb\((0|29), (0|29), (0|31)\)$/);
      expect(colors[1]).toMatch(/^rgb(a?)\((255, 255, 255|0, 0, 0, 0)/);
    }
    expect(await page.locator('.studio-palette').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe(
      'rgb(255, 255, 255)',
    );
    await page.emulateMedia({ colorScheme: 'light' });
  });

  test('every block, the letterhead too, is reached by Tab and selected with Enter', async ({ page }) => {
    await openStudio(page);
    const head = cellOf(page, 'header');
    await expect(head).toHaveAttribute('tabindex', '0');
    await expect(head).toHaveAttribute('aria-label', 'Letterhead');
    await head.focus();
    await page.keyboard.press('Enter');
    await expect(head).toHaveClass(/studio-sel/);
    await expect(bar(page)).toContainText('Always first on the Front');
    const legend = cellOf(page, 'legend');
    await legend.focus();
    await page.keyboard.press(' ');
    await expect(legend).toHaveClass(/studio-sel/);
    await expect(bar(page).locator('.studio-bar-name')).toHaveText('Proficiency Legend');
    // The card's buttons show their whole labels.
    const cut = await bar(page)
      .locator('.studio-bar-btn')
      .evaluateAll(btns => btns.filter(b => b.scrollWidth > b.clientWidth + 1).map(b => b.textContent));
    expect(cut).toEqual([]);
  });

  test('Side by Side heights are measured with the Side by Side layout', async ({ page }) => {
    await openStudio(page);
    await cellOf(page, 'legend').click();
    await bar(page).getByRole('radio', { name: 'Side by Side' }).click();
    const shown = await cellOf(page, 'legend').evaluate(el => el.querySelector('.report-legend').offsetHeight);
    const measured = await page.evaluate(() => {
      const cid = getActiveCourse();
      const st = getStudents(cid)[0];
      return ReportSheets.blockSizes(cid, [st], ReportBlocks.reportContext(), {}).legend.half;
    });
    // The 2 x 2 legend, not the four-column strip squeezed to 354px.
    expect(Math.abs(measured - shown)).toBeLessThanOrEqual(2);
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
    // Demo Mode has no attendance entered: said once, never blocking.
    await expect(dialog.locator('.issue-warn')).toContainText(
      'No attendance is entered for this report. Their reports print without it.',
    );
    await expect(dialog.locator('[data-issue="attendance"]')).toHaveText('Enter it now');
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

  test('Enter it now opens the Term Questionnaire on a student with no attendance; with totals entered the note names the rest', async ({
    page,
  }) => {
    await openStudio(page);
    await page.evaluate(() => {
      const cid = getActiveCourse();
      const ctx = ReportBlocks.reportContext();
      getStudents(cid)
        .slice(1)
        .forEach(st => saveTermAttendance(cid, st.id, ctx.termId, 2, 1));
    });
    await page.locator('.studio-view [data-view="all"]').click();
    await page.locator('.studio-view [data-view="one"]').click();
    await page.getByRole('button', { name: 'Print Reports' }).click();
    const dialog = page.locator('#issue-overlay');
    await expect(dialog.locator('.issue-warn')).toContainText(
      /^Before you print.*\w+ \w+ has no attendance entered\. Their reports print without it\./,
    );
    await dialog.locator('[data-issue="attendance"]').click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Term Questionnaire' })).toHaveAttribute('aria-selected', 'true');
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

  test('the comment’s line meter counts its printed lines as it is typed; a long comment continues, nothing is cut', async ({
    page,
  }) => {
    // The meter measures against the Report Card's comment box; a new
    // report has no comment block, so no meter.
    await openStudio(page);
    await page.locator('.report-seg-btn[data-tab="questionnaire"]').click();
    const meter = page.locator('#tq-meter-label');
    await expect(meter).toHaveText(/^\d+ of 10 lines$/);
    await expect(meter).not.toHaveClass(/over/);
    const editor = page.locator('#tq-narrative');
    await editor.click();
    await page.keyboard.press('End');
    for (let i = 0; i < 12; i++)
      await page.keyboard.type(
        ' She keeps asking questions that move the whole class forward and writes it all down with care.',
      );
    await expect(meter).toHaveClass(/over/);
    const lines = Number((await meter.textContent()).split(' ')[0]);
    expect(lines).toBeGreaterThan(10);
    await page.locator('.report-seg-btn[data-tab="progress"]').click();
    await expect(page.locator('.report-sheet').first()).toBeVisible();
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
      'missing-work/half',
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
    for (const id of [
      'support-home',
      'progress',
      'proficiency',
      'missing-work',
      'term-attendance',
      'self-assessment',
      'text-block',
    ]) {
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

  test('a starter applies, and Undo puts the layout back; the Templates tab draws each template with the real report', async ({
    page,
  }) => {
    await openStudio(page);
    await rateEveryone(page);
    await palette(page).getByRole('tab', { name: 'Templates' }).click();
    await expect(palette(page)).toContainText('Your Templates');
    await expect(palette(page)).toContainText('None yet');
    // Each starter is drawn with the previewed student's sheets and says how many it takes.
    const card = palette(page).locator('.studio-tpl[data-starter="report-card"]');
    await expect(card).toHaveClass(/current/);
    await expect(card.locator('.studio-tpl-side .report-sheet')).toHaveCount(2);
    await expect(card.locator('.studio-tpl-side .report-student-name').first()).toHaveText(await previewName(page));
    await expect(card.locator('.studio-tpl-count')).toHaveText('1 sheet');
    // Every side of every template sits inside its card: more sides draw smaller, none is cut off.
    const cut = await palette(page)
      .locator('.studio-tpl-thumbs')
      .evaluateAll(boxes =>
        boxes.flatMap(box => {
          const edge = box.getBoundingClientRect().right;
          return [...box.children]
            .filter(s => s.getBoundingClientRect().right > edge + 0.5)
            .map(() => box.closest('.studio-tpl').getAttribute('aria-label'));
        }),
      );
    expect(cut).toEqual([]);
    const sides = await palette(page)
      .locator('.studio-tpl-thumbs')
      .evaluateAll(boxes => boxes.map(b => b.children.length));
    expect(Math.max(...sides)).toBeGreaterThan(2);
    await expect(
      palette(page).locator('.studio-tpl[data-starter="interim-update"] .studio-tpl-side .report-sheet'),
    ).toHaveCount(2);
    await palette(page).getByRole('button', { name: 'Interim Update', exact: true }).click();
    await expect(page.locator('#rb-preview .report-sheet .report-grades')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Front Only' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#undo-toast')).toContainText('Applied Interim Update');
    await undo(page).click();
    await expect(page.locator('#rb-preview .report-sheet .report-grades')).toHaveCount(1);
    await expect(page.getByRole('radio', { name: 'Front and Back' })).toHaveAttribute('aria-checked', 'true');
  });

  test('Save as Template keeps the layout under a name; it applies later and deletes with Undo', async ({ page }) => {
    await openStudio(page);
    await page.locator('[data-action="studioBlock"][data-block="support-home"]').scrollIntoViewIfNeeded();
    await page.locator('[data-action="studioBlock"][data-block="support-home"]').click();
    await expect(page.locator('#rb-preview .sheet-cell[data-block="support-home"]')).toHaveCount(1);
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
    await expect(page.locator('#rb-preview .sheet-cell[data-block="support-home"]')).toHaveCount(0);
    await palette(page).getByRole('button', { name: 'Science 8 with Support at Home', exact: true }).click();
    await expect(page.locator('#rb-preview .sheet-cell[data-block="support-home"]')).toHaveCount(1);
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
    const from = await center(page.locator('[data-action="studioBlock"][data-block="support-home"]'));
    const to = await gapAbove(page, 'teacher-narrative');
    await dragStart(page, from, to);
    await expect(page.locator('.studio-ghost')).toBeVisible();
    await expect(page.locator('.studio-ghost .report-support-home')).toHaveCount(1);
    await expect(page.locator('.sheet-zoom[data-side="0"] .studio-drop-line')).toHaveCount(1);
    // The comment and the rows under it slide down; the legend stays.
    const slid = await page
      .locator('.sheet-zoom[data-side="0"] .sheet-row[data-slide]')
      .evaluateAll(rows => rows.map(r => r.querySelector('.sheet-cell').dataset.block));
    expect(slid).toEqual(['teacher-narrative', 'missing-work']);
    expect(await cellOf(page, 'teacher-narrative').evaluate(el => el.closest('.sheet-row').style.transform)).toMatch(
      /translateY\(\d+px\)/,
    );
    await page.mouse.up();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend',
      'support-home',
      'teacher-narrative',
      'missing-work/half',
    ]);
    await expect(page.locator('.studio-ghost, .studio-drop-line, .sheet-row[data-slide]')).toHaveCount(0);
    await expect(cellOf(page, 'support-home')).toHaveClass(/studio-sel/);
    await expect(page.locator('#studio-live')).toHaveText('Ways to Support at Home, Front, row 4 of 6.');
    await expect(page.locator('#undo-toast')).toContainText('Added Ways to Support at Home');
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
      'missing-work/half',
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
      'missing-work/half',
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
    const from = await center(page.locator('[data-action="studioBlock"][data-block="support-home"]'));
    await dragStart(page, from, { x: legend.x + legend.width + 40, y: legend.y + legend.height / 2 });
    await expect(page.locator('.studio-drop-slot')).toHaveCount(1);
    await expect(page.locator('.studio-drop-line')).toHaveCount(0);
    await page.mouse.up();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend/half+support-home/half',
      'teacher-narrative',
      'missing-work/half',
    ]);
    await expect(page.locator('#undo-toast')).toContainText('Put Ways to Support at Home beside Proficiency Legend');
    await expect(page.locator('#studio-live')).toHaveText(
      'Ways to Support at Home, Front, row 3 of 5, beside Proficiency Legend.',
    );
    // A pair offers no beside target: a drop over it lands in a gap.
    const pair = await cellOf(page, 'support-home').boundingBox();
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
    // Fill the Front past full: the grades move up from the Back.
    await cellOf(page, 'grade-table').click();
    await bar(page).getByRole('button', { name: 'Move to Front' }).click();
    expect(await rowsOf(page, 1)).not.toContain('grade-table');
    // Next Steps has no room there: dropped on the Front, it goes to the Back.
    const from = await center(page.locator('[data-action="studioBlock"][data-block="next-steps"]'));
    await dragStart(page, from, await gapAbove(page, 'legend'));
    await page.mouse.up();
    expect(await rowsOf(page, 0)).not.toContain('next-steps');
    expect(await rowsOf(page, 1)).toEqual(['self-assessment', 'next-steps', 'parent-response']);
    await expect(page.locator('#undo-toast')).toContainText('Added Next Steps to the Back. The Front is full');
    await undo(page).click();
    expect(await rowsOf(page, 1)).toEqual(['self-assessment', 'parent-response']);
  });

  test('holding the pointer on a block in the palette shows it at print size for the previewed student', async ({
    page,
  }) => {
    await openStudio(page);
    const btn = page.locator('[data-action="studioBlock"][data-block="next-steps"]');
    await btn.hover();
    const peek = page.locator('#studio-peek');
    await expect(peek).toBeVisible();
    await expect(peek).toContainText('Next Steps for ' + (await previewName(page)) + ', at print size');
    await expect(peek.locator('.report-next-steps')).toBeVisible();
    const box = await peek.locator('.studio-peek-box').boundingBox();
    expect(box.height).toBeGreaterThan(30);
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
    expect(await rowsOf(page, 1)).toEqual(['self-assessment', 'grade-table', 'parent-response']);
    await dragStart(page, await center(cellOf(page, 'header')), await gapAbove(page, 'legend'));
    await expect(page.locator('.studio-ghost')).toHaveCount(0);
    await page.mouse.up();
    expect(await rowsOf(page, 0)).toEqual([
      'header',
      'proficiency',
      'legend',
      'teacher-narrative',
      'missing-work/half',
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

test.describe('Grade Report', () => {
  test.setTimeout(90_000);

  test('a new class opens on the Grade Report: a table of this term, one sheet each, two Letter pages per student', async ({
    page,
  }) => {
    await openGrade(page);
    await expect(page.getByRole('radio', { name: 'Quick Report' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#studio-fit')).toHaveText('1 sheet for all 27 students');
    // Build Your Own's controls are hidden.
    await expect(page.locator('#report-sides')).toBeHidden();
    await expect(page.locator('#tb-save-template')).toBeHidden();
    const sheet = page.locator('.gr-sheet').first();
    await expect(sheet.locator('.report-student-name')).toHaveText(/\w+ \w+/);
    await expect(sheet.locator('.gr-head').first()).toContainText('Assignment');
    await expect(sheet.locator('.gr-head').first()).toContainText('Out Of');
    await expect(page.locator('.gr-term')).toContainText('Term Grade');
    // Grades only: no comment, attendance or other feedback on the sheet.
    await expect(page.locator('.gr-sheet .report-comment-box, .gr-sheet .report-attendance')).toHaveCount(0);
    await expect(page.getByRole('checkbox')).toHaveCount(1);
    // No Proficiency column, nothing cut off in a row, and no + Page.
    await expect(sheet.locator('.gr-head').first()).not.toContainText('Proficiency');
    const cut = await page
      .locator('.gr-sheet .gr-row:not(.gr-head) .gr-c')
      .evaluateAll(cells => cells.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent));
    expect(cut).toEqual([]);
    await expect(page.locator('.studio-page-add')).toHaveCount(0);
    // The switch and the Order buttons stay inside the left column.
    const spill = await page.locator('#studio-palette').evaluate(pal => {
      const edge = pal.getBoundingClientRect().right - parseFloat(getComputedStyle(pal).paddingRight);
      return [...pal.querySelectorAll('button, label')]
        .filter(b => b.getBoundingClientRect().right > edge + 0.5 || b.scrollWidth > b.clientWidth + 1)
        .map(b => b.textContent.trim());
    });
    expect(spill).toEqual([]);
    await showEveryone(page);
    expect(await overflowing(page)).toEqual([]);
    const pdf = await printToPdf(page);
    expect(countPages(pdf)).toBe(STUDENTS * 2);
  });

  test('Include takes the summary off; the choice and Build Your Own are remembered', async ({ page }) => {
    await openGrade(page);
    await expect(page.locator('.gr-summary')).toHaveCount(1);
    await page.getByRole('checkbox', { name: 'Category Summary' }).uncheck();
    await expect(page.locator('.gr-summary')).toHaveCount(0);
    await page.getByRole('radio', { name: 'Custom' }).click();
    await expect(page.locator('.studio-blk.placed')).toHaveCount(1);
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('.studio-blk.placed')).toHaveCount(1);
    await page.getByRole('radio', { name: 'Quick Report' }).click();
    await expect(page.getByRole('checkbox', { name: 'Category Summary' })).not.toBeChecked();
    await expect(page.locator('.gr-summary')).toHaveCount(0);
  });
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

  test('Learning Dispositions prints the six habits from the questionnaire; an unrated class prints none', async ({
    page,
  }) => {
    await openStudio(page);
    await applyTemplate(page, 'conference-pack');
    await showEveryone(page);
    // The Demo class has the old nine dispositions on this device and no habits: nothing prints.
    await expect(page.locator('.report-sheet .report-learner-profile')).toHaveCount(0);
    await page.evaluate(() =>
      upsertTermRating(getActiveCourse(), 'st1', ReportBlocks.getTermId(), {
        habits: { completes: 4, part: 2, ready: 5 },
      }),
    );
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await showEveryone(page);
    const block = page.locator('.report-sheet .report-learner-profile');
    await expect(block).toHaveCount(1);
    await expect(block.locator('.report-disp-row')).toHaveText([
      /Completes Work\s*Consistently/,
      /Takes Part\s*Sometimes/,
    ]);
    await expect(block).not.toContainText('Not Seen');
  });

  test('a dimension the teacher did not rate is left off the printed report', async ({ page }) => {
    await openStudio(page);
    await expect(page.locator('#rb-preview')).not.toContainText('Not Assessed');
  });
});
