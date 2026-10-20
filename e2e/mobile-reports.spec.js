/**
 * The phone's Reports tab is read-only (docs/report-forms-plan.md 5.4): the
 * class's issued copies for a report, and the live Report Card one student
 * at a time, scaled to the phone. Nothing is set up, issued or printed
 * there. Runs in Demo Mode on Science 8.
 */
import { test, expect } from '@playwright/test';

async function enterDemoOnPhone(page) {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="reports"]').click();
  await expect(page.locator('#m-screen-reports')).toBeVisible();
}

test.describe('Phone Reports tab', () => {
  test('lists the reports, says nothing is issued, and has no setup controls', async ({ page }) => {
    await enterDemoOnPhone(page);
    const terms = page.locator('#m-screen-reports [role="radiogroup"][aria-label="Report"] [role="radio"]');
    expect(await terms.count()).toBeGreaterThan(0);
    await expect(page.locator('#m-screen-reports')).toContainText('Nothing issued yet');
    await expect(page.locator('#m-reports-students .m-cell').first()).toContainText('Cece Adeyemi');
    await expect(page.locator('.rb-setup, [data-action="rbSetupForm"], [data-action="printReports"]')).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    ).toBe(true);
  });

  test('a student opens as their Report Card, scaled to the phone, and the stepper walks the class', async ({
    page,
  }) => {
    await enterDemoOnPhone(page);
    await page.locator('#m-reports-students .m-cell').first().click();
    await expect(page.locator('#m-screen-reports-live')).toBeVisible();
    await expect(page.locator('#m-reports-sheets .report-sheet')).toHaveCount(2);
    await expect(page.locator('#m-reports-name')).toHaveText('Cece Adeyemi');
    await expect(page.locator('#m-reports-count')).toContainText(/1 of \d+ · 1 sheet/);
    const box = await page.locator('#m-reports-sheets .report-sheet').first().boundingBox();
    expect(box.width).toBeLessThanOrEqual(375);
    const over = await page
      .locator('#m-reports-sheets .report-sheet')
      .evaluateAll(sheets => sheets.filter(s => s.scrollHeight > s.clientHeight + 1).length);
    expect(over).toBe(0);
    await page.getByRole('button', { name: 'Next student' }).click();
    await expect(page.locator('#m-reports-name')).toHaveText('Noor Al-Rashid');
    await page.getByRole('button', { name: 'Previous student' }).click();
    await expect(page.locator('#m-reports-name')).toHaveText('Cece Adeyemi');
    await page.locator('[data-action="m-back"]').click();
    await expect(page.locator('#m-screen-reports')).toBeVisible();
  });

  test('a copy issued on the desktop shows on the phone and opens student by student', async ({ page }) => {
    // Issue on the desktop (wide window), then look on the phone: same browser, same Demo Mode copy.
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/app\.html/, { timeout: 15000 });
    await page.goto(page.url().replace(/#.*/, '#/reports'));
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await page.locator('[data-action="rbApplyPreset"][data-preset="standard"]').click();
    await expect(page.locator('.report-sheet').first()).toBeVisible();
    const term = await page.locator('#report-period option:checked').innerText();
    await page.getByRole('button', { name: 'Issue Reports…' }).click();
    await page.locator('#issue-overlay #issue-print').uncheck();
    await page.locator('#issue-overlay [data-issue="go"]').click();
    await expect(page.locator('#rb-form-summary')).toContainText(/Issued .* saved as a fixed copy/);

    await page.setViewportSize({ width: 375, height: 740 });
    await page.goto('/teacher-mobile/');
    await page.locator('.m-tab-item[data-tab="reports"]').click();
    await expect(page.locator('#m-screen-reports')).toBeVisible();
    await page.locator('#m-screen-reports [role="radio"]', { hasText: term }).click();
    const copy = page.locator('#m-reports-issues .m-cell').first();
    await expect(copy).toContainText(/Issued /);
    await expect(copy).toContainText('27 reports');
    await copy.click();
    await expect(page.locator('#m-screen-reports-issue')).toBeVisible();
    await expect(page.locator('#m-reports-sheets .report-sheet')).toHaveCount(2);
    await expect(page.locator('#m-reports-count')).toContainText('1 of 27');
    await page.getByRole('button', { name: 'Next student' }).click();
    await expect(page.locator('#m-reports-count')).toContainText('2 of 27');
  });
});
