import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Points and Complete / Incomplete ledgers: one row per student with the
// score or mark, Late | Excused | Missing, and a Comment pill.
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
  await expect(row.locator('.ldg-status .grader-status-btn')).toHaveText(['Late', 'Excused', 'Missing']);
  await expect(row.locator('.ldg-note')).toContainText('Comment');

  const input = row.locator('.ldg-pts-input');
  await input.fill('7');
  await input.press('Tab');
  await expect(row.locator('.gb-pts-live-pct')).toHaveText('70%');
  await expect(card.locator('.ldg-stats')).toContainText('Median');

  await row.locator('.grader-status-btn[data-status="LATE"]').click();
  await expect(row.locator('.grader-status-btn[data-status="LATE"]')).toHaveAttribute('aria-pressed', 'true');
});

test('the Complete / Incomplete ledger marks and clears', async ({ page }) => {
  const card = await open(page, [assessment('a-cmp', 'Exit Slip', { scoreMode: 'complete' })], 'a-cmp');
  const row = card.locator('.ldg-row[data-status-student="stu-001"]');
  const complete = row.locator('.cmp-complete');
  await complete.click();
  await expect(row.locator('.cmp-complete')).toHaveClass(/active/);
  await expect(card.locator('.ldg-tally')).toContainText('1 Complete');
  await row.locator('.cmp-complete').click();
  await expect(row.locator('.cmp-btn.active')).toHaveCount(0);
});
