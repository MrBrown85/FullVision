import { test, expect } from '@playwright/test';

/* Phone grading keeps its place. A score, ± or clear tapped low on a long
   rubric (or on a competency in Competencies view) used to scroll the student's
   card back to the top, as did the redraw after a save synced. Demo Mode,
   Science 8: the Science Fair Proposal's rubric is padded to eight
   criteria so the card scrolls. Also: the card's foot clears the tab bar,
   and each criterion has a comment box. */

async function openLongRubric(page) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    const cid = Object.keys(COURSES)[0];
    const a = getAssessments(cid).find(x => x.title === 'Science Fair Proposal');
    const rubrics = structuredClone(getRubrics(cid));
    const r = rubrics.find(x => x.id === a.rubricId);
    const base = r.criteria.slice();
    for (let i = 0; r.criteria.length < 8; i++) {
      const c = structuredClone(base[i % base.length]);
      c.id = 'e2e-crit-' + i;
      c.name = 'Extra Criterion ' + (i + 1);
      r.criteria.push(c);
    }
    saveRubrics(cid, rubrics);
  });
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('text=Science Fair Proposal').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
}

const card = page => page.locator('.m-swiper-card').first();
const cardTop = page => card(page).evaluate(el => el.scrollTop);

// Scroll to the foot and wait for the nav bar to finish collapsing, which
// changes the card's height and so its bottom.
async function scrollCardToBottom(page) {
  let top = -1;
  await expect
    .poll(async () => {
      const was = top;
      top = await card(page).evaluate(el => {
        el.scrollTop = el.scrollHeight;
        return el.scrollTop;
      });
      await page.waitForTimeout(150);
      return was === top && (await cardTop(page)) === top;
    })
    .toBe(true);
  expect(top).toBeGreaterThan(200);
  return top;
}

test.describe('Phone grading card', () => {
  test('rubric score, ± and clear on a lower criterion', async ({ page }) => {
    await openLongRubric(page);
    await expect(card(page).locator('.m-crit-group')).toHaveCount(8);
    const top = await scrollCardToBottom(page);
    const group = () => card(page).locator('.m-crit-group').last();

    await group().locator('.m-score-btn[data-score="3"]').click();
    await expect(group().locator('.m-score-btn.m-score-active .m-level-fig')).toHaveText('3');
    expect(await cardTop(page)).toBe(top);

    await group().locator('.m-mod-btn').last().click();
    await expect(group().locator('.m-mod-btn').last()).toHaveClass(/m-mod-active/);
    expect(await cardTop(page)).toBe(top);

    // Tapping the active level again clears it.
    await group().locator('.m-score-btn[data-score="3"]').click();
    await expect(group().locator('.m-score-btn.m-score-active')).toHaveCount(0);
    expect(await cardTop(page)).toBe(top);
  });

  test('competency scores in Competencies view', async ({ page }) => {
    await openLongRubric(page);
    await page.getByRole('button', { name: 'Competencies', exact: true }).click();
    await expect(card(page).locator('.m-score-group').first()).toBeVisible();
    // Short competency lists don't scroll; give the card room to scroll. A
    // style rule, because a competency on rubric work redraws the card (its
    // level is written to each criterion behind it).
    await page.addStyleTag({ content: '.m-swiper-card { padding-top: 1200px !important; }' });
    const top = await scrollCardToBottom(page);
    const group = () => card(page).locator('.m-score-group').last();
    await group().locator('.m-score-btn[data-score="2"]').click();
    await expect(group().locator('.m-score-btn.m-score-active .m-level-fig')).toHaveText('2');
    expect(await cardTop(page)).toBe(top);
  });

  test('the redraw after a save syncs', async ({ page }) => {
    await openLongRubric(page);
    const top = await scrollCardToBottom(page);
    await card(page).locator('.m-crit-group').last().locator('.m-score-btn[data-score="4"]').click();
    // What a server echo or an id re-key does once the save lands.
    await page.evaluate(() => _invalidateAndRerender());
    await expect(card(page).locator('.m-crit-group').last().locator('.m-score-btn.m-score-active .m-level-fig')).toHaveText('4');
    expect(await cardTop(page)).toBe(top);
  });

  test('the Overall Comment scrolls clear of the tab bar', async ({ page }) => {
    await openLongRubric(page);
    await scrollCardToBottom(page);
    const gap = await page.evaluate(
      () =>
        document.querySelector('#m-tab-bar').getBoundingClientRect().top -
        document.querySelector('.m-swiper-card .m-overall-comment').getBoundingClientRect().bottom,
    );
    expect(gap).toBeGreaterThanOrEqual(8);
  });

  test('a criterion comment saves and survives a score tap', async ({ page }) => {
    await openLongRubric(page);
    const group = () => card(page).locator('.m-crit-group').nth(1);
    const box = () => group().locator('.m-crit-comment');
    // No empty boxes: each criterion shows a Comment button instead.
    await expect(card(page).locator('.m-crit-comment:visible')).toHaveCount(0);
    await group().getByRole('button', { name: 'Comment' }).click();
    await expect(box()).toBeFocused();
    await box().fill('Name the variable you change.');
    await box().blur();
    const saved = () =>
      page.evaluate(() => {
        const cid = Object.keys(COURSES)[0];
        const a = getAssessments(cid).find(x => x.title === 'Science Fair Proposal');
        const crit = getRubricById(cid, a.rubricId).criteria[1];
        const sid = document.querySelector('.m-swiper-card').dataset.sid;
        return getRubricCriterionComment(cid, sid, a.id, crit);
      });
    expect(await saved()).toBe('Name the variable you change.');
    await card(page).locator('.m-crit-group').nth(1).locator('.m-score-btn[data-score="2"]').click();
    await expect(box()).toHaveValue('Name the variable you change.');
    await expect(box()).toBeVisible();
    await expect(group().getByRole('button', { name: 'Comment' })).toBeHidden();
    expect(await saved()).toBe('Name the variable you change.');

    // Emptied, it clears and goes back behind its button.
    await box().fill('');
    await box().blur();
    await expect(box()).toBeHidden();
    await expect(group().getByRole('button', { name: 'Comment' })).toBeVisible();
    expect(await saved()).toBe('');
  });
});
