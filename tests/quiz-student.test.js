/**
 * A quiz on the student's page (docs/plans/quizzes-plan.md Q3b), on the page
 * as a browser loads it (tests/helpers/student-page-context.js). The three
 * routes (quiz, quiz-save, quiz-send) are answered here as the contract
 * ("The student's side (MQ2)") says; they are not on the deployed function
 * yet. The `page` reply marks a quiz piece with `quiz: true`. No test waits
 * on real time.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { WORK, fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);
const ON = { 'fv-build-quizzes': '1' };
const routes = page => page.calls.map(c => c.body.route);

const Q = [
  {
    id: 'q9',
    number: 1,
    kind: 'choice',
    prompt: 'Which is a producer?',
    points: 1,
    multiple: false,
    choices: [
      { id: 'a', text: 'Grass' },
      { id: 'b', text: 'Hawk' },
    ],
  },
  { id: 'q2', number: 2, kind: 'number', prompt: 'Half of 7?', points: 2, multiple: false, choices: null },
];

function world(opts = {}) {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
  const db = { answers: {}, sent: false, saves: [], missing: !!opts.missing, offline: false };
  const reply = () => ({
    ok: true,
    quiz: { tries: 1, tries_left: 0, closed: false, closes_on: null },
    try: {
      number: 1,
      sent: db.sent,
      started_at: '2026-11-18T17:00:00+00:00',
      sent_at: db.sent ? '2026-11-18T18:00:00+00:00' : null,
      reopened: false,
    },
    sent_tries: db.sent ? 1 : 0,
    can_answer: !db.sent,
    can_try_again: false,
    questions: Q,
    answers: db.answers,
  });
  const server = async body => {
    if (/^quiz/.test(body.route)) {
      if (db.missing) return { ok: false, error: 'bad_request' };
      if (db.offline) return { ok: false, error: 'network' };
      if (body.route === 'quiz') return reply();
      if (db.sent) return { ok: false, error: 'sent' };
      if (body.route === 'quiz-save') {
        db.saves.push([body.question_id, body.answer]);
        if (body.answer == null) delete db.answers[body.question_id];
        else db.answers[body.question_id] = body.answer;
        return { ok: true, question_id: body.question_id, saved_at: new Date().toISOString() };
      }
      db.sent = true;
      return { ok: true, try: 1, sent_at: '2026-11-18T18:00:00+00:00', tries_left: 0, can_try_again: false };
    }
    const res = await fn.handle(body);
    if (body.route === 'page' && res.ok && !opts.unmarked) {
      const piece = res.assessments.find(a => a.id === WORK.fair);
      piece.quiz = true;
      piece.due_date = TODAY; // due today: Outstanding, where a card with a button is drawn
    }
    return res;
  };
  return { db, server };
}

async function signIn(w, store = ON) {
  const page = openStudentPage({ store: { ...store } });
  page.server = w.server;
  await page.start('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return page;
}
const start = page => page.root().querySelector('[data-act="quiz-open"]');

describe('Start the Quiz', () => {
  it('is on the piece the page marks, with the switch on', async () => {
    const page = await signIn(world());
    expect(start(page).textContent).toBe('Start the Quiz');
    expect(routes(page)).not.toContain('quiz');
  });
  it('is nowhere with the switch off, and nothing is asked', async () => {
    const page = await signIn(world(), {});
    expect(start(page)).toBe(null);
    expect(page.root().innerHTML).not.toMatch(/quiz/i);
    await page.settle();
    expect(routes(page).filter(r => /^quiz/.test(r))).toEqual([]);
  });
  it('is nowhere when the server marks no piece (until the server has it, the page offers nothing)', async () => {
    const page = await signIn(world({ unmarked: true }));
    expect(start(page)).toBe(null);
  });
  it('opening it with the routes missing says so plainly and offers no retry', async () => {
    const page = await signIn(world({ missing: true }));
    await page.click('[data-act="quiz-open"]');
    await page.settle();
    expect(page.root().textContent).toContain('This quiz can’t open right now. Ask your teacher.');
    expect(page.root().querySelector('[data-act="quiz-retry"]')).toBe(null);
  });
});

describe('answering', () => {
  async function open(w) {
    const page = await signIn(w);
    await page.click('[data-act="quiz-open"]');
    await page.settle();
    return page;
  }
  it('shows the questions in the order sent, with nothing of a key', async () => {
    const page = await open(world());
    const text = [...page.root().querySelectorAll('.sp-quiz-q .sp-q')].map(e => e.textContent);
    expect(text).toEqual(['Which is a producer?', 'Half of 7?']);
    expect(page.root().querySelector('#sp-quiz-count').textContent).toBe('0 of 2 answered');
    expect(page.root().innerHTML).not.toMatch(/correct|tolerance/i);
  });
  it('saves a choice as it is pressed, with the ids, and a box once it is typed in', async () => {
    const w = world();
    const page = await open(w);
    await page.click('[data-act="quiz-pick"][data-value="a"]');
    page.type('input[data-kind="number"]', '3.5');
    page.runTimers();
    await page.settle();
    page.advance(2000);
    page.runTimers();
    await page.settle();
    expect(w.db.saves).toEqual([
      ['q9', ['a']],
      ['q2', 3.5],
    ]);
    expect(page.root().querySelector('#sp-quiz-count').textContent).toBe('2 of 2 answered');
  });
  it('Send asks first, then sends, and says Sent', async () => {
    const w = world();
    const page = await open(w);
    await page.click('[data-act="quiz-send-ask"]');
    expect(page.root().textContent).toContain('You haven’t answered 2 questions.');
    expect(routes(page)).not.toContain('quiz-send');
    await page.click('[data-act="quiz-send"]');
    await page.settle();
    expect(routes(page)).toContain('quiz-send');
    expect(page.root().querySelector('#sp-quiz-sent')).not.toBe(null);
    expect(start(page)).toBe(null);
  });
  it('with no connection Send does not send, and says the answers are on the phone', async () => {
    const w = world();
    const page = await open(w);
    await page.click('[data-act="quiz-pick"][data-value="a"]');
    w.db.offline = true;
    await page.click('[data-act="quiz-send-ask"]');
    await page.click('[data-act="quiz-send"]');
    await page.settle();
    expect(page.root().textContent).toContain('saved on this phone');
    expect(routes(page)).not.toContain('quiz-send');
    expect(Object.keys(page.tab).some(k => k.startsWith('fv-s-quiz-'))).toBe(true);
  });
  it('nothing of the answers is kept on the tab after a sign-out', async () => {
    const w = world();
    const page = await open(w);
    await page.click('[data-act="quiz-pick"][data-value="a"]');
    w.db.offline = true;
    await page.click('[data-act="quiz-pick"][data-value="b"]');
    page.advance(2000);
    page.runTimers();
    await page.settle();
    expect(Object.keys(page.tab).some(k => k.startsWith('fv-s-quiz-'))).toBe(true);
    page.ctx.StudentPage.reset();
    expect(Object.keys(page.tab).filter(k => k.startsWith('fv-s-quiz-'))).toEqual([]);
  });
});

describe('the key', () => {
  it('no file the student page loads names the teacher’s answer key store', () => {
    for (const f of ['s/quiz.js', 's/quiz-model.js', 's/quiz-view.js']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/gb-quiz-keys|gb-quizzes-/);
    }
  });
});
