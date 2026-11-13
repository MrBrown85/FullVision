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
import { U, seedClass, clearClass, click, fire, openAssignments, closePages } from './helpers/pin-save-paths.js';

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

const seed = () => {
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
