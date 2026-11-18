/**
 * Add Work for the Class, B3 (docs/plans/add-work-for-class-plan.md):
 * files dropped off a student or chosen from the tray, matched to students
 * by name (shared/name-match.js), and the Waiting for a Student tray
 * (teacher/add-work-tray.js). In Demo Mode, with PhotoShrink stubbed.
 *
 * A pile routed to students and the tray, natural order for one student's
 * files, each tray action, a refused file, the counts and the leave
 * question, placePieces, a single unnamed PDF opening a stubbed Split the
 * Scan, Escape standing aside while it is open, folders, and that no file
 * name reaches the data layer or the photo queue.
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
  name: 'page-' + n + '.jpg',
});
const pages = n => Array.from({ length: n }, (_, i) => page(i + 1));

const CID = U(1);
const PIECE = U(31);
const GROUP = U(33);
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
const [AVERY, LIAM, MATEO, PRIYA, SAM, JORDAN] = IDS;

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
const chipsOf = sid => [...rowOf(sid).querySelectorAll('.awc-file-name')].map(text);
const items = () => $$('.awt-item');
const itemNamed = name => items().find(el => text(el.querySelector('.awt-file-name')) === name);
const tick = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0));
};
// The photo queue, kept in memory: what it holds is what would upload.
function memoryQueue() {
  const kept = [];
  const store = {
    list: async () => kept.map(k => k.meta),
    putAll: async list => list.forEach(i => kept.push(JSON.parse(JSON.stringify(i)))),
    update: async () => {},
    blobs: async () => null,
    remove: async () => {},
    clear: async () => {},
  };
  runInThisContext(readFileSync('shared/photo-queue.js', 'utf-8'), { filename: 'shared/photo-queue.js' });
  window.PhotoQueue.configure({ store, isDemo: () => true, upload: async () => ({ error: null }) });
  return kept;
}
const file = (name, extra) =>
  Object.assign({ name, type: /\.pdf$/i.test(name) ? 'application/pdf' : 'image/jpeg' }, extra);

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
      { id: GROUP, title: 'Group Poster', tagIds: [Q], collaboration: 'group', groups: [[LIAM, SAM]] },
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
    Promise.resolve(
      f.refuse
        ? { ok: false, reason: PhotoShrink.REASONS.OFFICE }
        : {
            ok: true,
            pages: Array.from({ length: f.n || 1 }, (_, i) =>
              Object.assign(page(i + 1), { name: f.name.replace(/\.\w+$/, '') + '-' + (i + 1) + '.jpg' }),
            ),
          },
    ),
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

describe('a pile of files', () => {
  it('certain names go on their students; the rest wait in the tray, each saying why', async () => {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([
      file('Avery Chen.pdf', { n: 2 }),
      file('Chen.pdf'),
      file('Matteo C.jpg'),
      file('SCAN0017.pdf'),
      file('Priya K.jpg'),
      file('Blackwood_Sam.pdf'),
    ]);
    expect(chipsOf(AVERY)).toEqual(['Avery Chen.pdf']);
    expect(chipsOf(PRIYA)).toEqual(['Priya K.jpg']);
    expect(chipsOf(SAM)).toEqual(['Blackwood_Sam.pdf']);
    expect(chipsOf(LIAM)).toEqual([]);
    expect(chipsOf(MATEO)).toEqual([]);
    // In the order of their names.
    expect(items().map(el => text(el.querySelector('.awt-file')))).toEqual([
      'Chen.pdf · 1 page',
      'Matteo C.jpg · 1 page',
      'SCAN0017.pdf · 1 page',
    ]);
    expect(items().map(el => text(el.querySelector('.awt-why')))).toEqual([
      'Two students are named Chen.',
      'The spelling is close, not the same.',
      'No name in the file name.',
    ]);
    expect(text($('.awt-count'))).toBe('3 files');
    expect(text($('.awc-count'))).toBe('3 ready to add · 3 files waiting · 3 students with nothing to add stay Not In');
    expect(text($('.awc-primary'))).toBe('Add Work for 3 Students');
    // Each waiting file shows its first page.
    expect(itemNamed('Chen.pdf').querySelector('.awt-pic img').getAttribute('alt')).toBe('First page of Chen.pdf');
  });

  it("one student's files go on in the natural order of their names", async () => {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Avery Chen 10.jpg'), file('Avery Chen 2.jpg'), file('avery chen 1.jpg')]);
    expect(chipsOf(AVERY)).toEqual(['avery chen 1.jpg', 'Avery Chen 2.jpg', 'Avery Chen 10.jpg']);
  });

  it('a file dropped on a student still goes to that student, whatever it is called', async () => {
    AddWorkClass.open(CID, PIECE);
    const ev = new doc.defaultView.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', {
      value: { types: ['Files'], files: [file('Liam Chen.pdf')], items: [] },
    });
    rowOf(AVERY).dispatchEvent(ev);
    await tick();
    expect(chipsOf(AVERY)).toEqual(['Liam Chen.pdf']);
    expect(chipsOf(LIAM)).toEqual([]);
  });

  it('a file dropped off a student is matched by name', async () => {
    AddWorkClass.open(CID, PIECE);
    const drop = $('[data-awt-drop]');
    const over = new doc.defaultView.Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: { types: ['Files'], files: [], dropEffect: '' } });
    drop.dispatchEvent(over);
    expect(drop.classList.contains('is-over')).toBe(true);
    const ev = new doc.defaultView.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', {
      value: { types: ['Files'], files: [file('Liam Chen.pdf'), file('IMG_4471.jpg')], items: [] },
    });
    drop.dispatchEvent(ev);
    await tick(10);
    expect(chipsOf(LIAM)).toEqual(['Liam Chen.pdf']);
    expect(items().map(el => text(el.querySelector('.awt-file-name')))).toEqual(['IMG_4471.jpg']);
  });

  it('says how far along it is while reading, and Add Work waits', async () => {
    AddWorkClass.open(CID, PIECE);
    const waits = [];
    PhotoShrink.prepare = vi.fn(() => new Promise(r => waits.push(r)));
    // Each file takes a second to read, as a real photo might.
    let clock = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => (clock += 1000));
    const going = AddWorkClass.takeFiles([file('Avery Chen.pdf'), file('Priya Kaur.pdf')]);
    await tick();
    expect(text($('.awc-primary'))).toBe('Reading 1 of 2…');
    expect($('.awc-primary').disabled).toBe(true);
    expect(text($('.awt-status'))).toBe('Reading 1 of 2…');
    waits[0]({ ok: true, pages: pages(1) });
    await tick();
    expect(text($('.awc-primary'))).toBe('Reading 2 of 2…');
    expect($('.awc-primary').disabled).toBe(true);
    // One file at a time.
    expect(PhotoShrink.prepare).toHaveBeenCalledTimes(2);
    waits[1]({ ok: true, pages: pages(1) });
    await going;
    expect(text($('.awc-primary'))).toBe('Add Work for 2 Students');
    expect($('.awc-primary').disabled).toBe(false);
  });

  it('passes over files that are not photos or PDFs, and hidden ones, and says so in one line', async () => {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([
      file('Avery Chen.pdf'),
      { name: 'notes.txt', type: 'text/plain' },
      { name: 'class list.csv', type: 'text/csv' },
      { name: '.DS_Store', type: '' },
      { name: 'Thumbs', type: '', webkitRelativePath: 'Period 2/.hidden/Thumbs' },
    ]);
    expect(chipsOf(AVERY)).toEqual(['Avery Chen.pdf']);
    expect(text($('.awt-status'))).toBe('2 files that aren’t photos or PDFs were passed over.');
    expect(PhotoShrink.prepare).toHaveBeenCalledTimes(1);
  });

  it('reads at most 300 files, with a plain line', async () => {
    AddWorkClass.open(CID, PIECE);
    const many = Array.from({ length: 305 }, (_, i) => file('SCAN' + String(i).padStart(4, '0') + '.jpg'));
    await AddWorkClass.takeFiles(many);
    expect(PhotoShrink.prepare).toHaveBeenCalledTimes(300);
    expect(text($('.awt-status'))).toBe('Only the first 300 files were read. Add the rest after these.');
  });

  it('a refused file is listed with its reason and can be dismissed; it is not waiting', async () => {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Avery Chen essay.docx', { refuse: true, type: '' })]);
    const it = items()[0];
    expect(it.classList.contains('is-refused')).toBe(true);
    expect(text(it.querySelector('.awt-why'))).toBe('Save it as a PDF first.');
    expect(chipsOf(AVERY)).toEqual([]);
    expect(text($('.awt-count'))).toBe('');
    expect(text($('.awc-count'))).not.toMatch(/waiting/);
    click(it.querySelector('[data-awt="off"]'));
    expect(items().length).toBe(0);
  });

  it('a student graded with a group on this assessment is never matched to a classmate', async () => {
    AddWorkClass.open(CID, GROUP);
    // Liam and Sam are graded together: not listed. "Chen" now fits Avery only on the page,
    // but the class has two Chens, so it still waits.
    await AddWorkClass.takeFiles([file('Chen.pdf'), file('Liam Chen.pdf')]);
    expect(chipsOf(AVERY)).toEqual([]);
    const why = items().map(el => text(el.querySelector('.awt-why')));
    expect(why).toEqual(['Two students are named Chen.', 'That student is graded with a group on this assessment.']);
    // Only the listed student is offered.
    expect([...itemNamed('Chen.pdf').querySelectorAll('[data-awt="to"]')].map(text)).toEqual(['Avery Chen']);
  });
});

describe('the tray', () => {
  async function pile() {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Chen.pdf'), file('Matteo C.jpg'), file('SCAN0017.pdf', { n: 2 })]);
  }

  it('two students who fit: a button for each', async () => {
    await pile();
    const it = itemNamed('Chen.pdf');
    expect([...it.querySelectorAll('[data-awt="to"]')].map(text)).toEqual(['Avery Chen', 'Liam Chen']);
    click(it.querySelector('[data-awt="to"][data-sid="' + LIAM + '"]'));
    expect(chipsOf(LIAM)).toEqual(['Chen.pdf']);
    expect(itemNamed('Chen.pdf')).toBeUndefined();
    expect(text($('.awt-count'))).toBe('2 files');
  });

  it('a close spelling: Is this Mateo? Yes, Mateo places it', async () => {
    await pile();
    const it = itemNamed('Matteo C.jpg');
    expect(text(it.querySelector('.awt-ask'))).toBe('Is this Mateo?');
    expect([...it.querySelectorAll('.awt-act')].map(text)).toEqual(['Yes, Mateo', 'Someone Else']);
    click(it.querySelector('.awt-act.is-main'));
    expect(chipsOf(MATEO)).toEqual(['Matteo C.jpg']);
  });

  it('Someone Else, and no name: Choose a Student, with type-to-find', async () => {
    await pile();
    click(itemNamed('Matteo C.jpg').querySelector('[data-awt="else"]'));
    let it = itemNamed('Matteo C.jpg');
    const find = it.querySelector('.awt-find');
    expect(find.getAttribute('placeholder')).toBe('Type a name');
    expect([...it.querySelectorAll('.awt-option')].map(text)).toEqual(
      NAMES.map(n => n.join(' ')).sort((a, b) => {
        const la = a.split(' ')[1];
        const lb = b.split(' ')[1];
        return la === lb ? a.localeCompare(b) : la.localeCompare(lb);
      }),
    );
    find.value = 'pri';
    find.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    expect([...itemNamed('Matteo C.jpg').querySelectorAll('.awt-option')].map(text)).toEqual(['Priya Kaur']);
    // Return takes the first student found.
    Object.defineProperty(doc, 'activeElement', { configurable: true, get: () => find });
    const key = new doc.defaultView.Event('keydown', { bubbles: true, cancelable: true });
    key.key = 'Enter';
    doc.dispatchEvent(key);
    delete doc.activeElement;
    expect(chipsOf(PRIYA)).toEqual(['Matteo C.jpg']);
    expect(chipsOf(MATEO)).toEqual([]);
    // No name: Choose a Student opens the same list.
    it = itemNamed('SCAN0017.pdf');
    expect(text(it.querySelector('.awt-choose'))).toBe('Choose a Student');
    click(it.querySelector('.awt-choose'));
    const opt = [...itemNamed('SCAN0017.pdf').querySelectorAll('.awt-option')].find(b => text(b) === 'Jordan Reyes');
    click(opt);
    expect(chipsOf(JORDAN)).toEqual(['SCAN0017.pdf']);
    expect(text(rowOf(JORDAN).querySelector('.awc-pages'))).toBe('2 pages');
  });

  it('Return in an empty Choose a Student places nothing; the file still waits', async () => {
    await pile();
    click(itemNamed('SCAN0017.pdf').querySelector('.awt-choose'));
    const find = itemNamed('SCAN0017.pdf').querySelector('.awt-find');
    expect(find.value).toBe('');
    Object.defineProperty(doc, 'activeElement', { configurable: true, get: () => find });
    const enter = () => {
      const key = new doc.defaultView.Event('keydown', { bubbles: true, cancelable: true });
      key.key = 'Enter';
      doc.dispatchEvent(key);
    };
    enter();
    // Spaces alone are still an empty box.
    find.value = '  ';
    find.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    enter();
    delete doc.activeElement;
    expect($$('.awc-chip').length).toBe(0);
    expect(itemNamed('SCAN0017.pdf')).toBeDefined();
    expect(text($('.awt-count'))).toBe('3 files');
  });

  it('a file named for a student with no room left waits, saying why', async () => {
    AddWorkClass.open(CID, PIECE);
    AddWorkClass.placePieces([{ sid: AVERY, from: 'Scan', pages: pages(29) }]);
    await AddWorkClass.takeFiles([file('Avery Chen.pdf', { n: 2 })]);
    expect(chipsOf(AVERY)).toEqual(['Scan']);
    const it = itemNamed('Avery Chen.pdf');
    expect(text(it.querySelector('.is-note'))).toBe('A piece of work can have 30 pages at most.');
    expect(text(it.querySelector('.awt-why'))).toBe('Choose where it goes.');
  });

  it('Escape closes Choose a Student, not the page', async () => {
    await pile();
    click(itemNamed('SCAN0017.pdf').querySelector('.awt-choose'));
    const find = itemNamed('SCAN0017.pdf').querySelector('.awt-find');
    Object.defineProperty(doc, 'activeElement', { configurable: true, get: () => find });
    const key = new doc.defaultView.Event('keydown', { bubbles: true, cancelable: true });
    key.key = 'Escape';
    doc.dispatchEvent(key);
    delete doc.activeElement;
    expect(itemNamed('SCAN0017.pdf').querySelector('.awt-find')).toBeNull();
    expect(AddWorkClass.isOpen()).toBe(true);
    expect(showConfirm).not.toHaveBeenCalled();
  });

  it('a waiting file can be dragged onto a student', async () => {
    await pile();
    const it = itemNamed('SCAN0017.pdf');
    expect(it.getAttribute('draggable')).toBe('true');
    const start = new doc.defaultView.Event('dragstart', { bubbles: true });
    Object.defineProperty(start, 'dataTransfer', { value: { types: [], setData() {} } });
    it.dispatchEvent(start);
    const over = new doc.defaultView.Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: { types: [], dropEffect: '' } });
    rowOf(SAM).dispatchEvent(over);
    expect(text(rowOf(SAM).querySelector('.awc-drop'))).toBe('Drop to Add for Sam');
    const drop = new doc.defaultView.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { types: [], files: [] } });
    rowOf(SAM).dispatchEvent(drop);
    expect(chipsOf(SAM)).toEqual(['SCAN0017.pdf']);
    expect(itemNamed('SCAN0017.pdf')).toBeUndefined();
  });

  it('a waiting file can be taken off, and its picture let go', async () => {
    const gone = [];
    vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:x' + gone.length);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(u => gone.push(u));
    await pile();
    click(itemNamed('Chen.pdf').querySelector('.awt-off'));
    expect(itemNamed('Chen.pdf')).toBeUndefined();
    expect(gone.length).toBe(1);
    // The pictures of what still waits go when the page closes.
    AddWorkClass.close(true);
    expect(gone.length).toBe(3);
  });

  it('a picture placed from the tray is the same one, not made again', async () => {
    let n = 0;
    const made = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => 'blob:' + n++);
    await pile();
    const before = made.mock.calls.length;
    click(itemNamed('Chen.pdf').querySelector('[data-awt="to"]'));
    expect(made.mock.calls.length).toBe(before);
    expect(rowOf(AVERY).querySelector('.awc-thumb img').getAttribute('src')).toBe('blob:0');
  });

  it('waiting files count in the leave question', async () => {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('SCAN0017.pdf')]);
    click($('.awc-cancel'));
    expect(showConfirm).toHaveBeenCalledWith(
      'Leave without adding?',
      '1 file is waiting.',
      'Leave',
      'danger',
      expect.any(Function),
      'Keep Adding',
    );
    await AddWorkClass.takeFiles([file('Avery Chen.pdf')]);
    click($('.awc-cancel'));
    expect(showConfirm.mock.calls[1][1]).toBe('2 files are waiting.');
  });

  it('waiting files never block Add Work, and are still there after it', async () => {
    memoryQueue();
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Avery Chen.pdf'), file('Chen.pdf')]);
    expect($('.awc-primary').disabled).toBe(false);
    click($('.awc-primary'));
    for (let i = 0; i < 40 && !text($('.awc-note')); i++) await tick(1);
    expect($('.awc-done')).toBeNull();
    expect(text($('.awc-note'))).toBe('Added Work for 1 Student.');
    expect(items().map(el => text(el.querySelector('.awt-file-name')))).toEqual(['Chen.pdf']);
    expect(getStudentSubmission(CID, AVERY, PIECE).files.length).toBe(1);
    // Placed now, it is added on its own.
    click(itemNamed('Chen.pdf').querySelector('[data-sid="' + LIAM + '"]'));
    click($('.awc-primary'));
    for (let i = 0; i < 40 && !$('.awc-done'); i++) await tick(1);
    window.PhotoQueue.release();
    expect(text($('.awc-done-title'))).toBe('Added Work for 2 Students');
  });

  it('Grid draws the tray as a strip above the cards', async () => {
    AddWorkClass.open(CID, PIECE);
    click($('.awc-seg-btn[data-layout="grid"]'));
    await AddWorkClass.takeFiles([file('Chen.pdf')]);
    const strip = $('.awt-tray.is-strip');
    expect(strip).not.toBeNull();
    expect(strip.nextElementSibling.classList.contains('awc-grid')).toBe(true);
    expect([...itemNamed('Chen.pdf').querySelectorAll('[data-awt="to"]')].map(text)).toEqual([
      'Avery Chen',
      'Liam Chen',
    ]);
    click(itemNamed('Chen.pdf').querySelector('[data-awt="to"]'));
    expect($('.awc-card[data-awc-target="' + AVERY + '"] .awc-file-name')).not.toBeNull();
  });

  it('Column draws the tray beside the students, with its buttons and the privacy line', () => {
    AddWorkClass.open(CID, PIECE);
    const tray = $('.awc-body > .awt-tray');
    expect(tray).not.toBeNull();
    expect(text(tray.querySelector('.awt-drop-title'))).toBe('Drop the Scan, a Folder or Files');
    expect($$('.awt-pick-btn').map(text)).toEqual(['Choose Files…', 'Choose a Folder…']);
    expect($('.awt-input[data-awt-input="folder"]').hasAttribute('webkitdirectory')).toBe(true);
    expect(text(tray.querySelector('.awt-note'))).toBe(
      'File names are read on this computer to find each student. Only the pages upload, made smaller; the names are not kept.',
    );
    expect(text($('.awc-hint'))).toBe('Nothing is added until you press Add Work.');
  });
});

/* Rule 9 (docs/plans/add-work-for-class-plan.md): Return never takes a name
   two students share (one in each class, or two in one): the teacher picks. */
describe('Someone Else: Return takes a student only when one fits', () => {
  const CID2 = U(2);
  const PIECE2 = U(32);
  const B_AVERY = U(200); // the same name as Socials 10's Avery Chen
  const XIMENA = U(201);
  const TWIN = U(202); // a second student in Socials 10

  afterEach(() => clearClass(CID2));

  function seedSecond() {
    seedClass(CID2, {
      students: [
        { id: B_AVERY, firstName: 'Avery', lastName: 'Chen' },
        { id: XIMENA, firstName: 'Ximena', lastName: 'Quill' },
      ],
      learningMaps: { subjects: [], sections: [], _customized: true, _version: 1, _flatVersion: 2 },
      assessments: [{ id: PIECE2, title: 'Conscription', tagIds: [], date: '2026-10-20' }],
      courseConfigs: { student_page_enabled: true, return_grades: 'on_save' },
    });
    COURSES[CID2].name = 'Block C';
    saveDemoStudentWork(CID2, {
      course: { send_work: true },
      assessments: [{ id: PIECE2, students_send: 'photos' }],
      submissions: [],
    });
  }
  async function bothClasses() {
    seedSecond();
    AddWorkClass.open(CID, PIECE);
    click($('[data-awc="two"]'));
    await tick(8);
    expect($('[data-awc="two"]').getAttribute('aria-checked')).toBe('true');
  }

  // A waiting file with Choose a Student open; → its find box.
  async function openFind() {
    await AddWorkClass.takeFiles([file('SCAN0017.pdf')]);
    await tick();
    click(itemNamed('SCAN0017.pdf').querySelector('.awt-choose'));
    return find();
  }
  const find = () => itemNamed('SCAN0017.pdf').querySelector('.awt-find');
  function type(value) {
    const el = find();
    el.value = value;
    el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
  }
  function key(el, k) {
    Object.defineProperty(doc, 'activeElement', { configurable: true, get: () => el });
    const e = new doc.defaultView.Event('keydown', { bubbles: true, cancelable: true });
    e.key = k;
    doc.dispatchEvent(e);
    delete doc.activeElement;
    return e;
  }
  const say = () => {
    const el = itemNamed('SCAN0017.pdf').querySelector('[data-awt-say]');
    return el ? text(el) : null;
  };
  const options = () => [...itemNamed('SCAN0017.pdf').querySelectorAll('.awt-option')];

  it('two classes, one name in each: Return places nothing and the choices stay, each with its class', async () => {
    await bothClasses();
    await openFind();
    type('Avery Chen');
    key(find(), 'Enter');
    expect(chipsOf(AVERY)).toEqual([]);
    expect(chipsOf(B_AVERY)).toEqual([]);
    expect(options().map(text)).toEqual(['Avery Chen · Socials 10', 'Avery Chen · Block C']);
    expect(say()).toBe('Two students are named Avery Chen. Choose one.');
    // The teacher picks the second class's Avery.
    click(options()[1]);
    expect(chipsOf(B_AVERY)).toEqual(['SCAN0017.pdf']);
    expect(chipsOf(AVERY)).toEqual([]);
  });

  it('two students of the same name in one class: Return places nothing', async () => {
    getStudents(CID).push({ id: TWIN, firstName: 'Priya', lastName: 'Kaur' });
    AddWorkClass.open(CID, PIECE);
    await openFind();
    type('priya kaur');
    key(find(), 'Enter');
    expect(chipsOf(PRIYA)).toEqual([]);
    expect(chipsOf(TWIN)).toEqual([]);
    expect(options().map(o => o.getAttribute('data-sid'))).toEqual([PRIYA, TWIN]);
    expect(say()).toBe('Two students are named Priya Kaur. Choose one.');
  });

  it('a surname two students share: Return places nothing; typing on clears the sentence', async () => {
    AddWorkClass.open(CID, PIECE);
    await openFind();
    type('Chen');
    key(find(), 'Enter');
    expect(chipsOf(AVERY)).toEqual([]);
    expect(chipsOf(LIAM)).toEqual([]);
    expect(options().map(text)).toEqual(['Avery Chen', 'Liam Chen']);
    expect(say()).toBe('More than one student could fit. Choose one.');
    type('Liam');
    expect(say()).toBe('');
    key(find(), 'Enter');
    expect(chipsOf(LIAM)).toEqual(['SCAN0017.pdf']);
  });

  it('two classes: a name only one student has is still placed on Return', async () => {
    await bothClasses();
    await openFind();
    type('Ximena');
    key(find(), 'Enter');
    expect(chipsOf(XIMENA)).toEqual(['SCAN0017.pdf']);
  });

  it('nothing typed places no one; Enter on a highlighted choice places that one', async () => {
    await bothClasses();
    await openFind();
    key(find(), 'Enter');
    expect($$('.awc-chip').length).toBe(0);
    type('Avery');
    // The arrows reach a choice; Return on it is the button's own click, not the tray's.
    key(find(), 'ArrowDown');
    const second = options()[1];
    expect(key(second, 'Enter').defaultPrevented).toBe(false);
    click(second);
    expect(chipsOf(B_AVERY)).toEqual(['SCAN0017.pdf']);
    expect(chipsOf(AVERY)).toEqual([]);
  });

  it('a name that is markup is shown as text', async () => {
    getStudents(CID).push({ id: TWIN, firstName: '<img src=x onerror=alert(1)>', lastName: 'Kaur' });
    AddWorkClass.open(CID, PIECE);
    await openFind();
    type('Kaur');
    key(find(), 'Enter');
    expect(chipsOf(PRIYA)).toEqual([]);
    expect(itemNamed('SCAN0017.pdf').querySelector('img[onerror]')).toBeNull();
    expect(options().map(text)).toContain('<img src=x onerror=alert(1)> Kaur');
    expect(say()).toBe('More than one student could fit. Choose one.');
  });
});

describe('folders', () => {
  const fileEntry = f => ({ isFile: true, isDirectory: false, name: f.name, file: ok => ok(f) });
  const dirEntry = (name, children) => {
    let given = false;
    return {
      isFile: false,
      isDirectory: true,
      name,
      createReader: () => ({
        readEntries: ok => {
          // A batch, then an empty one.
          ok(given ? [] : children);
          given = true;
        },
      }),
    };
  };

  it('a folder dropped anywhere is read into its sub-folders, hidden files left out', async () => {
    AddWorkClass.open(CID, PIECE);
    const root = dirEntry('Period 2', [
      fileEntry(file('Avery Chen.pdf')),
      fileEntry({ name: '.DS_Store', type: '' }),
      dirEntry('more', [fileEntry(file('Priya Kaur.jpg')), fileEntry({ name: 'readme.txt', type: 'text/plain' })]),
      dirEntry('__MACOSX', [fileEntry(file('._Avery Chen.pdf'))]),
    ]);
    const ev = new doc.defaultView.Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(ev, 'dataTransfer', {
      value: {
        types: ['Files'],
        files: [{ name: 'Period 2', type: '' }],
        items: [{ kind: 'file', webkitGetAsEntry: () => root }],
      },
    });
    // Dropped on a student, a folder is still matched by name.
    rowOf(SAM).dispatchEvent(ev);
    await tick(20);
    expect(chipsOf(AVERY)).toEqual(['Avery Chen.pdf']);
    expect(chipsOf(PRIYA)).toEqual(['Priya Kaur.jpg']);
    expect(chipsOf(SAM)).toEqual([]);
    expect(text($('.awt-status'))).toBe('1 file that isn’t a photo or PDF was passed over.');
  });

  it('Choose a Folder… hands its files to the same matching', async () => {
    AddWorkClass.open(CID, PIECE);
    const input = $('.awt-input[data-awt-input="folder"]');
    Object.defineProperty(input, 'files', {
      configurable: true,
      value: [
        Object.assign(file('Mateo Cruz.jpg'), { webkitRelativePath: 'Scans/Mateo Cruz.jpg' }),
        Object.assign({ name: '.DS_Store', type: '' }, { webkitRelativePath: 'Scans/.DS_Store' }),
      ],
    });
    input.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    await tick(10);
    expect(chipsOf(MATEO)).toEqual(['Mateo Cruz.jpg']);
    expect($('.awt-status').textContent).toBe('');
  });
});

describe('placePieces and Split the Scan', () => {
  it('places pieces on their students with one draw; one that cannot be placed waits', () => {
    AddWorkClass.open(CID, PIECE);
    const out = AddWorkClass.placePieces([
      { sid: AVERY, from: 'Scan, pages 1–2', pages: pages(2) },
      { sid: LIAM, from: 'Scan, pages 3–4', pages: pages(2) },
      { sid: 'not-here', from: 'Scan, page 5', pages: pages(1) },
      { sid: MATEO, from: 'Scan, pages 6–36', pages: pages(31) },
    ]);
    expect(out).toEqual({ placed: 2, waiting: 2 });
    expect(chipsOf(AVERY)).toEqual(['Scan, pages 1–2']);
    expect(chipsOf(LIAM)).toEqual(['Scan, pages 3–4']);
    expect(items().map(el => text(el.querySelector('.awt-file-name')))).toEqual(['Scan, page 5', 'Scan, pages 6–36']);
    expect(text(itemNamed('Scan, pages 6–36').querySelector('.is-note'))).toBe(
      'A piece of work can have 30 pages at most.',
    );
  });

  function stubSplit() {
    const split = { opened: [], open: false };
    window.AddWorkSplit = {
      takes: files => files.length === 1 && /\.pdf$/i.test(files[0].name),
      open: vi.fn((cid, aid, f, opts) => {
        split.opened.push({ cid, aid, name: f.name, opts });
        split.open = true;
        return true;
      }),
      isOpen: () => split.open,
      close: vi.fn(() => {
        split.open = false;
      }),
    };
    return split;
  }

  it('one PDF that matches no student for certain opens Split the Scan, and its pieces land', async () => {
    const split = stubSplit();
    AddWorkClass.open(CID, PIECE);
    expect($$('.awt-pick-btn').map(text)).toEqual(['Choose Files…', 'Choose a Folder…', 'Split a Scan…']);
    await AddWorkClass.takeFiles([file('SCAN0017.pdf')]);
    expect(split.opened.map(o => [o.cid, o.aid, o.name])).toEqual([[CID, PIECE, 'SCAN0017.pdf']]);
    // The scan itself is never read here.
    expect(PhotoShrink.prepare).not.toHaveBeenCalled();
    split.opened[0].opts.onPieces([
      { sid: PRIYA, from: 'Scan, pages 1–2', pages: pages(2) },
      { sid: MATEO, from: 'Scan, pages 3–4', pages: pages(2) },
    ]);
    split.open = false;
    split.opened[0].opts.onClose();
    expect(chipsOf(PRIYA)).toEqual(['Scan, pages 1–2']);
    expect(chipsOf(MATEO)).toEqual(['Scan, pages 3–4']);
    expect(text($('.awc-primary'))).toBe('Add Work for 2 Students');
  });

  it('a PDF named for one student, or two PDFs, are matched by name instead', async () => {
    const split = stubSplit();
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Priya Kaur.pdf')]);
    await AddWorkClass.takeFiles([file('SCAN0017.pdf'), file('SCAN0018.pdf')]);
    expect(split.opened).toEqual([]);
    expect(chipsOf(PRIYA)).toEqual(['Priya Kaur.pdf']);
    expect(items().length).toBe(2);
  });

  it('Split a Scan… opens it with the chosen PDF, whatever it is called', () => {
    const split = stubSplit();
    AddWorkClass.open(CID, PIECE);
    const input = $('.awt-input[data-awt-input="scan"]');
    Object.defineProperty(input, 'files', { configurable: true, value: [file('Priya Kaur.pdf')] });
    input.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    expect(split.opened.map(o => o.name)).toEqual(['Priya Kaur.pdf']);
  });

  it("the page's Escape and arrow keys stand aside while Split the Scan is open", async () => {
    const split = stubSplit();
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('SCAN0017.pdf')]);
    expect(split.open).toBe(true);
    const esc = () => {
      const key = new doc.defaultView.Event('keydown', { bubbles: true, cancelable: true });
      key.key = 'Escape';
      doc.dispatchEvent(key);
      return key;
    };
    const k = esc();
    expect(k.defaultPrevented).toBe(false);
    expect(AddWorkClass.isOpen()).toBe(true);
    split.open = false;
    esc();
    expect(AddWorkClass.isOpen()).toBe(false);
  });

  it('closing the page closes Split the Scan too', () => {
    const split = stubSplit();
    AddWorkClass.open(CID, PIECE);
    split.open = true;
    AddWorkClass.close(true);
    expect(window.AddWorkSplit.close).toHaveBeenCalled();
  });
});

describe('no file name leaves the page', () => {
  it('from a pile, the tray and Split the Scan, none reaches the data layer', async () => {
    const split = (() => {
      const s = { opts: null, open: false };
      window.AddWorkSplit = {
        takes: f => f.length === 1 && /\.pdf$/i.test(f[0].name),
        open: (cid, aid, f, opts) => ((s.opts = opts), (s.open = true), true),
        isOpen: () => s.open,
        close: () => (s.open = false),
      };
      return s;
    })();
    const handed = [];
    const real = globalThis.addStudentWorkPages;
    globalThis.addStudentWorkPages = vi.fn((cid, sid, aid, pg) => {
      handed.push(...pg);
      return Promise.resolve({ result: 'sent' });
    });
    try {
      AddWorkClass.open(CID, PIECE);
      await AddWorkClass.takeFiles([file('Avery Chen essay.pdf', { n: 2 }), file('Chen_final.pdf')]);
      click(itemNamed('Chen_final.pdf').querySelector('[data-sid="' + LIAM + '"]'));
      await AddWorkClass.takeFiles([file('SCAN0017.pdf')]);
      split.opts.onPieces([
        {
          sid: PRIYA,
          from: 'Scan, pages 1–2',
          pages: pages(2).map(p => Object.assign(p, { name: 'Priya Kaur scan-1.jpg' })),
        },
      ]);
      split.open = false;
      click($('.awc-primary'));
      await tick(20);
    } finally {
      globalThis.addStudentWorkPages = real;
    }
    expect(handed.length).toBe(5);
    handed.forEach(p => expect(p.name).toMatch(/^page-\d+\.jpg$/));
    const said = JSON.stringify(handed, (k, v) => (v instanceof Blob ? '' : v)).toLowerCase();
    ['avery', 'chen', 'essay', 'final', 'priya', 'kaur', 'scan'].forEach(bit => expect(said).not.toContain(bit));
  });

  it('none reaches the photo queue in Demo Mode', async () => {
    const kept = memoryQueue();
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Mateo Cruz.pdf', { n: 2 }), file('Matteo C.jpg')]);
    click(itemNamed('Matteo C.jpg').querySelector('[data-sid="' + MATEO + '"]'));
    click($('.awc-primary'));
    for (let i = 0; i < 40 && !$('.awc-done'); i++) await tick(1);
    window.PhotoQueue.release();
    expect(text($('.awc-done-title'))).toBe('Added Work for 1 Student');
    expect(kept.length).toBe(3);
    expect(JSON.stringify(kept).toLowerCase()).not.toMatch(/mateo|matteo|cruz/);
    expect(getStudentSubmission(CID, MATEO, PIECE).files.length).toBe(3);
  });
});

/* ── One pile, two classes (B6) ── */
describe('one pile, two classes', () => {
  const CID2 = U(2);
  const PIECE2 = U(32);
  const B_AVERY = U(200); // the same name as Socials 10's Avery Chen
  const XIMENA = U(201);

  function seedSecond() {
    seedClass(CID2, {
      students: [
        { id: B_AVERY, firstName: 'Avery', lastName: 'Chen' },
        { id: XIMENA, firstName: 'Ximena', lastName: 'Quill' },
      ],
      learningMaps: { subjects: [], sections: [], _customized: true, _version: 1, _flatVersion: 2 },
      assessments: [{ id: PIECE2, title: ' conscription ', tagIds: [], date: '2026-10-20' }],
      courseConfigs: { student_page_enabled: true, return_grades: 'on_save' },
    });
    COURSES[CID2].name = 'Block C';
    saveDemoStudentWork(CID2, {
      course: { send_work: true },
      assessments: [{ id: PIECE2, students_send: 'photos' }],
      submissions: [],
    });
  }
  afterEach(() => clearClass(CID2));

  async function turnOn() {
    click($('[data-awc="two"]'));
    await tick(8);
    expect($('[data-awc="two"]').getAttribute('aria-checked')).toBe('true');
  }

  it('is offered only for a same-titled assessment, and is never on by itself', async () => {
    AddWorkClass.open(CID, PIECE);
    expect($('[data-awc="two"]')).toBeNull(); // no other class yet
    AddWorkClass.close(true);
    seedSecond();
    AddWorkClass.open(CID, PIECE);
    expect($('[data-awc="two"]').getAttribute('aria-checked')).toBe('false');
    expect($$('.awc-row').length).toBe(6);
    await turnOn();
    expect($$('.awc-class-head').map(text)).toEqual(['Socials 10', 'Block C']);
    expect($$('.awc-row').length).toBe(8);
  });

  it('the other class is offered with its student page off too (offered in every class)', async () => {
    seedSecond();
    setStudentPageSwitch(CID2, false);
    expect(getReturnSettings(CID2).student_page).toBe(false);
    AddWorkClass.open(CID, PIECE);
    expect($('[data-awc="two"]').getAttribute('aria-checked')).toBe('false');
    await turnOn();
    expect($$('.awc-class-head').map(text)).toEqual(['Socials 10', 'Block C']);
  });

  it('a name in both classes is offered with each class, never taken; a name in one goes to its class', async () => {
    seedSecond();
    AddWorkClass.open(CID, PIECE);
    await turnOn();
    await AddWorkClass.takeFiles([file('Avery Chen.pdf'), file('Ximena Quill.pdf')]);
    await tick();
    expect(chipsOf(AVERY)).toEqual([]);
    expect(chipsOf(B_AVERY)).toEqual([]);
    expect(chipsOf(XIMENA)).toEqual(['Ximena Quill.pdf']);
    const avery = itemNamed('Avery Chen.pdf');
    expect([...avery.querySelectorAll('.awt-act')].map(text).slice(0, 2)).toEqual([
      'Avery Chen · Socials 10',
      'Avery Chen · Block C',
    ]);
    // A file named for nobody says which classes it looked in.
    await AddWorkClass.takeFiles([file('Zed Nobody.pdf')]);
    await tick();
    expect(text(itemNamed('Zed Nobody.pdf').querySelector('.awt-why'))).toBe(
      'No student in Socials 10 or Block C has that name.',
    );
  });

  it('turned off, the second class’s files go back to the tray, never to a student of the first', async () => {
    seedSecond();
    AddWorkClass.open(CID, PIECE);
    await turnOn();
    await AddWorkClass.takeFiles([file('Ximena Quill.pdf')]);
    await tick();
    expect(chipsOf(XIMENA)).toEqual(['Ximena Quill.pdf']);
    click($('[data-awc="two"]'));
    await tick();
    expect($('[data-awc="two"]').getAttribute('aria-checked')).toBe('false');
    expect(rowOf(XIMENA)).toBeNull();
    expect($$('.awc-chip').length).toBe(0);
    expect(items().length).toBe(1);
    expect(text($('.awc-two-line'))).toBe('1 file from Block C went back to Waiting for a Student.');
  });

  it('adds each student’s pages in their own class; On Paper goes to the student’s own class', async () => {
    seedSecond();
    memoryQueue();
    AddWorkClass.open(CID, PIECE);
    await turnOn();
    await AddWorkClass.takeFiles([file('Ximena Quill.pdf', { n: 2 }), file('Priya Kaur.pdf')]);
    await tick();
    click($('.awc-primary'));
    for (let i = 0; i < 40 && !$('.awc-done'); i++) await tick(1);
    window.PhotoQueue.release();
    expect(getStudentSubmission(CID2, XIMENA, PIECE2).files.length).toBe(2);
    expect(getStudentSubmission(CID, XIMENA, PIECE)).toBeNull();
    expect(getStudentSubmission(CID, PRIYA, PIECE).files.length).toBe(1);
    expect(getStudentSubmission(CID2, PRIYA, PIECE2)).toBeNull();
    // Not In: both classes, each with their class.
    const bAvery = $$('.awc-done-row').find(li => {
      const tag = li.querySelector('.awc-class-tag');
      return tag && text(tag) === 'Block C';
    });
    expect(text(bAvery.querySelector('.awc-name'))).toBe('Avery Chen');
    click(bAvery.querySelector('.awc-paper'));
    await tick();
    expect(getStudentSubmission(CID2, B_AVERY, PIECE2).on_paper).toBe(true);
    expect(getStudentSubmission(CID, AVERY, PIECE)).toBeNull();
  });
});

describe('one pile, two classes: while the other class is read', () => {
  const CID2 = U(2);
  const PIECE2 = U(32);
  const XIMENA = U(201);
  let realLoad;
  let finish;
  beforeEach(() => {
    seedClass(CID2, {
      students: [{ id: XIMENA, firstName: 'Ximena', lastName: 'Quill' }],
      learningMaps: { subjects: [], sections: [], _customized: true, _version: 1, _flatVersion: 2 },
      assessments: [{ id: PIECE2, title: 'Conscription', tagIds: [], date: '2026-10-20' }],
      courseConfigs: { student_page_enabled: true, return_grades: 'on_save' },
    });
    COURSES[CID2].name = 'Block C';
    saveDemoStudentWork(CID2, {
      course: { send_work: true },
      assessments: [{ id: PIECE2, students_send: 'photos' }],
      submissions: [],
    });
    // The other class's load, held until the test lets it go.
    realLoad = globalThis.loadClass;
    globalThis.loadClass = () => new Promise(r => (finish = r));
  });
  afterEach(() => {
    globalThis.loadClass = realLoad;
    clearClass(CID2);
  });

  it('Add Work waits, and says so, until the other class is read', async () => {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Priya Kaur.pdf')]);
    await tick();
    expect(text($('.awc-primary'))).toBe('Add Work for 1 Student');
    click($('[data-awc="two"]'));
    await tick();
    expect(text($('.awc-primary'))).toBe('Reading Block C…');
    expect($('.awc-primary').hasAttribute('disabled')).toBe(true);
    finish();
    await tick(8);
    expect($('[data-awc="two"]').getAttribute('aria-checked')).toBe('true');
    expect(text($('.awc-primary'))).toBe('Add Work for 1 Student');
    expect($('.awc-primary').hasAttribute('disabled')).toBe(false);
  });

  it('a class read after Add Work was pressed, or on the summary, is dropped and says nothing', async () => {
    for (const late of [{ busy: true }, { view: 'done' }]) {
      const a = getAssessments(CID).find(x => x.id === PIECE);
      const list = AddWorkClass.students(CID, a);
      const s = {
        cid: CID,
        a,
        view: 'stage',
        busy: false,
        byId: {},
        subs: {},
        stage: AddWorkTargets.create({ cid: CID, aid: PIECE, a, list, subs: {}, name: 'Socials 10' }, () => null),
      };
      const ctx = {
        state: () => s,
        draw: () => {},
        offered: AddWorkClass.offered,
        students: AddWorkClass.students,
        read: (cid, aid) => {
          const x = getAssessments(cid).find(y => y.id === aid);
          return { cid, aid, a: x, list: AddWorkClass.students(cid, x), subs: {}, name: 'Block C' };
        },
      };
      const going = AddWorkTwoClasses.turnOn(s, CID2, ctx);
      expect(s.twoState.reading).toBe('Block C');
      Object.assign(s, late);
      finish();
      expect(await going).toBe(false);
      expect(s.stage.classes().length).toBe(1);
      expect(s.byId[XIMENA]).toBeUndefined();
      expect(s.twoState).toMatchObject({ reading: '', line: '' });
    }
  });
});

/* Turned on after the files: every file matched by its name is matched
   again, as if it were dropped now (the drop-then-switch fault). */
describe('one pile, two classes: turned on after the files', () => {
  const CID2 = U(2);
  const PIECE2 = U(32);
  const XIMENA = U(201);
  const HANA = U(202); // shares Priya Kaur's last name
  const WOOD = U(203); // Black Wood: certain for Sam Blackwood alone, for Black Wood with both
  const ESSAY = U(34); // a second Socials 10 assessment, for the For choice
  beforeEach(() => {
    saveAssessments(
      CID,
      getAssessments(CID).concat([{ id: ESSAY, title: 'Essay One', tagIds: [Q], date: '2026-10-25' }]),
    );
    const work = getCourseSubmissions(CID);
    work.assessments.push({ id: ESSAY, students_send: 'photos' });
    saveDemoStudentWork(CID, work);
    seedClass(CID2, {
      students: [
        { id: XIMENA, firstName: 'Ximena', lastName: 'Quill' },
        { id: HANA, firstName: 'Hana', lastName: 'Kaur' },
        { id: WOOD, firstName: 'Black', lastName: 'Wood' },
      ],
      learningMaps: { subjects: [], sections: [], _customized: true, _version: 1, _flatVersion: 2 },
      assessments: [{ id: PIECE2, title: 'Conscription', tagIds: [], date: '2026-10-20' }],
      courseConfigs: { student_page_enabled: true, return_grades: 'on_save' },
    });
    COURSES[CID2].name = 'Block C';
    saveDemoStudentWork(CID2, {
      course: { send_work: true },
      assessments: [{ id: PIECE2, students_send: 'photos' }],
      submissions: [],
    });
  });
  afterEach(() => clearClass(CID2));

  const pile = () => [file('Kaur.jpg'), file('Priya Kaur.pdf'), file('Ximena Quill.pdf'), file('Chen.pdf')];
  const flip = async () => {
    click($('[data-awc="two"]'));
    await tick(8);
  };
  // Who has which file, and what waits with its reason, in a fixed order.
  const placed = () =>
    $$('.awc-row')
      .flatMap(r =>
        [...r.querySelectorAll('.awc-file-name')].map(n => r.getAttribute('data-awc-target') + ' ' + text(n)),
      )
      .sort();
  const waiting = () =>
    items()
      .map(el => text(el.querySelector('.awt-file-name')) + ': ' + text(el.querySelector('.awt-why')))
      .sort();
  const shot = () => ({ placed: placed(), waiting: waiting() });

  async function dropThenSwitch() {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles(pile());
    await tick();
    const before = shot();
    await flip();
    expect($('[data-awc="two"]').getAttribute('aria-checked')).toBe('true');
    return before;
  }
  async function switchThenDrop() {
    AddWorkClass.open(CID, PIECE);
    await flip();
    await AddWorkClass.takeFiles(pile());
    await tick();
  }

  it('a class whose assessment has another title is not offered', () => {
    saveAssessments(CID2, [{ id: PIECE2, title: 'Something Else', tagIds: [], date: '2026-10-20' }]);
    AddWorkClass.open(CID, PIECE);
    expect($('[data-awc="two"]')).toBeNull();
  });

  it('drop then switch gives what switch then drop gives', async () => {
    const before = await dropThenSwitch();
    // One class: Kaur.jpg was certain, Ximena's file had no student.
    expect(before.placed).toEqual([PRIYA + ' Kaur.jpg', PRIYA + ' Priya Kaur.pdf']);
    expect(before.waiting).toEqual([
      'Chen.pdf: Two students are named Chen.',
      'Ximena Quill.pdf: No student here has that name.',
    ]);
    const after = shot();
    expect(after.placed).toEqual([PRIYA + ' Priya Kaur.pdf', XIMENA + ' Ximena Quill.pdf'].sort());
    expect(after.waiting).toEqual(['Chen.pdf: Two students are named Chen.', 'Kaur.jpg: Two students are named Kaur.']);
    expect(text($('.awc-two-line'))).toBe(
      'Both classes are listed. 1 file went back to Waiting for a Student, and 1 waiting file was placed.',
    );
    // Kaur.jpg offers both Kaurs, each with their class; it is never taken.
    expect([...itemNamed('Kaur.jpg').querySelectorAll('.awt-act')].map(text).slice(0, 2)).toEqual([
      'Priya Kaur · Socials 10',
      'Hana Kaur · Block C',
    ]);
    AddWorkClass.close(true);
    await switchThenDrop();
    expect(shot()).toEqual(after);
  });

  it('turned off again, both orders end the same, as switch-first always did', async () => {
    await dropThenSwitch();
    await flip();
    const a = shot();
    expect(text($('.awc-two-line'))).toBe('1 file from Block C went back to Waiting for a Student.');
    AddWorkClass.close(true);
    await switchThenDrop();
    await flip();
    expect(shot()).toEqual(a);
    expect(rowOf(XIMENA)).toBeNull();
    expect(a.placed).toEqual([PRIYA + ' Priya Kaur.pdf']);
    // Matched again against one class: no Block C student offered, and not placed.
    expect(a.waiting).toContain('Kaur.jpg: Choose where it goes.');
    expect(a.waiting).toContain('Chen.pdf: Two students are named Chen.');
    expect([...itemNamed('Kaur.jpg').querySelectorAll('.awt-act')].map(text).join(' ')).not.toMatch(/Hana|Block C/);
    // The one student it fits is offered, never taken.
    expect([...itemNamed('Kaur.jpg').querySelectorAll('.awt-act')].map(text)).toEqual(['Yes, Priya', 'Someone Else']);
    expect(text(itemNamed('Kaur.jpg').querySelector('.awt-ask'))).toBe('Is this Priya?');
  });

  it('one line names both what went back and what was placed, or either alone', async () => {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Ximena Quill.pdf')]);
    await flip();
    expect(text($('.awc-two-line'))).toBe('Both classes are listed. 1 waiting file was placed.');
    expect(chipsOf(XIMENA)).toEqual(['Ximena Quill.pdf']);
  });

  it('a file read while the switch turns on is matched once read, against both classes', async () => {
    let release;
    const real = PhotoShrink.prepare;
    PhotoShrink.prepare = vi.fn(f => new Promise(r => (release = () => r(real(f)))));
    AddWorkClass.open(CID, PIECE);
    const reading = AddWorkClass.takeFiles([file('Kaur.jpg')]);
    await tick();
    await flip();
    expect($('[data-awc="two"]').getAttribute('aria-checked')).toBe('true');
    release();
    await reading;
    await tick();
    expect(chipsOf(PRIYA)).toEqual([]);
    expect(waiting()).toEqual(['Kaur.jpg: Two students are named Kaur.']);
  });

  it('a note about the old match goes when the new one is not certain', async () => {
    AddWorkClass.open(CID, PIECE);
    // Certain for Priya alone, but she has no room left.
    await AddWorkClass.takeFiles([file('Priya Kaur.pdf', { n: 30 })]);
    await AddWorkClass.takeFiles([file('Kaur.jpg')]);
    expect(text(itemNamed('Kaur.jpg'))).toContain('A piece of work can have 30 pages at most.');
    await flip();
    expect(waiting()).toEqual(['Kaur.jpg: Two students are named Kaur.']);
    expect(text(itemNamed('Kaur.jpg'))).not.toContain('30 pages');
  });

  // The For choice on a student's file, as the teacher sets it.
  const setFor = (sid, aid) => {
    const sel = rowOf(sid).querySelector('.awc-for select');
    [...sel.options].forEach(o => o.toggleAttribute('selected', o.value === aid));
    sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  };
  const forOf = sid => [...rowOf(sid).querySelectorAll('.awc-for select')].map(el => el.value);
  const noteOf = sid => [...rowOf(sid).querySelectorAll('.awc-row-note')].map(text);

  it('a For choice the teacher made goes with the file to the tray, and back onto the student', async () => {
    memoryQueue();
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Kaur.jpg')]);
    setFor(PRIYA, ESSAY);
    expect(forOf(PRIYA)).toEqual([ESSAY]);
    await flip();
    expect(waiting()).toEqual(['Kaur.jpg: Two students are named Kaur.']);
    click(itemNamed('Kaur.jpg').querySelector('[data-sid="' + PRIYA + '"]'));
    expect(forOf(PRIYA)).toEqual([ESSAY]);
    expect(noteOf(PRIYA)).toEqual([]);
    click($('.awc-primary'));
    for (let i = 0; i < 40 && !$('.awc-done'); i++) await tick(1);
    window.PhotoQueue.release();
    expect(getStudentSubmission(CID, PRIYA, ESSAY).files.length).toBe(1);
    expect(getStudentSubmission(CID, PRIYA, PIECE)).toBeNull();
  });

  it('placed on a student of the other class, the choice can’t apply, and the row says so', async () => {
    // Block C has an Essay One of its own: the sentence is still true.
    saveAssessments(
      CID2,
      getAssessments(CID2).concat([{ id: U(35), title: 'Essay One', tagIds: [], date: '2026-10-25' }]),
    );
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Kaur.jpg')]);
    setFor(PRIYA, ESSAY);
    await flip();
    click(itemNamed('Kaur.jpg').querySelector('[data-sid="' + HANA + '"]'));
    expect(chipsOf(HANA)).toEqual(['Kaur.jpg']);
    expect($$('.awc-chip.is-late').length).toBe(0);
    expect(noteOf(HANA)).toEqual(['Kaur.jpg was for Essay One in Socials 10. Here it is for Conscription.']);
  });

  it('placed on a classmate the chosen assessment does not list, the row says why', async () => {
    // Essay One is graded with a group for Avery and Jordan: not on their rows.
    saveAssessments(
      CID,
      getAssessments(CID).map(a =>
        a.id === ESSAY ? Object.assign({}, a, { collaboration: 'group', groups: [[AVERY, JORDAN]] }) : a,
      ),
    );
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Kaur.jpg')]);
    setFor(PRIYA, ESSAY);
    await flip();
    const item = itemNamed('Kaur.jpg');
    click(item.querySelector('[data-awt="else"]'));
    click(itemNamed('Kaur.jpg').querySelector('[data-awt="to"][data-sid="' + AVERY + '"]'));
    expect(chipsOf(AVERY)).toEqual(['Kaur.jpg']);
    expect(forOf(AVERY)).toEqual([PIECE]);
    expect(noteOf(AVERY)).toEqual([
      'Kaur.jpg was for Essay One, which Avery Chen is not part of. It is for Conscription.',
    ]);
  });

  it('a file left on its default assessment carries nothing', async () => {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Kaur.jpg')]);
    expect(forOf(PRIYA)).toEqual([PIECE]);
    await flip();
    click(itemNamed('Kaur.jpg').querySelector('[data-sid="' + HANA + '"]'));
    expect(chipsOf(HANA)).toEqual(['Kaur.jpg']);
    expect(noteOf(HANA)).toEqual([]);
  });

  it('files that go back wait in the order of their names, as a drop of them would', async () => {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Kaur.jpg')]);
    await AddWorkClass.takeFiles([file('Black Wood.jpg')]);
    await flip();
    expect(items().map(el => text(el.querySelector('.awt-file-name')))).toEqual(['Black Wood.jpg', 'Kaur.jpg']);
  });

  it('a name certain for a different student in each view waits (the one order that differs)', async () => {
    AddWorkClass.open(CID, PIECE);
    await AddWorkClass.takeFiles([file('Black Wood.jpg')]);
    expect(chipsOf(SAM)).toEqual(['Black Wood.jpg']);
    await flip();
    // Never moved to Block C's Black Wood: it waits for the teacher.
    expect(chipsOf(SAM)).toEqual([]);
    expect(chipsOf(WOOD)).toEqual([]);
    expect(waiting()).toEqual(['Black Wood.jpg: Choose where it goes.']);
    AddWorkClass.close(true);
    // With the switch on first, the same file is placed on Black Wood.
    AddWorkClass.open(CID, PIECE);
    await flip();
    await AddWorkClass.takeFiles([file('Black Wood.jpg')]);
    expect(chipsOf(WOOD)).toEqual(['Black Wood.jpg']);
  });

  it('a file the teacher placed or moved is left where it is', async () => {
    AddWorkClass.open(CID, PIECE);
    // Dropped on Priya's row.
    await AddWorkClass.addFiles(PRIYA, [file('Kaur.jpg')]);
    // Placed from the tray with a click.
    await AddWorkClass.takeFiles([file('Chen.pdf'), file('Mateo Cruz.pdf')]);
    click(itemNamed('Chen.pdf').querySelector('[data-sid="' + AVERY + '"]'));
    // Matched by name, then moved by the teacher.
    expect(chipsOf(MATEO)).toEqual(['Mateo Cruz.pdf']);
    click(rowOf(MATEO).querySelector('[data-awc="moveMenu"]'));
    click($('.awc-move-item[data-to="' + SAM + '"]'));
    expect(chipsOf(SAM)).toEqual(['Mateo Cruz.pdf']);
    await flip();
    expect(chipsOf(PRIYA)).toEqual(['Kaur.jpg']);
    expect(chipsOf(AVERY)).toEqual(['Chen.pdf']);
    expect(chipsOf(SAM)).toEqual(['Mateo Cruz.pdf']);
    expect(items().length).toBe(0);
    expect(text($('.awc-two-line'))).toBe('Both classes are listed. Each student’s pages go to their own class.');
  });

  it('a piece from Split the Scan (named or by its sticker) is not matched by name', async () => {
    AddWorkClass.open(CID, PIECE);
    // As Split the Scan hands its pieces back.
    AddWorkClass.placePieces([{ sid: PRIYA, from: 'Scan, page 1', pages: pages(1), scan: true }]);
    expect(chipsOf(PRIYA)).toEqual(['Scan, page 1']);
    await flip();
    expect(chipsOf(PRIYA)).toEqual(['Scan, page 1']);
    expect(items().length).toBe(0);
  });
});
