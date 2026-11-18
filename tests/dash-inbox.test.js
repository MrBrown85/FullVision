/**
 * The Inbox tile (teacher/dash-inbox.js; D4 of
 * docs/plans/dashboard-inbox-plan.md): no count in its header, the counts
 * line's forms, Grade Submissions carrying its piece, the title opening the
 * Work Wall, All Caught Up, and the top bar's To Grade cell going to the tile
 * when the tile is on the page and to Assignments when it is not.
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

function flags(on) {
  localStorage.removeItem('fv-build-dashRow');
  localStorage.removeItem('fv-build-bulletins');
  for (const [k, v] of Object.entries(on)) if (v) localStorage.setItem('fv-build-' + k, '1');
}
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
  const dom = parseHTML('<!DOCTYPE html><html><body><main id="main">' + html + '</main></body></html>');
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
  flags({ dashRow: true });
  sendWorkOn();
});
afterEach(() => {
  globalThis.document = stubDocument;
  delete window.WorkWall;
});

describe('the tile', () => {
  it('has the title, one view pill, one Assignments link, and no count in its header', () => {
    const doc = mountTile();
    const head = doc.querySelector('.dash-inbox-head');
    expect(head.querySelector('.dash-inbox-title').textContent).toBe('Inbox');
    expect(head.querySelector('.dash-view-btn').textContent.trim()).toBe('By Assessment');
    // The pill's menu lists the views registered; By Assessment is first (later slices add theirs).
    expect(head.querySelector('.dash-view-item').textContent).toContain('By Assessment');
    expect(head.querySelectorAll('a')).toHaveLength(1);
    expect(head.querySelector('a').textContent).toBe('Assignments →');
    expect(head.textContent).not.toMatch(/\d/);
    // Closed at rest.
    expect(head.querySelector('.dash-view-menu').hasAttribute('hidden')).toBe(true);
  });

  it('is nothing with Send Work off', () => {
    const work = getCourseSubmissions(CID);
    work.course.send_work = false;
    saveDemoStudentWork(CID, work);
    expect(DashInbox.html(CID)).toBe('');
  });

  it('says each row\'s counts as "N in · N to grade · N not in"', () => {
    const doc = mountTile();
    const row = doc.querySelector('.dash-inbox-row[data-aid="' + LIGHT + '"]');
    const c = GraderWork.workCounts(CID, LIGHT, ids());
    const inN = GraderWork.workInIds(CID, LIGHT, ids()).length;
    expect(row.querySelector('.dash-inbox-main').textContent).toBe(
      inN + ' in · ' + c.tograde + ' to grade · ' + c.notin + ' not in',
    );
    expect(row.querySelector('.dash-inbox-name').textContent).toBe('Light Refraction Lab');
    // Late is a word, in its own span.
    expect(row.querySelector('.dash-inbox-late').textContent).toBe('· Late 1');
    expect(row.querySelector('.dash-inbox-newest').textContent).toMatch(/^Newest: Marcus Lee, /);
    expect(DashInbox.countsText({ in: 6, tograde: 4, notin: 20, toreturn: 2 })).toBe(
      '6 in · 4 to grade · 20 not in · 2 to return',
    );
    expect(DashInbox.countsText({ in: 6, tograde: 4, notin: 20, toreturn: 0 })).toBe('6 in · 4 to grade · 20 not in');
  });

  it('says "You Added" and "on paper" quietly', () => {
    const model = DashInboxModel.build(CID, { seen: null });
    const html = DashInbox.html(CID);
    const doc = parseHTML('<body>' + html + '</body>').document;
    // Cell Microscope Lab has nothing to grade, so it has no row; its words are the model's.
    expect(doc.querySelector('.dash-inbox-row[data-aid="sci8a1"]')).toBeNull();
    expect(model.pieces.find(p => p.aid === 'sci8a1')).toMatchObject({ addedByTeacher: 2, onPaper: 1 });
  });

  it('Grade Submissions opens the grader on the first student in the order the work came in', () => {
    const doc = mountTile();
    const button = doc.querySelector('.dash-inbox-row[data-aid="' + LIGHT + '"] .dash-inbox-grade');
    expect(button.textContent).toBe('Grade Submissions');
    expect(button.getAttribute('data-aid')).toBe(LIGHT);
    const calls = [];
    const was = window.PageAssignments;
    window.PageAssignments = { openGrader: (...a) => calls.push(a) };
    try {
      const { handled } = clickOn(doc, '.dash-inbox-row[data-aid="' + LIGHT + '"] .dash-inbox-grade');
      expect(handled).toBe(true);
    } finally {
      window.PageAssignments = was;
    }
    const order = DashInboxModel.build(CID, { seen: null }).pieces.find(p => p.aid === LIGHT).gradeOrder;
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(CID);
    expect(calls[0][1]).toBe(LIGHT);
    expect(calls[0][2]).toBe(order[0]);
    expect(calls[0][3].studentIds).toEqual(order);
    expect(calls[0][3].show).toBe('tograde');
    expect(typeof calls[0][3].onClose).toBe('function');
  });

  it('the title opens the Work Wall', () => {
    const doc = mountTile();
    const calls = [];
    window.WorkWall = { open: (...a) => calls.push(a) };
    expect(clickOn(doc, '.dash-inbox-row[data-aid="' + LIGHT + '"] .dash-inbox-name').handled).toBe(true);
    expect(calls[0].slice(0, 2)).toEqual([CID, LIGHT]);
    expect(typeof calls[0][2].onClose).toBe('function');
  });

  it('escapes a title and a name', () => {
    getAssessments(CID).find(a => a.id === LIGHT).title = '<i>Hi</i> & "you"';
    const html = DashInbox.html(CID);
    expect(html).not.toContain('<i>Hi');
    expect(html).toContain('&lt;i&gt;Hi&lt;/i&gt;');
  });

  it('is All Caught Up when nothing waits, and D5 can replace the line', () => {
    getStudents(CID);
    GraderWork.workCounts(CID, LIGHT, ids()).ids.tograde.forEach(sid =>
      Grader.setOverallComment(CID, sid, LIGHT, 'Seen.'),
    );
    expect(DashInbox.html(CID)).toContain('All Caught Up');
    expect(DashInbox.html(CID)).not.toContain('Grade Submissions');
    const was = DashInbox.emptyHtml;
    DashInbox.emptyHtml = () => '<li id="d5-drop"></li>';
    try {
      expect(DashInbox.html(CID)).toContain('id="d5-drop"');
      expect(DashInbox.html(CID)).not.toContain('All Caught Up');
    } finally {
      DashInbox.emptyHtml = was;
    }
  });
});

// The top bar as the page draws it; the To Grade cell is inside.
const glance = () => DashOverview.glanceHtml({ cid: CID, allStudents: getStudents(CID), classAvg: 0, missing: [] });

describe("the top bar's To Grade cell", () => {
  const cell = () => parseHTML('<body>' + glance() + '</body>').document.querySelector('.dash-glance-tograde');

  it('goes to the Inbox with the switch on and the tile built', () => {
    const a = cell();
    expect(a.hasAttribute('data-dash-inbox-jump')).toBe(true);
    expect(a.getAttribute('aria-label')).toMatch(/: go to the Inbox$/);
    // The look and the text are as before.
    expect(a.querySelector('.dash-glance-label').textContent).toBe('To Grade');
    expect(a.getAttribute('data-href')).toBe('/assignments?course=' + CID + '&show=tograde');
  });

  it('opens Assignments with the switch off, or no tile built', () => {
    flags({});
    let a = cell();
    expect(a.hasAttribute('data-dash-inbox-jump')).toBe(false);
    expect(a.getAttribute('aria-label')).toMatch(/: open Assignments$/);
    flags({ dashRow: true });
    const was = window.DashInbox;
    delete window.DashInbox;
    try {
      a = cell();
      expect(a.hasAttribute('data-dash-inbox-jump')).toBe(false);
    } finally {
      window.DashInbox = was;
    }
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
