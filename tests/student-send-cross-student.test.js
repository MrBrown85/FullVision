/* A send left on Not Sent Yet belongs to the student who made it (M1 of
   the Send Work wiring review). When a session ends without Done (15 idle
   minutes, Done in another tab), the page's unfinished sends go with it:
   coming back online under the next student's session sends nothing of
   the last student's. Against the real handler and send routes over the
   stand-in database. */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { CECE, OMAR, WORK, fakeStudentSubmit, sampleCard, samplePage } from './helpers/fake-student-submit.js';
import { PAGE_JPEG, THUMB_JPEG } from './helpers/fake-send-world.js';

const TODAY = new Date().toISOString().slice(0, 10);
const KEY = 'fv-s-session';
const piece = id => '.sp-piece[data-piece="' + id + '"]';

function memoryStore() {
  const rows = new Map();
  return {
    rows,
    list: async () => [...rows.values()].map(r => JSON.parse(JSON.stringify(r.meta))),
    putAll: async items =>
      items.forEach(i => rows.set(i.meta.id, { meta: { ...i.meta }, photo: i.photo, thumb: i.thumb })),
    update: async (id, patch) => {
      if (rows.has(id)) Object.assign(rows.get(id).meta, patch);
    },
    blobs: async id => (rows.has(id) ? { photo: rows.get(id).photo, thumb: rows.get(id).thumb } : null),
    remove: async ids => ids.forEach(id => rows.delete(id)),
    clear: async () => rows.clear(),
  };
}
const page1 = () => ({
  blob: { size: PAGE_JPEG.length, bytes: PAGE_JPEG },
  thumb: { size: THUMB_JPEG.length, bytes: THUMB_JPEG },
  hash: 'h',
  width: 900,
  height: 1200,
});

function omarCard() {
  const page = samplePage(TODAY);
  page.student = { enrollment_id: OMAR, first_name: 'Omar' };
  return sampleCard(TODAY, {
    code: 'ABCDEFGH',
    enrollment: OMAR,
    first: 'Omar',
    birthday: null,
    number: '7654321',
    page,
  });
}

describe('a send left on Not Sent Yet ends with the session, not only with Done', () => {
  for (const how of ['idle', 'other-tab-done']) {
    it(how + ': Cece’s photos are not handed in under Omar’s session when the device comes back online', async () => {
      const fn = fakeStudentSubmit({
        cards: [sampleCard(TODAY), omarCard()],
        sendWork: { [WORK.fair]: { students_send: 'photos_files', open: true } },
      });
      const store = {};
      const kept = memoryStore();
      let down = false;
      const page = openStudentPage({ store, objectUrls: true });
      page.server = body => (down && body.route === 'send-start' ? { ok: false, error: 'network' } : fn.handle(body));
      page.storage = async (url, init) => {
        if (init.method === 'PUT')
          return { status: fn.world.phoneUpload(url, init.body.bytes, init.headers['Content-Type']) };
        const got = fn.world.phoneDownload(url);
        return { status: got.status, blob: got.bytes && { size: got.bytes.length } };
      };
      page.T.setSendStore(kept);
      page.T.setPrepare(() => Promise.resolve({ ok: true, kind: 'jpeg', pages: [page1()] }));
      await page.start('#P3R8-WDK4');
      page.type('#sp-ident', '0123456');
      await page.click('[data-act="card-yes"]');

      // Cece sends with the Wi-Fi down: Not Sent Yet. She goes back to the list and walks away.
      down = true;
      await page.click(piece(WORK.fair) + ' [data-act="send-open"]');
      await page.T.sendFiles([{}], -1);
      await page.settle();
      page.type('#sp-send-note', 'Cece wrote this.');
      await page.click('[data-act="send-go"]');
      expect(page.root().querySelector('#sp-send-title').textContent).toBe('Not sent yet');
      await page.settle();
      expect(kept.rows.size).toBe(1);
      await page.click('[data-act="send-done"]');

      // Her session ends without Done.
      if (how === 'idle') page.advance(16 * 60 * 1000);
      else delete store[KEY];
      page.T.checkSession();
      await page.settle();
      expect(page.root().querySelector('#sp-code')).toBeTruthy();
      // Every sign-out wipes the photos this device kept for her (ruling 138).
      expect(kept.rows.size).toBe(0);

      // Omar signs in on the same tab.
      page.type('#sp-code', 'ABCD-EFGH');
      await page.submit('form[data-form="card"]');
      page.type('#sp-ident', '7654321');
      await page.click('[data-act="card-yes"]');
      expect(JSON.parse(store[KEY]).e).toBe(OMAR);

      // The Wi-Fi comes back.
      down = false;
      page.fire('online');
      await page.settle();

      const subs = [...fn.world.subs.values()];
      // Nothing of Cece's is sent under Omar's session, and nothing of hers is started for him.
      expect(subs.filter(s => s.enrollment === OMAR)).toEqual([]);
      const starts = page.calls.filter(c => c.body.route === 'send-start').map(c => c.body);
      expect(starts.filter(b => b.enrollment_id === OMAR)).toEqual([]);
    });
  }
});
