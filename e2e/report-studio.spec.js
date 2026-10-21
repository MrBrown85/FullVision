/**
 * Reports: Page Studio and the printed reports (teacher/report-studio.js,
 * report-sheets.js, report-blocks.js, page-reports.js). Demo Mode's Science 8
 * class, 27 students. The palette, the pages on their grid at paper size,
 * the fit line, the inspector, blocks that adapt to their box, block
 * options, templates, Print Reports with its saved copy, and page counts
 * from Chromium's print engine.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

const STUDENTS = 27;

async function openStudio(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.goto(page.url().replace(/#.*/, '#/reports'));
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
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
        const cells = [...s.querySelectorAll('.sheet-body > .sheet-cell')];
        return (
          (body && (body.scrollHeight > body.clientHeight + 1 || body.scrollWidth > body.clientWidth + 1)) ||
          cells.some(c => c.scrollWidth > c.clientWidth + 1)
        );
      })
      .map(s => s.querySelector('.sheet-footer')?.textContent || '?'),
  );
}

/* Two placed blocks on one page never overlap. */
async function overlapping(page) {
  return page.locator('.report-sheet').evaluateAll(sheets =>
    sheets.flatMap(s => {
      const cells = [...s.querySelectorAll('.sheet-body > .sheet-cell')].map(c => ({
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

const inspector = page => page.locator('#studio-inspector');
const palette = page => page.locator('#studio-palette');

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

  test('opens on one student, two pages side by side, with the palette, the fit line and the inspector', async ({
    page,
  }) => {
    await openStudio(page);
    await expect(page.locator('.studio-palette .studio-blk')).toHaveCount(16);
    await expect(page.locator('.studio-blk.placed')).toHaveCount(6);
    await expect(page.locator('.studio-palette')).not.toContainText('Letterhead');
    await expect(page.locator('.sheet-label').first()).toHaveText('Page 1 of 2');
    await expect(page.locator('.report-sheet').first().locator('.sheet-footer')).toContainText(
      'Cece Adeyemi · Page 1 of 2',
    );
    await expect(page.locator('#studio-fit')).toHaveText('Fits for 27 of 27 students');
    await expect(page.locator('#studio-inspector')).toContainText('Select a block on the page');
    // Gone: the hint sentence, the fill bars, the stats, the size and place controls.
    await expect(page.locator('.studio-canvas')).not.toContainText('Drag a block onto a page');
    await expect(page.locator('#studio-inspector')).not.toContainText(/Longest|Shortest|overflow|Blank back/);
    expect(
      await page
        .locator('.report-sheet')
        .first()
        .evaluate(el => getComputedStyle(el, '::after').content),
    ).toBe('none');
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
    // Everyone shows thumbnails; the engine's own overflow flag is the check here.
    await expect(page.locator('.sheet-overflow')).toHaveCount(0);
    const sheets = await page.locator('.sheet-student').evaluateAll(els => els.map(el => el.dataset.sheets));
    expect(sheets.every(n => n === '1')).toBe(true);
    // A thumbnail opens that student.
    await page.locator('.sheet-student[data-sid="st2"]').click();
    await expect(page.locator('.report-sheet')).toHaveCount(2);
    await expect(page.locator('.report-sheet').first().locator('.report-student-name')).toHaveText('Noor Al-Rashid');
  });

  test('the back carries the dispositions and the response pinned at the bottom, wording intact', async ({ page }) => {
    await openStudio(page);
    const back = page.locator('.report-sheet').nth(1);
    await expect(back.locator('.report-learner-profile')).toHaveCount(1);
    await expect(back.locator('.sheet-pinned .report-parent-response')).toHaveCount(1);
    await expect(back.locator('.sheet-pinned')).toContainText('I have reviewed this report with my child');
    await expect(back.locator('.sheet-pinned')).toContainText('I would like to schedule a meeting with the teacher');
    await expect(back.locator('.sheet-pinned')).toContainText(
      'Please review this report with your child and return this section to the school.',
    );
  });

  test('a block is placed from the palette, selected on the page, and removed from the inspector', async ({ page }) => {
    await openStudio(page);
    // A click puts it at the first free row of the last page: under the dispositions.
    await page.locator('[data-action="studioBlock"][data-block="legend"]').click();
    const legend = page.locator('.report-sheet').nth(1).locator('.sheet-cell[data-block="legend"]');
    await expect(legend).toHaveCount(1);
    await expect(legend).toHaveAttribute('data-y', '15');
    await expect(legend).toHaveClass(/studio-sel/);
    await expect(page.locator('[data-action="studioBlock"][data-block="legend"]')).toHaveClass(/placed/);
    await expect(page.locator('#studio-inspector')).toContainText('Proficiency Legend');
    expect(await overlapping(page)).toEqual([]);
    // Click a block on the page: the inspector follows.
    await page.locator('.sheet-cell[data-block="competency-table"]').click();
    await expect(page.locator('.sheet-cell[data-block="competency-table"]')).toHaveClass(/studio-sel/);
    await expect(page.locator('#studio-inspector')).toContainText('Competency Table');
    // The letterhead cannot be removed.
    await page.locator('.sheet-cell[data-block="header"]').click();
    await expect(page.locator('#studio-inspector')).toContainText('Letterhead');
    await expect(page.locator('[data-action="studioRemove"]')).toHaveCount(0);
    // Remove the legend; it is back in the palette.
    await page.locator('.sheet-cell[data-block="legend"]').click();
    await page.locator('[data-action="studioRemove"]').click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(0);
    await expect(page.locator('[data-action="studioBlock"][data-block="legend"]')).not.toHaveClass(/placed/);
    expect(await overflowing(page)).toEqual([]);
    // The form is the class's: it survives a reload.
    await page.locator('[data-action="studioBlock"][data-block="observations"]').click();
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('[data-action="studioBlock"][data-block="observations"]')).toHaveClass(/placed/);
  });

  test('the Conference Pack cuts its grade table at rows and says it pushes past the page', async ({ page }) => {
    await openStudio(page);
    await applyTemplate(page, 'conference-pack');
    await expect(
      page.locator('.report-block-title', { hasText: 'Assignment Grades (continued)' }).first(),
    ).toBeVisible();
    // The response stays docked to the bottom of page 2; the table runs on after it.
    await expect(page.locator('.report-sheet').nth(1).locator('.sheet-pinned .report-parent-response')).toHaveCount(1);
    expect(await overflowing(page)).toEqual([]);
    expect(await overlapping(page)).toEqual([]);
    const link = page.locator('#studio-fit .studio-fit-link');
    await expect(link).toHaveText('Pushes past the page for 27 students');
    // The link opens Everyone: three sheets each, none overflowing.
    await link.click();
    await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 6, { timeout: 30_000 });
    await expect(page.locator('.report-sheet.sheet-overflow')).toHaveCount(0);
    await applyTemplate(page, 'report-card');
    // Laying every student out twice takes a few seconds.
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

  test('the comment box says how the draft sits on the form, as it is typed', async ({ page }) => {
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
    await expect(page.locator('.report-sheet')).toHaveCount(2);
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
      f = ReportSheets.place(f, 'grade-table', { page: 1, x: 0, y: 15, w: 6, h: 16 });
      f = ReportSheets.place(f, 'observations', { page: 1, x: 6, y: 15, w: 6, h: 16 });
      saveReportConfig(cid, { ...(getReportConfig(cid) || {}), form: f });
    });
    const back = page.locator('.report-sheet').nth(1);
    const cell = back.locator('.sheet-cell[data-block="grade-table"]').first();
    await expect(cell).toHaveAttribute('data-w', '6');
    expect(await cell.evaluate(el => el.offsetWidth)).toBe(354);
    const table = cell.locator('table.report-grade-table');
    await expect(table.locator('th.col-area')).toBeHidden();
    await expect(table.locator('th.col-category')).toBeHidden();
    await expect(table.locator('th.col-date')).toBeVisible();
    await expect(table.locator('th', { hasText: 'Score' })).toBeVisible();
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
    expect(letterY).toBe(31);
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

test.describe('Page Studio options', () => {
  test.setTimeout(90_000);

  test('Show checkboxes change the competency table and the letterhead', async ({ page }) => {
    await openStudio(page);
    const table = page.locator('.report-sheet .report-ct').first();
    await expect(table.locator('th.report-ct-evidence')).toHaveCount(1);
    await page.locator('.sheet-cell[data-block="competency-table"]').click();
    await inspector(page).getByLabel('Evidence Count').uncheck();
    await expect(page.locator('.report-sheet .report-ct th.report-ct-evidence')).toHaveCount(0);
    await inspector(page).getByLabel('Assignment Names').check();
    await expect(page.locator('.report-sheet .report-ct .report-ct-note').first()).toBeVisible();
    // The letterhead's student number.
    const meta = page.locator('.report-sheet .report-header-meta').first();
    await expect(meta).toContainText('Student No.');
    await page.locator('.sheet-cell[data-block="header"]').click();
    await inspector(page).getByLabel('Student Number').uncheck();
    await expect(page.locator('.report-sheet .report-header-meta').first()).not.toContainText('Student No.');
    // The choices are the class's: they survive a reload.
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('.report-sheet .report-ct th.report-ct-evidence')).toHaveCount(0);
  });

  test('dispositions show descriptions when asked; Growth and Next Steps takes 0–3 I-can statements', async ({
    page,
  }) => {
    await openStudio(page);
    await expect(page.locator('.report-sheet .report-dim-note')).toHaveCount(0);
    await page.locator('.sheet-cell[data-block="learner-dimensions"]').click();
    await inspector(page).getByLabel('Descriptions').check();
    await expect(page.locator('.report-sheet .report-dim-note').first()).toBeVisible();
    await expect(inspector(page).getByRole('radiogroup', { name: 'I-can Statements' })).toHaveCount(0);
    // Next steps is empty for the first demo student; its options still show.
    await page.locator('[data-action="studioBlock"][data-block="next-steps"]').click();
    const group = inspector(page).getByRole('radiogroup', { name: 'I-can Statements' });
    await expect(group.getByRole('radio', { name: '2' })).toHaveAttribute('aria-checked', 'true');
    await group.getByRole('radio', { name: 'None' }).click();
    await expect(group.getByRole('radio', { name: 'None' })).toHaveAttribute('aria-checked', 'true');
  });

  test('the no-evidence rule and Leave Off change one student without changing the class', async ({ page }) => {
    await openStudio(page);
    await page.locator('.sheet-cell[data-block="competency-table"]').click();
    const rule = inspector(page).getByRole('radiogroup', { name: 'When a student has no evidence' });
    await expect(rule.getByRole('radio', { name: 'Show “No Evidence”' })).toHaveAttribute('aria-checked', 'true');
    await rule.getByRole('radio', { name: 'Hide Row' }).click();
    await expect(rule.getByRole('radio', { name: 'Hide Row' })).toHaveAttribute('aria-checked', 'true');
    // Leave the legend-free comment off Cece's report only.
    await page.locator('.sheet-cell[data-block="teacher-narrative"]').click();
    await inspector(page).getByLabel('Leave off Cece Adeyemi’s report').check();
    await expect(page.locator('.sheet-cell[data-block="teacher-narrative"]')).toHaveCount(0);
    await expect(inspector(page)).toContainText('Teacher Comment');
    // Noor still has it.
    await page.locator('.studio-view [data-view="all"]').click();
    await expect(
      page.locator('.sheet-student[data-sid="st2"] .sheet-cell[data-block="teacher-narrative"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('.sheet-student[data-sid="st1"] .sheet-cell[data-block="teacher-narrative"]'),
    ).toHaveCount(0);
    // Back on Cece: the palette selects the block, and the checkbox brings it back.
    await page.locator('.sheet-student[data-sid="st1"]').click();
    await page.locator('[data-action="studioBlock"][data-block="teacher-narrative"]').click();
    await inspector(page).getByLabel('Leave off Cece Adeyemi’s report').uncheck();
    await expect(page.locator('.sheet-cell[data-block="teacher-narrative"]')).toHaveCount(1);
  });

  test('a text block prints what the teacher writes', async ({ page }) => {
    await openStudio(page);
    await page.locator('[data-action="studioBlock"][data-block="text-block"]').scrollIntoViewIfNeeded();
    await page.locator('[data-action="studioBlock"][data-block="text-block"]').click();
    await expect(inspector(page)).toContainText('Text Block');
    await inspector(page).getByLabel('Title').fill('Upcoming Dates');
    await inspector(page).getByLabel('Title').dispatchEvent('change');
    await inspector(page).getByLabel('Text', { exact: true }).fill('Science fair: Nov 30.\nConferences: Dec 4.');
    await inspector(page).getByLabel('Text', { exact: true }).dispatchEvent('change');
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
      'Doesn’t fit · Learning Dispositions, Parent / Guardian Response',
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
    await expect(page.locator('.report-sheet .report-legend')).toHaveCount(1);
    await expect(page.locator('#undo-toast')).toContainText('Applied Interim Update');
    await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.report-sheet .report-legend')).toHaveCount(0);
    await expect(page.locator('.report-sheet .report-learner-profile')).toHaveCount(1);
  });

  test('Save as Template keeps the layout under a name; it applies later and deletes with Undo', async ({ page }) => {
    await openStudio(page);
    // Change the layout: add the legend.
    await page.locator('[data-action="studioBlock"][data-block="legend"]').scrollIntoViewIfNeeded();
    await page.locator('[data-action="studioBlock"][data-block="legend"]').click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(1);
    // Save it.
    await page.getByRole('button', { name: 'Save as Template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save as Template' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('Name').fill('Science 8 with Legend');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(palette(page).getByRole('button', { name: 'Science 8 with Legend', exact: true })).toBeVisible();
    // Apply a starter, then the saved one.
    await palette(page).getByRole('button', { name: 'Report Card', exact: true }).click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(0);
    await palette(page).getByRole('button', { name: 'Science 8 with Legend', exact: true }).click();
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveCount(1);
    // It is kept: still listed after a reload.
    await page.reload();
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await palette(page).getByRole('tab', { name: 'Templates' }).click();
    await expect(palette(page).getByRole('button', { name: 'Science 8 with Legend', exact: true })).toBeVisible();
    // Delete, then Undo.
    await palette(page).getByRole('button', { name: 'Delete Science 8 with Legend' }).click();
    await expect(palette(page).getByRole('button', { name: 'Science 8 with Legend', exact: true })).toHaveCount(0);
    await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(palette(page).getByRole('button', { name: 'Science 8 with Legend', exact: true })).toBeVisible();
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
    await expect(header.locator('.report-student-name')).toHaveText('Cece Adeyemi');
    const meta = header.locator('.report-header-meta');
    await expect(meta.locator('.report-period')).toHaveText(
      await page.locator('#report-period option:checked').innerText(),
    );
    await expect(meta).toContainText(/\w{3} \d{1,2} – \w{3} \d{1,2}, \d{4}/);
    await expect(meta).toContainText('Student No. STU-201');
    await expect(page.locator('.report-sheet').first().locator('.sheet-footer')).toContainText(
      'Cece Adeyemi · Page 1 of 2',
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
