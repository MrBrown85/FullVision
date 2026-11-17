/**
 * Stickers name the pieces of a scan (teacher/add-work-split-stickers.js, B4
 * phase 2), over Split the Scan's model (teacher/add-work-split-model.js).
 *
 * The worst fault is a page under the wrong student, so every test says who
 * gets which piece: a sticker names a piece only from that piece's first
 * page, never over a typed name or a box the teacher emptied, never a
 * student typed on another piece, never a code read on two pieces, a
 * retired code, another class's code or a student who has left; a late read
 * names nothing once Split the Scan has closed; with no codes nothing is
 * read and jsQR is never fetched.
 *
 * Most tests stand a known answer in for the reader (configure({ read })),
 * keyed by the page's picture. One reads real stickers drawn with
 * vendor/qrcode.js through jsQR, on small pictures, with room for a slow
 * runner.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { resolve as resolvePath } from 'path';
import { runInThisContext } from 'vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = resolvePath(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
for (const f of ['shared/scan-label-read.js', 'teacher/add-work-split-stickers.js'])
  runInThisContext(readFileSync(resolvePath(root, f), 'utf-8'), { filename: f });

const M = window.AddWorkSplitModel;
const Stk = window.AddWorkSplitStickers;
const R = window.ScanLabelRead;
const T = window.AddWorkSplitTurn;

const CLASS = [
  { id: 's1', firstName: 'Ava', lastName: 'Bains' },
  { id: 's2', firstName: 'Ben', lastName: 'Chen' },
  { id: 's3', firstName: 'Cam', lastName: 'Diaz' },
  { id: 's4', firstName: 'Dev', lastName: 'Evans' },
];
// Codes of the alphabet (no 0, 1, I, O).
const CODE = { s1: 'AAAAAAAAAAAA', s2: 'BBBBBBBBBBBB', s3: 'CCCCCCCCCCCC', s4: 'DDDDDDDDDDDD' };
const OLD_S2 = 'BBBBBBBBBBB2';
const LEFT = 'LLLLLLLLLLLL'; // a student who has left the class
const LABELS = [
  ...Object.keys(CODE).map(sid => ({ enrollment_id: sid, code: CODE[sid], retired: false })),
  { enrollment_id: 's2', code: OLD_S2, retired: true },
  { enrollment_id: 's9', code: LEFT, retired: false },
];

// A scan of n pages, each picture a plain object the stand-in reader knows by its number.
const scan = n => Array.from({ length: n }, (_, i) => ({ page: { n: i + 1 }, blank: false }));

let answers; // page number → { code, upsideDown, turn } or null
let held; // page number → a promise the test lets go of
let listed; // cid → what listScanLabels answers
let reads; // page numbers read, in order
let lists; // cids asked
beforeEach(() => {
  answers = {};
  held = {};
  reads = [];
  lists = [];
  listed = { c1: { data: { labels: LABELS }, error: null, refused: null } };
  Stk.configure({
    list: cid => {
      lists.push(cid);
      return Promise.resolve(listed[cid] || { data: { labels: [] }, error: null, refused: null });
    },
    read: pic => {
      reads.push(pic.n);
      return held[pic.n] || Promise.resolve(answers[pic.n] === undefined ? null : answers[pic.n]);
    },
  });
});
afterEach(() => {
  Stk.configure({ list: null, read: null });
  T.finders.length = 0;
});

const sticker = (code, turn = 0) => ({ code, upsideDown: turn === 180, turn });

// Split the Scan as the stickers see it: the state, and a draw that syncs as the page's draw does.
function opened(n, per, list = CLASS, more = {}) {
  const m = M.model(scan(n), list);
  m.setPer(per);
  const s = { cid: 'c1', m, list, overlay: { querySelector: () => null }, ...more };
  let open = true;
  const ctx = {
    state: () => (open ? s : null),
    draw: () => {
      if (open) Stk.sync(s, ctx);
    },
    call: (_, sid) => (list.find(st => st.id === sid) || {}).firstName || '',
  };
  return { s, m, ctx, close: () => (open = false) };
}

// Until the reads under way are done.
async function settled(s) {
  for (let i = 0; i < 200; i++) {
    await new Promise(r => setTimeout(r, 0));
    if (!s.stk || !s.stk.busy) {
      await new Promise(r => setTimeout(r, 0));
      if (!s.stk || !s.stk.busy) return;
    }
  }
}
const who = m => m.pieces().map(p => p.sid);

describe('stickers name the pieces of a scan', () => {
  it('reads first pages first, then the rest, names the stickered pieces, and says both counts', async () => {
    answers = { 1: sticker(CODE.s2), 5: sticker(CODE.s4), 2: sticker(CODE.s2) };
    const { s, m, ctx } = opened(8, 2);
    expect(await Stk.start(s, ctx)).toBe(true);
    await settled(s);
    // First pages first, then the rest. Page 2 is s2's own second sticker: fine.
    expect(reads).toEqual([1, 3, 5, 7, 2, 4, 6, 8]);
    expect(who(m)).toEqual(['s2', '', 's4', '']);
    expect(m.pieces().map(p => p.bySticker)).toEqual([true, false, true, false]);
    expect(Stk.line(s)).toBe('2 pieces named by sticker, 2 left to type.');
    // The rest typed; Match hands each student the right pages.
    m.name(1, 's1');
    m.name(3, 's3');
    const handed = m.take().map(p => [p.sid, p.pages.map(pg => pg.n)]);
    expect(handed).toEqual([
      ['s2', [1, 2]],
      ['s1', [3, 4]],
      ['s4', [5, 6]],
      ['s3', [7, 8]],
    ]);
  });

  it('says how far it has read while it reads', async () => {
    let let1;
    held[1] = new Promise(r => (let1 = r));
    const { s, ctx } = opened(4, 2);
    await Stk.start(s, ctx);
    await new Promise(r => setTimeout(r, 0));
    expect(Stk.line(s)).toBe('Reading stickers: 0 of 4');
    let1(sticker(CODE.s1));
    await settled(s);
    expect(Stk.line(s)).toBe('1 piece named by sticker, 1 left to type.');
  });

  it('a name typed while the sticker is read is never replaced', async () => {
    let let1;
    held[1] = new Promise(r => (let1 = r));
    const { s, m, ctx } = opened(4, 2);
    await Stk.start(s, ctx);
    await new Promise(r => setTimeout(r, 0));
    m.name(0, 's3'); // typed before the read came back
    let1(sticker(CODE.s1));
    await settled(s);
    expect(who(m)[0]).toBe('s3');
    expect(m.pieces()[0].bySticker).toBe(false);
    // Said, with Use Sticker to take the sticker's name if the teacher asks.
    expect(Stk.note(s, m.pieces()[0], ctx)).toBe('The sticker says Ava.');
    expect(m.useSticker(0)).toBe(true);
    ctx.draw();
    expect(who(m)[0]).toBe('s1');
  });

  it('a box the teacher emptied is not named again by its sticker', async () => {
    answers = { 1: sticker(CODE.s1) };
    const { s, m, ctx } = opened(4, 2);
    await Stk.start(s, ctx);
    await settled(s);
    expect(who(m)[0]).toBe('s1');
    m.name(0, '');
    ctx.draw();
    expect(who(m)[0]).toBe('');
    await settled(s);
    expect(who(m)[0]).toBe('');
  });

  it('a moved cut un-names the sticker’s piece, and moving it back names it again', async () => {
    answers = { 3: sticker(CODE.s2) };
    const { s, m, ctx } = opened(6, 2);
    await Stk.start(s, ctx);
    await settled(s);
    expect(who(m)).toEqual(['', 's2', '']);
    // Piece 1 takes page 3: piece 2 now starts on page 4, which has no sticker.
    m.more(0);
    ctx.draw();
    await settled(s);
    expect(m.pieces().map(p => p.first)).toEqual([1, 4, 6]);
    expect(who(m)).toEqual(['', '', '']);
    // Back: piece 2 starts on page 3 again, and its sticker names it; page 3 is not read twice.
    m.fewer(0);
    ctx.draw();
    await settled(s);
    expect(who(m)).toEqual(['', 's2', '']);
    expect(reads.filter(n => n === 3)).toHaveLength(1);
  });

  it('a page dragged onto another piece takes no sticker name with it', async () => {
    answers = { 3: sticker(CODE.s2) };
    const { s, m, ctx } = opened(6, 2);
    await Stk.start(s, ctx);
    await settled(s);
    m.move(3, 0); // page 3, piece 2's first, onto piece 1
    ctx.draw();
    await settled(s);
    expect(who(m)).toEqual(['', '', '']);
    expect(m.pieces()[0].nos).toEqual([1, 2, 3]);
  });

  it('the same sticker on two pieces names neither, and each says which other piece', async () => {
    answers = { 1: sticker(CODE.s1), 5: sticker(CODE.s1) };
    const { s, m, ctx } = opened(6, 2);
    await Stk.start(s, ctx);
    await settled(s);
    expect(who(m)).toEqual(['', '', '']);
    const ps = m.pieces();
    expect(Stk.note(s, ps[0], ctx)).toBe('The same sticker is on piece 3. Type the name.');
    expect(Stk.note(s, ps[2], ctx)).toBe('The same sticker is on piece 1. Type the name.');
  });

  it('a retired code, another class’s code and a student who has left are shown, never taken', async () => {
    answers = { 1: sticker(OLD_S2), 3: sticker('ZZZZZZZZZZZZ'), 5: sticker(LEFT) };
    const { s, m, ctx } = opened(6, 2);
    await Stk.start(s, ctx);
    await settled(s);
    expect(who(m)).toEqual(['', '', '']);
    expect(m.pieces().map(p => Stk.note(s, p, ctx))).toEqual([
      'This sticker is from a sheet that was replaced.',
      'This sticker isn’t one of this class’s.',
      'This sticker is for a student no longer in the class.',
    ]);
    expect(Stk.line(s)).toBe('0 pieces named by sticker, 3 left to type.');
  });

  it('a sticker for a student typed on another piece changes nothing and is shown on both', async () => {
    answers = { 3: sticker(CODE.s1) };
    const { s, m, ctx } = opened(4, 2);
    m.name(0, 's1');
    await Stk.start(s, ctx);
    await settled(s);
    expect(who(m)).toEqual(['s1', '']);
    expect(m.twice()).toEqual({});
    const ps = m.pieces();
    expect(Stk.note(s, ps[1], ctx)).toBe('The sticker says Ava, who is typed on piece 1.');
    expect(Stk.note(s, ps[0], ctx)).toBe('The sticker on piece 2 says Ava too.');
    // The typed name moves: the sticker names its piece.
    m.name(0, 's3');
    expect(who(m)).toEqual(['s3', 's1']);
  });

  it('Class List Order: a sticker counts as typed, and when it disagrees with the list nothing can be matched', async () => {
    // Four pieces, four students: the list names every piece. Piece 1's sticker says Ben, the list says Ava.
    answers = { 1: sticker(CODE.s2) };
    const { s, m, ctx } = opened(8, 2);
    m.setOrder('list');
    expect(who(m)).toEqual(['s1', 's2', 's3', 's4']);
    await Stk.start(s, ctx);
    await settled(s);
    expect(who(m)).toEqual(['s2', 's2', 's3', 's4']);
    expect(m.twice()).toEqual({ s2: [0, 1] });
    expect(m.canMatch()).toBe(false);
    expect(m.take()).toEqual([]);
    // The teacher settles it on the second piece: now every piece is one student.
    m.name(1, 's1');
    expect(who(m)).toEqual(['s2', 's1', 's3', 's4']);
    expect(m.canMatch()).toBe(true);
  });

  it('Class List Order still names pieces only when there is one piece for each student (review rule 3)', async () => {
    answers = { 1: sticker(CODE.s2) };
    const { s, m, ctx } = opened(6, 2); // three pieces, four students
    m.setOrder('list');
    await Stk.start(s, ctx);
    await settled(s);
    expect(m.listFits()).toBe(false);
    expect(who(m)).toEqual(['s2', '', '']);
  });

  it('two classes: each class’s codes are asked for, and a sticker names a student of either', async () => {
    const B = [{ id: 't1', firstName: 'Tia', lastName: 'Ng' }];
    listed.c2 = {
      data: { labels: [{ enrollment_id: 't1', code: 'TTTTTTTTTTTT', retired: false }] },
      error: null,
      refused: null,
    };
    answers = { 1: sticker('TTTTTTTTTTTT'), 3: sticker(CODE.s3) };
    const { s, m, ctx } = opened(4, 2, CLASS.concat(B), { cids: ['c1', 'c2'] });
    await Stk.start(s, ctx);
    await settled(s);
    expect(lists).toEqual(['c1', 'c2']);
    expect(who(m)).toEqual(['t1', 's3']);
  });

  it('a class with no codes reads nothing, says nothing, and never fetches jsQR', async () => {
    Stk.configure({ read: null }); // the real reader
    let fetched = 0;
    R.configure({
      load: () => {
        fetched++;
        return Promise.resolve(require('../vendor/jsqr/jsQR.js'));
      },
    });
    listed.c1 = { data: { labels: [] }, error: null, refused: null };
    const { s, m, ctx } = opened(4, 2);
    expect(await Stk.start(s, ctx)).toBe(false);
    ctx.draw();
    await settled(s);
    expect(s.stk).toBe(null);
    expect(Stk.line(s)).toBe('');
    expect(fetched).toBe(0);
    expect(R.loaded()).toBe(false);
    expect(who(m)).toEqual(['', '']);
  });

  it('a refused list (offline, no permission) reads nothing and says nothing', async () => {
    listed.c1 = { data: null, error: null, refused: 'Sticker sheets are not available right now.' };
    const { s, ctx } = opened(4, 2);
    expect(await Stk.start(s, ctx)).toBe(false);
    ctx.draw();
    await settled(s);
    expect(reads).toEqual([]);
    expect(Stk.line(s)).toBe('');
  });

  it('closing Split the Scan mid-read names nothing afterwards', async () => {
    let let1;
    held[1] = new Promise(r => (let1 = r));
    const { s, m, ctx, close } = opened(4, 2);
    await Stk.start(s, ctx);
    await new Promise(r => setTimeout(r, 0));
    close();
    let1(sticker(CODE.s1));
    await settled(s);
    expect(reads).toEqual([1]);
    expect(who(m)).toEqual(['', '']);
  });

  it('a sticker read upside down marks only its own page, and nothing is turned', async () => {
    answers = { 3: sticker(CODE.s2, 180) };
    const { s, m, ctx } = opened(4, 2);
    const before = m.pages().map(p => p.page);
    await Stk.start(s, ctx);
    await settled(s);
    await T.find(s, ctx);
    expect([1, 2, 3, 4].map(no => T.marked(s, no))).toEqual([false, false, true, false]);
    expect(m.pages().map(p => p.page)).toEqual(before);
    expect(who(m)).toEqual(['', 's2']);
  });
});

describe('a wrong cut, caught by the stickers on later pages', () => {
  // Three two-page papers, each with its student's sticker on its first page.
  const papers = () => ({ 1: sticker(CODE.s1), 3: sticker(CODE.s2), 5: sticker(CODE.s3) });

  it('cut one page too long: no piece holding another student’s sticker is named, and it says which page', async () => {
    answers = papers();
    const { s, m, ctx } = opened(6, 3); // three pages per student, where the papers are two
    await Stk.start(s, ctx);
    await settled(s);
    expect(m.pieces().map(p => p.nos)).toEqual([
      [1, 2, 3],
      [4, 5, 6],
    ]);
    expect(who(m)).toEqual(['', '']);
    expect(m.pieces().map(p => Stk.note(s, p, ctx))).toEqual([
      'Page 3 of this piece has Ben’s sticker. Check where this piece ends.',
      'Page 2 of this piece has Cam’s sticker. Check where this piece ends.',
    ]);
    expect(m.canMatch()).toBe(false);
    expect(m.take()).toEqual([]);
  });

  it('the same scan cut right names them all, with nothing to say', async () => {
    answers = papers();
    const { s, m, ctx } = opened(6, 3);
    await Stk.start(s, ctx);
    await settled(s);
    m.setPer(2);
    ctx.draw();
    await settled(s);
    expect(who(m)).toEqual(['s1', 's2', 's3']);
    expect(m.pieces().map(p => Stk.note(s, p, ctx))).toEqual(['', '', '']);
    expect(m.take().map(p => [p.sid, p.pages.map(pg => pg.n)])).toEqual([
      ['s1', [1, 2]],
      ['s2', [3, 4]],
      ['s3', [5, 6]],
    ]);
  });

  it('a student with a sticker on both of their pages is named once, with no warning and not twice', async () => {
    answers = { 1: sticker(CODE.s1), 2: sticker(CODE.s1), 3: sticker(CODE.s2) };
    const { s, m, ctx } = opened(4, 2);
    await Stk.start(s, ctx);
    await settled(s);
    expect(who(m)).toEqual(['s1', 's2']);
    expect(m.twice()).toEqual({});
    expect(m.pieces().map(p => [p.wrong, Stk.note(s, p, ctx)])).toEqual([
      [null, ''],
      [null, ''],
    ]);
  });

  it('a typed name on a piece with another student’s sticker inside stays, and the line shows', async () => {
    answers = papers();
    const { s, m, ctx } = opened(6, 3);
    m.name(0, 's1');
    await Stk.start(s, ctx);
    await settled(s);
    expect(who(m)).toEqual(['s1', '']);
    expect(Stk.note(s, m.pieces()[0], ctx)).toBe(
      'Page 3 of this piece has Ben’s sticker. Check where this piece ends.',
    );
    // Typed names are the teacher's: matched as typed.
    expect(m.canMatch()).toBe(true);
    expect(m.take().map(p => [p.sid, p.pages.map(pg => pg.n)])).toEqual([['s1', [1, 2, 3]]]);
  });

  it('a retired or another class’s sticker on a later page says nothing', async () => {
    answers = { 1: sticker(CODE.s1), 2: sticker(OLD_S2), 3: sticker(CODE.s2), 4: sticker('ZZZZZZZZZZZZ') };
    const { s, m, ctx } = opened(4, 2);
    await Stk.start(s, ctx);
    await settled(s);
    expect(who(m)).toEqual(['s1', 's2']);
    expect(m.pieces().map(p => Stk.note(s, p, ctx))).toEqual(['', '']);
  });

  it('counts pages while it reads', async () => {
    let let2;
    answers = papers();
    held[2] = new Promise(r => (let2 = r));
    const { s, ctx } = opened(6, 2);
    await Stk.start(s, ctx);
    await new Promise(r => setTimeout(r, 0));
    for (let i = 0; i < 50 && reads.indexOf(2) < 0; i++) await new Promise(r => setTimeout(r, 0));
    expect(Stk.line(s)).toBe('Reading stickers: 3 of 6');
    let2(null);
    await settled(s);
    expect(Stk.line(s)).toBe('3 pieces named by sticker, 0 left to type.');
  });

  it('a later page read upside down is marked too, on its own', async () => {
    answers = { 1: sticker(CODE.s1), 2: sticker(CODE.s1, 180) };
    const { s, m, ctx } = opened(4, 2);
    await Stk.start(s, ctx);
    await settled(s);
    await T.find(s, ctx);
    expect([1, 2, 3, 4].map(no => T.marked(s, no))).toEqual([false, true, false, false]);
    expect(who(m)).toEqual(['s1', '']);
  });

  it('closing mid-read names nothing afterwards, a later page’s read included', async () => {
    let let4;
    answers = papers();
    held[4] = new Promise(r => (let4 = r));
    const { s, m, ctx, close } = opened(6, 2);
    await Stk.start(s, ctx);
    for (let i = 0; i < 50 && reads.indexOf(4) < 0; i++) await new Promise(r => setTimeout(r, 0));
    const named = who(m);
    close();
    let4(sticker(CODE.s3));
    await settled(s);
    expect(who(m)).toEqual(named);
    expect(reads.indexOf(6)).toBe(-1);
  });
});

describe('real stickers through jsQR', { timeout: 30000 }, () => {
  // A small white page with a sticker's QR (version 1, Q, FVS + code) drawn on it.
  function page(code, x, y, scale) {
    const w = 300;
    const h = 380;
    const data = new Uint8ClampedArray(w * h * 4).fill(255);
    if (code) {
      const qr = qrcode(1, 'Q');
      qr.addData('FVS' + code, 'Alphanumeric');
      qr.make();
      const n = qr.getModuleCount();
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) {
          if (!qr.isDark(r, c)) continue;
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) {
              const i = ((y + r * scale + dy) * w + x + c * scale + dx) * 4;
              data[i] = data[i + 1] = data[i + 2] = 0;
            }
        }
    }
    return { width: w, height: h, data };
  }

  it('a made-up scan with stickers on some first pages: each stickered piece goes to its student', async () => {
    Stk.configure({ read: null });
    R.configure({ load: () => Promise.resolve(require('../vendor/jsqr/jsQR.js')) });
    const pics = [
      page(CODE.s3, 200, 20, 3),
      page('', 0, 0, 0),
      page('', 0, 0, 0),
      page('', 0, 0, 0),
      page(CODE.s1, 200, 20, 3),
      page(CODE.s1, 200, 300, 3), // s1's own sticker on their second page: fine
    ];
    const m = M.model(
      pics.map(p => ({ page: p, blank: false })),
      CLASS,
    );
    m.setPer(2);
    const s = { cid: 'c1', m, list: CLASS, overlay: { querySelector: () => null } };
    const ctx = { state: () => s, draw: () => Stk.sync(s, ctx), call: () => '' };
    await Stk.start(s, ctx);
    for (let i = 0; i < 400 && Stk.line(s).indexOf('Reading') !== -1; i++) await new Promise(r => setTimeout(r, 5));
    await settled(s);
    expect(who(m)).toEqual(['s3', '', 's1']);
    m.name(1, 's2');
    // Each page handed over told by its pixels (Match hands over copies of the pages).
    expect(m.take().map(p => [p.sid, p.pages.map(pg => pics.findIndex(x => x.data === pg.data) + 1)])).toEqual([
      ['s3', [1, 2]],
      ['s2', [3, 4]],
      ['s1', [5, 6]],
    ]);
  });
});
