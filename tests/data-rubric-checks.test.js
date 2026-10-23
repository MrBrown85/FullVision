/**
 * Advanced Rubric checkboxes in the data layer (shared/data.js,
 * migrations/20261022_advanced_rubric_checks.sql).
 *
 *   rubric.style and criterion.checks in the rubric cache, from the bundle
 *   and from the table reads; the upsert_rubric payload; the ticks
 *   (getRubricCheckIds / setRubricCheck) and their set_rubric_check write;
 *   re-keying a checkbox created under a local id; copies carrying checks.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'c0000000-0000-4000-8000-000000000001';
const E1 = 'c0000000-0000-4000-8000-000000000021';
const A1 = 'c0000000-0000-4000-8000-000000000031';
const R1 = 'c0000000-0000-4000-8000-000000000071';
const C1 = 'c0000000-0000-4000-8000-000000000072';
const K1 = 'c0000000-0000-4000-8000-000000000081';
const K2 = 'c0000000-0000-4000-8000-000000000082';
const K3 = 'c0000000-0000-4000-8000-000000000083';

function makeRecordingClient() {
  var calls = [];
  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

const rubricRow = { id: R1, name: 'Lab Skills', created_at: '2026-09-01T00:00:00Z', style: 'advanced' };
const criterionRow = {
  id: C1,
  rubric_id: R1,
  name: 'Safety',
  level_4_descriptor: 'Leads',
  level_3_descriptor: 'Follows every step',
  level_2_descriptor: 'Needs reminders',
  level_1_descriptor: 'Needs many reminders',
  level_4_value: 4,
  level_3_value: 3,
  level_2_value: 2,
  level_1_value: 1,
  weight: 1,
  display_order: 0,
};
// Out of order on purpose: the cache sorts by display_order within a level.
const checkRows = [
  { id: K2, criterion_id: C1, level: 3, label: 'Cleans the station', display_order: 1 },
  { id: K3, criterion_id: C1, level: 4, label: 'Reminds others', display_order: 0 },
  { id: K1, criterion_id: C1, level: 3, label: 'Goggles on', display_order: 0 },
];

describe('rubric cache: style and checks', () => {
  it('reads checks per criterion in level display order and the rubric style', () => {
    var rubrics = _canonicalRubricRowsToCache([rubricRow], [criterionRow], [], checkRows);
    expect(rubrics).toHaveLength(1);
    expect(rubrics[0].style).toBe('advanced');
    expect(rubrics[0].criteria[0].checks).toEqual([
      { id: K1, level: 3, label: 'Goggles on', displayOrder: 0 },
      { id: K3, level: 4, label: 'Reminds others', displayOrder: 0 },
      { id: K2, level: 3, label: 'Cleans the station', displayOrder: 1 },
    ]);
  });

  it('treats a rubric row without style, or with checks left out, as Standard with no checks', () => {
    var rubrics = _canonicalRubricRowsToCache(
      [{ id: R1, name: 'Old', created_at: '2026-09-01T00:00:00Z' }],
      [criterionRow],
      [],
    );
    expect(rubrics[0].style).toBe('standard');
    expect(rubrics[0].criteria[0].checks).toEqual([]);
    expect(rubricStyle({ style: 'advanced' })).toBe('advanced');
    expect(rubricStyle({ style: 'odd' })).toBe('standard');
    expect(rubricStyle(null)).toBe('standard');
  });

  it('sends checks with their order within the level, ids only when the server knows them', () => {
    var payload = _rubricCriteriaPayload({
      criteria: [
        {
          id: C1,
          name: 'Safety',
          levels: {},
          checks: [
            { id: K1, level: 3, label: 'Goggles on' },
            { id: 'ck-local1', level: 4, label: 'Reminds others' },
            { id: K2, level: 3, label: 'Cleans the station' },
            { id: 'ck-bad', level: 9, label: 'Dropped' },
          ],
        },
      ],
    });
    expect(payload[0].checks).toEqual([
      { id: K1, level: 3, label: 'Goggles on', displayOrder: 0 },
      { level: 4, label: 'Reminds others', displayOrder: 0 },
      { id: K2, level: 3, label: 'Cleans the station', displayOrder: 1 },
    ]);
    // A Standard rubric sends an empty list.
    expect(_rubricCriteriaPayload({ criteria: [{ id: C1, name: 'Plain', levels: {} }] })[0].checks).toEqual([]);
  });

  it('counts a changed style or checkbox as a change to save', () => {
    var a = { id: R1, name: 'Lab', style: 'standard', criteria: [{ id: C1, name: 'Safety', levels: {}, checks: [] }] };
    var b = structuredClone(a);
    b.style = 'advanced';
    expect(_rubricSignature(a)).not.toBe(_rubricSignature(b));
    var c = structuredClone(a);
    c.criteria[0].checks = [{ id: K1, level: 3, label: 'Goggles on' }];
    expect(_rubricSignature(a)).not.toBe(_rubricSignature(c));
  });
});

describe('upsert_rubric payload', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    localStorage.clear();
    client = makeRecordingClient();
    globalThis.getSupabase = () => client;
  });
  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('carries p_style and each criterion’s checks', async () => {
    await window.v2.upsertRubric({
      id: R1,
      courseId: CID,
      name: 'Lab Skills',
      style: 'advanced',
      criteria: [
        {
          id: C1,
          name: 'Safety',
          linkedTagIds: [],
          checks: [
            { id: K1, level: 3, label: 'Goggles on', displayOrder: 0 },
            { level: 3, label: 'Cleans the station', displayOrder: 1 },
          ],
        },
      ],
    });
    var call = client.calls.find(function (c) {
      return c.name === 'upsert_rubric';
    });
    expect(call).toBeDefined();
    expect(call.payload.p_style).toBe('advanced');
    expect(call.payload.p_criteria[0].checks).toEqual([
      { id: K1, level: 3, label: 'Goggles on', display_order: 0 },
      { level: 3, label: 'Cleans the station', display_order: 1 },
    ]);
  });

  it('sends standard for a rubric with no style', async () => {
    await window.v2.upsertRubric({ id: R1, courseId: CID, name: 'Plain', criteria: [{ id: C1, name: 'One' }] });
    var call = client.calls[client.calls.length - 1];
    expect(call.payload.p_style).toBe('standard');
    expect(call.payload.p_criteria[0].checks).toEqual([]);
  });
});

describe('ticks: getRubricCheckIds / setRubricCheck', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    localStorage.clear();
    delete _cache.rubricChecks[CID];
    client = makeRecordingClient();
    globalThis.getSupabase = () => client;
    _useSupabase = true;
  });
  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    delete _cache.rubricChecks[CID];
  });

  function rpcCalls(name) {
    return client.calls.filter(function (c) {
      return c.name === name;
    });
  }

  it('ticks and clears one box, keeping the cache and localStorage in step', () => {
    expect(getRubricCheckIds(CID, E1, A1)).toEqual([]);
    setRubricCheck(CID, E1, A1, K1, true);
    setRubricCheck(CID, E1, A1, K2, true);
    expect(getRubricCheckIds(CID, E1, A1)).toEqual([K1, K2]);
    expect(isRubricCheckOn(CID, E1, A1, K1)).toBe(true);
    expect(JSON.parse(localStorage.getItem('gb-rubric-checks-' + CID))).toEqual({ [E1 + ':' + A1]: [K1, K2] });

    setRubricCheck(CID, E1, A1, K1, false);
    expect(getRubricCheckIds(CID, E1, A1)).toEqual([K2]);
    setRubricCheck(CID, E1, A1, K2, false);
    expect(getRubricCheckIds(CID, E1, A1)).toEqual([]);
    expect(JSON.parse(localStorage.getItem('gb-rubric-checks-' + CID))).toEqual({});
  });

  it('writes set_rubric_check for each change and nothing for a repeat', async () => {
    setRubricCheck(CID, E1, A1, K1, true);
    setRubricCheck(CID, E1, A1, K1, true); // already on
    setRubricCheck(CID, E1, A1, K1, false);
    await Promise.resolve();
    var calls = rpcCalls('set_rubric_check');
    expect(calls).toHaveLength(2);
    expect(calls[0].payload).toEqual({ p_enrollment_id: E1, p_assessment_id: A1, p_check_id: K1, p_on: true });
    expect(calls[1].payload).toEqual({ p_enrollment_id: E1, p_assessment_id: A1, p_check_id: K1, p_on: false });
    // No idempotency key: the write is idempotent by nature.
    expect(calls[0].payload.p_idempotency_key).toBeUndefined();
  });

  it('keeps a tick on a local id locally and sends nothing until the id is the server’s', () => {
    setRubricCheck(CID, E1, A1, 'ck-local', true);
    expect(getRubricCheckIds(CID, E1, A1)).toEqual(['ck-local']);
    expect(rpcCalls('set_rubric_check')).toHaveLength(0);
  });

  it('sends nothing in Demo Mode', () => {
    localStorage.setItem('gb-demo-mode', '1');
    setRubricCheck(CID, E1, A1, K1, true);
    expect(getRubricCheckIds(CID, E1, A1)).toEqual([K1]);
    expect(rpcCalls('set_rubric_check')).toHaveLength(0);
  });

  it('is echo-safe: a tick landing does not reload the class', () => {
    expect(_ECHO_SAFE_RPCS.set_rubric_check).toBe(true);
  });
});

describe('ticks from the class bundle', () => {
  it('rebuilds { sid:aid → [check ids] } from check_rows in index order', () => {
    var gb = {
      students: [{ enrollment_id: E1 }, { enrollment_id: 'e-other' }],
      assessments: [{ id: A1 }],
      check_index: [K1, K2, K3],
      check_rows: [
        [0, 0, 2],
        [1, 0, 0],
        [0, 0, 0],
        [0, 0, 0], // a duplicate row is one tick
        [0, 5, 1], // an assessment that is not in the list is skipped
      ],
    };
    expect(_bundleRubricChecks(gb)).toEqual({ [E1 + ':' + A1]: [K1, K3], ['e-other:' + A1]: [K1] });
    expect(_bundleRubricChecks({ students: [], assessments: [] })).toEqual({});
  });
});

describe('re-keying a checkbox', () => {
  beforeEach(() => {
    localStorage.clear();
    _cache.rubrics[CID] = [
      {
        id: R1,
        name: 'Lab Skills',
        style: 'advanced',
        criteria: [{ id: C1, name: 'Safety', levels: {}, checks: [{ id: 'ck-local', level: 3, label: 'Goggles on' }] }],
      },
    ];
    _cache.rubricChecks[CID] = { [E1 + ':' + A1]: ['ck-local', K2] };
  });
  afterEach(() => {
    delete _cache.rubrics[CID];
    delete _cache.rubricChecks[CID];
  });

  it('swaps the local id for the server’s in the rubric and in the ticks', () => {
    _rekey(CID, 'check', 'ck-local', K1);
    expect(_cache.rubrics[CID][0].criteria[0].checks[0].id).toBe(K1);
    expect(_cache.rubricChecks[CID][E1 + ':' + A1]).toEqual([K1, K2]);
  });

  it('finds a check by position within its criterion and level', () => {
    var crit = {
      checks: [
        { id: K2, level: 3, label: 'b', displayOrder: 1 },
        { id: K3, level: 4, label: 'c', displayOrder: 0 },
        { id: K1, level: 3, label: 'a', displayOrder: 0 },
      ],
    };
    // The cache is already in level display order; position is within the level.
    expect(_rubricCheckAt(crit, 3, 0).id).toBe(K2);
    expect(_rubricCheckAt(crit, 3, 1).id).toBe(K1);
    expect(_rubricCheckAt(crit, 4, 0).id).toBe(K3);
    expect(_rubricCheckAt(crit, 2, 0)).toBeNull();
  });
});

describe('a deleted assessment drops its ticks', () => {
  beforeEach(() => {
    localStorage.clear();
    _cache.scores[CID] = {};
    _cache.statuses[CID] = {};
    _cache.rubricChecks[CID] = { [E1 + ':' + A1]: [K1], [E1 + ':a-gone']: [K2] };
  });
  afterEach(() => {
    delete _cache.scores[CID];
    delete _cache.statuses[CID];
    delete _cache.rubricChecks[CID];
  });

  it('keeps ticks on assessments that remain', () => {
    _cleanOrphanedScores(CID, [{ id: A1 }]);
    expect(getRubricChecks(CID)).toEqual({ [E1 + ':' + A1]: [K1] });
  });
});

describe('Duplicate in the Rubric Bank carries the checks', () => {
  afterEach(() => {
    delete _cache.rubrics[CID];
  });

  it('copies style and checkboxes with new ids', () => {
    localStorage.clear();
    _cache.rubrics[CID] = [
      {
        id: R1,
        name: 'Lab Skills',
        style: 'advanced',
        criteria: [
          { id: C1, name: 'Safety', tagIds: [], levels: {}, checks: [{ id: K1, level: 3, label: 'Goggles on' }] },
        ],
      },
    ];
    var copy = RubricBank.duplicate(CID, R1);
    expect(copy.style).toBe('advanced');
    expect(copy.criteria[0].checks.map(k => k.label)).toEqual(['Goggles on']);
    expect(copy.criteria[0].checks[0].id).not.toBe(K1);
    // The source keeps its own ids.
    expect(getRubricById(CID, R1).criteria[0].checks[0].id).toBe(K1);
  });
});

describe('copies carry the checks', () => {
  it('gives a copied rubric new check ids and keeps the labels, levels and style', () => {
    var src = {
      id: R1,
      name: 'Lab Skills',
      style: 'advanced',
      criteria: [
        {
          id: C1,
          name: 'Safety',
          tagIds: [],
          levels: {},
          checks: [
            { id: K1, level: 3, label: 'Goggles on', displayOrder: 0 },
            { id: K2, level: 3, label: 'Cleans the station', displayOrder: 1 },
          ],
        },
      ],
    };
    var clone = RubricLibrary.cloneRubric(CID, 'c-other', src);
    expect(clone.style).toBe('advanced');
    var checks = clone.criteria[0].checks;
    expect(checks.map(k => k.label)).toEqual(['Goggles on', 'Cleans the station']);
    expect(checks.map(k => k.level)).toEqual([3, 3]);
    expect(checks.map(k => k.id)).not.toContain(K1);
    expect(checks.map(k => k.id)).not.toContain(K2);
    expect(new Set(checks.map(k => k.id)).size).toBe(2);
  });

  it('carries a checkbox edit onto a linked copy that still matched, with new ids', () => {
    var before = {
      id: R1,
      name: 'Lab Skills',
      style: 'advanced',
      criteria: [
        { id: C1, name: 'Safety', tagIds: [], levels: {}, checks: [{ id: K1, level: 3, label: 'Goggles on' }] },
      ],
    };
    var after = structuredClone(before);
    after.criteria[0].checks.push({ id: 'ck-new', level: 3, label: 'Cleans the station' });
    var copy = {
      id: 'r-copy',
      name: 'Lab Skills',
      style: 'advanced',
      criteria: [
        {
          id: 'c-copy',
          name: 'Safety',
          tagIds: [],
          levels: {},
          checks: [{ id: 'k-copy', level: 3, label: 'Goggles on' }],
        },
      ],
    };
    var plan = RubricLibrary.planLinkedEdit(CID, before, after, 'c-other', copy);
    expect(plan.changed).toBe(true);
    expect(plan.lines).toContain('Checkboxes of “Safety” updated');
    var next = plan.next.criteria[0].checks;
    expect(next.map(k => k.label)).toEqual(['Goggles on', 'Cleans the station']);
    expect(next.map(k => k.id)).not.toContain(K1);
    expect(next.map(k => k.id)).not.toContain('ck-new');
  });

  it('leaves a copy’s own checkbox wording alone and follows a style change', () => {
    var before = {
      id: R1,
      name: 'Lab Skills',
      style: 'standard',
      criteria: [
        { id: C1, name: 'Safety', tagIds: [], levels: {}, checks: [{ id: K1, level: 3, label: 'Goggles on' }] },
      ],
    };
    var after = structuredClone(before);
    after.style = 'advanced';
    after.criteria[0].checks[0].label = 'Goggles on all lab';
    var copy = {
      id: 'r-copy',
      name: 'Lab Skills',
      criteria: [
        {
          id: 'c-copy',
          name: 'Safety',
          tagIds: [],
          levels: {},
          checks: [{ id: 'k-copy', level: 3, label: 'Own wording' }],
        },
      ],
    };
    var plan = RubricLibrary.planLinkedEdit(CID, before, after, 'c-other', copy);
    expect(plan.next.style).toBe('advanced');
    expect(plan.lines).toContain('Style → Advanced');
    expect(plan.skipped).toContain('the checkboxes of “Safety”');
    expect(plan.next.criteria[0].checks[0].label).toBe('Own wording');
  });
});
