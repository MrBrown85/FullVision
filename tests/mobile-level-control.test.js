/**
 * The phone grader's level buttons (the board "Phone Speed Grader With
 * Photos"): each level's figure and word, in the class's level order, then
 * − Minus and + Plus. The classic grader (Send Work off) and the grader with
 * photos (the build switch and Send Work on) draw them the same way, and a
 * tap writes what it wrote before the buttons were redrawn. Demo Mode's
 * Science 8: the Cell Microscope Lab is an Advanced Rubric; the Immune System
 * Quick Check is scored by competency.
 */
import './setup-mobile.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
const QUICK = 'sci8a2';
const FAIR = 'sci8a20'; // a Standard rubric: listed criterion by criterion
let wasDemo;
let stubDocument;

beforeAll(() => {
  wasDemo = window.isDemoMode;
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
});
afterAll(() => {
  window.isDemoMode = wasDemo;
  CURRICULUM_INDEX = null;
  localStorage.clear();
});
beforeEach(() => {
  stubDocument = globalThis.document;
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  globalThis.document = dom.document;
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
});
afterEach(() => {
  globalThis.document = stubDocument;
  vi.restoreAllMocks();
});

const stack = () => document.getElementById('m-nav-stack');
const card = sid => stack().querySelector('.m-swiper-card[data-sid="' + sid + '"]');
function open(aid) {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  stack().innerHTML = MGrade.renderSwiper(CID, aid);
  MGrade.setupSwiper(CID, aid);
}
// The build switch and Send Work: the grader with photos.
function photosOn() {
  setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = true;
  saveDemoStudentWork(CID, work);
}

/* A tap, sent as teacher-mobile/shell.js sends it. */
function tap(el) {
  if (!el || el.disabled) return;
  const a = n => el.getAttribute('data-' + n);
  const action = a('action');
  if (action === 'm-grade-score') return MGrade.setScore(CID, a('sid'), a('aid'), a('tid'), parseInt(a('score'), 10));
  if (action === 'm-grade-crit')
    return MGrade.setCriterionScore(CID, a('sid'), a('aid'), a('critid'), parseInt(a('score'), 10));
  if (action === 'm-grade-mod') {
    const box = el.closest('.m-score-mods');
    const b = n => box.getAttribute('data-' + n);
    if (b('critid')) return MGrade.setCriterionMod(CID, b('sid'), b('aid'), b('critid'), parseInt(a('mod'), 10));
    return MGrade.setScoreMod(CID, b('sid'), b('aid'), b('tid'), parseInt(a('mod'), 10));
  }
  throw new Error('not a level control: ' + action);
}

describe('a tap on the level buttons writes what it did before', () => {
  function record() {
    const calls = [];
    ['setLevelOnPhone', 'setPlusMinusOnPhone'].forEach(name => {
      const real = Grader[name];
      vi.spyOn(Grader, name).mockImplementation(function () {
        calls.push([name].concat(Array.from(arguments)));
        return real.apply(this, arguments);
      });
    });
    return calls;
  }

  // Sam (st3) has 2 on the lab's first criterion and 3 on the quick check.
  it('a criterion: a new level, + then the same level again', () => {
    open(LAB);
    const crit = getRubricById(CID, getAssessments(CID).find(a => a.id === LAB).rubricId).criteria[0];
    const group = () => card('st3').querySelector('.m-crit-group[data-critid="' + crit.id + '"]');
    const calls = record();
    tap(group().querySelector('[data-action="m-grade-crit"][data-score="3"]'));
    tap(group().querySelector('.m-score-mods [data-mod="1"]'));
    tap(group().querySelector('[data-action="m-grade-crit"][data-score="3"]'));
    expect(calls).toMatchInlineSnapshot(`
      [
        [
          "setLevelOnPhone",
          "sci8",
          "st3",
          "sci8a1",
          "crit_sci8_lab_inquiry",
          3,
          0,
        ],
        [
          "setPlusMinusOnPhone",
          "sci8",
          "st3",
          "sci8a1",
          "crit_sci8_lab_inquiry",
          3,
          1,
          "",
        ],
        [
          "setLevelOnPhone",
          "sci8",
          "st3",
          "sci8a1",
          "crit_sci8_lab_inquiry",
          0,
          0,
        ],
      ]
    `);
  });

  it('a competency: a new level, − then another level', () => {
    open(QUICK);
    const tid = getAssessments(CID).find(a => a.id === QUICK).tagIds[0];
    const row = () =>
      card('st3')
        .querySelector('.m-score-mods[data-tid="' + tid + '"]')
        .closest('.m-score-group');
    const calls = record();
    tap(row().querySelector('[data-action="m-grade-score"][data-score="2"]'));
    tap(row().querySelector('.m-score-mods [data-mod="-1"]'));
    tap(row().querySelector('[data-action="m-grade-score"][data-score="4"]'));
    expect(calls).toMatchInlineSnapshot(`
      [
        [
          "setLevelOnPhone",
          "sci8",
          "st3",
          "sci8a2",
          "PA5",
          2,
        ],
        [
          "setPlusMinusOnPhone",
          "sci8",
          "st3",
          "sci8a2",
          "PA5",
          2,
          -1,
          "",
        ],
        [
          "setLevelOnPhone",
          "sci8",
          "st3",
          "sci8a2",
          "PA5",
          4,
        ],
      ]
    `);
  });
});

describe('the level control is drawn the same on both graders', () => {
  const lab = () => getAssessments(CID).find(a => a.id === LAB);
  const firstCrit = () => getRubricById(CID, lab().rubricId).criteria[0];
  // The first criterion's levels and Fine-tune on Sam's card.
  function control() {
    const group = card('st3').querySelector('.m-crit-group[data-critid="' + firstCrit().id + '"]');
    return { levels: group.querySelector('.m-score-btns'), fine: group.querySelector('.m-score-mods') };
  }
  const faces = levels =>
    [...levels.querySelectorAll('.m-score-btn')].map(
      b => b.querySelector('.m-level-fig').textContent + ' ' + b.querySelector('.m-level-word').textContent,
    );

  it('a plain class and one with photos, a pager and a list: figure and word, − Minus and + Plus, in the class’s order', () => {
    // History 12's case: a Letter class, highest level first.
    updateCourse(CID, { gradingSystem: 'letter' });
    saveCourseConfig(CID, { ...getCourseConfig(CID), levelOrder: 'desc' });
    open(LAB);
    MGrade.setCriterionScore(CID, 'st3', LAB, firstCrit().id, 3);
    MGrade.setCriterionMod(CID, 'st3', LAB, firstCrit().id, 1);
    const classic = control();
    expect(card('st3').querySelector('.m-crit-pager')).not.toBeNull();
    expect(faces(classic.levels)).toEqual(['4 Extending', '3+ Proficient', '2 Developing', '1 Emerging']);
    expect(classic.levels.getAttribute('aria-label')).toBe('Level for ' + firstCrit().name);
    expect(classic.fine.getAttribute('aria-label')).toBe('Fine-tune Proficient');
    expect([...classic.fine.querySelectorAll('.m-mod-btn')].map(b => b.textContent)).toEqual(['−Minus', '+Plus']);
    expect(classic.fine.querySelector('[data-mod="1"]').getAttribute('aria-pressed')).toBe('true');

    photosOn();
    open(LAB);
    expect(card('st3').querySelector('.m-crit-pager')).not.toBeNull();
    const photos = control();
    expect(photos.levels.outerHTML).toBe(classic.levels.outerHTML);
    expect(photos.fine.outerHTML).toBe(classic.fine.outerHTML);

    // A Standard rubric is listed criterion by criterion, with the same control.
    open(FAIR);
    const row = card('st3').querySelector('.m-crit-group');
    expect(card('st3').querySelector('.m-crit-pager')).toBeNull();
    expect(faces(row.querySelector('.m-score-btns')).map(f => f.replace(/^(\d)\S*/, '$1'))).toEqual([
      '4 Extending',
      '3 Proficient',
      '2 Developing',
      '1 Emerging',
    ]);
    expect([...row.querySelectorAll('.m-mod-btn')].map(b => b.textContent)).toEqual(['−Minus', '+Plus']);

    // Lowest first when the class says so.
    saveCourseConfig(CID, { ...getCourseConfig(CID), levelOrder: 'asc' });
    open(LAB);
    expect(faces(control().levels)).toEqual(['1 Emerging', '2 Developing', '3+ Proficient', '4 Extending']);
  });

  it('a competency row shows its level and + or − after a tap, and none once cleared', () => {
    open(QUICK);
    const tid = getAssessments(CID).find(a => a.id === QUICK).tagIds[0];
    const fine = () => card('st3').querySelector('.m-score-mods[data-tid="' + tid + '"]');
    const row = () => fine().closest('.m-score-group');
    tap(row().querySelector('[data-score="2"]'));
    tap(fine().querySelector('[data-mod="-1"]'));
    expect(row().querySelector('.m-score-active .m-level-fig').textContent).toBe('2−');
    expect(fine().getAttribute('aria-label')).toBe('Fine-tune Developing');
    tap(row().querySelector('[data-score="2"]'));
    expect(row().querySelector('.m-score-active')).toBeNull();
    expect([...row().querySelectorAll('.m-level-fig')].map(f => f.textContent)).toEqual(levelOrderFor(CID).map(String));
    expect(fine().querySelectorAll('.m-mod-btn[disabled]').length).toBe(2);
  });
});
