/**
 * Comments in the rubric editor (docs/plans/comment-bank-plan.md, "Rubric editor";
 * teacher/rubric-comment-lines.js). With the commentBank switch off the editor
 * draws what it always drew; on, a criterion's levels carry comment lines.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, seedClass, clearClass, click, fire, openAssignments, closePages } from './helpers/pin-save-paths.js';

const CID = U(1);
const AVA = U(11);
const LAB = U(33);
const RUBRIC = U(71);
const SAFETY = U(72);
const METHOD = U(73);
const WORDS = { 1: 'With help', 2: 'With reminders', 3: 'On their own', 4: 'And helps others' };

const seed = () =>
  seedClass(CID, {
    students: [{ id: AVA, firstName: 'Ava', lastName: 'Adams' }],
    rubrics: [
      {
        id: RUBRIC,
        name: 'Lab Skills',
        criteria: [
          {
            id: SAFETY,
            name: 'Safety',
            tagIds: [],
            levels: WORDS,
            checks: [],
            comments: [
              { level: 3, text: 'Safe from start to finish.' },
              { level: 3, text: 'Goggles on, every time.' },
              { level: 2, text: 'Remember your goggles.' },
            ],
          },
          { id: METHOD, name: 'Method', tagIds: [], levels: WORDS, checks: [] },
        ],
        overallComments: ['Thank you for a careful lab.'],
      },
    ],
    assessments: [{ id: LAB, title: 'Lab', rubricId: RUBRIC, tagIds: [], date: '2026-10-12', type: 'summative' }],
  });

const settled = () => new Promise(r => setTimeout(r, 10));
const card = () => document.querySelector('.af-ge-card');
const editRubric = async () => {
  const b = document.createElement('button');
  b.dataset.action = 'editRubricUI';
  b.dataset.rid = RUBRIC;
  document.body.appendChild(b);
  click(b);
  await settled();
};
const lines = (level, row = 0) =>
  [...document.querySelectorAll('.af-ge-grid tbody tr')[row].querySelectorAll('.af-ge-cell')]
    .map(td => td.querySelector('.af-ge-text').dataset.level === String(level) && td)
    .filter(Boolean)[0];
const type = (el, value) => {
  el.value = value;
  fire(el, 'input');
};

let wasDemo;
beforeEach(() => {
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
});
afterEach(async () => {
  await settled();
  closePages();
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
});

describe('the switch is off', () => {
  it('draws the editor as it was, comments or none', async () => {
    openAssignments(seed, CID, {});
    await settled();
    await editRubric();
    const off = card().outerHTML;
    expect(off).not.toContain('Comments');
    expect(off).not.toContain('af-cm');
    expect(off).not.toContain('Safe from start');
    // The same card with the new file absent altogether: byte for byte.
    const had = window.RubricCommentLines;
    delete window.RubricCommentLines;
    click(document.querySelector('.af-ge-card [data-action="geStyle"][data-style="standard"]'));
    await settled();
    window.RubricCommentLines = had;
    expect(card().outerHTML).toBe(off);
  });
});

/* The switch on: the editor reads it each time it draws. */
const switchOn = () => {
  const real = window.BuildFlags.on;
  window.BuildFlags.on = name => name === 'commentBank' || real(name);
  return () => (window.BuildFlags.on = real);
};

describe('the switch is on', () => {
  let restore;
  beforeEach(() => (restore = switchOn()));
  afterEach(() => restore());

  it('shuts: + Comments on each criterion, each comment a bubble under its level, + Overall Comments in the foot', async () => {
    openAssignments(seed, CID, {});
    await settled();
    await editRubric();
    const links = [...card().querySelectorAll('.af-ge-tools [data-cm="open"]')];
    expect(links.map(l => l.textContent)).toEqual(['+ Comments', '+ Comments']);
    const tools = card().querySelector('.af-ge-tools').children;
    expect([...tools].map(x => x.textContent)).toEqual(['+ Competency', '···', '+ Comments']);
    const bubbles = [...lines(3).querySelectorAll('.af-cm')];
    expect(bubbles.map(b => b.getAttribute('title'))).toEqual([
      'Safe from start to finish.',
      'Goggles on, every time.',
    ]);
    // Under the description, after it.
    expect(lines(3).firstElementChild.className).toContain('af-ge-text');
    expect(lines(2).querySelectorAll('.af-cm')).toHaveLength(1);
    expect(lines(4).querySelectorAll('.af-cm')).toHaveLength(0);
    expect(card().querySelector('.af-ge-foot').textContent).toContain('+ Overall Comments');
    // The overall row is there, shut, with its bubble.
    const overall = card().querySelector('.af-cm-overall');
    expect(overall.textContent).toContain('Overall Comment');
    expect(overall.querySelector('.af-cm').getAttribute('title')).toBe('Thank you for a careful lab.');
    expect(card().querySelectorAll('textarea.af-cm-field')).toHaveLength(0);
  });

  it('shows no count for a rubric not saved yet, or a comment nobody has had', async () => {
    openAssignments(seed, CID, {});
    await settled();
    await editRubric();
    expect(card().querySelectorAll('.af-cm-n')).toHaveLength(0);
  });

  it('shows a count where students have the comment', async () => {
    openAssignments(seed, CID, {});
    await settled();
    // Ava's comment on the Safety criterion holds the first bubble's words.
    saveRubricCriterionComment(CID, AVA, LAB, SAFETY, 'Safe from start to finish. Well done.');
    await editRubric();
    const n = lines(3).querySelector('.af-cm-n');
    expect(n && n.textContent).toBe('1×');
    expect(lines(3).querySelectorAll('.af-cm-n')).toHaveLength(1);
  });

  it('opens one criterion at a time: its levels show their lines and an empty one', async () => {
    openAssignments(seed, CID, {});
    await settled();
    await editRubric();
    click(card().querySelector('.af-ge-tools [data-cm="open"][data-i="0"]'));
    await settled();
    const fields = lines(3).querySelectorAll('textarea.af-cm-field');
    expect([...fields].map(f => f.value)).toEqual(['Safe from start to finish.', 'Goggles on, every time.', '']);
    expect(fields[2].className).toContain('is-new');
    expect(fields[2].getAttribute('placeholder')).toBe('Add a comment');
    expect(fields[0].getAttribute('maxlength')).toBe('500');
    expect(lines(4).querySelectorAll('textarea.af-cm-field')).toHaveLength(1);
    // The open one has no link; the other still has.
    const links = [...card().querySelectorAll('.af-ge-tools [data-cm="open"]')];
    expect(links.map(l => l.dataset.i)).toEqual(['1']);
    // The second criterion opens; the first shuts.
    click(links[0]);
    await settled();
    expect(document.querySelectorAll('.af-ge-grid tbody tr')[0].querySelectorAll('textarea.af-cm-field')).toHaveLength(
      0,
    );
    expect(document.querySelectorAll('.af-ge-grid tbody tr')[1].querySelectorAll('textarea.af-cm-field').length).toBe(
      4,
    );
    // Open state is on the editor, not the draft: nothing was written.
    expect(JSON.stringify(getRubricById(CID, RUBRIC))).not.toContain('cmOpen');
  });

  it('a click on a bubble opens the criterion with the caret in that line', async () => {
    openAssignments(seed, CID, {});
    await settled();
    await editRubric();
    click(lines(3).querySelectorAll('.af-cm')[1]);
    await settled();
    expect(document.activeElement.dataset.ge).toBe('comment');
    expect(document.activeElement.dataset.c).toBe('1');
    expect(document.activeElement.value).toBe('Goggles on, every time.');
  });

  it('typing in the empty line makes a comment and another empty line follows, with no redraw', async () => {
    openAssignments(seed, CID, {});
    await settled();
    await editRubric();
    click(card().querySelector('.af-ge-tools [data-cm="open"][data-i="1"]'));
    await settled();
    const first = lines(4, 1).querySelector('textarea.af-cm-field');
    expect(first.value).toBe('');
    type(first, 'Clear steps.');
    const after = lines(4, 1).querySelectorAll('textarea.af-cm-field');
    expect(after).toHaveLength(2);
    expect(after[0]).toBe(first);
    expect(after[1].dataset.c).toBe('1');
    expect(after[1].className).toContain('is-new');
    expect(after[0].className).not.toContain('is-new');
    // On the draft, at that level.
    type(after[1], 'Tests twice.');
    expect(lines(4, 1).querySelectorAll('textarea.af-cm-field')).toHaveLength(3);
    // Editing a line already there changes it, and adds no line.
    type(first, 'Clear steps, in order.');
    expect(lines(4, 1).querySelectorAll('textarea.af-cm-field')).toHaveLength(3);
  });

  it('draws a rubric with comments, and a criterion opened shows the same lines again after a redraw', async () => {
    openAssignments(seed, CID, {});
    await settled();
    await editRubric();
    click(card().querySelector('.af-ge-tools [data-cm="open"][data-i="1"]'));
    await settled();
    type(lines(4, 1).querySelector('textarea.af-cm-field'), 'Clear steps.');
    // A redraw (the criterion's ··· menu) keeps what was typed.
    click(card().querySelector('[data-action="geMenu"][data-i="1"]'));
    await settled();
    expect([...lines(4, 1).querySelectorAll('textarea.af-cm-field')].map(f => f.value)).toEqual(['Clear steps.', '']);
  });

  it('overall comments: + Overall Comments opens the row, typed in two columns across the levels', async () => {
    openAssignments(seed, CID, {});
    await settled();
    await editRubric();
    click(card().querySelector('.af-ge-foot [data-cm="open"]'));
    await settled();
    expect(card().querySelector('.af-ge-foot [data-cm="open"]')).toBe(null);
    const row = card().querySelector('.af-cm-overall');
    const fields = row.querySelectorAll('textarea.af-cm-field');
    expect([...fields].map(f => f.value)).toEqual(['Thank you for a careful lab.', '']);
    type(fields[1], 'Next time, share your plan first.');
    expect(row.querySelectorAll('textarea.af-cm-field')).toHaveLength(3);
    // The four levels and the + column's.
    expect(Number(row.querySelector('td').getAttribute('colspan'))).toBe(5);
  });

  it('a rubric with none shows no overall row until it is opened', async () => {
    openAssignments(
      () => {
        seed();
        const r = _cache.rubrics[CID][0];
        delete r.overallComments;
      },
      CID,
      {},
    );
    await settled();
    await editRubric();
    expect(card().querySelector('.af-cm-overall')).toBe(null);
    click(card().querySelector('.af-ge-foot [data-cm="open"]'));
    await settled();
    expect(card().querySelectorAll('.af-cm-overall textarea.af-cm-field')).toHaveLength(1);
  });

  it('keeps 40 comments at most on a criterion: no empty line once it holds 40', async () => {
    openAssignments(
      () => {
        seed();
        _cache.rubrics[CID][0].criteria[1].comments = Array.from({ length: 40 }, (_, i) => ({
          level: 3,
          text: 'c' + i,
        }));
      },
      CID,
      {},
    );
    await settled();
    await editRubric();
    click(card().querySelector('.af-ge-tools [data-cm="open"][data-i="1"]'));
    await settled();
    expect(lines(3, 1).querySelectorAll('textarea.af-cm-field')).toHaveLength(40);
    expect(lines(4, 1).querySelectorAll('textarea.af-cm-field')).toHaveLength(0);
  });

  it('a blank line is dropped on save, and the rest goes to saveRubrics with the overall comments', async () => {
    openAssignments(seed, CID, {});
    await settled();
    await editRubric();
    click(card().querySelector('.af-ge-tools [data-cm="open"][data-i="0"]'));
    await settled();
    const two = lines(3).querySelectorAll('textarea.af-cm-field');
    type(two[1], '');
    type(lines(1).querySelector('textarea.af-cm-field'), 'Needs the steps one at a time.');
    click(card().querySelector('[data-action="geSave"]'));
    await settled();
    const saved = getRubricById(CID, RUBRIC);
    expect(saved.criteria[0].comments).toEqual([
      { level: 3, text: 'Safe from start to finish.' },
      { level: 2, text: 'Remember your goggles.' },
      { level: 1, text: 'Needs the steps one at a time.' },
    ]);
    expect(saved.overallComments).toEqual(['Thank you for a careful lab.']);
  });

  it('asks before leaving a changed comment behind: the draft differs from how it opened', async () => {
    openAssignments(seed, CID, {});
    await settled();
    await editRubric();
    click(card().querySelector('.af-ge-tools [data-cm="open"][data-i="1"]'));
    await settled();
    type(lines(4, 1).querySelector('textarea.af-cm-field'), 'Clear steps.');
    click(document.querySelector('.rubric-editor-close'));
    await settled();
    expect(document.body.textContent).toContain('Discard This Rubric?');
  });

  it('Duplicate Criterion carries the comments', async () => {
    openAssignments(seed, CID, {});
    await settled();
    await editRubric();
    click(card().querySelector('[data-action="geMenu"][data-i="0"]'));
    await settled();
    click(card().querySelector('[data-action="geDupCrit"][data-i="0"]'));
    await settled();
    expect(card().querySelectorAll('.af-ge-grid tbody tr')).toHaveLength(4);
    const copy = document.querySelectorAll('.af-ge-grid tbody tr')[1];
    expect([...copy.querySelectorAll('.af-cm')].map(b => b.getAttribute('title'))).toEqual([
      'Safe from start to finish.',
      'Goggles on, every time.',
      'Remember your goggles.',
    ]);
  });
});

describe('copies, the Bank and the printouts', () => {
  beforeEach(() => seed());

  it('a rubric duplicated in its class carries every comment, and new ids', () => {
    const copy = RubricBank.duplicate(CID, RUBRIC);
    expect(copy.criteria[0].comments).toEqual(getRubricById(CID, RUBRIC).criteria[0].comments);
    expect(copy.overallComments).toEqual(['Thank you for a careful lab.']);
    expect(copy.criteria[0].id).not.toBe(SAFETY);
  });

  it('a rubric copied to another class carries them', () => {
    const clone = RubricLibrary.cloneRubric(CID, U(2), getRubricById(CID, RUBRIC));
    expect(clone.criteria[0].comments).toHaveLength(3);
    expect(clone.criteria[0].comments[0]).toEqual({ level: 3, text: 'Safe from start to finish.' });
    expect(clone.overallComments).toEqual(['Thank you for a careful lab.']);
  });

  it('a changed comment is a change the other classes are offered', () => {
    const before = structuredClone(getRubricById(CID, RUBRIC));
    const after = structuredClone(before);
    after.criteria[0].comments[0].text = 'Safe, start to finish.';
    after.overallComments = ['Thanks for a careful lab.'];
    const copy = RubricLibrary.cloneRubric(CID, U(2), before);
    const plan = RubricLibrary.planLinkedEdit(CID, before, after, U(2), copy);
    expect(plan.changed).toBe(true);
    expect(plan.lines).toEqual(['Overall comments updated', 'Comments of “Safety” updated']);
    expect(plan.next.criteria[0].comments[0].text).toBe('Safe, start to finish.');
    expect(plan.next.overallComments).toEqual(['Thanks for a careful lab.']);
    // The same rubric, no change: nothing to offer.
    expect(RubricLibrary.planLinkedEdit(CID, before, structuredClone(before), U(2), copy).changed).toBe(false);
  });

  it('the Rubric Bank grid and the printed sheet never show a comment', () => {
    const rubric = getRubricById(CID, RUBRIC);
    const grid = RubricBank.gridHtml(CID, rubric);
    expect(grid).toContain('On their own');
    expect(grid).not.toContain('Safe from start');
    expect(grid).not.toContain('Goggles');
    expect(grid).not.toContain('careful lab');
    const data = RubricPrint.sheetData(CID, LAB, AVA);
    const sheet = RubricPrint.renderSheet(data, {
      include: { feedback: true, criterionComments: true, codes: true, overall: true },
    });
    expect(sheet).toContain('On their own');
    expect(sheet).not.toContain('Safe from start');
    expect(sheet).not.toContain('Goggles');
    expect(sheet).not.toContain('careful lab');
  });
});
