/**
 * Speed recorder: load time and click response on a class of 30 students by
 * 60 assessments, every cell scored. It records numbers; it never fails on
 * them. A test fails only when a page does not draw at all.
 *
 * Run: npx playwright test --config=playwright.perf.config.js
 * Numbers: printed as a table, attached to the report, and written to
 * test-results/perf/<name>.json (and to $GITHUB_STEP_SUMMARY on CI).
 */
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { mockAuth, seedCourse, seedStudents, seedAssessments, seedScores, TEST_STUDENTS } from '../e2e/helpers.js';

const STUDENTS = Array.from({ length: 30 }, (_, i) => ({
  ...TEST_STUDENTS[0],
  id: 'stu-' + String(i + 1).padStart(3, '0'),
  firstName: 'Student' + (i + 1),
  preferred: 'Student' + (i + 1),
  lastName: 'L' + String(i + 1).padStart(2, '0'),
  sortName: 'L' + String(i + 1).padStart(2, '0') + ' Student' + (i + 1),
  studentNumber: String(2000 + i),
}));
const TAGS = ['QAP', 'PI', 'IP'];
const ASSESSMENTS = Array.from({ length: 60 }, (_, i) => {
  const day = new Date(Date.UTC(2026, 8, 3 + i)).toISOString().slice(0, 10);
  return {
    id: 'assess-' + String(i + 1).padStart(3, '0'),
    title: 'Task ' + (i + 1),
    date: day,
    type: i % 3 === 0 ? 'formative' : 'summative',
    tagIds: [TAGS[i % 3]],
    evidenceType: '',
    notes: '',
    coreCompetencyIds: [],
    rubricId: '',
    scoreMode: '',
    maxPoints: 0,
    weight: 1,
    dueDate: '',
    collaboration: 'individual',
    moduleId: '',
    pairs: [],
    groups: [],
    excludedStudents: [],
    created: day + 'T12:00:00.000Z',
  };
});
const SCORES = Object.fromEntries(
  STUDENTS.map((s, si) => [
    s.id,
    Object.fromEntries(
      ASSESSMENTS.map((a, ai) => [a.id, { [a.tagIds[0]]: { score: 1 + ((si + ai) % 4), date: a.date } }]),
    ),
  ]),
);

async function seedBigClass(page) {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page, STUDENTS);
  await seedAssessments(page, ASSESSMENTS);
  await seedScores(page, SCORES);
  // PERF_CPU=4 runs the page at a quarter speed, near a school Chromebook.
  const rate = Number(process.env.PERF_CPU) || 1;
  if (rate > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  }
}

// Event Timing (the data behind INP): the longest input-to-next-paint since
// the observer started. Installed before any page script runs.
async function watchInputs(page) {
  await page.addInitScript(() => {
    window.__perfEvents = [];
    window.__lcp = null;
    try {
      new PerformanceObserver(list => {
        const last = list.getEntries().pop();
        if (last) window.__lcp = last.startTime;
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver(list => {
        for (const e of list.getEntries()) window.__perfEvents.push({ name: e.name, duration: e.duration });
      }).observe({ type: 'event', durationThreshold: 16, buffered: true });
    } catch (_) {}
  });
}

async function loadNumbers(page) {
  return page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    return {
      domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
      loadMs: nav ? Math.round(nav.loadEventEnd) : null,
      readyMs: Math.round(performance.now()),
      lcpMs: window.__lcp == null ? null : Math.round(window.__lcp),
      scripts: performance.getEntriesByType('resource').filter(r => r.initiatorType === 'script').length,
      transferKB: Math.round(
        performance.getEntriesByType('resource').reduce((n, r) => n + (r.transferSize || 0), 0) / 1024,
      ),
    };
  });
}

// One click, timed from just before the click to the frame after `done`
// appears, plus the longest Event Timing entry the click produced.
async function clickNumbers(page, click, done) {
  await page.evaluate(() => (window.__perfEvents = []));
  const t0 = await page.evaluate(() => performance.now());
  await click();
  await done();
  const t1 = await page.evaluate(() => new Promise(r => requestAnimationFrame(() => r(performance.now()))));
  const longest = await page.evaluate(() => Math.max(0, ...window.__perfEvents.map(e => e.duration)));
  return { clickToDrawnMs: Math.round(t1 - t0), longestEventMs: Math.round(longest) };
}

const rows = [];
function record(testInfo, name, numbers) {
  const row = { name, ...numbers };
  rows.push(row);
  const dir = path.join('test-results', 'perf');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name.replace(/\W+/g, '-') + '.json'), JSON.stringify(row, null, 2));
  testInfo.attach(name, { body: JSON.stringify(row, null, 2), contentType: 'application/json' });
}

test.afterAll(() => {
  console.table(rows);
  if (process.env.GITHUB_STEP_SUMMARY && rows.length) {
    const keys = [...new Set(rows.flatMap(Object.keys))];
    const md =
      '## Speed (30 students x 60 assessments)\n\n| ' +
      keys.join(' | ') +
      ' |\n|' +
      keys.map(() => ' --- ').join('|') +
      '|\n' +
      rows.map(r => '| ' + keys.map(k => r[k] ?? '').join(' | ') + ' |').join('\n') +
      '\n';
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  }
});

test('Gradebook', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedBigClass(page);
  await watchInputs(page);
  await page.goto('/gradebook');
  await page.locator('.gb-scores-cell[data-sid="stu-030"][data-aid="assess-060"]').waitFor();
  const load = await loadNumbers(page);
  const cell = page.locator('.gb-scores-cell[data-sid="stu-015"][data-aid="assess-030"]');
  const click = await clickNumbers(
    page,
    () => cell.click({ button: 'right' }),
    () => page.locator('.gb-ctx-item[data-ctx="editCell"]').waitFor(),
  );
  record(testInfo, 'Gradebook', { ...load, ...click });
});

test('Assignments', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedBigClass(page);
  await watchInputs(page);
  await page.goto('/assignments');
  await page.locator('#gb-roster-list .student-row[data-sid="stu-030"]').waitFor();
  const load = await loadNumbers(page);
  const click = await clickNumbers(
    page,
    () => page.locator('#gb-roster-list .student-row[data-sid="stu-015"]').click(),
    () => page.locator('.focus-banner').waitFor(),
  );
  record(testInfo, 'Assignments', { ...load, ...click });
});

test('Class Management', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await seedBigClass(page);
  await watchInputs(page);
  await page.goto('/dashboard');
  await page.locator('[data-action="openClassManager"]').first().waitFor();
  const load = await loadNumbers(page);
  const open = await clickNumbers(
    page,
    () => page.locator('[data-action="openClassManager"]').first().click(),
    () => page.getByRole('tab', { name: /^Grading/ }).waitFor(),
  );
  const tab = await clickNumbers(
    page,
    () => page.getByRole('tab', { name: /^Grading/ }).click(),
    () => page.waitForURL(/manage=grading/),
  );
  record(testInfo, 'Class Management', {
    ...load,
    openMs: open.clickToDrawnMs,
    openLongestEventMs: open.longestEventMs,
    tabMs: tab.clickToDrawnMs,
    tabLongestEventMs: tab.longestEventMs,
  });
});

test('Phone grade tab', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await seedBigClass(page);
  await watchInputs(page);
  await page.goto('/teacher-mobile/');
  await page.locator('.m-tab-item[data-tab="grade"]').waitFor({ timeout: 15000 });
  const load = await loadNumbers(page);
  const tab = await clickNumbers(
    page,
    () => page.locator('.m-tab-item[data-tab="grade"]').click(),
    () => page.locator('#m-screen-grade-picker').waitFor(),
  );
  await page.locator('.m-seg-btn[data-val="all"]').click();
  const open = await clickNumbers(
    page,
    () => page.locator('#m-grade-list .m-cell[data-aid="assess-030"]').click(),
    () => page.locator('#m-screen-grade-swiper').waitFor(),
  );
  const score = await clickNumbers(
    page,
    () => page.locator('.m-swiper-card').first().locator('.m-score-btn').first().click(),
    () => page.locator('.m-swiper-card').first().locator('.m-score-btn.m-score-active').first().waitFor(),
  );
  record(testInfo, 'Phone grade tab', {
    ...load,
    tabMs: tab.clickToDrawnMs,
    openMs: open.clickToDrawnMs,
    scoreTapMs: score.clickToDrawnMs,
    scoreTapLongestEventMs: score.longestEventMs,
  });
});
