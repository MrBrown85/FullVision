/**
 * Add Work for the Class (B1, docs/plans/add-work-for-class-plan.md).
 *
 * The staging model: place, add more, move, take off, each choice, On
 * Paper, the counts and the button's words, the order of the writes. The
 * run: every answer from the data layer (the three calls stubbed), a page
 * closed in the middle. The screen in Demo Mode: who is listed, Already
 * In, a refused file, no file name reaching the data layer, and asking
 * before leaving with files waiting.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const page = n => ({
  blob: new Blob(['b' + n], { type: 'image/jpeg' }),
  thumb: new Blob(['t' + n], { type: 'image/jpeg' }),
  hash: String(n).padStart(64, 'a'),
  width: 1500,
  height: 2000,
  name: 'Jordan Reyes-' + n + '.jpg',
});
const pages = (n, from = 1) => Array.from({ length: n }, (_, i) => page(from + i));

function three() {
  return AddWorkStage.stage([
    { id: 'a', had: 'none' },
    { id: 'b', had: 'work' },
    { id: 'c', had: 'paper' },
    { id: 'd', had: 'none' },
  ]);
}

describe('the staging model', () => {
  it('places a file, then more files after it', () => {
    const s = three();
    expect(s.place('a', { from: 'Avery.pdf', pages: pages(2) }).ok).toBe(true);
    expect(s.place('a', { from: 'Avery 2.jpg', pages: pages(1, 3) }).ok).toBe(true);
    const r = s.row('a');
    expect(r.pieces.map(p => p.from)).toEqual(['Avery.pdf', 'Avery 2.jpg']);
    expect(r.pieces.map(p => p.pages.length)).toEqual([2, 1]);
    expect(s.counts()).toMatchObject({ ready: 1, files: 2, pages: 3 });
  });

  it('renames every page as it is kept, and numbers them across files in the writes', () => {
    const s = three();
    s.place('a', { from: 'Jordan Reyes.pdf', pages: pages(2) });
    s.place('a', { from: 'Jordan Reyes 2.pdf', pages: pages(1, 3) });
    s.row('a').pieces.forEach(p => p.pages.forEach(pg => expect(pg.name).toMatch(/^page-\d+\.jpg$/)));
    const w = s.writes()[0];
    expect(w.pages.map(p => p.name)).toEqual(['page-1.jpg', 'page-2.jpg', 'page-3.jpg']);
  });

  it('refuses an empty piece and one over 30 pages', () => {
    const s = three();
    expect(s.place('a', { from: 'x', pages: [] })).toEqual({ ok: false, reason: 'empty' });
    expect(s.place('a', { from: 'x', pages: pages(29) }).ok).toBe(true);
    expect(s.place('a', { from: 'y', pages: pages(2) })).toEqual({ ok: false, reason: 'too_many_pages' });
    expect(s.place('zz', { from: 'y', pages: pages(1) })).toEqual({ ok: false, reason: 'not_found' });
  });

  it('moves one file, or every file, from one student to another', () => {
    const s = three();
    const one = s.place('a', { from: 'one.pdf', pages: pages(1) }).piece;
    s.place('a', { from: 'two.pdf', pages: pages(2) });
    s.place('d', { from: 'dee.pdf', pages: pages(1) });
    const res = s.move('a', 'd', one.id);
    expect(res.ok).toBe(true);
    expect(s.row('a').pieces.map(p => p.from)).toEqual(['two.pdf']);
    expect(s.row('d').pieces.map(p => p.from)).toEqual(['dee.pdf', 'one.pdf']);
    expect(s.move('a', 'd').ok).toBe(true);
    expect(s.row('a').pieces).toEqual([]);
    expect(s.row('d').pieces.map(p => p.from)).toEqual(['dee.pdf', 'one.pdf', 'two.pdf']);
    expect(s.move('d', 'd').ok).toBe(false);
  });

  it('takes one file off, or all of them', () => {
    const s = three();
    const one = s.place('a', { from: 'one.pdf', pages: pages(1) }).piece;
    s.place('a', { from: 'two.pdf', pages: pages(1) });
    expect(s.takeOff('a', one.id).map(p => p.from)).toEqual(['one.pdf']);
    expect(s.takeOff('a').map(p => p.from)).toEqual(['two.pdf']);
    expect(s.counts().files).toBe(0);
  });

  it('a student with photos: Add as More Pages by default, then Replace Them or Skip', () => {
    const s = three();
    expect(s.choices('b')).toEqual(['add', 'replace', 'skip']);
    s.place('b', { from: 'b.pdf', pages: pages(1) });
    expect(s.row('b').choice).toBe('add');
    expect(s.writes()).toEqual([expect.objectContaining({ kind: 'add', sid: 'b', mode: 'add' })]);
    s.choose('b', 'replace');
    expect(s.writes()).toEqual([expect.objectContaining({ kind: 'replace', sid: 'b' })]);
    expect(s.counts().replace).toBe(1);
    s.choose('b', 'skip');
    expect(s.writes()).toEqual([]);
    expect(s.counts().ready).toBe(0);
  });

  it('a student handed in on paper: Replace Them by default, or Skip; never Add as More Pages', () => {
    const s = three();
    expect(s.choices('c')).toEqual(['replace', 'skip']);
    s.place('c', { from: 'c.pdf', pages: pages(1) });
    expect(s.row('c').choice).toBe('replace');
    expect(s.choose('c', 'add')).toBe(false);
    expect(s.writes()).toEqual([expect.objectContaining({ kind: 'replace', sid: 'c' })]);
  });

  it('On Paper only with nothing in and nothing placed, and it can be taken back', () => {
    const s = three();
    expect(s.setOnPaper('b', true)).toBe(false);
    expect(s.setOnPaper('a', true)).toBe(true);
    expect(s.counts()).toMatchObject({ ready: 1, paper: 1 });
    expect(s.setOnPaper('a', false)).toBe(true);
    expect(s.counts().paper).toBe(0);
    s.setOnPaper('a', true);
    // A file placed after On Paper takes its place.
    s.place('a', { from: 'a.pdf', pages: pages(1) });
    expect(s.row('a').onPaper).toBe(false);
  });

  it('counts for the footer and the button', () => {
    const s = three();
    expect(s.buttonLabel()).toBe('Add Work for 0 Students');
    expect(s.footerText()).toBe('2 students with nothing to add stay Not In');
    s.place('a', { from: 'a.pdf', pages: pages(1) });
    expect(s.buttonLabel()).toBe('Add Work for 1 Student');
    expect(s.footerText()).toBe('1 ready to add · 1 student with nothing to add stays Not In');
    s.place('b', { from: 'b.pdf', pages: pages(1) });
    s.setHad('b', 'work', null); // work came in meanwhile: to decide again
    expect(s.footerText()).toBe('1 ready to add · 1 to decide · 1 student with nothing to add stays Not In');
    s.setOnPaper('d', true);
    expect(s.buttonLabel()).toBe('Add Work for 2 Students');
    expect(s.footerText()).toBe('2 ready to add · 1 to decide');
  });

  it('the writes run in roster order, then one On Paper write', () => {
    const s = three();
    s.setOnPaper('d', true);
    s.place('c', { from: 'c.pdf', pages: pages(1) });
    s.place('a', { from: 'a.pdf', pages: pages(1) });
    s.place('b', { from: 'b.pdf', pages: pages(1) });
    expect(s.writes().map(w => w.kind + ':' + (w.sid || w.sids.join(',')) + (w.mode ? ':' + w.mode : ''))).toEqual([
      'add:a:new',
      'add:b:add',
      'replace:c',
      'paper:d',
    ]);
  });
});

describe('the run', () => {
  function stubs(answers) {
    const calls = [];
    const api = {
      add: vi.fn((sid, pg, mode) => {
        calls.push('add:' + sid + ':' + mode);
        return Promise.resolve(answers[sid] || { result: 'sent' });
      }),
      replace: vi.fn(sid => {
        calls.push('replace:' + sid);
        return Promise.resolve(answers[sid] || { result: 'sent' });
      }),
      paper: vi.fn(sids => {
        calls.push('paper:' + sids.join(','));
        return Promise.resolve(
          answers.paper || {
            result: 'sent',
            marked: sids.length,
            submissions: sids.map(id => ({ enrollment_id: id, on_paper: true })),
          },
        );
      }),
    };
    return { api, calls };
  }

  function placed() {
    const s = AddWorkStage.stage([
      { id: 'a', had: 'none' },
      { id: 'b', had: 'work' },
      { id: 'c', had: 'paper' },
      { id: 'd', had: 'none' },
      { id: 'e', had: 'none' },
    ]);
    s.place('a', { from: 'a.pdf', pages: pages(1) });
    s.place('b', { from: 'b.pdf', pages: pages(1) });
    s.place('c', { from: 'c.pdf', pages: pages(1) });
    s.place('d', { from: 'd.pdf', pages: pages(1) });
    s.setOnPaper('e', true);
    return s;
  }

  it('one student after another, each awaited, and On Paper last; sent clears the student', async () => {
    const s = placed();
    const { api, calls } = stubs({});
    let inFlight = 0;
    let most = 0;
    ['add', 'replace', 'paper'].forEach(k => {
      const was = api[k];
      api[k] = (...args) => {
        inFlight++;
        most = Math.max(most, inFlight);
        return was(...args).then(r => {
          inFlight--;
          return r;
        });
      };
    });
    const seen = [];
    const released = [];
    const out = await AddWorkStage.run(s, api, {
      progress: (n, total) => seen.push(n + '/' + total),
      release: p => released.push(...p.map(x => x.from)),
    });
    expect(calls).toEqual(['add:a:new', 'add:b:add', 'replace:c', 'add:d:new', 'paper:e']);
    expect(most).toBe(1);
    expect(seen).toEqual(['1/5', '2/5', '3/5', '4/5', '5/5']);
    expect(out).toMatchObject({ added: 4, paper: 1, stopped: null, closed: false });
    expect(released).toEqual(['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf']);
    expect(s.counts()).toMatchObject({ files: 0, paper: 0, ready: 0 });
    expect(s.row('e').had).toBe('paper');
    expect(s.row('a').had).toBe('work');
  });

  it('already_sent keeps the pages and shows the three choices', async () => {
    const s = placed();
    const { api } = stubs({ a: { result: 'already_sent', submission: { on_paper: false, files: [{}] } } });
    await AddWorkStage.run(s, api);
    const r = s.row('a');
    expect(r.pieces.length).toBe(1);
    expect(r.had).toBe('work');
    expect(r.choice).toBe(null);
    expect(s.choices('a')).toEqual(['add', 'replace', 'skip']);
    expect(r.note).toBe('Work came in for this student meanwhile. It is shown now.');
    expect(s.counts().decide).toBe(1);
  });

  it('on_paper keeps the pages and offers Replace Them or Skip', async () => {
    const s = placed();
    const { api } = stubs({ b: { result: 'on_paper' } });
    await AddWorkStage.run(s, api);
    expect(s.row('b').pieces.length).toBe(1);
    expect(s.choices('b')).toEqual(['replace', 'skip']);
    expect(s.row('b').choice).toBe(null);
    expect(s.row('b').note).toBe('This was handed in on paper. Use Replace Them to add photos.');
  });

  it('too_many_pages and uploading say the words and keep the pages', async () => {
    const s = placed();
    const { api } = stubs({ a: { result: 'too_many_pages' }, d: { result: 'uploading' } });
    await AddWorkStage.run(s, api);
    expect(s.row('a').pieces.length).toBe(1);
    expect(s.row('a').note).toBe('A piece of work can have 30 pages at most.');
    expect(s.row('d').pieces.length).toBe(1);
    expect(s.row('d').note).toBe("That work is still uploading. Try again when it's in.");
  });

  it('class_full stops the run once and leaves the students not yet run as they are', async () => {
    const s = placed();
    const { api, calls } = stubs({ b: { result: 'class_full' } });
    const out = await AddWorkStage.run(s, api);
    expect(calls).toEqual(['add:a:new', 'add:b:add']);
    expect(out.stopped).toBe('class_full');
    expect(out.said).toBe('This class has no room for more photos.');
    expect(out.added).toBe(1);
    expect(s.row('c').pieces.length).toBe(1);
    expect(s.row('d').pieces.length).toBe(1);
    expect(s.row('e').onPaper).toBe(true);
    expect(s.row('b').note).toBe('');
  });

  it('storage_full stops the run too', async () => {
    const s = placed();
    const { api, calls } = stubs({ a: { result: 'storage_full' } });
    const out = await AddWorkStage.run(s, api);
    expect(calls).toEqual(['add:a:new']);
    expect(out.said).toBe('This computer is full. Free some space, then try again.');
  });

  it('not_found drops the student; a thrown write is "couldn\'t be kept"', async () => {
    const s = placed();
    const { api } = stubs({ a: { result: 'not_found' } });
    api.replace = () => Promise.reject(new Error('boom'));
    const released = [];
    await AddWorkStage.run(s, api, { release: p => released.push(...p.map(x => x.from)) });
    expect(s.row('a')).toBe(null);
    expect(released).toContain('a.pdf');
    expect(s.row('c').note).toBe("The photos couldn't be kept. Try again.");
    expect(s.row('c').pieces.length).toBe(1);
  });

  it('nothing_sent: the work went meanwhile, so the student is new work again', async () => {
    const s = placed();
    const { api } = stubs({ b: { result: 'nothing_sent' } });
    await AddWorkStage.run(s, api);
    expect(s.row('b').had).toBe('none');
    expect(s.writes()[0]).toMatchObject({ sid: 'b', mode: 'new' });
  });

  it('a student on the On Paper write who had work in by then is not counted', async () => {
    const s = placed();
    const { api } = stubs({ paper: { result: 'sent', marked: 0, submissions: [] } });
    const out = await AddWorkStage.run(s, api);
    expect(out).toMatchObject({ added: 4, paper: 0 });
    expect(s.row('e').had).toBe('work');
    expect(s.row('e').onPaper).toBe(false);
  });

  it('a piece placed after the writes were taken stays when its student is added', async () => {
    const s = placed();
    const { api } = stubs({});
    const was = api.add;
    let late = null;
    api.add = (sid, pg, mode) => {
      // A file finishes reading for a while its write is out.
      if (sid === 'a') late = s.place('a', { from: 'late.pdf', pages: pages(2) }).piece;
      return was(sid, pg, mode);
    };
    const released = [];
    await AddWorkStage.run(s, api, { release: p => released.push(...p.map(x => x.from)) });
    expect(released).not.toContain('late.pdf');
    expect(s.row('a').pieces.map(p => p.id)).toEqual([late.id]);
    // It waits as more pages for a student whose work is now in.
    expect(s.row('a')).toMatchObject({ had: 'work', choice: 'add' });
    expect(s.counts().ready).toBe(1);
  });

  it('a page closed in the middle stops after the write that is running, and changes nothing more', async () => {
    const s = placed();
    const { api, calls } = stubs({});
    let open = true;
    const was = api.add;
    api.add = (...args) =>
      was(...args).then(r => {
        if (args[0] === 'b') open = false;
        return r;
      });
    const out = await AddWorkStage.run(s, api, { alive: () => open });
    expect(calls).toEqual(['add:a:new', 'add:b:add']);
    expect(out.closed).toBe(true);
    // b's answer came after the close: b is left as it was.
    expect(s.row('b').pieces.length).toBe(1);
  });
});

/* ── The screen, in Demo Mode ── */
const CID = U(1);
const PIECE = U(31);
const DIBELS = U(32);
const GROUP = U(33);
const Q = U(41);
const LAST = ['Abbott', 'Baker', 'Chen', 'Diaz', 'Evans'];
const IDS = LAST.map((_, i) => U(100 + i));

let doc;
let stubDocument;
let wasDemo;
let realPrepare;
let realConfirm;

const text = el => el.textContent.replace(/\s+/g, ' ').trim();
const $ = sel => doc.querySelector(sel);
const $$ = sel => [...doc.querySelectorAll(sel)];
const click = el => el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
const rowOf = sid => $('.awc-row[data-awc-target="' + sid + '"]');

function seedScreen() {
  seedClass(CID, {
    students: LAST.map((last, i) => ({
      id: IDS[i],
      firstName: ['Avery', 'Jordan', 'Mia', 'Ravi', 'Wren'][i],
      lastName: last,
    })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      { id: PIECE, title: 'Conscription', tagIds: [Q], date: '2026-10-20', dueDate: '2026-10-30' },
      { id: DIBELS, title: 'Winter Benchmark', scoreMode: 'dibels', scoringType: 'dibels', tagIds: [] },
      {
        id: GROUP,
        title: 'Group Poster',
        tagIds: [Q],
        collaboration: 'group',
        groups: [[IDS[0], IDS[1]]],
      },
    ],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_save' },
  });
  COURSES[CID].name = 'Socials 10';
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: [
      { id: PIECE, students_send: 'photos' },
      { id: GROUP, students_send: 'photos' },
    ],
    submissions: [
      {
        id: 'w-b',
        assessment_id: PIECE,
        enrollment_id: IDS[1],
        version: 1,
        state: 'sent',
        sent_by: 'student',
        on_paper: false,
        sent_at: '2026-10-30T20:41:00Z',
        files: [
          { id: 'f1', page: 1, path: 'x-1.jpg' },
          { id: 'f2', page: 2, path: 'x-2.jpg' },
        ],
      },
      {
        id: 'w-c',
        assessment_id: PIECE,
        enrollment_id: IDS[2],
        version: 1,
        state: 'sent',
        sent_by: 'teacher',
        on_paper: true,
        sent_at: '2026-10-31T10:00:00Z',
        files: [],
      },
    ],
  });
  clearProfCache();
}

beforeEach(() => {
  localStorage.clear();
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  stubDocument = globalThis.document;
  doc = parseHTML('<!DOCTYPE html><html><body><div id="main"></div></body></html>').document;
  globalThis.document = doc;
  realPrepare = PhotoShrink.prepare;
  realConfirm = globalThis.showConfirm;
  PhotoShrink.prepare = vi.fn(file =>
    Promise.resolve(
      file.refuse
        ? { ok: false, reason: PhotoShrink.REASONS.OFFICE }
        : {
            ok: true,
            pages: Array.from({ length: file.n || 1 }, (_, i) =>
              Object.assign(page(i + 1), { name: file.name.replace(/\.\w+$/, '') + '-' + (i + 1) + '.jpg' }),
            ),
          },
    ),
  );
  globalThis.showConfirm = vi.fn();
});
afterEach(() => {
  AddWorkClass.close(true);
  PhotoShrink.prepare = realPrepare;
  globalThis.showConfirm = realConfirm;
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  vi.restoreAllMocks();
});

describe('the page', () => {
  it("is offered where the row's + is: not on a DIBELS piece, not for students graded together", () => {
    seedScreen();
    const piece = getAssessments(CID).find(a => a.id === PIECE);
    const dibels = getAssessments(CID).find(a => a.id === DIBELS);
    const group = getAssessments(CID).find(a => a.id === GROUP);
    expect(AddWorkClass.offered(CID, piece)).toBe(true);
    expect(AddWorkClass.offered(CID, dibels)).toBe(false);
    expect(AddWorkClass.students(CID, group).map(s => s.id)).toEqual(IDS.slice(2));
    expect(AddWorkClass.students(CID, piece).map(s => s.id)).toEqual(IDS);
  });

  it('is not offered when the piece shows no work', () => {
    seedScreen();
    setStudentPageSwitch(CID, false);
    expect(AddWorkClass.open(CID, PIECE)).toBe(false);
    expect($('#add-work-class-overlay')).toBeNull();
  });

  it("says the board's words, and what is already in", () => {
    seedScreen();
    expect(AddWorkClass.open(CID, PIECE)).toBe(true);
    expect(text($('.awc-title'))).toBe('Add Work for the Class');
    expect(text($('.awc-sub'))).toBe('Conscription · Socials 10 · 5 students');
    expect($$('.awc-seg-btn').map(text)).toEqual(['Column', 'Grid']);
    expect(text($('.awc-primary'))).toBe('Add Work for 0 Students');
    expect($('.awc-primary').disabled).toBe(true);
    expect($$('.awc-row .awc-name').map(text)).toEqual([
      'Avery Abbott',
      'Jordan Baker',
      'Mia Chen',
      'Ravi Diaz',
      'Wren Evans',
    ]);
    expect(text(rowOf(IDS[0]).querySelector('.awc-had'))).toBe('Nothing in');
    expect(text(rowOf(IDS[1]).querySelector('.awc-had'))).toBe('2 photos, Oct 30');
    expect(text(rowOf(IDS[2]).querySelector('.awc-had'))).toBe('Handed in on paper');
    expect(text(rowOf(IDS[0]).querySelector('.awc-drop'))).toBe('Drop here, or click to choose');
    // On Paper only where nothing is in.
    expect(rowOf(IDS[0]).querySelector('.awc-paper')).not.toBeNull();
    expect(rowOf(IDS[1]).querySelector('.awc-paper')).toBeNull();
    expect(text($('.awc-hint'))).toBe('Nothing is added until you press Add Work.');
    expect(text($('.awc-count'))).toBe('3 students with nothing to add stay Not In');
  });

  it('a placed file shows its name and pages, and the three choices on a student with photos', async () => {
    seedScreen();
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.addFiles(IDS[1], [{ name: 'Jordan Baker.pdf', n: 1 }]);
    const row = rowOf(IDS[1]);
    expect(text(row.querySelector('.awc-file-name'))).toBe('Jordan Baker.pdf');
    expect(text(row.querySelector('.awc-pages'))).toBe('1 page');
    expect(row.querySelector('.awc-off').getAttribute('aria-label')).toBe('Take this file off');
    expect([...row.querySelectorAll('.awc-choice')].map(text)).toEqual([
      'Add as More Pages',
      'Replace Them',
      'Skip Jordan',
    ]);
    expect(row.querySelector('.awc-choice.is-on').getAttribute('data-choice')).toBe('add');
    expect(row.querySelector('.awc-warn')).toBeNull();
    click(row.querySelector('[data-choice="replace"]'));
    expect(text(rowOf(IDS[1]).querySelector('.awc-warn'))).toBe('Deleted photos can’t come back.');
    // Handed in on paper: Replace Them or Skip only, and nothing is deleted.
    await AddWorkClass.addFiles(IDS[2], [{ name: 'mia.jpg' }]);
    expect([...rowOf(IDS[2]).querySelectorAll('.awc-choice')].map(text)).toEqual(['Replace Them', 'Skip Mia']);
    expect(rowOf(IDS[2]).querySelector('.awc-warn')).toBeNull();
    expect(text($('.awc-primary'))).toBe('Add Work for 2 Students');
  });

  it('a refused file says why beside that student, and nothing waits', async () => {
    seedScreen();
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.addFiles(IDS[0], [{ name: 'essay.docx', refuse: true }]);
    expect(text(rowOf(IDS[0]).querySelector('.awc-row-note'))).toBe('Save it as a PDF first.');
    expect(rowOf(IDS[0]).querySelector('.awc-chip')).toBeNull();
    expect(text($('.awc-primary'))).toBe('Add Work for 0 Students');
  });

  it('no part of a file name reaches the data layer', async () => {
    seedScreen();
    const handed = [];
    const real = globalThis.addStudentWorkPages;
    globalThis.addStudentWorkPages = vi.fn((cid, sid, aid, pg) => {
      handed.push(...pg);
      return Promise.resolve({ result: 'sent' });
    });
    try {
      AddWorkClass.open(CID, PIECE);
      await AddWorkClass.addFiles(IDS[0], [{ name: 'Avery Abbott essay.pdf', n: 2 }]);
      await AddWorkClass.addFiles(IDS[0], [{ name: 'abbott_avery_p3.jpg' }]);
      click($('.awc-primary'));
      await new Promise(r => setTimeout(r, 0));
      await new Promise(r => setTimeout(r, 0));
    } finally {
      globalThis.addStudentWorkPages = real;
    }
    expect(handed.map(p => p.name)).toEqual(['page-1.jpg', 'page-2.jpg', 'page-3.jpg']);
    const said = JSON.stringify(handed, (k, v) => (v instanceof Blob ? '' : v)).toLowerCase();
    ['avery', 'abbott', 'essay', 'jordan', 'reyes', 'p3'].forEach(bit => expect(said).not.toContain(bit));
  });

  it('adds in Demo Mode, then lists who is still Not In; nothing else is set', async () => {
    seedScreen();
    // The photo queue, kept in memory: what it holds is what would upload.
    const kept = [];
    const store = {
      list: async () => kept.map(k => k.meta),
      putAll: async items => items.forEach(i => kept.push(JSON.parse(JSON.stringify(i)))),
      update: async () => {},
      blobs: async () => null,
      remove: async () => {},
      clear: async () => {},
    };
    runInThisContext(readFileSync('shared/photo-queue.js', 'utf-8'), { filename: 'shared/photo-queue.js' });
    window.PhotoQueue.configure({ store, isDemo: () => true, upload: async () => ({ error: null }) });
    const scoresBefore = JSON.stringify(getScores(CID));
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.addFiles(IDS[0], [{ name: 'Avery Abbott essay.pdf', n: 2 }]);
    click(rowOf(IDS[3]).querySelector('.awc-paper'));
    expect(text($('.awc-count'))).toBe('2 ready to add · 1 student with nothing to add stays Not In');
    click($('.awc-primary'));
    for (let i = 0; i < 40 && !$('.awc-done'); i++) await new Promise(r => setTimeout(r, 0));
    window.PhotoQueue.release();
    // No file name reached the queue either.
    expect(kept.length).toBe(2);
    expect(JSON.stringify(kept).toLowerCase()).not.toMatch(/avery|abbott|essay/);
    // Only pages count as Added Work; On Paper is said on its own line.
    expect(text($('.awc-done-title'))).toBe('Added Work for 1 Student');
    expect(text($('.awc-done-paper'))).toBe('1 set to Handed in on paper');
    expect($$('.awc-done-row .awc-name').map(text)).toEqual(['Wren Evans']);
    expect($$('.awc-done-row button').map(text)).toEqual(['On Paper', 'Leave Not In']);
    expect(getStudentSubmission(CID, IDS[0], PIECE).files.length).toBe(2);
    expect(getStudentSubmission(CID, IDS[3], PIECE).on_paper).toBe(true);
    expect(getStudentSubmission(CID, IDS[4], PIECE)).toBeNull();
    expect(JSON.stringify(getScores(CID))).toBe(scoresBefore);
    expect(getAssignmentStatus(CID, IDS[4], PIECE)).toBeFalsy();
    // Leave Not In does nothing but take the student off the list.
    click($('.awc-leave-in'));
    expect($$('.awc-done-row').length).toBe(0);
    expect(getStudentSubmission(CID, IDS[4], PIECE)).toBeNull();
  });

  it('asks before leaving with files waiting; leaves at once with none', async () => {
    seedScreen();
    const onClose = vi.fn();
    AddWorkClass.open(CID, PIECE, { onClose });
    await AddWorkClass.addFiles(IDS[0], [{ name: 'a.pdf' }]);
    await AddWorkClass.addFiles(IDS[3], [{ name: 'b.pdf' }]);
    click($('.awc-cancel'));
    expect(showConfirm).toHaveBeenCalledWith(
      'Leave without adding?',
      '2 files are waiting.',
      'Leave',
      'danger',
      expect.any(Function),
      'Keep Adding',
    );
    expect(AddWorkClass.isOpen()).toBe(true);
    showConfirm.mock.calls[0][4]();
    expect(AddWorkClass.isOpen()).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    AddWorkClass.open(CID, PIECE, { onClose });
    click($('.awc-back'));
    expect(AddWorkClass.isOpen()).toBe(false);
    expect(showConfirm).toHaveBeenCalledTimes(1);
  });

  it('lets each picture go when its file leaves and when the page closes', async () => {
    seedScreen();
    const made = [];
    const gone = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
      made.push('blob:' + made.length);
      return made[made.length - 1];
    });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(u => gone.push(u));
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.addFiles(IDS[0], [{ name: 'a.pdf' }]);
    await AddWorkClass.addFiles(IDS[3], [{ name: 'b.pdf' }]);
    click(rowOf(IDS[0]).querySelector('.awc-off'));
    expect(gone).toEqual(['blob:0']);
    AddWorkClass.close(true);
    expect(gone).toEqual(['blob:0', 'blob:1']);
  });

  it('Add Work waits while a file is being read', async () => {
    seedScreen();
    const add = vi.spyOn(globalThis, 'addStudentWorkPages');
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.addFiles(IDS[0], [{ name: 'a.pdf' }]);
    expect(text($('.awc-primary'))).toBe('Add Work for 1 Student');
    let finish;
    const realPrep = PhotoShrink.prepare;
    PhotoShrink.prepare = vi.fn(() => new Promise(r => (finish = r)));
    const going = AddWorkClass.addFiles(IDS[3], [{ name: 'b.pdf' }]);
    expect(text($('.awc-primary'))).toBe('Reading Files…');
    expect($('.awc-primary').disabled).toBe(true);
    // Even pressed, it does nothing.
    $('.awc-primary').disabled = false;
    click($('.awc-primary'));
    await new Promise(r => setTimeout(r, 0));
    expect(add).not.toHaveBeenCalled();
    finish({ ok: true, pages: pages(1) });
    await going;
    PhotoShrink.prepare = realPrep;
    expect(text($('.awc-primary'))).toBe('Add Work for 2 Students');
    expect($('.awc-primary').disabled).toBe(false);
  });

  const dragEvent = (type, dataTransfer) => {
    const ev = new doc.defaultView.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dataTransfer });
    return ev;
  };
  const filesFrom = list => ({ types: ['Files'], files: list, dropEffect: '' });

  it('after a chip drag that never ended, a file dropped on another student goes there and nothing moves', async () => {
    seedScreen();
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.addFiles(IDS[0], [{ name: 'avery.pdf' }]);
    // A chip starts to move; its dragend never reaches the page.
    rowOf(IDS[0])
      .querySelector('.awc-chip')
      .dispatchEvent(dragEvent('dragstart', { types: [], setData() {} }));
    const drop = dragEvent('drop', filesFrom([{ name: 'ravi.jpg' }]));
    rowOf(IDS[3]).dispatchEvent(dragEvent('dragover', filesFrom([])));
    rowOf(IDS[3]).dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0));
    expect([...rowOf(IDS[3]).querySelectorAll('.awc-file-name')].map(text)).toEqual(['ravi.jpg']);
    expect([...rowOf(IDS[0]).querySelectorAll('.awc-file-name')].map(text)).toEqual(['avery.pdf']);
  });

  it('a chip drag is let go when the page is drawn again without it', async () => {
    seedScreen();
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.addFiles(IDS[0], [{ name: 'avery.pdf' }]);
    rowOf(IDS[0])
      .querySelector('.awc-chip')
      .dispatchEvent(dragEvent('dragstart', { types: [], setData() {} }));
    // The page is drawn again mid-drag (a file finished reading, a layout change).
    click($('.awc-seg-btn[data-layout="column"]'));
    rowOf(IDS[3]).dispatchEvent(dragEvent('drop', { types: [], files: [] }));
    expect(rowOf(IDS[3]).querySelector('.awc-chip')).toBeNull();
    expect([...rowOf(IDS[0]).querySelectorAll('.awc-file-name')].map(text)).toEqual(['avery.pdf']);
  });

  it('with only On Paper set, the summary says so', async () => {
    seedScreen();
    AddWorkClass.open(CID, PIECE);
    click(rowOf(IDS[4]).querySelector('.awc-paper'));
    click($('.awc-primary'));
    for (let i = 0; i < 20 && !$('.awc-done'); i++) await new Promise(r => setTimeout(r, 0));
    expect(text($('.awc-done-title'))).toBe('Set 1 Student to Handed In on Paper');
    expect($('.awc-done-paper')).toBeNull();
  });

  it('moves a file to another student with Move to…', async () => {
    seedScreen();
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.addFiles(IDS[0], [{ name: 'wren.pdf' }]);
    click(rowOf(IDS[0]).querySelector('.awc-move'));
    const items = $$('.awc-move-item');
    expect(items.map(text)).toEqual(['Jordan Baker', 'Mia Chen', 'Ravi Diaz', 'Wren Evans']);
    click(items[3]);
    expect(rowOf(IDS[0]).querySelector('.awc-chip')).toBeNull();
    expect(text(rowOf(IDS[4]).querySelector('.awc-file-name'))).toBe('wren.pdf');
  });

  it('a late shrink for a page that closed draws nothing', async () => {
    seedScreen();
    let finish;
    PhotoShrink.prepare = vi.fn(() => new Promise(r => (finish = r)));
    AddWorkClass.open(CID, PIECE);
    const going = AddWorkClass.addFiles(IDS[0], [{ name: 'a.pdf' }]);
    expect(text(rowOf(IDS[0]).querySelector('.awc-reading'))).toBe('Reading…');
    await new Promise(r => setTimeout(r, 0));
    expect(PhotoShrink.prepare).toHaveBeenCalledTimes(1);
    AddWorkClass.close(true);
    AddWorkClass.open(CID, PIECE);
    finish({ ok: true, pages: pages(1) });
    await going;
    expect(rowOf(IDS[0]).querySelector('.awc-chip')).toBeNull();
  });

  it('keeps the layout for next time, and draws Grid with a card per student', () => {
    seedScreen();
    AddWorkClass.open(CID, PIECE);
    click($('.awc-seg-btn[data-layout="grid"]'));
    expect($$('.awc-card').length).toBe(5);
    AddWorkClass.close(true);
    AddWorkClass.open(CID, PIECE);
    expect($('.awc-seg-btn[data-layout="grid"]').getAttribute('aria-pressed')).toBe('true');
  });
});
