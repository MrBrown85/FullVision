/**
 * What is behind a criterion's name on the phone grader's card
 * (docs/plans/phone-look-plan.md): a Standard rubric's level words behind the
 * chevron, the comment last written on the criterion waiting as a
 * suggestion under an empty box, and a BC six-point guide kept as one track.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const ESSAY = U(31);
const SIX = U(32);
const QUESTION = U(41);
const STD = U(71);
const BARE = U(72);
const SIX_RUBRIC = U(73);
const WORDS = { 1: 'Few details', 2: 'Some details', 3: 'Clear details', 4: 'Rich details' };
let stubDocument;
let wasDemo;
let win;

function seed() {
  seedClass(CID, {
    students: [{ id: AVA, firstName: 'Ava', lastName: 'Adams' }],
    learningMaps: {
      subjects: [],
      sections: [{ id: U(51), name: 'Question', tags: [{ id: QUESTION, label: 'Question', text: 'Ask questions' }] }],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    rubrics: [
      {
        id: STD,
        name: 'Essay',
        criteria: [
          { id: U(81), name: 'Ideas', tagIds: [QUESTION], levels: WORDS },
          { id: BARE, name: 'Neatness', tagIds: [], levels: {} },
        ],
      },
      {
        id: SIX_RUBRIC,
        name: 'Literary Response',
        scale: [
          [1, 0],
          [2, -1],
          [2, 0],
          [3, -1],
          [3, 0],
          [4, 0],
        ].map(([level, mod], i) => ({ k: i + 1, name: 'Score ' + (i + 1), level, mod })),
        criteria: [{ id: U(82), name: 'Response', tagIds: [], levels: { 4: 'Thoughtful' } }],
      },
    ],
    assessments: [
      { id: ESSAY, title: 'Essay', rubricId: STD, tagIds: [QUESTION], date: '2026-10-10', type: 'summative' },
      { id: SIX, title: 'Response', rubricId: SIX_RUBRIC, tagIds: [], date: '2026-10-11', type: 'summative' },
    ],
  });
}

beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  stubDocument = globalThis.document;
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  win = dom.window;
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.focus = function () {};
  globalThis.document = dom.document;
  localStorage.clear();
  seed();
});
afterEach(() => {
  vi.restoreAllMocks();
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

function open(aid) {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  document.getElementById('m-nav-stack').innerHTML = MGrade.renderSwiper(CID, aid);
  MGrade.setupSwiper(CID, aid);
}
const card = () => document.querySelector('.m-swiper-card[data-sid="' + AVA + '"]');
const group = id => card().querySelector('.m-crit-group[data-critid="' + id + '"]');

describe('a Standard rubric’s level words', () => {
  it('are behind the chevron of a criterion that has them, in the track’s order; a bare criterion has no chevron', () => {
    open(ESSAY);
    const ideas = group(U(81));
    const toggle = ideas.querySelector('.m-crit-toggle');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('.m-chev')).not.toBeNull();
    expect(ideas.querySelector('.m-level-words')).toBeNull();
    expect(group(BARE).querySelector('.m-crit-toggle')).toBeNull();
    expect(group(BARE).querySelector('.m-crit-name').tagName).toBe('SPAN');

    MGrade.toggleChecklist(CID, AVA, ESSAY, U(81));
    const open1 = group(U(81));
    expect(open1.querySelector('.m-crit-toggle').getAttribute('aria-expanded')).toBe('true');
    const items = [...open1.querySelectorAll('.m-level-words-item')];
    expect(items.map(i => i.querySelector('.m-level-words-name').textContent)).toEqual(
      levelOrderFor(CID).map(lv => PROF_LABELS[lv]),
    );
    expect(items.map(i => i.querySelector('.m-level-words-text').textContent)).toEqual(
      levelOrderFor(CID).map(lv => WORDS[lv]),
    );
    // Tapped again, it closes.
    MGrade.toggleChecklist(CID, AVA, ESSAY, U(81));
    expect(group(U(81)).querySelector('.m-level-words')).toBeNull();
  });

  it('a level word that is markup is text', () => {
    const rub = getRubrics(CID)[0];
    rub.criteria[0].levels = { 3: '<b>bold</b>' };
    saveRubrics(CID, [rub]);
    open(ESSAY);
    MGrade.toggleChecklist(CID, AVA, ESSAY, U(81));
    const text = group(U(81)).querySelector('.m-level-words-text');
    expect(text.querySelector('b')).toBeNull();
    expect(text.textContent).toBe('<b>bold</b>');
  });
});

describe('a BC six-point guide', () => {
  it('keeps its six scores as one track, the chosen one’s name under it', () => {
    open(SIX);
    const g = group(U(82));
    expect([...g.querySelectorAll('.m-six-btn')].map(b => b.textContent)).toEqual(['6', '5', '4', '3', '2', '1']);
    expect(g.querySelector('.m-six-now').textContent).toBe('');
    MGrade.setCriterionScore(CID, AVA, SIX, U(82), 4);
    const after = group(U(82));
    expect(after.querySelector('.m-score-active').textContent).toBe('4');
    expect(after.querySelector('.m-six-now').textContent).toBe(RubricScale.label(getRubrics(CID)[1], 4));
    expect(after.querySelector('.m-score-mods')).toBeNull();
  });
});

describe('the last comment on a criterion waits as a suggestion', () => {
  it('shows under an empty comment box once it is open, and a tap makes it this student’s comment', () => {
    MGradeLook.rememberComment(CID, ESSAY, U(81), 'Use "refraction" and "normal".');
    open(ESSAY);
    const g = group(U(81));
    const suggest = g.querySelector('.m-crit-suggest');
    expect(suggest.hidden).toBe(true);
    // The Comment button opens the box, and the suggestion with it.
    MGrade.openCritComment(g.querySelector('.m-crit-comment-btn'));
    expect(g.querySelector('.m-crit-comment').hidden).toBe(false);
    expect(suggest.hidden).toBe(false);
    expect(suggest.textContent.trim()).toBe('Use "refraction" and "normal".');
    const write = vi.spyOn(Grader, 'setCriterionComment');
    MGrade.useSuggestion(suggest);
    expect(g.querySelector('.m-crit-comment').value).toBe('Use "refraction" and "normal".');
    expect(write).toHaveBeenCalledWith(CID, AVA, ESSAY, U(81), 'Use "refraction" and "normal".');
    expect(suggest.hidden).toBe(true);
  });

  it('is not drawn when this student already has a comment, or when there is none to suggest', () => {
    open(ESSAY);
    // Nothing written yet: the box opens with nothing waiting under it.
    MGrade.openCritComment(group(U(81)).querySelector('.m-crit-comment-btn'));
    expect(group(U(81)).querySelector('.m-crit-suggest').hidden).toBe(true);
    MGradeLook.rememberComment(CID, ESSAY, U(81), 'Earlier.');
    Grader.setCriterionComment(CID, AVA, ESSAY, U(81), 'Mine.');
    open(ESSAY);
    // This student already has a comment: it stays, and nothing is suggested over it.
    MGrade.openCritComment(group(U(81)).querySelector('.m-crit-comment-btn'));
    expect(group(U(81)).querySelector('.m-crit-suggest').hidden).toBe(true);
    expect(group(U(81)).querySelector('.m-crit-comment').value).toBe('Mine.');
  });

  it('saving a comment makes it the next suggestion', () => {
    open(ESSAY);
    const box = group(U(81)).querySelector('.m-crit-comment');
    box.hidden = false;
    box.value = 'Name the variable.';
    box.dispatchEvent(new win.Event('focusout', { bubbles: true }));
    // The card's own save, as the box is left (tab-grade.js wires focusout on the swiper).
    expect(MGradeLook.suggestion(CID, ESSAY, U(81))).toBe('Name the variable.');
  });
});
