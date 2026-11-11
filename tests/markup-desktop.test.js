/**
 * S9-F1: Mark Up on the desktop (teacher/markup.js), opened from the
 * grader's work pane. Marks are data over the photo and the stored file
 * never changes; an erased mark is gone before Return; the teacher's
 * working marks are apart from the copy the student was given, and Return
 * gives them, through Grader.returnGrades and data.js's returnWork.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, seedClass, clearClass, openGrader, closePages, settle } from './helpers/pin-save-paths.js';
import { click, key } from './helpers/gradebook-dom.js';

const CID = U(1);
const PIECE = U(31);
const Q = U(41);
const ANA = U(101);
const BO = U(102);
let wasDemo;

function seed({ sendWork = true, holds = true, seeMarks = true } = {}) {
  seedClass(CID, {
    students: [
      { id: ANA, firstName: 'Ana', lastName: 'Avila' },
      { id: BO, firstName: 'Bo', lastName: 'Bell' },
    ],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [{ id: PIECE, title: 'Lab', tagIds: [Q], date: '2026-10-20' }],
    courseConfigs: { student_page_enabled: true, return_grades: holds ? 'on_return' : 'on_save' },
  });
  const file = (id, n) => ({
    id,
    page: n,
    path: 'lab-p' + n + '.jpg',
    thumb_path: 'lab-p' + n + '-t.jpg',
    sha256: 'hash-' + id,
  });
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [{ id: PIECE, students_send: 'photos', students_see_markup: seeMarks }],
    submissions: [
      {
        id: 'w1',
        assessment_id: PIECE,
        enrollment_id: ANA,
        version: 1,
        state: 'sent',
        sent_by: 'student',
        sent_at: '2026-10-30T20:41:00Z',
        files: [file('a1', 1), file('a2', 2)],
      },
    ],
  });
}

const mk = () => document.querySelector('.markup-overlay');
const surface = () => mk().querySelector('.markup-surface');
const working = (fileId = 'a1') => getPageMarkup(CID, fileId).marks.marks;
const given = () => getStudentMarkup(CID, ANA, PIECE).files;

// The page on screen is 1000 by 1294 from the window's top left.
function layOut() {
  surface().getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 1294, right: 1000, bottom: 1294 });
}
function pointer(type, x, y) {
  // linkedom's own event, with the place on it.
  const ev = new document.defaultView.Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { clientX: x, clientY: y, button: 0, pointerId: 1 });
  surface().dispatchEvent(ev);
}
function draw(points) {
  pointer('pointerdown', points[0][0], points[0][1]);
  points.slice(1).forEach(p => pointer('pointermove', p[0], p[1]));
  pointer('pointerup', points[points.length - 1][0], points[points.length - 1][1]);
}
function tool(name) {
  click(mk().querySelector('[data-mk-tool="' + name + '"]'));
}
function openMarkUp(opts) {
  const overlay = openGrader(() => seed(opts), CID, PIECE, ANA);
  click(overlay.querySelector('[data-grader="work-markup"]'));
  layOut();
  return overlay;
}

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
});
afterEach(() => {
  if (window.MarkUp.isOpen()) window.MarkUp.close();
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  vi.restoreAllMocks();
});

describe('opening Mark Up', () => {
  it('opens from the work pane on the page shown, named as the board names it', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    click(overlay.querySelector('[data-grader="work-page"][data-dir="1"]'));
    click(overlay.querySelector('[data-grader="work-markup"]'));
    await settle();
    expect(mk().getAttribute('role')).toBe('dialog');
    expect(mk().querySelector('.markup-title').textContent).toBe('Mark Up');
    expect(mk().querySelector('.markup-sub').textContent).toBe('Ana Avila · Lab · Page 2 of 2');
    expect([...mk().querySelectorAll('[data-mk-tool]')].map(b => b.textContent)).toEqual([
      'Pen',
      'Highlight',
      'Note',
      'Tick',
      'Cross',
      'Eraser',
    ]);
    expect([...mk().querySelectorAll('[data-mk-color]')].map(b => b.getAttribute('aria-label'))).toEqual([
      'Red',
      'Green',
      'Blue',
    ]);
    expect(mk().querySelector('[data-mk-tool="pen"]').getAttribute('aria-pressed')).toBe('true');
    expect(mk().querySelector('.markup-side-title').textContent).toBe('Notes on This Page');
    expect(mk().querySelector('.markup-sees').textContent).toBe(
      'Ana sees these marks and notes when you return the work.',
    );
    expect(mk().querySelector('[data-mk="page"][data-dir="-1"]').textContent).toBe('‹ Page 1');
    expect(mk().querySelector('[data-mk="page"][data-dir="1"]').disabled).toBe(true);
    expect(mk().querySelector('.markup-img').getAttribute('src')).toBe('/assets/sample-work/lab-p2.jpg');
  });

  it('says when the student sees them at once, and when not at all', () => {
    openMarkUp({ holds: false });
    expect(mk().querySelector('.markup-sees').textContent).toBe(
      'Ana sees these marks and notes as soon as you make them.',
    );
    window.MarkUp.close();
    closePages();
    openMarkUp({ seeMarks: false });
    expect(mk().querySelector('.markup-sees').textContent).toBe(
      'Ana won’t see these marks. Students See Your Mark Up is off for this piece.',
    );
  });

  it('has no Mark Up button with Send Work off, or with nothing in', () => {
    let overlay = openGrader(() => seed({ sendWork: false }), CID, PIECE, ANA);
    expect(overlay.querySelector('[data-grader="work-markup"]')).toBeNull();
    closePages();
    overlay = openGrader(seed, CID, PIECE, BO);
    expect(overlay.querySelector('[data-grader="work-markup"]')).toBeNull();
  });
});

describe('drawing', () => {
  it('a pen line is saved as data over the page; the stored photo is unchanged', async () => {
    openMarkUp();
    const before = JSON.stringify(getStudentSubmission(CID, ANA, PIECE));
    draw([
      [100, 647],
      [300, 647],
      [500, 776.4],
    ]);
    await settle();
    expect(working()).toEqual([
      expect.objectContaining({
        type: 'pen',
        color: 'red',
        points: [
          [0.1, 0.5],
          [0.3, 0.5],
          [0.5, 0.6],
        ],
      }),
    ]);
    expect(JSON.stringify(getStudentSubmission(CID, ANA, PIECE))).toBe(before);
    expect(mk().querySelector('.markup-layer polyline')).not.toBeNull();
  });

  it('Highlight, Tick and Cross in the colour chosen', async () => {
    openMarkUp();
    click(mk().querySelector('[data-mk-color="blue"]'));
    tool('highlight');
    draw([
      [100, 100],
      [400, 100],
    ]);
    tool('tick');
    pointer('pointerdown', 200, 300);
    click(mk().querySelector('[data-mk-color="green"]'));
    tool('cross');
    pointer('pointerdown', 600, 300);
    await settle();
    expect(working().map(m => [m.type, m.color])).toEqual([
      ['highlight', 'blue'],
      ['tick', 'blue'],
      ['cross', 'green'],
    ]);
  });

  it('a note is placed, written and listed under Notes on This Page; its words are escaped', async () => {
    openMarkUp();
    tool('note');
    expect(mk().querySelector('.markup-notes-hint').textContent).toBe('Click the page where the note goes.');
    pointer('pointerdown', 500, 647);
    const input = mk().querySelector('.markup-note-input');
    expect(mk().querySelector('.markup-note-label').textContent).toBe('Note 1');
    expect(input.getAttribute('maxlength')).toBe('500');
    // Nothing is saved for an empty note.
    click(mk().querySelector('[data-mk="note-save"]'));
    expect(working()).toEqual([]);
    input.value = '  Is this a <reason>?  ';
    click(mk().querySelector('[data-mk="note-save"]'));
    await settle();
    expect(working()).toEqual([expect.objectContaining({ type: 'note', x: 0.5, y: 0.5, text: 'Is this a <reason>?' })]);
    const row = mk().querySelector('.markup-note');
    expect(row.querySelector('.markup-note-n').textContent).toBe('1');
    expect(row.querySelector('.markup-note-text').innerHTML).toBe('Is this a &lt;reason&gt;?');
    expect(mk().querySelector('.markup-layer text').textContent).toBe('1');
  });

  it('Enter saves a note; Escape puts it away and leaves Mark Up open', async () => {
    openMarkUp();
    tool('note');
    pointer('pointerdown', 100, 100);
    mk().querySelector('.markup-note-input').value = 'Why?';
    key(mk().querySelector('.markup-note-input'), 'Enter');
    pointer('pointerdown', 200, 200);
    key(mk().querySelector('.markup-note-input'), 'Escape');
    await settle();
    expect(window.MarkUp.isOpen()).toBe(true);
    expect(mk().querySelector('.markup-note-input')).toBeNull();
    expect(working().map(m => m.text)).toEqual(['Why?']);
  });

  it('Undo and Redo, by button and by key; each is saved', async () => {
    openMarkUp();
    tool('tick');
    pointer('pointerdown', 100, 100);
    pointer('pointerdown', 200, 200);
    await settle();
    expect(mk().querySelector('[data-mk="redo"]').disabled).toBe(true);
    click(mk().querySelector('[data-mk="undo"]'));
    await settle();
    expect(working().length).toBe(1);
    key(mk(), 'z', { metaKey: true, shiftKey: true });
    await settle();
    expect(working().length).toBe(2);
    key(mk(), 'z', { ctrlKey: true });
    key(mk(), 'z', { ctrlKey: true });
    await settle();
    expect(working()).toEqual([]);
    expect(mk().querySelector('[data-mk="undo"]').disabled).toBe(true);
  });

  it('the Eraser takes a mark out, by a click or a drag across marks; Remove takes a note out', async () => {
    openMarkUp();
    tool('tick');
    pointer('pointerdown', 100, 100);
    pointer('pointerdown', 500, 100);
    pointer('pointerdown', 900, 900);
    tool('note');
    pointer('pointerdown', 500, 1000);
    mk().querySelector('.markup-note-input').value = 'Gone soon';
    click(mk().querySelector('[data-mk="note-save"]'));
    tool('eraser');
    draw([
      [100, 100],
      [500, 100],
    ]);
    await settle();
    expect(working().map(m => m.type)).toEqual(['tick', 'note']);
    click(mk().querySelector('[data-mk="remove-note"]'));
    await settle();
    expect(working().map(m => [m.type, m.x])).toEqual([['tick', 0.9]]);
    expect(mk().querySelector('.markup-notes-none').textContent).toBe('No notes on this page yet.');
  });

  it('a drag on a turned page lands where the page is under the pointer', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    click(overlay.querySelector('[data-grader="work-rotate"]'));
    click(overlay.querySelector('[data-grader="work-markup"]'));
    // Turned a quarter: the 1000 by 1294 page lies 1294 wide on screen.
    surface().getBoundingClientRect = () => ({ left: 0, top: 0, width: 1294, height: 1000 });
    expect(mk().querySelector('.markup-stage').className).toContain('turn-90');
    tool('tick');
    pointer('pointerdown', 1294, 0);
    await settle();
    expect(working()[0]).toMatchObject({ x: 0, y: 0 });
  });
});

describe('the working marks and the copy the student is given', () => {
  it('in a class that holds grades nothing reaches the student until Return; a mark erased before then never does', async () => {
    const overlay = openMarkUp();
    tool('tick');
    pointer('pointerdown', 100, 100);
    tool('cross');
    pointer('pointerdown', 800, 800);
    tool('eraser');
    pointer('pointerdown', 800, 800);
    pointer('pointerup', 800, 800);
    await settle();
    expect(working().map(m => m.type)).toEqual(['tick']);
    expect(given()).toEqual([]);
    click(mk().querySelector('[data-mk="done"]'));
    expect(window.MarkUp.isOpen()).toBe(false);
    // Grade, then Return in the grader: the marks go with the grade.
    Grader.setLevel(CID, ANA, PIECE, Q, 3);
    window.PageAssignments.render();
    const returns = vi.spyOn(globalThis, 'returnWork');
    click(overlay.querySelector('[data-grader="return"]'));
    expect(returns).toHaveBeenCalledWith(CID, PIECE, [ANA]);
    expect(given()).toEqual([
      {
        file_id: 'a1',
        marks: { v: 1, marks: [expect.objectContaining({ type: 'tick' })] },
        given_at: expect.any(String),
      },
    ]);
    expect(JSON.stringify(given())).not.toContain('cross');
  });

  it('marks made after a grade was returned wait, with Return and the Draft line; Return gives them', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    Grader.setLevel(CID, ANA, PIECE, Q, 3);
    Grader.returnGrades(CID, PIECE, ANA);
    window.PageAssignments.render();
    expect(overlay.querySelector('.grader-returned')).not.toBeNull();
    click(overlay.querySelector('[data-grader="work-markup"]'));
    layOut();
    tool('tick');
    pointer('pointerdown', 100, 100);
    await settle();
    click(mk().querySelector('[data-mk="done"]'));
    const row = overlay.querySelector('.grader-return');
    expect(row.querySelector('.grader-draft-text').textContent).toBe('Marks saved. Not returned yet.');
    expect(given()).toEqual([]);
    click(row.querySelector('[data-grader="return"]'));
    expect(given().length).toBe(1);
    expect(overlay.querySelector('.grader-returned')).not.toBeNull();
  });

  it('in a class that does not hold grades the student has them as they are made', async () => {
    openMarkUp({ holds: false });
    tool('tick');
    pointer('pointerdown', 100, 100);
    await settle();
    expect(given().length).toBe(1);
  });
});

describe('the grader around Mark Up', () => {
  it('Done draws the marks over the page in the work pane and gives the keys back to Mark Up’s button', async () => {
    const overlay = openMarkUp();
    tool('tick');
    pointer('pointerdown', 100, 100);
    await settle();
    expect(overlay.querySelector('.grader-work-surface .markup-layer')).toBeNull();
    click(mk().querySelector('[data-mk="done"]'));
    expect(mk()).toBeNull();
    const layer = overlay.querySelector('.grader-work-surface .markup-layer');
    expect(layer.querySelector('.markup-tick')).not.toBeNull();
    expect(layer.previousElementSibling.className).toBe('grader-work-img');
    expect(document.activeElement).toBe(overlay.querySelector('[data-grader="work-markup"]'));
  });

  it('the grader’s keys stay off while Mark Up is open: Escape closes Mark Up only', () => {
    openMarkUp();
    key(mk().querySelector('[data-mk-tool="pen"]'), 'Escape');
    expect(window.MarkUp.isOpen()).toBe(false);
    expect(window.PageAssignments.graderOpen()).toBe(true);
  });

  it('→ inside Mark Up does not move the grader to the next student', () => {
    const overlay = openMarkUp();
    key(mk().querySelector('[data-mk-tool="pen"]'), 'ArrowRight');
    window.MarkUp.close();
    expect(overlay.querySelector('.grader-work-what').textContent).toMatch(/^Submitted Oct 30/);
    expect(overlay.querySelector('[data-grader="work-markup"]')).not.toBeNull();
  });

  it('closing the grader closes Mark Up', () => {
    openMarkUp();
    window.PageAssignments.closeGrader();
    expect(window.MarkUp.isOpen()).toBe(false);
    expect(mk()).toBeNull();
  });

  it('moves between pages, each with its own marks', async () => {
    openMarkUp();
    tool('tick');
    pointer('pointerdown', 100, 100);
    click(mk().querySelector('[data-mk="page"][data-dir="1"]'));
    expect(mk().querySelector('.markup-sub').textContent).toBe('Ana Avila · Lab · Page 2 of 2');
    expect(mk().querySelector('.markup-layer').children.length).toBe(0);
    layOut();
    pointer('pointerdown', 200, 200);
    await settle();
    expect(working('a1').length).toBe(1);
    expect(working('a2').length).toBe(1);
  });
});

describe('answers that come late or say no', () => {
  it('a picture that comes after Mark Up closed is let go and not shown', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    await settle();
    let answer;
    const released = vi.fn();
    vi.spyOn(globalThis, 'openStudentWorkPage').mockImplementation(
      () =>
        new Promise(r => {
          answer = r;
        }),
    );
    click(overlay.querySelector('[data-grader="work-markup"]'));
    const img = mk().querySelector('.markup-img');
    window.MarkUp.close();
    answer({ url: 'blob:late', release: released });
    await settle();
    expect(released).toHaveBeenCalled();
    expect(img.getAttribute('src')).toBeNull();
  });

  it('another save that came first wins: its marks are shown and said', async () => {
    openMarkUp();
    vi.spyOn(globalThis, 'saveMarkup').mockImplementation(() =>
      Promise.resolve({
        result: 'changed',
        file_id: 'a1',
        rev: 4,
        marks: { v: 1, marks: [{ id: 'x', type: 'cross', x: 0.5, y: 0.5, color: 'red' }] },
      }),
    );
    tool('tick');
    pointer('pointerdown', 100, 100);
    await settle();
    expect(mk().querySelector('.markup-layer .markup-cross')).not.toBeNull();
    expect(mk().querySelector('.markup-layer .markup-tick')).toBeNull();
    expect(mk().querySelector('.markup-msg').textContent).toBe(
      'These marks were changed somewhere else. The newest are shown.',
    );
  });

  it('a save that says no is said on the screen, plainly', async () => {
    openMarkUp();
    vi.spyOn(globalThis, 'saveMarkup').mockImplementation(() => Promise.resolve({ result: 'not_available' }));
    tool('tick');
    pointer('pointerdown', 100, 100);
    await settle();
    expect(mk().querySelector('.markup-msg').textContent).toBe('Mark Up is not ready for signed-in classes yet.');
  });

  it('each save sends the rev the last one answered, and its own key', async () => {
    openMarkUp();
    const spy = vi.spyOn(globalThis, 'saveMarkup');
    tool('tick');
    pointer('pointerdown', 100, 100);
    pointer('pointerdown', 200, 100);
    await settle();
    expect(spy.mock.calls.map(c => c[3])).toEqual([0, 1]);
    expect(spy.mock.calls[0][4]).not.toBe(spy.mock.calls[1][4]);
    expect(getPageMarkup(CID, 'a1').rev).toBe(2);
  });
});

describe('Return gives marks only where Mark Up can be on (a pin on every other Return)', () => {
  it('signed in, Return is returnGrades with the same arguments, and never returnWork', () => {
    seed();
    window.isDemoMode = () => false;
    const grades = vi.spyOn(globalThis, 'returnGrades').mockImplementation(() => ({ returned: 0 }));
    const work = vi.spyOn(globalThis, 'returnWork');
    Grader.returnGrades(CID, PIECE, ANA);
    Grader.returnGrades(CID, PIECE, [ANA, BO]);
    expect(grades.mock.calls).toEqual([
      [CID, PIECE, [ANA]],
      [CID, PIECE, [ANA, BO]],
    ]);
    expect(work).not.toHaveBeenCalled();
  });

  it('in Demo Mode with Send Work off, Return is returnGrades as before', () => {
    seed({ sendWork: false });
    const work = vi.spyOn(globalThis, 'returnWork');
    const grades = vi.spyOn(globalThis, 'returnGrades');
    Grader.returnGrades(CID, PIECE, [ANA]);
    expect(work).not.toHaveBeenCalled();
    expect(grades.mock.calls).toEqual([[CID, PIECE, [ANA]]]);
  });

  it('in Demo Mode with the build switch and Send Work on, Return gives the marks too', () => {
    seed();
    const work = vi.spyOn(globalThis, 'returnWork');
    Grader.returnGrades(CID, PIECE, [ANA]);
    expect(work.mock.calls).toEqual([[CID, PIECE, [ANA]]]);
  });
});
