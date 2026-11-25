/**
 * The Inbox's redrawn Roll Call (teacher/dash-inbox-rollcall.js; slice I2 of
 * docs/plans/inbox-redesign-plan.md): the three counts are GraderWork's, the
 * class is in class-list order, the piece list holds a piece with nothing in,
 * a filter picks the right students, Handed In on Paper writes through
 * markStudentWorkOnPaper, and the view is registered with the tile.
 * (Clicks, menus and layout are e2e/dashboard-inbox-rollcall.spec.js.)
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
const LIGHT = 'sci8a21';
const PIECE_KEY = 'fv-dash-inbox-rollpiece:' + CID;
let wasDemo;

const loadView = () =>
  runInThisContext(readFileSync('teacher/dash-inbox-rollcall.js', 'utf-8'), {
    filename: 'teacher/dash-inbox-rollcall.js',
  });

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
  loadView();
  DashInboxRollCall.reset();
});
afterEach(() => vi.restoreAllMocks());

const ids = () => sortStudents(getStudents(CID), 'lastName').map(s => s.id);
const view = aid => {
  localStorage.setItem(PIECE_KEY, aid);
  return DashInboxRollCall.html(CID);
};
const attr = (html, name) => [...html.matchAll(new RegExp(name + '="([^"]*)"', 'g'))].map(m => m[1]);

describe('the counts', () => {
  it("equal GraderWork's for the sample class", () => {
    for (const aid of [LAB, LIGHT]) {
      const m = DashInboxRollCall.model(CID, aid);
      const gw = GraderWork.workCounts(CID, aid, ids());
      expect(m.counts.tograde).toBe(gw.ids.tograde.length);
      expect(m.counts.returned).toBe(gw.returned);
      expect(m.counts.notin).toBe(gw.notin);
      expect(m.counts.all).toBe(gw.all);
    }
  });

  it('draw as toggle buttons with the count, and no button for a state with none', () => {
    const html = view(LIGHT);
    const m = DashInboxRollCall.model(CID, LIGHT);
    const states = ['tograde', 'returned', 'notin'].filter(k => m.counts[k] > 0);
    expect(attr(html, 'data-state')).toEqual(states);
    expect(html.match(/dash-inbox-rc-key"/g).length).toBe(states.length);
    expect(html).toContain(m.counts.tograde + ' To Grade');
    expect(html).not.toContain('aria-pressed="true"');
  });
});

describe('the class', () => {
  it('is in class-list order, one button a student', () => {
    const sids = attr(view(LIGHT), 'data-sid');
    expect(sids).toEqual(DashInboxRollCall.model(CID, LIGHT).students.map(c => c.sid));
    expect(new Set(sids)).toEqual(new Set(ids()));
    expect(sids.length).toBe(ids().length);
  });

  it('keeps one Tab stop and words each student for a screen reader', () => {
    expect(view(LIGHT).match(/tabindex="0"/g).length).toBe(1);
    const m = DashInboxRollCall.model(CID, LIGHT);
    m.students.forEach(c => expect(c.said.startsWith(c.full + ': ')).toBe(true));
    expect(m.students.find(c => c.mark === 'notin').said).toMatch(/: (Not In Yet|Missing)$/);
  });

  it('ends at the grid: no line of words under it', () => {
    expect(view(LIGHT).endsWith('</ul></div>')).toBe(true);
  });

  it('draws work that is in but neither to grade nor returned solid, with no tick', () => {
    const m = DashInboxRollCall.model(CID, LIGHT);
    const other = m.students.filter(c => c.mark === 'in');
    other.forEach(c => expect(c.said).not.toContain('returned'));
    expect(m.counts.tograde + m.counts.returned + m.counts.notin + other.length).toBe(m.counts.all);
  });
});

describe('the piece list', () => {
  it('includes a piece with nothing in yet, newest dated first', () => {
    const list = DashInboxRollCall.pieces(CID);
    const withWork = new Set(
      (getCourseSubmissions(CID).submissions || []).filter(s => s.state === 'sent').map(s => s.assessment_id),
    );
    expect(list.some(p => !withWork.has(p.aid))).toBe(true);
    const whens = list.map(p => p.when);
    expect([...whens].sort().reverse()).toEqual(whens);
  });

  it('keeps the choice per class, and falls back when the kept piece is gone', () => {
    const list = DashInboxRollCall.pieces(CID);
    const dflt = DashInboxRollCall.current(CID);
    expect(dflt).toBe((list.find(p => p.toGrade > 0) || list[0]).aid);
    const other = list.find(p => p.aid !== dflt).aid;
    localStorage.setItem(PIECE_KEY, other);
    expect(DashInboxRollCall.current(CID)).toBe(other);
    localStorage.setItem(PIECE_KEY, 'gone');
    expect(DashInboxRollCall.current(CID)).toBe(dflt);
  });

  it('draws the arrows, disabled at the ends', () => {
    const list = DashInboxRollCall.pieces(CID);
    const first = view(list[0].aid);
    expect(first).toMatch(/data-dash-rc="prev" aria-label="Previous assessment" aria-disabled="true"/);
    expect(first).not.toMatch(/data-dash-rc="next" aria-label="Next assessment" aria-disabled/);
    expect(first).toContain('aria-haspopup="listbox"');
  });
});

describe('a filter', () => {
  it('picks out the students in that state, and the three do not overlap', () => {
    const m = DashInboxRollCall.model(CID, LIGHT);
    const a = DashInboxRollCall.picked(CID, LIGHT, 'tograde');
    const b = DashInboxRollCall.picked(CID, LIGHT, 'returned');
    const c = DashInboxRollCall.picked(CID, LIGHT, 'notin');
    expect(a.length).toBe(m.counts.tograde);
    expect(b.length).toBe(m.counts.returned);
    expect(c.length).toBe(m.counts.notin);
    expect(new Set([...a, ...b, ...c]).size).toBe(a.length + b.length + c.length);
    a.forEach(sid => expect(m.students.find(s => s.sid === sid).said).toContain('To Grade'));
  });
});

describe('Handed In on Paper', () => {
  it('is the existing write, markStudentWorkOnPaper, for that one student', async () => {
    const m = DashInboxRollCall.model(CID, LIGHT);
    const sid = m.notIn[0];
    const spy = vi.spyOn(globalThis, 'markStudentWorkOnPaper');
    await DashInboxRollCall.paper(CID, LIGHT, sid);
    expect(spy).toHaveBeenCalledWith(CID, LIGHT, [sid]);
    const after = DashInboxRollCall.model(CID, LIGHT);
    expect(after.notIn).not.toContain(sid);
    expect(after.counts.tograde).toBe(m.counts.tograde + 1);
  });
});

describe('the switch', () => {
  it('registers the view, so the tile can show it', () => {
    DashInbox.setView(CID, 'rollcall');
    expect(DashInbox.viewOf(CID).key).toBe('rollcall');
  });
});
