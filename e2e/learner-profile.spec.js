import { test, expect } from '@playwright/test';

/* The Learner Profile (docs/STUDENT-VOICE-PLAN.md, PR 8; canvas 9d) in
   Demo Mode, Science 8. Cece answered About Me, the November Reflection
   and its Goal Check-In (shared/seed-data.js); Liam answered nothing. */

async function openStudent(page, first) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  const sid = await page.evaluate(n => getStudents('sci8').find(s => s.firstName === n).id, first);
  await page.goto(page.url().replace(/#.*/, '#/student?id=' + sid + '&course=sci8&tab=profile'));
  await page.locator('.lp-layout').waitFor();
}

test("Cece's own words: ID card, private note, About Me, her goals and her reflection", async ({ page }) => {
  await openStudent(page, 'Cece');
  const card = page.locator('.id-card');
  await expect(card.locator('.id-say strong')).toHaveText('SEE');
  await expect(card.locator('.id-facts .stu-chip')).toHaveText(['English', 'Igbo']);
  await expect(card).toContainText('With a partner');
  await expect(page.locator('.id-private-text')).toHaveText(
    "My grandma is staying with us so it's loud at home some nights.",
  );

  const about = page.locator('#lp-about');
  await expect(about.locator('h3')).toHaveText(['As a Learner', 'Outside School']);
  await expect(about).toContainText('I ask a lot of questions');

  const goals = page.locator('#lp-goals');
  await expect(goals.locator('h3').first()).toHaveText('Science 8 Goal');
  await expect(goals.locator('.st').first()).toHaveText('Working On It');
  await expect(goals).toContainText('Personal Awareness & Responsibility');

  const refl = page.locator('#lp-refl');
  await expect(refl.locator('.sh-grid .qw-b')).toHaveText(['Curious', 'Soccer', 'Finish on time', 'Baking']);
  await expect(refl.locator('.stu-core-step.on')).toHaveText(['Growing', 'Confident']);

  // The old Learner Profile stays below.
  await expect(page.locator('#lp-dispositions .stu-profile-group h3')).toHaveText([
    'Learning Dispositions',
    'Relational and Identity',
  ]);
  await expect(page.locator('#lp-core .stu-core-table')).toBeVisible();

  // The jump links move down the page.
  await card.getByRole('link', { name: /Reflections/ }).click();
  await expect(page.locator('#lp-refl')).toBeInViewport();
});

test('a student with no answers gets plain empty states, not blanks', async ({ page }) => {
  await openStudent(page, 'Liam');
  await expect(page.locator('#lp-about')).toContainText('Liam hasn’t answered About Me yet.');
  await expect(page.locator('#lp-refl')).toContainText('No reflections from Liam yet.');
  await expect(page.locator('.id-private')).toHaveCount(0);
  await expect(page.locator('#stu-tab-profile .stu-tab-sub')).toHaveText('No answers yet');
});
