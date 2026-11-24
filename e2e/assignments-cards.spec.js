import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// Assessment cards: a grip, the title and chips; the open card adds a ⋯
// menu with Class Results, Print Rubrics, Grade by, Set Everyone To › (a
// submenu of the four levels), Edit Assessment, Duplicate and Delete (the
// AssignmentsPage board). The menu stays inside the window wherever the
// bar is (Colin, Nov 16).
const RUBRIC = {
  id: 'rubric-card',
  name: 'Lab Report Rubric',
  criteria: [{ id: 'crit-hyp', name: 'Hypothesis', tagIds: ['QAP'] }],
};
const ASSESSMENT = {
  id: 'assess-card',
  title: 'Rubric Lab Report',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP'],
  rubricId: 'rubric-card',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

test('a card opens to a ⋯ menu that holds its actions, Set Everyone To in a submenu', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(
    ({ rubric, assessment, cid }) => {
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
    },
    { rubric: RUBRIC, assessment: ASSESSMENT, cid: TEST_COURSE.id },
  );
  await gotoApp(page, '/assignments');

  const card = page.locator('#ac-assess-card');
  await expect(card.locator('.assess-grip')).toBeVisible();
  await expect(card.locator('.rubric-badge')).toHaveText('Lab Report Rubric');

  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await expect(card).toHaveClass(/open/);
  await expect(card.locator('.assess-header-actions')).toHaveCSS('opacity', '1');
  // Set Everyone To is in the ⋯ menu, not a button of its own on the bar.
  await expect(card.locator('.assess-header-actions > .assess-setto')).toHaveCount(0);
  const more = card.locator('.assess-more-btn');
  await expect(more).toHaveAttribute('aria-label', 'More for ' + ASSESSMENT.title);
  await more.click();
  await expect(more).toHaveAttribute('aria-expanded', 'true');
  const menu = card.locator('.assess-more > .assess-menu');
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Class Results',
    'Print Rubrics',
    // In every class, student page or not (plan decision 2, Nov 17 2026).
    'Add Work for the Class',
    'Grade by Competencies',
    // A Standard rubric's words, beside where an Advanced one keeps its checklists (#1638).
    'Show Level Words',
    'Set Everyone To',
    'Edit Assessment',
    'Duplicate',
    // A piece no student has a grade or work on can go back to a Draft (#1484).
    'Unassign',
    'Delete…',
  ]);
  // Set Everyone To › opens its levels beside the menu: on hover, and by
  // → from the keyboard; ← closes them and goes back to it.
  const setTo = menu.getByRole('menuitem', { name: 'Set Everyone To' });
  const levels = card.locator('.assess-submenu');
  await expect(setTo).toHaveAttribute('aria-haspopup', 'menu');
  await expect(levels).toBeHidden();
  await setTo.hover();
  await expect(levels).toBeVisible();
  // In the class's Rubric Levels order (this class: Extending first).
  await expect(levels.getByRole('menuitem')).toHaveText(['Extending', 'Proficient', 'Developing', 'Emerging']);
  const [m, l] = [await menu.boundingBox(), await levels.boundingBox()];
  expect(l.x + l.width).toBeLessThanOrEqual(m.x);
  await menu.getByRole('menuitem', { name: 'Class Results' }).hover();
  await expect(levels).toBeHidden();
  await setTo.focus();
  await page.keyboard.press('ArrowRight');
  await expect(levels.getByRole('menuitem', { name: 'Extending' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(levels.getByRole('menuitem', { name: 'Proficient' })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(levels).toBeHidden();
  await expect(setTo).toBeFocused();
  // A level asks first, as the old Set Everyone To ▾ did.
  await setTo.click();
  await levels.getByRole('menuitem', { name: 'Proficient' }).click();
  await expect(menu).toBeHidden();
  await expect(page.locator('.confirm-overlay')).toContainText('Set Everyone To Proficient');
  await page.locator('.confirm-overlay').getByRole('button', { name: 'Cancel' }).click();

  // Esc closes it and goes back to ⋯.
  await more.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();

  await more.click();
  await menu.getByRole('menuitem', { name: 'Grade by Competencies' }).click();
  await expect(menu).toBeHidden();
  await more.click();
  await expect(menu.getByRole('menuitem', { name: 'Grade by Rubric' })).toBeVisible();
});

test('the ⋯ menu and its submenu stay inside the window on a bar near the bottom', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 700 });
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  const many = Array.from({ length: 14 }, (_, i) => ({
    ...ASSESSMENT,
    id: 'assess-card-' + i,
    title: 'Lab Report ' + (i + 1),
    date: '2026-03-' + String(10 + i),
  }));
  await page.addInitScript(
    ({ rubric, assessments, cid }) => {
      localStorage.setItem('gb-rubrics-' + cid, JSON.stringify([rubric]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify(assessments));
    },
    { rubric: RUBRIC, assessments: many, cid: TEST_COURSE.id },
  );
  await gotoApp(page, '/assignments');

  // The list's last card, so there is page above it to scroll.
  const card = page.locator('.assess-card').last();
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await expect(card).toHaveClass(/open/);
  // Scroll the page until the bar's ⋯ sits just above the window's bottom.
  const more = card.locator('.assess-more-btn');
  await more.evaluate(btn => {
    const main = btn.closest('.page-main');
    main.scrollTop += btn.getBoundingClientRect().bottom - (window.innerHeight - 20);
  });
  const btn = await more.boundingBox();
  expect(btn.y + btn.height).toBeGreaterThan(640);

  await more.click();
  const menu = card.locator('.assess-more > .assess-menu');
  await expect(menu).toBeVisible();
  const m = await menu.boundingBox();
  expect(m.y + m.height).toBeLessThanOrEqual(btn.y);
  expect(m.y).toBeGreaterThanOrEqual(0);

  await menu.getByRole('menuitem', { name: 'Set Everyone To' }).hover();
  const levels = card.locator('.assess-submenu');
  await expect(levels).toBeVisible();
  const l = await levels.boundingBox();
  expect(l.y).toBeGreaterThanOrEqual(0);
  expect(l.y + l.height).toBeLessThanOrEqual(700);
  expect(l.x).toBeGreaterThanOrEqual(0);
});
