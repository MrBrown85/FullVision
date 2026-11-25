/**
 * The Show bar on the Assignments page (teacher/assign-show.js; Colin,
 * Nov 16): Submitted, To Grade and Not In each list only the assessments
 * they count, and inside each card only the students they count. They only
 * filter (Colin, Nov 17): "shouldn't open or close tabs or assignment tabs,
 * just filter out and in what's available". Every card keeps the open or
 * closed the teacher gave it, through every change and back to All. A
 * second click lets go and puts back the scroll.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass, click, openAssignments, closePages } from './helpers/pin-save-paths.js';

const CID = U(1);
const LAB = U(31); // Students Send Photos: 0-4 sent (3 graded, 4 returned)
const TALK = U(32); // group work, one per group: 0-2 are a group; 0 and 5 sent
const QUIZ = U(33); // takes no work, nothing in
const Q = U(41);
const UNIT = U(61);
const IDS = Array.from({ length: 8 }, (_, i) => U(100 + i));
let wasDemo;
let wasStyle;

function sub(sid, aid) {
  const at = courseToday(CID) + 'T09:00:00Z';
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
      { id: 'f' + sid.slice(-3) + aid.slice(-2), page: 1, path: 'p.jpg', thumb_path: 'p-t.jpg', sha256: sid + aid },
    ],
  };
}

function seed({ sendWork = true, unit = false } = {}) {
  seedClass(CID, {
    students: IDS.map((id, i) => ({ id, firstName: 'S' + i, lastName: 'L' + i })),
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    modules: unit ? [{ id: UNIT, name: 'Unit 1', color: '#6366f1' }] : [],
    assessments: [
      { id: LAB, title: 'Lab', tagIds: [Q], date: '2026-10-20', moduleId: unit ? UNIT : undefined },
      { id: TALK, title: 'Talk', tagIds: [Q], date: '2026-10-21', collaboration: 'group', groups: [IDS.slice(0, 3)] },
      { id: QUIZ, title: 'Quiz', tagIds: [Q], date: '2026-10-22' },
    ],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [
      { id: LAB, students_send: 'photos' },
      { id: TALK, students_send: 'photos', group_work: 'group' },
    ],
    submissions: [...IDS.slice(0, 5).map(sid => sub(sid, LAB)), sub(IDS[0], TALK), sub(IDS[5], TALK)],
  });
  Grader.setLevel(CID, IDS[3], LAB, Q, 3, 0);
  Grader.setLevel(CID, IDS[4], LAB, Q, 2, 0);
  Grader.returnGrades(CID, LAB, [IDS[4]]);
}

const bar = show => document.querySelector('.atb-show [data-show="' + show + '"]');
const options = () => Array.from(document.querySelectorAll('.atb-show .seg-btn')).map(b => b.dataset.show);
const badge = show => bar(show).querySelector('.atb-badge');
const pressed = () =>
  Array.from(document.querySelectorAll('.atb-show .seg-btn'))
    .filter(b => b.getAttribute('aria-pressed') === 'true')
    .map(b => b.dataset.show);
const cards = () => Array.from(document.querySelectorAll('#main .assess-card')).map(c => c.id.slice(3));
const openCards = () => cards().filter(aid => document.getElementById('ac-' + aid).querySelector('.assess-body *'));
const studentsOn = aid =>
  Array.from(new Set(Array.from(document.querySelectorAll('#ac-' + aid + ' [data-sid]')).map(el => el.dataset.sid)));
const main = () => document.getElementById('main');
// Opens a closed card by its header, as the teacher does.
const openCard = aid => {
  if (!openCards().includes(aid)) click(document.querySelector('#ac-' + aid + ' .assess-header'));
};

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  wasStyle = globalThis.getComputedStyle;
  localStorage.clear();
});
afterEach(() => {
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  globalThis.getComputedStyle = wasStyle;
});

describe('GraderWork.workInIds', () => {
  it("lists the students whose work is in, graded or not, and a group-mate's work counts", () => {
    seed();
    expect(GraderWork.workInIds(CID, LAB, IDS)).toEqual(IDS.slice(0, 5));
    expect(GraderWork.workInIds(CID, TALK, IDS)).toEqual([IDS[0], IDS[1], IDS[2], IDS[5]]);
    expect(GraderWork.workInIds(CID, QUIZ, IDS)).toEqual([]);
    // A group member labelled Missing is left out, as To Grade leaves them.
    setAssignmentStatus(CID, IDS[2], TALK, 'NS');
    expect(GraderWork.workInIds(CID, TALK, IDS)).toEqual([IDS[0], IDS[1], IDS[5]]);
  });
});

describe('Show: Submitted', () => {
  it('lists only the work sent in, and a card opened shows only the students who sent it', () => {
    openAssignments(() => seed(), CID, {});
    expect(pressed()).toEqual(['all']);
    // Submitted and Not In carry no number; To Grade and To Return carry theirs.
    expect(bar('submitted').textContent).toBe('Submitted');
    expect(badge('submitted')).toBeNull();
    click(bar('submitted'));
    expect(pressed()).toEqual(['submitted']);
    expect(cards().sort()).toEqual([LAB, TALK].sort());
    // It opens nothing: the teacher opens the card they want.
    expect(openCards()).toEqual([]);
    openCard(LAB);
    openCard(TALK);
    expect(studentsOn(LAB).sort()).toEqual(IDS.slice(0, 5).sort());
    expect(studentsOn(TALK).sort()).toEqual([IDS[0], IDS[1], IDS[2], IDS[5]].sort());
  });

  it('cards keep what the teacher gave them, through Submitted and back, and the scroll comes back', () => {
    openAssignments(() => seed(), CID, {});
    globalThis.getComputedStyle = () => ({ overflowY: 'auto' });
    openCard(QUIZ);
    openCard(TALK);
    expect(openCards().sort()).toEqual([QUIZ, TALK].sort());
    main().scrollTop = 420;
    click(bar('submitted'));
    expect(main().scrollTop).toBe(0);
    // Talk stays open and Lab stays closed; the teacher opens Lab and closes Talk.
    expect(openCards()).toEqual([TALK]);
    openCard(LAB);
    click(document.querySelector('#ac-' + TALK + ' .assess-header'));
    expect(openCards()).toEqual([LAB]);
    click(bar('submitted'));
    expect(pressed()).toEqual(['all']);
    expect(cards().length).toBe(3);
    expect(openCards().sort()).toEqual([LAB, QUIZ].sort());
    expect(main().scrollTop).toBe(420);
    expect(studentsOn(QUIZ).length).toBe(IDS.length);
    expect(studentsOn(LAB).length).toBe(IDS.length);
  });

  it('one to another opens and closes nothing; the pressed one clicked again is All', () => {
    openAssignments(() => seed(), CID, {});
    openCard(QUIZ);
    click(bar('submitted'));
    expect(openCards()).toEqual([]);
    click(bar('tograde'));
    expect(pressed()).toEqual(['tograde']);
    click(bar('notin'));
    expect(pressed()).toEqual(['notin']);
    click(bar('notin'));
    expect(pressed()).toEqual(['all']);
    expect(cards().length).toBe(3);
    expect(openCards()).toEqual([QUIZ]);
    click(bar('tograde'));
    click(bar('all'));
    expect(pressed()).toEqual(['all']);
    expect(openCards()).toEqual([QUIZ]);
  });

  it('a folder keeps the open or closed the teacher gave it, and opens and closes while it is on', () => {
    openAssignments(() => seed({ unit: true }), CID, {});
    const folder = () => document.querySelector('.mod-folder[data-module-id="' + UNIT + '"]');
    const header = () => document.querySelector('.mod-folder-header[data-uid="' + UNIT + '"]');
    click(header());
    expect(folder().classList.contains('open')).toBe(false);
    click(bar('submitted'));
    expect(folder().classList.contains('open')).toBe(false);
    click(header());
    expect(folder().classList.contains('open')).toBe(true);
    click(bar('notin'));
    expect(folder().classList.contains('open')).toBe(true);
    click(bar('notin'));
    expect(folder().classList.contains('open')).toBe(true);
  });

  it('with Send Work off the bar holds All and To Return, and nothing else', () => {
    openAssignments(() => seed({ sendWork: false }), CID, {});
    expect(options()).toEqual(['all', 'toreturn']);
  });

  it('with Send Work off and nothing to return there is no bar', () => {
    openAssignments(
      () => {
        seed({ sendWork: false });
        Grader.returnGrades(CID, LAB, [IDS[3]]);
      },
      CID,
      {},
    );
    expect(document.querySelector('.atb-show')).toBeNull();
  });
});

describe('Show: To Grade', () => {
  it('lists the work waiting, and a card opened shows only the students it is from; a group counts once', () => {
    openAssignments(() => seed(), CID, {});
    // Lab: 0-2 wait (3 is a draft, 4 returned). Talk: the group (0-2) once, and 5.
    expect(badge('tograde').textContent).toBe('5');
    click(bar('tograde'));
    expect(cards().sort()).toEqual([LAB, TALK].sort());
    expect(openCards()).toEqual([]);
    openCard(LAB);
    openCard(TALK);
    expect(studentsOn(LAB).sort()).toEqual(IDS.slice(0, 3).sort());
    expect(studentsOn(TALK).sort()).toEqual([IDS[0], IDS[1], IDS[2], IDS[5]].sort());
  });

  it("the dashboard's To Grade cell opens the page with it on, and a click lets it go", () => {
    openAssignments(() => seed(), CID, { show: 'tograde' });
    expect(pressed()).toEqual(['tograde']);
    expect(cards().sort()).toEqual([LAB, TALK].sort());
    expect(openCards()).toEqual([]);
    click(bar('tograde'));
    expect(pressed()).toEqual(['all']);
    expect(cards().length).toBe(3);
    expect(openCards()).toEqual([]);
  });
});

describe('Show: Not In', () => {
  it('lists the pieces that take work, and a card opened shows only the students who sent nothing', () => {
    openAssignments(() => seed(), CID, {});
    // Lab: 5-7. Talk: 3, 4, 6, 7 (the group is in through 0's work, 5 sent). Quiz takes none.
    expect(bar('notin').textContent).toBe('Not In');
    expect(badge('notin')).toBeNull();
    click(bar('notin'));
    expect(cards().sort()).toEqual([LAB, TALK].sort());
    expect(openCards()).toEqual([]);
    openCard(LAB);
    openCard(TALK);
    expect(studentsOn(LAB).sort()).toEqual(IDS.slice(5).sort());
    expect(studentsOn(TALK).sort()).toEqual([IDS[3], IDS[4], IDS[6], IDS[7]].sort());
  });

  it('an Excused student is left out', () => {
    openAssignments(
      () => {
        seed();
        setAssignmentStatus(CID, IDS[7], LAB, 'EXC');
      },
      CID,
      {},
    );
    click(bar('notin'));
    openCard(LAB);
    expect(studentsOn(LAB).sort()).toEqual([IDS[5], IDS[6]].sort());
  });
});

describe('Show: To Return', () => {
  it('is an option of the bar, between To Grade and Not In, with its drafts as an amber badge', () => {
    openAssignments(() => seed(), CID, {});
    expect(options()).toEqual(['all', 'submitted', 'tograde', 'toreturn', 'notin']);
    // Lab's one draft: IDS[3]'s grade, not yet returned.
    expect(badge('toreturn').textContent).toBe('1');
    expect(badge('toreturn').classList.contains('atb-badge-amber')).toBe(true);
    expect(document.querySelector('.assess-to-return-btn, .assess-to-return-slot')).toBeNull();
    // Each card knows what it would stay for (point to preview).
    const has = aid => (document.getElementById('ac-' + aid).dataset.has || '').split(' ').filter(Boolean);
    expect(has(LAB).sort()).toEqual(['notin', 'submitted', 'tograde', 'toreturn']);
    expect(has(TALK).sort()).toEqual(['notin', 'submitted', 'tograde']);
    expect(has(QUIZ)).toEqual([]);
  });

  it('lists only the assessments with a draft, shows pressed with All let go, and a second click is All', () => {
    openAssignments(() => seed(), CID, {});
    click(bar('toreturn'));
    expect(pressed()).toEqual(['toreturn']);
    expect(cards()).toEqual([LAB]);
    click(bar('toreturn'));
    expect(pressed()).toEqual(['all']);
    expect(cards().length).toBe(3);
  });

  it('is not combined with another option: choosing one lets the other go, and All clears both', () => {
    openAssignments(() => seed(), CID, {});
    click(bar('toreturn'));
    click(bar('submitted'));
    expect(pressed()).toEqual(['submitted']);
    expect(cards().sort()).toEqual([LAB, TALK].sort());
    click(bar('toreturn'));
    expect(pressed()).toEqual(['toreturn']);
    expect(cards()).toEqual([LAB]);
    click(bar('tograde'));
    expect(pressed()).toEqual(['tograde']);
    click(bar('toreturn'));
    click(bar('all'));
    expect(pressed()).toEqual(['all']);
    expect(cards().length).toBe(3);
  });

  it('goes with the last draft: returned, the option leaves and the list is whole again', () => {
    openAssignments(() => seed(), CID, {});
    click(bar('toreturn'));
    expect(cards()).toEqual([LAB]);
    click(document.querySelector('[data-action="returnDrafts"][data-aid="' + LAB + '"]'));
    const ok = document.querySelector('.confirm-overlay .confirm-ok');
    if (ok) click(ok);
    expect(options().includes('toreturn')).toBe(false);
    expect(cards().length).toBe(3);
    expect(pressed()).toEqual(['all']);
  });
});
