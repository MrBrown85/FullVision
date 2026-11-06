// Download All My Data in Demo Mode: the account menu's button downloads one
// Excel workbook; its sheets are the ones teacher/export-all.js lists, the
// Science 8 gradebook sheet reads as the Scores view does, and the Summary
// names every student. The file is read back in the page with the vendored
// ExcelJS build the button loaded, so the test needs no package of its own.
import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

async function openDemo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => typeof getAssessments === 'function' && getAssessments('sci8').length > 0);
}

/* The workbook as plain data: { name: { rows: [[…]], views, autoFilter } }. */
async function readWorkbook(page, path) {
  const bytes = Array.from(readFileSync(path));
  return page.evaluate(async bytes => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(new Uint8Array(bytes).buffer);
    // The day as it was written (local midnight), whatever the clock's zone.
    const day = d => [d.getFullYear(), d.getMonth() + 1, d.getDate()].map(n => String(n).padStart(2, '0')).join('-');
    const out = {};
    wb.worksheets.forEach(ws => {
      const rows = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => {
        const cells = [];
        for (let c = 1; c <= ws.columnCount; c++) {
          const v = row.getCell(c).value;
          cells.push(v instanceof Date ? day(v) : v == null ? '' : v);
        }
        rows[n - 1] = cells;
      });
      out[ws.name] = { rows, views: ws.views, autoFilter: ws.autoFilter };
    });
    return { names: wb.worksheets.map(ws => ws.name), sheets: out };
  }, bytes);
}

test('the account menu downloads one workbook with every sheet', async ({ page }) => {
  await openDemo(page);
  await page.locator('[data-action="toggleUserMenu"]').click();
  const button = page.locator('[data-action="exportAllData"]');
  await expect(button).toHaveText('Download All My Data');
  const [download] = await Promise.all([page.waitForEvent('download'), button.click()]);
  expect(download.suggestedFilename()).toMatch(/^FullVision – .+ – \d{4}-\d{2}-\d{2}\.xlsx$/);
  // The progress line goes when the file is ready.
  await expect(page.locator('#export-all-status')).toHaveCount(0);

  // The class as the app names it ("A · Science 8": the block, then the name).
  const cname = await page.evaluate(() => coursePickerName(COURSES.sci8));
  const wb = await readWorkbook(page, await download.path());
  expect(wb.names.slice(0, 3)).toEqual(['Contents', 'Summary', cname]);
  for (const name of ['Rubric Levels', 'Feedback', 'Observations']) expect(wb.names).toContain(name);

  // Contents lists every other sheet.
  const listed = wb.sheets.Contents.rows.map(r => r[0]);
  for (const name of wb.names.slice(1)) expect(listed).toContain(name);

  // Summary: one row per demo student, the course grade as the app shows it.
  const summary = wb.sheets.Summary.rows;
  expect(summary[0]).toEqual(['Class', 'Student', 'Course Grade', 'Missing', 'Late', 'Withdrawn']);
  const students = await page.evaluate(() =>
    sortStudents(getStudents('sci8'), 'lastName').map(s => [displayName(s), studentGradeSummary('sci8', s.id).text]),
  );
  expect(summary.length).toBeGreaterThanOrEqual(students.length + 1);
  students.forEach(([name, grade], i) => {
    expect(summary[i + 1][0]).toBe(cname);
    expect(summary[i + 1][1]).toBe(name);
    expect(summary[i + 1][2]).toBe(grade);
  });

  // The gradebook sheet: dates, categories and titles over the grid; a cell
  // reads as the Scores view shows it; Class Average closes the sheet.
  const grid = wb.sheets[cname];
  expect(grid.rows[0][0]).toBe('Date');
  expect(grid.rows[1][0]).toBe('Category');
  expect(grid.rows[2].slice(0, 2)).toEqual(['Student', 'Course Grade']);
  expect(grid.views[0]).toMatchObject({ state: 'frozen', xSplit: 1, ySplit: 3 });
  expect(grid.autoFilter).toBeTruthy();
  const first = await page.evaluate(() => {
    const a = getAssessments('sci8')
      .slice()
      .sort((x, y) => (x.date || '').localeCompare(y.date || ''))[0];
    const s = sortStudents(getStudents('sci8'), 'lastName')[0];
    return { title: a.title, date: a.date, text: ExportAll.cellText(assessmentCellValue('sci8', s.id, a), a) };
  });
  expect(grid.rows[0][2]).toBe(first.date);
  expect(grid.rows[2][2]).toBe(first.title);
  expect(grid.rows[3][2]).toBe(first.text);
  expect(grid.rows[grid.rows.length - 1][0]).toBe('Class Average');
});
