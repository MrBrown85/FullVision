import { test, expect } from '@playwright/test';
import { mockAuth, TEST_LEARNING_MAP } from './helpers.js';
import { cardMenuItem } from './card-menu.js';

/* The save guard keeps the mark it used to drop (S19-B3). saveScores
   (shared/data.js) refuses a save that drops most of a class's marks
   against the browser's saved copy. In two rare cases the saved copy and
   memory disagree, and the guard dropped the mark the teacher had just
   entered:

   Two tabs: tab A uses Set Everyone To on a column (30 marks, in the saved
   copy). Tab B, which saved something a moment ago and so has not reloaded
   the class, types one mark. The guard rightly refuses to overwrite A's 30
   marks; B's mark is now kept with them, and is the only mark B sends.

   Storage full during Delete Assessment: the saved copy keeps the deleted
   work's marks. The next mark used to be blocked; now those marks are not
   counted, and the mark saves.

   Signed in (helpers.js mockAuth): each page has its own fake server, read
   from the saved copy at its first call, so a reload reads back what the
   page saved. Tests only. */

test.use({ viewport: { width: 1440, height: 900 } });

const CID = 'c1a55e00-0000-4000-8000-00000000b3c4';
const SIDS = Array.from({ length: 30 }, (_, i) => 'e0000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
const BIG = 'a5500000-0000-4000-8000-0000000000c1';
const SMALL = 'a5500000-0000-4000-8000-0000000000c2';
const NEW = 'a5500000-0000-4000-8000-0000000000c3';
const LEVEL = 'a5500000-0000-4000-8000-0000000000c4';

function classData(withBig) {
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
  const assessments = [quiz(SMALL, 'Small Quiz'), quiz(NEW, 'New Quiz')];
  if (withBig) assessments.unshift(quiz(BIG, 'Big Test'));
  else assessments.push({ id: LEVEL, title: 'Level Check', type: 'summative', scoreMode: '', tagIds: ['QAP'] });
  const scores = {};
  SIDS.forEach((sid, i) => {
    scores[sid] = [];
    if (withBig)
      scores[sid].push({ id: 'big-' + i, assessmentId: BIG, tagId: null, score: 5 + (i % 5), type: 'summative' });
    if (i < 4) scores[sid].push({ id: 'small-' + i, assessmentId: SMALL, tagId: null, score: 6, type: 'summative' });
  });
  return { cid: CID, students, assessments, scores, learningMap: TEST_LEARNING_MAP };
}

async function seedClass(page, data, demo) {
  await page.addInitScript(
    ({ data, demo }) => {
      const { cid, students, assessments, scores, learningMap } = data;
      if (localStorage.getItem('e2e-guard-keeps-mark-seeded')) return;
      if (demo && !JSON.parse(localStorage.getItem('gb-assessments-sci8') || '[]').length) return;
      localStorage.setItem('e2e-guard-keeps-mark-seeded', '1');
      const courses = demo ? JSON.parse(localStorage.getItem('gb-courses') || '{}') : {};
      courses[cid] = { id: cid, name: 'Grade 9 Science', gradingSystem: 'proficiency', calcMethod: 'mostRecent' };
      localStorage.setItem('gb-courses', JSON.stringify(courses));
      if (!demo) localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
      localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(learningMap));
      localStorage.setItem('gb-students-' + cid, JSON.stringify(students));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify(assessments));
      localStorage.setItem('gb-scores-' + cid, JSON.stringify(scores));
    },
    { data, demo },
  );
}

function guardLines(page) {
  const lines = [];
  page.on('console', m => {
    if (m.text().includes('[GUARD]')) lines.push(m.text());
  });
  return lines;
}

async function waitForClass(page, count) {
  await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
  await page.waitForFunction(([cid, n]) => getAssessments(cid).length === n, [CID, count], { timeout: 10_000 });
}

const go = (page, path) => page.evaluate(p => window.Router.navigate(p), path);

async function openScores(page) {
  await go(page, '/gradebook?course=' + CID);
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

const marks = (page, aid) =>
  page.evaluate(
    ([cid, a]) => {
      const of = blob =>
        Object.values(blob || {})
          .flat()
          .filter(e => e && e.assessmentId === a && e.score != null)
          .map(e => e.score);
      return { cache: of(getScores(cid)), saved: of(JSON.parse(localStorage.getItem('gb-scores-' + cid))) };
    },
    [CID, aid],
  );

// The outbox is shared: either tab may be the one that sends a write.
const writesOn = (pages, aid) =>
  Promise.all(
    pages.map(p =>
      p.evaluate(
        a =>
          (window.__e2eRpcLog || [])
            .filter(c => c.params && c.params.p_assessment_id === a)
            .map(c => [c.name, c.params.p_enrollment_id, c.params.p_value]),
        aid,
      ),
    ),
  ).then(lists => lists.flat());

async function expectNoBlock(page, guard) {
  expect(guard).toEqual([]);
  await expect(page.locator('#sync-toast')).toHaveCount(0);
}

test('two tabs: a mark typed in a tab not yet reloaded after a fill in the other is kept, with the fill', async ({
  page,
  context,
}) => {
  test.slow();
  const guardA = guardLines(page);
  await mockAuth(page);
  await seedClass(page, classData(false), false);
  await page.goto('/dashboard');
  await waitForClass(page, 3);

  const b = await context.newPage();
  const guardB = guardLines(b);
  await mockAuth(b);
  await b.goto('/gradebook?course=' + CID);
  await waitForClass(b, 3);
  // Tab B saved a moment ago, so it waits before reloading the class: here
  // it waits for the whole test, so its copy stays the stale one.
  await b.evaluate(() => (_REFRESH_QUIET_MS = 10 * 60 * 1000));
  await openScores(b);
  await typeInCell(b, NEW, SIDS[5], '7');

  // Tab A: Set Everyone To Proficient on Level Check, 30 marks.
  await page.bringToFront();
  await go(page, '/assignments?course=' + CID);
  const card = page.locator('#ac-' + LEVEL);
  await expect(card).toBeVisible();
  await card.locator('.assess-title').click();
  await expect(card).toHaveClass(/\bopen\b/);
  await (await cardMenuItem(card, 'confirmFillAll', '[data-score="3"]')).click();
  const ok = page.locator('.confirm-overlay #confirm-ok-btn');
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await expect.poll(async () => (await marks(page, LEVEL)).saved.length).toBe(30);
  await expectNoBlock(page, guardA);

  // Tab B, still without the fill, types a second mark.
  await b.bringToFront();
  expect((await marks(b, LEVEL)).cache).toEqual([]);
  await typeInCell(b, NEW, SIDS[6], '8');
  await expectNoBlock(b, guardB);
  expect((await marks(b, NEW)).saved.sort()).toEqual([7, 8]);
  expect((await marks(b, LEVEL)).saved).toHaveLength(30);
  expect((await marks(b, LEVEL)).cache).toHaveLength(30);
  // Only the two marks B typed go up; the fill is not sent again.
  await expect
    .poll(() => writesOn([page, b], NEW))
    .toEqual([
      ['upsert_score', SIDS[5], 7],
      ['upsert_score', SIDS[6], 8],
    ]);

  await b.reload();
  await waitForClass(b, 3);
  await b.locator('[data-action="setView"][data-mode="scores"]').click();
  await expect(cell(b, NEW, SIDS[6]).locator('.gb-scores-val')).toHaveText('8');
  await expect(cell(b, NEW, SIDS[5]).locator('.gb-scores-val')).toHaveText('7');
  expect((await marks(b, NEW)).saved.sort()).toEqual([7, 8]);
  await expectNoBlock(b, guardB);
});

for (const mode of ['Demo Mode', 'signed in'])
  test(`${mode}: storage full during Delete Assessment, then a new mark saves and outlasts a reload`, async ({
    page,
  }) => {
    const guard = guardLines(page);
    // The saved copy's next write fails once, as when storage is full.
    await page.addInitScript(cid => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (window.__failScoresOnce && k === 'gb-scores-' + cid) {
          window.__failScoresOnce = false;
          throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        }
        return set.call(this, k, v);
      };
    }, CID);
    if (mode === 'signed in') {
      await mockAuth(page);
      await seedClass(page, classData(true), false);
      await page.goto('/dashboard');
    } else {
      await seedClass(page, classData(true), true);
      await page.goto('/login.html');
      await page.locator('#demo-mode-btn').click();
      await page.waitForURL(/\/dashboard/);
      await page.waitForFunction(() => getAssessments('sci8').length > 0);
      await page.reload();
    }
    await waitForClass(page, 3);

    await go(page, '/assignments?course=' + CID);
    const card = page.locator('#ac-' + BIG);
    await expect(card).toBeVisible();
    await card.locator('.assess-title').click();
    await expect(card).toHaveClass(/\bopen\b/);
    await page.evaluate(() => (window.__failScoresOnce = true));
    await (await cardMenuItem(card, 'deleteAssess')).click();
    await page.locator('.confirm-overlay #confirm-ok-btn').click();
    await expect(card).toHaveCount(0);
    expect(await page.evaluate(() => window.__failScoresOnce)).toBe(false);

    await openScores(page);
    await typeInCell(page, NEW, SIDS[5], '7');
    await expect(cell(page, NEW, SIDS[5]).locator('.gb-scores-val')).toHaveText('7');
    expect(await marks(page, NEW)).toEqual({ cache: [7], saved: [7] });
    expect((await marks(page, BIG)).saved).toEqual([]);
    await expectNoBlock(page, guard);

    await page.reload();
    await waitForClass(page, 2);
    await page.locator('[data-action="setView"][data-mode="scores"]').click();
    await expect(cell(page, NEW, SIDS[5]).locator('.gb-scores-val')).toHaveText('7');
    expect(await marks(page, NEW)).toEqual({ cache: [7], saved: [7] });
    expect(await marks(page, SMALL)).toEqual({ cache: [6, 6, 6, 6], saved: [6, 6, 6, 6] });
    await expectNoBlock(page, guard);
  });
