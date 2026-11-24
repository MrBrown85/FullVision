/**
 * What the student sees when a quiz comes back (docs/plans/quizzes-plan.md Q5b): the model reads the `quiz-result`
 * reply (migrations/local-test/quizzes-contract.md, "MQ3, the returned view") and the view draws it. No page, no
 * network. Each `shows` value, Add a Total, an unanswered question, a question with no result, a question the
 * marking left out, and what is never read.
 */
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

globalThis.esc = s =>
  String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
globalThis.StudentQuestionKinds = {};
runInThisContext(readFileSync('s/quiz-model.js', 'utf8') + '\nglobalThis.StudentQuizModel = StudentQuizModel;');
runInThisContext(readFileSync('s/quiz-view.js', 'utf8') + '\nglobalThis.StudentQuizView = StudentQuizView;');
const M = globalThis.StudentQuizModel;
const V = globalThis.StudentQuizView;

const CH = [
  { id: 'a', text: 'Grass' },
  { id: 'b', text: 'Hawk' },
];
const q = (id, number, kind, more = {}) => ({
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
function reply(shows, more = {}) {
  const r = {
    ok: true,
    returned: true,
    shows,
    questions: [
      q('q9', 1, 'choice', {
        choices: CH,
        your_answer: ['b'],
        result: 'wrong',
        answer: ['a'],
        why: 'Grass makes its own food.',
      }),
      q('q2', 2, 'number', { your_answer: 3.5, result: 'right', answer: 3.5, why: null }),
      q('q5', 3, 'true_false', { your_answer: null, result: 'wrong', answer: true, why: 'It held for every tray.' }),
      q('q1', 4, 'text', { your_answer: 'More light.', result: 'partly', answer: null, why: null }),
      q('q7', 5, 'text', { your_answer: 'Soil.', result: 'waiting', answer: null, why: null }),
      q('q8', 6, 'number', { your_answer: 2, result: null, answer: 4, why: null }),
    ],
    ...more,
  };
  if (shows === 'grade') delete r.questions;
  return r;
}

describe('the model reads quiz-result', () => {
  it('is nothing for anything but returned: true with a shows it knows', () => {
    expect(M.resultFrom(null)).toBe(null);
    expect(M.resultFrom({ ok: true, returned: false })).toBe(null);
    expect(M.resultFrom({ ok: false, error: 'not_found' })).toBe(null);
    expect(M.resultFrom({ ok: true, returned: true })).toBe(null);
    expect(M.resultFrom({ ok: true, returned: true, shows: 'everything', questions: [] })).toBe(null);
    expect(M.resultFrom({ ok: true, returned: true, shows: 'right' })).toBe(null); // right with no questions
    expect(M.resultFrom(reply('answers', { questions: [{ id: 'x' }] }))).toBe(null); // a question it cannot draw
  });

  it('grade: no question is read, even if one was sent', () => {
    const r = M.resultFrom({ ...reply('answers'), shows: 'grade' });
    expect(r.shows).toBe('grade');
    expect(r.questions).toEqual([]);
    expect(r.total).toBe(null);
  });

  it('right: each question and whether it was right, and no key, even if one was sent', () => {
    const r = M.resultFrom(reply('right'));
    expect(r.questions.map(x => x.result)).toEqual(['wrong', 'right', 'wrong', 'partly', 'waiting', null]);
    expect(r.questions.map(x => x.answer)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
    expect(r.questions.map(x => x.why)).toEqual(['', '', '', '', '', '']);
    expect(JSON.stringify(r)).not.toContain('Grass makes its own food');
  });

  it('answers: the key and the why line too', () => {
    const r = M.resultFrom(reply('answers'));
    expect(r.questions[0].answer).toEqual(['a']);
    expect(r.questions[0].why).toBe('Grass makes its own food.');
    expect(r.questions[2].answer).toBe(true);
    expect(r.questions[3].answer).toBe(undefined); // a Text question has none
  });

  it('numbers the questions 1, 2, … in the order sent, and keeps only an answer that is one of its choices', () => {
    const odd = reply('answers');
    odd.questions[0].your_answer = ['zzz', 'b'];
    odd.questions[0].answer = ['nope'];
    const r = M.resultFrom(odd);
    expect(r.questions.map(x => x.number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.questions[0].yours).toEqual(['b']);
    expect(r.questions[0].answer).toBe(undefined);
  });

  it('Add a Total gives the total, and a bad one gives none', () => {
    expect(M.resultFrom(reply('grade', { total: { earned: 7, possible: 10 } })).total).toEqual({
      earned: 7,
      possible: 10,
    });
    expect(M.resultFrom(reply('right', { total: { earned: 'x', possible: 10 } })).total).toBe(null);
    expect(M.resultFrom(reply('right', { total: { earned: -1, possible: 10 } })).total).toBe(null);
    expect(M.figure(7)).toBe('7');
    expect(M.figure(6.5)).toBe('6.5');
    // Written as constants.js's formatPoints writes a points figure.
    const real = globalThis.formatPoints;
    globalThis.formatPoints = n => 'pts:' + n;
    expect(M.figure(6.5)).toBe('pts:6.5');
    globalThis.formatPoints = real;
  });

  it('a result it does not know is none, not a guess', () => {
    const odd = reply('right');
    odd.questions[1].result = 'amazing';
    expect(M.resultFrom(odd).questions[1].result).toBe(null);
  });
});

const ctx = (r, more = {}) => ({
  mode: 'returned',
  course: 'Science 8 · Block B',
  title: 'Data Patterns Quick Check',
  due: 'Returned Nov 24',
  back: r,
  top: '<div class="sp-fb-top"><p>Your Result Proficient</p></div>',
  ...more,
});
const draw = (shows, more, extra) => V.html(ctx(M.resultFrom(reply(shows, more)), extra));
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('the returned view', () => {
  it('Grade Only stops after the teacher’s comment: no question, no key, no Look Again', () => {
    const html = draw('grade');
    expect(html).toContain('Your Result Proficient');
    expect(html).toContain('Your teacher shows your result and comment for this quiz.');
    expect(html).not.toContain('sp-quiz-ra');
    expect(html).not.toContain('Your Answers');
    expect(html).not.toContain('quiz-look');
  });

  it('Grade and Which Were Right: each question marked with a word and a mark, no right answer', () => {
    const html = draw('right');
    const t = text(html);
    expect(t).toContain('Question 1 · Not Right');
    expect(t).toContain('Question 2 · Right');
    expect(t).toContain('Question 4 · Partly Right');
    expect(t).toContain('Question 5 · Not Assessed Yet');
    expect(t).toContain('You chose: Hawk');
    expect(t).not.toContain('Right answer');
    expect(t).not.toContain('Grass makes its own food');
    // A question the marking has no result for carries no word.
    expect(t).toContain('Question 6 Prompt q8');
    expect(t).not.toContain('Question 6 ·');
  });

  it('Grade, Which Were Right and the Answers: the right answer and the why, for a question not right only', () => {
    const t = text(draw('answers'));
    expect(t).toContain('Right answer: Grass');
    expect(t).toContain('Grass makes its own food.');
    expect(t).toContain('Right answer: True');
    expect(t).toContain('It held for every tray.');
    expect(t).toContain('Right answer: 4'); // the question with no result is not "right"
    // The right question shows no key line.
    const two = text(draw('answers')).split('Question 2')[1].split('Question 3')[0];
    expect(two).not.toContain('Right answer');
  });

  it('an unanswered question says so, in the student’s own numbering', () => {
    const t = text(draw('right'));
    expect(t).toContain('Question 3 · Not Right Prompt q5 You didn’t answer this question.');
  });

  it('Look Again points at the first question not right', () => {
    const html = draw('right');
    expect(html).toContain('data-act="quiz-look" data-pos="1"');
    expect(text(html)).toContain('Look Again at Question 1');
    const clean = reply('right');
    clean.questions.forEach(x => (x.result = 'right'));
    expect(V.html(ctx(M.resultFrom(clean)))).not.toContain('quiz-look');
  });

  it('Add a Total adds “7 of 10”, whatever the quiz shows', () => {
    for (const shows of ['grade', 'right', 'answers']) {
      const t = text(draw(shows, { total: { earned: 7, possible: 10 } }));
      expect(t).toContain('Your Total');
      expect(t).toContain('7 of 10');
    }
    expect(text(draw('answers'))).not.toContain('Your Total');
  });

  it('right and wrong are never colour alone: every marked question has a word and a mark', () => {
    const html = draw('answers');
    for (const word of ['Right', 'Not Right', 'Partly Right', 'Not Assessed Yet']) expect(text(html)).toContain(word);
    expect(html).toContain('>✓<');
    expect(html).toContain('>✗<');
    expect(html).toContain('>½<');
    expect(html).toContain('>…<');
  });

  it('draws nothing it did not esc', () => {
    const r = reply('answers');
    r.questions[0].prompt = '<img src=x onerror=alert(1)>';
    r.questions[0].why = '<b>bold</b>';
    const html = V.html(ctx(M.resultFrom(r), { title: '<script>x</script>' }));
    expect(html).not.toContain('<img src=x');
    expect(html).not.toContain('<b>bold</b>');
    expect(html).not.toContain('<script>x</script>');
  });

  it('has no control but Back and Look Again, and no right answer where none is shown', () => {
    const html = draw('right');
    expect(html.match(/data-act="[^"]+"/g).sort()).toEqual(['data-act="quiz-back"', 'data-act="quiz-look"']);
  });
});

describe('contrast of the returned view (light; the student page has no dark theme)', () => {
  const css = readFileSync('s/quiz.css', 'utf8');
  const lum = hex => {
    const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255);
    const f = v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => {
    const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  it('every mark and every word colour holds 4.5:1 on white', () => {
    const at = css.indexOf('.sp-quiz-mk {');
    const colours = [...css.slice(at).matchAll(/(?:background|color): (#[0-9a-f]{6});/g)].map(m => m[1]);
    expect(colours.length).toBeGreaterThan(6);
    for (const c of new Set(colours)) expect(ratio(c, '#ffffff'), c).toBeGreaterThanOrEqual(4.5);
  });
});
