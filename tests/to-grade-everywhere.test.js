/**
 * The plan's S6 unit test (docs/plans/student-page-build-plan.md, S6,
 * "Tests"): the dashboard's To Grade cell, the gradebook's "N to grade"
 * filter, the Assignments page's To Grade and the grader dialog's Show bar
 * give the same numbers, because each calls GraderWork (shared/grader.js);
 * a group counts once. And the dashboard cell in every state on its board
 * (S6-F5): Send Work off (no cell), a normal day, work sitting a week, all
 * caught up, graded but nothing returned, group work.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { mount, unmount } from './helpers/gradebook-dom.js';
import { U, seedClass, clearClass, openGrader, openAssignments, closePages, click } from './helpers/pin-save-paths.js';

const CID = U(1);
const LAB = U(31); // Students Send Photos
const TALK = U(32); // group work: the first three are one group
const QUIZ = U(33); // takes no work
const Q = U(41);
const IDS = Array.from({ length: 8 }, (_, i) => U(100 + i));
let wasDemo;

function sub(sid, aid, at, files = 1) {
  return {
    id: 'w' + sid.slice(-3) + aid.slice(-2),
    assessment_id: aid,
    enrollment_id: sid,
    version: 1,
    state: 'sent',
    sent_by: 'student',
    on_paper: false,
    note: null,
    sent_at: at,
    created_at: at,
    files: Array.from({ length: files }, (_, i) => ({
      id: 'f' + sid.slice(-3) + aid.slice(-2) + i,
      page: i + 1,
      path: 'lab-p1.jpg',
      thumb_path: 'lab-p1-t.jpg',
      sha256: sid + aid + i,
    })),
  };
}

/* 8 students. Lab: 0-2 sent and wait, 3 sent and is a draft, 4 sent and is
   returned, 5-7 nothing in. Talk (group of 0-2, others alone): 0, 1 and 5
   sent and wait. */
function seed({ sendWork = true, sentAt = null, labOnly = false } = {}) {
  const today = courseToday(CID);
  const at = sentAt || today + 'T09:00:00Z';
  seedClass(CID, {
    students: IDS.map((id, i) => ({ id, firstName: 'S' + i, lastName: 'L' + i })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      { id: LAB, title: 'Lab', tagIds: [Q], date: '2026-10-20' },
      { id: TALK, title: 'Talk', tagIds: [Q], date: '2026-10-21', collaboration: 'group', groups: [IDS.slice(0, 3)] },
      { id: QUIZ, title: 'Quiz', tagIds: [Q], date: '2026-10-22' },
    ],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  const subs = IDS.slice(0, 5).map(sid => sub(sid, LAB, at));
  if (!labOnly) [IDS[0], IDS[1], IDS[5]].forEach(sid => subs.push(sub(sid, TALK, at)));
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [
      { id: LAB, students_send: 'photos' },
      { id: TALK, students_send: labOnly ? 'nothing' : 'photos' },
    ],
    submissions: subs,
  });
  Grader.setLevel(CID, IDS[3], LAB, Q, 3, 0);
  Grader.setLevel(CID, IDS[4], LAB, Q, 2, 0);
  Grader.returnGrades(CID, LAB, [IDS[4]]);
}

function cell() {
  const html = DashOverview.glanceHtml({ cid: CID, allStudents: getStudents(CID), classAvg: 0, missing: [] });
  const { document: d } = parseHTML('<div id="x">' + html + '</div>');
  const el = d.querySelector('.dash-glance-tograde');
  if (!el) return null;
  return {
    n: parseInt(el.querySelector('.dash-glance-value').textContent, 10),
    line: el.querySelector('.dash-glance-sub').textContent.replace(/\s+/g, ' ').trim(),
    href: el.getAttribute('data-href'),
  };
}

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
});
afterEach(() => {
  closePages();
  try {
    unmount();
  } catch (e) {
    /* not mounted */
  }
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('the same numbers on every screen', () => {
  it('dashboard, gradebook, Assignments and the grader agree; a group counts once', () => {
    seed();
    // Lab: 3 students. Talk: the group (0, 1) once, and 5 alone: 2.
    expect(GraderWork.workCounts(CID, LAB).tograde).toBe(3);
    expect(GraderWork.workCounts(CID, TALK).tograde).toBe(2);
    const total = GraderWork.classWorkCounts(CID).tograde;
    expect(total).toBe(5);

    expect(cell().n).toBe(total);

    mount(() => seed(), { course: CID });
    const pill = document.querySelector('.gb-to-grade-btn');
    expect(parseInt(pill.textContent, 10)).toBe(total);
    // The filter leaves the students and columns with work waiting.
    click(pill);
    const cols = Array.from(document.querySelectorAll('.gb-scores-cell')).map(td => td.getAttribute('data-aid'));
    expect([...new Set(cols)].sort()).toEqual([LAB, TALK].sort());
    expect(document.querySelectorAll('.gb-scores-cell .gb-to-grade').length).toBe(3 + 3);
    unmount();

    openAssignments(() => seed(), CID);
    expect(parseInt(document.querySelector('.assess-tograde-n').textContent, 10)).toBe(total);
    const chips = Array.from(document.querySelectorAll('.assess-to-grade')).map(el => parseInt(el.textContent, 10));
    expect(chips.reduce((a, b) => a + b, 0)).toBe(total);
    closePages();

    const overlay = openGrader(() => seed(), CID, TALK, IDS[0]);
    expect(overlay.querySelector('.grader-show [data-show="tograde"] .grader-show-n').textContent).toBe('2');
  });

  it('a grade moves every screen by one', () => {
    seed();
    Grader.setLevel(CID, IDS[0], LAB, Q, 3, 0);
    expect(cell().n).toBe(4);
    mount(() => (seed(), Grader.setLevel(CID, IDS[0], LAB, Q, 3, 0)), { course: CID });
    expect(parseInt(document.querySelector('.gb-to-grade-btn').textContent, 10)).toBe(4);
  });
});

describe('the gradebook’s cells', () => {
  it('To Grade, the camera, and a hover line saying what came in', () => {
    seed({ labOnly: true });
    mount(() => seed({ labOnly: true }), { course: CID });
    const td = document.querySelector('.gb-scores-cell[data-sid="' + IDS[0] + '"][data-aid="' + LAB + '"]');
    expect(td.querySelector('.gb-to-grade').textContent).toBe('To Grade');
    expect(td.querySelector('.gb-work-camera')).not.toBeNull();
    expect(td.getAttribute('aria-label')).toMatch(/, sent, not graded, has photos$/);
    expect(td.getAttribute('title')).toMatch(/^Sent [A-Z][a-z]{2} \d{1,2} · 1 photo\. Click to open in the grader\.$/);
    // A returned piece with photos keeps its level and shows the camera.
    const done = document.querySelector('.gb-scores-cell[data-sid="' + IDS[4] + '"][data-aid="' + LAB + '"]');
    expect(done.querySelector('.gb-to-grade')).toBeNull();
    expect(done.querySelector('.gb-work-camera')).not.toBeNull();
    expect(document.querySelector('.gb-key').textContent).toContain('Sent, not graded');
  });

  it('with Send Work off the gradebook is as it was', () => {
    seed({ sendWork: false });
    mount(() => seed({ sendWork: false }), { course: CID });
    expect(document.querySelector('.gb-to-grade-btn')).toBeNull();
    expect(document.querySelector('.gb-to-grade')).toBeNull();
    expect(document.querySelector('.gb-work-camera')).toBeNull();
  });
});

describe('the dashboard’s To Grade cell, each state on its board', () => {
  it('Send Work off: no cell, the row as it was', () => {
    seed({ sendWork: false });
    expect(cell()).toBeNull();
    expect(
      DashOverview.glanceHtml({ cid: CID, allStudents: getStudents(CID), classAvg: 0, missing: [] }),
    ).not.toContain('grid-template-columns');
  });

  it('a normal day: N, and "N Not Returned"; it opens Assignments on To Grade', () => {
    seed({ labOnly: true });
    expect(cell()).toEqual({ n: 3, line: '1 Not Returned', href: '/assignments?course=' + CID + '&show=tograde' });
  });

  it('work sitting over a week: the oldest age', () => {
    const old = new Date(Date.parse(courseToday(CID)) - 11 * 86400000).toISOString();
    seed({ labOnly: true, sentAt: old });
    expect(cell().line).toBe('1 Not Returned · Oldest 11 Days');
  });

  it('all caught up: the grades returned this week', () => {
    seed({ labOnly: true });
    [IDS[0], IDS[1], IDS[2]].forEach(sid => Grader.setLevel(CID, sid, LAB, Q, 3, 0));
    Grader.returnGrades(CID, LAB, IDS.slice(0, 4));
    expect(cell()).toMatchObject({ n: 0, line: 'All Caught Up · 5 Returned This Week' });
  });

  it('graded, nothing returned: 0 to grade, N Not Returned', () => {
    seed({ labOnly: true });
    [IDS[0], IDS[1], IDS[2]].forEach(sid => Grader.setLevel(CID, sid, LAB, Q, 3, 0));
    expect(cell()).toMatchObject({ n: 0, line: '4 Not Returned' });
  });

  it('group work: a group counts once, and the line says Groups', () => {
    seed();
    // Only the group waits: grade the Lab's three and the lone Talk sender.
    [IDS[0], IDS[1], IDS[2]].forEach(sid => Grader.setLevel(CID, sid, LAB, Q, 3, 0));
    Grader.returnGrades(CID, LAB, IDS.slice(0, 4));
    Grader.setLevel(CID, IDS[5], TALK, Q, 3, 0);
    Grader.returnGrades(CID, TALK, [IDS[5]]);
    expect(cell()).toMatchObject({ n: 1, line: '1 Group · 0 Not Returned' });
  });
});

describe('the Assignments page', () => {
  it('To Grade leaves the pieces with work waiting; Grade Submissions opens the grader on them', () => {
    seed();
    openAssignments(() => seed(), CID, { show: 'tograde' });
    const titles = Array.from(document.querySelectorAll('.assess-card')).map(c => c.id);
    expect(titles.sort()).toEqual(['ac-' + LAB, 'ac-' + TALK].sort());
    click(document.querySelector('.assess-grade-work-btn[data-aid="' + LAB + '"]'));
    const overlay = document.getElementById('grader-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.querySelector('.grader-show [data-show="tograde"]').getAttribute('aria-pressed')).toBe('true');
    expect(overlay.querySelector('.grader-student').textContent).toBe('S0 L0');
    // Done: the page is back, and still answers a click.
    click(overlay.querySelector('[data-grader="close"]'));
    expect(document.getElementById('grader-overlay')).toBeNull();
    click(document.querySelector('.assess-tograde-seg [data-show="all"]'));
    expect(document.querySelectorAll('.assess-card').length).toBe(3);
  });

  it('Work Wall on a piece that takes work or has work in opens the wall for it; none with nothing in', () => {
    const opened = vi.spyOn(WorkWall, 'open').mockImplementation(() => {});
    openAssignments(() => seed(), CID, {});
    const btn = document.querySelector('.assess-work-wall-btn[data-aid="' + LAB + '"]');
    expect(btn.textContent).toBe('Work Wall');
    click(btn);
    expect(opened).toHaveBeenCalledWith(CID, LAB);
    opened.mockRestore();
    closePages();
    // Send Work off: the pieces with work in keep the wall.
    openAssignments(() => seed({ sendWork: false }), CID, {});
    expect(document.querySelector('.assess-work-wall-btn[data-aid="' + LAB + '"]') === null).toBe(false);
    closePages();
    openAssignments(
      () => {
        seed({ sendWork: false });
        const work = getCourseSubmissions(CID);
        work.submissions = [];
        saveDemoStudentWork(CID, work);
      },
      CID,
      {},
    );
    expect(document.querySelector('.assess-work-wall-btn') === null).toBe(true);
  });
});
