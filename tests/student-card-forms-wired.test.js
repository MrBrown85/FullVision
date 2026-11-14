/**
 * Questionnaires and My Reports from a real card (S4-F4; s/app.js's
 * loadForms and openRealForm, s/questionnaire.js's sendFromCard), against
 * the routes of supabase/functions/student-submit/forms-routes.ts as
 * phase2-routes-contract.md (Batch E) writes them: `forms` once the page is
 * up, `form` and `report` to open one, `answer` to send, each with the
 * session and the student it is for.
 *
 * - The two tabs list what `forms` gave; a function without the route
 *   (bad_request) leaves the page exactly as drawn.
 * - Start opens the questions from `form`; Send posts `answer` once, with
 *   no token, and shows Sent (already_sent too); a refusal says why.
 * - See Your Report shows what `report` gave.
 * - Nothing outlasts the session: Done, then the next student is asked
 *   their own `forms`, and this tab keeps no draft.
 * The stand-in answers only these routes; the rest of the function is the
 * real handler over the stand-in database.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { CECE, OMAR, fakeStudentSubmit, sampleCard, samplePage } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);
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

describe('the two tabs', () => {
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
    expect(viewOf(page).reports.map(r => [r.id, r.title, r.isNew])).toEqual([[R, 'Report 1', true]]);
    await page.click('[data-act="tab"][data-tab="questionnaires"]');
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
    expect(viewOf(off).reports).toEqual([]);
    await off.click('[data-act="tab"][data-tab="questionnaires"]');
    expect(words(off.root())).toContain('Questionnaires from your teacher will show here.');
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
  it('See Your Report asks `report` and shows it', async () => {
    const page = await signIn(school({}));
    await page.click('[data-act="tab"][data-tab="reports"]');
    await page.click('[data-act="r-open"][data-form-id="' + R + '"]');
    await page.settle();
    expect(bodies(page, 'report')).toEqual([expect.objectContaining({ enrollment_id: CECE, report_id: R })]);
    expect(page.T.state().screen).toBe('report');
    expect(page.T.state().report).toEqual(REPORT);
    expect(words(page.root().querySelector('.pr-view'))).toContain('Proficient');
    await page.click('[data-act="page-back"]');
    expect(viewOf(page).reports[0].isNew).toBe(false);
  });
});

describe('nothing outlasts the session', () => {
  it('Done, then another student signs in and is asked their own `forms`; no draft is left', async () => {
    const page = await signIn(school({}));
    await openQuestions(page);
    page.type('#q-q1', 'Half an answer');
    await new Promise(r => setTimeout(r, 450)); // the draft is kept once the student pauses
    expect(Object.keys(page.tab)).toEqual(['fv-s-card-drafts']);
    await page.click('[data-act="back"]');
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
