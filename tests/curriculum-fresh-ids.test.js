/**
 * Two classes made from the same BC course in one sitting each get their own
 * rows. The curriculum builder names rows after the course and its codes, the
 * same for every class, and the outbox resolves a local id against every
 * class's swaps, so the wizard and Re-link give new rows fresh ids before
 * saving (stage 5 review, finding F1).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const A = '11111111-1111-4111-8111-1111111111aa';
const B = '11111111-1111-4111-8111-1111111111bb';

describe('two classes from the same course', () => {
  var fake;
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    localStorage.clear();
    _cache.learningMaps = {};
    _learningMapSaveQueue = {};
    _learningMapIdRemap = {};
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
    saveCourses({ [A]: { id: A, name: 'Drafting 10 A' }, [B]: { id: B, name: 'Drafting 10 B' } });
    CURRICULUM_INDEX = newBankIndex(['DRAFT10']);
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    window.v2Queue.clear();
    CURRICULUM_INDEX = null;
  });

  it('saves the second class under its own course, folders and competencies', async () => {
    saveLearningMap(A, withFreshLearningMapIds(buildLearningMapFromTags(['DRAFT10'])));
    await settle(80);
    var before = fake.committed.length;
    saveLearningMap(B, withFreshLearningMapIds(buildLearningMapFromTags(['DRAFT10'])));
    await settle(80);
    var mine = fake.committed.slice(before);
    var subjects = mine.filter(c => c.name === 'upsert_subject' && !c.params.p_id);
    expect(subjects).toHaveLength(1);
    var subjectId = getLearningMap(B).subjects[0].id;
    var sections = mine.filter(c => c.name === 'upsert_section');
    expect(sections).toHaveLength(27);
    expect(sections.every(c => c.params.p_subject_id === subjectId)).toBe(true);
    // Every section in a folder points at one of B's folders.
    var folders = getLearningMap(B).competencyGroups.map(g => g.id);
    var inFolders = sections.filter(c => c.params.p_competency_group_id);
    expect(inFolders).toHaveLength(26);
    expect(inFolders.every(c => folders.indexOf(c.params.p_competency_group_id) >= 0)).toBe(true);
    // A is untouched: still 27 competencies.
    expect(getLearningMap(A).sections).toHaveLength(27);
  });
});
