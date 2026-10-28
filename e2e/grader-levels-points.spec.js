import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// The grade editor draws work without a rubric for one student: a card per
// competency with a level control and − | + stepper, a large points field,
// or Complete / Incomplete buttons that clear when clicked again.
function assessment(id, title, extra) {
  return Object.assign(
    {
      id,
      title,
      date: '2026-03-21',
      type: 'summative',
      tagIds: ['QAP', 'PI'],
      evidenceType: '',
      notes: '',
      coreCompetencyIds: [],
      rubricId: '',
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
    },
    extra,
  );
}
const LEVELS = assessment('assess-gl', 'Levels Lab');
const POINTS = assessment('assess-gp', 'Points Quiz', { scoreMode: 'points', maxPoints: 10 });
const COMPLETE = assessment('assess-gc', 'Exit Slip', { scoreMode: 'complete' });

async function openGrader(page, aid) {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(
    ({ list, cid }) => {
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify(list));
    },
    { list: [LEVELS, POINTS, COMPLETE], cid: TEST_COURSE.id },
  );
  await gotoApp(page, '/gradebook');
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="' + aid + '"]').click();
  return page.locator('#grader-overlay .grader-dialog');
}

test('level cards score, fine-tune and take keys', async ({ page }) => {
  const dialog = await openGrader(page, 'assess-gl');
  const card = dialog.locator('.grdl-card[data-tag="QAP"]');
  await expect(card.locator('.grdt-not-scored')).toBeVisible();

  await card.locator('.grdl-level[data-level="3"]').click();
  await expect(card.locator('.grdl-level.is-on')).toHaveText('Proficient');
  await card.locator('.grdl-stepper [data-mod="1"]').click();
  await expect(card.locator('.grdl-stepper [data-mod="1"]')).toHaveAttribute('aria-pressed', 'true');

  await card.focus();
  await page.keyboard.press('2');
  await expect(card.locator('.grdl-level.is-on')).toHaveText('Developing');
  await expect(dialog.locator('.grader-grade')).toContainText('Developing');

  // Feedback on the competency saves when the box loses focus.
  const note = card.locator('.grdt-note');
  await note.fill('Spots the trend in each graph.');
  await dialog.locator('.grader-student').click();
  await expect(note).toHaveClass(/has-text/);
  const saved = await page.evaluate(({ cid }) => getTagComment(cid, 'stu-001', 'assess-gl', 'QAP'), {
    cid: TEST_COURSE.id,
  });
  expect(saved).toBe('Spots the trend in each graph.');
});

test('points field saves on Enter and shows the percentage', async ({ page }) => {
  const dialog = await openGrader(page, 'assess-gp');
  const input = dialog.locator('.grdp-input');
  await input.fill('7');
  await input.press('Enter');
  await expect(dialog.locator('.grdp-pct')).toHaveText('70%');
  await expect(dialog.locator('.grader-grade')).toHaveText('7 of 10');
  const stored = await page.evaluate(({ cid }) => getPointsScore(cid, 'stu-001', 'assess-gp'), {
    cid: TEST_COURSE.id,
  });
  expect(stored).toBe(7);
});

test('complete and incomplete toggle and clear', async ({ page }) => {
  const dialog = await openGrader(page, 'assess-gc');
  const incomplete = dialog.locator('.grdc-btn[data-mark="incomplete"]');
  await dialog.locator('.grdc-btn[data-mark="complete"]').click();
  await expect(dialog.locator('.grader-grade')).toHaveText('Complete');
  await incomplete.click();
  await expect(incomplete).toHaveAttribute('aria-pressed', 'true');
  await expect(dialog.locator('.grader-grade')).toHaveText('Incomplete');
  await incomplete.click();
  await expect(dialog.locator('.grdc-btn.is-on')).toHaveCount(0);
  await expect(dialog.locator('.grader-grade')).toHaveText('Not Graded');
});
