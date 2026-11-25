/**
 * Bulletins on the phone (teacher-mobile/tab-bulletins.js, slice B1f): the
 * feed's model (kind, time, the Seen line, newest first), and the fourth tab,
 * on since B1g whatever an old `fv-build-bulletins` key on the device says.
 */
import './setup-mobile.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { runInThisContext } from 'vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const root = resolve(__dirname, '..');
runInThisContext(readFileSync(resolve(root, 'teacher-mobile/tab-bar.js'), 'utf-8'), {
  filename: 'teacher-mobile/tab-bar.js',
});
const MB = globalThis.MBulletins;
const MTabBar = globalThis.MTabBar;

const NOW = new Date(2026, 10, 18, 10, 30); // Wed, Nov 18, 10:30 a.m.
const at = (d, h, m = 0) => new Date(2026, 10, d, h, m).toISOString();

function bulletin(over = {}) {
  return {
    id: 'b1',
    kind: 'announcement',
    body: 'Read the Cell Theory pages.',
    link_url: null,
    link_title: null,
    pinned: false,
    pinned_until: null,
    waiting: false,
    key: null,
    posted_at: at(18, 9, 15),
    created_at: at(18, 9, 15),
    files: [],
    seen: 18,
    can_see: 26,
    ...over,
  };
}

describe('the feed’s model', () => {
  it('names each kind as the board does', () => {
    expect(MB.kindLabel(bulletin())).toBe('Announcement');
    expect(MB.kindLabel(bulletin({ files: [{ id: 'f', kind: 'photo' }] }))).toBe('Photo of the Board');
    expect(MB.kindLabel(bulletin({ files: [{ id: 'f', kind: 'photo' }], link_url: 'https://a.ca' }))).toBe(
      'Announcement',
    );
    expect(MB.kindLabel(bulletin({ files: [{ id: 'f', kind: 'pdf' }] }))).toBe('Announcement');
    expect(MB.kindLabel(bulletin({ kind: 'reminder' }))).toBe('Reminder');
    expect(MB.kindLabel(bulletin({ kind: 'reminder', pinned_until: '2026-11-19' }))).toBe(
      'Reminder · Until Thu, Nov 19',
    );
  });

  it('heads each day: Today, Yesterday, the weekday, then the date', () => {
    expect(MB.dayLabel(new Date(NOW.getTime() - 20000).toISOString(), NOW)).toBe('Today');
    expect(MB.dayLabel(at(18, 0, 5), NOW)).toBe('Today');
    expect(MB.dayLabel(at(17, 14), NOW)).toBe('Yesterday');
    expect(MB.dayLabel(at(16, 14), NOW)).toBe('Monday');
    expect(MB.dayLabel(at(12, 14), NOW)).toBe('Thursday');
    expect(MB.dayLabel(at(3, 14), NOW)).toBe('Tue, Nov 3');
    expect(MB.dayLabel(null, NOW)).toBe('');
  });

  it('the Seen line: Seen by N of M with the Not Seen part, Seen by All, Not Seen Yet, Not Sent Yet', () => {
    expect(MB.seenLine(bulletin())).toEqual({
      waiting: false,
      text: 'Seen by 18 of 26 · 8 Not Seen',
      main: 'Seen by 18 of 26',
      rest: '8 Not Seen',
    });
    expect(MB.seenLine(bulletin({ seen: 26 })).text).toBe('Seen by All 26');
    expect(MB.seenLine(bulletin({ seen: 0 })).text).toBe('Not Seen Yet');
    expect(MB.seenLine(bulletin({ waiting: true, key: 'k' }))).toMatchObject({ waiting: true, text: 'Not Sent Yet' });
  });

  it('the students not counted, named when one or two', () => {
    expect(MB.pausedText([])).toBe('');
    expect(MB.pausedText(['Jordan Kim'])).toBe('Jordan Kim Not Counted (Page Paused)');
    expect(MB.pausedText(['Jordan Kim', 'Ava Li'])).toBe('Jordan Kim and Ava Li Not Counted (Page Paused)');
    expect(MB.pausedText(['A', 'B', 'C'])).toBe('3 Not Counted (Page Paused)');
    expect(MB.noCardText(0)).toBe('');
    expect(MB.noCardText(1)).toBe('1 Has No Card Yet');
    expect(MB.noCardText(4)).toBe('4 Have No Card Yet');
  });

  it('is newest first, a waiting bulletin by when it was made; a pinned reminder is not lifted above it', () => {
    const cards = MB.feedModel(
      [
        bulletin({ id: 'old', posted_at: at(16, 9), created_at: at(16, 9) }),
        bulletin({ id: 'pin', kind: 'reminder', pinned: true, pinned_until: '2026-11-19', posted_at: at(17, 9) }),
        bulletin({
          id: 'waiting:k1',
          key: 'k1',
          waiting: true,
          posted_at: at(18, 10, 29),
          created_at: new Date(NOW.getTime() - 5000).toISOString(),
          files: [{ id: 'waiting:k1:0', kind: 'photo', status: 'uploading', paths: [] }],
          body: '',
        }),
      ],
      NOW,
    );
    expect(cards.map(c => c.id)).toEqual(['waiting:k1', 'pin', 'old']);
    expect(cards[0]).toMatchObject({
      waiting: true,
      key: 'k1',
      kind: 'Photo of the Board',
      day: 'Today',
      photo: { id: 'waiting:k1:0', ready: false },
      seen: { text: 'Not Sent Yet' },
    });
    expect(cards[1]).toMatchObject({ kind: 'Reminder · Until Thu, Nov 19', reminder: true, day: 'Yesterday' });
  });

  it('carries a PDF’s name and pages and a link’s site', () => {
    const [c] = MB.feedModel(
      [
        bulletin({
          link_url: 'https://www.britannica.com/science/cell',
          link_title: null,
          files: [{ id: 'p', kind: 'pdf', title: 'Cell Theory Reading', page_count: 2, status: 'ready', paths: [] }],
        }),
      ],
      NOW,
    );
    expect(c.pdfs).toEqual([{ title: 'Cell Theory Reading', pages: 2 }]);
    expect(c.link).toEqual({ title: 'britannica.com', host: 'britannica.com' });
    expect(c.photo).toBe(null);
  });
});

describe('the fourth tab', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it('is in the bar, last (on since B1g), whatever an old fv-build-bulletins key says', () => {
    for (const v of [null, '0', '1']) {
      if (v === null) localStorage.removeItem('fv-build-bulletins');
      else localStorage.setItem('fv-build-bulletins', v);
      expect(MTabBar.tabs()).toEqual(['students', 'observe', 'grade', 'bulletins']);
      expect(MB.on()).toBe(true);
    }
  });

  it('is remembered, and an old fv-build-bulletins key of 0 changes nothing', () => {
    MTabBar.remember('bulletins');
    expect(localStorage.getItem('td-mobile-tab')).toBe('bulletins');
    expect(MTabBar.saved()).toBe('bulletins');
    localStorage.setItem('fv-build-bulletins', '0');
    expect(MTabBar.saved()).toBe('bulletins');
  });

  it('its button: the page holds none, tab-bar.js adds it last, once', () => {
    const html = readFileSync(resolve(root, 'teacher-mobile/index.html'), 'utf-8');
    const { document } = parseHTML(html);
    const tabs = () => [...document.querySelectorAll('#m-tab-bar .m-tab-item')].map(b => b.getAttribute('data-tab'));
    expect(tabs()).toEqual(['students', 'observe', 'grade']);
    const saved = globalThis.document;
    globalThis.document = document;
    try {
      MTabBar.paint('students');
      expect(tabs()).toEqual(['students', 'observe', 'grade', 'bulletins']);
      MTabBar.paint('students');
      expect(tabs()).toEqual(['students', 'observe', 'grade', 'bulletins']);
      localStorage.setItem('fv-build-bulletins', '0');
      MTabBar.paint('students');
      expect(tabs()).toEqual(['students', 'observe', 'grade', 'bulletins']);
    } finally {
      globalThis.document = saved;
    }
  });

  it('the shell draws it through one call, and the phone loads the Bulletins files before the shell', () => {
    const shell = readFileSync(resolve(root, 'teacher-mobile/shell.js'), 'utf-8');
    expect(shell).toContain('if (window.MBulletins) html = MBulletins.tab(tab, _cid, html);');
    const html = readFileSync(resolve(root, 'teacher-mobile/index.html'), 'utf-8');
    for (const f of ['data-bulletins.js', 'bulletins-refusals.js', 'data-bulletins-demo.js', 'data-bulletins-queue.js'])
      expect(html.indexOf('shared/' + f)).toBeGreaterThan(-1);
    expect(html.indexOf('teacher-mobile/tab-bulletins.js')).toBeLessThan(html.indexOf('teacher-mobile/shell.js'));
  });

  it('a tab draw leaves Bulletins, and with the flag off returns the shell’s own screen untouched', () => {
    expect(MB.tab('students', 'c1', '<div>students</div>')).toBe('<div>students</div>');
  });
});
