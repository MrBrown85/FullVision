import { test, expect } from '@playwright/test';

/* Class Management's competency card (Nov 2 mockup, batch 2): a read-only
   Levels section with each descriptor and next step, and Write Your Own,
   which saves the teacher's wording to the descriptor bank printed rubrics
   read. Demo Mode, Science 8, Identify Patterns given a bank id. */
test.use({ viewport: { width: 1440, height: 1000 } });

async function open(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => {
    getTagById('sci8', 'IP').bank_id = 'bc.sci8.cc.14';
    return RubricPrint.loadBankLevels();
  });
  await page.locator('button', { hasText: 'Class Management' }).first().click();
  await page
    .locator('button', { hasText: /^Competencies/ })
    .first()
    .click();
  const card = page.locator('.cm-std-card', { has: page.locator('.cm-std-label', { hasText: 'Identify Patterns' }) });
  await card.locator('.cm-std-header').click();
  return card;
}

test('Levels shows each descriptor and next step; Write Your Own saves to the descriptor bank', async ({ page }) => {
  const card = await open(page);
  const rows = card.locator('.cm-level-row');
  await expect(rows).toHaveCount(4);
  await expect(rows.nth(1)).toContainText('Developing');
  await expect(rows.nth(1)).toContainText('Finds patterns and connections in data with growing consistency.');
  await expect(rows.nth(1)).toContainText('Next step:');
  await expect(rows.nth(3)).not.toContainText('Next step:');

  await card.locator('[data-action="cmLevelsEdit"]').click();
  const dev = card.locator('.cm-levels-input[data-level="2"]');
  await expect(dev).toHaveValue('Finds patterns and connections in data with growing consistency.');
  await dev.fill('Finds a trend in one data table');
  await card.locator('[data-action="cmLevelsSave"]').click();
  await expect(card.locator('.cm-level-row').nth(1)).toContainText('Finds a trend in one data table.');
  // Printed rubrics read the same wording; untouched levels saved nothing.
  const saved = await page.evaluate(() => {
    const tag = getTagById('sci8', 'IP');
    return {
      print: RubricPrint.levelWording(tag, 2).text,
      own: getCompetencyDescriptor(RubricDraft.competencyKey(tag)),
    };
  });
  expect(saved.print).toBe('Finds a trend in one data table');
  expect(Object.keys(saved.own)).toEqual(['2']);

  // Emptying the field goes back to the curriculum wording.
  await card.locator('[data-action="cmLevelsEdit"]').click();
  await card.locator('.cm-levels-input[data-level="2"]').fill('');
  await card.locator('[data-action="cmLevelsSave"]').click();
  await expect(card.locator('.cm-level-row').nth(1)).toContainText('with growing consistency');
});

test('typed wording survives a redraw of the card from another field', async ({ page }) => {
  const card = await open(page);
  await card.locator('[data-action="cmLevelsEdit"]').click();
  await card.locator('.cm-levels-input[data-level="3"]').fill('Names the trend and the outlier');
  // The Code field's blur saves and redraws the manager.
  const code = card.locator('.cm-std-code-input');
  await code.fill('IPX');
  await code.blur();
  await expect(card.locator('.cm-levels-input[data-level="3"]')).toHaveValue('Names the trend and the outlier');
  await expect(card.locator('.cm-levels-input[data-level="2"]')).toHaveValue(
    'Finds patterns and connections in data with growing consistency.',
  );
});

test('a competency with no bank wording shows the general wording as the printed rubric has it', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The first competency, taken off the bank, with no wording of the teacher's own.
  const label = await page.evaluate(() => {
    const sec = getSections('sci8')[0];
    const tag = sec.tags[0];
    delete tag.bank_id;
    localStorage.removeItem('gb-competency-descriptors');
    _competencyDescriptors = null;
    return tag.label;
  });
  await page.locator('button', { hasText: 'Class Management' }).first().click();
  await page
    .locator('button', { hasText: /^Competencies/ })
    .first()
    .click();
  const card = page.locator('.cm-std-card', { has: page.locator('.cm-std-label', { hasText: label }) }).first();
  await card.locator('.cm-std-header').click();
  const general = await page.evaluate(() => RubricPrint.GENERAL_LEVELS);
  const rows = card.locator('.cm-level-desc');
  await expect(rows.nth(0)).toContainText(general[1]);
  await expect(rows.nth(3)).toContainText(general[4]);
});
