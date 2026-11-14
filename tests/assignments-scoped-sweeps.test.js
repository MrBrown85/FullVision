/**
 * After a click, a change, a key or leaving a field, the Assignments page
 * brings the Missing | Excused locks and what is waiting to return up to
 * date (S1-F2). It used to do both over the whole page on every event:
 * every status button and every card's chips, marks and buttons, a key
 * typed in a comment included (docs/plans/speed-assessment.md, section 4,
 * item 2). Now it does them for what the event touched: one student's
 * piece of work, one card on pair and group work or for a card's own
 * controls, and the whole page only for an event outside every card (a
 * question's OK, Undo). A key in a text box that is not Enter does neither.
 *
 * Counted, not timed: the status checks (canSetAssignmentStatus) and the
 * draft counts (GradeState.draftsIn) each event leads to.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { U, seedClass, clearClass, click, fire, key, openAssignments, closePages } from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const ESSAY = U(31); // levels on a competency
const LAB = U(33); // levels on a competency
const TALK = U(37); // pair work: Ava and Ben are graded together
const QUIZ = U(32); // points
const QUESTION = U(41);
const EVERYONE = [AVA, BEN, CARA];

const seed = more => {
  seedClass(CID, {
    students: [
      { id: AVA, firstName: 'Ava', lastName: 'Adams' },
      { id: BEN, firstName: 'Ben', lastName: 'Brown' },
      { id: CARA, firstName: 'Cara', lastName: 'Chen' },
    ],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      { id: ESSAY, title: 'Essay', tagIds: [QUESTION], date: '2026-10-10', type: 'summative' },
      { id: LAB, title: 'Lab', tagIds: [QUESTION], date: '2026-10-12', type: 'summative' },
      { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
      {
        id: TALK,
        title: 'Pair Talk',
        tagIds: [QUESTION],
        date: '2026-10-16',
        type: 'summative',
        collaboration: 'pair',
        pairs: [[AVA, BEN]],
      },
      ...(Array.isArray(more) ? more : []),
    ],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
};

const card = aid => document.getElementById('ac-' + aid);
const level = (aid, sid, n) =>
  card(aid).querySelector('.rsg-criterion-row[data-student="' + sid + '"] .rsg-level.l' + n);
const statusButton = (aid, sid, which) =>
  card(aid).querySelector('[data-action="toggleStudentStatus"][data-sid="' + sid + '"][data-status="' + which + '"]');
const mark = (aid, sid) => {
  const el = card(aid).querySelector('.ret-mark[data-ret-sids*="' + sid + '"]');
  return el ? el.textContent.trim() : null;
};
const pill = () => {
  const el = document.querySelector('.assess-to-return-btn');
  return el ? el.textContent.trim() : '';
};
const settled = () => new Promise(r => setTimeout(r, 10));
const allStatusButtons = () => document.querySelectorAll('[data-action="toggleStudentStatus"]').length;

// What each event leads to: status checks, and draft counts over the whole class (a card's chips).
let checks;
let cardCounts;
beforeEach(() => {
  window.isDemoMode = () => true;
  checks = [];
  cardCounts = [];
  const can = globalThis.canSetAssignmentStatus;
  vi.spyOn(globalThis, 'canSetAssignmentStatus').mockImplementation(function (cid, sid, aid) {
    checks.push(aid + ':' + sid);
    return can.apply(this, arguments);
  });
  const draftsIn = GraderWork.draftsIn;
  vi.spyOn(GraderWork, 'draftsIn').mockImplementation(function (cid, aid, ids) {
    if (Array.isArray(ids) && ids.length === EVERYONE.length) cardCounts.push(aid);
    return draftsIn.apply(this, arguments);
  });
});
// The page's own timers run out before it closes: the next test loads a new copy.
afterEach(async () => {
  await settled();
  closePages();
  clearClass(CID);
  localStorage.clear();
  vi.restoreAllMocks();
});

async function openAll() {
  openAssignments(seed, CID, {});
  await settled();
  click(document.querySelector('[data-action="expandAllAssess"]'));
  await settled();
  checks.length = 0;
  cardCounts.length = 0;
}

describe('Assignments: an event brings up to date only what it touched', () => {
  it('a level for one student checks that student’s status buttons and counts that card', async () => {
    await openAll();
    expect(statusButton(ESSAY, BEN, 'NS').disabled).toBe(false);
    click(level(ESSAY, BEN, 3));
    await settled();
    // Missing, Excused and Late for Ben on the Essay; nobody else's.
    expect(new Set(checks)).toEqual(new Set([ESSAY + ':' + BEN]));
    expect(checks.length).toBe(3);
    expect(cardCounts).toEqual([ESSAY]);
    // And what the teacher sees is as before: Missing locked, the Draft mark, the count.
    expect(statusButton(ESSAY, BEN, 'NS').disabled).toBe(true);
    expect(mark(ESSAY, BEN)).toBe('Draft');
    expect(pill()).toBe('1 to return');
  });

  it('the toolbar’s count stays the sum of every card’s, graded one card at a time', async () => {
    await openAll();
    click(level(ESSAY, BEN, 3));
    await settled();
    click(level(LAB, CARA, 2));
    await settled();
    click(level(ESSAY, CARA, 4));
    await settled();
    expect(pill()).toBe('3 to return');
    expect(card(ESSAY).querySelector('.assess-to-return').textContent).toBe('2 to return');
    expect(card(LAB).querySelector('.assess-to-return').textContent).toBe('1 to return');
    // A redraw counts the same.
    window.PageAssignments.render();
    expect(pill()).toBe('3 to return');
  });

  it('pair work: a level for one member brings the whole card up to date', async () => {
    await openAll();
    const row = card(TALK).querySelector('.rsg-criterion-row[data-student]');
    click(row.querySelector('.rsg-level.l3'));
    await settled();
    expect(checks.length).toBeGreaterThan(0);
    expect(checks.every(c => c.startsWith(TALK + ':'))).toBe(true);
    expect(cardCounts).toEqual([TALK]);
  });

  it('a click outside every card (Undo, a question’s OK) brings the whole page up to date', async () => {
    await openAll();
    click(document.getElementById('page-toolbar-mount'));
    await settled();
    expect(checks.length).toBe(allStatusButtons());
    expect(new Set(cardCounts)).toEqual(new Set([ESSAY, LAB, QUIZ, TALK]));
  });

  it('a key typed in a comment brings nothing up to date; Enter and leaving the box do', async () => {
    await openAll();
    const box = card(QUIZ).querySelector('.ldg-pts-input[data-sid="' + CARA + '"]');
    fire(box, 'keyup');
    const comment = card(ESSAY).querySelector('textarea');
    fire(comment, 'keyup');
    await settled();
    expect(checks).toEqual([]);
    expect(cardCounts).toEqual([]);
    // Enter in a points box saves it.
    box.value = '6';
    const enter = new box.ownerDocument.defaultView.Event('keyup', { bubbles: true });
    enter.key = 'Enter';
    box.dispatchEvent(enter);
    await settled();
    expect(checks.every(c => c === QUIZ + ':' + CARA)).toBe(true);
    expect(cardCounts).toEqual([QUIZ]);
    checks.length = 0;
    fire(comment, 'focusout');
    await settled();
    expect(checks.length).toBeGreaterThan(0);
  });

  it('a comment saved off its timer locks that student’s Missing, as the next key used to', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      openAssignments(seed, CID, { open: ESSAY });
      await vi.advanceTimersByTimeAsync(10);
      const box = card(ESSAY).querySelector('.rsg-overall-comment[data-sid="' + CARA + '"]');
      expect(box, 'no Overall Comment for Cara').not.toBe(null);
      box.value = 'Check question 4.';
      fire(box, 'input');
      await vi.advanceTimersByTimeAsync(900);
      expect(statusButton(ESSAY, CARA, 'NS').disabled).toBe(true);
      expect(mark(ESSAY, CARA)).toBe('Draft');
    } finally {
      vi.useRealTimers();
    }
  });
});

/* The review of #1407. A key on the grid writes to the row the arrow keys
   reached (the page's own highlight, not the browser's focus), while the
   key's own event lands on whatever was clicked last: another student's
   level. Each key that writes is held to what a whole redraw draws of
   what an event brings up to date: the toolbar, every card's counts to
   return, every Draft or Returned mark and Return button, and every
   Missing | Excused | Late button. (A card's Missing count follows a card
   click, as before.) */
describe('Assignments: a key brings up to date the row it wrote to', () => {
  // Cara's Essay and Quiz and Ava's Essay are graded and returned.
  const EXIT = U(34); // Complete/Incomplete
  const graded = () => {
    seed([
      { id: EXIT, title: 'Exit Ticket', scoreMode: 'complete', maxPoints: 1, tagIds: [QUESTION], date: '2026-10-13' },
    ]);
    Grader.setMark(CID, CARA, EXIT, 'complete');
    Grader.returnGrades(CID, EXIT, [CARA]);
    Grader.setLevel(CID, CARA, ESSAY, QUESTION, 3, 0);
    Grader.setLevel(CID, AVA, ESSAY, QUESTION, 2, 0);
    Grader.setPoints(CID, CARA, QUIZ, 7);
    Grader.returnGrades(CID, ESSAY, [AVA, CARA]);
    Grader.returnGrades(CID, QUIZ, [CARA]);
    clearProfCache();
  };
  const returned = (aid, sid) => /^Returned/.test(mark(aid, sid) || '');
  const picture = () => {
    const out = [document.getElementById('page-toolbar-mount').innerHTML];
    document
      .querySelectorAll(
        '#main [data-returns-aid], #main [data-ret-aid], #main [data-return-row-aid], #main [data-return-slot-aid]',
      )
      .forEach(el => out.push(el.outerHTML));
    document
      .querySelectorAll('#main [data-action="toggleStudentStatus"]')
      .forEach(b => out.push([b.dataset.aid, b.dataset.sid, b.dataset.status, b.disabled, b.title].join(' ')));
    return out.join('\n');
  };
  function sameAsRedraw() {
    const kept = picture();
    window.PageAssignments.render();
    const drawn = picture().split('\n');
    kept.split('\n').forEach((line, i) => expect(line).toBe(drawn[i]));
    expect(kept.split('\n').length).toBe(drawn.length);
  }
  // A key as a browser sends it: down and up on the element with the focus.
  function press(k) {
    key(document.activeElement, k);
    const up = new document.defaultView.Event('keyup', { bubbles: true, cancelable: true });
    up.key = k;
    document.activeElement.dispatchEvent(up);
  }
  // A click on a level gives it the browser's focus too (it has tabindex="0").
  function clickLevel(aid, sid, n) {
    level(aid, sid, n).focus();
    click(level(aid, sid, n));
  }
  async function openGraded(params) {
    openAssignments(graded, CID, params || {});
    await settled();
    if (!params) click(document.querySelector('[data-action="expandAllAssess"]'));
    await settled();
  }

  it('+ on a returned grade the arrow keys reached: that row says Draft, as a redraw draws it', async () => {
    await openGraded();
    expect(returned(ESSAY, CARA)).toBe(true);
    clickLevel(ESSAY, BEN, 3);
    await settled();
    expect(pill()).toBe('1 to return');
    press('ArrowDown');
    expect(card(ESSAY).querySelector('.kb-focus').dataset.student).toBe(CARA);
    press('+');
    await settled();
    expect(mark(ESSAY, CARA)).toBe('Draft');
    expect(pill()).toBe('2 to return');
    sameAsRedraw();
  });

  it('− the same, and + again puts the returned grade back: Returned', async () => {
    await openGraded();
    clickLevel(ESSAY, BEN, 3);
    await settled();
    press('ArrowDown');
    press('-');
    await settled();
    expect(mark(ESSAY, CARA)).toBe('Draft');
    sameAsRedraw();
    clickLevel(ESSAY, BEN, 3);
    clickLevel(ESSAY, BEN, 3);
    await settled();
    press('ArrowDown');
    press('-');
    await settled();
    expect(returned(ESSAY, CARA)).toBe(true);
    sameAsRedraw();
  });

  it('1 to 4 on the row reached: that row, then the next, as the digit moves down', async () => {
    await openGraded();
    clickLevel(ESSAY, AVA, 4);
    await settled();
    press('ArrowDown');
    press('4');
    await settled();
    expect(mark(ESSAY, BEN)).toBe('Draft');
    expect(statusButton(ESSAY, BEN, 'NS').disabled).toBe(true);
    // The digit moved down to Cara: 2 changes her returned 3.
    expect(card(ESSAY).querySelector('.kb-focus').dataset.student).toBe(CARA);
    press('2');
    await settled();
    expect(mark(ESSAY, CARA)).toBe('Draft');
    expect(pill()).toBe('3 to return');
    sameAsRedraw();
  });

  it.each(['0', 'Backspace', 'Delete'])('%s clears the row reached', async clear => {
    await openGraded();
    clickLevel(ESSAY, AVA, 4);
    await settled();
    press('ArrowDown');
    press('3');
    await settled();
    expect(statusButton(ESSAY, BEN, 'NS').disabled).toBe(true);
    press('ArrowUp');
    expect(card(ESSAY).querySelector('.kb-focus').dataset.student).toBe(BEN);
    press(clear);
    await settled();
    expect(mark(ESSAY, BEN)).toBe('');
    expect(statusButton(ESSAY, BEN, 'NS').disabled).toBe(false);
    expect(pill()).toBe('1 to return');
    sameAsRedraw();
  });

  it('points: Enter saves and moves to the next box; L, E and N set a status from the box', async () => {
    await openGraded();
    const box = sid => card(QUIZ).querySelector('.gb-pts-input[data-sid="' + sid + '"]');
    box(BEN).focus();
    box(BEN).value = '6';
    press('Enter');
    await settled();
    expect(document.activeElement).toBe(box(CARA));
    expect(mark(QUIZ, BEN)).toBe('Draft');
    expect(statusButton(QUIZ, BEN, 'NS') || card(QUIZ).querySelector('.ldg-chip[data-status="NS"]')).not.toBe(null);
    // Cara's returned 7 becomes 9 and Late, from her box.
    box(CARA).value = '9';
    press('l');
    await settled();
    expect(mark(QUIZ, CARA)).toBe('Draft');
    expect(pill()).toBe('2 to return');
    sameAsRedraw();
    // Not Submitted, then Excused, for Ava, who has no score.
    box(AVA).focus();
    press('n');
    await settled();
    expect(getAssignmentStatuses(CID)[AVA + ':' + QUIZ]).toBe('NS');
    sameAsRedraw();
    box(BEN).focus();
    box(BEN).value = '';
    press('e');
    await settled();
    expect(getAssignmentStatuses(CID)[BEN + ':' + QUIZ]).toBe('EXC');
    expect(mark(QUIZ, BEN)).toBe('');
    expect(pill()).toBe('1 to return');
    sameAsRedraw();
  });

  it('Complete/Incomplete: C and I on the row with the focus, and L for Late', async () => {
    await openGraded();
    const row = sid => card(EXIT).querySelector('.ldg-row.ldg-cmp[data-status-student="' + sid + '"]');
    expect(row(BEN), 'no Complete/Incomplete row for Ben').not.toBe(null);
    row(BEN).focus();
    press('c');
    await settled();
    expect(document.activeElement).toBe(row(CARA));
    expect(mark(EXIT, BEN)).toBe('Draft');
    // Cara's returned Complete becomes Incomplete, and Late.
    press('ArrowUp');
    press('ArrowDown');
    press('i');
    await settled();
    expect(mark(EXIT, CARA)).toBe('Draft');
    row(CARA).focus();
    press('l');
    await settled();
    expect(getAssignmentStatuses(CID)[CARA + ':' + EXIT]).toBe('LATE');
    expect(pill()).toBe('2 to return');
    sameAsRedraw();
  });

  it('one student’s cards: 1 to 4, + and − on the card with the focus', async () => {
    await openGraded({ student: CARA });
    const tile = card(ESSAY).querySelector('.grdl-card, .grdt-crit');
    expect(tile, 'no card to focus in one student’s view').not.toBe(null);
    tile.focus();
    press('4');
    await settled();
    sameAsRedraw();
    card(ESSAY).querySelector('.grdl-card, .grdt-crit').focus();
    press('-');
    await settled();
    sameAsRedraw();
  });

  /* The review of #1396, held here too: a level picked in the dialog over
     the Work Wall is written under the page, where no event's scope
     reaches it. The page is drawn again as the wall closes, so the mark,
     the count and the lock are right before anything else is clicked. */
  it('grading through the Work Wall: Draft, the count and the Missing lock are right as the wall closes', async () => {
    const withWork = () => {
      seed();
      saveDemoStudentWork(CID, {
        course: { send_work: true },
        assessments: [ESSAY, LAB, QUIZ, TALK].map(id => ({ id, students_send: 'photos', after_due: 'stop' })),
        submissions: [
          {
            id: 's1',
            assessment_id: ESSAY,
            enrollment_id: BEN,
            version: 1,
            state: 'sent',
            sent_by: 'teacher',
            on_paper: false,
            is_late: false,
            note: null,
            sent_at: '2026-11-13T19:00:00Z',
            created_at: '2026-11-13T19:00:00Z',
            files: [{ id: 'f1', page: 1, path: 'p1.jpg', thumb_path: 'p1-thumb.jpg', added_by: 'teacher' }],
          },
        ],
      });
    };
    openAssignments(withWork, CID, { open: ESSAY });
    await settled();
    expect(mark(ESSAY, BEN)).toBe('');
    // In the app the router says this page is up, so the dialog opens over it (shared/work-wall.js).
    vi.spyOn(Router, 'getCurrentPage').mockReturnValue(window.PageAssignments);
    click(card(ESSAY).querySelector('[data-action="openWorkWall"]'));
    click(document.querySelector('#work-wall-overlay .ww-grade'));
    const dialog = document.getElementById('grader-overlay');
    expect(dialog.querySelector('.grader-student').textContent).toBe('Ben Brown');
    click(dialog.querySelector('.grdl-level[data-level="3"]'));
    click(dialog.querySelector('[data-grader="close"]'));
    click(document.querySelector('#work-wall-overlay [data-ww="close"]'));
    expect(mark(ESSAY, BEN)).toBe('Draft');
    expect(statusButton(ESSAY, BEN, 'NS').disabled).toBe(true);
    expect(pill()).toBe('1 to return');
    await settled();
    sameAsRedraw();
  });
});
