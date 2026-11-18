/**
 * The Dashboard's Bulletins tile (teacher/dash-bulletins.js): which three
 * bulletins show and in what order, the kind label, the Seen by line, the
 * empty, not-offered and Student Page off tiles, and Just Now. The drawing and
 * its height are tried in a browser (e2e/dashboard-bulletins-tile.spec.js).
 */
import './setup.js';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

runInThisContext(readFileSync('teacher/page-bulletins.js', 'utf-8'), { filename: 'teacher/page-bulletins.js' });
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
  it('the pinned reminder first, then the latest, three at most', () => {
    const list = [
      b('a', { posted_at: at(17, 10, 15) }),
      b('r', { kind: 'reminder', pinned: true, pinned_until: '2026-11-19', posted_at: at(14, 8, 42) }),
      b('c', { posted_at: at(17, 9, 58) }),
      b('d', { posted_at: at(16, 9, 0) }),
    ];
    expect(H.pick(list, '2026-11-17').map(x => x.id)).toEqual(['r', 'a', 'c']);
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

  it('Just Now for the last minute and for one not sent yet; else the time, the day or the date', () => {
    const justNow = new Date(now.getTime() - 20000).toISOString();
    expect(H.timeText(b('a', { posted_at: justNow }), now)).toBe('Just Now');
    expect(H.timeText(b('w', { waiting: true, posted_at: at(17, 8, 0) }), now)).toBe('Just Now');
    expect(H.timeText(b('a', { posted_at: at(17, 10, 15) }), now)).toBe('10:15');
    expect(H.timeText(b('a', { posted_at: at(17, 13, 5) }), new Date(2026, 10, 17, 14, 0))).toBe('1:05');
    expect(H.timeText(b('a', { posted_at: at(16, 10, 15) }), now)).toBe('Yesterday');
    expect(H.timeText(b('a', { posted_at: at(15, 10, 15) }), now)).toBe('Sun');
    expect(H.timeText(b('a', { posted_at: at(9, 10, 15) }), now)).toBe('Nov 9');
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
    localStorage.setItem('fv-build-dashRow', '1');
    localStorage.setItem('fv-build-bulletins', '1');
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

  it('a bulletin not sent yet has no Seen by button and says Just Now in bold', () => {
    const out = H.rowHtml(H.rowModel(b('w', { waiting: true }), 'sci8', now));
    expect(out).not.toContain('<button');
    expect(out).toContain('dash-bulletins-pending">Not Sent Yet');
    expect(out).toContain('dash-bulletins-fresh');
    expect(out).toContain('dash-bulletins-time">Just Now');
  });

  it('draws nothing unless both switches are on', () => {
    localStorage.removeItem('fv-build-bulletins');
    expect(D.html('sci8')).toBe('');
    localStorage.setItem('fv-build-bulletins', '1');
    localStorage.removeItem('fv-build-dashRow');
    expect(D.html('sci8')).toBe('');
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
    expect(out).toMatch(/aria-label="Reminder: Lab safety form/);
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

  it('not offered (the server has no Bulletins functions yet): one sentence, no buttons', () => {
    const cid = '11111111-2222-4333-8444-555555555555';
    globalThis._bltMem[cid] = {
      state: 'missing',
      list: [],
      meta: { can_see: 0, no_card: 0, paused: 0, page_on: true, more: false },
      at: 0,
      loading: null,
      writes: 0,
    };
    const out = H.tileHtml(cid, now);
    expect(out).toContain('Bulletins are not available yet.');
    expect(out).not.toContain('dash-bulletins-write');
    expect(out).not.toContain('dash-bulletins-row');
    delete globalThis._bltMem[cid];
  });
});
