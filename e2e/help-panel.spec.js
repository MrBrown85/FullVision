/**
 * The Help button and panel (onboarding C2) and the Keyboard Shortcuts sheet
 * (C3). The panel sits beside the page: the page narrows, the top bar and the
 * page's toolbar are never covered. The help site's index and fragments are
 * served from fixtures here, so the spec does not depend on the articles.
 */
import { test, expect } from '@playwright/test';

// The service worker would fetch the help files itself, past the fixtures.
test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });

const INDEX = [
  {
    slug: 'create-a-class',
    title: 'Create a Class From the BC Curriculum',
    section: 'Getting Started',
    pages: ['/dashboard'],
    summary: 'Build a class from one or more BC curriculum courses.',
    video: 'create-a-class.mp4',
    demo: null,
  },
  {
    slug: 'add-your-students',
    title: 'Add Your Students',
    section: 'Getting Started',
    pages: ['/dashboard'],
    summary: 'Add students one at a time or import a class list.',
    video: null,
    demo: null,
  },
  {
    slug: 'read-the-gradebook',
    title: 'Read the Gradebook',
    section: 'Gradebook',
    pages: ['/gradebook'],
    summary: 'What each column in the gradebook shows.',
    video: null,
    demo: '/gradebook',
  },
  {
    slug: 'print-grades',
    title: 'Print Grades',
    section: 'Gradebook',
    pages: ['/gradebook'],
    summary: 'Print the class list of grades.',
    video: null,
    demo: null,
  },
  { slug: 'glossary', title: 'Glossary', section: 'Getting Started', pages: [], summary: 'Terms.', video: null },
];
const FRAGMENT =
  '<article class="help-article"><h1>Read the Gradebook</h1><p>The gradebook shows every score in the class.</p>' +
  '<script>window.__ran = true</script><p><a href="print-grades" onclick="window.__ran = true">Print Grades</a></p>' +
  '<img src="img/gradebook.jpg" alt="The gradebook">' +
  '<svg><a xlink:href="javascript:window.__ran=true"><text>x</text></a></svg>' +
  '<a href="javascript:window.__ran=true">Bad</a></article>';

async function serveHelp(page, { fail = false } = {}) {
  await page.route('**/help/index.json', route =>
    fail
      ? route.fulfill({ status: 404, body: 'Not found' })
      : route.fulfill({ contentType: 'application/json', body: JSON.stringify(INDEX) }),
  );
  await page.route('**/help/fragments/*.html', route => route.fulfill({ contentType: 'text/html', body: FRAGMENT }));
  await page.route('**/help/img/*', route => route.fulfill({ status: 404, body: '' }));
}

async function openDemo(page, path = '/dashboard') {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  if (path !== '/dashboard') await page.evaluate(r => window.Router.navigate(r), path);
}

const box = (page, sel) => page.locator(sel).first().boundingBox();
// The first visible control in a toolbar.
const firstControl = (page, bar) =>
  page.evaluate(sel => {
    const el = Array.from(document.querySelectorAll(sel + ' button, ' + sel + ' select, ' + sel + ' input')).find(
      e => e.getBoundingClientRect().width > 0,
    );
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y };
  }, bar);

test('the Help button sits between the sync dot and the account button; the rest of the bar stays put', async ({
  page,
}) => {
  await serveHelp(page);
  await openDemo(page);
  const toggle = await box(page, '[data-action="toggleSidebar"]');
  const tabs = await box(page, '.tb-seg');
  const sync = await box(page, '.tb-sync');
  const help = await box(page, '[data-action="toggleHelp"]');
  const account = await box(page, '.tb-user-btn');
  expect(help.x).toBeGreaterThan(sync.x + sync.width);
  expect(account.x).toBeGreaterThan(help.x + help.width);
  expect(Math.round(help.height)).toBe(30);
  // The toggle, the tabs and the account button are where they were.
  expect(Math.round(toggle.x)).toBe(16);
  expect(Math.abs(tabs.x + tabs.width / 2 - 720)).toBeLessThanOrEqual(1);
  expect(Math.round(account.x + account.width)).toBe(1440 - 16);
});

// The bar's three groups never overlap, from a narrow window up.
for (const width of [700, 768, 820, 900, 1024, 1280]) {
  test(`at ${width} wide the top bar's groups do not overlap`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => localStorage.setItem('td-mobile-pref', 'desktop'));
    await serveHelp(page);
    await openDemo(page, '/observations');
    await page.locator('.tb-seg-active').waitFor();
    const r = await page.evaluate(() => {
      const b = s => document.querySelector(s).getBoundingClientRect();
      const left = Array.from(document.querySelectorAll('.tb-left > *')).reduce(
        (m, el) => Math.max(m, el.getBoundingClientRect().right),
        0,
      );
      const right = Array.from(document.querySelectorAll('.tb-right > *')).reduce(
        (m, el) => Math.min(m, el.getBoundingClientRect().left),
        Infinity,
      );
      const seg = b('.tb-seg');
      const active = b('.tb-seg-active');
      return { left, right, segL: seg.left, segR: seg.right, aL: active.left, aR: active.right, page: innerWidth };
    });
    expect(r.segL).toBeGreaterThanOrEqual(r.left - 0.5);
    expect(r.segR).toBeLessThanOrEqual(r.right + 0.5);
    expect(r.aL).toBeGreaterThanOrEqual(r.segL - 1);
    expect(r.aR).toBeLessThanOrEqual(r.segR + 1);
  });
}

const PAGES = [
  ['/dashboard', '.dash-toolbar'],
  ['/assignments', '.assess-toolbar'],
  ['/gradebook', '.gb-toolbar'],
  ['/reports', '.report-toolbar'],
];
for (const [path, bar] of PAGES) {
  test(`${path}: the panel narrows the page and covers nothing`, async ({ page }) => {
    await serveHelp(page);
    await openDemo(page, path);
    await page.locator(bar).waitFor();
    const before = await box(page, bar);
    const first = await firstControl(page, bar);
    const mainBefore = await box(page, '#main');
    await page.getByRole('button', { name: 'Help' }).click();
    const panel = page.locator('#help-panel');
    await expect(panel).toBeVisible();
    const p = await panel.boundingBox();
    expect(Math.round(p.width)).toBe(400);
    expect(Math.round(p.x + p.width)).toBe(1440);
    // Below the top bar, not over it.
    expect(Math.round(p.y)).toBe(52);
    const after = await box(page, bar);
    const firstAfter = await firstControl(page, bar);
    const mainAfter = await box(page, '#main');
    // Only narrower: the left edge and the first control do not move.
    expect(Math.round(after.x)).toBe(Math.round(before.x));
    expect(Math.round(firstAfter.x)).toBe(Math.round(first.x));
    expect(Math.round(firstAfter.y)).toBe(Math.round(first.y));
    expect(after.x + after.width).toBeLessThanOrEqual(p.x + 1);
    expect(Math.round(mainBefore.width - mainAfter.width)).toBe(400);
  });
}

test('the panel lists the page’s articles and Getting Started, and searches', async ({ page }) => {
  await serveHelp(page);
  await openDemo(page, '/gradebook');
  await page.getByRole('button', { name: 'Help' }).click();
  const panel = page.locator('#help-panel');
  await expect(panel.getByRole('heading', { name: 'Help', level: 2 })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Gradebook', level: 3 })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Read the Gradebook' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Print Grades' })).toBeVisible();
  await expect(panel.getByRole('heading', { name: 'Getting Started', level: 3 })).toBeVisible();
  const create = panel.getByRole('button', { name: /Create a Class From the BC Curriculum/ });
  await expect(create).toContainText('Video');
  // The 2×2 box and the link to the help site.
  await expect(panel.getByRole('button', { name: 'Glossary' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Keyboard Shortcuts' })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'What’s New' })).toHaveAttribute('href', '/help');
  const all = panel.getByRole('link', { name: 'All Help Articles' });
  await expect(all).toHaveAttribute('href', '/help');
  await expect(all).toHaveAttribute('target', '_blank');

  await panel.getByRole('searchbox', { name: 'Search Help' }).fill('print');
  await expect(panel.getByRole('heading', { name: 'Search Results' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Print Grades' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Read the Gradebook' })).toHaveCount(0);
  await expect(page.locator('#help-status')).toHaveText('1 article found.');
  await panel.getByRole('searchbox', { name: 'Search Help' }).fill('zzzz');
  await expect(panel).toContainText('No articles match the search.');
  await panel.getByRole('searchbox', { name: 'Search Help' }).fill('');
  await expect(panel.getByRole('heading', { name: 'Gradebook', level: 3 })).toBeVisible();

  // On the Dashboard its articles are all Getting Started ones: they are
  // listed once, under Getting Started.
  await page.evaluate(() => window.Router.navigate('/dashboard'));
  await expect(panel.getByRole('heading', { name: 'Gradebook', level: 3 })).toHaveCount(0);
  await expect(panel.getByRole('heading', { name: 'Dashboard', level: 3 })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Add Your Students' })).toHaveCount(1);
});

test('an article opens inside the panel, cleaned, with Back and Open in Help Site', async ({ page }) => {
  await serveHelp(page);
  await openDemo(page, '/gradebook');
  await page.getByRole('button', { name: 'Help' }).click();
  const panel = page.locator('#help-panel');
  await panel.getByRole('button', { name: 'Read the Gradebook' }).click();
  const article = panel.locator('#help-article');
  await expect(article).toContainText('The gradebook shows every score in the class.');
  expect(await page.evaluate(() => window.__ran)).toBeUndefined();
  expect(await article.locator('script').count()).toBe(0);
  // One card: the fragment's own article, not one inside another.
  expect(await panel.locator('.help-article').count()).toBe(1);
  expect(await article.locator('svg').count()).toBe(0);
  await expect(article.getByText('Bad')).not.toHaveAttribute('href', /.+/);
  expect(await article.locator('[onclick]').count()).toBe(0);
  await expect(article.locator('img')).toHaveAttribute('src', '/help/img/gradebook.jpg');
  await expect(panel.getByRole('link', { name: 'Open in Help Site' })).toHaveAttribute(
    'href',
    '/help/read-the-gradebook',
  );
  // A link to another article opens it in the panel.
  await article.getByRole('link', { name: 'Print Grades' }).click();
  await expect(panel.getByRole('link', { name: 'Open in Help Site' })).toHaveAttribute('href', '/help/print-grades');
  // Moving to another page keeps the article open where it was.
  await page.evaluate(() => window.Router.navigate('/assignments'));
  await expect(panel.getByRole('link', { name: 'Open in Help Site' })).toHaveAttribute('href', '/help/print-grades');
  await panel.getByRole('button', { name: 'Back' }).click();
  await page.evaluate(() => window.Router.navigate('/gradebook'));
  await expect(panel.getByRole('heading', { name: 'Gradebook', level: 3 })).toBeVisible();
});

test('the panel stays open across a reload; Close Help and Escape close it', async ({ page }) => {
  await serveHelp(page);
  await openDemo(page);
  const helpBtn = page.getByRole('button', { name: 'Help', exact: true });
  await helpBtn.click();
  await expect(helpBtn).toHaveAttribute('aria-expanded', 'true');
  await page.reload();
  await expect(page.locator('#help-panel')).toBeVisible();
  await page.getByRole('button', { name: 'Close Help' }).click();
  await expect(page.locator('#help-panel')).toHaveCount(0);
  await expect(helpBtn).toBeFocused();
  await page.reload();
  await expect(page.locator('[data-action="toggleHelp"]')).toBeVisible();
  await expect(page.locator('#help-panel')).toHaveCount(0);

  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.getByRole('searchbox', { name: 'Search Help' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#help-panel')).toHaveCount(0);
});

test('when the articles cannot be loaded, the panel says so and nothing else', async ({ page }) => {
  await serveHelp(page, { fail: true });
  await openDemo(page);
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const body = page.locator('#help-body');
  await expect(body).toHaveText('Help articles could not be loaded.');
  await expect(page.getByRole('searchbox', { name: 'Search Help' })).toBeHidden();
});

test('? opens Keyboard Shortcuts when no field has the focus', async ({ page }) => {
  await serveHelp(page);
  await openDemo(page);
  await page.locator('#main').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('?');
  const sheet = page.getByRole('dialog', { name: 'Keyboard Shortcuts' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Show Keyboard Shortcuts');
  await expect(sheet).toContainText('Create and Add Another');
  await expect(sheet).toContainText('Comment on the Selected Criterion');
  await expect(sheet.getByRole('button', { name: 'Close' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);

  // Typing ? in a field types it.
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  const search = page.getByRole('searchbox', { name: 'Search Help' });
  await search.fill('');
  await search.press('?');
  await expect(search).toHaveValue('?');
  await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toHaveCount(0);

  // The panel's Keyboard Shortcuts opens it too.
  await search.fill('');
  await page.locator('#help-panel').getByRole('button', { name: 'Keyboard Shortcuts' }).click();
  await expect(page.getByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeVisible();
});

test.describe('narrow window', () => {
  test.use({ viewport: { width: 700, height: 800 } });
  test('the panel opens over the page, under the top bar, within the window', async ({ page }) => {
    await serveHelp(page);
    // A teacher who chose the desktop app on a narrow window.
    await page.addInitScript(() => localStorage.setItem('td-mobile-pref', 'desktop'));
    await openDemo(page);
    await page.getByRole('button', { name: 'Help', exact: true }).click();
    const p = await page.locator('#help-panel').boundingBox();
    const dock = await page.locator('#app-dock').boundingBox();
    expect(Math.round(p.x + p.width)).toBe(700);
    expect(p.width).toBeLessThanOrEqual(400);
    expect(Math.round(p.y)).toBe(Math.round(dock.y + dock.height));
  });
});

test.describe('phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  test('Settings links to the help site', async ({ page }) => {
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/teacher-mobile\//);
    await expect(page.locator('#m-loading')).toBeHidden();
    await page.locator('[data-action="m-settings"]').first().click();
    const sheet = page.locator('#m-sheet-container .m-sheet.m-sheet-visible');
    const link = sheet.getByRole('link', { name: 'Help' });
    await expect(link).toHaveAttribute('href', '/help');
    await expect(link).toHaveAttribute('target', '_blank');
  });
});
