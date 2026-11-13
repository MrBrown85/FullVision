/**
 * Speed recorder: load time and click response on a class of 30 students by
 * 60 assessments, every cell scored, and (the "Work in" rows) on Demo Mode's
 * class with its student page on and about 620 pieces of student work in, as
 * History 12 was on Nov 13, 2026, when filed scans made every page that
 * shows work slow and no test had a class like it. It records numbers; it
 * never fails on them. A test fails only when a page does not draw at all.
 * What does fail on a class like that is tests/speed-guard.test.js, which
 * counts work instead of timing it.
 *
 * Run: npx playwright test --config=playwright.perf.config.js
 * Numbers: printed as a table, attached to the report, and written to
 * test-results/perf/<name>.json (and to $GITHUB_STEP_SUMMARY on CI).
 */
import { test, expect } from '@playwright/test';
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
      '## Speed (30 students x 60 assessments; "Work in": Demo Mode with 620 pieces of work)\n\n| ' +
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

/* Demo Mode's class in History 12's state: the student page and Send Work
   on, every piece taking photos, and about 620 pieces of work in with two
   pages each, spread over every piece. Demo Mode, because the signed-in fake holds no student work. */
async function seedWorkClass(page) {
  await watchInputs(page);
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 20000 });
  await page.waitForFunction(() => {
    const cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).some(a => a.id === 'sci8a1');
  });
  const at = await page.evaluate(() => {
    const cid = getActiveCourse();
    setStudentPageSwitch(cid, true, 'on_return');
    const work = getCourseSubmissions(cid);
    const pieces = getAssessments(cid);
    const students = getStudents(cid);
    work.course.send_work = true;
    work.assessments = pieces.map(a => ({ id: a.id, students_send: 'photos', after_due: 'stop' }));
    const subs = [];
    // Three students in five on every piece: about 620 pieces of work.
    pieces.forEach((a, p) =>
      students.forEach((s, i) => {
        if ((i * 3 + p) % 5 >= 3) return;
        const k = subs.length;
        const file = p => ({
          id: 'pf' + k + '-' + p,
          page: p,
          path: 'lab-p' + p + '.jpg',
          thumb_path: 'lab-p' + p + '-thumb.jpg',
          sha256: 'h' + k + p,
          width: 1546,
          height: 2000,
          rotation: 0,
          added_by: 'teacher',
        });
        subs.push({
          id: 'ps' + k,
          assessment_id: a.id,
          enrollment_id: s.id,
          version: 1,
          state: 'sent',
          sent_by: 'teacher',
          on_paper: false,
          is_late: false,
          note: null,
          sent_at: '2026-11-13T19:00:00Z',
          created_at: '2026-11-13T19:00:00Z',
          files: [file(1), file(2)],
        });
      }),
    );
    work.submissions = subs;
    saveDemoStudentWork(cid, work);
    return { students: students.length, pieces: pieces.length, work: subs.length };
  });
  const rate = Number(process.env.PERF_CPU) || 1;
  if (rate > 1) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
  }
  return at;
}
const elements = page => page.evaluate(() => document.getElementsByTagName('*').length);

test('Work in: Assignments', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const at = await seedWorkClass(page);
  await page.goto('/assignments');
  await page.locator('#ac-sci8a1 .assess-title').waitFor();
  const load = await loadNumbers(page);
  const count = await elements(page);
  const open = await clickNumbers(
    page,
    () => page.locator('#ac-sci8a1 .assess-title').click(),
    () => page.locator('#ac-sci8a1 .rsg-criterion-row').first().waitFor(),
  );
  await expect(page.locator('#ac-sci8a1 .rsg-see-work').first()).toBeVisible();
  const level = await clickNumbers(
    page,
    () => page.locator('#ac-sci8a1 .rsg-level[data-action="selectRubricScore"]').nth(5).click(),
    () => Promise.resolve(),
  );
  record(testInfo, 'Work in: Assignments', {
    ...load,
    elements: count,
    pieces: at.pieces,
    work: at.work,
    openMs: open.clickToDrawnMs,
    openLongestEventMs: open.longestEventMs,
    clickToDrawnMs: level.clickToDrawnMs,
    longestEventMs: level.longestEventMs,
  });
});

test('Work in: Gradebook and grader', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const at = await seedWorkClass(page);
  await page.goto('/gradebook');
  const cell = page.locator('.gb-scores-cell[data-aid="sci8a1"]').first();
  await cell.waitFor();
  const load = await loadNumbers(page);
  const count = await elements(page);
  const dialog = page.locator('#grader-overlay .grader-dialog');
  const open = await clickNumbers(
    page,
    () => cell.click(),
    () => dialog.waitFor(),
  );
  await expect(dialog).toHaveClass(/has-work/);
  const next = await clickNumbers(
    page,
    () => page.keyboard.press('ArrowRight'),
    () => Promise.resolve(),
  );
  const close = await clickNumbers(
    page,
    () => page.keyboard.press('Escape'),
    () => dialog.waitFor({ state: 'detached' }),
  );
  record(testInfo, 'Work in: Gradebook and grader', {
    ...load,
    elements: count,
    pieces: at.pieces,
    work: at.work,
    openMs: open.clickToDrawnMs,
    openLongestEventMs: open.longestEventMs,
    nextStudentMs: next.clickToDrawnMs,
    closeMs: close.clickToDrawnMs,
    closeLongestEventMs: close.longestEventMs,
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
  // Opening a task slides the grading screen in (0.35 s). openMs is the tap
  // to the screen being there; openSettledMs is the tap to the screen at rest.
  const swiper = page.locator('#m-screen-grade-swiper');
  const t0 = await page.evaluate(() => performance.now());
  const open = await clickNumbers(
    page,
    () => page.locator('#m-grade-list .m-cell[data-aid="assess-030"]').click(),
    () => swiper.waitFor(),
  );
  // Checked every frame, so the frame the slide ends on is the one counted.
  const settled = await (
    await page.waitForFunction(
      () => {
        const s = document.getElementById('m-screen-grade-swiper');
        return s && !/m-push-enter/.test(s.className) && performance.now();
      },
      null,
      { polling: 'raf' },
    )
  ).jsonValue();
  // The tap is timed on a screen at rest. Timed during the slide, Playwright
  // waits for the button to stop moving before it taps, so the slide was
  // counted as the tap (it read about 395 ms; S19-C10). A finger does not
  // wait: a tap during the slide scores at once.
  // Student1 has a 2 on Task 30 (SCORES), so tapping 3 changes the mark, and
  // the 3 itself must light up (any lit level was already there).
  const card = page.locator('.m-swiper-card[data-sid="stu-001"]');
  const level3 = card.locator('.m-score-btn[data-score="3"]');
  const level4 = card.locator('.m-score-btn[data-score="4"]');
  await expect(card.locator('.m-score-btn[data-score="2"]')).toHaveClass(/m-score-active/);
  // In the page, from the click reaching it: drawnMs, the first frame that
  // shows the 3 (its fill then fades in over 0.15 s, which blocks nothing);
  // readyMs, the first moment after that frame the page is free to take the
  // next tap.
  await page.evaluate(() => {
    const btn = document.querySelector('.m-swiper-card[data-sid="stu-001"] .m-score-btn[data-score="3"]');
    const tap = (window.__tap = {});
    document.addEventListener('click', e => (tap.at = e.timeStamp), { capture: true, once: true });
    const watch = () => {
      if (tap.at == null || !btn.classList.contains('m-score-active')) return requestAnimationFrame(watch);
      tap.drawn = performance.now() - tap.at;
      const ch = new MessageChannel();
      ch.port1.onmessage = () => (tap.ready = performance.now() - tap.at);
      ch.port2.postMessage(0);
    };
    requestAnimationFrame(watch);
  });
  const score = await clickNumbers(
    page,
    () => level3.click(),
    () => page.waitForFunction(() => window.__tap.ready != null, null, { polling: 'raf' }),
  );
  const inPage = await page.evaluate(() => window.__tap);
  // The next tap is taken: another level on the card can be tapped (seen,
  // still, enabled, nothing over it). trial: true checks without tapping.
  await level4.click({ trial: true });
  record(testInfo, 'Phone grade tab', {
    ...load,
    tabMs: tab.clickToDrawnMs,
    openMs: open.clickToDrawnMs,
    openSettledMs: Math.round(settled - t0),
    scoreTapMs: score.clickToDrawnMs,
    scoreTapDrawnMs: Math.round(inPage.drawn),
    scoreTapReadyMs: Math.round(inPage.ready),
    scoreTapLongestEventMs: score.longestEventMs,
  });
});
