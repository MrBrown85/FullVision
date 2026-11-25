/**
 * The redrawn Inbox's To Grade view (teacher/dash-inbox-stacks.js, and the
 * tile's header in teacher/dash-inbox.js; slice I1 of
 * docs/plans/inbox-redesign-plan.md).
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
  setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = true;
  saveDemoStudentWork(CID, work);
  seedDemoDrafts();
  DashInboxStacks.reset();
});
afterEach(() => {
  globalThis.document = stubDocument;
  delete window.PageAssignments;
  delete window.DashInboxRollCall;
  delete window.WorkWall;
});

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
function clickOn(doc, selector) {
  const target = doc.querySelector(selector);
  expect(target, selector).toBeTruthy();
  let redraws = 0;
  const handled = DashInbox.click(
    { target, button: 0, preventDefault: () => {} },
    {
      cid: CID,
      redraw: () => {
        redraws++;
      },
    },
  );
  return { handled, redraws: () => redraws };
}

describe('the To Grade view', () => {
  it('has the title, a two-button switch, Assignments →, one button, and no view menu or assignment row', () => {
    const doc = parseHTML('<body>' + DashInbox.html(CID) + '</body>').document;
    const head = doc.querySelector('.dash-inbox-head');
    expect(head.querySelector('.dash-inbox-title').textContent).toBe('Inbox');
    expect(head.querySelector('.dash-view-btn')).toBeNull();
    expect(doc.querySelector('.dash-inbox-row, .dash-inbox-list .dash-inbox-name')).toBeNull();
    const modes = [...head.querySelectorAll('.dash-inbox-switch [data-dash-inbox="mode"]')];
    // Roll Call is another file's: without it the switch shows To Grade alone.
    expect(modes.map(b => b.textContent)).toEqual(['To Grade']);
    expect(modes[0].getAttribute('aria-pressed')).toBe('true');
    expect(head.querySelector('a').textContent).toBe('Assignments →');
    const action = head.querySelectorAll('.dash-inbox-action');
    expect(action).toHaveLength(1);
    expect(action[0].textContent).toBe('Start Grading');
  });

  it('offers Roll Call in the switch once a view with that key is registered, and keeps the choice per class', () => {
    DashInbox.addView({ key: 'rollcall', label: 'Roll Call', html: () => '<p id="rc">roll</p>' });
    try {
      let doc = parseHTML('<body>' + DashInbox.html(CID) + '</body>').document;
      expect([...doc.querySelectorAll('.dash-inbox-switch button')].map(b => b.textContent)).toEqual([
        'To Grade',
        'Roll Call',
      ]);
      DashInbox.setView(CID, 'rollcall');
      expect(localStorage.getItem('fv-dash-inbox-view:' + CID)).toBe('rollcall');
      doc = parseHTML('<body>' + DashInbox.html(CID) + '</body>').document;
      expect(doc.querySelector('#rc')).toBeTruthy();
      expect(doc.querySelector('.dash-inbox-action')).toBeNull();
      const pressed = [...doc.querySelectorAll('.dash-inbox-switch button')].map(b => b.getAttribute('aria-pressed'));
      expect(pressed).toEqual(['false', 'true']);
    } finally {
      // Leave the registry as it was found.
      DashInbox.setView(CID, 'stacks');
    }
  });

  it('the switch picks a view and draws again', () => {
    DashInbox.addView({ key: 'rollcall', label: 'Roll Call', html: () => '' });
    const doc = mountTile();
    const { handled, redraws } = clickOn(doc, '[data-mode="rollcall"]');
    expect(handled).toBe(true);
    expect(redraws()).toBe(1);
    expect(localStorage.getItem('fv-dash-inbox-view:' + CID)).toBe('rollcall');
    DashInbox.setView(CID, 'stacks');
  });

  it("draws one stack per assessment with work to grade, each with GraderWork's count", () => {
    const doc = parseHTML('<body>' + DashInbox.html(CID) + '</body>').document;
    const stacks = [...doc.querySelectorAll('.dash-inbox-stack')];
    const c = GraderWork.workCounts(
      CID,
      LIGHT,
      getStudents(CID).map(s => s.id),
    );
    expect(stacks).toHaveLength(1);
    const stack = stacks[0];
    expect(stack.getAttribute('data-aid')).toBe(LIGHT);
    expect(stack.querySelector('.dash-inbox-stack-count').textContent).toBe(String(c.tograde));
    expect(stack.querySelectorAll('.dash-inbox-stack-layer')).toHaveLength(Math.min(4, c.tograde - 1));
    expect(stack.querySelector('.dash-inbox-stack-late').textContent).toBe('Late');
    expect(stack.querySelector('img[data-work-pic][data-dash-stack-pic]')).toBeTruthy();
    expect(stack.getAttribute('aria-label')).toBe(
      'Light Refraction Lab, ' + c.tograde + ' to grade, late. Open this stack.',
    );
    const title = doc.querySelector('.dash-inbox-stack-title');
    expect(title.textContent).toBe('Light Refraction Lab');
    expect(title.getAttribute('data-dash-inbox')).toBe('wall');
  });

  it("shows a dot, and says so in the stack's name, when a student sent work since the last look", () => {
    localStorage.setItem('fv-dash-inbox-seen:' + CID, '2026-11-01T00:00:00Z');
    const doc = parseHTML('<body>' + DashInbox.html(CID) + '</body>').document;
    expect(doc.querySelector('.dash-inbox-stack-dot').getAttribute('aria-label')).toBe('New work');
    expect(doc.querySelector('.dash-inbox-stack').getAttribute('aria-label')).toContain('new work');
  });

  it('lies a graded pile face down with Return N, in a class that holds grades', () => {
    let doc = parseHTML('<body>' + DashInbox.html(CID) + '</body>').document;
    const pile = doc.querySelector('.dash-inbox-return');
    expect(pile.querySelector('.dash-inbox-return-count').textContent).toBe('2');
    expect(pile.querySelector('.dash-inbox-return-btn').textContent).toBe('Return 2');
    expect(doc.querySelector('.dash-inbox-returns').classList.contains('is-solo')).toBe(false);
    setStudentPageSwitch(CID, true, 'on_save');
    doc = parseHTML('<body>' + DashInbox.html(CID) + '</body>').document;
    expect(doc.querySelector('.dash-inbox-return')).toBeNull();
  });

  it('Return N asks first, through PageAssignments.askReturn, when there is one', () => {
    const doc = mountTile();
    const calls = [];
    window.PageAssignments = { askReturn: (...a) => calls.push(a) };
    const { handled, redraws } = clickOn(doc, '.dash-inbox-return-btn');
    expect(handled).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(CID);
    expect(calls[0][1]).toEqual([LIGHT]);
    calls[0][3]();
    expect(redraws()).toBe(1);
    // Without it nothing breaks.
    delete window.PageAssignments;
    expect(clickOn(doc, '.dash-inbox-return-btn').handled).toBe(true);
  });

  it('Start Grading opens the grader on the first student of the first stack, with the queue', () => {
    const doc = mountTile();
    const calls = [];
    window.PageAssignments = { openGrader: (...a) => calls.push(a) };
    expect(clickOn(doc, '[data-dash-inbox="start"]').handled).toBe(true);
    const queue = DashInboxQueue.order(CID);
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 3)).toEqual([CID, queue[0].aid, queue[0].studentIds[0]]);
    expect(calls[0][3].studentIds).toEqual(queue[0].studentIds);
    expect(calls[0][3].show).toBe('tograde');
    expect(calls[0][3].queue).toEqual(queue);
    expect(typeof calls[0][3].onClose).toBe('function');
  });

  it('a stack opens in place: its pages with name and time, then Not In, and a click closes it', () => {
    let doc = mountTile();
    const { handled, redraws } = clickOn(doc, '.dash-inbox-stack');
    expect(handled).toBe(true);
    expect(redraws()).toBe(1);
    expect(DashInboxStacks.state().open).toBe(LIGHT);
    doc = mountTile();
    const open = DashInboxQueue.open(CID, LIGHT);
    expect(doc.querySelector('.dash-inbox-stack')).toBeNull();
    const spread = doc.querySelector('.dash-inbox-spread');
    expect(spread.querySelectorAll('.dash-inbox-page')).toHaveLength(open.items.length);
    expect(spread.querySelector('.dash-inbox-page-name').textContent).toBe(open.items[0].name);
    expect(spread.querySelector('.dash-inbox-page-when').textContent).toMatch(/\d:\d\d [ap]m/);
    expect(spread.querySelector('.dash-inbox-notin-head').textContent).toContain('Not In');
    expect(spread.querySelector('.dash-inbox-notin-n').textContent).toBe(String(open.notIn.length));
    expect(spread.querySelectorAll('.dash-inbox-notin-chip')).toHaveLength(open.notIn.length);
    expect(spread.querySelector('.dash-inbox-spread-close').getAttribute('aria-label')).toBe('Close this stack');
    // Everything to click is a real button.
    spread.querySelectorAll('[data-dash-inbox]').forEach(el => expect(el.tagName).toBe('BUTTON'));
    clickOn(doc, '.dash-inbox-spread-close');
    expect(DashInboxStacks.state().open).toBe(null);
    doc = mountTile();
    expect(doc.querySelector('.dash-inbox-spread')).toBeNull();
    expect(doc.querySelector('.dash-inbox-stack')).toBeTruthy();
  });

  it("a page opens the grader on that student with that piece's ids and the whole queue", () => {
    clickOn(mountTile(), '.dash-inbox-stack');
    const doc = mountTile();
    const pages = [...doc.querySelectorAll('.dash-inbox-page')];
    const last = pages[pages.length - 1];
    const calls = [];
    window.PageAssignments = { openGrader: (...a) => calls.push(a) };
    expect(clickOn(doc, '.dash-inbox-page[data-sid="' + last.getAttribute('data-sid') + '"]').handled).toBe(true);
    const queue = DashInboxQueue.order(CID);
    expect(calls[0].slice(0, 3)).toEqual([CID, LIGHT, last.getAttribute('data-sid')]);
    expect(calls[0][3].studentIds).toEqual(queue.find(q => q.aid === LIGHT).studentIds);
    expect(calls[0][3].queue).toEqual(queue);
  });

  it('a Not In name goes to Roll Call on that piece when it is there', () => {
    clickOn(mountTile(), '.dash-inbox-stack');
    const doc = mountTile();
    const calls = [];
    window.DashInboxRollCall = { show: (...a) => calls.push(a) };
    expect(clickOn(doc, '.dash-inbox-notin-chip').handled).toBe(true);
    expect(calls).toEqual([[CID, LIGHT]]);
  });

  it('lets go of an open stack whose work is all graded', () => {
    clickOn(mountTile(), '.dash-inbox-stack');
    const work = getCourseSubmissions(CID);
    work.submissions = work.submissions.filter(s => s.assessment_id !== LIGHT);
    saveDemoStudentWork(CID, work);
    const doc = parseHTML('<body>' + DashInbox.html(CID) + '</body>').document;
    expect(doc.querySelector('.dash-inbox-spread')).toBeNull();
    expect(DashInboxStacks.state().open).toBe(null);
  });
});

describe('the states', () => {
  const queue = extra =>
    Object.assign(
      { on: true, holds: true, toGrade: 0, toReturn: 0, caughtUp: true, stacks: [], returns: [], taking: [] },
      extra,
    );
  const ret = (aid, n, title) => ({ aid, title: title || 'Piece ' + aid, toreturn: n });

  it('with nothing to grade and more than one graded piece: Return All N in the header, piles face down', () => {
    const q = queue({ returns: [ret('a', 28), ret('b', 3), ret('c', 1), ret('d', 18)], toReturn: 50 });
    const head = parseHTML('<body>' + DashInboxStacks.headerHtml(CID, null, q) + '</body>').document;
    expect(head.querySelector('button').textContent).toBe('Return All 50');
    const doc = parseHTML('<body>' + DashInboxStacks.html(CID, null, q) + '</body>').document;
    expect(doc.querySelector('.dash-inbox-stack')).toBeNull();
    expect(doc.querySelector('.dash-inbox-returns').classList.contains('is-solo')).toBe(true);
    expect([...doc.querySelectorAll('.dash-inbox-return-btn')].map(b => b.textContent)).toEqual([
      'Return 28',
      'Return 3',
      'Return 1',
      'Return 18',
    ]);
  });

  it('Return All N asks once for every piece with a grade waiting', () => {
    const q = queue({ returns: [ret('a', 28), ret('b', 3)], toReturn: 31 });
    const doc = parseHTML('<body>' + DashInboxStacks.headerHtml(CID, null, q) + '</body>').document;
    const calls = [];
    window.PageAssignments = { askReturn: (...a) => calls.push(a) };
    const button = doc.querySelector('button');
    // The queue Return All asks about is the class's own: here the sample's one piece.
    DashInboxStacks.click(button, { cid: CID, redraw: () => {} });
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(CID);
    expect(calls[0][2]).toBe(button);
  });

  it('with one graded piece there is no header button, only its own Return N', () => {
    expect(DashInboxStacks.headerHtml(CID, null, queue({ returns: [ret('a', 5)], toReturn: 5 }))).toBe('');
  });

  it("with nothing to grade or return, draws the tile's existing empty state", () => {
    const html = DashInboxStacks.html(CID, { caughtUp: true }, queue());
    expect(html).toContain('id="dash-inbox-caught"');
    expect(DashInboxStacks.headerHtml(CID, null, queue())).toBe('');
  });

  it('writes a title only through esc', () => {
    const q = queue({
      toGrade: 2,
      caughtUp: false,
      stacks: [
        {
          aid: 'a<b',
          title: '<img src=x onerror=alert(1)>',
          tograde: 2,
          notin: 0,
          late: false,
          isNew: false,
          at: '',
          top: null,
        },
      ],
    });
    const html = DashInboxStacks.html(CID, null, q);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
