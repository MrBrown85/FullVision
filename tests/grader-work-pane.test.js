/**
 * The grader dialog's work pane (S6-F1 to F3, Demo Mode): the pages beside
 * the scoring, Whole Page and Fit Width, the student's note, Focus on
 * Work's short level names, Add Work and Grade From Paper for a student
 * with nothing in, "Same photo as", and Delete Work with Colin's approved
 * confirm (ruling 102, item 9 of the photo-warning wording).
 *
 * With Send Work off the dialog is as it was: no pane. Every answer that
 * comes back later (a page's picture, a shrunk file, a confirm's Yes) is
 * dropped when the dialog has moved to another student.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, seedClass, clearClass, openGrader, closePages, settle, fire } from './helpers/pin-save-paths.js';

const CID = U(1);
const PIECE = U(31);
const Q = U(41);
const P = U(42);
const ANA = U(101); // two pages and a note; she/her
const BO = U(102); // one page, the same photo as Cy's
const CY = U(103); // one page; and a page the teacher added
const DEE = U(104); // nothing in
const EVA = U(105); // nothing in
let wasDemo;
let realOpen;

function file(id, n, hash, by) {
  return { id, page: n, path: 'lab-p' + n + '.jpg', thumb_path: 'lab-p' + n + '-t.jpg', sha256: hash, added_by: by };
}
function sub(sid, files, extra) {
  return Object.assign(
    {
      id: 'w-' + sid.slice(-3),
      assessment_id: PIECE,
      enrollment_id: sid,
      version: 1,
      state: 'sent',
      sent_by: 'student',
      on_paper: false,
      is_late: false,
      note: null,
      sent_at: '2026-10-30T20:41:00Z',
      created_at: '2026-10-30T20:41:00Z',
      files,
    },
    extra || {},
  );
}

function seed({ sendWork = true } = {}) {
  seedClass(CID, {
    students: [
      { id: ANA, firstName: 'Ana', lastName: 'Avila', pronouns: 'she/her' },
      { id: BO, firstName: 'Bo', lastName: 'Bell' },
      { id: CY, firstName: 'Cy', lastName: 'Cole' },
      { id: DEE, firstName: 'Dee', lastName: 'Dunn' },
      { id: EVA, firstName: 'Eva', lastName: 'Ernst' },
    ],
    learningMaps: {
      subjects: [],
      sections: [
        { id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] },
        { id: U(52), name: 'Plan', tags: [{ id: P, label: 'Plan', text: 'Plan a test' }] },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [{ id: PIECE, title: 'Conscription', tagIds: [Q, P], date: '2026-10-20', dueDate: '2026-10-30' }],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [{ id: PIECE, students_send: 'photos' }],
    submissions: [
      sub(ANA, [file('a1', 1, 'ha1'), file('a2', 2, 'ha2')], { note: 'I spent the most time on the letter.' }),
      sub(BO, [file('b1', 1, 'same')]),
      sub(CY, [file('c1', 1, 'same'), file('c2', 2, 'hc2', 'teacher')]),
    ],
  });
}

const $ = (o, sel) => o.querySelector(sel);
const text = el => el.textContent.replace(/\s+/g, ' ').trim();

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  realOpen = globalThis.openStudentWorkPage;
  localStorage.clear();
});
afterEach(() => {
  globalThis.openStudentWorkPage = realOpen;
  document.querySelectorAll('.confirm-overlay').forEach(el => el.remove());
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  vi.restoreAllMocks();
});

describe('Send Work off: the dialog is as it was', () => {
  it('no work pane, no work line', () => {
    const overlay = openGrader(() => seed({ sendWork: false }), CID, PIECE, ANA);
    expect($(overlay, '.grader-dialog').classList.contains('has-work')).toBe(false);
    expect($(overlay, '.grader-work')).toBeNull();
    expect($(overlay, '.grader-work-line')).toBeNull();
  });
});

describe('the pages beside the scoring', () => {
  it('the line, the pager, the note and the picture', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    expect($(overlay, '.grader-dialog').classList.contains('has-work')).toBe(true);
    expect(text($(overlay, '.grader-work-what'))).toMatch(/^Submitted Oct 30, \d{1,2}:\d\d (am|pm) · 2 photos$/);
    // The scoring sits in its own column, beside the pane.
    expect($(overlay, '.grader-panel-col .grader-body')).not.toBeNull();
    expect(text($(overlay, '.grader-work-at'))).toBe('1 of 2');
    expect($(overlay, '[data-grader="work-page"][data-dir="-1"]').disabled).toBe(true);
    expect(text($(overlay, '.grader-work-note-title'))).toBe('Ana’s Note, Sent With the Work');
    expect(text($(overlay, '.grader-work-note p'))).toBe('I spent the most time on the letter.');
    expect($(overlay, '.grader-work-img').getAttribute('alt')).toBe('Page 1 of Conscription');
    await settle();
    expect($(overlay, '.grader-work-img').getAttribute('src')).toBe('/assets/sample-work/lab-p1.jpg');
    $(overlay, '[data-grader="work-page"][data-dir="1"]').click();
    expect(text($(overlay, '.grader-work-at'))).toBe('2 of 2');
    await settle();
    expect($(overlay, '.grader-work-img').getAttribute('src')).toBe('/assets/sample-work/lab-p2.jpg');
  });

  it('Whole Page, Fit Width and Rotate change the view only', () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    const before = JSON.stringify(getCourseSubmissions(CID));
    expect($(overlay, '.grader-work-page').classList.contains('fit-page')).toBe(true);
    $(overlay, '[data-grader="work-fit"][data-fit="width"]').click();
    expect($(overlay, '.grader-work-page').classList.contains('fit-width')).toBe(true);
    $(overlay, '[data-grader="work-rotate"]').click();
    expect($(overlay, '.grader-work-page').classList.contains('turn-90')).toBe(true);
    expect(JSON.stringify(getCourseSubmissions(CID))).toBe(before);
  });

  it('a picture that comes back after the dialog moved on is let go, not shown', async () => {
    let answer;
    const release = vi.fn();
    globalThis.openStudentWorkPage = () => new Promise(r => (answer = r));
    const overlay = openGrader(seed, CID, PIECE, ANA);
    const first = answer;
    $(overlay, '[data-grader="next"]').click();
    first({ url: 'blob:ana', release });
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
    expect($(overlay, '.grader-work-img').getAttribute('src')).not.toBe('blob:ana');
  });

  it('the picture on screen is let go when the dialog closes', async () => {
    const release = vi.fn();
    globalThis.openStudentWorkPage = () => Promise.resolve({ url: 'blob:x', release });
    openGrader(seed, CID, PIECE, ANA);
    await settle();
    window.PageAssignments.closeGrader();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('Same photo as names the other student, and opens them', () => {
    const overlay = openGrader(seed, CID, PIECE, BO);
    const same = $(overlay, '.grader-work-same');
    expect(text(same)).toBe('Same photo as Cy C.');
    same.click();
    expect(text($(overlay, '.grader-student'))).toBe('Cy Cole');
    expect(text($(overlay, '.grader-work-same'))).toBe('Same photo as Bo B.');
    expect(text($(overlay, '.grader-work-what'))).toMatch(/· 2 photos$/);
  });

  it('the strip lists the students whose work waits', () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    const who = Array.from(overlay.querySelectorAll('.grader-work-who')).map(b => b.getAttribute('aria-label'));
    expect(who).toEqual(['Ana Avila', 'Bo Bell', 'Cy Cole']);
  });
});

describe('Focus on Work', () => {
  it('narrows the scoring to short level names that keep their whole names', () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    $(overlay, '[data-grader="work-focus"]').click();
    const dialog = $(overlay, '.grader-dialog');
    expect(dialog.classList.contains('is-focus')).toBe(true);
    expect($(overlay, '[data-grader="work-focus"]').getAttribute('aria-pressed')).toBe('true');
    expect($(overlay, '.grader-work-page').classList.contains('fit-width')).toBe(true);
    const prf = Array.from(overlay.querySelectorAll('.grader-panel-col button')).find(
      b => b.getAttribute('aria-label') === 'Proficient',
    );
    expect(prf).toBeTruthy();
    expect(text($(prf, '.lvl-short'))).toBe('PRF');
    // A level picked in Focus scores as it did.
    prf.click();
    expect(GraderWork.workStateOf(CID, PIECE, ANA)).toBe('toreturn');
    // Off again: the whole names.
    $(overlay, '[data-grader="work-focus"]').click();
    expect(dialog.classList.contains('is-focus')).toBe(false);
  });
});

describe('Nothing in: Add Work and Grade From Paper', () => {
  it('says what is owed and offers Choose Files and Set Dee To', () => {
    const overlay = openGrader(seed, CID, PIECE, DEE);
    const days = Math.round((Date.parse(courseToday(CID)) - Date.parse('2026-10-30')) / 86400000);
    expect(text($(overlay, '.grader-work-what'))).toBe(
      days > 0 ? 'Not In · ' + days + (days === 1 ? ' day late' : ' days late') : 'Not In · Due Oct 30',
    );
    const pane = $(overlay, '.grader-addwork');
    expect(Array.from(pane.querySelectorAll('h3')).map(text)).toEqual(['Add Work for Dee', 'Grade From Paper']);
    expect(text($(pane, '.grader-addwork-hint'))).toBe('Photos or PDFs. Photos are made smaller before they upload.');
    expect(text($(pane, '.grader-addwork-choose'))).toBe('Choose Files');
    expect(text($(pane, '.grader-setto-btn'))).toBe('Set Dee To');
  });

  it('Set Dee To sets every competency and records the work as on paper', async () => {
    const overlay = openGrader(seed, CID, PIECE, DEE);
    $(overlay, '[data-grader="work-setto-menu"]').click();
    expect($(overlay, '.grader-setto-menu').hasAttribute('hidden')).toBe(false);
    $(overlay, '.grader-setto-menu [data-action="graderSetTo"][data-score="3"]').click();
    const levels = (getScores(CID)[DEE] || []).filter(e => e.assessmentId === PIECE).map(e => [e.tagId, e.score]);
    expect(levels.sort()).toEqual(
      [
        [Q, 3],
        [P, 3],
      ].sort(),
    );
    await settle();
    expect(getStudentSubmission(CID, DEE, PIECE).on_paper).toBe(true);
    expect(text($(overlay, '.grader-work-what'))).toBe('Handed in on paper');
    expect(GraderWork.workStateOf(CID, PIECE, DEE)).toBe('toreturn');
  });

  it('setToFromPaper leaves a level already given, and sets nothing under Missing', async () => {
    seed();
    Grader.setLevel(CID, DEE, PIECE, Q, 1, 0);
    expect(GraderWork.setToFromPaper(CID, PIECE, DEE, 4).set).toBe(1);
    const got = Object.fromEntries(
      (getScores(CID)[DEE] || []).filter(e => e.assessmentId === PIECE).map(e => [e.tagId, e.score]),
    );
    expect(got).toEqual({ [Q]: 1, [P]: 4 });
    Grader.setStatus(CID, EVA, PIECE, 'NS');
    const out = GraderWork.setToFromPaper(CID, PIECE, EVA, 3);
    expect(out.set).toBe(0);
    expect((await out.paper).marked).toBe(0);
  });

  it('Choose Files shrinks each file and adds the pages as the teacher’s', async () => {
    const pages = [{ blob: new Blob(['x']), thumb: new Blob(['t']), hash: 'h' }];
    vi.spyOn(PhotoShrink, 'prepare').mockResolvedValue({ ok: true, kind: 'jpeg', pages });
    const added = vi.fn().mockResolvedValue({ result: 'sent' });
    const real = globalThis.addStudentWorkPages;
    globalThis.addStudentWorkPages = added;
    try {
      const overlay = openGrader(seed, CID, PIECE, DEE);
      const input = $(overlay, '.grader-work-files');
      Object.defineProperty(input, 'files', { value: [new Blob(['a']), new Blob(['b'])], configurable: true });
      fire(input, 'change');
      expect(text($(overlay, '.grader-addwork-choose'))).toBe('Adding…');
      await settle();
      expect(PhotoShrink.prepare).toHaveBeenCalledTimes(2);
      expect(added).toHaveBeenCalledWith(CID, DEE, PIECE, pages.concat(pages), { mode: 'new' });
    } finally {
      globalThis.addStudentWorkPages = real;
    }
  });

  it('a Word file is refused with the plan’s line; a PDF says it can’t be added yet', async () => {
    const overlay = openGrader(seed, CID, PIECE, DEE);
    const input = () => $(overlay, '.grader-work-files');
    const choose = async answer => {
      PhotoShrink.prepare.mockResolvedValueOnce(answer);
      Object.defineProperty(input(), 'files', { value: [new Blob(['a'])], configurable: true });
      fire(input(), 'change');
      await settle();
      return text($(overlay, '.grader-addwork-msg'));
    };
    vi.spyOn(PhotoShrink, 'prepare');
    expect(await choose({ ok: false, reason: 'office', office: 'word' })).toBe('Save it as a PDF first.');
    expect(await choose({ ok: false, reason: 'no_decoder', kind: 'pdf' })).toBe(
      'PDFs can’t be added here yet. Add a photo of each page.'.replace('’', "'"),
    );
  });

  it('a file’s answer that comes back after the dialog moved on says nothing on the next student', async () => {
    let answer;
    vi.spyOn(PhotoShrink, 'prepare').mockImplementation(() => new Promise(r => (answer = r)));
    const overlay = openGrader(seed, CID, PIECE, DEE);
    const input = $(overlay, '.grader-work-files');
    Object.defineProperty(input, 'files', { value: [new Blob(['a'])], configurable: true });
    fire(input, 'change');
    await settle();
    $(overlay, '[data-grader="next"]').click();
    expect(text($(overlay, '.grader-student'))).toBe('Eva Ernst');
    answer({ ok: false, reason: 'office' });
    await settle();
    expect(text($(overlay, '.grader-addwork-msg'))).toBe('');
  });
});

describe('Delete Work (ruling 102, item 9)', () => {
  const ask = overlay => {
    $(overlay, '[data-grader="work-delete"]').click();
    const c = document.querySelector('.confirm-overlay');
    return {
      title: text(c.querySelector('.confirm-title')),
      message: text(c.querySelector('.confirm-message')),
      ok: document.getElementById('confirm-ok-btn'),
      cancel: document.getElementById('confirm-cancel-btn'),
    };
  };

  it('asks in the approved words, and deletes only on Delete Work', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    Grader.setLevel(CID, ANA, PIECE, Q, 3, 0);
    const c = ask(overlay);
    expect(c.title).toBe('Delete Ana’s Work?');
    expect(c.message).toBe(
      'Ana’s 2 photos for Conscription are deleted, and she can send it again. Her grade and your comments stay. Deleted photos can’t come back.',
    );
    expect(c.ok.textContent).toBe('Delete Work');
    expect(c.ok.className).toContain('danger');
    c.cancel.onclick();
    expect(getStudentSubmission(CID, ANA, PIECE)).not.toBeNull();
    ask(overlay).ok.onclick();
    await settle();
    expect(getStudentSubmission(CID, ANA, PIECE)).toBeNull();
    // The grade stays.
    expect((getScores(CID)[ANA] || []).some(e => e.assessmentId === PIECE && e.tagId === Q && e.score === 3)).toBe(
      true,
    );
    expect($(overlay, '.grader-addwork')).not.toBeNull();
  });

  it('names the page the teacher added', () => {
    const overlay = openGrader(seed, CID, PIECE, CY);
    expect(ask(overlay).message).toBe(
      'Cy’s 1 photo and the page you added for Conscription are deleted, and Cy can send it again. Cy’s grade and your comments stay. Deleted photos can’t come back.',
    );
  });

  it('a Yes that comes after the dialog moved to another student deletes nothing', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    const c = ask(overlay);
    $(overlay, '[data-grader="next"]').click();
    c.ok.onclick();
    await settle();
    expect(getStudentSubmission(CID, ANA, PIECE)).not.toBeNull();
    expect(getStudentSubmission(CID, BO, PIECE)).not.toBeNull();
  });

  it('deleteStudentWork does nothing signed in', async () => {
    seed();
    window.isDemoMode = () => false;
    expect(await deleteStudentWork(CID, ANA, PIECE)).toEqual({ result: 'not_available' });
  });
});

describe('Focus on Work on each way of scoring', () => {
  const QUIZ = U(32);
  const EXIT = U(33);
  function seedMore() {
    seed();
    saveAssessments(
      CID,
      getAssessments(CID).concat([
        { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [Q], date: '2026-10-21' },
        { id: EXIT, title: 'Exit Ticket', scoreMode: 'complete', maxPoints: 1, tagIds: [Q], date: '2026-10-22' },
      ]),
    );
    const work = getCourseSubmissions(CID);
    work.assessments.forEach(a => {
      if (a.id === QUIZ || a.id === EXIT) a.students_send = 'photos';
    });
    work.submissions.push(sub(ANA, [file('q1', 1, 'hq1')], { id: 'wq', assessment_id: QUIZ }));
    work.submissions.push(sub(ANA, [file('e1', 1, 'he1')], { id: 'we', assessment_id: EXIT }));
    saveDemoStudentWork(CID, work);
  }

  it('points: the score box sits in the narrow column beside the page', () => {
    const overlay = openGrader(seedMore, CID, QUIZ, ANA);
    $(overlay, '[data-grader="work-focus"]').click();
    expect($(overlay, '.grader-dialog').classList.contains('is-focus')).toBe(true);
    expect($(overlay, '.grader-panel-col .grdp-input')).not.toBeNull();
    expect($(overlay, '.grader-work-img')).not.toBeNull();
  });

  it('Complete or Incomplete: the two marks sit in the narrow column', () => {
    const overlay = openGrader(seedMore, CID, EXIT, ANA);
    $(overlay, '[data-grader="work-focus"]').click();
    const col = text($(overlay, '.grader-panel-col'));
    expect(col).toMatch(/Complete/);
    expect(col).toMatch(/Incomplete/);
  });
});
