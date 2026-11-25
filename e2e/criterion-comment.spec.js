import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

const RUBRIC = {
  id: 'rubric-cc',
  name: 'Lab Report Rubric',
  criteria: [
    { id: 'crit-hyp', name: 'Hypothesis', tagIds: ['QAP'] },
    { id: 'crit-data', name: 'Data Collection', tagIds: ['PI'] },
  ],
};

const ASSESSMENT = {
  id: 'assess-cc',
  title: 'Rubric Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  evidenceType: '',
  notes: '',
  coreCompetencyIds: [],
  rubricId: 'rubric-cc',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  dueDate: '',
  collaboration: 'individual',
  moduleId: '',
  pairs: [],
  groups: [],
  excludedStudents: [],
  created: new Date('2026-03-21').toISOString(),
};

async function openGrid(page, assessment) {
  await page.addInitScript(
    ({ rubric, assessment, cid }) => {
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
    },
    { rubric: RUBRIC, assessment: assessment || ASSESSMENT, cid: TEST_COURSE.id },
  );
  await gotoApp(page, '/assignments');
  await page.locator('text=Rubric Lab Report').first().click();
  await expect(page.locator('.rsg-crit-comment').first()).toBeVisible();
}

function commentButton(page, sid, critId) {
  return page.locator('.rsg-crit-comment[data-sid="' + sid + '"][data-critid="' + critId + '"]');
}
function row(page, sid, critId) {
  return page.locator('.rsg-criterion-row[data-student="' + sid + '"][data-criterion="' + critId + '"]');
}
const field = page => page.locator('#crit-comment-input');

/* The comment is typed in place under the criterion's levels (Nov 24 2026;
   it was a box over the page). */
test.describe('Criterion comment, typed in place', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
  });

  test('opens in the row, named for the student, with a count; no dialog', async ({ page }) => {
    await openGrid(page);
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const box = row(page, 'stu-001', 'crit-hyp').getByLabel('Comment on Hypothesis for Alice');
    await expect(box).toBeFocused();
    expect(await box.evaluate(el => el.tagName)).toBe('TEXTAREA');
    await expect(page.locator('#crit-comment-count')).toHaveText('0 / 500');

    await box.fill('x'.repeat(150));
    await expect(page.locator('#crit-comment-count')).toHaveClass(/is-long/);
  });

  test('Shift+Enter adds a line; Enter saves and moves to the next criterion, then the overall comment', async ({
    page,
  }) => {
    await openGrid(page);
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    await field(page).pressSequentially('First line');
    await field(page).press('Shift+Enter');
    await field(page).pressSequentially('Second line');
    await expect(field(page)).toHaveValue('First line\nSecond line');
    await field(page).press('Enter');
    await expect(commentButton(page, 'stu-001', 'crit-hyp')).toHaveClass(/has-comment/);
    await expect(row(page, 'stu-001', 'crit-hyp').locator('.rsg-crit-note')).toHaveText('First line\nSecond line');
    await expect(row(page, 'stu-001', 'crit-data').locator('#crit-comment-input')).toBeFocused();

    await field(page).fill('Tidy table.');
    await field(page).press('Tab');
    await expect(commentButton(page, 'stu-001', 'crit-data')).toHaveClass(/has-comment/);
    await expect(field(page)).toHaveCount(0);
    const overall = page.locator('.rsg-overall-comment[data-sid="stu-001"]');
    await expect(overall).toBeFocused();
    // Tab from there goes on to the next student's first criterion.
    await overall.press('Tab');
    await expect(row(page, 'stu-002', 'crit-hyp').locator('#crit-comment-input')).toBeFocused();
    await field(page).press('Shift+Tab');
    await expect(overall).toBeFocused();
  });

  test('saves as you type; a click elsewhere puts it away, a click on the comment opens it again', async ({ page }) => {
    await openGrid(page);
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    await field(page).fill('Good hypothesis.');
    await expect(commentButton(page, 'stu-001', 'crit-hyp')).toHaveClass(/has-comment/);
    await page.locator('.rsg-overall-comment[data-sid="stu-002"]').click();
    await expect(field(page)).toHaveCount(0);
    const note = row(page, 'stu-001', 'crit-hyp').locator('.rsg-crit-note');
    await expect(note).toHaveText('Good hypothesis.');
    await note.click();
    await expect(field(page)).toHaveValue('Good hypothesis.');
    await expect(field(page)).toBeFocused();
  });

  test('keys do not reach the grid while typing; emptying it removes the comment; Escape puts it away', async ({
    page,
  }) => {
    await openGrid(page);
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    await field(page).press('3');
    await expect(page.locator('.rsg-level.active')).toHaveCount(0);
    await expect(field(page)).toHaveValue('3');
    await field(page).press('Escape');
    await expect(field(page)).toHaveCount(0);
    await expect(commentButton(page, 'stu-001', 'crit-hyp')).toHaveClass(/has-comment/);

    await commentButton(page, 'stu-001', 'crit-hyp').click();
    await field(page).fill('');
    await field(page).press('Escape');
    await expect(commentButton(page, 'stu-001', 'crit-hyp')).not.toHaveClass(/has-comment/);
    await expect(row(page, 'stu-001', 'crit-hyp').locator('.rsg-crit-note')).toHaveCount(0);
  });

  test('Same As offers a comment already written on the criterion', async ({ page }) => {
    await openGrid(page);
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    await field(page).fill('Clear question.');
    await field(page).press('Escape');
    await commentButton(page, 'stu-002', 'crit-hyp').click();
    const chip = page.locator('.rsg-crit-reuse-chip');
    await expect(chip).toHaveText('Alice: Clear question.');
    await chip.click();
    await expect(field(page)).toHaveValue('Clear question.');
    await expect(page.locator('.rsg-crit-reuse')).toBeHidden();
    await expect(commentButton(page, 'stu-002', 'crit-hyp')).toHaveClass(/has-comment/);
  });

  test('on group work the field is named for the group and the comment is every member’s', async ({ page }) => {
    await openGrid(page, { ...ASSESSMENT, collaboration: 'group', groups: [['stu-001', 'stu-002']] });
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    await expect(field(page)).toHaveAttribute('aria-label', 'Comment on Hypothesis for Group 1');
    await field(page).fill('Strong question.');
    await field(page).press('Escape');
    const notes = await page.evaluate(
      ({ cid }) =>
        ['stu-001', 'stu-002'].map(sid =>
          (getScores(cid)[sid] || [])
            .filter(e => e.assessmentId === 'assess-cc' && e.critNote)
            .map(e => e.critNote)
            .join('|'),
        ),
      { cid: TEST_COURSE.id },
    );
    expect(notes).toEqual(['Strong question.', 'Strong question.']);
  });
});

test.describe('Line for One Student', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
  });

  test('a line for one member is theirs alone, under the group’s comment', async ({ page }) => {
    await openGrid(page, { ...ASSESSMENT, collaboration: 'group', groups: [['stu-001', 'stu-002']] });
    await commentButton(page, 'stu-001', 'crit-hyp').click();
    await field(page).fill('Strong question.');
    const each = page.locator('.rsg-crit-each');
    await expect(each.getByRole('button')).toHaveText(['Alice', 'Bob']);
    await each.getByRole('button', { name: 'Bob' }).click();
    const own = page.locator('#crit-own-stu-002');
    await expect(own).toBeFocused();
    await own.fill('Bob, your sketch made it clear.');
    // Tab walks back to the group's field with Shift+Tab, Escape puts both away.
    await own.press('Shift+Tab');
    await expect(field(page)).toBeFocused();
    await field(page).press('Escape');

    const notes = row(page, 'stu-001', 'crit-hyp');
    await expect(notes.locator('.rsg-crit-note')).toHaveText('Strong question.');
    await expect(notes.locator('.rsg-crit-own-note')).toHaveText('Bob Only: Bob, your sketch made it clear.');
    const lines = await page.evaluate(
      ({ cid }) =>
        ['stu-001', 'stu-002'].map(sid =>
          (getScores(cid)[sid] || [])
            .filter(e => e.assessmentId === 'assess-cc' && e.tagId === 'crit-hyp')
            .map(e => [e.critNote || '', e.critOwn || ''].join('|'))
            .join(','),
        ),
      { cid: TEST_COURSE.id },
    );
    expect(lines).toEqual(['Strong question.|', 'Strong question.|Bob, your sketch made it clear.']);

    // A click on the line opens it again at Bob's field.
    await notes.locator('.rsg-crit-own-note').click();
    await expect(page.locator('#crit-own-stu-002')).toBeFocused();
  });
});
