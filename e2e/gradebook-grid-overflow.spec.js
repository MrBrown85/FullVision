import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, gotoApp, TEST_ASSESSMENT } from './helpers.js';

// More columns than fit: the score area scrolls inside the gradebook's box,
// the page itself never scrolls sideways, and the last tilted title still
// shows in full at the far right.
const MANY_ASSESSMENTS = Array.from({ length: 40 }, (_, i) => ({
  ...TEST_ASSESSMENT,
  id: 'assess-' + String(i + 1).padStart(3, '0'),
  title: 'Assessment Number ' + (i + 1),
  date: '2026-03-' + String((i % 28) + 1).padStart(2, '0'),
}));

const layout = page =>
  page.evaluate(() => {
    var main = document.getElementById('main');
    var grid = document.querySelector('.gb-grid').getBoundingClientRect();
    var data = document.getElementById('gb-data');
    return {
      mainOverflow: main.scrollWidth - main.clientWidth,
      dataScrolls: data.scrollWidth > data.clientWidth,
      dataRight: data.getBoundingClientRect().right,
      gridRight: grid.right,
    };
  });

for (const view of ['scores', 'detailed']) {
  test(`the ${view} view scrolls inside its box, not the page`, async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page, MANY_ASSESSMENTS);
    await gotoApp(page, '/gradebook');
    await page.locator(`[data-action="setView"][data-mode="${view}"]`).click();

    const l = await layout(page);
    expect(l.mainOverflow).toBe(0);
    expect(l.dataScrolls).toBe(true);
    expect(l.dataRight).toBeLessThanOrEqual(l.gridRight);
  });
}

test('the last Scores title shows in full when scrolled to the end', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await seedAssessments(page, MANY_ASSESSMENTS);
  await gotoApp(page, '/gradebook');

  await page.locator('#gb-data').evaluate(el => {
    el.scrollLeft = el.scrollWidth;
    el.dispatchEvent(new Event('scroll'));
  });
  const { labelRight, headsRight } = await page.evaluate(() => ({
    labelRight: [...document.querySelectorAll('.gb-grid-colhead-label')].pop().getBoundingClientRect().right,
    headsRight: document.getElementById('gb-colheads').getBoundingClientRect().right,
  }));
  expect(labelRight).toBeLessThanOrEqual(headsRight);
});
