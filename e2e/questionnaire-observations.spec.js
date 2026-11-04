import { test, expect } from '@playwright/test';

/* The Term Questionnaire's Observations card and drawer (Questionnaire
   glance plan, step 5), in Demo Mode on Science 8's Report 2, Cece. */
test.use({ viewport: { width: 1440, height: 900 } });

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
  await page.locator('#tq-narrative').waitFor();
  await page.locator('#report-period').selectOption('Report 2');
  await page.locator('#tq-narrative').waitFor();
}

test('the card: the strip, the newest three read only, View All', async ({ page }) => {
  await open(page);
  const card = page.locator('.qn-obs');
  await expect(card.locator('.qn-card-title')).toHaveText('Observations');
  await expect(card.locator('.qno-seg-word')).toHaveText(['Strength', 'Growth', 'Concern', 'Note', 'All']);
  await expect(card.locator('.qno-seg-n')).toHaveText(['4', '0', '1', '1', '6']);
  await expect(card.locator('.obs-card')).toHaveCount(3);
  await expect(card.locator('.obs-card-delete')).toHaveCount(0);
  await expect(card.locator('.qno-view-all')).toHaveText('View All 6');
  // The long one is cut to two lines on the card.
  const text = card.locator('.obs-card', { hasText: 'Third lab write-up' }).locator('.obs-card-text');
  const lines = await text.evaluate(el => Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)));
  expect(lines).toBe(2);
});

test('the drawer covers only the left column; the Teacher Comment stays in view', async ({ page }) => {
  await open(page);
  const viewAll = page.locator('.qn-obs [data-action="tqOpenObs"][data-filter="all"]').last();
  await viewAll.scrollIntoViewIfNeeded();
  const before = await page.locator('.qn').evaluate(el => el.scrollTop);
  expect(before).toBeGreaterThan(0);
  await viewAll.click();
  const drawer = page.locator('#tq-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('.qno-panel-title')).toHaveText('Cece’s Observations');
  const d = await drawer.boundingBox();
  const left = await page.locator('.qn-left').boundingBox();
  const comment = await page.locator('.qn-comment').boundingBox();
  const out = await page.locator('#report-output').boundingBox();
  expect(Math.round(d.x)).toBe(Math.round(out.x));
  expect(Math.round(d.x + d.width)).toBe(Math.round(left.x + left.width));
  expect(d.x + d.width).toBeLessThan(comment.x);
  await expect(page.locator('.qn-comment')).toBeVisible();
  await expect(page.locator('#tq-narrative')).toBeEditable();
  // Opening it did not move the page under it.
  expect(await page.locator('.qn').evaluate(el => el.scrollTop)).toBe(before);
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
});

test('a long observation is cut to four lines with Show More', async ({ page }) => {
  await open(page);
  await page.locator('.qn-obs [data-action="tqOpenObs"][data-filter="concern"]').click();
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
  // A short one has no Show More.
  await page.locator('#tq-drawer [data-action="tqObsFilter"][data-filter="note"]').click();
  await expect(page.locator('#tq-drawer .qno-item:not([hidden]) .qno-more')).toHaveCount(0);
});

test('a card’s row opens the drawer at that row, in full', async ({ page }) => {
  await open(page);
  await page.locator('.qn-obs .obs-card', { hasText: 'Third lab write-up' }).click();
  const card = page.locator('#tq-drawer .obs-card', { hasText: 'Third lab write-up' });
  await expect(card).toHaveClass(/qno-open/);
  await expect(card).toBeInViewport();
  await expect(card.locator('.qno-more')).toHaveText('Show Less');
});

test('the search box keeps its focus and filters as it is typed', async ({ page }) => {
  await open(page);
  await page.locator('.qn-obs .qno-view-all').click();
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
  await page.locator('.qn-obs .qno-view-all').click();
  const list = page.locator('#tq-obs-list');
  const sept = page.locator('#tq-drawer .qno-group[data-month="2026-09"]');
  const head = sept.locator('.qno-month');
  // Scroll into September's rows: its heading stays at the top of the list.
  await sept.evaluate(el => {
    const l = el.closest('.qno-panel-list');
    l.scrollTop = el.offsetTop - l.offsetTop + 300;
  });
  const l = await list.boundingBox();
  const h = await head.boundingBox();
  expect(Math.abs(h.y - l.y)).toBeLessThan(2);
  await expect(head).toContainText('September 2026');
});

/* The page's layout (Questionnaire glance plan, step 6). */
test('the right column stays in view while the left column scrolls', async ({ page }) => {
  await open(page);
  const right = page.locator('.qn-right');
  const top = (await right.boundingBox()).y;
  expect(Math.round(top)).toBe(123);
  await page.locator('.qn').evaluate(el => (el.scrollTop = el.scrollHeight));
  expect(await page.locator('.qn').evaluate(el => el.scrollTop)).toBeGreaterThan(500);
  expect(Math.round((await right.boundingBox()).y)).toBe(123);
  await expect(page.locator('.qn-comment')).toBeInViewport();
});

// Colin, Nov 4: on a wide screen the left column had grown to fill it; it
// stays 470 px, and the right column takes the rest.
test('on a wide screen the left column keeps 470 px with the list shown, and grows by the list when hidden', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await open(page);
  expect(Math.round((await page.locator('.qn-left').boundingBox()).width)).toBe(470);
  const right = Math.round((await page.locator('.qn-right').boundingBox()).width);
  expect(right).toBeGreaterThan(1000);
  await page.evaluate(() => toggleSidebar());
  await expect.poll(async () => Math.round((await page.locator('.qn-left').boundingBox()).width)).toBe(710);
  expect(Math.round((await page.locator('.qn-right').boundingBox()).width)).toBe(right);
  await page.evaluate(() => toggleSidebar());
});

test('with the student list hidden the left column grows; the right keeps its width', async ({ page }) => {
  await open(page);
  expect(Math.round((await page.locator('.qn-left').boundingBox()).width)).toBe(470);
  expect(Math.round((await page.locator('.qn-right').boundingBox()).width)).toBe(670);
  await page.evaluate(() => toggleSidebar());
  await expect(page.locator('.page-layout.sidebar-hidden')).toHaveCount(1);
  await expect.poll(async () => Math.round((await page.locator('.qn-left').boundingBox()).width)).toBe(710);
  expect(Math.round((await page.locator('.qn-right').boundingBox()).width)).toBe(670);
  // The drawer still stops where the left column ends.
  await page.locator('.qn-obs .qno-view-all').click();
  const d = await page.locator('#tq-drawer').boundingBox();
  const left = await page.locator('.qn-left').boundingBox();
  expect(Math.round(d.x + d.width)).toBe(Math.round(left.x + left.width));
  await page.evaluate(() => toggleSidebar());
});

test('at 1280 px the columns stack as before', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await open(page);
  const left = await page.locator('.qn-left').boundingBox();
  const right = await page.locator('.qn-right').boundingBox();
  expect(right.y).toBeGreaterThan(left.y + left.height - 1);
  expect(await page.locator('.qn-right').evaluate(el => getComputedStyle(el).position)).toBe('static');
  await page.locator('.qn-obs .qno-view-all').click();
  const d = await page.locator('#tq-drawer').boundingBox();
  const out = await page.locator('#report-output').boundingBox();
  expect(Math.round(d.width)).toBe(Math.round(out.width));
});
