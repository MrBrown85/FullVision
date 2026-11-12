import { test, expect } from '@playwright/test';
import { gotoApp, clickAction, getText, mockAuth, TEST_LEARNING_MAP } from './helpers.js';

/* Pins what Class Settings does today on the Students tab and in Class
   Actions (S19-D12): the roster's sort buttons, designation chips, the
   links to the student page and the gradebook, archive and unarchive,
   delete, and the class backup file. Demo Mode keeps its data in
   localStorage, so a reload shows what was saved. One signed-in test
   checks that archive and delete reach the server. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openRoster(page) {
  await gotoApp(page, '/dashboard?manage=students');
  await expect(page.locator('.cm-rs-row').first()).toBeVisible();
}

// The roster's names are in edit boxes, so read their values.
function rosterNames(page) {
  return page
    .locator('.cm-rs-row')
    .evaluateAll(rows =>
      rows.map(r => [r.querySelector('[data-col="last"]').value, r.querySelector('[data-col="first"]').value]),
    );
}

const classActions = page => page.locator('.cm-head [data-action="cmStdMenu"]');
const actionsMenu = page => page.locator('.cm-class-actions-menu');
const classList = page => page.locator('.cm-class-list');
const pickerOptions = (page, sel) =>
  page.locator(sel + ' option').evaluateAll(opts => opts.map(o => [o.value, o.textContent]));

/* Duplicate Class for Block B: a second, empty class to archive and delete,
   so the demo class itself stays. Returns the copy's id. */
async function duplicateForBlockB(page) {
  await classActions(page).click();
  await clickAction(page, 'cmDuplicateCourse');
  const card = page.locator('.cm-dup-card');
  await expect(card.locator('.confirm-title')).toHaveText('Duplicate Block A · Science 8');
  await card.locator('.cm-block-picker .seg-btn', { hasText: /^B$/ }).click();
  await card.locator('#cm-dup-ok').click();
  await expect(page.locator('.cm-head-meta')).toContainText('Block B · 0 Students');
  const copy = await page.evaluate(() => Object.keys(COURSES).find(cid => cid !== 'sci8'));
  expect(copy).toBeTruthy();
  return copy;
}

async function archiveSelectedClass(page) {
  await classActions(page).click();
  await expect(actionsMenu(page).locator('[data-action="cmToggleArchive"]')).toHaveText('Archive Class');
  await clickAction(page, 'cmToggleArchive');
  await expect(page.locator('.cm-head-meta')).toContainText('· Archived');
}

test.describe('Class Settings roster and class actions in Demo Mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
    await openRoster(page);
  });

  test('Last Name and First Name are the two sort buttons, and each sorts the roster', async ({ page }) => {
    const sortButtons = page.locator('.cm-rs-head [data-action="cmRosterSort"]');
    await expect(sortButtons).toHaveCount(2);
    const byLast = page.locator('[data-action="cmRosterSort"][data-sort="lastName"]');
    const byFirst = page.locator('[data-action="cmRosterSort"][data-sort="firstName"]');

    // Last Name is the order it opens in.
    await expect(byLast).toHaveAttribute('aria-pressed', 'true');
    await expect(byLast).toHaveText('Last Name ↑');
    await expect(byFirst).toHaveAttribute('aria-pressed', 'false');
    await expect(byFirst).toHaveText('First Name');
    let names = await rosterNames(page);
    expect(names).toHaveLength(27);
    expect(names.slice(0, 3)).toEqual([
      ['Adeyemi', 'Cece'],
      ['Al-Rashid', 'Noor'],
      ['Berg', 'Hannah'],
    ]);
    const lastFirst = (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]);
    expect(names).toEqual(names.slice().sort(lastFirst));

    await byFirst.click();
    await expect(byFirst).toHaveAttribute('aria-pressed', 'true');
    await expect(byFirst).toHaveText('First Name ↑');
    await expect(byLast).toHaveAttribute('aria-pressed', 'false');
    await expect(byLast).toHaveText('Last Name');
    names = await rosterNames(page);
    expect(names).toHaveLength(27);
    expect(names.slice(0, 3)).toEqual([
      ['Singh', 'Aiden'],
      ['Osei', 'Amara'],
      ['Jama', 'Anisa'],
    ]);
    const firstLast = (a, b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]);
    expect(names).toEqual(names.slice().sort(firstLast));

    await byLast.click();
    await expect(byLast).toHaveAttribute('aria-pressed', 'true');
    names = await rosterNames(page);
    expect(names[0]).toEqual(['Adeyemi', 'Cece']);
  });

  test('A designation chip is added from + and removed with its ×, and a reload keeps each', async ({ page }) => {
    const row = page.locator('.cm-rs-row[data-sid="st3"]');
    const desig = row.locator('.cm-rs-desig');
    await expect(row.locator('[data-col="last"]')).toHaveValue('Blackwood');
    await expect(row.locator('.cm-rs-chip')).toHaveCount(0);
    await expect(page.locator('#cm-rs-summary')).toHaveText('27 students');

    // + lists the BC codes; picking one adds its chip.
    await row.locator('.cm-rs-add').click();
    await expect(row.locator('.cm-rs-add')).toHaveAttribute('aria-expanded', 'true');
    const picks = page.locator('.cm-rs-pick');
    await expect(picks).toHaveCount(12);
    await expect(picks.first()).toHaveText('A Physically Dependent');
    await page.locator('.cm-rs-pick[data-code="Q"]').click();
    await expect(page.locator('.cm-rs-picker')).toHaveCount(0);
    const chip = row.locator('.cm-rs-chip[data-code="Q"]');
    await expect(chip).toHaveText('Q Learning Disability ×');
    await expect(chip).toHaveAttribute('aria-label', 'Remove Q Learning Disability');
    await expect(desig.locator('.cm-iep-tag')).toHaveText('IEP');
    await expect(desig.locator('.cm-mod-tag')).toHaveCount(0);
    await expect(page.locator('#cm-rs-summary')).toHaveText('27 students · 1 with designations');
    expect(await page.evaluate(() => getStudents('sci8').find(s => s.id === 'st3').designations)).toEqual(['Q']);

    // A code the student has is not offered again.
    await row.locator('.cm-rs-add').click();
    await expect(picks).toHaveCount(11);
    await expect(page.locator('.cm-rs-pick[data-code="Q"]')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.locator('.cm-rs-picker')).toHaveCount(0);

    await page.reload();
    await expect(chip).toHaveText('Q Learning Disability ×');
    await expect(page.locator('#cm-rs-summary')).toHaveText('27 students · 1 with designations');

    await chip.click();
    await expect(row.locator('.cm-rs-chip')).toHaveCount(0);
    await expect(desig.locator('.cm-iep-tag')).toHaveCount(0);
    await expect(page.locator('#cm-rs-summary')).toHaveText('27 students');
    expect(await page.evaluate(() => getStudents('sci8').find(s => s.id === 'st3').designations)).toEqual([]);

    await page.reload();
    await expect(row.locator('[data-col="last"]')).toHaveValue('Blackwood');
    await expect(row.locator('.cm-rs-chip')).toHaveCount(0);
  });

  test("Open Student Page in a row's ⋯ menu opens that student's page", async ({ page }) => {
    await page.locator('.cm-rs-row[data-sid="st3"] .cm-rs-menu').click();
    const item = page.locator('[data-action="cmOpenStudentPage"][data-sid="st3"]');
    await expect(item).toHaveText('Open Student Page');
    await item.click();
    await expect(page).toHaveURL(/\/student\?course=sci8&id=st3$/);
    await expect(page.locator('#main')).toContainText('Sam Blackwood');
    await expect(page.locator('#main')).toContainText('Edit Student');
  });

  test("Open Gradebook opens the class's gradebook", async ({ page }) => {
    await expect(page.locator('[data-action="cmOpenGradebook"]')).toHaveText('Open Gradebook');
    await clickAction(page, 'cmOpenGradebook');
    await expect(page).toHaveURL(/\/gradebook$/);
    await expect(page.locator('.gb-course-select').first()).toHaveValue('sci8');
    await expect(page.locator('#main')).toContainText('Blackwood');
  });

  test('Archive Class takes a class out of the class pickers, Unarchive Class brings it back, and a reload keeps each', async ({
    page,
  }) => {
    const copy = await duplicateForBlockB(page);

    // Before it is archived, Delete Class is not offered.
    await classActions(page).click();
    await expect(actionsMenu(page).locator('[data-action="cmDeleteCourse"]')).toHaveCount(0);
    await expect(actionsMenu(page)).toContainText('Delete Class appears here once a class is archived.');
    await page.keyboard.press('Escape');

    await page.locator('.cm-toolbar [data-action="closeClassManager"]').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect
      .poll(() => pickerOptions(page, '#gb-course-select'))
      .toEqual([
        ['sci8', 'A · Science 8'],
        [copy, 'B · Science 8'],
      ]);

    await gotoApp(page, '/dashboard?manage=students');
    await page.locator(`.cm-class-item[data-cid="${copy}"]`).click();
    await expect(page.locator('.cm-head-meta')).toContainText('Block B');
    await archiveSelectedClass(page);
    // Class Settings lists it under Archived.
    await expect(classList(page).locator('.cm-class-group')).toHaveText('Archived');
    await expect(classList(page).locator(`.cm-class-item.archived[data-cid="${copy}"]`)).toContainText(
      '0 Students · Archived',
    );
    await classActions(page).click();
    await expect(actionsMenu(page).locator('[data-action="cmToggleArchive"]')).toHaveText('Unarchive Class');
    await expect(actionsMenu(page).locator('[data-action="cmDeleteCourse"]')).toHaveText('Delete Class');
    await page.keyboard.press('Escape');
    expect(await page.evaluate(cid => isCourseArchived(cid), copy)).toBe(true);

    // The dashboard's and the gradebook's class pickers leave it out.
    await page.locator('.cm-toolbar [data-action="closeClassManager"]').click();
    await expect.poll(() => pickerOptions(page, '#gb-course-select')).toEqual([['sci8', 'A · Science 8']]);
    await page.reload();
    await page.waitForSelector('#dock-mount nav');
    await expect.poll(() => pickerOptions(page, '#gb-course-select')).toEqual([['sci8', 'A · Science 8']]);
    await gotoApp(page, '/gradebook');
    await expect(page.locator('.gb-course-select').first()).toHaveValue('sci8');
    await expect.poll(() => pickerOptions(page, '.gb-course-select')).toEqual([['sci8', 'A · Science 8']]);

    // Unarchive puts it back.
    await gotoApp(page, '/dashboard?manage=students');
    await page.locator(`.cm-class-item[data-cid="${copy}"]`).click();
    await expect(page.locator('.cm-head-meta')).toContainText('· Archived');
    await classActions(page).click();
    await clickAction(page, 'cmToggleArchive');
    await expect(page.locator('.cm-head-meta')).not.toContainText('Archived');
    await expect(classList(page).locator('.cm-class-group')).toHaveCount(0);
    await expect(classList(page).locator(`.cm-class-item[data-cid="${copy}"]`)).toContainText('Block B · 0 Students');
    await page.locator('.cm-toolbar [data-action="closeClassManager"]').click();
    await expect
      .poll(() => pickerOptions(page, '#gb-course-select'))
      .toEqual([
        ['sci8', 'A · Science 8'],
        [copy, 'B · Science 8'],
      ]);
    await page.reload();
    await page.waitForSelector('#dock-mount nav');
    await expect
      .poll(() => pickerOptions(page, '#gb-course-select'))
      .toEqual([
        ['sci8', 'A · Science 8'],
        [copy, 'B · Science 8'],
      ]);
    expect(await page.evaluate(cid => isCourseArchived(cid), copy)).toBe(false);
  });

  test('Delete Class asks first; Cancel keeps the class, and Delete Class removes it for good', async ({ page }) => {
    const copy = await duplicateForBlockB(page);
    await archiveSelectedClass(page);

    await classActions(page).click();
    await clickAction(page, 'cmDeleteCourse');
    const dialog = page.locator('.confirm-card');
    await expect(dialog.locator('.confirm-title')).toHaveText('Delete Class');
    await expect(dialog.locator('.confirm-message')).toHaveText(
      'Permanently delete Science 8 with all its students, assessments, and scores? It disappears now and is erased for good after 30 days.',
    );
    await expect(dialog.locator('#confirm-ok-btn')).toHaveText('Delete Class');
    await dialog.locator('#confirm-cancel-btn').click();
    await expect(dialog).toHaveCount(0);
    await expect(classList(page).locator(`.cm-class-item[data-cid="${copy}"]`)).toHaveCount(1);
    expect(await page.evaluate(cid => !!COURSES[cid], copy)).toBe(true);

    await classActions(page).click();
    await clickAction(page, 'cmDeleteCourse');
    await dialog.locator('#confirm-ok-btn').click();
    await expect(dialog).toHaveCount(0);
    await expect(classList(page).locator(`.cm-class-item[data-cid="${copy}"]`)).toHaveCount(0);
    await expect(classList(page).locator('.cm-class-group')).toHaveCount(0);
    // Class Settings goes back to the demo class.
    await expect(page.locator('.cm-head-meta')).toContainText('Block A · 27 Students');
    expect(await getText(page, '.cm-head-title')).toBe('Science 8');
    expect(
      await page.evaluate(cid => [!!COURSES[cid], Object.keys(localStorage).filter(k => k.includes(cid))], copy),
    ).toEqual([false, []]);

    await page.reload();
    await expect(page.locator('.cm-rs-row').first()).toBeVisible();
    await expect(classList(page).locator('.cm-class-item')).toHaveCount(1);
    expect(await page.evaluate(() => Object.keys(COURSES))).toEqual(['sci8']);
  });

  test('Download Class Backup saves the class as one JSON file', async ({ page }) => {
    await classActions(page).click();
    await expect(actionsMenu(page).locator('[data-action="cmDownloadBackup"]')).toHaveText('Download Class Backup');
    const [download] = await Promise.all([page.waitForEvent('download'), clickAction(page, 'cmDownloadBackup')]);
    const today = await page.evaluate(() => new Date().toISOString().slice(0, 10));
    expect(download.suggestedFilename()).toBe('gradebook-sci8-' + today + '.json');

    const fs = await import('node:fs');
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(Object.keys(backup)).toEqual([
      'course',
      'savedAt',
      'courseInfo',
      'students',
      'categories',
      'assessments',
      'scores',
      'overrides',
      'notes',
      'config',
      'learningMap',
      'modules',
      'rubrics',
      'rubricChecks',
      'statuses',
      'flags',
      'goals',
      'reflections',
      'observations',
      'termRatings',
      'customTags',
      'reportConfig',
    ]);
    expect(backup.course).toBe('sci8');
    expect(backup.courseInfo.name).toBe('Science 8');
    const inApp = await page.evaluate(() => ({
      students: getStudents('sci8').map(s => s.id),
      assessments: getAssessments('sci8').map(a => a.id),
      scores: Object.keys(getScores('sci8')).sort(),
    }));
    expect(backup.students.map(s => s.id)).toEqual(inApp.students);
    expect(backup.students).toHaveLength(27);
    expect(backup.assessments.map(a => a.id)).toEqual(inApp.assessments);
    expect(Object.keys(backup.scores).sort()).toEqual(inApp.scores);
  });
});

/* Signed in, the same two class actions go to the server: archive_course,
   then delete_course. The classes have server-shaped ids, so the writes
   reach the fake server (see mockAuth). */
const CID_A = 'c1a55e00-0000-4000-8000-00000000000a';
const CID_B = 'c1a55e00-0000-4000-8000-00000000000b';

async function seedTwoClasses(page) {
  await page.addInitScript(
    ({ a, b, learningMap }) => {
      if (localStorage.getItem('e2e-pin-cm-roster-seeded')) return;
      localStorage.setItem('e2e-pin-cm-roster-seeded', '1');
      const course = (id, name) => ({ id, name, gradingSystem: 'proficiency', calcMethod: 'mostRecent' });
      localStorage.setItem('gb-courses', JSON.stringify({ [a]: course(a, 'Science 9'), [b]: course(b, 'Science 10') }));
      localStorage.setItem('gb-config', JSON.stringify({ activeCourse: a }));
      [a, b].forEach(cid => {
        localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(learningMap));
        localStorage.setItem('gb-students-' + cid, '[]');
        localStorage.setItem('gb-assessments-' + cid, '[]');
      });
    },
    { a: CID_A, b: CID_B, learningMap: TEST_LEARNING_MAP },
  );
}

function rpcCalls(page, name) {
  return page.evaluate(n => (window.__e2eRpcLog || []).filter(c => c.name === n).map(c => c.params), name);
}

test('Signed in, Archive Class and Delete Class send archive_course and delete_course', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await mockAuth(page);
  await seedTwoClasses(page);
  await gotoApp(page, '/dashboard?manage=students');
  await page.locator(`.cm-class-item[data-cid="${CID_B}"]`).click();
  await expect(page.locator('.cm-head-title')).toHaveText('Science 10');

  await archiveSelectedClass(page);
  await expect.poll(() => rpcCalls(page, 'archive_course')).toEqual([{ p_course_id: CID_B, p_archived: true }]);

  await classActions(page).click();
  await clickAction(page, 'cmDeleteCourse');
  const dialog = page.locator('.confirm-card');
  await expect(dialog.locator('.confirm-title')).toHaveText('Delete Class');
  await dialog.locator('#confirm-ok-btn').click();
  await expect(page.locator(`.cm-class-item[data-cid="${CID_B}"]`)).toHaveCount(0);
  expect(await rpcCalls(page, 'delete_course')).toEqual([{ p_course_id: CID_B }]);
  await expect(page.locator('.cm-head-title')).toHaveText('Science 9');
});
