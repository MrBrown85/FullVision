import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

/* Sentence starters are a per-class bank (docs/DECISIONS.md, "Observations
   (2026-10-18)"). They are edited in Class Management and picked with "/" or
   "+ Starter" in any observation box. */

async function storedStarters(page) {
  return page.evaluate(cid => JSON.parse(localStorage.getItem('gb-obs-templates-' + cid) || '[]'), TEST_COURSE.id);
}

async function openStarters(page) {
  await gotoApp(page, '/dashboard');
  await page.getByRole('button', { name: 'Class Management' }).first().click();
  const section = page.locator('#cm-starters');
  await expect(section).toBeVisible();
  return section;
}

test.describe('Sentence starters', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
  });

  test('a starter added in Class Management fills the text, type, context and tags with / on the Observations page', async ({
    page,
  }) => {
    const section = await openStarters(page);
    // A class with none is offered the six suggestions, unsaved.
    await expect(section.locator('.cm-starter-row.is-suggestion')).toHaveCount(6);
    await expect(section.getByRole('button', { name: 'Add these to this class' })).toBeVisible();
    expect(await storedStarters(page)).toEqual([]);

    await section.getByRole('button', { name: '+ Write your own' }).click();
    const text = section.locator('#cm-starter-text');
    await expect(text).toBeFocused();
    await text.fill('Measured twice before pouring');
    await section.getByLabel('Type').selectOption('strength');
    await section.getByLabel('Context').selectOption('small-group');
    await section.locator('.cm-starter-tag', { hasText: 'Engagement' }).click();
    await section.getByRole('button', { name: 'Add starter' }).click();

    const row = section.locator('.cm-starter-row', { hasText: 'Measured twice before pouring' });
    await expect(row).toBeVisible();
    await expect(row.locator('.obs-pill-type')).toHaveText('Strength');
    await expect(row.locator('.obs-pill-context')).toHaveText('Small group');
    await expect(row.locator('.obs-card-dim')).toHaveText('Engagement');
    expect(await storedStarters(page)).toMatchObject([
      { text: 'Measured twice before pouring', sentiment: 'strength', context: 'small-group', dims: ['engagement'] },
    ]);

    // After a reload, on the Observations page.
    await page.goto(`/teacher/app.html#/observations?course=${TEST_COURSE.id}`);
    const input = page.locator('#capture-input');
    await input.click();
    await input.pressSequentially('@Bob ');
    await expect(page.locator('#obs-capture .obsc-chip-student')).toContainText('Bob');
    await input.pressSequentially('/meas');
    const suggest = page.locator('#capture-suggest');
    await expect(suggest.locator('.obsc-item').first()).toContainText('Measured twice before pouring');
    await expect(suggest.locator('.obsc-item').last()).toHaveText('Edit starters…');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Measured twice before pouring');
    await expect(page.locator('#obs-capture .obsc-chip-type[data-value="strength"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Enter');

    const card = page.locator('.obs-card', { hasText: 'Measured twice before pouring' });
    await expect(card).toBeVisible();
    await expect(card.locator('.obs-pill-type')).toHaveText('Strength');
    await expect(card.locator('.obs-pill-context')).toHaveText('Small group');
    await expect(card.locator('.obs-card-dim')).toHaveText('Engagement');
  });

  test('add the suggestions, reorder, edit and delete; Edit starters… comes back here', async ({ page }) => {
    const section = await openStarters(page);
    await section.getByRole('button', { name: 'Add these to this class' }).click();
    await expect(section.locator('.cm-starter-row:not(.is-suggestion)')).toHaveCount(6);
    const texts = () => section.locator('.cm-starter-text').allTextContents();
    expect((await texts())[0]).toBe('Strong collaboration with peers');

    await section.locator('.cm-starter-row').nth(1).getByRole('button', { name: 'Move up' }).click();
    expect((await texts()).slice(0, 2)).toEqual(['Asked a great question in class', 'Strong collaboration with peers']);

    await section.locator('.cm-starter-row').first().getByRole('button', { name: 'Edit' }).click();
    await section.locator('#cm-starter-text').fill('Asked a question that moved the class on');
    await page.keyboard.press('Enter');
    expect((await texts())[0]).toBe('Asked a question that moved the class on');

    await section.locator('.cm-starter-row').first().getByRole('button', { name: 'Delete starter' }).click();
    await page.locator('#confirm-ok-btn').click();
    await expect(section.locator('.cm-starter-row')).toHaveCount(5);
    expect((await storedStarters(page)).map(t => t.text)[0]).toBe('Strong collaboration with peers');

    await page.goto(`/teacher/app.html#/observations?course=${TEST_COURSE.id}`);
    await page.locator('#starter-btn').click();
    const menu = page.locator('#starter-dropdown');
    await expect(menu.locator('[data-obsc="pickStarter"]')).toHaveCount(5);
    await menu.getByText('Edit starters…').click();
    await expect(page.locator('#cm-starters')).toBeVisible();
  });
});
