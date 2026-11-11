/**
 * Mark Up and Reflect on Feedback from a real card (S9-W1, S10-W1;
 * s/feedback.js, with s/app.js's CLASS_ROUTES and s/reflect.js), against
 * the routes of tests/../migrations/2026111120_markup_reflect_revise.sql as
 * phase2-routes-contract.md writes them: `feedback` once the class's work
 * is in and it takes work, `reflect`, `reply` and `answer-seen` with the
 * session and the student they are for.
 *
 * - A class that takes no work is sent no `feedback`; one whose answer is
 *   empty is drawn exactly as it was.
 * - Reflecting sends the student's words with their own enrollment and the
 *   session; the screen shows what the route answered.
 * - An answer the teacher sent is marked seen once it is on screen.
 * - Nothing is kept past the session: Done ends it, and the next student
 *   in the same tab is asked their own `feedback`.
 * The stand-in answers only the routes this change calls; the rest of the
 * function is the real handler over the stand-in database.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';
import { CECE, WORK, fakeStudentSubmit, sampleCard } from './helpers/fake-student-submit.js';

const TODAY = new Date().toISOString().slice(0, 10);
const words = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const bodies = (page, route) => page.calls.filter(c => c.body.route === route).map(c => c.body);
const viewOf = page => page.T.viewOf(page.T.state());

function reflection(extra) {
  return Object.assign(
    {
      makes_sense: 'not_sure',
      question: 'Why a 3?',
      plan: null,
      went_well: null,
      sent_at: '2026-11-09T18:00:00Z',
      answer: null,
      answered_at: null,
      sense_now: null,
      follow_up: null,
      follow_up_answer: null,
      follow_up_answered_at: null,
      answer_new: false,
    },
    extra,
  );
}

/* The routes as the contract answers them, over what `world` holds. A call
   with no session, or for another student, is refused as the database does. */
function routes(world) {
  const seen = [];
  const refuse = body => (!body.session ? { ok: false, error: 'signed_out' } : null);
  return {
    seen,
    answer(body) {
      if (!['feedback', 'reflect', 'reply', 'answer-seen', 'markup'].includes(body.route)) return null;
      seen.push(body);
      if (world.off) return { ok: false, error: 'bad_request' };
      const refused = refuse(body);
      if (refused) return refused;
      if (body.route === 'feedback') {
        return {
          ok: true,
          v: 1,
          reflect_on_feedback: world.reflect,
          show_my_learning: false,
          assessments: world.assessments,
          last_plan: world.reflect ? world.lastPlan || null : null,
        };
      }
      if (body.route === 'reflect') {
        const r = body.reflection;
        world.assessments = [
          { id: body.assessment_id, marks: null, revision: null, reflection: reflection({ ...r, sent_at: 'now' }) },
        ];
        return { ok: true, reflection: { ...r, sent_at: 'now' } };
      }
      if (body.route === 'answer-seen') {
        world.assessments.forEach(a => {
          if (a.reflection && body.assessment_ids.includes(a.id)) a.reflection.answer_new = false;
        });
        return { ok: true, seen: body.assessment_ids.length };
      }
      return { ok: false, error: 'not_found' };
    },
  };
}

function school(world, sendWork) {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)], sendWork });
  const stand = routes(world);
  const dev = { fn, store: {}, stand };
  dev.open = async () => {
    const page = openStudentPage({ store: dev.store, objectUrls: true });
    page.server = body => stand.answer(body) || fn.handle(body);
    page.storage = async () => ({ status: 200 });
    await page.start('#P3R8-WDK4');
    return page;
  };
  return dev;
}
async function signIn(dev) {
  const page = await dev.open();
  page.type('#sp-ident', '0123456');
  await page.click('[data-act="card-yes"]');
  await page.settle();
  return page;
}

const TAKES = { [WORK.energy]: { students_send: 'photos', open: true } };

describe('a class that takes no work is sent no `feedback`', () => {
  it('Send Work off: not asked, and nothing about Reflect on Feedback shows', async () => {
    const world = { reflect: true, assessments: [] };
    const dev = school(world, undefined);
    const page = await signIn(dev);
    expect(dev.stand.seen).toEqual([]);
    expect(viewOf(page).reflectOn).toBe(false);
  });

  it('the function from before these routes (bad_request) leaves the page exactly as it was drawn', async () => {
    const world = { reflect: true, assessments: [], off: true };
    const off = await signIn(school(world, TAKES));
    const none = await signIn(school({ reflect: false, assessments: [] }, TAKES));
    expect(bodies(off, 'feedback')).toHaveLength(1);
    expect(off.root().innerHTML).toBe(none.root().innerHTML);
    expect(viewOf(off).reflectOn).toBe(false);
  });
});

describe('a class that takes work, with Reflect on Feedback on', () => {
  it('asks `feedback` once with the session and the student, then shows Reflect on Feedback on returned work', async () => {
    const world = { reflect: true, assessments: [] };
    const dev = school(world, TAKES);
    const page = await signIn(dev);
    const [ask] = bodies(page, 'feedback');
    expect(bodies(page, 'feedback')).toHaveLength(1);
    expect(ask.session).toMatch(/\S/);
    expect(ask.enrollment_id).toBe(CECE);
    expect(viewOf(page).reflectOn).toBe(true);
  });

  it('reflecting sends the words with the session and the student, and the screen shows what the route answered', async () => {
    const world = { reflect: true, assessments: [] };
    const dev = school(world, TAKES);
    const page = await signIn(dev);
    await page.click('[data-segment="back"]');
    const p = viewOf(page).work.find(x => x.id === WORK.energy);
    await page.click('.sp-piece[data-piece="' + p.id + '"] [data-act="feedback"]');
    await page.click('[data-act="reflect-open"]');
    await page.click('[data-act="reflect-sense"][data-value="yes"]');
    page.type('#sp-reflect-plan', 'Next time I’ll label every part first.');
    await page.click('[data-act="reflect-send"]');
    await page.settle();
    const [sent] = bodies(page, 'reflect');
    expect(sent).toMatchObject({
      enrollment_id: CECE,
      assessment_id: WORK.energy,
      reflection: { makes_sense: 'yes', plan: 'Next time I’ll label every part first.' },
    });
    expect(sent.session).toMatch(/\S/);
    expect(words(page.root().querySelector('#sp-reflect-title'))).toBe('Reflection Sent');
    const fb = page.T.feedbackOf(page.T.state());
    expect(fb.assessments.find(a => a.id === WORK.energy).reflection).toMatchObject({ makes_sense: 'yes' });
    expect(fb.last_plan).toMatchObject({ assessment_id: WORK.energy, plan: 'Next time I’ll label every part first.' });
  });

  it('an answer the teacher sent is marked seen once, when it is on screen', async () => {
    const world = {
      reflect: true,
      assessments: [
        {
          id: WORK.energy,
          marks: null,
          revision: null,
          reflection: reflection({ answer: 'A 3 names the cause.', answered_at: 'x', answer_new: true }),
        },
      ],
    };
    const dev = school(world, TAKES);
    const page = await signIn(dev);
    await page.click('[data-segment="back"]');
    await page.click('.sp-piece[data-piece="' + WORK.energy + '"] [data-act="feedback"]');
    await page.click('[data-act="reflect-open"]');
    await page.settle();
    expect(bodies(page, 'answer-seen')).toHaveLength(1);
    expect(bodies(page, 'answer-seen')[0]).toMatchObject({
      enrollment_id: CECE,
      assessment_ids: [WORK.energy],
    });
    // Opened again: it is not new, so nothing more is sent.
    await page.click('[data-act="reflect-back"]');
    await page.click('[data-act="reflect-open"]');
    await page.settle();
    expect(bodies(page, 'answer-seen')).toHaveLength(1);
  });

  it('nothing outlasts the session: after Done the next sign-in asks for its own `feedback`', async () => {
    const world = {
      reflect: true,
      assessments: [{ id: WORK.energy, marks: null, revision: null, reflection: reflection({}) }],
    };
    const dev = school(world, TAKES);
    const page = await signIn(dev);
    expect(page.T.feedbackOf(page.T.state()).assessments).toHaveLength(1);
    await page.click('[data-act="card-done"]');
    expect(page.T.state().realFeedback || null).toBeNull();
    expect(page.T.feedbackOf(page.T.state())).toBeNull();
  });
});
