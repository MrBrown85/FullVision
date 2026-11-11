import { test, expect } from '@playwright/test';

// A closed card's edit / duplicate / delete (and print, Grade By) buttons
// stay out of its layout: the title and chips use the card's full width,
// hovering moves nothing, and a narrow window puts them on their own row
// once the card is open.

async function openDemoAssignments(page, path = '/assignments?course=sci8', ready = '.assess-card') {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(p => window.Router.navigate(p), path);
  await page.waitForSelector(ready);
}

function cardBoxes(page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('.assess-card')].slice(0, 8).map(c => {
      const r = el => {
        const b = el.getBoundingClientRect();
        return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)];
      };
      return {
        title: c.querySelector('.assess-title').textContent,
        card: r(c),
        titleBox: r(c.querySelector('.assess-title')),
        chips: [...c.querySelectorAll('.assess-meta > *')].map(r),
      };
    }),
  );
}

test('closed cards keep no room for their hidden buttons', async ({ page }) => {
  await openDemoAssignments(page);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll('.assess-card:not(.open)')].map(c => {
        const h = c.querySelector('.assess-header').getBoundingClientRect();
        const meta = c.querySelector('.assess-meta').getBoundingClientRect();
        const chevron = c.querySelector('.assess-chevron').getBoundingClientRect();
        return { gap: Math.round(chevron.left - meta.right), height: Math.round(h.height) };
      }),
    );
    expect(rows.length).toBeGreaterThan(4);
    for (const row of rows) {
      // The chips' row runs up to the chevron, and every card is two lines.
      expect(row.gap).toBeLessThanOrEqual(12);
      expect(row.height).toBe(rows[0].height);
    }
  }
});

test('hovering a closed card moves nothing', async ({ page }) => {
  await openDemoAssignments(page);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.mouse.move(5, 5);
    const before = await cardBoxes(page);
    for (const i of [0, 1, 3, 5]) {
      await page.locator('.assess-card').nth(i).locator('.assess-grip').hover();
      await expect(page.locator('.assess-card').nth(i).locator('.assess-header-actions')).toHaveCSS('opacity', '1');
      expect(await cardBoxes(page)).toEqual(before);
    }
  }
});

test('a narrow window gives an open card its buttons on their own row', async ({ page }) => {
  await openDemoAssignments(page);
  await page.setViewportSize({ width: 768, height: 1024 });
  const lab = page.locator('.assess-card', { hasText: 'Chemical Reactions Lab' }).first();
  const quiz = page.locator('.assess-card', { hasText: 'Data Reading Quiz' }).first();
  const height = loc => loc.locator('.assess-header').evaluate(h => Math.round(h.getBoundingClientRect().height));
  // A rubric card closed is no taller than a plain one.
  expect(await height(lab)).toBe(await height(quiz));
  await expect(lab.locator('.assess-header-actions')).toBeHidden();

  await lab.locator('.assess-title').click();
  await expect(lab).toHaveClass(/open/);
  const r = await lab.evaluate(c => {
    const box = s => c.querySelector(s).getBoundingClientRect();
    return {
      titleH: Math.round(box('.assess-title').height),
      metaBottom: box('.assess-meta').bottom,
      actionsTop: box('.assess-header-actions').top,
    };
  });
  expect(r.titleH).toBeLessThan(30); // one line
  expect(r.actionsTop).toBeGreaterThanOrEqual(r.metaBottom);
});

test('opening an assessment from the Gradebook shows its header', async ({ page }) => {
  await openDemoAssignments(page, '/gradebook?course=sci8', '#gb-colheads');
  const id = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Chemical Reactions Lab').id);
  await page.evaluate(p => window.Router.navigate(p), '/assignments?course=sci8&open=' + id);
  const card = page.locator('#ac-' + id);
  await expect(card).toHaveClass(/open/);
  await page.waitForTimeout(300);
  const r = await page.evaluate(aid => {
    const main = document.getElementById('main').getBoundingClientRect();
    const card = document.getElementById('ac-' + aid).getBoundingClientRect();
    return { mainTop: main.top, cardTop: card.top, cardH: card.height, mainH: main.height };
  }, id);
  expect(r.cardH).toBeGreaterThan(r.mainH); // taller than the window
  expect(r.cardTop).toBeGreaterThanOrEqual(r.mainTop);
  expect(r.cardTop).toBeLessThan(r.mainTop + 60);
});

test('hidden buttons take no clicks: a click there opens the card', async ({ page }) => {
  await openDemoAssignments(page);
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const lab = page.locator('.assess-card', { hasText: 'Chemical Reactions Lab' }).first();
    if (await lab.evaluate(c => c.classList.contains('open'))) await lab.locator('.assess-title').click();
    await expect(lab).not.toHaveClass(/open/);
    // With the mouse away, nothing hidden sits under the ⋯ button's spot.
    await page.mouse.move(5, 5);
    const hit = await lab.evaluate(c => {
      const b = c.querySelector('.assess-more-btn').getBoundingClientRect();
      const el = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return !!el.closest('.assess-header-actions');
    });
    expect(hit).toBe(false);
    // Hovered, a closed card shows its ⋯, not the open grid's Set Everyone To.
    await lab.locator('.assess-grip').hover();
    await expect(lab.locator('.assess-more-btn')).toBeVisible();
    await expect(lab.locator('.assess-setto')).toBeHidden();
    // A click on the header's blank middle opens the card.
    const p = await lab.evaluate(c => {
      const h = c.querySelector('.assess-header').getBoundingClientRect();
      const meta = c.querySelector('.assess-meta').lastElementChild.getBoundingClientRect();
      const act = c.querySelector('.assess-header-actions').getBoundingClientRect();
      return { x: (meta.right + act.left) / 2, y: h.top + h.height / 2 };
    });
    await page.mouse.click(p.x, p.y);
    await expect(lab).toHaveClass(/open/);
    await expect(lab.locator('.assess-body')).toBeVisible();
    await lab.locator('.assess-title').click();
  }
});

test('a touch screen shows no actions on a closed card', async ({ browser }) => {
  const context = await browser.newContext({ hasTouch: true, isMobile: false, viewport: { width: 1024, height: 900 } });
  const page = await context.newPage();
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/);
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const hoverNone = await page.evaluate(() => matchMedia('(hover: none)').matches);
  test.skip(!hoverNone, 'this browser reports a hover device');
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.waitForSelector('.assess-card');
  await expect(page.locator('.assess-card:not(.open) .assess-header-actions').first()).toBeHidden();
  await context.close();
});
