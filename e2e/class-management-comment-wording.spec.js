import { test, expect } from '@playwright/test';

/* Class Management's competency card (inputs plan, item 9): a Comment
   Wording panel beside Levels, showing the words a generated comment says
   the skill in, the teacher's own else the bank's, with Write Your Own.
   Demo Mode, Science 8, on Data Patterns (PA4) from the curriculum bank. */
test.use({ viewport: { width: 1440, height: 1000 } });

async function openCard(page, { reload } = {}) {
  // A fresh page load, as a reload of the dashboard.
  if (reload) await page.goto('/dashboard');
  else await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => CompetencyWording.loadBank());
  await page.locator('button', { hasText: 'Class Management' }).first().click();
  await page
    .locator('button', { hasText: /^Competencies/ })
    .first()
    .click();
  const card = page.locator('.cm-std-card', { has: page.locator('.cm-std-label', { hasText: 'Data Patterns' }) });
  await card.locator('.cm-std-header').click();
  return card;
}

// The bank's first phrasing at Proficient, and its first home prompt, as the panel says them.
async function bankWording(page) {
  return page.evaluate(() => {
    const e = CommentBank.bankEntry(getTagById('sci8', 'PA4').bank_id);
    return { area: e.area, proficient: e.forms.at.Proficient[0], home: e.home[0], step: e.steps.Developing };
  });
}

test('Comment Wording shows the bank wording; Write Your Own saves a line, and emptying it goes back', async ({
  page,
}) => {
  let card = await openCard(page);
  const bank = await bankWording(page);
  const panel = card.locator('.cm-std-comment');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.cm-std-section-label')).toHaveText('Comment Wording');
  // Beside Levels on a wide screen.
  const [lv, cw] = await Promise.all([card.locator('.cm-std-levels').boundingBox(), panel.boundingBox()]);
  expect(cw.x).toBeGreaterThan(lv.x + lv.width - 1);

  await expect(panel.locator('.cm-cw-row[data-kind="area"]')).toContainText(bank.area);
  const prof = panel.locator('.cm-cw-row[data-kind="at"][data-level="3"]');
  await expect(prof).toContainText('Proficient');
  await expect(prof).toContainText(bank.proficient);
  await expect(panel.locator('.cm-cw-row[data-kind="next"][data-level="2"]')).toContainText(bank.step);
  await expect(panel.locator('.cm-cw-row[data-kind="next"]')).toHaveCount(4);
  // Home prompts say the student slots as "them".
  const home = panel.locator('.cm-cw-row[data-kind="home"]');
  await expect(home).toHaveCount(2);
  await expect(home.first()).not.toContainText('{');
  await expect(home.first()).not.toContainText('[');
  if (/\{him\}/.test(bank.home)) await expect(home.first()).toContainText('them');
  await expect(panel.locator('.cm-cw-own')).toHaveCount(0);

  await panel.locator('[data-action="cmCommentEdit"]').click();
  const field = panel.locator('.cm-cw-input[data-kind="at"][data-level="3"]');
  await expect(field).toHaveValue(bank.proficient);
  await field.fill('reads a trend from a table and names the outlier');
  await panel.locator('[data-action="cmCommentSave"]').click();
  await expect(prof).toContainText('reads a trend from a table and names the outlier');
  await expect(prof.locator('.cm-cw-own')).toHaveText('Your wording');
  await expect(panel.locator('.cm-cw-own')).toHaveCount(1);
  // Only the changed string was saved.
  const own = await page.evaluate(() => CompetencyWording.commentWording(getTagById('sci8', 'PA4')));
  expect(own).toEqual({
    area: '',
    at: { Proficient: 'reads a trend from a table and names the outlier' },
    next: {},
    home: [],
  });

  // It survives a reload.
  card = await openCard(page, { reload: true });
  const prof2 = card.locator('.cm-std-comment .cm-cw-row[data-kind="at"][data-level="3"]');
  await expect(prof2).toContainText('reads a trend from a table and names the outlier');
  await expect(prof2.locator('.cm-cw-own')).toHaveText('Your wording');

  // Emptying it goes back to the bank's.
  const panel2 = card.locator('.cm-std-comment');
  await panel2.locator('[data-action="cmCommentEdit"]').click();
  await panel2.locator('.cm-cw-input[data-kind="at"][data-level="3"]').fill('');
  await panel2.locator('[data-action="cmCommentSave"]').click();
  await expect(prof2).toContainText(bank.proficient);
  await expect(panel2.locator('.cm-cw-own')).toHaveCount(0);
  const after = await page.evaluate(() => CompetencyWording.commentWording(getTagById('sci8', 'PA4')).at);
  expect(after).toEqual({});
});

test('a line put back to the bank wording is not saved; Cancel saves nothing', async ({ page }) => {
  const card = await openCard(page);
  const bank = await bankWording(page);
  const panel = card.locator('.cm-std-comment');
  await panel.locator('[data-action="cmCommentEdit"]').click();
  await panel.locator('.cm-cw-input[data-kind="area"]').fill('reading graphs');
  await panel.locator('[data-action="cmCommentCancel"]').click();
  await expect(panel.locator('.cm-cw-row[data-kind="area"]')).toContainText(bank.area);

  await panel.locator('[data-action="cmCommentEdit"]').click();
  const f = panel.locator('.cm-cw-input[data-kind="at"][data-level="3"]');
  await f.fill('something else');
  await f.fill(bank.proficient);
  await panel.locator('[data-action="cmCommentSave"]').click();
  await expect(panel.locator('.cm-cw-own')).toHaveCount(0);
  const own = await page.evaluate(() => CompetencyWording.commentWording(getTagById('sci8', 'PA4')));
  expect(own.at).toEqual({});
  expect(own.area).toBe('');
});

test('the panels stack when the card is narrow', async ({ page }) => {
  const card = await openCard(page);
  // Narrower than two panels side by side.
  await card.locator('.cm-std-wording-pair').evaluate(el => (el.style.width = '600px'));
  const [lv, cw] = await Promise.all([
    card.locator('.cm-std-levels').boundingBox(),
    card.locator('.cm-std-comment').boundingBox(),
  ]);
  expect(cw.y).toBeGreaterThan(lv.y + lv.height - 1);
});
