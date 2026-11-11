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
