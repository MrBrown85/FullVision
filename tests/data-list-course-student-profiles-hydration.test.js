/**
 * list_course_student_profiles happy-path hydration test.
 *
 * Codex's regression coverage in tests/data-pagination.test.js mocks
 * list_course_student_profiles as PGRST202 (the missing-RPC fallback).
 * That proves the fallback works but says nothing about the common path —
 * the path that fires on every sign-in against a current Supabase deployment.
 *
 * This test pins the rich-hydration contract: when list_course_student_profiles
 * returns a populated row, _applyStudentProfileSummaries must correctly
 * populate _cache.notes / goals / reflections / overrides / flags /
 * studentProfileSummaries. If a future schema change drops a field or
 * renames a key, this test catches it.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const CID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const ENROLLMENT_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const STUDENT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SECTION_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

function richProfileRow() {
  return {
    enrollment: {
      id: ENROLLMENT_ID,
      student_id: STUDENT_ID,
      roster_position: 1,
      designations: [],
      is_flagged: true,
    },
    student: {
      id: STUDENT_ID,
      first_name: 'Ada',
      last_name: 'Lovelace',
      preferred_name: 'Countess',
      pronouns: 'she/her',
      student_number: 'A001',
      email: 'ada@example.test',
      date_of_birth: '1815-12-10',
    },
    overall_proficiency: 3.5,
    letter: 'B',
    counts: { assessments: 4 },
    goals: { [SECTION_ID]: 'Master argument structure by midterm.' },
    reflections: {
      [SECTION_ID]: { body: 'I am improving my evidence use.', confidence: 4, updated_at: '2026-04-20' },
    },
    section_overrides: {
      [SECTION_ID]: { level: 4, reason: 'Capstone work demonstrated mastery.', updated_at: '2026-04-20' },
    },
    notes: [{ body: 'First note about strong work.' }, { body: 'Second note: ready for extension.' }],
    is_flagged: true,
    recent_observations: [],
  };
}

describe('loadStudentProfileSummaries — happy path (rich RPC response)', () => {
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    localStorage.clear();

    // Reset the relevant cache slots so the test starts from a clean state.
    ['students', 'goals', 'reflections', 'overrides', 'notes', 'flags', 'studentProfileSummaries'].forEach(
      function (field) {
        if (_cache[field]) _cache[field][CID] = undefined;
      },
    );
    // Seed a student in the cache so _applyStudentProfileSummaries can
    // hydrate enriched fields onto it.
    _cache.students[CID] = [{ id: ENROLLMENT_ID, firstName: 'placeholder', lastName: '' }];
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('populates notes / goals / reflections / overrides / flags from one rich row', async () => {
    var calls = [];
    globalThis.getSupabase = function () {
      return {
        rpc(name, payload) {
          calls.push({ name: name, payload: payload || {} });
          if (name === 'list_course_student_profiles') {
            return Promise.resolve({ data: [richProfileRow()], error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    };

    await loadStudentProfileSummaries(CID);

    // Confirm it actually called the rich-hydration RPC.
    expect(calls.map(c => c.name)).toContain('list_course_student_profiles');

    // Notes — array of {body} → joined with double-newline.
    expect(_cache.notes[CID]).toEqual({
      [ENROLLMENT_ID]: 'First note about strong work.\n\nSecond note: ready for extension.',
    });

    // Goals + reflections — passed through as-is.
    expect(_cache.goals[CID]).toEqual({
      [ENROLLMENT_ID]: { [SECTION_ID]: 'Master argument structure by midterm.' },
    });
    expect(_cache.reflections[CID]).toEqual({
      [ENROLLMENT_ID]: {
        [SECTION_ID]: { body: 'I am improving my evidence use.', confidence: 4, updated_at: '2026-04-20' },
      },
    });

    // Section overrides — same structure.
    expect(_cache.overrides[CID]).toEqual({
      [ENROLLMENT_ID]: {
        [SECTION_ID]: { level: 4, reason: 'Capstone work demonstrated mastery.', updated_at: '2026-04-20' },
      },
    });

    // Flags — true row → entry in cache.
    expect(_cache.flags[CID]).toEqual({ [ENROLLMENT_ID]: true });

    // Summaries — full normalized record indexed by enrollment id.
    var summary = _cache.studentProfileSummaries[CID][ENROLLMENT_ID];
    expect(summary).toBeDefined();
    expect(summary.student.firstName).toBe('Ada');
    expect(summary.student.lastName).toBe('Lovelace');
    expect(summary.student.personId).toBe(STUDENT_ID);
    expect(summary.overallProficiency).toBe(3.5);
    expect(summary.letter).toBe('B');
    expect(summary.isFlagged).toBe(true);

    // The cached student row was enriched with name fields off the summary.
    expect(_cache.students[CID][0]).toEqual(
      expect.objectContaining({
        id: ENROLLMENT_ID,
        firstName: 'Ada',
        lastName: 'Lovelace',
        preferred: 'Countess',
        pronouns: 'she/her',
        studentNumber: 'A001',
        isFlagged: true,
      }),
    );
  });

  it('skips populating note/goal caches when the row has empty arrays/objects', async () => {
    var emptyRow = richProfileRow();
    emptyRow.notes = [];
    emptyRow.goals = {};
    emptyRow.reflections = {};
    emptyRow.section_overrides = {};
    emptyRow.is_flagged = false;
    emptyRow.enrollment.is_flagged = false;

    globalThis.getSupabase = function () {
      return {
        rpc(name) {
          if (name === 'list_course_student_profiles') {
            return Promise.resolve({ data: [emptyRow], error: null });
          }
          return Promise.resolve({ data: null, error: null });
        },
      };
    };

    await loadStudentProfileSummaries(CID);

    // Empty inputs should NOT write entries — guards against the cache
    // getting populated with empty placeholder objects.
    expect(_cache.notes[CID] || {}).toEqual({});
    expect(_cache.goals[CID]).toEqual({});
    expect(_cache.reflections[CID]).toEqual({});
    expect(_cache.overrides[CID]).toEqual({});
    expect(_cache.flags[CID]).toEqual({});
    // But the summary record itself is still populated.
    expect(_cache.studentProfileSummaries[CID][ENROLLMENT_ID]).toBeDefined();
  });
});
