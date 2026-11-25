/**
 * The phone grader and the Grade list as the boards draw them
 * (docs/plans/phone-look-plan.md). Demo Mode, Science 8, the Light Refraction
 * Lab (a pair's card, then three students, each with work to read).
 *
 * The top bar names the card on screen and opens the class list; a name held
 * there peeks at that student's paper; a progress line, not buttons; a level
 * on the track with + beside the name; Late from ⋯ shown as one chip; Return
 * and Next held seven seconds with Undo over the tab bar; Next Student in a
 * class that returns as it saves; All Caught Up; Full Screen scoring; the last
 * comment on a criterion waiting as a suggestion; the phone turned sideways;
 * the fit of a criterion's line and the bottom bar at 375 and 320 px in the
 * page's font and a wide one; the Grade list.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';
import { jumpTo, settled } from './phone-jump.js';
import { findLowContrastText } from './contrast-check.js';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

const CID = 'sci8';

async function enter(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function openLab(page, title = 'Light Refraction Lab') {
  await enter(page);
  const aid = await page.evaluate(t => getAssessments('sci8').find(a => a.title === t).id, title);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  // Light Refraction Lab has work waiting, so the list opens on To Grade; the rest are on All.
  if (title !== 'Light Refraction Lab')
    await page.locator('.m-seg-btn[data-action="m-grade-seg"][data-val="all"]').click();
  await page.locator('#m-grade-list .m-tg-row[data-aid="' + aid + '"]').click();
  await expect(page.locator('#m-swiper')).toBeVisible();
  return aid;
}

const title = page => page.locator('#m-nav-bar-grade-swiper .m-nav-title-text');
const nextBtn = page => page.locator('#m-grade-return-act .m-grade-return-btn');

// The class list, then one name on it. Returns that student's card.
async function goTo(page, name) {
  await page.locator('#m-nav-bar-grade-swiper .m-nav-title-btn').click();
  await page.locator('#m-sheet-container .m-roster-row', { hasText: name }).click();
  await expect(title(page)).toHaveText(name);
  await expect(page.locator('#m-sheet-container .m-roster')).toHaveCount(0);
  return page.locator('#m-swiper .m-swiper-card').nth(await settled(page));
}

// A level on every criterion of a card.
async function scoreAll(card, score = 3) {
  const n = await card.locator('.m-crit-group').count();
  for (let i = 0; i < n; i++)
    await card.locator('.m-crit-group').nth(i).locator(`.m-score-btn[data-score="${score}"]`).click();
}

const drafts = (page, aid, sid) =>
  page.evaluate(([cid, aid, sid]) => GraderWork.draftsIn(cid, aid, [sid]).length, [CID, aid, sid]);

test('the bar names the card on screen, its name opens the class list, and the progress line is no row of buttons', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openLab(page);
  // A pair's card is named by its two students.
  await expect(title(page)).toHaveText('Aiden and Olivia');
  // Back is the chevron alone; ⋯ and the sync dot are in the bar; the tab bar stays.
  await expect(page.locator('#m-nav-bar-grade-swiper .m-nav-bar-back')).toHaveAccessibleName('Grade');
  await expect(page.locator('#m-nav-bar-grade-swiper .m-nav-bar-back span')).toHaveCount(0);
  await expect(page.locator('#m-nav-bar-grade-swiper #sync-indicator-dot')).toBeVisible();
  await expect(page.locator('#m-tab-bar')).toBeVisible();
  // A thin line, a segment a card; nothing in it is a control.
  const segs = await page.evaluate(() =>
    [...document.querySelectorAll('#m-grade-progress .m-prog-seg')].map(t => t.getBoundingClientRect().height),
  );
  expect(segs.length).toBe(4);
  segs.forEach(h => expect(h).toBeLessThanOrEqual(4));
  await expect(page.locator('#m-grade-progress button')).toHaveCount(0);
  // The old pieces are gone: no avatar or name on the card, no Competencies | Rubric row, no Draft line.
  await expect(
    page.locator(
      '#m-screen-grade-swiper :is(.m-grade-avatar, .m-grade-student-header, .m-grade-view-row, .m-draft-mark)',
    ),
  ).toHaveCount(0);

  await page.locator('#m-nav-bar-grade-swiper .m-nav-title-btn').click();
  const rows = page.locator('#m-sheet-container .m-roster-row');
  await expect(rows).toHaveText(['Aiden and Olivia', 'Ines Larsen', 'Marcus Lee', 'Sofia Petrov']);
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  // Every frame of the slide, from the moment Marcus is chosen: the index and
  // the name in the bar are his, never a card the slide passes.
  await page.evaluate(() => {
    const w = /** @type {any} */ (window);
    w.__frames = [];
    const t0 = performance.now();
    const tick = () => {
      w.__frames.push([
        MGrade.getCurrentIndex(),
        document.querySelector('#m-nav-bar-grade-swiper .m-nav-title-text').textContent,
      ]);
      if (performance.now() - t0 < 2500) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  await rows.nth(2).click();
  await expect(title(page)).toHaveText('Marcus Lee');
  expect(await settled(page)).toBe(2);
  await expect
    .poll(() => page.evaluate(() => /** @type {any} */ (window).__frames.length), { timeout: 5000 })
    .toBeGreaterThan(20);
  const frames = await page.evaluate(() => /** @type {any} */ (window).__frames);
  const from = frames.findIndex(f => f[0] === 2);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(frames.slice(from).filter(f => f[0] !== 2 || f[1] !== 'Marcus Lee')).toEqual([]);
  // The progress line follows: the third segment is the blue one.
  await expect(page.locator('#m-grade-progress .m-prog-seg.is-current')).toHaveCount(1);
  expect(
    await page.evaluate(() =>
      [...document.querySelectorAll('#m-grade-progress .m-prog-seg')].findIndex(s =>
        s.classList.contains('is-current'),
      ),
    ),
  ).toBe(2);
  expect(errors).toEqual([]);
});

test('a name held on the class list peeks at that student’s paper, and the list stays', async ({ page }) => {
  await openLab(page);
  await page.locator('#m-nav-bar-grade-swiper .m-nav-title-btn').click();
  const row = page.locator('#m-sheet-container .m-roster-row', { hasText: 'Ines Larsen' });
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('#m-peek .m-peek-card img')).toBeVisible({ timeout: 3000 });
  await expect(page.locator('#m-peek .m-peek-card img')).toHaveAttribute('src', /sample-work\/light-lab-ines/);
  await page.mouse.up();
  await expect(page.locator('#m-peek')).toHaveCount(0);
  // Nobody was chosen: the class list is open and the card has not moved.
  await expect(page.locator('#m-sheet-container .m-roster')).toBeVisible();
  expect(await page.evaluate(() => MGrade.getCurrentIndex())).toBe(0);
  // A quick tap, a moment later, still chooses.
  await page.waitForTimeout(450);
  await row.click();
  await expect(title(page)).toHaveText('Ines Larsen');
});

test('a level on the track, + beside the name, and Late from ⋯ as one chip', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const aid = await openLab(page);
  const card = await goTo(page, 'Marcus Lee');
  const sid = await card.getAttribute('data-sid');
  const crit = card.locator('.m-crit-group').first();

  // − and + show once a level is chosen.
  await expect(crit.locator('.m-score-mods')).toBeHidden();
  const prf = crit.locator('.m-score-btn[data-score="3"]');
  await expect(prf).toHaveText('PRF');
  await prf.click();
  await expect(prf).toHaveClass(/m-score-active/);
  await expect(crit.locator('.m-score-mods')).toBeVisible();
  await crit.locator('.m-mod-btn[data-mod="1"]').click();
  await expect(prf).toHaveText('PRF +');
  const saved = await page.evaluate(
    ([cid, sid, aid]) =>
      (getScores(cid)[sid] || []).filter(e => e.assessmentId === aid).map(e => [e.score, e.mod || 0]),
    [CID, sid, aid],
  );
  expect(saved.length).toBeGreaterThan(0);
  saved.forEach(e => expect(e).toEqual([3, 1]));

  // ⋯: the status as one track, Competencies or Rubric, and Unsubmit.
  await page.locator('.m-grade-more').click();
  const more = page.locator('#m-sheet-container .m-more-sheet');
  await expect(more.locator('.m-status-pill')).toHaveText(['Late', 'Missing', 'Excused']);
  await expect(more.locator('[data-action="m-grade-view"]')).toHaveText('Grade by Competencies');
  await expect(more.locator('[data-action="m-work-unsubmit"]')).toHaveText('Unsubmit');
  await more.locator('.m-status-pill[data-val="LATE"]').click();
  await expect(more).toHaveCount(0);
  expect(await page.evaluate(([cid, sid, aid]) => getAssignmentStatus(cid, sid, aid), [CID, sid, aid])).toBe('LATE');
  // On the card: the status that is set, as one chip.
  await expect(card.locator('.m-grade-chip')).toHaveText('Late');
  expect(errors).toEqual([]);
});

test('Return and Next is held seven seconds, with Undo over the tab bar', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const aid = await openLab(page);
  const ines = await goTo(page, 'Ines Larsen');
  const inesId = await ines.getAttribute('data-sid');
  await scoreAll(ines);
  const next = page.locator('[data-action="m-grade-return-next"]');
  await next.click();
  await expect(title(page)).toHaveText('Marcus Lee');

  // The toast: over the tab bar, clear of the bottom bar, and the buttons of the next card are free.
  const toast = page.locator('#m-toast .m-toast-item');
  await expect(toast).toContainText('Returned to Ines');
  const over = () =>
    page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      const t = r('#m-toast .m-toast-item');
      const tabs = r('#m-tab-bar');
      const undo = r('#m-toast .m-toast-undo');
      return (
        t.top >= tabs.top - 1 &&
        t.bottom <= tabs.bottom + 1 &&
        t.top >= r('#m-grade-return-act').bottom &&
        undo.height >= 43.5
      );
    });
  await expect.poll(over).toBe(true);
  // Nothing is sent yet, and Ines's card already reads Returned.
  expect(await drafts(page, aid, inesId)).toBeGreaterThan(0);
  await settled(page);
  await goTo(page, 'Ines Larsen');
  await expect(page.locator('#m-grade-return .m-returned-mark')).toHaveText('Returned');

  // Undo: back on Ines, the grade still a draft, Return and Next there again.
  await toast.locator('.m-toast-undo').click();
  await expect(title(page)).toHaveText('Ines Larsen');
  await expect(next).toBeEnabled();
  expect(await drafts(page, aid, inesId)).toBeGreaterThan(0);

  // Left alone, it is sent when the seven seconds are up.
  await next.click();
  expect(await drafts(page, aid, inesId)).toBeGreaterThan(0);
  await expect.poll(() => drafts(page, aid, inesId), { timeout: 9000 }).toBe(0);
  await expect(toast).toHaveCount(0);

  // Leaving the grading screen sends a held return at once.
  await expect(title(page)).toHaveText('Marcus Lee');
  const marcus = page.locator('#m-swiper .m-swiper-card').nth(await settled(page));
  const marcusId = await marcus.getAttribute('data-sid');
  await scoreAll(marcus);
  await next.click();
  expect(await drafts(page, aid, marcusId)).toBeGreaterThan(0);
  await page.locator('#m-nav-bar-grade-swiper .m-nav-bar-back').click();
  expect(await drafts(page, aid, marcusId)).toBe(0);
  expect(errors).toEqual([]);
});

test('the last card: Return and Finish, then All Caught Up with the next piece and Done', async ({ page }) => {
  const aid = await openLab(page);
  const cards = await page.locator('#m-swiper .m-swiper-card').count();
  const last = await jumpToLast(page, cards);
  await scoreAll(last);
  await expect(nextBtn(page)).toHaveText('Return and Finish');
  await nextBtn(page).click();
  const done = page.locator('#m-grade-done');
  await expect(done.locator('.m-grade-done-title')).toHaveText('All Caught Up');
  await expect(done.locator('.m-grade-done-line')).toHaveText(/^\d+ returned/);
  // Undo takes the grader back.
  await page.locator('#m-toast .m-toast-undo').click();
  await expect(done).toHaveCount(0);
  await expect(nextBtn(page)).toBeEnabled();
  // Return and Finish again; Done goes back to the Grade list.
  await nextBtn(page).click();
  await expect(done).toBeVisible();
  await done.locator('[data-action="m-back"]').click();
  await expect(page.locator('#m-screen-grade-picker')).toBeVisible();
  // It was sent when the screen was left.
  expect(await page.evaluate(([cid, aid]) => GradeState.draftsWaiting(cid) >= 0 && !!aid, [CID, aid])).toBe(true);
});

async function jumpToLast(page, cards) {
  await jumpTo(page, cards - 1);
  return page.locator('#m-swiper .m-swiper-card').nth(cards - 1);
}

test('in a class that returns as it saves the button is Next Student, and nothing is held', async ({ page }) => {
  await enter(page);
  await page.evaluate(() =>
    saveCourseConfig('sci8', { ...getCourseConfig('sci8'), student_page_enabled: true, return_grades: 'on_save' }),
  );
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  const aid = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Light Refraction Lab').id);
  await page.locator('#m-grade-list .m-tg-row[data-aid="' + aid + '"]').click();
  await expect(page.locator('#m-swiper')).toBeVisible();
  // For Revision is on a student's own card, not a pair's.
  await goTo(page, 'Ines Larsen');
  await expect(nextBtn(page)).toHaveText('Next Student');
  await expect(page.locator('#m-grade-return-act [data-action="m-grade-revision"]')).toHaveText('For Revision');
  const first = await page.evaluate(() => MGrade.getCurrentIndex());
  await nextBtn(page).click();
  await expect.poll(() => settled(page)).toBe(first + 1);
  // No Return, so no Undo.
  await expect(page.locator('#m-toast .m-toast-item')).toHaveCount(0);
  // The last card says Finish, and All Caught Up counts what was graded.
  const cards = await page.locator('#m-swiper .m-swiper-card').count();
  await jumpTo(page, cards - 1);
  await expect(nextBtn(page)).toHaveText('Finish');
  await nextBtn(page).click();
  await expect(page.locator('#m-grade-done .m-grade-done-line')).toHaveText(/ graded/);
  await expect(page.locator('#m-toast .m-toast-item')).toHaveCount(0);
});

test('Full Screen: one criterion at a time over the paper, the dots become the levels given, then Return and Next', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const aid = await openLab(page);
  const card = await goTo(page, 'Marcus Lee');
  const sid = await card.getAttribute('data-sid');
  await card.locator('.m-work-full').click();
  const reader = page.locator('#m-reader');
  await expect(reader).toBeVisible();
  await expect(reader.locator('.m-reader-name')).toHaveText('Marcus Lee');
  await expect(reader.locator('.m-reader-page').first()).toHaveAttribute('src', /sample-work\/light-lab-marcus/);
  const bar = reader.locator('.m-reader-bar');
  const crits = await bar.locator('.m-reader-dot').count();
  expect(crits).toBeGreaterThan(1);
  await expect(bar.locator('.m-reader-dot.is-current')).toHaveCount(1);
  // Each level scored moves the bar to the next criterion left.
  const name0 = await bar.locator('.m-crit-name').textContent();
  await bar.locator('.m-score-btn[data-score="3"]').click();
  await expect(bar.locator('.m-crit-name')).not.toHaveText(name0);
  await expect(bar.locator('.m-reader-dot').first()).toHaveAttribute('data-level', '3');
  for (let i = 1; i < crits; i++) {
    await bar.locator('.m-score-btn[data-score="' + (i % 2 ? 4 : 2) + '"]').click();
    await page.waitForTimeout(260);
  }
  // Every criterion scored: a strip of the levels, outlined where the bar is; the bar's buttons.
  await expect(bar.locator('.m-reader-dot')).toHaveCount(0);
  await expect(bar.locator('.m-reader-chip')).toHaveCount(crits);
  await expect(bar.locator('.m-reader-chip').first()).toHaveText('PRF');
  await bar.locator('.m-reader-chip').nth(1).click();
  await expect(bar.locator('.m-reader-chip.is-current')).toHaveText('EXT');
  await expect(bar.locator('.m-score-btn.m-score-active')).toHaveText('EXT');
  await bar.locator('.m-mod-btn[data-mod="-1"]').click();
  await expect(bar.locator('.m-score-btn.m-score-active')).toHaveText('EXT −');
  // The card under it has the same levels.
  await expect(card.locator('.m-crit-group').nth(1).locator('.m-score-active')).toHaveText('EXT −');
  expect(await drafts(page, aid, sid)).toBeGreaterThan(0);
  await expect(bar.locator('.m-reader-act [data-action="m-grade-revision"]')).toHaveText('For Revision');
  await bar.locator('.m-reader-act .m-grade-return-btn').click();
  await expect(reader).toHaveCount(0);
  await expect(page.locator('#m-toast .m-toast-item')).toContainText('Returned to Marcus');
  expect(errors).toEqual([]);
});

test('the last comment on a criterion waits as a suggestion for the next student', async ({ page }) => {
  await openLab(page);
  const ines = await goTo(page, 'Ines Larsen');
  const crit = card => card.locator('.m-crit-group').first();
  await crit(ines)
    .getByRole('button', { name: /^Comment on / })
    .click();
  await crit(ines).locator('.m-crit-comment').fill('Use "refraction" and "normal" when you explain it.');
  await crit(ines).locator('.m-crit-comment').blur();
  const marcus = await goTo(page, 'Marcus Lee');
  await crit(marcus)
    .getByRole('button', { name: /^Comment on / })
    .click();
  const suggest = crit(marcus).locator('.m-crit-suggest');
  await expect(suggest).toBeVisible();
  await expect(suggest).toContainText('Use "refraction" and "normal" when you explain it.');
  await suggest.click();
  await expect(crit(marcus).locator('.m-crit-comment')).toHaveValue(
    'Use "refraction" and "normal" when you explain it.',
  );
  await expect(suggest).toBeHidden();
});

test('a Standard rubric’s level words are behind the criterion’s chevron', async ({ page }) => {
  await openLab(page, 'Science Fair Proposal');
  const card = page.locator('.m-swiper-card').first();
  const group = card.locator('.m-crit-group').first();
  const hasWords = await page.evaluate(() => {
    const a = getAssessments('sci8').find(x => x.title === 'Science Fair Proposal');
    return Object.values(getRubricById('sci8', a.rubricId).criteria[0].levels || {}).some(t => String(t).trim());
  });
  if (!hasWords) {
    await expect(group.locator('.m-crit-toggle')).toHaveCount(0);
    return;
  }
  const toggle = group.locator('.m-crit-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.click();
  await expect(group.locator('.m-crit-toggle')).toHaveAttribute('aria-expanded', 'true');
  const words = group.locator('.m-level-words-item');
  expect(await words.count()).toBeGreaterThan(0);
  await expect(words.first().locator('.m-level-words-name')).not.toHaveText('');
});

test('turned sideways: the paper at the left, the marks at the right', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await openLab(page);
  const card = await goTo(page, 'Ines Larsen');
  const paper = await card.locator('.m-work').boundingBox();
  const marks = await card.locator('.m-grade-marks').boundingBox();
  expect(paper.x + paper.width).toBeLessThanOrEqual(marks.x + 1);
  expect(Math.abs(paper.y - marks.y)).toBeLessThan(30);
  // The height goes to the paper and the marks; the tab bar steps aside, the bottom bar stays.
  await expect(page.locator('#m-tab-bar')).toBeHidden();
  await expect(nextBtn(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
});

for (const scheme of ['light', 'dark']) {
  test.describe(`${scheme} mode`, () => {
    test.use({ colorScheme: scheme });

    test('the grader is readable: text at least 4.5:1, every tap target at least 44 px', async ({ page }) => {
      await openLab(page);
      const card = await goTo(page, 'Ines Larsen');
      await card.locator('.m-crit-group').first().locator('.m-score-btn[data-score="3"]').click();
      await page.waitForTimeout(300);
      expect(await findLowContrastText(page, { skip: ['.m-work-pages', '.m-work-pin'] })).toEqual([]);
      const small = await page.evaluate(() =>
        [...document.querySelectorAll('#m-screen-grade-swiper button, #m-screen-grade-swiper input')]
          .filter(e => {
            const r = e.getBoundingClientRect();
            return (
              r.width && r.height && r.top >= 0 && r.bottom <= innerHeight && !e.closest('[inert]') && r.height < 43.5
            );
          })
          .map(e => e.outerHTML.slice(0, 90)),
      );
      expect(small).toEqual([]);
    });
  });
}

test('the Grade list: what waits is strong, the line stays only where nothing waits', async ({ page }) => {
  await enter(page);
  const aid = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Light Refraction Lab').id);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  const row = page.locator('#m-grade-list .m-tg-row[data-aid="' + aid + '"]');
  await expect(row.locator('.m-tg-title')).toHaveText('Light Refraction Lab');
  await expect(row.locator('.m-tg-pill')).toHaveText(/^\d+ to Grade$/);
  await expect(row.locator('.m-tg-notin')).toHaveText(/^\d+ Not In$/);
  await expect(row.locator('.m-tg-line')).toHaveCount(0);
  await expect(row.locator('.m-progress-bar')).toBeVisible();
  await expect(row.locator('[data-action="m-grade-row-menu"]')).toHaveAccessibleName('More for Light Refraction Lab');
  // A piece with nothing waiting keeps its line of category and date.
  await page.locator('.m-seg-btn[data-action="m-grade-seg"][data-val="all"]').click();
  const done = page.locator('#m-grade-list .m-tg-row[data-tg="0"]').first();
  await expect(done.locator('.m-tg-line')).toBeVisible();
  await expect(done.locator('.m-tg-pill')).toHaveCount(0);
});

for (const width of [375, 320]) {
  for (const font of FONTS) {
    test(`a criterion's line and the bottom bar fit at ${width} px, ${font} font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 667 });
      await openLab(page);
      const card = await goTo(page, 'Marcus Lee');
      // One short name and one that runs long, both with a level chosen.
      await card
        .locator('.m-crit-name')
        .first()
        .evaluate(el => {
          (el.querySelector('span') || el).textContent =
            'Uses evidence from the investigation to support a scientific explanation of results';
        });
      for (const i of [0, 1])
        await card.locator('.m-crit-group').nth(i).locator('.m-score-btn[data-score="2"]').click();
      await useFont(page, font);

      const fit = await card.evaluate(el => {
        const marks = el.querySelector('.m-grade-marks');
        const box = marks.getBoundingClientRect();
        const pad = parseFloat(getComputedStyle(marks).paddingLeft);
        const out = [...marks.querySelectorAll('*')]
          .filter(e => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && (r.right > box.right - pad + 0.6 || r.left < box.left + pad - 0.6);
          })
          .map(e => String(e.className));
        const hits = (a, b) =>
          a.right > b.left + 0.6 && b.right > a.left + 0.6 && a.bottom > b.top + 0.6 && b.bottom > a.top + 0.6;
        const overlaps = [...marks.querySelectorAll('.m-crit-group')].flatMap(g => {
          const parts = [...g.querySelectorAll('.m-crit-name, .m-mod-btn, .m-crit-comment-btn')]
            .filter(e => e.getBoundingClientRect().width > 0)
            .map(e => ({ name: String(e.className), r: e.getBoundingClientRect() }));
          return parts.flatMap((a, i) =>
            parts
              .slice(i + 1)
              .filter(b => hits(a.r, b.r))
              .map(b => a.name + ' over ' + b.name),
          );
        });
        // The track's four segments are one size, on one line.
        const segs = [...marks.querySelector('.m-score-btns').querySelectorAll('.m-score-btn')].map(b =>
          b.getBoundingClientRect(),
        );
        return {
          out,
          overlaps,
          segWidths: [...new Set(segs.map(r => Math.round(r.width)))].length,
          segTops: [...new Set(segs.map(r => Math.round(r.top)))].length,
          page: document.documentElement.scrollWidth - window.innerWidth,
        };
      });
      expect(fit.out).toEqual([]);
      expect(fit.overlaps).toEqual([]);
      expect(fit.segWidths).toBe(1);
      expect(fit.segTops).toBe(1);
      expect(fit.page).toBeLessThanOrEqual(0);

      // For Revision and Return and Next: side by side, a line each.
      const bar = await page.evaluate(() =>
        [...document.querySelectorAll('#m-grade-return-act button')].map(b => {
          const r = b.getBoundingClientRect();
          return { text: b.textContent, top: Math.round(r.top), height: Math.round(r.height), right: r.right };
        }),
      );
      expect(bar.map(b => b.text)).toEqual(['For Revision', 'Return and Next']);
      expect(bar[0].top).toBe(bar[1].top);
      bar.forEach(b => {
        expect(b.height).toBeLessThanOrEqual(52);
        expect(b.right).toBeLessThanOrEqual(width - 15.5);
      });
    });
  }
}
