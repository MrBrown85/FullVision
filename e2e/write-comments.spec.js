import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

/* Write Comments (docs/plans/write-comments-plan.md), in Demo Mode on
   Science 8's Report 2: one box per part, Say This, Other Ways, edit in
   place, the drag handle, the typed comment read back into sentences, and
   the student list's reasons. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page, student = 'st1') {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(() => {
    const cfg = getReportConfig('sci8') || {};
    saveReportConfig('sci8', Object.assign({}, cfg, { form: ReportSheets.form() }));
  });
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=' + student);
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
}

const comment = page => page.locator('#tq-narrative').inputValue();
const head = (page, key) => page.locator('#wc-head-' + key);
async function openBox(page, key) {
  if ((await head(page, key).getAttribute('aria-expanded')) !== 'true') await head(page, key).click();
  await expect(head(page, key)).toHaveAttribute('aria-expanded', 'true');
}
/* A comment Generate wrote, so every box has sentences to show. */
async function generated(page) {
  // The seeded comment's own sentences are the teacher's and would stay, so it is cleared first.
  await page.locator('#tq-narrative').evaluate(el => {
    el.value = '';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#tq-generate-first').click();
  await expect(page.locator('#tq-read .wc-sent').first()).toBeVisible();
}

test('every box is closed but Work Habits; a box opens by its head and by Enter', async ({ page }) => {
  await open(page);
  await expect(page.locator('.wc-box.open')).toHaveCount(1);
  await expect(head(page, 'habits')).toHaveAttribute('aria-expanded', 'true');
  for (const key of ['grade', 'best', 'strength', 'att', 'voice', 'obs', 'missing', 'next', 'cls']) {
    await expect(head(page, key)).toHaveAttribute('aria-expanded', 'false');
  }
  await head(page, 'strength').click();
  await expect(head(page, 'strength')).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('.wc-box[data-part="strength"] .wc-fact').first()).toBeVisible();
  await head(page, 'best').focus();
  await page.keyboard.press('Enter');
  await expect(head(page, 'best')).toHaveAttribute('aria-expanded', 'true');
  await head(page, 'best').click();
  await expect(head(page, 'best')).toHaveAttribute('aria-expanded', 'false');
});

for (const font of FONTS) {
  test(`the boxes and the comment keep their shape in the ${font} font`, async ({ page }) => {
    await open(page);
    await useFont(page, font);
    await openBox(page, 'strength');
    const box = await page.locator('.wc-box[data-part="strength"]').boundingBox();
    const left = await page.locator('.wc-left').boundingBox();
    expect(box.x + box.width).toBeLessThanOrEqual(left.x + left.width + 1);
    const over = await page.evaluate(
      () => document.querySelector('.wc-left').scrollWidth - document.querySelector('.wc-left').clientWidth,
    );
    expect(over).toBeLessThanOrEqual(1);
  });
}

test('Say This adds a sentence after the last one of its box and takes no other’s place', async ({ page }) => {
  await open(page);
  await generated(page);
  await openBox(page, 'strength');
  const before = await comment(page);
  const say = page.locator('.wc-box[data-part="strength"] [data-do="wcSay"]').first();
  await expect(say).toBeVisible();
  await say.click();
  await expect.poll(() => comment(page)).not.toBe(before);
  const after = await comment(page);
  // Every sentence that was there is still there, in the same order.
  let at = 0;
  for (const s of before.split(/(?<=[.!?])\s+/)) {
    const i = after.indexOf(s, at);
    expect(i, s).toBeGreaterThanOrEqual(at);
    at = i;
  }
  expect(after.length).toBeGreaterThan(before.length);
});

test('Name This One changes the piece the comment names', async ({ page }) => {
  await open(page);
  await generated(page);
  await openBox(page, 'best');
  const name = page.locator('.wc-box[data-part="best"] [data-do="wcSay"]').first();
  test.skip((await name.count()) === 0, 'this comment has no best-piece sentence');
  await expect(name).toHaveText('Name This One');
  const title = await name
    .locator('xpath=ancestor::*[contains(@class,"wc-fact")][1]//*[contains(@class,"wc-fact-name")]')
    .first()
    .textContent();
  await name.click();
  await expect.poll(() => comment(page)).toContain(title.trim());
});

test('Other Ways words a sentence another way, and Use puts it in', async ({ page }) => {
  await open(page);
  await generated(page);
  await openBox(page, 'grade');
  const before = await comment(page);
  await page.locator('.wc-box[data-part="grade"] [data-do="wcWays"]').first().click();
  const ways = page.locator('.wc-box[data-part="grade"] .wc-way');
  await expect(ways.first()).toBeVisible();
  await ways.first().locator('[data-do="wcUse"]').click();
  await expect.poll(() => comment(page)).not.toBe(before);
});

test('a click edits a sentence in place; Enter keeps it, Escape puts it back; an edited one is Yours', async ({
  page,
}) => {
  await open(page);
  await generated(page);
  await openBox(page, 'grade');
  const line = page.locator('.wc-box[data-part="grade"] .wc-line').first();
  const old = await line.locator('.wc-text').textContent();
  await line.locator('.wc-text').click();
  const field = line.locator('.wc-edit');
  await field.fill('Cece is doing well in Science 8 this year.');
  await field.press('Escape');
  await expect(field).toHaveCount(0);
  expect(await comment(page)).toContain(old.trim());
  await line.locator('.wc-text').click();
  await line.locator('.wc-edit').fill('Cece is doing well in Science 8 this year.');
  await line.locator('.wc-edit').press('Enter');
  await expect.poll(() => comment(page)).toContain('Cece is doing well in Science 8 this year.');
  await expect(page.locator('.wc-box[data-part="grade"] .wc-chip.own', { hasText: 'Yours' })).toBeVisible();
});

test('the drag handle moves a sentence in front of another; the arrow keys move it one place', async ({ page }) => {
  await open(page);
  await generated(page);
  for (const k of ['grade', 'strength', 'next']) await openBox(page, k);
  const texts = () => page.locator('#tq-read .wc-sent').allTextContents();
  // The name moves to whichever sentence comes first, so a sentence is known by its words after the first.
  const tail = t => t.trim().split(' ').slice(1).join(' ');
  // A sentence with none to pass has no grip; two more give the Strength box three.
  await expect(page.locator('.wc-box[data-part="strength"] .wc-grip')).toHaveCount(0);
  for (let i = 0; i < 2; i++) await page.locator('.wc-box[data-part="strength"] [data-do="wcSay"]').first().click();
  await expect(page.locator('.wc-box[data-part="strength"] .wc-grip')).toHaveCount(3);
  // Arrow keys: the last sentence of the Strength box moves one place earlier.
  const grip = page.locator('.wc-box[data-part="strength"] .wc-grip').last();
  const was = await texts();
  const strengthText = await page
    .locator('.wc-box[data-part="strength"] .wc-line')
    .last()
    .locator('.wc-text')
    .textContent();
  const at = was.findIndex(t => tail(t) === tail(strengthText));
  await grip.focus();
  await page.keyboard.press('ArrowUp');
  await expect.poll(async () => (await texts()).findIndex(t => tail(t) === tail(strengthText))).toBe(at - 1);
  // Drag: the last Strength sentence onto the top of the first one goes in front of it (the drag itself
  // is in write-comments-drag.spec.js). The top edge, not the centre: the centre is exactly where the
  // sentence is level with the first one's middle, and a pixel either way decides.
  const strengthLines = () => page.locator('.wc-box[data-part="strength"] .wc-line .wc-text');
  const firstNow = tail((await strengthLines().first().textContent()) || '');
  const lastNow = tail((await strengthLines().last().textContent()) || '');
  await page
    .locator('.wc-box[data-part="strength"] .wc-grip')
    .last()
    .dragTo(page.locator('.wc-box[data-part="strength"] .wc-line').first(), { targetPosition: { x: 20, y: 6 } });
  await expect.poll(async () => tail((await strengthLines().first().textContent()) || '')).toBe(lastNow);
  // Undo puts it back.
  await page.locator('#undo-toast button', { hasText: 'Undo' }).click();
  await expect.poll(async () => tail((await strengthLines().first().textContent()) || '')).toBe(firstNow);
});

test('typing in the comment is read back into sentences, with Undo', async ({ page }) => {
  await open(page);
  await generated(page);
  await page.locator('#tq-read').click();
  const box = page.locator('#tq-narrative');
  await expect(box).toBeVisible();
  const old = await box.inputValue();
  const sentences = old.split(/(?<=[.!?])\s+/);
  // One sentence reworded a little, one new, the rest left as they were.
  const reworded = sentences[0].replace(/\.$/, ' so far.');
  await box.fill([reworded].concat(sentences.slice(1)).join(' ') + ' Please call me about the lab trip.');
  await page.locator('.wc-head-card').click();
  await expect(page.locator('#tq-read')).toBeVisible();
  // The new sentence is in Your Sentences, marked Yours.
  await expect(page.locator('#wc-head-yours')).toContainText('1 in the Comment');
  await openBox(page, 'yours');
  await expect(page.locator('.wc-box[data-part="yours"] .wc-chip.own', { hasText: 'Yours' })).toHaveCount(1);
  // The reworded one stays in its box, marked Yours.
  await openBox(page, 'grade');
  await expect(page.locator('.wc-box[data-part="grade"] .wc-chip.own', { hasText: 'Yours' })).toHaveCount(1);
  await page.locator('#undo-toast button', { hasText: 'Undo' }).click();
  await expect.poll(() => comment(page)).toBe(old);
});

test('three sentences in a row that open alike are noted, with Vary Them', async ({ page }) => {
  await open(page);
  await page.locator('#tq-read').click();
  await page.locator('#tq-narrative').fill('She asks good questions. She hands in her work. She helps her group.');
  await page.locator('.wc-head-card').click();
  await expect(page.locator('#wc-notes .wc-note')).toContainText('Three sentences in a row start with She.');
  await expect(page.locator('#wc-notes [data-do="wcVary"]')).toHaveText('Vary Them');
});

test('the student list says who needs a look and why', async ({ page }) => {
  await open(page);
  const notes = page.locator('#gb-sidebar .student-row-note');
  await expect(notes.first()).toBeVisible();
  const all = await page.locator('#gb-sidebar .student-row[data-sid]:visible').count();
  await page.locator('.qn-roster-filter [data-filter="not-ready"]').click();
  await expect(page.locator('.qn-roster-filter [data-filter="not-ready"]')).toContainText('Needs a Look');
  const shown = await page.locator('#gb-sidebar .student-row[data-sid]:visible').count();
  expect(shown).toBeLessThanOrEqual(all);
  await page.locator('.qn-roster-filter [data-filter="all"]').click();
  await expect(page.locator('.qn-roster-filter [data-filter="all"]')).toHaveClass(/active/);
});
