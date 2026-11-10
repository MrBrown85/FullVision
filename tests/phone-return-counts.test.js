/**
 * The phone's To Return numbers and words are the gradebook's (S1-F3,
 * docs/plans/student-page-build-plan.md S1: "counts agree across gradebook,
 * grader and phone for the same class").
 *
 * One class with drafts is drawn twice: by the real gradebook
 * (teacher/page-gradebook.js, on tests/helpers/gradebook-dom.js) and by the
 * phone's Grade tab (teacher-mobile/tab-grade.js). With everyone on screen:
 * - the gradebook's "N to return" is the phone's To Return count, and both
 *   are GradeState.draftsWaiting, Class Settings' count;
 * - each Competencies header's Return N Graded is that row's Return N on the
 *   phone, and its line of names is the phone's;
 * - the gradebook's question and the phone's say the same three things;
 * - the phone's grading screen shows the Draft mark on exactly the cards the
 *   gradebook dashes;
 * - a Return N on the phone moves the gradebook's numbers by the same N.
 * The phone keeps its own copy of the gradebook's line of names
 * (MGrade.draftsSentence); this is what holds the two together.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { mount, unmount, showCompetencies, click } from './helpers/gradebook-dom.js';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const DEV = U(14);
const ELI = U(15);
const FERN = U(16);
const ESSAY = U(31); // levels on two competencies
const QUIZ = U(32); // points, out of 10
const EXIT = U(34); // Complete/Incomplete
const TALK = U(37); // pair work: Ava and Ben are graded together
const BENCH = U(38); // a DIBELS benchmark
const QUESTION = U(41);
const PLAN = U(42);
const EVERYONE = [AVA, BEN, CARA, DEV, ELI, FERN];
const WORK = [ESSAY, QUIZ, EXIT, TALK, BENCH];
const HELD = { student_page_enabled: true, return_grades: 'on_return' };

function seed() {
  seedClass(CID, {
    students: [
      { id: AVA, firstName: 'Ava', lastName: 'Adams' },
      { id: BEN, firstName: 'Ben', lastName: 'Brown' },
      { id: CARA, firstName: 'Cara', lastName: 'Chen' },
      { id: DEV, firstName: 'Dev', lastName: 'Dhillon' },
      { id: ELI, firstName: 'Eli', lastName: 'Evans' },
      { id: FERN, firstName: 'Fern', lastName: 'Fox' },
    ],
    learningMaps: {
      subjects: [],
      sections: [
        { id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] },
        { id: U(52), name: 'Plan', tags: [{ id: PLAN, label: 'Plan', text: 'Plan a test' }] },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      { id: ESSAY, title: 'Essay', tagIds: [QUESTION, PLAN], date: '2026-10-10', type: 'summative' },
      { id: QUIZ, title: 'Quiz', scoreMode: 'points', maxPoints: 10, tagIds: [QUESTION], date: '2026-10-11' },
      { id: EXIT, title: 'Exit Ticket', scoreMode: 'complete', maxPoints: 1, tagIds: [QUESTION], date: '2026-10-13' },
      {
        id: TALK,
        title: 'Pair Talk',
        tagIds: [QUESTION],
        date: '2026-10-16',
        type: 'summative',
        collaboration: 'pair',
        pairs: [[AVA, BEN]],
      },
      { id: BENCH, title: 'Reading Benchmark', scoreMode: 'dibels', tagIds: [], date: '2026-10-17' },
    ],
    statuses: { [FERN + ':' + ESSAY]: 'NS', [FERN + ':' + QUIZ]: 'EXC', [ELI + ':' + QUIZ]: 'LATE' },
    courseConfigs: HELD,
  });
  // Drafts: five on the Essay (past three names), one on the Quiz, two on
  // the Exit Ticket, the pair's two, and a benchmark, which has no state.
  [AVA, BEN, CARA, DEV, ELI].forEach((sid, i) => Grader.setLevel(CID, sid, ESSAY, QUESTION, 1 + (i % 4), 0));
  Grader.setPoints(CID, ELI, QUIZ, 7);
  Grader.setMark(CID, CARA, EXIT, 'complete');
  Grader.setMark(CID, DEV, EXIT, 'incomplete');
  Grader.setLevel(CID, AVA, TALK, QUESTION, 3, 0);
  Grader.setDibels(CID, AVA, BENCH, 'boy', { orfWrc: 90 });
}

/* ── The gradebook, as tests/gradebook-draft-cells.test.js reads it ──── */
function gradebook() {
  mount(() => {}, { course: CID });
  showCompetencies();
  const pill = document.querySelector('.gb-to-return');
  const out = { pill: pill ? parseInt(pill.textContent, 10) : 0, columns: {}, dashed: {} };
  WORK.forEach(aid => {
    const button = Array.from(document.querySelectorAll('.gb-return-drafts')).find(
      b => b.getAttribute('data-aid') === aid,
    );
    if (button) {
      click(button);
      const dialog = document.querySelector('.confirm-overlay');
      out.columns[aid] = {
        n: parseInt(button.textContent.replace('Return ', ''), 10),
        button: button.textContent,
        line: button.getAttribute('title'),
        asks: {
          title: dialog.querySelector('.confirm-title').textContent,
          message: dialog.querySelector('.confirm-message').textContent,
          ok: document.getElementById('confirm-ok-btn').textContent,
          cancel: document.getElementById('confirm-cancel-btn').textContent,
        },
      };
      document.getElementById('confirm-cancel-btn').onclick();
    }
    // The students whose cells in the column are dashed.
    out.dashed[aid] = EVERYONE.filter(sid =>
      Array.from(
        document.querySelectorAll('#gb-data td.gb-score[data-aid="' + aid + '"][data-sid="' + sid + '"]'),
      ).some(td => td.classList.contains('gb-draft')),
    );
  });
  unmount();
  return out;
}

/* ── The phone ──────────────────────────────────────────────────────── */
let stubDocument = null;
function page() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.focus = function () {};
  globalThis.document = dom.document;
}
const stack = () => document.getElementById('m-nav-stack');
const text = el => el.textContent.replace(/\s+/g, ' ').trim();

function phone() {
  page();
  // html-safe: MGrade.renderPicker escapes names and text; a test page
  stack().innerHTML = MGrade.renderPicker(CID);
  MGrade.filterAssessments(CID, 'toreturn');
  const count = document.querySelector('.m-seg-btn[data-val="toreturn"] .m-seg-count');
  const out = { segment: count ? parseInt(count.textContent, 10) : 0, rows: {}, drafts: {} };
  Array.from(document.querySelectorAll('#m-grade-to-return .m-to-return-row')).forEach(row => {
    const aid = row.getAttribute('data-aid');
    const button = row.querySelector('[data-action="m-grade-return-all"]');
    MGrade.askReturnAll(CID, aid, button);
    const sheet = document.querySelector('#m-sheet-container .m-confirm-sheet');
    out.rows[aid] = {
      n: parseInt(text(button).replace('Return ', ''), 10),
      // What a screen reader hears for the button, less the work's name.
      button: button.getAttribute('aria-label').split(',')[0],
      mark: text(row.querySelector('.m-draft-mark')),
      names: text(row.querySelector('.m-to-return-names')),
      asks: {
        title: text(sheet.querySelector('#m-confirm-title')),
        message: text(sheet.querySelector('#m-confirm-text')),
        ok: text(sheet.querySelector('.m-confirm-ok')),
        cancel: text(sheet.querySelector('[data-action="m-sheet-cancel"]')),
      },
    };
    // The next question takes the sheet's place; nothing here waits for
    // this one to slide away.
  });
  // The grading screen: who the Draft mark is shown for, card by card.
  WORK.forEach(aid => {
    // html-safe: MGrade.renderSwiper escapes names and text; a test page
    stack().innerHTML = MGrade.renderSwiper(CID, aid);
    MGrade.setupSwiper(CID, aid);
    const cards = Array.from(document.querySelectorAll('.m-swiper-card'));
    out.drafts[aid] = [];
    cards.forEach((card, i) => {
      MGrade.jumpToStudent(i, true);
      if (!document.querySelector('#m-grade-return .m-draft-mark')) return;
      // A pair's card stands for both partners.
      const members = Array.from(card.querySelectorAll('.m-group-pill[data-val="NS"]')).map(p =>
        p.getAttribute('data-sid'),
      );
      (members.length ? members : [card.getAttribute('data-sid')]).forEach(sid => out.drafts[aid].push(sid));
    });
    out.drafts[aid].sort();
  });
  return out;
}

beforeEach(() => {
  stubDocument = globalThis.document;
  // The clock only: the gradebook's own timers are left to run as they do.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
  localStorage.clear();
  seed();
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
});

describe('the phone’s To Return and the gradebook agree', () => {
  it('on the count, on each assessment’s N and names, and on the question', () => {
    const desk = gradebook();
    const hand = phone();

    // The class's count, three ways.
    expect(desk.pill).toBe(10);
    expect(hand.segment).toBe(desk.pill);
    expect(GradeState.draftsWaiting(CID)).toBe(desk.pill);

    // The same assessments have something to return; a benchmark never does.
    expect(Object.keys(hand.rows).sort()).toEqual(Object.keys(desk.columns).sort());
    expect(Object.keys(hand.rows).sort()).toEqual([ESSAY, QUIZ, EXIT, TALK].sort());

    Object.keys(desk.columns).forEach(aid => {
      const column = desk.columns[aid];
      const row = hand.rows[aid];
      expect(row.n, aid).toBe(column.n);
      expect(row.n, aid).toBe(GradeState.draftsIn(CID, aid, EVERYONE).length);
      // "Return 3 Graded" is what the desktop's button says and what the
      // phone's "Return 3" is called.
      expect(row.button, aid).toBe(column.button);
      // "3 drafts", then the line of names.
      expect(column.line.indexOf(row.mark + ': '), aid).toBe(0);
      // The question: title, who, the action, Cancel.
      expect(row.asks, aid).toEqual(column.asks);
      expect(row.asks.message, aid).toBe(column.line);
    });
    // Past three names the line counts the rest; the row lists them all.
    expect(desk.columns[ESSAY].line).toBe('5 drafts: Ava, Ben, Cara and 2 others can’t see them yet.');
    expect(hand.rows[ESSAY].names).toBe('Ava, Ben, Cara, Dev, Eli');
    expect(hand.rows[QUIZ].asks).toEqual({
      title: 'Return 1 Grade Now?',
      message: '1 draft: Eli can’t see it yet.',
      ok: 'Return 1 Graded',
      cancel: 'Cancel',
    });
  });

  it('on which grades are drafts: the Draft mark on the phone is the dashed cell on the desktop', () => {
    const desk = gradebook();
    const hand = phone();
    WORK.forEach(aid => {
      expect(hand.drafts[aid], aid).toEqual(desk.dashed[aid].slice().sort());
      expect(hand.drafts[aid], aid).toEqual(GradeState.draftsIn(CID, aid, EVERYONE).sort());
    });
    expect(hand.drafts[TALK]).toEqual([AVA, BEN]);
    expect(hand.drafts[BENCH]).toEqual([]);
  });

  it('after a Return N on the phone, by the same N', () => {
    const before = gradebook();
    page();
    // html-safe: MGrade.renderPicker escapes names and text; a test page
    stack().innerHTML = MGrade.renderPicker(CID);
    MGrade.filterAssessments(CID, 'toreturn');
    MGrade.askReturnAll(CID, ESSAY, null);
    document.querySelector('#m-sheet-container .m-confirm-ok').onclick();
    const count = document.querySelector('.m-seg-btn[data-val="toreturn"] .m-seg-count');
    expect(parseInt(count.textContent, 10)).toBe(before.pill - before.columns[ESSAY].n);

    const after = gradebook();
    expect(after.pill).toBe(before.pill - before.columns[ESSAY].n);
    expect(after.columns[ESSAY]).toBeUndefined();
    expect(after.dashed[ESSAY]).toEqual([]);
    expect(after.columns[QUIZ]).toEqual(before.columns[QUIZ]);
    expect(GradeState.draftsWaiting(CID)).toBe(after.pill);
  });
});
