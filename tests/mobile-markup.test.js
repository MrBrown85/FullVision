/**
 * Mark Up a photo on the phone (S9-F2): teacher-mobile/markup.js, on Demo
 * Mode's sample work (Science 8, Cell Microscope Lab; Jordan's page has
 * marks, Noor sent two pages). The data functions are
 * tests/markup-data.test.js's.
 */
import './setup-mobile.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
let wasDemo;
let stubDocument;
let released;
let DomEvent;

function seedDemo() {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
}

function turnOn({ sendWork = true, mode = 'on_return' } = {}) {
  setStudentPageSwitch(CID, true, mode);
  const work = getCourseSubmissions(CID);
  work.course.send_work = sendWork;
  saveDemoStudentWork(CID, work);
}

function page() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.focus = function () {};
  // A stage 300 x 400 at the top left; the sample page is 1000 x 1294.
  dom.window.HTMLElement.prototype.getBoundingClientRect = function () {
    return { left: 0, top: 0, width: 300, height: 400, right: 300, bottom: 400 };
  };
  DomEvent = dom.window.Event;
  globalThis.document = dom.document;
}

const root = () => document.getElementById('m-markup');
const q = sel => root().querySelector(sel);
const files = sid => getStudentSubmission(CID, sid, LAB).files;
const working = (sid, i = 0) => getPageMarkup(CID, files(sid)[i].id).marks.marks;
const stage = () => q('.m-markup-stage');

// A finger (or the mouse) on the stage, in screen pixels.
function ptr(type, id, x, y) {
  const e = new DomEvent('pointer' + type, { bubbles: true, cancelable: true });
  e.pointerId = id;
  e.clientX = x;
  e.clientY = y;
  e.pointerType = 'touch';
  stage().dispatchEvent(e);
}
function drag(points, id = 1) {
  ptr('down', id, ...points[0]);
  points.slice(1).forEach(p => ptr('move', id, ...p));
  ptr('up', id, ...points[points.length - 1]);
}
const tap = (x, y) => drag([[x, y]]);
const tool = t => q('[data-mk="tool"][data-tool="' + t + '"]').click();

// Jordan has the sample's marks on his only page.
let jordan;

beforeAll(() => {
  wasDemo = window.isDemoMode;
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
});
afterAll(() => {
  window.isDemoMode = wasDemo;
  CURRICULUM_INDEX = null;
  localStorage.clear();
});
beforeEach(() => {
  stubDocument = globalThis.document;
  page();
  seedDemo();
  released = [];
  vi.spyOn(globalThis, 'openStudentWorkPage').mockImplementation((cid, file) =>
    Promise.resolve({ url: 'blob:' + file.id, release: () => released.push(file.id) }),
  );
  jordan = getStudents(CID).find(s =>
    getAssessmentMarkup(CID, LAB).some(r => r.enrollment_id === s.id && r.marks.marks.length > 2),
  ).id;
});
afterEach(() => {
  MMarkUp.close();
  globalThis.document = stubDocument;
  vi.restoreAllMocks();
});

describe('with Send Work off', () => {
  it('does not open, and the photos full screen has no Mark Up', () => {
    turnOn({ sendWork: false });
    expect(MMarkUp.can(CID, LAB, jordan, 0)).toBe(false);
    expect(MMarkUp.open(CID, LAB, jordan, 0)).toBe(false);
    expect(root()).toBeNull();
  });
});

describe('with the student page and Send Work on', () => {
  beforeEach(() => turnOn());

  it('the board’s screen: Done, Mark Up, the name and page, Undo, Redo, six tools, the line and the hint', async () => {
    expect(MMarkUp.open(CID, LAB, jordan, 0)).toBe(true);
    const st = getStudents(CID).find(s => s.id === jordan);
    expect(q('[data-mk="done"]').textContent).toBe('Done');
    expect(q('.m-markup-title').textContent).toBe('Mark Up');
    expect(q('.m-markup-sub').textContent).toBe(displayName(st) + ' · Page 1 of ' + files(jordan).length);
    expect(q('[data-mk="undo"]').getAttribute('aria-label')).toBe('Undo');
    expect(q('[data-mk="redo"]').getAttribute('aria-label')).toBe('Redo');
    expect([...root().querySelectorAll('[data-mk="tool"]')].map(b => b.getAttribute('aria-label'))).toEqual([
      'Pen',
      'Highlight',
      'Note',
      'Tick',
      'Cross',
      'Eraser',
    ]);
    expect(q('[data-tool="pen"]').getAttribute('aria-pressed')).toBe('true');
    expect(q('.m-markup-sees').textContent).toBe(
      displayNameFirst(st) + ' sees these marks and notes when you return the work.',
    );
    expect(q('.m-markup-hint').textContent).toBe('One finger draws. Two fingers move the page.');
    // The sample's notes are numbered pins with their words, escaped.
    expect([...root().querySelectorAll('.m-mk-pin')].map(p => p.textContent)).toEqual(['1', '2', '3']);
    expect(q('.m-mk-note-text').textContent).toBe('Which cell is this? Label it onion or cheek.');
    await Promise.resolve();
    expect(q('.m-markup-img').getAttribute('src')).toBe('blob:' + files(jordan)[0].id);
  });

  it('one finger draws a pen line; Done saves the whole set and the stored page is unchanged', async () => {
    const before = JSON.stringify(files(jordan));
    const n = working(jordan).length;
    MMarkUp.open(CID, LAB, jordan, 0);
    drag([
      [50, 100],
      [90, 110],
      [150, 120],
    ]);
    const pen = MMarkUp.marks().pop();
    expect(pen).toMatchObject({ type: 'pen', color: 'red' });
    expect(pen.points.length).toBe(3);
    pen.points.forEach(([x, y]) => {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    });
    // Nothing is saved while the page is open.
    expect(working(jordan)).toHaveLength(n);
    expect(await MMarkUp.done()).toBe(true);
    expect(root()).toBeNull();
    expect(working(jordan)).toHaveLength(n + 1);
    expect(JSON.stringify(files(jordan))).toBe(before);
    // The picture was let go.
    expect(released).toContain(files(jordan)[0].id);
  });

  it('two fingers move the page and draw nothing; a line a second finger lands on is dropped', () => {
    MMarkUp.open(CID, LAB, jordan, 0);
    const n = MMarkUp.marks().length;
    ptr('down', 1, 100, 100);
    ptr('move', 1, 120, 110);
    ptr('down', 2, 200, 200);
    ptr('move', 1, 60, 60);
    ptr('move', 2, 240, 240);
    ptr('up', 2, 240, 240);
    ptr('up', 1, 60, 60);
    expect(MMarkUp.marks()).toHaveLength(n);
    expect(q('.m-markup-layer').style.transform).toMatch(/scale\((?!1\))/);
  });

  it('Tick, Cross and Highlight are marks; Undo and Redo step through them', () => {
    MMarkUp.open(CID, LAB, jordan, 0);
    const n = MMarkUp.marks().length;
    tool('tick');
    tap(100, 100);
    tool('cross');
    tap(150, 150);
    tool('highlight');
    drag([
      [40, 300],
      [200, 300],
    ]);
    expect(
      MMarkUp.marks()
        .slice(n)
        .map(m => m.type),
    ).toEqual(['tick', 'cross', 'highlight']);
    expect(MMarkUp.marks()[n]).toMatchObject({ color: 'green' });
    q('[data-mk="undo"]').click();
    expect(MMarkUp.marks()).toHaveLength(n + 2);
    q('[data-mk="redo"]').click();
    expect(MMarkUp.marks()).toHaveLength(n + 3);
    expect(q('[data-mk="redo"]').disabled).toBe(true);
  });

  it('Note: a tap opens the note box, Add Note places a numbered pin; a tap on it changes its words', () => {
    MMarkUp.open(CID, LAB, jordan, 0);
    tool('note');
    tap(60, 330);
    expect(q('.m-markup-note-label').textContent).toBe('Note');
    expect(q('[data-mk="note-save"]').textContent).toBe('Add Note');
    q('.m-markup-note-text').value = '<b>Units?</b>';
    q('[data-mk="note-save"]').click();
    const note = MMarkUp.marks().pop();
    expect(note).toMatchObject({ type: 'note', text: '<b>Units?</b>' });
    expect([...root().querySelectorAll('.m-mk-pin')].pop().textContent).toBe('4');
    expect(root().innerHTML).not.toContain('<b>Units?</b>');
    tap(60, 330);
    expect(q('[data-mk="note-save"]').textContent).toBe('Save Note');
    expect(q('.m-markup-note-text').innerHTML).toBe('&lt;b&gt;Units?&lt;/b&gt;');
    q('.m-markup-note-text').value = 'Units?';
    q('[data-mk="note-save"]').click();
    expect(
      MMarkUp.marks()
        .filter(m => m.type === 'note')
        .pop().text,
    ).toBe('Units?');
  });

  it('the Eraser takes away the marks it touches, on lift', () => {
    MMarkUp.open(CID, LAB, jordan, 0);
    tool('tick');
    tap(100, 100);
    const n = MMarkUp.marks().length;
    tool('eraser');
    ptr('down', 1, 100, 100);
    expect(MMarkUp.marks()).toHaveLength(n);
    ptr('up', 1, 100, 100);
    expect(MMarkUp.marks()).toHaveLength(n - 1);
    expect(MMarkUp.marks().some(m => m.type === 'tick' && Math.abs(m.x - 100 / 300) < 0.01)).toBe(false);
  });

  it('a mark made and erased before Return is never given to the student', async () => {
    const given = () => JSON.stringify(getStudentMarkup(CID, jordan, LAB));
    const was = given();
    MMarkUp.open(CID, LAB, jordan, 0);
    tool('cross');
    tap(120, 220);
    tool('eraser');
    tap(120, 220);
    tool('pen');
    drag([
      [20, 380],
      [80, 380],
    ]);
    const spy = vi.spyOn(globalThis, 'saveMarkup');
    await MMarkUp.done();
    // The erased cross was never saved, not even as the working copy.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][2].marks.filter(m => m.type === 'cross')).toHaveLength(0);
    expect(working(jordan).filter(m => m.type === 'cross')).toHaveLength(0);
    // In a class that holds grades the student keeps what they had until Return.
    expect(given()).toBe(was);
    expect(studentMarkupWaiting(CID, jordan, LAB)).toBe(true);
    returnWork(CID, LAB, [jordan]);
    const out = getStudentMarkup(CID, jordan, LAB).files[0].marks.marks;
    expect(out.filter(m => m.type === 'cross')).toHaveLength(0);
    expect(out.filter(m => m.type === 'pen')).toHaveLength(2);
  });

  it('a class that does not hold grades says the student sees them once you tap Done', () => {
    turnOn({ mode: 'on_save' });
    MMarkUp.open(CID, LAB, jordan, 0);
    expect(q('.m-markup-sees').textContent).toMatch(/sees these marks and notes once you tap Done\.$/);
  });

  it('a piece with Students See Your Mark Up off says so', () => {
    const real = getAssessmentStudentWork;
    vi.spyOn(globalThis, 'getAssessmentStudentWork').mockImplementation((c, a) => ({
      ...real(c, a),
      students_see_markup: false,
    }));
    MMarkUp.open(CID, LAB, jordan, 0);
    expect(q('.m-markup-sees').textContent).toMatch(
      /doesn’t see these marks\. Students See Your Mark Up is off for this work\.$/,
    );
  });

  it('a save answered after the screen closed changes nothing', async () => {
    MMarkUp.open(CID, LAB, jordan, 0);
    tool('tick');
    tap(100, 100);
    let answer;
    vi.spyOn(globalThis, 'saveMarkup').mockImplementation(() => new Promise(r => (answer = r)));
    const p = MMarkUp.done();
    MMarkUp.close();
    // Another student's page is open now.
    const noor = getStudents(CID).find(
      s => s.id !== jordan && (getStudentSubmission(CID, s.id, LAB)?.files || []).length > 1,
    ).id;
    MMarkUp.open(CID, LAB, noor, 0);
    await Promise.resolve();
    await Promise.resolve();
    const shown = root().innerHTML;
    answer({ result: 'changed', rev: 9, marks: { v: 1, marks: [{ id: 'x', type: 'tick', x: 0.5, y: 0.5 }] } });
    expect(await p).toBe(false);
    expect(root().innerHTML).toBe(shown);
    expect(MMarkUp.marks().some(m => m.id === 'x')).toBe(false);
  });

  it('a picture answered after the page changed is let go, not shown', async () => {
    const noor = getStudents(CID).find(s => (getStudentSubmission(CID, s.id, LAB)?.files || []).length > 1).id;
    let answers = [];
    openStudentWorkPage.mockImplementation(
      (cid, file) =>
        new Promise(r => answers.push(() => r({ url: 'blob:' + file.id, release: () => released.push(file.id) }))),
    );
    MMarkUp.open(CID, LAB, noor, 0);
    await MMarkUp.goPage(1);
    expect(q('.m-markup-sub').textContent).toMatch(/Page 2 of /);
    answers[0]();
    await Promise.resolve();
    await Promise.resolve();
    expect(released).toContain(files(noor)[0].id);
    expect(q('.m-markup-img').getAttribute('src')).toBeNull();
  });

  it('pages: Page 2 › and ‹ Page 1 save the page left', async () => {
    const noor = getStudents(CID).find(s => (getStudentSubmission(CID, s.id, LAB)?.files || []).length > 1).id;
    MMarkUp.open(CID, LAB, noor, 0);
    expect(q('[data-mk="next"]').textContent).toBe('Page 2 ›');
    expect(q('[data-mk="prev"]')).toBeNull();
    tool('tick');
    tap(100, 100);
    const n = working(noor, 0).length;
    await MMarkUp.goPage(1);
    expect(working(noor, 0)).toHaveLength(n + 1);
    expect(q('[data-mk="prev"]').textContent).toBe('‹ Page 1');
  });

  it('the photos full screen has Mark Up for each page', () => {
    // html-safe: MGrade.renderSwiper escapes names and text; a test page
    document.getElementById('m-nav-stack').innerHTML = MGrade.renderSwiper(CID, LAB);
    const box = document.querySelector('.m-work[data-sid="' + jordan + '"]');
    MGradePhotos.openFull(CID, box);
    const btns = document.querySelectorAll('#m-sheet-container [data-action="m-markup-open"]');
    expect(btns).toHaveLength(files(jordan).length);
    expect(btns[0].textContent).toBe('Mark Up');
    expect(btns[0].getAttribute('data-sid')).toBe(jordan);
  });
});

describe('the phone loads Mark Up', () => {
  it('in its page, its offline copy and its tests; the shell opens it', () => {
    expect(readFileSync('teacher-mobile/index.html', 'utf-8')).toContain(
      '<script src="../teacher-mobile/markup.js"></script>',
    );
    expect(readFileSync('sw.js', 'utf-8')).toContain("'/teacher-mobile/markup.js'");
    expect(readFileSync('tests/setup-mobile.js', 'utf-8')).toContain("load('teacher-mobile/markup.js')");
    expect(readFileSync('teacher-mobile/shell.js', 'utf-8')).toContain("action === 'm-markup-open'");
  });
});
