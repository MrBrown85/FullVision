import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* The Sentences card's adding, editing, dragging and menus
   (term-questionnaire-redesign-plan, slices 4, 5 and 6), in Demo Mode on
   Science 8's Report 2. */
test.use({ viewport: { width: 1440, height: 1100 } });

async function open(page, student = 'st2', generate = true) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.locator('#tq-narrative').waitFor();
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
  if (generate) await page.locator('#tq-generate').click();
  await page.waitForTimeout(300);
}
const rows = page => page.locator('#tq-sentences .qn-srow');
const texts = page => rows(page).locator('.qn-req-text').allTextContents();
const lastBoxTop = page =>
  page
    .locator('#tq-sentences .qn-box')
    .last()
    .evaluate(el => el.getBoundingClientRect().top);

test('the add bar shows after a pause, draws over the gap and moves nothing; it is not there while a sentence is dragged', async ({
  page,
}) => {
  await open(page);
  const top = await lastBoxTop(page);
  const gaps = page.locator('#tq-sentences .qn-gap');
  const n = await gaps.count();
  // Sweep the pointer down the card, resting on each gap: the last box never moves.
  for (let i = 0; i < n; i++) {
    const g = await gaps.nth(i).boundingBox();
    await page.mouse.move(g.x + 80, g.y + g.height / 2);
    expect(await lastBoxTop(page)).toBe(top);
  }
  // Not at once, then it is there.
  const g = await gaps.nth(1).boundingBox();
  await page.mouse.move(g.x + 90, g.y + g.height / 2);
  const pill = gaps.nth(1).locator('.qn-gap-add');
  expect(await pill.evaluate(el => getComputedStyle(el).opacity)).toBe('0');
  await expect(pill).toHaveCSS('opacity', '1');
  const look = await pill.evaluate(el => {
    const c = getComputedStyle(el);
    return { h: el.getBoundingClientRect().height, r: c.borderRadius, bg: c.backgroundColor, fs: c.fontSize };
  });
  expect(look).toEqual({ h: 18, r: '9px', bg: 'rgb(0, 102, 204)', fs: '11.5px' });
  expect(await lastBoxTop(page)).toBe(top);
  // A click on the top edge of a sentence reaches the sentence, not the bar.
  const t = await rows(page).nth(2).locator('.qn-req-text').boundingBox();
  await page.mouse.click(t.x + 70, t.y + 1);
  await expect(page.locator('.qn-edit-field')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.locator('.qn-edit-field')).toHaveCount(0);
});

test('+ Add a Sentence writes at the end, before the closing; the bar writes at its gap; Return adds, Esc cancels', async ({
  page,
}) => {
  await open(page);
  const n = await rows(page).count();
  const add = page.locator('#tq-add-sentence');
  const look = await add.evaluate(el => {
    const c = getComputedStyle(el);
    return { h: el.getBoundingClientRect().height, r: c.borderRadius, bg: c.backgroundColor, fs: c.fontSize };
  });
  expect(look).toEqual({ h: 28, r: '7px', bg: 'rgb(0, 102, 204)', fs: '13px' });
  await add.click();
  const own = page.locator('#tq-sentences #tq-own');
  await expect(own.locator('#tq-own-input')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(own).toHaveCount(0);
  await expect(rows(page)).toHaveCount(n);
  await add.click();
  await own.locator('#tq-own-input').fill('Noor shared her lab notes with the class');
  await page.keyboard.press('Enter');
  await expect(rows(page)).toHaveCount(n + 1);
  await expect(rows(page).last().locator('.qn-req-text')).toHaveText('Noor shared her lab notes with the class.');
  expect(await page.locator('#tq-narrative').inputValue()).toContain('Noor shared her lab notes with the class.');
  // The bar at the first gap writes there.
  const g = await page.locator('#tq-sentences .qn-gap').first().boundingBox();
  await page.mouse.move(g.x + 90, g.y + g.height / 2);
  await page.locator('#tq-sentences .qn-gap').first().locator('.qn-gap-add').click();
  await own.locator('#tq-own-input').fill('Noor began the term well.');
  await own.locator('#tq-own-save').click();
  await expect(rows(page).nth(1).locator('.qn-req-text')).toHaveText('Noor began the term well.');
});

test('click a sentence to edit it: Return keeps it and marks it edited, Esc puts it back', async ({ page }) => {
  await open(page);
  const first = rows(page).first();
  const was = await first.locator('.qn-req-text').textContent();
  await first.locator('.qn-req-text').click();
  const field = first.locator('.qn-edit-field');
  await expect(field).toBeFocused();
  const ring = await field.evaluate(el => getComputedStyle(el).boxShadow);
  expect(ring).toContain('rgb(0, 102, 204) 0px 0px 0px 2px');
  await field.fill('Noor is doing well in Science 8.');
  await page.keyboard.press('Escape');
  await expect(page.locator('.qn-edit-field')).toHaveCount(0);
  await expect(first.locator('.qn-req-text')).toHaveText(was);
  expect(await page.locator('#tq-narrative').inputValue()).toContain(was);
  // Keep it: through the comment box, so the row is edited and Options offers the bank's wording back.
  await first.locator('.qn-req-text').click();
  await first.locator('.qn-edit-field').fill('Noor is doing well in Science 8.');
  await page.keyboard.press('Enter');
  await expect(first.locator('.qn-req-text')).toHaveText('Noor is doing well in Science 8.');
  await expect(first.locator('.qn-edited')).toHaveText('Edited');
  expect(await page.locator('#tq-narrative').inputValue()).toContain('Noor is doing well in Science 8.');
  await first.locator('[data-do="wording"]').click();
  await expect(page.locator('#tq-wording-menu')).toContainText('The bank’s wording, before your edit');
  await page.keyboard.press('Escape');
  // A click away keeps it too.
  const second = rows(page).nth(1);
  await second.locator('.qn-req-text').click();
  await second.locator('.qn-edit-field').fill('Her writing is polished.');
  await page.locator('.qn-name').click();
  await expect(rows(page).nth(1).locator('.qn-req-text')).toHaveText('Her writing is polished.');
});

test('a pointer drag reorders and saves; Esc puts the order back; the lifted sentence is lifted', async ({ page }) => {
  await open(page);
  const before = await texts(page);
  const handle = rows(page).nth(1).locator('.qn-srow-handle');
  await handle.scrollIntoViewIfNeeded();
  const b = await handle.boundingBox();
  await page.mouse.move(b.x + 8, b.y + 12);
  await page.mouse.down();
  await page.mouse.move(b.x + 8, b.y + 40, { steps: 4 });
  await page.mouse.move(b.x + 8, b.y + 130, { steps: 8 });
  const lifted = page.locator('#tq-sentences .qn-srow.lifted');
  await expect(lifted).toHaveCount(1);
  const look = await lifted.evaluate(el => {
    const c = getComputedStyle(el);
    return { r: c.borderRadius, shadow: c.boxShadow, t: c.transform };
  });
  expect(look.r).toBe('12px');
  expect(look.shadow).toContain('0px 14px 34px 6px');
  expect(look.t).not.toBe('none');
  await expect(page.locator('#tq-sentences .qn-slot')).toHaveCount(1);
  expect(await page.locator('#tq-sentences .qn-gap-add').first().isVisible()).toBe(false);
  // Esc: nothing changed, nothing saved.
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('#tq-sentences .qn-srow.lifted')).toHaveCount(0);
  expect(await texts(page)).toEqual(before);
  // Again, let go: the order changed and is saved with the comment.
  await handle.scrollIntoViewIfNeeded();
  const b2 = await handle.boundingBox();
  await page.mouse.move(b2.x + 8, b2.y + 12);
  await page.mouse.down();
  await page.mouse.move(b2.x + 8, b2.y + 50, { steps: 5 });
  await page.mouse.move(b2.x + 8, b2.y + 150, { steps: 10 });
  await page.mouse.up();
  await expect(page.locator('#tq-sentences .qn-srow.lifted')).toHaveCount(0);
  const after = await texts(page);
  expect(after).not.toEqual(before);
  expect(after.slice().sort()).toEqual(before.slice().sort());
  await expect(page.locator('[data-do="reset"]')).toHaveCount(1);
  const saved = await page.evaluate(() => getStudentTermRating('sci8', 'st2', 'term-2').narrative);
  expect(saved.indexOf(after[1])).toBeLessThan(saved.indexOf(after[2]));
  expect(await page.locator('#tq-narrative').inputValue()).toBe(saved);
});

test('a menu: Esc closes it and gives the focus back; the arrow keys, Home and End move through it', async ({
  page,
}) => {
  await open(page);
  const btn = rows(page).first().locator('[data-do="wording"]');
  await btn.click();
  const items = page.locator('#tq-wording-menu button');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('End');
  await expect(items.last()).toBeFocused();
  await page.keyboard.press('Home');
  await expect(items.first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#tq-wording-menu')).toHaveCount(0);
  await expect(btn).toBeFocused();
});

test('Pick the Piece changes the sentence, the evidence and At a Glance, and survives Generate and a reload', async ({
  page,
}) => {
  await open(page);
  const bestBox = page.locator('#tq-sentences .qn-box[data-part="bestPiece"]');
  await bestBox.locator('[data-do="wording"]').click();
  const menu = page.locator('#tq-wording-menu');
  await expect(menu.locator('.qn-menu-head').first()).toHaveText('Pick the Piece');
  const picks = menu.locator('[data-do="pickPiece"]');
  await expect(picks).toHaveCount(4);
  await expect(menu.locator('.qn-menu-head').nth(1)).toHaveText('Other ways to say this');
  await expect(menu.locator('[data-do="piecesAll"]')).toContainText('Assignments…');
  await expect(menu).toContainText('Open in Grader ›');
  await expect(menu).toContainText('Add a Note for the Report ›');
  const title = (await picks.nth(1).locator('.qn-menu-text').textContent()) || '';
  await picks.nth(1).click();
  await expect(bestBox.locator('.qn-req-text').first()).toContainText(title);
  await expect(bestBox.locator('.qn-box-evidence')).toContainText(title);
  await expect(page.locator('.qno-glance .qn-fact', { hasText: 'Best Piece' })).toContainText(title);
  await page.locator('#tq-generate').click();
  await expect(bestBox.locator('.qn-box-evidence')).toContainText(title);
  await page.reload();
  await page.locator('#tq-narrative').waitFor();
  await expect(page.locator('#tq-sentences .qn-box[data-part="bestPiece"] .qn-box-evidence')).toContainText(title);
});

test('Pick the Skill names the chosen competency as the strength', async ({ page }) => {
  await open(page);
  const box = page.locator('#tq-sentences .qn-box[data-part="strengths"]');
  await box.locator('[data-do="wording"]').click();
  const picks = page.locator('#tq-wording-menu [data-do="pickSkill"]');
  await expect(page.locator('#tq-wording-menu .qn-menu-head').first()).toHaveText('Pick the Skill');
  const name = ((await picks.nth(1).locator('.qn-menu-text').textContent()) || '').trim();
  await picks.nth(1).click();
  await expect(box.locator('.qn-box-evidence')).toContainText(name);
});

test('See the N lists the missing work and opens the grader; it changes no status', async ({ page }) => {
  await open(page, 'st6');
  const before = await page.evaluate(() => JSON.stringify(getAssignmentStatuses('sci8')));
  const see = page.locator('#tq-row-missing [data-do="missOpen"]');
  await expect(see).toHaveText(/^See the \d+$/);
  const look = await see.evaluate(el => {
    const c = getComputedStyle(el);
    return { h: el.getBoundingClientRect().height, bg: c.backgroundColor, color: c.color };
  });
  expect(look).toEqual({ h: 26, bg: 'rgba(138, 90, 0, 0.14)', color: 'rgb(107, 66, 0)' });
  await see.click();
  const menu = page.locator('#tq-miss-menu');
  await expect(menu).toBeVisible();
  await expect(menu.locator('.qn-miss-item')).not.toHaveCount(0);
  await expect(menu.locator('.qn-miss-step')).toHaveCount(0);
  await menu.locator('.qn-miss-open').first().click();
  await expect(page.locator('#grader-overlay .grader-dialog')).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(getAssignmentStatuses('sci8')))).toBe(before);
});

for (const font of FONTS) {
  test(`the card with a menu and the writing box open fits in the ${font} font`, async ({ page }) => {
    await open(page);
    await useFont(page, font);
    await page.locator('#tq-add-sentence').click();
    const over = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('#tq-sentences *').forEach(el => {
        const cs = getComputedStyle(el);
        if (cs.display === 'none' || el.offsetParent === null) return;
        if (el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1 && !['auto', 'scroll'].includes(cs.overflowX))
          out.push((el.id || el.className || el.tagName) + ': ' + (el.textContent || '').trim().slice(0, 30));
      });
      if (document.documentElement.scrollWidth > innerWidth) out.push('the page scrolls sideways');
      return out;
    });
    expect(over).toEqual([]);
  });
}
