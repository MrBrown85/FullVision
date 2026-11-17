/**
 * The work icon on a student's row, on every kind of work (Colin, Nov 16:
 * "All types of assessment, not just rubrics, should have the ability to
 * add a submission for a student or view their submission the same way as
 * the rubrics already do"). With nothing in, the row has + (Attach Work);
 * with work in, See the Work. Points and Complete/Incomplete rows are the
 * ledger's (ledgerRowOpen); competencies with no rubric are the tag grid's.
 * A DIBELS benchmark is a reading record, not work: no icon.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass, openAssignments, closePages } from './helpers/pin-save-paths.js';

const CID = U(1);
const Q = U(41);
const IN = U(100); // work in
const NONE = U(101); // nothing in
const PIECES = {
  points: { id: U(301), title: 'Cell Quiz', scoreMode: 'points', maxPoints: 20 },
  complete: { id: U(302), title: 'Safety Contract', scoreMode: 'complete' },
  competencies: { id: U(303), title: 'Lab Write-Up', tagIds: [Q] },
  dibels: { id: U(304), title: 'Fall Benchmark', scoreMode: 'dibels' },
};
let wasDemo;

function sub(aid, sid) {
  return {
    id: 'w-' + aid.slice(-3),
    assessment_id: aid,
    enrollment_id: sid,
    version: 1,
    state: 'sent',
    sent_by: 'teacher',
    on_paper: false,
    is_late: false,
    note: null,
    sent_at: '2026-11-16T19:00:00Z',
    created_at: '2026-11-16T19:00:00Z',
    files: [{ id: 'f' + aid.slice(-3), page: 1, path: 'p.jpg', thumb_path: 't.jpg' }],
  };
}

function seed() {
  const pieces = Object.values(PIECES);
  seedClass(CID, {
    students: [
      { id: IN, firstName: 'Ava', lastName: 'Abbott' },
      { id: NONE, firstName: 'Ines', lastName: 'Baker' },
    ],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: pieces.map(p => Object.assign({ tagIds: [Q], date: '2026-11-10', dueDate: '2026-11-14' }, p)),
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: pieces.map(p => ({ id: p.id, students_send: 'photos_files' })),
    submissions: pieces.map(p => sub(p.id, IN)),
  });
}

const row = (aid, sid, cls) => document.querySelector('#ac-' + aid + ' .' + cls + '[data-sid="' + sid + '"]');

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
});
afterEach(() => {
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe("the work icon on a student's row", () => {
  ['points', 'complete', 'competencies'].forEach(kind => {
    it(kind + ': + with nothing in, See the Work with work in', () => {
      const aid = PIECES[kind].id;
      openAssignments(seed, CID, { open: aid });
      const plus = row(aid, NONE, 'rsg-attach-btn');
      expect(plus).not.toBeNull();
      expect(plus.getAttribute('data-action')).toBe('attachWorkMenu');
      expect(plus.getAttribute('aria-label')).toBe('Attach Work for Ines');
      expect(row(aid, NONE, 'rsg-see-work')).toBeNull();
      const see = row(aid, IN, 'rsg-see-work');
      expect(see).not.toBeNull();
      expect(see.getAttribute('data-action')).toBe('gradeSubmissions');
      expect(row(aid, IN, 'rsg-attach-btn')).toBeNull();
    });
  });

  it('points and Complete/Incomplete: the icon sits in the name cell, after the name', () => {
    ['points', 'complete'].forEach(kind => {
      const aid = PIECES[kind].id;
      openAssignments(seed, CID, { open: aid });
      const name = row(aid, NONE, 'rsg-attach-btn').closest('.ldg-name');
      expect(name.classList.contains('ldg-name-work')).toBe(true);
      expect(name.querySelector('.ldg-name-text').textContent).toContain('Baker');
      closePages();
    });
  });

  it('a DIBELS benchmark has no work icon', () => {
    const aid = PIECES.dibels.id;
    openAssignments(seed, CID, { open: aid });
    expect(document.querySelector('#ac-' + aid)).not.toBeNull();
    expect(document.querySelectorAll('#ac-' + aid + ' .rsg-work-btn').length).toBe(0);
  });
});
