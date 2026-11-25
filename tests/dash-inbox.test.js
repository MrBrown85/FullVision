/**
 * The Inbox tile (teacher/dash-inbox.js; D4 of
 * docs/plans/dashboard-inbox-plan.md, redrawn by
 * docs/plans/inbox-redesign-plan.md): its header, only in a class with the
 * student page and Send Work on, its stacks adding up to the top bar's To
 * Grade, the chosen view and an open stack kept through a redraw, and the top
 * bar's To Grade cell going to the tile when the tile is on the page and to
 * Assignments when it is not.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LIGHT = 'sci8a21';
let wasDemo;
let stubDocument;

function sendWorkOn() {
  setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = true;
  saveDemoStudentWork(CID, work);
}
const ids = () => getStudents(CID).map(s => s.id);

// The tile as a page: DashInbox's click looks for it in the document.
function mountTile() {
  const html = DashInbox.html(CID);
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><main id="main"><div class="dash-glance"></div>' + html + '</main></body></html>',
  );
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(dom.document.createElement('div')));
  proto.scrollIntoView = function () {};
  proto.focus = function () {};
  globalThis.document = dom.document;
  return dom.document;
}
function clickOn(doc, selector, extra) {
  const target = doc.querySelector(selector);
  let prevented = false;
  const e = Object.assign({ target, button: 0, preventDefault: () => (prevented = true) }, extra || {});
  const handled = DashInbox.click(e, { cid: CID, redraw: () => {} });
  return { handled, prevented };
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
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
  sendWorkOn();
});
afterEach(() => {
  globalThis.document = stubDocument;
  delete window.WorkWall;
});

describe('the tile', () => {
  it('has the title, a two-way switch, one Assignments link, one button, and no count in its header', () => {
    const doc = mountTile();
    const head = doc.querySelector('.dash-inbox-head');
    expect(head.querySelector('.dash-inbox-title').textContent).toBe('Inbox');
    expect(head.querySelector('.dash-view-btn')).toBeNull();
    expect(head.querySelectorAll('a')).toHaveLength(1);
    expect(head.querySelector('a').textContent).toBe('Assignments →');
    expect(head.querySelectorAll('.dash-inbox-action')).toHaveLength(1);
    expect(head.querySelector('.dash-inbox-action').textContent).toBe('Start Grading');
    expect(head.textContent).not.toMatch(/\d/);
  });

  it('is nothing with Send Work off', () => {
    const work = getCourseSubmissions(CID);
    work.course.send_work = false;
    saveDemoStudentWork(CID, work);
    expect(DashInbox.shows(CID)).toBe(false);
    expect(DashInbox.html(CID)).toBe('');
  });

  it('is nothing with the student page off', () => {
    setStudentPageSwitch(CID, false, 'on_return');
    expect(DashInbox.shows(CID)).toBe(false);
    expect(DashInbox.html(CID)).toBe('');
  });

  it("has stacks whose to grade add up to the top bar's To Grade", () => {
    const doc = mountTile();
    const sum = [...doc.querySelectorAll('.dash-inbox-stack-count')].reduce((n, el) => n + Number(el.textContent), 0);
    const bar = parseHTML('<body>' + glance() + '</body>').document.querySelector('.dash-glance-tograde');
    expect(sum).toBeGreaterThan(0);
    expect(bar.textContent).toContain(String(sum));
    expect(DashInbox.model().toGrade).toBe(sum);
  });

  it('keeps the chosen view and an open stack when the Dashboard draws again', () => {
    DashInbox.addView({ key: 'rollcall', label: 'Roll Call', html: () => '<p id="rc">roll</p>' });
    try {
      let doc = mountTile();
      clickOn(doc, '.dash-inbox-stack');
      doc = mountTile();
      expect(doc.querySelector('.dash-inbox-spread')).toBeTruthy();
      expect(doc.querySelector('[data-mode="stacks"]').getAttribute('aria-pressed')).toBe('true');
      DashInbox.setView(CID, 'rollcall');
      doc = mountTile();
      expect(doc.querySelector('#rc')).toBeTruthy();
      expect(doc.querySelector('[data-mode="rollcall"]').getAttribute('aria-pressed')).toBe('true');
      // Back to To Grade: the stack is still open.
      DashInbox.setView(CID, 'stacks');
      expect(mountTile().querySelector('.dash-inbox-spread')).toBeTruthy();
    } finally {
      DashInbox.setView(CID, 'stacks');
      DashInboxStacks.reset();
    }
  });

  it('reads the time as "Thu 1:05 pm", with no comma, and a date past a week', () => {
    const day = DashInbox.whenText(CID, new Date(Date.now() - 86400000).toISOString());
    expect(day).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2} [ap]m$/);
    expect(DashInbox.whenText(CID, new Date(Date.now() - 20 * 86400000).toISOString())).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}, \d{1,2}:\d{2} [ap]m$/,
    );
  });

  it('starts the kept time at a first look, so nothing is new on it', () => {
    const key = 'fv-dash-inbox-seen:' + CID;
    localStorage.removeItem(key);
    const doc = parseHTML('<body>' + DashInbox.html(CID) + '</body>').document;
    expect(doc.querySelector('.dash-inbox-stack-dot')).toBeNull();
    expect(Date.parse(localStorage.getItem(key))).toBeGreaterThan(0);
  });

  it("a stack's title opens the Work Wall", () => {
    const doc = mountTile();
    const calls = [];
    window.WorkWall = { open: (...a) => calls.push(a) };
    expect(clickOn(doc, '.dash-inbox-stack-title').handled).toBe(true);
    expect(calls[0].slice(0, 2)).toEqual([CID, LIGHT]);
    expect(typeof calls[0][2].onClose).toBe('function');
  });

  it('is All Caught Up when nothing waits', () => {
    GraderWork.workCounts(CID, LIGHT, ids()).ids.tograde.forEach(sid =>
      Grader.setOverallComment(CID, sid, LIGHT, 'Seen.'),
    );
    expect(DashInbox.html(CID)).not.toContain('Start Grading');
    expect(DashInbox.html(CID)).not.toContain('dash-inbox-stack"');
  });
});

// The top bar as the page draws it; the To Grade cell is inside.
const glance = () => DashOverview.glanceHtml({ cid: CID, allStudents: getStudents(CID), classAvg: 0, missing: [] });

describe("the top bar's To Grade cell", () => {
  const cell = () => parseHTML('<body>' + glance() + '</body>').document.querySelector('.dash-glance-tograde');

  it('goes to the Inbox with the tile built', () => {
    const a = cell();
    expect(a.hasAttribute('data-dash-inbox-jump')).toBe(true);
    expect(a.getAttribute('aria-label')).toMatch(/: go to the Inbox$/);
    // The look and the text are as before.
    expect(a.querySelector('.dash-glance-label').textContent).toBe('To Grade');
    expect(a.getAttribute('data-href')).toBe('/assignments?course=' + CID + '&show=tograde');
  });

  it('opens Assignments with no tile built', () => {
    const was = window.DashInbox;
    delete window.DashInbox;
    try {
      const a = cell();
      expect(a.hasAttribute('data-dash-inbox-jump')).toBe(false);
      expect(a.getAttribute('aria-label')).toMatch(/: open Assignments$/);
    } finally {
      window.DashInbox = was;
    }
  });

  it('goes to the Inbox whatever an old fv-build-dashRow on the device says (D9: the row is on)', () => {
    for (const v of ['0', '1', 'no']) {
      localStorage.setItem('fv-build-dashRow', v);
      expect(cell().hasAttribute('data-dash-inbox-jump')).toBe(true);
      expect(DashInbox.shows(CID)).toBe(true);
    }
    localStorage.removeItem('fv-build-dashRow');
  });

  it('a click scrolls to the Inbox and rings it; with none on the page the link is left alone', () => {
    const doc = mountTile();
    const cellEl = parseHTML('<body>' + glance() + '</body>').document.querySelector('.dash-glance-tograde');
    doc.body.appendChild(doc.importNode ? doc.importNode(cellEl, true) : cellEl);
    const r = clickOn(doc, '.dash-glance-tograde');
    expect(r.handled).toBe(true);
    expect(r.prevented).toBe(true);
    expect(doc.getElementById('dash-inbox').classList.contains('is-ring')).toBe(true);
    // A click to open a new tab is the link's.
    expect(clickOn(doc, '.dash-glance-tograde', { metaKey: true }).handled).toBe(false);
    // No Inbox in the page: the click is not taken.
    doc.getElementById('dash-inbox').remove();
    const none = clickOn(doc, '.dash-glance-tograde');
    expect(none.handled).toBe(false);
    expect(none.prevented).toBe(false);
  });
});
