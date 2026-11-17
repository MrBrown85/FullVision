/**
 * A teacher-built reflection on the student page (docs/plans/reflect-plan.md,
 * "The data contract"; the mockup's boards 4 and 5): the Reflect tab's name
 * and its count, the first card with the title and description, each new
 * kind drawn and answered (s/question-kinds.js), what Send sends in the
 * contract's "student's answer" shapes, the star that keeps Send back,
 * Demo Mode's Unit 2 Exit Reflection, and Preview as a Student
 * (#preview-reflection). Nothing here is sent anywhere.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';

const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const q = (page, sel) => page.root().querySelector(sel);
const qa = (page, sel) => [...page.root().querySelectorAll(sel)];

async function demo() {
  const page = openStudentPage();
  await page.start('#demo-card');
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  return page;
}

async function openUnit2(page) {
  await page.click('[data-act="tab"][data-tab="questionnaires"]');
  await page.click('.sp-forms-phone [data-act="q-start"][data-form-id="demo-q-unit2"]');
  await page.settle();
}

// What gets the focus: every focus() call, in order.
function watchFocus(page) {
  const seen = [];
  let proto = Object.getPrototypeOf(page.root());
  while (proto && !Object.prototype.hasOwnProperty.call(proto, 'focus')) proto = Object.getPrototypeOf(proto);
  const was = proto.focus;
  proto.focus = function () {
    seen.push(this);
    return was && was.apply(this, arguments);
  };
  return { seen, last: () => seen[seen.length - 1] };
}

const ID = n => 'demo-unit2-' + n;

describe('the Reflect tab', () => {
  it('is called Reflect, and its badge counts the reflections open and not yet answered', async () => {
    const page = await demo();
    const tab = q(page, '.sp-tabs-bottom [data-tab="questionnaires"]');
    expect(words(tab.querySelector('.sp-tab-label'))).toBe('Reflect');
    // November Reflection and Unit 2 Exit Reflection are open; About Me is sent, March not open yet.
    expect(words(tab.querySelector('.sp-tab-badge'))).toBe('2');
    expect(tab.querySelector('.sp-tab-badge').getAttribute('aria-hidden')).toBe('true');
    expect(words(tab.querySelector('.sp-hidden-title'))).toBe('2 to answer');
    await page.click('[data-act="tab"][data-tab="questionnaires"]');
    expect(words(q(page, 'h1.sp-page-title'))).toBe('Reflect');
    const card = qa(page, '.sp-forms-phone .sp-form-card').find(
      c => words(c.querySelector('.sp-form-title')) === 'Unit 2 Exit Reflection',
    );
    expect(words(card.querySelector('.sp-form-sub'))).toBe('A few questions about how the unit went. About 5 minutes.');
  });

  it('the view with nothing open has no badge on Reflect', () => {
    const page = openStudentPage();
    const html = page.run('StudentPageView.html')(
      {
        course: { name: 'Science 8' },
        work: [],
        changes: [],
        questionnaires: [
          { id: 'a', title: 'A', state: 'sent' },
          { id: 'b', title: 'B', state: 'soon' },
        ],
      },
      { tab: 'questionnaires' },
    );
    expect(html).not.toContain('to answer');
  });
});

describe('Unit 2 Exit Reflection in Demo Mode', () => {
  it('opens on a first card with its title and description, then board 5’s questions, a heading and a date', async () => {
    const page = await demo();
    await openUnit2(page);
    expect(page.T.state().screen).toBe('part');
    expect(words(q(page, '.sp-head-title'))).toBe('Unit 2 Exit Reflection');
    const first = q(page, '.sp-main > .sp-card');
    expect(words(first.querySelector('h1'))).toBe('Unit 2 Exit Reflection');
    expect(words(first.querySelector('.sp-note'))).toBe('A few questions about how the unit went. About 5 minutes.');
    // The section heading takes no answer and is not counted: six of the seven.
    expect(words(q(page, '#sp-count'))).toBe('0 of 6 answered');
    expect(qa(page, '[data-qbox]')).toHaveLength(6);
    expect(words(q(page, '.sp-rq-section h2'))).toBe('Before You Go');
    expect(words(q(page, '.sp-rq-section .sp-note'))).toBe('One last question about your lab report.');
    // Three marked with a star, each with its word for a screen reader.
    expect(qa(page, '.sp-req')).toHaveLength(3);
    expect(qa(page, '.sp-req').every(s => s.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(words(q(page, '#q-' + ID(1) + '-p'))).toBe(
      'What is one thing you understand better after this unit? * (required)',
    );
    expect(q(page, '#q-' + ID(1)).getAttribute('aria-required')).toBe('true');
    // The rating: five, its ends in words, the ends read with their numbers.
    const rate = qa(page, '[data-act="rate"][data-q="' + ID(2) + '"]');
    expect(rate.map(words)).toEqual(['1', '2', '3', '4', '5']);
    expect(rate[0].getAttribute('aria-label')).toBe('1, Not Yet');
    expect(rate[4].getAttribute('aria-label')).toBe('5, Could Teach It');
    expect(qa(page, '.sp-rq-ends span').map(words)).toEqual(['Not Yet', 'Could Teach It']);
    // One answer from a list, with Other last.
    expect(qa(page, '[data-qbox="' + ID(3) + '"] [role="radio"]').map(words)).toEqual([
      'Labs',
      'Notes',
      'Practice Questions',
      'Group Work',
      'Other',
    ]);
    // Each statement with its row of choices, named by the statement.
    const rows = qa(page, '[data-qbox="' + ID(4) + '"] .sp-rq-lk-row');
    expect(rows.map(r => words(r.querySelector('.sp-rq-lk-st')))).toEqual([
      'I asked questions when I was stuck',
      'I checked my work before handing it in',
      'I helped someone in my group',
    ]);
    const group = rows[0].querySelector('[role="radiogroup"]');
    expect(q(page, '#' + group.getAttribute('aria-labelledby')).textContent).toBe('I asked questions when I was stuck');
    expect([...group.querySelectorAll('button')].map(words)).toEqual(['Never', 'Sometimes', 'Usually', 'Always']);
    // The ranking: arrows only, the first with no Up and the last with no Down.
    const rank = qa(page, '[data-rank-q="' + ID(5) + '"] li');
    expect(rank.map(li => words(li.querySelector('.sp-rq-rank-text')))).toEqual([
      'Labs',
      'Notes',
      'Practice Questions',
    ]);
    expect([...rank[0].querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual(['Move Labs down']);
    expect([...rank[1].querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual([
      'Move Notes up',
      'Move Notes down',
    ]);
    expect([...rank[2].querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual([
      'Move Practice Questions up',
    ]);
    expect(words(q(page, '[data-qbox="' + ID(5) + '"]'))).toContain('Use the arrows to move one up or down.');
    // The date, with its subtitle read with it.
    const date = q(page, '#q-' + ID(7));
    expect(date.getAttribute('type')).toBe('date');
    expect(q(page, '#' + date.getAttribute('aria-describedby')).textContent).toBe(
      'Pick the day you plan to hand it in.',
    );
  });

  it('Send stays back until the starred ones are answered, and goes to the first one not answered', async () => {
    const page = await demo();
    await openUnit2(page);
    const focus = watchFocus(page);
    await page.click('[data-act="send"]');
    expect(page.T.state().screen).toBe('part');
    expect(words(q(page, '.sp-msg'))).toBe('Answer the questions marked with a star first.');
    expect(q(page, '.sp-msg').getAttribute('role')).toBe('alert');
    expect(focus.last().id).toBe('q-' + ID(1));
    page.type('#q-' + ID(1), 'Why the small numbers never change.');
    await page.click('[data-act="rate"][data-q="' + ID(2) + '"][data-value="4"]');
    await page.click('[data-act="send"]');
    // The choice is next: the focus goes to its first choice.
    expect(focus.last().getAttribute('data-value')).toBe('Labs');
    expect(page.T.state().screen).toBe('part');
    // The last starred one answered: the message has done its job and goes.
    await page.click('[data-act="kc-pick"][data-q="' + ID(3) + '"][data-value="Notes"]');
    expect(q(page, '.sp-msg')).toBeNull();
    expect(page.calls).toEqual([]);
  });

  it('answers each kind and sends the contract’s shapes; Demo Mode sends nothing', async () => {
    const page = await demo();
    await openUnit2(page);
    page.type('#q-' + ID(1), '  Why the small numbers never change.  ');
    await page.click('[data-act="rate"][data-q="' + ID(2) + '"][data-value="4"]');
    expect(q(page, '[data-act="rate"][data-value="4"]').getAttribute('aria-checked')).toBe('true');
    // Other, typed, then a choice in its place (one answer).
    await page.click('[data-act="kc-other"][data-q="' + ID(3) + '"]');
    page.type('#q-' + ID(3) + '-other', '  Videos ');
    expect(page.T.state().answers[ID(3)]).toEqual(['Videos']);
    await page.click('[data-act="kc-pick"][data-q="' + ID(3) + '"][data-value="Labs"]');
    expect(q(page, '#q-' + ID(3) + '-other')).toBeNull();
    expect(page.T.state().answers[ID(3)]).toEqual(['Labs']);
    expect(words(q(page, '#sp-count'))).toBe('3 of 6 answered');
    // A likert with two of three statements is sent, but not counted as answered.
    await page.click('[data-act="likert"][data-q="' + ID(4) + '"][data-s="0"][data-value="Usually"]');
    await page.click('[data-act="likert"][data-q="' + ID(4) + '"][data-s="2"][data-value="Always"]');
    expect(words(q(page, '#sp-count'))).toBe('3 of 6 answered');
    // The ranking is not sent until one is moved.
    expect(page.T.collect(page.T.state())).not.toHaveProperty(ID(5));
    await page.click('[data-act="rank-down"][data-q="' + ID(5) + '"][data-i="0"]');
    expect(qa(page, '[data-rank-q="' + ID(5) + '"] .sp-rq-rank-text').map(words)).toEqual([
      'Notes',
      'Labs',
      'Practice Questions',
    ]);
    expect(words(q(page, '#sp-count'))).toBe('4 of 6 answered');
    page.type('#q-' + ID(7), '2026-11-20');
    expect(words(q(page, '#sp-count'))).toBe('5 of 6 answered');
    expect(page.T.collect(page.T.state())).toEqual({
      [ID(1)]: 'Why the small numbers never change.',
      [ID(2)]: 4,
      [ID(3)]: ['Labs'],
      [ID(4)]: { 'I asked questions when I was stuck': 'Usually', 'I helped someone in my group': 'Always' },
      [ID(5)]: ['Notes', 'Labs', 'Practice Questions'],
      [ID(7)]: '2026-11-20',
    });
    await page.click('[data-act="send"]');
    await page.settle();
    expect(page.T.state().screen).toBe('sent');
    expect(words(q(page, '.sp-big'))).toBe('Sent to Your Teacher');
    expect(words(page.root())).toContain('This was Demo Mode. Nothing was sent.');
    await page.click('[data-act="page-back"]');
    expect(q(page, '.sp-tab[aria-current="page"]').getAttribute('data-tab')).toBe('questionnaires');
    expect(page.calls).toEqual([]);
  });

  it('November Reflection still opens the ready-made questions', async () => {
    const page = await demo();
    await page.click('[data-act="tab"][data-tab="questionnaires"]');
    await page.click('.sp-forms-phone [data-act="q-start"][data-form-id="demo-q-reflection"]');
    await page.settle();
    expect(page.T.state().data.parts.map(p => p.kind)).toEqual(['core_reflection', 'goal_checkin']);
    expect(q(page, '.sp-rq-list, .sp-req, [data-qbox]')).toBeNull();
  });
});

/* Each kind on its own, drawn and answered as the page holds it. */
function part(questions) {
  return { id: 'p', kind: 'custom', title: 'Check-In', theme: 'Short.', questions };
}
async function opened(questions) {
  const page = openStudentPage();
  await page.start('#demo-card');
  const S = page.T.state();
  S.data = {
    ok: true,
    token: 'demo',
    student: { first_name: 'Cece' },
    course: { name: 'Science 8' },
    parts: [part(questions)],
    context: {},
  };
  S.part = 0;
  S.answers = {};
  S.screen = 'part';
  page.run('StudentPage.paint')();
  return page;
}
const Q = (id, kind, prompt, options) => ({
  id,
  kind,
  prompt,
  options: options || {},
  core_ids: [],
  teacher_only: false,
});

describe('each new kind and option', () => {
  it('text: one line with long false, a box otherwise; a subtitle under any question', async () => {
    const page = await opened([
      Q('a', 'text', 'Your name for the poster?', { long: false, subtitle: 'A word or two.' }),
      Q('b', 'text', 'Tell me more.'),
    ]);
    expect(q(page, '#q-a').tagName).toBe('INPUT');
    expect(q(page, '#q-a').getAttribute('maxlength')).toBe('2000');
    expect(q(page, '#q-a').getAttribute('aria-describedby')).toBe('q-a-sub');
    expect(words(q(page, '#q-a-sub'))).toBe('A word or two.');
    expect(q(page, '#q-b').tagName).toBe('TEXTAREA');
    page.type('#q-a', ' Atoms ');
    expect(page.T.collect(page.T.state())).toEqual({ a: 'Atoms' });
  });

  it('choice: many answers with Other kept beside them; a dropdown with Other opens its box', async () => {
    const page = await opened([
      Q('m', 'choice', 'Which did you use?', { choices: ['Labs', 'Notes'], other: true }),
      Q('d', 'choice', 'Pick one.', { choices: ['Red', 'Blue'], dropdown: true, multiple: false, other: true }),
    ]);
    expect(qa(page, '[data-qbox="m"] [role="checkbox"]').map(words)).toEqual(['Labs', 'Notes', 'Other']);
    expect(q(page, '[data-qbox="m"] [role="group"]')).toBeTruthy();
    await page.click('[data-act="kc-pick"][data-q="m"][data-value="Notes"]');
    await page.click('[data-act="kc-other"][data-q="m"]');
    page.type('#q-m-other', 'Videos');
    await page.click('[data-act="kc-pick"][data-q="m"][data-value="Labs"]');
    expect(page.T.state().answers.m).toEqual(['Notes', 'Videos', 'Labs']);
    expect(q(page, '#q-m-other').value).toBe('Videos');
    // Other turned off takes its typed answer with it.
    await page.click('[data-act="kc-other"][data-q="m"]');
    expect(page.T.state().answers.m).toEqual(['Notes', 'Labs']);
    // The dropdown.
    const sel = q(page, 'select#q-d');
    expect([...sel.querySelectorAll('option')].map(words)).toEqual(['Choose One', 'Red', 'Blue', 'Other']);
    page.choose('select#q-d', 'Blue');
    sel.dispatchEvent(new sel.ownerDocument.defaultView.Event('change', { bubbles: true }));
    expect(page.T.state().answers.d).toEqual(['Blue']);
    const again = q(page, 'select#q-d');
    page.choose('select#q-d', '__other__');
    again.dispatchEvent(new again.ownerDocument.defaultView.Event('change', { bubbles: true }));
    expect(q(page, '#q-d-other')).toBeTruthy();
    page.type('#q-d-other', 'Green');
    expect(page.T.collect(page.T.state())).toEqual({ m: ['Notes', 'Labs'], d: ['Green'] });
  });

  it('choice: a kept answer the teacher has since renamed or removed is not shown, counted or sent', async () => {
    const page = await opened([
      Q('a', 'choice', 'One answer', { choices: ['Labs', 'Notes'], multiple: false }),
      Q('b', 'choice', 'Many answers', { choices: ['Labs', 'Notes'], other: true }),
    ]);
    const S = page.T.state();
    // A draft from before the teacher renamed "Old" and "Older": only one typed Other is kept, with Other on.
    S.answers = { a: ['Old'], b: ['Older', 'Notes', 'Videos'] };
    page.run('StudentPage.paint')();
    expect(qa(page, '[data-qbox="a"] [aria-checked="true"]')).toEqual([]);
    expect(qa(page, '[data-qbox="b"] [aria-checked="true"]').map(words)).toEqual(['Notes', 'Other']);
    expect(q(page, '#q-b-other').value).toBe('Videos');
    expect(words(q(page, '#sp-count'))).toBe('1 of 2 answered');
    expect(page.T.collect(S)).toEqual({ b: ['Notes', 'Videos'] });
    // Without Other, a text not among the choices is never sent.
    S.answers = { a: ['Labs', 'Gone'] };
    expect(page.T.collect(S)).toEqual({ a: ['Labs'] });
  });

  it('choice: an Other typed the same as a listed choice is that choice, and Other goes off', async () => {
    const page = await opened([
      Q('o', 'choice', 'Which?', { choices: ['Labs', 'Notes'], multiple: false, other: true }),
    ]);
    await page.click('[data-act="kc-other"][data-q="o"]');
    page.type('#q-o-other', ' labs ');
    expect(page.T.state().answers.o).toEqual(['Labs']);
    page.run('StudentPage.paint')();
    expect(qa(page, '[data-qbox="o"] [aria-checked="true"]').map(words)).toEqual(['Labs']);
    expect(q(page, '#q-o-other')).toBeNull();
    expect(page.T.collect(page.T.state())).toEqual({ o: ['Labs'] });
  });

  it('a teacher’s own prompt keeps "this class"; a ready-made one reads the class’s name', async () => {
    const page = await opened([Q('c', 'text', 'What did you like about this class?')]);
    expect(words(q(page, '#q-c-p'))).toBe('What did you like about this class?');
    const S = page.T.state();
    S.data.parts.push({
      id: 'r',
      kind: 'about_me',
      title: 'About Me',
      questions: [
        { id: 'r1', kind: 'text', prompt: 'How can these help you in this class?', options: {}, core_ids: [] },
      ],
    });
    S.part = 1;
    page.run('StudentPage.paint')();
    expect(words(page.root())).toContain('How can these help you in Science 8?');
  });

  it('choice with shuffle: one order for the page load, the same each time it is drawn', async () => {
    const choices = 'ABCDEFGHIJKLMNOP'.split('');
    const page = await opened([Q('s', 'choice', 'Shuffled', { choices, multiple: false, shuffle: true })]);
    const order = () => qa(page, '[data-act="kc-pick"][data-q="s"]').map(b => b.getAttribute('data-value'));
    const first = order();
    expect([...first].sort()).toEqual(choices);
    expect(first).not.toEqual(choices); // 1 in 16! to fail
    await page.click('[data-act="kc-pick"][data-q="s"][data-value="C"]');
    expect(order()).toEqual(first);
  });

  it('rating: 5 when levels are not given; 10 in two rows; pressed again, none', async () => {
    const page = await opened([Q('r', 'rating', 'How sure?'), Q('t', 'rating', 'Out of ten', { levels: 10 })]);
    expect(qa(page, '[data-act="rate"][data-q="r"]')).toHaveLength(5);
    expect(qa(page, '[data-act="rate"][data-q="t"]')).toHaveLength(10);
    expect(q(page, '[data-qbox="t"] .sp-rq-rate').getAttribute('style')).toContain('repeat(5,');
    await page.click('[data-act="rate"][data-q="t"][data-value="7"]');
    expect(page.T.collect(page.T.state())).toEqual({ t: 7 });
    await page.click('[data-act="rate"][data-q="t"][data-value="7"]');
    expect(page.T.collect(page.T.state())).toEqual({});
  });

  it('likert: more than four columns stack on a phone; a starred one needs every statement', async () => {
    const page = await opened([
      Q('l', 'likert', 'How true?', {
        required: true,
        statements: ['One', 'Two'],
        choices: ['1', '2', '3', '4', '5'],
      }),
    ]);
    expect(q(page, '.sp-rq-scale').classList.contains('sp-rq-scale-wide')).toBe(true);
    await page.click('[data-act="likert"][data-q="l"][data-s="0"][data-value="3"]');
    expect(page.T.firstMissing(page.T.state())).toMatchObject({ part: 0, q: { id: 'l' } });
    await page.click('[data-act="send"]');
    expect(words(q(page, '.sp-msg'))).toBe('Answer the questions marked with a star first.');
    await page.click('[data-act="likert"][data-q="l"][data-s="1"][data-value="5"]');
    expect(page.T.firstMissing(page.T.state())).toBeNull();
    expect(page.T.collect(page.T.state())).toEqual({ l: { One: '3', Two: '5' } });
  });

  it('ranking: moved down then up again is still the student’s order, every choice once', async () => {
    const page = await opened([Q('k', 'ranking', 'Order these', { choices: ['A', 'B', 'C'] })]);
    expect(page.T.isAnswered({ kind: 'ranking', options: { choices: ['A', 'B', 'C'] } }, undefined)).toBe(false);
    await page.click('[data-act="rank-down"][data-q="k"][data-i="1"]');
    await page.click('[data-act="rank-up"][data-q="k"][data-i="2"]');
    expect(page.T.collect(page.T.state())).toEqual({ k: ['A', 'B', 'C'] });
    // An order kept from before the teacher changed the choices: only theirs, each once.
    page.T.state().answers.k = ['C', 'X', 'C'];
    expect(page.T.collect(page.T.state())).toEqual({ k: ['C', 'A', 'B'] });
  });

  it('date: only a whole day is sent', async () => {
    const page = await opened([Q('d', 'date', 'When?')]);
    page.type('#q-d', '2026-1');
    expect(page.T.collect(page.T.state())).toEqual({});
    page.type('#q-d', '2026-12-01');
    expect(page.T.collect(page.T.state())).toEqual({ d: '2026-12-01' });
  });

  it('every text goes through esc', async () => {
    const page = await opened([
      Q('x', 'choice', '<b>Prompt</b>', { choices: ['<i>a</i>', 'b"c'], subtitle: '<u>s</u>', multiple: false }),
      Q('y', 'likert', 'L', { statements: ['<s>st</s>'], choices: ['<em>c</em>', 'd'] }),
      Q('z', 'section', '<h3>Head</h3>', { subtitle: '<b>x</b>' }),
    ]);
    expect(page.root().querySelector('b, i, u, s, em, h3')).toBeNull();
    expect(words(q(page, '#q-x-p'))).toBe('<b>Prompt</b>');
  });
});

describe('Preview as a Student', () => {
  const draft = {
    title: 'Lab Check-In',
    description: 'Two quick questions.',
    course: { name: 'Chemistry 11' },
    questions: [
      { prompt: 'How did the lab go?', kind: 'text', options: { required: true } },
      { id: 'q2', prompt: 'How sure are you?', kind: 'rating', options: { levels: 4 } },
      { id: 'q3', prompt: 'Anything else about this class?', kind: 'text', options: { long: false } },
    ],
  };

  it('draws the stored draft once, says it is a preview, and Send sends nothing', async () => {
    const page = openStudentPage({ store: { 'fv-reflect-preview': JSON.stringify(draft) } });
    await page.start('#preview-reflection');
    // Read once and removed.
    expect(page.store).not.toHaveProperty('fv-reflect-preview');
    expect(page.T.state().screen).toBe('part');
    expect(words(q(page, '.sp-preview-note'))).toBe('This is a preview. Nothing is sent.');
    expect(words(q(page, '.sp-head-title'))).toBe('Lab Check-In');
    expect(words(page.root())).toContain('Chemistry 11');
    expect(words(q(page, '.sp-main h1'))).toBe('Lab Check-In');
    expect(words(page.root())).toContain('Two quick questions.');
    // A teacher's own words: "this class" is not rewritten in the preview either.
    expect(words(q(page, '#q-q3-p'))).toBe('Anything else about this class?');
    // A question with no id yet gets one of its own.
    expect(q(page, '#q-preview-1')).toBeTruthy();
    expect(qa(page, '[data-act="rate"][data-q="q2"]')).toHaveLength(4);
    // No way back to a page that isn't there.
    expect(q(page, '[data-act="back"]')).toBeNull();
    await page.click('[data-act="send"]');
    expect(words(q(page, '.sp-msg'))).toBe('Answer the questions marked with a star first.');
    page.type('#q-preview-1', 'Fine.');
    await page.click('[data-act="send"]');
    expect(page.T.state().screen).toBe('sent');
    expect(words(page.root())).toContain('This is a preview. Nothing was sent.');
    expect(words(page.root())).not.toContain('Demo Mode');
    expect(page.calls).toEqual([]);
    expect(page.probes).toEqual([]);
    expect(page.tab).toEqual({});
  });

  it('with nothing stored, says there is nothing to preview and asks for no sign-in', async () => {
    const page = openStudentPage();
    await page.start('#preview-reflection');
    expect(page.T.state().screen).toBe('previewnone');
    expect(words(q(page, 'h1'))).toBe('Nothing to Preview');
    expect(words(page.root())).toContain('There is nothing to preview.');
    expect(q(page, '#sp-code')).toBeNull();
    expect(page.calls).toEqual([]);
  });
});
