/**
 * The student list and the Help panel slide (by transform) when their buttons
 * are pressed, and the page beside them takes its new width at once, as the
 * slide starts. They end fully open or fully closed, even when pressed again
 * mid-slide. The top tabs' lit pill glides from the page left to the page
 * opened, and so does every other slider's, here and on the phone, even one
 * drawn again on the click. With reduced motion there is no slide or glide: the change is
 * complete at once.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });

async function openDemo(page) {
  await page.route('**/help/index.json', r => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => window.Router.navigate('/assignments'));
  await page.locator('#gb-sidebar').waitFor();
}
const sidebarWidth = page =>
  page.evaluate(() => document.getElementById('sidebar-mount').getBoundingClientRect().width);
const helpWidth = page =>
  page.evaluate(() => {
    const p = document.getElementById('help-panel');
    return p ? p.getBoundingClientRect().width : 0;
  });
const mainWidth = page => page.evaluate(() => document.querySelector('.page-main').getBoundingClientRect().width);

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the student list slides, the page follows, and it ends fully shut and fully open', async ({ page }) => {
    await openDemo(page);
    const full = await sidebarWidth(page);
    const mainFull = await mainWidth(page);
    expect(full).toBeGreaterThan(100);
    // Every frame of the slide, from the press: some frame has the list
    // part-way out (its transform), with the page already at its new width.
    // (A fixed wait missed the middle on a busy machine.)
    const frames = page.evaluate(
      () =>
        new Promise(resolve => {
          const out = [];
          const start = performance.now();
          const tick = () => {
            out.push([
              document.getElementById('gb-sidebar').getBoundingClientRect().left,
              document.querySelector('.page-main').getBoundingClientRect().width,
              getComputedStyle(document.querySelector('.assess-course-select')).display !== 'none',
            ]);
            if (performance.now() - start < 600) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.click('[data-action="toggleSidebar"]');
    const mid = (await frames).filter(([left]) => left > -full && left < 0);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.every(([, m]) => m > mainFull)).toBe(true);
    // The page does not resize frame by frame: one width the whole slide.
    expect(new Set(mid.map(([, m]) => Math.round(m))).size).toBe(1);
    // The toolbar's own class picker waits until the list is gone.
    expect(mid.some(([, , picker]) => picker)).toBe(false);
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    await expect(page.locator('#page-layout')).not.toHaveClass(/sidebar-sliding/);
    await expect(page.locator('.assess-course-select')).toBeVisible();
    await expect(page.locator('#gb-sidebar')).toBeHidden();
    await page.click('[data-action="toggleSidebar"]');
    await expect.poll(() => sidebarWidth(page)).toBe(full);
    await expect(page.locator('#gb-sidebar')).toBeVisible();
    await expect(page.locator('#sidebar-mount')).not.toHaveAttribute('style', /width/);
    // Pressed again and again, quickly: it still settles on the last press.
    for (let i = 0; i < 5; i++) {
      await page.click('[data-action="toggleSidebar"]');
      await page.waitForTimeout(70);
    }
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    await expect.poll(() => mainWidth(page)).toBeGreaterThan(mainFull);
  });

  test('the Help panel slides in and out and ends fully open or gone', async ({ page }) => {
    await openDemo(page);
    const mainFull = await mainWidth(page);
    // Every frame of the slide, from the press: some frame is part-way in.
    // (A fixed wait missed the middle on a busy machine.)
    const frames = page.evaluate(
      () =>
        new Promise(resolve => {
          const out = [];
          const start = performance.now();
          const tick = () => {
            const p = document.getElementById('help-panel');
            out.push(p ? p.getBoundingClientRect().left : -1);
            if (performance.now() - start < 600) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.click('[data-action="toggleHelp"]');
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect((await frames).some(l => l > vw - 400 && l < vw)).toBe(true);
    await expect.poll(() => helpWidth(page)).toBe(400);
    await expect(page.locator('#help-panel')).not.toHaveClass(/help-sliding/);
    expect(await mainWidth(page)).toBeCloseTo(mainFull - 400, 0);
    await page.click('[data-action="toggleHelp"]');
    await expect(page.locator('#help-panel')).toHaveCount(0);
    expect(await mainWidth(page)).toBeCloseTo(mainFull, 0);
    // Quick presses, ending on open then on closed.
    for (let i = 0; i < 3; i++) {
      await page.click('[data-action="toggleHelp"]');
      await page.waitForTimeout(80);
    }
    await expect.poll(() => helpWidth(page)).toBe(400);
    await page.click('[data-action="toggleHelp"]');
    await expect(page.locator('#help-panel')).toHaveCount(0);
  });

  test('the lit tab glides from the page left to the page opened', async ({ page }) => {
    await openDemo(page);
    const left = sel => page.evaluate(q => document.querySelector(q).getBoundingClientRect().left, sel);
    // Every frame from a click: where the gliding pill is, the lit tab's
    // name, and the colour of the lit tab's own pill. It watches until the
    // pill has glided and gone, and a few frames after, not for a fixed time:
    // on GitHub's runners the first visit to Reporting (its scripts load and
    // run) held the glide up past 800 ms, so no frame after it was ever seen.
    // (Giving up after 10 s ends a glide that never comes.)
    const watch = () =>
      page.evaluate(
        () =>
          new Promise(resolve => {
            const out = [];
            const start = performance.now();
            let seenGlide = false;
            let after = 0;
            const tick = () => {
              const glide = document.querySelector('.tb-seg .seg-glide');
              const on = document.querySelector('.tb-seg-active');
              out.push([
                glide ? glide.getBoundingClientRect().left : null,
                on.textContent,
                getComputedStyle(on).backgroundColor,
              ]);
              if (glide) seenGlide = true;
              else if (seenGlide) after++;
              if (after < 5 && performance.now() - start < 10000) requestAnimationFrame(tick);
              else resolve(out);
            };
            requestAnimationFrame(tick);
          }),
      );
    const thumb = await page.evaluate(() => getComputedStyle(document.querySelector('.tb-seg-active')).backgroundColor);
    // Once the glide's pill is gone the tab's own pill is there in full: no
    // frame with neither, and no fade back in.
    const landed = (seen, name) => {
      const after = seen.slice(seen.findIndex(([x]) => x !== null)).filter(([x]) => x === null);
      expect(after.length).toBeGreaterThan(0);
      expect(after.every(([, lit, bg]) => lit === name && bg === thumb)).toBe(true);
    };

    // Assignments to Dashboard: half-way through the glide the pill is part-way there. The glide is held at its
    // middle to look: on GitHub's runners the frames came too far apart to catch it moving (Nov 25, 2026).
    const from = await left('.tb-seg-active');
    const to = await left('.tb-seg-link[data-href="/dashboard"]');
    await page.evaluate(() => {
      window.__mid = null;
      const seen = new MutationObserver(list =>
        list.forEach(m =>
          m.addedNodes.forEach(n => {
            if (!n.classList || !n.classList.contains('seg-glide') || window.__mid !== null) return;
            const anim = n.getAnimations()[0];
            anim.ready.then(() => {
              anim.pause();
              anim.currentTime = anim.effect.getTiming().duration / 2;
              window.__mid = n.getBoundingClientRect().left;
              anim.play();
            });
          }),
        ),
      );
      seen.observe(document.querySelector('#dock-mount'), { childList: true, subtree: true });
    });
    let frames = watch();
    await page.click('.tb-seg-link[data-href="/dashboard"]');
    let seen = await frames;
    const mid = await page.evaluate(() => window.__mid);
    expect(mid).toBeLessThan(from - 5);
    expect(mid).toBeGreaterThan(to + 5);
    landed(seen, 'Dashboard');

    // Reporting loads its scripts on the first visit and draws the tabs
    // twice; the glide still runs and lands.
    frames = watch();
    await page.click('.tb-seg-link[data-href="/reports"]');
    seen = await frames;
    expect(seen.some(([x]) => x !== null)).toBe(true);
    landed(seen, 'Reporting');
    await expect(page.locator('.tb-seg .seg-glide')).toHaveCount(0);
    await expect(page.locator('.tb-seg')).not.toHaveClass(/seg-gliding/);

    // The same tab again (a link inside the page) moves nothing.
    await page.evaluate(() => window.Router.navigate('/reports'));
    await expect(page.locator('.tb-seg .seg-glide')).toHaveCount(0);
  });

  /* On a slow computer the Dashboard's draw holds the glide's start back by
     more than its safety timer, which ended the glide before it moved: the
     pill jumped, and this file's test above failed on GitHub's runners
     (Nov 25, 2026). The timer now counts from the glide's start. */
  test('on a slow computer the lit tab still glides all the way', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'slows the CPU through Chrome DevTools');
    await openDemo(page);
    // Each glide's pill, and whether its glide had run to the end when the pill was taken away.
    await page.evaluate(() => {
      window.__glides = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (frames, opts) {
        const anim = animate.call(this, frames, opts);
        if (this.classList.contains('seg-glide')) window.__glides.push({ el: this, anim, endedAs: null });
        return anim;
      };
      new MutationObserver(list =>
        list.forEach(m =>
          m.removedNodes.forEach(n => {
            const g = window.__glides.find(x => x.el === n || (n.contains && n.contains(x.el)));
            if (g && g.endedAs === null) g.endedAs = g.anim.playState;
          }),
        ),
      ).observe(document.body, { childList: true, subtree: true });
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 12 });
    await page.click('.tb-seg-link[data-href="/dashboard"]');
    await expect(page.locator('.tb-seg-active')).toHaveText('Dashboard');
    await expect(page.locator('.tb-seg .seg-glide')).toHaveCount(0, { timeout: 15000 });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const ended = await page.evaluate(() => window.__glides.map(g => g.endedAs));
    expect(ended.length).toBeGreaterThan(0);
    expect(ended).toEqual(ended.map(() => 'finished'));
  });
});

/* Every frame from a click on `go`: the glide's place, and the lit button's
   name and pill colour in `track`. */
async function glideFrames(page, track, go, ms = 700) {
  const frames = page.evaluate(
    ([track, ms]) =>
      new Promise(resolve => {
        const out = [];
        const start = performance.now();
        const tick = () => {
          const glide = document.querySelector('.seg-glide');
          const t = document.querySelector(track);
          const on = t && SegGlide.lit(t);
          out.push([
            glide ? glide.getBoundingClientRect().left : null,
            on ? on.textContent.trim() : '',
            on ? getComputedStyle(on).backgroundColor : '',
          ]);
          if (performance.now() - start < ms) requestAnimationFrame(tick);
          else resolve(out);
        };
        requestAnimationFrame(tick);
      }),
    [track, ms],
  );
  await page.locator(go).click();
  return frames;
}

/* The glide ran, and once its pill was gone the lit button's own pill was
   there in full: no frame with neither, no fade back in. */
function glidedAndLanded(seen, name, thumb) {
  const first = seen.findIndex(([x]) => x !== null);
  expect(first).toBeGreaterThanOrEqual(0);
  const after = seen.slice(first).filter(([x]) => x === null);
  expect(after.length).toBeGreaterThan(0);
  expect(after.every(([, lit, bg]) => lit.startsWith(name) && bg === thumb)).toBe(true);
}

test.describe('every slider', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a slider drawn again on a click glides and lands (Assignments: Show)', async ({ page }) => {
    await openDemo(page);
    const track = '.atb-show:not(.dash-show)';
    const thumb = await page.evaluate(
      t => getComputedStyle(SegGlide.lit(document.querySelector(t))).backgroundColor,
      track,
    );
    const seen = await glideFrames(page, track, track + ' .seg-btn:nth-child(2)');
    glidedAndLanded(seen, 'Submitted', thumb);
    await expect(page.locator('.seg-glide')).toHaveCount(0);
    await expect(page.locator('.seg-gliding')).toHaveCount(0);
  });

  test("the phone's sliders glide too (Grade: To Return)", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/login.html');
    await page.locator('#demo-mode-btn').click();
    await page.waitForURL(/teacher-mobile\//);
    await page.locator('.m-tab-item[data-tab="observe"]').click();
    const track = '.m-obs-track';
    await page.locator(track).waitFor();
    const thumb = await page.evaluate(
      t => getComputedStyle(SegGlide.lit(document.querySelector(t))).backgroundColor,
      track,
    );
    const seen = await glideFrames(page, track, track + ' .m-seg-btn:nth-child(2)');
    glidedAndLanded(seen, 'Strength', thumb);
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('both panels change at once', async ({ page }) => {
    await openDemo(page);
    const full = await sidebarWidth(page);
    await page.click('[data-action="toggleSidebar"]');
    expect(await sidebarWidth(page)).toBe(0);
    await page.click('[data-action="toggleSidebar"]');
    expect(await sidebarWidth(page)).toBe(full);
    await page.click('[data-action="toggleHelp"]');
    expect(await helpWidth(page)).toBe(400);
    await page.click('[data-action="toggleHelp"]');
    await expect(page.locator('#help-panel')).toHaveCount(0);
  });

  test('the lit tab changes at once', async ({ page }) => {
    await openDemo(page);
    await page.click('.tb-seg-link[data-href="/reports"]');
    await expect(page.locator('.tb-seg-active')).toHaveText('Reporting');
    await expect(page.locator('.tb-seg .seg-glide')).toHaveCount(0);
  });

  test('a slider drawn again changes at once', async ({ page }) => {
    await openDemo(page);
    const seen = await glideFrames(page, '.atb-show', '.atb-show .seg-btn:nth-child(2)', 300);
    expect(seen.every(([x]) => x === null)).toBe(true);
    await expect(page.locator('.atb-show .seg-btn:nth-child(2)')).toHaveAttribute('aria-pressed', 'true');
  });
});

test.describe('closing', () => {
  test.use({ reducedMotion: 'no-preference' });

  // Dialogs and menus close at once, with nothing left fading in the page
  // (Colin, Nov 11: "Close instantly").
  test('a dialog closes at once, even with motion on', async ({ page }) => {
    await openDemo(page);
    await page.evaluate(() => window.showConfirm('Delete?', 'Sure?', 'Delete', 'danger', () => {}));
    await expect(page.locator('.confirm-overlay')).toHaveCount(1);
    await page.keyboard.press('Escape');
    expect(await page.locator('.confirm-overlay').count()).toBe(0);
  });
});
