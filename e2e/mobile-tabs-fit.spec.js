/**
 * The tabs' top bar, Observe and Bulletins fit a phone at 320, 375 and 390
 * px wide, in the page's font and in the wide stand-in for CI's (e2e/wide-font.js):
 * nothing scrolls sideways, the bar's pieces sit side by side without
 * overlapping, and nothing inside a card runs out of it. Demo Mode, with a
 * long class name, so the bar has its Demo pill, its name and ⋯ to fit.
 */
import { test, expect } from '@playwright/test';
import { FONTS, useFont } from './wide-font.js';

test.use({ viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true });

async function open(page, tab) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.evaluate(() => {
    COURSES[getActiveCourse()].name = 'Science 8 Block A Extended Name';
  });
  await page.locator('.m-tab-item[data-tab="' + tab + '"]').click();
  await expect(page.locator('#m-nav-stack .m-tabbar')).toBeVisible();
}

// The bar's three pieces never overlap, and the sideways scroll is only the faces' own.
const barProblems = page =>
  page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push('page scrolls sideways');
    const bar = document.querySelector('#m-nav-stack .m-tabbar-inner');
    const pieces = [...bar.children].filter(n => n.getBoundingClientRect().width > 0);
    const rects = pieces.map(n => n.getBoundingClientRect());
    rects.forEach((r, i) => {
      if (r.left < -0.5 || r.right > innerWidth + 0.5) out.push('piece ' + i + ' is off the screen');
      if (i && r.left < rects[i - 1].right - 0.5) out.push('piece ' + i + ' overlaps the one before');
    });
    return out;
  });

for (const width of [320, 375, 390]) {
  for (const font of FONTS) {
    test(`Observe and its top bar fit at ${width} px, ${font} font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 667 });
      await open(page, 'observe');
      await useFont(page, font);
      expect(await barProblems(page)).toEqual([]);
      const out = await page.evaluate(() => {
        const bad = [];
        const track = document.querySelector('.m-obs-track').getBoundingClientRect();
        document.querySelectorAll('.m-obs-track .m-seg-btn').forEach(b => {
          if (b.scrollWidth > b.clientWidth + 1) bad.push('track label cut: ' + b.textContent);
          if (b.getBoundingClientRect().height < 43.5) bad.push('track segment under 44 px');
        });
        if (track.right > innerWidth) bad.push('track is wider than the screen');
        document.querySelectorAll('#m-obs-cards .m-obs-card').forEach(card => {
          const box = card.getBoundingClientRect();
          card.querySelectorAll('*').forEach(e => {
            const r = e.getBoundingClientRect();
            if (r.width > 0 && (r.right > box.right + 0.6 || r.left < box.left - 0.6)) bad.push(String(e.className));
          });
        });
        return bad;
      });
      expect(out).toEqual([]);
    });

    test(`Bulletins and its top bar fit at ${width} px, ${font} font`, async ({ page }) => {
      await page.setViewportSize({ width, height: 667 });
      await open(page, 'bulletins');
      await expect(page.locator('.m-bulletin-card').first()).toBeVisible();
      await useFont(page, font);
      expect(await barProblems(page)).toEqual([]);
      const out = await page.evaluate(() => {
        const bad = [];
        document.querySelectorAll('#m-bulletin-feed .m-bulletin-card').forEach(card => {
          const box = card.getBoundingClientRect();
          card.querySelectorAll('.m-bulletin-tile, .m-bulletin-seen, .m-bulletin-reminder').forEach(e => {
            const r = e.getBoundingClientRect();
            if (r.width > 0 && (r.right > box.right + 0.6 || r.left < box.left - 0.6)) bad.push(String(e.className));
            if (e.matches('.m-bulletin-seen') && r.height < 43.5) bad.push('Seen button under 44 px');
          });
        });
        document.querySelectorAll('.m-bulletin-btn').forEach(b => {
          if (b.scrollWidth > b.clientWidth + 1) bad.push('button text cut: ' + b.textContent);
        });
        return bad;
      });
      expect(out).toEqual([]);
    });
  }
}
