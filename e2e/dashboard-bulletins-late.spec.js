/**
 * The Bulletins tile, signed in (slice B1e): until the server answers
 * list_bulletins there is no slot and the Inbox has the whole column; when the
 * answer comes the Dashboard draws its row once more, never over an open menu;
 * and a class whose list fails is not asked for again on every draw.
 * The fake server (helpers.js mockAuth) holds list_bulletins here.
 */
import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents } from './helpers.js';

test.use({ viewport: { width: 1280, height: 800 } });

const CID = '11111111-2222-4333-8444-555555555555';

async function signedIn(page, { hold = true } = {}) {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  // The class gets a server-shaped id: Bulletins is only read for a class the server knows.
  await page.addInitScript(cid => {
    const old = 'sci8';
    Object.keys(localStorage).forEach(k => {
      if (k.endsWith('-' + old)) {
        localStorage.setItem(k.slice(0, -old.length) + cid, localStorage.getItem(k));
        localStorage.removeItem(k);
      }
    });
    const courses = JSON.parse(localStorage.getItem('gb-courses'));
    courses[cid] = Object.assign({}, courses[old], { id: cid });
    delete courses[old];
    localStorage.setItem('gb-courses', JSON.stringify(courses));
    localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
    localStorage.setItem('gb-lastActiveCourse', cid);
    localStorage.setItem('fv-build-dashRow', '1');
    localStorage.setItem('fv-build-bulletins', '1');
  }, CID);
  // The server's answer to list_bulletins: held until the spec lets it go, then failing on demand.
  await page.addInitScript(
    ([hold]) => {
      const answer = {
        bulletins: [
          {
            id: '00000000-0000-4000-8000-00000000c001',
            kind: 'announcement',
            body: 'Bring a calculator tomorrow.',
            posted_at: new Date(Date.now() - 3 * 3600000).toISOString(),
            created_at: new Date(Date.now() - 3 * 3600000).toISOString(),
            seen: 20,
            can_see: 27,
          },
        ],
        can_see: 27,
        no_card: 0,
        paused: 0,
        page_on: true,
        more: false,
      };
      const client = window._supabase;
      const real = client.rpc;
      window.__listCalls = 0;
      window.__listFails = false;
      let release = () => {};
      const held = new Promise(resolve => {
        release = resolve;
      });
      window.__releaseBulletins = () => release({ data: answer, error: null });
      if (!hold) window.__releaseBulletins();
      client.rpc = (name, params) => {
        if (name !== 'list_bulletins') return real(name, params);
        window.__listCalls++;
        if (window.__listFails)
          return Promise.resolve({ data: null, error: { message: 'simulated failure', code: '500' } });
        return held;
      };
    },
    [hold],
  );
}

const height = (page, sel) =>
  page
    .locator(sel)
    .first()
    .evaluate(el => Math.round(el.getBoundingClientRect().height));

test('the answer comes late: no slot at first, then the row is drawn once, and not over an open menu', async ({
  page,
}) => {
  await signedIn(page);
  await page.goto('/dashboard');
  await page.locator('.dash-row').waitFor();
  // Nothing offered yet: the Inbox has the whole column and there is no slot.
  const row = await height(page, '.dash-row');
  expect(await height(page, '.dash-row-inbox')).toBe(row);
  await expect(page.locator('.dash-row-bulletins')).toHaveCount(0);
  await expect(page.locator('.dash-bulletins-tile')).toHaveCount(0);

  // The page settles (its own late draws are over), then a view menu is opened on the row and the server answers.
  await page.waitForTimeout(1500);
  await page.locator('#dash-view-btn-comp').click();
  await expect(page.locator('#dash-view-menu-comp')).toBeVisible();
  await page.evaluate(() => {
    window.__renders = 0;
    const render = PageDashboard.render;
    PageDashboard.render = function () {
      window.__renders++;
      return render.apply(this, arguments);
    };
    window.__releaseBulletins();
  });
  await page.waitForTimeout(2500);
  expect(await height(page, '.dash-row-inbox')).toBe(row);
  await expect(page.locator('.dash-row-bulletins')).toHaveCount(0);
  await expect(page.locator('#dash-view-menu-comp')).toBeVisible();
  expect(await page.evaluate(() => window.__renders)).toBe(0);

  // The menu closes: the row is drawn once more, with the tile under a 299 px Inbox.
  await page.keyboard.press('Escape');
  await expect(page.locator('#dash-view-menu-comp')).toBeHidden();
  await expect.poll(() => page.locator('.dash-bulletins-tile').count(), { timeout: 6000 }).toBe(1);
  // 60 and 40 percent of the row less the 12 px gap.
  expect(Math.abs((await height(page, '.dash-row-inbox')) - (row - 12) * 0.6)).toBeLessThanOrEqual(1);
  expect(Math.abs((await height(page, '.dash-bulletins-tile')) - (row - 12) * 0.4)).toBeLessThanOrEqual(1);
  await expect(page.locator('.dash-bulletins-row')).toHaveCount(1);
  expect(await page.evaluate(() => window.__renders)).toBe(1);
  // No second draw follows.
  await page.waitForTimeout(2500);
  expect(await page.evaluate(() => window.__renders)).toBe(1);
});

test('a list that was read once and then fails keeps its rows and is asked for again only on the 30-second tick', async ({
  page,
}) => {
  await page.clock.install();
  await signedIn(page, { hold: false });
  await page.goto('/dashboard');
  await expect(page.locator('.dash-bulletins-row')).toHaveCount(1);
  // The tile's 30-second timer starts afresh here, so the clock can be moved to just before it.
  await page.evaluate(() => {
    DashBulletins.destroy();
    PageDashboard.render();
    window.__listFails = true;
  });
  const draw = () => page.evaluate(() => PageDashboard.render());
  const calls = () => page.evaluate(() => window.__listCalls);
  const before = await calls();
  // Old enough for the data layer to read again: a Dashboard draw asks, once, and it fails.
  await page.clock.fastForward(16000);
  await draw();
  await expect.poll(calls).toBe(before + 1);
  await page.waitForTimeout(500);
  // More draws do not ask again, and the tile keeps what it showed, with no sentence about it.
  await draw();
  await draw();
  await draw();
  expect(await calls()).toBe(before + 1);
  await expect(page.locator('.dash-bulletins-row')).toHaveCount(1);
  await expect(page.locator('.dash-bulletins-tile')).not.toContainText('could not');
  // The 30-second tick asks.
  await page.clock.fastForward(15000);
  await expect.poll(calls).toBe(before + 2);
  await expect(page.locator('.dash-bulletins-row')).toHaveCount(1);
});
