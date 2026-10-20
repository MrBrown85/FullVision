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
  await expect(page.locator('.report-student')).toHaveCount(STUDENTS);
}

async function applyPreset(page, preset) {
  await page.locator(`[data-action="rbApplyPreset"][data-preset="${preset}"]`).click();
  await expect(page.locator(`.rb-preset-btn.active[data-preset="${preset}"]`)).toBeVisible();
}

async function printToPdf(page) {
  await page.emulateMedia({ media: 'print' });
  const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
  await page.emulateMedia({ media: 'screen' });
  return pdf;
}

test.describe('Printed progress reports', () => {
  test.setTimeout(90_000);

  test('Standard prints two Letter pages per student', async ({ page }) => {
    await openDemoProgressReports(page);
    await applyPreset(page, 'standard');
    const pdf = await printToPdf(page);
    expect(countPages(pdf)).toBe(STUDENTS * 2);
    for (const [w, h] of pageBoxes(pdf)) {
      expect([w, h]).toEqual([612, 792]);
    }
  });

  test('Brief prints one page per student', async ({ page }) => {
    await openDemoProgressReports(page);
    await applyPreset(page, 'brief');
    expect(countPages(await printToPdf(page))).toBe(STUDENTS);
  });

  test('every Standard report is exactly two pages, including the students with Next Steps', async ({ page }) => {
    await openDemoProgressReports(page);
    await applyPreset(page, 'standard');
    const rows = page.locator('#gb-sidebar .student-row');
    const n = await rows.count();
    const uneven = [];
    for (let i = 0; i < n; i++) {
      await rows.nth(i).click();
      await expect(page.locator('.report-student')).toHaveCount(1);
      const pages = countPages(await printToPdf(page));
      if (pages !== 2) uneven.push(`${await rows.nth(i).innerText()}: ${pages}`);
    }
    expect(uneven, 'students whose report is not two pages').toEqual([]);
  });

  test('the letterhead names the class, block, report, term dates and student number', async ({ page }) => {
    await openDemoProgressReports(page);
    const header = page.locator('.report-student').first().locator('.report-header');
    await expect(header.locator('.report-course-title')).toHaveText('Science 8 · Block A');
    await expect(header.locator('.report-student-name')).toHaveText('Cece Adeyemi');
    const meta = header.locator('.report-header-meta');
    await expect(meta.locator('.report-period')).toHaveText(
      await page.locator('#report-period option:checked').innerText(),
    );
    await expect(meta).toContainText(/\w{3} \d{1,2} – \w{3} \d{1,2}, \d{4}/);
    await expect(meta).toContainText('Student No. STU-201');
  });

  test('levels print as dots and a word in black', async ({ page }) => {
    await openDemoProgressReports(page);
    await applyPreset(page, 'standard');
    const first = page.locator('.report-student').first();
    const chip = first.locator('.report-section-chip-value').first();
    await expect(chip).toContainText(/[●○]{4}/);
    await expect(first.locator('.report-learner-dim-value').first()).toContainText(/[●○]{4}/);
    await page.emulateMedia({ media: 'print' });
    expect(await chip.evaluate(el => getComputedStyle(el).color)).toBe('rgb(0, 0, 0)');
    expect(
      await first
        .locator('.report-learner-dim-value')
        .first()
        .evaluate(el => getComputedStyle(el).color),
    ).toBe('rgb(0, 0, 0)');
    await page.emulateMedia({ media: 'screen' });
    await page.getByRole('tab', { name: 'Class Summary' }).click();
    await expect(page.locator('.class-summary-table td[data-prof]').first()).toContainText(/[●○]{4}/);
  });

  test('Legal paper prints a 14 in page and is remembered for the class on this device', async ({ page }) => {
    await openDemoProgressReports(page);
    await applyPreset(page, 'standard');
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
    await applyPreset(page, 'standard');
    await expect(page.locator('#rb-preview')).not.toContainText('Not Assessed');
  });
});
