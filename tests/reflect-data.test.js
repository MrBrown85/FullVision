/**
 * Reflect on Feedback on the client (S10), in Demo Mode (shared/data.js,
 * "Reflect on Feedback"; shared/seed-data.js, seedDemoReflections).
 *
 * The answers have the server's shapes (batch-c-contract.md, PR 1043, not
 * applied): set_course_feedback_options, list_course_feedback,
 * answer_reflection, and the student's feedback(...), reflect(...) and
 * reply(...).
 */
import './setup.js';
import { readFileSync, readdirSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
const NEXT = 'sci8a2';
const JORDAN = 'st10';
const NOOR = 'st2';
const LIAM = 'st4';
const CECE = 'st1';
let wasDemo;
let n = 0;
const key = () => 'k' + ++n;
const yes = { makes_sense: 'yes', plan: 'Next time I will check my labels.' };
const unsure = { makes_sense: 'not_sure', question: 'What is a cell wall?' };

function seedDemo() {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
}

function config(patch) {
  saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID) || {}, patch));
}
const turnOn = () => config({ student_page_enabled: true, reflect_on_feedback: true });
const reflectionOf = (sid, aid = LAB) =>
  getCourseFeedback(CID).reflections.find(r => r.enrollment_id === sid && r.assessment_id === aid);

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

describe('the switch', () => {
  it('is off by default, and while off nothing shows and nothing can be sent', () => {
    expect(getReflectOnFeedback(CID)).toBe(false);
    expect(getCourseFeedback(CID).reflections).toEqual([]);
    expect(getCourseFeedback(CID).course).toEqual({ reflect_on_feedback: false, show_my_learning: false });
    expect(getQuestionsWaiting(CID)).toEqual([]);
    expect(getStudentReflections(CID, JORDAN)).toEqual([]);
    expect(getStudentLastPlan(CID, LIAM)).toBeNull();
    const own = getStudentFeedback(CID, JORDAN);
    expect(own.reflect_on_feedback).toBe(false);
    expect(own.assessments.every(a => a.reflection === null)).toBe(true);
    expect(sendStudentReflection(CID, CECE, LAB, yes, CECE)).toEqual({ ok: false, error: 'reflect_off' });
  });

  it('needs the build switch as well', () => {
    config({ reflect_on_feedback: true });
    expect(getReflectOnFeedback(CID)).toBe(false);
    expect(getQuestionsWaiting(CID)).toEqual([]);
    turnOn();
    expect(getReflectOnFeedback(CID)).toBe(true);
  });

  it('setCourseFeedbackOptions writes only what it names', async () => {
    config({ student_page_enabled: true });
    expect(await setCourseFeedbackOptions(CID, { reflect_on_feedback: true }, key())).toEqual({
      reflect_on_feedback: true,
      show_my_learning: false,
    });
    expect(getReflectOnFeedback(CID)).toBe(true);
    expect(await setCourseFeedbackOptions(CID, { show_my_learning: true }, key())).toEqual({
      reflect_on_feedback: true,
      show_my_learning: true,
    });
    for (const bad of [null, {}, { reflect_on_feedback: 'yes' }, { other: true }]) {
      expect(await setCourseFeedbackOptions(CID, bad, key())).toEqual({ result: 'invalid' });
    }
    expect(await setCourseFeedbackOptions(CID, { reflect_on_feedback: false })).toEqual({ result: 'invalid' });
    expect(getReflectOnFeedback(CID)).toBe(true);
  });
});

describe('the sample, with the switch on', () => {
  beforeEach(turnOn);

  it('has three reflections in list_course_feedback’s shape, and one question waiting', () => {
    const all = getCourseFeedback(CID);
    expect(Object.keys(all).sort()).toEqual(['course', 'markup', 'reflections', 'revisions']);
    expect(all.revisions).toEqual([]);
    expect(all.markup.map(m => m.file_id).sort()).toEqual(['demo-sub-st10-sci8a1-p1', 'demo-sub-st2-sci8a1-p2']);
    expect(all.reflections.map(r => r.enrollment_id).sort()).toEqual([JORDAN, LIAM, NOOR].sort());
    all.reflections.forEach(r =>
      expect(Object.keys(r).sort()).toEqual(
        [
          'answer',
          'answered_at',
          'assessment_id',
          'enrollment_id',
          'follow_up',
          'follow_up_answer',
          'follow_up_answered_at',
          'id',
          'makes_sense',
          'plan',
          'question',
          'sense_now',
          'sense_now_at',
          'sent_at',
          'waiting',
          'went_well',
        ].sort(),
      ),
    );
    expect(getQuestionsWaiting(CID).map(r => r.enrollment_id)).toEqual([JORDAN]);
    expect(getStudentLastPlan(CID, LIAM)).toMatchObject({ assessment_id: LAB });
  });

  it('is seeded once', () => {
    seedDemoReflections();
    expect(getCourseFeedback(CID).reflections).toHaveLength(3);
  });
});

describe('a student’s reflection', () => {
  beforeEach(turnOn);

  it('is taken on returned work from the student themself', () => {
    const out = sendStudentReflection(CID, CECE, LAB, yes, CECE);
    expect(out.ok).toBe(true);
    expect(Object.keys(out.reflection)).not.toContain('enrollment_id');
    expect(out.reflection).toMatchObject({ makes_sense: 'yes', plan: yes.plan, question: null, answer: null });
    expect(reflectionOf(CECE).waiting).toBe(false);
  });

  it('only from its own student: another student, or none, is not_found', () => {
    expect(sendStudentReflection(CID, CECE, LAB, yes, JORDAN)).toEqual({ ok: false, error: 'not_found' });
    expect(sendStudentReflection(CID, CECE, LAB, yes)).toEqual({ ok: false, error: 'not_found' });
    expect(sendStudentReflection(CID, 'st99', LAB, yes, 'st99')).toEqual({ ok: false, error: 'not_found' });
    expect(sendStudentReflection(CID, CECE, 'nope', yes, CECE)).toEqual({ ok: false, error: 'not_found' });
    expect(reflectionOf(CECE)).toBeUndefined();
  });

  it('only on returned work', () => {
    saveAssessments(
      CID,
      getAssessments(CID).concat([{ id: 'sci8new', title: 'New Lab', date: '2025-11-20', tagIds: [] }]),
    );
    expect(sendStudentReflection(CID, CECE, 'sci8new', yes, CECE)).toEqual({ ok: false, error: 'not_returned' });
    // A draft never returned is not back; a draft over a returned grade is.
    _saveGradeReturns(CID, { [LAB]: { [CECE]: { is_draft: true } } });
    expect(sendStudentReflection(CID, CECE, LAB, yes, CECE)).toEqual({ ok: false, error: 'not_returned' });
    _saveGradeReturns(CID, { [LAB]: { [CECE]: { is_draft: true, returned_at: '2025-10-05T10:00:00.000Z' } } });
    expect(sendStudentReflection(CID, CECE, LAB, yes, CECE).ok).toBe(true);
  });

  it('refuses a wrong shape', () => {
    const bad = [
      null,
      { makes_sense: 'maybe', plan: 'x' },
      { makes_sense: 'not_sure' },
      { makes_sense: 'not_sure', question: '   ' },
      { makes_sense: 'yes' },
      { makes_sense: 'yes', plan: 'x'.repeat(1001) },
      { makes_sense: 'yes', plan: 'x', went_well: 7 },
    ];
    bad.forEach(r => expect(sendStudentReflection(CID, CECE, LAB, r, CECE)).toEqual({ ok: false, error: 'invalid' }));
    expect(sendStudentReflection(CID, CECE, LAB, { makes_sense: 'yes', plan: 'x'.repeat(1000) }, CECE).ok).toBe(true);
  });

  it('sent again before the answer takes the place of the first; the same twice is the same', () => {
    vi.useFakeTimers({ now: new Date('2025-10-06T10:00:00Z') });
    try {
      sendStudentReflection(CID, CECE, LAB, unsure, CECE);
      const first = reflectionOf(CECE);
      vi.setSystemTime(new Date('2025-10-06T11:00:00Z'));
      sendStudentReflection(CID, CECE, LAB, unsure, CECE);
      expect(reflectionOf(CECE)).toEqual(first);
      sendStudentReflection(CID, CECE, LAB, yes, CECE);
      const second = reflectionOf(CECE);
      expect(second.id).toBe(first.id);
      expect(second).toMatchObject({ makes_sense: 'yes', question: null, sent_at: '2025-10-06T11:00:00.000Z' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('cannot be changed once answered', async () => {
    await answerReflection(CID, reflectionOf(JORDAN).id, 'Look at the shape.', key());
    expect(sendStudentReflection(CID, JORDAN, LAB, yes, JORDAN)).toEqual({ ok: false, error: 'already_answered' });
  });
});

describe('the teacher’s answer', () => {
  beforeEach(turnOn);

  it('clears the question everywhere it shows, and leaves the student’s words as they were', async () => {
    const before = reflectionOf(JORDAN);
    expect(getQuestionsWaiting(CID)).toHaveLength(1);
    expect(getQuestionsWaiting(CID, JORDAN)).toHaveLength(1);
    expect(getStudentReflections(CID, JORDAN)[0].waiting).toBe(true);
    const out = await answerReflection(CID, before.id, 'An onion cell has a wall and a regular shape.', key());
    expect(out.result).toBe('answered');
    expect(out.reflection).toMatchObject({ answer: 'An onion cell has a wall and a regular shape.', waiting: false });
    expect(getQuestionsWaiting(CID)).toEqual([]);
    expect(getQuestionsWaiting(CID, JORDAN)).toEqual([]);
    expect(getStudentReflections(CID, JORDAN)[0].waiting).toBe(false);
    expect(reflectionOf(JORDAN)).toMatchObject({ question: before.question, makes_sense: before.makes_sense });
    expect(getStudentFeedback(CID, JORDAN).assessments.find(a => a.id === LAB).reflection.answer).toContain('onion');
  });

  it('answers the follow-up next, then nothing more', async () => {
    const id = reflectionOf(NOOR).id;
    expect(await answerReflection(CID, id, 'Again?', key())).toEqual({ result: 'already_answered' });
    // Noor's sample already said it makes sense now, so a fresh one asks.
    sendStudentReflection(CID, CECE, LAB, unsure, CECE);
    const cece = reflectionOf(CECE).id;
    await answerReflection(CID, cece, 'A wall is the stiff outer layer.', key());
    expect(
      sendStudentReply(CID, CECE, LAB, { sense_now: 'not_sure', follow_up: 'Do animal cells have one?' }, CECE).ok,
    ).toBe(true);
    expect(getQuestionsWaiting(CID, CECE)).toHaveLength(1);
    const two = await answerReflection(CID, cece, 'No, only plant cells.', key());
    expect(two.reflection).toMatchObject({ follow_up_answer: 'No, only plant cells.', waiting: false });
    expect(getQuestionsWaiting(CID, CECE)).toEqual([]);
    expect(await answerReflection(CID, cece, 'More.', key())).toEqual({ result: 'already_answered' });
  });

  it('is idempotent, and refuses a wrong answer or a reflection not found', async () => {
    const id = reflectionOf(JORDAN).id;
    const k = key();
    const first = await answerReflection(CID, id, 'Look at the shape.', k);
    expect(await answerReflection(CID, id, 'Look at the shape.', k)).toEqual(first);
    expect(await answerReflection(CID, id, '', key())).toEqual({ result: 'invalid' });
    expect(await answerReflection(CID, id, 'x'.repeat(2001), key())).toEqual({ result: 'invalid' });
    expect(await answerReflection(CID, id, 'x')).toEqual({ result: 'invalid' });
    expect(await answerReflection(CID, 'nope', 'x', key())).toEqual({ result: 'not_found' });
  });
});

describe('Does It Make Sense Now?', () => {
  beforeEach(turnOn);

  it('waits for an answer, takes one follow-up, and only with Not Sure', async () => {
    expect(sendStudentReply(CID, CECE, LAB, { sense_now: 'yes' }, CECE)).toEqual({ ok: false, error: 'not_found' });
    expect(sendStudentReply(CID, JORDAN, LAB, { sense_now: 'yes' }, JORDAN)).toEqual({
      ok: false,
      error: 'not_answered',
    });
    await answerReflection(CID, reflectionOf(JORDAN).id, 'Look at the shape.', key());
    expect(sendStudentReply(CID, JORDAN, LAB, { sense_now: 'yes', follow_up: 'Hm' }, JORDAN)).toEqual({
      ok: false,
      error: 'invalid',
    });
    expect(sendStudentReply(CID, JORDAN, LAB, { sense_now: 'sure' }, JORDAN)).toEqual({ ok: false, error: 'invalid' });
    expect(sendStudentReply(CID, JORDAN, LAB, { sense_now: 'not_sure', follow_up: 'Which shape?' }, NOOR)).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(sendStudentReply(CID, JORDAN, LAB, { sense_now: 'not_sure', follow_up: 'Which shape?' }, JORDAN).ok).toBe(
      true,
    );
    expect(sendStudentReply(CID, JORDAN, LAB, { sense_now: 'yes' }, JORDAN)).toEqual({
      ok: false,
      error: 'already_asked',
    });
  });
});

describe('the plan on the next piece', () => {
  beforeEach(turnOn);

  it('work sent before the reflection is not the next piece', async () => {
    const sent = Date.parse(getStudentLastPlan(CID, LIAM).sent_at);
    vi.useFakeTimers({ now: new Date(sent - 86400000) });
    try {
      await markStudentWorkOnPaper(CID, NEXT, [LIAM]);
    } finally {
      vi.useRealTimers();
    }
    expect(getStudentSubmission(CID, LIAM, NEXT)).not.toBeNull();
    expect(getStudentReflections(CID, LIAM)[0].next).toBeNull();
  });

  it('is Your Plan From Last Time, and "Did You Do It?" is kept on the next piece’s work', async () => {
    expect(getStudentFeedback(CID, LIAM).last_plan).toEqual(getStudentLastPlan(CID, LIAM));
    expect(getStudentLastPlan(CID, LIAM).plan).toContain('magnification');
    expect(getStudentReflections(CID, LIAM)[0].next).toBeNull();
    await markStudentWorkOnPaper(CID, NEXT, [LIAM]);
    expect(getStudentReflections(CID, LIAM)[0].next).toEqual({ assessment_id: NEXT, followed_plan: null });
    const saved = await setStudentFollowedPlan(CID, LIAM, NEXT, 'partly');
    expect(saved.result).toBe('saved');
    expect(saved.submission.followed_plan).toBe('partly');
    expect(getStudentReflections(CID, LIAM)[0].next).toEqual({ assessment_id: NEXT, followed_plan: 'partly' });
    expect(await setStudentFollowedPlan(CID, LIAM, NEXT, 'maybe')).toEqual({ result: 'invalid' });
    expect(await setStudentFollowedPlan(CID, CECE, NEXT, 'yes')).toEqual({ result: 'nothing_sent' });
    expect(await setStudentFollowedPlan(CID, 'st99', NEXT, 'yes')).toEqual({ result: 'not_found' });
  });
});

describe('only the teacher reads them', () => {
  beforeEach(turnOn);

  it('a student’s own feedback carries their reflection only, with no ids', () => {
    const own = getStudentFeedback(CID, JORDAN);
    expect(Object.keys(own).sort()).toEqual(
      ['assessments', 'last_plan', 'ok', 'reflect_on_feedback', 'show_my_learning', 'v'].sort(),
    );
    const lab = own.assessments.find(a => a.id === LAB);
    expect(lab.marks).toEqual({ pages: 1, notes: 3 });
    expect(lab.reflection.question).toContain('which cell');
    const text = JSON.stringify(own);
    ['Why is the cheek cell wrong', 'magnification beside', 'demo-rf-', NOOR, LIAM].forEach(s =>
      expect(text).not.toContain(s),
    );
    expect(getStudentFeedback(CID, CECE).assessments).toEqual([]);
  });

  it('nothing a family reads, and nothing the student page builds, reads the teacher’s lists', () => {
    const family = readdirSync('teacher')
      .filter(f => /^(report|page-reports|qr-slips|myed)/.test(f) && f.endsWith('.js'))
      .map(f => 'teacher/' + f)
      .concat(['shared/phone-report-view.js', 'shared/student-view.js']);
    const teacherOnly = /\b(getCourseFeedback|getQuestionsWaiting|getStudentReflections|answerReflection)\b/;
    const reflections = /\b(getStudentFeedback|getStudentLastPlan|sendStudentReflection)\b/;
    family.forEach(f => {
      let src = '';
      try {
        src = readFileSync(f, 'utf-8');
      } catch {
        return;
      }
      expect(src, f).not.toMatch(teacherOnly);
      if (f !== 'shared/student-view.js') expect(src, f).not.toMatch(reflections);
    });
  });
});

describe('a class the server keeps no student-page rows for', () => {
  it('reads nothing, answers not_available, stores nothing and calls nothing', async () => {
    turnOn();
    window.isDemoMode = () => false;
    const rpc = vi.fn();
    globalThis.getSupabase = rpc;
    const before = localStorage.getItem('gb-student-feedback-' + CID);
    expect(getReflectOnFeedback(CID)).toBe(false);
    expect(getCourseFeedback(CID)).toEqual({
      course: { reflect_on_feedback: false, show_my_learning: false },
      markup: [],
      revisions: [],
      reflections: [],
    });
    expect(getQuestionsWaiting(CID)).toEqual([]);
    expect(getStudentFeedback(CID, JORDAN).assessments).toEqual([]);
    expect(await setCourseFeedbackOptions(CID, { reflect_on_feedback: true }, key())).toEqual({
      result: 'not_available',
    });
    expect(await answerReflection(CID, 'demo-rf-st10-sci8a1', 'x', key())).toEqual({ result: 'not_available' });
    expect(sendStudentReflection(CID, CECE, LAB, yes, CECE)).toEqual({ ok: false, error: 'not_available' });
    expect(sendStudentReply(CID, CECE, LAB, { sense_now: 'yes' }, CECE)).toEqual({ ok: false, error: 'not_available' });
    expect(await setStudentFollowedPlan(CID, LIAM, LAB, 'yes')).toEqual({ result: 'not_available' });
    expect(saveDemoReflections(CID, [])).toBe(false);
    expect(localStorage.getItem('gb-student-feedback-' + CID)).toBe(before);
    expect(rpc).not.toHaveBeenCalled();
    delete globalThis.getSupabase;
  });

  it('data.js names the Reflect on Feedback functions at call sites the drift check can read (S10-W1)', () => {
    const src = [
      'shared/data.js',
      'shared/data-student-work.js',
      'shared/data-feedback-live.js',
      'shared/data-markup.js',
      'shared/data-reflect.js',
      'shared/data-revisions.js',
    ]
      .map(f => readFileSync(f, 'utf-8'))
      .join('\n');
    expect(src.match(/_writeRpc\(\s*'set_course_feedback_options'/g).length).toBe(1);
    expect(src.match(/_writeRpc\(\s*'answer_reflection'/g).length).toBe(1);
    expect(src.match(/_callRpcWithAuthGuard\(\s*'list_course_feedback'/g).length).toBe(1);
  });
});
