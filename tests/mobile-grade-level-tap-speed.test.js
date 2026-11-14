/**
 * A level tap on the phone grader, counted (docs/plans/speed-assessment.md,
 * section 7, P2 and P3).
 *
 * P2: a level on a rubric criterion, or on a competency row of rubric work,
 * drew the whole card again (and fetched its pictures again). Now only the
 * row's buttons, its ± and an open checklist change, in place, and the
 * button tapped keeps the focus. What the card shows afterwards is what a
 * fresh draw of it shows.
 *
 * P3: every score tap checked Missing and Excused for every student on the
 * screen (three calls each) and sorted the class again for the Draft and
 * Return bar. Now it checks the one student, and the bar uses the cards as
 * drawn. A status change still checks everyone.
 *
 * The fixture: 30 students, a rubric with five criteria, each feeding one
 * of three competencies, in a class that holds grades (the bar is on).
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const AID = U(31);
const RUB = U(32);
const TAGS = [U(41), U(42), U(43)];
const CRITS = [0, 1, 2, 3, 4].map(i => U(61 + i));
const N = 30;
const S = Array.from({ length: N }, (_, i) => U(101 + i));
let wasDemo;
let stubDocument;

function seed() {
  seedClass(CID, {
    students: S.map((id, i) => ({ id, firstName: 'Kid' + String(i).padStart(2, '0'), lastName: 'Son' })),
    learningMaps: {
      subjects: [],
      sections: [
        {
          id: U(51),
          name: 'Thinking',
          tags: TAGS.map((id, i) => ({ id, label: 'Competency ' + (i + 1), text: 'Do ' + i })),
        },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    rubrics: [
      {
        id: RUB,
        name: 'Lab Rubric',
        criteria: CRITS.map((id, i) => ({ id, name: 'Criterion ' + (i + 1), tagIds: [TAGS[i % 3]], levels: {} })),
      },
    ],
    assessments: [{ id: AID, title: 'Lab', tagIds: TAGS, rubricId: RUB, date: '2026-11-03', type: 'summative' }],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
}

function phonePage() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.focus = function () {
    dom.document._fvFocus = this;
  };
  Object.defineProperty(dom.document, 'activeElement', {
    get() {
      return this._fvFocus && this._fvFocus.isConnected ? this._fvFocus : this.body;
    },
    configurable: true,
  });
  globalThis.document = dom.document;
}

function openGrader() {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  document.getElementById('m-nav-stack').innerHTML = MGrade.renderSwiper(CID, AID);
  MGrade.setupSwiper(CID, AID);
}

const card = sid => document.querySelector('.m-swiper-card[data-sid="' + sid + '"]');
const levelBtn = (sid, crit, lv) =>
  card(sid).querySelector('.m-score-btn[data-critid="' + crit + '"][data-score="' + lv + '"]');
const rowBtn = (sid, tid, lv) =>
  card(sid).querySelector('.m-score-btn[data-tid="' + tid + '"][data-score="' + lv + '"]');

/* The level rows of a card as a fresh draw makes them. */
function freshRows(sid) {
  const tmp = parseHTML('<div></div>').document.firstChild;
  // html-safe: MGrade.renderSwiper escapes names and text; a test copy
  tmp.innerHTML = MGrade.renderSwiper(CID, AID, { keep: true });
  return rows(tmp.querySelector('.m-swiper-card[data-sid="' + sid + '"]'));
}
const rows = el => [...el.querySelectorAll('.m-score-btns, .m-score-mods, .m-checklist')].map(r => r.outerHTML);

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  stubDocument = globalThis.document;
  phonePage();
  seed();
  openGrader();
});
afterEach(() => {
  vi.restoreAllMocks();
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('a level on a rubric criterion (P2)', () => {
  it('changes the row in place: no card is drawn again, the button keeps the focus', () => {
    const drawn = vi.spyOn(MGradePhotos, 'pinHtml');
    const before = card(S[0]);
    const btn = levelBtn(S[0], CRITS[0], 3);
    btn.focus();
    MGrade.setCriterionScore(CID, S[0], AID, CRITS[0], 3);
    // Before: the card was drawn again, once a tap.
    expect(drawn).toHaveBeenCalledTimes(0);
    expect(card(S[0])).toBe(before);
    expect(levelBtn(S[0], CRITS[0], 3)).toBe(btn);
    expect(document.activeElement).toBe(btn);
    expect(btn.classList.contains('m-score-active')).toBe(true);
    expect(rows(card(S[0]))).toEqual(freshRows(S[0]));
  });

  it('a second tap clears it, and ± changes in place too', () => {
    MGrade.setCriterionScore(CID, S[1], AID, CRITS[1], 2);
    const drawn = vi.spyOn(MGradePhotos, 'pinHtml');
    MGrade.setCriterionMod(CID, S[1], AID, CRITS[1], 1);
    expect(rows(card(S[1]))).toEqual(freshRows(S[1]));
    MGrade.setCriterionScore(CID, S[1], AID, CRITS[1], 2);
    expect(rows(card(S[1]))).toEqual(freshRows(S[1]));
    expect(card(S[1]).querySelector('.m-score-active')).toBeNull();
    // freshRows draws every card once: 30. The taps drew none.
    expect(drawn).toHaveBeenCalledTimes(2 * N);
  });

  it('an open checklist follows the level', () => {
    const rub = getRubrics(CID)[0];
    rub.criteria[0].checks = [{ id: 'k1', level: 3, label: 'Labels the axes' }];
    rub.style = 'advanced';
    saveRubrics(CID, [rub]);
    openGrader();
    MGrade.toggleChecklist(CID, S[2], AID, CRITS[0]);
    MGrade.setCriterionScore(CID, S[2], AID, CRITS[0], 4);
    expect(rows(card(S[2]))).toEqual(freshRows(S[2]));
  });
});

describe('a level on a competency row of rubric work (P2)', () => {
  it('changes every row in place, as a fresh draw shows them', () => {
    MGrade.setGradeView(CID, AID, 'tags');
    const drawn = vi.spyOn(MGradePhotos, 'pinHtml');
    MGrade.setScore(CID, S[3], AID, TAGS[0], 2);
    MGrade.setScoreMod(CID, S[3], AID, TAGS[0], 1);
    // A criterion set apart: Competency 1 is now mixed.
    MGrade.setGradeView(CID, AID, 'rubric');
    MGrade.setCriterionScore(CID, S[3], AID, CRITS[3], 4);
    MGrade.setGradeView(CID, AID, 'tags');
    drawn.mockClear();
    const btn = rowBtn(S[3], TAGS[1], 3);
    MGrade.setScore(CID, S[3], AID, TAGS[1], 3);
    expect(drawn).toHaveBeenCalledTimes(0);
    expect(rows(card(S[3]))).toEqual(freshRows(S[3]));
    expect(card(S[3]).querySelector('.m-score-mixed')).not.toBeNull();
    expect(btn.isConnected).toBe(true);
  });
});

describe('a score tap checks one student (P3)', () => {
  it('Missing and Excused are checked for the student tapped only, and the class is not sorted again', () => {
    const can = vi.spyOn(globalThis, 'canSetAssignmentStatus');
    const sorted = vi.spyOn(globalThis, 'sortStudents');
    MGrade.setCriterionScore(CID, S[4], AID, CRITS[0], 3);
    // Before: 3 for each of 30 students (91 in all), and the class sorted for the bar.
    expect(can.mock.calls.length).toBeLessThanOrEqual(4);
    expect(can.mock.calls.every(c => c[1] === S[4])).toBe(true);
    expect(sorted).toHaveBeenCalledTimes(0);
    const pills = card(S[4]).querySelectorAll('.m-status-pill[data-val="NS"], .m-status-pill[data-val="EXC"]');
    expect([...pills].every(p => p.disabled)).toBe(true);
    expect(card(S[4]).querySelector('.m-status-hint').hidden).toBe(false);
    expect(document.querySelector('.m-thumb[data-sid="' + S[4] + '"]').classList.contains('m-thumb-graded')).toBe(true);
    expect(document.querySelector('.m-thumb[data-sid="' + S[5] + '"]').classList.contains('m-thumb-graded')).toBe(
      false,
    );
  });

  it('the bar still follows the card on screen', () => {
    MGrade.setCriterionScore(CID, S[0], AID, CRITS[0], 3);
    expect(document.getElementById('m-grade-return-state').textContent).toContain('Saved. Not returned yet.');
  });
});
