import { test, expect } from '@playwright/test';
import { mockAuth, TEST_LEARNING_MAP } from './helpers.js';
import { cardMenuItem } from './card-menu.js';

/* A tab that is behind catches up before it saves
   (docs/plans/stale-tab-plan.md). Two pages in one browser share the saved
   copy and the outbox. Tab B saved a moment ago, so it does not reload the
   class from the server (here, not for the whole test). Tab A changes the
   class. Tab B then saves from its old copy:

   F1. A fills a column (30 marks); B types a mark. Before: blocked with a
       red message, and B's mark was lost. Now both are kept.
   F2. A adds work and fills it (30 marks); B edits a title and types a
       mark. Before: the new work and its marks left the saved copy. Now
       they stay, signed in and in Demo Mode, and after a reload. */

test.use({ viewport: { width: 1440, height: 900 } });

const CID = 'c1a55e00-0000-4000-8000-00000000b5d1';
const SIDS = Array.from({ length: 30 }, (_, i) => 'e0000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
const SMALL = 'a5500000-0000-4000-8000-0000000000d2';
const NEW = 'a5500000-0000-4000-8000-0000000000d3';
const LEVEL = 'a5500000-0000-4000-8000-0000000000d4';
const ADDED = 'a5500000-0000-4000-8000-0000000000d5';

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
  const assessments = [
    quiz(SMALL, 'Small Quiz'),
    quiz(NEW, 'New Quiz'),
    { id: LEVEL, title: 'Level Check', type: 'summative', scoreMode: '', tagIds: ['QAP'] },
  ];
  const scores = {};
  SIDS.forEach((sid, i) => {
    scores[sid] = [];
    if (i < 4) scores[sid].push({ id: 'small-' + i, assessmentId: SMALL, tagId: null, score: 6, type: 'summative' });
  });
  return { cid: CID, students, assessments, scores, learningMap: TEST_LEARNING_MAP };
}

async function seedClass(page, data, demo) {
  await page.addInitScript(
    ({ data, demo }) => {
      const { cid, students, assessments, scores, learningMap } = data;
      if (localStorage.getItem('e2e-stale-tab-seeded')) return;
      if (demo && !JSON.parse(localStorage.getItem('gb-assessments-sci8') || '[]').length) return;
      localStorage.setItem('e2e-stale-tab-seeded', '1');
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

// Set Everyone To Proficient on a proficiency card, on the Assignments page.
async function fillCard(page, aid) {
  await go(page, '/assignments?course=' + CID);
  const card = page.locator('#ac-' + aid);
  await expect(card).toBeVisible();
  await card.locator('.assess-title').click();
  await expect(card).toHaveClass(/\bopen\b/);
  await (await cardMenuItem(card, 'confirmFillAll', '[data-score="3"]')).click();
  const ok = page.locator('.confirm-overlay #confirm-ok-btn');
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await expect.poll(async () => (await marks(page, aid)).saved.length).toBe(30);
}

async function openTwoTabs(page, context, mode) {
  const guardA = guardLines(page);
  if (mode === 'signed in') {
    await mockAuth(page);
    await seedClass(page, classData(), false);
    await page.goto('/dashboard');
  } else {
    await seedClass(page, classData(), true);
    await page.goto('/login.html');
    await page.locator('#demo-mode-btn').click();
    await page.waitForURL(/\/dashboard/);
    await page.waitForFunction(() => getAssessments('sci8').length > 0);
    await page.reload();
  }
  await waitForClass(page, 3);

  const b = await context.newPage();
  const guardB = guardLines(b);
  if (mode === 'signed in') await mockAuth(b);
  await b.goto('/gradebook?course=' + CID);
  await waitForClass(b, 3);
  // Tab B saved a moment ago, so it waits before reloading the class: here
  // it waits for the whole test, so its copy stays the old one.
  await b.evaluate(() => (_REFRESH_QUIET_MS = 10 * 60 * 1000));
  await openScores(b);
  await typeInCell(b, NEW, SIDS[5], '7');
  return { b, guardA, guardB };
}

test('F1, signed in: a mark typed in a tab behind the other tab’s fill is kept, and so is the fill', async ({
  page,
  context,
}) => {
  test.slow();
  const { b, guardA, guardB } = await openTwoTabs(page, context, 'signed in');

  await page.bringToFront();
  await fillCard(page, LEVEL);
  await expectNoBlock(page, guardA);

  await b.bringToFront();
  expect((await marks(b, LEVEL)).cache).toEqual([]); // B has not reloaded
  await typeInCell(b, NEW, SIDS[6], '8');
  await expect(cell(b, NEW, SIDS[6]).locator('.gb-scores-val')).toHaveText('8');
  await b.waitForTimeout(500);
  await expectNoBlock(b, guardB);
  expect((await marks(b, LEVEL)).saved).toHaveLength(30);
  expect((await marks(b, LEVEL)).cache).toHaveLength(30);
  expect((await marks(b, NEW)).saved.sort()).toEqual([7, 8]);

  // B's two marks reached the server once each, and nothing else from B's
  // old copy did. (This class's levels are on a key the fake server is not
  // sent, so the fill itself stays local here.)
  expect(await b.evaluate(() => (window.__e2eRpcLog || []).filter(c => /clear|delete/.test(c.name)))).toEqual([]);
  expect((await writesOn([page, b], NEW)).sort()).toEqual([
    ['upsert_score', SIDS[5], 7],
    ['upsert_score', SIDS[6], 8],
  ]);

  await b.reload();
  await waitForClass(b, 3);
  expect((await marks(b, LEVEL)).cache).toHaveLength(30);
  expect((await marks(b, NEW)).cache.sort()).toEqual([7, 8]);
});

for (const mode of ['signed in', 'Demo Mode'])
  test(`F2, ${mode}: new work and its marks survive a stale tab’s title edit and mark`, async ({ page, context }) => {
    test.slow();
    const { b, guardA, guardB } = await openTwoTabs(page, context, mode);

    // Tab A adds work and fills it.
    await page.bringToFront();
    await page.evaluate(
      ([cid, id]) =>
        saveAssessments(
          cid,
          getAssessments(cid).concat([{ id, title: 'Added Lab', type: 'summative', scoreMode: '', tagIds: ['QAP'] }]),
        ),
      [CID, ADDED],
    );
    await fillCard(page, ADDED);
    await expectNoBlock(page, guardA);

    // Tab B, still on its old copy, renames a quiz as the edit form does
    // (its own list, changed, saved whole) and types a mark.
    await b.bringToFront();
    expect(await b.evaluate(cid => getAssessments(cid).length, CID)).toBe(3);
    await b.evaluate(cid => {
      const list = getAssessments(cid);
      list.find(a => a.title === 'Small Quiz').title = 'Short Quiz';
      saveAssessments(cid, list);
    }, CID);
    await typeInCell(b, NEW, SIDS[6], '8');
    await b.waitForTimeout(500);
    await expectNoBlock(b, guardB);

    const titles = list => list.map(a => a.title).sort();
    const savedList = () => b.evaluate(cid => JSON.parse(localStorage.getItem('gb-assessments-' + cid)), CID);
    expect(titles(await savedList())).toEqual(['Added Lab', 'Level Check', 'New Quiz', 'Short Quiz']);
    expect((await marks(b, ADDED)).saved).toHaveLength(30);
    expect((await marks(b, NEW)).saved.sort()).toEqual([7, 8]);
    if (mode === 'signed in') {
      const all = await Promise.all([page, b].map(p => p.evaluate(() => (window.__e2eRpcLog || []).map(c => c.name))));
      expect(all.flat().filter(n => /delete_assessment|create_assessment/.test(n))).toEqual(['create_assessment']);
      expect(all.flat().filter(n => /clear/.test(n))).toEqual([]);
      expect((await writesOn([page, b], NEW)).sort()).toEqual([
        ['upsert_score', SIDS[5], 7],
        ['upsert_score', SIDS[6], 8],
      ]);
    }

    await b.reload();
    await waitForClass(b, 4);
    expect((await marks(b, ADDED)).cache).toHaveLength(30);
    expect((await marks(b, NEW)).cache.sort()).toEqual([7, 8]);
    expect(titles(await b.evaluate(cid => getAssessments(cid), CID))).toContain('Short Quiz');
  });
