/**
 * S14 follow-up: the Work Wall counts a group once.
 *
 * On a One per Group piece a pair that sent one piece of work is one piece
 * to grade. GraderWork (shared/grader.js) counts it once; the grader, the
 * gradebook, the dashboard and the phone all say so. The wall's To Grade
 * and Not In pills, and the cards its To Grade filter shows, must say the
 * same. Before this change the wall counted the pair as two.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const PIECE = U(31);
const Q = U(41);
const NAMES = ['Aiden', 'Olivia', 'Ines', 'Marcus', 'Sofia', 'Tom', 'Uma'];
const S = NAMES.map((_, i) => U(101 + i));
const [AIDEN, OLIVIA, INES, MARCUS, SOFIA] = S;

let doc;
let stubDocument;
let wasDemo;
let realPA;

const text = el => el.textContent.replace(/\s+/g, ' ').trim();
const $ = sel => doc.querySelector(sel);
const $$ = sel => [...doc.querySelectorAll(sel)];
const click = el => el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));
const pill = f => $('.ww-pill[data-filter="' + f + '"]');

function sub(sid, n) {
  return {
    id: 'w' + n,
    assessment_id: PIECE,
    enrollment_id: sid,
    version: 1,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    sent_at: '2026-11-03T18:0' + n + ':00Z',
    created_at: '2026-11-03T18:0' + n + ':00Z',
    files: [{ id: 'p' + n, page: 1, path: 'p' + n + '.jpg', thumb_path: 'p' + n + '-thumb.jpg' }],
  };
}

// Aiden and Olivia are a pair; Aiden sent for both. Ines, Marcus and Sofia
// sent their own; Tom and Uma sent nothing.
function seed({ groupWork = 'group', sender = AIDEN } = {}) {
  seedClass(CID, {
    students: S.map((id, i) => ({ id, firstName: NAMES[i], lastName: String.fromCharCode(65 + i) + 'son' })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Light', tags: [{ id: Q, label: 'Refraction', text: 'Bend light' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      {
        id: PIECE,
        title: 'Light Lab',
        tagIds: [Q],
        date: '2026-11-03',
        collaboration: 'pair',
        pairs: [[AIDEN, OLIVIA]],
      },
    ],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: [{ id: PIECE, students_send: 'photos', group_work: groupWork }],
    submissions: [sub(sender, 1), sub(INES, 2), sub(MARCUS, 3), sub(SOFIA, 4)],
  });
  clearProfCache();
}

beforeEach(() => {
  localStorage.clear();
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  stubDocument = globalThis.document;
  doc = parseHTML('<!DOCTYPE html><html><body><div id="main"></div></body></html>').document;
  globalThis.document = doc;
  globalThis.requestAnimationFrame = fn => fn();
  realPA = window.PageAssignments;
  window.PageAssignments = { openGrader: () => {}, graderOpen: () => false };
});
afterEach(() => {
  WorkWall.close(true);
  window.PageAssignments = realPA;
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('the Work Wall on a pair', () => {
  it("To Grade and Not In are GraderWork's: the pair counts once", () => {
    seed();
    const c = GraderWork.workCounts(CID, PIECE);
    expect([c.tograde, c.groups, c.notin]).toEqual([4, 1, 2]);
    WorkWall.open(CID, PIECE);
    expect(text(pill('tograde'))).toBe('To Grade ' + c.tograde);
    expect(text(pill('notin'))).toBe('Not In ' + c.notin);
    // All still has a card per student.
    expect(text(pill('all'))).toBe('All 7');
    expect($$('.ww-card').length).toBe(7);
  });

  it('the To Grade filter shows a card per piece of work: the pair once, by the one who sent', () => {
    seed();
    WorkWall.open(CID, PIECE);
    click(pill('tograde'));
    const shown = $$('.ww-card').map(el => el.getAttribute('data-sid'));
    expect(shown.length).toBe(GraderWork.workCounts(CID, PIECE).tograde);
    expect(shown).toContain(AIDEN);
    expect(shown).not.toContain(OLIVIA);
    expect(shown).toEqual(expect.arrayContaining([INES, MARCUS, SOFIA]));
  });

  it('the card that stands for the pair is the one with the work, whoever is first by name', () => {
    seed({ sender: OLIVIA });
    WorkWall.open(CID, PIECE);
    click(pill('tograde'));
    const shown = $$('.ww-card').map(el => el.getAttribute('data-sid'));
    expect(shown).toContain(OLIVIA);
    expect(shown).not.toContain(AIDEN);
    expect($('.ww-card[data-sid="' + OLIVIA + '"] img')).not.toBeNull();
  });

  it('a member graded separately is their own piece again, on the wall as in GraderWork', () => {
    seed();
    Grader.gradeSeparately(CID, PIECE, OLIVIA);
    const c = GraderWork.workCounts(CID, PIECE);
    expect(c.tograde).toBe(5);
    WorkWall.open(CID, PIECE);
    expect(text(pill('tograde'))).toBe('To Grade 5');
    click(pill('tograde'));
    expect($$('.ww-card').length).toBe(5);
  });

  it('on Each Student nothing is merged: Olivia sent nothing and is Not In', () => {
    seed({ groupWork: 'each' });
    const c = GraderWork.workCounts(CID, PIECE);
    WorkWall.open(CID, PIECE);
    expect(text(pill('tograde'))).toBe('To Grade ' + c.tograde);
    expect(text(pill('notin'))).toBe('Not In ' + c.notin);
    expect(c.ids.notin).toContain(OLIVIA);
  });
});
