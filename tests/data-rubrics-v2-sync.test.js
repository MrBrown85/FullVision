import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const TAG = '33333333-3333-4333-8333-333333333333';
const RUBRIC_ID = '44444444-4444-4444-8444-444444444444';
const CRITERION_ID = '55555555-5555-4555-8555-555555555555';

function makeRubricSyncClient(options) {
  options = options || {};
  var calls = [];
  var tableData = options.tableData || {};
  var upsertResults = (options.upsertResults || []).slice();

  function filteredRows(table, filters) {
    return (tableData[table] || []).filter(function (row) {
      return (filters || []).every(function (filter) {
        if (filter.kind === 'eq') return row[filter.column] === filter.value;
        if (filter.kind === 'in') return (filter.values || []).includes(row[filter.column]);
        return true;
      });
    });
  }

  function makeQuery(table) {
    var filters = [];
    return {
      select() {
        return this;
      },
      eq(column, value) {
        filters.push({ kind: 'eq', column: column, value: value });
        return this;
      },
      in(column, values) {
        filters.push({ kind: 'in', column: column, values: values });
        return this;
      },
      then(resolve, reject) {
        calls.push({ type: 'select', table: table, filters: filters.slice() });
        return Promise.resolve({
          data: structuredClone(filteredRows(table, filters)),
          error: null,
        }).then(resolve, reject);
      },
    };
  }

  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ type: 'rpc', name: name, payload: payload || {} });
      if (name === 'upsert_rubric') {
        return Promise.resolve({ data: upsertResults.shift() || null, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
    from(table) {
      return makeQuery(table);
    },
  };
}

describe('rubric canonical sync', () => {
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = false;
    localStorage.clear();
    delete _cache.rubrics[CID];
    delete _cache.assessments[CID];
    _rubricSaveQueue = {};
    _assessmentSaveQueue = {};
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('rehydrates new rubrics with canonical ids and patches linked assessments', async () => {
    saveAssessments(CID, [
      {
        id: AID,
        title: 'Essay',
        rubricId: 'local-rubric',
        tagIds: [TAG],
        scoreMode: 'proficiency',
      },
    ]);

    var client = makeRubricSyncClient({
      upsertResults: [RUBRIC_ID],
      tableData: {
        rubric: [{ id: RUBRIC_ID, course_id: CID, name: 'Writing', created_at: '2026-04-21T12:00:00Z' }],
        criterion: [
          {
            id: CRITERION_ID,
            rubric_id: RUBRIC_ID,
            name: 'Ideas',
            level_4_descriptor: 'Extending',
            level_3_descriptor: 'Proficient',
            level_2_descriptor: 'Developing',
            level_1_descriptor: 'Emerging',
            level_4_value: 5,
            level_3_value: 3,
            level_2_value: 2,
            level_1_value: 1,
            weight: 2,
            display_order: 0,
          },
        ],
        criterion_tag: [{ criterion_id: CRITERION_ID, tag_id: TAG }],
      },
    });

    _useSupabase = true;
    globalThis.getSupabase = () => client;

    var result = await saveRubrics(CID, [
      {
        id: 'local-rubric',
        name: 'Writing',
        criteria: [
          {
            id: 'local-criterion',
            name: 'Ideas',
            tagIds: [TAG],
            levels: {
              4: 'Extending',
              3: 'Proficient',
              2: 'Developing',
              1: 'Emerging',
            },
            weight: 2,
            levelValues: { 4: 5 },
          },
        ],
      },
    ]);
    await _assessmentSaveQueue[CID];

    var upsertCall = client.calls.find(function (c) {
      return c.name === 'upsert_rubric';
    });
    expect(upsertCall.payload.p_id).toBeNull();
    expect(upsertCall.payload.p_name).toBe('Writing');
    expect(upsertCall.payload.p_criteria[0]).toMatchObject({
      name: 'Ideas',
      level_4_value: 5,
      weight: 2,
      display_order: 0,
      linked_tag_ids: [TAG],
    });

    expect(result.idMap['local-rubric']).toBe(RUBRIC_ID);
    expect(getRubrics(CID)[0].id).toBe(RUBRIC_ID);
    expect(getRubrics(CID)[0].criteria[0].id).toBe(CRITERION_ID);
    expect(getRubrics(CID)[0].criteria[0].levelValues).toEqual({ 4: 5 });
    expect(getAssessments(CID)[0].rubricId).toBe(RUBRIC_ID);

    var assessmentUpdate = client.calls.find(function (c) {
      return c.name === 'update_assessment';
    });
    expect(assessmentUpdate.payload.p_id).toBe(AID);
    expect(assessmentUpdate.payload.p_patch.rubric_id).toBe(RUBRIC_ID);
  });

  it('deletes removed canonical rubrics remotely', async () => {
    saveRubrics(CID, [
      {
        id: RUBRIC_ID,
        name: 'Old rubric',
        criteria: [],
      },
    ]);

    var client = makeRubricSyncClient({
      tableData: {
        rubric: [],
        criterion: [],
        criterion_tag: [],
      },
    });

    _useSupabase = true;
    globalThis.getSupabase = () => client;

    var result = await saveRubrics(CID, []);

    var deleteCall = client.calls.find(function (c) {
      return c.name === 'delete_rubric';
    });
    expect(deleteCall).toEqual({
      type: 'rpc',
      name: 'delete_rubric',
      payload: { p_id: RUBRIC_ID },
    });
    expect(result.rubrics).toEqual([]);
    expect(getRubrics(CID)).toEqual([]);
  });
});
