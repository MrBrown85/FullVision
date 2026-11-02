/**
 * Bank ids on the server (migrations/20261102_tag_bank_id.sql). A competency
 * imported from the BC curriculum bank keeps the bank's id in tag.bank_id:
 * the save sends it, a change to it alone is saved, and it comes back from
 * get_learning_map / get_class_bundle and from the removed-competency list.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = '11111111-1111-4111-8111-111111111111';
const SUBJ = '55555555-5555-4555-8555-555555555555';
const SEC1 = '66666666-6666-4666-8666-666666666666';
const TAG1 = '77777777-7777-4777-8777-777777777777';

function seedMap(bankId) {
  var map = {
    subjects: [{ id: SUBJ, name: 'Drafting 10', color: '#6366f1' }],
    sections: [
      {
        id: SEC1,
        subject: SUBJ,
        name: 'Prototype Building',
        color: '#6366f1',
        tags: [
          {
            id: TAG1,
            code: 'PR3',
            label: 'Prototype Building',
            text: 'Prototype, making changes to tools, materials, and procedures as needed',
            source_text: 'Prototype, making changes to tools, materials, and procedures as needed',
            i_can_statements: [],
            bank_id: bankId,
          },
        ],
      },
    ],
    _customized: true,
    _version: 1,
    _flatVersion: 2,
  };
  _cache.learningMaps[CID] = map;
  localStorage.setItem('gb-' + _DATA_KEYS.learningMaps + '-' + CID, JSON.stringify(map));
  return map;
}

describe('tag.bank_id', () => {
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
    saveCourses({ [CID]: { id: CID, name: 'Drafting 10' } });
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    window.v2Queue.clear();
  });

  it('upsertTag sends p_bank_id, and null when there is none', async () => {
    await window.v2.upsertTag({ sectionId: SEC1, label: 'Prototype Building', bankId: 'bc.draft10.cc.11' });
    await window.v2.upsertTag({ sectionId: SEC1, label: 'My Own' });
    var sent = fake.calls.filter(c => c.name === 'upsert_tag').map(c => c.params.p_bank_id);
    expect(sent).toEqual(['bc.draft10.cc.11', null]);
  });

  it('saving a learning map sends the tag’s bank id', async () => {
    var map = seedMap(null);
    _rememberServerState('learningMaps', CID, JSON.parse(JSON.stringify(map)));
    var next = JSON.parse(JSON.stringify(map));
    next.sections[0].tags[0].bank_id = 'bc.draft10.cc.11';
    saveLearningMap(CID, next);
    await settle(60);
    expect(fake.committedCount('upsert_tag', p => p.p_id === TAG1 && p.p_bank_id === 'bc.draft10.cc.11')).toBe(1);
  });

  it('does not resend a tag whose bank id did not change', async () => {
    var map = seedMap('bc.draft10.cc.11');
    _rememberServerState('learningMaps', CID, JSON.parse(JSON.stringify(map)));
    saveLearningMap(CID, JSON.parse(JSON.stringify(map)));
    await settle(60);
    expect(fake.committedCount('upsert_tag')).toBe(0);
  });

  it('reads bank_id from the server learning map', () => {
    var map = _canonicalLearningMapToCache(CID, {
      subjects: [
        {
          id: SUBJ,
          name: 'Drafting 10',
          sections: [
            {
              id: SEC1,
              name: 'Prototype Building',
              tags: [{ id: TAG1, code: 'PR3', label: 'Prototype Building', bank_id: 'bc.draft10.cc.11' }],
            },
          ],
        },
      ],
    });
    expect(map.sections[0].tags[0].bank_id).toBe('bc.draft10.cc.11');
  });

  it('keeps bank_id on a removed competency so Add Back restores it', () => {
    mergeRemovedSectionsFromServer(CID, [
      {
        id: SEC1,
        name: 'Prototype Building',
        subject_id: SUBJ,
        removed_at: '2026-11-02T00:00:00Z',
        tags: [{ id: TAG1, code: 'PR3', label: 'Prototype Building', bank_id: 'bc.draft10.cc.11' }],
      },
    ]);
    expect(getRemovedSections(CID)[0].section.tags[0].bank_id).toBe('bc.draft10.cc.11');
  });
});
