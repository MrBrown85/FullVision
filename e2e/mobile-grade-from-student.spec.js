/**
 * Grade on a student's page opens the newest assessment's grading screen on
 * the Grade tab, at that student's card, and Back returns to the page.
 * Runs in Demo Mode, where Science Fair Proposal is the newest assessment.
 */
import { test, expect } from '@playwright/test';
import { jumpTo, settled } from './phone-jump.js';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

// The card the swiper has scrolled to, once it stops.
async function currentCardName(page) {
  let last = null;
  for (let i = 0; i < 40; i++) {
    const now = await page.evaluate(() => document.getElementById('m-swiper')?.scrollLeft ?? null);
    if (now !== null && now === last) break;
    last = now;
    await page.waitForTimeout(150);
  }
  return page.evaluate(() => {
    const sw = document.getElementById('m-swiper');
    const card = sw.querySelectorAll('.m-swiper-card')[Math.round(sw.scrollLeft / sw.clientWidth)];
    return card.querySelector('.m-grade-student-name').textContent.trim();
  });
}

// A piece from the profile's All Work, which opens in place.
async function openWork(detail, title) {
  await detail.locator('summary', { hasText: 'All Work' }).click();
  await detail.locator('.m-assess-compact', { hasText: title }).first().click();
}

for (const row of [0, 3]) {
  test(`Grade on student ${row + 1}'s page lands on their card for the newest assessment, and Back returns`, async ({
    page,
  }) => {
    await page.goto('/login.html');
    await page.locator('#demo-mode-btn').click();
    await page.waitForURL(/teacher-mobile\//);
    await page.locator('.m-tab-item[data-tab="students"]').click();
    await page.locator('.m-card-all[data-action="m-all-students"]').click();
    await page.locator('[data-action="m-jump-student"]').nth(row).click();
    await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
    const detail = page.locator('#m-screen-student-detail');
    const name = (await detail.locator('.m-sp-name').textContent()).trim();

    // All Work, newest first: the first piece is the newest.
    await openWork(detail, 'Science Fair Proposal');
    await expect(page.locator('.m-tab-item[data-tab="grade"]')).toHaveAttribute('aria-selected', 'true');
    const bar = page.locator('#m-nav-bar-grade-swiper');
    await expect(bar.locator('.m-nav-title-text')).toHaveText(name);
    expect(await settled(page)).toBe(row);
    expect(await currentCardName(page)).toBe(name);

    await bar.locator('[data-action="m-back"]').click();
    await expect(page.locator('.m-tab-item[data-tab="students"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#m-screen-student-detail .m-sp-name')).toHaveText(name);
    await expect(page.locator('#m-screen-grade-swiper')).toHaveCount(0);

    // Back again returns to the cards, as from any student page.
    await page.locator('#m-screen-student-detail [data-action="m-back"]').click();
    await expect(page.locator('#m-screen-student-detail')).toHaveCount(0);
    await expect(page.locator('#m-student-card-stack')).toBeVisible();
  });
}

// On Group work the swiper has a card per group, so the student's place in
// the roster is not their card. Grade used to open the card at the roster
// number: another group's, or past the last card ("14 of 18").
test('Grade on a student page on Group work opens their group card, or their own card when in no group', async ({
  page,
}) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  // Three groups of four, not in roster order; students 13 on are in no group.
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const list = getAssessments(cid);
    const a = list.find(x => x.title === 'Science Fair Proposal');
    const ids = sortStudents(getStudents(cid), 'alpha').map(s => s.id);
    a.collaboration = 'group';
    a.groups = [ids.slice(8, 12), ids.slice(0, 4), ids.slice(4, 8)];
    saveAssessments(cid, list);
  });

  const openGrade = async row => {
    await page.locator('.m-tab-item[data-tab="students"]').click();
    await page.locator('.m-card-all[data-action="m-all-students"]').click();
    await page.locator('[data-action="m-jump-student"]').nth(row).click();
    await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
    const detail = page.locator('#m-screen-student-detail');
    const name = (await detail.locator('.m-sp-name').textContent()).trim();
    await openWork(detail, 'Science Fair Proposal');
    return name;
  };
  const bar = page.locator('#m-nav-bar-grade-swiper .m-nav-title-text');

  // Student 4 is in the second group.
  await openGrade(3);
  await expect(bar).toHaveText('Group 2');
  expect(await settled(page)).toBe(1);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const sw = document.getElementById('m-swiper');
        const card = sw.querySelectorAll('.m-swiper-card')[Math.round(sw.scrollLeft / sw.clientWidth)];
        return card.querySelector('.m-group-title')?.textContent;
      }),
    )
    .toBe('Group 2');

  // Student 14 is in no group: their own card, after the three group cards.
  await page.locator('#m-nav-bar-grade-swiper [data-action="m-back"]').click();
  await page.locator('#m-screen-student-detail [data-action="m-back"]').click();
  const name = await openGrade(13);
  await expect(bar).toHaveText(name);
  expect(await settled(page)).toBe(4);
  expect(await currentCardName(page)).toBe(name);
});

// A grading screen already open on the Grade tab used to come back under the
// new one with the same ids. The field's handlers bound to the hidden copy, so
// typed points never saved and the screen opened on the first student.
test('Grade on a student page with a grading screen open on the Grade tab opens one screen that saves typed points', async ({
  page,
}) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  // The points exam becomes the newest assessment, so Grade opens it.
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const list = getAssessments(cid).map(a =>
      a.title === 'Mid-Year Comprehensive Exam' ? { ...a, date: '2099-06-30' } : a,
    );
    saveAssessments(cid, list);
  });

  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('.m-seg-btn[data-action="m-grade-seg"][data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell', { hasText: 'Mid-Year Comprehensive Exam' }).click();
  await expect(page.locator('#m-swiper')).toBeVisible();
  await page.waitForTimeout(500);

  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('.m-card-all[data-action="m-all-students"]').click();
  await page.locator('[data-action="m-jump-student"]').nth(3).click();
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
  const detail = page.locator('#m-screen-student-detail');
  const name = (await detail.locator('.m-sp-name').textContent()).trim();
  const sid = await detail.locator('.m-sp-observe').getAttribute('data-sid');
  await openWork(detail, 'Mid-Year Comprehensive Exam');

  await expect(page.locator('#m-nav-bar-grade-swiper .m-nav-title-text')).toHaveText(name);
  await expect(page.locator('#m-screen-grade-swiper')).toHaveCount(1);
  await expect(page.locator('#m-swiper')).toHaveCount(1);
  expect(await currentCardName(page)).toBe(name);

  const field = page.locator(`.m-swiper-card[data-sid="${sid}"] .m-pts-input`);
  await field.tap();
  await page.keyboard.type('41');
  await page.keyboard.press('Enter');
  await expect(field).toHaveValue('41');
  const stored = await page.evaluate(sid => {
    const cid = getActiveCourse();
    const a = getAssessments(cid).find(x => x.title === 'Mid-Year Comprehensive Exam');
    return getPointsScore(cid, sid, a.id);
  }, sid);
  expect(stored).toBe(41);
});

// The grading bar always shows what is graded: its title at rest on the Grade list, "N of 27" following a
// thumbnail tap, and the student page fading its title in on scroll.
test('the grading bar names the student on screen, and follows the class list', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="grade"]').click();

  // The Grade list has no large title: its bar title shows at rest.
  await expect(page.locator('#m-nav-bar-grade-picker .m-nav-bar-title-inline')).toHaveCSS('opacity', '1');

  await page.locator('.m-seg-btn[data-action="m-grade-seg"][data-val="all"]').click();
  await page.locator('#m-grade-list .m-cell', { hasText: 'Science Fair Proposal' }).click();
  // The bar names the student on screen, and follows the class list.
  const title = page.locator('#m-nav-bar-grade-swiper .m-nav-bar-title-inline');
  const names = await page.evaluate(() =>
    sortStudents(getStudents(getActiveCourse()).slice(), 'alpha').map(s => displayName(s)),
  );
  await expect(title).toHaveCSS('opacity', '1');
  await expect(title.locator('.m-nav-title-text')).toHaveText(names[0]);

  await jumpTo(page, 4);
  await expect(title.locator('.m-nav-title-text')).toHaveText(names[4]);
  await expect(title).toHaveCSS('opacity', '1');
});

test('the student page keeps its bar title hidden at rest and fades it in on scroll', async ({ page }) => {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
  const title = page.locator('#m-nav-bar-student-detail .m-nav-bar-title-inline');
  await expect(title).toHaveCSS('opacity', '0');
  // The scroll handler is bound once the page has slid in, so scroll until it fades in.
  await expect(async () => {
    await page.locator('#m-screen-student-detail .m-screen-content').evaluate(el => {
      el.scrollTop = 200;
      el.dispatchEvent(new Event('scroll'));
    });
    await expect(title).toHaveCSS('opacity', '1', { timeout: 500 });
  }).toPass();
});
