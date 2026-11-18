/**
 * AddWorkClass.open(cid, aid, { files | drop }) (D5 of
 * docs/plans/dashboard-inbox-plan.md): the Dashboard's Inbox opens Add Work
 * for the Class with files already given. They must land exactly as they
 * would by the page's own way in: open then takeFiles for files, a drop off
 * a student for a drop. Each test does both and compares what the page holds.
 * In Demo Mode, with PhotoShrink stubbed, as tests/add-work-tray.test.js.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const PIECE = U(31);
const DRAFT = U(32);
const Q = U(41);
const NAMES = [
  ['Avery', 'Chen'],
  ['Liam', 'Chen'],
  ['Mateo', 'Cruz'],
  ['Priya', 'Kaur'],
  ['Sam', 'Blackwood'],
  ['Jordan', 'Reyes'],
];
const IDS = NAMES.map((_, i) => U(100 + i));

let doc;
let stubDocument;
let wasDemo;
let realPrepare;
let realConfirm;

const text = el => el.textContent.replace(/\s+/g, ' ').trim();
const $ = sel => doc.querySelector(sel);
const $$ = sel => [...doc.querySelectorAll(sel)];
const tick = async (n = 20) => {
  for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0));
};
const file = (name, extra) =>
  Object.assign({ name, type: /\.pdf$/i.test(name) ? 'application/pdf' : 'image/jpeg' }, extra);

// Two exact names, one close spelling, one with no name, a hidden file and one that can't be read.
const PILE = () => [
  file('Avery Chen.pdf', { n: 2 }),
  file('Kaur_Priya.jpg'),
  file('Matteo C.jpg'),
  file('SCAN0017.jpg'),
  { name: '.DS_Store', type: '' },
  { name: 'notes.txt', type: 'text/plain' },
];

// What the page holds: each student's files, what waits and why, the status and counts lines.
function held() {
  return {
    rows: $$('.awc-row[data-awc-target]').map(r => ({
      sid: r.getAttribute('data-awc-target'),
      files: [...r.querySelectorAll('.awc-file-name')].map(text),
    })),
    waiting: $$('.awt-item').map(el => [text(el.querySelector('.awt-file')), text(el.querySelector('.awt-why'))]),
    tray: AddWorkClass.waiting().map(x => x.from),
    status: text($('.awt-status')),
    count: text($('.awc-count')),
  };
}

function seed() {
  seedClass(CID, {
    students: NAMES.map(([firstName, lastName], i) => ({ id: IDS[i], firstName, lastName })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      { id: PIECE, title: 'Conscription', tagIds: [Q], date: '2026-10-20', dueDate: '2026-10-30' },
      { id: DRAFT, title: 'Not Yet', tagIds: [Q], isDraft: true },
    ],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_save' },
  });
  COURSES[CID].name = 'Socials 10';
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: [{ id: PIECE, students_send: 'photos' }],
    submissions: [],
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
  PhotoShrink.prepare = vi.fn(f =>
    Promise.resolve({
      ok: true,
      pages: Array.from({ length: f.n || 1 }, (_, i) => ({
        blob: new Blob(['b' + i], { type: 'image/jpeg' }),
        thumb: new Blob(['t' + i], { type: 'image/jpeg' }),
        hash: String(i + 1).padStart(64, 'a'),
        width: 1500,
        height: 2000,
        name: f.name.replace(/\.\w+$/, '') + '-' + (i + 1) + '.jpg',
      })),
    }),
  );
  globalThis.showConfirm = vi.fn();
  delete window.AddWorkSplit;
  seed();
});
afterEach(() => {
  AddWorkClass.close(true);
  delete window.AddWorkSplit;
  PhotoShrink.prepare = realPrepare;
  globalThis.showConfirm = realConfirm;
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  vi.restoreAllMocks();
});

describe('open with files', () => {
  it('leaves the page holding exactly what open then takeFiles leaves', async () => {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles(PILE());
    await tick();
    const plain = held();
    AddWorkClass.close(true);

    expect(AddWorkClass.open(CID, PIECE, { files: PILE() })).toBe(true);
    await tick();
    const given = held();
    expect(given).toEqual(plain);
    // And it is the pile as the tray matches it: two certain names placed, the rest waiting.
    expect(given.rows.find(r => r.sid === IDS[0]).files).toEqual(['Avery Chen.pdf']);
    expect(given.rows.find(r => r.sid === IDS[3]).files).toEqual(['Kaur_Priya.jpg']);
    expect(given.waiting.map(w => w[0])).toEqual(['Matteo C.jpg · 1 page', 'SCAN0017.jpg · 1 page']);
    expect(given.status).toBe('1 file that isn’t a photo or PDF was passed over.');
  });

  it('takes a FileList-like object as an array', async () => {
    const list = PILE();
    const like = { length: list.length };
    list.forEach((f, i) => (like[i] = f));
    AddWorkClass.open(CID, PIECE, { files: like });
    await tick();
    expect(held().rows.find(r => r.sid === IDS[0]).files).toEqual(['Avery Chen.pdf']);
  });

  it('a single PDF that names no student opens Split the Scan, as the tray does', async () => {
    const opened = [];
    window.AddWorkSplit = {
      takes: files => files.length === 1 && /\.pdf$/i.test(files[0].name),
      open: vi.fn((cid, aid, f) => {
        opened.push([cid, aid, f.name]);
        return true;
      }),
      isOpen: () => opened.length > 0,
      close: vi.fn(),
    };
    AddWorkClass.open(CID, PIECE, { files: [file('SCAN0017.pdf')] });
    await tick();
    expect(opened).toEqual([[CID, PIECE, 'SCAN0017.pdf']]);
    expect(PhotoShrink.prepare).not.toHaveBeenCalled();
  });

  it('with neither option the page is drawn exactly as today', () => {
    AddWorkClass.open(CID, PIECE);
    const plain = $('#add-work-class-overlay').innerHTML;
    AddWorkClass.close(true);
    AddWorkClass.open(CID, PIECE, { onClose: () => {} });
    expect($('#add-work-class-overlay').innerHTML).toBe(plain);
    expect(PhotoShrink.prepare).not.toHaveBeenCalled();
  });

  it('a piece not offered: false, and nothing is taken', async () => {
    const files = PILE();
    expect(AddWorkClass.open(CID, DRAFT, { files })).toBe(false);
    expect(AddWorkClass.open(CID, DRAFT, { drop: { types: ['Files'], files, items: [] } })).toBe(false);
    await tick();
    expect($('#add-work-class-overlay')).toBeNull();
    expect(AddWorkClass.isOpen()).toBe(false);
    expect(PhotoShrink.prepare).not.toHaveBeenCalled();
  });
});

describe('open with a drop', () => {
  const fileEntry = f => ({ isFile: true, isDirectory: false, name: f.name, file: ok => ok(f) });
  const dirEntry = (name, children) => {
    let given = false;
    return {
      isFile: false,
      isDirectory: true,
      name,
      createReader: () => ({
        readEntries: ok => {
          ok(given ? [] : children);
          given = true;
        },
      }),
    };
  };
  /* As a browser hands a drop over: its items, files and types can be read
     only while the drop is being handled, and are empty after it (the entries
     already taken stay usable). end() closes that turn. */
  const expiring = dt => {
    let live = true;
    return {
      get types() {
        return live ? dt.types : [];
      },
      get files() {
        return live ? dt.files : [];
      },
      get items() {
        return live ? dt.items : [];
      },
      end() {
        live = false;
      },
    };
  };
  // A fresh folder each time: a reader gives its entries once.
  const folderDrop = () => {
    const root = dirEntry('Period 2', [
      fileEntry(file('Avery Chen.pdf')),
      fileEntry({ name: '.DS_Store', type: '' }),
      dirEntry('more', [fileEntry(file('Priya Kaur.jpg')), fileEntry({ name: 'readme.txt', type: 'text/plain' })]),
      dirEntry('__MACOSX', [fileEntry(file('._Avery Chen.pdf'))]),
      fileEntry(file('Matteo C.jpg')),
    ]);
    return expiring({
      types: ['Files'],
      files: [{ name: 'Period 2', type: '' }],
      items: [{ kind: 'file', webkitGetAsEntry: () => root }],
    });
  };
  const dropOnPage = dt => {
    const ev = new doc.defaultView.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', { value: dt });
    $('[data-awt-drop]').dispatchEvent(ev);
    dt.end();
  };
  // As the Inbox calls it: inside the drop's own turn, which ends at once after.
  const openWith = dt => {
    const r = AddWorkClass.open(CID, PIECE, { drop: dt });
    dt.end();
    return r;
  };

  it('walks a dropped folder exactly as a drop on the page does', async () => {
    AddWorkClass.open(CID, PIECE);
    dropOnPage(folderDrop());
    await tick();
    const plain = held();
    AddWorkClass.close(true);

    openWith(folderDrop());
    await tick();
    const given = held();
    expect(given).toEqual(plain);
    expect(given.rows.find(r => r.sid === IDS[0]).files).toEqual(['Avery Chen.pdf']);
    expect(given.rows.find(r => r.sid === IDS[3]).files).toEqual(['Priya Kaur.jpg']);
    expect(given.waiting.map(w => w[0])).toEqual(['Matteo C.jpg · 1 page']);
    expect(given.status).toBe('1 file that isn’t a photo or PDF was passed over.');
  });

  it('a drop of plain files lands as those files dropped on the page', async () => {
    const dt = () => expiring({ types: ['Files'], files: PILE(), items: [] });
    AddWorkClass.open(CID, PIECE);
    dropOnPage(dt());
    await tick();
    const plain = held();
    AddWorkClass.close(true);
    openWith(dt());
    await tick();
    expect(held()).toEqual(plain);
    expect(plain.rows.find(r => r.sid === IDS[0]).files).toEqual(['Avery Chen.pdf']);
  });

  it('drop wins over files when both are given', async () => {
    const dt = folderDrop();
    AddWorkClass.open(CID, PIECE, { drop: dt, files: [file('Sam Blackwood.jpg')] });
    dt.end();
    await tick();
    const h = held();
    expect(h.rows.find(r => r.sid === IDS[4]).files).toEqual([]);
    expect(h.rows.find(r => r.sid === IDS[0]).files).toEqual(['Avery Chen.pdf']);
  });

  it('reads the drop in its own turn: a drop that is empty a moment later still lands every file', async () => {
    const dt = folderDrop();
    openWith(dt);
    // The turn is over: the drop now reads as empty, as a browser's does.
    expect(dt.items.length + dt.files.length).toBe(0);
    await tick();
    const h = held();
    expect(h.rows.find(r => r.sid === IDS[0]).files).toEqual(['Avery Chen.pdf']);
    expect(h.rows.find(r => r.sid === IDS[3]).files).toEqual(['Priya Kaur.jpg']);
    expect(h.tray).toEqual(['Matteo C.jpg']);
  });
});
