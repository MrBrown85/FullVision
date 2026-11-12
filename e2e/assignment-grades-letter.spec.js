import { test, expect } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* A Letter class's Assignment Grades is drawn exactly as main drew it
   (Assignment Grades layout, 2026-11-12): the same HTML, and every column
   the same width, on the built site. e2e/fixtures/assignment-grades-
   letter-main.json was written by this file on main (9953ecc3), before the
   change:
     UPDATE_LETTER_MAIN=1 TZ=UTC npx playwright test e2e/assignment-grades-letter.spec.js
   The widths do not depend on the font (each column is set in px or em
   at the sheet's fixed size), so the file holds on any machine; the test
   also runs with a wider font forced on the sheet. Students by name. */

// Run from the repository's root, as Playwright runs it.
const FILE = resolve('e2e/fixtures/assignment-grades-letter-main.json');
const UPDATE = process.env.UPDATE_LETTER_MAIN === '1';
const NAMES = ['Ethan Dubois', 'Cece Adeyemi', 'Mei Wong', 'Aiden Singh'];
const WIDE_FONT = `.report-sheet, .report-sheet * {
  font-family: Verdana, 'DejaVu Sans', sans-serif !important;
  letter-spacing: 0.03em !important;
}`;

for (const wide of [false, true]) {
  test(`a Letter class draws Assignment Grades as main did, HTML and column widths${wide ? ', in a wider font' : ''}`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
    if (wide) await page.addStyleTag({ content: WIDE_FONT });
    await page.evaluate(r => window.Router.navigate(r), '/reports');
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await expect(page.locator('#studio')).toBeVisible();
    const now = await page.evaluate(names => {
      const cid = 'sci8';
      const S = ReportSheets;
      const students = names.map(n => getStudents(cid).find(s => displayNameWithLast(s) === n));
      const host = document.createElement('div');
      host.className = 'rb-preview';
      host.style.cssText = 'position:absolute;left:0;top:0;width:1200px;';
      document.body.appendChild(host);
      const was = COURSES[cid].gradingSystem;
      COURSES[cid].gradingSystem = 'letter';
      const out = {};
      try {
        for (const word of [true, false, 'auto'])
          for (const columns of ['one', 'two'])
            for (const half of [false, true]) {
              const form = S.normalizeForm({
                v: 6,
                id: 'custom',
                name: 'Custom',
                type: 'standard',
                perStudent: {},
                sides: [
                  {
                    rows: [
                      { cells: [{ block: 'header', size: 'row' }] },
                      {
                        cells: [{ block: 'grade-table', size: 'row', options: { word, columns } }].concat(
                          half ? [{ block: 'proficiency', size: 'half' }] : [],
                        ),
                      },
                    ],
                  },
                ],
              });
              const preview = document.createElement('div');
              host.appendChild(preview);
              S.renderPreview({ preview, paper: 'letter', form, cid, students, ctx: ReportBlocks.reportContext() });
              students.forEach(st => {
                const el = preview.querySelector('.sheet-student[data-sid="' + st.id + '"]');
                const blocks = [...el.querySelectorAll('.sheet-body .report-grades')];
                // Each column's width, from each column's first row.
                const widths = [...el.querySelectorAll('.sheet-body .report-grades-col')].map(col => {
                  const row = col.querySelector('.report-grades-row');
                  return row ? [...row.children].map(c => Math.round(c.getBoundingClientRect().width * 100) / 100) : [];
                });
                out[[`word ${word}`, columns, half ? 'half' : 'row', displayNameWithLast(st)].join(' | ')] = {
                  html: blocks.map(b => b.outerHTML).join(''),
                  widths,
                };
              });
              preview.remove();
            }
      } finally {
        COURSES[cid].gradingSystem = was;
        host.remove();
      }
      return out;
    }, NAMES);
    if (UPDATE && !wide) writeFileSync(FILE, JSON.stringify(now, null, 2) + '\n');
    const main = JSON.parse(readFileSync(FILE, 'utf8'));
    expect(Object.keys(now).sort()).toEqual(Object.keys(main).sort());
    expect(Object.keys(now).length).toBe(3 * 2 * 2 * NAMES.length);
    for (const key of Object.keys(main)) {
      expect(now[key].html, key).toBe(main[key].html);
      expect(now[key].widths, key).toEqual(main[key].widths);
    }
    // The word column is there with Word on.
    expect(now['word true | one | row | Ethan Dubois'].html).toContain('report-grades-word');
    expect(errors).toEqual([]);
  });
}
