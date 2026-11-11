/**
 * Student work on the client (S5-F5): Demo Mode's sample work and the
 * read side every later screen uses (shared/data.js, "Student work";
 * shared/seed-data.js, seedDemoStudentWork).
 *
 * The answers have the server's shapes (batch-b-contract.md, commit
 * 5cbe3657): list_course_submissions for a class, work(...) for a student.
 * The sample pages are files in assets/sample-work, and every number the
 * sample gives about a page (bytes, sha256) is that file's own.
 */
import './setup.js';
import { createHash } from 'crypto';
import { readFileSync, readdirSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
const KMT = 'sci8a4';
let wasDemo;

function seedDemo() {
  window.isDemoMode = () => true;
  // The class from scratch: what a test changed is gone from memory too.
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
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
  seedDemo();
});

// Width and height from a baseline or progressive JPEG's frame header.
function jpegSize(buf) {
  let i = 2;
  while (i < buf.length) {
    if (buf[i] !== 0xff) return null;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  return null;
}

describe('the sample work, in the shape of list_course_submissions', () => {
  it('has the contract’s fields and nothing else', () => {
    const all = getCourseSubmissions(CID);
    expect(Object.keys(all).sort()).toEqual(['assessments', 'bucket', 'course', 'submissions', 'uploads']);
    expect(all.bucket).toBe('student-photos');
    expect(all.course).toEqual({ send_work: false, keep_photos_until: 'end_of_year' });
    expect(all.uploads).toEqual([]);
    expect(all.assessments).toHaveLength(getAssessments(CID).length);
    all.assessments.forEach(a =>
      expect(Object.keys(a).sort()).toEqual([
        'accept_until',
        'after_due',
        'group_work',
        'id',
        'students_see_markup',
        'students_send',
      ]),
    );
    expect(all.submissions).toHaveLength(10);
    all.submissions.forEach(s => {
      expect(Object.keys(s).sort()).toEqual([
        'assessment_id',
        'created_at',
        'enrollment_id',
        'files',
        'followed_plan',
        'id',
        'is_late',
        'note',
        'on_paper',
        'sent_at',
        'sent_by',
        'state',
        'version',
      ]);
      expect(s.state).toBe('sent');
      expect(s.version).toBe(1);
      expect(s.files.length).toBeLessThanOrEqual(STUDENT_WORK_MAX_PAGES);
      s.files.forEach((f, i) => {
        expect(Object.keys(f).sort()).toEqual([
          'bytes',
          'height',
          'id',
          'page',
          'path',
          'rotation',
          'sha256',
          'thumb_bytes',
          'thumb_path',
          'width',
        ]);
        expect(f.page).toBe(i + 1);
      });
    });
  });

  it('gives a believable spread on Cell Microscope Lab', () => {
    const on = sid => getStudentSubmission(CID, sid, LAB);
    // Sent on time, one page.
    expect(on('st1')).toMatchObject({ sent_by: 'student', is_late: false, on_paper: false });
    expect(on('st1').files).toHaveLength(1);
    // Two pages.
    expect(on('st2').files.map(f => f.page)).toEqual([1, 2]);
    // Sent late, with a note.
    expect(on('st3')).toMatchObject({ is_late: true, note: 'I was away Thursday.' });
    // Added by the teacher.
    expect(on('st5')).toMatchObject({ sent_by: 'teacher', on_paper: false });
    // Handed in on paper: no pages.
    expect(on('st6')).toMatchObject({ sent_by: 'teacher', on_paper: true, files: [] });
    // Sent late and two pages.
    expect(on('st8')).toMatchObject({ is_late: true });
    expect(on('st8').files).toHaveLength(2);
    // Not sent.
    expect(on('st11')).toBeNull();
    // A late send is after the lab's date; an on-time one is on it.
    const day = getAssessments(CID)
      .find(a => a.id === LAB)
      .date.slice(0, 10);
    expect(on('st1').sent_at.slice(0, 10)).toBe(day);
    expect(on('st3').sent_at.slice(0, 10) > day).toBe(true);
    expect(Date.parse(on('st1').created_at)).toBeLessThan(Date.parse(on('st1').sent_at));
  });

  it('sets what each piece takes: Cell Microscope Lab photos, KMT closed, the rest nothing', () => {
    expect(getAssessmentStudentWork(CID, LAB)).toEqual({
      id: LAB,
      students_send: 'photos',
      after_due: 'keep',
      accept_until: null,
      group_work: 'each',
      students_see_markup: true,
    });
    const kmt = getAssessmentStudentWork(CID, KMT);
    expect(kmt).toMatchObject({ students_send: 'photos_files', after_due: 'until' });
    expect(kmt.accept_until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(getAssessmentStudentWork(CID, 'sci8a2').students_send).toBe('nothing');
  });

  it('ships every page it names, a small JPEG whose bytes and hash are the ones given', () => {
    const named = new Set();
    getCourseSubmissions(CID).submissions.forEach(s =>
      s.files.forEach(f => {
        [
          [f.path, f.bytes],
          [f.thumb_path, f.thumb_bytes],
        ].forEach(([name, bytes]) => {
          const buf = readFileSync('assets/sample-work/' + name);
          expect(buf.length, name).toBe(bytes);
          expect(buf[0] === 0xff && buf[1] === 0xd8, name + ' is a JPEG').toBe(true);
          expect(buf.length, name + ' is small').toBeLessThan(120000);
          named.add(name);
        });
        const page = readFileSync('assets/sample-work/' + f.path);
        expect(createHash('sha256').update(page).digest('hex')).toBe(f.sha256);
        expect(jpegSize(page)).toEqual({ width: f.width, height: f.height });
        expect(f.thumb_path).toBe(f.path.replace(/\.jpg$/, '-thumb.jpg'));
      }),
    );
    // Nothing in the folder that the sample does not use.
    expect(readdirSync('assets/sample-work').sort()).toEqual([...named].sort());
  });

  it('answers copies: changing an answer changes nothing stored', () => {
    const one = getStudentSubmission(CID, 'st1', LAB);
    one.files.push({ id: 'x' });
    one.note = 'changed';
    getCourseSubmissions(CID).submissions[0].files.length = 0;
    expect(getStudentSubmission(CID, 'st1', LAB).files).toHaveLength(1);
    expect(getStudentSubmission(CID, 'st1', LAB).note).toBeNull();
  });

  it('drops the work of an assessment that no longer exists, as the server does', () => {
    saveAssessments(
      CID,
      getAssessments(CID).filter(a => a.id !== LAB),
    );
    expect(getCourseSubmissions(CID).submissions).toEqual([]);
    expect(getStudentSubmission(CID, 'st1', LAB)).toBeNull();
  });
});

// Send Work on for the sample class, as a teacher would turn it on.
function sendWorkOn() {
  const stored = JSON.parse(localStorage.getItem('gb-student-work-sci8'));
  stored.course.send_work = true;
  expect(saveDemoStudentWork(CID, stored)).toBe(true);
}

describe('the student page’s work(...)', () => {
  it('with Send Work off, as it starts: the work sent shows, nothing is open and nothing can change', () => {
    const w = getStudentWork(CID, 'st1');
    expect(w.send_work).toBe(false);
    expect(w.assessments.map(a => a.id)).toEqual([LAB, KMT]);
    expect(w.assessments[0]).toMatchObject({ open: false, sent: { pages: 1, can_change: false } });
    expect(getStudentWork(CID, 'st11').assessments[0]).toMatchObject({ open: false, sent: null });
  });

  it('lists what takes work or has work in, with the window and what was sent', () => {
    sendWorkOn();
    const w = getStudentWork(CID, 'st1');
    expect(Object.keys(w).sort()).toEqual(['assessments', 'ok', 'send_work', 'v']);
    expect(w).toMatchObject({ ok: true, v: 1, send_work: true });
    expect(w.assessments.map(a => a.id)).toEqual([LAB, KMT]);
    const lab = w.assessments[0];
    expect(Object.keys(lab).sort()).toEqual([
      'closes_on',
      'id',
      'late_now',
      'open',
      'sending',
      'sent',
      'students_send',
    ]);
    expect(lab).toMatchObject({ students_send: 'photos', open: true, closes_on: null, late_now: false, sending: null });
    // Cece's lab is graded, so she cannot Unsend or Replace it.
    expect(lab.sent).toMatchObject({ sent_by: 'student', pages: 1, grading: true, can_change: false });
    expect(Object.keys(lab.sent).sort()).toEqual([
      'can_change',
      'grading',
      'is_late',
      'note',
      'on_paper',
      'pages',
      'sent_at',
      'sent_by',
      'submission_id',
    ]);
    const kmt = w.assessments[1];
    expect(kmt).toMatchObject({ students_send: 'photos_files', open: false, sent: null });
    expect(kmt.closes_on).toBe(getAssessmentStudentWork(CID, KMT).accept_until);
  });

  it('shows nothing sent for a student who sent nothing, and the lab still open to them', () => {
    sendWorkOn();
    const lab = getStudentWork(CID, 'st11').assessments.find(a => a.id === LAB);
    expect(lab).toMatchObject({ open: true, sent: null });
  });

  it('lets a student change their own send only before grading starts', () => {
    sendWorkOn();
    // Take Cece's grade away: her lab is sent and not being graded.
    saveScores(
      CID,
      Object.assign({}, getScores(CID), { st1: (getScores(CID).st1 || []).filter(e => e.assessmentId !== LAB) }),
    );
    const checks = Object.assign({}, getRubricChecks(CID));
    delete checks['st1:' + LAB];
    saveRubricChecks(CID, checks);
    const sent = () => getStudentWork(CID, 'st1').assessments.find(a => a.id === LAB).sent;
    expect(sent()).toMatchObject({ grading: false, can_change: true });
    // Work the teacher added is never the student's to change.
    saveScores(
      CID,
      Object.assign({}, getScores(CID), { st5: (getScores(CID).st5 || []).filter(e => e.assessmentId !== LAB) }),
    );
    const mateo = getStudentWork(CID, 'st5').assessments.find(a => a.id === LAB).sent;
    expect(mateo.can_change).toBe(false);
  });
});

describe('started grading (Colin’s rule)', () => {
  function ungraded(sid) {
    saveScores(
      CID,
      Object.assign({}, getScores(CID), { [sid]: (getScores(CID)[sid] || []).filter(e => e.assessmentId !== LAB) }),
    );
    const checks = Object.assign({}, getRubricChecks(CID));
    delete checks[sid + ':' + LAB];
    saveRubricChecks(CID, checks);
  }

  it('is a level, a tick, an Overall Comment or a draft; a Late mark alone is not', () => {
    ungraded('st11');
    expect(studentWorkGradingStarted(CID, 'st11', LAB)).toBe(false);
    setAssignmentStatus(CID, 'st11', LAB, 'LATE');
    expect(studentWorkGradingStarted(CID, 'st11', LAB)).toBe(false);
    saveScoreComment(CID, 'st11', LAB, 'Good labels.');
    expect(studentWorkGradingStarted(CID, 'st11', LAB)).toBe(true);

    ungraded('st12');
    saveRubricChecks(CID, Object.assign({}, getRubricChecks(CID), { ['st12:' + LAB]: ['any-check'] }));
    expect(studentWorkGradingStarted(CID, 'st12', LAB)).toBe(true);

    ungraded('st13');
    const spy = vi.spyOn(globalThis, 'getGradeReturn').mockReturnValue({ is_draft: true });
    try {
      expect(studentWorkGradingStarted(CID, 'st13', LAB)).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect(studentWorkGradingStarted(CID, 'st13', LAB)).toBe(false);
  });
});

describe('showing a page', () => {
  it('gives the sample page’s address for a page and for its thumbnail', async () => {
    const f = getStudentSubmission(CID, 'st2', LAB).files[1];
    expect(await studentWorkPageUrl(CID, f, 'page')).toBe('/assets/sample-work/cell-lab-noor-2.jpg');
    expect(await studentWorkPageUrl(CID, f, 'thumb')).toBe('/assets/sample-work/cell-lab-noor-2-thumb.jpg');
  });

  it('gives no address for a name that is not a sample page', async () => {
    for (const path of ['../../login.html', 'a/b.jpg', 'https://example.com/x.jpg', 'x.png', '']) {
      expect(await studentWorkPageUrl(CID, { path, thumb_path: path }, 'page'), path).toBeNull();
    }
  });
});

describe('outside Demo Mode, and the store’s limits', () => {
  it('gives a signed-in class the empty answers and stores nothing for it', async () => {
    window.isDemoMode = () => false;
    expect(getCourseSendWork(CID)).toEqual({ send_work: false, keep_photos_until: 'end_of_year' });
    expect(getCourseSubmissions(CID).submissions).toEqual([]);
    expect(getAssessmentStudentWork(CID, LAB).students_send).toBe('nothing');
    expect(getStudentWork(CID, 'st1')).toEqual({ ok: true, v: 1, send_work: false, assessments: [] });
    expect(getStudentSubmission(CID, 'st1', LAB)).toBeNull();
    expect(await studentWorkPageUrl(CID, { path: 'cell-lab-cece-1.jpg' }, 'page')).toBeNull();
    expect(saveDemoStudentWork('other', { course: { send_work: true } })).toBe(false);
    expect(localStorage.getItem('gb-student-work-other')).toBeNull();
  });

  it('refuses a submission of more than 30 pages', () => {
    const files = Array.from({ length: 31 }, (_, i) => ({ id: 'f' + i, page: i + 1 }));
    expect(saveDemoStudentWork(CID, { submissions: [{ id: 's', state: 'sent', files }] })).toBe(false);
    expect(getCourseSubmissions(CID).submissions).toHaveLength(10);
    expect(saveDemoStudentWork(CID, { submissions: [{ id: 's', state: 'sent', files: files.slice(0, 30) }] })).toBe(
      true,
    );
  });

  it('is seeded once: Demo Mode opening again keeps what is stored', () => {
    saveDemoStudentWork(CID, { course: { send_work: false }, submissions: [] });
    seedIfNeeded();
    expect(getCourseSendWork(CID).send_work).toBe(false);
    expect(getCourseSubmissions(CID).submissions).toEqual([]);
  });

  it('comes to a class seeded before it existed', () => {
    localStorage.removeItem('gb-student-work-sci8');
    expect(getCourseSubmissions(CID).submissions).toEqual([]);
    seedIfNeeded();
    expect(getCourseSubmissions(CID).submissions).toHaveLength(10);
  });

  it('goes with the class when the class is deleted', async () => {
    await deleteCourseData(CID);
    expect(localStorage.getItem('gb-student-work-sci8')).toBeNull();
    expect(getCourseSubmissions(CID).submissions).toEqual([]);
  });
});
