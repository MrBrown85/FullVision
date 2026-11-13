/**
 * S9-T1: the grader's work pane exposes the page on screen as a surface a
 * drawing layer can sit on (PageAssignments.workSurface). A tidy-up: the
 * picture, the pager, the fit and the turn work as before; the turn is now
 * on the surface, so a layer inside it turns with the picture.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass, openGrader, closePages, settle } from './helpers/pin-save-paths.js';

const CID = U(1);
const PIECE = U(31);
const Q = U(41);
const ANA = U(101);
const BO = U(102);
let wasDemo;

function seed({ sendWork = true } = {}) {
  seedClass(CID, {
    students: [
      { id: ANA, firstName: 'Ana', lastName: 'Avila' },
      { id: BO, firstName: 'Bo', lastName: 'Bell' },
    ],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [{ id: PIECE, title: 'Lab', tagIds: [Q], date: '2026-10-20' }],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  const file = (id, n) => ({ id, page: n, path: 'lab-p' + n + '.jpg', thumb_path: 'lab-p' + n + '-t.jpg' });
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [{ id: PIECE, students_send: 'photos' }],
    submissions: [
      {
        id: 'w1',
        assessment_id: PIECE,
        enrollment_id: ANA,
        version: 1,
        state: 'sent',
        sent_by: 'student',
        sent_at: '2026-10-30T20:41:00Z',
        files: [file('a1', 1), file('a2', 2)],
      },
    ],
  });
}

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

describe('PageAssignments.workSurface', () => {
  it('names the page on screen; the picture is inside the surface', async () => {
    const overlay = openGrader(seed, CID, PIECE, ANA);
    await settle();
    const s = window.PageAssignments.workSurface();
    expect(s.el).toBe(overlay.querySelector('.grader-work-page > .grader-work-surface'));
    expect(s.img.parentNode).toBe(s.el);
    expect(s.img.getAttribute('src')).toBe('/assets/sample-work/lab-p1.jpg');
    expect({ cid: s.cid, aid: s.aid, sid: s.sid, fileId: s.fileId, page: s.page, turn: s.turn }).toEqual({
      cid: CID,
      aid: PIECE,
      sid: ANA,
      fileId: 'a1',
      page: 1,
      turn: 0,
    });
    overlay.querySelector('[data-grader="work-page"][data-dir="1"]').click();
    overlay.querySelector('[data-grader="work-rotate"]').click();
    expect(window.PageAssignments.workSurface()).toMatchObject({ fileId: 'a2', page: 2, turn: 90 });
  });

  it('null with nothing in and with the dialog closed; work that is in shows with Send Work off', () => {
    openGrader(seed, CID, PIECE, BO);
    expect(window.PageAssignments.workSurface()).toBeNull();
    closePages();
    openGrader(() => seed({ sendWork: false }), CID, PIECE, ANA);
    expect(window.PageAssignments.workSurface()).toMatchObject({ fileId: 'a1', page: 1 });
    window.PageAssignments.closeGrader();
    expect(window.PageAssignments.workSurface()).toBeNull();
  });
});
