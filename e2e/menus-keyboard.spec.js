import { test, expect } from '@playwright/test';

/* Keyboard in the account menu and Class Management's switches. Demo Mode. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

test('Escape closes the account menu and puts the focus on its button', async ({ page }) => {
  await enterDemo(page);
  const btn = page.locator('.tb-user-btn');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.tb-user-menu')).not.toHaveClass(/open/);
  await expect(btn).toBeFocused();
});

test('A Class Management switch keeps the focus after Space, through its question', async ({ page }) => {
  await enterDemo(page);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Grading/ }).click();
  const sw = () => page.locator('#cm-folders-count');
  const before = await sw().isChecked();
  await sw().focus();
  await page.keyboard.press('Space');
  // Folders Count as One moves grades, so it asks first.
  await expect(page.locator('#confirm-cancel-btn')).toBeFocused();
  await page.keyboard.press('Enter'); // Cancel
  await expect(sw()).toBeFocused();
  await expect(sw()).toBeChecked({ checked: before });
  await page.keyboard.press('Space');
  await page.locator('#confirm-ok-btn').click();
  await expect(sw()).toBeChecked({ checked: !before });
  await expect(sw()).toBeFocused();
});

test('A Class Management menu keeps the focus after a change with no question', async ({ page }) => {
  await enterDemo(page);
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /^Grading/ }).click();
  const sel = page.locator('#cm-recent-limit');
  await sel.focus();
  const values = await sel.locator('option').evaluateAll(o => o.map(x => x.value));
  const now = await sel.inputValue();
  await sel.selectOption(values.find(v => v !== now));
  const confirm = page.locator('#confirm-ok-btn');
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(page.locator('#cm-recent-limit')).toBeFocused();
});
