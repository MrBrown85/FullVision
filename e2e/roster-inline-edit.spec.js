import { test, expect } from '@playwright/test';
import { mockAuth, TEST_LEARNING_MAP } from './helpers.js';

/* The Students tab roster is edited in place: every field is a box in its
   row, a box saves when it loses focus, Enter or ↓ moves down the column and
   ↑ up. Parent Email is the student's first guardian. Bulk Edit is gone. */

const CID = 'c1a55e00-0000-4000-8000-000000000002';
const ALICE = 'e0000000-0000-4000-8000-00000000001a';
const BOB = 'e0000000-0000-4000-8000-00000000001b';
const CHARLIE = 'e0000000-0000-4000-8000-00000000001c';

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
    ({ cid, students, learningMap }) => {
      if (localStorage.getItem('e2e-roster-seeded')) return;
      localStorage.setItem('e2e-roster-seeded', '1');
      const courses = { [cid]: { id: cid, name: 'Science 9', gradingSystem: 'proficiency', calcMethod: 'mostRecent' } };
      localStorage.setItem('gb-courses', JSON.stringify(courses));
      localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
      localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(learningMap));
      localStorage.setItem('gb-students-' + cid, JSON.stringify(students));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([]));
      localStorage.setItem('gb-scores-' + cid, JSON.stringify({}));
    },
    {
      cid: CID,
      students: [
        student(ALICE, 'Alice', 'Anderson'),
        student(BOB, 'Bob', 'Baker'),
        student(CHARLIE, 'Charlie', 'Chen'),
      ],
      learningMap: TEST_LEARNING_MAP,
    },
  );
}

async function openRoster(page) {
  await page.goto('/dashboard');
  await page.waitForSelector('#dock-mount nav', { timeout: 10_000 });
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Students/ }).click();
  await expect(page.locator('.cm-rs-row')).toHaveCount(3);
}

const box = (page, sid, col) => page.locator(`.cm-rs-row[data-sid="${sid}"] [data-col="${col}"]`);

function savedStudent(page, sid) {
  return page.evaluate(({ cid, sid }) => getStudents(cid).find(s => s.id === sid), { cid: CID, sid });
}

test.describe('Students tab roster', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedClass(page);
  });

  test('a field saves when it loses focus, and Enter and the arrows move down and up a column', async ({ page }) => {
    await openRoster(page);
    await expect(page.getByRole('button', { name: /Bulk Edit/ })).toHaveCount(0);

    await box(page, ALICE, 'first').fill('Alicia');
    await box(page, ALICE, 'first').press('Enter');
    await expect(box(page, BOB, 'first')).toBeFocused();
    expect((await savedStudent(page, ALICE)).firstName).toBe('Alicia');

    await box(page, BOB, 'first').press('ArrowDown');
    await expect(box(page, CHARLIE, 'first')).toBeFocused();
    await box(page, CHARLIE, 'first').press('ArrowUp');
    await expect(box(page, BOB, 'first')).toBeFocused();
  });

  test('a blank first name and a malformed email are refused', async ({ page }) => {
    await openRoster(page);
    await box(page, BOB, 'first').fill('');
    await box(page, BOB, 'first').press('Tab');
    await expect(box(page, BOB, 'first')).toHaveValue('Bob');
    expect((await savedStudent(page, BOB)).firstName).toBe('Bob');

    await box(page, BOB, 'email').fill('not-an-email');
    await box(page, BOB, 'email').press('Tab');
    await expect(box(page, BOB, 'email')).toHaveValue('');
    expect((await savedStudent(page, BOB)).email || '').toBe('');
  });

  test('ELL and designations save from the row', async ({ page }) => {
    await openRoster(page);
    await box(page, CHARLIE, 'ell').check();
    await expect.poll(async () => (await savedStudent(page, CHARLIE)).designations).toContain('ELL');

    await box(page, CHARLIE, 'desig').click();
    await page.locator('.cm-rs-picker [data-code="Q"]').click();
    await expect.poll(async () => (await savedStudent(page, CHARLIE)).designations).toContain('Q');
    await expect(page.locator(`.cm-rs-row[data-sid="${CHARLIE}"] .cm-rs-chip[data-code="Q"]`)).toBeVisible();
    await expect(page.locator('#cm-rs-summary')).toContainText('1 with designations');
  });

  test('a parent email is saved as the student guardian', async ({ page }) => {
    await openRoster(page);
    await box(page, ALICE, 'g0').fill('parent@example.com');
    await box(page, ALICE, 'g0').press('Tab');
    await expect
      .poll(() =>
        page.evaluate(() => (window.__e2eRpcLog || []).filter(c => c.name === 'upsert_guardian').map(c => c.params)),
      )
      .toContainEqual(
        expect.objectContaining({ p_email: 'parent@example.com', p_student_id: ALICE.replace(/^e/, 'f') }),
      );
  });
});
