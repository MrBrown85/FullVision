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
 * One key is allowed ahead of the SQL, by name: an assessment's created_at,
 * which migration S0-M4b makes page() send. When that file lands, add it
 * to the list of SQL files below and take the key out of AHEAD_OF_THE_SQL.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CARD_ROUTES, cardReply } from '../supabase/functions/student-submit/card-routes.ts';

const SQL = ['migrations/2026110902_grade_return.sql', 'migrations/2026110904_student_sessions_page.sql']
  .map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8'))
  .join('\n');

// Allowed by the edge function before the database sends it.
const AHEAD_OF_THE_SQL = { assessment: ['created_at'] };

/** The body of the last definition of a function in the SQL files. */
function body(name) {
  const at = SQL.lastIndexOf('create or replace function ' + name + '(');
  expect(at, name).toBeGreaterThan(-1);
  const open = SQL.indexOf('$function$', at);
  // Without its comments: one can sit between two keys, and can hold a comma or an apostrophe.
  return SQL.slice(open, SQL.indexOf('$function$;', open)).replace(/--.*$/gm, '');
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

/* What the SQL sends, level by level. Each list is checked against the SQL
   in the first test, then used to build a full reply for the second. */
const SENT = {
  card: ['ok', 'kind', 'student', 'course', 'check', 'also_password'],
  person: ['first_name'],
  klass: ['name', 'block'],
  verified: ['ok', 'session_token', 'expires_at', 'enrollment_id', 'classes'],
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
  // page() builds the first nine and joins _returned_grade's six to them.
  assessment: ['id', 'title', 'date', 'due_date', 'score_mode', 'max_points', 'weight', 'rubric_id', 'tag_ids'],
  returned: ['status', 'returned_at', 'updated_at', 'seen_at', 'grade', 'previous'],
  copy: ['v', 'value', 'modifier', 'comment', 'tags', 'criteria', 'checks'],
  level: ['value', 'modifier', 'comment'],
  beyond: ['beyond'],
};

describe('the lists below are the keys the applied SQL sends', () => {
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
    session_token: 'a'.repeat(64),
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
    expect(cardReply(CARD_ROUTES.verify, FULL.verified)).toEqual(FULL.verified);
    expect(cardReply(CARD_ROUTES['add-card'], FULL.verified)).toEqual(FULL.verified);
    // A session joined by Add Another Card sends no new token.
    const joined = { ...FULL.verified, session_token: null };
    expect(cardReply(CARD_ROUTES['add-card'], joined)).toEqual(joined);
  });

  it('page: every key at every level, nothing else', () => {
    expect(cardReply(CARD_ROUTES.page, FULL.page)).toEqual(FULL.page);
  });

  it('a key at any level that the SQL does not send is left behind, but for created_at on an assessment', () => {
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

    for (const route of ['card', 'verify']) {
      const full = route === 'card' ? FULL.card : FULL.verified;
      expect(cardReply(CARD_ROUTES[route], { ...extra(full), ok: true })).toEqual(full);
    }
  });

  it('seen and done say only what the SQL says', () => {
    expect(cardReply(CARD_ROUTES.seen, { ok: true, seen: 2, made_up: 'LEAK' })).toEqual({ ok: true, seen: 2 });
    expect(cardReply(CARD_ROUTES.done, { ok: true, made_up: 'LEAK' })).toEqual({ ok: true });
  });
});
