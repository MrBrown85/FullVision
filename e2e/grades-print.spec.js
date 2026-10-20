/**
 * Print Grades: the class grade sheet, printed from Demo Mode's Science 8
 * (27 students, 37 assessments) through Chromium's print engine.
 * teacher/grades-print.js; docs/DECISIONS.md "Printed class grade sheet".
 *
 * The page counts are the dialog's arithmetic, held against the PDF: 3
 * Letter pages and 2 Legal pages at Normal size, all time.
 */
import { test, expect } from '@playwright/test';

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
    for (const mode of ['detailed', 'scores', 'summary']) {
      await page.locator(`[data-action="setView"][data-mode="${mode}"]`).click();
      await expect(page.getByRole('button', { name: 'Print Grades' })).toBeVisible();
      await expect(page.getByRole('link', { name: '+ New Assessment' })).toBeInViewport();
    }
  });

  test('the dialog labels are Title Case', async ({ page }) => {
    await openDemoGradebook(page);
    const dialog = await openDialog(page);
    const legends = await dialog.locator('legend').allInnerTexts();
    expect(legends).toEqual(['Term', 'Assessments', 'Scores', 'Show', 'Sort By', 'Paper', 'Text Size']);
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

  test('Letter prints 3 landscape pages, each with every student and the header', async ({ page }) => {
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
      await expect(p.locator('.gp-head')).toContainText('Science 8 · Block A');
      await expect(p.locator('.gp-head')).toContainText('Printed');
      await expect(p.locator('.gp-foot-line')).toContainText(`Page ${i + 1} of ${expected}`);
      // Nothing runs past the page box.
      const fit = await p.evaluate(el => {
        const box = el.getBoundingClientRect();
        const grid = el.querySelector('.gp-grid').getBoundingClientRect();
        const foot = el.querySelector('.gp-foot').getBoundingClientRect();
        return {
          gridOk: grid.right <= box.right + 0.5 && grid.bottom <= foot.top + 0.5,
          footOk: foot.bottom <= box.bottom + 0.5,
        };
      });
      expect(fit).toEqual({ gridOk: true, footOk: true });
    }
    // The summary sits on the last page only.
    await expect(pages.nth(0).locator('.gp-sum')).toHaveCount(0);
    await expect(
      pages
        .nth(expected - 1)
        .locator('th.gp-sum')
        .last(),
    ).toHaveText('Overall');
    // Every column prints once.
    expect(await page.locator('#grades-print-root th.gp-ch[data-col]').count()).toBe(37);

    const pdf = await pdfOfStaged(page);
    expect(countPages(pdf)).toBe(expected);
    for (const box of pageBoxes(pdf)) expect(box).toEqual([792, 612]);
  });

  test('Legal prints 2 wider pages and is remembered for the class', async ({ page }) => {
    await openDemoGradebook(page);
    let dialog = await openDialog(page);
    await dialog.getByLabel('All Time').check();
    await dialog.getByLabel('Legal').check();
    expect(await pagesInStatus(dialog)).toBe(2);
    await stageFromDialog(page, dialog);
    const pdf = await pdfOfStaged(page);
    expect(countPages(pdf)).toBe(2);
    for (const box of pageBoxes(pdf)) expect(box).toEqual([1008, 612]);

    await page.reload();
    await expect(page.getByRole('button', { name: 'Print Grades' })).toBeVisible();
    dialog = await openDialog(page);
    await expect(dialog.getByLabel('Legal')).toBeChecked();
    await dialog.getByLabel('Letter').check();
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
});
