/**
 * Core Competencies on an assessment are stored on the server
 * (migrations/20261027_assessment_core_competencies.sql). The chips on the
 * assessment form used to live only in the browser's copy of the class, so
 * the next class load dropped them and other devices never saw them.
 *
 *   create_assessment   p_core_competency_ids, only when some are ticked
 *   update_assessment   core_competency_ids in p_patch, only when changed
 *   get_class_bundle /  core_competency_ids on each assessment, read back
 *   get_gradebook       into coreCompetencyIds
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

// Production loads the outbox next to shared/data.js; so do these tests.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = '11111111-1111-4111-8111-111111111111';
const AID = '44444444-4444-4444-8444-444444444444';

describe('_coreCompetencyIdsOf', () => {
  it('keeps known codes once, in CORE_COMPETENCIES order', () => {
    expect(_coreCompetencyIdsOf(['PAR', 'COM', 'COM', 'XYZ', 'CRT'])).toEqual(['COM', 'CRT', 'PAR']);
  });

  it('gives an empty list for none', () => {
    expect(_coreCompetencyIdsOf(undefined)).toEqual([]);
    expect(_coreCompetencyIdsOf(null)).toEqual([]);
    expect(_coreCompetencyIdsOf([])).toEqual([]);
  });
});

describe('Core Competencies on the write path', () => {
  var fake;
  var originalGetSupabase;
  var originalUseSupabase;

  function seed(value) {
    _cache.assessments[CID] = value;
    localStorage.setItem('gb-' + _DATA_KEYS.assessments + '-' + CID, JSON.stringify(value));
  }

  beforeEach(() => {
    localStorage.clear();
    _cache.assessments = {};
    _assessmentSaveQueue = {};
    _assessmentDispatchQueue = {};
    _serverState = {};
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });
    window.v2Queue.clear();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    window.v2Queue.clear();
  });

  it('sends the ticked chips with a new assessment', async () => {
    seed([]);
    saveAssessments(CID, [{ id: 'local-1', title: 'Lab', tagIds: [], coreCompetencyIds: ['CRT', 'COM'] }]);
    await settle();
    var call = fake.committed.find(c => c.name === 'create_assessment');
    expect(call.params.p_core_competency_ids).toEqual(['COM', 'CRT']);
    expect(call.params.p_idempotency_key).toEqual(expect.any(String));
  });

  it('leaves the parameter out when no chip is ticked', async () => {
    seed([]);
    saveAssessments(CID, [{ id: 'local-1', title: 'Lab', tagIds: [] }]);
    await settle();
    var call = fake.committed.find(c => c.name === 'create_assessment');
    expect('p_core_competency_ids' in call.params).toBe(false);
  });

  it('sends a changed chip set in the update patch, and only the change', async () => {
    _persistLoadedField(CID, 'assessments', [{ id: AID, title: 'Lab', tagIds: [], coreCompetencyIds: ['COM'] }]);
    var list = getAssessments(CID).map(a => Object.assign({}, a, { coreCompetencyIds: ['COM', 'PAR'] }));
    saveAssessments(CID, list);
    await settle();
    var call = fake.committed.find(c => c.name === 'update_assessment');
    expect(call.params.p_patch).toEqual({ core_competency_ids: ['COM', 'PAR'] });
  });

  it('clears the chips on the server when the last one is unticked', async () => {
    _persistLoadedField(CID, 'assessments', [{ id: AID, title: 'Lab', tagIds: [], coreCompetencyIds: ['COM'] }]);
    var list = getAssessments(CID).map(a => Object.assign({}, a, { coreCompetencyIds: undefined }));
    saveAssessments(CID, list);
    await settle();
    var call = fake.committed.find(c => c.name === 'update_assessment');
    expect(call.params.p_patch).toEqual({ core_competency_ids: [] });
  });

  it('sends nothing when the chips are the same in another order', async () => {
    _persistLoadedField(CID, 'assessments', [{ id: AID, title: 'Lab', tagIds: [], coreCompetencyIds: ['COM', 'CRT'] }]);
    var list = getAssessments(CID).map(a => Object.assign({}, a, { coreCompetencyIds: ['CRT', 'COM'] }));
    saveAssessments(CID, list);
    await settle();
    expect(fake.calls.filter(c => c.name === 'update_assessment')).toHaveLength(0);
  });

  it('keeps the chips in the outbox when the update fails, and sends them on retry', async () => {
    _persistLoadedField(CID, 'assessments', [{ id: AID, title: 'Lab', tagIds: [], coreCompetencyIds: [] }]);
    fake.failNext('update_assessment');
    var list = getAssessments(CID).map(a => Object.assign({}, a, { coreCompetencyIds: ['SAR'] }));
    saveAssessments(CID, list);
    await settle();
    expect(fake.committed.filter(c => c.name === 'update_assessment')).toHaveLength(0);
    await window.v2Queue.flush();
    var committed = fake.committed.filter(c => c.name === 'update_assessment');
    expect(committed).toHaveLength(1);
    expect(committed[0].params.p_patch.core_competency_ids).toEqual(['SAR']);
  });
});

describe('Core Competencies on the read path', () => {
  beforeEach(() => {
    localStorage.clear();
    _cache.assessments = {};
    _serverState = {};
  });

  it('the class bundle load reads core_competency_ids into coreCompetencyIds', () => {
    _bundleToCache(CID, {
      gradebook: {
        course: { id: CID },
        students: [],
        assessments: [
          { id: AID, title: 'Lab', score_mode: 'proficiency', core_competency_ids: ['PAR', 'COM'] },
          { id: 'b2', title: 'Quiz', score_mode: 'proficiency', core_competency_ids: [] },
        ],
        categories: [],
        modules: [],
      },
    });
    var byId = {};
    getAssessments(CID).forEach(a => (byId[a.id] = a));
    expect(byId[AID].coreCompetencyIds).toEqual(['COM', 'PAR']);
    expect(byId.b2.coreCompetencyIds).toEqual([]);
  });

  it('the server list replaces a stale local one, empty included', () => {
    var next = _assessmentFromDetail(
      { id: AID, title: 'Lab', coreCompetencyIds: ['COM'] },
      { assessment: { id: AID, core_competency_ids: [] }, linked_tags: [] },
    );
    expect(next.coreCompetencyIds).toEqual([]);
  });

  it('an older server that sends no list gives an empty one', () => {
    _v2GradebookToCache(CID, {
      course: { id: CID },
      students: [],
      assessments: [{ id: AID, title: 'Lab', score_mode: 'proficiency' }],
      categories: [],
      modules: [],
      cells: {},
    });
    expect(getAssessments(CID)[0].coreCompetencyIds).toEqual([]);
  });
});
