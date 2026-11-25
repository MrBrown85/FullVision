import { test, expect } from '@playwright/test';

/* The lines a student or parent writes on print (Colin, 2026-11-25: "the
   lines that students are supposed to write on don't actually print").
   They were a background pattern (repeating-linear-gradient), and
   Chrome's print engine dropped most of its one-pixel stripes. Each line
   is now an element with a bottom border (report-blocks.js _openHtml,
   report-sheets.js RULED_LINES), and a copy issued before gets its lines
   put in when it is shown again (ReportSheets.ruleOldCopy). Demo Mode's
   Science 8, every student, in Everyone view. */

test.setTimeout(120_000);

async function open(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.setViewportSize({ width: 1500, height: 1000 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await page.evaluate(() => {
    const one = ReportOne.normalize({
      parts: [
        'header',
        'teacher-narrative',
        'student-reflection-learning',
        'student-reflection-habits',
        'text-block',
        'parent-response',
      ],
      options: { 'text-block': { title: 'Notes', text: 'Write here.' } },
    });
    saveReportConfig('sci8', Object.assign({}, getReportConfig('sci8'), { one }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await page.getByRole('radio', { name: 'Everyone' }).click();
  await expect(page.locator('#rb-preview .sheet-student')).toHaveCount(
    await page.evaluate(() => getStudents('sci8').length),
  );
  return errors;
}

test('the writing lines are borders, so they print', async ({ page }) => {
  const errors = await open(page);
  await page.emulateMedia({ media: 'print' });
  const got = await page.evaluate(() => {
    const sheets = Array.from(document.querySelectorAll('#rb-preview .report-sheet'));
    // Anything on the paper drawn as a striped background.
    const lost = [];
    sheets.forEach(sheet =>
      sheet.querySelectorAll('*').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display !== 'none' && cs.backgroundImage.indexOf('repeating') >= 0) lost.push(el.className);
      }),
    );
    // Each question's lines: one bordered line every 26px of its room.
    const write = Array.from(document.querySelectorAll('#rb-preview .report-write-lines')).map(box => {
      const lines = Array.from(box.querySelectorAll(':scope > .report-line'));
      return {
        room: Math.round(box.offsetHeight / 26),
        lines: lines.length,
        ruled: lines.every(l => getComputedStyle(l).borderBottomWidth === '1px'),
      };
    });
    // A ruled box (an empty Teacher Comment, Your Own Text): its lines fill it and take no room.
    const ruled = Array.from(document.querySelectorAll('#rb-preview .report-ruled')).map(box => {
      const shown = Array.from(box.querySelectorAll('.report-line')).filter(
        l => l.offsetTop + l.offsetHeight <= box.clientHeight,
      );
      return { room: Math.floor(box.clientHeight / 22), shown: shown.length };
    });
    return { lost, write, ruled };
  });
  expect(got.lost).toEqual([]);
  expect(got.write.length).toBeGreaterThan(0);
  got.write.forEach(w => {
    expect(w.lines).toBe(w.room);
    expect(w.ruled).toBe(true);
  });
  got.ruled.forEach(r => expect(r.shown).toBe(r.room));
  expect(errors).toEqual([]);
});

test('a copy issued before gets its lines when it is shown again', async ({ page }) => {
  await open(page);
  // A saved copy's HTML had empty boxes: the lines were the box's background.
  const got = await page.evaluate(() => {
    const host = document.querySelector('#rb-preview .report-sheet .sheet-body');
    const box = document.createElement('div');
    box.innerHTML =
      '<div class="report-write-lines" style="height:78px"></div>' +
      '<div class="report-ruled report-ruled-fill report-ruled-empty" style="height:66px"></div>';
    host.appendChild(box);
    ReportSheets.ruleOldCopy(box);
    ReportSheets.ruleOldCopy(box); // twice is once
    const [write, ruled] = box.children;
    const shown = Array.from(ruled.querySelectorAll('.report-line')).filter(
      l => l.offsetTop + l.offsetHeight <= ruled.clientHeight,
    ).length;
    return {
      write: write.querySelectorAll(':scope > .report-line').length,
      writeH: write.offsetHeight,
      layers: ruled.querySelectorAll('.report-ruled-lines').length,
      shown,
      ruledH: ruled.offsetHeight,
    };
  });
  expect(got).toEqual({ write: 3, writeH: 78, layers: 1, shown: 3, ruledH: 66 });
});
