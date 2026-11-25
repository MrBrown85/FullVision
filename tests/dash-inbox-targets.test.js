/**
 * The redrawn Inbox with nothing waiting (R5) and a scan held over it (R6):
 * teacher/dash-inbox-targets.js and the one-line tile in teacher/dash-inbox.js
 * (slice I4 of docs/plans/inbox-redesign-plan.md). Behind the build switch
 * inboxStacks: off, the tile is D5's, as released.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
  DashInboxStacks.reset();
});
afterEach(() => {
  DashInboxTargets.leave();
  DashInboxDrop.leave(CID);
  globalThis.document = stubDocument;
  delete window.DashInboxRollCall;
  vi.restoreAllMocks();
});

const flagOn = () => localStorage.setItem('fv-build-inboxStacks', '1');
const ids = () => getStudents(CID).map(s => s.id);
// Everything assessed and returned: nothing to grade and nothing to return.
function allDone() {
  getAssessments(CID).forEach(a =>
    GraderWork.workCounts(CID, a.id, ids()).ids.tograde.forEach(sid =>
      Grader.setOverallComment(CID, sid, a.id, 'Seen.'),
    ),
  );
  getAssessments(CID).forEach(a => {
    const back = GraderWork.workCounts(CID, a.id, ids()).ids.toreturn;
    if (back.length) Grader.returnGrades(CID, a.id, back);
  });
}
/* The tile as a page, mounted the way afterRender does. With `bulletins` false
   the targets are the tile's body. */
function mountTile({ bulletins = true } = {}) {
  const html = DashInbox.html(CID, { bulletins });
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><main id="main"><div class="dash-glance"></div><div class="dash-row-left">' +
      html +
      '</div></main></body></html>',
  );
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(dom.document.createElement('div')));
  proto.focus = function () {};
  globalThis.document = dom.document;
  const tile = dom.document.getElementById('dash-inbox');
  const rest = tile.classList.contains('is-rest');
  DashInboxDrop.mount(tile, CID, DashInbox.model(), { own: true });
  DashInboxTargets.mount(tile, CID, { quiet: !rest, rest });
  return dom.document;
}
function click(doc, el) {
  let redraws = 0;
  const handled = DashInbox.click(
    { target: el, button: 0, preventDefault: () => {} },
    { cid: CID, redraw: () => redraws++ },
  );
  return { handled, redraws: () => redraws };
}
function dragEvent(doc, type, target, dt) {
  const ev = new doc.defaultView.Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', { value: dt });
  target.dispatchEvent(ev);
  return ev;
}
const files = () => ({ types: ['Files'], files: [{ name: 'x.pdf' }], items: [], dropEffect: 'none' });

describe('the switch off', () => {
  it('is D5 as released: the drop area for a class with nothing to grade', () => {
    allDone();
    const doc = parseHTML('<body>' + DashInbox.html(CID, { bulletins: true }) + '</body>').document;
    expect(doc.querySelector('#dash-inbox-caught')).toBeTruthy();
    expect(doc.querySelector('.is-quiet, .dash-inbox-target, .dash-inbox-caught-up')).toBeNull();
    expect(DashInbox.quiet()).toBe(false);
  });
});

describe('which state draws', () => {
  beforeEach(flagOn);

  it('work waiting: the usual tile, not the line', () => {
    parseHTML('<body>' + DashInbox.html(CID, { bulletins: true }) + '</body>');
    expect(DashInbox.quiet()).toBe(false);
  });

  it('nothing to grade and nothing to return: the line', () => {
    allDone();
    const doc = parseHTML('<body>' + DashInbox.html(CID, { bulletins: true }) + '</body>').document;
    expect(DashInbox.quiet()).toBe(true);
    const tile = doc.getElementById('dash-inbox');
    expect(tile.classList.contains('is-quiet')).toBe(true);
    expect(tile.classList.contains('is-rest')).toBe(false);
    const head = tile.querySelector('.dash-inbox-head');
    expect(head.querySelector('.dash-inbox-title').textContent).toBe('Inbox');
    expect([...head.querySelectorAll('.dash-inbox-switch button')].map(b => b.textContent)).toContain('To Grade');
    expect(head.querySelector('.dash-inbox-caught-up').textContent).toBe('All Caught Up');
    expect(head.querySelector('[data-dash-inbox="targets-open"]').textContent).toBe('Add Work');
    expect(head.querySelector('a').textContent).toBe('Assignments →');
    // No body and no line of grey words under it.
    expect(tile.querySelector('.dash-inbox-body').textContent).toBe('');
    expect(tile.querySelector('.dash-inbox-action:not([data-dash-inbox="targets-open"])')).toBeNull();
  });

  it('graded work still to return: not the line', () => {
    getAssessments(CID).forEach(a =>
      GraderWork.workCounts(CID, a.id, ids()).ids.tograde.forEach(sid =>
        Grader.setOverallComment(CID, sid, a.id, 'Seen.'),
      ),
    );
    parseHTML('<body>' + DashInbox.html(CID, { bulletins: true }) + '</body>');
    expect(DashInbox.quiet()).toBe(false);
  });

  it('Roll Call is never the line', () => {
    allDone();
    DashInbox.addView({ key: 'rollcall', label: 'Roll Call', html: () => '<p>roll</p>' });
    DashInbox.setView(CID, 'rollcall');
    try {
      parseHTML('<body>' + DashInbox.html(CID, { bulletins: true }) + '</body>');
      expect(DashInbox.quiet()).toBe(false);
    } finally {
      DashInbox.setView(CID, 'stacks');
    }
  });

  it('with no Bulletins the tile keeps its height and its body is the targets', () => {
    allDone();
    const doc = parseHTML('<body>' + DashInbox.html(CID, { bulletins: false }) + '</body>').document;
    const tile = doc.getElementById('dash-inbox');
    expect(tile.classList.contains('is-rest')).toBe(true);
    expect(tile.querySelectorAll('.dash-inbox-body .dash-inbox-target').length).toBeGreaterThan(1);
  });

  it('the chips are queue.taking, two at most, each showing Roll Call on its piece', () => {
    allDone();
    const taking = DashInboxQueue.build(CID, {}).taking;
    expect(taking.length).toBeGreaterThan(0);
    const doc = mountTile();
    const chips = [...doc.querySelectorAll('.dash-inbox-chip')];
    expect(chips.map(c => c.getAttribute('data-aid'))).toEqual(taking.slice(0, 2).map(t => t.aid));
    expect(chips[0].querySelector('b').textContent).toBe(taking[0].notin + ' Not In');
    expect(chips[0].getAttribute('aria-label')).toContain(taking[0].title);
    const show = vi.fn();
    window.DashInboxRollCall = { show };
    expect(click(doc, chips[0]).handled).toBe(true);
    expect(show).toHaveBeenCalledWith(CID, taking[0].aid);
  });
});

describe('the targets', () => {
  beforeEach(() => {
    flagOn();
    allDone();
  });

  it('are the pieces Add Work For lists, in its order, then Another Assessment', () => {
    const doc = mountTile({ bulletins: false });
    const want = DashInboxDrop.choices(CID, 7);
    expect(want.length).toBeGreaterThan(1);
    const buttons = [...doc.querySelectorAll('.dash-inbox-target')];
    expect(buttons.map(b => b.getAttribute('data-aid'))).toEqual([...want.map(c => c.aid), null]);
    expect(buttons.map(b => b.querySelector('.dash-inbox-target-title').textContent)).toEqual([
      ...want.map(c => c.label),
      'Another Assessment',
    ]);
    // The first three are D5's own three.
    expect(want.slice(0, 3).map(c => c.aid)).toEqual(DashInboxDrop.choices(CID).map(c => c.aid));
    // "N Not In" is GraderWork's count, and left out at zero.
    const counts = DashInboxDrop.notInBy(CID);
    want.forEach((c, i) => {
      const n = buttons[i].querySelector('.dash-inbox-target-count');
      if (counts[c.aid]) expect(n.textContent).toBe(counts[c.aid] + ' Not In');
      else expect(n).toBeNull();
    });
    // Every target is a button with a name.
    buttons.forEach(b => expect(b.tagName).toBe('BUTTON'));
    expect(buttons[0].getAttribute('aria-label')).toContain(want[0].label);
  });

  it('files held over the line open them, and they close when the drag leaves', () => {
    const doc = mountTile();
    const tile = doc.getElementById('dash-inbox');
    const panel = doc.querySelector('.dash-inbox-targets');
    expect(panel.hidden).toBe(true);
    dragEvent(doc, 'dragenter', tile, files());
    expect(panel.hidden).toBe(false);
    expect(panel.querySelectorAll('.dash-inbox-target').length).toBeGreaterThan(1);
    expect(DashInboxTargets.state()).toBe('drag');
    dragEvent(doc, 'dragleave', tile, files());
    expect(panel.hidden).toBe(true);
    expect(DashInboxTargets.state()).toBeNull();
  });

  it('a drag that is not files (a picture dragged from the page) opens nothing', () => {
    const doc = mountTile();
    dragEvent(doc, 'dragenter', doc.getElementById('dash-inbox'), { types: ['text/plain'], files: [], items: [] });
    expect(doc.querySelector('.dash-inbox-targets').hidden).toBe(true);
  });

  it('a drop on a target opens Add Work for the Class on that piece with the drop', () => {
    const doc = mountTile();
    const tile = doc.getElementById('dash-inbox');
    const open = vi.spyOn(AddWorkClass, 'open').mockImplementation(() => true);
    const dt = files();
    dragEvent(doc, 'dragenter', tile, dt);
    const target = doc.querySelector('.dash-inbox-target[data-aid="' + LIGHT + '"]');
    const ev = dragEvent(doc, 'drop', target, dt);
    expect(ev.defaultPrevented).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0][0]).toBe(CID);
    expect(open.mock.calls[0][1]).toBe(LIGHT);
    expect(open.mock.calls[0][2].drop).toBe(dt);
    // The targets go with the drop.
    expect(doc.querySelector('.dash-inbox-targets').hidden).toBe(true);
  });

  it('a drop off every target opens nothing', () => {
    const doc = mountTile();
    const open = vi.spyOn(AddWorkClass, 'open').mockImplementation(() => true);
    dragEvent(doc, 'dragenter', doc.getElementById('dash-inbox'), files());
    dragEvent(doc, 'drop', doc.querySelector('.dash-inbox-head'), files());
    expect(open).not.toHaveBeenCalled();
  });

  it('a drop on a piece that has stopped taking work opens nothing in its place and says so', () => {
    const doc = mountTile();
    const open = vi.spyOn(AddWorkClass, 'open').mockImplementation(() => true);
    vi.spyOn(DashInboxDrop, 'stillOffered').mockReturnValue(false);
    const tile = doc.getElementById('dash-inbox');
    dragEvent(doc, 'dragenter', tile, files());
    dragEvent(doc, 'drop', doc.querySelector('.dash-inbox-target[data-aid="' + LIGHT + '"]'), files());
    expect(open).not.toHaveBeenCalled();
    expect(doc.querySelector('.dash-inbox-targets-note').textContent).toContain('were not added');
  });

  it('a drop on the rest state reaches Add Work too', () => {
    const doc = mountTile({ bulletins: false });
    const open = vi.spyOn(AddWorkClass, 'open').mockImplementation(() => true);
    const dt = files();
    dragEvent(doc, 'drop', doc.querySelector('.dash-inbox-target[data-aid="' + LIGHT + '"]'), dt);
    expect(open.mock.calls[0].slice(0, 2)).toEqual([CID, LIGHT]);
  });

  it('the Add Work button opens them with a Close button; Close and Escape shut them', () => {
    const doc = mountTile();
    const panel = doc.querySelector('.dash-inbox-targets');
    click(doc, doc.querySelector('[data-dash-inbox="targets-open"]'));
    expect(panel.hidden).toBe(false);
    expect(DashInboxTargets.state()).toBe('add');
    click(doc, panel.querySelector('[data-dash-inbox="targets-close"]'));
    expect(panel.hidden).toBe(true);
    click(doc, doc.querySelector('[data-dash-inbox="targets-open"]'));
    const esc = new doc.defaultView.Event('keydown', { bubbles: true, cancelable: true });
    esc.key = 'Escape';
    doc.getElementById('dash-inbox').dispatchEvent(esc);
    expect(panel.hidden).toBe(true);
  });

  it('a click on a target opens Add Work for the Class on that piece with no files', () => {
    const doc = mountTile();
    const open = vi.spyOn(AddWorkClass, 'open').mockImplementation(() => true);
    click(doc, doc.querySelector('[data-dash-inbox="targets-open"]'));
    click(doc, doc.querySelector('.dash-inbox-target[data-aid="' + LIGHT + '"]'));
    expect(open.mock.calls[0][1]).toBe(LIGHT);
    expect(open.mock.calls[0][2].drop).toBeUndefined();
  });

  it('Another Assessment sends the teacher to Assignments', () => {
    const doc = mountTile();
    const navigate = vi.fn();
    window.Router = { isRoute: () => true, navigate };
    try {
      click(doc, doc.querySelector('[data-dash-inbox="targets-open"]'));
      click(doc, doc.querySelector('[data-dash-inbox="target-other"]'));
      expect(navigate).toHaveBeenCalledWith('/assignments?course=' + CID);
    } finally {
      delete window.Router;
    }
  });
});
