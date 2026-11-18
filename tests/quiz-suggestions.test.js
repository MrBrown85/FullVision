/**
 * quizSuggestions (shared/calc.js; docs/plans/quizzes-plan.md, "Grade math"
 * and slice Q4): a table of cases at the table's edges (85.9, 86, 72.9, 73,
 * 49.9, 50), two, three and no questions on a competency, an untagged
 * question, a waiting Text answer, a tolerance's ends, two tries each way
 * and a tie; what counts as right for each kind; Points scoring; a mark
 * given above a question's points now; and that it writes nothing.
 *
 * And the proof that a suggestion is never a grade: no file but the quiz
 * results screen calls quizSuggestions.
 */
import './setup.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(new URL('.', import.meta.url).pathname, '..');
const T1 = 'tag-1';
const T2 = 'tag-2';
const T3 = 'tag-3';
const SETTINGS = { tries: 1, counts: 'best', scoring: 'competencies', tagIds: [T1, T2, T3] };

const choice = (id, tag, points, right, multiple) => ({
  id,
  kind: 'choice',
  tag_id: tag,
  points: points == null ? 1 : points,
  multiple: !!multiple,
  choices: [
    { id: id + '-a', text: 'A' },
    { id: id + '-b', text: 'B' },
    { id: id + '-c', text: 'C' },
  ],
  key: { answer: right || [id + '-a'], tolerance: null, why: null },
});
const tf = (id, tag, right) => ({ id, kind: 'true_false', tag_id: tag, points: 1, key: { answer: right } });
const num = (id, tag, answer, tolerance, points) => ({
  id,
  kind: 'number',
  tag_id: tag,
  points: points || 1,
  key: { answer, tolerance },
});
const text = (id, tag, points) => ({ id, kind: 'text', tag_id: tag, points: points || 2, key: { answer: null } });
const ans = (question_id, answer, given_points) => ({
  question_id,
  answer,
  given_points: given_points === undefined ? null : given_points,
});
let tryN = 0;
const sent = (answers, n) => ({
  attempt_id: 'att-' + ++tryN,
  try: n || 1,
  sent_at: '2026-11-19T10:0' + (n || 1) + ':00Z',
  answers,
});

/* N one-point questions on T1, the first `right` answered right. */
function onT1(n, right, tag) {
  const qs = [];
  const answers = [];
  for (let i = 0; i < n; i++) {
    const q = choice('q' + i, tag || T1, 1);
    qs.push(q);
    answers.push(ans(q.id, [i < right ? q.id + '-a' : q.id + '-b']));
  }
  return { qs, answers };
}
const comp = (out, tag) => out.competencies.find(c => c.tagId === tag);

describe('a level at each edge of the default table (86 / 73 / 50)', () => {
  // [questions' points on T1, earned, the level]
  const EDGES = [
    // 85.9% and 86%
    [1000, 859, 3],
    [1000, 860, 4],
    [100, 86, 4],
    // 72.9% and 73%
    [1000, 729, 2],
    [1000, 730, 3],
    // 49.9% and 50%
    [1000, 499, 1],
    [1000, 500, 2],
    // 0 and all
    [3, 0, 1],
    [3, 3, 4],
  ];
  it.each(EDGES)('%s points possible, %s earned: level %s', (possible, earned, level) => {
    // Three questions on T1 whose points make `possible`; one Text answer carries the rest.
    const qs = [choice('a', T1, 1), choice('b', T1, 1), text('t', T1, possible - 2)];
    const right = Math.min(earned, 2);
    const answers = [
      ans('a', [right >= 1 ? 'a-a' : 'a-b']),
      ans('b', [right >= 2 ? 'b-a' : 'b-b']),
      ans('t', 'Because…', earned - right),
    ];
    const out = quizSuggestions(qs, null, [sent(answers)], SETTINGS);
    expect(comp(out, T1)).toMatchObject({ state: 'level', level, earned, possible });
  });

  it('follows the class’s own table, not the default', () => {
    const { qs, answers } = onT1(4, 3); // 75%
    const scale = {
      boundaries: [
        { min: 90, proficiency: 4 },
        { min: 76, proficiency: 3 },
        { min: 60, proficiency: 2 },
        { min: 0, proficiency: 1 },
      ],
    };
    expect(comp(quizSuggestions(qs, null, [sent(answers)], SETTINGS), T1).level).toBe(3);
    expect(comp(quizSuggestions(qs, null, [sent(answers)], SETTINGS, scale), T1).level).toBe(2);
  });

  it('suggests Extending only where the table gives it (decision 5)', () => {
    const { qs, answers } = onT1(3, 3);
    expect(comp(quizSuggestions(qs, null, [sent(answers)], SETTINGS), T1).level).toBe(4);
    const noExtending = {
      boundaries: [
        { min: 73, proficiency: 3 },
        { min: 50, proficiency: 2 },
        { min: 0, proficiency: 1 },
      ],
    };
    expect(comp(quizSuggestions(qs, null, [sent(answers)], SETTINGS, noExtending), T1).level).toBe(3);
  });
});

describe('how many questions a competency needs (decision 4)', () => {
  it('none, two: Too Few; three: a level', () => {
    const qs = [choice('a', T1), choice('b', T1), choice('c', T2), choice('d', T2), choice('e', T2)];
    const answers = [ans('a', ['a-a']), ans('b', ['b-a']), ans('c', ['c-a']), ans('d', ['d-a']), ans('e', ['e-b'])];
    const out = quizSuggestions(qs, null, [sent(answers)], SETTINGS);
    expect(comp(out, T1)).toMatchObject({ questions: 2, state: 'too_few', level: 0, earned: 2, possible: 2 });
    expect(comp(out, T2)).toMatchObject({ questions: 3, state: 'level', level: 2, earned: 2, possible: 3 });
    expect(comp(out, T3)).toMatchObject({ questions: 0, state: 'too_few', level: 0, earned: 0, possible: 0 });
  });

  it('an untagged question counts toward no competency (decision 8), and into the total', () => {
    const { qs, answers } = onT1(3, 3);
    const loose = choice('loose', null, 5);
    const out = quizSuggestions(qs.concat(loose), null, [sent(answers.concat(ans('loose', ['loose-a'])))], SETTINGS);
    expect(comp(out, T1)).toMatchObject({ earned: 3, possible: 3, level: 4 });
    expect(out.total).toMatchObject({ earned: 8, possible: 8 });
    expect(out.competencies.map(c => c.tagId)).toEqual([T1, T2, T3]);
  });

  it('an archived question counts toward nothing', () => {
    const { qs, answers } = onT1(3, 3);
    const gone = { ...choice('gone', T1, 9), archived_at: '2026-11-18T00:00:00Z' };
    const out = quizSuggestions(qs.concat(gone), null, [sent(answers.concat(ans('gone', ['gone-b'])))], SETTINGS);
    expect(comp(out, T1)).toMatchObject({ questions: 3, earned: 3, possible: 3 });
    expect(out.marked.questions.gone).toBeUndefined();
  });
});

describe('what counts as right', () => {
  const one = (q, answer, extra) => {
    const out = quizSuggestions([q], null, [sent(answer === undefined ? [] : [ans(q.id, answer, extra)])], {
      ...SETTINGS,
      tagIds: [],
    });
    return out.marked.questions[q.id];
  };

  it('a Choice with one right answer: that answer', () => {
    const q = choice('c', T1, 2);
    expect(one(q, ['c-a'])).toEqual({ earned: 2, result: 'right' });
    expect(one(q, ['c-b'])).toEqual({ earned: 0, result: 'wrong' });
  });

  it('a Choice with several right: all of them and no others, or nothing (no part marks)', () => {
    const q = choice('m', T1, 2, ['m-a', 'm-c'], true);
    expect(one(q, ['m-c', 'm-a'])).toEqual({ earned: 2, result: 'right' });
    expect(one(q, ['m-a'])).toEqual({ earned: 0, result: 'wrong' });
    expect(one(q, ['m-a', 'm-b', 'm-c'])).toEqual({ earned: 0, result: 'wrong' });
    expect(one(q, ['m-a', 'm-a'])).toEqual({ earned: 0, result: 'wrong' });
  });

  it('True or False: the key’s answer', () => {
    expect(one(tf('t', T1, false), false)).toEqual({ earned: 1, result: 'right' });
    expect(one(tf('t', T1, false), true)).toEqual({ earned: 0, result: 'wrong' });
    expect(one(tf('t', T1, false), 'false')).toEqual({ earned: 0, result: 'wrong' });
  });

  it('a Number: within the tolerance, the ends included, compared on paper', () => {
    const q = num('n', T1, 12.5, 0.1, 2);
    expect(one(q, 12.5).result).toBe('right');
    expect(one(q, 12.4).result).toBe('right'); // 12.5 − 12.4 is 0.0999…96 in a computer
    expect(one(q, 12.6).result).toBe('right'); // and 0.1000…04 the other way
    expect(one(q, 12.39).result).toBe('wrong');
    expect(one(q, 12.61).result).toBe('wrong');
    expect(one(num('z', T1, 3, null), 3).result).toBe('right'); // no tolerance: exactly
    expect(one(num('z', T1, 3, null), 3.0000001).result).toBe('wrong');
    expect(one(num('z', T1, 3, 0), '3').result).toBe('wrong');
  });

  it('a Text answer: the points the teacher gave; none given yet is waiting', () => {
    const q = text('w', T1, 2);
    expect(one(q, 'Because', null)).toEqual({ earned: 0, result: 'waiting' });
    expect(one(q, 'Because', 2)).toEqual({ earned: 2, result: 'right' });
    expect(one(q, 'Because', 1.5)).toEqual({ earned: 1.5, result: 'partly' });
    expect(one(q, 'Because', 0)).toEqual({ earned: 0, result: 'wrong' });
  });

  it('a mark given above what the question is worth now counts only what it is worth', () => {
    // mark_quiz_answer gave 3 when the question was worth 3; it is worth 1 now.
    expect(one(text('w', T1, 1), 'Because', 3)).toEqual({ earned: 1, result: 'right' });
  });

  it('no answer earns 0 and is not waiting, whatever the kind', () => {
    expect(one(choice('c', T1), undefined)).toEqual({ earned: 0, result: 'wrong' });
    expect(one(text('w', T1), undefined)).toEqual({ earned: 0, result: 'wrong' });
  });

  it('reads a key handed apart from the questions before a question’s own', () => {
    const q = choice('c', T1, 1);
    const out = quizSuggestions([q], { c: { answer: ['c-b'] } }, [sent([ans('c', ['c-b'])])], SETTINGS);
    expect(out.marked.questions.c.result).toBe('right');
  });
});

describe('a Text answer waiting', () => {
  it('holds only the competency it is on', () => {
    const qs = [choice('a', T1), choice('b', T1), text('t', T1), choice('c', T2), choice('d', T2), choice('e', T2)];
    const answers = [
      ans('a', ['a-a']),
      ans('b', ['b-a']),
      ans('t', 'So…'),
      ans('c', ['c-a']),
      ans('d', ['d-a']),
      ans('e', ['e-b']),
    ];
    const out = quizSuggestions(qs, null, [sent(answers)], SETTINGS);
    expect(comp(out, T1)).toMatchObject({ state: 'waiting', level: 0 });
    expect(comp(out, T2)).toMatchObject({ state: 'level', level: 2 });
    expect(out.waiting).toBe(1);
    expect(out.total.state).toBe('waiting');
    expect(out.marked.questions.t).toEqual({ earned: 0, result: 'waiting' });
  });
});

describe('more than one try (decision 9): one whole try counts, never a mix', () => {
  const qs = [choice('a', T1), choice('b', T1), choice('c', T1), choice('d', T2), choice('e', T2), choice('f', T2)];
  const answersFor = rights => qs.map(q => ans(q.id, [rights.includes(q.id) ? q.id + '-a' : q.id + '-b']));
  // Try 1: T1 all right, T2 none (3). Try 2: T1 one right, T2 all right (4).
  const t1 = () => sent(answersFor(['a', 'b', 'c']), 1);
  const t2 = () => sent(answersFor(['a', 'd', 'e', 'f']), 2);

  it('Best: the try with the higher total, whole', () => {
    const out = quizSuggestions(qs, null, [t1(), t2()], { ...SETTINGS, tries: 2, counts: 'best' });
    expect(out.mode).toBe('best');
    expect(out.counted.try).toBe(2);
    expect(comp(out, T1)).toMatchObject({ earned: 1, level: 1 }); // not try 1's 3 of 3
    expect(comp(out, T2)).toMatchObject({ earned: 3, level: 4 });
    expect(out.tries.map(t => t.earned)).toEqual([3, 4]);
  });

  it('Best: a tie goes to the later try', () => {
    const tie = sent(answersFor(['d', 'e', 'f']), 2);
    const out = quizSuggestions(qs, null, [t1(), tie], { ...SETTINGS, tries: 0, counts: 'best' });
    expect(out.counted.try).toBe(2);
    expect(comp(out, T1).earned).toBe(0);
  });

  it('Best: the first try is kept when it is higher', () => {
    const low = sent(answersFor(['a']), 2);
    expect(quizSuggestions(qs, null, [low, t1()], { ...SETTINGS, tries: 2, counts: 'best' }).counted.try).toBe(1);
  });

  it('Latest: the last try sent, even when it is lower', () => {
    const low = sent(answersFor(['a']), 2);
    const out = quizSuggestions(qs, null, [t1(), low], { ...SETTINGS, tries: 2, counts: 'latest' });
    expect(out.mode).toBe('latest');
    expect(out.counted.try).toBe(2);
    expect(comp(out, T1).earned).toBe(1);
  });

  it('a one-try quiz with a try Reopen gave counts the last try', () => {
    const low = sent(answersFor(['a']), 2);
    expect(quizSuggestions(qs, null, [t1(), low], { ...SETTINGS, tries: 1, counts: 'best' }).counted.try).toBe(2);
  });

  it('Best waits while any try has a Text answer waiting', () => {
    const withText = qs.concat(text('t', T2));
    const one = sent(answersFor(['a', 'b', 'c']).concat(ans('t', 'So…', 2)), 1);
    const two = sent(answersFor(['a']).concat(ans('t', 'Hmm', null)), 2);
    const out = quizSuggestions(withText, null, [one, two], { ...SETTINGS, tries: 2, counts: 'best' });
    expect(out.counted).toBeNull();
    expect(out.marked).toBeNull();
    expect(out.waiting).toBe(1);
    expect(out.competencies.map(c => c.state)).toEqual(['waiting', 'waiting', 'too_few']);
    // Assessed: try 1 counts.
    two.answers[two.answers.length - 1].given_points = 0;
    expect(quizSuggestions(withText, null, [one, two], { ...SETTINGS, tries: 2, counts: 'best' }).counted.try).toBe(1);
  });

  it('only sent tries count, in the order they were tried', () => {
    const open = { ...t2(), sent_at: null };
    const out = quizSuggestions(qs, null, [open, t1()], { ...SETTINGS, tries: 2, counts: 'latest' });
    expect(out.tries.map(t => t.try)).toEqual([1]);
    expect(out.counted.try).toBe(1);
  });

  it('no try sent: nothing suggested', () => {
    const out = quizSuggestions(qs, null, [], SETTINGS);
    expect(out.counted).toBeNull();
    expect(out.total.state).toBe('not_sent');
    expect(out.competencies.map(c => c.state)).toEqual(['not_sent', 'not_sent', 'not_sent']);
  });
});

describe('Points scoring: the total is the score, and every competency reads its level', () => {
  it('each tagged competency reads the level the total reaches; tags only sort', () => {
    const qs = [choice('a', T1, 4), choice('b', T2, 3), choice('c', null, 3)];
    const answers = [ans('a', ['a-a']), ans('b', ['b-a']), ans('c', ['c-b'])];
    const out = quizSuggestions(qs, null, [sent(answers)], { ...SETTINGS, scoring: 'points', maxPoints: 10 });
    expect(out.total).toEqual({ earned: 7, possible: 10, state: 'level', level: 2 }); // 70%: Developing
    expect(out.competencies.map(c => [c.state, c.level, c.earned, c.possible])).toEqual([
      ['total', 2, 4, 4],
      ['total', 2, 3, 3],
      ['total', 2, 0, 0],
    ]);
  });

  it('the level is the one the piece’s points read as, through pointsToProf', () => {
    const qs = [choice('a', T1, 43), choice('b', T1, 7)];
    const out = quizSuggestions(qs, null, [sent([ans('a', ['a-a']), ans('b', ['b-b'])])], {
      ...SETTINGS,
      scoring: 'points',
      maxPoints: 50,
    });
    expect(out.total.level).toBe(pointsToProf(43, 50));
    expect(out.total.level).toBe(4); // 86%
  });

  it('waits whole for a Text answer', () => {
    const qs = [choice('a', T1, 4), text('t', T2, 2)];
    const out = quizSuggestions(qs, null, [sent([ans('a', ['a-a']), ans('t', 'So')])], {
      ...SETTINGS,
      scoring: 'points',
    });
    expect(out.total.state).toBe('waiting');
    expect(out.competencies.map(c => c.state)).toEqual(['waiting', 'waiting', 'waiting']);
  });
});

describe('it writes nothing and keeps what it is handed', () => {
  it('leaves the questions, key and tries as they were, and stores nothing', () => {
    const { qs, answers } = onT1(3, 2);
    const tries = [sent(answers)];
    const before = JSON.stringify([qs, tries]);
    const keys = Object.keys(localStorage._store).sort();
    quizSuggestions(qs, null, tries, SETTINGS);
    expect(JSON.stringify([qs, tries])).toBe(before);
    expect(Object.keys(localStorage._store).sort()).toEqual(keys);
  });

  it('marked is in confirm_quiz’s shape: earned, possible, and { earned, result } a question', () => {
    const { qs, answers } = onT1(3, 2);
    const out = quizSuggestions(qs, null, [sent(answers)], SETTINGS);
    expect(Object.keys(out.marked)).toEqual(['earned', 'possible', 'questions']);
    Object.values(out.marked.questions).forEach(q => expect(Object.keys(q)).toEqual(['earned', 'result']));
  });
});

describe('a suggestion is never a grade: who calls quizSuggestions', () => {
  it('no file but calc.js (its home) and the quiz results screen names it', () => {
    const DIRS = ['shared', 'teacher', 'teacher-mobile', 's', 'supabase', 'netlify'];
    const found = [];
    const walk = dir => {
      readdirSync(join(ROOT, dir), { withFileTypes: true }).forEach(e => {
        const rel = dir + '/' + e.name;
        if (e.isDirectory()) return walk(rel);
        if (!/\.(js|mjs|ts|html)$/.test(e.name)) return;
        if (/quizSuggestions/.test(readFileSync(join(ROOT, rel), 'utf-8'))) found.push(rel);
      });
    };
    DIRS.forEach(walk);
    ['index.html', 'login.html', 'sw.js'].forEach(f => {
      if (/quizSuggestions/.test(readFileSync(join(ROOT, f), 'utf-8'))) found.push(f);
    });
    expect(found.sort()).toEqual(['shared/calc.js', 'teacher/quiz-results.js']);
  });
});
