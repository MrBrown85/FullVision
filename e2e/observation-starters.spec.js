import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

/* Sentence starters are the teacher's, one list for every class
   (migrations/20261022_teacher_sentence_starters.sql). They are edited on My
   Sentence Starters and picked with "/" or "+ Starter" in any observation
   box, most used first. */

async function storedStarters(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('gb-obs-templates-teacher') || '[]'));
}

async function openStarters(page) {
  await gotoApp(page, '/observations/starters');
  const section = page.locator('.ms-page');
  await expect(section.getByRole('heading', { name: 'My Sentence Starters' })).toBeVisible();
  return section;
}

test.describe('Sentence starters', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
  });

  test('a starter added on My Sentence Starters fills the text, type, context and tags with / on the Observations page', async ({
    page,
  }) => {
    const section = await openStarters(page);
    // A teacher with none is offered the six suggestions, unsaved.
    await expect(section.locator('.cm-starter-row.is-suggestion')).toHaveCount(6);
    await expect(section.getByRole('button', { name: 'Add These Starters' })).toBeVisible();
    expect(await storedStarters(page)).toEqual([]);

    await section.getByRole('button', { name: 'Add Starter' }).click();
    const text = section.locator('#ms-text');
    await expect(text).toBeFocused();
    await text.fill('Measured twice before pouring');
    await section.getByLabel('Type').selectOption('strength');
    await section.getByLabel('Context').selectOption('small-group');
    await section.locator('.cm-starter-tag', { hasText: 'Engagement' }).click();
    await section.getByRole('button', { name: 'Add Starter' }).click();

    const row = section.locator('.ms-row', { hasText: 'Measured twice before pouring' });
    await expect(row).toBeVisible();
    await expect(row.locator('.obs-pill-type')).toHaveText('Strength');
    await expect(row.locator('.obs-pill-context')).toHaveText('Small group');
    await expect(row.locator('.obs-card-dim')).toHaveText('Engagement');
    await expect(row.locator('.ms-row-uses')).toHaveText('0');
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
    await expect(suggest.locator('.obsc-item').last()).toHaveText('Edit My Starters…');
    await page.keyboard.press('Enter');
    await expect(input).toHaveValue('Measured twice before pouring');
    await expect(page.locator('#obs-capture .obsc-chip-type[data-value="strength"]')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await page.keyboard.press('Enter');

    const card = page.locator('.obs-card', { hasText: 'Measured twice before pouring' });
    await expect(card).toBeVisible();
    await expect(card.locator('.obs-type')).toHaveText('Strength');
    await expect(card.locator('.obs-card-context')).toHaveText('Small group');
    await expect(card.locator('.obs-card-dim')).toHaveText('Engagement');
    // It counts toward Times Used.
    expect((await storedStarters(page))[0].uses).toBe(1);
  });

  test('add the suggestions, reorder, edit and delete; Edit My Starters… comes back here', async ({ page }) => {
    const section = await openStarters(page);
    // No class list on this page, so no sidebar button either.
    await expect(page.locator('.tb-btn').first()).toBeHidden();
    await section.getByRole('button', { name: 'Add These Starters' }).click();
    await expect(section.locator('.ms-row:not(.ms-row-head)')).toHaveCount(6);
    const texts = () => section.locator('.ms-row-text').allTextContents();
    expect((await texts())[0]).toBe('Strong collaboration with peers');

    await section
      .locator('.ms-row:not(.ms-row-head)')
      .nth(1)
      .getByRole('button', { name: /^Move up/ })
      .click();
    expect((await texts()).slice(0, 2)).toEqual(['Asked a great question in class', 'Strong collaboration with peers']);

    await section.locator('.ms-row:not(.ms-row-head)').first().getByRole('button', { name: /^Edit/ }).click();
    await section.locator('#ms-text').fill('Asked a question that moved the class on');
    await page.keyboard.press('Enter');
    expect((await texts())[0]).toBe('Asked a question that moved the class on');

    await section
      .locator('.ms-row:not(.ms-row-head)')
      .first()
      .getByRole('button', { name: /^Delete/ })
      .click();
    await page.locator('#confirm-ok-btn').click();
    await expect(section.locator('.ms-row:not(.ms-row-head)')).toHaveCount(5);
    expect((await storedStarters(page)).map(t => t.text)[0]).toBe('Strong collaboration with peers');

    await page.goto(`/teacher/app.html#/observations?course=${TEST_COURSE.id}`);
    await page.locator('#starter-btn').click();
    const menu = page.locator('#starter-dropdown');
    await expect(menu.locator('[data-obsc="pickStarter"]')).toHaveCount(5);
    await menu.getByText('Edit My Starters…').click();
    await expect(page.getByRole('heading', { name: 'My Sentence Starters' })).toBeVisible();
    // Back on a page with a class list, the button is there again.
    await page.locator('.tb-breadcrumb a').first().click();
    await expect(page.locator('.tb-btn').first()).toBeVisible();
  });

  test('Save as Starter keeps what is in the box for every class', async ({ page }) => {
    await gotoApp(page, `/observations?course=${TEST_COURSE.id}`);
    const input = page.locator('#capture-input');
    await input.click();
    await input.pressSequentially('@Bob ');
    await page.locator('#obs-capture .obsc-chip-type[data-value="strength"]').click();
    await input.pressSequentially('Explained their reasoning clearly to the group');
    await page.getByRole('button', { name: 'Save as Starter' }).click();
    const dialog = page.getByRole('dialog', { name: 'Save as Starter' });
    await expect(dialog).toContainText('Leave out student names so it works for anyone.');
    await expect(dialog).toContainText('Your observation for Bob isn’t added until you press Add.');
    await dialog.getByRole('button', { name: 'Save Starter' }).click();
    await expect(dialog).toBeHidden();
    expect(await storedStarters(page)).toMatchObject([
      { text: 'Explained their reasoning clearly to the group', sentiment: 'strength' },
    ]);
    // The note itself is still in the box.
    await expect(input).toHaveValue('Explained their reasoning clearly to the group');
    await expect(page.locator('.obs-card', { hasText: 'Explained their reasoning' })).toHaveCount(0);
  });

  test('Escape in Save as Starter closes only that dialog, not the observation dialog behind it', async ({ page }) => {
    await gotoApp(page, `/gradebook?course=${TEST_COURSE.id}`);
    await page.evaluate(cid => {
      ObsCapture.openDialog({ cid: cid, students: [getStudents(cid)[0].id], title: 'Add observation' });
    }, TEST_COURSE.id);
    const box = page.locator('.obsc-dialog textarea');
    await box.fill('Shared the microscope without being asked');
    await page.locator('.obsc-dialog .obsc-save-starter').click();
    await expect(page.getByRole('dialog', { name: 'Save as Starter' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Save as Starter' })).toHaveCount(0);
    await expect(page.locator('.obsc-dialog')).toBeVisible();
    await expect(box).toHaveValue('Shared the microscope without being asked');
    // A second Escape closes the observation dialog, as before.
    await page.keyboard.press('Escape');
    await expect(page.locator('.obsc-dialog')).toHaveCount(0);
  });
});
