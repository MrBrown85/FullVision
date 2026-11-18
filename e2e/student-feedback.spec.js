import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast } from './student-card-fake.js';

/* Your Feedback and The Whole Rubric (S4-F3), in Demo Mode, against the
   built site with the live site's CSP: opened from My Learning's Your
   Work, on a phone as a screen of its own and on a Chromebook beside the
   list, and inside Preview as Student. Nothing is sent.
   Set S4_SHOTS to a folder to save a picture of each screen (light). */

const SHOTS = process.env.S4_SHOTS || '';
async function picture(page, name) {
  if (!SHOTS) return;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: `${SHOTS}/S4-F3-${name}.png`, fullPage: true });
}

async function demo(page) {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  await page.goto('/s/#demo-card');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  // The sample class has bulletins, so the page opens on them (B1g); Assignments is the next tab.
  await page.locator('.sp-tab[data-tab="assignments"]').locator('visible=true').first().click();
  await expect(page.getByRole('button', { name: /^Outstanding \d+$/ })).toBeVisible();
  return posts;
}

// The My Learning tab: along the bottom on a phone, in the header on a Chromebook.
async function myLearning(page) {
  await page.locator('.sp-tab[data-tab="learning"]:visible').click();
  await expect(page.locator('.sp-ml-work')).toBeVisible();
}

// Your Feedback opens from the piece's row in My Learning's Your Work.
async function openFeedback(page, id, title) {
  await myLearning(page);
  await page.locator('.sp-ml-row[data-act="feedback"][data-piece="' + id + '"]').click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeFocused();
}
const openLab = page => openFeedback(page, 'demo-lab', 'Cell Microscope Lab');

test.describe('on a phone', () => {
  test.use(PHONE);

  test('a row in My Learning opens Your Feedback as a screen of its own; My Learning goes back', async ({ page }) => {
    const posts = await demo(page);
    await openLab(page);
    // The board's phone screen: no class header, no tabs along the bottom.
    await expect(page.locator('.sp-head')).toBeHidden();
    await expect(page.locator('.sp-tabs-bottom')).toBeHidden();
    await expect(page.locator('.sp-fb-sub')).toHaveText(/^Returned \S+ \d+$/);
    await expect(page.getByText('Your Result', { exact: true })).toBeVisible();
    await expect(page.locator('.sp-fb-comment')).toHaveText('Careful focusing. Label the nucleus next time.');
    // Your Rubric: each criterion, its level and the teacher's comment on it, and nothing more.
    await expect(page.getByRole('heading', { name: 'Your Rubric' })).toBeVisible();
    const method = page.locator('.sp-fb-criterion', { hasText: 'Method' });
    await expect(method.locator('.sp-level')).toHaveText('Proficient');
    await expect(method.getByText('Every step is there, in order.')).toBeVisible();
    const drawing = page.locator('.sp-fb-criterion', { hasText: 'Labelled Drawing' });
    await expect(drawing.locator('.sp-level')).toHaveText('Developing +');
    await expect(drawing.getByText('Label the nucleus and the cell wall.')).toBeVisible();
    await expect(
      page.locator('.sp-feedback').getByText(/Means Here|To Reach|What You Showed|Counts toward/),
    ).toHaveCount(0);
    await fits(page);
    await named(page);
    await contrast(page);
    await picture(page, 'phone-feedback-rubric');

    // What the Levels Mean is at the foot, closed at first; it opens and closes.
    const levels = page.getByRole('button', { name: 'What the Levels Mean' });
    await expect(levels).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('You went beyond the goal')).toBeHidden();
    await levels.click();
    await expect(levels).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('You went beyond the goal')).toBeVisible();
    await fits(page);
    await contrast(page);
    await picture(page, 'phone-feedback-levels');
    await levels.click();
    await expect(levels).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByText('You went beyond the goal')).toBeHidden();

    // The Whole Rubric still shows what each level asks.
    await page.getByRole('button', { name: 'See the Whole Rubric' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'The Whole Rubric' })).toBeFocused();
    await expect(page.locator('.sp-fb-you')).toHaveCount(2);
    await expect(page.getByText('Lists every step in order, so someone else could repeat it.')).toBeVisible();
    await fits(page);
    await named(page);
    await contrast(page);
    await picture(page, 'phone-whole-rubric');
    await page.getByRole('button', { name: 'Your Feedback' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cell Microscope Lab' })).toBeFocused();

    await expect(page.locator('.sp-fb-back')).toHaveText('My Learning');
    await page.locator('.sp-fb-back').click();
    await expect(page.locator('.sp-head')).toBeVisible();
    await expect(page.locator('.sp-ml-row[data-piece="demo-lab"]')).toBeFocused();
    expect(posts).toEqual([]);
  });

  test('points: the score, its percent and a bar', async ({ page }) => {
    await demo(page);
    await openFeedback(page, 'demo-quiz', 'Cell Structure Quiz');
    await expect(page.locator('.sp-fb-score')).toHaveText('8 / 10');
    await expect(page.locator('.sp-fb-pct')).toHaveText('80%');
    const width = await page.locator('.sp-fb-fill').evaluate(el => el.offsetWidth / el.parentElement.offsetWidth);
    expect(width).toBeCloseTo(0.8, 1);
    await fits(page);
    await contrast(page);
    await picture(page, 'phone-feedback-points');
  });

  test('a card not due yet is on Upcoming, with when it is due and no What You’re Graded On', async ({ page }) => {
    await demo(page);
    await page.getByRole('button', { name: /^Upcoming \d+$/ }).click();
    const fair = page.locator('.sp-piece', { hasText: 'Science Fair Proposal' });
    await expect(fair).toBeVisible();
    await expect(fair.locator('.sp-flag-later')).toHaveText('In 4 Days');
    await expect(fair.getByText('What You’re Graded On')).toHaveCount(0);
    await expect(fair.getByText('Questioning and Predicting')).toHaveCount(0);
    await fits(page);
    await contrast(page);
    await picture(page, 'phone-upcoming-card');
  });
});

test.describe('on a Chromebook', () => {
  test.use(CHROMEBOOK);

  test('Your Feedback sits beside My Learning’s list; another row opens its own', async ({ page }) => {
    const posts = await demo(page);
    await openLab(page);
    await expect(page.locator('.sp-side')).toBeVisible();
    await expect(page.locator('.sp-head')).toBeVisible();
    await expect(page.locator('.sp-fb-back')).toBeHidden();
    await expect(page.locator('.sp-side-row.sp-side-on')).toContainText('Cell Microscope Lab');
    // On a Chromebook the levels are always shown, the chips in a row (the board), with no button.
    await expect(page.getByRole('button', { name: 'What the Levels Mean' })).toBeHidden();
    await expect(page.getByText('You went beyond the goal')).toBeVisible();
    await expect(page.getByText('Every step is there, in order.')).toBeVisible();
    await fits(page);
    await named(page);
    await contrast(page);
    await picture(page, 'chromebook-feedback-rubric');
    // Another returned piece in the list opens its feedback.
    await page.locator('.sp-side-row', { hasText: 'Cell Structure Quiz' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cell Structure Quiz' })).toBeFocused();
    await expect(page.locator('.sp-fb-score')).toHaveText('8 / 10');
    // Missing work goes to its card on Outstanding.
    await page.locator('.sp-side-row', { hasText: 'Immune System Quick Check' }).click();
    await expect(page.locator('.sp-feedback')).toHaveCount(0);
    await expect(page.locator('.sp-piece.sp-picked h2')).toHaveText('Immune System Quick Check');
    await expect(page.getByRole('button', { name: /^Outstanding \d+$/ })).toHaveAttribute('aria-pressed', 'true');
    expect(posts).toEqual([]);
  });
});

test.describe('inside Preview as Student', () => {
  test.use(CHROMEBOOK);

  test('the teacher sees the same feedback, an Advanced and a Single-Point rubric included', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.waitForFunction(
      () => {
        var cid = typeof getActiveCourse === 'function' && getActiveCourse();
        return !!cid && getStudents(cid).length > 0 && getAllTags(cid).length > 0;
      },
      null,
      { timeout: 15000 },
    );
    const found = await page.evaluate(() => {
      var cid = getActiveCourse();
      setStudentPageSwitch(cid, true);
      var st = sortStudents(getStudents(cid), 'lastName')[0];
      var view = StudentView.fromCache(cid, st.id).view;
      var of = function (style) {
        var p = view.work.find(function (x) {
          return x.kind === 'back' && x.result.text && x.rubric && x.rubric.style === style;
        });
        return p ? p.id : '';
      };
      return { cid: cid, sid: st.id, advanced: of('advanced'), single: of('single_point') };
    });
    expect(found.advanced).not.toBe('');
    expect(found.single).not.toBe('');
    await page.goto('/dashboard?manage=student-page');
    await page.getByRole('button', { name: 'Open Preview' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('radio', { name: 'Chromebook' }).click();
    for (const [id, name] of [
      [found.advanced, 'advanced'],
      [found.single, 'single-point'],
    ]) {
      await dialog.locator('.sp-tabs-top [data-tab="learning"]').click();
      await dialog.locator('.sp-ml-row[data-act="feedback"][data-piece="' + id + '"]').click();
      await expect(dialog.locator('.sp-feedback')).toBeVisible();
      await dialog
        .locator('.sp-fb-criterion')
        .first()
        .evaluate(el => el.scrollIntoView({ block: 'center' }));
      await expect(dialog.locator('.sp-fb-criterion').first()).toBeVisible();
      await picture(page, 'preview-chromebook-' + name);
    }
    // A Single-Point Rubric: each criterion's level, with no goal written out and no whole rubric to see.
    await expect(dialog.locator('.sp-fb-criterion .sp-level').first()).toBeVisible();
    await expect(dialog.locator('.sp-feedback').getByText(/^What You Showed$|^The Goal$/)).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'See the Whole Rubric' })).toHaveCount(0);
    await dialog.getByRole('radio', { name: 'Phone' }).click();
    await picture(page, 'preview-phone-single-point');
    expect(errors).toEqual([]);
  });
});
