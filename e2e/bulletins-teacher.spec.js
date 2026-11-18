/**
 * Bulletins, the teacher's page (slice B1c), Demo Mode.
 *
 * The page and its tab draw only with the build switch on
 * (localStorage fv-build-bulletins = 1). Each test starts on the sample
 * class's three sample bulletins.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1280, height: 800 } });

// The clock is pinned before the page loads: Wednesday, Nov 18, 2026 at 13:00 where the browser is, so a heading is
// always the same word whatever time the test runs.
const NOW = new Date('2026-11-18T13:00:00');

async function open(page, { on = true, studentPage = true } = {}) {
  await page.clock.install({ time: NOW });
  if (on) await page.addInitScript(() => localStorage.setItem('fv-build-bulletins', '1'));
  // The front page's Try Demo Mode link (student=1) starts the sample class with the Student Page on.
  await page.goto(studentPage ? '/login.html?student=1' : '/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/dashboard/);
  await page.goto('/bulletins');
}

const feed = page => page.locator('#bulletin-feed');
const cards = page => page.locator('#bulletin-feed .bulletin-post');
const display = (page, selector) =>
  page.evaluate(sel => [...document.querySelectorAll(sel)].map(el => getComputedStyle(el).display), selector);

async function write(page, words) {
  await page.locator('.bulletin-bar-open').click();
  await expect(page.locator('#bulletin-compose')).toBeVisible();
  await page.locator('#bulletin-words').fill(words);
}

test('the Bulletins tab is after Assignments, and the page has the sample bulletins', async ({ page }) => {
  await open(page);
  // The app is still on its loading screen until the open tab is drawn: wait for it before reading the tabs.
  await expect(page.locator('.tb-seg-active')).toHaveText('Bulletins');
  const tabs = await page.locator('.tb-seg-link').allTextContents();
  expect(tabs.slice(0, 3)).toEqual(['Dashboard', 'Assignments', 'Bulletins']);
  await expect(page.locator('.bulletin-title')).toHaveText('Bulletins');
  await expect(page.locator('.bulletin-sub')).toHaveText('27 students can see it');
  await expect(cards(page)).toHaveCount(3);
  // The samples are 2 days back at 8:42 (Monday) and 20 and 37 minutes before now, on Today.
  await expect(feed(page).locator('.bulletin-day')).toHaveText(['Pinned', 'Today']);
  await expect(feed(page).locator('.bulletin-time')).toHaveText(['Monday 8:42 a.m.', '12:40 p.m.', '12:23 p.m.']);
  await expect(feed(page).locator('.bulletin-day').first()).toHaveText('Pinned');
  await expect(cards(page).first().locator('.bulletin-kind-label')).toHaveText('Reminder · Until Fri, Nov 20');
  await expect(cards(page).first().locator('.bulletin-foot')).toContainText('Linked to Cell Microscope Lab');
  await expect(feed(page)).toContainText('Seen by 19 of 27 · 8 Not Seen');
  await expect(feed(page)).toContainText('14 Got It · 2 Have a Question');
  await expect(feed(page)).toContainText('Seen by All 27');
  await expect(feed(page)).toContainText('Photo of the Board');
  await expect(feed(page)).toContainText('PDF · Cell Theory Reading');
});

test('the composer, the menu, the Seen by list and the confirm are out of sight at rest', async ({ page }) => {
  await open(page);
  await expect(cards(page)).toHaveCount(3);
  expect(await display(page, '#bulletin-compose')).toEqual(['none']);
  expect(await display(page, '.bulletin-menu')).toEqual(['none', 'none', 'none']);
  expect(await display(page, '.bulletin-seenlist')).toEqual(['none', 'none', 'none']);
  expect(await display(page, '#bulletin-file-input')).toEqual(['none']);
  await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  await expect(page.locator('.bulletin-bar')).toBeVisible();
});

test('write an announcement: Post waits for words, then the bulletin is first under Today', async ({ page }) => {
  await open(page);
  await page.locator('.bulletin-bar-open').click();
  const post = page.locator('#bulletin-post');
  await expect(post).toBeDisabled();
  await expect(page.locator('#bulletin-compose .btn-primary')).toHaveCount(1); // Post is the only blue button
  await page.locator('#bulletin-words').fill('Bring a calculator tomorrow.');
  await expect(post).toBeEnabled();
  await post.click();
  await expect(page.locator('#bulletin-compose')).toBeHidden();
  await expect(cards(page)).toHaveCount(4);
  const first = feed(page).locator('.bulletin-post', { hasText: 'Bring a calculator tomorrow.' });
  await expect(first.locator('.bulletin-kind-label')).toHaveText('Announcement');
  await expect(first).toContainText('Not Seen Yet');
  // Newest first: it is above the other bulletins of Today (the pinned reminder stays above all).
  const bodies = await cards(page).locator('.bulletin-body').allTextContents();
  expect(bodies[0]).toMatch(/^Lab safety form/);
  expect(bodies[1]).toBe('Bring a calculator tomorrow.');
});

test('the words survive a redraw of the page, and a count shows near the limit', async ({ page }) => {
  await open(page);
  await write(page, 'Half written');
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('fv:bulletins-changed', { detail: {} })));
  await expect(page.locator('#bulletin-words')).toHaveValue('Half written');
  await expect(page.locator('#bulletin-count')).toBeHidden();
  await page.locator('#bulletin-words').fill('x'.repeat(1900));
  await expect(page.locator('#bulletin-count')).toHaveText('1900 of 2000');
  await page.locator('#bulletin-words').fill('x'.repeat(2001));
  await expect(page.locator('#bulletin-count')).toContainText('Over by 1 characters');
  await expect(page.locator('#bulletin-post')).toBeDisabled();
});

test('a reminder takes a date and a linked assessment, and is pinned', async ({ page }) => {
  await open(page);
  await write(page, 'Permission forms are due.');
  await page.getByRole('button', { name: 'Reminder', exact: true }).click();
  await expect(page.locator('#bulletin-words')).toHaveValue('Permission forms are due.');
  const until = new Date();
  until.setDate(until.getDate() + 3);
  const day = `${until.getFullYear()}-${String(until.getMonth() + 1).padStart(2, '0')}-${String(until.getDate()).padStart(2, '0')}`;
  await page.locator('#bulletin-until').fill(day);
  await page.locator('#bulletin-linked').selectOption({ label: 'Immune System Quick Check' });
  await page.locator('#bulletin-post').click();
  const card = feed(page).locator('.bulletin-post', { hasText: 'Permission forms are due.' });
  await expect(card.locator('.bulletin-kind-label')).toContainText('Reminder · Until');
  await expect(card.locator('.bulletin-foot a')).toHaveText('Immune System Quick Check');
  await expect(card.locator('.bulletin-foot a')).toHaveAttribute('href', /\/assignments\?course=sci8&open=sci8a2$/);
  // Pinned, under the heading, above the older pinned reminder (newest first).
  await expect(feed(page).locator('.bulletin-day')).toHaveText(['Pinned', 'Today']);
  await expect(feed(page).locator('.bulletin-post').nth(0)).toContainText('Permission forms are due.');
  await expect(feed(page).locator('.bulletin-post').nth(1)).toContainText('Lab safety form');
});

test('a link is checked, then shows as a card with the site’s name that opens in a new tab', async ({ page }) => {
  await open(page);
  await write(page, 'Watch the first six minutes.');
  await page.getByRole('button', { name: 'Add a Link' }).last().click();
  await page.locator('#bulletin-link-url').fill('ftp://example.com/x');
  await expect(page.locator('#bulletin-link-note')).toHaveText('A link must start with http:// or https://.');
  await expect(page.locator('#bulletin-post')).toBeDisabled();
  await page.locator('#bulletin-link-url').fill('https://good.example.com@evil.example.net/');
  await expect(page.locator('#bulletin-link-note')).toHaveText('A link cannot hold a user name or a password.');
  await expect(page.locator('#bulletin-post')).toBeDisabled();
  await page.locator('#bulletin-link-url').fill('https://www.example.com/watch?v=1');
  await page.locator('#bulletin-link-title').fill('Inside a Cell');
  await expect(page.locator('#bulletin-link-note')).toBeHidden();
  await page.locator('#bulletin-post').click();
  const card = feed(page).locator('.bulletin-post', { hasText: 'Watch the first six minutes.' });
  const link = card.locator('a.bulletin-linkcard');
  await expect(link).toContainText('Inside a Cell');
  await expect(link).toContainText('example.com');
  await expect(link).toContainText('Students are asked before it opens');
  await expect(link).toHaveAttribute('href', 'https://www.example.com/watch?v=1');
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
});

test('pin, edit and delete from the menu; the confirm shows only for Delete', async ({ page }) => {
  await open(page);
  const card = feed(page).locator('.bulletin-post', { hasText: 'Read the Cell Theory pages' });
  const menu = card.locator('.bulletin-menu');
  await expect(menu).toBeHidden();
  await card.locator('.bulletin-more-btn').click();
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText(['Edit', 'Pin', 'Delete']);
  await expect(page.locator('.confirm-overlay')).toHaveCount(0);

  // Pin: it moves up under Pinned.
  await menu.getByRole('menuitem', { name: 'Pin' }).click();
  await expect(feed(page).locator('.bulletin-day').first()).toHaveText('Pinned');
  await expect(feed(page).locator('.bulletin-post').nth(0)).toContainText('Read the Cell Theory pages');
  const pinned = feed(page).locator('.bulletin-post', { hasText: 'Read the Cell Theory pages' });
  await pinned.locator('.bulletin-more-btn').click();
  await expect(pinned.locator('.bulletin-menu').getByRole('menuitem')).toHaveText(['Edit', 'Unpin', 'Delete']);
  await pinned.locator('.bulletin-menu').getByRole('menuitem', { name: 'Unpin' }).click();
  await expect(feed(page).locator('.bulletin-day')).toHaveText(['Pinned', 'Today']);

  // Edit: the box opens on it, files cannot be changed.
  const again = feed(page).locator('.bulletin-post', { hasText: 'Read the Cell Theory pages' });
  await again.locator('.bulletin-more-btn').click();
  await again.getByRole('menuitem', { name: 'Edit' }).click();
  await expect(page.locator('#bulletin-compose')).toBeVisible();
  await expect(page.locator('#bulletin-words')).toHaveValue(/Read the Cell Theory pages/);
  await expect(page.locator('#bulletin-compose')).toContainText('Files cannot be changed after posting.');
  await expect(page.locator('#bulletin-post')).toHaveText('Save');
  await page.locator('#bulletin-words').fill('Read pages 1 and 2 before Thursday.');
  await page.locator('#bulletin-post').click();
  await expect(page.locator('#bulletin-compose')).toBeHidden();
  const edited = feed(page).locator('.bulletin-post', { hasText: 'Read pages 1 and 2 before Thursday.' });
  await expect(edited).toHaveCount(1);
  await expect(edited).toContainText('PDF · Cell Theory Reading'); // the file stays

  // Delete: asks first; Keep It leaves it; Delete removes it.
  await edited.locator('.bulletin-more-btn').click();
  await edited.getByRole('menuitem', { name: 'Delete' }).click();
  const confirm = page.locator('.confirm-overlay');
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText(
    "Delete this bulletin? Students will no longer see it, and who has seen it is deleted too. Its file is deleted and can't come back.",
  );
  await confirm.getByRole('button', { name: 'Keep It' }).click();
  await expect(confirm).toHaveCount(0);
  await expect(cards(page)).toHaveCount(3);
  await edited.locator('.bulletin-more-btn').click();
  await edited.getByRole('menuitem', { name: 'Delete' }).click();
  await page.locator('.confirm-overlay').getByRole('button', { name: 'Delete' }).click();
  await expect(cards(page)).toHaveCount(2);
  await expect(feed(page)).not.toContainText('Read pages 1 and 2');
});

test('Seen by opens the list: not seen first, then Show It Again', async ({ page }) => {
  await open(page);
  const card = feed(page).locator('.bulletin-post', { hasText: 'Read the Cell Theory pages' });
  const list = card.locator('.bulletin-seenlist');
  await expect(list).toBeHidden();
  await card.getByRole('button', { name: /Seen by 19 of 27/ }).click();
  await expect(list).toBeVisible();
  await expect(list).toContainText('Not Seen Yet · 8');
  await expect(list).toContainText('Sam Blackwood');
  await expect(list).toContainText('Caleb Firth');
  await expect(list).toContainText('Have a Question · 2');
  await expect(list).toContainText('Noor Al-Rashid');
  const heads = await list.locator('.bulletin-seen-head').allTextContents();
  expect(heads[0]).toBe('Not Seen Yet · 8');
  await expect(list.getByRole('button', { name: 'Show Who Has Seen It (19)' })).toBeVisible();
  await expect(list).not.toContainText('Jordan Kim'); // seen, no reaction: folded away
  await expect(list).not.toContainText('Got It'); // Got It and Done are counts on the facts line, not lists of names
  await expect(list).not.toContainText('Cece Adeyemi');
  await list.getByRole('button', { name: 'Show Who Has Seen It (19)' }).click();
  await expect(list).toContainText('Jordan Kim');
  await list.getByRole('button', { name: 'Show It Again on These 8 Phones' }).click();
  await expect(list).toContainText('Shown again on 8 phones.');
  // Closing it hides it again.
  await card.getByRole('button', { name: /Seen by 19 of 27/ }).click();
  await expect(list).toBeHidden();
});

test('nothing scrolls sideways at 1280 × 800, with the composer and a list open', async ({ page }) => {
  await open(page);
  await write(page, 'x'.repeat(300));
  const card = feed(page).locator('.bulletin-post', { hasText: 'Read the Cell Theory pages' });
  await card.getByRole('button', { name: /Seen by 19 of 27/ }).click();
  const sideways = await page.evaluate(() => {
    const main = document.getElementById('main');
    const page = document.querySelector('.bulletin-page');
    return {
      doc: document.documentElement.scrollWidth > innerWidth,
      main: main.scrollWidth > main.clientWidth + 1,
      page: page.scrollWidth > page.clientWidth + 1,
    };
  });
  expect(sideways).toEqual({ doc: false, main: false, page: false });
});

test('a class whose Student Page is off says students cannot see Bulletins, and posting still works', async ({
  page,
}) => {
  await open(page, { studentPage: false });
  const note = page.locator('.bulletin-sub');
  await expect(note).toContainText('Students cannot see Bulletins until the Student Page is turned on.');
  await expect(note.getByRole('link', { name: 'Class Settings →' })).toHaveAttribute(
    'href',
    /\/dashboard\?course=sci8&manage=student-page/,
  );
  await write(page, 'Posting still works.');
  await page.locator('#bulletin-post').click();
  await expect(feed(page)).toContainText('Posting still works.');
});

test('with the switch off there is no Bulletins tab and the address opens the Dashboard', async ({ page }) => {
  await open(page, { on: false });
  await expect(page.locator('.tb-seg-active')).toHaveText('Dashboard');
  const tabs = await page.locator('.tb-seg-link').allTextContents();
  expect(tabs).toEqual(['Dashboard', 'Assignments', 'Observations', 'Gradebook', 'Reporting']);
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.locator('.bulletin-page')).toHaveCount(0);
  // With the switch off Demo Mode writes no bulletins at all.
  const kept = await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('gb-bulletins')));
  expect(kept).toEqual([]);
});

test('keyboard focus stays where it was: the menu, a redraw, Cancel and the confirm', async ({ page }) => {
  await open(page);
  const card = feed(page).locator('.bulletin-post', { hasText: 'Read the Cell Theory pages' });
  const more = card.locator('.bulletin-more-btn');
  await more.focus();
  await page.keyboard.press('Enter');
  const menu = card.locator('.bulletin-menu');
  await expect(menu).toBeVisible();
  // Focus moves into the menu, and Escape gives it back to the ⋯ button.
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(more).toBeFocused();
  // The 15-second read finds nothing new: the feed is not drawn again, and focus stays.
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('fv:bulletins-changed', { detail: { cid: 'sci8' } })),
  );
  await expect(more).toBeFocused();
  // A redraw that does happen keeps focus on the same control (a menu opened by the keyboard, then Pin).
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Tab');
  await expect(menu.getByRole('menuitem', { name: 'Pin' })).toBeFocused();
  await page.keyboard.press('Enter');
  const pinned = feed(page).locator('.bulletin-post', { hasText: 'Read the Cell Theory pages' });
  await expect(pinned.locator('.bulletin-more-btn')).toBeFocused();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab'); // Edit, Unpin, Delete
  await expect(pinned.locator('.bulletin-menu').getByRole('menuitem', { name: 'Delete' })).toBeFocused();
  await page.keyboard.press('Enter');
  const confirm = page.locator('.confirm-overlay');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep It' }).click();
  await expect(confirm).toHaveCount(0);
  // The confirm returns focus to the ⋯ button that started it.
  await expect(pinned.locator('.bulletin-more-btn')).toBeFocused();
  // Cancel in the box returns focus to the Write to… button.
  await page.locator('.bulletin-bar-open').click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.locator('.bulletin-bar-open')).toBeFocused();
});

test('a new bulletin glides in (not under Reduce Motion), and nothing fades', async ({ page }) => {
  await open(page);
  await write(page, 'Glide in.');
  await page.locator('#bulletin-post').click();
  const first = feed(page).locator('.bulletin-post', { hasText: 'Glide in.' });
  await expect(first).toHaveClass(/bulletin-glide/);
  // The rule itself (the card may already have finished moving): 200 ms.
  const rule = () =>
    page.evaluate(() => {
      const probe = document.createElement('div');
      probe.className = 'bulletin-glide';
      document.querySelector('.bulletin-col').appendChild(probe);
      const cs = getComputedStyle(probe);
      const out = { name: cs.animationName, duration: cs.animationDuration };
      probe.remove();
      return out;
    });
  expect(await rule()).toEqual({ name: 'bulletin-glide', duration: '0.2s' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect((await rule()).name).toBe('none');
});

test('a photo added in Demo Mode shows its pages, and its thumbnails never link to a data: address', async ({
  page,
}) => {
  await open(page);
  await page.locator('.bulletin-bar-open').click();
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 900;
    canvas.height = 700;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 900, 700);
    ctx.fillStyle = '#123';
    ctx.font = '60px sans-serif';
    ctx.fillText('Board', 80, 300);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/png'));
    const input = document.getElementById('bulletin-file-input');
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'board.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await expect(page.locator('.bulletin-chip')).toContainText('board');
  await expect(page.locator('#bulletin-compose')).toContainText("Check the photo for students' faces before you post.");
  await page.locator('#bulletin-post').click();
  const card = feed(page).locator('.bulletin-post', { hasText: 'Photo of the Board' }).first();
  const thumb = card.locator('.bulletin-thumb-link').first();
  await expect(thumb.locator('img')).toHaveAttribute('src', /^data:image\//);
  expect(await thumb.getAttribute('href')).toBe(null);
});

test('a bulletin that was not posted comes back: into an empty box, or offered under a box that holds words', async ({
  page,
}) => {
  await open(page);
  const returned = at => ({
    key: crypto.randomUUID(),
    at,
    bulletin: { kind: 'announcement', body: 'Words that were refused.' },
    message: 'Words can be up to 2,000 characters.',
  });
  // An empty box: the words come back into it, with one plain sentence.
  await page.evaluate(
    r => localStorage.setItem('gb-bulletins-returned-sci8', JSON.stringify([r])),
    returned(new Date(2026, 10, 16, 12, 17).toISOString()),
  );
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('fv:bulletins-changed', { detail: { cid: 'sci8' } })),
  );
  await expect(page.locator('#bulletin-compose')).toBeVisible();
  await expect(page.locator('#bulletin-words')).toHaveValue('Words that were refused.');
  await expect(page.locator('#bulletin-note')).toHaveText(
    "Your bulletin from Monday at 12:17 p.m. wasn't posted, so its words are back in the box. Words can be up to 2,000 characters.",
  );
  expect(await page.evaluate(() => localStorage.getItem('gb-bulletins-returned-sci8'))).toBe(null);

  // A box that holds new words is never overwritten: the refused words wait as a line that asks first.
  await page.locator('#bulletin-words').fill('Newer words I am typing.');
  await page.evaluate(
    r => localStorage.setItem('gb-bulletins-returned-sci8', JSON.stringify([r])),
    returned(new Date(2026, 10, 18, 9, 5).toISOString()),
  );
  await page.evaluate(() =>
    document.dispatchEvent(new CustomEvent('fv:bulletins-changed', { detail: { cid: 'sci8' } })),
  );
  const line = page.locator('.bulletin-returned-line');
  await expect(line).toContainText("Your bulletin from 9:05 a.m. wasn't posted.");
  await expect(page.locator('#bulletin-words')).toHaveValue('Newer words I am typing.');
  await line.getByRole('button', { name: 'Put It Back in the Box' }).click();
  const confirm = page.locator('.confirm-overlay');
  await expect(confirm).toBeVisible();
  await confirm.getByRole('button', { name: 'Keep What I Have' }).click();
  await expect(page.locator('#bulletin-words')).toHaveValue('Newer words I am typing.');
  await expect(line).toHaveCount(1);
  await line.getByRole('button', { name: 'Put It Back in the Box' }).click();
  await page.locator('.confirm-overlay').getByRole('button', { name: 'Put It Back' }).click();
  await expect(page.locator('#bulletin-words')).toHaveValue('Words that were refused.');
  await expect(line).toHaveCount(0);
});
