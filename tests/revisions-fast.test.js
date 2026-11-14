/**
 * A student's revision request on a piece is found through the class's
 * requests sorted once, not sorted again for every cell.
 *
 * What was slow (docs/plans/speed-assessment.md, section 7's second sweep):
 * revisionStateOf and heldForRevision ask _revisionNewest for each cell of a
 * draw, and each ask built the roster, filtered every request of the class and
 * sorted them (_classRevisions). The requests are now sorted and grouped by
 * piece and student once for each list read (shared/data-revisions.js,
 * _revisionsByTime); the roster and the class's pieces are read at each ask.
 *
 * This file holds the old way beside the new for every student and piece, in
 * Demo Mode and signed in, and after each change that moves the answer.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const Q = U(41);
const IDS = Array.from({ length: 12 }, (_, i) => U(100 + i));
const AIDS = Array.from({ length: 10 }, (_, i) => U(300 + i));
const GONE_STUDENT = U(199);
const GONE_PIECE = U(399);
let wasDemo;
const saved = {};

function request(n, aid, sid, created) {
  return {
    id: 'rv' + n,
    assessment_id: aid,
    enrollment_id: sid,
    what_to_fix: 'Fix ' + n,
    revise_by: null,
    criterion_ids: [],
    keep_grade: true,
    hidden: false,
    first_submission_id: null,
    first_version: 1,
    first_grade: null,
    created_at: created,
    updated_at: created,
    cancelled_at: n % 5 === 0 ? created : null,
  };
}
// Several requests on some pieces, stored out of time order, some at the same instant,
// one on a student no longer in the class and one on a deleted piece, and an entry that is not a request.
function requests() {
  const out = {};
  let n = 0;
  AIDS.forEach((aid, a) =>
    IDS.forEach((sid, s) => {
      if ((a + s) % 3) return;
      const times = (a + s) % 2 ? 3 : 1;
      for (let t = times; t > 0; t--) {
        const r = request(n++, aid, sid, '2026-11-' + String(10 + ((n * 7) % 9)).padStart(2, '0') + 'T12:00:00Z');
        out[r.id] = r;
      }
    }),
  );
  out.rvGoneStudent = request(900, AIDS[0], GONE_STUDENT, '2026-11-01T00:00:00Z');
  out.rvGonePiece = request(901, GONE_PIECE, IDS[0], '2026-11-01T00:00:00Z');
  out.notOne = 'not a request';
  return out;
}
function writeRequests(list) {
  const draft = _studentFeedbackDraft(CID);
  draft.revisions = list;
  _studentFeedbackWrite(CID, draft);
}
function seed() {
  seedClass(CID, {
    students: IDS.map((id, i) => ({ id, firstName: 'F' + i, lastName: 'L' + i })),
    assessments: AIDS.map((id, i) => ({ id, title: 'Piece ' + i, tagIds: [Q], date: '2026-10-01' })),
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  saveDemoStudentWork(CID, { course: { send_work: true }, assessments: [], submissions: [] });
  writeRequests(requests());
}

// The old way, as shared/data-revisions.js had it.
function oldClassRevisions() {
  if (!revisionsOn(CID)) return [];
  const all = _revisionsOf(_studentFeedbackStored(CID));
  const students = {};
  (getStudents(CID) || []).forEach(s => {
    if (s && s.id) students[s.id] = true;
  });
  return (_isDemoSession() ? Object.keys(all).map(id => all[id]) : _fbRevisions(CID))
    .filter(r => _plainObject(r) && students[r.enrollment_id] && _assessmentById(CID, r.assessment_id))
    .sort((x, y) =>
      String(x.created_at) < String(y.created_at) ? -1 : String(x.created_at) > String(y.created_at) ? 1 : 0,
    );
}
function oldNewest(sid, aid) {
  const mine = oldClassRevisions().filter(r => r.enrollment_id === sid && r.assessment_id === aid);
  return mine[mine.length - 1] || null;
}
function same() {
  expect(_classRevisions(CID)).toEqual(oldClassRevisions());
  let found = 0;
  AIDS.concat([GONE_PIECE]).forEach(aid =>
    IDS.concat([GONE_STUDENT]).forEach(sid => {
      const now = _revisionNewest(CID, sid, aid);
      expect(now).toBe(oldNewest(sid, aid));
      if (now) found++;
    }),
  );
  return found;
}

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  seed();
});
afterEach(() => {
  Object.keys(saved).forEach(k => {
    globalThis[k] = saved[k];
    delete saved[k];
  });
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe("a student's revision request on a piece", () => {
  it('is what the old way gave, for every student and piece, asked again and again', () => {
    expect(same()).toBeGreaterThan(30);
    expect(same()).toBeGreaterThan(30);
    expect(_classRevisions(CID).length).toBeGreaterThan(50);
  });

  it('follows each change at once', () => {
    same();
    // A new request, a later one on the same piece and student.
    const list = requests();
    list.rvNew = request(950, AIDS[0], IDS[0], '2026-12-01T00:00:00Z');
    writeRequests(list);
    expect(same()).toBeGreaterThan(30);
    expect(_revisionNewest(CID, IDS[0], AIDS[0]).id).toBe('rv950');
    // A student taken off the roster in place, and a piece taken out of the class in place.
    getStudents(CID).splice(0, 1);
    same();
    expect(_revisionNewest(CID, IDS[0], AIDS[0])).toBeNull();
    getAssessments(CID).splice(3, 1);
    same();
    // The student back on the roster.
    getStudents(CID).push({ id: IDS[0], firstName: 'F0', lastName: 'L0' });
    same();
    expect(_revisionNewest(CID, IDS[0], AIDS[0]).id).toBe('rv950');
    // Send Work off: revisions are off and nothing is found.
    saveDemoStudentWork(CID, { course: { send_work: false }, assessments: [], submissions: [] });
    expect(same()).toBe(0);
  });

  it('signed in, from the server’s list', () => {
    const live = Object.values(requests()).map(r => (typeof r === 'object' ? Object.assign(r, { _live: true }) : r));
    let list = live;
    ['_isDemoSession', 'revisionsOn', '_fbRevisions'].forEach(k => (saved[k] = globalThis[k]));
    globalThis._isDemoSession = () => false;
    globalThis.revisionsOn = () => true;
    globalThis._fbRevisions = () => list;
    expect(same()).toBeGreaterThan(30);
    // The next turn's list, with one more.
    list = live.concat([Object.assign(request(960, AIDS[1], IDS[1], '2026-12-02T00:00:00Z'), { _live: true })]);
    same();
    expect(_revisionNewest(CID, IDS[1], AIDS[1]).id).toBe('rv960');
  });
});
