import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Points and Complete / Incomplete ledgers: one row per student with the
// score or mark, Missing | Excused | Late, and the Overall Comment field.
function assessment(id, title, extra) {
  return Object.assign(
    {
      id,
      title,
      date: '2026-03-21',
      type: 'summative',
      tagIds: ['QAP'],
      rubricId: '',
      scoreMode: '',
      maxPoints: 0,
      weight: 1,
      collaboration: 'individual',
      created: new Date('2026-03-21').toISOString(),
    },
    extra,
  );
}

async function open(page, list, aid) {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(({ list, cid }) => localStorage.setItem('gb-assessments-' + cid, JSON.stringify(list)), {
    list,
    cid: TEST_COURSE.id,
  });
  await gotoApp(page, '/assignments');
  const card = page.locator('#ac-' + aid);
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  return card;
}

test('the points ledger takes a score and a status', async ({ page }) => {
  const card = await open(page, [assessment('a-pts', 'Unit Quiz', { scoreMode: 'points', maxPoints: 10 })], 'a-pts');
  const row = card.locator('.ldg-row[data-status-student="stu-001"]');
  await expect(row.locator('.ldg-status .grader-status-btn')).toHaveText(['Missing', 'Excused', 'Late']);
  await expect(row.locator('.ldg-overall .rsg-overall-comment')).toHaveAttribute(
    'placeholder',
    'Add an overall comment for Alice',
  );

  const input = row.locator('.ldg-pts-input');
  await input.fill('7');
  await input.press('Tab');
  await expect(row.locator('.gb-pts-live-pct')).toHaveText('70%');
  await expect(card.locator('.ldg-stats')).toContainText('Median');

  await row.locator('.grader-status-btn[data-status="LATE"]').click();
  await expect(row.locator('.grader-status-btn[data-status="LATE"]')).toHaveAttribute('aria-pressed', 'true');
});

test('the points ledger Average counts Missing as 0, like the Class Average', async ({ page }) => {
  const card = await open(page, [assessment('a-avg', 'Unit Quiz', { scoreMode: 'points', maxPoints: 10 })], 'a-avg');
  const alice = card.locator('.ldg-row[data-status-student="stu-001"]');
  await alice.locator('.ldg-pts-input').fill('7');
  await alice.locator('.ldg-pts-input').press('Tab');
  await expect(card.locator('.ldg-tally')).toContainText('Average 70%');
  // Bob is Missing: 7 + 0 over 2 students, 35%; he isn't counted as Marked.
  await card.locator('.ldg-row[data-status-student="stu-002"] .grader-status-btn[data-status="NS"]').click();
  await expect(card.locator('.ldg-tally')).toContainText('Average 35%');
  await expect(card.locator('.ldg-tally')).toContainText('1 Marked');
  // Nov 3 sweep: Median and Lowest count the Missing 0 as the Average does.
  await expect(card.locator('.ldg-stats')).toContainText('Median 3.5 / 10');
  await expect(card.locator('.ldg-stats')).toContainText('Lowest 0 / 10');
  await expect(card.locator('.ldg-stats')).toContainText('Highest 7 / 10');
});

test('the Complete / Incomplete ledger marks and clears', async ({ page }) => {
  const card = await open(page, [assessment('a-cmp', 'Exit Slip', { scoreMode: 'complete' })], 'a-cmp');
  const row = card.locator('.ldg-row[data-status-student="stu-001"]');
  const complete = row.locator('.cmp-complete');
  await complete.click();
  await expect(row.locator('.cmp-complete')).toHaveClass(/active/);
  // Typing in the row's Overall Comment is not a c / i answer.
  await row.locator('.ldg-overall .rsg-overall-comment').pressSequentially('ci');
  await expect(row.locator('.cmp-complete')).toHaveClass(/active/);
  await expect(row.locator('.cmp-incomplete')).not.toHaveClass(/active/);
  await expect(card.locator('.ldg-tally')).toContainText('1 Complete');
  await row.locator('.cmp-complete').click();
  await expect(row.locator('.cmp-btn.active')).toHaveCount(0);
});
