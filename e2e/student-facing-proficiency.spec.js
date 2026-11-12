import { test, expect } from '@playwright/test';
import { cardMenuItem } from './card-menu.js';

/* Students and families read proficiencies, not scores out of 4 (DECISIONS,
   "Student-facing levels are proficiencies", 2026-11-12). Demo Mode's
   Science 8 is a Proficiency class. Each surface a student or family reads
   is opened as the teacher opens it: the Quick Report's preview, a Progress
   Report on the Report Card template, a printed rubric, and the student's
   own page in Preview as Student. None shows "/ 4", "out of 4" or a level as
   a decimal; each names a proficiency. The student page and the reports say
   the same for the same student, a level the teacher set by hand included. */

const FIGURE = /\/ ?4\b|out of 4|(?<![\d.:])[0-4]\.\d(?![\d%])/;
const WORD = /Emerging|Developing|Proficient|Extending/;

/* A report with the Proficiency block, each competency on its own row. */
const ONE_BLOCK = {
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
          { cells: [{ block: 'proficiency', size: 'row', options: { rows: 'each', facts: false } }] },
        ],
      },
    ],
    perStudent: {},
  },
  preset: 'standard',
};

async function demo(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getSections('sci8').length > 0);
  // The class is graded by Proficiency; the first student has a competency set by hand, a level above
  // what the scores give, with the student page and My Learning on.
  const at = await page.evaluate(() => {
    const cid = 'sci8';
    const st = sortStudents(getStudents(cid), 'lastName')[0];
    const sec = getSections(cid)[0];
    setSectionOverride(cid, st.id, sec.id, 1, 'Seen in class');
    setStudentPageSwitch(cid, true);
    saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), { show_my_learning: true }));
    return { mode: courseGradeMode(cid), sid: st.id, name: displayNameWithLast(st), sec: sec.id };
  });
  expect(at.mode).toBe('proficiency');
  return { at, errors };
}

/* The Progress Report canvas showing this student alone, as the teacher
   picks one in Select Students. In One Student view the canvas otherwise
   moves to whichever report the class fit finds longest; with the same
   blocks for everyone that depends on how the machine's fonts wrap (on this
   Mac every report ties and the first stays; on CI's Linux fonts Hannah
   Berg's ran longer, and the test read her report instead). */
async function sheetOf(page, name) {
  await page.getByRole('button', { name: 'Select students' }).click();
  const list = page.locator('#picker-dropdown');
  await list.getByRole('button', { name: 'Deselect All' }).click();
  await list.locator('.student-picker-item', { hasText: name }).click();
  await page.getByRole('button', { name: 'Select students' }).click();
  await expect(list).not.toHaveClass(/open/);
  const sheet = page.locator('.report-sheet').first();
  await expect(sheet).toContainText(name);
  return sheet;
}

const noFigure = text => {
  const m = String(text).match(FIGURE);
  return m ? '…' + text.slice(Math.max(0, m.index - 40), m.index + 10) : null;
};

test('every surface a student or family reads names a proficiency and shows no score out of 4', async ({ page }) => {
  test.setTimeout(90_000);
  const { at, errors } = await demo(page);

  // The Quick Report: the grade sheet, its summary and Course Grade, then its Feedback Pages.
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  const sheet = page.locator('.report-sheet').first();
  await expect(sheet).toBeVisible();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  const quick = await sheet.innerText();
  expect(quick).toMatch(WORD);
  expect(noFigure(quick)).toBeNull();
  await expect(sheet.locator('.gr-term-grade')).toHaveText(WORD);
  await page.getByRole('switch', { name: 'Feedback Pages' }).click();
  await expect(page.locator('.report-sheet').nth(1)).toBeVisible();
  const pages = (await page.locator('.report-sheet').allInnerTexts()).join('\n');
  expect(noFigure(pages)).toBeNull();

  // A Progress Report: the Report Card template, front and back.
  await page.getByRole('radio', { name: 'Custom' }).click();
  await page.locator('[data-action="studioTab"][data-tab="templates"]').click();
  await page.locator('[data-action="studioTemplate"][data-starter="report-card"]').click();
  await expect(page.locator('.sheet-cell[data-block="proficiency"]').first()).toBeVisible();
  const card = (await page.locator('.report-sheet').allInnerTexts()).join('\n');
  expect(card).toContain('BC Proficiency Scale');
  expect(card).toMatch(WORD);
  expect(noFigure(card)).toBeNull();

  // A printed rubric, as Print Rubrics previews it and prints it.
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  const assess = page.locator('#ac-sci8a19');
  await assess.waitFor();
  if (!(await assess.evaluate(el => el.classList.contains('open')))) await assess.locator('.assess-title').click();
  await (await cardMenuItem(assess, 'printRubrics')).click();
  await expect(page.locator('#rp-title')).toHaveText('Print Rubrics');
  await expect(page.locator('#rp-preview .rubric-sheet').first()).toBeVisible();
  const sheets = await page.evaluate(sid => {
    const d = ReportScores.withReportScores('handout', () => RubricPrint.sheetData('sci8', 'sci8a19', sid));
    return {
      overall: d.overall.text,
      html: RubricPrint.renderSheet(d, { include: RubricPrint.DEFAULT_OPTIONS.include }),
    };
  }, at.sid);
  expect(sheets.overall).toMatch(WORD);
  // The preview is the printed sheet, drawn small.
  const preview = await page.locator('#rp-preview').innerText();
  expect(preview).toMatch(WORD);
  expect(noFigure(preview + ' ' + sheets.html.replace(/<[^>]+>/g, ' '))).toBeNull();
  await page.keyboard.press('Escape');

  // The student page, in Preview as Student: My Learning, the list of work back, and one piece's feedback.
  await page.goto('/dashboard?manage=student-page');
  await page.getByRole('button', { name: 'Open Preview' }).click();
  const dialog = page.getByRole('dialog', { name: 'Previewing as ' + at.name });
  await expect(dialog).toBeVisible();
  const screen = dialog.locator('.ps-screen');
  const seen = [];
  await screen.locator('.sp-tabs-bottom').getByRole('button', { name: 'My Learning' }).click();
  await expect(screen.locator('.sp-ml-at-word')).toHaveText(WORD);
  seen.push(await screen.innerText());
  seen.push(
    await screen.locator('[aria-label]').evaluateAll(els => els.map(e => e.getAttribute('aria-label')).join(' ')),
  );
  await screen.locator('.sp-tabs-bottom').getByRole('button', { name: 'Assignments' }).click();
  await screen.locator('[data-segment="back"]').click();
  // On a phone, Back is a deck of cards: the piece, Your Result and each row's level.
  await expect(screen.getByText('Your Result').first()).toBeVisible();
  const back = await screen.innerText();
  expect(back).toMatch(WORD);
  seen.push(back);
  await screen.getByRole('button', { name: 'See Your Feedback' }).first().click();
  await expect(screen.locator('.sp-fb-big')).toHaveText(WORD);
  seen.push(await screen.innerText());
  seen.forEach(text => expect(noFigure(text)).toBeNull());
  expect(errors).toEqual([]);
});

test('the student page and the reports say the same for the same student', async ({ page }) => {
  test.setTimeout(60_000);
  const { at, errors } = await demo(page);

  // The reports: the Quick Report's Course Grade, and a competency's Now on a Progress Report.
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('.report-sheet').first()).toBeVisible();
  const course = (await (await sheetOf(page, at.name)).locator('.gr-term-grade').innerText()).trim();
  expect(course).toMatch(WORD);
  await page.evaluate(layout => saveReportConfig('sci8', layout), ONE_BLOCK);
  await page.reload();
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('.sheet-cell[data-block="proficiency"]').first()).toBeVisible();
  const label = await page.evaluate(
    id => ReportBlocks.competencyLabel(getSections('sci8').find(s => s.id === id)),
    at.sec,
  );
  const row = (await sheetOf(page, at.name))
    .locator('tr', { has: page.locator('.report-ct-name', { hasText: label }) })
    .first();
  const now = (await row.locator('td').nth(2).innerText()).trim();
  // The level the teacher set by hand, Emerging, not the level the scores give.
  expect(now).toBe('Emerging');

  // The student page: You're at, and the same competency in Your Skills.
  await page.goto('/dashboard?manage=student-page');
  await page.getByRole('button', { name: 'Open Preview' }).click();
  const dialog = page.getByRole('dialog', { name: 'Previewing as ' + at.name });
  const screen = dialog.locator('.ps-screen');
  await screen.locator('.sp-tabs-bottom').getByRole('button', { name: 'My Learning' }).click();
  await expect(screen.locator('.sp-ml-at-word')).toHaveText(course);
  await expect(screen.locator('[data-skill="' + at.sec + '"] .sp-level').first()).toHaveText(now);
  expect(errors).toEqual([]);
});
