/**
 * Per-student options on the Student Page (docs/plans/per-student-options-plan.md,
 * Layout A): the data layer (shared/data-reflect.js, getStudentPageOptions,
 * setStudentPageOptions, loadStudentPageOptions, effectiveShowOverallGrade)
 * and the Students list's additions (teacher/student-page-students.js).
 *
 * - On this device (Demo Mode): kept in gb-student-page-options-<cid>,
 *   nothing sent.
 * - Signed in: list_student_page_options is the reader the controls depend
 *   on; until the server has it nothing is offered or sent. A change is
 *   set_student_page_options with the class, the students, the change and a
 *   key, shown at once; a refusal (a raised error) puts it back.
 * - The effective Show Overall Grade: the student's own Show or Hide, else
 *   the class's switch; Preview's StudentView.learningOn(cid, sid) reads it.
 * - The list: Work Sent and Overall Grade; the filters Questions and
 *   Exceptions with their counts. Feedback Opened and Feedback Not Opened
 *   are off until Colin rules (TEACHER_SEES_OPENED), their counting kept; the
 *   exceptions line; the bar; the side panel; a toast with Undo; every name
 *   through esc().
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, clearClass, seedClass, serverSaysStudentPageOn, settle, signIn } from './helpers/pin-save-paths.js';

const CID = 'c-sps';
const ON = { student_page_enabled: true, return_grades: 'on_return' };
const STUDENTS = [
  { id: 's1', firstName: 'Jordan', lastName: 'Abel' },
  { id: 's2', firstName: 'Priya', lastName: 'Byrne' },
  { id: 's3', firstName: 'Liam', lastName: 'Chen' },
];
const ASSESSMENTS = [
  { id: 'a1', title: 'Lab Report', date: '2026-11-01', type: 'summative', tagIds: [] },
  { id: 'a2', title: 'Quiz <b>1</b>', date: '2026-11-02', type: 'summative', tagIds: [] },
  { id: 'a3', title: 'Essay', date: '2026-11-03', type: 'summative', tagIds: [] },
];
// Jordan: two pieces back, one opened after it came back; Priya: one back, seen only before; Liam: none.
const RETURNS = {
  a1: {
    s1: { returned_at: '2026-11-10T18:00:00.000Z', seen_at: '2026-11-11T18:00:00.000Z' },
    s2: { returned_at: '2026-11-10T18:00:00.000Z', seen_at: '2026-11-09T18:00:00.000Z' },
  },
  a2: { s1: { returned_at: '2026-11-12T18:00:00.000Z' } },
  a3: { s1: { is_draft: true } },
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KEY = () => crypto.randomUUID();

function seed(students, config) {
  clearClass(CID);
  seedClass(CID, {
    students: students || STUDENTS,
    assessments: ASSESSMENTS,
    gradeReturns: RETURNS,
    courseConfigs: config || ON,
  });
  COURSES[CID].name = 'Science 8';
  localStorage.removeItem('gb-student-page-options-' + CID);
}
function classShows(on) {
  saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { show_my_learning: on }));
}
function parse(html) {
  const doc = parseHTML('<!doctype html><html><head></head><body></body></html>').document;
  const box = doc.createElement('div');
  box.innerHTML = html;
  return box;
}
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const at = cid => ({ closest: () => ({ dataset: { cid } }) });
async function list(cid = CID) {
  await StudentCards.load(cid);
  return parse(StudentCards.render(cid));
}
const filtersOf = box => [...box.querySelectorAll('.sc-chip')].map(b => [text(b), b.className]);
const column = (box, n) => [...box.querySelectorAll('.sc-table tbody tr')].map(tr => text(tr.children[n]));
function panel(sid, cid = CID) {
  StudentPageStudents._setOpen(cid, sid);
  try {
    return parse(StudentCards.render(cid)).querySelector('.sps-panel');
  } finally {
    StudentPageStudents._setOpen(cid, null);
  }
}

beforeEach(() => {
  StudentCards._reset();
  _forgetStudentPageOptions();
  seed();
});
afterEach(async () => {
  await settle();
  StudentCards._reset();
  _forgetStudentPageOptions();
  clearClass(CID);
  localStorage.removeItem('gb-student-page-options-' + CID);
  localStorage.removeItem('gb-student-cards-' + CID);
});

describe('the options on this device (Demo Mode)', () => {
  it('are offered with the student page on, and not with it off', () => {
    expect(studentPageOptionsOffered(CID)).toBe(true);
    expect(getStudentPageOptions(CID)).toEqual({});
    seed(STUDENTS, { student_page_enabled: false });
    expect(studentPageOptionsOffered(CID)).toBe(false);
  });

  it('keep each change on the device, and only the students with one', async () => {
    expect(await setStudentPageOptions(CID, ['s1', 's2'], { show_overall_grade: 'hide' }, KEY())).toEqual({
      ok: true,
      options: {
        s1: { show_overall_grade: 'hide', paused_at: null },
        s2: { show_overall_grade: 'hide', paused_at: null },
      },
    });
    await setStudentPageOptions(CID, ['s3'], { paused: true }, KEY());
    const opts = getStudentPageOptions(CID);
    expect(opts.s3.show_overall_grade).toBe('class');
    expect(opts.s3.paused_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Object.keys(JSON.parse(localStorage.getItem('gb-student-page-options-' + CID))).sort()).toEqual([
      's1',
      's2',
      's3',
    ]);
    // Back to the class and open again: nothing kept.
    await setStudentPageOptions(CID, ['s1', 's2'], { show_overall_grade: 'class' }, KEY());
    await setStudentPageOptions(CID, ['s3'], { paused: false }, KEY());
    expect(getStudentPageOptions(CID)).toEqual({});
    expect(localStorage.getItem('gb-student-page-options-' + CID)).toBe(null);
  });

  it('refuse a wrong ask with nothing changed', async () => {
    const bad = [
      [[], { show_overall_grade: 'hide' }],
      [['s1', 'nobody'], { show_overall_grade: 'hide' }],
      [Array.from({ length: 501 }, () => 's1'), { show_overall_grade: 'hide' }],
      [['s1'], { show_overall_grade: 'maybe' }],
      [['s1'], { paused: 'yes' }],
      [['s1'], { reason: 'custody' }],
      [['s1'], {}],
    ];
    for (const [ids, change] of bad) {
      expect(await setStudentPageOptions(CID, ids, change, KEY())).toEqual({ result: 'invalid' });
    }
    expect(getStudentPageOptions(CID)).toEqual({});
    seed(STUDENTS, { student_page_enabled: false });
    expect(await setStudentPageOptions(CID, ['s1'], { paused: true }, KEY())).toEqual({ result: 'not_available' });
  });

  it('forget a student who leaves the class', async () => {
    await setStudentPageOptions(CID, ['s1', 's2'], { show_overall_grade: 'hide' }, KEY());
    _cache.students[CID] = STUDENTS.slice(1);
    expect(Object.keys(getStudentPageOptions(CID))).toEqual(['s2']);
  });

  it('Reset Demo Data and deleting the class take the options with them', async () => {
    await setStudentPageOptions(CID, ['s1'], { show_overall_grade: 'hide' }, KEY());
    expect(localStorage.getItem('gb-student-page-options-' + CID)).not.toBe(null);
    _clearCourseLocalState(CID);
    expect(localStorage.getItem('gb-student-page-options-' + CID)).toBe(null);
    expect(getStudentPageOptions(CID)).toEqual({});
  });

  it('Preview as a paused student shows what their card shows, not their page', async () => {
    const stub = globalThis.document;
    const doc = parseHTML('<!doctype html><html><body></body></html>').document;
    globalThis.document = doc;
    try {
      await setStudentPageOptions(CID, ['s3'], { paused: true }, KEY());
      expect(PreviewStudent.open(CID, 's3', null)).toBe(true);
      const screen = doc.querySelector('#preview-student .ps-screen');
      expect(text(screen)).toBe('The student page is turned off for this class. Ask your teacher.');
      expect(screen.querySelector('.sp-tabs-bottom')).toBe(null);
      PreviewStudent.close();
      expect(PreviewStudent.open(CID, 's2', null)).toBe(true);
      expect(text(doc.querySelector('#preview-student .ps-screen'))).not.toContain('turned off');
      PreviewStudent.close();
    } finally {
      globalThis.document = stub;
    }
  });

  it('the effective Show Overall Grade: the student’s own, else the class’s, and Preview reads it', async () => {
    await setStudentPageOptions(CID, ['s1'], { show_overall_grade: 'show' }, KEY());
    await setStudentPageOptions(CID, ['s2'], { show_overall_grade: 'hide' }, KEY());
    classShows(false);
    expect(['s1', 's2', 's3'].map(s => effectiveShowOverallGrade(CID, s))).toEqual([true, false, false]);
    classShows(true);
    expect(['s1', 's2', 's3'].map(s => effectiveShowOverallGrade(CID, s))).toEqual([true, false, true]);
    expect(StudentView.learningOn(CID, 's2')).toBe(false);
    expect(StudentView.learningOn(CID)).toBe(true);
    // A paused page leaves the grade setting as it was.
    await setStudentPageOptions(CID, ['s3'], { paused: true }, KEY());
    expect(effectiveShowOverallGrade(CID, 's3')).toBe(true);
  });
});

describe('signed in', () => {
  const REAL = U(81);
  const S = [U(82), U(83), U(84)];
  let session;
  beforeEach(() => {
    session = signIn();
    clearClass(REAL);
    seedClass(REAL, {
      students: STUDENTS.map((s, i) => ({ ...s, id: S[i] })),
      courseConfigs: ON,
    });
    serverSaysStudentPageOn(REAL);
  });
  afterEach(() => {
    serverSaysStudentPageOn(REAL, false);
    session.signOut();
    clearClass(REAL);
  });
  const sent = name => session.sent().filter(c => c[0] === name);

  it('a server without list_student_page_options: nothing offered, nothing sent, and not asked again', async () => {
    session.fake.on('list_student_page_options', () => ({
      data: null,
      error: { code: 'PGRST202', message: 'Could not find the function public.list_student_page_options' },
    }));
    expect(await loadStudentPageOptions(REAL)).toBe(false);
    expect(studentPageOptionsOffered(REAL)).toBe(false);
    expect(getStudentPageOptions(REAL)).toEqual({});
    expect(await setStudentPageOptions(REAL, [S[0]], { show_overall_grade: 'hide' }, KEY())).toEqual({
      result: 'not_available',
    });
    expect(await loadStudentPageOptions(REAL, true)).toBe(false);
    expect(session.sent().map(c => c[0])).toEqual(['list_student_page_options']);
    session.fake.on('list_student_cards', () => ({ data: [], error: null }));
    // The list has no Overall Grade and no Exceptions, and the panel no What … Sees.
    const box = await list(REAL);
    expect([...box.querySelectorAll('.sc-table thead th')].map(text)).not.toContain('Overall Grade');
    expect(filtersOf(box).map(f => f[0])).not.toContain('Grade Exceptions 0');
    const p = panel(S[0], REAL);
    expect(p.querySelector('#sps-sees-title')).toBe(null);
    expect(text(p.querySelector('#sps-done-title'))).toBe('What Jordan Has Done');
    expect(StudentPageStudents.exceptionsLine(REAL)).toBe('');
  });

  it('reads the class’s options, the words as they come', async () => {
    session.fake.on('list_student_page_options', () => ({
      data: {
        ok: true,
        options: [
          { enrollment_id: S[0], show_overall_grade: 'hide', paused_at: null },
          { enrollment_id: S[1], show_overall_grade: 'class', paused_at: '2026-11-17T20:00:00+00:00' },
          { enrollment_id: S[2], show_overall_grade: 'show', paused_at: null },
        ],
      },
      error: null,
    }));
    expect(await loadStudentPageOptions(REAL)).toBe(true);
    expect(sent('list_student_page_options')).toEqual([['list_student_page_options', { p_course_id: REAL }]]);
    expect(studentPageOptionsOffered(REAL)).toBe(true);
    expect(getStudentPageOptions(REAL)).toEqual({
      [S[0]]: { show_overall_grade: 'hide', paused_at: null },
      [S[1]]: { show_overall_grade: 'class', paused_at: '2026-11-17T20:00:00+00:00' },
      [S[2]]: { show_overall_grade: 'show', paused_at: null },
    });
    expect(effectiveShowOverallGrade(REAL, S[0])).toBe(false);
    expect(effectiveShowOverallGrade(REAL, S[2])).toBe(true);
  });

  it('a change is set_student_page_options with the class, the students, the change and a key, shown at once', async () => {
    session.fake.on('list_student_page_options', () => ({ data: { ok: true, options: [] }, error: null }));
    await loadStudentPageOptions(REAL);
    let answer;
    session.fake.on('set_student_page_options', () => new Promise(r => (answer = r)));
    const done = setStudentPageOptions(REAL, [S[0], S[1]], { show_overall_grade: 'hide' }, KEY());
    expect(getStudentPageOptions(REAL)[S[0]]).toEqual({ show_overall_grade: 'hide', paused_at: null });
    await settle();
    const [call] = session.fake.calls.filter(c => c.name === 'set_student_page_options');
    expect(call.params).toEqual({
      p_course_id: REAL,
      p_enrollment_ids: [S[0], S[1]],
      p_show_overall_grade: 'hide',
      p_paused: null,
      p_idempotency_key: expect.stringMatching(UUID),
    });
    answer({
      data: {
        ok: true,
        options: [
          { enrollment_id: S[0], show_overall_grade: 'hide', paused_at: null },
          { enrollment_id: S[1], show_overall_grade: 'hide', paused_at: null },
        ],
      },
      error: null,
    });
    expect((await done).ok).toBe(true);
    expect(Object.keys(getStudentPageOptions(REAL)).sort()).toEqual([S[0], S[1]].sort());
    // A pause sends only the pause.
    session.fake.on('set_student_page_options', () => ({
      data: {
        ok: true,
        options: [{ enrollment_id: S[2], show_overall_grade: 'class', paused_at: '2026-11-17T21:00:00Z' }],
      },
      error: null,
    }));
    await setStudentPageOptions(REAL, [S[2]], { paused: true }, KEY());
    const last = session.fake.calls.filter(c => c.name === 'set_student_page_options').pop().params;
    expect([last.p_show_overall_grade, last.p_paused]).toEqual([null, true]);
    expect(getStudentPageOptions(REAL)[S[2]].paused_at).toBe('2026-11-17T21:00:00Z');
  });

  it('a list read begun before a change is dropped: it cannot put the change back', async () => {
    session.fake.on('list_student_page_options', () => ({ data: { ok: true, options: [] }, error: null }));
    await loadStudentPageOptions(REAL);
    let stale;
    session.fake.on('list_student_page_options', () => new Promise(r => (stale = r)));
    const reading = loadStudentPageOptions(REAL, true);
    session.fake.on('set_student_page_options', () => ({
      data: { ok: true, options: [{ enrollment_id: S[0], show_overall_grade: 'hide', paused_at: null }], skipped: [] },
      error: null,
    }));
    await setStudentPageOptions(REAL, [S[0]], { show_overall_grade: 'hide' }, KEY());
    await settle();
    stale({ data: { ok: true, options: [] }, error: null });
    await reading;
    expect(getStudentPageOptions(REAL)).toEqual({ [S[0]]: { show_overall_grade: 'hide', paused_at: null } });
  });

  it('students the server skipped show what the server has, and the rest are changed', async () => {
    session.fake.on('list_student_page_options', () => ({ data: { ok: true, options: [] }, error: null }));
    await loadStudentPageOptions(REAL);
    session.fake.on('set_student_page_options', () => ({
      data: {
        ok: true,
        options: [{ enrollment_id: S[0], show_overall_grade: 'hide', paused_at: null }],
        skipped: [S[1]],
      },
      error: null,
    }));
    const out = await setStudentPageOptions(REAL, [S[0], S[1]], { show_overall_grade: 'hide' }, KEY());
    expect(out.ok).toBe(true);
    expect(out.skipped).toEqual([S[1]]);
    expect(getStudentPageOptions(REAL)).toEqual({ [S[0]]: { show_overall_grade: 'hide', paused_at: null } });
  });

  it('refused (a raised error): what is shown goes back to the server’s', async () => {
    session.fake.on('list_student_page_options', () => ({
      data: { ok: true, options: [{ enrollment_id: S[0], show_overall_grade: 'show', paused_at: null }] },
      error: null,
    }));
    await loadStudentPageOptions(REAL);
    session.fake.on('set_student_page_options', () => ({
      data: null,
      error: { code: '22023', message: 'unknown enrollment' },
    }));
    const out = await setStudentPageOptions(REAL, [S[0]], { show_overall_grade: 'hide' }, KEY());
    expect(out).toEqual({ result: 'failed' });
    expect(getStudentPageOptions(REAL)).toEqual({ [S[0]]: { show_overall_grade: 'show', paused_at: null } });
  });
});

describe('the Students list', () => {
  // Demo Mode, where the class's Show Overall Grade row is offered (CmStudentPage.learningSettings).
  let wasDemo;
  beforeEach(() => {
    wasDemo = window.isDemoMode;
    window.isDemoMode = () => true;
  });
  afterEach(() => {
    window.isDemoMode = wasDemo;
  });

  it('Work Sent and Overall Grade for each student; nothing about what a student opened', async () => {
    const box = await list();
    expect([...box.querySelectorAll('.sc-table thead th')].map(text)).toEqual([
      '',
      'Student',
      'Card',
      'Status',
      'Work Sent',
      'Overall Grade',
      '',
    ]);
    expect(column(box, 4)).toEqual(['0', '0', '0']);
    expect(column(box, 5)).toEqual(['Hidden · Class', 'Hidden · Class', 'Hidden · Class']);
    expect(box.textContent).not.toMatch(/Feedback Opened|Feedback Not Opened|Not opened|what they’ve opened/);
    classShows(true);
    await setStudentPageOptions(CID, ['s1'], { show_overall_grade: 'hide' }, KEY());
    await setStudentPageOptions(CID, ['s3'], { paused: true }, KEY());
    const after = parse(StudentCards.render(CID));
    expect(column(after, 5)).toEqual(['Hidden', 'Shown · Class', 'Page Paused']);
    expect([...after.querySelectorAll('.sps-grade')].map(e => e.className)).toEqual([
      'sps-grade sps-grade-hidden',
      'sps-grade sps-grade-class',
      'sps-grade sps-grade-paused',
    ]);
  });

  it('the facts behind them: returned, opened, not opened newest first, work sent by piece, late from the newest version', () => {
    const f = StudentPageStudents.factsOf(CID, 's1', [
      { assessment_id: 'a1', version: 1, is_late: false },
      { assessment_id: 'a1', version: 2, is_late: true },
      { assessment_id: 'a2', version: 1, is_late: true },
      { assessment_id: 'a2', version: 2, is_late: false },
    ]);
    expect([f.returned, f.opened, f.sent, f.late]).toEqual([2, 1, 2, 1]);
    expect(f.notOpened).toEqual([{ title: 'Quiz <b>1</b>', back: '2026-11-12T18:00:00.000Z' }]);
    expect(f.reflections).toBe(null);
  });

  it('a Missing or Excused piece is never counted as returned or not opened', () => {
    saveAssignmentStatuses(CID, { 's1:a2': 'EXC', 's2:a1': 'NS' });
    expect(StudentPageStudents.factsOf(CID, 's1', []).returned).toBe(1);
    expect(StudentPageStudents.factsOf(CID, 's1', []).notOpened).toEqual([]);
    expect(StudentPageStudents.factsOf(CID, 's2', []).returned).toBe(0);
  });

  it('with TEACHER_SEES_OPENED on (for a later server change): Feedback Opened and Feedback Not Opened', async () => {
    StudentPageStudents._setTeacherSeesOpened(true);
    try {
      let box = await list();
      expect([...box.querySelectorAll('.sc-table thead th')].map(text)).toContain('Feedback Opened');
      // Jordan opened one of two pieces back; Priya saw hers only before it came back; Liam has none.
      expect(column(box, 4)).toEqual(['1 of 2', '0 of 1', 'None']);
      expect(filtersOf(box)[1]).toEqual(['Feedback Not Opened 2', 'sc-chip sc-chip-info']);
      StudentCards.setFilter(CID, 'not_opened');
      box = parse(StudentCards.render(CID));
      expect(column(box, 1)).toEqual(['Jordan Abel', 'Priya Byrne']);
      const p = panel('s1');
      expect(text(p.querySelector('.sps-facts'))).toContain('Feedback Opened1 of 2 returned pieces');
      expect(text(p.querySelector('.sps-unopened'))).toBe('Not opened: Quiz <b>1</b>, back Nov 12');
      expect(p.querySelector('.sps-unopened b')).toBe(null);
    } finally {
      StudentPageStudents._setTeacherSeesOpened(false);
    }
  });

  it('filters with counts, coloured only when they hold any; Exceptions narrows the list', async () => {
    let box = await list();
    expect(filtersOf(box)).toEqual([
      ['All 3', 'sc-chip active'],
      ['Grade Exceptions 0', 'sc-chip'],
      ['Not Printed 3', 'sc-chip sc-chip-warn'],
      ['Locked 0', 'sc-chip'],
      ['Never Opened 0', 'sc-chip'],
    ]);
    await setStudentPageOptions(CID, ['s2'], { show_overall_grade: 'show' }, KEY());
    await setStudentPageOptions(CID, ['s3'], { paused: true }, KEY());
    StudentCards.setFilter(CID, 'exceptions');
    box = parse(StudentCards.render(CID));
    expect(filtersOf(box)[1]).toEqual(['Grade Exceptions 2', 'sc-chip sc-chip-warn active']);
    expect(column(box, 1)).toEqual(['Priya Byrne', 'Liam Chen']);
  });

  it('Questions shows with Reflect on Feedback on', async () => {
    const was = window.isDemoMode;
    window.isDemoMode = () => true;
    try {
      saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { reflect_on_feedback: true }));
      const box = await list();
      expect(filtersOf(box).map(f => f[0])).toContain('Questions 0');
    } finally {
      window.isDemoMode = was;
    }
  });

  it('the line under Show Overall Grade names the exceptions', async () => {
    expect(StudentPageStudents.exceptionsLine(CID)).toBe('');
    classShows(true);
    await setStudentPageOptions(CID, ['s1', 's2'], { show_overall_grade: 'hide' }, KEY());
    expect(StudentPageStudents.exceptionsLine(CID)).toBe('Hidden for Jordan and Priya');
    classShows(false);
    await setStudentPageOptions(CID, ['s3'], { show_overall_grade: 'show' }, KEY());
    expect(StudentPageStudents.exceptionsLine(CID)).toBe('Shown for Liam');
    const more = ['A', 'B', 'C', 'D', 'E'].map((n, i) => ({ id: 'm' + i, firstName: n, lastName: 'Zed' }));
    seed(more);
    classShows(true);
    await setStudentPageOptions(CID, ['m0', 'm1', 'm2', 'm3', 'm4'], { show_overall_grade: 'hide' }, KEY());
    expect(StudentPageStudents.exceptionsLine(CID)).toBe('Hidden for A, B, C and 2 more');
    const btn = parse(StudentPageStudents.exceptionsHtml(CID)).querySelector('button');
    expect(btn.dataset.action).toBe('spStudentExceptions');
  });

  it('ticks give a bar; its buttons change every ticked student, with one Undo', async () => {
    await list();
    const toasts = [];
    const was = globalThis.showUndoToast;
    globalThis.showUndoToast = (msg, undo) => toasts.push({ msg, undo });
    try {
      await setStudentPageOptions(CID, ['s2'], { show_overall_grade: 'show' }, KEY());
      ['s1', 's2'].forEach(sid =>
        StudentPageStudents.handleChange({
          dataset: { actionChange: 'spStudentPick', student: sid },
          checked: true,
          closest: () => ({ dataset: { cid: CID } }),
        }),
      );
      const bar = parse(StudentCards.render(CID)).querySelector('.sps-bar');
      expect(text(bar.querySelector('.sps-bar-count'))).toBe('2 Selected');
      expect([...bar.querySelectorAll('button')].map(text)).toEqual([
        'Show',
        'Hide',
        'Use Class Setting',
        'Pause',
        'Resume',
        'Replace and Show',
        'Replace and Print',
        'Clear Selection',
      ]);
      // Each says in full what it acts on, and what it does on hover.
      expect([...bar.querySelectorAll('.sps-bar-group')].map(g => g.getAttribute('aria-label'))).toEqual([
        'Overall Grade',
        'Student Page',
        'Card',
      ]);
      expect(bar.querySelector('[data-value="print"]').getAttribute('title')).toBe(
        'Makes a new card for each and prints it. Their old card stops working at once.',
      );
      StudentPageStudents.handleAction('spStudentBulk', {
        dataset: { value: 'hide' },
        closest: () => ({ dataset: { cid: CID } }),
      });
      expect(getStudentPageOptions(CID).s1.show_overall_grade).toBe('hide');
      expect(getStudentPageOptions(CID).s2.show_overall_grade).toBe('hide');
      expect(toasts.map(t => t.msg)).toEqual(['Overall grade hidden for 2 students.']);
      // A second press changes nobody: no change, no toast, and the first Undo still works.
      StudentPageStudents.handleAction('spStudentBulk', {
        dataset: { value: 'hide' },
        closest: () => ({ dataset: { cid: CID } }),
      });
      expect(toasts.length).toBe(1);
      toasts[0].undo();
      await settle();
      // Each back as it was: Jordan follows the class, Priya is shown.
      expect(getStudentPageOptions(CID)).toEqual({ s2: { show_overall_grade: 'show', paused_at: null } });
      StudentPageStudents.handleAction('spStudentClear', at(CID));
      expect(parse(StudentCards.render(CID)).querySelector('.sps-bar')).toBe(null);
      // Another filter clears the ticks, so the bar acts only on students the teacher can see.
      StudentPageStudents.handleChange({
        dataset: { actionChange: 'spStudentPick', student: 's1' },
        checked: true,
        closest: () => ({ dataset: { cid: CID } }),
      });
      expect(StudentPageStudents.picked(CID)).toEqual(['s1']);
      StudentCards.setFilter(CID, 'locked');
      expect(StudentPageStudents.picked(CID)).toEqual([]);
    } finally {
      globalThis.showUndoToast = was;
    }
  });

  it('one student’s change from the panel says their name, and Undo puts it back', async () => {
    await list();
    const toasts = [];
    const was = globalThis.showUndoToast;
    globalThis.showUndoToast = (msg, undo) => toasts.push({ msg, undo });
    try {
      StudentPageStudents._setOpen(CID, 's1');
      StudentPageStudents.handleAction('spStudentPage', {
        dataset: { value: 'paused' },
        closest: () => ({ dataset: { cid: CID } }),
      });
      StudentPageStudents.handleAction('spStudentGrade', {
        dataset: { value: 'hide' },
        closest: () => ({ dataset: { cid: CID } }),
      });
      expect(toasts.map(t => t.msg)).toEqual(['Jordan’s page is paused.', 'Jordan’s overall grade is hidden.']);
      toasts[1].undo();
      toasts[0].undo();
      await settle();
      expect(getStudentPageOptions(CID)).toEqual({});
    } finally {
      StudentPageStudents._setOpen(CID, null);
      globalThis.showUndoToast = was;
    }
  });

  it('the side panel: what the student sees, what they have done, and their card', async () => {
    await list();
    classShows(true);
    let p = panel('s1');
    expect(p.getAttribute('role')).toBe('dialog');
    expect(text(p.querySelector('#sps-panel-name'))).toBe('Jordan Abel');
    expect(text(p.querySelector('#sps-preview'))).toBe('Preview as Jordan');
    expect(text(p.querySelector('#sps-sees-title'))).toBe('What Jordan Sees');
    expect(
      [...p.querySelectorAll('[data-action="spStudentGrade"]')].map(b => [text(b), b.getAttribute('aria-checked')]),
    ).toEqual([
      ['Use Class Setting (Shown)', 'true'],
      ['Show', 'false'],
      ['Hide', 'false'],
    ]);
    expect(text(p.querySelector('#sps-grade-hint'))).toBe('Jordan sees their overall grade at the top of My Learning.');
    expect(text(p.querySelector('#sps-page-hint'))).toBe('Jordan’s card opens their page.');
    expect(text(p.querySelector('#sps-done-title'))).toBe('What Jordan Has Done');
    // Nothing about what Jordan opened (TEACHER_SEES_OPENED is off); Work Sent stays.
    expect(text(p.querySelector('.sps-facts'))).toBe('Work SentNone');
    expect(p.querySelector('.sps-unopened')).toBe(null);
    expect(text(p.querySelector('#sps-card-title'))).toBe('Card');
    expect(p.querySelector('.sps-card-btns')).toBe(null);
    await setStudentPageOptions(CID, ['s1'], { show_overall_grade: 'hide' }, KEY());
    await setStudentPageOptions(CID, ['s1'], { paused: true }, KEY());
    p = panel('s1');
    expect(p.querySelector('#sps-grade-hide').getAttribute('aria-checked')).toBe('true');
    expect(p.querySelector('#sps-page-paused').getAttribute('aria-checked')).toBe('true');
    expect(text(p.querySelector('#sps-grade-hint'))).toBe(
      'Jordan’s overall grade stays off their page. Each piece’s result and feedback still show.',
    );
  });

  it('the panel closes with Class Settings, and opens again only when a name is pressed', async () => {
    await list();
    StudentPageStudents._setOpen(CID, 's1');
    expect(StudentPageStudents.openStudent(CID)).toBe('s1');
    DashClassManager.closeClassManager();
    expect(StudentPageStudents.openStudent(CID)).toBe(null);
    expect(parse(StudentCards.render(CID)).querySelector('.sps-panel')).toBe(null);
  });

  it('Show and Hide only where the class’s Show Overall Grade row is offered; Pause stays', async () => {
    await list();
    const was = CmStudentPage.learningSettings;
    CmStudentPage.learningSettings = () => ({ offered: false, on: false });
    try {
      expect(StudentPageStudents.gradeOffered(CID)).toBe(false);
      const p = panel('s1');
      expect(p.querySelector('[data-action="spStudentGrade"]')).toBe(null);
      expect(p.querySelector('#sps-page-paused')).not.toBe(null);
      StudentPageStudents.handleChange({
        dataset: { actionChange: 'spStudentPick', student: 's1' },
        checked: true,
        closest: () => ({ dataset: { cid: CID } }),
      });
      const bar = parse(StudentCards.render(CID)).querySelector('.sps-bar');
      expect([...bar.querySelectorAll('button')].map(text)).toEqual([
        'Pause',
        'Resume',
        'Replace and Show',
        'Replace and Print',
        'Clear Selection',
      ]);
      StudentPageStudents.handleAction('spStudentBulk', {
        dataset: { value: 'hide' },
        closest: () => ({ dataset: { cid: CID } }),
      });
      expect(getStudentPageOptions(CID)).toEqual({});
    } finally {
      CmStudentPage.learningSettings = was;
    }
  });

  it('every name goes through esc()', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    seed([{ id: 'e1', firstName: evil, lastName: 'Doe' }, ...STUDENTS.slice(1)]);
    classShows(true);
    await setStudentPageOptions(CID, ['e1'], { show_overall_grade: 'hide' }, KEY());
    const box = await list();
    StudentPageStudents._setOpen(CID, 'e1');
    const withPanel = parse(StudentCards.render(CID));
    StudentPageStudents._setOpen(CID, null);
    const line = parse(StudentPageStudents.exceptionsHtml(CID));
    [box, withPanel, line].forEach(b => expect(b.querySelector('img')).toBe(null));
    expect(text(withPanel.querySelector('#sps-panel-name'))).toBe(evil + ' Doe');
    expect(text(line)).toBe('Hidden for ' + evil);
    expect(withPanel.querySelector('.sps-check[data-student="e1"]').getAttribute('aria-label')).toBe(
      'Select ' + evil + ' Doe',
    );
  });

  it('Escape closes the panel and the focus goes back to the student’s name', async () => {
    const stub = globalThis.document;
    const doc = parseHTML('<!doctype html><html><body></body></html>').document;
    let active = null;
    Object.defineProperty(doc, 'activeElement', { configurable: true, get: () => active });
    globalThis.document = doc;
    try {
      await StudentCards.load(CID);
      StudentPageStudents.handleAction('spStudentOpen', {
        dataset: { student: 's2' },
        closest: () => ({ dataset: { cid: CID } }),
      });
      expect(StudentPageStudents.openStudent(CID)).toBe('s2');
      doc.body.innerHTML = StudentCards.render(CID);
      const name = doc.querySelector('.sps-name[data-student="s2"]');
      expect(name.getAttribute('aria-expanded')).toBe('true');
      name.focus = () => (active = name);
      const esc = new doc.defaultView.Event('keydown', { bubbles: true });
      Object.defineProperty(esc, 'key', { value: 'Escape' });
      doc.dispatchEvent(esc);
      expect(StudentPageStudents.openStudent(CID)).toBe(null);
      expect(active).toBe(name);
    } finally {
      globalThis.document = stub;
    }
  });
});
