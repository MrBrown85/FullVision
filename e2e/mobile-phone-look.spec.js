/**
 * The phone's new look, L1 and L2 (docs/plans/phone-look-plan.md).
 * Demo Mode, Science 8, Light Refraction Lab, with the build switch on:
 * the bar names the card on screen and its name opens the class list; a
 * level on the track, + beside the name; Late from ⋯ shown as one chip on
 * the card; the fit of a criterion's line and the bottom bar on a 375 and
 * a 320 px phone, in the page's font and a wide one. L2: the Grade list
 * and Bulletins.
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
  expect(await seen.evaluate(el => getComputedStyle(el).fontSize)).toBe('0px');
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
