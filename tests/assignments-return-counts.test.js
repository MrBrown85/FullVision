/**
 * The Assignments page, the gradebook and the phone show the same numbers
 * and the same words for the same class (S1-F2,
 * docs/plans/student-page-build-plan.md S1: "counts agree across gradebook,
 * grader and phone for the same class").
 *
 * One class with drafts is drawn four times: by the real gradebook
 * (teacher/page-gradebook.js), by the phone's Grade tab
 * (teacher-mobile/tab-grade.js), by the Assignments page and by the grader
 * dialog (teacher/page-assignments.js). With everyone on screen:
 * - the Assignments page's "N to return" is the gradebook's and the phone's
 *   To Return count, and all three are GradeState.draftsWaiting, Class
 *   Settings' count;
 * - each card's Return N Graded is that assessment's Return N Graded under
 *   the gradebook's Competencies header and its Return N on the phone, with
 *   the same line of names;
 * - the three questions say the same four things;
 * - the rows the page marks Draft are the cells the gradebook dashes and
 *   the cards the phone marks;
 * - the dialog's To Return count and its Return N Graded are the same N;
 * - a Return N Graded on the page moves the other screens by the same N.
 * tests/phone-return-counts.test.js holds the gradebook and the phone
 * together; its two readers are repeated here so this file stands alone.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { mount, unmount, showCompetencies } from './helpers/gradebook-dom.js';
import { U, seedClass, clearClass, click, openAssignments, openGrader, closePages } from './helpers/pin-save-paths.js';

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

const text = el => el.textContent.replace(/\s+/g, ' ').trim();
// The desktop's confirm dialog (teacher/ui.js showConfirm), read and cancelled.
function readConfirm() {
  const dialog = document.querySelector('.confirm-overlay');
  const asks = {
    title: dialog.querySelector('.confirm-title').textContent,
    message: dialog.querySelector('.confirm-message').textContent,
    ok: document.getElementById('confirm-ok-btn').textContent,
    cancel: document.getElementById('confirm-cancel-btn').textContent,
  };
  document.getElementById('confirm-cancel-btn').onclick();
  return asks;
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
      out.columns[aid] = {
        n: parseInt(button.textContent.replace('Return ', ''), 10),
        button: button.textContent,
        line: button.getAttribute('title'),
        asks: readConfirm(),
      };
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

/* ── The phone, as tests/phone-return-counts.test.js reads it ────────── */
let stubDocument = null;
function phone() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.focus = function () {};
  const was = globalThis.document;
  globalThis.document = dom.document;
  try {
    // html-safe: MGrade.renderPicker escapes names and text; a test page
    document.getElementById('m-nav-stack').innerHTML = MGrade.renderPicker(CID);
    MGrade.filterAssessments(CID, 'toreturn');
    const count = document.querySelector('.m-seg-btn[data-val="toreturn"] .m-seg-count');
    const out = { segment: count ? parseInt(count.textContent, 10) : 0, rows: {} };
    Array.from(document.querySelectorAll('#m-grade-to-return .m-to-return-row')).forEach(row => {
      const aid = row.getAttribute('data-aid');
      const button = row.querySelector('[data-action="m-grade-return-all"]');
      MGrade.askReturnAll(CID, aid, button);
      const sheet = document.querySelector('#m-sheet-container .m-confirm-sheet');
      out.rows[aid] = {
        n: parseInt(text(button).replace('Return ', ''), 10),
        // What a screen reader hears for the button: "Return 3 Graded, Essay".
        label: button.getAttribute('aria-label'),
        asks: {
          title: text(sheet.querySelector('#m-confirm-title')),
          message: text(sheet.querySelector('#m-confirm-text')),
          ok: text(sheet.querySelector('.m-confirm-ok')),
          cancel: text(sheet.querySelector('[data-action="m-sheet-cancel"]')),
        },
      };
    });
    return out;
  } finally {
    globalThis.document = was;
  }
}

/* ── The Assignments page ────────────────────────────────────────────── */
const settled = () => new Promise(r => setTimeout(r, 10));
async function assignments() {
  openAssignments(() => {}, CID);
  click(document.querySelector('[data-action="expandAllAssess"]'));
  await settled();
  const pill = document.querySelector('.assess-to-return-btn');
  const out = { pill: pill ? parseInt(pill.textContent, 10) : 0, cards: {}, marked: {} };
  WORK.forEach(aid => {
    const card = document.getElementById('ac-' + aid);
    const button = card.querySelector('.assess-return-btn');
    const chip = card.querySelector('.assess-to-return');
    if (button) {
      click(button);
      out.cards[aid] = {
        n: parseInt(button.textContent.replace('Return ', ''), 10),
        chip: chip ? parseInt(chip.textContent, 10) : 0,
        button: button.textContent,
        label: button.getAttribute('aria-label'),
        line: button.getAttribute('title'),
        asks: readConfirm(),
      };
    }
    // The students whose row carries the Draft mark (a pair's row is both).
    out.marked[aid] = [];
    Array.from(card.querySelectorAll('.ret-mark')).forEach(mark => {
      if (text(mark) === 'Draft')
        mark
          .getAttribute('data-ret-sids')
          .split(',')
          .forEach(sid => out.marked[aid].push(sid));
    });
    out.marked[aid].sort();
  });
  closePages();
  return out;
}

/* ── The grader dialog, opened on each piece with the whole class ────── */
async function dialog() {
  const out = {};
  for (const aid of WORK) {
    openGrader(() => {}, CID, aid, FERN);
    await settled();
    const overlay = document.getElementById('grader-overlay');
    const seg = overlay.querySelector('.grader-show [data-show="toreturn"]');
    const button = overlay.querySelector('.grader-return-all');
    out[aid] = { bar: !!overlay.querySelector('.grader-show') };
    if (seg) out[aid].toReturn = parseInt(text(seg).replace('To Return ', ''), 10);
    if (button) {
      click(button);
      Object.assign(out[aid], {
        n: parseInt(button.textContent.replace('Return ', ''), 10),
        button: button.textContent,
        line: button.getAttribute('title'),
        asks: readConfirm(),
      });
    }
    closePages();
  }
  return out;
}

beforeEach(() => {
  stubDocument = globalThis.document;
  // The clock only: the pages' own timers are left to run as they do.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T18:00:00.000Z'));
  localStorage.clear();
  seed();
});
afterEach(() => {
  vi.useRealTimers();
  closePages();
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
});

describe('the Assignments page, the gradebook and the phone agree', () => {
  it('on the class’s count', async () => {
    const desk = gradebook();
    const hand = phone();
    const page = await assignments();
    expect(page.pill).toBe(10);
    expect(page.pill).toBe(desk.pill);
    expect(page.pill).toBe(hand.segment);
    expect(page.pill).toBe(GradeState.draftsWaiting(CID));
  });

  it('on each assessment’s N, its line of names and its question', async () => {
    const desk = gradebook();
    const hand = phone();
    const page = await assignments();

    // The same assessments have something to return; a benchmark never does.
    const waiting = [ESSAY, QUIZ, EXIT, TALK].sort();
    expect(Object.keys(page.cards).sort()).toEqual(waiting);
    expect(Object.keys(desk.columns).sort()).toEqual(waiting);
    expect(Object.keys(hand.rows).sort()).toEqual(waiting);

    waiting.forEach(aid => {
      const card = page.cards[aid];
      const column = desk.columns[aid];
      const row = hand.rows[aid];
      expect(card.n, aid).toBe(column.n);
      expect(card.n, aid).toBe(row.n);
      expect(card.n, aid).toBe(GradeState.draftsIn(CID, aid, EVERYONE).length);
      // The chip beside the title counts the same drafts.
      expect(card.chip, aid).toBe(card.n);
      // "Return 3 Graded" on both desktop screens; the phone's "Return 3"
      // is called that, with the work's name, as the card's button is.
      expect(card.button, aid).toBe(column.button);
      expect(card.label, aid).toBe(row.label);
      // The hover line is the gradebook's, and each question's message.
      expect(card.line, aid).toBe(column.line);
      expect(card.asks, aid).toEqual(column.asks);
      expect(card.asks, aid).toEqual(row.asks);
      expect(card.asks.message, aid).toBe(card.line);
    });
    expect(page.cards[ESSAY].asks).toEqual({
      title: 'Return 5 Grades Now?',
      message: '5 drafts: Ava, Ben, Cara and 2 others can’t see them yet.',
      ok: 'Return 5 Graded',
      cancel: 'Cancel',
    });
    expect(page.cards[QUIZ].asks).toEqual({
      title: 'Return 1 Grade Now?',
      message: '1 draft: Eli can’t see it yet.',
      ok: 'Return 1 Graded',
      cancel: 'Cancel',
    });
    expect(page.cards[TALK].asks.message).toBe('2 drafts: Ava and Ben can’t see them yet.');
  });

  it('on which grades are drafts: the page’s Draft mark is the gradebook’s dashed cell', async () => {
    const desk = gradebook();
    const page = await assignments();
    WORK.forEach(aid => {
      expect(page.marked[aid], aid).toEqual(desk.dashed[aid].slice().sort());
      expect(page.marked[aid], aid).toEqual(GradeState.draftsIn(CID, aid, EVERYONE).sort());
    });
    expect(page.marked[TALK]).toEqual([AVA, BEN]);
    expect(page.marked[BENCH]).toEqual([]);
    // Missing and Excused are never drafts.
    expect(page.marked[ESSAY]).not.toContain(FERN);
    expect(page.marked[QUIZ]).toEqual([ELI]);
  });

  it('and the grader dialog’s To Return and Return N Graded are the card’s', async () => {
    const page = await assignments();
    const box = await dialog();
    [ESSAY, QUIZ, EXIT, TALK].forEach(aid => {
      expect(box[aid].bar, aid).toBe(true);
      expect(box[aid].toReturn, aid).toBe(page.cards[aid].n);
      expect(box[aid].n, aid).toBe(page.cards[aid].n);
      expect(box[aid].button, aid).toBe(page.cards[aid].button);
      expect(box[aid].line, aid).toBe(page.cards[aid].line);
      // Fern, on screen in the dialog, has no draft: every one of these asks.
      expect(box[aid].asks, aid).toEqual(page.cards[aid].asks);
    });
    // A DIBELS benchmark has no state: no bar in the dialog.
    expect(box[BENCH]).toEqual({ bar: false });
  });

  it('after a Return N Graded on the page, by the same N', async () => {
    const before = gradebook();
    openAssignments(() => {}, CID, { open: ESSAY });
    await settled();
    click(document.querySelector('#ac-' + ESSAY + ' .assess-return-btn'));
    document.getElementById('confirm-ok-btn').onclick();
    await settled();
    const n = before.columns[ESSAY].n;
    expect(parseInt(document.querySelector('.assess-to-return-btn').textContent, 10)).toBe(before.pill - n);
    closePages();

    const after = gradebook();
    const hand = phone();
    expect(after.pill).toBe(before.pill - n);
    expect(hand.segment).toBe(after.pill);
    expect(after.columns[ESSAY]).toBeUndefined();
    expect(hand.rows[ESSAY]).toBeUndefined();
    expect(after.dashed[ESSAY]).toEqual([]);
    expect(after.columns[QUIZ]).toEqual(before.columns[QUIZ]);
    expect(GradeState.draftsWaiting(CID)).toBe(after.pill);
  });
});
