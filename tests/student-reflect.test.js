/**
 * Reflect on Feedback on the student's page (S10-F1 and S10-F2;
 * s/reflect.js, s/feedback.js, s/send.js, shared/student-view.js).
 *
 * - Only on returned work, only while the class's switch is on, only the
 *   student's own: the stand-in answers as Batch C's `reflect` and `reply`
 *   are written to, and refuses as they do.
 * - An answer the teacher kept for herself never reaches the page.
 * - The plan goes on the next piece to do; Check and Send asks Did You Do
 *   It? and keeps the student's word.
 * - Every answer draws only while the same reflection is on screen for the
 *   same student; a reply of the wrong kind never leaves a stuck screen.
 *
 * Demo Mode only (#demo-card-reflect). Nothing is sent anywhere.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';

const q = (page, sel) => page.root().querySelector(sel);
const qa = (page, sel) => [...page.root().querySelectorAll(sel)];
const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');

async function demo(hash) {
  const page = openStudentPage();
  await page.start(hash || '#demo-card-reflect');
  await page.submit('form[data-form="card"]');
  page.type('#sp-ident', page.T.DEMO.number);
  await page.click('[data-act="card-yes"]');
  return page;
}
const viewOf = page => page.T.viewOf(page.T.state());
const piece = (page, title) => viewOf(page).work.find(p => p.title === title);

async function openFeedback(page, title) {
  await page.click('[data-segment="back"]');
  const p = piece(page, title);
  await page.click('.sp-piece[data-piece="' + p.id + '"] [data-act="feedback"]');
  return p;
}
async function openReflect(page, title) {
  await openFeedback(page, title || 'Cell Microscope Lab');
  await page.click('[data-act="reflect-open"]');
}
function held() {
  let settle;
  const promise = new Promise(r => (settle = r));
  return { promise, settle };
}

describe('Reflect on Feedback off (every class until the teacher turns it on, and #demo-card-send)', () => {
  it('no button, no plan, nothing asked', async () => {
    const page = await demo('#demo-card-send');
    expect(page.T.feedbackOf(page.T.state()).reflect_on_feedback).toBe(false);
    expect(viewOf(page).reflectOn).toBe(false);
    expect(viewOf(page).work.every(p => !p.plan && !p.reflection)).toBe(true);
    await openFeedback(page, 'Cell Microscope Lab');
    expect(q(page, '[data-act="reflect-open"]')).toBeNull();
    expect(page.calls).toEqual([]);
  });
});

describe('S10-F1: reflecting, on returned work only', () => {
  it('Your Feedback has Reflect on Feedback; an answered piece says the teacher answered', async () => {
    const page = await demo();
    await openFeedback(page, 'Cell Microscope Lab');
    expect(words(q(page, '[data-act="reflect-open"]'))).toBe('Reflect on Feedback');
    await page.click('[data-act="feedback-close"]');
    await openFeedback(page, 'Energy Transfer Investigation');
    expect(words(q(page, '[data-act="reflect-open"]'))).toBe('Ms. Rivera Answered');
  });

  it('a note the teacher kept for herself is never sent: the quiz shows only what Cece asked', async () => {
    const page = await demo();
    const fb = page.T.feedbackOf(page.T.state());
    const quiz = fb.assessments.find(a => a.id === 'demo-quiz').reflection;
    expect(quiz).toMatchObject({ question: 'Why was number 4 wrong?', answer: null, answered_at: null });
    expect(JSON.stringify(fb)).not.toMatch(/Go over question 4/);
    await openFeedback(page, 'Cell Structure Quiz');
    expect(words(q(page, '[data-act="reflect-open"]'))).toBe('Your Reflection');
    await page.click('[data-act="reflect-open"]');
    expect(words(q(page, '#sp-reflect-title'))).toBe('Question Sent');
    expect(page.root().innerHTML).not.toMatch(/Go over question 4/);
  });

  it('the three steps: Yes, a plan with a starter, What Went Well; Reflection Sent with the plan', async () => {
    const page = await demo();
    await openReflect(page);
    expect(words(q(page, '#sp-reflect-title'))).toBe('Reflect on Feedback');
    expect(words(q(page, '.sp-reflect-said h2'))).toBe('Ms. Rivera Said');
    expect(words(q(page, '.sp-reflect-said p'))).toBe('Careful focusing. Label the nucleus next time.');
    const group = q(page, '[role="radiogroup"]');
    expect(group.getAttribute('aria-label')).toBe('Does the feedback make sense?');
    expect(qa(page, '[data-act="reflect-sense"]').map(words)).toEqual(['Yes', 'Not Sure']);
    expect(q(page, '[data-act="reflect-send"]')).toBeNull();
    await page.click('[data-act="reflect-sense"][data-value="yes"]');
    expect(qa(page, '.sp-reflect-step-title').map(words)).toEqual([
      '1Does the Feedback Make Sense?',
      '2What Will You Do Next Time?',
      '3What Went Well?Optional',
    ]);
    expect(qa(page, '[data-field="plan"]').map(words)).toEqual([
      'Next time I’ll…',
      'I’ll practise…',
      'Before I start, I’ll…',
    ]);
    expect(q(page, '[data-act="reflect-send"]').hasAttribute('disabled')).toBe(true);
    await page.click('[data-act="reflect-starter"][data-field="plan"][data-n="0"]');
    expect(q(page, '#sp-reflect-plan').value).toBe('Next time I’ll ');
    page.type('#sp-reflect-plan', 'Next time I’ll label every part first.');
    expect(q(page, '[data-act="reflect-send"]').hasAttribute('disabled')).toBe(false);
    page.type('#sp-reflect-went', 'I got better at focusing.');
    expect(words(q(page, '.sp-reflect-private'))).toBe('Only Ms. Rivera sees this.');
    await page.click('[data-act="reflect-send"]');
    expect(words(q(page, '#sp-reflect-title'))).toBe('Reflection Sent');
    expect(words(q(page, '.sp-reflect-plan .sp-plan-words'))).toBe('Next time I’ll label every part first.');
    expect(page.root().textContent).toMatch(/Ms\. Rivera will read it\./);
    expect(page.root().textContent).toMatch(/It’ll show on your next Science 8 assignment\./);
    const sent = page.T.feedbackOf(page.T.state());
    expect(sent.assessments.find(a => a.id === 'demo-lab').reflection).toMatchObject({
      makes_sense: 'yes',
      plan: 'Next time I’ll label every part first.',
      went_well: 'I got better at focusing.',
    });
    expect(sent.last_plan).toMatchObject({ assessment_id: 'demo-lab', plan: 'Next time I’ll label every part first.' });
    await page.click('[data-act="reflect-back"]');
    expect(page.T.state().screen).toBe('assignments');
    expect(words(q(page, '[data-act="reflect-open"]'))).toBe('Your Reflection');
    expect(page.calls).toEqual([]);
  });

  it('Not Sure: a question, Ask Ms. Rivera, Question Sent', async () => {
    const page = await demo();
    await openReflect(page);
    await page.click('[data-act="reflect-sense"][data-value="not_sure"]');
    expect(page.root().textContent).toMatch(/That’s okay\. Ask Ms\. Rivera about the part that doesn’t make sense\./);
    expect(qa(page, '[data-field="question"]').map(words)).toEqual([
      'What does … mean?',
      'Can you show me an example of…',
      'I don’t know how to…',
    ]);
    page.type('#sp-reflect-question', 'What counts as a label?');
    expect(words(q(page, '[data-act="reflect-send"]'))).toBe('Ask Ms. Rivera');
    await page.click('[data-act="reflect-send"]');
    expect(words(q(page, '#sp-reflect-title'))).toBe('Question Sent');
    expect(page.root().textContent).toMatch(/Ms\. Rivera will answer it here\./);
  });

  it('only on returned work: a press made up by hand on work not back opens nothing; the stand-in refuses it', async () => {
    const page = await demo();
    const fair = piece(page, 'Science Fair Proposal');
    expect(fair.kind).toBe('due');
    page.T.state().screen = 'assignments';
    await page.click('[data-segment="todo"]');
    const fake = page.root().ownerDocument.createElement('button');
    fake.setAttribute('data-act', 'reflect-open');
    fake.setAttribute('data-piece', fair.id);
    page.root().appendChild(fake);
    await page.click('[data-act="reflect-open"][data-piece="' + fair.id + '"]');
    expect(page.T.state().screen).toBe('assignments');
    expect(page.T.state().reflect).toBeNull();
  });

  it('the stand-in refuses as the server does: not returned, switch off, already answered, wrong shape', async () => {
    const page = await demo();
    const st = page.T.state();
    const ask = (route, body) =>
      page.run('StudentPage.feedbackAsk(' + JSON.stringify(route) + ', ' + JSON.stringify(body) + ')');
    const yes = { makes_sense: 'yes', plan: 'A plan.' };
    expect(await ask('reflect', { assessment_id: 'demo-fair', reflection: yes })).toEqual({
      ok: false,
      error: 'not_returned',
    });
    expect(await ask('reflect', { assessment_id: 'nope', reflection: yes })).toEqual({ ok: false, error: 'not_found' });
    expect(await ask('reflect', { assessment_id: 'demo-energy', reflection: yes })).toEqual({
      ok: false,
      error: 'already_answered',
    });
    expect(await ask('reflect', { assessment_id: 'demo-lab', reflection: { makes_sense: 'yes' } })).toMatchObject({
      ok: false,
    });
    expect(await ask('reply', { assessment_id: 'demo-kmt', reply: { sense_now: 'yes' } })).toEqual({
      ok: false,
      error: 'not_answered',
    });
    st.demoReflect = false;
    expect(await ask('reply', { assessment_id: 'demo-energy', reply: { sense_now: 'yes' } })).toEqual({
      ok: false,
      error: 'not_found',
    });
    expect(await ask('reflect', { assessment_id: 'demo-lab', reflection: yes })).toEqual({
      ok: false,
      error: 'reflect_off',
    });
  });
});

describe('S10-F1: Your Teacher Answered', () => {
  it('the question and the answer; Yes: "Then make your plan for next time."', async () => {
    const page = await demo();
    await openReflect(page, 'Energy Transfer Investigation');
    expect(words(q(page, '#sp-reflect-title'))).toBe('Ms. Rivera Answered');
    const bubbles = qa(page, '.sp-bubble');
    expect(words(bubbles[0].querySelector('.sp-bubble-who'))).toMatch(/^You Asked, \S+ \d+$/);
    expect(words(bubbles[0].querySelector('.sp-bubble-words'))).toBe(
      'What counts as a pattern? I thought one number going up was one.',
    );
    expect(words(bubbles[1].querySelector('.sp-bubble-who span:last-child'))).toMatch(/^Ms\. Rivera, \S+ \d+$/);
    expect(q(page, '[role="radiogroup"]').getAttribute('aria-label')).toBe('Does it make sense now?');
    await page.click('[data-act="reflect-sense-now"][data-value="yes"]');
    expect(page.root().textContent).toMatch(/Then make your plan for next time\./);
    expect(q(page, '[data-act="reflect-sense-now"][data-value="yes"]').getAttribute('aria-checked')).toBe('true');
    expect(q(page, '[data-act="reflect-sense-now"]').hasAttribute('disabled')).toBe(true);
  });

  it('Still Not Sure: one more question, once', async () => {
    const page = await demo();
    await openReflect(page, 'Energy Transfer Investigation');
    await page.click('[data-act="reflect-sense-now"][data-value="not_sure"]');
    page.type('#sp-reflect-follow', 'So is a pattern always over the whole table?');
    await page.click('[data-act="reflect-follow"]');
    expect(qa(page, '.sp-bubble-words').map(words)).toContain('So is a pattern always over the whole table?');
    expect(page.root().textContent).toMatch(/Ms\. Rivera will answer it here\./);
    expect(q(page, '[data-act="reflect-follow"]')).toBeNull();
    const again = await page.run(
      'StudentPage.feedbackAsk("reply", { assessment_id: "demo-energy", reply: { sense_now: "not_sure", follow_up: "Again?" } })',
    );
    expect(again).toEqual({ ok: false, error: 'already_asked' });
  });
});

describe('answers that arrive late, or wrong', () => {
  it('a send that lands after the student went back draws nothing and changes no screen', async () => {
    const page = await demo();
    const h = held();
    page.T.setFeedbackAnswer(() => h.promise);
    await openReflect(page);
    await page.click('[data-act="reflect-sense"][data-value="yes"]');
    page.type('#sp-reflect-plan', 'A plan.');
    await page.click('[data-act="reflect-send"]');
    expect(words(q(page, '[data-act="reflect-send"]'))).toBe('Sending…');
    await page.click('[data-act="reflect-back"]');
    h.settle({ ok: true, reflection: { makes_sense: 'yes', plan: 'A plan.' } });
    await page.settle();
    expect(page.T.state().screen).toBe('assignments');
    expect(page.T.state().reflect).toBeNull();
  });

  it('a send that lands after the student went back and opened another piece leaves that one alone', async () => {
    const page = await demo();
    const h = held();
    page.T.setFeedbackAnswer(() => h.promise);
    await openReflect(page);
    await page.click('[data-act="reflect-sense"][data-value="yes"]');
    page.type('#sp-reflect-plan', 'A plan.');
    await page.click('[data-act="reflect-send"]');
    const first = page.T.state().reflect;
    await page.click('[data-act="reflect-back"]');
    await page.click('[data-act="reflect-open"]');
    const second = page.T.state().reflect;
    expect(second).not.toBe(first);
    h.settle({ ok: false, error: 'reflect_off' });
    await page.settle();
    expect(first.message).toBe('');
    expect(first.busy).toBe(true);
    expect(q(page, '#sp-reflect-msg')).toBeNull();
  });

  it('a send that lands after Done draws nothing', async () => {
    const page = await demo();
    const h = held();
    page.T.setFeedbackAnswer(() => h.promise);
    await openReflect(page);
    await page.click('[data-act="reflect-sense"][data-value="yes"]');
    page.type('#sp-reflect-plan', 'A plan.');
    await page.click('[data-act="reflect-send"]');
    // Done, as the page's header button sends it.
    const done = page.root().ownerDocument.createElement('button');
    done.setAttribute('data-act', 'card-done');
    page.root().appendChild(done);
    await page.click('[data-act="card-done"]');
    const screen = page.T.state().screen;
    h.settle({ ok: true, reflection: {} });
    await page.settle();
    expect(page.T.state().screen).toBe(screen);
    expect(page.root().innerHTML).not.toMatch(/Reflection Sent/);
  });

  it('a reply of the wrong kind says it could not reach FullVision, and Send works again', async () => {
    const page = await demo();
    page.T.setFeedbackAnswer(() => 'not json');
    await openReflect(page);
    await page.click('[data-act="reflect-sense"][data-value="yes"]');
    page.type('#sp-reflect-plan', 'A plan.');
    await page.click('[data-act="reflect-send"]');
    expect(words(q(page, '#sp-reflect-msg'))).toBe('Couldn’t reach FullVision. Check your internet and try again.');
    expect(q(page, '[data-act="reflect-send"]').hasAttribute('disabled')).toBe(false);
    page.T.setFeedbackAnswer(null);
    await page.click('[data-act="reflect-send"]');
    expect(words(q(page, '#sp-reflect-title'))).toBe('Reflection Sent');
  });

  it('answered meanwhile: the answer shows', async () => {
    const page = await demo();
    page.T.setFeedbackAnswer(() => ({ ok: false, error: 'already_answered' }));
    await openReflect(page);
    await page.click('[data-act="reflect-sense"][data-value="yes"]');
    page.type('#sp-reflect-plan', 'A plan.');
    await page.click('[data-act="reflect-send"]');
    expect(page.T.state().reflect.step).toBe('answer');
  });
});

describe('S10-F2: the plan on the next piece, and Did You Do It?', () => {
  it('the plan from yesterday shows on the next piece to do, not the late one', async () => {
    const page = await demo();
    const fair = piece(page, 'Science Fair Proposal');
    expect(fair.plan).toEqual({
      text: 'Next time I’ll write down what I predict before I heat anything.',
      fromTitle: 'KMT & States of Matter Lab',
    });
    expect(piece(page, 'Disease Research Poster').plan).toBeNull();
    const card = q(page, '.sp-piece[data-piece="' + fair.id + '"] .sp-plan');
    expect([...card.children].map(words)).toEqual([
      'Your Plan From Last Time',
      'Next time I’ll write down what I predict before I heat anything.',
      'From your reflection on KMT & States of Matter Lab',
    ]);
  });

  it('the last plan is the newest one, whatever order the pieces come in', async () => {
    const page = await demo();
    const st = page.T.state();
    page.T.demoReflections(st)['demo-quiz'] = {
      makes_sense: 'yes',
      plan: 'An older plan.',
      sent_at: '2020-01-01T00:00:00Z',
    };
    expect(page.T.feedbackOf(st).last_plan).toMatchObject({ assessment_id: 'demo-kmt' });
  });

  it('the view: the next piece due on or after the plan, never its own, none of the wrong shape', () => {
    const reply = {
      student: {},
      course: {},
      assessments: [
        {
          id: 'a',
          title: 'A',
          date: '2026-11-01',
          due_date: '2026-11-03',
          returned_at: '2026-11-04T00:00:00Z',
          grade: { v: 1, value: 3 },
        },
        { id: 'b', title: 'B', date: '2026-11-01', due_date: '2026-11-02' },
        { id: 'c', title: 'C', date: '2026-11-01', due_date: '2026-11-12' },
        { id: 'd', title: 'D', date: '2026-11-01', due_date: '2026-11-09' },
        // Back already: a plan never goes on returned work.
        {
          id: 'e',
          title: 'E',
          date: '2026-11-01',
          due_date: '2026-11-06',
          returned_at: '2026-11-07T00:00:00Z',
          grade: { v: 1, value: 2 },
        },
      ],
    };
    const fb = lp => ({ ok: true, assessments: [], last_plan: lp });
    const plan = { assessment_id: 'a', plan: 'Read it twice.', sent_at: '2026-11-05T18:00:00Z' };
    const v = StudentView.build(reply, 'c', null, null, fb(plan));
    expect(v.work.filter(p => p.plan).map(p => [p.id, p.plan])).toEqual([
      ['d', { text: 'Read it twice.', fromTitle: 'A' }],
    ]);
    [null, { plan: 3, sent_at: '2026-11-05' }, { plan: '  ', sent_at: '2026-11-05' }, { plan: 'x' }].forEach(lp =>
      expect(StudentView.build(reply, 'c', null, null, fb(lp)).work.some(p => p.plan)).toBe(false),
    );
    expect(
      StudentView.build(reply, 'c', null, null, fb(Object.assign({}, plan, { sent_at: '2026-11-20' }))).work.some(
        p => p.plan,
      ),
    ).toBe(false);
    expect(StudentView.build(reply, 'c', null, null, { ok: false, last_plan: plan }).work.some(p => p.plan)).toBe(
      false,
    );
  });

  it('the view: a reflection only on returned work; the switch only when the reply says true', () => {
    const reply = {
      student: {},
      course: {},
      assessments: [
        { id: 'a', title: 'A', date: '2026-11-01', returned_at: '2026-11-04T00:00:00Z', grade: { v: 1, value: 3 } },
        { id: 'b', title: 'B', date: '2026-11-01' },
      ],
    };
    const r = { makes_sense: 'not_sure', question: 'Why?', sent_at: '2026-11-05T00:00:00Z' };
    const fb = {
      ok: true,
      reflect_on_feedback: true,
      assessments: [
        { id: 'a', reflection: r },
        { id: 'b', reflection: r },
      ],
    };
    const v = StudentView.build(reply, 'c', null, null, fb);
    expect(v.reflectOn).toBe(true);
    expect(v.work.find(p => p.id === 'a').reflection).toMatchObject({ makesSense: 'not_sure', question: 'Why?' });
    expect(v.work.find(p => p.id === 'b').reflection).toBeNull();
    expect(
      StudentView.build(reply, 'c', null, null, Object.assign({}, fb, { reflect_on_feedback: 'yes' })).reflectOn,
    ).toBe(false);
    const odd = Object.assign({}, fb, {
      assessments: [{ id: 'a', reflection: { makes_sense: 'maybe', sent_at: 'x' } }],
    });
    expect(StudentView.build(reply, 'c', null, null, odd).work.find(p => p.id === 'a').reflection).toBeNull();
  });

  it('Check and Send asks Did You Do It? on the piece with the plan, and keeps the student’s word', async () => {
    const page = await demo();
    page.T.setPrepare(file =>
      Promise.resolve({ ok: true, kind: 'jpeg', pages: [{ blob: { size: 1 }, thumb: { size: 1 }, hash: 'h' }] }),
    );
    await page.click('.sp-piece[data-piece="demo-fair"] [data-act="send-open"]');
    expect(words(q(page, '.sp-send-plan .sp-plan-title'))).toBe('Your Plan From Last Time');
    expect(words(q(page, '.sp-send-plan-ask'))).toBe('Did You Do It?');
    expect(q(page, '.sp-send-plan [role="radiogroup"]').getAttribute('aria-label')).toBe('Did you follow your plan?');
    expect(qa(page, '[data-act="send-followed"]').map(words)).toEqual(['Yes', 'Partly', 'Not This Time']);
    await page.T.sendFiles([{}], -1);
    await page.settle();
    await page.click('[data-act="send-followed"][data-value="partly"]');
    expect(q(page, '[data-value="partly"]').getAttribute('aria-checked')).toBe('true');
    await page.click('[data-act="send-go"]');
    expect(page.T.state().demoSent['demo-fair'].followedPlan).toBe('partly');
  });

  it('a piece with no plan asks nothing, and keeps no word', async () => {
    const page = await demo();
    page.T.setPrepare(() =>
      Promise.resolve({ ok: true, kind: 'jpeg', pages: [{ blob: { size: 1 }, thumb: { size: 1 }, hash: 'h' }] }),
    );
    await page.click('.sp-piece[data-piece="demo-poster"] [data-act="send-open"]');
    expect(q(page, '.sp-send-plan')).toBeNull();
    await page.T.sendFiles([{}], -1);
    await page.settle();
    // Even a word left on the send by hand is not kept for a piece with no plan.
    page.T.state().send.followed = 'yes';
    await page.click('[data-act="send-go"]');
    expect(page.T.state().demoSent['demo-poster'].followedPlan).toBeNull();
  });
});
