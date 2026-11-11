/**
 * The phone's counts of sent work come from the one count (S7 follow-up;
 * docs/plans/student-page-build-plan.md, S6/S7: the dashboard cell, the
 * gradebook filter, the grader and the phone give the same numbers, from
 * GraderWork in shared/grader.js).
 *
 * The fixture: ten students and three pieces.
 * - Lab (Students Send Photos): S0–S2 sent and wait; S3 sent and has a
 *   draft; S4 sent and is returned; S5 sent nothing and was graded from
 *   paper (a draft); S6 is Excused; S7 is Missing; S8 has nothing; S9 sent
 *   nothing and was returned from paper.
 * - Talk (One per Group, a group of S0–S2): S0 and S1 sent for the group;
 *   S5 sent alone.
 * - Quiz takes no work.
 *
 * "Every phone number" pins what the phone shows on that fixture: the Grade
 * tab's rows, its red count and To Grade count, the row menu, the filter
 * sheet's "Showing X of Y", the student card's To Grade list and the speed
 * grader's "1 of N to grade". "The same numbers" holds the phone, the
 * gradebook and the dashboard to GraderWork on the same fixture.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { mount, unmount } from './helpers/gradebook-dom.js';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const LAB = U(31);
const TALK = U(32);
const QUIZ = U(33);
const Q = U(41);
const IDS = Array.from({ length: 10 }, (_, i) => U(100 + i));
let wasDemo;
let stubDocument;

function sub(sid, aid, at) {
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
    files: [
      {
        id: 'f' + sid.slice(-3) + aid.slice(-2),
        page: 1,
        path: 'lab-p1.jpg',
        thumb_path: 'lab-p1-t.jpg',
        sha256: sid + aid,
      },
    ],
  };
}

function seed() {
  const at = courseToday(CID) + 'T09:00:00Z';
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
  subs.push(sub(IDS[0], TALK, at), sub(IDS[1], TALK, at), sub(IDS[5], TALK, at));
  saveDemoStudentWork(CID, {
    course: { send_work: true },
    assessments: [
      { id: LAB, students_send: 'photos' },
      { id: TALK, students_send: 'photos', group_work: 'group' },
    ],
    submissions: subs,
  });
  Grader.setLevel(CID, IDS[3], LAB, Q, 3, 0);
  Grader.setLevel(CID, IDS[4], LAB, Q, 2, 0);
  Grader.setLevel(CID, IDS[5], LAB, Q, 3, 0);
  Grader.setLevel(CID, IDS[9], LAB, Q, 2, 0);
  Grader.returnGrades(CID, LAB, [IDS[4], IDS[9]]);
  Grader.setStatus(CID, IDS[6], LAB, 'EXC');
  Grader.setStatus(CID, IDS[7], LAB, 'NS');
}

/* ── The phone, on a linkedom page with teacher-mobile/index.html's holders ── */

function phonePage() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div>' +
      '<nav><button class="m-tab-item" data-tab="grade">Grade</button></nav></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  globalThis.document = dom.document;
}
const stack = () => document.getElementById('m-nav-stack');
const text = el => (el ? el.textContent : null);

function picker() {
  // html-safe: MGrade.renderPicker escapes names and text; a test page
  stack().innerHTML = MGrade.renderPicker(CID);
  MGrade.filterAssessments(CID);
}

function row(aid) {
  const r = stack().querySelector('.m-tg-row[data-aid="' + aid + '"]');
  return { pill: text(r.querySelector('.m-tg-pill')), notin: text(r.querySelector('.m-tg-notin')) };
}

function menu(aid) {
  MGrade.openRowMenu(CID, aid);
  const titles = [...document.querySelectorAll('#m-sheet-container .m-tg-menu-title')].map(t => t.textContent);
  MComponents.dismissSheet();
  return titles.filter(t => / Waiting$| Not In$/.test(t));
}

function showing() {
  MGrade.openFilterSheet(CID);
  const n = text(document.querySelector('#m-sheet-container .m-live-filter-count'));
  MGrade.doneFilterSheet();
  return n;
}

// "Lab: Grade", "Talk: Add Work" for one student's To Grade list.
function card(i) {
  const st = getStudents(CID).find(s => s.id === IDS[i]);
  const { document: d } = parseHTML('<div>' + MGradePhotos.studentListHtml(CID, st) + '</div>');
  return [...d.querySelectorAll('.m-scard-tograde-row')].map(
    b => text(b.querySelector('.m-scard-return-title')) + ': ' + text(b.querySelector('.m-scard-tograde-act')),
  );
}

function grader(aid) {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  stack().innerHTML = MGrade.renderSwiper(CID, aid, { only: 'tograde' });
  const bar = text(document.querySelector('.m-nav-bar'));
  const m = bar && bar.match(/\d+ of \d+ to grade/);
  return m ? m[0] : null;
}

function phone() {
  phonePage();
  picker();
  MGradePhotos.syncTabBadge(CID);
  const out = {
    badge: text(document.querySelector('.m-tab-badge')),
    segment: text(stack().querySelector('[data-val="tograde"] .m-seg-count')),
    lab: row(LAB),
    talk: row(TALK),
    labMenu: menu(LAB),
    talkMenu: menu(TALK),
    showing: showing(),
    cards: Object.fromEntries([0, 2, 5, 9].map(i => ['S' + i, card(i)])),
    labGrader: grader(LAB),
    talkGrader: grader(TALK),
  };
  return out;
}

/* ── The desktop ── */

function dashboard() {
  const html = DashOverview.glanceHtml({ cid: CID, allStudents: getStudents(CID), classAvg: 0, missing: [] });
  const { document: d } = parseHTML('<div>' + html + '</div>');
  return parseInt(text(d.querySelector('.dash-glance-tograde .dash-glance-value')), 10);
}

function gradebook() {
  mount(() => seed(), { course: CID });
  const n = parseInt(text(document.querySelector('.gb-to-grade-btn')), 10);
  unmount();
  return n;
}

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  stubDocument = globalThis.document;
  localStorage.clear();
  seed();
});
afterEach(() => {
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('every phone number for sent work, on the fixture', () => {
  /* Was, before the phone asked GraderWork: badge and To Grade 6; Lab
     "4 not in"; Talk "3 to grade", "7 not in"; the menus to match; S2's
     list "Lab: Grade, Talk: Add Work", S5's and S9's with "Lab: Add Work".
     The rest is unchanged. */
  it('is what GraderWork says', () => {
    expect(phone()).toEqual({
      badge: '5',
      segment: '5',
      // Lab: S7 (Missing) and S8 are not in; S5 and S9, graded from paper, are not.
      lab: { pill: '3 to grade', notin: '2 not in' },
      // Talk: the group's work (S0 and S1 sent) counts once, and S5's: 2.
      // Not in: S3, S4, S6, S7, S8, S9; S2 is in through the group.
      talk: { pill: '2 to grade', notin: '6 not in' },
      labMenu: ['Grade the 3 Waiting', 'Add Work for the 2 Not In'],
      talkMenu: ['Grade the 2 Waiting', 'Add Work for the 6 Not In'],
      showing: 'Showing 2 of 3',
      cards: {
        S0: ['Talk: Grade', 'Lab: Grade'],
        S2: ['Talk: Grade', 'Lab: Grade'],
        S5: ['Talk: Grade'],
        S9: ['Talk: Add Work'],
      },
      labGrader: '1 of 3 to grade',
      talkGrader: '1 of 2 to grade',
    });
  });
});

describe('the same numbers on the phone, the gradebook and the dashboard', () => {
  it('for the class, and for each piece', () => {
    const p = phone();
    const total = GraderWork.classWorkCounts(CID).tograde;
    expect(total).toBe(5);
    expect(Number(p.badge)).toBe(total);
    expect(Number(p.segment)).toBe(total);
    expect(dashboard()).toBe(total);
    expect(gradebook()).toBe(total);
    [
      [LAB, p.lab, p.labMenu, p.labGrader],
      [TALK, p.talk, p.talkMenu, p.talkGrader],
    ].forEach(([aid, r, m, g]) => {
      const c = GraderWork.workCounts(CID, aid);
      expect(r).toEqual({ pill: c.tograde + ' to grade', notin: c.notin + ' not in' });
      expect(m).toEqual(['Grade the ' + c.tograde + ' Waiting', 'Add Work for the ' + c.notin + ' Not In']);
      expect(g).toBe('1 of ' + c.tograde + ' to grade');
    });
    // A student's To Grade list is their state on each piece.
    IDS.forEach((sid, i) => {
      const want = [];
      [TALK, LAB].forEach(aid => {
        const s = GraderWork.workStateOf(CID, aid, sid);
        const title = aid === LAB ? 'Lab' : 'Talk';
        if (s === 'tograde') want.push(title + ': Grade');
      });
      [TALK, LAB].forEach(aid => {
        const s = GraderWork.workStateOf(CID, aid, sid);
        const title = aid === LAB ? 'Lab' : 'Talk';
        if (s === 'notin') want.push(title + ': Add Work');
      });
      expect(card(i)).toEqual(want);
    });
  });

  it('a grade from paper moves the phone with the rest', () => {
    // S8 had nothing in; graded from paper, they are no longer Not In anywhere.
    Grader.setLevel(CID, IDS[8], LAB, Q, 3, 0);
    expect(GraderWork.workCounts(CID, LAB).notin).toBe(1);
    expect(phone().lab).toEqual({ pill: '3 to grade', notin: '1 not in' });
  });
});
