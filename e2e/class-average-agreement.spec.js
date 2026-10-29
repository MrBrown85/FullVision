import { test, expect } from '@playwright/test';
import {
  mockAuth,
  seedCourse,
  seedStudents,
  seedAssessments,
  gotoApp,
  TEST_ASSESSMENT,
  TEST_COURSE,
} from './helpers.js';

// The gradebook's Class Average, the printed grade sheet's and the CSV
// export's are one number per column (calc.js classColumnAverage), with
// Not Submitted and Excused in the mix: Excused out everywhere, Not
// Submitted 0 on points and Complete/Incomplete work and out on
// proficiency work.
const PROF = { ...TEST_ASSESSMENT, id: 'a-prof', title: 'Lab Report', tagIds: ['QAP'] };
const PTS = { ...TEST_ASSESSMENT, id: 'a-pts', title: 'Quiz', tagIds: ['PI'], scoreMode: 'points', maxPoints: 10 };
const CMP = { ...TEST_ASSESSMENT, id: 'a-cmp', title: 'Homework', tagIds: ['IP'], scoreMode: 'complete', maxPoints: 1 };

test('the gradebook, the printed sheet and the CSV export show the same Class Averages', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, [PROF, PTS, CMP]);
  await gotoApp(page, '/gradebook');

  await page.evaluate(cid => {
    // Alice: 3+, 8/10, Complete. Bob: Not Submitted on all. Carol: Excused on
    // all, with scores entered before she was excused.
    upsertScore(cid, 'stu-001', 'a-prof', 'QAP', 3, '2026-03-20', 'summative', '', 1);
    setPointsScore(cid, 'stu-001', 'a-pts', 8);
    setCompletionMark(cid, 'stu-001', 'a-cmp', 'complete');
    upsertScore(cid, 'stu-003', 'a-prof', 'QAP', 1, '2026-03-20', 'summative', '');
    setPointsScore(cid, 'stu-003', 'a-pts', 2);
    setCompletionMark(cid, 'stu-003', 'a-cmp', 'incomplete');
    // Excused can't be set on scored work any more; older data has both,
    // so Carol's statuses are written straight in.
    var statuses = getAssignmentStatuses(cid);
    ['a-prof', 'a-pts', 'a-cmp'].forEach(aid => {
      setAssignmentStatus(cid, 'stu-002', aid, 'NS');
      statuses['stu-003:' + aid] = 'EXC';
    });
    saveAssignmentStatuses(cid, statuses);
    clearProfCache();
    PageGradebook.render();
  }, TEST_COURSE.id);

  // The first number in a cell: "3.3", "4/10" (4), "50%".
  const num = text => parseFloat((String(text).match(/[0-9.]+/) || ['NaN'])[0]);

  // Gradebook, Competencies view: the Class Average under each column.
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  const gradebook = await page.evaluate(() => {
    var out = {};
    var first = document.querySelector('#gb-data tbody tr');
    var stats = document.querySelector('#gb-data tr.gb-stats-row').children;
    Array.prototype.forEach.call(first.children, function (td, i) {
      out[td.dataset.aid] = stats[i].textContent;
    });
    return out;
  });

  // Printed sheet: its own Class Average function, on its own columns,
  // printing scores as marked (points as points), as the gradebook shows them.
  const printed = await page.evaluate(cid => {
    var opts = GradesPrint.normalizeOptions({ scoresAs: 'points' });
    var students = getStudents(cid);
    var out = {};
    GradesPrint.columnsFor(cid, opts).forEach(function (c) {
      out[c.id] = GradesPrint.columnAverageText(cid, students, c, opts);
    });
    return out;
  }, TEST_COURSE.id);

  // CSV export: the Class Average row under each assessment.
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('[data-action="exportScoresCSV"]').click(),
  ]);
  const csv = (await (await download.createReadStream()).toArray()).join('');
  const lines = csv
    .trim()
    .split('\n')
    .map(l => l.slice(1, -1).split('","'));
  const header = lines[0];
  const avgRow = lines[lines.length - 1];
  expect(avgRow[0]).toBe('Class Average');
  const exported = {};
  [PROF, PTS, CMP].forEach(a => {
    exported[a.id] = avgRow[header.findIndex(h => h.startsWith(a.title + ' ('))];
  });

  // Expected by hand. Proficiency: only Alice counts (3+). Points: Alice 8
  // and Bob 0 (Not Submitted), Carol out: 4/10. Complete: Alice 1, Bob 0: 50%.
  const threePlus = await page.evaluate(() => scoreModValue({ score: 3, mod: 1 }));
  expect(num(gradebook['a-prof'])).toBeCloseTo(Math.round(threePlus * 10) / 10, 5);
  expect(num(gradebook['a-pts'])).toBe(4);
  expect(num(gradebook['a-cmp'])).toBe(50);

  for (const id of ['a-prof', 'a-pts', 'a-cmp']) {
    expect(num(printed[id]), 'printed ' + id).toBe(num(gradebook[id]));
    expect(num(exported[id]), 'exported ' + id).toBe(num(gradebook[id]));
  }
});
