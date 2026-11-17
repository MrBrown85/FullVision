/**
 * Add Work for the Class: Split the Scan (B2, docs/plans/add-work-for-class-plan.md).
 *
 * The model (teacher/add-work-split-model.js): the starting Pages per
 * Student, the cut, a moved line, a blank page left out and one kept, names
 * kept against first pages through every kind of re-cut, Class List Order,
 * the name box, a student on two pieces, and the pieces handed over. The
 * reading (AddWorkSplit.read): PhotoShrink asked for 150 pages, every page
 * renamed, a 151-page scan refused here, and the grader's Add Work still
 * refusing a 21-page PDF.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const M = window.AddWorkSplitModel;
const S = window.AddWorkSplit;

const FILE_NAME = 'Block C 2026-11-17 0832.pdf';

const fakePage = n => ({
  blob: new Blob(['b' + n], { type: 'image/jpeg' }),
  thumb: new Blob(['t' + n], { type: 'image/jpeg' }),
  hash: String(n).padStart(64, 'a'),
  width: 1545,
  height: 2000,
  name: 'Block C 2026-11-17 0832-page-' + n + '.jpg',
  page: n,
});
// blank: the scan's page numbers (1-based) that are blank.
const scan = (n, blank = []) =>
  Array.from({ length: n }, (_, i) => ({ page: fakePage(i + 1), blank: blank.indexOf(i + 1) >= 0 }));

const CLASS = [
  { id: 's1', firstName: 'Avery', lastName: 'Chen' },
  { id: 's2', firstName: 'Liam', lastName: 'Chen' },
  { id: 's3', firstName: 'Zoë', lastName: 'Okafor' },
  { id: 's4', firstName: 'Theodore', lastName: 'Nguyen', preferred: 'Theo' },
  { id: 's5', firstName: 'Mia', lastName: 'Kowalski' },
  { id: 's6', firstName: 'Mateo', lastName: 'Cruz' },
];

const cut = m => m.pieces().map(p => p.nos);
const sids = m => m.pieces().map(p => p.sid);

describe('Pages per Student to start with', () => {
  it('is the kept pages over the students when that is a whole number from 1 to 30', () => {
    expect(M.startPer(56, 28)).toBe(2);
    expect(M.startPer(28, 28)).toBe(1);
    expect(M.startPer(90, 3)).toBe(30);
  });
  it('is 1 otherwise', () => {
    expect(M.startPer(55, 28)).toBe(1);
    expect(M.startPer(93, 3)).toBe(1); // 31 a piece
    expect(M.startPer(12, 0)).toBe(1);
    expect(M.startPer(0, 28)).toBe(1);
  });
});

describe('the cut', () => {
  it('cuts the kept pages into pieces of Pages per Student, the last with what is left', () => {
    const m = M.model(scan(12), CLASS);
    m.setPer(2);
    expect(cut(m)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
      [9, 10],
      [11, 12],
    ]);
    expect(m.line()).toBe('12 pages make 6 pieces of 2.');
    m.setPer(5);
    expect(cut(m)).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7, 8, 9, 10],
      [11, 12],
    ]);
    expect(m.line()).toBe('12 pages make 3 pieces: 2 of 5 and 1 of 2.');
  });

  it('keeps Pages per Student from 1 to 30', () => {
    const m = M.model(scan(70), CLASS);
    expect(m.setPer(0)).toBe(1);
    expect(m.setPer(31)).toBe(30);
    expect(cut(m).map(p => p.length)).toEqual([30, 30, 10]);
  });

  it('one more page on a piece takes the next piece’s first page and cuts every piece after again', () => {
    const m = M.model(scan(12), CLASS);
    m.setPer(2);
    expect(m.more(1)).toBe(true);
    expect(cut(m)).toEqual([[1, 2], [3, 4, 5], [6, 7], [8, 9], [10, 11], [12]]);
  });

  it('one page fewer gives the last page to the next piece and cuts every piece after again', () => {
    const m = M.model(scan(12), CLASS);
    m.setPer(2);
    expect(m.fewer(0)).toBe(true);
    expect(cut(m)).toEqual([[1], [2, 3], [4, 5], [6, 7], [8, 9], [10, 11], [12]]);
    // The last piece's last page becomes a piece of its own.
    m.setPer(2);
    expect(m.fewer(5)).toBe(true);
    expect(cut(m).slice(-2)).toEqual([[11], [12]]);
  });

  it('never makes an empty piece or one over 30 pages', () => {
    const m = M.model(scan(40), CLASS);
    m.setPer(1);
    expect(m.fewer(0)).toBe(false); // one page already
    m.setPer(30);
    expect(m.more(0)).toBe(false); // 30 already
    expect(m.more(1)).toBe(false); // the last piece: nothing after it
    for (const p of m.pieces()) expect(p.nos.length).toBeGreaterThan(0);
    // Keeping every blank page cannot make a piece of 31.
    const b = M.model(
      scan(
        32,
        Array.from({ length: 16 }, (_, i) => i * 2 + 2),
      ),
      CLASS,
    );
    b.setPer(16);
    expect(cut(b)).toEqual([[1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31]]);
    b.setLeaveOut(false);
    expect(cut(b).map(p => p.length)).toEqual([30, 2]);
  });
});

describe('blank pages', () => {
  it('are left out before the scan is cut, and stay in place', () => {
    // A two-sided scan: every back is blank but page 6.
    const m = M.model(scan(8, [2, 4, 8]), CLASS);
    expect(m.counts()).toMatchObject({ pages: 8, blank: 3, left: 3, kept: 5 });
    expect(M.startPer(m.counts().kept, 5)).toBe(1);
    m.setPer(1);
    expect(cut(m)).toEqual([[1], [3], [5], [6], [7]]);
    // Each left-out page shows in the piece it sits in.
    expect(m.pieces().map(p => p.all)).toEqual([[1, 2], [3, 4], [5], [6], [7, 8]]);
  });

  it('one kept goes back into its own piece, and can be left out again', () => {
    const m = M.model(scan(8, [2, 4, 6, 8]), CLASS);
    m.setPer(1);
    expect(cut(m)).toEqual([[1], [3], [5], [7]]);
    expect(m.keep(4, true)).toBe(true);
    expect(cut(m)).toEqual([[1], [3, 4], [5], [7]]);
    expect(m.counts()).toMatchObject({ left: 3, kept: 5 });
    expect(m.keep(4, false)).toBe(true);
    expect(cut(m)).toEqual([[1], [3], [5], [7]]);
    expect(m.keep(3, true)).toBe(false); // not a blank page
  });

  it('Leave Out Blank Pages off puts every blank page back in place', () => {
    const m = M.model(scan(8, [2, 4, 6, 8]), CLASS);
    m.setPer(1);
    m.setLeaveOut(false);
    expect(cut(m)).toEqual([
      [1, 2],
      [3, 4],
      [5, 6],
      [7, 8],
    ]);
    m.setLeaveOut(true);
    expect(cut(m)).toEqual([[1], [3], [5], [7]]);
  });

  it('a page is blank when its sharpness is under the threshold', () => {
    expect(M.isBlank(M.BLANK_BELOW - 0.1)).toBe(true);
    expect(M.isBlank(M.BLANK_BELOW)).toBe(false);
    expect(M.isBlank(null)).toBe(false);
  });

  it('every page left out makes no pieces, and nothing can be matched', () => {
    const m = M.model(scan(3, [1, 2, 3]), CLASS);
    m.setPer(1);
    expect(m.pieces()).toEqual([]);
    expect(m.line()).toBe('Every page is left out.');
    expect(m.canMatch()).toBe(false);
    m.keep(2, true);
    expect(cut(m)).toEqual([[2]]);
  });
});

describe('a name belongs to the page it was read from', () => {
  // After any change, every named piece starts on the page it was named on.
  function named(m) {
    const out = {};
    m.pieces().forEach(p => {
      if (p.sid) out[p.first] = p.sid;
    });
    return out;
  }

  it('a moved line keeps the name on a piece that still starts on its page, and no other', () => {
    const m = M.model(scan(12), CLASS);
    m.setPer(2);
    m.name(0, 's1'); // pages 1–2
    m.name(2, 's3'); // pages 5–6
    m.name(3, 's5'); // pages 7–8
    expect(named(m)).toEqual({ 1: 's1', 5: 's3', 7: 's5' });
    // Piece 2 takes page 5: piece 3 now starts on page 6, piece 4 on page 8.
    m.more(1);
    expect(cut(m).slice(0, 4)).toEqual([
      [1, 2],
      [3, 4, 5],
      [6, 7],
      [8, 9],
    ]);
    expect(named(m)).toEqual({ 1: 's1' });
    // Back again: the pieces start on 5 and 7 once more, and their names return.
    m.fewer(1);
    expect(named(m)).toEqual({ 1: 's1', 5: 's3', 7: 's5' });
  });

  it('a new Pages per Student keeps the names of pieces that start where they did', () => {
    const m = M.model(scan(12), CLASS);
    m.setPer(2);
    m.name(1, 's2'); // pages 3–4
    m.name(2, 's3'); // pages 5–6
    m.setPer(4); // 1–4, 5–8, 9–12
    expect(named(m)).toEqual({ 5: 's3' });
    m.setPer(1);
    expect(named(m)).toEqual({ 3: 's2', 5: 's3' });
  });

  it('a blank page kept before a named piece’s first page takes the name off', () => {
    const m = M.model(scan(6, [1, 4]), CLASS);
    m.setPer(1);
    expect(cut(m)).toEqual([[2], [3], [5], [6]]);
    m.name(0, 's1'); // first page 2
    m.name(1, 's2'); // first page 3
    m.keep(1, true); // the first piece now starts on page 1
    expect(cut(m)[0]).toEqual([1, 2]);
    expect(named(m)).toEqual({ 3: 's2' });
    // A kept page after a piece's first page leaves its name alone.
    m.keep(4, true);
    expect(cut(m)[1]).toEqual([3, 4]);
    expect(named(m)).toEqual({ 3: 's2' });
  });

  it('a turned page keeps its place and its name', () => {
    const m = M.model(scan(4), CLASS);
    m.setPer(2);
    m.name(1, 's4');
    const turned = { ...fakePage(3), width: 2000, height: 1545 };
    expect(m.setPage(3, turned)).toBe(true);
    expect(m.page(3).page).toBe(turned);
    expect(named(m)).toEqual({ 3: 's4' });
  });
});

describe('Class List Order', () => {
  it('gives the pieces the listed students in order, and none to pieces past the list', () => {
    const m = M.model(scan(16), CLASS);
    m.setPer(2); // 8 pieces, 6 students
    m.setOrder('list');
    expect(sids(m)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6', '', '']);
    expect(m.counts()).toMatchObject({ named: 6, unnamed: 2 });
  });

  it('a name typed on a piece wins, and an emptied box is no one', () => {
    const m = M.model(scan(12), CLASS);
    m.setPer(2);
    m.setOrder('list');
    m.name(2, 's6');
    m.name(4, '');
    expect(sids(m)).toEqual(['s1', 's2', 's6', 's4', '', 's6']);
    expect(m.twice()).toEqual({ s6: [2, 5] });
  });

  it('No Order keeps only the typed names', () => {
    const m = M.model(scan(12), CLASS);
    m.setPer(2);
    m.setOrder('list');
    m.name(1, 's5');
    m.setOrder('typed');
    expect(sids(m)).toEqual(['', 's5', '', '', '', '']);
  });
});

describe('the name box', () => {
  const find = (text, used) => M.matches(CLASS, text, used).map(st => st.id);

  it('a unique start finds one student, by first, last or full name', () => {
    expect(find('av')).toEqual(['s1']);
    expect(find('kow')).toEqual(['s5']);
    expect(find('avery c')).toEqual(['s1']);
    expect(find('theo')).toEqual(['s4']); // the preferred name
    expect(find('theod')).toEqual(['s4']); // the legal first name too
  });

  it('a start two students share finds both, first names before last names', () => {
    expect(find('chen')).toEqual(['s1', 's2']);
    expect(find('m')).toEqual(['s5', 's6']); // Mia, then Mateo: the class list's order
  });

  it('ignores capitals, accents and spaces', () => {
    expect(find('ZOE')).toEqual(['s3']);
    expect(find('  zoë ')).toEqual(['s3']);
    expect(find('Okafor')).toEqual(['s3']);
    expect(M.fold('Zoë  Okafor')).toBe('zoe okafor');
  });

  it('puts a student already on a piece last', () => {
    expect(find('chen', { s1: 0 })).toEqual(['s2', 's1']);
    expect(find('')).toEqual([]);
    expect(find('q')).toEqual([]);
  });

  it('a student on two pieces is flagged, and nothing can be matched until one changes', () => {
    const m = M.model(scan(12), CLASS);
    m.setPer(2);
    m.name(0, 's1');
    m.name(4, 's1');
    m.name(1, 's2');
    expect(m.twice()).toEqual({ s1: [0, 4] });
    expect(m.counts()).toMatchObject({ named: 3, twice: 1 });
    expect(m.canMatch()).toBe(false);
    expect(m.take()).toEqual([]);
    m.name(4, 's3');
    expect(m.canMatch()).toBe(true);
  });
});

describe('the named pieces handed over', () => {
  it('go with the right students and the right pages in order, with no file name, and the rest stay', () => {
    const m = M.model(scan(12, [4]), CLASS);
    m.setPer(2); // [1,2] [3,5] [6,7] [8,9] [10,11] [12]
    expect(cut(m)).toEqual([[1, 2], [3, 5], [6, 7], [8, 9], [10, 11], [12]]);
    m.name(1, 's3');
    m.name(3, 's1');
    m.name(5, 's6');
    const pieces = m.take();
    expect(pieces.map(p => p.sid)).toEqual(['s3', 's1', 's6']);
    expect(pieces.map(p => p.from)).toEqual(['Scan, pages 3–5', 'Scan, pages 8–9', 'Scan, page 12']);
    expect(pieces.map(p => p.pages.map(pg => pg.hash))).toEqual([
      [fakePage(3).hash, fakePage(5).hash],
      [fakePage(8).hash, fakePage(9).hash],
      [fakePage(12).hash],
    ]);
    pieces.forEach(p => p.pages.forEach((pg, i) => expect(pg.name).toBe('page-' + (i + 1) + '.jpg')));
    const text = JSON.stringify(pieces);
    expect(text).not.toContain('Block C');
    expect(text).not.toContain('0832');
    // The unnamed pieces stay, with the pages they had; the blank page went with its piece.
    expect(cut(m)).toEqual([
      [1, 2],
      [6, 7],
      [10, 11],
    ]);
    expect(m.pages().map(p => p.no)).toEqual([1, 2, 6, 7, 10, 11]);
    expect(m.counts()).toMatchObject({ pieces: 3, named: 0 });
  });

  it('in Class List Order, the pieces left do not take the list’s names again', () => {
    const m = M.model(scan(16), CLASS);
    m.setPer(2);
    m.setOrder('list');
    expect(m.take().map(p => p.sid)).toEqual(['s1', 's2', 's3', 's4', 's5', 's6']);
    expect(sids(m)).toEqual(['', '']);
    expect(m.order()).toBe('typed');
  });

  it('every piece is a piece the class page can place', () => {
    const m = M.model(scan(6), CLASS);
    m.setPer(3);
    m.name(0, 's1');
    m.name(1, 's2');
    const stage = AddWorkStage.stage(CLASS.map(st => ({ id: st.id, had: 'none' })));
    for (const p of m.take()) expect(stage.place(p.sid, p).ok).toBe(true);
    expect(stage.counts()).toMatchObject({ ready: 2, pages: 6 });
  });
});

describe('reading the scan', () => {
  const pdf = (name = FILE_NAME, size = 64) =>
    new File([new TextEncoder().encode('%PDF-1.7\n'), new Uint8Array(size)], name, { type: 'application/pdf' });

  it('asks PhotoShrink for up to 150 pages, renames every page, and measures each for blankness', async () => {
    let asked = null;
    const progress = [];
    const res = await S.read(pdf(), {
      shrink: async (file, o) => {
        asked = o;
        o.onProgress({ page: 1, pages: 3 });
        return { ok: true, kind: 'pdf', pages: [1, 2, 3].map(fakePage) };
      },
      measure: async p => (p.hash === fakePage(2).hash ? 1 : 400),
      onProgress: p => progress.push(p.step + p.page),
    });
    expect(asked.maxPages).toBe(150);
    expect(res.ok).toBe(true);
    expect(res.pages.map(p => p.page.name)).toEqual(['page-1.jpg', 'page-2.jpg', 'page-3.jpg']);
    expect(res.pages.map(p => p.blank)).toEqual([false, true, false]);
    expect(JSON.stringify(res.pages)).not.toContain('Block C');
    expect(progress).toEqual(['read1', 'blank1', 'blank2', 'blank3']);
  });

  it('refuses a 151-page scan, and one over 20 MB, with a line that says to scan it in two halves', async () => {
    const openPdf = async () => ({ pages: 151, page: async () => ({ width: 10, height: 10 }), close() {} });
    const over = await S.read(pdf(), { openPdf });
    expect(over).toEqual({ ok: false, said: expect.stringContaining('Scan the pile in two halves') });
    const big = await S.read(pdf(FILE_NAME, PhotoShrink.MAX_PDF_BYTES), { openPdf });
    expect(big.said).toBe(over.said);
    expect(over.said).not.toContain('Block C');
  });

  it('says what Add Work says for a locked PDF and a missing reader', async () => {
    const locked = async () => {
      const err = new Error('locked');
      err.reason = 'unreadable';
      err.extra = { locked: true };
      throw err;
    };
    expect((await S.read(pdf(), { openPdf: locked })).said).toBe(
      'That PDF has a password. Save a copy without one, then add it.',
    );
    const res = await S.read(pdf(), { shrink: async () => ({ ok: false, kind: 'pdf', reason: 'no_decoder' }) });
    expect(res.said).toBe("The PDF reader couldn't load. Check the connection and try again.");
  });

  it('stops asking for pages once the page has closed', async () => {
    let asked = 0;
    let open = true;
    const openPdf = async () => ({
      pages: 3,
      page: async () => {
        asked++;
        open = false;
        return { width: 10, height: 10, source: {} };
      },
      close() {},
    });
    const res = await S.read(pdf(), {
      openPdf,
      alive: () => open,
      shrink: async (file, o) => {
        const doc = await o.openPdf(file, {});
        for (let n = 1; n <= doc.pages; n++) await doc.page(n);
        return { ok: true, pages: [] };
      },
    }).catch(e => ({ thrown: String(e) }));
    expect(asked).toBe(1);
    expect(res.ok).toBe(false);
  });

  it('takes exactly one PDF, by its type or its name', () => {
    expect(S.takes([pdf()])).toBe(true);
    expect(S.takes([{ name: 'scan.PDF', type: '' }])).toBe(true);
    expect(S.takes([pdf(), pdf()])).toBe(false);
    expect(S.takes([{ name: 'a.jpg', type: 'image/jpeg' }])).toBe(false);
    expect(S.takes([])).toBe(false);
  });
});

describe('the grader’s Add Work', () => {
  const was = window.PhotoReaders.openPdf;
  afterEach(() => {
    window.PhotoReaders.openPdf = was;
  });

  it('still refuses a 21-page PDF', async () => {
    window.PhotoReaders.openPdf = async () => ({ pages: 21, page: async () => ({}), close() {} });
    const file = new File([new TextEncoder().encode('%PDF-1.7\n')], 'Essay.pdf', { type: 'application/pdf' });
    const res = await AddWorkFiles.prepare([file]);
    expect(res).toEqual({ pages: [], said: 'That PDF is too long to add here.' });
  });
});

describe('the page', () => {
  const was = window.PhotoReaders.openPdf;
  let stub;
  let assessments;
  beforeEach(() => {
    stub = globalThis.document;
    assessments = globalThis.getAssessments;
    globalThis.document = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
  });
  afterEach(() => {
    S.close();
    window.PhotoReaders.openPdf = was;
    globalThis.document = stub;
    globalThis.getAssessments = assessments;
  });

  it('opens over what is showing, says why a 151-page scan is refused, and closes', async () => {
    window.PhotoReaders.openPdf = async () => ({ pages: 151, page: async () => ({}), close() {} });
    const cid = 'awsplit';
    const a = { id: 'a1', title: 'Cell Lab' };
    globalThis.getAssessments = () => [a];
    let closed = 0;
    const file = new File([new TextEncoder().encode('%PDF-1.7\n')], FILE_NAME, { type: 'application/pdf' });
    expect(S.open(cid, 'nope', file)).toBe(false);
    expect(S.open(cid, 'a1', file, { onClose: () => closed++ })).toBe(true);
    expect(S.isOpen()).toBe(true);
    const overlay = document.getElementById('add-work-split-overlay');
    expect(overlay.querySelector('.aws-title').textContent).toBe('Split the Scan');
    await new Promise(r => setTimeout(r, 0));
    await expect.poll(() => overlay.querySelector('.aws-refused')?.textContent || '').toContain('two halves');
    expect(overlay.textContent).not.toContain('Block C');
    overlay.querySelector('[data-aws="close"]').click();
    expect(S.isOpen()).toBe(false);
    expect(closed).toBe(1);
  });
});
