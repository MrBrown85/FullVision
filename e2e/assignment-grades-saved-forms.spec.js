import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* A report saved on main with Assignment Grades' Proficiency Word on, and
   one with it off, open on this build in each grading style (Assignment
   Grades layout, 2026-11-12). e2e/fixtures/report-config-main.json holds
   what main stored after the teacher's clicks in Page Studio (main
   9953ecc3: Custom, then the Word box ticked, then unticked).

   In a Proficiency or Both class the report draws with no word column and
   Page Studio does not offer Word; in a Letter class Word is offered with
   the saved choice and the column follows it. Opening the report,
   selecting the block and printing it leave the stored report exactly as
   main stored it. */

const SAVED = JSON.parse(readFileSync(resolve('e2e/fixtures/report-config-main.json'), 'utf8'));
const stored = page => page.evaluate(() => localStorage.getItem('gb-report-config-sci8'));

for (const word of ['on', 'off']) {
  test(`a report saved on main with Proficiency Word ${word} loads, draws and prints in every grading style, unchanged`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    const raw = JSON.stringify(SAVED[word]);
    expect(raw).toContain(`"word":${word === 'on'}`);
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.waitForFunction(() => getStudents('sci8').length > 0);
    await page.evaluate(r => localStorage.setItem('gb-report-config-sci8', r), raw);
    await page.reload();
    await page.waitForFunction(() => getStudents('sci8').length > 0);
    for (const mode of ['proficiency', 'both', 'letter']) {
      await page.evaluate(m => {
        COURSES.sci8.gradingSystem = m;
        window.Router.navigate('/dashboard');
      }, mode);
      await page.evaluate(r => window.Router.navigate(r), '/reports');
      await page.getByRole('tab', { name: 'Progress Reports' }).click();
      const cell = page.locator('#rb-preview .sheet-cell[data-block="grade-table"]').first();
      await expect(cell).toBeVisible();
      await expect(cell.locator('.report-grades-row').first()).toBeVisible();
      await cell.click();
      const bar = page.locator('.studio-bar');
      await expect(bar).toBeVisible();
      const box = bar.locator('input[data-key="word"]');
      const words = page.locator('#rb-preview .report-grades-word');
      if (mode === 'letter') {
        // The option and the column come back with the saved choice.
        await expect(box).toHaveCount(1);
        if (word === 'on') {
          await expect(box).toBeChecked();
          await expect(words.first()).toBeAttached();
        } else {
          await expect(box).not.toBeChecked();
          await expect(words).toHaveCount(0);
        }
      } else {
        await expect(box).toHaveCount(0);
        await expect(words).toHaveCount(0);
      }
      // Print it.
      await page.emulateMedia({ media: 'print' });
      const pdf = await page.pdf({ format: 'Letter', printBackground: true, preferCSSPageSize: true });
      await page.emulateMedia({ media: 'screen' });
      expect(pdf.length).toBeGreaterThan(1000);
      // Stored exactly as main stored it.
      expect(await stored(page)).toBe(raw);
    }
    expect(errors).toEqual([]);
  });
}
