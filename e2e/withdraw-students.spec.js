import { test, expect } from '@playwright/test';
import { mockAuth, TEST_LEARNING_MAP } from './helpers.js';

/* Removing a student withdraws them (docs/DECISIONS.md, "Students are removed
   by withdrawal, not deletion"). Class Management lists withdrawn students
   with Re-enrol and the permanent delete, the second step. The class and
   students have server-shaped ids, so the writes reach the fake server. */

const CID = 'c1a55e00-0000-4000-8000-000000000001';
const ALICE = 'e0000000-0000-4000-8000-00000000000a';
const BOB = 'e0000000-0000-4000-8000-00000000000b';
const CHARLIE = 'e0000000-0000-4000-8000-00000000000c';
const AID = 'a5500000-0000-4000-8000-000000000001';

function student(id, first, last) {
  return {
    id,
    personId: id.replace(/^e/, 'f'),
    firstName: first,
    lastName: last,
    preferred: '',
    pronouns: '',
    studentNumber: '',
    email: '',
    dateOfBirth: '',
    designations: [],
    attendance: [],
    sortName: last + ' ' + first,
  };
}

async function seedClass(page) {
  await page.addInitScript(
    ({ cid, students, aid, learningMap }) => {
      // Seed once: a reload must keep what the test did.
      if (localStorage.getItem('e2e-withdraw-seeded')) return;
      localStorage.setItem('e2e-withdraw-seeded', '1');
      const courses = { [cid]: { id: cid, name: 'Science 9', gradingSystem: 'proficiency', calcMethod: 'mostRecent' } };
      localStorage.setItem('gb-courses', JSON.stringify(courses));
      localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
      localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(learningMap));
      localStorage.setItem('gb-students-' + cid, JSON.stringify(students));
      localStorage.setItem(
        'gb-assessments-' + cid,
        JSON.stringify([
          { id: aid, title: 'Quiz 1', type: 'summative', scoreMode: 'points', maxPoints: 10, tagIds: [] },
        ]),
      );
      const scores = {};
      students.forEach((s, i) => {
        scores[s.id] = [{ id: 'sc-' + i, assessmentId: aid, tagId: null, score: 4 + i * 2, type: 'summative' }];
      });
      localStorage.setItem('gb-scores-' + cid, JSON.stringify(scores));
    },
    {
      cid: CID,
      students: [
        student(ALICE, 'Alice', 'Anderson'),
        student(BOB, 'Bob', 'Baker'),
        student(CHARLIE, 'Charlie', 'Chen'),
      ],
      aid: AID,
      learningMap: TEST_LEARNING_MAP,
    },
  );
}

async function openClassManager(page) {
  await page.goto('/teacher/app.html#/dashboard');
  await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
  await page.locator('[data-action="openClassManager"]').first().click();
  await expect(page.locator('.cm-student-list').first()).toBeVisible();
}

function rpcCalls(page, name) {
  return page.evaluate(n => (window.__e2eRpcLog || []).filter(c => c.name === n).map(c => c.params), name);
}

async function withdrawAlice(page) {
  await page.locator(`[data-action="cmRemoveStudent"][data-sid="${ALICE}"]`).click();
  const dialog = page.locator('.confirm-card');
  await expect(dialog.locator('.confirm-title')).toHaveText('Withdraw student');
  await dialog.locator('#confirm-ok-btn').click();
}

const roster = page => page.locator('.cm-section .cm-student-list').first();
const withdrawn = page => page.locator('#cm-withdrawn');

test.describe('Withdraw students', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedClass(page);
  });

  test('the remove button withdraws: the student moves to the Withdrawn list and nothing is deleted', async ({
    page,
  }) => {
    await openClassManager(page);
    await page.locator(`[data-action="cmRemoveStudent"][data-sid="${ALICE}"]`).click();

    const dialog = page.locator('.confirm-card');
    await expect(dialog.locator('.confirm-message')).toContainText('kept');
    await expect(dialog.locator('.confirm-message')).not.toContainText('cannot be undone');
    await expect(dialog.locator('#confirm-ok-btn')).toHaveText('Withdraw');
    await dialog.locator('#confirm-ok-btn').click();

    await expect(roster(page)).not.toContainText('Anderson');
    await expect(roster(page)).toContainText('Baker');
    await expect(withdrawn(page)).toContainText('Withdrawn (1)');
    const row = withdrawn(page).locator(`[data-withdrawn-sid="${ALICE}"]`);
    await expect(row).toContainText('Alice Anderson');
    await expect(row.getByRole('button', { name: 'Re-enrol' })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Delete permanently' })).toBeVisible();
    await expect(page.locator('#undo-toast')).toContainText('withdrawn');

    await expect.poll(() => rpcCalls(page, 'withdraw_student')).toHaveLength(1);
    expect((await rpcCalls(page, 'withdraw_student'))[0].p_enrollment_id).toBe(ALICE);
    expect(await rpcCalls(page, 'delete_student')).toHaveLength(0);
    expect(await rpcCalls(page, 'delete_withdrawn_student')).toHaveLength(0);
  });

  test('a withdrawn student leaves the gradebook, stays withdrawn after a reload, and keeps their scores', async ({
    page,
  }) => {
    await openClassManager(page);
    await withdrawAlice(page);
    await expect(withdrawn(page)).toContainText('Alice Anderson');

    await page.goto('/teacher/app.html#/gradebook');
    await page.waitForSelector('#dock-mount nav');
    await expect(page.locator('#main')).toContainText('Baker');
    await expect(page.locator('#main')).not.toContainText('Anderson');

    await page.reload();
    await page.waitForSelector('#dock-mount nav');
    await expect(page.locator('#main')).toContainText('Baker');
    await expect(page.locator('#main')).not.toContainText('Anderson');
    const kept = await page.evaluate(
      ({ cid, sid }) => {
        const entry = getWithdrawnStudents(cid).find(w => w.student.id === sid);
        return { inRoster: getStudents(cid).some(s => s.id === sid), scores: entry && entry.records.scores };
      },
      { cid: CID, sid: ALICE },
    );
    expect(kept.inRoster).toBe(false);
    expect(kept.scores).toHaveLength(1);

    await openClassManager(page);
    await expect(withdrawn(page)).toContainText('Alice Anderson');
  });

  test('Re-enrol puts the student back with their scores', async ({ page }) => {
    await openClassManager(page);
    await withdrawAlice(page);

    await withdrawn(page).getByRole('button', { name: 'Re-enrol' }).click();

    await expect(roster(page)).toContainText('Anderson');
    await expect(withdrawn(page)).toHaveCount(0);
    await expect.poll(() => rpcCalls(page, 'reenrol_student')).toHaveLength(1);
    expect((await rpcCalls(page, 'reenrol_student'))[0].p_enrollment_id).toBe(ALICE);
    expect(await rpcCalls(page, 'create_student_and_enroll')).toHaveLength(0);
    const score = await page.evaluate(({ cid, sid }) => getScores(cid)[sid][0].score, { cid: CID, sid: ALICE });
    expect(score).toBe(4);

    await page.goto('/teacher/app.html#/gradebook');
    await page.waitForSelector('#dock-mount nav');
    await expect(page.locator('#main')).toContainText('Anderson');
  });

  test('Undo on the toast re-enrols the student', async ({ page }) => {
    await openClassManager(page);
    await withdrawAlice(page);

    await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).click();

    await expect(roster(page)).toContainText('Anderson');
    await expect(withdrawn(page)).toHaveCount(0);
    await expect.poll(() => rpcCalls(page, 'reenrol_student')).toHaveLength(1);
  });

  test('Delete permanently is a second step: it warns, deletes, and offers no Undo', async ({ page }) => {
    await openClassManager(page);
    await withdrawAlice(page);
    await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).waitFor();
    await page.evaluate(() => dismissUndoToast());

    await withdrawn(page).getByRole('button', { name: 'Delete permanently' }).click();
    const dialog = page.locator('.confirm-card');
    await expect(dialog.locator('.confirm-title')).toHaveText('Delete permanently');
    await expect(dialog.locator('.confirm-message')).toContainText('cannot be undone');
    await dialog.locator('#confirm-ok-btn').click();

    await expect(withdrawn(page)).toHaveCount(0);
    await expect(roster(page)).not.toContainText('Anderson');
    await expect(page.locator('#undo-toast')).toHaveCount(0);
    await expect.poll(() => rpcCalls(page, 'delete_withdrawn_student')).toHaveLength(1);
    expect((await rpcCalls(page, 'delete_withdrawn_student'))[0].p_enrollment_id).toBe(ALICE);
    expect(await rpcCalls(page, 'delete_student')).toHaveLength(0);

    await page.reload();
    await page.waitForSelector('#dock-mount nav');
    await page.locator('[data-action="openClassManager"]').first().click();
    await expect(roster(page)).toContainText('Baker');
    await expect(roster(page)).not.toContainText('Anderson');
    await expect(withdrawn(page)).toHaveCount(0);
  });
});

test.describe('Withdraw students in Demo Mode', () => {
  test('withdraw, re-enrol and delete work with no server', async ({ page }) => {
    const requests = [];
    page.on('request', req => {
      if (/supabase\.co/.test(req.url())) requests.push(req.url());
    });
    await page.goto('/login.html');
    await page.locator('#demo-mode-btn').click();
    await page.waitForURL(/teacher\/app\.html/);
    await page.waitForSelector('#dock-mount nav');
    await page.locator('[data-action="openClassManager"]').first().click();
    const firstRemove = page.locator('[data-action="cmRemoveStudent"]').first();
    await expect(firstRemove).toBeVisible();
    const sid = await firstRemove.getAttribute('data-sid');
    const before = await page.locator('[data-action="cmRemoveStudent"]').count();

    await firstRemove.click();
    await page.locator('.confirm-card #confirm-ok-btn').click();
    await expect(page.locator('[data-action="cmRemoveStudent"]')).toHaveCount(before - 1);
    await expect(page.locator(`#cm-withdrawn [data-withdrawn-sid="${sid}"]`)).toBeVisible();

    await page.locator('#cm-withdrawn').getByRole('button', { name: 'Re-enrol' }).click();
    await expect(page.locator('[data-action="cmRemoveStudent"]')).toHaveCount(before);
    await expect(page.locator('#cm-withdrawn')).toHaveCount(0);

    await page.locator(`[data-action="cmRemoveStudent"][data-sid="${sid}"]`).click();
    await page.locator('.confirm-card #confirm-ok-btn').click();
    await page.evaluate(() => dismissUndoToast());
    await page.locator('#cm-withdrawn').getByRole('button', { name: 'Delete permanently' }).click();
    await page.locator('.confirm-card #confirm-ok-btn').click();
    await expect(page.locator('#cm-withdrawn')).toHaveCount(0);
    await expect(page.locator('[data-action="cmRemoveStudent"]')).toHaveCount(before - 1);

    expect(requests).toEqual([]);
  });
});
