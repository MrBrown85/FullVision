/**
 * A quiz on the student's page, the model (docs/plans/quizzes-plan.md Q3b):
 * s/quiz-model.js on the contract's reply shapes, with no page, no network
 * and no real clock: order kept, answers kept, tries, closed, the saver's
 * queue and its offline behaviour, and Send's check.
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

runInThisContext(readFileSync('s/quiz-model.js', 'utf8') + '\nglobalThis.StudentQuizModel = StudentQuizModel;');
const M = globalThis.StudentQuizModel;

const q = (id, number, kind, more) => ({
  id,
  number,
  kind,
  prompt: 'Question ' + id,
  points: 1,
  multiple: false,
  choices: null,
  ...more,
});
const CH = [
  { id: 'a', text: 'Grass' },
  { id: 'b', text: 'Hawk' },
];
function reply(more = {}) {
  return {
    ok: true,
    quiz: { tries: 2, tries_left: 1, closed: false, closes_on: '2026-11-28' },
    try: { number: 1, sent: false, started_at: '2026-11-18T17:04:11+00:00', sent_at: null, reopened: false },
    sent_tries: 0,
    can_answer: true,
    can_try_again: false,
    questions: [
      q('q9', 1, 'choice', { choices: CH }),
      q('q2', 2, 'number'),
      q('q5', 3, 'true_false'),
      q('q1', 4, 'text'),
    ],
    answers: { q9: ['a'], q2: 3.5 },
    ...more,
  };
}

describe('a reply', () => {
  it('keeps the student’s own order and answers, and the tries', () => {
    const m = M.fromReply(reply());
    expect(m.questions.map(x => x.id)).toEqual(['q9', 'q2', 'q5', 'q1']);
    expect(m.answers).toEqual({ q9: ['a'], q2: 3.5 });
    expect(m).toMatchObject({ tries: 2, triesLeft: 1, canAnswer: true, sent: false, closed: false });
  });
  it('is nothing when it is not a quiz this page can draw', () => {
    expect(M.fromReply(null)).toBe(null);
    expect(M.fromReply({ ok: false, error: 'not_found' })).toBe(null);
    expect(M.fromReply(reply({ questions: [q('x', 1, 'ranking')] }))).toBe(null);
    expect(M.fromReply(reply({ questions: [q('x', 1, 'choice', { choices: [CH[0]] })] }))).toBe(null);
  });
  it('drops an answer of the wrong shape and one to a choice the question lacks', () => {
    const m = M.fromReply(reply({ answers: { q9: ['zzz'], q2: 'x', q5: true } }));
    expect(m.answers).toEqual({ q5: true });
  });
  it('a sent try cannot be answered, and Try Again follows the server', () => {
    const m = M.fromReply(
      reply({
        try: { number: 1, sent: true, sent_at: '2026-11-19T21:31:00+00:00' },
        can_answer: true,
        can_try_again: true,
      }),
    );
    expect(m.canAnswer).toBe(false);
    expect(m.canTryAgain).toBe(true);
    expect(
      M.fromReply(reply({ quiz: { tries: 1, tries_left: 0, closed: true, closes_on: null }, can_answer: false }))
        .canAnswer,
    ).toBe(false);
  });
  it('unlimited tries have no count', () => {
    expect(M.fromReply(reply({ quiz: { tries: 0, tries_left: null, closed: false } })).triesLeft).toBe(null);
  });
  it('carries no key: nothing of a right answer is read from a reply', () => {
    const m = M.fromReply(
      reply({
        questions: [
          q('q9', 1, 'choice', { choices: CH.map(c => ({ ...c, correct: true })), key: ['a'], tolerance: 1 }),
        ],
      }),
    );
    expect(JSON.stringify(m)).not.toMatch(/correct|tolerance|"key"/);
  });
});

describe('what is left, and Send’s check', () => {
  const m = M.fromReply(reply());
  it('counts what is answered and names the questions left by their number', () => {
    expect(M.counts(m, m.answers)).toEqual({ total: 4, done: 2, left: 2, next: 3, unanswered: [3, 4] });
    expect(M.counts(m, { ...m.answers, q5: false, q1: ' hi ' }).left).toBe(0);
    expect(M.counts(m, { ...m.answers, q1: '   ' }).unanswered).toEqual([3, 4]);
  });
  it('reads a number as typed', () => {
    expect(M.parseNumber(' 3,5 ')).toEqual({ ok: true, value: 3.5 });
    expect(M.parseNumber('-2')).toEqual({ ok: true, value: -2 });
    expect(M.parseNumber('')).toEqual({ ok: true, value: null });
    expect(M.parseNumber('abc').ok).toBe(false);
    expect(M.parseNumber('1e99').ok).toBe(false);
    expect(M.parseNumber('1,2,3').ok).toBe(false);
  });
  it('trims a text answer and clears a blank one', () => {
    expect(M.textValue('  hi\n')).toBe('hi');
    expect(M.textValue(' \t ')).toBe(null);
  });
  it('one answer replaces, several toggle', () => {
    expect(M.choiceNext({ multiple: false }, ['a'], 'b')).toEqual(['b']);
    expect(M.choiceNext({ multiple: true }, ['a'], 'b')).toEqual(['a', 'b']);
    expect(M.choiceNext({ multiple: true }, ['a'], 'a')).toBe(null);
  });
});

/* The saver, on timers of the test's own. */
function clock() {
  let t = 0;
  let n = 0;
  const jobs = new Map();
  return {
    set: (fn, ms) => {
      jobs.set(++n, { fn, at: t + ms });
      return n;
    },
    clear: id => jobs.delete(id),
    now: () => t,
    async run(ms) {
      t += ms;
      for (const [id, j] of [...jobs]) {
        if (j.at <= t) {
          jobs.delete(id);
          j.fn();
        }
      }
      await new Promise(r => setTimeout(r, 0));
    },
  };
}

describe('saving as the student goes', () => {
  it('sends only the latest value of a box being typed in, after a pause', async () => {
    const c = clock();
    const sent = [];
    const s = M.createSaver({
      send: async (id, a) => (sent.push([id, a]), { ok: true, saved_at: '2026-11-18T17:00:00Z' }),
      set: c.set,
      clear: c.clear,
      now: c.now,
    });
    s.queue('q1', 'a');
    s.queue('q1', 'ab');
    s.queue('q1', 'abc');
    await c.run(300);
    expect(sent).toEqual([]);
    await c.run(500);
    expect(sent).toEqual([['q1', 'abc']]);
    expect(s.status().kind).toBe('saved');
    expect(s.waiting()).toBe(0);
  });
  it('a clear is a null', async () => {
    const c = clock();
    const sent = [];
    const s = M.createSaver({
      send: async (id, a) => (sent.push([id, a]), { ok: true }),
      set: c.set,
      clear: c.clear,
      now: c.now,
    });
    s.queue('q5', null, true);
    await c.run(200);
    expect(sent).toEqual([['q5', null]]);
  });
  it('with no connection the answer waits, says so, and goes when the browser is online', async () => {
    const c = clock();
    let up = false;
    const sent = [];
    const kept = [];
    const s = M.createSaver({
      send: async (id, a) => (up ? (sent.push([id, a]), { ok: true }) : { ok: false, error: 'network' }),
      persist: p => kept.push(Object.keys(p)),
      set: c.set,
      clear: c.clear,
      now: c.now,
    });
    s.queue('q9', ['a'], true);
    await c.run(200);
    expect(s.status().kind).toBe('offline');
    expect(s.waiting()).toBe(1);
    expect(M.createSaver).toBeTypeOf('function');
    up = true;
    s.online();
    await c.run(10);
    expect(sent).toEqual([['q9', ['a']]]);
    expect(s.status().kind).toBe('saved');
    expect(kept[0]).toEqual(['q9']);
    expect(kept[kept.length - 1]).toEqual([]);
  });
  it('Send’s flush says false while a save is still waiting, true once none is', async () => {
    const c = clock();
    let up = false;
    const s = M.createSaver({
      send: async () => (up ? { ok: true } : { ok: false, error: 'network' }),
      set: c.set,
      clear: c.clear,
      now: c.now,
    });
    s.queue('q2', 4, true);
    expect(await s.flush()).toBe(false);
    up = true;
    expect(await s.flush()).toBe(true);
  });
  it('a try sent on another phone stops the saving and tells the screen once', async () => {
    const c = clock();
    const stops = [];
    const s = M.createSaver({
      send: async () => ({ ok: false, error: 'sent' }),
      onStop: code => stops.push(code),
      set: c.set,
      clear: c.clear,
      now: c.now,
    });
    s.queue('q2', 4, true);
    await c.run(200);
    expect(stops).toEqual(['sent']);
    expect(s.waiting()).toBe(0);
    s.queue('q2', 5, true);
    await c.run(200);
    expect(stops).toEqual(['sent']);
  });
  it('a session that is over is the page’s to end', async () => {
    const c = clock();
    const over = [];
    const s = M.createSaver({
      send: async () => ({ ok: false, error: 'card_expired' }),
      onSessionOver: r => over.push(r.error),
      set: c.set,
      clear: c.clear,
      now: c.now,
    });
    s.queue('q2', 4, true);
    await c.run(200);
    expect(over).toEqual(['card_expired']);
  });
  it('a busy server is tried again after its wait', async () => {
    const c = clock();
    let n = 0;
    const s = M.createSaver({
      send: async () => (++n === 1 ? { ok: false, error: 'too_many', retry_after_s: 5 } : { ok: true }),
      set: c.set,
      clear: c.clear,
      now: c.now,
    });
    s.queue('q2', 4, true);
    await c.run(200);
    expect(n).toBe(1);
    await c.run(5000);
    expect(n).toBe(2);
    expect(s.waiting()).toBe(0);
  });
});
