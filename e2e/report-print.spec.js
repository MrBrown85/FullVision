/**
 * Printed progress reports, counted in pages.
 *
 * Demo Mode's Science 8 class (27 students, term ratings, comments) is
 * printed through Chromium's print engine on Letter paper and the PDF's pages
 * are counted. These numbers are the ones docs/report-forms-plan.md says to
 * hold: Standard is two pages per student, Brief one. Before 2026-10-20 the
 * Standard preset printed three pages per student with the third mostly
 * blank, and nothing in the suite would have noticed.
 */
import { test, expect } from '@playwright/test';

const STUDENTS = 27;

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

async function openDemoProgressReports(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.goto(page.url().replace(/#.*/, '#/reports'));
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('.report-sheet').first()).toBeVisible();
}

/* Everyone: every student's pages on the canvas, which is what prints. */
async function showEveryone(page) {
  await page.locator('[data-action="studioView"][data-view="all"]').click();
  await expect(page.locator('.report-sheet')).toHaveCount(STUDENTS * 2);
}

/* A template from the palette's Templates tab. */
async function applyTemplate(page, id) {
  await page.locator('[data-action="studioTab"][data-tab="templates"]').click();
  await page.locator(`[data-action="studioTemplate"][data-starter="${id}"]`).click();
  await page.locator('[data-action="studioTab"][data-tab="blocks"]').click();
}

async function printToPdf(page) {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  return pdf;
}

test.describe('Printed progress reports', () => {
  test.setTimeout(90_000);

  test('the Report Card prints two Letter pages per student', async ({ page }) => {
    await openDemoProgressReports(page);
    await showEveryone(page);
    const pdf = await printToPdf(page);
    expect(countPages(pdf)).toBe(STUDENTS * 2);
    for (const [w, h] of pageBoxes(pdf)) {
      expect([w, h]).toEqual([612, 792]);
    }
  });

  test('the Interim Update prints one side per student, with its back left blank for duplex', async ({ page }) => {
    await openDemoProgressReports(page);
    await applyTemplate(page, 'interim-update');
    await showEveryone(page);
    expect(countPages(await printToPdf(page))).toBe(STUDENTS * 2);
    await expect(page.locator('.report-sheet .report-legend')).toHaveCount(STUDENTS);
  });

  test('every report is exactly one sheet, including the students with Next Steps', async ({ page }) => {
    await openDemoProgressReports(page);
    await showEveryone(page);
    const sheets = await page.locator('.sheet-student').evaluateAll(els => els.map(el => el.dataset.sheets));
    expect(sheets).toHaveLength(STUDENTS);
    expect(
      sheets.every(n => n === '1'),
      'students needing more than one sheet',
    ).toBe(true);
    expect(countPages(await printToPdf(page))).toBe(STUDENTS * 2);
  });

  test('the letterhead names the class, block, report, term dates and student number', async ({ page }) => {
    await openDemoProgressReports(page);
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
    await openDemoProgressReports(page);
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
    await openDemoProgressReports(page);
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
    await openDemoProgressReports(page);
    await expect(page.locator('#rb-preview')).not.toContainText('Not Assessed');
  });
});
