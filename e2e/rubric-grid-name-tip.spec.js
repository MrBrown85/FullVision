import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// A criterion name cut off in the rubric grid shows in full in the shared
// tooltip: after a short hover (not at once), or straight away on a tap. A
// name that fits shows no tip.
const LONG = 'The Strongest Cosmological Argument and Why Its Critics Reply as They Do';
const RUBRIC = {
  id: 'rubric-names',
  name: 'Cosmological Arguments Rubric',
  criteria: [
    { id: 'crit-long', name: LONG, tagIds: ['QAP'] },
    { id: 'crit-short', name: 'Thesis', tagIds: ['PI'] },
  ],
};
const ASSESSMENT = {
  id: 'assess-names',
  title: 'Five Ways Essay',
  date: '2026-03-21',
  type: 'summative',
  tagIds: ['QAP', 'PI'],
  rubricId: 'rubric-names',
  scoreMode: '',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-03-21').toISOString(),
};

async function openGrid(page) {
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
  const card = page.locator('#ac-assess-names');
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  return card.locator('.rsg-student[data-status-student="stu-001"]');
}

test('a cut-off criterion name shows in full after a short hover', async ({ page }) => {
  const alice = await openGrid(page);
  const tip = page.locator('#gb-tooltip');
  const longLabel = alice.locator('.rsg-criterion-row[data-criterion="crit-long"] .rsg-criterion-label');
  const shortLabel = alice.locator('.rsg-criterion-row[data-criterion="crit-short"] .rsg-criterion-label');
  // No native title doubles the tip.
  await expect(alice.locator('.rsg-criterion-label[title]')).toHaveCount(0);

  const rowBox = () =>
    alice.locator('.rsg-criterion-row').evaluateAll(els =>
      els.map(el => {
        const r = el.getBoundingClientRect();
        return [r.x, r.y, r.width, r.height];
      }),
    );
  const before = await rowBox();

  await longLabel.hover();
  await page.waitForTimeout(250);
  await expect(tip).toBeHidden();
  await expect(tip).toBeVisible({ timeout: 1500 });
  await expect(tip.locator('strong')).toHaveText(LONG);
  expect(await rowBox()).toEqual(before);

  await page.mouse.move(5, 5);
  await expect(tip).toBeHidden();

  // Passing over a name and leaving before the delay shows nothing.
  await longLabel.hover();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(900);
  await expect(tip).toBeHidden();

  // A name that fits needs no tip.
  await shortLabel.hover();
  await page.waitForTimeout(900);
  await expect(tip).toBeHidden();
});

test.describe('on a touch screen', () => {
  test.use({ hasTouch: true });

  test('tapping a cut-off name shows it at once; the next tap closes it', async ({ page }) => {
    const alice = await openGrid(page);
    const tip = page.locator('#gb-tooltip');
    const longLabel = alice.locator('.rsg-criterion-row[data-criterion="crit-long"] .rsg-criterion-label');

    await longLabel.tap();
    await expect(tip).toBeVisible({ timeout: 300 });
    await expect(tip.locator('strong')).toHaveText(LONG);

    await alice.locator('.rsg-student-name').tap();
    await expect(tip).toBeHidden();
  });
});
