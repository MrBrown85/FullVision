/**
 * The Inbox's Roll Call view (teacher/dash-inbox-roll.js; D8 of
 * docs/plans/dashboard-inbox-plan.md): the whole class in class-list order,
 * each state GraderWork's own (and worded as Side by Side words it), the foot
 * line counting the chips as drawn, a first initial when two share a first
 * name, a pair shown in together, the form a tile's height gives, and the
 * pages grid.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => vi.restoreAllMocks());

const roster = () => sortStudents(getStudents(CID), 'lastName');
const ids = () => roster().map(s => s.id);
const chip = (m, sid) => m.students.find(c => c.sid === sid);

// Chips as drawn: solid, dashed and Excused, counted from the model's own
// kinds. A chip with work in that says Excused is counted as Excused.
const drawn = m => ({
  solid: m.students.filter(c => c.kind === 'in' && c.status !== 'excused').length,
  dashed: m.students.filter(c => c.kind === 'out').length,
  excused: m.students.filter(c => c.status === 'excused').length,
});

function sendNothing(aid) {
  const work = getCourseSubmissions(CID);
  work.assessments = work.assessments.map(x => (x.id === aid ? { ...x, students_send: 'nothing' } : x));
  saveDemoStudentWork(CID, work);
}
function draftFor(sid) {
  const real = globalThis.getGradeReturn;
  vi.spyOn(globalThis, 'getGradeReturn').mockImplementation((c, s, a) =>
    s === sid && a === LIGHT ? { is_draft: true } : real(c, s, a),
  );
}

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
        expect(c.state).toBe(GraderWork.workStateOf(CID, aid, c.sid));
      });
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

  it('says Not In Yet for a student with nothing in', () => {
    const m = DashInboxRoll.model(CID, LIGHT);
    const out = m.students.find(c => c.kind === 'out');
    expect(out.said).toBe(out.full + ': Not In Yet');
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

describe('words are Side by Side’s, from GraderWork’s state', () => {
  it('says To Grade while work waits, and Assessed otherwise', () => {
    const m = DashInboxRoll.model(CID, LIGHT);
    m.students
      .filter(c => c.kind === 'in')
      .forEach(c => {
        expect(c.word).toBe(DashInboxSide.stateWord(c.state === 'tograde'));
        expect(c.said.startsWith(c.full + ': ' + c.word)).toBe(true);
      });
    expect(m.students.some(c => c.word === 'To Grade')).toBe(true);
  });

  it('a piece whose Students Send is Nothing: no work is to grade, and the chips say Assessed', () => {
    sendNothing(LIGHT);
    expect(GraderWork.workCounts(CID, LIGHT, ids()).tograde).toBe(0);
    const m = DashInboxRoll.model(CID, LIGHT);
    const solid = m.students.filter(c => c.kind === 'in');
    expect(solid.length).toBeGreaterThan(0);
    solid.forEach(c => {
      expect(c.state).toBe(GraderWork.workStateOf(CID, LIGHT, c.sid));
      expect(c.word).toBe('Assessed');
      expect(c.said).not.toContain('To Grade');
    });
    // And the same words Side by Side writes for the same students.
    const side = DashInboxSide.model(CID, LIGHT);
    side.items.forEach(it => expect(it.line).toContain('Assessed'));
  });

  it('a draft under Missing and under Excused is not to grade, and says so', () => {
    const m0 = DashInboxRoll.model(CID, LIGHT);
    const a = m0.students.find(c => c.in && c.state === 'tograde' && !c.mates.length && c.full !== 'Aiden Singh');
    const b = m0.students.find(c => c.in && c.state === 'tograde' && c.sid !== a.sid && !c.mates.length);
    const real = globalThis.getGradeReturn;
    vi.spyOn(globalThis, 'getGradeReturn').mockImplementation((c, s, x) =>
      (s === a.sid || s === b.sid) && x === LIGHT ? { is_draft: true } : real(c, s, x),
    );
    setAssignmentStatus(CID, a.sid, LIGHT, 'NS');
    setAssignmentStatus(CID, b.sid, LIGHT, 'EXC');
    const m = DashInboxRoll.model(CID, LIGHT);
    const ca = chip(m, a.sid);
    const cb = chip(m, b.sid);
    expect(ca.state).toBe(GraderWork.workStateOf(CID, LIGHT, a.sid));
    expect(cb.state).toBe(GraderWork.workStateOf(CID, LIGHT, b.sid));
    expect(ca.word).not.toBe('To Grade');
    expect(ca.word).toBe('Assessed');
    // Sent work and Excused reads Excused.
    expect(cb.word).toBe('Excused');
    expect(cb.said.startsWith(cb.full + ': Excused')).toBe(true);
  });

  it('a draft with nothing in is solid and Assessed, not dashed', () => {
    const out = DashInboxRoll.model(CID, LIGHT).students.find(c => c.kind === 'out');
    draftFor(out.sid);
    const c = chip(DashInboxRoll.model(CID, LIGHT), out.sid);
    expect(GraderWork.workStateOf(CID, LIGHT, out.sid)).toBe('toreturn');
    expect(c.kind).toBe('in');
    expect(c.word).toBe('Assessed');
  });
});

describe('Excused and Missing', () => {
  const firstOut = aid => DashInboxRoll.model(CID, aid).students.find(c => c.kind === 'out');

  it('says Excused, quiet, and opens the grader like the rest', () => {
    const out = firstOut(LIGHT);
    setAssignmentStatus(CID, out.sid, LIGHT, 'EXC');
    const m = DashInboxRoll.model(CID, LIGHT);
    const c = chip(m, out.sid);
    expect(c.kind).toBe('excused');
    expect(c.said).toBe(c.full + ': Excused');
    expect(m.notIn).not.toContain(out.sid);
    const html = DashInboxRoll.html(CID);
    expect(html).toContain('is-excused');
    expect(html).toContain('data-kind="excused"');
  });

  it('says Missing, and it stays dashed', () => {
    const out = firstOut(LIGHT);
    setAssignmentStatus(CID, out.sid, LIGHT, 'NS');
    const m = DashInboxRoll.model(CID, LIGHT);
    const c = chip(m, out.sid);
    expect(c.kind).toBe('out');
    expect(c.said).toBe(c.full + ': Missing');
    expect(m.notIn).toContain(out.sid);
    expect(DashInboxRoll.html(CID)).toContain('>Missing</span>');
  });
});

describe('the foot counts the chips as drawn', () => {
  const states = {
    'the sample class': () => {},
    'Students Send Nothing': () => sendNothing(LIGHT),
    'a draft with nothing in': () => draftFor(DashInboxRoll.model(CID, LIGHT).students.find(c => c.kind === 'out').sid),
    'an Excused and a Missing student': () => {
      const outs = DashInboxRoll.model(CID, LIGHT).students.filter(c => c.kind === 'out');
      setAssignmentStatus(CID, outs[0].sid, LIGHT, 'EXC');
      setAssignmentStatus(CID, outs[1].sid, LIGHT, 'NS');
    },
    'an Excused student who sent work, and one who did not': () => {
      const m = DashInboxRoll.model(CID, LIGHT);
      setAssignmentStatus(CID, m.students.find(c => c.kind === 'in' && !c.mates.length).sid, LIGHT, 'EXC');
      setAssignmentStatus(CID, m.students.find(c => c.kind === 'out').sid, LIGHT, 'EXC');
    },
  };
  for (const [name, make] of Object.entries(states)) {
    it('agrees for every piece: ' + name, () => {
      make();
      const pieces = getAssessments(CID).filter(a => !isDibelsScored(a));
      expect(pieces.length).toBeGreaterThan(5);
      pieces.forEach(a => {
        const m = DashInboxRoll.model(CID, a.id);
        const d = drawn(m);
        expect(m.counts.in).toBe(d.solid);
        expect(m.counts.notin).toBe(d.dashed);
        expect(m.counts.excused).toBe(d.excused);
        // Each student once: the numbers add up to the class.
        expect(m.counts.in + m.counts.notin + m.counts.excused).toBe(m.students.length);
        expect(m.foot.startsWith(d.solid + ' in · ' + d.dashed + ' not in')).toBe(true);
        if (d.excused) expect(m.foot).toContain(d.excused + ' Excused');
        const html = DashInboxRoll.html(CID);
        void html;
      });
    });
  }

  it('equals GraderWork’s not in where the piece takes work and nothing was assessed without work', () => {
    const m = DashInboxRoll.model(CID, LIGHT);
    expect(m.counts.notin).toBe(GraderWork.workCounts(CID, LIGHT, ids()).notin);
  });
});

describe('the grading style', () => {
  it('does not change a state, a count or a name', () => {
    const was = JSON.stringify(DashInboxRoll.model(CID, LIGHT));
    for (const style of ['letter', 'both', 'proficiency']) {
      COURSES[CID].gradingSystem = style;
      expect(JSON.stringify(DashInboxRoll.model(CID, LIGHT))).toBe(was);
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
  it('draws a chip per student, one Tab stop, and no picture can be dragged', () => {
    const html = DashInboxRoll.html(CID);
    expect((html.match(/data-dash-roll="chip"/g) || []).length).toBe(ids().length);
    expect((html.match(/tabindex="0"/g) || []).length).toBe(1);
    expect(html).not.toContain('Mark Missing');
    expect(html).toContain('Add Work for the Class');
  });

  it('every picture it draws is not draggable', () => {
    DashInboxRoll.reset();
    DashInboxRoll.setForm('pages');
    const imgs = [];
    const html = DashInboxRoll.html(CID);
    (html.match(/<img[^>]*>/g) || []).forEach(i => imgs.push(i));
    expect(imgs.length).toBeGreaterThan(0);
    imgs.forEach(i => expect(i).toContain('draggable="false"'));
  });
});
