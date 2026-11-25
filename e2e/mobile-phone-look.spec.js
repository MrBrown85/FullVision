/**
 * The phone's new look, L1 to L3 (docs/plans/phone-look-plan.md).
 * Demo Mode, Science 8, Light Refraction Lab, with the build switch on:
 * the bar names the card on screen and its name opens the class list; a
 * level on the track, + beside the name; Late from ⋯ shown as one chip on
 * the card; the fit of a criterion's line and the bottom bar on a 375 and
 * a 320 px phone, in the page's font and a wide one. L2: the Grade list
 * and Bulletins. L2b: the Write a Bulletin sheet. L3: Return and Next held
 * seven seconds for Undo.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

const CID = 'sci8';

async function openLab(page) {
  await page.addInitScript(() => localStorage.setItem('fv-build-phoneLook', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const aid = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Light Refraction Lab').id);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('#m-grade-list .m-cell[data-aid="' + aid + '"]').click();
  await expect(page.locator('#m-swiper')).toBeVisible();
  return aid;
}

const title = page => page.locator('#m-nav-bar-grade-swiper .m-nav-title-text');

// The class list, then one name on it. Returns that student's card.
async function goTo(page, name) {
  await title(page).click();
  await page.locator('#m-sheet-container .m-roster-row', { hasText: name }).click();
  await expect(title(page)).toHaveText(name);
  await expect(page.locator('#m-sheet-container .m-roster')).toHaveCount(0);
  const idx = await page.evaluate(() => MGrade.getCurrentIndex());
  return page.locator('#m-swiper .m-swiper-card').nth(idx);
}

test('the bar names the card on screen, and its name opens the class list', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openLab(page);
  await expect(page.locator('html')).toHaveClass(/m-look/);
  // A pair's card is named by its two students.
  await expect(title(page)).toHaveText('Aiden and Olivia');
  // The strip of circles is one thin line, a segment a card.
  const strip = await page.evaluate(() =>
    [...document.querySelectorAll('#m-thumb-strip .m-thumb')].map(t => t.getBoundingClientRect().height),
  );
  expect(strip.length).toBe(4);
  strip.forEach(h => expect(h).toBeLessThanOrEqual(4));
  // Competencies | Rubric and Unsubmit are not on the screen; they are under ⋯.
  await expect(page.locator('#m-screen-grade-swiper > .m-grade-view-row')).toBeHidden();
  await expect(page.locator('#m-swiper .m-work-unsubmit').first()).toBeHidden();

  await title(page).click();
  const rows = page.locator('#m-sheet-container .m-roster-row');
  await expect(rows).toHaveText(['Aiden and Olivia', 'Ines Larsen', 'Marcus Lee', 'Sofia Petrov']);
  await expect(rows.nth(0)).toHaveAttribute('aria-current', 'true');
  await rows.nth(2).click();
  await expect(title(page)).toHaveText('Marcus Lee');
  expect(await page.evaluate(() => MGrade.getCurrentIndex())).toBe(2);
  // Last, since Tab can move to another card: drawn as a line, the circles are out of the tab order and the screen reader's way.
  await expect(page.locator('#m-thumb-strip')).toHaveAttribute('inert', '');
  await page.locator('#m-nav-bar-grade-swiper .m-nav-bar-back').focus();
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement.closest('#m-thumb-strip'))).toBe(false);
  }
  expect(errors).toEqual([]);
});

test('a level on the track, + beside the name, and Late from ⋯', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const aid = await openLab(page);
  const card = await goTo(page, 'Marcus Lee');
  const sid = await card.getAttribute('data-sid');
  const crit = card.locator('.m-crit-group').first();

  // − and + show once a level is chosen.
  await expect(crit.locator('.m-score-mods')).toBeHidden();
  const prf = crit.locator('.m-level-btn[data-score="3"]');
  expect(await prf.evaluate(b => getComputedStyle(b, '::before').content)).toBe('"PRF"');
  await prf.click();
  await expect(prf).toHaveClass(/m-score-active/);
  await expect(crit.locator('.m-score-mods')).toBeVisible();
  await crit.locator('.m-mod-btn[data-mod="1"]').click();
  await expect(prf).toHaveAttribute('data-code', 'PRF +');
  const saved = await page.evaluate(
    ([cid, sid, aid]) =>
      (getScores(cid)[sid] || []).filter(e => e.assessmentId === aid).map(e => [e.score, e.mod || 0]),
    [CID, sid, aid],
  );
  expect(saved.length).toBeGreaterThan(0);
  saved.forEach(e => expect(e).toEqual([3, 1]));

  // ⋯: the card's own status control, Competencies or Rubric, and Unsubmit.
  await page.locator('.m-grade-more').click();
  const more = page.locator('#m-sheet-container .m-more-sheet');
  await expect(more.locator('.m-status-pill')).toHaveText(['Missing', 'Excused', 'Late']);
  await expect(more.locator('.m-seg-btn')).toHaveText(['Competencies', 'Rubric']);
  await expect(more.locator('.m-work-unsubmit')).toHaveText('Unsubmit');
  await more.locator('.m-status-pill[data-val="LATE"]').click();
  await expect(more).toHaveCount(0);
  expect(await page.evaluate(([cid, sid, aid]) => getAssignmentStatus(cid, sid, aid), [CID, sid, aid])).toBe('LATE');
  // On the card: the status that is set, as one chip.
  const pills = card.locator('.m-grade-student-header .m-status-pill');
  await expect(pills.filter({ hasText: 'Late' })).toBeVisible();
  await expect(pills.filter({ hasText: 'Missing' })).toBeHidden();
  await expect(pills.filter({ hasText: 'Excused' })).toBeHidden();
  expect(errors).toEqual([]);
});

test('L3: Return and Next is held seven seconds, with Undo over the tab bar', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const aid = await openLab(page);
  const drafts = sid =>
    page.evaluate(([cid, aid, sid]) => GraderWork.draftsIn(cid, aid, [sid]).length, [CID, aid, sid]);
  const score = async card => {
    for (const i of [0, 1, 2])
      await card.locator('.m-crit-group').nth(i).locator('.m-level-btn[data-score="3"]').click();
  };
  const ines = await goTo(page, 'Ines Larsen');
  const inesId = await ines.getAttribute('data-sid');
  await score(ines);
  const next = page.locator('[data-action="m-grade-return-next"]');
  await next.click();
  await expect(title(page)).toHaveText('Marcus Lee');

  // The toast: over the tab bar, clear of the bottom bar and the card.
  const toast = page.locator('#m-toast .m-toast-item');
  await expect(toast).toContainText('Returned to Ines');
  const over = () =>
    page.evaluate(() => {
      const r = s => document.querySelector(s).getBoundingClientRect();
      const t = r('#m-toast .m-toast-item');
      const tabs = r('#m-tab-bar');
      return t.top >= tabs.top && t.bottom <= tabs.bottom && t.top >= r('#m-grade-return-act').bottom;
    });
  // (Polled: with reduced motion the app's styles give every change a 0.01 ms
  // transition, so the new place is reported on the next frame.)
  await expect.poll(over).toBe(true);
  // Nothing is sent yet, and Ines's card already reads Returned.
  expect(await drafts(inesId)).toBeGreaterThan(0);
  // Once the slide to the next card is over, back to hers from the class list.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const s = document.getElementById('m-swiper');
        return Math.abs(s.scrollLeft - MGrade.getCurrentIndex() * s.clientWidth) < 1;
      }),
    )
    .toBe(true);
  await goTo(page, 'Ines Larsen');
  await expect(page.locator('#m-grade-return .m-returned-mark')).toHaveText('Returned');

  // Undo: back on Ines, the grade still a draft, Return and Next there again.
  await toast.locator('.m-toast-undo').click();
  await expect(title(page)).toHaveText('Ines Larsen');
  await expect(next).toBeEnabled();
  expect(await drafts(inesId)).toBeGreaterThan(0);

  // Left alone, it is sent when the seven seconds are up.
  await next.click();
  expect(await drafts(inesId)).toBeGreaterThan(0);
  await expect.poll(() => drafts(inesId), { timeout: 9000 }).toBe(0);
  await expect(toast).toHaveCount(0);

  // Leaving the grading screen sends a held return at once.
  await expect(title(page)).toHaveText('Marcus Lee');
  const marcus = page.locator('#m-swiper .m-swiper-card').nth(await page.evaluate(() => MGrade.getCurrentIndex()));
  const marcusId = await marcus.getAttribute('data-sid');
  await score(marcus);
  await next.click();
  expect(await drafts(marcusId)).toBeGreaterThan(0);
  await page.locator('#m-nav-bar-grade-swiper .m-nav-bar-back').click();
  expect(await drafts(marcusId)).toBe(0);
  expect(errors).toEqual([]);
});

test('L2b: Write a Bulletin has no Posts To line, and Let Students React is a row with its switch at the right', async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem('fv-build-phoneLook', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.locator('.m-tab-item[data-tab="bulletins"]').click();
  await page.locator('[data-m-bulletin="write"]').click();
  const row = page.locator('.m-bulletin-switch');
  await expect(row).toBeVisible();
  await expect(page.locator('.m-bulletin-to')).toBeHidden();
  for (const font of FONTS) {
    await useFont(page, font);
    const at = await row.evaluate(el => {
      const r = e => e.getBoundingClientRect();
      const box = r(el);
      const words = r(el.querySelector('span'));
      const sw = r(el.querySelector('input'));
      return {
        gap: sw.left - words.right,
        right: box.right - sw.right,
        mid: Math.abs((sw.top + sw.bottom) / 2 - (words.top + words.bottom) / 2),
      };
    });
    expect(at.gap, font).toBeGreaterThan(8);
    expect(at.right, font).toBeLessThanOrEqual(14);
    expect(at.mid, font).toBeLessThanOrEqual(2);
  }
  const box = row.locator('input');
  const was = await box.isChecked();
  await box.click();
  expect(await box.isChecked()).toBe(!was);
});

test('L2: the Grade list and Bulletins', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fv-build-phoneLook', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const aid = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Light Refraction Lab').id);

  // A piece with work waiting: its name, what waits, the bar.
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  const row = page.locator('#m-grade-list .m-cell[data-aid="' + aid + '"]');
  await expect(row.locator('.m-tg-pill')).toBeVisible();
  await expect(row.locator('.m-tg-notin')).toBeVisible();
  await expect(row.locator('.m-cell-subtitle')).toBeHidden();
  await expect(row.locator('.m-progress-bar')).toBeVisible();
  // A piece with nothing waiting keeps its line of category and date.
  await page.locator('.m-seg-btn[data-action="m-grade-seg"][data-val="all"]').click();
  const done = page.locator('#m-grade-list .m-cell[data-tg="0"]').first();
  await expect(done.locator('.m-cell-subtitle')).toBeVisible();

  // Bulletins: no large title; "8 Not Seen" is what the Seen line reads.
  await page.locator('.m-tab-item[data-tab="bulletins"]').click();
  const feed = page.locator('#m-bulletin-feed');
  await expect(feed.locator('.m-bulletin-card').first()).toBeVisible();
  await expect(page.locator('.m-bulletin-content > .m-title-large')).toBeHidden();
  const seen = feed.locator('.m-bulletin-seen', { has: page.locator('.m-bulletin-not-seen') }).first();
  await expect(seen.locator('.m-bulletin-not-seen')).toBeVisible();
  // "Seen by 19 of 27" is not shown, and is still read out.
  const quiet = seen.locator('.m-look-sr');
  await expect(quiet).toHaveText(/^Seen by \d+ of \d+ · $/);
  expect(await quiet.evaluate(el => el.getBoundingClientRect().width)).toBeLessThanOrEqual(1);
  for (const font of FONTS) {
    await useFont(page, font);
    const out = await feed.evaluate(el =>
      [...el.querySelectorAll('.m-bulletin-card')].flatMap(card => {
        const box = card.getBoundingClientRect();
        return [...card.querySelectorAll('.m-bulletin-file-line, .m-bulletin-link, .m-bulletin-not-seen')]
          .filter(e => {
            const r = e.getBoundingClientRect();
            return r.width > 0 && (r.right > box.right + 0.6 || r.left < box.left - 0.6);
          })
          .map(e => String(e.className));
      }),
    );
    expect(out, font).toEqual([]);
  }
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
          el.textContent = 'Uses evidence from the investigation to support a scientific explanation of results';
        });
      for (const i of [0, 1])
        await card.locator('.m-crit-group').nth(i).locator('.m-level-btn[data-score="2"]').click();
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
          const parts = [...g.querySelectorAll('.m-crit-name, .m-checks-btn, .m-mod-btn, .m-crit-comment-btn')]
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
        const segs = [...marks.querySelector('.m-score-btns').querySelectorAll('.m-level-btn')].map(b =>
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

/* L5 and L6: the Students card as the student's My Learning, and the
   profile with the student's own words first. */
async function openPhone(page) {
  await page.addInitScript(() => localStorage.setItem('fv-build-phoneLook', '1'));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}
// The card on top of the stack.
const topCard = page => page.locator('.m-card-stack-item[data-depth="0"] .m-sl-card');
// Nothing in `sel` runs past the left or right edge of `box`, less its padding.
const overflow = (page, box, sel) =>
  page.evaluate(
    ([box, sel]) => {
      const b = document.querySelector(box);
      const r = b.getBoundingClientRect();
      const pad = parseFloat(getComputedStyle(b).paddingLeft);
      return [...b.querySelectorAll(sel)]
        .filter(e => {
          const x = e.getBoundingClientRect();
          return x.width > 0 && (x.right > r.right - pad + 0.6 || x.left < r.left + pad - 0.6);
        })
        .map(e => String(e.className));
    },
    [box, sel],
  );

test('L5: the Students card is the student’s My Learning', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openPhone(page);
  const card = topCard(page);
  await expect(card).toBeVisible();
  const sid = await card.locator('.m-sl-profile').getAttribute('data-sid');
  const name = await page.evaluate(sid => displayName(getStudents('sci8').find(s => s.id === sid)), sid);
  await expect(card.locator('.m-sl-name')).toHaveText(name);
  await expect(card.locator('.m-sl-word')).not.toHaveText('');
  await expect(card.locator('.m-sl-bar')).toHaveCount(4);
  await expect(card.locator('.m-sl-observe')).toHaveText('+ Observe');
  await expect(card.locator('.m-sl-profile')).toHaveText('Profile');
  // The newest pieces with a result, at most five, then All N Pieces.
  const rows = card.locator('.m-sl-work .m-sl-row:not(.m-sl-all)');
  expect(await rows.count()).toBeLessThanOrEqual(5);
  await expect(rows.first().locator('.m-sl-pill')).not.toHaveText('');
  await expect(card.locator('.m-sl-all')).toHaveText(/^All \d+ Pieces$/);
  // The old card's competency rows are gone.
  await expect(card.locator('.m-scard-sec-row')).toHaveCount(0);
  // The name opens every student.
  await card.locator('.m-sl-who').click();
  await expect(page.locator('#m-sheet-container #m-student-list')).toBeVisible();
  expect(errors).toEqual([]);
});

test('L6: the profile puts the student’s words first; All Work and Competencies open in place', async ({ page }) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await openPhone(page);
  await topCard(page).locator('.m-sl-profile').click();
  const pageEl = page.locator('#m-screen-student-detail .m-sl-page');
  await expect(pageEl.locator('.m-sl-id .m-sl-id-name')).toBeVisible();
  await expect(pageEl.locator('.m-sl-observe')).toHaveText('+ Observe');
  // The tabs are gone; the rows open in place.
  await expect(page.locator('#m-screen-student-detail .m-st-tab')).toHaveCount(0);
  const work = pageEl.locator('details', { has: page.locator('summary', { hasText: 'All Work' }) });
  await expect(work).not.toHaveAttribute('open', '');
  await work.locator('summary').click();
  await expect(work).toHaveAttribute('open', '');
  await expect(work.locator('.m-assess-compact').first()).toBeVisible();
  const comps = pageEl.locator('details', { has: page.locator('summary', { hasText: 'Competencies' }) });
  await comps.locator('summary').click();
  await expect(comps.locator('.m-section-card, .m-group-header').first()).toBeVisible();
  // A piece in All Work opens the grader on this student.
  await work.locator('.m-assess-compact').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  expect(errors).toEqual([]);
});

for (const width of [375, 320]) {
  for (const font of FONTS) {
    test(`L5 and L6 fit at ${width} px, ${font} font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 700 });
      await openPhone(page);
      await useFont(page, font);
      await expect(topCard(page)).toBeVisible();
      expect(
        await overflow(
          page,
          '.m-card-stack-item[data-depth="0"] .m-sl-card',
          '.m-sl-who, .m-sl-level, .m-sl-acts > *, .m-sl-row, .m-sl-pill',
        ),
      ).toEqual([]);
      // Observe and Profile share one line.
      const acts = await topCard(page)
        .locator('.m-sl-acts > *')
        .evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(acts).size).toBe(1);
      await topCard(page).locator('.m-sl-profile').click();
      await expect(page.locator('#m-screen-student-detail .m-sl-page')).toBeVisible();
      await page.locator('#m-screen-student-detail details summary').evaluateAll(s => s.forEach(x => x.click()));
      const out = await page.evaluate(() =>
        [...document.querySelectorAll('#m-screen-student-detail .m-sl-block')].flatMap(b => {
          const r = b.getBoundingClientRect();
          return [...b.querySelectorAll('.m-sl-bubble, .m-sl-chip, .m-sl-observe, summary, .m-obs-card')]
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
    });
  }
}
