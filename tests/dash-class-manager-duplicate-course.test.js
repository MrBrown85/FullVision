/**
 * Class manager — Duplicate Class.
 *
 * The copy gets the class settings, the learning map, sentence starters and
 * the categories with their weights, all as new rows. Reporting terms stay
 * behind: their dates belong to one school year (docs/DECISIONS.md,
 * Reporting periods 6). Signed in, the categories wait for the new class's
 * server id and then go up through save_categories.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const SRC = '11111111-1111-4111-8111-111111111111';
const NEW_CID = '55555555-5555-4555-8555-555555555555';
const LAB = '66666666-6666-4666-8666-000000000001';
const TEST = '66666666-6666-4666-8666-000000000002';

const TERMS = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-02', ends_on: '2026-11-20' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-11-23', ends_on: '2027-01-30' },
];

function stubEl(dataset) {
  return { dataset: dataset };
}

function newCid() {
  return Object.keys(COURSES).find(id => id !== SRC);
}

function seedSource() {
  saveCourses({
    [SRC]: { id: SRC, name: 'Science 8', gradingSystem: 'both', calcMethod: 'decayingAvg', decayWeight: 0.7 },
  });
  _cache.courseConfigs[SRC] = {
    calcMethod: 'decayingAvg',
    decayWeight: 0.7,
    roundPercent: false,
    reportingTerms: TERMS,
  };
  // Stored out of order: the copy follows displayOrder.
  _cache.categories[SRC] = [
    { id: TEST, name: 'Tests', weight: 60, displayOrder: 1 },
    { id: LAB, name: 'Labs', weight: 40, displayOrder: 0 },
  ];
}

describe('class manager — duplicate class', () => {
  var fake;
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function (field) {
      if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config') {
        _cache[field] = {};
      }
    });
    _categorySaveQueue = {};
    _serverState = {};
    _idRekeys = {};
    _idmapCache = null;
    _idmapRaw = null;
    _pendingLocalCids.clear();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = false;
    window.v2Queue.clear();
    seedSource();
    DashClassManager.configure({ activeCourse: SRC, onRender: function () {}, onCourseChange: function () {} });
    DashClassManager.openClassManager();
  });

  afterEach(() => {
    DashClassManager.resetState();
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    window.v2Queue.clear();
  });

  it('copies categories as new rows in order and leaves reporting terms behind', () => {
    DashClassManager.handleAction('cmDuplicateCourse', stubEl({ cid: SRC }));
    const cid = newCid();
    expect(COURSES[cid].name).toBe('Science 8 (Copy)');

    const cats = getCategories(cid);
    expect(cats.map(c => [c.name, c.weight, c.displayOrder])).toEqual([
      ['Labs', 40, 0],
      ['Tests', 60, 1],
    ]);
    expect(cats.map(c => c.id)).not.toContain(LAB);
    expect(cats.map(c => c.id)).not.toContain(TEST);

    const cc = getCourseConfig(cid);
    expect(cc).toMatchObject({ calcMethod: 'decayingAvg', decayWeight: 0.7, roundPercent: false });
    expect(cc.reportingTerms).toBeUndefined();
    expect(getReportingTerms(cid)).toEqual([]);

    // The source class is untouched.
    expect(getCategories(SRC).map(c => c.id)).toEqual([TEST, LAB]);
    expect(getCourseConfig(SRC).reportingTerms).toEqual(TERMS);
  });

  it('copies nothing into categories when the source has none', () => {
    _cache.categories[SRC] = [];
    DashClassManager.handleAction('cmDuplicateCourse', stubEl({ cid: SRC }));
    expect(getCategories(newCid())).toEqual([]);
  });

  it('signed in, sends the categories with the new class id once it lands, and no terms', async () => {
    fake = makeFakeSupabase();
    fake.on('create_course', () => ({ data: NEW_CID, error: null }));
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });

    DashClassManager.handleAction('cmDuplicateCourse', stubEl({ cid: SRC }));
    await settle();

    const saves = fake.committed.filter(c => c.name === 'save_categories');
    expect(saves).toHaveLength(1);
    expect(saves[0].params.p_course_id).toBe(NEW_CID);
    expect(saves[0].params.p_categories).toEqual([
      { name: 'Labs', weight: 40 },
      { name: 'Tests', weight: 60 },
    ]);

    // Re-keyed to the server's ids under the new class.
    const cats = getCategories(NEW_CID);
    expect(cats).toHaveLength(2);
    cats.forEach(c => expect(c.id).toMatch(/^aaaaaaaa-/));

    const patches = fake.calls.filter(c => c.name === 'update_course' && c.params.p_course_id === NEW_CID);
    expect(patches.length).toBeGreaterThan(0);
    patches.forEach(p => expect(p.params.p_patch).not.toHaveProperty('reporting_terms'));
    // Nothing is written to the source class.
    expect(fake.calls.filter(c => c.params.p_course_id === SRC && !/^list_/.test(c.name))).toEqual([]);
  });
});
