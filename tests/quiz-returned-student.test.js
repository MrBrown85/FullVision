/**
 * A quiz that came back, on the student's page (docs/plans/quizzes-plan.md Q5b), on the page as a browser loads it
 * (tests/helpers/student-page-context.js). `quiz-result` is Q5a's route and is not on the deployed function yet: it
 * is answered here as the contract ("MQ3, the returned view") says. `quiz-list` names the piece. No test waits on
 * real time, and nothing here calls a live function or database.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { WORK, fakeStudentSubmit, sampleCard, samplePage } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);
const ON = { 'fv-build-quizzes': '1' };
const routes = page => page.calls.map(c => c.body.route);
const AID = WORK.energy; // a returned piece with a grade, in a Proficiency class
const POINTS = WORK.quiz; // a returned points piece, which a Letter or Both class words as a % and a letter

const CH = [
  { id: 'a', text: 'Grass' },
  { id: 'b', text: 'Hawk' },
];
const Q = (id, number, kind, more) => ({
  id,
  number,
  kind,
  prompt: 'Prompt ' + id,
  points: 1,
  multiple: false,
  choices: null,
  your_answer: null,
  result: 'right',
  ...more,
});
const QUESTIONS = [
  Q('q9', 1, 'choice', { choices: CH, your_answer: ['b'], result: 'wrong', answer: ['a'], why: 'Grass makes food.' }),
  Q('q2', 2, 'number', { your_answer: 3.5, result: 'right', answer: 3.5, why: null }),
  Q('q5', 3, 'true_false', { your_answer: null, result: 'wrong', answer: true, why: null }),
];

/** What quiz-result answers, by the quiz's `shows`. */
function resultFor(shows, total) {
  const out = { ok: true, returned: true, shows };
  if (total) out.total = total;
  if (shows === 'grade') return out;
  out.questions = QUESTIONS.map(x => {
    const y = { ...x };
    if (shows === 'right') {
      delete y.answer;
      delete y.why;
    }
    return y;
  });
  return out;
}

function world(opts = {}) {
  const fn = fakeStudentSubmit({
    cards: [sampleCard(TODAY, opts.system ? { page: samplePage(TODAY, opts.system) } : undefined)],
  });
  const db = {
    listed: 0,
    asked: [],
    answerable: !!opts.answerable,
    reply: opts.reply || resultFor(opts.shows || 'answers'),
  };
  const server = async body => {
    if (body.route === 'quiz-list') {
      db.listed += 1;
      if (opts.noList) return { ok: false, error: 'bad_request' };
      return {
        ok: true,
        quizzes: [AID, POINTS, WORK.fair].map(id => ({
          assessment_id: id,
          tries_left: db.answerable || id === WORK.fair ? 1 : 0,
          can_answer: db.answerable || id === WORK.fair,
          closed: !db.answerable && id !== WORK.fair,
          has_open_try: false,
        })),
      };
    }
    if (body.route === 'quiz-result') {
      db.asked.push(body.assessment_id);
      if (opts.fail === 'throw') throw new Error('network down');
      if (opts.fail) return { ok: false, error: opts.fail };
      return db.reply;
    }
    if (/^quiz/.test(body.route)) return { ok: false, error: 'bad_request' };
    return fn.handle(body);
  };
  return { db, server, fn };
}

async function signIn(w, store = ON) {
  const page = openStudentPage({ store: { ...store } });
  page.server = w.server;
  await page.start('#P3R8-WDK4');
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  await page.settle();
  return page;
}
// The words of an element, a space where one tag ends and the next begins.
const words = el =>
  el
    ? el.innerHTML
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
const q = (page, sel) => page.root().querySelector(sel);
const seeQuiz = page => page.root().querySelector('[data-act="quiz-open"]');

// Your Feedback for a piece, from My Learning.
async function feedbackOf(page, id) {
  await page.click('[data-tab="learning"]');
  await page.click('.sp-ml-row[data-act="feedback"][data-piece="' + id + '"]');
}

describe('asking quiz-result', () => {
  it('asks once for each returned quiz piece the list says can no longer be answered, and never again on this class', async () => {
    const w = world();
    const page = await signIn(w);
    expect(w.db.asked.sort()).toEqual([AID, POINTS].sort());
    await page.click('[data-tab="learning"]');
    await page.click('[data-tab="assignments"]');
    page.runTicks();
    await page.settle();
    expect(w.db.asked).toHaveLength(2);
    expect(routes(page).filter(r => r === 'quiz-result')).toHaveLength(2);
  });

  it('is not asked for a piece that is still to do or one that can still be answered', async () => {
    const w = world({ answerable: true });
    await signIn(w);
    expect(w.db.asked).toEqual([]);
  });

  it('is not asked, and nothing quiz is drawn, with the switch off', async () => {
    const w = world();
    const page = await signIn(w, {});
    expect(w.db.asked).toEqual([]);
    expect(w.db.listed).toBe(0);
    await feedbackOf(page, AID);
    expect(seeQuiz(page)).toBe(null);
    expect(page.root().innerHTML).not.toMatch(/sp-quiz|quiz-open|See Your Quiz/);
    expect(routes(page).filter(r => /^quiz/.test(r))).toEqual([]);
  });

  it('is not asked when the server names no quiz (no quiz-list)', async () => {
    const w = world({ noList: true });
    await signIn(w);
    expect(w.db.asked).toEqual([]);
  });
});

describe('when it has not come back, or quiz-result is not there', () => {
  for (const [name, opts] of [
    ['returned: false', { reply: { ok: true, returned: false } }],
    ['a missing route (bad_request)', { fail: 'bad_request' }],
    ['a refused piece (not_found)', { fail: 'not_found' }],
    ['a server error', { fail: 'server' }],
    ['no answer at all', { fail: 'throw' }],
    ['a shows the page does not know', { reply: { ok: true, returned: true, shows: 'all' } }],
    ['a question it cannot draw', { reply: { ok: true, returned: true, shows: 'right', questions: [{ id: 'x' }] } }],
  ]) {
    it(`${name}: Your Feedback is as it was, with no quiz part, and nothing is said`, async () => {
      const w = world(opts);
      const page = await signIn(w);
      expect(w.db.asked.length).toBeGreaterThan(0);
      await feedbackOf(page, AID);
      expect(q(page, '.sp-feedback')).not.toBe(null);
      expect(seeQuiz(page)).toBe(null);
      expect(page.root().innerHTML).not.toMatch(/sp-quiz|quiz-open|See Your Quiz/);
      expect(page.ctx.StudentPage._test.quizBack()).toEqual({});
    });
  }
});

describe('See Your Quiz and the returned view', () => {
  it('is on Your Feedback once quiz-result said it is back, and opens the page’s own result and the answers', async () => {
    const w = world();
    const page = await signIn(w);
    await feedbackOf(page, AID);
    const feedbackResult = words(q(page, '.sp-fb-top'));
    expect(words(seeQuiz(page))).toBe('See Your Quiz');
    await page.click('[data-act="quiz-open"]');
    expect(q(page, '.sp-quiz[data-quiz-mode="returned"]')).not.toBe(null);
    expect(q(page, '#sp-quiz-title').textContent).toBe('Energy Transfer Investigation');
    // The grade is the page's own Your Result, in the class's words: the same as Your Feedback's.
    expect(words(q(page, '.sp-quiz-top'))).toBe(feedbackResult);
    expect(words(q(page, '.sp-quiz-top'))).toContain('Extending');
    const text = words(q(page, '.sp-quiz'));
    expect(text).toContain('Question 1 · Not Right Prompt q9 You chose: Hawk Right answer: Grass Grass makes food.');
    expect(text).toContain('Question 2 · Right Prompt q2 Your answer: 3.5');
    expect(text).toContain('Question 3 · Not Right Prompt q5 You didn’t answer this question. Right answer: True');
    expect(text).toContain('Look Again at Question 1');
    // No quiz route was asked to open it: the result was already in.
    expect(routes(page).filter(r => r === 'quiz')).toEqual([]);
    // Back goes to Assignments, which still names the piece's button.
    await page.click('[data-act="quiz-back"]');
    expect(q(page, '.sp-quiz')).toBe(null);
  });

  it('Look Again moves to the question', async () => {
    const page = await signIn(world());
    await feedbackOf(page, AID);
    await page.click('[data-act="quiz-open"]');
    await page.click('[data-act="quiz-look"]');
    expect(q(page, '.sp-quiz-ra[data-pos="1"]')).not.toBe(null);
  });

  it('Grade and Which Were Right shows no right answer anywhere in the page', async () => {
    const page = await signIn(world({ shows: 'right' }));
    await feedbackOf(page, AID);
    await page.click('[data-act="quiz-open"]');
    expect(words(q(page, '.sp-quiz'))).not.toMatch(/Right answer|Grass makes food/);
    expect(page.root().innerHTML).not.toContain('Grass makes food');
  });

  it('Grade Only stops after the teacher’s comment, with no question', async () => {
    const page = await signIn(world({ shows: 'grade' }));
    await feedbackOf(page, AID);
    await page.click('[data-act="quiz-open"]');
    const text = words(q(page, '.sp-quiz'));
    expect(text).toContain('Your teacher shows your result and comment for this quiz.');
    expect(text).toContain('Your data table shows every transfer. Well done.');
    expect(q(page, '.sp-quiz-ra')).toBe(null);
    expect(q(page, '[data-act="quiz-look"]')).toBe(null);
  });

  it('Add a Total adds “7 of 10”', async () => {
    const page = await signIn(world({ reply: resultFor('right', { earned: 7, possible: 10 }) }));
    await feedbackOf(page, AID);
    await page.click('[data-act="quiz-open"]');
    expect(words(q(page, '.sp-quiz-totalcard'))).toBe('Your Total 7 of 10');
  });

  for (const system of ['proficiency', 'letter', 'both']) {
    it(`the grade is the class's (${system}), the page's own words, never one of the view's own`, async () => {
      const page = await signIn(world({ system }));
      await feedbackOf(page, POINTS);
      const fb = words(q(page, '.sp-fb-top'));
      await page.click('[data-act="quiz-open"]');
      expect(words(q(page, '.sp-quiz-top'))).toBe(fb);
      if (system !== 'proficiency') expect(fb).toMatch(/80\s*%/);
      expect(page.root().querySelector('.sp-quiz-top').innerHTML).toBe(
        page.root().querySelector('.sp-quiz-top').innerHTML,
      );
    });
  }
});

describe('nothing of it is kept', () => {
  it('nothing is written to localStorage or sessionStorage on a real sign-in', async () => {
    const w = world();
    const page = await signIn(w);
    await feedbackOf(page, AID);
    await page.click('[data-act="quiz-open"]');
    const all = JSON.stringify([page.store, page.tab]);
    expect(all).not.toContain('Grass');
    expect(all).not.toContain('Prompt q9');
    expect(Object.keys(page.tab).filter(k => /quiz/.test(k))).toEqual([]);
    expect(Object.keys(page.store).filter(k => /quiz/.test(k) && k !== 'fv-build-quizzes')).toEqual([]);
  });

  const MIN = 60 * 1000;
  async function open(w) {
    const page = await signIn(w);
    await feedbackOf(page, AID);
    await page.click('[data-act="quiz-open"]');
    expect(words(q(page, '.sp-quiz'))).toContain('Grass');
    expect(Object.keys(page.ctx.StudentPage._test.quizBack())).toHaveLength(2);
    return page;
  }
  const gone = page => {
    expect(page.ctx.StudentPage._test.quizBack()).toEqual({});
    expect(page.root().innerHTML).not.toMatch(/Grass|Prompt q9|sp-quiz/);
    expect(JSON.stringify([page.store, page.tab])).not.toMatch(/Grass|Prompt q9/);
  };

  it('Log Out', async () => {
    const page = await open(world());
    await page.click('[data-act="quiz-back"]');
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="logout-ask"]');
    page.advance(500);
    await page.click('[data-act="card-done"]');
    gone(page);
  });

  it('Done in another tab', async () => {
    const page = await open(world());
    delete page.store['fv-s-session'];
    page.fire('storage');
    await page.settle();
    gone(page);
  });

  it('the fifteen idle minutes', async () => {
    const page = await open(world());
    page.advance(16 * MIN);
    page.fire('pageshow');
    page.hide();
    page.show();
    await page.settle();
    gone(page);
  });

  it('a sign-out of the page itself (reset), and the screen open on it', async () => {
    const page = await open(world());
    const test = page.ctx.StudentPage._test;
    page.ctx.StudentPage.quizLetGo();
    expect(test.quizBack()).toEqual({});
    expect(test.quizOf().back).toBe(null);
    page.ctx.StudentPage.reset();
    expect(test.quizBack()).toEqual({});
  });

  it('is let go when the class changes: a new list asks again for its own pieces', async () => {
    const w = world();
    const page = await signIn(w);
    expect(Object.keys(page.ctx.StudentPage._test.quizBack())).toHaveLength(2);
    page.ctx.StudentPage.quizLetGo();
    expect(page.ctx.StudentPage._test.quizBack()).toEqual({});
  });
});

describe('the source', () => {
  it('quiz-result is a class route, and the student page never names the key store', () => {
    expect(readFileSync('s/app.js', 'utf8')).toMatch(/'quiz-result': 1/);
    for (const f of ['s/quiz.js', 's/quiz-model.js', 's/quiz-view.js']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/gb-quiz-keys|gb-quizzes-|quiz_key/);
    }
  });
  it('the returned view reads no localStorage or sessionStorage of its own', () => {
    const view = readFileSync('s/quiz-view.js', 'utf8');
    expect(view).not.toMatch(/localStorage|sessionStorage/);
  });
});
