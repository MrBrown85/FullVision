import { test, expect } from '@playwright/test';
import { mockAuth, TEST_LEARNING_MAP } from './helpers.js';
import { cardMenuItem } from './card-menu.js';

/* Pins what holds today when a teacher deletes the assessment that holds
   most of a class's marks and then grades other work (S19-B3). saveScores
   (shared/data.js) refuses a save that drops more than half the students or
   more than 70% of the entries against the saved copy, logs "[GUARD]" and
   shows "Score save blocked". Both delete paths, the Gradebook's column menu
   (_commitDeleteAssess) and the Assignments card's Delete…
   (_confirmDeleteAssess), save the shorter assessment list first, and
   saveAssessments takes the work's marks out of the cache and the saved copy
   (_cleanOrphanedScores) before the delete saves the scores, so the guard
   sees no drop and the next mark saves.

   The class: 30 students, Big Test with a mark for all 30 (30 of the class's
   32 entries, so taking it out leaves 2, far under the guard's 30%), Small
   Quiz with 2 marks, and New Quiz with none. In Demo Mode and signed in
   (helpers.js mockAuth); signed in, the class has server-shaped ids so the
   writes reach the fake server, and the class is seeded once so a reload
   reads back what the page saved. Tests only. */

test.use({ viewport: { width: 1440, height: 900 } });

const CID = 'c1a55e00-0000-4000-8000-00000000b3b3';
const SIDS = Array.from({ length: 30 }, (_, i) => 'e0000000-0000-4000-8000-' + String(i + 1).padStart(12, '0'));
const BIG = 'a5500000-0000-4000-8000-0000000000b1';
const SMALL = 'a5500000-0000-4000-8000-0000000000b2';
const NEW = 'a5500000-0000-4000-8000-0000000000b3';
const GRADED = SIDS[5];

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
  const assessments = [quiz(BIG, 'Big Test'), quiz(SMALL, 'Small Quiz'), quiz(NEW, 'New Quiz')];
  const scores = {};
  SIDS.forEach((sid, i) => {
    scores[sid] = [{ id: 'big-' + i, assessmentId: BIG, tagId: null, score: 5 + (i % 5), type: 'summative' }];
    if (i < 2) scores[sid].push({ id: 'small-' + i, assessmentId: SMALL, tagId: null, score: 6, type: 'summative' });
  });
  return { cid: CID, students, assessments, scores, learningMap: TEST_LEARNING_MAP };
}

/* Writes the class into localStorage once, before the page's own scripts
   run. Signed in, at the first load: a reload must read back what the page
   saved. In Demo Mode, beside the sample class once Demo Mode has made it. */
async function seedClass(page, demo) {
  await page.addInitScript(
    ({ data, demo }) => {
      const { cid, students, assessments, scores, learningMap } = data;
      if (localStorage.getItem('e2e-delete-then-grade-seeded')) return;
      if (demo && !JSON.parse(localStorage.getItem('gb-assessments-sci8') || '[]').length) return;
      localStorage.setItem('e2e-delete-then-grade-seeded', '1');
      const courses = demo ? JSON.parse(localStorage.getItem('gb-courses') || '{}') : {};
      courses[cid] = { id: cid, name: 'Grade 9 Science', gradingSystem: 'proficiency', calcMethod: 'mostRecent' };
      localStorage.setItem('gb-courses', JSON.stringify(courses));
      if (!demo) localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
      localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(learningMap));
      localStorage.setItem('gb-students-' + cid, JSON.stringify(students));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify(assessments));
      localStorage.setItem('gb-scores-' + cid, JSON.stringify(scores));
    },
    { data: classData(), demo },
  );
}

// Every "[GUARD]" line the page logs.
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

async function enterDemo(page) {
  await seedClass(page, true);
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The sample class seeds after the curriculum bank loads; the reload adds ours.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.reload();
  await waitForClass(page, 3);
}

async function signIn(page) {
  await mockAuth(page);
  await seedClass(page, false);
  await page.goto('/dashboard');
  await waitForClass(page, 3);
}

const go = (page, path) => page.evaluate(p => window.Router.navigate(p), path);

async function openScores(page) {
  await go(page, '/gradebook?course=' + CID);
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await expect(page.locator('#gb-data td.gb-scores-cell').first()).toBeVisible();
}

const cell = (page, aid, sid) => page.locator(`.gb-scores-cell[data-aid="${aid}"][data-sid="${sid}"]`);

/* Selects the cell, types the digit and Return, as a teacher would. Return
   moves the box down a row; Escape closes that one without saving. */
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

async function deleteFromGradebook(page) {
  await openScores(page);
  const label = page.locator(`#gb-colheads .gb-grid-colhead[data-aid="${BIG}"] .gb-grid-colhead-label`);
  await label.focus();
  await page.keyboard.press('Enter');
  await page.locator('.gb-ctx-menu [data-ctx="deleteAssess"]').click();
  await expect(page.locator('#confirm-title')).toHaveText('Delete “Big Test”?');
  await page.locator('#confirm-ok-btn').click();
  await expect(cell(page, BIG, GRADED)).toHaveCount(0);
  // The delete is done when the ten-second Undo toast closes.
  await expect(page.locator('#undo-toast')).toContainText('Deleted “Big Test”');
  await expect(page.locator('#undo-toast')).toHaveCount(0, { timeout: 15_000 });
}

async function deleteFromAssignments(page) {
  await go(page, '/assignments?course=' + CID);
  const card = page.locator('#ac-' + BIG);
  await expect(card).toBeVisible();
  await card.locator('.assess-title').click();
  await expect(card).toHaveClass(/\bopen\b/);
  await (await cardMenuItem(card, 'deleteAssess')).click();
  const dialog = page.locator('.confirm-overlay');
  await expect(dialog.locator('.confirm-title')).toHaveText('Delete Assessment');
  await dialog.locator('#confirm-ok-btn').click();
  await expect(card).toHaveCount(0);
}

// The marks for one assessment, in the cache and in the saved copy.
const marks = (page, aid) =>
  page.evaluate(
    ([cid, a]) => {
      const of = blob =>
        Object.values(blob || {})
          .flat()
          .filter(e => e && e.assessmentId === a)
          .map(e => e.score);
      return { cache: of(getScores(cid)), saved: of(JSON.parse(localStorage.getItem('gb-scores-' + cid))) };
    },
    [CID, aid],
  );

const rpc = (page, name) =>
  page.evaluate(n => (window.__e2eRpcLog || []).filter(c => c.name === n).map(c => c.params), name);

async function expectNoBlock(page, guard) {
  expect(guard).toEqual([]);
  await expect(page.locator('#sync-toast')).toHaveCount(0);
}

for (const mode of ['Demo Mode', 'signed in'])
  for (const where of ['the Gradebook', 'the Assignments page'])
    test(`${mode}: Delete Assessment from ${where}, then a new mark saves and outlasts a reload`, async ({ page }) => {
      test.slow(); // the Gradebook's Undo toast stays up ten seconds
      const guard = guardLines(page);
      const signedIn = mode === 'signed in';
      if (signedIn) await signIn(page);
      else await enterDemo(page);
      expect((await marks(page, BIG)).cache).toHaveLength(30);

      if (where === 'the Gradebook') await deleteFromGradebook(page);
      else await deleteFromAssignments(page);
      expect(await page.evaluate(cid => getAssessments(cid).map(a => a.title), CID)).toEqual([
        'Small Quiz',
        'New Quiz',
      ]);
      expect(await marks(page, BIG)).toEqual({ cache: [], saved: [] });
      expect((await marks(page, SMALL)).saved).toEqual([6, 6]);
      await expectNoBlock(page, guard);
      if (signedIn) expect(await rpc(page, 'delete_assessment')).toEqual([expect.objectContaining({ p_id: BIG })]);

      if (where === 'the Assignments page') await openScores(page);
      await typeInCell(page, NEW, GRADED, '7');
      await expect(cell(page, NEW, GRADED).locator('.gb-scores-val')).toHaveText('7');
      expect(await marks(page, NEW)).toEqual({ cache: [7], saved: [7] });
      await expectNoBlock(page, guard);
      if (signedIn)
        await expect
          .poll(() => rpc(page, 'upsert_score'))
          .toEqual([expect.objectContaining({ p_enrollment_id: GRADED, p_assessment_id: NEW, p_value: 7 })]);

      await page.reload();
      await waitForClass(page, 2);
      await page.locator('[data-action="setView"][data-mode="scores"]').click();
      await expect(cell(page, NEW, GRADED).locator('.gb-scores-val')).toHaveText('7');
      await expect(cell(page, BIG, GRADED)).toHaveCount(0);
      expect(await marks(page, NEW)).toEqual({ cache: [7], saved: [7] });
      expect(await marks(page, SMALL)).toEqual({ cache: [6, 6], saved: [6, 6] });
      await expectNoBlock(page, guard);
    });
