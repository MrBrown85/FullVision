/**
 * Idempotency keys on the direct (online) write paths.
 *
 * Every mutating v2 RPC in FV_IDEMPOTENT_RPCS accepts an optional
 * p_idempotency_key uuid and caches its result per (key, teacher, endpoint)
 * through fv_idem_check / fv_idem_store. The offline queue already sent one;
 * the direct call sites did not, so fv_idempotency stayed empty.
 *
 * The property that makes the key worth anything is that it survives a retry:
 * _callRpcWithAuthGuard re-sends the same params after a token refresh, and
 * again from the session-expired queue. A key minted per attempt would dedup
 * nothing.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keyOf(params) {
  return params.p_idempotency_key;
}

describe('_stampIdempotencyKey', () => {
  it('stamps a uuid key on an endpoint that accepts one', () => {
    var params = _stampIdempotencyKey('upsert_subject', { p_course_id: 'c1' });
    expect(keyOf(params)).toMatch(UUID_RE);
  });

  it('leaves an endpoint that has no such parameter untouched', () => {
    // PostgREST resolves overloads by argument name, so sending the parameter
    // to one of these would fail the call with "function does not exist".
    ['update_assessment', 'delete_subject', 'save_term_rating', 'upsert_tag_score', 'reorder_roster'].forEach(
      function (name) {
        var params = _stampIdempotencyKey(name, { p_id: 'x' });
        expect(Object.prototype.hasOwnProperty.call(params, 'p_idempotency_key')).toBe(false);
      },
    );
  });

  it('keeps the first key when stamped again — this is what makes a retry dedup', () => {
    var params = { p_course_id: 'c1' };
    _stampIdempotencyKey('upsert_subject', params);
    var first = keyOf(params);
    _stampIdempotencyKey('upsert_subject', params);
    expect(keyOf(params)).toBe(first);
  });

  it('gives distinct writes distinct keys, so neither suppresses the other', () => {
    var a = _stampIdempotencyKey('upsert_note', { p_enrollment_id: 'e1', p_body: 'first' });
    var b = _stampIdempotencyKey('upsert_note', { p_enrollment_id: 'e1', p_body: 'second' });
    expect(keyOf(a)).not.toBe(keyOf(b));
  });

  it('tolerates a missing params object', () => {
    expect(_stampIdempotencyKey('upsert_subject', null)).toBeNull();
  });
});

describe('FV_IDEMPOTENT_RPCS', () => {
  it('names exactly the endpoints the server retrofitted', () => {
    // Verified against pg_proc: these 38 are the public functions carrying a
    // p_idempotency_key argument (the three student ones from
    // migrations/20261019_withdraw_students.sql, the six report-form ones
    // from migrations/20261020_report_template / _report_issue / _guardian,
    // remove_section / restore_section from
    // migrations/20261022_soft_remove_competency.sql, the four questionnaire
    // ones from migrations/20261025_questionnaires_tables_and_functions.sql,
    // the four phone-report ones from migrations/20261025_phone_reports.sql).
    // Keep in lockstep with the database.
    expect(Object.keys(FV_IDEMPOTENT_RPCS).sort()).toEqual([
      'close_phone_report',
      'create_assessment',
      'create_course',
      'create_custom_tag',
      'create_observation',
      'create_phone_report',
      'create_report_issue',
      'create_student_and_enroll',
      'delete_guardian',
      'delete_questionnaire',
      'delete_report_issue',
      'delete_report_template',
      'delete_withdrawn_student',
      'duplicate_assessment',
      'duplicate_course',
      'import_json_restore',
      'import_roster_csv',
      'import_teams_class',
      'issue_access_codes',
      'issue_report_codes',
      'reenrol_student',
      'remove_section',
      'restore_section',
      'save_report_template',
      'set_questionnaire_on',
      'update_phone_report',
      'upsert_category',
      'upsert_competency_group',
      'upsert_guardian',
      'upsert_module',
      'upsert_note',
      'upsert_observation_template',
      'upsert_questionnaire',
      'upsert_rubric',
      'upsert_section',
      'upsert_subject',
      'upsert_tag',
      'withdraw_student',
    ]);
  });
});

describe('retry reuses the same key', () => {
  var originalGetSupabase;
  var originalRefresh;
  var originalUseSupabase;

  beforeEach(() => {
    originalGetSupabase = globalThis.getSupabase;
    originalRefresh = globalThis.refreshSupabaseSession;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    globalThis.refreshSupabaseSession = originalRefresh;
    _useSupabase = originalUseSupabase;
  });

  it('sends the identical key on the post-refresh retry', async () => {
    var calls = [];
    var attempt = 0;
    globalThis.getSupabase = function () {
      return {
        rpc: function (name, payload) {
          calls.push({ name: name, key: payload.p_idempotency_key });
          attempt += 1;
          // First attempt looks like an expired token; the guard refreshes the
          // session and replays the very same params object.
          if (attempt === 1) return Promise.resolve({ data: null, error: { message: 'JWT expired' } });
          return Promise.resolve({ data: 'subject-uuid', error: null });
        },
      };
    };
    globalThis.refreshSupabaseSession = function () {
      return Promise.resolve({ session: { access_token: 't' } });
    };

    await _callRpcWithAuthGuard('upsert_subject', { p_course_id: 'c1', p_name: 'Science' }, {});

    expect(calls).toHaveLength(2);
    expect(calls[0].key).toMatch(UUID_RE);
    expect(calls[1].key).toBe(calls[0].key);
  });

  it('carries a key through the v2 upsert wrappers', async () => {
    var seen = [];
    globalThis.getSupabase = function () {
      return {
        rpc: function (name, payload) {
          seen.push({ name: name, key: payload.p_idempotency_key });
          return Promise.resolve({ data: null, error: null });
        },
      };
    };

    await window.v2.upsertSubject({ courseId: 'c1', name: 'Science', displayOrder: 0 });
    await window.v2.upsertTag({ id: null, sectionId: 's1', label: 'Tag' });

    expect(seen).toHaveLength(2);
    seen.forEach(function (c) {
      expect(c.key, c.name).toMatch(UUID_RE);
    });
  });
});
