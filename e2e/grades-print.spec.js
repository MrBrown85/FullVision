/**
 * Print Grades: the class grade sheet, printed from Demo Mode's Science 8
 * (27 students, 37 assessments) through Chromium's print engine.
 * teacher/grades-print.js; docs/DECISIONS.md "Printed class grade sheet".
 *
 * Portrait, laid out like MyEd's class list with grid, filling the page.
 * The page counts are the dialog's arithmetic, held against the PDF: 3
 * Letter or Legal pages at Normal size, 2 at Compact, all time.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp } from './helpers.js';

const STUDENTS = 27;

function countPages(pdf) {
  const text = pdf.toString('latin1');
  return (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
}

function pageBoxes(pdf) {
  const text = pdf.toString('latin1');
  return [...text.matchAll(/\/MediaBox\s*\[\s*0\s+0\s+(\d+)\s+(\d+)\s*\]/g)].map(m => [Number(m[1]), Number(m[2])]);
}

async function openDemoGradebook(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.goto(page.url().replace(/#.*/, '#/gradebook'));
  await expect(page.getByRole('button', { name: 'Print Grades' })).toBeVisible();
}

async function openDialog(page) {
  await page.getByRole('button', { name: 'Print Grades' }).click();
  const dialog = page.getByRole('dialog', { name: 'Print Grades' });
  await expect(dialog).toBeVisible();
  return dialog;
}

/* Sets a row's value through its menu: the row's button, then the choice. */
async function choose(dialog, row, choice) {
  await dialog.getByRole('button', { name: new RegExp('^' + row + ' ') }).click();
  const menu = dialog.page().getByRole('menu');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: choice }).click();
  await expect(menu).toHaveCount(0);
}

async function pagesInStatus(dialog) {
  const text = await dialog.locator('.gpd-count-pages').innerText();
  const m = text.match(/^(\d+) pages? · /);
  return m ? Number(m[1]) : 0;
}

async function expectCount(dialog, pages, detail) {
  await expect(dialog.locator('.gpd-count-pages')).toHaveText(pages);
  await expect(dialog.locator('.gpd-count-detail')).toHaveText(detail);
}

/* Print from the dialog with window.print stubbed. The staged pages are
   kept until the test makes its PDF: the stub returns at once, and print()
   would otherwise clear them on its next tick. */
async function stageFromDialog(page, dialog) {
  await page.evaluate(() => {
    window.__printed = 0;
    window.print = () => {
      window.__printed++;
    };
    const realSetTimeout = window.setTimeout;
    window.__holdCleanup = true;
    window.setTimeout = (fn, ms, ...rest) => (window.__holdCleanup && !ms ? 0 : realSetTimeout(fn, ms, ...rest));
  });
  await dialog.getByRole('button', { name: 'Print', exact: true }).click();
  await expect(page.locator('body.grades-print-active')).toHaveCount(1);
  expect(await page.evaluate(() => window.__printed)).toBe(1);
}

/* Chromium fires afterprint while it prints to PDF, which clears the sheet,
   so DOM checks come before this. */
async function pdfOfStaged(page) {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => {
    window.__holdCleanup = false;
  });
  return pdf;
}

test.describe('Print Grades', () => {
  test.setTimeout(90_000);

  test('the button is on every gradebook view and the toolbar keeps New Assessment', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await openDemoGradebook(page);
    for (const mode of ['detailed', 'scores']) {
      await page.locator(`[data-action="setView"][data-mode="${mode}"]`).click();
      await expect(page.getByRole('button', { name: 'Print Grades' })).toBeVisible();
      await expect(page.getByRole('link', { name: '+ New Assessment' })).toBeInViewport();
    }
  });

  test('the dialog has its rows in three groups, Title Case, with a live page count', async ({ page }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    const groups = await dialog.locator('.gpd-group-label').evaluateAll(els => els.map(el => el.textContent));
    expect(groups).toEqual(['Content', 'Students', 'Page']);
    const labels = await dialog.locator('.gpd-label').allTextContents();
    expect(labels).toEqual([
      'Term',
      'Assessments',
      'Scores',
      'Blank Gradebook',
      'Attendance',
      'Show As',
      'Sort By',
      'Final Grade',
      'Class Average Row',
      'Late Marks',
      'Paper',
      'Text Size',
    ]);
    const values = await dialog.locator('.gpd-value').allTextContents();
    expect(values).toEqual([
      'All Time',
      'All Assessments',
      'As Entered',
      'Pupil # and Name',
      'Last Name',
      'Letter · 8.5 × 11 in',
      'Normal',
    ]);
    const small = new Set(['a', 'an', 'and', 'as', 'for', 'in', 'of', 'the', 'to', 'by', '·', '×', '#']);
    for (const label of labels.concat(values)) {
      for (const word of label.split(/\s+/)) {
        if (!word || small.has(word) || /^\d/.test(word)) continue;
        expect(word[0], `"${label}"`).toBe(word[0].toUpperCase());
      }
    }
    await expect(dialog.getByRole('switch')).toHaveCount(5);
    await expectCount(dialog, '3 pages · Letter', `${STUDENTS} students · 37 columns`);
    // The page picture shows the first page's columns and the final grade only on the last.
    await expect(dialog.locator('.gpd-thumb .gpd-t-colhead .gpd-t-cell')).toHaveCount(14);
    await expect(dialog.locator('.gpd-thumb .gpd-t-avg')).toHaveCount(1);
    // A menu closes on Escape first, then the dialog.
    await dialog.getByRole('button', { name: /^Term / }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitemradio', { name: 'All Time' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('menuitemradio', { name: /^Term 1/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: /^Term / })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('Letter prints 3 portrait pages, each with every student and the header, filled to the edges', async ({
    page,
  }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    await choose(dialog, 'Term', 'All Time');
    await choose(dialog, 'Paper', /^Letter/);
    await choose(dialog, 'Text Size', 'Normal');
    const expected = await pagesInStatus(dialog);
    expect(expected).toBe(3);
    await stageFromDialog(page, dialog);
    const pages = page.locator('#grades-print-root .gp-page');
    await expect(pages).toHaveCount(expected);
    for (let i = 0; i < expected; i++) {
      const p = pages.nth(i);
      await expect(p.locator('.gp-row')).toHaveCount(STUDENTS);
      const head = p.locator('.gp-head');
      await expect(head).toContainText('Class Grade Sheet');
      await expect(head).toContainText('Class: Science 8');
      await expect(head).toContainText('Block: A');
      await expect(head.locator('.gp-head-line')).toContainText(`Page ${i + 1} of ${expected}`);
      await expect(p.locator('th.gp-rh')).toHaveText(['Pupil #', 'Name']);
      // The grid runs to the foot and the right edge, and nothing runs past the page.
      const fit = await p.evaluate(el => {
        const box = el.getBoundingClientRect();
        const grid = el.querySelector('.gp-grid').getBoundingClientRect();
        const key = el.querySelector('.gp-key').getBoundingClientRect();
        const inch = 96;
        return {
          inside: grid.right <= box.right + 0.5 && grid.bottom <= key.top + 0.5 && key.bottom <= box.bottom + 0.5,
          toFoot: key.top - grid.bottom < 0.2 * inch,
          toEdge: box.right - grid.right < 0.2 * inch,
        };
      });
      expect(fit).toEqual({ inside: true, toFoot: true, toEdge: true });
    }
    // No category averages; the final grade sits at the right of the last page only.
    await expect(page.locator('#grades-print-root')).not.toContainText('Category Averages');
    await expect(pages.nth(0).locator('th.gp-final')).toHaveCount(0);
    await expect(pages.nth(expected - 1).locator('th.gp-final.gp-ch')).toHaveText('Final Grade');
    await expect(
      pages
        .nth(expected - 1)
        .locator('.gp-row td.gp-final')
        .first(),
    ).toHaveText(/^\d\.\d$/);
    // Every column prints once.
    expect(await page.locator('#grades-print-root th.gp-ch[data-col]').count()).toBe(37);

    const pdf = await pdfOfStaged(page);
    expect(countPages(pdf)).toBe(expected);
    for (const box of pageBoxes(pdf)) expect(box).toEqual([612, 792]);
  });

  test('Legal prints 3 taller pages and is remembered for the class', async ({ page }) => {
    await openDemoGradebook(page);
    let dialog = await openDialog(page);
    await choose(dialog, 'Term', 'All Time');
    await choose(dialog, 'Paper', /^Legal/);
    await expectCount(dialog, '3 pages · Legal', `${STUDENTS} students · 37 columns`);
    await stageFromDialog(page, dialog);
    // The page rule names the paper and portrait, so the print dialog picks Legal.
    expect(await page.locator('#grades-print-page').textContent()).toContain('size: legal portrait');
    const pdf = await pdfOfStaged(page);
    expect(countPages(pdf)).toBe(3);
    for (const box of pageBoxes(pdf)) expect(box).toEqual([612, 1008]);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Print Grades' })).toBeVisible();
    dialog = await openDialog(page);
    await expect(dialog.getByRole('button', { name: /^Paper / })).toHaveText('Legal · 8.5 × 14 in');
    await choose(dialog, 'Paper', /^Letter/);
  });

  test('Pupil # Only prints numbers and no names', async ({ page }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    await choose(dialog, 'Term', 'All Time');
    await choose(dialog, 'Show As', 'Pupil # Only');
    await stageFromDialog(page, dialog);
    const root = page.locator('#grades-print-root');
    await expect(root.locator('th.gp-rh').first()).toHaveText('Pupil #');
    await expect(root.locator('td.gp-name')).toHaveCount(0);
    await expect(root).not.toContainText('Adeyemi');
    await expect(root).toContainText('STU-201');
    await pdfOfStaged(page);
    const reset = await openDialog(page);
    await choose(reset, 'Show As', 'Pupil # and Name');
    await reset.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Compact prints fewer pages than Normal', async ({ page }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    await choose(dialog, 'Term', 'All Time');
    await choose(dialog, 'Paper', /^Letter/);
    await choose(dialog, 'Text Size', 'Normal');
    const normal = await pagesInStatus(dialog);
    await choose(dialog, 'Text Size', 'Compact');
    const compact = await pagesInStatus(dialog);
    expect(compact).toBeLessThan(normal);
    await choose(dialog, 'Text Size', 'Normal');
  });

  test('a term prints its own columns and leaves the gradebook as it was', async ({ page }) => {
    await openDemoGradebook(page);
    const picker = page.locator('#main .term-select');
    const before = await picker.inputValue();
    const dialog = await openDialog(page);
    await choose(dialog, 'Term', /^Term 2/);
    await expect(dialog.getByRole('button', { name: /^Term / })).toHaveText('Term 2');
    await stageFromDialog(page, dialog);
    await expect(page.locator('#grades-print-root .gp-head').first()).toContainText('Term 2');
    expect(countPages(await pdfOfStaged(page))).toBeGreaterThan(0);
    // After the print dialog closes the sheet is cleared and the term is the gradebook's own.
    await page.evaluate(() => {
      window.__holdCleanup = false;
      window.dispatchEvent(new Event('afterprint'));
    });
    await expect(page.locator('body.grades-print-active')).toHaveCount(0);
    await expect(page.locator('#grades-print-root .gp-page')).toHaveCount(0);
    expect(await picker.inputValue()).toBe(before);
    expect(await page.evaluate(() => (getActiveTerm(getActiveCourse()) || { ordinal: 'all' }).ordinal + '')).toBe(
      before,
    );
  });

  test('Blank Gradebook prints the assessment titles over empty score boxes', async ({ page }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    await choose(dialog, 'Term', 'All Time');
    await dialog.getByLabel('Blank Gradebook').check();
    await expect(dialog.getByLabel('Blank Gradebook')).toHaveAccessibleDescription(
      'Prints the assessment titles across the top with every score box empty.',
    );
    await expectCount(dialog, '3 pages · Letter', `${STUDENTS} students · Blank Gradebook · 37 columns`);
    for (const label of ['Final Grade', 'Class Average Row', 'Late Marks']) {
      await expect(dialog.getByLabel(label)).toBeDisabled();
    }
    await expect(dialog.getByRole('button', { name: /^Scores / })).toBeDisabled();
    // The picture shows a stroke for each title.
    await expect(dialog.locator('.gpd-thumb .gpd-t-colhead .gpd-t-cell i')).toHaveCount(13);
    await expect(dialog.locator('.gpd-thumb .gpd-t-avg')).toHaveCount(0);
    await stageFromDialog(page, dialog);
    const sheet = page.locator('#grades-print-root .gp-page');
    await expect(sheet).toHaveCount(3);
    await expect(sheet.first().locator('.gp-row:not(.gp-blank-row)')).toHaveCount(STUDENTS);
    await expect(sheet.first().locator('th.gp-ch[data-col]')).toHaveCount(13);
    await expect(sheet.first().locator('.gp-row td.gp-cell')).not.toHaveCount(0);
    expect(
      await sheet.locator('.gp-row td.gp-cell').evaluateAll(cells => cells.filter(c => c.textContent.trim()).length),
    ).toBe(0);
    await expect(sheet.locator('.gp-avg')).toHaveCount(0);
    await expect(sheet.first().locator('.gp-head')).toContainText('Scores: Blank');
    expect(countPages(await pdfOfStaged(page))).toBe(3);
    const reset = await openDialog(page);
    await reset.getByLabel('Blank Gradebook').uncheck();
    await reset.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Attendance prints school days from this Monday, a band per week', async ({ page }) => {
    await page.clock.setFixedTime(new Date('2026-10-21T10:00:00'));
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    await dialog.getByLabel('Attendance').check();
    await expect(dialog.getByLabel('Attendance')).toHaveAccessibleDescription(
      'Prints school days across the top, Monday to Friday, from Mon Oct 19.',
    );
    await expectCount(dialog, '1 page · Letter', `${STUDENTS} students · 16 school days`);
    for (const label of ['Blank Gradebook', 'Final Grade', 'Class Average Row', 'Late Marks']) {
      await expect(dialog.getByLabel(label)).toBeDisabled();
    }
    for (const row of ['Term', 'Assessments', 'Scores']) {
      await expect(dialog.getByRole('button', { name: new RegExp('^' + row + ' ') })).toBeDisabled();
    }
    // The picture draws a heavier rule where each new week begins.
    await expect(dialog.locator('.gpd-thumb .gpd-t-colhead .gpd-t-brk')).toHaveCount(3);
    await stageFromDialog(page, dialog);
    const sheet = page.locator('#grades-print-root .gp-page');
    await expect(sheet).toHaveCount(1);
    await expect(sheet.locator('.gp-head-title')).toHaveText('Attendance Sheet');
    await expect(sheet.locator('.gp-head')).toContainText('Dates: Oct 19 – Nov 9, 2026');
    const heads = await sheet.locator('th.gp-ch[data-col]').allTextContents();
    expect(heads.slice(0, 6)).toEqual([
      'Mon Oct 19',
      'Tue Oct 20',
      'Wed Oct 21',
      'Thu Oct 22',
      'Fri Oct 23',
      'Mon Oct 26',
    ]);
    expect(heads).toHaveLength(16);
    await expect(sheet.locator('.gp-band-cell')).toHaveText(['Week of Oct 19', 'Week of Oct 26', 'Week of Nov 2', '']);
    await expect(sheet.locator('.gp-row:not(.gp-blank-row)')).toHaveCount(STUDENTS);
    expect(countPages(await pdfOfStaged(page))).toBe(1);
    const reset = await openDialog(page);
    await reset.getByLabel('Attendance').uncheck();
    await reset.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Custom Dates shows From and To, and Pick Assessments its list', async ({ page }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    await choose(dialog, 'Term', 'Custom Dates');
    await dialog.getByRole('textbox', { name: 'From' }).fill('2026-04-01');
    await dialog.getByRole('textbox', { name: 'To' }).fill('2026-05-10');
    await expect(dialog.getByLabel('Final Grade')).toBeDisabled();
    await choose(dialog, 'Assessments', 'Pick Assessments');
    const pick = dialog.getByRole('group', { name: 'Pick Assessments' });
    await expect(pick.getByRole('checkbox')).toHaveCount(4);
    await pick.getByRole('checkbox', { name: /Cell Structure Quiz/ }).check();
    await pick.getByRole('checkbox', { name: /Periodic Table Quiz/ }).check();
    await expectCount(dialog, '1 page · Letter', `${STUDENTS} students · 2 columns`);
    await stageFromDialog(page, dialog);
    await expect(page.locator('#grades-print-root th.gp-ch[data-col]')).toHaveCount(2);
    await pdfOfStaged(page);
    const reset = await openDialog(page);
    await choose(reset, 'Term', 'All Time');
    await choose(reset, 'Assessments', 'All Assessments');
    await reset.getByRole('button', { name: 'Cancel' }).click();
  });
});

test.describe('Print Grades, class with no assessments', () => {
  test('prints a blank grid and Print is enabled', async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await gotoApp(page, '/gradebook');
    const dialog = await openDialog(page);
    await expectCount(dialog, '1 page · Letter', '3 students · Blank Grid · 11 columns');
    await expect(dialog.getByRole('button', { name: 'Print', exact: true })).toBeEnabled();
    await stageFromDialog(page, dialog);
    const sheet = page.locator('#grades-print-root .gp-page');
    await expect(sheet).toHaveCount(1);
    await expect(sheet.locator('.gp-row:not(.gp-blank-row)')).toHaveCount(3);
    await expect(sheet.locator('.gp-row').first()).toContainText('Anderson, Alice');
    const pdf = await pdfOfStaged(page);
    expect(countPages(pdf)).toBe(1);
    for (const box of pageBoxes(pdf)) expect(box).toEqual([612, 792]);
  });
});
