/**
 * Reports read grades through one entry, teacher/report-scores.js (student
 * page build plan, S2-T1), checked on the page itself.
 *
 * The Reports page redraws from timers (a resize, the class fit) and
 * from promises (a printed copy).
 * A grade read there outside ReportScores.withReportScores would count
 * drafts once reports are on returned grades (S2-F1), and nothing in a unit
 * test runs those timers. Two watches are set on the page. Every function
 * calc.js gives out that reads a grade notes each call a report file makes
 * to it while no report surface is running (calc.js keeps what it has
 * worked out, so the asking is watched, not only the read). And the data
 * layer's readers of scores, statuses and ticks note each read a report
 * file makes then. Demo Mode's Science 8.
 *
 * Not counted: the roster in the sidebar, which shows the teacher their own
 * grades (teacher/ui.js renderSidebar, all work by plan 1.3), and whatever
 * no report file asks for.
 */
import { test, expect } from '@playwright/test';

const STUDENTS = 27;

/* Wraps the data layer's readers and ReportScores.withReportScores, once,
   after the app has loaded. */
async function watch(page) {
  // Demo Mode's class is on the page.
  await page.waitForFunction(
    () =>
      typeof ReportScores !== 'undefined' &&
      typeof getStudents === 'function' &&
      getStudents('sci8').length > 0 &&
      Object.keys(getScores('sci8')).length > 0,
  );
  await page.evaluate(() => {
    const REPORT_FILE =
      /\/(page-reports|report-[a-z-]+|comment-[a-z-]+|grade-report|grades-print|rubric-print|export-all)\.js:\d+/g;
    window.__seam = { outside: [], inside: 0, later: [], runs: 0 };
    const note = text => {
      if (window.__seam.outside.indexOf(text) < 0) window.__seam.outside.push(text);
    };
    // calc.js functions that read no score: a setting, the report's term, or a level they are given, formatted.
    const NO_SCORE = [
      'withReturnedOnly',
      'clearProfCache',
      'courseGradeMode',
      'formatLevel',
      'levelWord',
      'getActiveTerm',
      'setActiveTerm',
      // A level, %, or points figure it is given, as calc.js prints and reads it.
      'printedLevel',
      'roundLevel',
      'wholePercent',
      'oneDecimal',
      'nearestScoreLevelName',
      // A level it is given, as a student reads it (calc.js; DECISIONS, "Student-facing levels are proficiencies").
      'studentLevelText',
      'studentMarkText',
      'studentLevelChange',
      'studentGroupGradeText',
      'studentLevelBarPercent',
      'studentLevelStep',
    ];
    Object.keys(Calc)
      .filter(name => typeof window[name] === 'function' && NO_SCORE.indexOf(name) < 0)
      .forEach(name => {
        const real = window[name];
        window[name] = function () {
          if (ReportScores.running() !== null) window.__seam.inside++;
          else {
            // The line that called calc.js: the frame above this one.
            const caller = ((new Error().stack || '').split('\n')[2] || '').match(REPORT_FILE);
            if (caller && caller[0].indexOf('report-scores.js') < 0) note(name + ' from ' + caller[0].slice(1));
          }
          return real.apply(this, arguments);
        };
      });
    ['getScores', 'getAssignmentStatuses', 'getRubricChecks'].forEach(name => {
      const real = window[name];
      window[name] = function () {
        if (ReportScores.running() !== null) window.__seam.inside++;
        else {
          const stack = new Error().stack || '';
          const frames = (stack.match(REPORT_FILE) || []).filter(f => f.indexOf('report-scores.js') < 0);
          // The sidebar's roster is the teacher's own view of the class.
          if (frames.length && stack.indexOf('renderSidebar') < 0) note(name + ' from ' + frames[0].slice(1));
        }
        return real.apply(this, arguments);
      };
    });
    const run = ReportScores.withReportScores;
    ReportScores.withReportScores = function (surface, fn) {
      const result = run.call(this, surface, fn);
      window.__seam.runs++;
      if (result && typeof result.then === 'function') window.__seam.later.push(surface);
      return result;
    };
  });
}

const seen = page => page.evaluate(() => window.__seam);

/* calc.js keeps what it has worked out, and a kept grade is given back
   without a read. Emptied before each step, so the step's grades are read
   again and a read outside the seam cannot hide behind an earlier one. */
const forget = page => page.evaluate(() => clearProfCache());

test('every grade the Reports page draws, from a click, a timer or a promise, is read inside the report’s set of scores', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.addInitScript(() => {
    window.print = () => {};
  });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await watch(page);

  // The Term Questionnaire: the screen, Generate, another student, another report.
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await expect(page.locator('.qn')).toBeVisible();
  await forget(page);
  await page.locator('[data-action="tqGenerate"]').first().click();
  await expect(page.locator('#tq-narrative')).not.toHaveValue('');
  await forget(page);
  await page.locator('#gb-sidebar .student-row[data-sid]').nth(3).click();
  await expect(page.locator('.qn')).toBeVisible();
  await forget(page);
  await page.selectOption('#report-period', 'Report 1');
  await expect(page.locator('.qn')).toBeVisible();
  await forget(page);
  await page.locator('[data-action="tqGenerate"]').first().click();
  // Typing saves on a timer.
  await page.locator('#tq-narrative').press('End');
  await forget(page);
  await page.locator('#tq-narrative').pressSequentially(' More.');
  await page.waitForTimeout(900);
  expect((await seen(page)).inside).toBeGreaterThan(0);

  // Progress Reports: One Report on the class's Quick Report choices, with
  // its class-fit timer.
  await forget(page);
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  // The Feedback Pages, switched on in the panel.
  for (const key of ['fb-rubrics', 'fb-comments', 'fb-observations']) {
    await forget(page);
    await page.locator(`#studio-palette [data-action="oneSwitch"][data-part="${key}"]`).click();
    await expect(page.locator(`#studio-palette [data-action="oneSwitch"][data-part="${key}"]`)).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator('#studio-fit')).not.toBeEmpty();
  }
  // A resize redraws the canvas from a timer.
  await forget(page);
  await page.setViewportSize({ width: 1180, height: 820 });
  await page.waitForTimeout(400);
  await forget(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(400);

  // A Setup: the Report Card, then Choose Assessments (each row's result)
  // and a part switched off for one student.
  await forget(page);
  await page.locator('#studio-palette [data-action="oneSetupMenu"]').click();
  await forget(page);
  await page.locator('#studio-palette [data-action="oneSetup"][data-value="report-card"]').click();
  await expect(page.locator('.sheet-cell[data-part="parent-response"]')).toHaveCount(1);
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  await forget(page);
  await page.locator('#studio-palette [data-action="oneOpen"][data-part="assessments"]').click();
  await page.locator('#studio-palette [data-action="oneChoose"]').click();
  const choose = page.getByRole('dialog', { name: 'Choose Assessments' });
  await expect(choose).toBeVisible();
  await forget(page);
  await choose.getByRole('switch').first().click();
  await page.keyboard.press('Escape');
  await expect(choose).toHaveCount(0);
  await forget(page);
  await page.locator('#studio-palette [data-action="oneScope"]').nth(1).click();
  await forget(page);
  await page.locator('#studio-palette [data-action="oneSwitch"][data-part="legend"]').click();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  await page.locator('#studio-palette [data-action="oneScope"]').first().click();

  // Everyone, then Print Reports: the copy is saved and printed from a promise.
  await forget(page);
  await page.locator('.studio-view [data-view="all"]').click();
  await expect(page.locator('.sheet-student')).toHaveCount(STUDENTS);
  await forget(page);
  await page.getByRole('button', { name: 'Print Reports' }).click();
  await page.locator('#issue-overlay [data-issue="go"]').click();
  await expect(page.locator('#issue-overlay')).toHaveCount(0);
  await page.waitForTimeout(600);

  const seam = await seen(page);
  expect(seam.outside).toEqual([]);
  // No function run in the seam left work for later: on returned grades that would be refused.
  expect(seam.later).toEqual([]);
  expect(seam.inside).toBeGreaterThan(1000);
  expect(seam.runs).toBeGreaterThan(1000);
  expect(errors).toEqual([]);
});

test('the watch sees a read a report file makes outside the seam', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await watch(page);
  // A rubric handout, asked for as Print Rubrics asks, is not a report surface.
  await page.evaluate(() => {
    const cid = 'sci8';
    const lab = getAssessments(cid).find(a => a.rubricId);
    const scored = getStudents(cid).find(s => getAssessmentOverallScore(cid, s.id, lab.id) > 0);
    RubricPrint.sheetData(cid, lab.id, scored.id);
  });
  const seam = await seen(page);
  // Both watches: the read, and the grade asked of calc.js.
  expect(seam.outside.join(' ')).toContain('getScores from rubric-print.js');
  expect(seam.outside.join(' ')).toContain('getAssessmentOverallScore from rubric-print.js');
});
