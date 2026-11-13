import { test, expect } from '@playwright/test';
import { mockAuth, TEST_LEARNING_MAP } from './helpers.js';

/* Two tabs on one class, the second opened while a write waits in the
   outbox (one-mark-save design, Part A, step 4; fault 4).

   Tab A enters a points mark while the server cannot be reached, so it
   waits in the outbox the tabs share. Tab B opens the class then: its class
   check waits for the outbox, so it shows the class from the saved copy
   and has no baseline. Tab A enters four more marks. Tab B enters one
   points mark. On main, B's save compared its memory with the saved copy,
   took A's four newer marks for marks B had removed, and sent a clear for
   each, which replaced A's waiting marks. Now B compares with its own copy
   and sends only its own mark.

   Signed in (helpers.js mockAuth). The fake server keeps no writes, so the
   server here is every write the fake answered with success, from both
   tabs, in order. Writes fail (as a 504) until the connection returns.
   Tests only. */

test.use({ viewport: { width: 1440, height: 900 } });

const CID = 'c1a55e00-0000-4000-8000-00000000d4e5';
const SIDS = Array.from({ length: 30 }, (_, i) => 'e0000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
const OLD = 'a5500000-0000-4000-8000-0000000000d1';
const QUIZ = 'a5500000-0000-4000-8000-0000000000d2';

function classData() {
  const students = SIDS.map((id, i) => {
    const last = 'Student' + String(i + 1).padStart(2, '0');
    return {
      id,
      personId: id.replace(/^e/, 'f'),
      firstName: 'Pat',
      lastName: last,
      preferred: '',
      pronouns: '',
      studentNumber: '',
      email: '',
      dateOfBirth: '',
      designations: [],
      attendance: [],
      sortName: last + ' Pat',
    };
  });
  const quiz = (id, title) => ({ id, title, type: 'summative', scoreMode: 'points', maxPoints: 10, tagIds: [] });
  const assessments = [quiz(OLD, 'Old Test'), quiz(QUIZ, 'Quiz')];
  const scores = {};
  SIDS.forEach((sid, i) => {
    scores[sid] = [{ id: 'old-' + i, assessmentId: OLD, tagId: null, score: 5 + (i % 5), type: 'summative' }];
  });
  return { cid: CID, students, assessments, scores, learningMap: TEST_LEARNING_MAP };
}

async function seedClass(page, data) {
  await page.addInitScript(data => {
    const { cid, students, assessments, scores, learningMap } = data;
    if (localStorage.getItem('e2e-two-tabs-behind-seeded')) return;
    localStorage.setItem('e2e-two-tabs-behind-seeded', '1');
    localStorage.setItem(
      'gb-courses',
      JSON.stringify({
        [cid]: { id: cid, name: 'Grade 9 Science', gradingSystem: 'proficiency', calcMethod: 'mostRecent' },
      }),
    );
    localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
    localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(learningMap));
    localStorage.setItem('gb-students-' + cid, JSON.stringify(students));
    localStorage.setItem('gb-assessments-' + cid, JSON.stringify(assessments));
    localStorage.setItem('gb-scores-' + cid, JSON.stringify(scores));
  }, data);
}

async function waitForClass(page) {
  await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
  await page.waitForFunction(cid => getAssessments(cid).length === 2, CID, { timeout: 10_000 });
}

async function openScores(page) {
  await page.evaluate(p => window.Router.navigate(p), '/gradebook?course=' + CID);
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await expect(page.locator('#gb-data td.gb-scores-cell').first()).toBeVisible();
}

const cell = (page, aid, sid) => page.locator(`.gb-scores-cell[data-aid="${aid}"][data-sid="${sid}"]`);

async function typeInCell(page, aid, sid, digit) {
  await cell(page, aid, sid).focus();
  await expect(cell(page, aid, sid)).toHaveClass(/gb-focus/);
  await page.keyboard.press(digit);
  await expect(cell(page, aid, sid).locator('.gb-scores-input')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('.gb-scores-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('.gb-scores-input')).toHaveCount(0);
}

// Each Quiz cell's value on the server: the last write that succeeded, from
// either tab (the outbox is shared, so either may send it).
async function serverQuiz(pages) {
  const logs = await Promise.all(
    pages.map(p =>
      p.evaluate(() => (window.__e2eRpcLog || []).filter(c => c.at >= (window.__e2eOnlineAt || Infinity))),
    ),
  );
  const values = {};
  logs
    .flat()
    .filter(c => c.name === 'upsert_score' && c.params && c.params.p_assessment_id === QUIZ)
    .sort((x, y) => x.at - y.at)
    .forEach(c => (values[c.params.p_enrollment_id] = c.params.p_value));
  return values;
}

test('two tabs: a points mark in a tab opened while a write waited keeps the other tab’s marks on the server', async ({
  page,
  context,
}) => {
  test.slow();
  await mockAuth(page);
  await seedClass(page, classData());
  await page.goto('/dashboard');
  await waitForClass(page);
  await openScores(page);

  // The server cannot be reached: every write fails and waits in the outbox.
  await page.evaluate(() => (window.__e2eFailWrites = true));
  await typeInCell(page, QUIZ, SIDS[0], '6');
  await expect.poll(() => page.evaluate(() => window.v2Queue.stats().queued)).toBeGreaterThan(0);

  // Tab B opens the class while that write waits.
  const b = await context.newPage();
  await mockAuth(b);
  await b.addInitScript(() => (window.__e2eFailWrites = true));
  await b.goto('/gradebook?course=' + CID);
  await waitForClass(b);
  await openScores(b);
  expect(await b.evaluate(cid => _hasServerState('scores', cid), CID)).toBe(false);

  // Tab A enters four more marks.
  await page.bringToFront();
  for (const i of [1, 2, 3, 4]) await typeInCell(page, QUIZ, SIDS[i], '7');
  // Each has been tried once and is waiting to be tried again.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem('fv-sync-queue-v1') || '{"entries":[]}').entries.filter(
            e => e.endpoint === 'upsert_score' && e.attempts >= 1,
          ).length,
      ),
    )
    .toBe(5);

  // Tab B, without them in memory, enters one points mark.
  await b.bringToFront();
  await typeInCell(b, QUIZ, SIDS[20], '9');
  await expect(b.locator('#sync-toast')).toHaveCount(0);

  // The connection returns.
  for (const p of [page, b]) {
    await p.evaluate(() => {
      window.__e2eOnlineAt = Date.now();
      window.__e2eFailWrites = false;
    });
  }
  await page.evaluate(() => window.v2Queue.flush());
  await b.evaluate(() => window.v2Queue.flush());
  await expect.poll(() => page.evaluate(() => window.v2Queue.stats().queued), { timeout: 15_000 }).toBe(0);

  const server = await serverQuiz([page, b]);
  expect(server).toEqual({
    [SIDS[0]]: 6,
    [SIDS[1]]: 7,
    [SIDS[2]]: 7,
    [SIDS[3]]: 7,
    [SIDS[4]]: 7,
    [SIDS[20]]: 9,
  });
});
