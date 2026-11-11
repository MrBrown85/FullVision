import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast } from './student-card-fake.js';

/* Your Feedback and The Whole Rubric (S4-F3), in Demo Mode, against the
   built site with the live site's CSP: opened from a returned card, on a
   phone as a screen of its own and on a Chromebook beside the list, and
   inside Preview as Student. Nothing is sent.
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
  await expect(page.getByRole('button', { name: 'To Do 3' })).toBeVisible();
  return posts;
}

async function openLab(page) {
  await page.getByRole('button', { name: 'Back 6' }).click();
  const lab = page.locator('.sp-piece', { hasText: 'Cell Microscope Lab' });
  if (await page.locator('.sp-side').isVisible()) {
    await page.locator('.sp-side-row', { hasText: 'Cell Microscope Lab' }).click();
  } else {
    await page.locator('.sp-deck').evaluate((d, title) => {
      const card = [...d.querySelectorAll('.sp-piece')].find(c => c.textContent.includes(title));
      d.scrollTo({ left: card.offsetLeft - d.offsetLeft, behavior: 'auto' });
    }, 'Cell Microscope Lab');
  }
  await lab.getByRole('button', { name: 'See Your Feedback' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Cell Microscope Lab' })).toBeFocused();
}

test.describe('on a phone', () => {
  test.use(PHONE);

  test('a returned card opens Your Feedback as a screen of its own; Assignments goes back', async ({ page }) => {
    const posts = await demo(page);
    await openLab(page);
    // The board's phone screen: no class header, no To Do, Sent and Back, no tabs along the bottom.
    await expect(page.locator('.sp-head')).toBeHidden();
    await expect(page.locator('.sp-tabs-bottom')).toBeHidden();
    await expect(page.locator('.sp-segments')).toBeHidden();
    await expect(page.getByText('Your Result', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Your Rubric' })).toBeVisible();
    await expect(page.getByText('What Proficient Means Here')).toBeVisible();
    await expect(page.getByText('To Reach Extending')).toBeVisible();
    await fits(page);
    await named(page);
    await contrast(page);
    await picture(page, 'phone-feedback-rubric');

    await page.getByRole('button', { name: 'What the Levels Mean' }).click();
    await expect(page.getByRole('button', { name: 'What the Levels Mean' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByText('You went beyond the goal')).toBeVisible();
    await fits(page);
    await contrast(page);
    await picture(page, 'phone-feedback-levels');

    await page.getByRole('button', { name: 'See the Whole Rubric' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'The Whole Rubric' })).toBeFocused();
    await expect(page.locator('.sp-fb-you')).toHaveCount(2);
    await fits(page);
    await named(page);
    await contrast(page);
    await picture(page, 'phone-whole-rubric');
    await page.getByRole('button', { name: 'Your Feedback' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Cell Microscope Lab' })).toBeFocused();

    await page.getByRole('button', { name: 'Assignments' }).first().click();
    await expect(page.locator('.sp-head')).toBeVisible();
    await expect(page.locator('.sp-piece.sp-picked h2')).toBeFocused();
    expect(posts).toEqual([]);
  });

  test('points: the score, its percent and a bar', async ({ page }) => {
    await demo(page);
    await page.getByRole('button', { name: 'Back 6' }).click();
    await page.locator('.sp-deck').evaluate(d => {
      const card = [...d.querySelectorAll('.sp-piece')].find(c => c.textContent.includes('Cell Structure Quiz'));
      d.scrollTo({ left: card.offsetLeft - d.offsetLeft, behavior: 'auto' });
    });
    await page
      .locator('.sp-piece', { hasText: 'Cell Structure Quiz' })
      .getByRole('button', { name: 'See Your Feedback' })
      .click();
    await expect(page.locator('.sp-fb-score')).toHaveText('8 / 10');
    await expect(page.locator('.sp-fb-pct')).toHaveText('80%');
    const width = await page.locator('.sp-fb-fill').evaluate(el => el.offsetWidth / el.parentElement.offsetWidth);
    expect(width).toBeCloseTo(0.8, 1);
    await fits(page);
    await contrast(page);
    await picture(page, 'phone-feedback-points');
  });

  test('a card not back yet says what it is graded on', async ({ page }) => {
    await demo(page);
    const fair = page.locator('.sp-piece', { hasText: 'Science Fair Proposal' });
    await expect(fair.getByText('What You’re Graded On')).toBeVisible();
    await expect(fair.getByText('Questioning and Predicting')).toBeVisible();
    await fits(page);
    await contrast(page);
    await picture(page, 'phone-todo-graded-on');
  });
});

test.describe('on a Chromebook', () => {
  test.use(CHROMEBOOK);

  test('Your Feedback takes the card’s place beside the list', async ({ page }) => {
    const posts = await demo(page);
    await openLab(page);
    await expect(page.locator('.sp-side')).toBeVisible();
    await expect(page.locator('.sp-head')).toBeVisible();
    await expect(page.locator('.sp-fb-back')).toBeHidden();
    await page.getByRole('button', { name: 'What the Levels Mean' }).click();
    await fits(page);
    await named(page);
    await contrast(page);
    await picture(page, 'chromebook-feedback-rubric');
    // Another piece in the list shows its card.
    await page.locator('.sp-side-row', { hasText: 'Cell Structure Quiz' }).click();
    await expect(page.locator('.sp-feedback')).toHaveCount(0);
    await expect(page.locator('.sp-piece.sp-picked h2')).toHaveText('Cell Structure Quiz');
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
      await dialog.getByRole('button', { name: /^Back \d+$/ }).click();
      await dialog.locator('.sp-side-row[data-piece="' + id + '"]').click();
      await dialog.locator('.sp-piece.sp-picked').getByRole('button', { name: 'See Your Feedback' }).click();
      await expect(dialog.locator('.sp-feedback')).toBeVisible();
      await dialog
        .locator('.sp-fb-criterion')
        .first()
        .evaluate(el => el.scrollIntoView({ block: 'center' }));
      await expect(dialog.locator('.sp-fb-criterion').first()).toBeVisible();
      await picture(page, 'preview-chromebook-' + name);
    }
    await expect(dialog.getByText(/^What You Showed$|^The Goal$/).first()).toBeVisible();
    await dialog.getByRole('radio', { name: 'Phone' }).click();
    await picture(page, 'preview-phone-single-point');
    expect(errors).toEqual([]);
  });
});
