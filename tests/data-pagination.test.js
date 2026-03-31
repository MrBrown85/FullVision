const CID = 'paged-course';
const TEACHER_ID = 'teacher-pagination-test';

function buildScoreRows(total) {
  var rows = [];
  for (var i = 0; i < total; i++) {
    rows.push({
      teacher_id: TEACHER_ID,
      course_id: CID,
      student_id: 'stu-' + String((i % 5) + 1).padStart(3, '0'),
      assessment_id: 'a-' + String(i + 1).padStart(4, '0'),
      tag_id: 'QAP',
      score: (i % 4) + 1,
      date: '2026-03-20',
      type: 'summative',
      created_at: '2026-03-20T00:00:00.000Z',
    });
  }
  return rows;
}

function buildAssessmentRows(total) {
  var rows = [];
  for (var i = 0; i < total; i++) {
    rows.push({
      teacher_id: TEACHER_ID,
      course_id: CID,
      id: 'a-' + String(i + 1).padStart(4, '0'),
      title: 'Assessment ' + (i + 1),
      date: '2026-03-20',
      type: 'summative',
      tag_ids: ['QAP'],
      updated_at: '2026-03-20T00:00:00.000Z',
    });
  }
  return rows;
}

function makeSupabaseClient(rowsByTable, opts) {
  opts = opts || {};
  var rangeCalls = [];

  return {
    rangeCalls: rangeCalls,
    from: function(table) {
      var state = { range: null, gtColumn: null, gtValue: null };
      var chain = {
        select: function() { return chain; },
        eq: function() { return chain; },
        gt: function(col, val) { state.gtColumn = col; state.gtValue = val; return chain; },
        abortSignal: function() { return chain; },
        range: function(start, end) {
          state.range = { start: start, end: end };
          rangeCalls.push({ table: table, start: start, end: end });
          return chain;
        },
        then: function(resolve) {
          var rows = (rowsByTable[table] || []).slice();
          if (state.gtColumn && state.gtValue) {
            rows = rows.filter(function(row) {
              return (row[state.gtColumn] || '') > state.gtValue;
            });
          }
          if (state.range) {
            rows = rows.slice(state.range.start, state.range.end + 1);
          } else {
            rows = rows.slice(0, opts.defaultCap || 1000);
          }
          resolve({ data: rows, error: null });
        },
      };
      if (opts.disableRange) delete chain.range;
      return chain;
    },
  };
}

describe('course-table pagination guards', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var originalTeacherId;

  beforeEach(() => {
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    originalTeacherId = _teacherId;

    _useSupabase = true;
    _teacherId = TEACHER_ID;
    _cache.scores[CID] = undefined;
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    _teacherId = originalTeacherId;
    _cache.scores[CID] = undefined;
  });

  it('paginates score refetches past the 1000-row PostgREST cap', async () => {
    var rows = buildScoreRows(1500);
    var client = makeSupabaseClient({ scores: rows });
    globalThis.getSupabase = function() { return client; };

    await _handleCrossTabChange(CID, 'scores');

    expect(_countFieldItems('scores', _cache.scores[CID])).toBe(1500);
    expect(client.rangeCalls).toEqual([
      { table: 'scores', start: 0, end: 999 },
      { table: 'scores', start: 1000, end: 1999 },
    ]);
  });

  it('keeps the existing score cache when a refetch is truncated to 1000 rows', async () => {
    var rows = buildScoreRows(1500);
    _cache.scores[CID] = _scoreRowsToBlob(rows);

    var client = makeSupabaseClient({ scores: rows }, { disableRange: true, defaultCap: 1000 });
    globalThis.getSupabase = function() { return client; };

    await _handleCrossTabChange(CID, 'scores');

    expect(_countFieldItems('scores', _cache.scores[CID])).toBe(1500);
    expect(client.rangeCalls).toHaveLength(0);
  });

  it('heals scores from local backup using total score entries, not just student keys', () => {
    var fullRows = buildScoreRows(1500);
    var partialRows = buildScoreRows(1000);
    _cache.scores[CID] = _scoreRowsToBlob(partialRows);
    localStorage.setItem('gb-scores-' + CID, JSON.stringify(_scoreRowsToBlob(fullRows)));

    _teacherId = null; // avoid enqueueing a background sync in this unit test
    _healFromLocalBackup(CID, 'scores', 'scores');

    expect(_countFieldItems('scores', _cache.scores[CID])).toBe(1500);
  });

  it('paginates assessment loads during initData so login does not start from a truncated course state', async () => {
    var scoreRows = buildScoreRows(1500);
    var assessmentRows = buildAssessmentRows(1500);
    var client = makeSupabaseClient({
      scores: scoreRows,
      observations: [],
      assessments: assessmentRows,
      students: [],
      goals: [],
      reflections: [],
      overrides: [],
      statuses: [],
      student_notes: [],
      student_flags: [],
      term_ratings: [],
      config_learning_maps: [],
      config_course: [],
      config_modules: [],
      config_rubrics: [],
      config_custom_tags: [],
      config_report: [],
    });
    globalThis.getSupabase = function() { return client; };

    await initData(CID);

    expect(_cache.assessments[CID]).toHaveLength(1500);
    expect(_countFieldItems('scores', _cache.scores[CID])).toBe(1500);
    expect(client.rangeCalls.filter(function(call) { return call.table === 'assessments'; })).toEqual([
      { table: 'assessments', start: 0, end: 999 },
      { table: 'assessments', start: 1000, end: 1999 },
    ]);
  });
});
