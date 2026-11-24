/**
 * A quiz answer still waiting to be saved is never lost silently, and never left behind on a shared device
 * (docs/plans/quizzes-plan.md Q3b). Students share Chromebooks and iPads, so every way a student leaves
 * clears that student's unsent answers from sessionStorage (and localStorage holds nothing of a quiz for a
 * real sign-in): Log Out, Done in another tab, the 15-minute idle sign-out, the midnight end and Switch
 * Class. Each test types an answer with `quiz-save` failing, so it waits, leaves by that route, and reads
 * everything the device holds. Where the page asks first (Log Out, Switch Class) the answer goes only after
 * the student chooses to leave. Also: closing the tab asks while a save waits; Try Again is not offered after
 * quiz_closed or no_tries_left; a closed quiz with a sent try reads See Your Quiz, its closed date inside.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { CECE, OMAR, WORK, fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);
const ON = { 'fv-build-quizzes': '1' };
const MIN = 60 * 1000;
const SECRET = 'My private answer 7491';
const KEY = 'fv-s-session';

const Q = [
  { id: 'q1', number: 1, kind: 'text', prompt: 'Say what you see.', points: 3, multiple: false, choices: null },
  { id: 'q2', number: 2, kind: 'number', prompt: 'Half of 7?', points: 2, multiple: false, choices: null },
];

function world(opts = {}) {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)], lasts: opts.lasts });
  const db = { saveFails: true, saves: 0, sent: !!opts.sent, closed: !!opts.closed, newTry: opts.newTry || null };
  const reply = () => ({
    ok: true,
    quiz: { tries: 2, tries_left: db.sent ? 1 : 1, closed: db.closed, closes_on: db.closed ? '2026-11-21' : null },
    try: {
      number: 1,
      sent: db.sent,
      started_at: '2026-11-18T17:00:00+00:00',
      sent_at: db.sent ? '2026-11-18T18:00:00+00:00' : null,
      reopened: false,
    },
    sent_tries: db.sent ? 1 : 0,
    can_answer: !db.sent && !db.closed,
    can_try_again: db.sent && !db.closed,
    questions: Q,
    answers: {},
  });
  const server = async body => {
    if (body.route === 'quiz-list') {
      return {
        ok: true,
        quizzes: [
          {
            assessment_id: WORK.fair,
            tries_left: 1,
            can_answer: !db.sent && !db.closed,
            closed: db.closed,
            has_open_try: !db.sent && !opts.noTry,
          },
        ],
      };
    }
    if (body.route === 'quiz' && opts.noTry) {
      return {
        ok: true,
        quiz: { tries: 2, tries_left: 2, closed: true, closes_on: '2026-11-21' },
        try: null,
        sent_tries: 0,
        can_answer: false,
        can_try_again: false,
        questions: [],
        answers: {},
      };
    }
    if (body.route === 'quiz') return db.newTry && body.new_try ? { ok: false, error: db.newTry } : reply();
    if (body.route === 'quiz-save') {
      db.saves += 1;
      return db.saveFails
        ? { ok: false, error: 'network' }
        : { ok: true, question_id: body.question_id, saved_at: new Date().toISOString() };
    }
    if (body.route === 'quiz-send')
      return { ok: true, try: 1, sent_at: '2026-11-18T18:00:00+00:00', tries_left: 1, can_try_again: true };
    const asked = body.route === 'page' && body.enrollment_id === OMAR ? { ...body, enrollment_id: CECE } : body;
    const res = await fn.handle(asked);
    if (body.route === 'page' && res.ok) {
      res.assessments.find(a => a.id === WORK.fair).due_date = TODAY;
      res.classes = [
        { enrollment_id: CECE, course: { name: 'Science 8', block: 'B' } },
        { enrollment_id: OMAR, course: { name: 'Math 8', block: 'A' } },
      ];
      if (body.enrollment_id === OMAR) res.student = { enrollment_id: OMAR, first_name: 'Omar' };
    }
    return res;
  };
  return { db, server };
}

async function signIn(w) {
  const page = openStudentPage({ store: { ...ON } });
  page.server = w.server;
  await page.start('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  return page;
}

// Opens the quiz and types an answer; the save fails, so it waits. Then back to Assignments.
async function waiting(w, { leave = true } = {}) {
  const page = await signIn(w);
  await page.click('[data-act="quiz-open"]');
  await page.settle();
  page.type('textarea[data-kind="text"]', SECRET);
  page.advance(1000);
  page.runTimers();
  await page.settle();
  if (leave) await page.click('[data-act="quiz-back"]');
  return page;
}

const held = page => JSON.stringify([page.tab, page.store]);
function expectNothingLeft(page) {
  const all = held(page);
  expect(all).not.toContain(SECRET);
  expect(all).not.toContain('fv-s-quiz-');
  // A real sign-in puts nothing of a quiz in localStorage.
  expect(Object.keys(page.store).filter(k => /quiz/i.test(k) && k !== 'fv-build-quizzes')).toEqual([]);
}
function expectKept(page) {
  expect(held(page)).toContain('fv-s-quiz-');
  expect(held(page)).toContain(SECRET);
}

describe('every way a student leaves clears their unsent quiz answers', () => {
  it('is set up: the answer waits in sessionStorage and nothing of it is in localStorage', async () => {
    const page = await waiting(world());
    expectKept(page);
    expect(Object.keys(page.store).filter(k => /quiz/i.test(k) && k !== 'fv-build-quizzes')).toEqual([]);
  });

  it('Log Out: asks first, says an answer has not reached the teacher, clears only when they log out anyway', async () => {
    const page = await waiting(world());
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="logout-ask"]');
    const sheet = page.root().querySelector('.sp-logout');
    expect(sheet.textContent).toContain('hasn’t reached your teacher yet');
    expect(sheet.textContent).toContain('Log Out Anyway');
    page.advance(500);
    // Wait keeps the answer.
    await page.click('[data-act="logout-cancel"]');
    expectKept(page);
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="logout-ask"]');
    page.advance(500);
    expectKept(page);
    await page.click('[data-act="card-done"]');
    expectNothingLeft(page);
  });

  it('Done in another tab: the session is gone, so is the answer', async () => {
    const page = await waiting(world());
    delete page.store[KEY];
    page.fire('storage');
    await page.settle();
    expect(page.root().querySelector('.sp-quiz')).toBe(null);
    expectNothingLeft(page);
  });

  it('the fifteen idle minutes', async () => {
    const page = await waiting(world());
    page.advance(16 * MIN);
    page.fire('pageshow');
    page.hide();
    page.show();
    await page.settle();
    expect(page.root().querySelector('.sp-deck')).toBe(null);
    expectNothingLeft(page);
  });

  it('the midnight end', async () => {
    const page = await waiting(world({ lasts: 10 * MIN }));
    page.advance(10 * MIN + 1000);
    page.runTimers();
    await page.settle();
    expect(page.root().querySelector('.sp-deck')).toBe(null);
    expectNothingLeft(page);
  });

  it('Switch Class: asks first, and lets the answer go only when they switch anyway', async () => {
    const page = await waiting(world());
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="class-open"][data-enrollment="' + OMAR + '"]');
    const sheet = page.root().querySelector('.sp-logout');
    expect(sheet.textContent).toContain('Switch Class?');
    expect(sheet.textContent).toContain('hasn’t reached your teacher yet');
    expectKept(page);
    await page.click('[data-act="class-hold-cancel"]');
    expectKept(page);
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="class-open"][data-enrollment="' + OMAR + '"]');
    await page.click('.sp-logout [data-act="class-open"]');
    await page.settle();
    expectNothingLeft(page);
    expect(page.root().querySelector('.sp-logout')).toBe(null);
  });
});

describe('an answer waiting is not lost silently', () => {
  it('closing the tab asks only while a save is waiting', async () => {
    const w = world();
    const page = await waiting(w, { leave: false });
    const ask = () => page.T.quizAsksBeforeClosing();
    expect(ask()).toBe(true);
    // The real beforeunload event: it asks (preventDefault) while the save waits.
    let prevented = 0;
    page.fire('beforeunload', { preventDefault: () => (prevented += 1) });
    expect(prevented).toBe(1);
    w.db.saveFails = false;
    page.advance(60 * 1000);
    page.runTimers();
    await page.settle();
    expect(ask()).toBe(false);
    page.fire('beforeunload', { preventDefault: () => (prevented += 1) });
    expect(prevented).toBe(1);
  });
  it('the Log Out sheet is the plain one when nothing waits', async () => {
    const w = world();
    w.db.saveFails = false;
    const page = await signIn(w);
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="logout-ask"]');
    expect(page.root().querySelector('.sp-logout').textContent).toContain('You’ll need your card');
  });
});

describe('Try Again and a closed quiz', () => {
  it('Closed alone only when this tab has opened it and found nothing of theirs', async () => {
    const page = await signIn(world({ closed: true, noTry: true }));
    expect(page.root().querySelector('[data-act="quiz-open"]').textContent).toBe('See Your Quiz');
    await page.click('[data-act="quiz-open"]');
    await page.settle();
    expect(page.root().textContent).toContain('You didn’t start it before it closed');
    await page.click('[data-act="quiz-back"]');
    expect(page.root().querySelector('[data-act="quiz-open"]').textContent).toBe('Closed');
  });
  for (const [error, words] of [
    ['quiz_closed', 'closed, so you can’t start another try'],
    ['no_tries_left', 'no tries left'],
  ]) {
    it('after ' + error + ' no Try Again is offered, and the student is told', async () => {
      const page = await signIn(world({ sent: true, newTry: error }));
      await page.click('[data-act="quiz-open"]');
      await page.settle();
      await page.click('[data-act="quiz-again"]');
      await page.settle();
      expect(page.root().textContent).toContain(words);
      expect(page.root().querySelector('[data-act="quiz-again"]')).toBe(null);
    });
  }
  it('a closed quiz with a sent try reads See Your Quiz, with its closed date inside', async () => {
    const page = await signIn(world({ sent: true, closed: true }));
    const button = page.root().querySelector('[data-act="quiz-open"]');
    expect(button.textContent).toBe('See Your Quiz');
    await page.click('[data-act="quiz-open"]');
    await page.settle();
    expect(page.root().textContent).toContain('This quiz closed on Nov 21');
  });
});
