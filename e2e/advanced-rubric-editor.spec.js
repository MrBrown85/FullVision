/**
 * Advanced Rubrics in the rubric editor (Rubric Bank plan §5, PR 7): the
 * Standard | Advanced switch, checkboxes inside each level cell, Enter adding
 * the next one, "+ From Competency" putting I-can statements in as Proficient
 * checkboxes, and the switch back to Standard dropping the checkboxes after a
 * confirmation. A save lands in gb-rubrics-<cid> with rubric.style and
 * criterion.checks (level, label, displayOrder within the level).
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE, TEST_LEARNING_MAP } from './helpers.js';

const STATEMENTS = ['I can plan a fair test', 'I can record data with units'];

async function savedRubrics(page) {
  return page.evaluate(cid => JSON.parse(localStorage.getItem('gb-rubrics-' + cid) || '[]'), TEST_COURSE.id);
}

/* [level, displayOrder, label] per checkbox, Extending first. */
function checkRows(criterion) {
  return (criterion.checks || [])
    .map(k => [k.level, k.displayOrder, k.label])
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
}

async function openNewRubric(page) {
  await gotoApp(page, '/assignments');
  await page.locator('[data-action="toggleToolbarDropdown"]').click();
  await page.locator('[data-action="newRubricUI"]').click();
  const editor = page.locator('#rubric-modal');
  await expect(editor).toBeVisible();
  return editor;
}

test.describe('Advanced Rubric editor', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    // The fixture's competencies have no I-can statements; give them two.
    await page.addInitScript(
      ({ cid, map, statements }) => {
        const withStatements = JSON.parse(JSON.stringify(map), (key, value) =>
          key === 'i_can_statements' ? statements : value,
        );
        localStorage.setItem('gb-learningMaps-' + cid, JSON.stringify(withStatements));
      },
      { cid: TEST_COURSE.id, map: TEST_LEARNING_MAP, statements: STATEMENTS },
    );
  });

  test('saves checkboxes in the level cells, then drops them on the way back to Standard', async ({ page }) => {
    const editor = await openNewRubric(page);
    const style = editor.locator('.rubric-style-seg');
    await expect(style.getByRole('radio', { name: 'Standard' })).toHaveAttribute('aria-checked', 'true');
    await expect(editor.locator('.rubric-check-list')).toHaveCount(0);

    await style.getByRole('radio', { name: 'Advanced' }).click();
    await expect(style.getByRole('radio', { name: 'Advanced' })).toHaveAttribute('aria-checked', 'true');
    await expect(editor.locator('.rubric-check-list')).toHaveCount(4);
    await expect(editor.locator('#re-style-hint')).toBeVisible();

    await editor.locator('#re-name').fill('Lab Skills Rubric');
    // Proficient: the first box by the button, the second by Enter.
    await editor.locator('[data-action="addCritCheck"][data-level="3"]').click();
    const proficient = editor.locator('.rubric-check-input[data-level="3"]');
    await expect(proficient.first()).toBeFocused();
    await proficient.first().fill('Goggles on for the whole lab');
    await proficient.first().press('Enter');
    await expect(proficient).toHaveCount(2);
    await expect(proficient.nth(1)).toBeFocused();
    await proficient.nth(1).fill('Cleans the station');
    await proficient.nth(1).press('Enter');
    await expect(proficient).toHaveCount(3);
    // Enter on a blank label adds nothing more.
    await proficient.nth(2).press('Enter');
    await expect(proficient).toHaveCount(3);
    // Alt+↑ moves a box up within its level.
    await proficient.nth(1).press('Alt+ArrowUp');
    await expect(proficient.first()).toHaveValue('Cleans the station');
    // Extending gets one; a box can be removed.
    await editor.locator('[data-action="addCritCheck"][data-level="4"]').click();
    await editor.locator('.rubric-check-input[data-level="4"]').first().fill('Reminds others of safety steps');
    await editor.locator('[data-action="addCritCheck"][data-level="1"]').click();
    await editor.locator('.rubric-check-input[data-level="1"]').first().fill('Gone');
    await editor.locator('[data-action="removeCritCheck"][data-level="1"]').click();
    await expect(editor.locator('.rubric-check-input[data-level="1"]')).toHaveCount(0);

    await editor.locator('[data-action="saveRubricEdit"]').click();
    await expect(editor).toBeHidden();

    let rubrics = await savedRubrics(page);
    expect(rubrics).toHaveLength(1);
    expect(rubrics[0].style).toBe('advanced');
    // The blank third Proficient box is not saved.
    expect(checkRows(rubrics[0].criteria[0])).toEqual([
      [4, 0, 'Reminds others of safety steps'],
      [3, 0, 'Cleans the station'],
      [3, 1, 'Goggles on for the whole lab'],
    ]);

    // Reopen: the boxes come back; Standard asks first, then drops them.
    await page.locator('[data-action="toggleToolbarDropdown"]').click();
    await page.locator('[data-action="editRubricUI"][data-rid="' + rubrics[0].id + '"]').click();
    await expect(editor).toBeVisible();
    await expect(editor.locator('.rubric-check-input')).toHaveCount(3);
    await expect(editor.locator('.rubric-check-input[data-level="3"]').first()).toHaveValue('Cleans the station');
    await editor.locator('.rubric-style-seg').getByRole('radio', { name: 'Standard' }).click();
    const confirm = page.locator('.confirm-overlay');
    await expect(confirm).toContainText('Switch to a Standard Rubric?');
    await confirm.locator('#confirm-ok-btn').click();
    await expect(editor.locator('.rubric-check-list')).toHaveCount(0);
    await editor.locator('[data-action="saveRubricEdit"]').click();
    await expect(editor).toBeHidden();

    rubrics = await savedRubrics(page);
    expect(rubrics[0].style).toBe('standard');
    expect(rubrics[0].criteria[0].checks).toEqual([]);
  });

  test('a ticked checkbox is kept for the student and suggests the level', async ({ page }) => {
    // The scoring UI is PR 8; this ticks through the data layer it will use.
    // Seeded on every load: seedCourse empties the rubrics each time, but
    // leaves gb-rubric-checks-<cid> (the ticks) alone.
    await page.addInitScript(cid => {
      localStorage.setItem(
        'gb-rubrics-' + cid,
        JSON.stringify([
          {
            id: 'rub-adv',
            name: 'Lab Skills Rubric',
            style: 'advanced',
            criteria: [
              {
                id: 'crit-safety',
                name: 'Safety',
                tagIds: ['QAP'],
                levels: { 4: 'Leads', 3: 'Follows every step', 2: 'Needs reminders', 1: 'Needs many reminders' },
                checks: [
                  { id: 'k3a', level: 3, label: 'Goggles on', displayOrder: 0 },
                  { id: 'k3b', level: 3, label: 'Cleans the station', displayOrder: 1 },
                  { id: 'k4a', level: 4, label: 'Reminds others', displayOrder: 0 },
                ],
              },
            ],
          },
        ]),
      );
      localStorage.setItem(
        'gb-assessments-' + cid,
        JSON.stringify([
          {
            id: 'assess-adv',
            title: 'Density Lab',
            date: '2026-10-01',
            type: 'summative',
            tagIds: ['QAP'],
            rubricId: 'rub-adv',
            scoreMode: '',
            weight: 1,
            collaboration: 'individual',
            created: '2026-10-01T00:00:00.000Z',
          },
        ]),
      );
    }, TEST_COURSE.id);
    await gotoApp(page, '/assignments');

    const level = await page.evaluate(cid => {
      const crit = getRubricById(cid, 'rub-adv').criteria[0];
      const before = getRubricCheckIds(cid, 'stu-001', 'assess-adv');
      setRubricCheck(cid, 'stu-001', 'assess-adv', 'k3a', true);
      const after = setRubricCheck(cid, 'stu-001', 'assess-adv', 'k3b', true);
      return RubricChecks.levelAfterTick(crit, 0, before, after);
    }, TEST_COURSE.id);
    expect(level).toBe(3);

    // Kept across a reload, for that student and assessment only.
    await page.reload();
    await page.waitForSelector('#dock-mount nav');
    const kept = await page.evaluate(cid => {
      return {
        mine: getRubricCheckIds(cid, 'stu-001', 'assess-adv'),
        other: getRubricCheckIds(cid, 'stu-002', 'assess-adv'),
        style: rubricStyle(getRubricById(cid, 'rub-adv')),
      };
    }, TEST_COURSE.id);
    expect(kept).toEqual({ mine: ['k3a', 'k3b'], other: [], style: 'advanced' });

    // Unticking one drops the suggestion; a hand-picked level would stay.
    const untick = await page.evaluate(cid => {
      const crit = getRubricById(cid, 'rub-adv').criteria[0];
      const before = getRubricCheckIds(cid, 'stu-001', 'assess-adv');
      const after = setRubricCheck(cid, 'stu-001', 'assess-adv', 'k3b', false);
      return {
        fromBoxes: RubricChecks.levelAfterTick(crit, 3, before, after),
        byHand: RubricChecks.levelAfterTick(crit, 4, before, after),
      };
    }, TEST_COURSE.id);
    expect(untick).toEqual({ fromBoxes: 0, byHand: 4 });
  });

  test('"+ From Competency" puts each I-can statement in as a Proficient checkbox', async ({ page }) => {
    const editor = await openNewRubric(page);
    await editor.locator('.rubric-style-seg').getByRole('radio', { name: 'Advanced' }).click();
    await editor.locator('[data-action="criterionFromCompetency"]').click();
    const picker = page.locator('.crit-from-comp-dialog');
    await expect(picker).toBeVisible();
    await picker.locator('[data-pick-tag="PI"]').click();
    await picker.locator('[data-copy-ok]').click();
    await expect(picker).toBeHidden();

    const proficient = editor.locator('.rubric-check-input[data-level="3"]');
    await expect(proficient).toHaveCount(2);
    await expect(proficient.first()).toHaveValue(STATEMENTS[0]);
    await expect(proficient.nth(1)).toHaveValue(STATEMENTS[1]);
    await expect(editor.locator('.rubric-check-input[data-level="4"]')).toHaveCount(0);

    await editor.locator('#re-name').fill('Planning Rubric');
    await editor.locator('[data-action="saveRubricEdit"]').click();
    await expect(editor).toBeHidden();
    const rubrics = await savedRubrics(page);
    expect(rubrics[0].style).toBe('advanced');
    expect(rubrics[0].criteria[0].tagIds).toEqual(['PI']);
    expect(checkRows(rubrics[0].criteria[0])).toEqual([
      [3, 0, STATEMENTS[0]],
      [3, 1, STATEMENTS[1]],
    ]);
  });
});
