/**
 * The Inbox's drop (teacher/dash-inbox-drop.js; D5), the review's fixes:
 * every action goes to the piece the tile shows and never to another once
 * that piece stops taking work; the cover never outlasts its drag; a file
 * let go just outside the tile is refused; a drag from the page is never
 * files; pictures are not draggable; one listener set; two pieces with one
 * title told apart. Demo Mode, Science 8, the student page and Send Work on.
 */
import './setup.js';
import { readFileSync, readdirSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LIGHT = 'sci8a21';
const CELL = 'sci8a1';
const DAY = 86400000;
let wasDemo;
let stubDocument;

function sendWorkOn() {
  setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = true;
  saveDemoStudentWork(CID, work);
}
const ids = () => getStudents(CID).map(s => s.id);
function caughtUp() {
  getAssessments(CID).forEach(a =>
    GraderWork.workCounts(CID, a.id, ids()).ids.tograde.forEach(sid =>
      Grader.setOverallComment(CID, sid, a.id, 'Seen.'),
    ),
  );
}
function mountTile() {
  const html = DashInbox.html(CID);
  const dom = parseHTML('<!DOCTYPE html><html><body><main id="main">' + html + '</main></body></html>');
  globalThis.document = dom.document;
  DashInboxDrop.mount(dom.document.getElementById('dash-inbox'), CID, DashInbox.model());
  return dom.document;
}
function dragEvent(doc, type, dt) {
  const ev = new doc.defaultView.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dt });
  return ev;
}
const files = () => ({ types: ['Files'], files: [{ name: 'x.jpg' }], items: [], dropEffect: 'none' });
const clickOn = (doc, el) => el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));

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
  globalThis.document = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
  localStorage.setItem('fv-build-dashRow', '1');
  sendWorkOn();
});
afterEach(() => {
  DashInboxDrop.leave(CID);
  globalThis.document = stubDocument;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ── Review item 1 ─────────────────────────────────────── */
describe('the piece shown is the piece used', () => {
  // Cell Microscope Lab stops taking work after its due day, today. Light
  // Refraction Lab is due `lightIn` days on and keeps taking work.
  function closesToday(lightIn) {
    const today = courseToday(CID);
    const day = n => new Date(Date.parse(today + 'T12:00:00Z') + n * DAY).toISOString().slice(0, 10);
    getAssessments(CID).find(a => a.id === CELL).dueDate = today;
    getAssessments(CID).find(a => a.id === LIGHT).dueDate = day(lightIn);
    const work = getCourseSubmissions(CID);
    work.assessments = (work.assessments || []).filter(x => x.id !== CELL);
    work.assessments.push({ id: CELL, students_send: 'photos', after_due: 'stop', accept_until: null });
    saveDemoStudentWork(CID, work);
  }
  function pickBy(doc, aid) {
    const select = doc.querySelector('[data-dash-inbox-for]');
    select.querySelectorAll('option').forEach(o => o.removeAttribute('selected'));
    select.querySelector('option[value="' + aid + '"]').setAttribute('selected', '');
    select.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  }
  // A day on, with no draw.
  const tomorrow = () => vi.setSystemTime(new Date(Date.now() + DAY));
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T19:00:00Z'));
  });

  for (const how of ['default', 'by hand']) {
    it('a button acts on the piece in the box (' + how + '), and on no other once it has gone', () => {
      // By default the next one due (Cell, today) is chosen; by hand, Light is due today too and comes first.
      closesToday(how === 'default' ? 5 : 0);
      caughtUp();
      const doc = mountTile();
      if (how === 'by hand') {
        expect(doc.querySelector('[data-dash-inbox-for]').value).toBe(LIGHT);
        pickBy(doc, CELL);
      }
      expect(doc.querySelector('[data-dash-inbox-for]').value).toBe(CELL);
      const open = vi.spyOn(AddWorkClass, 'open').mockImplementation(() => true);
      clickOn(doc, doc.querySelector('[data-dash-inbox-pick="files"]'));
      expect(open.mock.calls.map(c => c[1])).toEqual([CELL]);
      tomorrow();
      // The box still reads Cell Microscope Lab, which takes no more work: nothing opens.
      expect(doc.querySelector('[data-dash-inbox-for]').value).toBe(CELL);
      clickOn(doc, doc.querySelector('[data-dash-inbox-pick="files"]'));
      expect(open).toHaveBeenCalledTimes(1);
      expect(doc.querySelector('.dash-inbox-drop-notice').textContent).toBe(
        'The list of assessments changed. Choose again.',
      );
    });

    it('a drop goes to the piece in the box (' + how + '), and to no other once it has gone', () => {
      closesToday(how === 'default' ? 5 : 0);
      caughtUp();
      const doc = mountTile();
      if (how === 'by hand') pickBy(doc, CELL);
      const open = vi.spyOn(AddWorkClass, 'open').mockImplementation(() => true);
      const area = doc.querySelector('[data-dash-inbox-area]');
      area.dispatchEvent(dragEvent(doc, 'dragenter', files()));
      expect(doc.querySelector('.dash-inbox-drop-cover-title').textContent).toBe('Drop to Add to Cell Microscope Lab');
      area.dispatchEvent(dragEvent(doc, 'drop', files()));
      expect(open.mock.calls.map(c => c[1])).toEqual([CELL]);
      tomorrow();
      const late = dragEvent(doc, 'drop', files());
      area.dispatchEvent(late);
      expect(late.defaultPrevented).toBe(true);
      expect(open).toHaveBeenCalledTimes(1);
      expect(doc.querySelector('.dash-inbox-drop-notice').textContent).toBe(
        'The list of assessments changed, so those files were not added. Drop them again.',
      );
      // The next drag clears the sentence.
      area.dispatchEvent(dragEvent(doc, 'dragenter', files()));
      expect(doc.querySelector('.dash-inbox-drop-notice')).toBeNull();
    });
  }

  it('with rows showing, a drop goes to the piece the cover named, and to no other once it has gone', () => {
    closesToday(5);
    // Cell Microscope Lab is the newest piece taking work.
    getAssessments(CID).find(a => a.id === CELL).date = '2026-11-18';
    const doc = mountTile();
    expect(doc.querySelector('.dash-inbox-row')).not.toBeNull();
    const open = vi.spyOn(AddWorkClass, 'open').mockImplementation(() => true);
    const row = doc.querySelector('.dash-inbox-row');
    row.dispatchEvent(dragEvent(doc, 'dragenter', files()));
    expect(doc.querySelector('.dash-inbox-drop-cover-title').textContent).toBe('Drop to Add to Cell Microscope Lab');
    tomorrow();
    row.dispatchEvent(dragEvent(doc, 'drop', files()));
    expect(open).not.toHaveBeenCalled();
    expect(doc.querySelector('.dash-inbox-drop-notice')).not.toBeNull();
  });
});

/* ── Review items 4, 5, 6 and 8 ────────────────────────── */
describe('drags around the tile', () => {
  it('dragenter accepts files at once, so a release at once still drops', () => {
    const doc = mountTile();
    const enter = dragEvent(doc, 'dragenter', files());
    doc.querySelector('.dash-inbox-row').dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(true);
  });

  // The test window has no events of its own: lend it a real event target.
  const win = new EventTarget();
  let was;
  beforeEach(() => {
    was = { add: window.addEventListener, remove: window.removeEventListener };
    window.addEventListener = win.addEventListener.bind(win);
    window.removeEventListener = win.removeEventListener.bind(win);
  });
  afterEach(() => {
    DashInboxDrop.leave(CID);
    window.addEventListener = was.add;
    window.removeEventListener = was.remove;
  });

  for (const [what, fire] of [
    ['a mouse move', () => win.dispatchEvent(new Event('mousemove'))],
    ['a pointer down', () => win.dispatchEvent(new Event('pointerdown'))],
    ['a key', () => win.dispatchEvent(new Event('keydown'))],
    ['a click', () => win.dispatchEvent(new Event('click'))],
    ['the window losing focus', () => win.dispatchEvent(new Event('blur'))],
    ['dragend', doc => doc.dispatchEvent(new doc.defaultView.Event('dragend', { bubbles: true }))],
    ['a drop elsewhere', doc => doc.body.dispatchEvent(dragEvent(doc, 'drop', files()))],
    [
      'leaving the window',
      doc => {
        const ev = dragEvent(doc, 'dragleave', files());
        Object.defineProperty(ev, 'clientX', { value: 0 });
        Object.defineProperty(ev, 'clientY', { value: 0 });
        doc.body.dispatchEvent(ev);
      },
    ],
  ]) {
    it('the cover never outlasts its drag: ' + what + ' takes it away', () => {
      const doc = mountTile();
      doc.querySelector('.dash-inbox-row').dispatchEvent(dragEvent(doc, 'dragenter', files()));
      expect(doc.querySelector('.dash-inbox-drop-cover').hidden).toBe(false);
      fire(doc);
      expect(doc.querySelector('.dash-inbox-drop-cover').hidden).toBe(true);
    });
  }

  it('a file let go just outside the tile is refused, not opened by the browser', () => {
    const doc = mountTile();
    // linkedom lays nothing out: the tile counts as on screen.
    doc.getElementById('dash-inbox').getClientRects = () => [{}];
    const main = doc.getElementById('main');
    const out = doc.createElement('div');
    main.appendChild(out);
    const dt = files();
    const over = dragEvent(doc, 'dragover', dt);
    out.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(dt.dropEffect).toBe('none');
    const drop = dragEvent(doc, 'drop', dt);
    out.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    // A place that takes files says so first, and is left alone.
    const zone = doc.createElement('div');
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    });
    main.appendChild(zone);
    const dt2 = files();
    zone.dispatchEvent(dragEvent(doc, 'dragover', dt2));
    expect(dt2.dropEffect).toBe('copy');
    // A file box takes a drop with no script: never touched, nor its label, nor a dialog or overlay.
    const boxes = doc.createElement('div');
    boxes.innerHTML =
      '<input type="file" id="f1"><label id="l1">Choose Files<input type="file"></label>' +
      '<div role="dialog"><p id="d1">x</p></div><div class="grader-overlay"><p id="o1">x</p></div>';
    main.appendChild(boxes);
    for (const id of ['f1', 'l1', 'd1', 'o1']) {
      for (const type of ['dragover', 'drop']) {
        const ev = dragEvent(doc, type, files());
        doc.getElementById(id).dispatchEvent(ev);
        expect(ev.defaultPrevented, id + ' ' + type).toBe(false);
      }
    }
    // Outside the Dashboard's page (#main): left alone.
    const away = doc.createElement('div');
    doc.body.appendChild(away);
    const ev = dragEvent(doc, 'drop', files());
    away.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    // The tile off screen: nothing refused.
    doc.getElementById('dash-inbox').getClientRects = () => [];
    const hid = dragEvent(doc, 'drop', files());
    out.dispatchEvent(hid);
    expect(hid.defaultPrevented).toBe(false);
    doc.getElementById('dash-inbox').getClientRects = () => [{}];
    // Once the Dashboard is left nothing of this stays on the page.
    DashInboxDrop.leave(CID);
    const after = dragEvent(doc, 'dragover', files());
    out.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('a drag that began on the page is never taken as files, even if it says Files', () => {
    const doc = mountTile();
    const open = vi.spyOn(AddWorkClass, 'open').mockImplementation(() => true);
    const row = doc.querySelector('.dash-inbox-row');
    row.dispatchEvent(new doc.defaultView.Event('dragstart', { bubbles: true }));
    const enter = dragEvent(doc, 'dragenter', files());
    row.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    expect(doc.querySelector('.dash-inbox-drop-cover').hidden).toBe(true);
    row.dispatchEvent(dragEvent(doc, 'drop', files()));
    expect(open).not.toHaveBeenCalled();
    // That drag is over: files from the computer are taken again.
    row.dispatchEvent(dragEvent(doc, 'drop', files()));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a page drag whose end is never heard does not switch the tile off', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const doc = mountTile();
    const open = vi.spyOn(AddWorkClass, 'open').mockImplementation(() => true);
    const row = doc.querySelector('.dash-inbox-row');
    // A drag from the page whose dragend never comes.
    row.dispatchEvent(new doc.defaultView.Event('dragstart', { bubbles: true }));
    // While it goes on its source hears `drag`, and files are not taken.
    vi.setSystemTime(Date.now() + 400);
    row.dispatchEvent(new doc.defaultView.Event('drag', { bubbles: true }));
    vi.setSystemTime(Date.now() + 400);
    const during = dragEvent(doc, 'dragenter', files());
    row.dispatchEvent(during);
    expect(during.defaultPrevented).toBe(false);
    // Then nothing: the next file drag from outside the window is taken.
    vi.setSystemTime(Date.now() + 1000);
    const next = dragEvent(doc, 'dragenter', files());
    row.dispatchEvent(next);
    expect(next.defaultPrevented).toBe(true);
    row.dispatchEvent(dragEvent(doc, 'drop', files()));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('a mouse move, a press or a new draw also ends a page drag never heard to end', () => {
    const win = new EventTarget();
    const was = { add: window.addEventListener, remove: window.removeEventListener };
    window.addEventListener = win.addEventListener.bind(win);
    window.removeEventListener = win.removeEventListener.bind(win);
    try {
      for (const end of ['mousemove', 'pointerdown', 'draw']) {
        let doc = mountTile();
        doc.querySelector('.dash-inbox-row').dispatchEvent(new doc.defaultView.Event('dragstart', { bubbles: true }));
        if (end === 'draw') doc = mountTile();
        else win.dispatchEvent(new Event(end));
        const ev = dragEvent(doc, 'dragenter', files());
        doc.querySelector('.dash-inbox-row').dispatchEvent(ev);
        expect(ev.defaultPrevented, end).toBe(true);
      }
    } finally {
      DashInboxDrop.leave(CID);
      window.addEventListener = was.add;
      window.removeEventListener = was.remove;
    }
  });

  it('every Inbox picture is drawn not draggable', () => {
    const html = DashInbox.html(CID);
    const imgs = html.match(/<img [^>]*>/g) || [];
    expect(imgs.length).toBeGreaterThan(0);
    imgs.forEach(i => expect(i).toContain('draggable="false"'));
    // Every view's own pictures too, each Inbox file in the folder (Flip
    // Through and Roll Call included when they come): each <img says it, and
    // so does every picture made with createElement('img').
    const inbox = readdirSync('teacher').filter(f => /^dash-inbox.*\.js$/.test(f));
    expect(inbox).toContain('dash-inbox.js');
    for (const f of inbox) {
      const src = readFileSync('teacher/' + f, 'utf-8');
      (src.match(/<img [^>]*/g) || []).forEach(i => expect(i, f).toContain('draggable="false"'));
      const made = (src.match(/createElement\(['"]img['"]\)/g) || []).length;
      const told = (src.match(/draggable\s*=\s*false|setAttribute\(['"]draggable['"]/g) || []).length;
      expect(told, f).toBeGreaterThanOrEqual(made);
    }
  });

  it('one set of listeners however many draws: one drop, one open', () => {
    mountTile();
    const doc = mountTile();
    DashInboxDrop.mount(doc.getElementById('dash-inbox'), CID, DashInbox.model());
    const open = vi.spyOn(AddWorkClass, 'open').mockImplementation(() => true);
    const out = doc.createElement('div');
    doc.body.appendChild(out);
    let seen = 0;
    doc.addEventListener('dragover', e => e.defaultPrevented && seen++);
    doc.querySelector('.dash-inbox-row').dispatchEvent(dragEvent(doc, 'drop', files()));
    expect(open).toHaveBeenCalledTimes(1);
    expect(doc.querySelectorAll('.dash-inbox-drop-cover').length).toBe(1);
  });

  it('two pieces with one title are told apart by their dates', () => {
    const a = getAssessments(CID).find(x => x.id === CELL);
    a.title = 'Light Refraction Lab';
    caughtUp();
    const doc = mountTile();
    const labels = [...doc.querySelectorAll('[data-dash-inbox-for] option')].map(o => o.textContent);
    expect(labels.length).toBe(2);
    expect(new Set(labels).size).toBe(2);
    labels.forEach(l => expect(l).toMatch(/^Light Refraction Lab \(\w{3} \d{1,2}(, \d{4})?\)$/));
    // The cover names it the same way.
    doc.querySelector('[data-dash-inbox-area]').dispatchEvent(dragEvent(doc, 'dragenter', files()));
    expect(labels).toContain(
      doc.querySelector('.dash-inbox-drop-cover-title').textContent.replace('Drop to Add to ', ''),
    );
  });
});
