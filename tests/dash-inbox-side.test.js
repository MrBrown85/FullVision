/**
 * Side by Side and the assessment switch (teacher/dash-inbox-side.js and
 * dash-inbox-pick.js; D6 of docs/plans/dashboard-inbox-plan.md). The sample
 * class (Science 8) with the student page and Send Work on: Light Refraction
 * Lab has work waiting, Cell Microscope Lab is assessed (Ethan on paper,
 * Mateo added by the teacher). Every state and count is GraderWork's.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1'; // Cell Microscope Lab
const LIGHT = 'sci8a21'; // Light Refraction Lab
let wasDemo;

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
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
  setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = true;
  saveDemoStudentWork(CID, work);
});

const ids = () => getStudents(CID).map(s => s.id);

describe('DashInboxPick', () => {
  it("lists the pieces with work in, newest work first, with GraderWork's count", () => {
    const list = DashInboxPick.pieces(CID);
    expect(list.map(p => p.aid)).toEqual([LIGHT, LAB]);
    expect(list[0].title).toBe('Light Refraction Lab');
    list.forEach(p => expect(p.inCount).toBe(GraderWork.workInIds(CID, p.aid, ids()).length));
  });

  it('keeps the chosen piece per class, and falls back to the first when none is kept or it is gone', () => {
    expect(DashInboxPick.current(CID)).toBe(LIGHT);
    DashInboxPick.set(CID, LAB);
    expect(localStorage.getItem('fv-dash-inbox-piece:' + CID)).toBe(LAB);
    expect(DashInboxPick.current(CID)).toBe(LAB);
    DashInboxPick.set(CID, 'a-piece-that-is-gone');
    expect(DashInboxPick.current(CID)).toBe(LIGHT);
    DashInboxPick.set(CID, LAB);
    // Another class keeps its own.
    expect(DashInboxPick.current('some-other-class')).toBe(null);
  });

  it('defaults to the first piece with work to grade, not just the newest work', () => {
    // Cell Microscope Lab (all assessed) now has the newest work; Light Refraction Lab still waits.
    const work = getCourseSubmissions(CID);
    work.submissions.forEach(s => {
      if (s.assessment_id === LAB) s.sent_at = '2030-01-01T10:00:00Z';
    });
    saveDemoStudentWork(CID, work);
    const list = DashInboxPick.pieces(CID);
    expect(list.map(p => p.aid)).toEqual([LAB, LIGHT]);
    expect(GraderWork.workCounts(CID, LAB, ids()).tograde).toBe(0);
    expect(GraderWork.workCounts(CID, LIGHT, ids()).tograde).toBeGreaterThan(0);
    expect(DashInboxPick.current(CID)).toBe(LIGHT);
    // A kept piece that still exists stays the kept one.
    DashInboxPick.set(CID, LAB);
    expect(DashInboxPick.current(CID)).toBe(LAB);
    // With nothing to grade anywhere, the first piece with work in.
    GraderWork.workCounts(CID, LIGHT, ids()).ids.tograde.forEach(sid =>
      Grader.setOverallComment(CID, sid, LIGHT, 'Seen.'),
    );
    DashInboxPick.set(CID, 'gone');
    expect(DashInboxPick.current(CID)).toBe(LAB);
  });

  it('has no pieces and no current with nothing in', () => {
    const work = getCourseSubmissions(CID);
    work.submissions = [];
    saveDemoStudentWork(CID, work);
    expect(DashInboxPick.pieces(CID)).toEqual([]);
    expect(DashInboxPick.current(CID)).toBe(null);
    expect(DashInboxPick.html(CID)).toBe('');
  });

  it('draws one button a piece, the current one pressed, each with its aid', () => {
    DashInboxPick.set(CID, LAB);
    const out = DashInboxPick.html(CID);
    const btns = [...out.matchAll(/<button[^>]*data-dash-inbox-pick="([^"]+)" aria-pressed="(\w+)">([^<]*)</g)];
    expect(btns.map(b => b[1])).toEqual([LIGHT, LAB]);
    expect(btns.map(b => b[2])).toEqual(['false', 'true']);
    expect(btns[0][3]).toMatch(/^Light Refraction Lab · \d+ In$/);
    expect(out).toContain('role="group"');
  });

  it('sets the piece and calls back on a click, and stops after unmount', () => {
    const handlers = {};
    const root = {
      addEventListener: (type, fn) => (handlers[type] = fn),
      removeEventListener: type => delete handlers[type],
      contains: () => true,
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    const click = aid => ({
      target: { closest: () => ({ getAttribute: () => aid, closest: () => null }) },
    });
    const got = [];
    DashInboxPick.mount(root, CID, aid => got.push(aid));
    handlers.click(click(LAB));
    expect(got).toEqual([LAB]);
    expect(DashInboxPick.current(CID)).toBe(LAB);
    DashInboxPick.unmount(root);
    expect(handlers.click).toBeUndefined();
    expect(handlers.keydown).toBeUndefined();
  });
});

describe('DashInboxSide model', () => {
  it('lists every student with work in, to grade first by arrival, then assessed', () => {
    const m = DashInboxSide.model(CID, LIGHT);
    expect(m.items.flatMap(i => i.members).sort()).toEqual(GraderWork.workInIds(CID, LIGHT, ids()).sort());
    expect(m.items.length).toBeGreaterThan(3);
    const states = m.items.map(i => i.tograde);
    // Every to-grade piece of work before any assessed one.
    expect(states).toEqual([...states].sort((a, b) => Number(b) - Number(a)));
    const times = m.items.filter(i => i.tograde).map(i => Date.parse(i.at));
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(m.order).toEqual(m.items.map(i => i.sid));
    m.items.forEach(i => expect(i.tograde).toBe(GraderWork.workStateOf(CID, LIGHT, i.sid) === 'tograde'));
  });

  it('says the state, the time and Late in the line under each page', () => {
    const m = DashInboxSide.model(CID, LIGHT);
    m.items.forEach(i => expect(i.line).toMatch(/ · (To Grade|Assessed)/));
    const marcus = m.items.find(i => i.name === 'Marcus Lee');
    expect(marcus.late).toBe(true);
    expect(marcus.line).toMatch(/^Late · \w{3} \d{1,2}:\d{2} [ap]m · To Grade$/);
    const sofia = m.items.find(i => i.name === 'Sofia Petrov');
    expect(sofia.late).toBe(false);
    expect(sofia.line).not.toContain('Late');
  });

  it('makes a pile of a student who sent several pages, in page order', () => {
    const m = DashInboxSide.model(CID, LIGHT);
    const sofia = m.items.find(i => i.name === 'Sofia Petrov');
    expect(sofia.pages.length).toBe(2);
    expect(sofia.pages.map(p => p.page)).toEqual([1, 2]);
    expect(m.items.filter(i => i.pages.length === 1).length).toBe(m.items.length - 1);
  });

  it('draws a paper hand-in with no scan as a lined sheet, and says who added work', () => {
    const m = DashInboxSide.model(CID, LAB);
    const ethan = m.items.find(i => i.name === 'Ethan Dubois');
    expect(ethan.sheet).toBe(true);
    expect(ethan.paper).toBe(true);
    expect(ethan.line).toContain('On Paper');
    const mateo = m.items.find(i => i.name === 'Mateo Cruz');
    expect(mateo.line).toMatch(/^Added by You · /);
    expect(mateo.line).toMatch(/ · Assessed$/);
    expect(m.items.every(i => !i.tograde)).toBe(true);
  });

  it("the not-in count and the foot are GraderWork's own", () => {
    for (const aid of [LIGHT, LAB]) {
      const m = DashInboxSide.model(CID, aid);
      expect(m.notIn).toBe(GraderWork.workCounts(CID, aid, ids()).notin);
    }
    const m = DashInboxSide.model(CID, LIGHT);
    expect(DashInboxSide.footText(m)).toBe('To grade first, then assessed. ' + m.notIn + ' not in yet.');
    expect(DashInboxSide.footText({ notIn: 0 })).toBe('To grade first, then assessed.');
  });

  it("shows a pair as one item: the sender's page, captioned with both names, one stop for the grader", () => {
    const m = DashInboxSide.model(CID, LIGHT);
    const names = m.items.map(i => i.name);
    // Aiden sent the work; Olivia is his pair, so she is not an item of her own.
    const pair = m.items.find(i => i.name === 'Aiden Singh and Olivia Tam');
    expect(pair).toBeTruthy();
    expect(pair.fullName).toBe('Aiden Singh, Olivia Tam');
    expect(pair.members.length).toBe(2);
    expect(names).not.toContain('Olivia Tam');
    expect(names).not.toContain('Aiden Singh');
    expect(m.order.filter(sid => pair.members.includes(sid))).toEqual([pair.sid]);
    // The switch's count is still GraderWork's: both students are in.
    expect(DashInboxPick.pieces(CID).find(p => p.aid === LIGHT).inCount).toBe(
      GraderWork.workInIds(CID, LIGHT, ids()).length,
    );
    expect(m.items.length).toBe(GraderWork.workInIds(CID, LIGHT, ids()).length - 1);
  });

  it('is empty with no piece', () => {
    expect(DashInboxSide.model(CID, null).items).toEqual([]);
    expect(DashInboxSide.model(CID, 'nope').items).toEqual([]);
  });
});

describe('DashInboxSide view', () => {
  it('registers as Side by Side, and draws a pile with its count and no Compare control', () => {
    expect(DashInbox.viewOf(CID).key).toBe('assessment');
    DashInbox.setView(CID, 'side');
    expect(DashInbox.viewOf(CID).label).toBe('Side by Side');
    const out = DashInbox.html(CID);
    expect(out).toContain('dash-inbox-side-row');
    expect(out).toContain('2 pages');
    expect(out).not.toMatch(/Compare 2|picked/);
    // Pictures wait for mount: no address in the markup.
    expect(out).not.toMatch(/src=/);
  });

  it('escapes every name and title', () => {
    const students = getStudents(CID);
    const was = students[0].firstName;
    students[0].firstName = '<img src=x onerror=alert(1)>';
    const out = DashInboxSide.html(CID);
    students[0].firstName = was;
    expect(out).not.toContain('<img src=x');
  });
});
