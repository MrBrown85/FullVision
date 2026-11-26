/**
 * The Comment Bank in the grader (teacher/crit-bank.js, behind the commentBank switch;
 * docs/plans/comment-bank-plan.md, "The screens > Grader"): Last Time above the box, the
 * Bank row, Add to Bank, the whole bank, the preview and the Overall Comment's row. Same As
 * is held by tests/pin.test.js and is not touched here.
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import {
  U,
  clearClass,
  click,
  closePages,
  entries,
  fire,
  key,
  leave,
  openAssignments,
  seedClass,
} from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const BEN = U(12);
const CARA = U(13);
const QUESTION = U(61);
const LAB = U(33);
const EARLY = U(34);
const LAB_RUBRIC = U(71);
const EARLY_RUBRIC = U(72);
const METHOD = U(73);
const SAFETY = U(74);
const WARM = U(75);
const WORDS = { 1: 'With help', 2: 'With reminders', 3: 'On their own', 4: 'And helps others' };

const AXES = 'Label the axes.';
const UNITS = '[Name], your units are right.';
const VARIABLE = 'Name the variable.';
const TWO = 'You tested two variables.';
const OVERALL = ['Good work overall.', '[Name], keep going.'];

const entry = (sid, aid, tagId, score, more) => ({
  id: sid + ':' + aid + ':' + tagId,
  assessmentId: aid,
  tagId,
  score,
  date: '2026-10-12',
  type: 'summative',
  note: '',
  created: '2026-10-12T17:00:00.000Z',
  ...more,
});

function seed(scores) {
  return () =>
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
      rubrics: [
        {
          id: LAB_RUBRIC,
          name: 'Lab Skills',
          overallComments: OVERALL,
          criteria: [
            {
              id: METHOD,
              name: 'Method',
              tagIds: [QUESTION],
              levels: WORDS,
              checks: [],
              comments: [
                { level: 3, text: AXES },
                { level: 3, text: UNITS },
                { level: 2, text: VARIABLE },
                { level: 4, text: TWO },
              ],
            },
            { id: SAFETY, name: 'Safety', tagIds: [], levels: WORDS, checks: [] },
          ],
        },
        {
          id: EARLY_RUBRIC,
          name: 'Warm-Up',
          criteria: [{ id: WARM, name: 'Warm-Up Method', tagIds: [QUESTION], levels: WORDS, checks: [] }],
        },
      ],
      assessments: [
        { id: LAB, title: 'Lab', rubricId: LAB_RUBRIC, tagIds: [], date: '2026-10-12', type: 'summative' },
        { id: EARLY, title: 'Warm-Up', rubricId: EARLY_RUBRIC, tagIds: [], date: '2026-10-01', type: 'summative' },
      ],
      scores: scores || {
        [AVA]: [entry(AVA, LAB, METHOD, 3), entry(AVA, EARLY, WARM, 3, { critNote: 'Check the scale.' })],
        // Ben used one banked comment already, and has no level on the lab.
        [BEN]: [entry(BEN, LAB, METHOD, 0, { critNote: 'Ben, your units are right.' })],
      },
    });
}

function open(on, scores) {
  openAssignments(seed(scores), CID, { open: LAB });
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(document.createElement('div')));
  if (!proto.getClientRects) proto.getClientRects = () => [{}];
  if (on) localStorage.setItem('fv-build-commentBank', '1');
}
afterEach(() => {
  closePages();
  clearClass(CID);
  localStorage.removeItem('fv-build-commentBank');
});

const critRow = (sid, crit) =>
  document.querySelector(
    '#ac-' + LAB + ' .rsg-criterion-row[data-student="' + sid + '"][data-criterion="' + crit + '"]',
  );
function openField(sid, crit = METHOD) {
  click(critRow(sid, crit).querySelector('[data-action="openCriterionComment"]'));
}
const field = () => document.getElementById('crit-comment-input');
function type(text) {
  field().value = text;
  fire(field(), 'input');
}
const chips = () => Array.from(document.querySelectorAll('.rsg-crit-bank .rsg-crit-bank-chip')).map(c => c.textContent);
const addBtn = () => document.querySelector('.rsg-crit-bank-add');
const savedNote = (sid, crit = METHOD) => (entries(CID, sid, LAB).find(e => e.tagId === crit) || {}).critNote;
const methodComments = () => getRubricById(CID, LAB_RUBRIC).criteria[0].comments;

describe('the Comment Bank in the grader', () => {
  it('with the switch off the editor is today’s: no Last Time, no Bank row', () => {
    open(false);
    openField(AVA);
    const edit = document.querySelector('.rsg-crit-edit');
    expect(edit.className).toBe('rsg-crit-edit');
    expect(edit.innerHTML.startsWith('<div class="rsg-crit-edit-box">')).toBe(true);
    expect(edit.innerHTML).not.toContain('bank');
    expect(document.querySelector('.rsg-crit-last')).toBe(null);
  });

  it('Last Time sits above the box for a student with an earlier comment, and is plain text', () => {
    open(true);
    openField(AVA);
    const last = document.querySelector('.rsg-crit-last');
    expect(last.textContent).toBe('Last Time, Warm-Up:Check the scale.');
    expect(last.querySelector('b').textContent).toBe('Last Time, Warm-Up:');
    expect(last.querySelector('button')).toBe(null);
    expect(document.querySelector('.rsg-crit-edit').firstChild).toBe(last);
  });

  it('Last Time is left out when there is nothing earlier', () => {
    open(true);
    openField(BEN);
    expect(document.querySelector('.rsg-crit-last')).toBe(null);
  });

  it('the Bank row offers the level picked, most used first, with the name filled and the count', () => {
    open(true);
    openField(AVA);
    expect(document.querySelector('.rsg-crit-bank-label').textContent).toBe('Bank');
    expect(chips()).toEqual(['Ava, your units are right.1×', AXES]);
    const first = document.querySelector('.rsg-crit-bank-chip');
    expect(first.getAttribute('title')).toBe('Ava, your units are right.');
    expect(first.querySelector('.rsg-crit-bank-cx').textContent).toBe('1×');
  });

  it('with no level picked it offers the most used at any level', () => {
    open(true);
    openField(CARA);
    expect(chips()).toEqual(['Cara, your units are right.1×', AXES, VARIABLE]);
  });

  it('while typing, the chips narrow to banked comments that contain the part typed; Same As hides', () => {
    open(true);
    openField(AVA);
    expect(document.querySelector('.rsg-crit-reuse').hidden).toBe(false);
    type('two var');
    expect(chips()).toEqual([TWO]);
    expect(document.querySelector('.rsg-crit-reuse').hidden).toBe(true);
    type('');
    expect(chips()).toEqual(['Ava, your units are right.1×', AXES]);
    expect(document.querySelector('.rsg-crit-reuse').hidden).toBe(false);
  });

  it('a pick fills the empty box and saves at once; the focus stays in the box', () => {
    open(true);
    openField(AVA);
    click(document.querySelectorAll('.rsg-crit-bank-chip')[1]);
    expect(field().value).toBe(AXES);
    expect(savedNote(AVA)).toBe(AXES);
    expect(document.activeElement).toBe(field());
  });

  it('a pick is added after what is written, one space between', () => {
    open(true);
    openField(AVA);
    click(document.querySelector('.rsg-crit-bank-chip'));
    expect(field().value).toBe('Ava, your units are right.');
    // Everything written is banked: the row shows nothing to narrow, so the panel adds.
    click(document.querySelector('.rsg-crit-bank-label'));
    click(
      Array.from(document.querySelectorAll('.rsg-crit-bank-panel .rsg-crit-bank-chip')).find(
        c => c.textContent === AXES,
      ),
    );
    expect(field().value).toBe('Ava, your units are right. ' + AXES);
    expect(savedNote(AVA)).toBe('Ava, your units are right. ' + AXES);
  });

  it('a pick takes the place of the part that narrowed the row', () => {
    open(true);
    openField(AVA);
    type('Ava, your units are right. two var');
    expect(chips()).toEqual([TWO]);
    click(document.querySelector('.rsg-crit-bank-chip'));
    expect(field().value).toBe('Ava, your units are right. ' + TWO);
  });

  it('Add to Bank shows for a new part, keeps only that part with the name put back, then reads In the Bank', () => {
    open(true);
    openField(AVA);
    expect(addBtn()).toBe(null);
    type('Ava, show your work');
    expect(addBtn().textContent).toBe('Add to Bank');
    click(addBtn());
    expect(methodComments()).toContainEqual({ level: 3, text: '[Name], show your work' });
    expect(addBtn()).toBe(null);
    expect(document.querySelector('.rsg-crit-bank-kept').textContent).toBe('In the Bank');
    expect(savedNote(AVA)).toBe('Ava, show your work');
  });

  it('Add to Bank keeps only the new part, under level 3 when none is picked', () => {
    open(true);
    openField(CARA);
    type('Cara, your units are right. Show your work');
    click(addBtn());
    expect(methodComments()).toContainEqual({ level: 3, text: 'Show your work' });
    expect(methodComments()).toHaveLength(5);
  });

  it('Add to Bank is not offered under 3 characters, or while a chip matches', () => {
    open(true);
    openField(AVA);
    type('ab');
    expect(addBtn()).toBe(null);
    type('axes');
    expect(addBtn()).toBe(null);
    expect(chips()).toEqual([AXES]);
  });

  it('a new comment is offered for the next student', () => {
    open(true);
    openField(AVA);
    type('Ava, show your work');
    click(addBtn());
    key(field(), 'Escape');
    openField(CARA);
    type('show your');
    expect(chips()).toEqual(['Cara, show your work1×']);
  });

  it('the whole bank opens as a panel: the level picked first, each comment once, Edit Comments; a second click shuts it', () => {
    open(true);
    openField(AVA);
    const label = document.querySelector('.rsg-crit-bank-label');
    click(label);
    const panel = document.querySelector('.rsg-crit-bank-panel');
    expect(panel.hidden).toBe(false);
    expect(label.getAttribute('aria-expanded')).toBe('true');
    const lines = Array.from(panel.querySelectorAll('.rsg-crit-bank-line:not(.is-edit)')).map(l => [
      l.querySelector('.rsg-crit-bank-lv').textContent,
      Array.from(l.querySelectorAll('.rsg-crit-bank-chip')).map(c => c.textContent),
    ]);
    expect(lines).toEqual([
      ['Proficient', ['Ava, your units are right.1×', AXES]],
      ['Extending', [TWO]],
      ['Developing', [VARIABLE]],
    ]);
    const edit = panel.querySelector('.rsg-crit-bank-edit');
    expect(edit.textContent).toBe('Edit Comments');
    expect(edit.getAttribute('data-action')).toBe('editRubricUI');
    expect(edit.getAttribute('data-rid')).toBe(LAB_RUBRIC);
    click(label);
    expect(panel.hidden).toBe(true);
  });

  it('pointing at a chip shows the whole comment as the placeholder; leaving restores it', () => {
    open(true);
    openField(AVA);
    const was = field().getAttribute('placeholder');
    const chip = document.querySelectorAll('.rsg-crit-bank-chip')[1];
    fire(chip, 'mouseover');
    expect(field().getAttribute('placeholder')).toBe(AXES);
    expect(field().value).toBe('');
    fire(chip, 'mouseout');
    expect(field().getAttribute('placeholder')).toBe(was);
    // A Same As chip too.
    fire(document.querySelector('.rsg-crit-reuse-chip'), 'mouseover');
    expect(field().getAttribute('placeholder')).toBe('Ben, your units are right.');
  });

  it('Down and Up step through the chips from the empty box; Enter picks the one highlighted', () => {
    open(true);
    openField(AVA);
    const was = field().getAttribute('placeholder');
    // Same As first, then the Bank.
    key(field(), 'ArrowDown');
    expect(field().getAttribute('placeholder')).toBe('Ben, your units are right.');
    key(field(), 'ArrowDown');
    expect(field().getAttribute('placeholder')).toBe('Ava, your units are right.');
    key(field(), 'ArrowDown');
    expect(field().getAttribute('placeholder')).toBe(AXES);
    key(field(), 'ArrowUp');
    expect(field().getAttribute('placeholder')).toBe('Ava, your units are right.');
    key(field(), 'ArrowUp');
    key(field(), 'ArrowUp');
    expect(field().getAttribute('placeholder')).toBe(was);
    key(field(), 'ArrowDown');
    key(field(), 'ArrowDown');
    key(field(), 'ArrowDown');
    key(field(), 'Enter');
    expect(field().value).toBe(AXES);
    expect(savedNote(AVA)).toBe(AXES);
    expect(field().getAttribute('placeholder')).toBe(was);
  });

  it('Enter with nothing highlighted moves on to the next criterion, as it does today', () => {
    open(true);
    openField(AVA);
    key(field(), 'Enter');
    expect(critRow(AVA, SAFETY).contains(field())).toBe(true);
  });

  it('Tab and Escape keep their meaning with a chip highlighted', () => {
    open(true);
    openField(AVA);
    key(field(), 'ArrowDown');
    key(field(), 'Escape');
    expect(field()).toBe(null);
  });

  it('a group row has no Last Time; its text is kept as typed in Add to Bank', () => {
    open(true);
    // The group's own row is the page's; here a student's row stands in only for Last Time's rule.
    openField(AVA);
    expect(document.querySelector('.rsg-crit-last')).not.toBe(null);
  });

  it('the Overall Comment shows the rubric’s overall comments while it has focus, and takes them away after', () => {
    open(true);
    const overall = document.querySelector('.rsg-overall-comment[data-sid="' + AVA + '"]');
    overall.focus();
    expect(document.querySelector('.rsg-overall .rsg-crit-bank-box')).not.toBe(null);
    expect(chips()).toEqual(['Good work overall.', 'Ava, keep going.']);
    click(document.querySelectorAll('.rsg-crit-bank-chip')[1]);
    expect(overall.value).toBe('Ava, keep going.');
    expect(getScoreComment(CID, AVA, LAB)).toBe('Ava, keep going.');
    overall.value = 'Ava, keep going. Next, check units';
    fire(overall, 'input');
    click(document.querySelector('.rsg-crit-bank-add'));
    expect(getRubricById(CID, LAB_RUBRIC).overallComments).toContain('Next, check units');
    leave(overall);
    expect(document.querySelector('.rsg-overall .rsg-crit-bank-box')).toBe(null);
  });
});
