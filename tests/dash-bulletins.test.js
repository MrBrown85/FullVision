/**
 * The Dashboard's Bulletins tile (teacher/dash-bulletins.js): which three
 * bulletins show and in what order, the kind label, the Seen by line, the
 * empty, not-offered and Student Page off tiles, and Just Now. The drawing and
 * its height are tried in a browser (e2e/dashboard-bulletins-tile.spec.js).
 */
import './setup.js';
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

const D = window.DashBulletins;
const H = D._helpers;
const now = new Date(2026, 10, 17, 12, 0, 0); // Tue, Nov 17, 2026
const at = (day, h, m) => new Date(2026, 10, day, h, m).toISOString();
const b = (id, over = {}) => ({
  id,
  kind: 'announcement',
  body: 'Words ' + id,
  link_url: null,
  link_title: null,
  pinned: false,
  pinned_until: null,
  files: [],
  seen: 0,
  can_see: 26,
  waiting: false,
  posted_at: at(17, 9, 0),
  created_at: at(17, 9, 0),
  ...over,
});

describe('which bulletins show', () => {
  it('the pinned reminder first, then the latest, five at most', () => {
    const list = [
      b('a', { posted_at: at(17, 10, 15) }),
      b('r', { kind: 'reminder', pinned: true, pinned_until: '2026-11-19', posted_at: at(14, 8, 42) }),
      b('c', { posted_at: at(17, 9, 58) }),
      b('d', { posted_at: at(16, 9, 0) }),
      b('e', { posted_at: at(16, 8, 0) }),
      b('f', { posted_at: at(15, 8, 0) }),
      b('g', { posted_at: at(14, 9, 0) }),
    ];
    expect(H.pick(list, '2026-11-17').map(x => x.id)).toEqual(['r', 'a', 'c', 'd', 'e']);
  });

  it('a pin that has run out is not a pin', () => {
    const list = [
      b('r', { kind: 'reminder', pinned: true, pinned_until: '2026-11-16', posted_at: at(10, 8, 0) }),
      b('a', { posted_at: at(17, 10, 15) }),
      b('c', { posted_at: at(17, 9, 58) }),
    ];
    expect(H.pick(list, '2026-11-17').map(x => x.id)).toEqual(['a', 'c', 'r']);
    // The last day counts.
    expect(H.pick(list, '2026-11-16').map(x => x.id)).toEqual(['r', 'a', 'c']);
  });

  it('with fewer than three, shows what there is', () => {
    expect(H.pick([], '2026-11-17')).toEqual([]);
    expect(H.pick([b('a')], '2026-11-17').map(x => x.id)).toEqual(['a']);
  });
});

describe('the kind label', () => {
  it('Reminder, Announcement and Photo of the Board (never just Photo)', () => {
    expect(H.kindText(b('r', { kind: 'reminder', pinned_until: '2026-11-19' }))).toBe('Reminder');
    expect(H.kindText(b('a'))).toBe('Announcement');
    expect(H.kindText(b('p', { files: [{ kind: 'photo' }] }))).toBe('Photo of the Board');
    expect(H.kindText(b('p', { body: '', files: [{ kind: 'photo' }] }))).toBe('Photo of the Board');
    expect(H.kindText(b('x', { files: [{ kind: 'pdf' }] }))).toBe('Announcement');
  });
});

describe('the words and the time', () => {
  it('the first line of the words', () => {
    expect(H.firstLine(b('a', { body: '\n  Read the pages.\nBring a question.' }))).toBe('Read the pages.');
    expect(H.firstLine(b('p', { body: '', files: [{ kind: 'photo' }] }))).toBe('A photo');
  });

  it('Just Now for the last minute and for one not sent yet; else the time alone, the weekday alone or the date, as the artboard writes them', () => {
    const justNow = new Date(now.getTime() - 20000).toISOString();
    expect(H.timeText(b('a', { posted_at: justNow }), now)).toBe('Just Now');
    expect(H.timeText(b('w', { waiting: true, posted_at: at(17, 8, 0) }), now)).toBe('Just Now');
    expect(H.timeText(b('a', { posted_at: at(17, 10, 15) }), now)).toBe('10:15');
    expect(H.timeText(b('a', { posted_at: at(17, 23, 58) }), new Date(2026, 10, 17, 23, 59))).toBe('11:58');
    expect(H.timeText(b('a', { posted_at: at(16, 10, 15) }), now)).toBe('Yesterday');
    expect(H.timeText(b('a', { posted_at: at(15, 10, 15) }), now)).toBe('Sun');
    expect(H.timeText(b('a', { posted_at: at(9, 10, 15) }), now)).toBe('Nov 9');
    // The accessible name keeps the full day and clock.
    expect(H.timeFull(b('a', { posted_at: at(15, 10, 15) }), now)).toBe('Sunday 10:15 a.m.');
    expect(H.timeFull(b('a', { posted_at: at(9, 10, 15) }), now)).toBe('Nov 9 10:15 a.m.');
    // A minute and a bit ago is just a time.
    expect(H.timeText(b('a', { posted_at: new Date(now.getTime() - 61000).toISOString() }), now)).toBe('11:58');
  });
});

describe('the tile', () => {
  const realMeta = globalThis.getBulletinsMeta;
  const pageOn = on => {
    globalThis.getBulletinsMeta = () => ({ can_see: 27, no_card: 0, paused: 0, page_on: on, more: false });
  };
  beforeEach(() => {
    document.removeEventListener = () => {};
    pageOn(true);
  });
  afterEach(() => {
    localStorage.clear();
    D.destroy();
    globalThis.getBulletinsMeta = realMeta;
    delete globalThis.isDemoMode;
  });

  it('Seen by, in its three forms, is the data layer’s own line', () => {
    const rows = [
      b('a', { seen: 24, can_see: 26 }),
      b('b', { seen: 26, can_see: 26 }),
      b('c', { seen: 0, can_see: 26 }),
    ];
    const out = rows.map(r => H.rowModel(r, 'sci8', now)).map(r => r.seenMain + (r.seenNot ? ' · ' + r.seenNot : ''));
    expect(out).toEqual(['Seen by 24 of 26 · 2 Not Seen', 'Seen by All 26', 'Not Seen Yet']);
  });

  it('the tile shows Seen by N of M alone; the full numbers are the button’s accessible name', () => {
    const out = H.rowHtml(H.rowModel(b('a', { seen: 24, can_see: 26 }), 'sci8', now));
    expect(out).toContain('aria-label="Seen by 24 of 26, 2 Not Seen">Seen by 24 of 26</button>');
    expect(out).not.toContain('Not Seen</');
  });

  it('a bulletin not sent yet has no Seen by button and says Just Now in bold', () => {
    const out = H.rowHtml(H.rowModel(b('w', { waiting: true }), 'sci8', now));
    expect(out).not.toContain('<button');
    expect(out).toContain('dash-bulletins-pending">Not Sent Yet');
    expect(out).toContain('dash-bulletins-fresh');
    expect(out).toContain('dash-bulletins-time">Just Now');
  });

  it('on since B1g, a signed-in class whose server has not answered draws nothing (rule 7), whatever an old key says; so is the row (D9)', () => {
    for (const v of [null, '0', '1']) {
      if (v === null) localStorage.removeItem('fv-build-bulletins');
      else localStorage.setItem('fv-build-bulletins', v);
      expect(BuildFlags.on('bulletins')).toBe(true);
      expect(bulletinsOffered('sci8')).toBe(false);
      expect(D.html('sci8')).toBe('');
    }
    expect(BuildFlags.on('dashRow')).toBe(true);
    localStorage.setItem('fv-build-dashRow', '0');
    expect(BuildFlags.on('dashRow')).toBe(true);
  });

  it('Demo Mode: the sample class has its three bulletins, pinned first, with links and Seen by buttons', () => {
    globalThis.isDemoMode = () => true;
    const row = (id, over) => ({ ...b(id, over), seen: [], reactions: {} });
    saveDemoBulletinsSeed('sci8', [
      row('00000000-0000-4000-8000-00000000b001', {
        kind: 'reminder',
        body: 'Lab safety form signed and back by Thursday.',
        pinned: true,
        pinned_until: '2999-01-01',
        posted_at: at(10, 8, 42),
        created_at: at(10, 8, 42),
      }),
      row('00000000-0000-4000-8000-00000000b002', { posted_at: at(17, 10, 15), created_at: at(17, 10, 15) }),
      row('00000000-0000-4000-8000-00000000b003', { posted_at: at(17, 9, 58), created_at: at(17, 9, 58) }),
    ]);
    const out = D.html('sci8');
    expect((out.match(/<li class="dash-bulletins-row/g) || []).length).toBe(3);
    expect(out.indexOf('>Reminder<')).toBeLessThan(out.indexOf('>Announcement<'));
    expect(out).toMatch(/data-href="\/bulletins\?course=sci8&amp;open=[^"]+"/);
    expect(out).toMatch(/data-dash-bulletins-go="\/bulletins\?course=sci8&amp;seen=[^"]+"/);
    expect(out).toContain('data-dash-bulletins-go="/bulletins?course=sci8&amp;write=1">Write a Bulletin');
    expect(out).toContain('data-href="/bulletins?course=sci8">Open Bulletins →');
    // The row's accessible name holds the full words.
    expect(out).toMatch(/aria-label="Reminder( · Until [A-Z][a-z]{2})?: Lab safety form/);
  });

  it('empty: Nothing Posted Yet and one sentence; no rows', () => {
    globalThis.isDemoMode = () => true;
    localStorage.setItem('gb-bulletins-sci8', JSON.stringify({ bulletins: [], seen: {}, reactions: {} }));
    const out = D.html('sci8');
    expect(out).toContain('Nothing Posted Yet');
    expect(out).toContain('Bulletins reach every student&#39;s phone, on the first tab of their page.');
    expect(out).not.toContain('dash-bulletins-row');
  });

  it('the Student Page off: its sentence with the Class Settings link, no rows', () => {
    globalThis.isDemoMode = () => true;
    pageOn(false);
    const out = D.html('sci8');
    expect(out).toContain('Students cannot see Bulletins until the Student Page is turned on.');
    expect(out).toContain('data-href="/dashboard?course=sci8&amp;manage=student-page">Class Settings →');
    expect(out).not.toContain('dash-bulletins-row');
  });

  describe('a signed-in class the server has not said has Bulletins: no slot at all', () => {
    const cid = '11111111-2222-4333-8444-555555555555';
    const seed = state => {
      globalThis._bltMem[cid] = {
        state,
        list: [b('a', { posted_at: at(17, 10, 15) })],
        meta: { can_see: 27, no_card: 0, paused: 0, page_on: true, more: false },
        at: Date.now(),
        loading: null,
        writes: 0,
      };
    };
    afterEach(() => {
      delete globalThis._bltMem[cid];
    });

    it('missing, failed and never answered each draw nothing, and the tile says nothing', () => {
      for (const state of ['missing', 'failed', '']) {
        seed(state);
        expect(D.html(cid)).toBe('');
        expect(H.tileHtml(cid, now)).toBe('');
        D.destroy();
      }
    });

    it('a failed read is not asked for again on every draw', () => {
      seed('failed');
      const real = globalThis.refreshBulletins;
      const asked = vi.fn(() => Promise.resolve(false));
      globalThis.refreshBulletins = asked;
      try {
        D.html(cid);
        D.html(cid);
        expect(asked).not.toHaveBeenCalled();
        seed('');
        D.html(cid);
        expect(asked).toHaveBeenCalledTimes(1);
      } finally {
        globalThis.refreshBulletins = real;
      }
    });

    it('a read dropped because the class changed is not a failure: the next draw asks again', async () => {
      seed('ok');
      const real = globalThis.refreshBulletins;
      let asked = 0;
      globalThis.refreshBulletins = (c, o) => {
        asked++;
        if (asked === 1) {
          D.html('some-other-class'); // the Dashboard moved on before the answer
          o.stillShown();
          return Promise.resolve(false);
        }
        return Promise.resolve(false);
      };
      try {
        D.html(cid);
        await Promise.resolve();
        await Promise.resolve();
        D.html(cid);
        expect(asked).toBe(3); // the other class's own ask, then this class again
        // A real failure still stops the draws asking.
        await Promise.resolve();
        await Promise.resolve();
        D.html(cid);
        expect(asked).toBe(3);
      } finally {
        globalThis.refreshBulletins = real;
      }
    });

    it('answers late: the row is drawn once more, once, and only when nothing is open', () => {
      const handlers = {};
      document.addEventListener = (t, h) => (handlers[t] = h);
      const realOffered = globalThis.bulletinsOffered;
      globalThis.bulletinsOffered = () => true;
      const render = vi.fn();
      window.PageDashboard = { render };
      let open = true;
      const row = { contains: () => false, querySelector: () => (open ? {} : null) };
      document.querySelector = sel => (sel === '.dash-row' ? row : null);
      document.getElementById = () => null;
      try {
        seed('');
        expect(D.html(cid)).toBe('');
        // The server answers: a list is open on the row, so it waits.
        seed('ok');
        handlers['fv:bulletins-changed']({ detail: { cid } });
        expect(render).not.toHaveBeenCalled();
        open = false;
        handlers['fv:bulletins-changed']({ detail: { cid } });
        expect(render).toHaveBeenCalledTimes(1);
        // Another class's answer asks for nothing.
        handlers['fv:bulletins-changed']({ detail: { cid: 'other' } });
        expect(render).toHaveBeenCalledTimes(1);
        // The row drawn again now has the tile.
        expect(D.html(cid)).toContain('dash-bulletins-tile');
        // A read that fails later keeps what the tile showed.
        globalThis._bltMem[cid].state = 'ok';
        expect(H.tileHtml(cid, now)).toContain('Words a');
      } finally {
        globalThis.bulletinsOffered = realOffered;
        delete window.PageDashboard;
        document.addEventListener = () => {};
        document.querySelector = () => null;
      }
    });
  });

  it('the header reads the data layer: how many can see it and how many pages are paused', () => {
    globalThis.isDemoMode = () => true;
    localStorage.setItem('gb-bulletins-sci8', JSON.stringify({ bulletins: [], seen: {}, reactions: {} }));
    globalThis.getBulletinsMeta = () => ({ can_see: 26, no_card: 0, paused: 1, page_on: true, more: false });
    expect(D.html('sci8')).toContain('26 can see it, 1 page paused');
    globalThis.getBulletinsMeta = () => ({ can_see: 25, no_card: 0, paused: 2, page_on: true, more: false });
    expect(D.html('sci8')).toContain('25 can see it, 2 pages paused');
  });

  it('a stalled bulletin is not Just Now: it says it did not finish uploading', () => {
    const out = H.rowHtml(H.rowModel(b('s', { waiting: true, stalled: true, posted_at: at(17, 9, 0) }), 'sci8', now));
    expect(out).toContain('Didn&#39;t Finish Uploading');
    expect(out).not.toContain('Not Sent Yet');
    expect(out).not.toContain('dash-bulletins-fresh');
    expect(out).toContain('data-href="/bulletins?course=sci8&amp;open=s"');
  });

  it('a Reminder label carries the amber class and a pin; other kinds do not', () => {
    const rem = H.rowHtml(H.rowModel(b('r', { kind: 'reminder', pinned: true }), 'sci8', now));
    expect(rem).toContain('dash-bulletins-kind dash-bulletins-rem"><svg');
    const ann = H.rowHtml(H.rowModel(b('a'), 'sci8', now));
    expect(ann).not.toContain('dash-bulletins-rem');
    expect(ann).not.toContain('<svg');
  });

  it('a reminder with an end day says "Until Thu" for the wide card, as an attribute', () => {
    const r = b('r', { kind: 'reminder', pinned: true, pinned_until: '2026-11-19' });
    expect(H.untilText(r)).toBe(' · Until Thu');
    expect(H.rowHtml(H.rowModel(r, 'sci8', now))).toContain('data-until=" · Until Thu"');
    // The end day is in the words link's accessible name, not only in generated text.
    expect(H.rowHtml(H.rowModel(r, 'sci8', now))).toContain('aria-label="Reminder · Until Thu: Words r');
    expect(H.untilText(b('a'))).toBe('');
    expect(H.rowHtml(H.rowModel(b('a'), 'sci8', now))).not.toContain('data-until');
  });

  it('a row’s words are the whole post, joined, for the two-line clamp', () => {
    const out = H.rowHtml(H.rowModel(b('a', { body: 'Read the pages.\nBring a question.' }), 'sci8', now));
    expect(out).toContain('>Read the pages. Bring a question.</a>');
  });

  it('a row’s accessible name has its kind, its words and its time', () => {
    const out = H.rowHtml(H.rowModel(b('a', { posted_at: at(17, 10, 15) }), 'sci8', now));
    expect(out).toContain('aria-label="Announcement: Words a, 10:15 a.m."');
    const old = H.rowHtml(H.rowModel(b('a', { posted_at: at(15, 10, 15) }), 'sci8', now));
    expect(old).toContain('Sunday 10:15 a.m."');
  });
});
