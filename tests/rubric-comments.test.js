/**
 * The Comment Bank per rubric, data layer (shared/rubric-comments.js and the loader,
 * payload, signature, wrapper and backup changes).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'c1000000-0000-4000-8000-000000000001';
const R1 = 'c1000000-0000-4000-8000-000000000071';
const R2 = 'c1000000-0000-4000-8000-000000000072';
const K1 = 'c1000000-0000-4000-8000-000000000081';
const K2 = 'c1000000-0000-4000-8000-000000000082';
const K3 = 'c1000000-0000-4000-8000-000000000083';
const TAG = 'c1000000-0000-4000-8000-000000000091';
const TAG2 = 'c1000000-0000-4000-8000-000000000092';
const E1 = 'c1000000-0000-4000-8000-000000000021';
const E2 = 'c1000000-0000-4000-8000-000000000022';
const A1 = 'c1000000-0000-4000-8000-000000000031';
const A2 = 'c1000000-0000-4000-8000-000000000032';
const A3 = 'c1000000-0000-4000-8000-000000000033';

function recordingClient() {
  const calls = [];
  return {
    calls,
    rpc(name, payload) {
      calls.push({ name, payload: payload || {} });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

describe('RubricComments helpers', () => {
  const crit = {
    id: K1,
    comments: [
      { level: 3, text: 'Clear question.' },
      { level: 2, text: 'Name the variable.' },
      { level: 3, text: '[Name], well done.' },
      { level: 3, text: '' },
    ],
  };

  it('at and all read the criterion in order and tolerate none', () => {
    expect(RubricComments.at(crit, 3)).toEqual(['Clear question.', '[Name], well done.']);
    expect(RubricComments.at(crit, 4)).toEqual([]);
    expect(RubricComments.all(crit)).toHaveLength(3);
    expect(RubricComments.all({})).toEqual([]);
    expect(RubricComments.all(null)).toEqual([]);
  });

  it('fill and slot round trip, and slot leaves a name inside another word alone', () => {
    expect(RubricComments.fill('[Name], well done.', 'Ava')).toBe('Ava, well done.');
    expect(RubricComments.fill('[Name] and [Name]', 'Al')).toBe('Al and Al');
    expect(RubricComments.slot('Ava, well done.', 'Ava')).toBe('[Name], well done.');
    expect(RubricComments.slot('Also, Al did well. Al’s plan.', 'Al')).toBe('Also, [Name] did well. [Name]’s plan.');
    const t = '[Name], keep going.';
    expect(RubricComments.slot(RubricComments.fill(t, 'Jo'), 'Jo')).toBe(t);
    expect(RubricComments.slot('Nothing here', '')).toBe('Nothing here');
  });

  it('newPart takes out one banked piece, or two', () => {
    const bank = ['Clear question.', '[Name], well done.'];
    expect(RubricComments.newPart('Clear question. Add units.', bank, 'Ava')).toBe('Add units.');
    expect(RubricComments.newPart('Ava, well done. Clear question. Check units.', bank, 'Ava')).toBe('Check units.');
    expect(RubricComments.newPart('Clear question.', bank, 'Ava')).toBe('');
    expect(RubricComments.newPart('  Own words  ', bank, 'Ava')).toBe('Own words');
  });
});

describe('RubricComments reads the class', () => {
  beforeEach(() => {
    localStorage.clear();
    ['rubrics', 'assessments', 'students', 'scores'].forEach(f => delete _cache[f][CID]);
    saveStudents(CID, [
      { id: E1, firstName: 'Ava', lastName: 'A' },
      { id: E2, firstName: 'Ben', lastName: 'B' },
    ]);
    saveRubrics(CID, [
      {
        id: R1,
        name: 'Lab',
        criteria: [
          {
            id: K1,
            name: 'Inquiry',
            tagIds: [TAG],
            levels: {},
            comments: [
              { level: 3, text: 'Clear question.' },
              { level: 3, text: '[Name], well done.' },
              { level: 2, text: 'Name the variable.' },
            ],
          },
          { id: K3, name: 'Safety', tagIds: [TAG2], levels: {} },
        ],
        overallComments: ['Good lab.', '[Name], keep going.'],
      },
      {
        id: R2,
        name: 'Report',
        criteria: [{ id: K2, name: 'Findings', tagIds: [TAG], levels: {} }],
      },
    ]);
    saveAssessments(CID, [
      { id: A1, title: 'Lab 1', rubricId: R1, date: '2026-09-10', tagIds: [TAG, TAG2], scoreMode: 'proficiency' },
      { id: A2, title: 'Report 1', rubricId: R2, date: '2026-10-01', tagIds: [TAG], scoreMode: 'proficiency' },
      { id: A3, title: 'Lab 2', rubricId: R1, date: '2026-11-01', tagIds: [TAG, TAG2], scoreMode: 'proficiency' },
    ]);
  });

  it('uses counts students, not uses', () => {
    const crit = getRubricById(CID, R1).criteria[0];
    saveRubricCriterionComment(CID, E1, A1, K1, 'Clear question. Ava, well done.');
    saveRubricCriterionComment(CID, E1, A3, K1, 'Clear question again.');
    saveRubricCriterionComment(CID, E2, A1, K1, 'Ben, well done.');
    const used = RubricComments.uses(CID, R1, crit);
    expect(used['3|Clear question.']).toBe(1);
    expect(used['3|[Name], well done.']).toBe(2);
    expect(used['2|Name the variable.']).toBe(0);
  });

  it('overallUses counts students with the overall text', () => {
    saveScoreComment(CID, E1, A1, 'Good lab. Ava, keep going.');
    saveScoreComment(CID, E2, A1, 'Good lab.');
    const used = RubricComments.overallUses(CID, R1);
    expect(used['Good lab.']).toBe(2);
    expect(used['[Name], keep going.']).toBe(1);
  });

  it('lastTime picks the latest earlier comment that shares a competency', () => {
    const crit = getRubricById(CID, R1).criteria[0];
    saveRubricCriterionComment(CID, E1, A1, K1, 'First try.');
    saveRubricCriterionComment(CID, E1, A2, K2, 'Findings were thin.');
    expect(RubricComments.lastTime(CID, E1, A3, crit)).toEqual({ text: 'Findings were thin.', title: 'Report 1' });
    // Nothing earlier than the first assessment.
    expect(RubricComments.lastTime(CID, E1, A1, crit)).toBeNull();
    // Another student has no comment.
    expect(RubricComments.lastTime(CID, E2, A3, crit)).toBeNull();
  });

  it('lastTime ignores criteria with other competencies, none, and undated work', () => {
    const safety = getRubricById(CID, R1).criteria[1];
    saveRubricCriterionComment(CID, E1, A1, K1, 'First try.');
    expect(RubricComments.lastTime(CID, E1, A3, safety)).toBeNull();
    expect(RubricComments.lastTime(CID, E1, A3, { id: 'x', tagIds: [] })).toBeNull();
    const list = getAssessments(CID).map(a => (a.id === A1 ? { ...a, date: '' } : a));
    saveAssessments(CID, list);
    expect(RubricComments.lastTime(CID, E1, A3, getRubricById(CID, R1).criteria[0])).toBeNull();
  });
});

describe('the comment bank on the wire', () => {
  let originalGetSupabase;
  let originalUseSupabase;
  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    localStorage.clear();
  });
  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  const rubric = () => ({
    id: R1,
    name: 'Lab',
    style: 'standard',
    criteria: [
      {
        id: K1,
        name: 'Inquiry',
        levels: { 3: 'x' },
        comments: [{ level: 3, text: 'Clear question.' }],
      },
    ],
    overallComments: ['Good lab.'],
  });
  const rows = () => ({
    rubric: [{ id: R1, name: 'Lab', style: 'standard', overall_comments: ['Good lab.', 7] }],
    criterion: [
      {
        id: K1,
        rubric_id: R1,
        name: 'Inquiry',
        display_order: 0,
        comments: [{ level: '3', text: 'Clear question.' }, { bad: 1 }],
      },
      { id: K2, rubric_id: R1, name: 'Other', display_order: 1 },
    ],
  });

  it('the loader carries comments, defaulting to none', () => {
    const r = rows();
    const out = _canonicalRubricRowsToCache(r.rubric, r.criterion, [], [], []);
    expect(out[0].overallComments).toEqual(['Good lab.']);
    expect(out[0].criteria[0].comments).toEqual([{ level: 3, text: 'Clear question.' }]);
    expect(out[0].criteria[1].comments).toEqual([]);
    expect(_canonicalRubricRowsToCache([{ id: R2, name: 'x' }], [], [], [], [])[0].overallComments).toEqual([]);
  });

  it('the payload and signatures carry comments', () => {
    expect(_rubricCriteriaPayload(rubric())[0].comments).toEqual([{ level: 3, text: 'Clear question.' }]);
    const edited = rubric();
    edited.overallComments = ['Good lab.', 'More.'];
    expect(_rubricSignature(edited)).not.toBe(_rubricSignature(rubric()));
    expect(_rubricsContentSignature([edited])).not.toBe(_rubricsContentSignature([rubric()]));
    const other = rubric();
    other.criteria[0].comments.push({ level: 2, text: 'Add units.' });
    expect(_rubricSignature(other)).not.toBe(_rubricSignature(rubric()));
  });

  it('upsertRubric sends comments and p_overall_comments when it is given them, and leaves them out when it is not', async () => {
    _useSupabase = true;
    const client = recordingClient();
    globalThis.getSupabase = () => client;
    const params = () => ({
      id: R1,
      courseId: CID,
      name: 'Lab',
      criteria: _rubricCriteriaPayload(rubric()),
      overallComments: _overallCommentsOf(rubric()),
    });
    await window.v2.upsertRubric(params());
    let call = client.calls[client.calls.length - 1];
    expect(call.payload.p_overall_comments).toEqual(['Good lab.']);
    expect(call.payload.p_criteria[0].comments).toEqual([{ level: 3, text: 'Clear question.' }]);

    // A call that does not name them leaves them out, so the database keeps what it holds.
    const bare = params();
    bare.overallComments = undefined;
    bare.criteria = bare.criteria.map(c => {
      const { comments, ...rest } = c;
      return rest;
    });
    await window.v2.upsertRubric(bare);
    call = client.calls[client.calls.length - 1];
    expect('p_overall_comments' in call.payload).toBe(false);
    expect('comments' in call.payload.p_criteria[0]).toBe(false);
  });

  it('the fallback loader selects the comment columns', async () => {
    const selects = [];
    const query = table => {
      const q = {
        select(cols) {
          selects.push({ table, cols });
          return q;
        },
        eq: () => q,
        in: () => q,
        then: (res, rej) => Promise.resolve({ data: [], error: null }).then(res, rej),
      };
      return q;
    };
    globalThis.getSupabase = () => ({ from: query, rpc: () => Promise.resolve({ data: null, error: null }) });
    const cols = table => selects.filter(s => s.table === table).map(s => s.cols);
    await _loadCanonicalRubrics(CID);
    expect(cols('rubric')).toEqual(['id,name,created_at,copy_group,style,scale,overall_comments']);
    // With a rubric present the criterion query runs too.
    selects.length = 0;
    const withRubric = table => {
      const q = query(table);
      if (table === 'rubric')
        q.then = (res, rej) => Promise.resolve({ data: [{ id: R1 }], error: null }).then(res, rej);
      return q;
    };
    globalThis.getSupabase = () => ({ from: withRubric });
    await _loadCanonicalRubrics(CID);
    expect(cols('rubric')[0]).toContain(',overall_comments');
    expect(cols('criterion')[0]).toMatch(/,comments$/);
  });
});

describe('Add to Bank writes', () => {
  let originalGetSupabase;
  let originalUseSupabase;
  let client;
  const seed = (ids = { rubric: R1, criterion: K1 }) => {
    const rb = [
      {
        id: ids.rubric,
        name: 'Lab',
        criteria: [{ id: ids.criterion, name: 'Inquiry', levels: {}, comments: [{ level: 3, text: 'Kept.' }] }],
        overallComments: ['Kept overall.'],
      },
    ];
    delete _cache.rubrics[CID];
    _useSupabase = false; // the seed itself is not under test
    saveRubrics(CID, rb);
    _useSupabase = true;
    return rb;
  };
  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    localStorage.clear();
    _rubricSaveQueue = {};
    client = recordingClient();
    globalThis.getSupabase = () => client;
    _useSupabase = true;
  });
  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    _serverState.rubrics && delete _serverState.rubrics[CID];
  });
  const calls = name => client.calls.filter(c => c.name === name);
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
    await new Promise(r => setTimeout(r, 0));
  };

  it('adds a criterion comment: cache, baseline, one keyed RPC, no rubric resend', async () => {
    const rb = seed();
    _rememberServerState('rubrics', CID, rb);
    expect(RubricComments.addCriterionComment(CID, R1, K1, 2, '  Add units.  ')).toBe(true);
    expect(RubricComments.at(getRubricById(CID, R1).criteria[0], 2)).toEqual(['Add units.']);
    expect(RubricComments.at(_serverStateOr('rubrics', CID, [])[0].criteria[0], 2)).toEqual(['Add units.']);
    await settle();
    const sent = calls('add_criterion_comment');
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ p_criterion_id: K1, p_level: 2, p_text: 'Add units.' });
    expect(sent[0].payload.p_idempotency_key).toMatch(/^[0-9a-f-]{36}$/);
    // The next save finds nothing to send.
    await saveRubrics(CID, getRubrics(CID));
    await settle();
    expect(calls('upsert_rubric')).toHaveLength(0);
  });

  it('adds an overall comment the same way', async () => {
    const rb = seed();
    _rememberServerState('rubrics', CID, rb);
    expect(RubricComments.addOverallComment(CID, R1, 'Next steps.')).toBe(true);
    expect(getRubricById(CID, R1).overallComments).toEqual(['Kept overall.', 'Next steps.']);
    await settle();
    const sent = calls('add_rubric_overall_comment');
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toMatchObject({ p_rubric_id: R1, p_text: 'Next steps.' });
    expect(sent[0].payload.p_idempotency_key).toBeTruthy();
    await saveRubrics(CID, getRubrics(CID));
    await settle();
    expect(calls('upsert_rubric')).toHaveLength(0);
  });

  it('ignores empty, duplicate and over-cap text', async () => {
    seed();
    expect(RubricComments.addCriterionComment(CID, R1, K1, 3, '   ')).toBe(false);
    expect(RubricComments.addCriterionComment(CID, R1, K1, 3, 'Kept.')).toBe(false);
    expect(RubricComments.addOverallComment(CID, R1, 'Kept overall.')).toBe(false);
    expect(RubricComments.addCriterionComment(CID, R1, 'nope', 3, 'New')).toBe(false);
    for (let i = 0; i < 39; i++) expect(RubricComments.addOverallComment(CID, R1, 'o' + i)).toBe(true);
    expect(RubricComments.addOverallComment(CID, R1, 'one too many')).toBe(false);
    expect(RubricComments.addCriterionComment(CID, R1, K1, 2, 'x'.repeat(600))).toBe(true);
    expect(RubricComments.at(getRubricById(CID, R1).criteria[0], 2)[0]).toHaveLength(500);
    await settle();
    expect(calls('add_criterion_comment')).toHaveLength(1);
    expect(calls('add_rubric_overall_comment')).toHaveLength(39);
    // Same level and text at another level is not a duplicate.
    expect(RubricComments.addCriterionComment(CID, R1, K1, 4, 'Kept.')).toBe(true);
  });

  it('a criterion still on a local id waits for its server id', async () => {
    seed({ rubric: R1, criterion: 'cLOCAL1' });
    expect(RubricComments.addCriterionComment(CID, R1, 'cLOCAL1', 3, 'Waits.')).toBe(true);
    await settle();
    expect(calls('add_criterion_comment')).toHaveLength(0);
    expect(RubricComments.at(getRubricById(CID, R1).criteria[0], 3)).toContain('Waits.');
  });

  it('a criterion whose create is queued holds the write behind it', async () => {
    const rb = [{ id: R1, name: 'Lab', criteria: [{ id: 'cLOCAL2', name: 'Inquiry', levels: {} }] }];
    delete _cache.rubrics[CID];
    saveRubrics(CID, rb); // writes on: registers the queued creates
    await settle();
    client.calls.length = 0;
    expect(RubricComments.addCriterionComment(CID, R1, 'cLOCAL2', 3, 'Waits.')).toBe(true);
    await settle();
    expect(calls('add_criterion_comment')).toHaveLength(0);
  });

  it('in Demo Mode the local write is the whole of it', async () => {
    localStorage.setItem('gb-demo-mode', '1');
    seed();
    expect(RubricComments.addCriterionComment(CID, R1, K1, 2, 'Demo.')).toBe(true);
    expect(RubricComments.addOverallComment(CID, R1, 'Demo overall.')).toBe(true);
    await settle();
    expect(client.calls).toHaveLength(0);
    const stored = JSON.parse(localStorage.getItem('gb-rubrics-' + CID));
    expect(stored[0].criteria[0].comments).toContainEqual({ level: 2, text: 'Demo.' });
    expect(stored[0].overallComments).toContain('Demo overall.');
  });

  it('the two writes are idempotent and echo-safe', () => {
    ['add_criterion_comment', 'add_rubric_overall_comment'].forEach(n => {
      expect(FV_IDEMPOTENT_RPCS[n]).toBe(true);
      expect(_ECHO_SAFE_RPCS[n]).toBe(true);
    });
  });
});

describe('backup and restore carry the comments', () => {
  it('backupToPayload puts comments and overall_comments on the rows', () => {
    const backup = {
      rubrics: [
        {
          id: R1,
          name: 'Lab',
          criteria: [
            { id: K1, name: 'Inquiry', levels: {}, comments: [{ level: 3, text: 'Kept.' }] },
            { id: K2, name: 'Plain', levels: {} },
          ],
          overallComments: ['Kept overall.'],
        },
      ],
    };
    const plan = FVBackupRestore.planRestore(
      { course: CID, ...backup },
      {
        makeId: (
          n => () =>
            'd1000000-0000-4000-8000-' + String(++n).padStart(12, '0')
        )(0),
      },
    );
    const p = plan.payload;
    expect(p.rubrics[0].overall_comments).toEqual(['Kept overall.']);
    expect(p.criteria[0].comments).toEqual([{ level: 3, text: 'Kept.' }]);
    // A Demo Mode restore keeps them in the cached rubric.
    expect(plan.cache.rubrics[0].criteria[0].comments).toEqual([{ level: 3, text: 'Kept.' }]);
    expect(plan.cache.rubrics[0].overallComments).toEqual(['Kept overall.']);
    expect('comments' in p.criteria[1]).toBe(false);
  });
});
