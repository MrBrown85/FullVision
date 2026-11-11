/**
 * E9 (Batch E; my-learning-contract.md): while a class has Show My Learning
 * on, student_submit.page also sends show_my_learning: true, learning (the
 * class's calculation settings, categories, folders and learning map) and
 * each piece's category_id. The student-submit edge function
 * (supabase/functions/student-submit/card-routes.ts) hands on exactly the
 * contract's fields, and only when learning is there. With it off, the
 * phone's page is what it was, byte for byte.
 */
import BANK_STEPS from '../supabase/functions/_shared/bank-steps.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';
import { readCardKey } from '../supabase/functions/_shared/card-key.ts';
import { makeHandler } from '../supabase/functions/student-submit/handler.ts';
import { FAKE_KEY } from './helpers/card-key-fake.js';

const KEY = await readCardKey(FAKE_KEY);
const SESSION = 'a'.repeat(64);
const EXPIRES = '2026-11-11T07:00:00+00:00';

const CECE = '11111111-1111-4111-8111-111111111111';
const STU2 = '12121212-1212-4212-8212-121212121212';
const TAG = '33333333-3333-4333-8333-333333333333';
const TAG_2 = '34343434-3434-4434-8434-343434343434';
const LAB = '88888888-8888-4888-8888-888888888888';
const QUIZ = '77777777-7777-4777-8777-777777777777';
const CAT = 'c0c0c0c0-0000-4000-8000-000000000001';
const CAT_2 = 'c0c0c0c0-0000-4000-8000-000000000002';
const GROUP = 'd0d0d0d0-0000-4000-8000-000000000001';
const SUBJECT = 'e0e0e0e0-0000-4000-8000-000000000001';
const SECTION = 'f0f0f0f0-0000-4000-8000-000000000001';
const TEACHER = 'abababab-0000-4000-8000-000000000001';

const clone = v => JSON.parse(JSON.stringify(v));

// The page as the phone gets it today (Show My Learning off).
const TODAY = {
  ok: true,
  v: 1,
  expires_at: EXPIRES,
  student: { enrollment_id: CECE, first_name: 'CeCe' },
  course: {
    name: 'Science 8',
    block: 'C',
    grading_system: 'both',
    level_order: 'desc',
    round_percent: true,
    grading_scale: null,
  },
  classes: [{ enrollment_id: CECE, student: { first_name: 'CeCe' }, course: { name: 'Science 8', block: 'C' } }],
  tags: { [TAG]: { label: 'Ask questions', code: 'Q1', i_can: ['I can ask a question.'] } },
  rubrics: [],
  assessments: [
    {
      id: LAB,
      title: 'Lab Report',
      date: '2026-11-04',
      due_date: null,
      created_at: '2026-11-11T06:05:52.513413+00:00',
      score_mode: 'points',
      max_points: 10,
      weight: 1,
      rubric_id: null,
      tag_ids: [TAG],
      category_name: 'Projects',
      category_percent: 60,
      status: null,
      returned_at: '2026-11-11T06:05:52.562805+00:00',
      updated_at: null,
      seen_at: null,
      grade: { v: 1, value: 8, modifier: 0, comment: 'Good.', tags: {}, criteria: {}, checks: [] },
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
      category_name: null,
      category_percent: null,
      status: null,
      returned_at: null,
      updated_at: null,
      seen_at: null,
      grade: null,
      previous: null,
    },
  ],
};

// What the database sends for it today: the teacher's name too.
const FROM_DB_OFF = clone(TODAY);
FROM_DB_OFF.course.teacher_name = 'Ms. Okafor';

// What the phone gets with Show My Learning on.
const REAL_BANK_ID = Object.keys(BANK_STEPS.ids).find(id => !BANK_STEPS.sensitive.includes(id));
const LEARNING = {
  course: {
    grading_system: 'both',
    calc_method: 'decaying_avg',
    decay_weight: 0.65,
    recent_score_limit: null,
    round_percent: true,
    level_order: 'desc',
    timezone: 'America/Vancouver',
    folders_count_as_one: false,
    courses_count_equally: false,
    grading_scale: { boundaries: [{ min: 86, letter: 'A' }], percents: { 4: 100 } },
    category_weights: { summative: 60, formative: 40 },
    reporting_terms: [{ ordinal: 1, label: 'Term 1', starts_on: '2026-09-02', ends_on: '2026-11-20' }],
  },
  categories: [
    { id: CAT, name: 'Projects', weight: 60, display_order: 0, calc_mode: 'points' },
    { id: CAT_2, name: 'Tests', weight: 40, display_order: 1, calc_mode: 'percent' },
  ],
  competency_groups: [{ id: GROUP, name: 'Questioning', color: '#336699', display_order: 0, counts_as_one: true }],
  subjects: [
    {
      id: SUBJECT,
      name: 'Science',
      display_order: 0,
      sections: [
        {
          id: SECTION,
          name: 'Questioning and Predicting',
          display_order: 0,
          competency_group_id: GROUP,
          tags: [
            {
              id: TAG,
              code: 'Q1',
              label: 'Ask questions',
              i_can_text: 'I can ask a question.',
              bank_id: REAL_BANK_ID,
              display_order: 0,
              i_can_statements: ['I can ask a question.', 'I can say what I expect.'],
            },
            {
              id: TAG_2,
              code: 'Q2',
              label: 'Plan a fair test',
              i_can_text: null,
              bank_id: null,
              display_order: 1,
              i_can_statements: [],
            },
          ],
        },
      ],
    },
  ],
};
// A real bank id: its Next Step sentences come from supabase/functions/_shared/bank-steps.json.
const NEXT = {
  [REAL_BANK_ID]: {
    Emerging: BANK_STEPS.steps[BANK_STEPS.ids[REAL_BANK_ID]][0],
    Developing: BANK_STEPS.steps[BANK_STEPS.ids[REAL_BANK_ID]][1],
    Proficient: BANK_STEPS.steps[BANK_STEPS.ids[REAL_BANK_ID]][2],
    sensitive: false,
  },
};
const ON = clone(TODAY);
ON.assessments[0].category_id = CAT;
ON.assessments[1].category_id = null;
ON.show_my_learning = true;
ON.learning = clone(LEARNING);
ON.learning.section_overrides = {
  [LEARNING.subjects[0].sections[0].id]: { level: 3, date: '2026-11-01T18:00:00+00:00' },
};
ON.learning.next_steps = NEXT;

// What the database sends with it on: the same, plus what must stop at the edge.
const FROM_DB_ON = clone(FROM_DB_OFF);
FROM_DB_ON.assessments[0].category_id = CAT;
FROM_DB_ON.assessments[1].category_id = null;
FROM_DB_ON.show_my_learning = true;
FROM_DB_ON.learning = clone(LEARNING);
const tagFromDb = FROM_DB_ON.learning.subjects[0].sections[0].tags[0];
tagFromDb.source_text = 'Demonstrate a sustained curiosity about a scientific topic';
tagFromDb.class_avg = 3.1;
FROM_DB_ON.learning.course.teacher_id = TEACHER;
FROM_DB_ON.learning.course.name = 'Science 8';
FROM_DB_ON.learning.course.student_page_enabled = true;
FROM_DB_ON.learning.course.curriculum_tags = ['SCI8'];
FROM_DB_ON.learning.categories[0].course_id = 'aaaaaaaa-0000-4000-8000-000000000001';
FROM_DB_ON.learning.competency_groups[0].created_at = '2026-09-01T00:00:00+00:00';
FROM_DB_ON.learning.subjects[0].color = '#000000';
FROM_DB_ON.learning.subjects[0].sections[0].color = '#ffffff';
FROM_DB_ON.learning.subjects[0].sections[0].removed_at = null;
FROM_DB_ON.learning.scores = [{ enrollment_id: STU2, value: 4 }];
// This student's hand-set level, with the teacher's reason, which must stop at the edge.
FROM_DB_ON.learning.section_overrides = {
  [LEARNING.subjects[0].sections[0].id]: { level: 3, date: '2026-11-01T18:00:00+00:00', reason: 'Talked with her mum' },
  'not-a-section-id': { level: 4 },
};
FROM_DB_ON.learning.class_average = 3.2;
FROM_DB_ON.class_average = 3.2;
FROM_DB_ON.roster = [{ enrollment_id: STU2, first_name: 'Stu' }];

function setup(reply) {
  const handle = makeHandler({
    region: 'ca-central-1',
    ipKey: 'test-key',
    cardKey: KEY,
    log: () => {},
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
  return handle;
}

async function phone(reply) {
  const res = await setup(reply)(
    new Request('https://x.supabase.co/functions/v1/student-submit', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'https://fullvision.ca',
        'cf-connecting-ip': '203.0.113.7',
      },
      body: JSON.stringify({ route: 'page', session: SESSION, enrollment_id: CECE }),
    }),
  );
  expect(res.status).toBe(200);
  return res.text();
}

describe('student-submit: My Learning on the page (E9)', () => {
  it('off: the page reads byte for byte as today', async () => {
    const text = await phone(FROM_DB_OFF);
    expect(text).toBe(JSON.stringify(TODAY));
    expect(text).not.toContain('learning');
    expect(text).not.toContain('category_id');
  });

  it('off: a stray category_id or show_my_learning without learning is not handed on', async () => {
    const stray = clone(FROM_DB_OFF);
    stray.assessments[0].category_id = CAT;
    stray.show_my_learning = true;
    expect(await phone(stray)).toBe(JSON.stringify(TODAY));
  });

  it("on: exactly the contract's fields, and today's page around them unchanged", async () => {
    const text = await phone(FROM_DB_ON);
    const page = JSON.parse(text);
    expect(page).toEqual(ON);
    expect(page.show_my_learning).toBe(true);
    expect(Object.keys(page.learning).sort()).toEqual([
      'categories',
      'competency_groups',
      'course',
      'next_steps',
      'section_overrides',
      'subjects',
    ]);
    expect(text).not.toContain('Talked with her mum');
    expect(Object.keys(page.learning.course)).toHaveLength(12);
    expect(page.assessments.map(a => a.category_id)).toEqual([CAT, null]);
    // Take E9's keys away and the page is today's, to the byte.
    delete page.show_my_learning;
    delete page.learning;
    for (const a of page.assessments) delete a.category_id;
    expect(JSON.stringify(page)).toBe(JSON.stringify(TODAY));
  });

  it("on: a tag's source_text, the course's teacher_id and name, and anything unlisted stop at the edge", async () => {
    const text = await phone(FROM_DB_ON);
    for (const word of [
      'source_text',
      'Demonstrate a sustained curiosity',
      'class_avg',
      'teacher_id',
      TEACHER,
      'Ms. Okafor',
      'student_page_enabled',
      'curriculum_tags',
      'course_id',
      'created_at":"2026-09-01',
      '#000000',
      '#ffffff',
      'removed_at',
      'class_average',
      'roster',
      'scores',
    ]) {
      expect(text).not.toContain(word);
    }
    const page = JSON.parse(text);
    expect(page.learning.course).not.toHaveProperty('name');
    expect(page.learning.subjects[0]).not.toHaveProperty('color');
  });

  it('on: nothing of another student reaches the phone', async () => {
    const text = await phone(FROM_DB_ON);
    expect(text).not.toContain(STU2);
    expect(text).not.toContain('Stu');
  });

  it('on: each setting goes as its type, or as null', async () => {
    const odd = clone(FROM_DB_ON);
    Object.assign(odd.learning.course, {
      grading_scale: 'A',
      category_weights: [1, 2],
      reporting_terms: { label: 'Term 1' },
      decay_weight: { x: 1 },
    });
    odd.learning.subjects[0].sections[0].tags[0].i_can_statements = ['I can ask.', 7, { x: 1 }, ''];
    odd.learning.categories[0].name = { evil: true };
    odd.assessments[0].category_id = 'not-an-id';
    const page = JSON.parse(await phone(odd));
    expect(page.learning.course).toMatchObject({
      grading_scale: null,
      category_weights: null,
      reporting_terms: null,
      decay_weight: null,
    });
    expect(page.learning.subjects[0].sections[0].tags[0].i_can_statements).toEqual(['I can ask.', '']);
    expect(page.learning.categories[0].name).toBeNull();
    expect(page.assessments[0].category_id).toBeNull();
  });
});
