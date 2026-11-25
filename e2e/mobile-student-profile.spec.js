/**
 * The phone's student profile (docs/plans/phone-look-plan.md, L6): the
 * student's own words first, All Work and Competencies opening in place, a
 * long answer cut at five lines with More, an open concern closed in one tap,
 * and the student's words over a new note. Demo Mode, Science 8.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

test.use({ viewport: { width: 375, height: 700 }, isMobile: true, hasTouch: true });

async function openPhone(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}
const profile = page => page.locator('#m-screen-student-detail');
async function openProfile(page) {
  await openPhone(page);
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
  await expect(profile(page).locator('.m-sp-name')).toBeVisible();
}

test('the profile puts the student’s words first; All Work and Competencies open in place', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openProfile(page);
  await expect(profile(page).locator('.m-sp-observe')).toHaveText('+ Observe');
  // The old tabs, hero and To Grade are gone.
  await expect(profile(page).locator('.m-st-tab, .m-hero, .m-scard-tograde')).toHaveCount(0);
  const heads = await profile(page).locator('.m-sp-head h2').allTextContents();
  expect(heads.slice(0, 2)).toEqual(expect.arrayContaining(['About Me']));
  const work = profile(page).locator('details', { has: page.locator('summary', { hasText: 'All Work' }) });
  await expect(work).not.toHaveAttribute('open', '');
  await work.locator('summary').click();
  await expect(work).toHaveAttribute('open', '');
  await expect(work.locator('.m-assess-compact').first()).toBeVisible();
  const comps = profile(page).locator('details', { has: page.locator('summary', { hasText: 'Competencies' }) });
  await comps.locator('summary').click();
  await expect(comps.locator('.m-section-card, .m-group-header').first()).toBeVisible();
  // A piece in All Work opens the grader on this student.
  await work.locator('.m-assess-compact').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  expect(errors).toEqual([]);
});

test('the private note is behind a tap', async ({ page }) => {
  await openProfile(page);
  const note = profile(page).locator('details.m-sp-note');
  await expect(note).toHaveCount(1);
  await expect(note).not.toHaveAttribute('open', '');
  await expect(note.locator('.m-sp-bubble')).toBeHidden();
  await note.locator('summary').click();
  await expect(note.locator('.m-sp-bubble')).toBeVisible();
});

test('a long answer is cut at five lines with More, and Less shuts it again', async ({ page }) => {
  await openPhone(page);
  await page.evaluate(() => {
    const sid = getStudents('sci8')[0].id;
    window.__long = 'Honestly the hardest thing is the write ups because ' + 'I erase it and start again. '.repeat(12);
    const real = StudentVoice.profile;
    StudentVoice.profile = list => {
      const p = real(list);
      if (p.about && p.about.hard) p.about.hard.v = { text: window.__long };
      return p;
    };
    window.__sid = sid;
  });
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
  const answer = profile(page).locator('.m-sp-answer', { has: page.locator('.m-sp-clamp', { hasText: 'Honestly' }) });
  await expect(answer).toHaveClass(/is-long/);
  const text = answer.locator('.m-sp-clamp');
  const line = await text.evaluate(el => parseFloat(getComputedStyle(el).lineHeight));
  expect((await text.boundingBox()).height).toBeLessThanOrEqual(line * 5 + 1);
  const more = answer.locator('.m-sp-more');
  await expect(more).toHaveText('More');
  expect((await more.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await more.click();
  await expect(more).toHaveText('Less');
  expect((await text.boundingBox()).height).toBeGreaterThan(line * 5 + 1);
  await more.click();
  await expect(more).toHaveText('More');
});

/* An open concern for the student, then its one-tap follow-up. */
async function addConcern(page) {
  return page.evaluate(() => {
    const cid = getActiveCourse();
    const sid = getStudents(cid)[0].id;
    addQuickOb(cid, sid, 'Missed two lab deadlines', [], 'concern');
    const all = getQuickObs(cid)[sid];
    return { cid, sid, obId: all[all.length - 1].id };
  });
}

test('an open concern closes in one tap from its chip, and Undo opens it again', async ({ page }) => {
  await openPhone(page);
  const { cid, obId } = await addConcern(page);
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
  const chip = profile(page).locator('[data-sp-action="concerns"]');
  await expect(chip).toHaveText(/1 Open Concern/);
  expect((await chip.boundingBox()).height).toBeGreaterThanOrEqual(44);
  await chip.click();
  const sheet = page.locator('#m-sheet-container .m-sp-concern');
  await expect(sheet).toContainText('Missed two lab deadlines');
  await expect(sheet.locator('.m-sp-concern-btn')).toHaveText([
    'Called Home',
    'Spoke With Student',
    'Still Happening',
    'Resolved',
  ]);
  await sheet.locator('[data-kind="resolved"]').click();
  await expect(page.locator('#m-sheet-container .m-sp-concern')).toHaveCount(0);
  expect(await page.evaluate(([c, o]) => getObservationFollowUps(c, o).map(f => f.kind), [cid, obId])).toEqual([
    'resolved',
  ]);
  // The chip is gone with the concern.
  await expect(profile(page).locator('[data-sp-action="concerns"]')).toHaveCount(0);
  await page.locator('#m-toast [data-action="m-toast-undo"]').click();
  expect(await page.evaluate(([c, o]) => getObservationFollowUps(c, o).length, [cid, obId])).toBe(0);
  await expect(profile(page).locator('[data-sp-action="concerns"]')).toHaveCount(1);
});

test('a step that is not Resolved leaves the concern open', async ({ page }) => {
  await openPhone(page);
  const { cid, obId } = await addConcern(page);
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
  await profile(page).locator('[data-sp-action="concerns"]').click();
  await page.locator('#m-sheet-container [data-kind="called_home"]').click();
  expect(await page.evaluate(([c, o]) => getObservationFollowUps(c, o).map(f => f.kind), [cid, obId])).toEqual([
    'called_home',
  ]);
  await expect(profile(page).locator('[data-sp-action="concerns"]')).toHaveCount(1);
});

test('+ Observe starts a note with the student’s own words quoted', async ({ page }) => {
  await openProfile(page);
  await profile(page).locator('.m-sp-observe').click();
  const quote = page.locator('#m-sheet-container .m-sp-words');
  await expect(quote.locator('figcaption')).toHaveText(/^Hard Right Now · /);
  await expect(quote.locator('blockquote')).not.toHaveText('');
  await expect(page.locator('#m-sheet-container #m-obs-text')).toBeVisible();
});

for (const width of [375, 320]) {
  for (const font of FONTS) {
    test(`the profile fits at ${width} px, ${font} font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await openPhone(page);
      await useFont(page, font);
      await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
      await expect(profile(page).locator('.m-sp-name')).toBeVisible();
      await profile(page)
        .locator('details summary')
        .evaluateAll(s => s.forEach(x => x.click()));
      const out = await page.evaluate(() =>
        [...document.querySelectorAll('#m-screen-student-detail .m-sp-card')].flatMap(b => {
          const r = b.getBoundingClientRect();
          return [...b.querySelectorAll('.m-sp-bubble, .m-sp-chip, .m-sp-observe, summary, .m-obs-card')]
            .filter(e => {
              const x = e.getBoundingClientRect();
              return x.width > 0 && (x.right > r.right + 0.6 || x.left < r.left - 0.6);
            })
            .map(e => String(e.className || e.tagName));
        }),
      );
      expect(out).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(
        0,
      );
      // Every row is a 44 px target.
      const rows = await profile(page)
        .locator('.m-sp-row > summary')
        .evaluateAll(els => els.map(e => e.getBoundingClientRect().height));
      rows.forEach(h => expect(h).toBeGreaterThanOrEqual(44));
    });
  }
}
