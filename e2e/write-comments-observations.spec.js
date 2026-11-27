import { test, expect } from '@playwright/test';

/* The Observations box and its drawer, and the page's layout (docs/plans/write-comments-plan.md,
   decisions 2 and 11), in Demo Mode on Science 8's Report 2, Cece. */
// The student list slides in the real app; these specs measure the end state at once.
test.use({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });

const LONG =
  'Third lab write-up this month handed in late. When we talked she said she finishes the experiment and the data table in class, then means to do the conclusion at home and forgets about it until the next lab. Grandma is staying with the family and evenings are loud. Agreed she will write the conclusion in the last ten minutes of the lab period and hand in whatever she has; I will check her binder on Fridays for the next three weeks.';

async function open(page, { extra = 0 } = {}) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  // One long observation, and `extra` short ones a month apart, so the
  // list is long enough to scroll.
  await page.evaluate(
    ({ text, extra }) => {
      const add = (t, s, day) => {
        addQuickOb('sci8', 'st1', t, ['selfRegulation'], s, 'independent');
        const list = getQuickObs('sci8').st1;
        const ob = list[list.length - 1];
        ob.date = day;
        ob.created = day + 'T18:00:00.000Z';
      };
      add(text, 'concern', '2026-10-29');
      for (let i = 0; i < extra; i++)
        add(
          'Checked in about the lab plan, week ' + (i + 1) + '.',
          'note',
          '2026-09-' + String(10 + i).padStart(2, '0'),
        );
    },
    { text: LONG, extra },
  );
  await page.evaluate(r => window.Router.navigate(r), '/reports?tab=questionnaire&student=st1');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor({ state: 'attached' });
  await page.locator('#wc-head-obs').click();
}

test('the box: the strip, the newest three read only, View All', async ({ page }) => {
  await open(page);
  const card = page.locator('.wc-box[data-part="obs"]');
  await expect(page.locator('#wc-head-obs')).toContainText('Observations');
  await expect(page.locator('#wc-head-obs')).toContainText('Only You');
  await expect(card.locator('.qno-seg-word')).toHaveText(['Strength', 'Growth', 'Concern', 'Note', 'All']);
  await expect(card.locator('.qno-seg-n')).toHaveText(['4', '0', '1', '1', '6']);
  await expect(card.locator('.obs-card')).toHaveCount(3);
  await expect(card.locator('.obs-card-delete')).toHaveCount(0);
  await expect(card.locator('[data-do="wcSay"]')).toHaveCount(0);
  await expect(card.locator('.qno-view-all')).toHaveText('View All 6');
  const text = card.locator('.obs-card', { hasText: 'Third lab write-up' }).locator('.obs-card-text');
  const lines = await text.evaluate(el => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)));
  expect(lines).toBe(2);
});

test('the drawer covers only the left side; the Teacher Comment stays in view', async ({ page }) => {
  await open(page);
  await page.locator('.wc-box[data-part="obs"] [data-action="tqOpenObs"][data-filter="all"]').last().click();
  const drawer = page.locator('#tq-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.qno-panel-title')).toHaveText('Cece’s Observations');
  const d = await drawer.boundingBox();
  const left = await page.locator('.wc-left').boundingBox();
  const comment = await page.locator('.qn-comment').boundingBox();
  const out = await page.locator('#report-output').boundingBox();
  expect(Math.round(d.x)).toBe(Math.round(out.x));
  expect(Math.round(d.x + d.width)).toBeLessThanOrEqual(Math.round(left.x + left.width) + 24);
  expect(d.x + d.width).toBeLessThan(comment.x);
  await expect(page.locator('.qn-comment')).toBeVisible();
  await page.locator('#tq-read').click();
  await expect(page.locator('#tq-narrative')).toBeEditable();
  await page.locator('#tq-drawer .qno-close').focus();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

test('a long observation is cut to four lines with Show More', async ({ page }) => {
  await open(page);
  await page.locator('.wc-box[data-part="obs"] [data-action="tqOpenObs"][data-filter="concern"]').click();
  await expect(page.locator('#tq-obs-showing')).toHaveText('Showing 1 of 6');
  const card = page.locator('#tq-drawer .obs-card', { hasText: 'Third lab write-up' });
  const lines = () =>
    card
      .locator('.obs-card-text')
      .evaluate(el => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)));
  expect(await lines()).toBe(4);
  await expect(card.locator('.qno-more')).toHaveText('Show More');
  await card.locator('.qno-more').click();
  await expect(card.locator('.qno-more')).toHaveText('Show Less');
  expect(await lines()).toBeGreaterThan(4);
  await card.locator('.qno-more').click();
  expect(await lines()).toBe(4);
  await page.locator('#tq-drawer [data-action="tqObsFilter"][data-filter="note"]').click();
  await expect(page.locator('#tq-drawer .qno-item:not([hidden]) .qno-more')).toHaveCount(0);
});

test('a card’s row opens the drawer at that row, in full', async ({ page }) => {
  await open(page);
  await page.locator('.wc-box[data-part="obs"] .obs-card', { hasText: 'Third lab write-up' }).click();
  const card = page.locator('#tq-drawer .obs-card', { hasText: 'Third lab write-up' });
  await expect(card).toHaveClass(/qno-open/);
  await expect(card).toBeInViewport();
  await expect(card.locator('.qno-more')).toHaveText('Show Less');
});

test('the search box keeps its focus and filters as it is typed', async ({ page }) => {
  await open(page);
  await page.locator('.wc-box[data-part="obs"] .qno-view-all').click();
  const box = page.locator('#tq-obs-search');
  await box.click();
  await box.pressSequentially('microscope');
  await expect(box).toBeFocused();
  await expect(page.locator('#tq-drawer .qno-item:not([hidden])')).toHaveCount(1);
  await expect(page.locator('#tq-obs-showing')).toHaveText('Showing 1 of 6');
  await box.fill('nothing like this');
  await expect(page.locator('#tq-drawer .qno-nomatch')).toBeVisible();
  await page.locator('#tq-drawer [data-action="tqObsShowAll"]').click();
  await expect(page.locator('#tq-drawer .qno-item:not([hidden])')).toHaveCount(6);
  await expect(box).toHaveValue('');
});

test('scrolling the drawer keeps the month heading in view', async ({ page }) => {
  await open(page, { extra: 12 });
  await page.locator('.wc-box[data-part="obs"] .qno-view-all').click();
  const list = page.locator('#tq-obs-list');
  const sept = page.locator('#tq-drawer .qno-group[data-month="2026-09"]');
  const head = sept.locator('.qno-month');
  await sept.evaluate(el => {
    const l = el.closest('.qno-panel-list');
    l.scrollTop = el.offsetTop - l.offsetTop + 300;
  });
  const l = await list.boundingBox();
  const h = await head.boundingBox();
  expect(Math.abs(h.y - l.y)).toBeLessThan(2);
  await expect(head).toContainText('September 2026');
});

test('the Teacher Comment stays in view while the left side scrolls', async ({ page }) => {
  await open(page);
  for (const k of ['strength', 'next', 'cls']) await page.locator('#wc-head-' + k).click();
  const right = page.locator('.wc-right');
  const top = (await right.boundingBox()).y;
  await page.locator('.wc-left').evaluate(el => (el.scrollTop = el.scrollHeight));
  expect(await page.locator('.wc-left').evaluate(el => el.scrollTop)).toBeGreaterThan(300);
  expect(Math.round((await right.boundingBox()).y)).toBe(Math.round(top));
  await expect(page.locator('.qn-comment')).toBeInViewport();
});

test('at 1280 px the columns stack, and the drawer takes the full width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  const left = await page.locator('.wc-left').boundingBox();
  const right = await page.locator('.wc-right').boundingBox();
  expect(right.y).toBeGreaterThan(left.y + left.height - 1);
  await page.locator('.wc-box[data-part="obs"] .qno-view-all').click();
  const d = await page.locator('#tq-drawer').boundingBox();
  const out = await page.locator('#report-output').boundingBox();
  expect(Math.round(d.width)).toBe(Math.round(out.width));
});
