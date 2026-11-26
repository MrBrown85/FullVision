import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// The grader dialog on points work opens with the points box in focus, and
// ← → step to the previous or next student. Drawing the next student takes
// the box away; Chrome blurs a box as it goes, and that blur saved the box's
// points for the student the page had just moved to. So → gave the next
// student the first student's points, and from an empty box it erased theirs
// (found Nov 26, 2026). A step now leaves the box first, and a box saves for
// the student the teacher went into it for.
const CID = TEST_COURSE.id;
const AID = 'assess-step';
const QUIZ = {
  id: AID,
  title: 'Points Quiz',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP'],
  evidenceType: '',
  notes: '',
  coreCompetencyIds: [],
  rubricId: '',
  scoreMode: 'points',
  maxPoints: 10,
  weight: 1,
  dueDate: '',
  collaboration: 'individual',
  moduleId: '',
  pairs: [],
  groups: [],
  excludedStudents: [],
  created: new Date('2026-03-21').toISOString(),
};
const ALICE = 'stu-001';
const BOB = 'stu-002';
const CHARLIE = 'stu-003';

async function open(page, sid) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(({ list, cid }) => localStorage.setItem('gb-assessments-' + cid, JSON.stringify(list)), {
    list: [QUIZ],
    cid: CID,
  });
  await gotoApp(page, '/dashboard');
  // Alice has 6 and Bob has 8; Charlie has no points yet.
  await page.evaluate(
    ({ cid, aid, alice, bob }) => {
      setPointsScore(cid, alice, aid, 6);
      setPointsScore(cid, bob, aid, 8);
    },
    { cid: CID, aid: AID, alice: ALICE, bob: BOB },
  );
  await page.evaluate(() => window.Router.navigate('/gradebook'));
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await page.locator('.gb-scores-cell[data-sid="' + sid + '"][data-aid="' + AID + '"]').click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  await expect(dialog.locator('.grdp-input')).toBeFocused();
  return { dialog, box: dialog.locator('.grdp-input'), name: dialog.locator('.grader-student'), errors };
}
const points = page =>
  page.evaluate(({ cid, aid, sids }) => sids.map(sid => getPointsScore(cid, sid, aid)), {
    cid: CID,
    aid: AID,
    sids: [ALICE, BOB, CHARLIE],
  });

test('→ and ← in the points box leave every student with their own points', async ({ page }) => {
  const { box, name, errors } = await open(page, ALICE);
  await expect(box).toHaveValue('6');

  await page.keyboard.press('ArrowRight');
  await expect(name).toContainText('Bob');
  // Bob's own points, in a box ready to type in: not Alice's 6.
  await expect(box).toHaveValue('8');
  await expect(box).toBeFocused();
  expect(await points(page)).toEqual([6, 8, null]);

  await page.keyboard.press('ArrowRight');
  await expect(name).toContainText('Charlie');
  await expect(box).toHaveValue('');
  await expect(box).toBeFocused();
  expect(await points(page)).toEqual([6, 8, null]);

  // Back from Charlie's empty box: Bob's 8 is not erased.
  await page.keyboard.press('ArrowLeft');
  await expect(name).toContainText('Bob');
  await expect(box).toHaveValue('8');
  await page.keyboard.press('ArrowLeft');
  await expect(name).toContainText('Alice');
  await expect(box).toHaveValue('6');
  expect(await points(page)).toEqual([6, 8, null]);
  // The redraw is not cut short by a save from the box it is taking away.
  expect(errors).toEqual([]);
});

test('points typed and then Next are saved for the student they were typed for', async ({ page }) => {
  const { dialog, box, name, errors } = await open(page, ALICE);
  await page.keyboard.type('7');
  await dialog.locator('[data-grader="next"]').click();
  await expect(name).toContainText('Bob');
  await expect(box).toHaveValue('8');
  expect(await points(page)).toEqual([7, 8, null]);

  // Typed for Charlie, then the dialog closes: Charlie's, and nobody else's.
  await page.keyboard.press('ArrowRight');
  await expect(name).toContainText('Charlie');
  await page.keyboard.type('9.5');
  await dialog.locator('.grader-done').click();
  await expect(page.locator('#grader-overlay')).toHaveCount(0);
  expect(await points(page)).toEqual([7, 8, 9.5]);
  expect(errors).toEqual([]);
});
