import { test, expect } from '@playwright/test';

/* The Quick Report's columns in a Proficiency class (DECISIONS, "The Quick
   Report's columns", 2026-11-12). Colin: "now that students only see the
   proficincey, the columns don't make a lot of sense." Demo Mode's Science
   8 is a Proficiency class. Ethan Dubois has a Missing piece and work with
   no mark yet; one of his levels is marked Late and one piece with no mark
   Excused here, so his sheet has a row of every kind. His sheet is picked by
   name: in One Student view the canvas otherwise moves to whichever report
   the class fit finds longest, and that depends on the machine's fonts. */

const NAME = 'Ethan Dubois';
const LEVEL = /^(Emerging|Developing|Proficient|Extending)( [+−])?$/;

/* A font wider than any a teacher's machine prints in: Verdana (on a Mac
   and Windows; DejaVu Sans, its near twin, on Linux) with its letters
   spaced a little further apart. The sheet must fit its text in this as
   it does in the machine's own fonts: CI's Linux fonts cut off dates and
   results a Mac fitted (main, Nov 12). Put on before anything is measured,
   so the sheet is laid out in it. */
const WIDE_FONT = `.report-sheet, .report-sheet * {
  font-family: Verdana, 'DejaVu Sans', sans-serif !important;
  letter-spacing: 0.03em !important;
}`;

async function openDemo(page, wide) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  if (wide) await page.addStyleTag({ content: WIDE_FONT });
}

async function openQuickReportFor(page, wide) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openDemo(page, wide);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Quick Report' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  // GradeReport loads with the Reports page.
  const marked = await page.evaluate(name => {
    const cid = 'sci8';
    const st = getStudents(cid).find(s => s.firstName + ' ' + s.lastName === name);
    const rows = GradeReport.rows(cid, st, GradeReport.options({}));
    const level = rows.find(r => r.note === '' && r.score && !r.outOf && !/Complete/.test(r.score));
    // He has two pieces with no mark yet: one is excused, one stays blank.
    const none = rows.filter(r => r.note === '' && !r.score);
    Grader.setStatus(cid, st.id, level.id, 'LATE');
    Grader.setStatus(cid, st.id, none[0].id, 'EXC');
    return { mode: courseGradeMode(cid), late: level.title, excused: none[0].title, blank: none.length };
  }, NAME);
  expect(marked.mode).toBe('proficiency');
  expect(marked.blank).toBe(2);
  await page.getByRole('button', { name: 'Select students' }).click();
  const list = page.locator('#picker-dropdown');
  await list.getByRole('button', { name: 'Deselect All' }).click();
  await list.locator('.student-picker-item', { hasText: NAME }).click();
  await page.getByRole('button', { name: 'Select students' }).click();
  await expect(list).not.toHaveClass(/open/);
  const sheet = page.locator('.gr-sheet').first();
  await expect(sheet).toContainText(NAME);
  return { sheet, marked, errors };
}

/* Every row printed on the student's grade sheet, front and back, as
   { cell class: text }. */
async function printedRows(page) {
  return page.locator('.sheet-student .gr-sheet .gr-table .gr-row:not(.gr-head)').evaluateAll(rows =>
    rows.map(r => {
      const o = { missing: r.classList.contains('gr-missing') };
      r.querySelectorAll('.gr-c').forEach(c => {
        const k = [...c.classList].find(x => x !== 'gr-c' && x !== 'gr-r' && x !== 'gr-flag').slice(3);
        o[k] = c.textContent;
      });
      return o;
    }),
  );
}

for (const wide of [false, true]) {
  test(`a Proficiency class prints Date, Assignment, Category and Result, the summary and Overall Proficiency${
    wide ? ', in a wider font' : ''
  }`, async ({ page }) => {
    test.setTimeout(60_000);
    const { sheet, marked, errors } = await openQuickReportFor(page, wide);

    const head = await sheet.locator('.gr-table .gr-head').first().locator('.gr-c').allTextContents();
    expect(head).toEqual(['Date', 'Assignment', 'Category', 'Result', '']);
    await expect(page.locator('.gr-sheet .gr-head')).not.toContainText(['Score']);

    const rows = await printedRows(page);
    expect(rows.length).toBeGreaterThan(30);
    const by = title => rows.find(r => r.title === title);
    // A level, and a level marked Late.
    const level = rows.find(r => LEVEL.test(r.result) && r.note === '');
    expect(level).toBeTruthy();
    expect(by(marked.late)).toMatchObject({ note: 'Late' });
    expect(by(marked.late).result).toMatch(LEVEL);
    // Points as "8 / 10", never beside a figure out of 4.
    const points = rows.find(r => /^\d+(\.\d+)? \/ \d+(\.\d+)?$/.test(r.result));
    expect(points).toBeTruthy();
    expect(rows.filter(r => / \/ 4$/.test(r.result))).toEqual([]);
    // Complete or Incomplete, Missing, Excused.
    expect(rows.some(r => r.result === 'Complete' || r.result === 'Incomplete')).toBe(true);
    expect(rows.find(r => r.result === 'Missing')).toMatchObject({ missing: true, note: '' });
    expect(by(marked.excused)).toMatchObject({ result: 'Excused', note: '' });
    // No mark yet: the cell is blank. No dash anywhere in the table.
    expect(rows.filter(r => r.result === '').length).toBeGreaterThan(0);
    expect(rows.filter(r => /—|-$/.test(r.result))).toEqual([]);
    // Missing and Excused print in bold, as the note did.
    const bold = await page
      .locator('.gr-sheet .gr-result.gr-flag')
      .first()
      .evaluate(el => getComputedStyle(el).fontWeight);
    expect(Number(bold)).toBeGreaterThanOrEqual(700);

    // The summary: Category, Assessments, Proficiency; no Weight.
    const sum = await page.locator('.gr-summary .gr-head .gr-c').allTextContents();
    expect(sum).toEqual(['Category', 'Assessments', 'Proficiency']);
    await expect(page.locator('.gr-term > span').first()).toHaveText('Overall Proficiency');
    await expect(page.locator('.gr-term-grade')).toHaveText(LEVEL);
    await expect(page.locator('.gr-facts')).toHaveText('Missing Assignments: 1');

    // It still fits: one sheet, nothing cut off in a cell, nothing past the page.
    await expect(page.locator('.sheet-student .sheet-badge')).toHaveText('1 sheet');
    const cut = await page
      .locator('.gr-sheet .gr-row .gr-c')
      .evaluateAll(cells => cells.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => c.textContent));
    expect(cut).toEqual([]);
    const over = await page
      .locator('.sheet-student .report-sheet .sheet-body')
      .evaluateAll(bodies => bodies.filter(b => b.scrollHeight > b.clientHeight + 1).length);
    expect(over).toBe(0);
    expect(errors).toEqual([]);
  });
}

/* Nothing is cut off in a wider font, in any of the sheet's layouts: every
   Demo student's sheet in a Proficiency, Both and Letter class, on Letter
   and Legal paper, with and without Assignment Numbers, and with the
   class's work listed up to four times over, so the sheet drops to its
   small type and then to two columns of rows. A cell is cut off when its
   text is wider than the cell. The Assignment column is the one that gives
   way (its titles print on two lines, then end in "…"), so it is left out
   here: with Assignment Numbers in two columns of rows in a Letter class,
   this font leaves it narrower than its heading. */
test('in a wider font no cell is cut off, in every layout and grading style', async ({ page }) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openDemo(page, true);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  const found = await page.evaluate(() => {
    const cid = 'sci8';
    const own = window.getAssessments;
    const probe = document.createElement('div');
    probe.className = 'report-fitmap';
    probe.style.cssText = 'position:absolute;left:0;top:0;';
    document.body.appendChild(probe);
    const cut = [];
    const tiers = {};
    let pages = 0;
    try {
      for (const mode of ['proficiency', 'both', 'letter']) {
        COURSES[cid].gradingSystem = mode;
        for (const times of [1, 1.5, 1.75, 2, 2.25, 2.5, 3, 4]) {
          window.getAssessments = c => {
            const list = own(c);
            return c === cid
              ? [].concat(...Array(Math.ceil(times)).fill(list)).slice(0, Math.round(list.length * times))
              : list;
          };
          for (const paper of ['letter', 'legal']) {
            for (const numbers of [false, true]) {
              for (const st of getStudents(cid)) {
                const r = GradeReport.layoutStudent(cid, st, ReportBlocks.reportContext(), {
                  paper,
                  grade: { numbers },
                });
                tiers[mode + ' ' + r.tier] = true;
                probe.innerHTML = r.html;
                probe.querySelectorAll('.gr-sheet .gr-row .gr-c:not(.gr-title)').forEach(c => {
                  if (c.scrollWidth > c.clientWidth + 1)
                    cut.push([mode, r.tier, c.className, c.textContent].join(' | '));
                });
                probe.querySelectorAll('.report-sheet .sheet-body').forEach(b => {
                  if (b.scrollHeight > b.clientHeight + 1) pages++;
                });
              }
            }
          }
        }
      }
    } finally {
      window.getAssessments = own;
      probe.remove();
    }
    return { cut: [...new Set(cut)], tiers: Object.keys(tiers).sort(), over: pages };
  });
  expect(found.cut).toEqual([]);
  // Every grading style reached all three sizes of the table.
  for (const mode of ['proficiency', 'both', 'letter'])
    for (const tier of ['regular', 'small', 'two']) expect(found.tiers).toContain(mode + ' ' + tier);
  expect(found.over).toBe(0);
  expect(errors).toEqual([]);
});
