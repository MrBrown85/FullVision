/**
 * Questionnaires from a real card, on the Reflect tab (S4-F4; s/app.js's
 * loadForms and openRealForm, s/questionnaire.js's sendFromCard), against
 * the routes of supabase/functions/student-submit/forms-routes.ts as
 * phase2-routes-contract.md (Batch E) writes them: `forms` once the page is
 * up, `form` to open one, `answer` to send, each with the session and the
 * student it is for.
 *
 * - Reflect lists the questionnaires `forms` gave; a function without
 *   the route (bad_request) leaves the page exactly as drawn.
 * - Start opens the questions from `form`; Send posts `answer` once, with
 *   no token, and shows Sent (already_sent too); a refusal says why.
 * - The phone reports `forms` also lists are not on the card's page
 *   (Colin, 2026-11-14): no Reports tab, and `report` is never asked.
 * - Nothing outlasts the session: Log Out, then the next student is asked
 *   their own `forms`, and this tab keeps no draft.
 * The stand-in answers only these routes; the rest of the function is the
 * real handler over the stand-in database.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { CECE, OMAR, fakeStudentSubmit, sampleCard, samplePage } from './helpers/fake-student-submit.js';

const TODAY = new Date().toLocaleDateString('en-CA');
const Q = '00000091-0000-4000-8000-000000000000';
const R = '00000092-0000-4000-8000-000000000000';
const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const bodies = (page, route) => page.calls.filter(c => c.body.route === route).map(c => c.body);
const viewOf = page => page.T.viewOf(page.T.state());

const PARTS = [
  {
    id: 'p1',
    kind: 'core_reflection',
    title: 'November Reflection',
    questions: [{ id: 'q1', kind: 'text', prompt: 'How did it go?', options: {}, core_ids: [] }],
  },
];
const REPORT = {
  v: 1,
  name: 'Cece Adeyemi',
  first: 'Cece',
  course: 'Science 8',
  report: 'Report 1',
  issued: '2026-11-09T18:00:00Z',
  overall: { mode: 'proficiency', text: '3.0', level: 3, word: 'Proficient' },
  comment: ['Cece is working at a proficient level.'],
};

function lists(student) {
  return {
    questionnaires: [
      {
        id: Q,
        title: student === OMAR ? 'Omar’s Check-In' : 'November Reflection',
        description: 'Core Competencies and your goal check-in',
        minutes: null,
        state: 'open',
        opens_on: null,
        closes_on: '2026-11-30',
        sent_at: null,
      },
    ],
    reports: [
      {
        id: R,
        title: 'Report 1',
        issued_at: '2026-11-09T18:00:00Z',
        expires_on: '2026-11-30',
        opened_at: null,
        overall: { word: 'Proficient', text: '3.0', level: 3 },
        comment: ['Cece is working at a proficient level.'],
      },
    ],
  };
}

/* The routes as the contract answers them. `world.off` is the function from
   before them; `world.form` and `world.answer` are a refusal to answer with. */
function routes(world) {
  return body => {
    if (!['forms', 'form', 'answer', 'report'].includes(body.route)) return null;
    if (world.off) return { ok: false, error: 'bad_request' };
    if (!body.session) return { ok: false, error: 'signed_out' };
    const student = body.enrollment_id;
    if (body.route === 'forms') {
      const l = lists(student);
      if (world.sent) l.questionnaires[0] = { ...l.questionnaires[0], state: 'sent', sent_at: world.sent };
      return { ok: true, v: 1, ...l };
    }
    if (body.route === 'form') return world.form || { ok: true, parts: PARTS, context: {} };
    if (body.route === 'answer') {
      // Answered before (on a slip, or in another tab): the server lists it as sent.
      if (!world.answer || world.answer.error === 'already_sent') world.sent = '2026-11-11T19:00:00Z';
      if (world.answer) return world.answer;
      return { ok: true, submitted_at: world.sent };
    }
    return { ok: true, report: REPORT };
  };
}

function school(world) {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
  fn.state.cards.K7M4QX2P = sampleCard(TODAY, {
    code: 'K7M4QX2P',
    enrollment: OMAR,
    first: 'Omar',
    number: '7654321',
    page: Object.assign(samplePage(TODAY), { student: { enrollment_id: OMAR, first_name: 'Omar' }, assessments: [] }),
  });
  const stand = routes(world);
  const page = openStudentPage({ store: {} });
  page.server = body => stand(body) || fn.handle(body);
  return page;
}
async function signIn(page, hash, number) {
  await page.start(hash || '#P3R8-WDK4');
  page.type('#sp-ident', number || '0123456');
  await page.click('[data-act="card-yes"]');
  await page.settle();
  return page;
}
async function openQuestions(page) {
  await page.click('[data-act="tab"][data-tab="questionnaires"]');
  await page.click('[data-act="q-start"][data-form-id="' + Q + '"]');
  await page.settle();
}
async function answerAndSend(page) {
  page.type('#q-q1', 'It went well.');
  await page.click('[data-act="send"]');
  await page.settle();
}

describe('Reflect', () => {
  it('asks `forms` once after sign-in, with the session and the student', async () => {
    const page = await signIn(school({}));
    const asks = bodies(page, 'forms');
    expect(asks).toHaveLength(1);
    expect(asks[0].enrollment_id).toBe(CECE);
    expect(asks[0].session).toMatch(/\S/);
  });

  it('lists what `forms` gave', async () => {
    const page = await signIn(school({}));
    expect(viewOf(page).questionnaires.map(q => [q.id, q.title, q.state])).toEqual([
      [Q, 'November Reflection', 'open'],
    ]);
    await page.click('[data-act="tab"][data-tab="questionnaires"]');
    expect(words(page.root().querySelector('.sp-page-title'))).toBe('Reflect');
    expect(page.root().querySelector('[data-act="q-start"][data-form-id="' + Q + '"]')).toBeTruthy();
  });

  it('a function without the routes (bad_request) leaves the page byte for byte as drawn', async () => {
    const off = await signIn(school({ off: true }));
    // The same page where `forms` answers that there is nothing.
    const before = openStudentPage({ store: {} });
    const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
    before.server = body =>
      body.route === 'forms' ? { ok: true, v: 1, questionnaires: [], reports: [] } : fn.handle(body);
    await signIn(before);
    expect(bodies(off, 'forms')).toHaveLength(1);
    expect(off.root().innerHTML).toBe(before.root().innerHTML);
    expect(viewOf(off).questionnaires).toEqual([]);
    await off.click('[data-act="tab"][data-tab="questionnaires"]');
    expect(words(off.root())).toContain('Reflections from your teacher will show here.');
  });
});

describe('a questionnaire', () => {
  it('Start asks `form` and shows its questions', async () => {
    const page = await signIn(school({}));
    await openQuestions(page);
    expect(bodies(page, 'form')).toEqual([
      expect.objectContaining({ route: 'form', enrollment_id: CECE, questionnaire_id: Q }),
    ]);
    expect(bodies(page, 'form')[0].session).toMatch(/\S/);
    expect(page.T.state().screen).toBe('part');
    expect(words(page.root().querySelector('label[for="q-q1"]'))).toBe('How did it go?');
  });

  it('Send posts `answer` with the session, the student, the questionnaire and the answers, then shows Sent', async () => {
    const page = await signIn(school({}));
    await openQuestions(page);
    await answerAndSend(page);
    const [sent] = bodies(page, 'answer');
    expect(bodies(page, 'answer')).toHaveLength(1);
    expect(sent).toMatchObject({ enrollment_id: CECE, questionnaire_id: Q, answers: { q1: 'It went well.' } });
    expect(sent.session).toMatch(/\S/);
    expect(sent.token).toBeUndefined();
    expect(bodies(page, 'submit')).toEqual([]);
    expect(words(page.root().querySelector('.sp-big'))).toBe('Sent to Your Teacher');
    // Back on the page, it reads Sent, from the server's list asked again.
    await page.click('[data-act="page-back"]');
    expect(bodies(page, 'forms').length).toBeGreaterThanOrEqual(2);
    expect(viewOf(page).questionnaires[0].state).toBe('sent');
    expect(page.tab).toEqual({});
  });

  it('already_sent shows Sent', async () => {
    const page = await signIn(school({ answer: { ok: false, error: 'already_sent' } }));
    await openQuestions(page);
    await answerAndSend(page);
    expect(words(page.root().querySelector('.sp-big'))).toBe('Sent to Your Teacher');
    expect(viewOf(page).questionnaires[0].state).toBe('sent');
  });

  it('a refusal says why in a plain sentence, and the answers stay', async () => {
    const page = await signIn(school({ answer: { ok: false, error: 'closed' } }));
    await openQuestions(page);
    await answerAndSend(page);
    expect(bodies(page, 'answer')).toHaveLength(1);
    expect(page.T.state().screen).toBe('part');
    expect(words(page.root().querySelector('.sp-msg'))).toBe(
      'These questions are closed now. Ask your teacher if you still need to answer.',
    );
    expect(page.root().querySelector('#q-q1').value).toBe('It went well.');
  });

  it('one that will not open says why, with the way back to the page', async () => {
    const page = await signIn(school({ form: { ok: false, error: 'not_open_yet', opens_on: '2026-12-01' } }));
    await openQuestions(page);
    expect(words(page.root().querySelector('.sp-lead[role="alert"]'))).toMatch(/^These questions open on /);
    await page.click('[data-act="page-back"]');
    expect(page.T.state().screen).toBe('assignments');
    expect(page.T.state().tab).toBe('questionnaires');
  });
});

describe('a phone report', () => {
  it('one `forms` lists is not shown on the card’s page, and `report` is never asked', async () => {
    const page = await signIn(school({}));
    expect(bodies(page, 'forms')).toHaveLength(1);
    expect(viewOf(page).reports).toBeUndefined();
    expect(page.T.state().realForms).not.toHaveProperty('reports');
    expect(page.root().querySelector('[data-tab="reports"]')).toBeNull();
    for (const tab of ['assignments', 'learning', 'questionnaires']) {
      await page.click('.sp-tabs-bottom [data-act="tab"][data-tab="' + tab + '"]');
      expect(page.root().querySelector('[data-act="r-open"]'), tab).toBeNull();
      expect(page.root().innerHTML, tab).not.toContain('Report 1');
      expect(page.root().innerHTML, tab).not.toContain(R);
    }
    expect(bodies(page, 'report')).toEqual([]);
  });
});

describe('nothing outlasts the session', () => {
  it('Log Out, then another student signs in and is asked their own `forms`; no draft is left', async () => {
    const page = await signIn(school({}));
    await openQuestions(page);
    page.type('#q-q1', 'Half an answer');
    await new Promise(r => setTimeout(r, 450)); // the draft is kept once the student pauses
    expect(Object.keys(page.tab)).toEqual(['fv-s-card-drafts']);
    await page.click('[data-act="back"]');
    await page.click('[data-act="settings-open"]');
    await page.click('.sp-set [data-act="logout-ask"]');
    // Log Out? takes presses once it has been up a moment (a double tap is not a yes).
    page.advance(500);
    await page.click('[data-act="card-done"]');
    expect(page.tab).toEqual({});
    expect(page.T.state().realForms).toBeNull();
    await page.click('[data-act="card-restart"]');
    page.type('#sp-code', 'K7M4-QX2P');
    await page.submit('form[data-form="card"]');
    page.type('#sp-ident', '7654321');
    await page.click('[data-act="card-yes"]');
    await page.settle();
    const asks = bodies(page, 'forms');
    expect(asks.map(b => b.enrollment_id)).toEqual([CECE, OMAR]);
    expect(viewOf(page).questionnaires[0].title).toBe('Omar’s Check-In');
  });
});

/* Fifteen minutes with no activity signs the page out (DECISIONS, "Student
   page build rulings" 4). A reflection opened from the page is never taken
   down mid-answer, but a key or a touch on it was not counted as activity
   either: a student who wrote for more than fifteen minutes was signed out,
   and the answers deleted, on going back to the page (Nov 25 2026). */
describe('writing a reflection is activity', () => {
  const MIN = 60 * 1000;
  const afterBack = async page => {
    await page.click('[data-act="back"]');
    page.T.checkSession();
    page.runTimers();
    await page.settle();
  };

  it.each(['keydown', 'touchstart', 'pointerdown'])(
    'twenty minutes of writing (%s), then Back: still signed in, the page up, the draft kept',
    async name => {
      const page = await signIn(school({}));
      await openQuestions(page);
      for (let i = 0; i < 4; i++) {
        page.advance(5 * MIN);
        page.fire(name);
      }
      page.type('#q-q1', 'A long answer, twenty minutes in the writing');
      await new Promise(r => setTimeout(r, 450)); // the draft is kept once the student pauses
      await afterBack(page);
      expect(page.T.state().screen).toBe('assignments');
      expect(page.root().querySelector('.sp-page-title')).toBeTruthy();
      expect(Object.keys(page.tab)).toEqual(['fv-s-card-drafts']);
      expect(bodies(page, 'done')).toEqual([]);
    },
  );

  it('a touch before the page has started, or with nobody signed in, is not an error', async () => {
    const page = school({});
    // Before start() the page has no state yet. Every touch, key and scroll comes here (s/app.js, active),
    // and this threw on each of them (found by main's browser tests, Nov 25).
    expect(() => page.T.active()).not.toThrow();
    await page.start('#P3R8-WDK4');
    expect(() => page.T.active()).not.toThrow();
  });

  it('sixteen minutes with the form untouched: Back signs out, as it did', async () => {
    const page = await signIn(school({}));
    await openQuestions(page);
    page.advance(16 * MIN);
    await afterBack(page);
    expect(page.T.state().screen).not.toBe('assignments');
    expect(bodies(page, 'done').length).toBe(1);
    expect(page.tab).toEqual({});
  });

  it('a touch after the fifteen minutes does not bring the session back', async () => {
    const page = await signIn(school({}));
    await openQuestions(page);
    page.advance(16 * MIN);
    page.fire('keydown');
    await afterBack(page);
    expect(page.T.state().screen).not.toBe('assignments');
    expect(bodies(page, 'done').length).toBe(1);
  });
});

/* An answer from the server draws the page again. Drawn under a press, the
   button is replaced before the finger lifts and the tap does nothing, so
   that redraw waits for the press to end (s/student.js, later). */
describe('a redraw the student did not ask for waits for a press to end', () => {
  const start = page => page.root().querySelector('[data-act="q-start"][data-form-id="' + Q + '"]');
  // Reflect opened 21 s after `forms` was last asked: it is asked again, and this time lists the questionnaire as sent.
  async function askedAgainUnderAPress(world) {
    const page = await signIn(school(world));
    await page.click('[data-act="tab"][data-tab="questionnaires"]');
    expect(start(page)).toBeTruthy();
    page.advance(21000);
    world.sent = '2026-11-11T19:00:00Z';
    const tab = page.root().querySelector('.sp-tabs-bottom [data-act="tab"][data-tab="questionnaires"]');
    await page.click('[data-act="tab"][data-tab="assignments"]');
    page
      .root()
      .querySelector('.sp-tabs-bottom [data-act="tab"][data-tab="questionnaires"]')
      .dispatchEvent(new tab.ownerDocument.defaultView.Event('click', { bubbles: true }));
    page.fire('pointerdown'); // a finger comes down before the answer arrives
    await page.settle();
    expect(bodies(page, 'forms')).toHaveLength(2);
    return page;
  }

  it('`forms` answered while a finger is down: the page is drawn when it lifts', async () => {
    const page = await askedAgainUnderAPress({});
    // The answer is in, the page not yet drawn again: Start is still the button under the finger.
    expect(viewOf(page).questionnaires[0].state).toBe('sent');
    const held = start(page);
    expect(held).toBeTruthy();
    page.fire('pointerup');
    expect(start(page)).toBe(held); // not before the click the lift brings
    page.advance(100);
    page.runTimers();
    expect(start(page)).toBeNull();
  });

  it('a lift the page never hears of holds the redraw for 700 ms, no longer', async () => {
    const page = await askedAgainUnderAPress({});
    expect(start(page)).toBeTruthy();
    page.advance(800);
    page.runTimers(); // the press is called over
    page.runTimers(); // and what waited runs
    expect(start(page)).toBeNull();
  });
});

describe('Reflect asks again', () => {
  it('opening Reflect asks `forms` again at most every 20 seconds, so one turned on mid-class shows', async () => {
    const page = await signIn(school({}));
    expect(bodies(page, 'forms')).toHaveLength(1);
    // Just asked when the page came up: opening Reflect now asks nothing.
    await page.click('[data-act="tab"][data-tab="questionnaires"]');
    expect(bodies(page, 'forms')).toHaveLength(1);
    // The badge counts the one open.
    expect(words(page.root().querySelector('.sp-tabs-bottom [data-tab="questionnaires"] .sp-tab-badge'))).toBe('1');
    page.advance(21000);
    await page.click('[data-act="tab"][data-tab="assignments"]');
    expect(bodies(page, 'forms')).toHaveLength(1);
    await page.click('[data-act="tab"][data-tab="questionnaires"]');
    await page.settle();
    expect(bodies(page, 'forms')).toHaveLength(2);
    await page.click('[data-act="tab"][data-tab="assignments"]');
    await page.click('[data-act="tab"][data-tab="questionnaires"]');
    expect(bodies(page, 'forms')).toHaveLength(2);
  });
});

describe('a teacher-built reflection from a real card', () => {
  const CUSTOM = [
    {
      id: 'c1',
      kind: 'custom',
      title: 'Unit 2 Exit Reflection',
      theme: 'A few questions.',
      closes_on: null,
      grade: null,
      questions: [
        { id: 'r', kind: 'rating', prompt: 'How sure?', options: { levels: 5 }, core_ids: [], teacher_only: false },
        {
          id: 'c',
          kind: 'choice',
          prompt: 'Which?',
          options: { choices: ['Labs', 'Notes'], multiple: false, other: true },
          core_ids: [],
          teacher_only: false,
        },
        {
          id: 'l',
          kind: 'likert',
          prompt: 'How often?',
          options: { statements: ['Asked', 'Checked'], choices: ['Never', 'Always'] },
          core_ids: [],
          teacher_only: false,
        },
        {
          id: 'k',
          kind: 'ranking',
          prompt: 'Order',
          options: { choices: ['A', 'B', 'C'] },
          core_ids: [],
          teacher_only: false,
        },
        { id: 's', kind: 'section', prompt: 'Last', options: {}, core_ids: [], teacher_only: false },
        { id: 'd', kind: 'date', prompt: 'When?', options: {}, core_ids: [], teacher_only: false },
      ],
    },
  ];

  it('keeps a draft of every new shape, brings it back, and sends the contract’s answers', async () => {
    const page = await signIn(school({ form: { ok: true, parts: CUSTOM, context: {} } }));
    await openQuestions(page);
    await page.click('[data-act="rate"][data-q="r"][data-value="3"]');
    await page.click('[data-act="kc-other"][data-q="c"]');
    page.type('#q-c-other', 'Videos');
    await page.click('[data-act="likert"][data-q="l"][data-s="1"][data-value="Always"]');
    await page.click('[data-act="rank-up"][data-q="k"][data-i="2"]');
    page.type('#q-d', '2026-12-01');
    // Back to the page and in again: the draft brings every answer back.
    await page.click('[data-act="back"]');
    expect(JSON.parse(page.tab['fv-s-card-drafts'])).toBeTruthy();
    await page.click('[data-act="q-start"][data-form-id="' + Q + '"]');
    await page.settle();
    expect(page.root().querySelector('[data-act="rate"][data-value="3"]').getAttribute('aria-checked')).toBe('true');
    expect(page.root().querySelector('#q-c-other').value).toBe('Videos');
    expect(
      page.root().querySelector('[data-act="likert"][data-s="1"][data-value="Always"]').getAttribute('aria-checked'),
    ).toBe('true');
    expect([...page.root().querySelectorAll('[data-rank-q="k"] .sp-rq-rank-text')].map(words)).toEqual(['A', 'C', 'B']);
    expect(page.root().querySelector('#q-d').value).toBe('2026-12-01');
    await page.click('[data-act="send"]');
    await page.settle();
    const [sent] = bodies(page, 'answer');
    expect(sent.answers).toEqual({
      r: 3,
      c: ['Videos'],
      l: { Checked: 'Always' },
      k: ['A', 'C', 'B'],
      d: '2026-12-01',
    });
    expect(words(page.root().querySelector('.sp-big'))).toBe('Sent to Your Teacher');
    expect(page.tab).toEqual({});
  });
});
