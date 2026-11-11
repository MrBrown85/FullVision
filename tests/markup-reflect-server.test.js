/**
 * Mark Up and Reflect on Feedback for a signed-in teacher (S9-W1, S10-W1;
 * shared/data.js, "Mark Up and Reflect on Feedback for a signed-in
 * teacher"). The server is tests/helpers/fake-supabase.js with a stand-in
 * for Batch C's teacher RPCs (migrations/2026111120_markup_reflect_revise.sql).
 *
 * - The class's marks and reflections are read with list_course_feedback
 *   (and list_assessment_markup for a piece with marked pages) when the
 *   class loads with Send Work or Reflect on Feedback on, and the screens
 *   read them through the readers Demo Mode's use. With both off, or the
 *   student page off, nothing is asked and the writers answer as before.
 * - save_markup: a key, the rev the screen read, the piece's cell key;
 *   shown at once offline; two saves in a row go as one, with the first's
 *   base rev; another device's save first is answered changed.
 * - return_work in place of return_grades, one student to a call, after the
 *   student's saves; a student whose grade is already back gets a call of
 *   their own for the marks.
 * - answer_reflection: shown at once, one key, only_me false.
 * - set_course_feedback_options: shown at once, only what changed.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';
import { syntheticClass } from './eval-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = 'e0000000-0000-4000-8000-000000000001';
const id = n => 'e0000000-0000-4000-8000-' + String(n).padStart(12, '0');
const NOOR = id(100);
const MATEO = id(101);
const CAUSES = id(300);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const PAGE1 = 'f0000000-0000-4000-8000-000000000001';
const PAGE2 = 'f0000000-0000-4000-8000-000000000002';
const REFLECTION = 'f1000000-0000-4000-8000-000000000001';

let fake;
let original;
let course; // the class's course row
let work; // what list_course_submissions sends
let fb; // the server's marks, reflections and switches
let gradeRows; // what list_course_grade_returns sends

const setOnline = on => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
const callsTo = name => fake.calls.filter(c => c.name === name).map(c => c.params);
const pen = n => ({
  v: 1,
  marks: [
    {
      id: 'm' + n,
      type: 'pen',
      color: 'red',
      points: [
        [0.1, 0.1],
        [0.2, 0.2],
      ],
    },
  ],
});
const tick = (x, y) => ({ v: 1, marks: [{ id: 't1', type: 'tick', color: 'green', x, y }] });

function submission(sid, files) {
  return {
    id: 'f2000000-0000-4000-8000-000000000001',
    assessment_id: CAUSES,
    enrollment_id: sid,
    version: 1,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    is_late: false,
    note: null,
    created_at: '2026-11-05T17:40:00Z',
    sent_at: '2026-11-05T17:41:09Z',
    files: files.map((f, i) => ({
      id: f,
      page: i + 1,
      path: [CID, CAUSES, sid, 'sub', f].join('/') + '.jpg',
      thumb_path: [CID, CAUSES, sid, 'sub', f].join('/') + '-thumb.jpg',
      sha256: 'c'.repeat(64),
      added_by: 'student',
    })),
  };
}

const waiting = r => r.given_rev !== r.rev && r.marks.marks.length > 0;
const markRow = r => Object.assign({ waiting: waiting(r) }, r);

// The server's side, as the Batch C functions answer (the cases are in migrations/local-test/batch_c.py).
function installServer() {
  fake.on('get_class_bundle', () => {
    const bundle = syntheticClass();
    bundle.version = 1;
    Object.assign(bundle.gradebook.course, course);
    return { data: bundle, error: null };
  });
  fake.on('list_course_grade_returns', () => ({ data: structuredClone(gradeRows), error: null }));
  fake.on('list_course_submissions', () => ({ data: structuredClone(work), error: null }));
  fake.on('list_course_feedback', () => ({
    data: {
      course: { reflect_on_feedback: fb.reflect, show_my_learning: false },
      markup: Object.values(fb.marks).map(r => ({
        file_id: r.file_id,
        assessment_id: CAUSES,
        enrollment_id: r.enrollment_id,
        rev: r.rev,
        given_rev: r.given_rev,
        given_at: r.given_at,
        waiting: waiting(r),
      })),
      revisions: structuredClone(fb.revisions),
      reflections: fb.reflect ? structuredClone(fb.reflections) : [],
    },
    error: null,
  }));
  fake.on('list_assessment_markup', () => ({
    data: Object.values(fb.marks).map(r => markRow(structuredClone(r))),
    error: null,
  }));
  fake.on('save_markup', p => {
    const was = fb.marks[p.p_file_id];
    if (p.p_base_rev != null && (was ? was.rev : 0) !== p.p_base_rev) {
      return {
        data: { result: 'changed', file_id: p.p_file_id, rev: was ? was.rev : 0, marks: was && was.marks },
        error: null,
      };
    }
    const row = (fb.marks[p.p_file_id] = Object.assign(
      { file_id: p.p_file_id, enrollment_id: NOOR, given: null, given_rev: null, given_at: null },
      was,
      { rev: (was ? was.rev : 0) + 1, marks: p.p_marks, saved_at: '2026-11-11T20:00:00Z' },
    ));
    return {
      data: { result: 'saved', file_id: p.p_file_id, rev: row.rev, given_rev: row.given_rev, waiting: waiting(row) },
      error: null,
    };
  });
  fake.on('return_work', p => {
    const given = [];
    Object.values(fb.marks).forEach(r => {
      if (!p.p_enrollment_ids.includes(r.enrollment_id) || !waiting(r)) return;
      Object.assign(r, { given: r.marks, given_rev: r.rev, given_at: '2026-11-11T20:05:00Z' });
      given.push(r.enrollment_id);
    });
    return {
      data: {
        returned: 0,
        enrollment_ids: [],
        returned_at: null,
        marks_given: given.length,
        marks_enrollment_ids: given,
      },
      error: null,
    };
  });
  fake.on('answer_reflection', p => {
    const r = fb.reflections.find(x => x.id === p.p_reflection_id);
    if (!r) return { data: null, error: { code: 'P0002', message: 'reflection not found' } };
    if (r.answer) return { data: { result: 'already_answered', reflection: r }, error: null };
    Object.assign(r, { answer: p.p_answer, answered_at: '2026-11-11T20:10:00Z', waiting: false });
    return { data: { result: 'answered', reflection: r }, error: null };
  });
  fake.on('return_for_revision', p => {
    const open = fb.revisions.find(r => r.enrollment_id === p.p_enrollment_id && r.state === 'open');
    if (open) return { data: { result: 'already_open', request: open }, error: null };
    const row = {
      id: 'f3000000-0000-4000-8000-00000000000' + (fb.revisions.length + 1),
      assessment_id: p.p_assessment_id,
      enrollment_id: p.p_enrollment_id,
      what_to_fix: p.p_request.what_to_fix,
      revise_by: p.p_request.revise_by,
      criterion_ids: p.p_request.criterion_ids,
      keep_grade: true,
      grade_hidden: false,
      first_submission_id: null,
      first_version: 1,
      first_grade: null,
      first_returned_at: null,
      created_at: '2026-11-11T20:20:00Z',
      updated_at: '2026-11-11T20:20:00Z',
      closed_at: null,
      state: 'open',
      revision_submission_id: null,
      revision_version: null,
      revision_sent_at: null,
      revision_note: null,
      revision_late: null,
      revision_sent_by: null,
    };
    fb.revisions.push(row);
    return { data: { result: 'made', request: row, returned: {}, hidden: false }, error: null };
  });
  fake.on('set_revision_request', p => {
    const r = fb.revisions.find(x => x.id === p.p_request_id);
    if (!r) return { data: null, error: { code: 'P0002', message: 'revision request not found' } };
    if (r.state !== 'open') return { data: { result: 'not_open', request: r }, error: null };
    Object.assign(r, p.p_patch);
    return { data: { result: 'saved', request: r }, error: null };
  });
  fake.on('cancel_revision', p => {
    const r = fb.revisions.find(x => x.id === p.p_request_id);
    if (r.state !== 'open') return { data: { result: 'not_open', request: r }, error: null };
    Object.assign(r, { state: 'cancelled', closed_at: '2026-11-11T20:30:00Z' });
    return { data: { result: 'cancelled', request: r, unhidden: false }, error: null };
  });
  fake.on('set_course_feedback_options', p => {
    if ('reflect_on_feedback' in p.p_patch) fb.reflect = p.p_patch.reflect_on_feedback;
    return { data: { reflect_on_feedback: fb.reflect, show_my_learning: false }, error: null };
  });
}

async function openClass() {
  await initData(CID);
  await settle();
  await settle();
}
async function quiet() {
  for (let i = 0; i < 6; i++) {
    await window.v2Queue.flush();
    await settle();
  }
}

beforeEach(() => {
  original = {
    getSupabase: globalThis.getSupabase,
    useSupabase: _useSupabase,
    teacher: _teacherId,
    quiet: _REFRESH_QUIET_MS,
    wait: _MARKUP_SAVE_WAIT_MS,
  };
  _REFRESH_QUIET_MS = 0;
  _useSupabase = true;
  _supabaseDegraded = false;
  _teacherId = 'teacher-a';
  globalThis.__FV_CLASS_BUNDLE = true;
  localStorage.clear();
  course = {
    student_page_enabled: true,
    return_grades: 'on_return',
    send_work: true,
    keep_photos_until: 'end_of_year',
  };
  work = {
    bucket: 'student-photos',
    course: { send_work: true, keep_photos_until: 'end_of_year' },
    assessments: [
      {
        id: CAUSES,
        students_send: 'photos',
        after_due: 'keep',
        accept_until: null,
        group_work: 'each',
        students_see_markup: true,
      },
    ],
    submissions: [submission(NOOR, [PAGE1, PAGE2])],
    uploads: [],
  };
  gradeRows = {};
  fb = {
    reflect: true,
    revisions: [],
    marks: {
      [PAGE1]: {
        file_id: PAGE1,
        enrollment_id: NOOR,
        rev: 2,
        marks: pen(1),
        given: null,
        given_rev: null,
        given_at: null,
        saved_at: '2026-11-10T20:00:00Z',
      },
    },
    reflections: [
      {
        id: REFLECTION,
        assessment_id: CAUSES,
        enrollment_id: NOOR,
        makes_sense: 'not_sure',
        question: 'Why a 3 and not a 4?',
        plan: null,
        went_well: null,
        sent_at: '2026-11-09T18:00:00Z',
        answer: null,
        answered_at: null,
        note: null,
        noted_at: null,
        sense_now: null,
        follow_up: null,
        follow_up_answer: null,
        follow_up_note: null,
        waiting: true,
      },
    ],
  };
  fake = makeFakeSupabase();
  installServer();
  globalThis.getSupabase = () => fake;
  setOnline(true);
  window.v2Queue.clear();
  _workServer = {};
  _workCourseRow = {};
  _workRead = {};
  _fbCourseRow = {};
  _fbCourseHere = {};
  _fbServer = {};
  _fbRows = {};
  _fbRead = {};
  _fbWrites = {};
  _fbMemo = {};
  saveCourses({ [CID]: { id: CID, name: 'History 12' } });
  saveConfig({ activeCourse: CID });
});

afterEach(() => {
  if (_loadRetryTimer) clearTimeout(_loadRetryTimer);
  _loadRetryTimer = null;
  window.v2Queue.clear();
  globalThis.getSupabase = original.getSupabase;
  _useSupabase = original.useSupabase;
  _teacherId = original.teacher;
  _REFRESH_QUIET_MS = original.quiet;
  _MARKUP_SAVE_WAIT_MS = original.wait;
  globalThis.__FV_CLASS_BUNDLE = false;
  setOnline(true);
  localStorage.clear();
  delete _cache.students[CID];
  delete _classVersion[CID];
});

describe('reading a signed-in class’s marks and reflections', () => {
  it('reads them with the class when Send Work is on, and every reader answers from them', async () => {
    await openClass();
    expect(callsTo('list_course_feedback')).toEqual([{ p_course_id: CID }]);
    expect(callsTo('list_assessment_markup')).toEqual([{ p_assessment_id: CAUSES }]);
    expect(getPageMarkup(CID, PAGE1)).toMatchObject({ rev: 2, given: null, given_rev: null, waiting: true });
    // A handed-in page nobody has marked has rev 0.
    expect(getPageMarkup(CID, PAGE2)).toMatchObject({ rev: 0, waiting: false });
    expect(getAssessmentMarkup(CID, CAUSES).map(r => r.file_id)).toEqual([PAGE1]);
    expect(studentMarkupWaiting(CID, NOOR, CAUSES)).toBe(true);
    expect(getReflectOnFeedback(CID)).toBe(true);
    expect(getQuestionsWaiting(CID).map(r => [r.id, r.question, r.waiting])).toEqual([
      [REFLECTION, 'Why a 3 and not a 4?', true],
    ]);
    expect(getStudentReflections(CID, NOOR)).toHaveLength(1);
    expect(getCourseFeedbackOptions(CID)).toEqual({ reflect_on_feedback: true, show_my_learning: false });
  });

  it('what the student sees of the marks is the given copy only, and Students See Your Mark Up holds', async () => {
    fb.marks[PAGE1].given = tick(0.5, 0.5);
    fb.marks[PAGE1].given_rev = 1;
    await openClass();
    expect(getStudentMarkup(CID, NOOR, CAUSES).files.map(f => f.marks)).toEqual([tick(0.5, 0.5)]);
    expect(getStudentMarkCounts(CID, NOOR, CAUSES)).toEqual({ pages: 1, notes: 0 });
    work.assessments[0].students_see_markup = false;
    await refreshStudentWork(CID, { force: true });
    expect(getStudentMarkup(CID, NOOR, CAUSES).files).toEqual([]);
  });

  it('Preview as Student shows Reflect on Feedback from the server’s switch, and the marks the student was given', async () => {
    fb.marks[PAGE1].given = tick(0.5, 0.5);
    fb.marks[PAGE1].given_rev = 2;
    await openClass();
    const reply = StudentView.feedbackReply(CID, NOOR, { assessments: [{ id: CAUSES }] });
    expect(reply.reflect_on_feedback).toBe(true);
    expect(reply.assessments).toEqual([{ id: CAUSES, marks: { pages: 1, notes: 0 } }]);
    fb.reflect = false;
    await refreshCourseFeedback(CID, { force: true });
    expect(StudentView.feedbackReply(CID, NOOR, { assessments: [] }).reflect_on_feedback).toBe(false);
  });

  it('with Send Work and Reflect on Feedback both off, the class load asks nothing about feedback', async () => {
    course.send_work = false;
    work.course.send_work = false;
    fb.reflect = false;
    await openClass();
    await refreshStudentWork(CID, { force: true });
    expect(callsTo('list_course_feedback')).toEqual([]);
    expect(callsTo('list_assessment_markup')).toEqual([]);
    expect(getReflectOnFeedback(CID)).toBe(false);
  });

  it('a class whose student page is off is sent nothing, and its writers answer as before', async () => {
    course.student_page_enabled = false;
    await openClass();
    await refreshCourseFeedback(CID, { force: true });
    expect(await saveMarkup(CID, PAGE1, pen(2), 0, 'k1')).toEqual({ result: 'not_available' });
    expect(await answerReflection(CID, REFLECTION, 'Because…', 'k2')).toEqual({ result: 'not_available' });
    expect(await setCourseFeedbackOptions(CID, { reflect_on_feedback: true }, 'k3')).toEqual({
      result: 'not_available',
    });
    await window.v2Queue.flush();
    expect(fake.calls.map(c => c.name).filter(n => /markup|feedback|reflection|return_work/.test(n))).toEqual([]);
  });
});

describe('save_markup', () => {
  it('goes through the outbox with its key, the rev the screen read and the student’s cell key', async () => {
    await openClass();
    const key = 'c0000000-0000-4000-8000-000000000009';
    const res = await saveMarkup(CID, PAGE1, pen(2), 2, key);
    expect(res).toEqual({ result: 'saved', file_id: PAGE1, rev: 3, given: false });
    const [call] = callsTo('save_markup');
    expect(call).toEqual({ p_file_id: PAGE1, p_marks: pen(2), p_base_rev: 2, p_idempotency_key: key });
    // What landed is what the screen reads next, not what was read before.
    expect(getPageMarkup(CID, PAGE1)).toMatchObject({ rev: 3, marks: pen(2), waiting: true });
    await settle();
    expect(getPageMarkup(CID, PAGE1)).toMatchObject({ rev: 3, marks: pen(2) });
  });

  it('offline it shows at once; saves in a row go as one with the first’s base rev; they go when it is back', async () => {
    await openClass();
    _MARKUP_SAVE_WAIT_MS = 0;
    setOnline(false);
    const a = await saveMarkup(CID, PAGE1, pen(2), 2, 'k-a');
    const b = await saveMarkup(CID, PAGE1, pen(3), a.rev, 'k-b');
    expect([a.rev, b.rev]).toEqual([3, 4]);
    // The page shows the newest marks, and its rev is the one the save will make.
    expect(getPageMarkup(CID, PAGE1)).toMatchObject({ rev: 3, marks: pen(3) });
    expect(window.v2Queue.queued('save_markup')).toHaveLength(1);
    expect(getSyncDotState().status).toBe('error');
    setOnline(true);
    await quiet();
    const sent = callsTo('save_markup');
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ p_base_rev: 2, p_marks: pen(3) });
    expect(sent[0].p_idempotency_key).toMatch(UUID);
    expect(fb.marks[PAGE1].rev).toBe(3);
  });

  it('another device’s save first: the screen is told, and nothing is written', async () => {
    await openClass();
    fb.marks[PAGE1].rev = 5;
    fb.marks[PAGE1].marks = tick(0.4, 0.4);
    const res = await saveMarkup(CID, PAGE1, pen(2), 2, 'k-x');
    expect(res).toMatchObject({ result: 'changed', rev: 5, marks: tick(0.4, 0.4) });
    expect(fb.marks[PAGE1].marks).toEqual(tick(0.4, 0.4));
    await settle();
    expect(getPageMarkup(CID, PAGE1)).toMatchObject({ rev: 5, marks: tick(0.4, 0.4) });
  });

  it('a page still uploading, with a local id, has no marks and is sent nothing', async () => {
    await openClass();
    expect(getPageMarkup(CID, 'photo-queue:p1')).toBeNull();
    expect(await saveMarkup(CID, 'photo-queue:p1', pen(2), 0, 'k-l')).toEqual({ result: 'not_found' });
    expect(callsTo('save_markup')).toEqual([]);
  });
});

describe('Return with the marks', () => {
  it('a student whose grade is back and whose marks are waiting gets a return_work call of their own', async () => {
    await openClass();
    const out = returnWork(CID, CAUSES, [NOOR, MATEO]);
    expect(out).toMatchObject({ marks_given: 1, marks_enrollment_ids: [NOOR] });
    // Shown as given at once.
    expect(studentMarkupWaiting(CID, NOOR, CAUSES)).toBe(false);
    await quiet();
    const calls = callsTo('return_work');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ p_assessment_id: CAUSES, p_enrollment_ids: [NOOR] });
    expect(calls[0].p_idempotency_key).toMatch(UUID);
    expect(callsTo('return_grades')).toEqual([]);
    expect(fb.marks[PAGE1].given_rev).toBe(2);
    expect(studentMarkupWaiting(CID, NOOR, CAUSES)).toBe(false);
  });

  it('the grader’s Return is return_work in a signed-in class, one student to a call, after that student’s saves', async () => {
    gradeRows = { [CAUSES]: { [NOOR]: { is_draft: true }, [MATEO]: { is_draft: true } } };
    await openClass();
    expect(GraderWork.workOnInClass(CID)).toBe(true);
    _MARKUP_SAVE_WAIT_MS = 0;
    setOnline(false);
    await saveMarkup(CID, PAGE1, pen(3), 2, 'k-r');
    const out = Grader.returnGrades(CID, CAUSES, [NOOR, MATEO]);
    expect(out.enrollment_ids.sort()).toEqual([NOOR, MATEO].sort());
    expect(out.marks_enrollment_ids).toEqual([NOOR]);
    setOnline(true);
    await quiet();
    // The save went first, so the Return gave the marks the teacher left.
    expect(fake.calls.map(c => c.name).filter(n => /save_markup|return_work|return_grades/.test(n))).toEqual([
      'save_markup',
      'return_work',
      'return_work',
    ]);
    expect(
      callsTo('return_work')
        .flatMap(p => p.p_enrollment_ids)
        .sort(),
    ).toEqual([NOOR, MATEO].sort());
    expect(callsTo('return_grades')).toEqual([]);
    expect(fb.marks[PAGE1]).toMatchObject({ given_rev: 3, given: pen(3) });
  });
});

describe('Reflect on Feedback', () => {
  it('Send Answer goes with its key as a real answer, shows at once, and clears the question', async () => {
    await openClass();
    const key = 'c0000000-0000-4000-8000-000000000008';
    const res = await answerReflection(CID, REFLECTION, 'A 3 means you named the cause; a 4 weighs two.', key);
    expect(res.result).toBe('answered');
    expect(res.reflection).toMatchObject({
      id: REFLECTION,
      answer: 'A 3 means you named the cause; a 4 weighs two.',
      waiting: false,
    });
    expect(callsTo('answer_reflection')).toEqual([
      {
        p_reflection_id: REFLECTION,
        p_answer: 'A 3 means you named the cause; a 4 weighs two.',
        p_idempotency_key: key,
        p_only_me: false,
      },
    ]);
    expect(getQuestionsWaiting(CID)).toEqual([]);
    await settle();
    expect(getStudentReflections(CID, NOOR)[0].answer).toMatch(/^A 3 means/);
  });

  it('offline the answer shows at once and goes when it is back; a reflection that is not there is not found', async () => {
    await openClass();
    _MARKUP_SAVE_WAIT_MS = 0;
    setOnline(false);
    expect((await answerReflection(CID, REFLECTION, 'Because…', 'k-o')).result).toBe('answered');
    expect(getQuestionsWaiting(CID)).toEqual([]);
    expect(getSyncDotState().status).toBe('error');
    expect(await answerReflection(CID, 'f1000000-0000-4000-8000-0000000000ff', 'x', 'k-p')).toEqual({
      result: 'not_found',
    });
    setOnline(true);
    await quiet();
    expect(callsTo('answer_reflection')).toHaveLength(1);
    expect(fb.reflections[0].answer).toBe('Because…');
  });

  it('the class switch is shown at once and sent with only what changed', async () => {
    fb.reflect = false;
    await openClass();
    expect(getReflectOnFeedback(CID)).toBe(false);
    const done = setCourseFeedbackOptions(CID, { reflect_on_feedback: true }, 'k-s');
    expect(getReflectOnFeedback(CID)).toBe(true);
    expect(await done).toEqual({ reflect_on_feedback: true, show_my_learning: false });
    const [call] = callsTo('set_course_feedback_options');
    expect(call).toMatchObject({ p_course_id: CID, p_patch: { reflect_on_feedback: true } });
    expect(call.p_idempotency_key).toMatch(UUID);
    // Turned on, its reflections are read.
    await settle();
    expect(callsTo('list_course_feedback').length).toBeGreaterThan(0);
    expect(getReflectOnFeedback(CID)).toBe(true);
  });
});

describe('Return for Revision, its edit and Take Back (S7-W1)', () => {
  const ask = { what_to_fix: 'Label the graph.', revise_by: '2026-11-20', criterion_ids: [], keep_grade: true };

  it('shows only while Send Work is on; Return for Revision returns the work, then asks, with keys', async () => {
    await openClass();
    expect(revisionsOn(CID)).toBe(true);
    const key = 'c0000000-0000-4000-8000-000000000007';
    const done = returnForRevision(CID, NOOR, CAUSES, ask, key);
    // Shown open at once, and the work is "revising".
    expect(revisionWorkState(CID, NOOR, CAUSES)).toBe('revising');
    const res = await done;
    expect(res.result).toBe('made');
    expect(res.request).toMatchObject({ what_to_fix: 'Label the graph.', state: 'open', enrollment_id: NOOR });
    await quiet();
    const [call] = callsTo('return_for_revision');
    expect(call).toEqual({
      p_assessment_id: CAUSES,
      p_enrollment_id: NOOR,
      p_request: { what_to_fix: 'Label the graph.', revise_by: '2026-11-20', criterion_ids: [], keep_grade: true },
      p_idempotency_key: key,
    });
    // The work was returned first, as Return returns it: one student, one call, no return_grades.
    expect(callsTo('return_work').map(p => p.p_enrollment_ids)).toEqual([[NOOR]]);
    expect(callsTo('return_grades')).toEqual([]);
    expect(getRevisionRequest(CID, NOOR, CAUSES)).toMatchObject({ state: 'open', what_to_fix: 'Label the graph.' });
    expect(getCourseFeedback(CID).revisions).toHaveLength(1);
    // Another press answers already_open and sends nothing more.
    expect((await returnForRevision(CID, NOOR, CAUSES, ask, 'k-again')).result).toBe('already_open');
    expect(callsTo('return_for_revision')).toHaveLength(1);
  });

  it('a class with Send Work off has no revisions, and its writers answer as before', async () => {
    course.send_work = false;
    work.course.send_work = false;
    fb.reflect = false;
    await openClass();
    expect(revisionsOn(CID)).toBe(false);
    expect(await returnForRevision(CID, NOOR, CAUSES, ask, 'k1')).toEqual({ result: 'revisions_off' });
    expect(callsTo('return_for_revision')).toEqual([]);
  });

  it('Edit sends only what changed; Take Back cancels; both show at once and take the server’s answer', async () => {
    await openClass();
    await returnForRevision(CID, NOOR, CAUSES, ask, 'c0000000-0000-4000-8000-000000000006');
    await quiet();
    const id = getRevisionRequest(CID, NOOR, CAUSES).id;
    const saved = setRevisionRequest(
      CID,
      id,
      { what_to_fix: 'Label both axes.' },
      'c0000000-0000-4000-8000-000000000005',
    );
    expect(getRevisionRequest(CID, NOOR, CAUSES).what_to_fix).toBe('Label both axes.');
    expect((await saved).result).toBe('saved');
    expect(callsTo('set_revision_request')[0]).toMatchObject({
      p_request_id: id,
      p_patch: { what_to_fix: 'Label both axes.' },
    });
    const back = cancelRevision(CID, id, 'c0000000-0000-4000-8000-000000000004');
    expect(revisionWorkState(CID, NOOR, CAUSES)).toBeNull();
    expect(await back).toMatchObject({ result: 'cancelled', unhidden: false });
    expect(callsTo('cancel_revision')).toHaveLength(1);
    expect(callsTo('cancel_revision')[0].p_idempotency_key).toBe('c0000000-0000-4000-8000-000000000004');
    await quiet();
    expect(getRevisionRequest(CID, NOOR, CAUSES)).toMatchObject({ state: 'cancelled' });
  });

  it('offline, a Return for Revision shows open at once and goes when the device is back', async () => {
    await openClass();
    _MARKUP_SAVE_WAIT_MS = 0;
    setOnline(false);
    const res = await returnForRevision(CID, NOOR, CAUSES, ask, 'c0000000-0000-4000-8000-000000000003');
    expect(res.result).toBe('made');
    expect(revisionWorkState(CID, NOOR, CAUSES)).toBe('revising');
    // Not answered yet, so it has no server id to edit or take back.
    const pending = getRevisionRequest(CID, NOOR, CAUSES).id;
    expect(await cancelRevision(CID, pending, 'k-c')).toEqual({ result: 'failed' });
    expect(getSyncDotState().status).toBe('error');
    setOnline(true);
    await quiet();
    expect(callsTo('return_for_revision')).toHaveLength(1);
    expect(getRevisionRequest(CID, NOOR, CAUSES).id).toMatch(UUID);
  });
});
