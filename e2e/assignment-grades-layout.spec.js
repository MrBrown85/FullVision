import { test, expect } from '@playwright/test';

/* Assignment Grades on the Progress Report (DECISIONS, "Student-facing
   levels are proficiencies", Assignment Grades layout, 2026-11-12).

   1. A Proficiency or Both class prints no Proficiency Word column (a
      level's mark is its proficiency and points carry no word, so the
      column was empty) and the panel does not offer the option there. A
      Letter class keeps both.
   2. No mark is cut off or runs into the next column, in any grading
      style, in one column and in two: the mark column grows to the widest
      mark the class can print, measured in the sheet's fonts. At 90px a
      Both class's "Proficient − · 67%" ran over. One Report prints the
      part across the page (DECISIONS, "One Report"), so the half width
      Page Studio offered is not laid out here.

   Each layout check also runs in a wider font forced on the sheet. CI's
   Linux fonts are wider than a Mac's. */

const WIDE_FONT = `.report-sheet, .report-sheet * {
  font-family: Verdana, 'DejaVu Sans', sans-serif !important;
  letter-spacing: 0.03em !important;
}`;

/* Every Demo student, so every mark the class holds is laid out; Ethan
   Dubois, checked by name, has points, Missing and unmarked work. */
const NAME = 'Ethan Dubois';

async function openDemo(page, wide) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  if (wide) await page.addStyleTag({ content: WIDE_FONT });
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
}

for (const wide of [false, true]) {
  test(`Assignment Grades: no mark is cut off, and the word column is only in a Letter class${
    wide ? ', in a wider font' : ''
  }`, async ({ page }) => {
    test.setTimeout(120_000);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await openDemo(page, wide);
    const found = await page.evaluate(() => {
      const cid = 'sci8';
      const S = ReportSheets;
      const students = getStudents(cid);
      // The part on its own under the letterhead, as One Report lays it out.
      const model = columns =>
        ReportOne.normalize({
          parts: ['header', 'grade-table'],
          options: { 'grade-table': { word: true, columns } },
          feedback: {},
        });
      const host = document.createElement('div');
      host.className = 'rb-preview';
      host.style.cssText = 'position:absolute;left:0;top:0;width:1200px;';
      document.body.appendChild(host);
      const out = {
        wide: {},
        students: students.map(s => displayNameWithLast(s)),
        cut: [],
        words: {},
        past: 0,
        marks: {},
        layouts: 0,
      };
      const was = COURSES[cid].gradingSystem;
      try {
        for (const mode of ['proficiency', 'both', 'letter']) {
          COURSES[cid].gradingSystem = mode;
          out.words[mode] = 0;
          out.marks[mode] = [];
          out.wide[mode] = 0;
          for (const columns of ['one', 'two']) {
            const preview = document.createElement('div');
            host.appendChild(preview);
            S.renderPreview({
              preview,
              paper: 'letter',
              cid,
              students,
              ctx: ReportBlocks.reportContext(),
              layout: ReportOne.layoutWith(model(columns)),
            });
            out.layouts++;
            preview.querySelectorAll('.report-grades-row').forEach(row => {
              const figs = row.querySelector('.report-grades-figs');
              if (!figs.textContent) return;
              const next = figs.nextElementSibling;
              // Cut off: wider than its cell. Into its neighbour: past the
              // next cell's left edge, or past the row's right edge.
              const text = document.createRange();
              text.selectNodeContents(figs);
              const r = text.getBoundingClientRect();
              const right = next ? next.getBoundingClientRect().left : row.getBoundingClientRect().right;
              if (
                figs.scrollWidth > figs.clientWidth + 1 ||
                r.right > right + 0.5 ||
                r.left < figs.getBoundingClientRect().left - 0.5
              )
                out.cut.push([mode, columns, 'row', figs.textContent].join(' | '));
              // A wide mark sits on the title's last line: never over the
              // title's words (each line of the title, where it shares the
              // mark's height, ends left of the mark).
              // The title's words only (its spacer is not a word).
              const words = row.querySelector('.report-grades-title').firstChild;
              const title = document.createRange();
              if (words && words.nodeType === 3) title.selectNodeContents(words);
              [...(words && words.nodeType === 3 ? title.getClientRects() : [])].forEach(line => {
                if (line.width > 0 && line.bottom > r.top + 1 && line.top < r.bottom - 1 && line.right > r.left - 1)
                  out.cut.push([mode, columns, 'row', figs.textContent, 'over the title'].join(' | '));
              });
              if (row.classList.contains('report-grades-wide')) out.wide[mode]++;
              if (out.marks[mode].indexOf(figs.textContent) < 0) out.marks[mode].push(figs.textContent);
            });
            out.words[mode] += preview.querySelectorAll('.report-grades-word').length;
            preview.querySelectorAll('.report-sheet .sheet-body').forEach(b => {
              if (b.scrollHeight > b.clientHeight + 1) out.past++;
            });
            preview.remove();
          }
        }
      } finally {
        COURSES[cid].gradingSystem = was;
        host.remove();
        S.clearPageStyle && S.clearPageStyle();
      }
      out.cut = [...new Set(out.cut)];
      return out;
    });
    expect(found.students).toContain(NAME);
    expect(found.students.length).toBeGreaterThan(20);
    expect(found.layouts).toBe(6);
    expect(found.cut).toEqual([]);
    expect(found.past).toBe(0);
    // Both's wide marks reached past their column onto the title's line; a
    // Letter class's never do (it is as main drew it).
    expect(found.wide.both).toBeGreaterThan(0);
    expect(found.wide.letter).toBe(0);
    // The word column: none in a Proficiency or Both class, Word on; there in a Letter class.
    expect(found.words.proficiency).toBe(0);
    expect(found.words.both).toBe(0);
    expect(found.words.letter).toBeGreaterThan(0);
    // The wide marks were laid out: a Both class's level with its + or −
    // and its %, points with their %, and a Proficiency class's level.
    expect(found.marks.both.some(m => /^(Emerging|Developing|Proficient|Extending) [+−] · \d+%$/.test(m))).toBe(true);
    expect(found.marks.both.some(m => /^\d+(\.\d+)? \/ \d+(\.\d+)? · \d+%$/.test(m))).toBe(true);
    expect(found.marks.proficiency.some(m => /^(Emerging|Developing|Proficient|Extending) [+−]$/.test(m))).toBe(true);
    expect(found.marks.letter.some(m => /^\d\.\d \/ 4 · \d+%$/.test(m))).toBe(true);
    expect(errors).toEqual([]);
  });
}

/* The panel offers Proficiency Word for Assignment Grades in a Letter
   class only. The class's report is a form built in Page Studio, read as
   One Report's parts and never rewritten. */
test('the panel offers Proficiency Word for Assignment Grades only in a Letter class', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0);
  await page.evaluate(() =>
    saveReportConfig('sci8', {
      progressMode: 'build',
      form: {
        v: 6,
        id: 'custom',
        name: 'Custom',
        type: 'standard',
        sides: [
          {
            rows: [
              { cells: [{ block: 'header', size: 'row' }] },
              { cells: [{ block: 'grade-table', size: 'row', options: { word: true } }] },
            ],
          },
        ],
        perStudent: {},
      },
      preset: 'standard',
    }),
  );
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
    const open = page.locator('#studio-palette [data-action="oneOpen"][data-part="grade-table"]');
    if ((await open.getAttribute('aria-expanded')) !== 'true') await open.click();
    const bar = page.locator('#one-opts-grade-table');
    await expect(bar).toBeVisible();
    await expect(bar.getByRole('button', { name: 'Percent', exact: true })).toBeVisible();
    if (mode === 'letter') {
      await expect(bar.locator('[data-opt="word"]')).toHaveCount(1);
      await expect(bar.getByRole('button', { name: 'Proficiency Word' })).toBeVisible();
      await expect(page.locator('#rb-preview .report-grades-word').first()).toBeAttached();
    } else {
      await expect(bar.locator('[data-opt="word"]')).toHaveCount(0);
      await expect(bar).not.toContainText('Proficiency Word');
      await expect(page.locator('#rb-preview .report-grades-word')).toHaveCount(0);
    }
    // The saved form still has Word on: it was not rewritten.
    expect(await page.evaluate(() => JSON.stringify(getReportConfig('sci8')))).toContain('"word":true');
  }
});
