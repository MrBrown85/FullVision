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

/* Opens the dialog, picks the given radios by label, and returns its
   status line. */
async function openDialog(page) {
  await page.getByRole('button', { name: 'Print Grades' }).click();
  const dialog = page.getByRole('dialog', { name: 'Print Grades' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function pagesInStatus(dialog) {
  const text = await dialog.locator('#gp-status').innerText();
  const m = text.match(/(\d+) pages?\./);
  return m ? Number(m[1]) : 0;
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

  test('the dialog labels are Title Case', async ({ page }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    const legends = await dialog.locator('legend').allInnerTexts();
    expect(legends).toEqual(['Term', 'Assessments', 'Scores', 'Students', 'Sort By', 'Show', 'Paper', 'Text Size']);
    const labels = await dialog
      .locator('.gp-option:not(.gp-pick-option) > span')
      .evaluateAll(els => els.map(el => el.firstChild.textContent.trim()));
    const small = new Set(['a', 'an', 'and', 'as', 'for', 'in', 'of', 'the', 'to', 'by']);
    for (const label of labels) {
      for (const word of label.split(/\s+/)) {
        if (!word || small.has(word) || /^\d/.test(word)) continue;
        expect(word[0], `"${label}"`).toBe(word[0].toUpperCase());
      }
    }
    await expect(dialog.locator('#gp-status')).toHaveText(`${STUDENTS} students · 37 columns · 3 pages.`);
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('Letter prints 3 portrait pages, each with every student and the header, filled to the edges', async ({
    page,
  }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    await dialog.getByLabel('All Time').check();
    await dialog.getByLabel('Letter').check();
    await dialog.getByLabel('Normal').check();
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
    await dialog.getByLabel('All Time').check();
    await dialog.getByLabel('Legal').check();
    expect(await pagesInStatus(dialog)).toBe(3);
    await stageFromDialog(page, dialog);
    // The page rule names the paper and portrait, so the print dialog picks Legal.
    expect(await page.locator('#grades-print-page').textContent()).toContain('size: legal portrait');
    const pdf = await pdfOfStaged(page);
    expect(countPages(pdf)).toBe(3);
    for (const box of pageBoxes(pdf)) expect(box).toEqual([612, 1008]);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Print Grades' })).toBeVisible();
    dialog = await openDialog(page);
    await expect(dialog.getByLabel('Legal')).toBeChecked();
    await dialog.getByLabel('Letter').check();
  });

  test('Pupil # Only prints numbers and no names', async ({ page }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    await dialog.getByLabel('All Time').check();
    await dialog.getByLabel('Pupil # Only').check();
    await stageFromDialog(page, dialog);
    const root = page.locator('#grades-print-root');
    await expect(root.locator('th.gp-rh').first()).toHaveText('Pupil #');
    await expect(root.locator('td.gp-name')).toHaveCount(0);
    await expect(root).not.toContainText('Adeyemi');
    await expect(root).toContainText('STU-201');
    await pdfOfStaged(page);
    const reset = await openDialog(page);
    await reset.getByLabel('Pupil # and Name').check();
    await reset.getByRole('button', { name: 'Cancel' }).click();
  });

  test('Compact prints fewer pages than Normal', async ({ page }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    await dialog.getByLabel('All Time').check();
    await dialog.getByLabel('Letter').check();
    await dialog.getByLabel('Normal').check();
    const normal = await pagesInStatus(dialog);
    await dialog.getByLabel('Compact').check();
    const compact = await pagesInStatus(dialog);
    expect(compact).toBeLessThan(normal);
    await dialog.getByLabel('Normal').check();
  });

  test('a term prints its own columns and leaves the gradebook as it was', async ({ page }) => {
    await openDemoGradebook(page);
    const picker = page.locator('#main .term-select');
    const before = await picker.inputValue();
    const dialog = await openDialog(page);
    await dialog.getByLabel('Term 2', { exact: false }).check();
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

  test('Blank Grid prints the roster on an empty grid', async ({ page }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    await dialog.getByLabel('All Time').check();
    await dialog.getByLabel('Blank Grid').check();
    await expect(dialog.locator('#gp-status')).toHaveText(`${STUDENTS} students · Blank Grid · 1 page.`);
    await expect(dialog.getByLabel('Final Grade')).toBeDisabled();
    await stageFromDialog(page, dialog);
    const sheet = page.locator('#grades-print-root .gp-page');
    await expect(sheet).toHaveCount(1);
    await expect(sheet.locator('.gp-row:not(.gp-blank-row)')).toHaveCount(STUDENTS);
    await expect(sheet.locator('th.gp-ch[data-col]')).toHaveCount(0);
    expect(await sheet.locator('.gp-row').first().locator('td.gp-blank').count()).toBeGreaterThan(5);
    await expect(sheet.locator('.gp-head')).toContainText('Scores: Blank Grid');
    expect(countPages(await pdfOfStaged(page))).toBe(1);
    const reset = await openDialog(page);
    await reset.getByLabel('All Assessments').check();
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
    await expect(dialog.locator('#gp-status')).toHaveText('3 students · Blank Grid · 1 page.');
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
