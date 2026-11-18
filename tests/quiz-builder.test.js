/**
 * The Quiz card on the assessment form (teacher/quiz-builder.js, slice Q2b
 * of docs/plans/quizzes-plan.md; board "Quizzes Artboard", Board 1).
 *
 * 1. With the quizzes switch off the form is byte for byte what it was:
 *    tests/fixtures/quiz-switch-off.json holds the form as origin/main drew
 *    it (commit 24c12a66, before Q2b), in its states (new, with Send Work
 *    off and on, after Yes, Photos, an edit of Points work, the Student Page
 *    off; in Demo Mode and signed in), with the localStorage keys each walk
 *    left and the server calls it made. It was written by this file's own
 *    walk on that commit, with only this file and its fixture added:
 *      UPDATE_QUIZ_SNAPSHOT=1 npx vitest run tests/quiz-builder.test.js
 *    Run that only on code from before a change the form is meant to keep
 *    out; never to make a failing comparison pass.
 * 2. With it on: They Answer a Quiz on the Student Work card, the card's
 *    model (each kind, the key, points, a competency, validation), the
 *    round trip through save and reopen, Points kept equal to the quiz's
 *    total, Students Send kept at Nothing, the scoring a new quiz starts on,
 *    and that Duplicate does not carry a quiz.
 */
import './setup.js';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInThisContext } from 'node:vm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  U,
  signIn,
  seedClass,
  clearClass,
  click,
  fire,
  key,
  tick,
  openAssignments,
  closePages,
  serverSaysStudentPageOn,
} from './helpers/pin-save-paths.js';

const SNAPSHOT = join(new URL('.', import.meta.url).pathname, 'fixtures', 'quiz-switch-off.json');
const UPDATE = process.env.UPDATE_QUIZ_SNAPSHOT === '1';

const CID = U(1);
const AVA = U(11);
const T1 = U(41);
const T2 = U(42);
const ESSAY = U(31);
const POINTS = U(32);

function seedWith(config, extra) {
  return () => {
    seedClass(CID, {
      students: [{ id: AVA, firstName: 'Ava', lastName: 'Adams' }],
      learningMaps: {
        subjects: [],
        sections: [
          { id: U(51), name: 'Question', tags: [{ id: T1, label: 'Questioning', code: 'QP1', text: 'Ask questions' }] },
          {
            id: U(52),
            name: 'Patterns',
            tags: [{ id: T2, label: 'Data Patterns', code: 'PA4', text: 'Find patterns' }],
          },
        ],
        _customized: true,
        _version: 1,
        _flatVersion: 2,
      },
      assessments: [
        { id: ESSAY, title: 'Essay', tagIds: [T1], date: '2026-10-10', type: 'summative' },
        { id: POINTS, title: 'Points Check', scoreMode: 'points', maxPoints: 10, tagIds: [T1], date: '2026-10-11' },
      ],
      courseConfigs: config || {},
      ...(extra || {}),
    });
    // The page's mount clears localStorage: the switch is set after it.
    if (SWITCH_ON) localStorage.setItem('fv-build-quizzes', '1');
  };
}
let SWITCH_ON = false;

const settled = () => new Promise(r => setTimeout(r, 10));
const form = () => document.getElementById('new-assess-form');

async function openNew(seed) {
  openAssignments(seed, CID);
  await settled();
  click(document.querySelector('[data-action="showNewForm"]'));
  await settled();
}
async function openEdit(seed, aid) {
  openAssignments(seed, CID);
  await settled();
  click(document.querySelector('[data-action="editAssess"][data-aid="' + aid + '"]'));
  await settled();
}

/* ── 1. The switch off ─────────────────────────────────────── */

/* Every state of the form this walk draws, as HTML, with the keys and calls. */
async function walk(demo, calls) {
  const out = {};
  const take = name => {
    out[name] = form().innerHTML;
  };
  const page = { student_page_enabled: true, return_grades: 'on_return' };
  const close = () => {
    closePages();
    clearClass(CID);
  };
  const sendWork = on => {
    if (demo) setCourseSendWork(CID, { send_work: on });
  };

  await openNew(seedWith(page));
  sendWork(false);
  close();
  await openNew(seedWith(page));
  take('new, Student Page on');
  close();
  if (demo) {
    await openNew(() => {
      seedWith(page)();
      sendWork(true);
    });
    take('new, Send Work on');
    click(form().querySelector('[data-field="students_send"][data-value="photos"]'));
    await settled();
    take('new, Send Work on, Yes, Photos');
    close();
    await openEdit(() => {
      seedWith(page)();
      sendWork(true);
    }, POINTS);
    take('edit Points work, Send Work on');
    close();
  }
  await openEdit(seedWith(page), ESSAY);
  take('edit, Student Page on');
  close();
  await openNew(seedWith({}));
  take('new, Student Page off');
  close();
  out.keys = Object.keys(localStorage._store).sort().join(' ');
  if (calls) out.calls = calls().join(' ');
  return out;
}

describe('with the quizzes switch off the form is what it was', () => {
  let wasDemo;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T18:00:00.000Z'));
    wasDemo = window.isDemoMode;
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    serverSaysStudentPageOn(CID, false);
    localStorage.clear();
  });

  const demoWalk = () => {
    window.isDemoMode = () => true;
    return walk(true);
  };
  const signedInWalk = async () => {
    window.isDemoMode = () => false;
    const session = signIn();
    try {
      serverSaysStudentPageOn(CID, true);
      return await walk(false, () => session.fake.calls.map(c => c.name).filter(n => /quiz/.test(n)));
    } finally {
      session.signOut();
    }
  };

  if (UPDATE) {
    it('writes the snapshot (run on the code from before the change)', async () => {
      const demo = await demoWalk();
      localStorage.clear();
      const snap = { demo, signedIn: await signedInWalk() };
      writeFileSync(SNAPSHOT, JSON.stringify(snap, null, 2) + '\n');
    });
    return;
  }
  const before = existsSync(SNAPSHOT) ? JSON.parse(readFileSync(SNAPSHOT, 'utf-8')) : {};

  it('has the snapshot', () => {
    expect(Object.keys(before.demo || {})).toHaveLength(7);
    expect(Object.keys(before.signedIn || {})).toHaveLength(5);
  });

  it('in Demo Mode: every state, and the keys left', async () => {
    const now = await demoWalk();
    Object.keys(before.demo).forEach(name => expect(now[name], name).toBe(before.demo[name]));
    expect(Object.keys(now)).toEqual(Object.keys(before.demo));
  });

  it('signed in with the server’s student page on: every state, the keys, and no quiz call', async () => {
    const now = await signedInWalk();
    Object.keys(before.signedIn).forEach(name => expect(now[name], name).toBe(before.signedIn[name]));
    expect(now.calls).toBe('');
  });

  it('the seed adds nothing to Demo Mode with the switch off', () => {
    window.isDemoMode = () => true;
    const seedDemoQuiz = runInThisContext(
      '(function () {\n' + readFileSync('shared/seed-data.js', 'utf-8') + '\nreturn seedDemoQuiz;\n})()',
    );
    COURSES.sci8 = { id: 'sci8', name: 'Science 8' };
    expect(seedDemoQuiz()).toBe(false);
    delete COURSES.sci8;
    expect(Object.keys(localStorage._store).filter(k => /quiz/.test(k))).toEqual([]);
  });
});

/* ── 2. The switch on ──────────────────────────────────────── */

describe('with the quizzes switch on, in Demo Mode', () => {
  let wasDemo;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-18T18:00:00.000Z'));
    wasDemo = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    localStorage.setItem('fv-build-quizzes', '1');
    SWITCH_ON = true;
  });
  afterEach(() => {
    closePages();
    clearClass(CID);
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    localStorage.clear();
    SWITCH_ON = false;
  });

  const page = { student_page_enabled: true, return_grades: 'on_return' };
  const mount = () => document.getElementById('quiz-mount');
  const model = () => QuizBuilder._model();
  const q = i => model().qs[i];
  const edit = k => mount().querySelector('.quiz-edit[data-k="' + k + '"]');
  const type = (el, text) => {
    el.value = text;
    fire(el, 'input');
  };
  // linkedom's <select> has no value setter: the option is marked instead.
  const pick = (sel, value) => {
    sel.querySelectorAll('option').forEach(o => {
      if (o.getAttribute('value') === value) o.setAttribute('selected', '');
      else o.removeAttribute('selected');
    });
    fire(sel, 'change');
  };
  const choose = el => {
    el.checked = true;
    fire(el, 'change');
  };

  // The saved piece's form again, on the same page (a new page would clear Demo Mode's store).
  async function reopen(aid) {
    click(document.querySelector('[data-action="editAssess"][data-aid="' + aid + '"]'));
    await settled();
  }

  async function newQuiz(seed) {
    await openNew(seed || seedWith(page));
    const title = form().querySelector('#af-title');
    title.value = 'Food Webs Check';
    fire(title, 'input');
    tick(form().querySelector('.af-tag-cb[value="' + T1 + '"]'), true);
    tick(form().querySelector('.af-tag-cb[value="' + T2 + '"]'), true);
    await settled();
    click(mount().querySelector('[data-quiz-act="answer"][data-value="quiz"]'));
    await settled();
  }

  /* Writes one question of every kind through the card, as a teacher does. */
  function writeQuiz() {
    // 1: Choice, the question They Answer a Quiz started with.
    let e = edit(q(0).k);
    type(e.querySelector('.quiz-prompt'), 'Which is a producer?');
    const texts = () => edit(q(0).k).querySelectorAll('.quiz-choice-text');
    type(texts()[0], 'Grass');
    key(texts()[0], 'Enter');
    type(texts()[1], 'Hawk');
    type(texts()[2], 'Fox');
    choose(edit(q(0).k).querySelectorAll('.quiz-key')[0]);
    // 2: True or False.
    click(mount().querySelector('[data-quiz-act="add"]'));
    e = edit(q(1).k);
    pick(e.querySelector('.rb-kind'), 'true_false');
    type(edit(q(1).k).querySelector('.quiz-prompt'), 'A hawk is a producer.');
    choose(edit(q(1).k).querySelector('[data-quiz-tf="False"]'));
    // 3: Number, within 0.1.
    click(mount().querySelector('[data-quiz-act="add"]'));
    e = edit(q(2).k);
    pick(e.querySelector('.rb-kind'), 'number');
    e = edit(q(2).k);
    type(e.querySelector('.quiz-prompt'), 'Average height at week 4, in cm?');
    type(e.querySelector('[data-quiz-f="answer"]'), '12.5');
    type(e.querySelector('[data-quiz-f="within"]'), '0.1');
    type(e.querySelector('[data-quiz-f="points"]'), '2');
    const tag = e.querySelector('[data-quiz-f="tag"]');
    pick(tag, '');
    // 4: Text.
    click(mount().querySelector('[data-quiz-act="add"]'));
    e = edit(q(3).k);
    pick(e.querySelector('.rb-kind'), 'text');
    type(edit(q(3).k).querySelector('.quiz-prompt'), 'What would you test next?');
  }

  it('the Student Work card: with Send Work off, No and They Answer a Quiz of its own', async () => {
    await openNew(seedWith(page));
    expect(form().querySelector('.af-card-work')).toBeNull();
    const own = mount().querySelector('.quiz-work');
    expect(Array.from(own.querySelectorAll('.seg-btn')).map(b => b.textContent)).toEqual(['No', 'They Answer a Quiz']);
    expect(own.querySelector('[aria-checked="true"]').textContent).toBe('No');
    expect(mount().querySelector('.quiz-card')).toBeNull();
  });

  it('with Send Work on, the fourth answer; Students Send stays Nothing for a quiz', async () => {
    await openNew(() => {
      seedWith(page)();
      setCourseSendWork(CID, { send_work: true });
    });
    const answers = () => Array.from(form().querySelectorAll('[data-field="students_send"]'));
    expect(answers().map(b => b.textContent)).toEqual([
      'No',
      'Yes, Photos',
      'Yes, Photos or PDFs',
      'They Answer a Quiz',
    ]);
    expect(mount().querySelector('.quiz-work')).toBeNull();
    click(form().querySelector('[data-field="students_send"][data-value="photos"]'));
    click(form().querySelector('[data-field="students_send"][data-value="quiz"]'));
    await settled();
    const on = form().querySelector('[data-field="students_send"][aria-checked="true"]');
    expect(on.textContent).toBe('They Answer a Quiz');
    expect(document.activeElement).toBe(on);
    expect(mount().querySelector('.quiz-card')).not.toBeNull();
    // The photo questions go: a quiz piece takes no photos.
    expect(form().querySelectorAll('[data-work-row]')).toHaveLength(1);
    const title = form().querySelector('#af-title');
    title.value = 'Quick Check';
    fire(title, 'input');
    tick(form().querySelector('.af-tag-cb[value="' + T1 + '"]'), true);
    type(edit(q(0).k).querySelector('.quiz-prompt'), 'Which is a producer?');
    const texts = edit(q(0).k).querySelectorAll('.quiz-choice-text');
    type(texts[0], 'Grass');
    type(texts[1], 'Hawk');
    choose(edit(q(0).k).querySelectorAll('.quiz-key')[0]);
    click(form().querySelector('.af-actions .btn-primary'));
    await settled();
    const made = getAssessments(CID).find(a => a.title === 'Quick Check');
    expect(made).toBeTruthy();
    expect(getAssessmentStudentWork(CID, made.id).students_send).toBe('nothing');
    expect(QuizData.get(CID, made.id).questions).toHaveLength(1);
  });

  it('a new quiz starts on Competencies in a Proficiency class', async () => {
    await newQuiz();
    expect(form().querySelector('#af-scoremode').value).toBe('competencies');
  });

  it('a new quiz starts on Points in a Letter class', async () => {
    await newQuiz(() => {
      seedWith(page)();
      COURSES[CID].gradingSystem = 'letter';
    });
    expect(form().querySelector('#af-scoremode').value).toBe('points');
  });

  it('Rubric or Complete/Incomplete: the card says why in a sentence, and the save stops', async () => {
    await newQuiz();
    writeQuiz();
    click(form().querySelector('.af-scoremode-btn[data-mode="complete"]'));
    await settled();
    expect(mount().querySelector('#quiz-why').textContent).toBe(
      'A quiz is scored by Competencies or Points. Choose one of them under Scoring, or another answer above.',
    );
    const n = getAssessments(CID).length;
    expect(QuizBuilder.formOk()).toBe(false);
    expect(getAssessments(CID)).toHaveLength(n);
  });

  it('each kind, its key, points and a competency go into the payload as the contract sets it', async () => {
    await newQuiz();
    writeQuiz();
    const p = QuizBuilder._payload();
    expect(p).toMatchObject({
      shuffle_questions: true,
      shuffle_choices: true,
      tries: 1,
      counts: 'best',
      shows: 'answers',
      add_total: false,
      after_due: 'keep',
      accept_until: null,
    });
    const [choice, tf, num, text] = p.questions;
    expect(choice).toMatchObject({ kind: 'choice', prompt: 'Which is a producer?', multiple: false, points: 1 });
    expect(choice.choices.map(c => c.text)).toEqual(['Grass', 'Hawk', 'Fox']);
    choice.choices.forEach(c => expect(c.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab]/));
    expect(choice.key).toEqual({ answer: [choice.choices[0].id], tolerance: null, why: null });
    // A new question starts on the competency with the fewest questions.
    expect([T1, T2]).toContain(choice.tag_id);
    expect(tf).toMatchObject({ kind: 'true_false', key: { answer: false, tolerance: null, why: null } });
    expect(num).toMatchObject({ kind: 'number', points: 2, tag_id: null, key: { answer: 12.5, tolerance: 0.1 } });
    expect(text).toMatchObject({ kind: 'text', key: { answer: null, tolerance: null, why: null } });
    expect(QuizData.problem(p, [T1, T2])).toBeNull();
  });

  it('Multiple Answers: every right answer, sorted as the server sorts, and the hint says all or nothing', async () => {
    await newQuiz();
    writeQuiz();
    click(mount().querySelector('.quiz-row[data-k="' + q(0).k + '"]'));
    click(edit(q(0).k).querySelector('[data-quiz-act="multiple"]'));
    expect(edit(q(0).k).textContent).toContain(
      'Several are right. A student gets the points only by choosing every right answer and no other.',
    );
    const boxes = edit(q(0).k).querySelectorAll('.quiz-key');
    expect(boxes[0].type).toBe('checkbox');
    choose(boxes[1]);
    const c = QuizBuilder._payload().questions[0];
    expect(c.multiple).toBe(true);
    expect(c.key.answer).toEqual([c.choices[0].id, c.choices[1].id].sort());
  });

  it('validation: a Choice with no right answer, a Number with no answer, no words, points out of range', async () => {
    await newQuiz();
    const Q = {
      k: 'x',
      kind: 'choice',
      prompt: '',
      choices: [
        { id: 'a', text: 'A' },
        { id: 'b', text: '' },
      ],
      multiple: false,
      points: '1.5',
      answer: [],
      within: '',
      why: '',
    };
    expect(QuizBuilder._problems(Q)).toEqual([
      { field: 'prompt', text: 'Write the question.' },
      { field: 'choices', text: 'Write each choice, or remove the empty one.' },
      { field: 'answer', text: 'Choose the right answer.' },
      { field: 'points', text: 'Points are a whole number from 0 to 100.' },
    ]);
    const N = { ...Q, kind: 'number', prompt: 'How tall?', answer: '', points: '101' };
    expect(QuizBuilder._problems(N)).toEqual([
      { field: 'answer', text: 'Write the right answer.' },
      { field: 'points', text: 'Points are a whole number from 0 to 100.' },
    ]);
    expect(QuizBuilder._problems({ ...N, answer: 'twelve', points: '0' })).toEqual([
      { field: 'answer', text: 'The right answer is a number, like 12.5.' },
    ]);
    expect(QuizBuilder._problems({ ...N, answer: '-3.5', within: '-1', points: '100' })).toEqual([
      { field: 'within', text: 'Within is a number of 0 or more. Leave it blank for exactly.' },
    ]);
    expect(QuizBuilder._problems({ ...Q, kind: 'true_false', prompt: 'x', points: '2', answer: null })).toEqual([
      { field: 'answer', text: 'Choose True or False.' },
    ]);
  });

  it('a save with a Choice that has no right answer stops at it, says so beside it, and saves nothing', async () => {
    await newQuiz();
    type(edit(q(0).k).querySelector('.quiz-prompt'), 'Which is a producer?');
    const texts = edit(q(0).k).querySelectorAll('.quiz-choice-text');
    type(texts[0], 'Grass');
    type(texts[1], 'Hawk');
    const n = getAssessments(CID).length;
    click(form().querySelector('.af-actions .btn-primary'));
    await settled();
    expect(getAssessments(CID)).toHaveLength(n);
    const e = edit(q(0).k);
    expect(e.querySelector('.quiz-err').textContent).toBe('Choose the right answer.');
    expect(e.querySelector('.quiz-key').getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(e.querySelector('.quiz-key'));
    // No banner: the sentence is beside the choices, nowhere else.
    expect(document.querySelectorAll('.quiz-err')).toHaveLength(1);
  });

  it('the round trip: saved, closed and opened again, every field is as written', async () => {
    await newQuiz();
    writeQuiz();
    click(mount().querySelector('[data-quiz-act="set"][data-quiz-set="tries"][data-value="2"]'));
    click(mount().querySelector('[data-quiz-act="set"][data-quiz-set="counts"][data-value="latest"]'));
    click(mount().querySelector('[data-quiz-act="toggle"][data-quiz-set="shuffle_choices"]'));
    click(mount().querySelector('[data-quiz-act="toggle"][data-quiz-set="add_total"]'));
    choose(mount().querySelector('[data-quiz-sees="right"]'));
    const sent = QuizBuilder._payload();
    click(form().querySelector('.af-actions .btn-primary'));
    await settled();
    const made = getAssessments(CID).find(a => a.title === 'Food Webs Check');
    expect(made).toBeTruthy();
    await reopen(made.id);
    expect(QuizBuilder.picked()).toBe(true);
    expect(QuizBuilder.snapshot()).toBe('');
    const back = QuizBuilder._payload();
    back.questions.forEach(x => delete x.id);
    expect(back).toEqual(sent);
    expect(back).toMatchObject({ tries: 2, counts: 'latest', shuffle_choices: false, add_total: true, shows: 'right' });
    expect(mount().querySelector('#quiz-head').textContent).toBe('Quiz · 4 Questions · 5 Points');
  });

  it('on Points the piece’s Max Points is the quiz’s total, and follows the questions', async () => {
    await newQuiz();
    writeQuiz();
    click(form().querySelector('.af-scoremode-btn[data-mode="points"]'));
    await settled();
    const box = form().querySelector('#af-maxpoints');
    expect(box.value).toBe('5');
    expect(box.readOnly).toBe(true);
    // The Text question is still open from writing it.
    type(edit(q(3).k).querySelector('[data-quiz-f="points"]'), '5');
    expect(box.value).toBe('9');
    click(form().querySelector('.af-actions .btn-primary'));
    await settled();
    expect(getAssessments(CID).find(a => a.title === 'Food Webs Check')).toMatchObject({
      scoreMode: 'points',
      maxPoints: 9,
    });
  });

  it('Evidence by Competency counts each one’s questions and says how many more a suggestion needs', async () => {
    await newQuiz();
    writeQuiz();
    const ev = mount().querySelector('#quiz-evidence').textContent;
    expect(ev).toContain('Evidence by Competency');
    expect(ev).toMatch(/more questions? and this quiz can suggest a level here\./);
    expect(ev).toContain('No Competency');
    // Three on one: its line goes.
    model().qs.forEach(x => (x.tag = T1));
    click(mount().querySelector('[data-quiz-act="preview"]'));
    click(mount().querySelector('[data-quiz-act="preview"]'));
    const rows = Array.from(mount().querySelectorAll('.quiz-ev-row')).map(r => r.textContent);
    expect(rows[0]).toBe('QP1 Questioning4 questions · 5 points');
    expect(rows[1]).toBe('PA4 Data PatternsNo questions yet3 more questions and this quiz can suggest a level here.');
  });

  it('Copy, Move and Delete, and where the focus goes after each', async () => {
    await newQuiz();
    writeQuiz();
    const keys = () => model().qs.map(x => x.k);
    const [a, b, c, d] = keys();
    click(mount().querySelector('.quiz-row[data-k="' + b + '"]'));
    click(edit(b).querySelector('[data-action="quizCopy"]'));
    const copy = model().open;
    expect(keys()).toEqual([a, b, copy, c, d]);
    expect(document.activeElement).toBe(edit(copy).querySelector('.quiz-prompt'));
    expect(q(2).prompt).toBe('A hawk is a producer.');
    click(edit(copy).querySelector('[data-action="quizUp"]'));
    click(edit(copy).querySelector('[data-action="quizUp"]'));
    expect(keys()).toEqual([copy, a, b, c, d]);
    // At the top Move Up is off, so the focus moves to Move Down.
    expect(document.activeElement).toBe(edit(copy).querySelector('[data-action="quizDown"]'));
    // A question with words asks first; the focus goes to the next question.
    click(edit(copy).querySelector('[data-action="quizDelete"]'));
    expect(document.getElementById('confirm-title').textContent).toBe('Delete This Question?');
    document.getElementById('confirm-ok-btn').onclick();
    expect(keys()).toEqual([a, b, c, d]);
    expect(document.activeElement).toBe(mount().querySelector('.quiz-row[data-k="' + a + '"]'));
    // A blank one goes at once.
    click(mount().querySelector('[data-quiz-act="add"]'));
    const blank = model().open;
    click(edit(blank).querySelector('[data-action="quizDelete"]'));
    expect(document.getElementById('confirm-title')).toBeNull();
    expect(keys()).toEqual([a, b, c, d]);
  });

  it('Preview as a Student draws the questions as a student sees them, and no right answer', async () => {
    await newQuiz();
    writeQuiz();
    click(mount().querySelector('[data-quiz-act="preview"]'));
    const pv = mount().querySelector('.quiz-preview');
    expect(pv.textContent).toContain('1. Which is a producer?');
    expect(pv.textContent).toContain('Students type a number');
    expect(pv.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(pv.innerHTML).not.toContain('12.5');
    expect(pv.innerHTML).not.toContain('checked');
  });

  it('Tries: Counts and its line only with more than one', async () => {
    await newQuiz();
    const settings = () => mount().querySelector('#quiz-settings').textContent;
    expect(mount().querySelector('[data-quiz-set="counts"]')).toBeNull();
    expect(settings()).toContain('You can reopen it for one student.');
    click(mount().querySelector('[data-quiz-set="tries"][data-value="u"]'));
    expect(mount().querySelectorAll('[data-quiz-set="counts"]')).toHaveLength(2);
    expect(settings()).toContain('Each try is a fresh shuffle. You can reopen it for one student.');
    expect(QuizBuilder._payload().tries).toBe(0);
  });

  it('Duplicate makes a plain copy: no quiz goes with it', async () => {
    await newQuiz();
    writeQuiz();
    click(form().querySelector('.af-actions .btn-primary'));
    await settled();
    const made = getAssessments(CID).find(a => a.title === 'Food Webs Check');
    click(document.querySelector('[data-action="dupeAssess"][data-aid="' + made.id + '"]'));
    await settled();
    const dupe = getAssessments(CID).find(a => a.title === 'Food Webs Check (Copy)');
    expect(dupe).toBeTruthy();
    expect(QuizData.get(CID, dupe.id).quiz).toBeNull();
    expect(getAssessmentStudentWork(CID, dupe.id).students_send).toBe('nothing');
  });

  it('taking a saved quiz off asks first, then removes it on save', async () => {
    await newQuiz();
    writeQuiz();
    click(form().querySelector('.af-actions .btn-primary'));
    await settled();
    const made = getAssessments(CID).find(a => a.title === 'Food Webs Check');
    await reopen(made.id);
    click(mount().querySelector('[data-quiz-act="answer"][data-value="nothing"]'));
    expect(document.getElementById('confirm-title').textContent).toBe('Take the Quiz Off?');
    document.getElementById('confirm-ok-btn').onclick();
    await settled();
    expect(mount().querySelector('.quiz-card')).toBeNull();
    click(form().querySelector('.af-actions .btn-primary'));
    await settled();
    expect(QuizData.get(CID, made.id).quiz).toBeNull();
  });
});
