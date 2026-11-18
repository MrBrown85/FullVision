/**
 * One student's work on one piece is looked up without copying the whole
 * class's work.
 *
 * What broke (Nov 13, 2026): History 12 had 635 pieces of work filed (1,297
 * pages). getStudentSubmission copied every submission of the class for each
 * ask, and one draw of a page asks for each student on each piece: counting
 * the class's work took about two seconds, and every page that shows work
 * was slow. The lookups now go through an index made once for each stored
 * copy of the work (shared/data-student-work.js, _newestSubmissionsOf).
 *
 * This file holds the two halves: the answers are what the old way gave, and
 * a draw's lookups make no whole-class copy (counted, not timed, so the test
 * does not depend on the machine).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass, openAssignments, closePages } from './helpers/pin-save-paths.js';

const CID = U(1);
const Q = U(41);
const IDS = Array.from({ length: 30 }, (_, i) => U(100 + i));
const AIDS = Array.from({ length: 36 }, (_, i) => U(300 + i));
const GONE = U(399); // a piece that was deleted: its work is not given
let wasDemo;
let real;
let wholeClassCopies;

function file(n, k) {
  return {
    id: 'f' + n + '-' + k,
    page: k,
    path: 'p' + n + '-' + k + '.jpg',
    thumb_path: 't' + n + '-' + k + '.jpg',
    sha256: 'h' + n + k,
  };
}
function sub(n, aid, sid, extra) {
  return Object.assign(
    {
      id: 's' + n,
      assessment_id: aid,
      enrollment_id: sid,
      version: 1,
      state: 'sent',
      sent_by: 'teacher',
      on_paper: false,
      is_late: false,
      note: null,
      sent_at: '2026-11-13T19:00:00Z',
      created_at: '2026-11-13T19:00:00Z',
      // Stored out of order on purpose: the readers give the pages in order.
      files: [file(n, 2), file(n, 1)],
    },
    extra || {},
  );
}

// 635 pieces of work across 30 students and 36 pieces, as History 12 had.
function seed() {
  seedClass(CID, {
    students: IDS.map((id, i) => ({ id, firstName: 'First' + i, lastName: 'Last' + i })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: AIDS.map((id, i) => ({
      id,
      title: 'Piece ' + i,
      tagIds: [Q],
      date: '2026-10-01',
      dueDate: '2026-10-02',
    })),
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  const subs = [];
  let n = 0;
  AIDS.forEach(aid =>
    IDS.forEach((sid, i) => {
      if (subs.length >= 635 || (i * 7 + n++) % 5 === 0) return;
      subs.push(sub(subs.length, aid, sid));
    }),
  );
  // A second version of one piece, stored before and after its first; a send not finished; a deleted piece's work.
  subs.push(sub(9001, AIDS[35], IDS[29], { version: 2 }));
  subs.push(sub(9002, AIDS[35], IDS[29], { version: 1 }));
  subs.push(sub(9003, AIDS[35], IDS[28], { state: 'sending' }));
  subs.push(sub(9004, GONE, IDS[0]));
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: AIDS.map(id => ({ id, students_send: 'photos', after_due: 'stop' })),
    submissions: subs,
  });
}

// The old way: every submission of the class copied, then the student's newest picked.
function oldWay(sid, aid) {
  const mine = real(CID)
    .filter(s => s.enrollment_id === sid && s.assessment_id === aid)
    .sort((x, y) => (y.version || 1) - (x.version || 1));
  return mine[0] || null;
}

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  real = globalThis._studentWorkSubmissions;
  wholeClassCopies = 0;
  globalThis._studentWorkSubmissions = function (cid) {
    wholeClassCopies++;
    return real(cid);
  };
});
afterEach(() => {
  globalThis._studentWorkSubmissions = real;
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe("one student's work on one piece", { timeout: 120000 }, () => {
  it('is what the old way gave, for every student on every piece', () => {
    seed();
    let found = 0;
    AIDS.concat([GONE]).forEach(aid =>
      IDS.forEach(sid => {
        const now = getStudentSubmission(CID, sid, aid);
        expect(now).toEqual(oldWay(sid, aid));
        if (now) found++;
      }),
    );
    expect(found).toBe(635 + 1);
    // The newest version, the pages in order, nothing of a deleted piece or an unfinished send.
    expect(getStudentSubmission(CID, IDS[29], AIDS[35]).id).toBe('s9001');
    expect(getStudentSubmission(CID, IDS[1], AIDS[0]).files.map(f => f.page)).toEqual([1, 2]);
    expect(getStudentSubmission(CID, IDS[0], GONE)).toBeNull();
    expect(getStudentSubmission(CID, IDS[28], AIDS[35])).toBeNull();
  });

  it('is a copy: changing what was given changes nothing stored', () => {
    seed();
    const got = getStudentSubmission(CID, IDS[1], AIDS[0]);
    got.note = 'changed';
    got.files.pop();
    const again = getStudentSubmission(CID, IDS[1], AIDS[0]);
    expect(again.note).toBeNull();
    expect(again.files).toHaveLength(2);
  });

  it('follows the stored work: new work shows and deleted work goes', () => {
    seed();
    expect(getStudentSubmission(CID, IDS[0], AIDS[0])).toBeNull();
    const work = getCourseSubmissions(CID);
    work.submissions.push(sub(9100, AIDS[0], IDS[0]));
    saveDemoStudentWork(CID, work);
    expect(getStudentSubmission(CID, IDS[0], AIDS[0]).id).toBe('s9100');
    work.submissions = work.submissions.filter(s => s.id !== 's9100');
    saveDemoStudentWork(CID, work);
    expect(getStudentSubmission(CID, IDS[0], AIDS[0])).toBeNull();
  });
});

describe('a draw makes no copy of the whole class’s work', { timeout: 120000 }, () => {
  it('counting the class’s work, the rows’ buttons, and Same Photo As', () => {
    seed();
    wholeClassCopies = 0;
    const counts = GraderWork.classWorkCounts(CID);
    expect(counts.tograde).toBe(636);
    AIDS.forEach(aid => IDS.forEach(sid => WorkWall.seeWorkHtml(CID, aid, sid)));
    IDS.forEach(sid => GraderWork.samePhotoAs(CID, AIDS[0], sid));
    IDS.forEach(sid => WorkWall.tabSummary(CID, sid));
    expect(wholeClassCopies).toBe(0);
  });

  it('the Dashboard draw counts the class once and asks workCounts only for the rows drawn', () => {
    seed();
    const ids = getStudents(CID).map(s => s.id);
    const calls = { workCounts: 0, classWorkCounts: 0 };
    const wc = GraderWork.workCounts;
    const cwc = GraderWork.classWorkCounts;
    GraderWork.workCounts = (...a) => (calls.workCounts++, wc.apply(GraderWork, a));
    GraderWork.classWorkCounts = (...a) => (calls.classWorkCounts++, cwc.apply(GraderWork, a));
    try {
      // The model alone: one count of the class, and one workCounts for each row drawn.
      wholeClassCopies = 0;
      const m = DashInboxModel.build(CID, { seen: null });
      expect(wholeClassCopies).toBe(1);
      expect(m.pieces.length).toBeGreaterThan(20);
      expect(m.rows).toHaveLength(4);
      expect(calls.classWorkCounts).toBe(1);
      expect(calls.workCounts).toBeLessThanOrEqual(m.rows.length + 2);
      expect(m.pieces.reduce((n, p) => n + p.tograde, 0)).toBe(cwc(CID, ids).tograde);

      // The whole panel: the top bar and the Inbox share the one count.
      calls.workCounts = calls.classWorkCounts = 0;
      localStorage.setItem('fv-build-dashRow', '1');
      const html = DashOverview.renderOverviewPanel({
        cid: CID,
        sections: [],
        allStudents: getStudents(CID),
        assessments: [],
        classAvg: 0,
        classR: 0,
        ccCounts: {},
        ccAssessments: {},
        ccObs: {},
        coreSelf: coreSelfRatings(CID, ids),
        coreView: 'self',
        compView: 'mix',
        obs: {},
        classChange: null,
        mixPop: null,
        helpRule: null,
        naComp: null,
      });
      expect(html).toContain('id="dash-inbox"');
      expect(html).toContain('dash-glance-tograde');
      expect(calls.classWorkCounts).toBe(1);
      expect(calls.workCounts).toBeLessThanOrEqual(4 + 2);
    } finally {
      GraderWork.workCounts = wc;
      GraderWork.classWorkCounts = cwc;
      localStorage.removeItem('fv-build-dashRow');
    }
  });

  it('the Dashboard draw with Side by Side counts the class once and no piece again', () => {
    seed();
    const ids = getStudents(CID).map(s => s.id);
    const calls = { workCounts: 0, classWorkCounts: 0, workInIds: 0 };
    const wc = GraderWork.workCounts;
    const cwc = GraderWork.classWorkCounts;
    const wi = GraderWork.workInIds;
    GraderWork.workCounts = (...a) => (calls.workCounts++, wc.apply(GraderWork, a));
    GraderWork.classWorkCounts = (...a) => (calls.classWorkCounts++, cwc.apply(GraderWork, a));
    GraderWork.workInIds = (...a) => (calls.workInIds++, wi.apply(GraderWork, a));
    try {
      localStorage.setItem('fv-build-dashRow', '1');
      localStorage.setItem('fv-dash-inbox-view:' + CID, 'side');
      const draw = () =>
        DashOverview.renderOverviewPanel({
          cid: CID,
          sections: [],
          allStudents: getStudents(CID),
          assessments: [],
          classAvg: 0,
          classR: 0,
          ccCounts: {},
          ccAssessments: {},
          ccObs: {},
          coreSelf: coreSelfRatings(CID, ids),
          coreView: 'self',
          compView: 'mix',
          obs: {},
          classChange: null,
          mixPop: null,
          helpRule: null,
          naComp: null,
        });
      // The tile's own By Assessment model is built in every view: that is the baseline.
      localStorage.setItem('fv-dash-inbox-view:' + CID, 'assessment');
      draw();
      const base = { ...calls };
      expect(base.classWorkCounts).toBe(1);
      calls.workCounts = calls.classWorkCounts = calls.workInIds = 0;
      localStorage.setItem('fv-dash-inbox-view:' + CID, 'side');
      const html = draw();
      expect(html).toContain('dash-inbox-side-row');
      expect(html).toContain('dash-inbox-pick-btn');
      // One count of the class, shared with the top bar; the switch counts no piece again.
      expect(calls.classWorkCounts).toBe(1);
      // Over the baseline only the chosen piece's own row asks: its counts, and who is in.
      expect(calls.workCounts).toBeLessThanOrEqual(base.workCounts + 1);
      expect(calls.workInIds).toBeLessThanOrEqual(base.workInIds + 1);
      // The next draw counts afresh (a new send shows), and no more than the first.
      const first = { ...calls };
      calls.workCounts = calls.classWorkCounts = calls.workInIds = 0;
      draw();
      expect(calls).toEqual(first);
    } finally {
      GraderWork.workCounts = wc;
      GraderWork.classWorkCounts = cwc;
      GraderWork.workInIds = wi;
      localStorage.removeItem('fv-build-dashRow');
      localStorage.removeItem('fv-dash-inbox-view:' + CID);
    }
  });

  it('the Dashboard draw with Flip Through counts the class once and no piece again', () => {
    seed();
    const ids = getStudents(CID).map(s => s.id);
    const calls = { workCounts: 0, classWorkCounts: 0, workInIds: 0 };
    const wc = GraderWork.workCounts;
    const cwc = GraderWork.classWorkCounts;
    const wi = GraderWork.workInIds;
    GraderWork.workCounts = (...a) => (calls.workCounts++, wc.apply(GraderWork, a));
    GraderWork.classWorkCounts = (...a) => (calls.classWorkCounts++, cwc.apply(GraderWork, a));
    GraderWork.workInIds = (...a) => (calls.workInIds++, wi.apply(GraderWork, a));
    try {
      localStorage.setItem('fv-build-dashRow', '1');
      localStorage.setItem('fv-dash-inbox-view:' + CID, 'flip');
      const draw = () =>
        DashOverview.renderOverviewPanel({
          cid: CID,
          sections: [],
          allStudents: getStudents(CID),
          assessments: [],
          classAvg: 0,
          classR: 0,
          ccCounts: {},
          ccAssessments: {},
          ccObs: {},
          coreSelf: coreSelfRatings(CID, ids),
          coreView: 'self',
          compView: 'mix',
          obs: {},
          classChange: null,
          mixPop: null,
          helpRule: null,
          naComp: null,
        });
      // The tile's own By Assessment model is built in every view: that is the baseline.
      localStorage.setItem('fv-dash-inbox-view:' + CID, 'assessment');
      draw();
      const base = { ...calls };
      expect(base.classWorkCounts).toBe(1);
      calls.workCounts = calls.classWorkCounts = calls.workInIds = 0;
      localStorage.setItem('fv-dash-inbox-view:' + CID, 'flip');
      const html = draw();
      expect(html).toContain('dash-inbox-flip-stage');
      expect(html).toContain('dash-inbox-pick-btn');
      // One count of the class, shared with the top bar; the switch counts no piece again.
      expect(calls.classWorkCounts).toBe(1);
      // Over the baseline only the chosen piece's own row asks: its counts, and who is in.
      expect(calls.workCounts).toBeLessThanOrEqual(base.workCounts + 1);
      expect(calls.workInIds).toBeLessThanOrEqual(base.workInIds + 1);
      // The next draw counts afresh (a new send shows), and no more than the first.
      const first = { ...calls };
      calls.workCounts = calls.classWorkCounts = calls.workInIds = 0;
      draw();
      expect(calls).toEqual(first);
    } finally {
      GraderWork.workCounts = wc;
      GraderWork.classWorkCounts = cwc;
      GraderWork.workInIds = wi;
      localStorage.removeItem('fv-build-dashRow');
      localStorage.removeItem('fv-dash-inbox-view:' + CID);
    }
  });

  it('the Assignments page: every card closed, one open, and one student', () => {
    openAssignments(seed, CID, {});
    closePages();
    openAssignments(seed, CID, { open: AIDS[0] });
    expect(document.querySelectorAll('.rsg-see-work').length).toBeGreaterThan(0);
    closePages();
    openAssignments(seed, CID, { student: IDS[1] });
    expect(wholeClassCopies).toBe(0);
  });
});
