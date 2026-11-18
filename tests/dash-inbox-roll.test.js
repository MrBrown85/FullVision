/**
 * The Inbox's Roll Call view (teacher/dash-inbox-roll.js; D8 of
 * docs/plans/dashboard-inbox-plan.md): the whole class in class-list order,
 * each state GraderWork's own, the foot line's counts GraderWork's, a first
 * initial when two share a first name, a pair shown in together, the form a
 * tile's height gives, and the pages grid.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
const LIGHT = 'sci8a21';
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
  DashInboxRoll.reset();
});

const roster = () => sortStudents(getStudents(CID), 'lastName');
const ids = () => roster().map(s => s.id);

describe('the model', () => {
  it('has one entry per student in class-list order', () => {
    const m = DashInboxRoll.model(CID, LIGHT);
    expect(m.students.map(c => c.sid)).toEqual(ids());
    expect(m.students.length).toBeGreaterThan(20);
  });

  it("gives each state as GraderWork's workStateOf does, and in as workInIds does", () => {
    for (const aid of [LAB, LIGHT]) {
      const m = DashInboxRoll.model(CID, aid);
      const inIds = GraderWork.workInIds(CID, aid, ids());
      m.students.forEach(c => {
        expect(c.in).toBe(inIds.includes(c.sid));
        if (c.in) {
          const was = GraderWork.workStateOf(CID, aid, c.sid);
          expect(c.state).toBe(was || 'tograde');
        } else {
          expect(c.state).toBe(null);
        }
      });
    }
  });

  it("makes the foot line's counts GraderWork's", () => {
    for (const aid of [LAB, LIGHT]) {
      const m = DashInboxRoll.model(CID, aid);
      const c = GraderWork.workCounts(CID, aid, ids());
      expect(m.counts.in).toBe(GraderWork.workInIds(CID, aid, ids()).length);
      expect(m.counts.notin).toBe(c.notin);
      expect(m.foot.startsWith(m.counts.in + ' in · ' + c.notin + ' not in')).toBe(true);
    }
  });

  it('names a paper hand-in and Late in the chip, and on the foot', () => {
    const m = DashInboxRoll.model(CID, LAB);
    const ethan = m.students.find(c => c.full === 'Ethan Dubois');
    expect(ethan.paper).toBe(true);
    expect(ethan.said).toContain('On Paper');
    expect(m.foot).toContain('Ethan Dubois on paper');
    const light = DashInboxRoll.model(CID, LIGHT);
    const marcus = light.students.find(c => c.full === 'Marcus Lee');
    expect(marcus.late).toBe(true);
    expect(marcus.said).toContain('Late');
    expect(light.foot).toContain('1 Late');
  });

  it('says a student with nothing in is not in', () => {
    const m = DashInboxRoll.model(CID, LIGHT);
    const out = m.students.find(c => !c.in);
    expect(out.said).toBe(out.full + ': Not in');
    expect(m.notIn).toContain(out.sid);
    expect(m.order.every(id => !m.notIn.includes(id))).toBe(true);
  });

  it('shows each member of a pair in', () => {
    const m = DashInboxRoll.model(CID, LIGHT);
    const aiden = m.students.find(c => c.full === 'Aiden Singh');
    const olivia = m.students.find(c => c.full === 'Olivia Tam');
    expect(aiden.in).toBe(true);
    expect(olivia.in).toBe(true);
    const mate = [aiden, olivia].find(c => c.mates.length);
    expect(mate.said).toContain('with ');
  });
});

describe('Excused and Missing', () => {
  const firstOut = aid => DashInboxRoll.model(CID, aid).students.find(c => !c.in);

  it('says Excused, leaves it out of the not-in count and the Add Work list', () => {
    const before = DashInboxRoll.model(CID, LIGHT);
    const out = firstOut(LIGHT);
    setAssignmentStatus(CID, out.sid, LIGHT, 'EXC');
    const m = DashInboxRoll.model(CID, LIGHT);
    const c = m.students.find(x => x.sid === out.sid);
    expect(c.status).toBe('excused');
    expect(c.said).toBe(c.full + ': Excused');
    expect(m.counts.notin).toBe(GraderWork.workCounts(CID, LIGHT, ids()).notin);
    expect(m.counts.notin).toBe(before.counts.notin - 1);
    expect(m.notIn).not.toContain(out.sid);
    const html = DashInboxRoll.html(CID, DashInboxModel.build(CID));
    expect(html).toContain('is-excused');
    expect(html).toContain('data-excused="1"');
  });

  it('says Missing, and still counts it as not in', () => {
    const before = DashInboxRoll.model(CID, LIGHT);
    const out = firstOut(LIGHT);
    setAssignmentStatus(CID, out.sid, LIGHT, 'NS');
    const m = DashInboxRoll.model(CID, LIGHT);
    const c = m.students.find(x => x.sid === out.sid);
    expect(c.said).toBe(c.full + ': Missing');
    expect(m.counts.notin).toBe(before.counts.notin);
    expect(m.notIn).toContain(out.sid);
  });
});

describe('the grading style', () => {
  it('does not change a state, a count or a name', () => {
    const was = JSON.stringify(DashInboxRoll.model(CID, LIGHT));
    for (const style of ['letter', 'both', 'proficiency']) {
      COURSES[CID].gradingSystem = style;
      expect(JSON.stringify(DashInboxRoll.model(CID, LIGHT))).toBe(was);
      const m = DashInboxRoll.model(CID, LIGHT);
      m.students.forEach(c => {
        if (c.in) expect(c.state).toBe(GraderWork.workStateOf(CID, LIGHT, c.sid) || 'tograde');
      });
    }
  });
});

describe('the names', () => {
  it('is a first name, with the last initial when two share one', () => {
    const names = DashInboxRoll.shortNames([
      { id: 'a', firstName: 'Sam', lastName: 'Blackwood' },
      { id: 'b', firstName: 'sam', lastName: 'Lee' },
      { id: 'c', firstName: 'Ava', lastName: 'Roy' },
    ]);
    expect(names).toEqual({ a: 'Sam B.', b: 'sam L.', c: 'Ava' });
  });

  it('writes the foot line', () => {
    const c = { in: 10, notin: 17, late: 2 };
    expect(DashInboxRoll.footText(c, ['Ethan Dubois'])).toBe('10 in · 17 not in · 2 Late · Ethan Dubois on paper');
    expect(DashInboxRoll.footText(c, ['A B', 'C D'])).toBe('10 in · 17 not in · 2 Late · A B and C D on paper');
    expect(DashInboxRoll.footText({ in: 1, notin: 2, late: 0 }, ['a', 'b', 'c'])).toBe('1 in · 2 not in · 3 on paper');
  });
});

describe('the form and the grid', () => {
  it('is names under 380 px and pages from 380', () => {
    expect(DashInboxRoll.formFor(299)).toBe('names');
    expect(DashInboxRoll.formFor(379)).toBe('names');
    expect(DashInboxRoll.formFor(380)).toBe('pages');
    expect(DashInboxRoll.formFor(510)).toBe('pages');
  });

  it('fits 27 pages nine across in three rows at the full column, none under 80 px', () => {
    const lay = DashInboxRoll.layoutFor(27, 629, 360);
    expect(lay.cols).toBe(9);
    expect(lay.pageH).toBeGreaterThanOrEqual(80);
    expect(lay.scrolls).toBe(false);
  });

  it('scrolls, at 80 px, when they cannot all fit', () => {
    const lay = DashInboxRoll.layoutFor(30, 629, 260);
    expect(lay.pageH).toBe(80);
    expect(lay.scrolls).toBe(true);
  });
});

describe('the tile body', () => {
  it('draws a chip per student, each a button with its state in its name', () => {
    const html = DashInboxRoll.html(CID, DashInboxModel.build(CID));
    const n = (html.match(/data-dash-roll="chip"/g) || []).length;
    expect(n).toBe(ids().length);
    expect(html).not.toContain('Mark Missing');
    expect(html).toContain('Add Work for the Class');
  });
});
