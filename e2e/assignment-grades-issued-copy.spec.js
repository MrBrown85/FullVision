import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* A report issued before the Assignment Grades layout change (2026-11-12)
   reprints as it went home. e2e/fixtures/report-issue-main.json holds the
   sheets main (9953ecc3) kept for Ethan Dubois and Cece Adeyemi in a Both
   and a Proficiency class (Letterhead and Assignment Grades in two columns,
   Proficiency Word on by default, so each row has its word cell), and each
   column's width when main drew them. Here the copy is issued again from
   that HTML, opened from the Copy menu, and drawn: the page shows exactly
   the HTML main kept, and every column is the width main drew it. Also
   with a wider font forced on the sheet. */

const MAIN = JSON.parse(readFileSync(resolve('e2e/fixtures/report-issue-main.json'), 'utf8'));
const WIDE_FONT = `.report-sheet, .report-sheet * {
  font-family: Verdana, 'DejaVu Sans', sans-serif !important;
  letter-spacing: 0.03em !important;
}`;

for (const wide of [false, true]) {
  for (const mode of ['both', 'proficiency']) {
    test(`a ${mode} class's copy issued on main reprints as issued${wide ? ', in a wider font' : ''}`, async ({
      page,
    }) => {
      test.setTimeout(60_000);
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto('/login.html?demo=1');
      await page.waitForURL(/\/dashboard/, { timeout: 15000 });
      await page.waitForFunction(() => getStudents('sci8').length > 0);
      if (wide) await page.addStyleTag({ content: WIDE_FONT });
      // The Reports page loads the report code and styles.
      await page.evaluate(r => window.Router.navigate(r), '/reports');
      await page.getByRole('tab', { name: 'Print Reports' }).click();
      await expect(page.locator('#studio')).toBeVisible();
      const copies = MAIN.copies[mode];
      expect(copies.map(c => c.name)).toEqual(['Ethan Dubois', 'Cece Adeyemi']);
      // Each column as main drew it, the same HTML drawn here.
      const widths = await page.evaluate(
        list =>
          list.map(c => {
            const p = document.createElement('div');
            p.className = 'rb-preview report-sheets-on';
            p.innerHTML = c.html;
            document.body.appendChild(p);
            const w = [...p.querySelectorAll('.report-grades-row')].map(r =>
              [...r.children].map(x => Math.round(x.getBoundingClientRect().width * 100) / 100),
            );
            p.remove();
            return w;
          }),
        copies,
      );
      copies.forEach((c, i) => expect(widths[i]).toEqual(c.widths));
      expect(copies[0].html).toContain('report-grades-word');

      // Issued, then opened from the Copy menu: the page shows main's HTML.
      await page.evaluate(
        ([m, form, list]) => {
          COURSES.sci8.gradingSystem = m;
          const ctx = ReportBlocks.reportContext();
          return ReportIssues.issue({
            cid: 'sci8',
            termId: ctx.termId,
            termLabel: ctx.termLabel,
            paper: 'letter',
            form,
            students: list.map(c => ({ sid: c.sid, name: c.name, sheets: c.sheets, html: c.html })),
          });
        },
        [mode, MAIN.form, copies],
      );
      await page.evaluate(() => window.Router.navigate('/dashboard'));
      await page.evaluate(r => window.Router.navigate(r), '/reports');
      await page.getByRole('tab', { name: 'Print Reports' }).click();
      const copy = page.locator('#report-copy');
      await expect(copy).toBeVisible();
      const id = await copy.locator('option').nth(1).getAttribute('value');
      await copy.selectOption(id);
      await expect(page.locator('#tb-print-btn')).toHaveText('Print This Copy');
      const shown = await page.locator('#rb-preview').evaluate(p => p.innerHTML);
      expect(copies.map(c => c.html)).toContain(shown);
      expect(errors).toEqual([]);
    });
  }
}
