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

// The Add/Edit Assignment form's Pair and Group panels: Manual lays out empty
// pairs or groups with everyone in Unassigned, students drag between them,
// and Number of Groups is saved with the assignment.

const STUDENTS = ['Ava', 'Ben', 'Cora', 'Dev', 'Eli', 'Fay'].map((name, i) => ({
  id: 'stu-00' + (i + 1),
  firstName: name,
  lastName: 'Test' + (i + 1),
  preferred: name,
  pronouns: '',
  studentNumber: String(1001 + i),
  email: '',
  dateOfBirth: '',
  designations: [],
  enrolledDate: '',
  attendance: [],
}));

const GROUP_WORK = { ...TEST_ASSESSMENT, title: 'Group Work', collaboration: 'group' };

async function openEditor(page) {
  await gotoApp(page, '/assignments?edit=' + GROUP_WORK.id);
  await expect(page.locator('#collab-panel-mount .collab-panel')).toBeVisible();
}

// Opens the editor again without a reload (a reload re-seeds localStorage).
async function reopenEditor(page) {
  await page.evaluate(id => {
    const btn = document.querySelector('[data-action="editAssess"][data-aid="' + id + '"]');
    btn.click();
  }, GROUP_WORK.id);
  await expect(page.locator('#collab-panel-mount .collab-panel')).toBeVisible();
}

// Drag events dispatched straight to the elements: the form is still
// scrolling into view when a test starts, so mouse positions can miss.
async function drag(page, sid, title) {
  const dt = await page.evaluateHandle(() => new DataTransfer());
  await page
    .locator('#collab-panel-mount [data-collab-drag-sid="' + sid + '"]')
    .dispatchEvent('dragstart', { dataTransfer: dt });
  const target = card(page, title);
  await target.dispatchEvent('dragover', { dataTransfer: dt });
  await target.dispatchEvent('drop', { dataTransfer: dt });
}

const card = (page, title) =>
  page.locator('#collab-panel-mount .collab-group-card').filter({
    has: page.locator('.collab-group-header span:first-child', { hasText: new RegExp('^' + title + '$') }),
  });

test.describe('Group setup panel', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page, STUDENTS);
    await seedAssessments(page, [GROUP_WORK]);
  });

  test('Manual gives empty groups and students drag into them', async ({ page }) => {
    await openEditor(page);
    const manual = page.locator('[data-action="collabManualGroups"]');
    await manual.click();
    await expect(manual).toHaveClass(/active/);
    await expect(page.locator('[data-action="collabRandomGroups"]')).not.toHaveClass(/active/);

    for (const n of [1, 2, 3, 4]) await expect(card(page, 'Group ' + n)).toContainText('0 students');
    await expect(card(page, 'Unassigned')).toContainText('6 students');

    await drag(page, 'stu-001', 'Group 2');
    await expect(card(page, 'Group 2')).toContainText('1 student');
    await expect(card(page, 'Group 2')).toContainText('Ava');
    await expect(card(page, 'Unassigned')).toContainText('5 students');

    // Dragging back out empties the group but keeps it.
    await drag(page, 'stu-001', 'Unassigned');
    await expect(card(page, 'Group 2')).toContainText('0 students');
    await expect(card(page, 'Unassigned')).toContainText('6 students');
  });

  test('Number of Groups keeps manual groups and is saved', async ({ page }) => {
    await openEditor(page);
    await page.locator('[data-action="collabManualGroups"]').click();
    await drag(page, 'stu-002', 'Group 1');

    await page.locator('[data-action="collabSetGroupCount"][data-delta="-1"]').click();
    await expect(page.locator('.collab-stepper-val')).toHaveText('3');
    await expect(card(page, 'Group 4')).toHaveCount(0);
    await expect(card(page, 'Group 1')).toContainText('Ben');

    await page.locator('[data-action="saveEditAssess"]').click();
    const saved = await page.evaluate(
      cid => JSON.parse(localStorage.getItem('gb-assessments-' + cid))[0],
      TEST_COURSE.id,
    );
    expect(saved.groupCount).toBe(3);
    expect(saved.groups).toEqual([['stu-002'], [], []]);

    await reopenEditor(page);
    await expect(page.locator('.collab-stepper-val')).toHaveText('3');
    await expect(page.locator('[data-action="collabManualGroups"]')).toHaveClass(/active/);
    await expect(card(page, 'Group 1')).toContainText('Ben');
    await expect(card(page, 'Unassigned')).toContainText('5 students');
  });

  test('Number of Groups is saved before any groups are made', async ({ page }) => {
    await openEditor(page);
    await page.locator('[data-action="collabSetGroupCount"][data-delta="1"]').click();
    await expect(page.locator('.collab-stepper-val')).toHaveText('5');
    await page.locator('[data-action="saveEditAssess"]').click();
    await reopenEditor(page);
    await expect(page.locator('.collab-stepper-val')).toHaveText('5');
  });

  test('Manual pairs give empty pairs to fill', async ({ page }) => {
    await openEditor(page);
    await page.locator('.af-collab-btn[data-collab="pair"]').click();
    await page.locator('[data-action="collabManualPairs"]').click();
    await expect(page.locator('[data-action="collabManualPairs"]')).toHaveClass(/active/);
    for (const n of [1, 2, 3]) await expect(card(page, 'Pair ' + n)).toContainText('0 students');
    await expect(card(page, 'Unassigned')).toContainText('6 students');
    await drag(page, 'stu-003', 'Pair 3');
    await expect(card(page, 'Pair 3')).toContainText('Cora');
  });
});
