/**
 * Observation follow-ups (docs/DECISIONS.md, "Observation follow-ups") in
 * Demo Mode: the dashboard's open concerns, the card that opens to its
 * timeline, + Follow Up with its four choices, a Resolved follow-up closing
 * the concern, the edit window's list and its delete question, and the same
 * on the phone. Demo Mode's sample class has one concern with two
 * follow-ups (Ethan Dubois, "Needed a few reminders...").
 */
import { test, expect } from '@playwright/test';

const SEEDED = 'qo_seed_st6_0';

async function enterDemo(page, phone) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(phone ? /teacher-mobile\// : /\/dashboard/);
}

const openConcerns = page => page.evaluate(() => getOpenConcerns(getActiveCourse()).length);

test.describe('Observation follow-ups on a computer', () => {
  test('open concerns on the dashboard lead to the card, which opens to its follow-ups', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterDemo(page);
    await page.goto('/dashboard?course=sci8');
    const flag = page.locator('#dash-obs-card .dash-ob2-open-sum');
    await expect(flag).toBeVisible();
    const n = await openConcerns(page);
    expect(n).toBeGreaterThan(0);
    await expect(flag).toHaveText(n + ' open concern' + (n === 1 ? '' : 's'));
    await flag.click();
    const item = page.locator('.dash-ob2-open-item[data-href*="ob=' + SEEDED + '"]');
    await expect(item).toContainText('Ethan Dubois');
    await expect(item).toContainText('Still Happening');
    await item.click();
    await page.waitForURL(/\/observations\?.*ob=qo_seed_st6_0/);

    const card = page.locator('.obs-card[data-obid="' + SEEDED + '"]');
    await expect(card).toBeInViewport();
    const toggle = card.locator('.obs-fu-toggle');
    await expect(toggle).toHaveText(/^2 follow-ups · last /);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(card.locator('.obs-fu-item')).toHaveCount(2);
    await expect(card.locator('.obs-fu-kind')).toHaveText(['Called Home', 'Still Happening']);
    // Shut and open again in place; the strip never opens the edit window.
    await toggle.click();
    await expect(card.locator('.obs-fu-list')).toHaveCount(0);
    await card.locator('.obs-fu-toggle').click();
    await expect(card.locator('.obs-fu-item')).toHaveCount(2);
    await expect(page.locator('#obs-focus-backdrop')).toHaveCount(0);
    // Follow-ups are never cards of their own.
    await expect(page.locator('.obs-card-text', { hasText: 'Spoke with his mom' })).toHaveCount(0);
  });

  test('+ Follow Up with Resolved closes the concern; the edit window lists them and asks before a delete', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await enterDemo(page);
    await page.goto('/observations?course=sci8&student=st6&ob=' + SEEDED);
    const card = page.locator('.obs-card[data-obid="' + SEEDED + '"]');
    await expect(card).toBeVisible();
    const before = await openConcerns(page);
    await card.getByRole('button', { name: '+ Follow Up' }).click();

    const dialog = page.getByRole('dialog', { name: 'Follow Up' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.obs-fu-chip')).toHaveText([
      'Called Home',
      'Spoke With Student',
      'Still Happening',
      'Resolved',
    ]);
    await expect(dialog.getByRole('button', { name: 'Save' })).toBeDisabled();
    await dialog.getByRole('button', { name: 'Resolved' }).click();
    await expect(dialog.getByRole('button', { name: 'Resolved' })).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('Met with Ethan and his mom; on task all week.');
    await page.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);

    await expect(card.locator('.obs-fu-toggle')).toHaveText(/^3 follow-ups · last /);
    await expect(card.locator('.obs-fu-closed')).toHaveText('Resolved');
    await expect(card.locator('.obs-fu-item').last()).toContainText('Met with Ethan and his mom');
    expect(await openConcerns(page)).toBe(before - 1);

    // Kept on the device.
    await page.reload();
    await expect(card.locator('.obs-fu-toggle')).toHaveText(/^3 follow-ups/);

    // The edit window lists them; a follow-up is edited on its own.
    await card.locator('.obs-card-text').click();
    const focus = page.locator('#obs-focus-card');
    await expect(focus.locator('.obs-fu-item')).toHaveCount(3);
    await focus.locator('.obs-fu-entry').first().click();
    const edit = page.getByRole('dialog', { name: 'Edit Follow-Up' });
    await expect(edit.getByRole('button', { name: 'Called Home' })).toHaveAttribute('aria-pressed', 'true');
    await edit.locator('textarea').fill('Spoke with his mom on the phone.');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(focus.locator('.obs-fu-text').first()).toHaveText('Spoke with his mom on the phone.');
    // Esc in the follow-up window closes it alone.
    await focus.getByRole('button', { name: '+ Follow Up' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Follow Up' })).toHaveCount(0);
    await expect(focus).toBeVisible();

    // Deleting the observation says how many follow-ups go with it.
    await focus.getByRole('button', { name: 'Delete' }).click();
    await expect(page.locator('#confirm-title')).toHaveText('Delete this observation and its 3 follow-ups?');
    await page.locator('#confirm-cancel-btn').click();
    await expect(card).toBeVisible();
  });
});

test.describe('Observation follow-ups on the phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('the card shows them and + Follow Up opens as the sheet’s second page', async ({ page }) => {
    await enterDemo(page, true);
    await page.locator('.m-tab-item[data-tab="observe"]').click();
    await page.locator('.m-filter-pill[data-filter="sentiment:concern"]').click();
    const card = page.locator('.m-obs-card[data-obid="' + SEEDED + '"]');
    await card.scrollIntoViewIfNeeded();
    await expect(card.locator('.obs-fu-toggle')).toHaveText(/^2 follow-ups · last /);
    await card.locator('.obs-fu-toggle').click();
    await expect(card.locator('.obs-fu-item')).toHaveCount(2);
    // The strip never opens the observation's sheet.
    await expect(page.locator('#m-obs-edit')).toHaveCount(0);

    await card.getByRole('button', { name: '+ Follow Up' }).click();
    const pick = page.locator('#m-obs-edit-picker');
    await expect(pick).toBeVisible();
    await expect(pick.locator('.m-edit-title')).toHaveText('Follow Up');
    await expect(pick.locator('.obs-fu-chip')).toHaveCount(4);
    await pick.getByRole('button', { name: 'Spoke With Student' }).click();
    await pick.locator('textarea').fill('Talked at lunch.');
    await pick.getByRole('button', { name: 'Save' }).click();
    // Back on the observation's sheet, the new follow-up listed.
    await expect(pick).toBeHidden();
    const panel = page.locator('#m-obs-edit .obs-fu-panel');
    await expect(panel.locator('.obs-fu-item')).toHaveCount(3);
    await expect(panel).toContainText('Talked at lunch.');
    await page.locator('#m-obs-edit [data-action="m-obs-delete"]').click();
    await expect(page.locator('#m-confirm-title')).toHaveText('Delete this observation and its 3 follow-ups?');
  });
});
