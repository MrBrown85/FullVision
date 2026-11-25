/**
 * The Inbox's All Caught Up and file drop (teacher/dash-inbox-drop.js; D5 of
 * docs/plans/dashboard-inbox-plan.md). Demo Mode, Science 8, with the
 * student page and Send Work on: the choices and the one chosen, the two
 * quiet lines against GraderWork, the cover's words, a drag with no files,
 * and that a drop calls AddWorkClass.open with the drop itself.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LIGHT = 'sci8a21';
const CELL = 'sci8a1';
let wasDemo;
let stubDocument;

function sendWorkOn() {
  setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = true;
  saveDemoStudentWork(CID, work);
}
const ids = () => getStudents(CID).map(s => s.id);
// Every graded piece returned: nothing to grade and nothing to return.
function returnAll() {
  getAssessments(CID).forEach(a => {
    const back = GraderWork.workCounts(CID, a.id, ids()).ids.toreturn;
    if (back.length) Grader.returnGrades(CID, a.id, back);
  });
}
function caughtUp() {
  getAssessments(CID).forEach(a =>
    GraderWork.workCounts(CID, a.id, ids()).ids.tograde.forEach(sid =>
      Grader.setOverallComment(CID, sid, a.id, 'Seen.'),
    ),
  );
}
// What the tile holds: D5's empty space (DashInbox.emptyHtml, the To Grade view's own fallback) when nothing
// is to grade, else the tile as drawn, stacks and all.
function tileHtml() {
  if (GraderWork.classWorkCounts(CID, ids()).tograde > 0) return DashInbox.html(CID);
  return (
    '<section class="dash-inbox" id="dash-inbox"><div class="dash-inbox-body"><ul class="dash-inbox-list" id="dash-inbox-list">' +
    DashInbox.emptyHtml(CID, { caughtUp: true }) +
    '</ul></div></section>'
  );
}
function mountTile() {
  const html = tileHtml();
  const dom = parseHTML('<!DOCTYPE html><html><body><main id="main">' + html + '</main></body></html>');
  globalThis.document = dom.document;
  DashInboxDrop.mount(dom.document.getElementById('dash-inbox'), CID, {
    caughtUp: !dom.document.querySelector('.dash-inbox-stack'),
  });
  return dom.document;
}
function dragEvent(doc, type, dt) {
  const ev = new doc.defaultView.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dt });
  return ev;
}

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
  // A document of its own, so leave() can take its listeners off it.
  globalThis.document = parseHTML('<!DOCTYPE html><html><body></body></html>').document;
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
  sendWorkOn();
});
afterEach(() => {
  DashInboxDrop.leave(CID);
  globalThis.document = stubDocument;
  vi.restoreAllMocks();
});

describe('which assessment', () => {
  it('offers the pieces taking work that Add Work takes, newest first, three at most', () => {
    const list = DashInboxDrop.choices(CID);
    expect(list.length).toBeGreaterThan(0);
    expect(list.length).toBeLessThanOrEqual(3);
    list.forEach(c => {
      const a = getAssessments(CID).find(x => x.id === c.aid);
      expect(AddWorkClass.offered(CID, a)).toBe(true);
      expect(GraderWork.workOn(CID, a)).toBe(true);
    });
    expect(list.map(c => c.aid)).toEqual([LIGHT, CELL]);
  });

  it('chooses the next one due, else the newest', () => {
    const list = [
      { aid: 'a', title: 'A', due: '2099-01-10' },
      { aid: 'b', title: 'B', due: '2099-01-05' },
      { aid: 'c', title: 'C', due: '' },
    ];
    expect(DashInboxDrop.chosen(CID, list).aid).toBe('b');
    // None due from today on: the newest.
    expect(
      DashInboxDrop.chosen(CID, [
        { aid: 'x', due: '2000-01-01' },
        { aid: 'y', due: '' },
      ]).aid,
    ).toBe('x');
    expect(DashInboxDrop.chosen(CID, [])).toBe(null);
  });

  it('a drop goes to the newest piece taking work, or in All Caught Up to the one chosen', () => {
    expect(DashInboxDrop.target(CID, { caughtUp: false }).aid).toBe(LIGHT);
    caughtUp();
    const doc = mountTile();
    // "Add Work For": one chip a piece (board E1).
    const group = doc.querySelector('[data-dash-inbox-for]');
    expect([...group.querySelectorAll('[data-dash-inbox-for-chip]')].map(o => o.textContent)).toEqual([
      'Light Refraction Lab',
      'Cell Microscope Lab',
    ]);
    group
      .querySelector('[data-dash-inbox-for-chip="' + CELL + '"]')
      .dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
    expect(group.querySelector('[aria-checked="true"]').getAttribute('data-dash-inbox-for-chip')).toBe(CELL);
    expect(DashInboxDrop.target(CID, { caughtUp: true }).aid).toBe(CELL);
    // Not caught up: still the newest.
    expect(DashInboxDrop.target(CID, { caughtUp: false }).aid).toBe(LIGHT);
  });

  it('with nothing taking work there is nowhere to drop, and the cover says so', () => {
    const work = getCourseSubmissions(CID);
    work.course.send_work = false;
    saveDemoStudentWork(CID, work);
    expect(DashInboxDrop.choices(CID)).toEqual([]);
    expect(DashInboxDrop.target(CID, { caughtUp: true })).toBe(null);
    expect(DashInboxDrop.coverText(null)).toEqual([
      'No assessment is taking work, so these files have nowhere to go.',
      '',
    ]);
  });
});

describe('All Caught Up', () => {
  it('0 to grade, 7 to return: the drop area, then the two lines under it, and not "All Caught Up"', () => {
    caughtUp();
    const html = tileHtml();
    // As the top bar: work waits to be returned, so nothing is caught up.
    expect(GraderWork.classWorkCounts(CID, ids())).toMatchObject({ tograde: 0, toreturn: 7 });
    expect(html).not.toContain('All Caught Up');
    expect(html).toContain('Drop the Scan, a Folder or Files');
    expect(html).toContain('Photos or PDFs. Files are matched to students by name.');
    expect(html).not.toContain('dash-inbox-stack');
    const doc = mountTile();
    expect([...doc.querySelectorAll('.dash-inbox-drop-pick')].map(b => b.textContent)).toEqual(
      window.AddWorkSplit
        ? ['Choose Files…', 'Choose a Folder…', 'Split a Scan…']
        : ['Choose Files…', 'Choose a Folder…'],
    );
    expect(doc.querySelector('.dash-inbox-drop-area').classList.contains('awt-drop')).toBe(true);
    const counts = GraderWork.workCounts(CID, LIGHT, ids());
    const lines = [...doc.querySelectorAll('.dash-inbox-drop-line')].map(p => p.textContent.replace(/\s+/g, ' '));
    expect(lines[0]).toBe('Light Refraction Lab: ' + counts.toreturn + ' Not Returned Return Them →');
    expect(counts.toreturn).toBeGreaterThan(0);
    expect(lines[1]).toBe('Next taking work: Light Refraction Lab · ' + counts.notin + ' not in yet Work Wall →');
    expect(doc.querySelector('.dash-inbox-drop-line a').getAttribute('data-href')).toBe(
      '/assignments?course=' + CID + '&open=' + LIGHT,
    );
    // As on the board: Add Work For, the drop area, then the two lines.
    expect([...doc.querySelector('#dash-inbox-caught').children].map(el => el.className)).toEqual([
      'dash-inbox-drop-top',
      'awt-drop dash-inbox-drop-area',
      'dash-inbox-drop-line dash-inbox-drop-back',
      'dash-inbox-drop-line',
    ]);
  });

  it('nothing to grade and nothing to return: "All Caught Up", as the top bar says it', () => {
    caughtUp();
    returnAll();
    expect(GraderWork.classWorkCounts(CID, ids())).toMatchObject({ tograde: 0, toreturn: 0 });
    const doc = mountTile();
    const home = doc.querySelector('#dash-inbox-caught');
    expect(home.querySelector('.dash-inbox-drop-caught').textContent).toBe('All Caught Up');
    expect(home.querySelector('.dash-inbox-drop-back')).toBeNull();
    expect(home.textContent).not.toContain('Not Returned');
    expect(home.querySelector('.dash-inbox-drop-area')).not.toBeNull();
  });

  it('escapes the titles', () => {
    const a = getAssessments(CID).find(x => x.id === LIGHT);
    a.title = '<i>Hi</i>';
    caughtUp();
    const html = tileHtml();
    expect(html).not.toContain('<i>Hi');
    expect(html).toContain('&lt;i&gt;Hi&lt;/i&gt;');
  });

  it('Choose Files… opens Add Work for the chosen piece, then its own Choose Files…', () => {
    caughtUp();
    const doc = mountTile();
    const clicked = [];
    const open = vi.spyOn(AddWorkClass, 'open').mockImplementation((cid, aid) => {
      const o = doc.createElement('div');
      o.id = 'add-work-class-overlay';
      ['files', 'folder', 'scan'].forEach(w => {
        const b = doc.createElement('button');
        b.setAttribute('data-awt', w);
        b.addEventListener('click', () => clicked.push([aid, w]));
        o.appendChild(b);
      });
      doc.body.appendChild(o);
      return true;
    });
    doc
      .querySelector('[data-dash-inbox-pick="folder"]')
      .dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(CID);
    expect(open.mock.calls[0][1]).toBe(LIGHT);
    expect(clicked).toEqual([[LIGHT, 'folder']]);
  });
});

describe('a drop on the tile', () => {
  it('a drag with files shows one cover naming where they go; leaving takes it away', () => {
    const doc = mountTile();
    const cover = doc.querySelector('.dash-inbox-drop-cover');
    expect(cover.hidden).toBe(true);
    const dt = { types: ['Files'], files: [{ name: 'x.jpg' }], items: [] };
    const row = doc.querySelector('.dash-inbox-stack');
    row.dispatchEvent(dragEvent(doc, 'dragenter', dt));
    expect(cover.hidden).toBe(false);
    expect(cover.textContent).toBe(
      'Drop to Add to Light Refraction LabPhotos or PDFs. Files are matched to students by name.',
    );
    // Into a child and out of the first: still one cover.
    cover.dispatchEvent(dragEvent(doc, 'dragenter', dt));
    row.dispatchEvent(dragEvent(doc, 'dragleave', dt));
    expect(cover.hidden).toBe(false);
    cover.dispatchEvent(dragEvent(doc, 'dragleave', dt));
    expect(cover.hidden).toBe(true);
  });

  it('a drag with no files shows nothing and a drop of it does nothing', () => {
    const doc = mountTile();
    const open = vi.spyOn(AddWorkClass, 'open');
    const dt = { types: ['text/plain'], files: [], items: [] };
    const row = doc.querySelector('.dash-inbox-stack');
    row.dispatchEvent(dragEvent(doc, 'dragenter', dt));
    const over = dragEvent(doc, 'dragover', dt);
    row.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(false);
    expect(doc.querySelector('.dash-inbox-drop-cover').hidden).toBe(true);
    const drop = dragEvent(doc, 'drop', dt);
    row.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
    expect(DashInboxDrop.hasFiles({ dataTransfer: dt })).toBe(false);
    expect(DashInboxDrop.hasFiles({})).toBe(false);
  });

  it('a drop calls AddWorkClass.open inside the handler, with the drop itself', () => {
    const doc = mountTile();
    let during = null;
    const dt = { types: ['Files'], files: [{ name: 'x.jpg' }], items: [] };
    const drop = dragEvent(doc, 'drop', dt);
    const open = vi.spyOn(AddWorkClass, 'open').mockImplementation((cid, aid, opts) => {
      // Still inside the drop: the event is being dispatched.
      during = drop.eventPhase;
      return true;
    });
    doc.querySelector('.dash-inbox-stack').dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    const [cid, aid, opts] = open.mock.calls[0];
    expect([cid, aid]).toEqual([CID, LIGHT]);
    expect(opts.drop).toBe(dt);
    expect(typeof opts.onClose).toBe('function');
    expect(during).not.toBe(0);
    expect(doc.querySelector('.dash-inbox-drop-cover').hidden).toBe(true);
  });

  it('unmount takes the cover and the listeners away', () => {
    const doc = mountTile();
    const tile = doc.getElementById('dash-inbox');
    DashInboxDrop.unmount();
    expect(doc.querySelector('.dash-inbox-drop-cover')).toBeNull();
    const open = vi.spyOn(AddWorkClass, 'open');
    const dt = { types: ['Files'], files: [{ name: 'x.jpg' }], items: [] };
    const drop = dragEvent(doc, 'drop', dt);
    tile.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});
