import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* The IE path and the menus, in the new page (docs/plans/write-comments-plan.md,
   decision 11): the deadline calendar, + Problem Sentence and + Plan Sentence,
   Approve and Next on an IE, slider keys, and the class lines' menus. Demo
   Mode, Science 8 as a Letter class (grade 10, so IE is on offer). */
test.use({ viewport: { width: 1440, height: 1100 } });

async function openIe(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    COURSES.sci8.gradingSystem = 'letter';
    COURSES.sci8.gradeLevel = '10';
    clearProfCache();
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.evaluate(() => {
    upsertTermRating('sci8', 'st1', 'term-2', {
      reportingBasis: 'ie',
      ieDeadline: null,
      narrative: '',
      approvedAt: null,
    });
    clearProfCache();
  });
  // Redraw on IE: the period picked again.
  await page.locator('#report-period').selectOption('Report 1');
  await page.locator('#report-period').selectOption('Report 2');
  await expect(page.locator('#wc-head-grade')).toContainText('IE');
}

test('the IE deadline calendar keeps the focus: ‹ and › with clicks and keys, then ↓ ↑ never move to another student', async ({
  page,
}) => {
  await openIe(page);
  const name = page.locator('.qn-name');
  const who = await name.textContent();
  const url = page.url();
  await page.locator('#tq-deadline-btn').click();
  await expect(page.locator('#tq-cal')).toHaveCount(1);
  const inCal = () => page.evaluate(() => !!document.activeElement && !!document.activeElement.closest('#tq-cal'));
  const title = () => page.locator('#tq-cal .qn-cal-title').textContent();
  const first = await title();
  await page.locator('#tq-cal [data-dir="1"]').click();
  expect(await title()).not.toBe(first);
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await expect(name).toHaveText(who);
  await expect(page.locator('#tq-cal')).toHaveCount(1);
  expect(page.url()).toBe(url);
  await page.locator('#tq-cal [data-dir="-1"]').click();
  expect(await title()).toBe(first);
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText(who);
  await page.locator('#tq-cal [data-dir="1"]').focus();
  await page.keyboard.press('Enter');
  expect(await title()).not.toBe(first);
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText(who);
  await page.locator('#tq-cal .qn-cal-title').click();
  expect(await inCal()).toBe(true);
  await page.keyboard.press('ArrowDown');
  await expect(name).toHaveText(who);
  await page.keyboard.press('Escape');
  await expect(page.locator('#tq-cal')).toHaveCount(0);
  await expect(page.locator('#tq-deadline-btn')).toBeFocused();
});

for (const font of FONTS) {
  test(`Approve and Next on an IE with no deadline goes to the deadline; after a date is picked it approves (${font} font)`, async ({
    page,
  }) => {
    await openIe(page);
    await useFont(page, font);
    const approve = page.locator('#tq-approve-next');
    await expect(approve).toBeEnabled();
    const who = await page.locator('.qn-name').textContent();
    await approve.click();
    await expect(page.locator('#tq-deadline-btn')).toBeFocused();
    await expect(page.locator('.qn-name')).toHaveText(who);
    expect(await page.evaluate(() => !!getStudentTermRating('sci8', 'st1', 'term-2').approvedAt)).toBe(false);
    await expect(approve).toBeEnabled();
    await page.locator('#tq-deadline-btn').click();
    await page.locator('#tq-cal .qn-cal-day:not([disabled])').last().click();
    await approve.click();
    await expect(page.locator('.qn-name')).not.toHaveText(who);
    expect(await page.evaluate(() => !!getStudentTermRating('sci8', 'st1', 'term-2').approvedAt)).toBe(true);
  });
}

test('an IE with no comment shows + Problem Sentence and + Plan Sentence, and no Your gradebook text', async ({
  page,
}) => {
  await openIe(page);
  const wc = page.locator('.wc-left');
  await expect(wc.getByRole('button', { name: '+ Problem Sentence' })).toBeVisible();
  await expect(wc.getByRole('button', { name: '+ Plan Sentence' })).toBeVisible();
  await expect(wc).not.toContainText('Your gradebook');
  await expect(wc.locator('.qn-req-source')).toHaveCount(0);
  await wc.getByRole('button', { name: '+ Problem Sentence' }).click();
  await page.locator('#tq-own-input').fill('Cece has handed in too little marked work for a grade.');
  await page.locator('#tq-own-save').click();
  await expect(wc.getByRole('button', { name: '+ Problem Sentence' })).toHaveCount(0);
  await expect(wc.locator('.qn-req-text', { hasText: 'too little marked work' })).toBeVisible();
  await expect(wc.getByRole('button', { name: '+ Plan Sentence' })).toBeVisible();
});

test('slider keys and menu keys never change the student; menus open inside a short window; Escape closes and returns the focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 700 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  const shown = () => page.locator('.qn').getAttribute('data-sid');
  const sid = await shown();
  const slider = page.locator('.qn-hs[data-habit="ready"]');
  await expect(slider).toHaveAttribute('role', 'slider');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Not rated');
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '2');
  await expect(slider).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(slider).toHaveAttribute('aria-valuenow', '1');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  await expect(slider).toHaveAttribute('aria-valuenow', '3');
  await page.keyboard.press('4');
  await expect(slider).toHaveAttribute('aria-valuetext', 'Consistently');
  await page.keyboard.press('Backspace');
  await expect(slider).not.toHaveAttribute('aria-valuenow', /./);
  expect(await page.evaluate(() => getStudentTermRating('sci8', 'st1', 'term-2').habits)).toEqual({});
  expect(await shown()).toBe(sid);

  // The Support Line menu: arrow keys, Home and End move through it; it opens inside the window.
  await page.locator('#wc-head-cls').click();
  const btn = page.locator('#tq-support-btn');
  await btn.evaluate(el => el.scrollIntoView({ block: 'end' }));
  await btn.click();
  const menu = page.locator('#tq-support-menu');
  await expect(menu).toBeVisible();
  const inWindow = await menu.evaluate(el => {
    const r = el.getBoundingClientRect();
    return r.top >= 0 && r.bottom <= window.innerHeight;
  });
  expect(inWindow).toBe(true);
  const focused = () => page.evaluate(() => document.activeElement && document.activeElement.outerHTML);
  const inMenu = () => page.evaluate(() => !!document.activeElement.closest('#tq-support-menu'));
  const firstItem = await focused();
  expect(await inMenu()).toBe(true);
  await page.keyboard.press('ArrowDown');
  expect(await focused()).not.toBe(firstItem);
  expect(await inMenu()).toBe(true);
  await page.keyboard.press('ArrowUp');
  expect(await focused()).toBe(firstItem);
  await page.keyboard.press('End');
  const last = await focused();
  expect(last).not.toBe(firstItem);
  await page.keyboard.press('Home');
  expect(await focused()).toBe(firstItem);
  expect(await shown()).toBe(sid);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(page.locator('#tq-support-btn')).toBeFocused();
});
