/**
 * S12-F2: grading group work (the board "Teacher: Grading Group Work").
 * On a One per Group piece one member sends for the group: the grader shows
 * the group's work on one pane, Students in This Group and Change One
 * Student, and the one counting function (GraderWork.workCounts) counts a
 * group once. The plan's test: To Grade 4 means four groups; a member
 * graded separately returns on their own; a missing or excused member is
 * left out, as today.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass, openGrader, closePages, settle } from './helpers/pin-save-paths.js';
import { click } from './helpers/gradebook-dom.js';

const CID = U(1);
const PIECE = U(31);
const Q = U(41);
// Twelve students in four groups of three; the first of each sends.
const S = Array.from({ length: 12 }, (_, i) => U(101 + i));
const GROUPS = [S.slice(0, 3), S.slice(3, 6), S.slice(6, 9), S.slice(9, 12)];
const NAMES = ['Priya', 'Ava', 'Leo', 'Bea', 'Cal', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ida', 'Jo'];
let wasDemo;

function seed({ groupWork = 'group', sendWork = true } = {}) {
  seedClass(CID, {
    students: S.map((id, i) => ({ id, firstName: NAMES[i], lastName: String.fromCharCode(65 + i) + 'son' })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Manor', tags: [{ id: Q, label: 'Manor Layout', text: 'Lay it out' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      { id: PIECE, title: 'Manor', tagIds: [Q], date: '2026-11-03', collaboration: 'group', groups: GROUPS },
    ],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [{ id: PIECE, students_send: 'photos', group_work: groupWork }],
    submissions: GROUPS.map((g, i) => ({
      id: 'w' + i,
      assessment_id: PIECE,
      enrollment_id: g[0],
      version: 1,
      state: 'sent',
      sent_by: 'student',
      sent_at: '2026-11-03T18:0' + i + ':00Z',
      note: i === 0 ? 'Leo drew the cottages.' : null,
      files: [1, 2].map(n => ({ id: 'g' + i + 'p' + n, page: n, path: 'lab-p' + n + '.jpg', sha256: 'h' + i + n })),
    })),
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

describe('the one count', () => {
  it('To Grade 4 means four groups', () => {
    seed();
    const c = GraderWork.workCounts(CID, PIECE);
    expect([c.tograde, c.groups, c.notin]).toEqual([4, 4, 0]);
    // Every member is to grade: none who sent nothing is Not In.
    expect(c.ids.tograde.length).toBe(12);
    expect(GraderWork.classWorkCounts(CID).tograde).toBe(4);
  });

  it('on Each Student the members who sent nothing are Not In, as before', () => {
    seed({ groupWork: 'each' });
    const c = GraderWork.workCounts(CID, PIECE);
    expect(c.ids.notin.length).toBe(8);
  });

  it('a member graded separately counts and returns on their own', () => {
    seed();
    Grader.gradeSeparately(CID, PIECE, S[2]);
    expect(GraderWork.workCounts(CID, PIECE).tograde).toBe(5);
    Grader.setLevel(CID, S[2], PIECE, Q, 2);
    let c = GraderWork.workCounts(CID, PIECE);
    expect([c.tograde, c.toreturn]).toEqual([4, 1]);
    expect(c.ids.toreturn).toEqual([S[2]]);
    Grader.returnGrades(CID, PIECE, [S[2]]);
    c = GraderWork.workCounts(CID, PIECE);
    expect([c.tograde, c.toreturn, c.returned]).toEqual([4, 0, 1]);
    expect(c.ids.returned).toEqual([S[2]]);
  });

  it('a member marked Missing or Excused is left out; the group still counts once', () => {
    seed();
    Grader.setStatus(CID, S[1], PIECE, 'NS');
    Grader.setStatus(CID, S[4], PIECE, 'EXC');
    const c = GraderWork.workCounts(CID, PIECE);
    expect([c.tograde, c.notin]).toEqual([4, 0]);
    expect(c.ids.tograde).not.toContain(S[1]);
    expect(c.ids.tograde).not.toContain(S[4]);
  });

  it('the group’s own pages are not "the same photo" as a group-mate’s', () => {
    seed();
    expect(GraderWork.samePhotoAs(CID, PIECE, S[1])).toEqual([]);
  });
});

describe('the grader on a group', () => {
  it('one work pane for the group, whoever sent it, with the board’s words', async () => {
    const overlay = openGrader(seed, CID, PIECE, S[1]);
    await settle();
    expect(overlay.querySelector('.grader-work-what').textContent).toBe(
      'Sent by Priya A. for the group, Nov 3 · 2 photos',
    );
    expect(overlay.querySelector('.grader-work-at').textContent).toBe('1 of 2');
    expect(overlay.querySelector('.grader-work-note-title').textContent).toBe('Priya’s Note, Sent for the Group');
    expect(overlay.querySelector('.grader-work-delete')).toBeNull();
    const strip = overlay.querySelector('.grader-work-strip');
    expect(strip.getAttribute('aria-label')).toBe('Groups to grade');
    expect([...strip.querySelectorAll('button')].map(b => b.getAttribute('aria-label'))).toEqual([
      'Group 1',
      'Group 2',
      'Group 3',
      'Group 4',
    ]);
    expect(strip.querySelector('[aria-current="true"]').getAttribute('aria-label')).toBe('Group 1');
    click(strip.querySelectorAll('button')[2]);
    expect(overlay.querySelector('.grader-work-what').textContent).toMatch(/^Sent by Eli G\. for the group/);
  });

  it('Students in This Group: one grade for all three, each Same as group', () => {
    const overlay = openGrader(seed, CID, PIECE, S[0]);
    const card = overlay.querySelector('.grader-members');
    expect(card.querySelector('.grader-members-title').textContent).toBe('Students in This Group');
    expect(card.querySelector('.grader-members-hint').textContent).toBe(
      'One grade for all three. Change one student only when their part was different.',
    );
    expect([...card.querySelectorAll('.grader-member-same')].map(p => p.textContent)).toEqual([
      'Same as group',
      'Same as group',
      'Same as group',
    ]);
  });

  it('Change One Student: the member keeps the group’s grade as their own, opens, and the change is named', () => {
    const overlay = openGrader(seed, CID, PIECE, S[0]);
    Grader.setLevel(CID, S[0], PIECE, Q, 3);
    window.PageAssignments.render();
    click(overlay.querySelector('.grader-change-one-btn'));
    const items = [...overlay.querySelectorAll('[data-grader="change-one"]')];
    expect(items.map(b => b.textContent)).toEqual(['Priya Ason', 'Ava Bson', 'Leo Cson']);
    click(items[2]);
    const a = getAssessments(CID).find(x => x.id === PIECE);
    expect(isGradedSeparately(a, S[2])).toBe(true);
    expect(overlay.querySelector('.grader-separate-line').textContent).toMatch(/^Graded Separately From Group 1/);
    // Leo's own grade starts as the group's: nothing is named as changed.
    click(overlay.querySelector('[data-grader="prev"]'));
    expect(overlay.querySelector('.grader-member-same.is-changed')).toBeNull();
    // Then it changes.
    Grader.setLevel(CID, S[2], PIECE, Q, 1);
    window.PageAssignments.render();
    const card = overlay.querySelector('.grader-members');
    expect(card.querySelector('.grader-members-title').textContent).toBe('Students in This Group');
    expect(card.querySelector('.grader-member-same.is-changed').textContent).toBe(
      'Manor Layout: Emerging · changed for Leo',
    );
  });

  it('without Send Work or work in, the members card is the same board card, after the criteria', () => {
    const overlay = openGrader(
      () => {
        seed({ sendWork: false });
        const work = getCourseSubmissions(CID);
        work.submissions = [];
        saveDemoStudentWork(CID, work);
      },
      CID,
      PIECE,
      S[0],
    );
    const card = overlay.querySelector('.grader-members');
    expect(card.querySelector('.grader-members-title').textContent).toBe('Students in This Group');
    expect(card.querySelector('.grader-members-hint').textContent).toBe(
      'One grade for all three. Change one student only when their part was different.',
    );
    expect(card.querySelectorAll('.grader-member-same')).toHaveLength(3);
    expect(overlay.querySelector('.grader-change-one-btn')).not.toBeNull();
    // Criteria, then Students in This Group, then the Overall Comment.
    const order = [...overlay.querySelectorAll('.grdl-card[data-tag], .grader-members, .grdt-overall')].map(el =>
      el.className.split(' ').pop(),
    );
    expect(order).toEqual(['grdl-card', 'grader-members', 'grdt-overall']);
    expect(overlay.querySelector('.grader-work') === null).toBe(true);
  });
});
