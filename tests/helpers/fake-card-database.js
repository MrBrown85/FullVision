/**
 * A stand-in for the database after S3-M1, for the tests of the two edge
 * functions together: it stores what it is given and nothing else.
 *
 * It has no key and makes no tag. issue_cards keeps the tags teacher-cards
 * hands it; card and verify_card find a card by comparing the tag
 * student-submit hands them with the one stored. So a test in which a card
 * made through one function opens through the other shows that the two
 * make the same tag from the same code, the way the real database would
 * see it. It answers and refuses as the contract says the SQL does
 * (card-codes-contract.md, with the migration builder's notes of Nov 10):
 *   - issue_cards refuses a whole request by raising, with a SQLSTATE in
 *     the error's `code`: PT401 (not a teacher), P0002 (class not found, or
 *     another teacher's), 22023 (malformed);
 *   - per student: made, changed (the live card is not the one named),
 *     not_found (withdrawn, or not in this class), failed (both candidates
 *     taken); results in the order of the items;
 *   - a tag is unique across every card ever made, live or stopped; the
 *     second candidate is used when the first is taken;
 *   - a password's tag is kept only for a student with no birthday and no
 *     student number;
 *   - a replay (the same teacher and request id) answers the first reply
 *     with `replayed: true` and no `candidate`.
 *
 * Nothing here reaches a real database.
 */
export const id = n => ('0000000' + n).slice(-8) + '-0000-4000-8000-000000000000';

export const TEACHER = id(900);
export const OTHER_TEACHER = id(901);
export const COURSE = id(800);
export const OTHER_COURSE = id(801); // the other teacher's class
export const CECE = id(1); // has a birthday and a student number
export const OMAR = id(2); // has neither: his card carries its own password
export const NOOR = id(3); // has a student number only
export const GONE = id(4); // withdrawn
export const ELSEWHERE = id(5); // enrolled in the other teacher's class

const HEX64 = /^[0-9a-f]{64}$/;
const HEX8 = /^[0-9a-f]{8}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const clone = v => JSON.parse(JSON.stringify(v));

/** What the database raises: an error whose `code` is the SQLSTATE and whose message may quote what it was sent. */
export function raised(sqlstate, message) {
  const e = new Error(message || sqlstate);
  e.name = 'PostgresError';
  e.code = sqlstate;
  return e;
}

export function fakeCardDatabase() {
  const state = {
    teachers: [TEACHER, OTHER_TEACHER],
    courses: { [COURSE]: TEACHER, [OTHER_COURSE]: OTHER_TEACHER },
    students: {
      [CECE]: { course: COURSE, first: 'Cece', birthday: '2012-05-15', number: '0123456' },
      [OMAR]: { course: COURSE, first: 'Omar', birthday: null, number: null },
      [NOOR]: { course: COURSE, first: 'Noor', birthday: null, number: '7654321' },
      [GONE]: { course: COURSE, first: 'Gone', birthday: null, number: '1111111', withdrawn: true },
      [ELSEWHERE]: { course: OTHER_COURSE, first: 'Elle', birthday: '2012-01-01', number: null },
    },
    cards: [], // every card ever made: { id, enrollment_id, code_hmac, pw_hmac, key_id, seq, stopped }
    replies: {}, // 'teacher:request' → the first reply
    sessions: {}, // token → enrollment
    handed: [], // everything any function was handed, as it arrived
    worksUntil: '2027-01-29',
    down: false,
  };
  let made = 0;

  /* student_submit.issue_cards(p_teacher_id, p_course_id, p_items, p_key_id, p_idempotency_key) */
  async function issue(teacherId, courseId, items, keyId, requestId) {
    state.handed.push(clone({ fn: 'issue_cards', teacherId, courseId, items, keyId, requestId }));
    if (state.down) throw new Error(`connection refused while issuing ${JSON.stringify(items)}`);
    if (!state.teachers.includes(teacherId)) throw raised('PT401', 'not a teacher');
    if (state.courses[courseId] !== teacherId) throw raised('P0002', 'course not found');
    const bad = why => raised('22023', `${why}: ${JSON.stringify(items)}`);
    if (!Array.isArray(items) || items.length > 250) throw bad('items');
    if (!HEX8.test(String(keyId))) throw bad('key id');
    if (!UUID.test(String(requestId))) throw bad('request id');
    const tags = items.flatMap(it => (Array.isArray(it.candidates) ? it.candidates.map(c => c && c.code_hmac) : []));
    for (const it of items) {
      if (!UUID.test(String(it.enrollment_id))) throw bad('enrollment_id');
      if (it.replaces != null && !UUID.test(String(it.replaces))) throw bad('replaces');
      if (!Array.isArray(it.candidates) || it.candidates.length !== 2) throw bad('candidates');
      for (const c of it.candidates) {
        if (!c || !HEX64.test(String(c.code_hmac)) || !HEX64.test(String(c.pw_hmac))) throw bad('tag');
      }
    }
    if (new Set(items.map(it => it.enrollment_id)).size !== items.length) throw bad('enrollment twice');
    if (new Set(tags).size !== tags.length) throw bad('tag twice');

    const cacheKey = teacherId + ':' + requestId;
    if (state.replies[cacheKey]) return clone({ replayed: true, results: state.replies[cacheKey] });

    const results = items.map(it => {
      const student = state.students[it.enrollment_id];
      if (!student || student.course !== courseId || student.withdrawn) {
        return { enrollment_id: it.enrollment_id, result: 'not_found' };
      }
      const live = state.cards.find(k => k.enrollment_id === it.enrollment_id && !k.stopped) || null;
      if ((live ? live.id : null) !== (it.replaces || null)) {
        return { enrollment_id: it.enrollment_id, result: 'changed' };
      }
      const candidate = it.candidates.findIndex(c => !state.cards.some(k => k.code_hmac === c.code_hmac));
      if (candidate < 0) return { enrollment_id: it.enrollment_id, result: 'failed' };
      const has_password = !student.birthday && !student.number;
      if (live) live.stopped = true;
      made += 1;
      const card = {
        id: id(1000 + made),
        enrollment_id: it.enrollment_id,
        code_hmac: it.candidates[candidate].code_hmac,
        pw_hmac: has_password ? it.candidates[candidate].pw_hmac : null,
        key_id: keyId,
        seq: state.cards.filter(k => k.enrollment_id === it.enrollment_id).length + 1,
        stopped: false,
      };
      state.cards.push(card);
      return {
        enrollment_id: it.enrollment_id,
        result: 'made',
        card_id: card.id,
        seq: card.seq,
        works_until: state.worksUntil,
        candidate,
        has_password,
      };
    });
    // What a replay gets: the same results, with no word of which candidate was stored.
    state.replies[cacheKey] = results.map(r => {
      const kept = { ...r };
      delete kept.candidate;
      return kept;
    });
    return clone({ replayed: false, results });
  }

  const no = error => ({ ok: false, error });
  const find = (fn, tag, keyId) => {
    if (!HEX64.test(String(tag)) || !HEX8.test(String(keyId))) throw raised('22023', `${fn}: ${tag}`);
    const k = state.cards.find(c => c.code_hmac === tag);
    return !k ? { error: 'not_found' } : k.stopped ? { error: 'card_stopped' } : { card: k };
  };
  const fns = {
    // student_submit.card(p_code_hmac, p_key_id, p_ip_hash)
    card(tag, keyId) {
      const found = find('card', tag, keyId);
      if (found.error) return no(found.error);
      const student = state.students[found.card.enrollment_id];
      const identity = !!(student.birthday || student.number);
      if (!identity && !found.card.pw_hmac) return no('reprint');
      return {
        ok: true,
        kind: 'card',
        student: { first_name: student.first },
        course: { name: 'Science 8', block: 'B' },
        check: identity ? 'identity' : 'password',
        also_password: identity && !!found.card.pw_hmac,
      };
    },
    // student_submit.verify_card(p_code_hmac, p_key_id, p_birthday, p_student_number, p_password_hmac,
    //                            p_session_token, p_ip_hash, p_add)
    verify_card(tag, keyId, birthday, number, passwordTag) {
      const found = find('verify_card', tag, keyId);
      if (found.error) return no(found.error);
      if (passwordTag != null && !HEX64.test(String(passwordTag))) throw raised('22023', 'password tag');
      const k = found.card;
      const student = state.students[k.enrollment_id];
      const right =
        (student.birthday && birthday === student.birthday) ||
        (student.number && number === student.number) ||
        (k.pw_hmac && passwordTag === k.pw_hmac);
      if (!right) return { ok: false, error: 'wrong_identity', tries_left: 4 };
      const token = ('5e' + String(Object.keys(state.sessions).length).padStart(2, '0')).repeat(16);
      state.sessions[token] = k.enrollment_id;
      return {
        ok: true,
        session_token: token,
        expires_at: '2026-11-11T08:00:00+00:00',
        enrollment_id: k.enrollment_id,
        classes: [
          {
            enrollment_id: k.enrollment_id,
            student: { first_name: student.first },
            course: { name: 'Science 8', block: 'B' },
          },
        ],
      };
    },
  };

  /* What student-submit's index.ts does with a card route's statement. */
  async function call(text, params) {
    const fn = /^select student_submit\.(\w+)\(/.exec(text)[1];
    state.handed.push(clone({ fn, params }));
    if (state.down) throw new Error('connection refused');
    return clone(fns[fn](...params));
  }

  return {
    state,
    issue,
    call,
    live: enrollment => state.cards.find(k => k.enrollment_id === enrollment && !k.stopped),
  };
}
