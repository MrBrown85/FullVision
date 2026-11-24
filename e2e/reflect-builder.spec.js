import { test, expect } from '@playwright/test';

/* New Reflection on Class Settings' Reflect tab (docs/plans/reflect-plan.md,
   boards 1 and 2), in Demo Mode: a teacher builds a reflection with one
   question of every type, saves it On, and sees its card. */

test.use({ serviceWorkers: 'block' });

test('builds a reflection with every question type, saves it On and sees its card', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await page.goto('/dashboard?manage=questionnaires');
  await expect(page.locator('[role=tab][aria-selected=true]')).toContainText('Reflect');
  await expect(page.locator('.sq-section-head')).toContainText('Reflections');
  await expect(page.getByRole('button', { name: /QR Slips/ })).toHaveCount(0);

  await page.getByRole('button', { name: 'New Reflection' }).click();
  const b = page.locator('.rb-build');
  await expect(b.locator('.cm-section-title')).toHaveText('New Reflection');
  await b.getByLabel('Title').fill('Lab Week Reflection');
  await b.getByLabel('Description').fill('About 5 minutes.');
  const on = b.locator('.rb-q-on');
  const prompt = on.locator('[data-rb-path="prompt"]');
  const add = name => b.locator('.rb-add').getByRole('button', { name, exact: true }).click();

  // Choice (the first card), with Other and Required.
  await prompt.fill('Which helped you learn the most?');
  await on.getByRole('textbox', { name: 'Option 1', exact: true }).fill('Labs');
  await on.getByRole('textbox', { name: 'Option 2', exact: true }).fill('Notes');
  await on.getByRole('button', { name: '+ Add “Other” Option' }).click();
  await on.getByRole('switch', { name: 'Required' }).click();
  await expect(on.getByRole('switch', { name: 'Required' })).toHaveAttribute('aria-checked', 'true');

  await add('Text');
  await prompt.fill('What do you understand better now?');
  await add('Rating');
  await prompt.fill('How confident are you?');
  await on.getByRole('textbox', { name: 'Word for 1' }).fill('Not Yet');
  await add('Date');
  await prompt.fill('When is your next test?');
  await add('Ranking');
  await prompt.fill('Put these in order.');
  await on.getByRole('textbox', { name: 'Item 1', exact: true }).fill('Labs');
  await on.getByRole('textbox', { name: 'Item 2', exact: true }).fill('Notes');
  await on.getByRole('textbox', { name: 'Item 3', exact: true }).fill('Practice');
  await add('Likert');
  await prompt.fill('How often did you do each?');
  await on.getByRole('textbox', { name: 'Statement 1', exact: true }).fill('I asked questions');
  await add('Heading');
  await prompt.fill('Last Part');
  // The Likert goes under the heading: ⌥↓ while typing in it, as in One Report. It stays open.
  await b.getByRole('button', { name: 'Edit question 6' }).click();
  await prompt.press('Alt+ArrowDown');
  await expect(b.locator('.rb-q').nth(6)).toHaveClass(/rb-q-on/);
  await expect(prompt).toBeFocused();
  await expect(b.locator('.rb-q').nth(5)).toContainText('Last Part');

  // The cards not being edited read as students see them.
  await expect(b.locator('.rb-q-view .rb-v-prompt').first()).toHaveText('1. Which helped you learn the most? *');
  await expect(b.locator('.rb-q')).toHaveCount(7);

  await b.getByRole('button', { name: 'Save and Turn On' }).click();
  await expect(page.locator('.rb-build')).toHaveCount(0);
  const card = page.locator('.sq-card', { hasText: 'Lab Week Reflection' });
  await expect(card).toBeVisible();
  await expect(card.locator('.sq-desc')).toHaveText('About 5 minutes. · 6 questions');
  await expect(card.locator('.sq-facts')).toContainText('In Students’ Reflect Tab');
  await expect(card.locator('.sq-facts')).toContainText('Until you turn it off');
  await expect(card.getByRole('button', { name: 'Delete' })).toBeVisible();
  await expect(card.getByRole('radio', { name: 'On' })).toHaveAttribute('aria-checked', 'true');

  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('gb-questionnaires-sci8')).find(q => q.title === 'Lab Week Reflection'),
  );
  expect(saved).toMatchObject({
    title: 'Lab Week Reflection',
    theme: 'About 5 minutes.',
    is_on: true,
    closes_on: null,
  });
  expect(saved.questions.map(q => q.kind)).toEqual([
    'choice',
    'text',
    'rating',
    'date',
    'ranking',
    'section',
    'likert',
  ]);
  expect(saved.questions[0].options).toEqual({
    required: true,
    choices: ['Labs', 'Notes'],
    multiple: false,
    other: true,
  });

  // Show Questions draws them as students see them, with Edit Questions.
  await card.getByRole('button', { name: 'Show Questions' }).click();
  await expect(card.locator('.rb-qs-view .rb-q')).toHaveCount(7);
  await card.getByRole('button', { name: 'Edit Questions' }).click();
  await expect(page.locator('.rb-build .cm-section-title')).toHaveText('Edit Reflection');
  await page.locator('.rb-build').getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.rb-build')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('moves a card from its ⋯ menu and by dragging its ⠿, a heading with its questions', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await page.goto('/dashboard?manage=questionnaires');
  await page.getByRole('button', { name: 'New Reflection' }).click();
  const b = page.locator('.rb-build');
  await b.getByLabel('Title').fill('Moving');
  const on = b.locator('.rb-q-on');
  const prompt = on.locator('[data-rb-path="prompt"]');
  const add = name => b.locator('.rb-add').getByRole('button', { name, exact: true }).click();
  const order = () => page.evaluate(() => CmReflectBuilder._state().questions.map(d => d.prompt));
  await on.locator('select.rb-kind').selectOption('text');
  await prompt.fill('a');
  await add('Heading');
  await prompt.fill('H');
  await add('Text');
  await prompt.fill('b');
  await add('Heading');
  await prompt.fill('K');
  await add('Text');
  await prompt.fill('c');

  // ⋯ Move To puts c at the foot of H; focus goes back to its ⋯.
  await on.getByRole('button', { name: 'More options' }).click();
  await expect(on.getByRole('menuitem', { name: 'Move Down' })).toBeDisabled();
  await on.getByRole('menuitem', { name: 'H', exact: true }).click();
  expect(await order()).toEqual(['a', 'H', 'b', 'c', 'K']);
  await expect(on.getByRole('button', { name: 'More options' })).toBeFocused();

  // Dragging H's ⠿ below K carries b and c with it.
  const head = b.locator('.rb-q').nth(1);
  await head.hover();
  const g = await head.locator('.rb-q-grip').boundingBox();
  const end = await b.locator('.rb-q').last().boundingBox();
  await page.mouse.move(g.x + 12, g.y + 12);
  await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(g.x + 12, g.y + 12 + ((end.y + end.height - g.y) * k) / 10);
  await page.mouse.up();
  await expect.poll(order).toEqual(['a', 'K', 'H', 'b', 'c']);
  await expect(page.locator('#rb-said')).toHaveText('Moved the heading H.');
  expect(errors).toEqual([]);
});

test('adds a card between two others: the + on the line between them, and ⋯', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.locator('#app-loading')).toHaveCount(0);
  await page.goto('/dashboard?manage=questionnaires');
  await page.getByRole('button', { name: 'New Reflection' }).click();
  const b = page.locator('.rb-build');
  await b.getByLabel('Title').fill('Adding');
  const on = b.locator('.rb-q-on');
  const prompt = on.locator('[data-rb-path="prompt"]');
  const add = name => b.locator('.rb-add').getByRole('button', { name, exact: true }).click();
  const state = () => page.evaluate(() => CmReflectBuilder._state().questions.map(d => d.kind + ':' + d.prompt));
  await on.locator('select.rb-kind').selectOption('rating');
  await prompt.fill('a');
  await add('Text');
  await prompt.fill('b');
  await add('Text');
  await prompt.fill('c');

  // Point at the line between a and b: a + in the margin; pointing at it offers the two choices.
  const first = await b.locator('.rb-q').nth(0).boundingBox();
  const second = await b.locator('.rb-q').nth(1).boundingBox();
  await page.mouse.move(first.x + 200, (first.y + first.height + second.y) / 2);
  const plus = b.locator('.rb-ins-plus');
  await expect(plus).toBeVisible();
  await plus.hover();
  await expect(b.locator('.rb-q').nth(1)).toHaveClass(/rb-q-parted/);
  await b.locator('.rb-ins-acts').getByText('Add a Question').click();
  // A Rating, like the question above, open with the cursor in it.
  await expect(b.locator('.rb-q').nth(1)).toHaveClass(/rb-q-on/);
  await expect(prompt).toBeFocused();
  await prompt.fill('new');
  await prompt.blur();
  expect(await state()).toEqual(['rating:a', 'rating:new', 'text:b', 'text:c']);
  await expect(b.locator('.rb-ins')).toHaveCount(0);

  // ⋯ on c: Start a New Heading Here puts a heading above it.
  await b.getByRole('button', { name: 'Edit question 4' }).click();
  await on.getByRole('button', { name: 'More options' }).click();
  await on.getByRole('menuitem', { name: 'Start a New Heading Here' }).click();
  await expect(prompt).toBeFocused();
  await prompt.fill('Last Part');
  // ⋯ on the heading has no add; Add a Question Below on c adds a Text under it.
  await b.getByRole('button', { name: 'Edit question 4' }).click();
  await on.getByRole('button', { name: 'More options' }).click();
  await on.getByRole('menuitem', { name: 'Add a Question Below' }).click();
  await prompt.fill('d');
  await prompt.blur();
  expect(await state()).toEqual(['rating:a', 'rating:new', 'text:b', 'section:Last Part', 'text:c', 'text:d']);
  expect(errors).toEqual([]);
});
