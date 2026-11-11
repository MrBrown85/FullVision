/**
 * Revisions on the teacher's desktop (S11-F1, S11-F3; the boards "Teacher:
 * Return for Revision" and "Teacher: Grading a Revision, Both Versions"),
 * and what the one grader makes of them (shared/grader.js).
 *
 * 1. The counts: a revision sent in is To Grade again, one being graded is
 *    To Return, one asked for and not in is neither (it went back: Returned).
 * 2. Return N Graded and Return leave out work out for revision until the
 *    revision is graded. The grade is always kept: Hide is not offered
 *    (Colin, Nov 11: "Take hide out and we'll work on it later.").
 * 3. The grader: Return for Revision and its sheet, the Revising row and
 *    Take Back, the revision's work line, New and First, the Revision card,
 *    "Was Developing + on the Oct 30 version", and Before and After with
 *    the board's worked example, 2.7 · 67% before and 3.0 · 75% after.
 * 4. Off (Send Work off, or signed in): nothing new shows and nothing new
 *    is written.
 *
 * Demo Mode's data layer does the work (shared/data.js, "Revisions"); these
 * tests go through it, never a stand-in.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, seedClass, clearClass, openGrader, closePages } from './helpers/pin-save-paths.js';
import { parseHTML } from 'linkedom';
import { click, key, mount, unmount } from './helpers/gradebook-dom.js';

const CID = U(1);
const PIECE = U(31); // 2.6 The Conscription Crisis
const SUPPORT = U(41); // Support and Opposition
const LETTER = U(42); // Letter to the Editor
const JORDAN = U(100);
const HANNAH = U(101);
const FIX = 'Add a third reason from Bourassa to the letter.';
const NOTE = 'I added how conscription split families in Quebec as the third reason.';
const PAGES = [{ path: 'revised-letter-1.jpg', thumb_path: 'revised-letter-1-thumb.jpg' }];
let wasDemo;
let n = 0;
const k = () => 'key-' + ++n;

function seed({ holds = true, sendWork = true } = {}) {
  seedClass(CID, {
    students: [
      { id: JORDAN, firstName: 'Jordan', lastName: 'Reyes' },
      { id: HANNAH, firstName: 'Hannah', lastName: 'Berg' },
    ],
    learningMaps: {
      subjects: [],
      sections: [
        {
          id: U(51),
          name: 'Conscription',
          tags: [
            { id: SUPPORT, label: 'Support and Opposition', text: 'Explain who supported and opposed it' },
            { id: LETTER, label: 'Letter to the Editor', text: 'Argue a position with reasons' },
          ],
        },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      {
        id: PIECE,
        title: '2.6 The Conscription Crisis',
        tagIds: [SUPPORT, LETTER],
        date: '2026-10-20',
        dueDate: '2026-10-30',
      },
    ],
    courseConfigs: holds ? { student_page_enabled: true, return_grades: 'on_return' } : { student_page_enabled: true },
  });
  COURSES[CID].gradingSystem = 'both';
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [{ id: PIECE, students_send: 'photos' }],
    submissions: [
      {
        id: 'sub-jordan-v1',
        assessment_id: PIECE,
        enrollment_id: JORDAN,
        version: 1,
        state: 'sent',
        sent_by: 'student',
        on_paper: false,
        is_late: false,
        note: 'I wasn’t sure if my headline counted as a reason.',
        sent_at: '2026-10-30T18:00:00.000Z',
        created_at: '2026-10-30T17:58:00.000Z',
        files: [{ id: 'f1', page: 1, path: 'letter-1.jpg', thumb_path: 'letter-1-thumb.jpg' }],
      },
    ],
  });
}

const at = iso => vi.setSystemTime(new Date(iso));
// Jordan's first version, graded and returned: Developing + and Proficient, 2.7 · 67%.
function gradeFirstVersion() {
  at('2026-11-01T18:00:00.000Z');
  Grader.setLevel(CID, JORDAN, PIECE, SUPPORT, 3, 0);
  Grader.setLevel(CID, JORDAN, PIECE, LETTER, 2, 1);
  Grader.setLevel(CID, HANNAH, PIECE, SUPPORT, 4, 0);
  Grader.setLevel(CID, HANNAH, PIECE, LETTER, 3, 0);
  Grader.returnGrades(CID, PIECE, [JORDAN, HANNAH]);
}
function ask(more = {}) {
  at('2026-11-02T18:00:00.000Z');
  return Grader.returnForRevision(
    CID,
    JORDAN,
    PIECE,
    { what_to_fix: FIX, revise_by: '2026-11-10', criterion_ids: [], ...more },
    k(),
  );
}
function sendRevision() {
  at('2026-11-09T18:00:00.000Z');
  return sendStudentRevision(CID, JORDAN, PIECE, PAGES, NOTE, JORDAN);
}
const row = () => getGradeReturn(CID, JORDAN, PIECE);
const state = sid => GraderWork.workStateOf(CID, PIECE, sid);
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  vi.useFakeTimers({ toFake: ['Date'] });
  localStorage.clear();
});
afterEach(() => {
  closePages();
  vi.useRealTimers();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  clearProfCache();
});

describe('the counts ask revisionWorkState first', () => {
  it('revising is Returned (neither To Grade nor To Return); revised is To Grade; grading is To Return', async () => {
    seed();
    gradeFirstVersion();
    expect(state(JORDAN)).toBe('returned');
    expect((await ask()).result).toBe('made');
    expect(state(JORDAN)).toBe('returned');
    expect(GraderWork.workCounts(CID, PIECE)).toMatchObject({ tograde: 0, toreturn: 0, returned: 2, revised: 0 });
    sendRevision();
    expect(state(JORDAN)).toBe('tograde');
    expect(GraderWork.workCounts(CID, PIECE)).toMatchObject({ tograde: 1, toreturn: 0, returned: 1, revised: 1 });
    expect(GraderWork.classWorkCounts(CID)).toMatchObject({ tograde: 1, revised: 1 });
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    expect(state(JORDAN)).toBe('toreturn');
    expect(GraderWork.workCounts(CID, PIECE)).toMatchObject({ tograde: 0, toreturn: 1, revised: 0 });
  });
});

describe('Return N Graded leaves out work out for revision', () => {
  it('a regrade before the revision is in waits; once the revision is in and graded, it returns', async () => {
    seed();
    gradeFirstVersion();
    await ask();
    expect(getRevisionRequest(CID, JORDAN, PIECE)).toMatchObject({ keep_grade: true, grade_hidden: false });
    Grader.setLevel(CID, JORDAN, PIECE, SUPPORT, 4, 0);
    // GradeState alone would count the change as a draft to return.
    expect(GradeState.draftsIn(CID, PIECE, [JORDAN, HANNAH])).toEqual([JORDAN]);
    expect(GraderWork.draftsIn(CID, PIECE, [JORDAN, HANNAH])).toEqual([]);
    expect(GraderWork.draftsReturned(CID, PIECE, [JORDAN, HANNAH])).toEqual([]);
    expect(Grader.returnGrades(CID, PIECE, [JORDAN, HANNAH]).returned).toBe(0);
    expect(row().is_draft).toBe(true);
    Grader.setLevel(CID, JORDAN, PIECE, SUPPORT, 3, 0);
    // The revision in, not graded yet: still left out.
    sendRevision();
    expect(GraderWork.draftsIn(CID, PIECE, [JORDAN])).toEqual([]);
    // Graded: its grade is the one returned.
    at('2026-11-10T16:00:00.000Z');
    Grader.setLevel(CID, JORDAN, PIECE, LETTER, 3, 0);
    expect(GraderWork.draftsIn(CID, PIECE, [JORDAN, HANNAH])).toEqual([JORDAN]);
    expect(Grader.returnGrades(CID, PIECE, [JORDAN]).returned).toBe(1);
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('returned');
    expect(state(JORDAN)).toBe('returned');
  });

  it('Grader.returnForRevision keeps the grade even when asked to hide it', async () => {
    seed();
    gradeFirstVersion();
    const made = await ask({ keep_grade: false });
    expect(made).toMatchObject({ result: 'made', hidden: false });
    expect(GradeState.stateOf(CID, JORDAN, PIECE)).toBe('returned');
    const out = await Grader.cancelRevision(CID, JORDAN, PIECE, made.request.id, k());
    expect(out).toMatchObject({ result: 'cancelled', unhidden: false });
    expect(GraderWork.revisionStateOf(CID, JORDAN, PIECE)).toBeNull();
  });
});

describe('off: Send Work off, or signed in', () => {
  it('with Send Work off no revision is offered or counted, and the writers refuse', async () => {
    seed({ sendWork: false });
    gradeFirstVersion();
    expect(GraderWork.revisionsOnInClass(CID)).toBe(false);
    expect((await ask()).result).toBe('revisions_off');
    const overlay = openGrader(
      () => {
        seed({ sendWork: false });
        gradeFirstVersion();
      },
      CID,
      PIECE,
      JORDAN,
    );
    expect(overlay.querySelector('[data-grader="revision-open"]')).toBeNull();
    expect(overlay.querySelector('.grader-revision-host')).toBeNull();
  });

  it('signed in: no Return for Revision, Return calls returnGrades as before, and the writer sends nothing', async () => {
    window.isDemoMode = () => false;
    const overlay = openGrader(
      () => {
        seed();
        gradeFirstVersion();
      },
      CID,
      PIECE,
      JORDAN,
    );
    expect(GraderWork.revisionsOnInClass(CID)).toBe(false);
    expect(overlay.querySelector('[data-grader="revision-open"]')).toBeNull();
    expect(
      (await Grader.returnForRevision(CID, JORDAN, PIECE, { what_to_fix: FIX, keep_grade: true }, k())).result,
    ).toBe('not_available');
    expect(getRevisionRequest(CID, JORDAN, PIECE)).toBeNull();
  });
});

describe('the grader: Return for Revision', () => {
  const open = (opts, sid = JORDAN) =>
    openGrader(
      () => {
        seed(opts);
        gradeFirstVersion();
        at('2026-11-02T18:00:00.000Z');
      },
      CID,
      PIECE,
      sid,
    );

  it('beside Return; the sheet in the board’s words; Return for Revision makes the request', async () => {
    const overlay = open();
    const btn = overlay.querySelector('[data-grader="revision-open"]');
    expect(btn.textContent).toBe('Return for Revision');
    click(btn);
    const sheet = overlay.querySelector('.grader-sheet');
    expect(sheet.getAttribute('role')).toBe('dialog');
    expect(sheet.querySelector('.grader-sheet-title').textContent).toBe('Return for Revision');
    expect(sheet.querySelector('.grader-sheet-sub').textContent).toBe('Jordan Reyes · 2.6 The Conscription Crisis');
    expect([...sheet.querySelectorAll('.grader-sheet-label')].map(x => x.textContent)).toEqual([
      'What to Fix',
      'Revise By',
      'Until the New Version Is Graded',
    ]);
    expect(sheet.querySelector('.grader-sheet-keep').textContent).toBe('Keep this grade. The new version replaces it.');
    // Hide is left out (Colin, Nov 11).
    expect(sheet.querySelector('input[type="radio"]')).toBeNull();
    expect(sheet.textContent).not.toContain('Hide');
    // Nothing to fix written: it says so and sends nothing.
    click(sheet.querySelector('[data-rv="send"]'));
    expect(sheet.querySelector('.grader-sheet-msg').textContent).toBe('Write what to fix first.');
    expect(getRevisionRequest(CID, JORDAN, PIECE)).toBeNull();
    sheet.querySelector('.grader-sheet-fix').value = FIX;
    sheet.querySelector('.grader-sheet-by').value = '2026-11-10';
    click(sheet.querySelector('[data-rv="send"]'));
    await flush();
    expect(overlay.querySelector('.grader-sheet')).toBeNull();
    expect(getRevisionRequest(CID, JORDAN, PIECE)).toMatchObject({
      what_to_fix: FIX,
      revise_by: '2026-11-10',
      keep_grade: true,
      grade_hidden: false,
      state: 'open',
    });
    // The row: Revising, the date, Take Back; no Return.
    const ret = overlay.querySelector('.grader-return');
    expect(ret.querySelector('.grader-revising-mark').textContent).toBe('Revising');
    expect(ret.querySelector('.grader-draft-text').textContent).toBe('Returned for Revision · Revise by Tue, Nov 10');
    expect(ret.querySelector('.grader-draft-still')).toBeNull();
    expect(ret.querySelector('[data-grader="return"]')).toBeNull();
    expect(ret.querySelector('[data-grader="revision-open"]')).toBeNull();
    // Take Back.
    click(ret.querySelector('[data-grader="revision-takeback"]'));
    await flush();
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('cancelled');
    expect(GradeState.stateOf(CID, JORDAN, PIECE)).toBe('returned');
    expect(overlay.querySelector('[data-grader="revision-open"]')).not.toBeNull();
  });

  it('Escape closes the sheet, not the grader; Cancel sends nothing', () => {
    const overlay = open();
    click(overlay.querySelector('[data-grader="revision-open"]'));
    key(overlay.querySelector('.grader-sheet-fix'), 'Escape');
    expect(overlay.querySelector('.grader-sheet')).toBeNull();
    expect(window.PageAssignments.graderOpen()).toBe(true);
    click(overlay.querySelector('[data-grader="revision-open"]'));
    click(overlay.querySelector('[data-rv="cancel"]'));
    expect(overlay.querySelector('.grader-sheet')).toBeNull();
    expect(getRevisionRequest(CID, JORDAN, PIECE)).toBeNull();
  });

  it('an answer that comes after the grader closed draws nothing and opens nothing', async () => {
    const overlay = open();
    click(overlay.querySelector('[data-grader="revision-open"]'));
    overlay.querySelector('.grader-sheet-fix').value = FIX;
    click(overlay.querySelector('[data-rv="send"]'));
    window.PageAssignments.closeGrader();
    await flush();
    expect(document.getElementById('grader-overlay')).toBeNull();
    expect(document.querySelector('.grader-sheet')).toBeNull();
  });
});

describe('the grader: grading both versions', () => {
  const openOnRevision = () =>
    openGrader(
      () => {
        seed();
        gradeFirstVersion();
        at('2026-11-02T18:00:00.000Z');
        returnForRevision(
          CID,
          JORDAN,
          PIECE,
          { what_to_fix: FIX, revise_by: '2026-11-10', criterion_ids: [], keep_grade: true },
          k(),
        );
        sendRevision();
      },
      CID,
      PIECE,
      JORDAN,
    );

  it('the revision’s line, New and First, the card, and "Was Developing + on the Oct 30 version"', () => {
    const overlay = openOnRevision();
    const what = overlay.querySelector('.grader-work-what').textContent;
    expect(what.startsWith('Revised Nov 9, ')).toBe(true);
    expect(what.endsWith(' · 1 new page')).toBe(true);
    expect([...overlay.querySelectorAll('[data-grader="work-version"]')].map(b => b.textContent)).toEqual([
      'New · Nov 9',
      'First · Oct 30',
    ]);
    const card = overlay.querySelector('.grader-revision');
    expect(card.querySelector('.grader-revision-title').textContent).toBe('Revision, Sent Nov 9 (a day early)');
    expect([...card.querySelectorAll('.grader-revision-who')].map(x => x.textContent)).toEqual([
      'You asked:',
      'Jordan’s note:',
    ]);
    expect([...card.querySelectorAll('.grader-revision-said')].map(x => x.textContent)).toEqual([FIX, NOTE]);
    // Not graded yet: no Before and After.
    expect(card.querySelector('.grader-revision-ba')).toBeNull();
    const letter = overlay.querySelector('.grdl-card[data-tag="' + LETTER + '"]');
    expect(letter.querySelector('.grader-was-line').textContent).toBe('Was Developing + on the Oct 30 version');
    expect(letter.querySelector('.grader-was-hint').textContent).toBe('Pick the level for the new version.');
    // Return is greyed out until the new version is graded.
    expect(overlay.querySelector('[data-grader="return"]').disabled).toBe(true);
    // First shows the first version's page; Mark Up and Delete Work are the new one's.
    click(overlay.querySelector('[data-grader="work-version"][data-version="first"]'));
    expect(overlay.querySelector('.grader-work-surface').dataset.fileId).toBe('f1');
    expect(overlay.querySelector('[data-grader="work-delete"]')).toBeNull();
  });

  it('Before and After: 2.7 · 67% before, 3.0 · 75% after, a draft until it is returned', () => {
    const again = openOnRevision();
    at('2026-11-10T16:00:00.000Z');
    // Proficient on Letter to the Editor, in the grader.
    click(again.querySelector('.grdl-card[data-tag="' + LETTER + '"] [data-level="3"]'));
    expect(again.querySelector('.grdl-card[data-tag="' + LETTER + '"] .grader-was-hint')).toBeNull();
    let ba = again.querySelector('.grader-revision-ba');
    expect(ba.querySelector('.grader-revision-ba-title').textContent).toBe('Before and After');
    const result = ba.querySelector('.is-result');
    expect(result.querySelector('.grader-revision-before').textContent).toBe('2.7 · 67%');
    expect(result.querySelector('.grader-revision-after').textContent).toBe('3.0 · 75% Draft');
    const rows = [...ba.querySelectorAll('.grader-revision-ba-row:not(.is-result)')].map(r =>
      [...r.children].map(c => c.textContent),
    );
    expect(rows).toEqual([
      ['Support and Opposition', 'No change', 'Proficient'],
      ['Letter to the Editor', 'Developing +', 'Proficient'],
    ]);
    // The student still has 2.7 · 67% until it is returned.
    expect(
      formatLevel(CID, withReturnedOnly(() => assessmentCellValue(CID, JORDAN, getAssessments(CID)[0])).value),
    ).toBe('2.7 · 67%');
    click(again.querySelector('[data-grader="return"]'));
    ba = again.querySelector('.grader-revision-ba');
    expect(ba.querySelector('.is-result .grader-revision-after').textContent).toBe('3.0 · 75%');
    expect(getRevisionRequest(CID, JORDAN, PIECE).state).toBe('returned');
  });
});

describe('the gradebook’s Revising cell and the dashboard’s "1 Revised"', () => {
  const glance = () => {
    const html = DashOverview.glanceHtml({ cid: CID, allStudents: getStudents(CID), classAvg: 0, missing: [] });
    const { document: d } = parseHTML('<div>' + html + '</div>');
    return d.querySelector('.dash-glance-tograde .dash-glance-sub').textContent.replace(/\s+/g, ' ').trim();
  };
  const jordanCell = () =>
    document.querySelector('.gb-scores-cell[data-sid="' + JORDAN + '"][data-aid="' + PIECE + '"]');

  it('Revising under the grade while nothing is in, with its key line; To Grade once the revision is in', () => {
    mount(
      () => {
        seed();
        gradeFirstVersion();
        returnForRevision(
          CID,
          JORDAN,
          PIECE,
          { what_to_fix: FIX, revise_by: '2026-11-10', criterion_ids: [], keep_grade: true },
          k(),
        );
      },
      { course: CID },
    );
    try {
      expect(jordanCell().querySelector('.gb-revising').textContent).toBe('Revising');
      expect(jordanCell().textContent).toContain('2.7');
      expect(jordanCell().getAttribute('aria-label')).toContain(', returned for revision');
      const keyItem = [...document.querySelectorAll('.gb-key-item')].find(x => x.querySelector('.gb-revising'));
      expect(keyItem.textContent).toBe('RevisingReturned for revision');
      expect(glance()).toMatch(/^All Caught Up/);
      sendRevision();
      expect(glance()).toBe('1 Revised · 0 Not Returned');
    } finally {
      unmount();
    }
  });

  it('with Send Work off there is no Revising cell, key line or Revised count', () => {
    mount(
      () => {
        seed({ sendWork: false });
        gradeFirstVersion();
      },
      { course: CID },
    );
    try {
      expect(document.querySelector('.gb-revising')).toBeNull();
    } finally {
      unmount();
    }
  });
});
