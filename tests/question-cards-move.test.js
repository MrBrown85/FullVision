/**
 * Characterization test for Q2a (docs/plans/quizzes-plan.md): moving Reflect's
 * question-card drawing into teacher/question-cards.js must change nothing.
 * tests/fixtures/question-cards-move.json holds what render(cid) and
 * previewHtml returned on the code before the move. Every string must match
 * exactly. Never regenerate the fixture after the move
 * (UPDATE_QUESTION_CARDS_FIXTURE=1 rewrites it; it was run once, before).
 * One edit by hand since: "Section Heading" became "Heading" (DECISIONS,
 * "Reflect's builder works the way One Report's editor does" 1), a find and
 * replace of those words only.
 * Rewritten once since, on purpose, when Reflect's cards began to move as
 * One Report's do (same entry, 2): every difference was checked to be a ⠿
 * grip, the ↑ ↓ buttons gone, or the ⋯ menu's moving items (and a ⋯ on a
 * heading's card). It guards Reflect's output from here on.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE = resolve(ROOT, 'tests/fixtures/question-cards-move.json');
if (typeof CmReflectBuilder === 'undefined')
  runInThisContext(readFileSync(resolve(ROOT, 'teacher/cm-reflect-builder.js'), 'utf-8'), {
    filename: 'teacher/cm-reflect-builder.js',
  });

const CID = 'course-qc';
const B = () => CmReflectBuilder;

const SAVED = [
  { id: 'a1', kind: 'section', prompt: 'Part One <b>& more</b>', options: { subtitle: 'Read "slowly"' } },
  {
    id: 'a2',
    kind: 'choice',
    prompt: 'Which helped? <i>x</i>',
    options: { choices: ['Labs', 'Notes & <b>'], multiple: false },
  },
  {
    id: 'a3',
    kind: 'choice',
    prompt: 'Pick all',
    options: { choices: ['One', '', 'Three'], multiple: true, other: true, required: true, subtitle: 'Any number' },
  },
  {
    id: 'a4',
    kind: 'choice',
    prompt: 'Pick from a list',
    options: { choices: ['A', 'B'], multiple: false, dropdown: true, shuffle: true, other: true },
  },
  { id: 'a5', kind: 'text', prompt: 'Short answer', options: { long: false, required: true } },
  { id: 'a6', kind: 'text', prompt: 'Long answer', options: {} },
  { id: 'a7', kind: 'rating', prompt: 'How sure?', options: { levels: 7, low: 'Not Yet', high: 'Could Teach It' } },
  { id: 'a8', kind: 'rating', prompt: 'Default rating', options: {} },
  { id: 'a9', kind: 'date', prompt: 'When?', options: { required: true } },
  { id: 'a10', kind: 'ranking', prompt: 'Order these', options: { choices: ['First', 'Second', ''] } },
  {
    id: 'a11',
    kind: 'likert',
    prompt: 'How often?',
    options: { statements: ['I try', 'I ask <u>'], choices: ['Never', 'Sometimes', 'Usually', 'Always'] },
  },
  { id: 'a12', kind: 'text', prompt: '', options: {} },
  { id: 'a13', kind: 'text', prompt: 'Gone', archived: true, options: {} },
];

const BAD = [
  { id: 'b1', kind: 'section', prompt: '', options: {} },
  { id: 'b2', kind: 'choice', prompt: 'One option', options: { choices: ['Only'] } },
  { id: 'b3', kind: 'choice', prompt: 'Dupes', options: { choices: ['Same', 'same'] } },
  { id: 'b4', kind: 'ranking', prompt: 'Rank', options: { choices: ['x'] } },
  { id: 'b5', kind: 'likert', prompt: 'Lik', options: { statements: [], choices: ['a'] } },
  { id: 'b6', kind: 'text', prompt: '', options: {} },
];

const reflection = (questions, extra) =>
  Object.assign(
    {
      id: 'q1',
      title: 'Exit <Reflection>',
      theme: 'About "5" minutes.',
      closes_on: '2099-01-01',
      is_on: false,
      questions,
    },
    extra || {},
  );

function record() {
  const out = {};
  const reset = () => B()._reset();
  // Every card of the full reflection open in turn, with the menu shut and open.
  SAVED.filter(x => !x.archived).forEach((_, n) => {
    reset();
    B().open(CID, reflection(SAVED));
    B()._state().active = n;
    out['full-active-' + n] = B().render(CID);
    B()._state().menu = n;
    out['full-active-' + n + '-menu'] = B().render(CID);
  });
  reset();
  B().open(CID, reflection(SAVED));
  out['full-none-active'] = B().render(CID);
  out['full-preview'] = B().previewHtml(SAVED);
  out['preview-empty'] = B().previewHtml([]);
  out['preview-null'] = B().previewHtml(null);
  // A saved reflection that was on, with answers.
  reset();
  B().open(CID, reflection(SAVED.slice(1, 3), { is_on: true, answered: ['e1'], closes_on: '' }));
  B()._state().active = 1;
  out['reopened-on-answered'] = B().render(CID);
  // An empty draft.
  reset();
  B().open(CID, null);
  out['empty-draft'] = B().render(CID);
  B()._state().showErrors = true;
  out['empty-draft-errors'] = B().render(CID);
  // The validation messages showing, each bad card open and shut.
  reset();
  B().open(CID, reflection(BAD, { title: '' }));
  B()._state().showErrors = true;
  out['bad-errors-none-active'] = B().render(CID);
  BAD.forEach((_, n) => {
    B()._state().active = n;
    out['bad-errors-active-' + n] = B().render(CID);
  });
  B()._state().msg = 'A message & <b>';
  B()._state().saving = true;
  out['bad-msg-saving'] = B().render(CID);
  // First and last card tool states (Move Up / Move Down off).
  reset();
  B().open(CID, reflection(SAVED.slice(1, 4)));
  [0, 1, 2].forEach(n => {
    B()._state().active = n;
    out['three-active-' + n] = B().render(CID);
  });
  reset();
  B().open(CID, reflection(SAVED.slice(1, 2)));
  B()._state().active = 0;
  out['one-card-active'] = B().render(CID);
  B().close();
  out['closed'] = B().render(CID);
  reset();
  return out;
}

describe('Reflect builder output is unchanged by the question-cards move', () => {
  const got = record();
  if (process.env.UPDATE_QUESTION_CARDS_FIXTURE === '1') {
    writeFileSync(FIXTURE, JSON.stringify(got, null, 1) + '\n');
  }
  const want = JSON.parse(readFileSync(FIXTURE, 'utf-8'));

  it('records the same set of drafts', () => {
    expect(Object.keys(got).sort()).toEqual(Object.keys(want).sort());
    expect(Object.keys(want).length).toBeGreaterThan(40);
  });

  for (const name of Object.keys(want)) {
    it(name, () => {
      expect(got[name]).toBe(want[name]);
    });
  }

  it('covers every kind in an edit card and a read card', () => {
    const all = Object.values(want).join('\n');
    for (const k of [
      'rb-v-long',
      'rb-v-date',
      'rb-v-levels',
      'rb-v-rank',
      'rb-v-likert',
      'rb-v-section',
      'rb-v-select',
      'rb-mark-check',
      'rb-qmenu',
      'rb-err',
      'rb-q-edit',
    ])
      expect(all, k).toContain(k);
  });
});
