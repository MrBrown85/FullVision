/**
 * Mark Up, revisions, reflections and each piece's Send Work settings read
 * the class's work through the index without copying all of it.
 *
 * What was slow (docs/plans/speed-assessment.md, finding 5): these readers
 * copied every submission of the class (_studentWorkSubmissions) for each
 * ask, and they are asked per student row and per piece: with the student
 * page on, studentMarkupWaiting did it for each student of every open card,
 * and the grader's open copied the class's work three times. They now look
 * through the index shared/data-student-work.js keeps for each stored copy
 * of the work (_workIndexOf), and copy only what they give.
 *
 * This file holds the old way beside the new for every student, piece and
 * page, that a change to the stored work or marks shows at once, and that
 * the readers make no whole-class copy.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const Q = U(41);
const IDS = Array.from({ length: 30 }, (_, i) => U(100 + i));
const AIDS = Array.from({ length: 36 }, (_, i) => U(300 + i));
const GONE = U(399); // a piece that was deleted: its work is not given
let wasDemo;
let real;
let wholeClassCopies;

const file = (n, k) => ({ id: 'f' + n + '-' + k, page: k, path: 'p' + n + '-' + k + '.jpg', sha256: 'h' + n + k });
function sub(n, aid, sid, extra) {
  return Object.assign(
    {
      id: 's' + n,
      assessment_id: aid,
      enrollment_id: sid,
      version: 1,
      state: 'sent',
      sent_by: n % 3 ? 'student' : 'teacher',
      on_paper: false,
      is_late: false,
      note: null,
      followed_plan: n % 4 === 0 ? 'yes' : null,
      sent_at: '2026-11-' + String(1 + (n % 27)).padStart(2, '0') + 'T19:00:00Z',
      created_at: '2026-11-01T19:00:00Z',
      // Stored out of order on purpose: the readers give the pages in order.
      files: [file(n, 2), file(n, 1)],
    },
    extra || {},
  );
}

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
    assessments: AIDS.map((id, i) => ({ id, title: 'Piece ' + i, tagIds: [Q], date: '2026-10-01' })),
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return', reflect_on_feedback: true },
  });
  const subs = [];
  let n = 0;
  AIDS.forEach(aid =>
    IDS.forEach((sid, i) => {
      if (subs.length >= 635 || (i * 7 + n++) % 5 === 0) return;
      subs.push(sub(subs.length, aid, sid));
    }),
  );
  // Versions stored out of order; a send not finished; a deleted piece's work;
  // one page id in two submissions; no sent_at.
  subs.push(sub(9001, AIDS[35], IDS[29], { version: 2 }));
  subs.push(sub(9002, AIDS[35], IDS[29], { version: 1 }));
  subs.push(sub(9003, AIDS[35], IDS[28], { state: 'sending' }));
  subs.push(sub(9004, GONE, IDS[0]));
  subs.push(sub(9005, AIDS[3], IDS[0], { files: [file(7, 1), file(9005, 1)] }));
  subs.push(sub(9006, AIDS[4], IDS[0], { sent_at: null }));
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: AIDS.map((id, i) => ({
      id,
      students_send: i % 2 ? 'photos' : 'nothing',
      after_due: i % 3 ? 'stop' : 'until',
      accept_until: '2026-12-01',
      students_see_markup: i % 5 !== 0,
    })).concat([{ id: AIDS[2], students_send: 'photos' }]), // a second row for one piece: the first counts
    submissions: subs,
  });
  // Marks on every seventh page, given; a page of a deleted piece cannot be marked.
  const pages = {};
  subs.forEach((s, k) => {
    if (k % 7 === 0 && s.state === 'sent' && s.assessment_id !== GONE)
      pages[s.files[1].id] = { v: 1, marks: [{ type: 'note', text: 'Look here', x: 0.1, y: 0.2 }] };
  });
  expect(saveDemoMarkup(CID, pages)).toBe(true);
  // Reflections for a few students, on a few pieces.
  const list = [];
  IDS.slice(0, 8).forEach((sid, i) =>
    list.push({
      assessment_id: AIDS[i],
      enrollment_id: sid,
      sent_at: '2026-11-' + String(5 + i).padStart(2, '0') + 'T12:00:00.000Z',
      makes_sense: 'yes',
      question: null,
      plan: 'Plan ' + i,
      went_well: null,
    }),
  );
  expect(saveDemoReflections(CID, list)).toBe(true);
}

/* ── The old ways, as the files had them, over the whole-class copy ──
   (made once for each round of checks: every copy is the same) */
let snap = null;
const all = () => snap;
function oldMarkupPage(fileId) {
  if (!fileId) return null;
  const subs = all();
  for (const s of subs) for (const f of s.files || []) if (f && f.id === fileId) return { file: f, submission: s };
  return null;
}
function oldAssessmentMarkup(aid) {
  const kept = _markupKeptMap(CID);
  const out = [];
  all().forEach(s => {
    if (s.assessment_id !== aid) return;
    (s.files || []).forEach(f => {
      if (f && kept[f.id]) out.push(_markupRow(f.id, s.enrollment_id, kept[f.id]));
    });
  });
  return out;
}
function oldMarkupFiles(sid, aid) {
  if (!_assessmentById(CID, aid)) return null;
  if (getAssessmentStudentWork(CID, aid).students_see_markup === false) return [];
  const status = getAssignmentStatus(CID, sid, aid);
  if (status === 'NS' || status === 'EXC') return [];
  const kept = _markupKeptMap(CID);
  const out = [];
  all().forEach(s => {
    if (s.assessment_id !== aid || s.enrollment_id !== sid) return;
    (s.files || []).forEach(f => {
      const k = f && kept[f.id];
      if (k && k.given) out.push({ file_id: f.id, marks: _studentWorkCopy(k.given), given_at: k.given_at || null });
    });
  });
  return out;
}
const oldVersions = (sid, aid) =>
  all()
    .filter(s => s.enrollment_id === sid && s.assessment_id === aid)
    .sort((x, y) => (x.version || 1) - (y.version || 1));
const oldRevisionSubmission = id => all().find(s => s.id === id) || null;
function oldReflections(sid) {
  const subs = all().filter(s => s.enrollment_id === sid && s.sent_at);
  return _classReflections(CID)
    .filter(r => r.enrollment_id === sid)
    .reverse()
    .map(r => {
      const row = _reflectionRow(r);
      const after = subs
        .filter(s => s.assessment_id !== r.assessment_id && String(s.sent_at) > String(r.sent_at))
        .sort((x, y) => (String(x.sent_at) < String(y.sent_at) ? -1 : 1))[0];
      row.next = after ? { assessment_id: after.assessment_id, followed_plan: after.followed_plan || null } : null;
      return row;
    });
}
function oldSettings(aid) {
  const stored = _studentWorkStored(CID);
  const own = stored && (stored.assessments || []).find(a => a && a.id === aid);
  const out = Object.assign({ id: aid }, _STUDENT_WORK_DEFAULTS, own ? _studentWorkCopy(own) : {});
  out.id = aid;
  if (out.after_due !== 'until') out.accept_until = null;
  return out;
}

function sameEverywhere() {
  snap = real(CID);
  const pieces = AIDS.concat([GONE, U(398)]);
  const fileIds = new Set(['f-none', '']);
  snap.forEach(s => s.files.forEach(f => fileIds.add(f.id)));
  (_studentWorkStored(CID).submissions || []).forEach(s => (s.files || []).forEach(f => f && fileIds.add(f.id)));
  let pages = 0;
  fileIds.forEach(id => {
    const now = _markupPage(CID, id);
    expect(now).toEqual(oldMarkupPage(id));
    if (now) pages++;
  });
  let marked = 0;
  pieces.forEach(aid => {
    expect(getAssessmentStudentWork(CID, aid)).toEqual(oldSettings(aid));
    const rows = getAssessmentMarkup(CID, aid);
    expect(rows).toEqual(oldAssessmentMarkup(aid));
    marked += rows.length;
    IDS.forEach(sid => {
      expect(_studentMarkupFiles(CID, sid, aid)).toEqual(oldMarkupFiles(sid, aid));
      expect(getSubmissionVersions(CID, sid, aid)).toEqual(oldVersions(sid, aid));
    });
  });
  (_studentWorkStored(CID).submissions || []).forEach(s => {
    expect(_revisionSubmission(CID, { revision_submission_id: s.id })).toEqual(oldRevisionSubmission(s.id));
  });
  expect(_revisionSubmission(CID, { revision_submission_id: 'none' })).toBeNull();
  IDS.forEach(sid => expect(getStudentReflections(CID, sid)).toEqual(oldReflections(sid)));
  return { pages, marked };
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
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('the work readers', () => {
  it('give what the old way gave, for every student, piece and page', () => {
    seed();
    const { pages, marked } = sameEverywhere();
    expect(pages).toBeGreaterThan(1200);
    expect(marked).toBeGreaterThan(80);
    // The first submission holding a shared page; the first settings row of a piece.
    expect(_markupPage(CID, 'f7-1').submission.id).toBe('s7');
    expect(getAssessmentStudentWork(CID, AIDS[2]).students_send).toBe('nothing');
    expect(getSubmissionVersions(CID, IDS[29], AIDS[35]).map(s => s.id)).toEqual(['s9002', 's9001']);
    expect(getStudentReflections(CID, IDS[0])[0].next).not.toBeNull();
  });

  it('give copies: changing what was given changes nothing stored', () => {
    seed();
    const page = _markupPage(CID, 'f1-1');
    page.submission.note = 'changed';
    page.file.page = 99;
    expect(_markupPage(CID, 'f1-1').submission.note).toBeNull();
    expect(_markupPage(CID, 'f1-1').file.page).toBe(1);
    const v = getSubmissionVersions(CID, IDS[29], AIDS[35]);
    v[0].files.pop();
    expect(getSubmissionVersions(CID, IDS[29], AIDS[35])[0].files).toHaveLength(2);
    const set = getAssessmentStudentWork(CID, AIDS[1]);
    set.students_send = 'nothing';
    expect(getAssessmentStudentWork(CID, AIDS[1]).students_send).toBe('photos');
  });

  it('follow the stored work and marks at once', () => {
    seed();
    sameEverywhere();
    // New work, a page added to existing work, and work deleted.
    const work = getCourseSubmissions(CID);
    work.submissions.push(sub(9100, AIDS[0], IDS[0], { version: 3 }));
    work.submissions[1].files.push(file(9101, 3));
    work.submissions = work.submissions.filter(s => s.id !== 's2');
    work.assessments[1].students_see_markup = false;
    saveDemoStudentWork(CID, work);
    sameEverywhere();
    expect(_markupPage(CID, 'f9101-3')).not.toBeNull();
    expect(_markupPage(CID, 'f2-1')).toBeNull();
    // A page marked: it shows on the piece at once.
    const aid = work.submissions[1].assessment_id;
    const before = getAssessmentMarkup(CID, aid).length;
    expect(saveDemoMarkup(CID, { 'f9101-3': { v: 1, marks: [{ type: 'note', text: 'New', x: 0, y: 0 }] } })).toBe(true);
    expect(getAssessmentMarkup(CID, aid).length).toBe(before + 1);
    sameEverywhere();
    // A piece taken out of the class: its work goes from every reader.
    _cache.assessments[CID].splice(0, 1);
    sameEverywhere();
    expect(getSubmissionVersions(CID, IDS[1], AIDS[0])).toEqual([]);
  });

  it('with no marks in the class, Mark Up answers at once', () => {
    seed();
    localStorage.removeItem('gb-student-feedback-' + CID);
    expect(getAssessmentMarkup(CID, AIDS[0])).toEqual([]);
    expect(_studentMarkupFiles(CID, IDS[1], AIDS[1])).toEqual([]);
    expect(_studentMarkupFiles(CID, IDS[1], GONE)).toBeNull();
    sameEverywhere();
  });

  it('make no copy of the whole class’s work', () => {
    seed();
    wholeClassCopies = 0;
    AIDS.forEach(aid => {
      getAssessmentMarkup(CID, aid);
      IDS.forEach(sid => {
        studentMarkupWaiting(CID, sid, aid);
        _teacherMarksOnWork(CID, sid, aid, 's1');
        getStudentMarkCounts(CID, sid, aid);
        getSubmissionVersions(CID, sid, aid);
        getStudentRevision(CID, sid, aid);
      });
    });
    IDS.forEach(sid => {
      getStudentReflections(CID, sid);
      getStudentFeedback(CID, sid);
      getStudentWork(CID, sid);
    });
    getCourseFeedback(CID);
    expect(wholeClassCopies).toBe(0);
  });
});
