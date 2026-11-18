/**
 * Bulletins on the phone (slice B1f, docs/plans/bulletins-plan.md; boards
 * T1 to T4): Demo Mode, Science 8, 390 x 844, with the build flag
 * `bulletins` set on this browser (fv-build-bulletins). Post a Photo takes a
 * made-up picture through the camera's file input (shared/photo-shrink.js
 * makes it smaller in the browser) and it shows first in the feed; nothing
 * is sent. With the flag off the phone has its three tabs as before. One
 * run has motion on. The last three run signed in against a stand-in server
 * (the review's must-fixes 1 to 3: posted once, a desktop delete let go,
 * Take It Back while the post is on its way).
 */
import { test, expect } from '@playwright/test';
import { mockAuth } from './helpers.js';

test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

async function openPhone(page, { flag = true, tab = '', motion = false } = {}) {
  await page.emulateMedia({ reducedMotion: motion ? 'no-preference' : 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.evaluate(
    ({ flag, tab }) => {
      if (flag) localStorage.setItem('fv-build-bulletins', '1');
      else localStorage.removeItem('fv-build-bulletins');
      if (tab) localStorage.setItem('td-mobile-tab', tab);
    },
    { flag, tab },
  );
  await page.reload();
  await expect(page.locator('#m-tab-bar')).toBeVisible();
}

async function openTab(page) {
  await page.locator('.m-tab-item[data-tab="bulletins"]').click();
  await expect(page.locator('#m-screen-bulletins')).toBeVisible();
}

// A picture of a board, drawn in the page: a real JPEG for the camera's input.
async function boardPhoto(page) {
  const b64 = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 1600;
    c.height = 1000;
    const g = c.getContext('2d');
    g.fillStyle = '#2f4f3a';
    g.fillRect(0, 0, 1600, 1000);
    g.fillStyle = '#fff';
    g.font = 'bold 90px sans-serif';
    g.fillText('If… then… because…', 80, 200);
    return c.toDataURL('image/jpeg', 0.9).split(',')[1];
  });
  return { name: 'board.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(b64, 'base64') };
}

// What is out of sight at rest: no sheet, no camera screen, no file input showing.
async function atRest(page) {
  return page.evaluate(() => ({
    camera: !!document.getElementById('m-bulletin-camera'),
    sheet: !!document.querySelector('#m-sheet-container .m-sheet'),
    backdrop: getComputedStyle(document.getElementById('m-sheet-backdrop')).display,
    inputs: [...document.querySelectorAll('input[type=file]')].filter(i => getComputedStyle(i).display !== 'none')
      .length,
  }));
}

test('the fourth tab is last; Post a Photo shows the photo, a caption and the faces reminder, then posts it first', async ({
  page,
}) => {
  await openPhone(page);
  const tabs = page.locator('#m-tab-bar .m-tab-item');
  await expect(tabs).toHaveCount(4);
  expect(await tabs.evaluateAll(els => els.map(e => e.getAttribute('data-tab')))).toEqual([
    'students',
    'observe',
    'grade',
    'bulletins',
  ]);
  await expect(tabs.nth(3)).toBeVisible();
  await openTab(page);
  await expect(page.locator('#m-screen-bulletins .m-title-large')).toHaveText('Bulletins');
  await expect(page.locator('.m-bulletin-card').first()).toBeVisible();
  expect(await atRest(page)).toEqual({ camera: false, sheet: false, backdrop: 'none', inputs: 0 });

  await page.locator('[data-m-bulletin="photo"]').click();
  const cam = page.locator('#m-bulletin-camera');
  await expect(cam).toBeVisible();
  await expect(cam.locator('.m-addwork-shutter')).toBeVisible();
  await expect(cam).toContainText('Posts to Science 8: every student’s phone.');
  const input = cam.locator('input[type=file]');
  await expect(input).toHaveAttribute('capture', 'environment');
  await expect(input).toBeHidden();
  await input.setInputFiles(await boardPhoto(page));
  await expect(cam.locator('.m-bulletin-shot-img')).toBeVisible({ timeout: 15000 });
  await expect(cam.locator('#m-bulletin-caption')).toBeVisible();
  await expect(cam).toContainText('Check the photo for students’ faces before you post.');
  await expect(cam.locator('.m-bulletin-retake')).toBeVisible();
  await cam.locator('#m-bulletin-caption').fill('Tonight’s question');
  await cam.locator('[data-m-bulletin-cam="post"]').click();
  await expect(cam).toHaveCount(0);

  const first = page.locator('.m-bulletin-card').first();
  await expect(first.locator('.m-bulletin-kind')).toHaveText('Photo of the Board');
  await expect(first.locator('.m-bulletin-time')).toHaveText('Just Now');
  await expect(first.locator('.m-bulletin-words')).toHaveText('Tonight’s question');
  await expect(first.locator('.m-bulletin-photo img')).toHaveAttribute('src', /^data:image\/jpeg/);
  await expect(first.locator('.m-bulletin-seen')).toHaveText('Not Seen Yet');
  expect(await atRest(page)).toEqual({ camera: false, sheet: false, backdrop: 'none', inputs: 0 });
});

test('Write a Bulletin posts a reminder with its last day and its assignment', async ({ page }) => {
  await openPhone(page);
  await openTab(page);
  await page.locator('[data-m-bulletin="write"]').click();
  const sheet = page.locator('#m-bulletin-write');
  await expect(sheet).toBeVisible();
  // Quick Poll and Whiteboard are not offered.
  await expect(sheet.locator('[data-m-bulletin="kind"]')).toHaveText(['Announcement', 'Reminder']);
  await sheet.locator('[data-m-bulletin="kind"][data-kind="reminder"]').click();
  await sheet.locator('#m-bulletin-words').fill('Bring your signed lab safety form on Thursday.');
  const until = await page.evaluate(() => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    return (
      d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    );
  });
  await sheet.locator('#m-bulletin-until').fill(until);
  const aid = await page.evaluate(() => getAssessments(getActiveCourse())[0].id);
  await sheet.locator('#m-bulletin-linked').selectOption(aid);
  await sheet.locator('#m-bulletin-react').check();
  await sheet.locator('[data-m-bulletin="post"]').click();
  await expect(page.locator('#m-sheet-container .m-sheet')).toHaveCount(0);

  const card = page.locator('.m-bulletin-card', { hasText: 'Bring your signed lab safety form' });
  await expect(card).toHaveCount(1);
  await expect(card.locator('.m-bulletin-kind')).toHaveText(/^Reminder · Until /);
  const kept = await page.evaluate(
    () => getBulletins(getActiveCourse()).filter(b => b.body === 'Bring your signed lab safety form on Thursday.')[0],
  );
  expect(kept).toMatchObject({
    kind: 'reminder',
    pinned: true,
    pinned_until: until,
    assessment_id: aid,
    reactions_on: true,
  });
});

test('who has seen it: the sheet lists the students not seen first, with Show It Again, and Done closes it', async ({
  page,
}) => {
  await openPhone(page);
  await openTab(page);
  const seen = page.locator('.m-bulletin-seen', { hasText: 'Not Seen' }).first();
  const label = await seen.innerText();
  const n = Number(/(\d+) Not Seen/.exec(label)[1]);
  await seen.click();
  const sheet = page.locator('#m-bulletin-seen-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.m-bulletin-sec')).toHaveText('Not Seen Yet · ' + n);
  await expect(sheet.locator('.m-bulletin-names').first().locator('.m-cell')).toHaveCount(n);
  await expect(sheet.locator('[data-m-bulletin="again"]')).toHaveText('Show It Again on These ' + n + ' Phones');
  await expect(sheet.locator('[data-m-bulletin="show-seen"]')).toHaveText(/^Show Who Has Seen It \(\d+\)$/);
  await sheet.locator('[data-m-bulletin="again"]').click();
  await expect(sheet.locator('[data-m-bulletin="again"]')).toBeDisabled();
  await sheet.locator('[data-m-bulletin="close"]').click();
  await expect(page.locator('#m-sheet-container .m-sheet')).toHaveCount(0);
  await expect(page.locator('#m-sheet-backdrop')).toBeHidden();
});

test('nothing scrolls sideways at 320 px: the feed, Post a Photo and Write a Bulletin', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await openPhone(page);
  await openTab(page);
  const wide = () => page.evaluate(() => document.documentElement.scrollWidth);
  expect(await wide()).toBeLessThanOrEqual(320);
  await page.locator('[data-m-bulletin="photo"]').click();
  await page.locator('#m-bulletin-camera input[type=file]').setInputFiles(await boardPhoto(page));
  await expect(page.locator('#m-bulletin-caption')).toBeVisible({ timeout: 15000 });
  expect(await wide()).toBeLessThanOrEqual(320);
  await page.locator('#m-bulletin-camera [data-m-bulletin-cam="close"]').click();
  await page.locator('[data-m-bulletin="write"]').click();
  await page.locator('#m-bulletin-write [data-m-bulletin="kind"][data-kind="reminder"]').click();
  await page.locator('#m-bulletin-write [data-m-bulletin="add-link"]').click();
  expect(await wide()).toBeLessThanOrEqual(320);
});

test('with the flag off: three tabs, no Bulletins anywhere, and a remembered Bulletins opens on Students', async ({
  page,
}) => {
  await openPhone(page, { flag: false, tab: 'bulletins' });
  await expect(page.locator('#m-tab-bar .m-tab-item:visible')).toHaveCount(3);
  // The page holds no fourth button at all with the flag off.
  await expect(page.locator('.m-tab-item[data-tab="bulletins"]')).toHaveCount(0);
  await expect(page.locator('.m-tab-item[data-tab="students"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#m-screen-bulletins')).toHaveCount(0);
  await expect(page.locator('[class*="m-bulletin-"]:not(.m-bulletin-tab), [id^="m-bulletin-"]')).toHaveCount(0);
  // Nothing of Bulletins is written to the device with the flag off (no Demo Mode samples either).
  for (const t of ['observe', 'grade', 'students']) await page.locator('.m-tab-item[data-tab="' + t + '"]').click();
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => /bulletin/i.test(k)))).toEqual([]);
});

test('with motion on: a new photo glides in at the top, and the feed is not drawn again for a read that changed nothing', async ({
  page,
}) => {
  await openPhone(page, { motion: true });
  await openTab(page);
  const first = page.locator('.m-bulletin-card').first();
  await first.evaluate(el => (el.dataset.mark = 'kept'));
  await page.evaluate(() => MBulletins.refresh(true));
  await expect(page.locator('.m-bulletin-card').first()).toHaveAttribute('data-mark', 'kept');
  await page.locator('[data-m-bulletin="photo"]').click();
  await page.locator('#m-bulletin-camera input[type=file]').setInputFiles(await boardPhoto(page));
  await expect(page.locator('#m-bulletin-caption')).toBeVisible({ timeout: 15000 });
  await page.locator('[data-m-bulletin-cam="post"]').click();
  const added = page.locator('.m-bulletin-card').first();
  await expect(added.locator('.m-bulletin-kind')).toHaveText('Photo of the Board');
  // The card that was first is the same element, moved down (it was not drawn again).
  await expect(page.locator('.m-bulletin-card[data-mark="kept"]')).toHaveCount(1);
});

test('the confirm’s main button is never under the tap that opened it', async ({ page }) => {
  await openPhone(page);
  await openTab(page);
  const id = await page.locator('.m-bulletin-seen').first().getAttribute('data-id');
  for (const y of [680, 700, 720, 725, 740, 760]) {
    await page.evaluate(id => MBulletins.openSeen(id), id);
    const del = page.locator('#m-bulletin-seen-sheet [data-m-bulletin="delete"]');
    await expect(del).toBeVisible();
    // A tap at this height opens the question: the delete button is moved under the finger first.
    await del.evaluate((el, y) => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 195, clientY: y }));
    }, y);
    const ok = page.locator('#m-sheet-container .m-bulletin-confirm-ok');
    await expect(ok).toBeVisible();
    await page.waitForTimeout(400);
    const box = await ok.boundingBox();
    expect(y >= box.y && y <= box.y + box.height, 'tap at ' + y + ' is on the main button').toBe(false);
    await page.locator('#m-sheet-container .m-bulletin-confirm-cancel').click();
    await expect(page.locator('#m-sheet-container .m-sheet')).toHaveCount(0);
  }
});

/* ── Signed in, against a stand-in server (must-fixes 1 to 3) ─────────────── */

const sid = n => 'e2e00000-0000-4000-8000-' + String(n).padStart(12, '0');
const SCID = sid(1);

async function signedIn(page) {
  await mockAuth(page);
  await page.addInitScript(cid => {
    const KEY = 'e2e-blt-server';
    if (!localStorage.getItem(KEY)) {
      const course = { id: cid, name: 'Science 8', gradingSystem: 'proficiency', calcMethod: 'mostRecent' };
      const st = (n, first) => ({ id: 'e2e00000-0000-4000-8000-0000000000' + n, firstName: first, lastName: 'Test' });
      localStorage.setItem('gb-courses', JSON.stringify({ [cid]: course }));
      localStorage.setItem('gb-config', JSON.stringify({ activeCourse: cid }));
      localStorage.setItem('gb-lastActiveCourse', cid);
      localStorage.setItem('gb-students-' + cid, JSON.stringify([st(11, 'Alice'), st(12, 'Bob')]));
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([]));
      localStorage.setItem('fv-build-bulletins', '1');
      localStorage.setItem('td-mobile-tab', 'bulletins');
      localStorage.setItem(KEY, JSON.stringify({ rows: {}, byKey: {}, stored: [], n: 0 }));
    }
    window.__e2eRpcLog = window.__e2eRpcLog || [];
    const read = () => JSON.parse(localStorage.getItem(KEY));
    const write = s => localStorage.setItem(KEY, JSON.stringify(s));
    const ok = data => Promise.resolve({ data, error: null });
    const log = (name, params) => window.__e2eRpcLog.push({ name, params });
    const fresh = s => 'e2e00000-0000-4000-9000-' + String(++s.n).padStart(12, '0');
    const client = window._supabase;
    const real = client.rpc;
    client.rpc = function (name, params) {
      params = params || {};
      const s = read();
      if (name === 'list_bulletins') {
        log(name, params);
        return ok({ bulletins: Object.values(s.rows), more: false, can_see: 2, no_card: 0, paused: 0, page_on: true });
      }
      if (name === 'post_bulletin') {
        log(name, params);
        const answer = () => {
          const t = read();
          if (t.byKey[params.p_idempotency_key]) return ok(t.byKey[params.p_idempotency_key]);
          const id = fresh(t);
          const files = (params.p_files || []).map((f, i) => {
            const fid = fresh(t);
            return {
              id: fid,
              kind: f.kind,
              title: f.title,
              page_count: f.pages,
              status: 'uploading',
              position: i + 1,
              bytes: null,
              finish_by: new Date(Date.now() + 7200000).toISOString(),
              paths: Array.from({ length: f.pages }, (_, n) => cid + '/' + fid + '/' + (n + 1) + '.jpg'),
            };
          });
          const now = new Date().toISOString();
          const row = Object.assign({}, params.p_bulletin, {
            id,
            visible: !files.length,
            posted_at: files.length ? null : now,
            created_at: now,
            idempotency_key: params.p_idempotency_key,
            files,
            seen: 0,
            can_see: 2,
            reactions: { got_it: 0, done: 0, question: 0 },
          });
          t.rows[id] = row;
          t.byKey[params.p_idempotency_key] = { bucket: 'bulletin-files', bulletin: row };
          write(t);
          return ok({ bucket: 'bulletin-files', bulletin: row });
        };
        return window.__bltHoldPost ? window.__bltHoldPost.then(answer) : answer();
      }
      if (name === 'finish_bulletin_file') {
        log(name, params);
        const row = Object.values(s.rows).find(r => r.files.some(f => f.id === params.p_bulletin_file_id));
        if (!row) return ok({ file_id: params.p_bulletin_file_id, status: 'gone' });
        const f = row.files.find(x => x.id === params.p_bulletin_file_id);
        const missing = f.paths.map((p, i) => (s.stored.indexOf(p) < 0 ? i + 1 : 0)).filter(Boolean);
        if (missing.length) return ok({ file_id: f.id, bulletin: row, missing, bad: [] });
        f.status = 'ready';
        if (row.files.every(x => x.status === 'ready')) {
          row.visible = true;
          row.posted_at = new Date().toISOString();
        }
        write(s);
        return ok({ file_id: f.id, bulletin: row });
      }
      if (name === 'delete_bulletin') {
        log(name, params);
        delete s.rows[params.p_bulletin_id];
        write(s);
        return ok({ deleted: true, id: params.p_bulletin_id });
      }
      if (name === 'list_bulletin_seen')
        return ok({
          bulletin_id: params.p_bulletin_id,
          not_seen: [],
          seen: [],
          reactions: {},
          paused: [],
          no_card: [],
        });
      return real(name, params);
    };
    client.storage = {
      from: bucket => ({
        upload: (p, blob, opts) => {
          log('storage.upload', { bucket, path: p, contentType: opts.contentType });
          if (window.__bltUploadFail) return Promise.resolve({ error: { message: 'network: failed to fetch' } });
          const s = read();
          if (!Object.values(s.rows).some(r => r.files.some(f => f.paths.indexOf(p) >= 0)))
            return Promise.resolve({
              error: { message: 'new row violates row-level security policy', statusCode: '403' },
            });
          s.stored.push(p);
          write(s);
          return Promise.resolve({ data: { path: p }, error: null });
        },
        createSignedUrl: (p, seconds) =>
          Promise.resolve({ data: { signedUrl: 'https://fake.supabase.co/storage/sign/' + p }, error: null }),
      }),
    };
  }, SCID);
  await page.route('https://fake.supabase.co/storage/sign/**', route =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: Buffer.from('ffd8ffd9', 'hex') }),
  );
  await page.goto('/teacher-mobile/');
  await expect(page.locator('#m-screen-bulletins')).toBeVisible({ timeout: 15000 });
  await expect(page.locator('[data-m-bulletin="photo"]')).toBeVisible();
}

const rpcs = async (page, name) =>
  page.evaluate(n => window.__e2eRpcLog.filter(c => c.name === n).map(c => c.params), name);
const serverRows = page => page.evaluate(() => Object.values(JSON.parse(localStorage.getItem('e2e-blt-server')).rows));

async function postPhoto(page, caption) {
  await page.locator('[data-m-bulletin="photo"]').click();
  await page.locator('#m-bulletin-camera input[type=file]').setInputFiles(await boardPhoto(page));
  await expect(page.locator('#m-bulletin-caption')).toBeVisible({ timeout: 15000 });
  await page.locator('#m-bulletin-caption').fill(caption);
  await page.locator('[data-m-bulletin-cam="post"]').click();
  await expect(page.locator('#m-bulletin-camera')).toHaveCount(0);
}

test('signed in: posted offline, then three hours later back online, it posts once and shows once', async ({
  page,
  context,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signedIn(page);
  await context.setOffline(true);
  await postPhoto(page, 'From the bus');
  await expect(page.locator('.m-bulletin-card').first()).toContainText('Not Sent Yet');
  await page.evaluate(cid => {
    const k = 'gb-bulletins-pending-' + cid;
    const list = JSON.parse(localStorage.getItem(k));
    list[0].at = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
    localStorage.setItem(k, JSON.stringify(list));
  }, SCID);
  await context.setOffline(false);
  await page.reload();
  await expect.poll(async () => (await serverRows(page)).filter(r => r.visible).length, { timeout: 15000 }).toBe(1);
  await page.evaluate(() => window.v2Queue.flush());
  await page.evaluate(() => MBulletins.refresh(true));
  // Every post the server took, by its key (the page's own log does not outlive the reload).
  const taken = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('e2e-blt-server')).byKey));
  expect(taken.length).toBe(1);
  expect((await serverRows(page)).length).toBe(1);
  await expect(page.locator('.m-bulletin-card')).toHaveCount(1);
  await expect(page.locator('.m-bulletin-card').first()).toContainText('Not Seen Yet');
});

test('signed in: deleted on the desktop while its photo was on its way, the phone lets it go and gives the words back', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signedIn(page);
  await page.evaluate(() => (window.__bltUploadFail = true));
  await postPhoto(page, 'Wrong photo');
  await expect.poll(async () => (await serverRows(page)).length, { timeout: 15000 }).toBe(1);
  // Delete on the desktop.
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('e2e-blt-server'));
    s.rows = {};
    localStorage.setItem('e2e-blt-server', JSON.stringify(s));
    window.__bltUploadFail = false;
  });
  await page.evaluate(() => window.PhotoQueue.send({ force: true }));
  await page.evaluate(() => MBulletins.refresh(true));
  await expect(page.locator('.m-bulletin-card')).toHaveCount(0, { timeout: 15000 });
  expect((await rpcs(page, 'post_bulletin')).length).toBe(1);
  expect(await serverRows(page)).toEqual([]);
  await page.locator('[data-m-bulletin="write"]').click();
  await expect(page.locator('#m-bulletin-words')).toHaveValue('Wrong photo');
});

test('signed in: Take It Back while the post is on its way: the card goes at once, nothing uploads, and the bulletin is deleted', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await signedIn(page);
  await page.evaluate(() => {
    window.__bltHoldPost = new Promise(r => (window.__bltReleasePost = r));
  });
  await postPhoto(page, 'Not this one');
  await expect.poll(async () => (await rpcs(page, 'post_bulletin')).length).toBe(1);
  const card = page.locator('.m-bulletin-card').first();
  await card.locator('[data-m-bulletin="take-back"]').click();
  await page.locator('#m-sheet-container .m-bulletin-confirm-ok').click();
  await expect(page.locator('.m-bulletin-card')).toHaveCount(0);
  await page.evaluate(() => window.__bltReleasePost());
  await expect.poll(async () => (await rpcs(page, 'delete_bulletin')).length, { timeout: 15000 }).toBe(1);
  expect((await rpcs(page, 'delete_bulletin'))[0].p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
  await page.evaluate(() => MBulletins.refresh(true));
  await expect(page.locator('.m-bulletin-card')).toHaveCount(0);
  expect(await rpcs(page, 'storage.upload')).toEqual([]);
  expect(await serverRows(page)).toEqual([]);
});
