import { test, expect } from '@playwright/test';

/* Handout files (Colin, Nov 17 2026: "+ Add a File"), in Demo Mode. On the
   assessment form a teacher adds, in one pick, a web page with one of its
   two pictures, a text file and an EPUB; the field says which picture was
   not chosen. Saved, Preview as Student lists the three under For This
   Assignment, and each opens over the device as the student page opens it
   (shared/handout-viewer.js):
     the web page in the sealed frame, its scripts running, its picture
     inside it, its saved answers kept by the in-memory storage stand-in,
     nothing of the page around it within reach (not its storage, its
     cookies, its page or its address), and nothing from the internet (no
     web picture, no fetch: no request leaves for another site);
     the text file as text;
     the EPUB in pages, Previous Page and Next Page, and Save to Phone.
   Nothing is sent. */

// The same unzip the viewer reads books with, here to make one (the spec runs as CommonJS).
const { zipSync } = require('../vendor/fflate/fflate.min.js');
const CID = 'sci8';
const SHOTS = process.env.NIGHT_SHOTS || '';
const enc = s => Buffer.from(s, 'utf-8');
// A 1×1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

const LESSON = `<!doctype html>
<html><head><meta charset="utf-8"><title>Lesson 1.1</title></head>
<body>
<h1>Lesson 1.1 Practice</h1>
<img id="map" src="images/map.png" alt="Map">
<img id="chart" src="chart.png" alt="Chart">
<button id="check" onclick="document.getElementById('said').textContent = 'Checked'">Check</button>
<p id="said"></p>
<a id="go" href="https://example.org/read">Read More</a>
<a id="blank" href="https://example.org/blank?typed=hello" target="_blank">Blank</a>
<form id="form" action="https://example.org/form" method="get" target="_blank"><input name="typed" value="hello"></form>
<button id="tries" onclick="tryAll('click')">Try</button>
<p id="opened"></p>
<img id="web" src="https://example.org/map.png" alt="From the web">
<p id="probe"></p>
<p id="kept"></p>
<p id="fetch"></p>
<script>
  var out = [];
  function t(name, f) {
    try { out.push(name + ':read:' + f()); } catch (e) { out.push(name + ':blocked'); }
  }
  t('storage', function () { return localStorage.getItem('fv-secret'); });
  t('session', function () { return sessionStorage.length; });
  t('cookie', function () { return document.cookie; });
  t('parent', function () { return parent.document.title; });
  t('top', function () { return top.location.href; });
  out.push('origin:' + window.origin);
  document.getElementById('probe').textContent = out.join('|');
  // A script may open no window: by window.open, a link's click or a form's submit, with or without a click.
  function tryAll(when) {
    var w = null;
    try { w = window.open('https://example.org/open?typed=hello', '_blank'); } catch (e) {}
    document.getElementById('blank').click();
    try { document.getElementById('form').submit(); } catch (e) {}
    document.getElementById('opened').textContent += when + ':' + (w ? 'window' : 'none') + ' ';
  }
  tryAll('load');
  // A worksheet that saves its answers, with no try: the stand-in keeps them while it is open.
  localStorage.setItem('answer', '42');
  localStorage.score = 7;
  sessionStorage.setItem('step', '3');
  document.getElementById('kept').textContent = [
    localStorage.getItem('answer'), localStorage.score, localStorage.length, Object.keys(localStorage).join('+'),
    sessionStorage.getItem('step'), localStorage.key(0),
  ].join(',');
  // Nothing from the internet: a fetch is refused.
  fetch('https://example.org/answers?typed=hello').then(
    function () { document.getElementById('fetch').textContent = 'fetch:sent'; },
    function () { document.getElementById('fetch').textContent = 'fetch:blocked'; }
  );
</script>
</body></html>`;

function epub() {
  return Buffer.from(
    zipSync({
      mimetype: enc('application/epub+zip'),
      'META-INF/container.xml': enc(
        '<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>',
      ),
      'OEBPS/content.opf': enc(
        '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0"><manifest>' +
          '<item id="c1" href="one.xhtml" media-type="application/xhtml+xml"/>' +
          '<item id="c2" href="two.xhtml" media-type="application/xhtml+xml"/>' +
          '</manifest><spine><itemref idref="c1"/><itemref idref="c2"/></spine></package>',
      ),
      'OEBPS/one.xhtml': enc(
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter One</h1>' +
          '<p>It was a dark and stormy night.</p>'.repeat(60) +
          '</body></html>',
      ),
      'OEBPS/two.xhtml': enc(
        '<html xmlns="http://www.w3.org/1999/xhtml"><body><h1>Chapter Two</h1><p>The morning came.</p></body></html>',
      ),
    }),
  );
}

test('a teacher adds a web page, a text file and an EPUB, and each opens as the student sees it, sealed', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  const posts = [];
  const remote = [];
  page.on('request', r => {
    if (r.method() === 'POST' && /supabase/.test(r.url())) posts.push(r.url());
  });
  // A request the frame's policy stops never leaves: the browser fails it as blocked. Anything else did go.
  page.on('requestfailed', r => {
    if (/example\.org/.test(r.url())) remote.push(r.url() + ' ' + (r.failure() || {}).errorText);
  });
  page.on('response', r => {
    if (/example\.org/.test(r.url())) remote.push(r.url() + ' answered');
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(cid => getAssessments(cid).length > 0 && getStudents(cid).length > 0, CID);
  // Something of the page's own that a handout must never read.
  await page.evaluate(() => {
    localStorage.setItem('fv-secret', 'teacher-only');
    document.cookie = 'fv-cookie=secret; path=/';
  });

  const { sid, aid, segment } = await page.evaluate(cid => {
    setStudentPageSwitch(cid, true);
    const st = sortStudents(getStudents(cid), 'lastName')[0];
    const built = StudentView.fromCache(cid, st.id);
    const p = built.view.work.find(x => x.kind === 'due');
    return { sid: st.id, aid: p ? p.id : '', segment: p ? StudentPageView.segmentOf(p, built.view) : '' };
  }, CID);
  expect(aid).not.toBe('');

  await page.goto('/assignments?course=' + CID);
  await page.waitForSelector('#ac-' + aid);
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), aid);
  const field = page.locator('.af-card-what #af-res');
  await expect(field.locator('.af-res-hint')).toHaveText(
    'A PDF can have up to 20 pages. A web page, text file or EPUB can be up to 20 MB; choose a web page together with its pictures.',
  );

  // + Add a File: the page with one of its two pictures, a text file and a book, in one pick.
  const chooser = page.waitForEvent('filechooser');
  await field.getByRole('button', { name: '+ Add a File' }).click();
  const picker = await chooser;
  expect(picker.isMultiple()).toBe(true);
  await picker.setFiles([
    { name: 'Lesson 1.1 Practice.html', mimeType: 'text/html', buffer: enc(LESSON) },
    { name: 'map.png', mimeType: 'image/png', buffer: PNG },
    { name: 'Reading Notes.txt', mimeType: 'text/plain', buffer: enc('Read pages 4 to 9.\n<b>Not bold</b>') },
    { name: 'The Novel.epub', mimeType: 'application/epub+zip', buffer: epub() },
  ]);
  await expect(field.locator('.af-res-item')).toHaveCount(3, { timeout: 15000 });
  await expect(field.locator('.af-res-item').nth(0)).toContainText('Lesson 1.1 Practice · Web Page ·');
  await expect(field.locator('.af-res-item').nth(1)).toContainText('Reading Notes · Text File ·');
  await expect(field.locator('.af-res-item').nth(2)).toContainText('The Novel · EPUB ·');
  if (SHOTS) await page.locator('.af-card-what').screenshot({ path: SHOTS + '/handout-files-form-1366.png' });
  await expect(field.locator('#af-res-msg')).toHaveText(
    'Lesson 1.1 Practice was added, but this picture it shows was not chosen, so it won’t appear: chart.png. To include it, remove the page and add it again with its pictures. ' +
      'On students’ screens, Lesson 1.1 Practice won’t show its pictures, fonts or scripts from the web (example.org). Handouts load nothing from the internet, to keep students’ information private.',
  );
  await page.locator('[data-action="saveEditAssess"]').click();
  await page.waitForFunction(
    ({ cid, aid }) => getAssessmentResources(cid, aid).length === 3,
    { cid: CID, aid },
    { timeout: 15000 },
  );

  // Preview as Student: For This Assignment lists the three.
  await page.goto('/dashboard?manage=student-page');
  await page.locator('#sp-preview-student').selectOption(sid);
  await page.getByRole('button', { name: 'Open Preview' }).click();
  const dialog = page.getByRole('dialog').first();
  await dialog.getByRole('radio', { name: 'Chromebook' }).click();
  await dialog
    .getByRole('button', { name: new RegExp('^' + (segment === 'upcoming' ? 'Upcoming' : 'Outstanding') + ' \\d+$') })
    .click();
  await dialog.locator('.sp-side-row[data-piece="' + aid + '"]').click();
  const card = dialog.locator('.sp-piece.sp-picked');
  const rows = card.locator('.sp-res [data-act="handout-file"]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Lesson 1.1 Practice');
  await expect(rows.nth(0)).toContainText('Web Page');
  await expect(rows.nth(1)).toContainText('Text File');
  await expect(rows.nth(2)).toContainText('Book');

  // The web page: sealed, its scripts running, its picture inside it.
  await rows.nth(0).click();
  const viewer = page.locator('.ps-device > .hv-layer');
  await expect(viewer.getByRole('heading', { name: 'Lesson 1.1 Practice' })).toBeVisible();
  const iframe = viewer.locator('iframe.hv-frame');
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-forms allow-modals');
  const frame = page.frameLocator('.ps-device > .hv-layer iframe.hv-frame');
  await expect(frame.locator('h1')).toHaveText('Lesson 1.1 Practice');
  // The stand-in storage starts empty (nothing of the page's own), and keeps what the worksheet saves.
  await expect(frame.locator('#probe')).toHaveText(
    'storage:read:null|session:read:0|cookie:blocked|parent:blocked|top:blocked|origin:null',
  );
  await expect(frame.locator('#kept')).toHaveText('42,7,2,answer+score,3,answer');
  // No window opens from a script, at load or inside the student's own click; no question either.
  const popups = [];
  page.context().on('page', p => popups.push(p.url()));
  await frame.locator('#tries').click();
  await expect(frame.locator('#opened')).toHaveText('load:none click:none');
  await page.waitForTimeout(300);
  expect(popups).toEqual([]);
  await expect(viewer.locator('.hv-ask')).toHaveCount(0);
  // The student's own click on a web link: asked first, in FullVision's page, then opened in a new tab.
  await page.context().route('https://example.org/**', route => route.fulfill({ status: 200, body: 'ok' }));
  await frame.locator('#go').click();
  await expect(viewer.getByRole('alertdialog', { name: 'Open a Website' })).toContainText('https://example.org/read');
  expect(popups).toEqual([]);
  await viewer.getByRole('button', { name: 'Cancel' }).click();
  await expect(viewer.locator('.hv-ask')).toHaveCount(0);
  await frame.locator('#go').click();
  const opening = page.context().waitForEvent('page');
  await viewer.getByRole('button', { name: 'Open Website' }).click();
  const tab = await opening;
  await tab.waitForLoadState();
  expect(tab.url()).toBe('https://example.org/read');
  expect(popups).toEqual(['https://example.org/read']);
  await tab.close();
  await page.context().unroute('https://example.org/**');
  // Nothing from the internet: no fetch, no picture.
  await expect(frame.locator('#fetch')).toHaveText('fetch:blocked');
  expect(await frame.locator('#web').evaluate(img => img.naturalWidth)).toBe(0);
  await frame.locator('#check').click();
  await expect(frame.locator('#said')).toHaveText('Checked');
  await expect(frame.locator('#map')).toHaveAttribute('src', /^data:image\/png;base64,/);
  await expect.poll(() => frame.locator('#map').evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
  if (SHOTS) await page.locator('.ps-device').screenshot({ path: SHOTS + '/handout-file-page-chromebook.png' });
  // The frame's own document is the sealed address, under its own policy.
  const sealed = page.frames().find(f => /\/shared\/handout-frame\.html$/.test(f.url()));
  expect(sealed).toBeTruthy();
  expect(await sealed.evaluate(() => String(window.origin))).toBe('null');
  // The page around it is as it was.
  expect(await page.evaluate(() => localStorage.getItem('fv-secret'))).toBe('teacher-only');
  expect(await page.evaluate(() => [localStorage.getItem('answer'), localStorage.getItem('score')])).toEqual([
    null,
    null,
  ]);
  await viewer.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.hv-layer')).toHaveCount(0);

  // The text file: as text.
  await rows.nth(1).click();
  await expect(viewer.locator('pre.hv-text')).toHaveText('Read pages 4 to 9.\n<b>Not bold</b>');
  await expect(viewer.locator('pre.hv-text b')).toHaveCount(0);
  if (SHOTS) await page.locator('.ps-device').screenshot({ path: SHOTS + '/handout-file-text-chromebook.png' });
  await expect(viewer.locator('iframe')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('.hv-layer')).toHaveCount(0);
  // Escape over a file closed only the file.
  await expect(dialog.locator('.sp-piece.sp-picked')).toBeVisible();

  // The EPUB: in pages, sealed, and saved to the phone.
  await rows.nth(2).click();
  const book = page.frameLocator('.ps-device > .hv-layer iframe.hv-frame');
  await expect(book.locator('#fv-book')).toHaveCount(1);
  await expect.poll(() => book.locator('#fv-book').evaluate(el => el.shadowRoot.textContent)).toContain('Chapter One');
  // A long first chapter runs to several pages, one screen wide each.
  await expect(viewer.locator('.hv-count')).toHaveText(/^Part 1 of 2 · Page 1 of \d+$/);
  // Once the layout has settled, the count holds.
  let last = '';
  await expect
    .poll(async () => {
      const now = await viewer.locator('.hv-count').textContent();
      const same = now === last;
      last = now;
      return same;
    })
    .toBe(true);
  const pages = Number((await viewer.locator('.hv-count').textContent()).match(/of (\d+)$/)[1]);
  expect(pages).toBeGreaterThan(1);
  await expect(viewer.getByRole('button', { name: 'Previous Page' })).toBeDisabled();
  if (SHOTS) await page.locator('.ps-device').screenshot({ path: SHOTS + '/handout-file-book-chromebook.png' });
  for (let n = 2; n <= pages; n++) {
    await viewer.getByRole('button', { name: 'Next Page' }).click();
    await expect(viewer.locator('.hv-count')).toHaveText('Part 1 of 2 · Page ' + n + ' of ' + pages);
  }
  await viewer.getByRole('button', { name: 'Next Page' }).click();
  await expect(viewer.locator('.hv-count')).toHaveText('Part 2 of 2 · Page 1 of 1');
  await expect.poll(() => book.locator('#fv-book').evaluate(el => el.shadowRoot.textContent)).toContain('Chapter Two');
  await expect(viewer.getByRole('button', { name: 'Next Page' })).toBeDisabled();
  // Back from the next chapter lands on the last page of the one before.
  await viewer.getByRole('button', { name: 'Previous Page' }).click();
  await expect(viewer.locator('.hv-count')).toHaveText('Part 1 of 2 · Page ' + pages + ' of ' + pages);
  const download = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'Save to Phone' }).click();
  expect((await download).suggestedFilename()).toBe('The Novel.epub');
  await viewer.getByRole('button', { name: 'Back' }).click();
  await expect(page.locator('.hv-layer')).toHaveCount(0);

  // The sealed address alone is sealed too, and draws nothing.
  const alone = await page.context().newPage();
  const res = await alone.goto('/shared/handout-frame.html');
  expect(res.headers()['content-security-policy']).toContain('sandbox allow-scripts');
  expect(res.headers()['content-security-policy']).not.toContain('allow-same-origin');
  expect(await alone.evaluate(() => String(window.origin))).toBe('null');
  await alone.close();

  expect(posts).toEqual([]);
  // The page's web picture was tried, and the policy stopped it; nothing answered from example.org.
  expect(remote).toEqual(['https://example.org/map.png csp']);
  expect(errors).toEqual([]);
});
