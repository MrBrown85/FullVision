/**
 * The edge function's allow-list against the SQL it fronts (S0-W1).
 *
 * supabase/functions/student-submit/card-routes.ts copies a reply field by
 * field, so a key the SQL sends and the list forgets is silently dropped on
 * the way to the phone, and a key the list names and the SQL never sends is
 * a door left open. This reads the keys straight out of the applied SQL
 * (every jsonb_build_object in card, verify_card, page and the helpers
 * whose output they send) and checks, level by level, that the phone is
 * given exactly those: none dropped, none added.
 *
 * The SQL is Batch A's (2026110902, 2026110904) as S0-M4b left it
 * (2026110905, applied Nov 10). S0-M4b does not restate a function: it
 * finds a piece of text in the live one, once, and replaces it. The same
 * edits are read out of that file and made here, the same way, so what is
 * checked is the function as it stands. One of them makes page() send
 * each assessment's created_at.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_ROUTES, cardReply } from '../supabase/functions/student-submit/card-routes.ts';
import { SENT as B, makeBulletinRoutes } from '../supabase/functions/student-submit/bulletin-routes.ts';
import { SENT as Q, makeQuizRoutes } from '../supabase/functions/student-submit/quiz-routes.ts';

const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const SQL = [
  'migrations/2026110902_grade_return.sql',
  'migrations/2026110904_student_sessions_page.sql',
  // verify_card answers new_session in place of the token (2026112401).
  'migrations/2026112401_session_token_hashed_in_function.sql',
]
  .map(read)
  .join('\n');

/* S0-M4b's edits to Batch A's functions: [function, text to find exactly
   once, replacement], as its `_edits` array lists them. */
const PATCHES = (() => {
  const file = read('migrations/2026110905_grade_return_limits.sql');
  const from = file.indexOf('_edits text[][] := array[');
  const list = file.slice(from, file.indexOf('_def  text;', from));
  return [...list.matchAll(/array\['([\w.]+)\([^']*\)',\s*\$s\$([\s\S]*?)\$s\$,\s*\$s\$([\s\S]*?)\$s\$\]/g)].map(m => ({
    fn: m[1],
    find: m[2],
    put: m[3],
  }));
})();

// Allowed by the edge function before the database sends it: nothing, since S0-M4b.
const AHEAD_OF_THE_SQL = { assessment: [] };

/** The body of a function as it stands: its last definition, then S0-M4b's edits to it. */
function body(name) {
  const at = SQL.lastIndexOf('create or replace function ' + name + '(');
  expect(at, name).toBeGreaterThan(-1);
  const open = SQL.indexOf('$function$', at);
  let text = SQL.slice(open, SQL.indexOf('$function$;', open));
  for (const patch of PATCHES.filter(x => x.fn === name)) {
    expect(text.split(patch.find).length - 1, name + ': ' + patch.find.slice(0, 40)).toBe(1);
    text = text.replace(patch.find, () => patch.put);
  }
  // Without its comments: one can sit between two keys, and can hold a comma or an apostrophe.
  return text.replace(/--.*$/gm, '');
}

/** The arguments of one call, split at its own commas. `from` is just past the opening bracket. */
function args(text, from) {
  const out = [];
  let depth = 0;
  let quoted = false;
  let start = from;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") quoted = !quoted;
    if (quoted) continue;
    if (ch === '(') depth += 1;
    if (ch === ')') {
      if (depth === 0) {
        out.push(text.slice(start, i).trim());
        return out;
      }
      depth -= 1;
    }
    if (ch === ',' && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  throw new Error('a call that never closes');
}

/** Each jsonb_build_object in a function, as its list of keys, in the order written. */
function objects(name) {
  const text = body(name);
  const found = [];
  let at = -1;
  while ((at = text.indexOf('jsonb_build_object(', at + 1)) >= 0) {
    const list = args(text, at + 'jsonb_build_object('.length);
    found.push(list.filter((_, i) => i % 2 === 0).map(k => /^'([a-z0-9_]+)'$/.exec(k)[1]));
  }
  return found;
}

const sorted = list => [...list].sort();
const has = (name, keys) =>
  expect(
    objects(name).some(o => JSON.stringify(sorted(o)) === JSON.stringify(sorted(keys))),
    name + ' builds { ' + keys.join(', ') + ' }; it builds ' + JSON.stringify(objects(name)),
  ).toBe(true);

const U = n => ('0000000' + n).slice(-8) + '-0000-4000-8000-000000000000';
const AT = '2026-11-10T16:04:11.482913+00:00';
const TOKEN = 'a'.repeat(64);

/* What the SQL sends, level by level. Each list is checked against the SQL
   in the first test, then used to build a full reply for the second. */
const SENT = {
  card: ['ok', 'kind', 'student', 'course', 'check', 'also_password'],
  person: ['first_name'],
  klass: ['name', 'block'],
  verified: ['ok', 'new_session', 'expires_at', 'enrollment_id', 'classes'],
  sessionClass: ['enrollment_id', 'student', 'course'],
  page: ['ok', 'v', 'expires_at', 'student', 'course', 'classes', 'tags', 'rubrics', 'assessments'],
  pageStudent: ['enrollment_id', 'first_name'],
  pageCourse: ['name', 'block', 'grading_system', 'grading_scale', 'level_order', 'round_percent'],
  tag: ['label', 'code'],
  rubric: ['id', 'name', 'style', 'criteria'],
  criterion: [
    'id',
    'name',
    'weight',
    'level_1_value',
    'level_2_value',
    'level_3_value',
    'level_4_value',
    'level_1_descriptor',
    'level_2_descriptor',
    'level_3_descriptor',
    'level_4_descriptor',
    'checks',
  ],
  check: ['id', 'level', 'label'],
  // page() builds the first ten and joins _returned_grade's six to them.
  assessment: [
    'id',
    'title',
    'date',
    'due_date',
    'score_mode',
    'max_points',
    'weight',
    'rubric_id',
    'created_at',
    'tag_ids',
  ],
  returned: ['status', 'returned_at', 'updated_at', 'seen_at', 'grade', 'previous'],
  copy: ['v', 'value', 'modifier', 'comment', 'tags', 'criteria', 'checks'],
  level: ['value', 'modifier', 'comment'],
  beyond: ['beyond'],
};

describe('the lists below are the keys the applied SQL sends', () => {
  it('S0-M4b’s edits were read: eight functions, and page() gains created_at', () => {
    expect([...new Set(PATCHES.map(x => x.fn))].sort()).toEqual([
      'fv_private.restore_grade_returns',
      'public._grade_return_on_change',
      'public.course_draft_count',
      'public.list_course_grade_returns',
      'public.return_grades',
      'student_submit._returned_grade',
      'student_submit.page',
      'student_submit.seen',
    ]);
    expect(PATCHES.filter(x => x.fn === 'student_submit.page')).toEqual([
      {
        fn: 'student_submit.page',
        find: "'rubric_id', a.rubric_id,",
        put: "'rubric_id', a.rubric_id, 'created_at', a.created_at,",
      },
    ]);
    // A DIBELS piece's rows are not read for a student, and are not marked seen.
    expect(body('student_submit._returned_grade')).toContain("a.score_mode = 'dibels'");
    expect(body('student_submit.seen')).toContain("a.score_mode <> 'dibels'");
  });

  it('card, verify_card, page and the helpers they send build these objects and no others', () => {
    has('student_submit.card', SENT.card);
    has('student_submit.card', SENT.person);
    has('student_submit.card', SENT.klass);
    // Every other object card() builds is a refusal.
    expect(
      objects('student_submit.card').filter(
        o => ![SENT.card, SENT.person, SENT.klass].some(k => k.join() === o.join()),
      ),
    ).toEqual([
      ['ok', 'error'],
      ['ok', 'error'],
    ]);

    has('student_submit.verify_card', SENT.verified);
    expect(objects('student_submit.verify_card').filter(o => o.join() !== SENT.verified.join())).toEqual([
      ['ok', 'error'],
      ['ok', 'error'],
      ['ok', 'error'],
      ['ok', 'error'],
      ['ok', 'error', 'tries_left'],
    ]);
    expect(objects('student_submit._session_classes')).toEqual([SENT.sessionClass, SENT.person, SENT.klass]);

    expect(objects('student_submit.page')).toEqual([
      ['ok', 'error'],
      SENT.page,
      SENT.pageStudent,
      SENT.pageCourse,
      SENT.tag,
      SENT.rubric,
      SENT.criterion,
      SENT.check,
      SENT.assessment,
    ]);
    expect(objects('student_submit._returned_grade')).toEqual([SENT.returned]);
    expect(objects('public._grade_copy_of')).toEqual([SENT.copy]);
    expect(objects('public._grade_copy_entry')).toEqual([SENT.level, SENT.beyond]);

    expect(objects('student_submit.seen')).toEqual([
      ['ok', 'error'],
      ['ok', 'seen'],
    ]);
    expect(objects('student_submit.done')).toEqual([['ok']]);
  });
});

/* A reply holding every key the SQL sends at every level, each with a
   value of the kind the SQL gives it. */
const fill = (keys, values) => Object.fromEntries(keys.map(k => [k, values[k]]));
const PERSON = { first_name: 'Cece' };
const KLASS = { name: 'Science 8', block: 'B' };
const CLASSES = [fill(SENT.sessionClass, { enrollment_id: U(1), student: PERSON, course: KLASS })];
const LEVEL = { value: 3, modifier: 1, comment: 'Number the steps' };
const COPY = fill(SENT.copy, {
  v: 1,
  value: null,
  modifier: 0,
  comment: 'Clear method.',
  tags: { [U(2)]: LEVEL },
  criteria: { [U(3)]: { ...LEVEL, beyond: 'Went further' } },
  checks: [U(4)],
});
const FULL = {
  card: fill(SENT.card, {
    ok: true,
    kind: 'card',
    student: PERSON,
    course: KLASS,
    check: 'identity',
    also_password: true,
  }),
  verified: fill(SENT.verified, {
    ok: true,
    new_session: true,
    expires_at: AT,
    enrollment_id: U(1),
    classes: CLASSES,
  }),
  page: fill(SENT.page, {
    ok: true,
    v: 1,
    expires_at: AT,
    student: fill(SENT.pageStudent, { enrollment_id: U(1), first_name: 'Cece' }),
    course: fill(SENT.pageCourse, {
      name: 'Science 8',
      block: 'B',
      grading_system: 'both',
      grading_scale: { percents: { 1: 40, 2: 62, 3: 78, 4: 93 } },
      level_order: 'desc',
      round_percent: true,
    }),
    classes: CLASSES,
    tags: { [U(2)]: fill(SENT.tag, { label: 'Ask questions', code: 'Q1' }) },
    rubrics: [
      fill(SENT.rubric, {
        id: U(5),
        name: 'Lab Report',
        style: 'advanced',
        criteria: [
          fill(
            SENT.criterion,
            Object.assign(
              { id: U(3), name: 'Method', weight: 1.5 },
              ...[1, 2, 3, 4].map(n => ({
                ['level_' + n + '_value']: n * 2.5,
                ['level_' + n + '_descriptor']: 'L' + n,
              })),
              { checks: [fill(SENT.check, { id: U(4), level: 3, label: 'Lists every step' })] },
            ),
          ),
        ],
      }),
    ],
    assessments: [
      {
        ...fill(SENT.assessment, {
          id: U(6),
          title: 'Lab',
          date: '2026-10-27',
          due_date: '2026-10-30',
          score_mode: 'proficiency',
          max_points: 10,
          weight: 2,
          rubric_id: U(5),
          created_at: AT,
          tag_ids: [U(2)],
        }),
        ...fill(SENT.returned, {
          status: 'LATE',
          returned_at: AT,
          updated_at: AT,
          seen_at: AT,
          grade: COPY,
          previous: COPY,
        }),
      },
    ],
  }),
};

describe('the phone is given exactly what the SQL sends', () => {
  it('card: every key, nothing else', () => {
    expect(cardReply(CARD_ROUTES.card, FULL.card)).toEqual(FULL.card);
  });

  it('verify and add-card: every key, nothing else', () => {
    // The phone gets the token the function made in place of new_session: the database never has it.
    const { new_session, ...rest } = FULL.verified;
    expect(new_session).toBe(true);
    const phone = { ...rest, session_token: TOKEN };
    expect(cardReply(CARD_ROUTES.verify, FULL.verified, TOKEN)).toEqual(phone);
    expect(cardReply(CARD_ROUTES['add-card'], FULL.verified, TOKEN)).toEqual(phone);
    // A session joined by Add Another Card sends no new token.
    const joined = { ...FULL.verified, new_session: false };
    expect(cardReply(CARD_ROUTES['add-card'], joined, TOKEN)).toEqual({ ...phone, session_token: null });
  });

  it('page: every key at every level, nothing else', () => {
    expect(cardReply(CARD_ROUTES.page, FULL.page)).toEqual(FULL.page);
  });

  it('a key at any level that the SQL does not send is left behind: created_at passes on an assessment and nowhere else', () => {
    // The same reply with one made-up key beside every real one, at every level.
    const extra = v => {
      if (Array.isArray(v)) return v.map(extra);
      if (!v || typeof v !== 'object') return v;
      const out = { made_up: 'LEAK', created_at: AT };
      for (const [k, inner] of Object.entries(v)) out[k] = extra(inner);
      return out;
    };
    const passed = cardReply(CARD_ROUTES.page, { ...extra(FULL.page), ok: true });
    // grading_scale is the class's own setting and is handed on whole (card-routes.ts says why).
    const scale = passed.course.grading_scale;
    delete passed.course.grading_scale;
    expect(scale).toEqual(extra(FULL.page.course.grading_scale));
    const text = JSON.stringify(passed);
    expect(text).not.toContain('LEAK');
    expect(text).not.toContain('made_up');
    const want = JSON.parse(JSON.stringify(FULL.page));
    delete want.course.grading_scale;
    AHEAD_OF_THE_SQL.assessment.forEach(k => (want.assessments[0][k] = AT));
    expect(passed).toEqual(want);
    expect(text.split('"created_at"').length - 1).toBe(1);

    expect(cardReply(CARD_ROUTES.card, { ...extra(FULL.card), ok: true })).toEqual(FULL.card);
    const { new_session, ...verified } = FULL.verified;
    expect(cardReply(CARD_ROUTES.verify, { ...extra(FULL.verified), ok: true, new_session }, TOKEN)).toEqual({
      ...verified,
      session_token: TOKEN,
    });
  });

  it('seen and done say only what the SQL says', () => {
    expect(cardReply(CARD_ROUTES.seen, { ok: true, seen: 2, made_up: 'LEAK' })).toEqual({ ok: true, seen: 2 });
    expect(cardReply(CARD_ROUTES.done, { ok: true, made_up: 'LEAK' })).toEqual({ ok: true });
  });
});

/* Bulletins (migrations/2026111803_bulletins_student.sql, not applied yet;
   the routes are supabase/functions/student-submit/bulletin-routes.ts).
   The same two checks: the lists the routes copy are the keys the SQL
   builds, level by level, and a reply holding every one of them and a
   made-up key beside each comes out as exactly the first. */
describe('bulletins: the routes copy exactly the keys the SQL builds', () => {
  const M2 = read('migrations/2026111803_bulletins_student.sql');
  const m2Objects = name => {
    const at = M2.lastIndexOf('create or replace function ' + name + '(');
    expect(at, name).toBeGreaterThan(-1);
    const open = M2.indexOf('$function$', at);
    const text = M2.slice(open, M2.indexOf('$function$;', open)).replace(/--.*$/gm, '');
    const found = [];
    let i = -1;
    while ((i = text.indexOf('jsonb_build_object(', i + 1)) >= 0) {
      const list = args(text, i + 'jsonb_build_object('.length);
      found.push(list.filter((_, n) => n % 2 === 0).map(k => /^'([a-z0-9_]+)'$/.exec(k)[1]));
    }
    return found;
  };
  const REFUSAL = ['ok', 'error'];

  it('each function builds these objects, in this order, and no others', () => {
    expect(m2Objects('student_submit.bulletins')).toEqual([REFUSAL, B.bulletins, B.bulletin, B.file, B.fresh]);
    expect(m2Objects('student_submit.bulletin_seen')).toEqual([REFUSAL, REFUSAL, B.seen]);
    expect(m2Objects('student_submit.bulletin_react')).toEqual([REFUSAL, REFUSAL, REFUSAL, REFUSAL, B.react]);
    // The phone is given the links in place of the bucket and the paths.
    const links = m2Objects('student_submit.bulletin_file_links');
    expect(links).toHaveLength(4);
    expect(links.slice(0, 2)).toEqual([REFUSAL, REFUSAL]);
    expect(links[2]).toContain('bucket');
    expect(links[2].filter(k => k !== 'bucket')).toEqual(B.fileLinks);
    expect(links[3]).toEqual(['page', 'path']);
    expect(B.page).toEqual(['page', 'url']);
    // The shared rule answers a boolean and builds nothing.
    expect(m2Objects('student_submit._bulletin_visible')).toEqual([]);
  });

  it('a reply with a made-up key at every level comes out with exactly the SQL’s keys', async () => {
    const extra = v => {
      if (Array.isArray(v)) return v.map(extra);
      if (!v || typeof v !== 'object') return v;
      const out = { made_up: 'LEAK', seen: 9, can_see: 26 };
      for (const [k, inner] of Object.entries(v)) out[k] = extra(inner);
      return out;
    };
    const FEED = {
      ok: true,
      bulletins: [
        {
          id: U(1),
          kind: 'reminder',
          body: 'Field trip forms are due Friday.',
          link_url: null,
          link_title: null,
          pinned: true,
          pinned_until: '2026-11-20',
          assessment_id: U(2),
          reactions_on: true,
          posted_at: AT,
          edited_at: AT,
          files: [{ id: U(3), kind: 'pdf', title: 'Form', page_count: 2, position: 1 }],
          seen_at: null,
          reaction: 'done',
        },
      ],
      new: [{ enrollment_id: U(4), count: 1 }],
    };
    const route = makeBulletinRoutes({ db: { call: async () => extra(FEED) }, store: null });
    const r = await route('bulletins', { session: 'a'.repeat(64), enrollment_id: U(4) }, 'h');
    expect(r.body).toEqual(FEED);
    expect(JSON.stringify(r.body)).not.toMatch(/LEAK|made_up|can_see/);
    for (const [name, said, want] of [
      ['bulletin-seen', { ok: true, seen: 1 }, { ok: true, seen: 1 }],
      ['bulletin-react', { ok: true, reaction: 'done' }, { ok: true, reaction: 'done' }],
    ]) {
      const one = makeBulletinRoutes({ db: { call: async () => extra(said) }, store: null });
      const body = {
        session: 'a'.repeat(64),
        enrollment_id: U(4),
        bulletin_ids: [U(1)],
        bulletin_id: U(1),
        word: 'done',
      };
      expect((await one(name, body, 'h')).body).toEqual(want);
    }
  });
});

/* Quizzes (migrations/2026111806_quizzes_student.sql, applied Nov 18; the
   routes are supabase/functions/student-submit/quiz-routes.ts). The same two
   checks: the lists the routes copy are the keys the SQL builds, level by
   level, and a reply holding every one of them and a made-up key beside each
   comes out as exactly the first. */
describe('quizzes: the routes copy exactly the keys the SQL builds', () => {
  const MQ2 = read('migrations/2026111806_quizzes_student.sql');
  const mq2Objects = name => {
    const at = MQ2.lastIndexOf('create or replace function ' + name + '(');
    expect(at, name).toBeGreaterThan(-1);
    const open = MQ2.indexOf('$function$', at);
    const text = MQ2.slice(open, MQ2.indexOf('$function$;', open)).replace(/--.*$/gm, '');
    const found = [];
    let i = -1;
    while ((i = text.indexOf('jsonb_build_object(', i + 1)) >= 0) {
      const list = args(text, i + 'jsonb_build_object('.length);
      found.push(list.filter((_, n) => n % 2 === 0).map(k => /^'([a-z0-9_]+)'$/.exec(k)[1]));
    }
    return found;
  };
  const REFUSAL = ['ok', 'error'];

  it('each function builds these objects, in this order, and no others', () => {
    expect(mq2Objects('student_submit.quiz')).toEqual([REFUSAL, REFUSAL, REFUSAL, Q.quiz, Q.info, Q.try]);
    expect(mq2Objects('student_submit._quiz_questions')).toEqual([Q.question, Q.choice]);
    expect(mq2Objects('student_submit.quiz_save')).toEqual([
      REFUSAL,
      REFUSAL,
      REFUSAL,
      REFUSAL,
      REFUSAL,
      [...REFUSAL, 'question_id'],
      Q.save,
    ]);
    expect(mq2Objects('student_submit.quiz_send')).toEqual([REFUSAL, REFUSAL, REFUSAL, REFUSAL, Q.send]);
    // The helpers' own objects never reach the phone as they are: quiz reads them.
    expect(mq2Objects('student_submit._quiz_window')).toEqual([['tries', 'open', 'closes_on']]);
    expect(mq2Objects('student_submit._quiz_new_order')).toEqual([['questions', 'choices']]);
  });

  it('quiz_list (2026111807) builds a refusal, then ok and quizzes, then each entry, and no others', () => {
    const file = read('migrations/2026111807_quizzes_student_list.sql');
    const at = file.lastIndexOf('create or replace function student_submit.quiz_list(');
    const open = file.indexOf('$function$', at);
    const text = file.slice(open, file.indexOf('$function$;', open)).replace(/--.*$/gm, '');
    const found = [];
    let i = -1;
    while ((i = text.indexOf('jsonb_build_object(', i + 1)) >= 0) {
      found.push(
        args(text, i + 'jsonb_build_object('.length)
          .filter((_, n) => n % 2 === 0)
          .map(k => /^'([a-z0-9_]+)'$/.exec(k)[1]),
      );
    }
    expect(found).toEqual([REFUSAL, Q.list, Q.listed]);
  });

  it('a reply with a made-up key at every level comes out with exactly the SQL’s keys', async () => {
    const extra = v => {
      if (Array.isArray(v)) return v.map(extra);
      if (!v || typeof v !== 'object') return v;
      const out = { made_up: 'LEAK', key: 'LEAK', tag_id: U(9) };
      for (const [k, inner] of Object.entries(v)) out[k] = extra(inner);
      return out;
    };
    const QUIZ = {
      ok: true,
      quiz: { tries: 1, tries_left: 0, closed: false, closes_on: null },
      try: { number: 1, sent: false, started_at: AT, sent_at: null, reopened: false },
      sent_tries: 0,
      can_answer: true,
      can_try_again: false,
      questions: [
        {
          id: U(1),
          number: 1,
          kind: 'choice',
          prompt: 'Which is a producer?',
          points: 1,
          multiple: false,
          choices: [{ id: U(2), text: 'Grass' }],
        },
      ],
      answers: { [U(1)]: [U(2)] },
    };
    const said = extra(QUIZ);
    // answers is an object keyed by question: a made-up key there is not a question shown.
    const route = makeQuizRoutes({ db: { call: async () => said } });
    const body = { session: 'a'.repeat(64), enrollment_id: U(4), assessment_id: U(5) };
    const r = await route('quiz', body, 'h');
    expect(r.body).toEqual(QUIZ);
    expect(JSON.stringify(r.body)).not.toMatch(/LEAK|made_up|tag_id|00000009/);
    for (const [name, sent, want] of [
      ['quiz-save', { ok: true, question_id: U(1), saved_at: AT }, { ok: true, question_id: U(1), saved_at: AT }],
      [
        'quiz-send',
        { ok: true, try: 1, sent_at: AT, tries_left: 0, can_try_again: false },
        { ok: true, try: 1, sent_at: AT, tries_left: 0, can_try_again: false },
      ],
    ]) {
      const one = makeQuizRoutes({ db: { call: async () => extra(sent) } });
      expect((await one(name, { ...body, question_id: U(1), answer: true }, 'h')).body).toEqual(want);
    }
  });
});

/* The returned view (migrations/2026112407_quiz_returned.sql, MQ3): the same two checks for quiz-result. */
describe('quiz-result: the route copies exactly the keys the SQL builds', () => {
  const file = read('migrations/2026112407_quiz_returned.sql');
  const at = file.lastIndexOf('create or replace function student_submit.quiz_result(');
  const open = file.indexOf('$function$', at);
  const text = file.slice(open, file.indexOf('$function$;', open)).replace(/--.*$/gm, '');
  const found = [];
  let i = -1;
  while ((i = text.indexOf('jsonb_build_object(', i + 1)) >= 0) {
    found.push(
      args(text, i + 'jsonb_build_object('.length)
        .filter((_, n) => n % 2 === 0)
        .map(k => /^'([a-z0-9_]+)'$/.exec(k)[1]),
    );
  }
  const REFUSAL = ['ok', 'error'];

  it('builds two refusals, returned false, the view, its total, its questions, and each question’s extras, and no others', () => {
    expect(found).toEqual([
      REFUSAL,
      REFUSAL,
      ['ok', 'returned'],
      ['ok', 'returned', 'shows'],
      ['total'],
      Q.total,
      ['questions'],
      Q.right,
      Q.answers,
    ]);
    // The top level the route passes on is exactly what the SQL can build there.
    expect(Q.result).toEqual(['ok', 'returned', 'shows', 'total', 'questions']);
    // A question is _quiz_questions' (checked above against Q.question) with those added.
    expect(text).toContain('student_submit._quiz_questions(p_assessment_id, _t.question_order)');
  });

  it('a reply with a made-up key at every level comes out with exactly the SQL’s keys', async () => {
    const extra = v => {
      if (Array.isArray(v)) return v.map(extra);
      if (!v || typeof v !== 'object') return v;
      const out = { made_up: 'LEAK', key: 'LEAK', tag_id: U(9), tolerance: 0.5 };
      for (const [k, inner] of Object.entries(v)) out[k] = extra(inner);
      return out;
    };
    const VIEW = {
      ok: true,
      returned: true,
      shows: 'answers',
      total: { earned: 1, possible: 2 },
      questions: [
        {
          id: U(1),
          number: 1,
          kind: 'choice',
          prompt: 'Which is a producer?',
          points: 1,
          multiple: false,
          choices: [{ id: U(2), text: 'Grass' }],
          your_answer: [U(2)],
          result: 'right',
          answer: [U(2)],
          why: 'It makes its own food.',
        },
      ],
    };
    const route = makeQuizRoutes({ db: { call: async () => extra(VIEW) } });
    const body = { session: 'a'.repeat(64), enrollment_id: U(4), assessment_id: U(5) };
    const r = await route('quiz-result', body, 'h');
    expect(r.body).toEqual(VIEW);
    expect(JSON.stringify(r.body)).not.toMatch(/LEAK|made_up|tag_id|tolerance|00000009/);
    const none = makeQuizRoutes({ db: { call: async () => extra({ ok: true, returned: false }) } });
    expect((await none('quiz-result', body, 'h')).body).toEqual({ ok: true, returned: false });
  });
});
