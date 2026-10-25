import { test, expect } from '@playwright/test';

/* The Questionnaires tab in Class Management (docs/STUDENT-VOICE-PLAN.md,
   PR 5). Demo Mode, Science 8: turning on About Me shows who has answered,
   an edited question survives a reload, and Print QR Slips builds one slip
   per student, each with its own QR code. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher\/app\.html/);
}

async function openQuestionnaires(page) {
  await page.locator('[data-action="openClassManager"]').first().click();
  await page.getByRole('tab', { name: /Questionnaires/ }).click();
}

test('About Me turns on, saves an edited question, and prints a slip per student', async ({ page }) => {
  await enterDemo(page);
  await openQuestionnaires(page);
  const card = page.locator('[data-card="about-me"]');
  await expect(card.locator('.sq-name')).toHaveText('About Me');
  await card.getByRole('radio', { name: 'On' }).click();
  await expect(card.locator('.sq-facts')).toContainText('Answered0 of 27');
  await expect(page.getByRole('tab', { name: /Questionnaires/ })).toContainText('1');

  await card.getByRole('button', { name: 'Show Questions' }).click();
  const first = card.getByLabel('Question 1');
  await first.fill('What name do you go by?');
  await first.blur();
  await page.reload();
  await openQuestionnaires(page);
  await page.locator('[data-card="about-me"]').getByRole('button', { name: 'Show Questions' }).click();
  await expect(page.locator('[data-card="about-me"]').getByLabel('Question 1')).toHaveValue('What name do you go by?');

  await page.evaluate(() => {
    window.print = () => {
      window.__printedSlips = document.querySelectorAll('#qr-slips-root .qs-slip').length;
      window.__printedQrs = document.querySelectorAll('#qr-slips-root .qs-qr svg').length;
    };
  });
  await page.locator('[data-card="about-me"]').getByRole('button', { name: 'Print QR Slips' }).click();
  await expect.poll(() => page.evaluate(() => window.__printedSlips)).toBe(27);
  expect(await page.evaluate(() => window.__printedQrs)).toBe(27);
});
