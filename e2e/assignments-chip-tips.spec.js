import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// A card's category, rubric and Core Competency chips each say what they are
// in the shared tooltip, on hover and on keyboard focus, without moving
// anything on the card.
const CATEGORIES = [{ id: 'cat-labs', name: 'Labs & Investigations', weight: 30, displayOrder: 0 }];
const RUBRIC = {
  id: 'rubric-lab',
  name: 'Lab Investigation Rubric',
  criteria: [{ id: 'crit-hyp', name: 'Hypothesis', tagIds: ['QAP'] }],
};
const ASSESSMENT = {
  id: 'assess-chips',
  title: 'Chemical Reactions Lab',
  date: '2026-10-17',
  type: 'summative',
  tagIds: ['QAP'],
  categoryId: 'cat-labs',
  rubricId: 'rubric-lab',
  coreCompetencyIds: ['CRT', 'CT'],
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-10-17').toISOString(),
};

test('card chips show what they are on hover and focus', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(
    ({ categories, rubric, assessment, cid }) => {
      localStorage.setItem('gb-categories-' + cid, JSON.stringify(categories));
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
    },
    { categories: CATEGORIES, rubric: RUBRIC, assessment: ASSESSMENT, cid: TEST_COURSE.id },
  );
  await gotoApp(page, '/assignments');

  const card = page.locator('#ac-assess-chips');
  const tip = page.locator('#gb-tooltip');
  const chips = [
    [card.locator('.type-badge'), 'Labs & Investigations', 'Category worth 30% of the course grade.'],
    [card.locator('.rubric-badge'), 'Lab Investigation Rubric', 'The rubric used to grade this work.'],
    [card.locator('.cc-badge', { hasText: /^CRT$/ }), 'Critical & Reflective Thinking', 'Core Competency'],
    [card.locator('.cc-badge', { hasText: /^CT$/ }), 'Creative Thinking', 'Core Competency'],
  ];
  const metaBox = () =>
    card.locator('.assess-meta').evaluate(el => {
      const r = el.getBoundingClientRect();
      return [r.x, r.y, r.width, r.height];
    });
  const chipBoxes = () =>
    card.locator('.assess-meta > *').evaluateAll(els =>
      els.map(el => {
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }),
    );
  const before = { meta: await metaBox(), chips: await chipBoxes() };

  for (const [chip, name, text] of chips) {
    await chip.hover();
    await expect(tip).toBeVisible();
    await expect(tip.locator('strong')).toHaveText(name);
    await expect(tip.locator('.gb-code-tip-group')).toHaveText(text);
    await expect(chip).toHaveAttribute('aria-describedby', 'gb-tooltip');
    expect(await metaBox()).toEqual(before.meta);
    expect(await chipBoxes()).toEqual(before.chips);
  }
  // No native title doubles the tooltip.
  await expect(card.locator('.cc-badge[title]')).toHaveCount(0);

  // Leaving the chip closes it.
  await page.mouse.move(5, 5);
  await expect(tip).toBeHidden();

  // Keyboard: focus shows it, Escape closes it, focus stays on the chip.
  const rubricChip = card.locator('.rubric-badge');
  await rubricChip.focus();
  await expect(tip).toBeVisible();
  await expect(tip.locator('strong')).toHaveText('Lab Investigation Rubric');
  await page.keyboard.press('Escape');
  await expect(tip).toBeHidden();
  await expect(rubricChip).toBeFocused();
  await expect(rubricChip).not.toHaveAttribute('aria-describedby', 'gb-tooltip');

  // Tab to the next chip (codes run in Core Competency order) shows its tip.
  await page.keyboard.press('Tab');
  await expect(tip.locator('strong')).toHaveText('Creative Thinking');
});
