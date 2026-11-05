import { test, expect } from '@playwright/test';

/* The next step chooser (inputs plan, item 7): At a Glance's Next step
   row opens the three choices (CommentBank.nextStepChoices) and Let
   Generate Choose; a pick saves focusSectionId on the term rating. The
   Next Step row's Other Wording menu has the same choices under Which
   Skill, and its source line says Chosen by you. Demo Mode, Science 8,
   Report 2. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page, student = 'st1') {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
}
const choices = page =>
  page.evaluate(() => {
    const st = getStudents('sci8').find(s => s.id === 'st1');
    return CommentBank.nextStepChoices(CommentBank.facts('sci8', st, ReportBlocks.getTermId()));
  });
const focus = page =>
  page.evaluate(() => {
    const r = getStudentTermRating('sci8', 'st1', ReportBlocks.getTermId()) || {};
    return r.focusSectionId == null ? null : r.focusSectionId;
  });

test('At a Glance: the Next step chooser saves the teacher’s pick', async ({ page }) => {
  await open(page);
  const list = await choices(page);
  expect(list.length).toBeGreaterThan(1);
  const engine = list.find(c => c.engine);
  const other = list.find(c => !c.engine);
  const btn = page.locator('#tq-next-btn');
  await expect(btn).toHaveText(engine.name);
  await btn.click();
  const menu = page.locator('#tq-next-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.qn-menu-head')).toHaveText('Which Skill');
  const items = menu.locator('.qn-menu-item');
  await expect(items).toHaveCount(list.length + 1);
  await expect(items.last()).toContainText('Let Generate Choose');
  await expect(items.last()).toHaveAttribute('aria-checked', 'true');
  const eng = items.filter({ hasText: engine.name });
  await expect(eng).toContainText('Generate’s pick');
  await expect(eng).toContainText(engine.pieces + ' pieces');
  // The menu is not clipped by the card.
  const box = await items.last().boundingBox();
  expect(box && box.height).toBeGreaterThan(10);

  await items.filter({ hasText: other.name }).click();
  await expect(menu).toHaveCount(0);
  await expect(btn).toHaveText(other.name);
  await expect(btn).toBeFocused();
  expect(await focus(page)).toBe(other.id);

  // Keyboard: Enter opens on the pick, arrows move, Escape closes.
  await page.keyboard.press('Enter');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.qn-menu-item.on')).toBeFocused();
  await expect(menu.locator('.qn-menu-item.on')).toContainText(other.name);
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(btn).toBeFocused();
  expect(await focus(page)).toBe(other.id);

  // Space opens; Let Generate Choose clears the pick.
  await page.keyboard.press(' ');
  await expect(menu).toBeVisible();
  await page.keyboard.press('End');
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  expect(await focus(page)).toBe(null);
  await expect(btn).toHaveText(engine.name);
});

test('Next Step row: Which Skill in Other Wording, and Chosen by you', async ({ page }) => {
  await open(page);
  const list = await choices(page);
  const other = list.find(c => !c.engine);
  await page.locator('#tq-generate').click();
  const row = page.locator('#tq-sentences [data-row]', {
    has: page.locator('.qn-req-label', { hasText: /^Next Step$/ }),
  });
  await expect(row.first()).toBeVisible();
  await expect(row.first().locator('.qn-req-source')).not.toContainText('Chosen by you');
  await row.first().locator('[data-do="wording"]').click();
  const menu = page.locator('#tq-wording-menu');
  await expect(menu.locator('.qn-menu-head').first()).toHaveText('Which Skill');
  await expect(menu.locator('.qn-menu-head').nth(1)).toHaveText('Other ways to say this');
  await expect(menu.locator('.qn-skill-pick')).toHaveCount(list.length + 1);
  // Opened on the wording in use, not the skill.
  await expect(page.locator(':focus')).not.toHaveClass(/qn-skill-pick/);
  await menu.locator('.qn-skill-pick', { hasText: other.name }).click();
  await expect(menu).toHaveCount(0);
  expect(await focus(page)).toBe(other.id);
  await expect(page.locator('#tq-next-btn')).toHaveText(other.name);

  // A comment drafted with the pick names it, and the row says so.
  await page.locator('#tq-generate').click();
  await expect(row.first().locator('.qn-req-source')).toContainText(
    'Chosen by you · ' + other.name + ' · ' + other.pieces + ' pieces',
  );
});
