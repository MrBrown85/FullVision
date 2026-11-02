/**
 * Class manager — Download Class Backup.
 *
 * The backup file carries each competency's I Can statements, curriculum
 * wording (source_text) and bank id, so a restore through
 * import_json_restore (migrations/20261102_import_json_restore_tag_fields.sql)
 * gets them back.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CID = 'b0000000-0000-4000-8000-000000000001';
const SUBJ = 'b0000000-0000-4000-8000-000000000002';
const SEC = 'b0000000-0000-4000-8000-000000000003';
const T1 = 'b0000000-0000-4000-8000-000000000004';
const T2 = 'b0000000-0000-4000-8000-000000000005';

/* The learning map as get_class_bundle sends it. */
const serverMap = {
  subjects: [
    {
      id: SUBJ,
      name: 'Science',
      display_order: 0,
      sections: [
        {
          id: SEC,
          name: 'Questioning and Predicting',
          display_order: 0,
          tags: [
            {
              id: T1,
              code: 'QP1',
              label: 'Ask questions',
              i_can_text: 'I can ask questions\nI can make predictions',
              i_can_statements: ['I can ask questions', 'I can make predictions'],
              source_text: 'Demonstrate a sustained intellectual curiosity about a scientific topic',
              bank_id: 'bc.sci8.cc.1',
              display_order: 0,
            },
            { id: T2, code: 'QP2', label: 'Hand-made', i_can_text: '', display_order: 1 },
          ],
        },
      ],
    },
  ],
};

describe('class manager — download class backup', () => {
  var written;
  var originalBlob;
  var originalCreateObjectURL;
  var originalCreateElement;
  var link;

  beforeEach(() => {
    localStorage.clear();
    saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency' } });
    _persistLoadedField(CID, 'learningMaps', _canonicalLearningMapToCache(CID, serverMap));
    written = null;
    originalBlob = globalThis.Blob;
    originalCreateObjectURL = URL.createObjectURL;
    globalThis.Blob = function (parts) {
      written = parts.join('');
    };
    URL.createObjectURL = () => 'blob:backup';
    originalCreateElement = document.createElement;
    link = { click: vi.fn() };
    document.createElement = () => link;
  });

  afterEach(() => {
    globalThis.Blob = originalBlob;
    URL.createObjectURL = originalCreateObjectURL;
    document.createElement = originalCreateElement;
  });

  it('keeps I Can statements, curriculum wording and bank ids', () => {
    DashClassManager.handleAction('cmDownloadBackup', { dataset: { cid: CID } });
    expect(link.click).toHaveBeenCalledTimes(1);
    expect(link.download).toMatch(/^gradebook-b0000000-.*\.json$/);

    const backup = JSON.parse(written);
    const tags = backup.learningMap.sections.flatMap(s => s.tags);
    const byId = Object.fromEntries(tags.map(t => [t.id, t]));
    expect(byId[T1]).toMatchObject({
      i_can_statements: ['I can ask questions', 'I can make predictions'],
      source_text: 'Demonstrate a sustained intellectual curiosity about a scientific topic',
      bank_id: 'bc.sci8.cc.1',
    });
    // A hand-made competency has none, and says so rather than dropping the keys.
    expect(byId[T2]).toMatchObject({ i_can_statements: [], source_text: null, bank_id: null });
  });
});
