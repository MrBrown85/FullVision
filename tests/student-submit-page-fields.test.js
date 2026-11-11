/**
 * S4-W1: eight of the nine keys S4-M1 adds to a student's page reach the
 * phone through the student-submit edge function
 * (supabase/functions/student-submit/card-routes.ts), and nothing else does.
 * The ninth, course.teacher_name, is never sent: students do not see the
 * teacher's name (DECISIONS, Nov 11), whatever the database sends.
 *
 * The contract is migrations/local-test/s4-m1-contract.md:
 *   tags.<id>.i_can                     list of text
 *   rubrics[].criteria[].tag_ids        list of tag ids
 *   assessments[].description           text or null
 *   assessments[].module_name           text or null
 *   assessments[].category_name         text or null
 *   assessments[].category_percent      number or null
 *   assessments[].core_competencies     list of { id, name }
 *   classes[].to_do (page and verify)   whole number, 0 or more
 *
 * Each is copied only where the database sent it, and only as its type: a
 * wrong type is sent as the key's empty value, never as it came. A reply
 * from before S4-M1 reads byte for byte as it did, checked against the
 * routes as they stood (tests/fixtures/student-submit-card-routes-2026-11-11.ts).
 * The rest of the page route is in tests/student-submit-card-handler.test.js.
 */
import { describe, expect, it } from 'vitest';
import { readCardKey } from '../supabase/functions/_shared/card-key.ts';
import { makeHandler } from '../supabase/functions/student-submit/handler.ts';
import { CARD_ROUTES, cardReply } from '../supabase/functions/student-submit/card-routes.ts';
import {
  CARD_ROUTES as OLD_ROUTES,
  cardReply as oldCardReply,
} from './fixtures/student-submit-card-routes-2026-11-11.ts';
import { FAKE_KEY } from './helpers/card-key-fake.js';

const KEY = await readCardKey(FAKE_KEY);
const SESSION = 'a'.repeat(64);
const EXPIRES = '2026-11-11T07:00:00+00:00';

const CECE = '11111111-1111-4111-8111-111111111111'; // enrollment ids
const CECE_2 = '12121212-1212-4212-8212-121212121212';
const TAG = '33333333-3333-4333-8333-333333333333';
const TAG_2 = '34343434-3434-4434-8434-343434343434';
const RUBRIC = '44444444-4444-4444-8444-444444444444';
const CRITERION = '55555555-5555-4555-8555-555555555555';
const CHECK = '66666666-6666-4666-8666-666666666666';
const QUIZ = '77777777-7777-4777-8777-777777777777';
const LAB = '88888888-8888-4888-8888-888888888888';
const TICKET = '99999999-9999-4999-8999-999999999999';

const clone = v => JSON.parse(JSON.stringify(v));

// The page as student_submit.page gave it before S4-M1: no new key anywhere.
const OLD_PAGE = {
  ok: true,
  v: 1,
  expires_at: EXPIRES,
  student: { enrollment_id: CECE, first_name: 'CeCe' },
  course: {
    name: 'Science 8',
    block: 'C',
    grading_system: 'both',
    grading_scale: null,
    level_order: 'desc',
    round_percent: null,
  },
  classes: [
    { enrollment_id: CECE, student: { first_name: 'CeCe' }, course: { name: 'Science 8', block: 'C' } },
    { enrollment_id: CECE_2, student: { first_name: 'CeCe' }, course: { name: 'Socials 8', block: 'B' } },
  ],
  tags: {
    [TAG]: { label: 'Ask questions', code: 'Q1' },
    [TAG_2]: { label: 'Plan a fair test', code: 'Q2' },
  },
  rubrics: [
    {
      id: RUBRIC,
      name: 'Lab Report',
      style: 'advanced',
      criteria: [
        {
          id: CRITERION,
          name: 'Method',
          weight: 1,
          level_1_value: 1,
          level_2_value: 2,
          level_3_value: 3,
          level_4_value: 4,
          level_1_descriptor: null,
          level_2_descriptor: null,
          level_3_descriptor: 'Every step is listed, in order.',
          level_4_descriptor: null,
          checks: [{ id: CHECK, level: 3, label: 'Lists every step' }],
        },
      ],
    },
  ],
  assessments: [
    {
      id: LAB,
      title: 'Lab Report',
      date: '2026-11-04',
      due_date: '2026-11-08',
      created_at: '2026-11-11T06:05:52.513413+00:00',
      score_mode: 'proficiency',
      max_points: null,
      weight: 1,
      rubric_id: RUBRIC,
      tag_ids: [],
      status: null,
      returned_at: '2026-11-11T06:05:52.562805+00:00',
      updated_at: null,
      seen_at: null,
      grade: {
        v: 1,
        value: null,
        modifier: 0,
        comment: 'A clear report.',
        tags: {},
        criteria: { [CRITERION]: { value: 3, modifier: 0, comment: 'Number your steps next time.', beyond: null } },
        checks: [CHECK],
      },
      previous: null,
    },
    {
      id: QUIZ,
      title: 'Cells Quiz',
      date: '2026-11-07',
      due_date: null,
      created_at: '2026-11-11T06:05:52.517563+00:00',
      score_mode: 'points',
      max_points: 10,
      weight: 1,
      rubric_id: null,
      tag_ids: [],
      status: 'NS',
      returned_at: null,
      updated_at: null,
      seen_at: null,
      grade: null,
      previous: null,
    },
    {
      id: TICKET,
      title: 'Exit Ticket',
      date: '2026-11-09',
      due_date: null,
      created_at: '2026-11-11T06:05:52.519885+00:00',
      score_mode: 'proficiency',
      max_points: null,
      weight: 1,
      rubric_id: null,
      tag_ids: [TAG, TAG_2],
      status: null,
      returned_at: null,
      updated_at: null,
      seen_at: null,
      grade: null,
      previous: null,
    },
  ],
};

// The same page once S4-M1 is applied, as the phone gets it: the contract's
// worked example, without the teacher's name.
const NEW_PAGE = clone(OLD_PAGE);
NEW_PAGE.classes[0].to_do = 2;
NEW_PAGE.classes[1].to_do = 0;
NEW_PAGE.tags[TAG].i_can = ['I can ask a question that can be tested.', 'I can say what I expect to happen.'];
NEW_PAGE.tags[TAG_2].i_can = [];
NEW_PAGE.rubrics[0].criteria[0].tag_ids = [TAG, TAG_2];
Object.assign(NEW_PAGE.assessments[0], {
  description: 'Write up the density lab. Use the checklist on the back.',
  module_name: 'Unit 1: Cells',
  category_name: 'Projects',
  category_percent: 60,
  core_competencies: [
    { id: 'COM', name: 'Communicating' },
    { id: 'CRT', name: 'Critical & Reflective Thinking' },
  ],
});
Object.assign(NEW_PAGE.assessments[1], {
  description: null,
  module_name: 'Unit 1: Cells',
  category_name: 'Tests',
  category_percent: 40,
  core_competencies: [],
});
Object.assign(NEW_PAGE.assessments[2], {
  description: null,
  module_name: null,
  category_name: 'Practice',
  category_percent: 0,
  core_competencies: [],
});

// What the database sends for that page: the same, with the teacher's name.
const FROM_DATABASE = clone(NEW_PAGE);
FROM_DATABASE.course.teacher_name = 'Ms. Okafor';

const OLD_VERIFIED = {
  ok: true,
  session_token: SESSION,
  expires_at: EXPIRES,
  enrollment_id: CECE,
  classes: clone(OLD_PAGE.classes),
};
const NEW_VERIFIED = { ...clone(OLD_VERIFIED), classes: clone(NEW_PAGE.classes) };

/* The handler with a stand-in database that answers student_submit.page
   with `reply`. */
function setup(reply) {
  const logs = [];
  const handle = makeHandler({
    region: 'ca-central-1',
    ipKey: 'test-key',
    cardKey: KEY,
    log: entry => logs.push(entry),
    db: {
      open: async () => ({ ok: true }),
      verify: async () => ({ ok: true }),
      check: async () => ({ ok: true }),
      submit: async () => ({ ok: true }),
      async call(text) {
        if (!text.startsWith('select student_submit.page(')) throw new Error('unexpected ' + text);
        return clone(reply);
      },
    },
  });
  return { handle, logs };
}

function post(body) {
  return new Request('https://x.supabase.co/functions/v1/student-submit', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://fullvision.ca', 'cf-connecting-ip': '203.0.113.7' },
    body: JSON.stringify(body),
  });
}
const PAGE = { route: 'page', session: SESSION, enrollment_id: CECE };

async function phone(reply) {
  const { handle, logs } = setup(reply);
  const res = await handle(post(PAGE));
  expect(res.status).toBe(200);
  return { text: await res.text(), logs };
}

describe('student-submit: the S4-M1 keys reach the phone', () => {
  it('hands on all eight when the database sends them, as it sent them', async () => {
    const { text } = await phone(FROM_DATABASE);
    const page = JSON.parse(text);
    expect(page).toEqual(NEW_PAGE);
    expect(page.classes.map(c => c.to_do)).toEqual([2, 0]);
    expect(page.tags[TAG].i_can).toEqual(NEW_PAGE.tags[TAG].i_can);
    expect(page.tags[TAG_2].i_can).toEqual([]);
    expect(page.rubrics[0].criteria[0].tag_ids).toEqual([TAG, TAG_2]);
    expect(page.assessments[0]).toMatchObject({
      description: 'Write up the density lab. Use the checklist on the back.',
      module_name: 'Unit 1: Cells',
      category_name: 'Projects',
      category_percent: 60,
      core_competencies: NEW_PAGE.assessments[0].core_competencies,
    });
    expect(page.assessments.map(a => a.category_percent)).toEqual([60, 40, 0]);
  });

  it('hands on to_do with the classes of verify and add-card', () => {
    for (const route of ['verify', 'add-card']) {
      expect(cardReply(CARD_ROUTES[route], clone(NEW_VERIFIED)), route).toEqual(NEW_VERIFIED);
    }
  });

  it('keeps text as it is stored: no trimming, blanks and order kept', async () => {
    const sent = clone(NEW_PAGE);
    sent.tags[TAG].i_can = ['', ' I can ask.', 'I can ask.', 'I can ask.'];
    sent.assessments[0].description = 'Line one.\n\n  Line two.';
    sent.assessments[0].category_percent = 33.5;
    const page = JSON.parse((await phone(sent)).text);
    expect(page).toEqual(sent);
  });

  it('logs route, outcome and time only: none of the new values', async () => {
    const { logs } = await phone(FROM_DATABASE);
    expect(logs).toEqual([{ route: 'page', outcome: 'ok', ms: expect.any(Number) }]);
    const text = JSON.stringify(logs);
    for (const value of ['Okafor', 'I can', 'density', 'Unit 1', 'Projects', 'Communicating', 'COM', TAG, TAG_2]) {
      expect(text, value).not.toContain(value);
    }
  });
});

describe('student-submit: a wrong type from the database is never passed on', () => {
  // Values of every wrong shape, for each kind of key.
  const NOT_TEXT = [7, true, false, { text: 'DRAFT-ONLY' }, ['DRAFT-ONLY'], undefined];
  const NOT_NUMBER = ['60', '', true, { value: 60 }, [60], NaN, Infinity, undefined];
  const NOT_COUNT = ['2', -1, 2.5, true, null, { n: 2 }, [2], NaN, Infinity, 2 ** 60, undefined];
  const NOT_LIST = ['DRAFT-ONLY', 7, true, null, { 0: 'DRAFT-ONLY' }, undefined];

  /* Sends the page with one key set to a wrong value and checks the phone
     gets NEW_PAGE with that key set to `empty` instead. undefined goes as
     JSON's null. */
  async function check(set, empty, values) {
    for (const value of values) {
      const sent = clone(NEW_PAGE);
      set(sent, value === undefined ? null : value);
      const expected = clone(NEW_PAGE);
      set(expected, empty);
      const { text } = await phone(sent);
      expect(JSON.parse(text), JSON.stringify(value)).toEqual(expected);
      expect(text).not.toContain('DRAFT-ONLY');
    }
  }

  it('teacher_name: never sent, whatever the database sends', async () => {
    for (const value of ['Ms. Okafor', '  Colin Brown ', '', null, ...NOT_TEXT]) {
      const sent = clone(NEW_PAGE);
      sent.course.teacher_name = value === undefined ? null : value;
      const { text } = await phone(sent);
      expect(JSON.parse(text), JSON.stringify(value)).toEqual(NEW_PAGE);
      expect(text, JSON.stringify(value)).not.toContain('teacher_name');
      for (const leak of ['Okafor', 'Colin Brown', 'DRAFT-ONLY']) expect(text, leak).not.toContain(leak);
    }
  });

  it('description, module_name and category_name: text or null', async () => {
    for (const key of ['description', 'module_name', 'category_name']) {
      await check((p, v) => (p.assessments[0][key] = v), null, NOT_TEXT);
    }
  });

  it('category_percent: a number or null', async () => {
    // JSON cannot carry NaN or Infinity; a stand-in database can.
    for (const value of NOT_NUMBER) {
      const sent = clone(NEW_PAGE);
      sent.assessments[0].category_percent = value;
      const page = cardReply(CARD_ROUTES.page, sent);
      expect(page.assessments[0].category_percent, String(value)).toBeNull();
    }
    await check((p, v) => (p.assessments[0].category_percent = v), null, ['60', '', true, { value: 60 }, [60]]);
  });

  it('to_do: a whole number, 0 or more, else 0, on page and on verify', async () => {
    for (const value of NOT_COUNT) {
      const sent = clone(NEW_PAGE);
      sent.classes[0].to_do = value;
      expect(cardReply(CARD_ROUTES.page, sent).classes[0].to_do, String(value)).toBe(0);
      const verified = clone(NEW_VERIFIED);
      verified.classes[0].to_do = value;
      expect(cardReply(CARD_ROUTES.verify, verified).classes[0].to_do, String(value)).toBe(0);
    }
    await check((p, v) => (p.classes[0].to_do = v), 0, ['2', -1, 2.5, true, null, { n: 2 }]);
  });

  it('i_can: a list of text, anything else in it left behind', async () => {
    await check((p, v) => (p.tags[TAG].i_can = v), [], NOT_LIST);
    const sent = clone(NEW_PAGE);
    sent.tags[TAG].i_can = [7, 'I can ask.', null, { text: 'DRAFT-ONLY' }, ['DRAFT-ONLY'], true, 'I can plan.'];
    const { text } = await phone(sent);
    expect(JSON.parse(text).tags[TAG].i_can).toEqual(['I can ask.', 'I can plan.']);
    expect(text).not.toContain('DRAFT-ONLY');
  });

  it("a criterion's tag_ids: a list of ids, anything else in it left behind", async () => {
    await check((p, v) => (p.rubrics[0].criteria[0].tag_ids = v), [], NOT_LIST);
    const sent = clone(NEW_PAGE);
    sent.rubrics[0].criteria[0].tag_ids = [TAG, 'DRAFT-ONLY', 7, null, { id: TAG }, 'c1abcd', TAG_2];
    const { text } = await phone(sent);
    expect(JSON.parse(text).rubrics[0].criteria[0].tag_ids).toEqual([TAG, TAG_2]);
    expect(text).not.toContain('DRAFT-ONLY');
  });

  it('core_competencies: a list of { id, name }, both text, and only those two fields', async () => {
    await check((p, v) => (p.assessments[0].core_competencies = v), [], NOT_LIST);
    const sent = clone(NEW_PAGE);
    sent.assessments[0].core_competencies = [
      { id: 'COM', name: 'Communicating', draft: 'DRAFT-ONLY', is_draft: true },
      { id: 'CT', name: 7 },
      { id: null, name: 'DRAFT-ONLY' },
      { name: 'DRAFT-ONLY' },
      'DRAFT-ONLY',
      ['COM', 'Communicating'],
      null,
      { id: 'CRT', name: 'Critical & Reflective Thinking' },
    ];
    const { text } = await phone(sent);
    expect(JSON.parse(text).assessments[0].core_competencies).toEqual(NEW_PAGE.assessments[0].core_competencies);
    expect(text).not.toContain('DRAFT-ONLY');
    expect(text).not.toContain('is_draft');
  });
});

describe('student-submit: a key the contract does not name is still left behind', () => {
  it('drops neighbours of the new keys, and the new keys where they do not belong', async () => {
    const dirty = clone(NEW_PAGE);
    // Keys the contract lists under "What is not sent".
    Object.assign(dirty.course, { teacher_id: QUIZ, teacher_email: 'DRAFT-ONLY@example.com', to_do: 9 });
    Object.assign(dirty.tags[TAG], { i_can_text: 'DRAFT-ONLY', curriculum: 'DRAFT-ONLY', tag_ids: [TAG_2] });
    Object.assign(dirty.rubrics[0], { tag_ids: [TAG], i_can: ['DRAFT-ONLY'] });
    Object.assign(dirty.rubrics[0].criteria[0], { description: 'DRAFT-ONLY', i_can: ['DRAFT-ONLY'] });
    Object.assign(dirty.rubrics[0].criteria[0].checks[0], { tag_ids: [TAG] });
    Object.assign(dirty.assessments[0], {
      category_id: RUBRIC,
      module_id: RUBRIC,
      category_calculation: 'DRAFT-ONLY',
      course_worth: 12.5,
      teacher_name: 'DRAFT-ONLY',
      i_can: ['DRAFT-ONLY'],
      to_do: 9,
    });
    Object.assign(dirty.classes[0], { teacher_name: 'DRAFT-ONLY', done: 4 });
    Object.assign(dirty.classes[0].course, { teacher_name: 'DRAFT-ONLY', to_do: 9 });
    Object.assign(dirty.student, { teacher_name: 'DRAFT-ONLY', to_do: 9 });
    Object.assign(dirty, { teacher_name: 'DRAFT-ONLY', to_do: 9, core_competencies: [{ id: 'COM', name: 'X' }] });
    const { text } = await phone(dirty);
    expect(JSON.parse(text)).toEqual(NEW_PAGE);
    for (const leak of ['DRAFT-ONLY', 'i_can_text', 'category_id', 'module_id', 'course_worth', 'teacher_id']) {
      expect(text, leak).not.toContain(leak);
    }
  });
});

describe('student-submit: a reply from before S4-M1 reads as it did', () => {
  // Replies as the database sent them before S4-M1, plain and with mistakes in them.
  const old = {
    page: OLD_PAGE,
    'empty page': { ok: true, v: 1, expires_at: EXPIRES, tags: {}, rubrics: [] },
    'page with stray fields': (() => {
      const d = clone(OLD_PAGE);
      Object.assign(d.course, { id: RUBRIC, return_grades: 'on_return' });
      Object.assign(d.assessments[0], { is_draft: true, draft: { value: 4 } });
      d.assessments[1].created_at = { is_draft: true };
      d.tags.is_draft = { label: 'X', code: 'Y' };
      return d;
    })(),
  };

  it.each(Object.keys(old))('%s: the same bytes as the routes before S4-W1', name => {
    const before = JSON.stringify(oldCardReply(OLD_ROUTES.page, clone(old[name])));
    const after = JSON.stringify(cardReply(CARD_ROUTES.page, clone(old[name])));
    expect(after).toBe(before);
  });

  it('verify and add-card: the same bytes as before', () => {
    for (const route of ['verify', 'add-card']) {
      const before = JSON.stringify(oldCardReply(OLD_ROUTES[route], clone(OLD_VERIFIED)));
      expect(JSON.stringify(cardReply(CARD_ROUTES[route], clone(OLD_VERIFIED))), route).toBe(before);
    }
  });

  it('through the handler, the old page is today’s page, with no new key added', async () => {
    const { text } = await phone(OLD_PAGE);
    expect(text).toBe(JSON.stringify(oldCardReply(OLD_ROUTES.page, clone(OLD_PAGE))));
    for (const key of [
      'teacher_name',
      'to_do',
      'i_can',
      'description',
      'module_name',
      'category_name',
      'category_percent',
      'core_competencies',
    ]) {
      expect(text, key).not.toContain(`"${key}"`);
    }
    // tag_ids is on assessments already; no criterion gains one.
    expect(JSON.parse(text).rubrics[0].criteria.every(c => !('tag_ids' in c))).toBe(true);
  });

  it('the new keys change nothing else: the new page minus them is the old page', async () => {
    const page = JSON.parse((await phone(NEW_PAGE)).text);
    page.classes.forEach(c => delete c.to_do);
    Object.values(page.tags).forEach(t => delete t.i_can);
    page.rubrics.forEach(r => r.criteria.forEach(c => delete c.tag_ids));
    for (const a of page.assessments) {
      for (const k of ['description', 'module_name', 'category_name', 'category_percent', 'core_competencies']) {
        delete a[k];
      }
    }
    expect(JSON.stringify(page)).toBe(JSON.stringify(oldCardReply(OLD_ROUTES.page, clone(OLD_PAGE))));
  });
});
