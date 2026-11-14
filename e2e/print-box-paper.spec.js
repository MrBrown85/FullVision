import { test, expect } from '@playwright/test';

/* The Print Reports box asks which paper (teacher/report-print-paper.js,
   page-reports.js _issuePaper). A teacher's class had been left on Legal
   and he printed on Letter: every page came out shrunken. The box now has
   the toolbar's Paper switch and says what the paper needs; a switch
   re-counts the sheets before Print can be pressed, and what prints is
   laid out for the paper the box shows. Demo Mode's Science 8, 27 students. */

/* Every switch lays the whole class out again, and a GitHub runner is
   several times slower than a teacher's machine. */
test.setTimeout(120_000);

const LETTER = 'Letter paper (8.5 × 11 in).';
const LEGAL = 'Load Legal paper (8.5 × 14 in). On Letter paper these pages print shrunken.';
const STUDENTS = 27;

async function openReports(page, paper) {
  await page.clock.setFixedTime(new Date('2026-11-12T12:00:00'));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  // The class's paper as this computer remembers it (page-reports.js _loadPaper).
  if (paper) await page.evaluate(p => localStorage.setItem('gb-report-paper-sci8', p), paper);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await expect(page.locator('#studio-fit')).not.toBeEmpty({ timeout: 30_000 });
  await recordPrints(page);
}

/* window.print, recorded: the @page size in force and every printed
   sheet's paper, at the instant print is called. */
async function recordPrints(page) {
  await page.evaluate(() => {
    window.__printed = [];
    window.print = () => {
      const style = document.getElementById('report-sheets-page');
      const size = style && /size:\s*([a-z]+) portrait/.exec(style.textContent);
      const sheets = [...document.querySelectorAll('#rb-preview .report-sheet')];
      window.__printed.push({
        size: size ? size[1] : null,
        papers: [...new Set(sheets.map(s => s.getAttribute('data-paper')))],
        students: new Set([...document.querySelectorAll('#rb-preview .sheet-student')].map(s => s.dataset.sid)).size,
      });
    };
  });
}

async function openBox(page) {
  await page.getByRole('button', { name: 'Print Reports' }).click();
  const box = page.locator('#issue-overlay');
  await expect(box).toBeVisible({ timeout: 30_000 });
  return box;
}

const boxPaper = box => box.locator('#issue-paper [aria-checked="true"]');
const toolbarPaper = page => page.locator('#report-paper [aria-checked="true"]');

/* Presses a paper in the box and reads it in the same moment: before the
   pages re-flow the box says Counting Sheets… and Print is off; a press
   of Print then does nothing. */
async function switchInBox(page, paper) {
  return page.evaluate(p => {
    document.querySelector('#issue-paper [data-paper="' + p + '"]').click();
    const go = document.querySelector('#issue-overlay [data-issue="go"]');
    const out = {
      sheets: document.getElementById('issue-sheets').textContent,
      disabled: go.disabled,
      say: document.getElementById('issue-paper-say').textContent,
    };
    go.click();
    return out;
  }, paper);
}

async function printFromBox(page, box) {
  const before = await page.evaluate(() => window.__printed.length);
  await box.locator('[data-issue="go"]').click();
  await expect(box).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__printed.length), { timeout: 30_000 }).toBe(before + 1);
  return page.evaluate(() => window.__printed[window.__printed.length - 1]);
}

test('a class left on Legal opens the box on Legal and says so, untouched', async ({ page }) => {
  await openReports(page, 'legal');
  await expect(toolbarPaper(page)).toHaveText('Legal');
  const box = await openBox(page);
  await expect(boxPaper(box)).toHaveText('Legal');
  await expect(box.locator('#issue-paper-say')).toHaveText(LEGAL);
  await expect(box).toContainText('2-sided, flip on long edge');
  // The paper is named once, by the switch and its sentence.
  await expect(box.locator('.issue-kv')).not.toContainText(/Legal ·|Legal, 2-sided/);
  await expect(box.locator('[data-issue="go"]')).toBeEnabled();
  const printed = await printFromBox(page, box);
  expect(printed).toEqual({ size: 'legal', papers: ['legal'], students: STUDENTS });
});

test('switching to Letter in the box counts again, the toolbar follows, and it prints on Letter', async ({ page }) => {
  await openReports(page, 'legal');
  let box = await openBox(page);
  const sheetsBefore = await box.locator('#issue-sheets').textContent();
  const at = await switchInBox(page, 'letter');
  expect(at).toEqual({ sheets: 'Counting Sheets…', disabled: true, say: LETTER });
  // Print pressed while counting did nothing.
  await expect(box).toBeVisible();
  expect(await page.evaluate(() => window.__printed.length)).toBe(0);
  await expect(box.locator('#issue-sheets')).not.toHaveText('Counting Sheets…', { timeout: 30_000 });
  await expect(box.locator('#issue-sheets')).toHaveText(/^27 students · /);
  await expect(box.locator('[data-issue="go"]')).toBeEnabled();
  await expect(box.locator('#issue-paper-say')).toHaveText(LETTER);
  await expect(boxPaper(box)).toHaveText('Letter');
  await expect(toolbarPaper(page)).toHaveText('Letter');
  expect(await page.evaluate(() => localStorage.getItem('gb-report-paper-sci8'))).toBeNull();
  // Focus stays in the box, on the paper just chosen.
  expect(await box.evaluate(b => b.contains(document.activeElement) && document.activeElement.textContent)).toBe(
    'Letter',
  );
  expect(sheetsBefore).toMatch(/^27 students · /);
  const printed = await printFromBox(page, box);
  expect(printed).toEqual({ size: 'letter', papers: ['letter'], students: STUDENTS });

  // The choice survives a reload.
  await page.reload();
  await page.waitForFunction(() => window.Router && getStudents('sci8').length > 0, null, { timeout: 15000 });
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio-fit')).not.toBeEmpty({ timeout: 30_000 });
  await expect(toolbarPaper(page)).toHaveText('Letter');
  box = await openBox(page);
  await expect(boxPaper(box)).toHaveText('Letter');
  await expect(box.locator('#issue-paper-say')).toHaveText(LETTER);
});

test('the switch works from the keyboard, and Legal prints on Legal', async ({ page }) => {
  await openReports(page, null);
  const box = await openBox(page);
  await expect(boxPaper(box)).toHaveText('Letter');
  await expect(box.locator('#issue-paper-say')).toHaveText(LETTER);
  await box.locator('#issue-paper [data-paper="letter"]').focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => document.activeElement.dataset.paper)).toBe('legal');
  await page.keyboard.press('Space');
  await expect(box.locator('#issue-paper-say')).toHaveText(LEGAL);
  await expect(box.locator('#issue-sheets')).toHaveText(/^27 students · /, { timeout: 30_000 });
  await expect(box.locator('[data-issue="go"]')).toBeEnabled();
  await expect(toolbarPaper(page)).toHaveText('Legal');
  expect(await page.evaluate(() => localStorage.getItem('gb-report-paper-sci8'))).toBe('legal');
  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('Tab');
    expect(await box.evaluate(b => b.contains(document.activeElement))).toBe(true);
  }
  const printed = await printFromBox(page, box);
  expect(printed).toEqual({ size: 'legal', papers: ['legal'], students: STUDENTS });

  // The saved copy is Legal: shown with its paper's sentence where Print This Copy is pressed.
  await page.locator('#report-copy').selectOption({ index: 1 });
  await expect(page.getByRole('button', { name: 'Print This Copy' })).toBeVisible();
  await expect(page.locator('#studio-fit')).toHaveText(LEGAL);
  await page.locator('#report-copy').selectOption({ index: 0 });
  await expect(page.locator('#studio-fit')).not.toHaveText(LEGAL, { timeout: 30_000 });
});
