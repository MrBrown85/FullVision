/**
 * Class manager — Duplicate Class.
 *
 * The copy gets the class settings, the learning map, sentence starters,
 * the categories with their weights and the rubrics (unlinked, competencies
 * matched by name), all as new rows. Reporting terms stay
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

/* Duplicate Class asks for the new class's block in a dialog (covered in
   e2e/class-block.spec.js), then runs this copy step. */
function duplicate(block) {
  DashClassManager.duplicateCourse(SRC, block || '');
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
    duplicate();
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

  it('copies rubrics as new, unlinked rows matched to the copy’s competencies', () => {
    _cache.learningMaps[SRC] = {
      subjects: [{ id: 'subj-sci', name: 'Science 8', color: '#123456' }],
      sections: [
        {
          id: 'sec-q',
          subject: 'subj-sci',
          name: 'Questioning',
          color: '#123456',
          tags: [{ id: 'tag-q', label: 'Question and Predict', text: 'Ask questions' }],
        },
      ],
      _customized: true,
      _version: 1,
    };
    _cache.rubrics[SRC] = [
      {
        id: 'rub-lab',
        name: 'Lab Rubric',
        copyGroup: 'group-1',
        criteria: [
          { id: 'crit-q', name: 'Inquiry', tagIds: ['tag-q'], weight: 1, levels: { 4: 'a', 3: 'b', 2: 'c', 1: 'd' } },
        ],
      },
      {
        id: 'rub-adv',
        name: 'Lab Skills',
        style: 'advanced',
        criteria: [
          {
            id: 'crit-safe',
            name: 'Safety',
            tagIds: [],
            weight: 1,
            levels: { 4: '', 3: '', 2: '', 1: '' },
            checks: [{ id: 'chk-1', level: 3, label: 'Goggles on', displayOrder: 0 }],
          },
        ],
      },
    ];
    duplicate();
    const cid = newCid();
    const copies = getRubrics(cid);
    expect(copies.map(r => r.name)).toEqual(['Lab Rubric', 'Lab Skills']);
    expect(copies.map(r => r.id)).not.toContain('rub-lab');
    expect(copies[0].copyGroup).toBeUndefined();
    // The competency is the copy's own, found by name.
    const newTag = getLearningMap(cid).sections[0].tags[0];
    expect(newTag.id).not.toBe('tag-q');
    expect(copies[0].criteria[0].tagIds).toEqual([newTag.id]);
    expect(copies[0].criteria[0].id).not.toBe('crit-q');
    // An Advanced Rubric keeps its style and gets new checkbox ids.
    expect(copies[1].style).toBe('advanced');
    expect(copies[1].criteria[0].checks.map(k => k.label)).toEqual(['Goggles on']);
    expect(copies[1].criteria[0].checks[0].id).not.toBe('chk-1');
    // The source keeps its rubrics and its link.
    expect(getRubrics(SRC).map(r => r.id)).toEqual(['rub-lab', 'rub-adv']);
    expect(getRubrics(SRC)[0].copyGroup).toBe('group-1');
  });

  it('copies no rubrics when the source has none', () => {
    duplicate();
    expect(getRubrics(newCid())).toEqual([]);
  });

  it('with a block chosen, keeps the class name and sets the block', () => {
    duplicate('B');
    const cid = newCid();
    expect(COURSES[cid].name).toBe('Science 8');
    expect(COURSES[cid].block).toBe('B');
    expect(courseDisplayName(COURSES[cid])).toBe('Block B \u00B7 Science 8');
  });

  it('copies nothing into categories when the source has none', () => {
    _cache.categories[SRC] = [];
    duplicate();
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

    duplicate();
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
