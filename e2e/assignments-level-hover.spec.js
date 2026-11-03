import { test, expect } from '@playwright/test';

/* The class grid's competency levels (Nov 2 mockup): hovering or focusing a
   level fills the descriptor bar with its three lines, and nothing on the
   page moves. Demo Mode, Science 8's Immune System Quick Check: Drawing
   Conclusions (PA5) has its curriculum bank id, and Sharing Findings
   (CM1) has its bank id taken away to show the general wording. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    // A competency without a bank id, for the general wording.
    getTagById('sci8', 'CM1').bank_id = null;
    window.Router.navigate('/assignments');
  });
  const card = page.locator('#ac-sci8a2');
  await card.waitFor();
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  return card;
}

test('hovering a competency level shows its three lines, with nothing moving', async ({ page }) => {
  const card = await open(page);
  const bar = page.locator('#rsg-descriptor-bar');
  const level = card.locator('.rsg-criterion-row[data-student="st1"][data-tag="PA5"] .rsg-level.l2');
  await level.scrollIntoViewIfNeeded();
  const row = card.locator('.rsg-criterion-row[data-student="st1"][data-tag="PA5"]');
  const before = { level: await level.boundingBox(), row: await row.boundingBox() };

  await level.hover();
  await expect(bar).toBeVisible();
  await expect(bar.locator('.rsg-descriptor-label')).toHaveText('Drawing Conclusions');
  // The bank's wording arrives after its first load.
  await expect(bar).toContainText('Developing: Draws conclusions using science concepts with growing consistency.');
  await expect(bar).toContainText('Proficient means: I can');
  await expect(bar).toContainText('Next step:');
  expect(await level.boundingBox()).toEqual(before.level);
  expect(await row.boundingBox()).toEqual(before.row);

  // A competency without a bank id: its I Can statements and the BC general wording, no next step.
  await card.locator('.rsg-criterion-row[data-student="st1"][data-tag="CM1"] .rsg-level.l3').hover();
  await expect(bar.locator('.rsg-descriptor-label')).toHaveText('Sharing Findings');
  await expect(bar).toContainText('Proficient: Demonstrates');
  await expect(bar).not.toContainText('Next step:');

  await page.mouse.move(5, 450);
  await expect(bar).toBeHidden();
});

test('a level reached with Tab shows its lines too', async ({ page }) => {
  const card = await open(page);
  const level = card.locator('.rsg-criterion-row[data-student="st1"][data-tag="PA5"] .rsg-level.l4');
  await level.focus();
  const bar = page.locator('#rsg-descriptor-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Extending:');
  await expect(bar).not.toContainText('Next step:');
  await page.keyboard.press('Shift+Tab');
  await expect(bar).toContainText('Proficient:');
});

test('a rubric card opened after scoring a competency shows its own prompt', async ({ page }) => {
  const card = await open(page);
  const level = card.locator('.rsg-criterion-row[data-student="st1"][data-tag="PA5"] .rsg-level.l2');
  await level.scrollIntoViewIfNeeded();
  await level.hover();
  await level.click();
  const rubric = page.locator('#ac-sci8a1');
  await rubric.scrollIntoViewIfNeeded();
  if (!(await rubric.evaluate(el => el.classList.contains('open')))) await rubric.locator('.assess-title').click();
  const bar = page.locator('#rsg-descriptor-bar');
  // Idle, the bar is out of sight: the card's hint is the prompt.
  await expect(rubric.locator('.rsg-header-hint')).toHaveText('Hover a level to see its wording');
  await expect(bar).toBeHidden();
  await expect(bar).not.toContainText('Proficient means:');
});
