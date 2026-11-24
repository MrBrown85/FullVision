/**
 * New Reflection, the builder (teacher/cm-reflect-builder.js;
 * docs/plans/reflect-plan.md, board 2 and "The data contract"), and a
 * teacher-built reflection's card on the Reflect tab: Copy to Another Class
 * and Delete, in Demo Mode.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (typeof CmReflectBuilder === 'undefined')
  runInThisContext(readFileSync(resolve(ROOT, 'teacher/cm-reflect-builder.js'), 'utf-8'), {
    filename: 'teacher/cm-reflect-builder.js',
  });

const CID = 'course-rb';
const OTHER = 'course-rb2';
const tick = () => new Promise(r => setTimeout(r, 10));
const B = () => CmReflectBuilder;

function draft(kind, more) {
  var d = B().fromSaved({ kind: kind, prompt: '', options: {} });
  return Object.assign(d, more || {});
}

describe('the builder’s save output follows the contract for every kind', () => {
  it('Text: one line sends long false; a box sends nothing', () => {
    expect(B().toContract(draft('text', { prompt: ' What did you learn? ', long: false, required: true }))).toEqual({
      prompt: 'What did you learn?',
      kind: 'text',
      options: { required: true, long: false },
      core_ids: [],
      repeated_key: null,
      teacher_only: false,
    });
    expect(B().toContract(draft('text', { prompt: 'Tell me more', long: true })).options).toEqual({});
  });

  it('Choice: choices, multiple false for one answer, other, dropdown and shuffle; empty lines dropped', () => {
    var d = draft('choice', {
      prompt: 'Which helped?',
      choices: ['Labs', ' Notes ', ''],
      multiple: false,
      other: true,
      dropdown: true,
      shuffle: true,
      subtitle: 'Pick the one that helped most',
    });
    expect(B().toContract(d).options).toEqual({
      subtitle: 'Pick the one that helped most',
      choices: ['Labs', 'Notes'],
      multiple: false,
      other: true,
      dropdown: true,
      shuffle: true,
    });
    // Many answers: multiple absent, and never a drop-down.
    expect(
      B().toContract(Object.assign(d, { multiple: true, other: false, shuffle: false, subtitle: null })).options,
    ).toEqual({
      choices: ['Labs', 'Notes'],
    });
  });

  it('Rating: levels 2 to 10 and the two end words', () => {
    expect(
      B().toContract(draft('rating', { prompt: 'How sure?', levels: 4, low: 'Not Yet', high: 'Could Teach It' }))
        .options,
    ).toEqual({
      levels: 4,
      low: 'Not Yet',
      high: 'Could Teach It',
    });
    expect(B().toContract(draft('rating', { prompt: 'How sure?', levels: 40 })).options).toEqual({ levels: 5 });
  });

  it('Date takes no options; Ranking its items; Likert statements and columns; Section its subtitle', () => {
    expect(B().toContract(draft('date', { prompt: 'When?' })).options).toEqual({});
    expect(B().toContract(draft('ranking', { prompt: 'Order', choices: ['A', 'B', 'C'] })).options).toEqual({
      choices: ['A', 'B', 'C'],
    });
    expect(
      B().toContract(
        draft('likert', { prompt: 'How often?', statements: ['I asked', ''], columns: ['Never', 'Always'] }),
      ).options,
    ).toEqual({ statements: ['I asked'], choices: ['Never', 'Always'] });
    expect(B().toContract(draft('section', { prompt: 'Part 2', subtitle: 'About labs', required: true }))).toEqual({
      prompt: 'Part 2',
      kind: 'section',
      options: { subtitle: 'About labs' },
      core_ids: [],
      repeated_key: null,
      teacher_only: false,
    });
  });

  it('a saved question reads back as the same question', () => {
    var saved = {
      id: 'qq1',
      prompt: 'Which helped?',
      kind: 'choice',
      options: { required: true, choices: ['Labs', 'Notes'], multiple: false, other: true },
      core_ids: [],
      repeated_key: null,
      teacher_only: false,
    };
    expect(B().toContract(B().fromSaved(saved))).toEqual(saved);
    var likert = { prompt: 'How often?', kind: 'likert', options: { statements: ['S'], choices: ['A', 'B'] } };
    expect(B().toContract(B().fromSaved(likert)).options).toEqual(likert.options);
  });
});

describe('the builder checks before saving, in plain words', () => {
  it('names each problem', () => {
    var e = B().validate(
      {
        title: ' ',
        closes: '2020-01-01',
        questions: [
          draft('section', { k: 's', prompt: '' }),
          draft('text', { k: 't', prompt: '' }),
          draft('choice', { k: 'c', prompt: 'Q', choices: ['Only one', ''] }),
          draft('choice', { k: 'd', prompt: 'Q', choices: ['Same', 'same'] }),
          draft('ranking', { k: 'r', prompt: 'Q', choices: ['A'] }),
          draft('likert', { k: 'l', prompt: 'Q', statements: [''], columns: ['A', 'B'] }),
          draft('rating', { k: 'ok', prompt: 'Fine' }),
        ],
      },
      '2026-11-16',
    );
    expect(e.title).toBe('Give the reflection a title.');
    expect(e.closes).toBe('Pick today or a later day, or leave it empty.');
    expect(e.none).toBeUndefined();
    expect(e.q).toEqual({
      s: 'Write the heading.',
      t: 'Write the question.',
      c: 'Give at least two options.',
      d: 'Two options say the same thing.',
      r: 'Give at least two items to put in order.',
      l: 'Give at least one statement and two columns.',
    });
  });

  it('a section heading alone is not a question', () => {
    var e = B().validate({ title: 'T', questions: [draft('section', { prompt: 'Part 1' })] });
    expect(e.none).toBe('Add at least one question.');
    expect(B().validate({ title: 'T', questions: [draft('date', { prompt: 'When?' })] })).toBeNull();
  });
});

function dom() {
  return parseHTML('<!doctype html><html><head></head><body></body></html>').document;
}

describe('building a reflection on the Reflect tab (Demo Mode)', () => {
  var originals;
  var root;

  function mount() {
    root.innerHTML = CmQuestionnaires.render(CID);
  }
  function click(selector) {
    var el = root.querySelector(selector);
    expect(el, selector).toBeTruthy();
    DashClassManager.handleAction(el.dataset.action, el);
  }
  function type(selector, value) {
    var el = root.querySelector(selector);
    expect(el, selector).toBeTruthy();
    el.value = value;
    DashClassManager.handleBlur(el);
  }
  function change(selector, value) {
    var el = root.querySelector(selector);
    expect(el, selector).toBeTruthy();
    // linkedom: a select's value is read from its selected option.
    el.querySelectorAll('option').forEach(o => o.removeAttribute('selected'));
    el.querySelector('option[value="' + value + '"]').setAttribute('selected', '');
    DashClassManager.handleChange(el);
  }
  const customs = cid => Questionnaires.list(cid).filter(q => q.kind === 'custom');

  beforeEach(async () => {
    localStorage.clear();
    originals = {
      isDemoMode: globalThis.isDemoMode,
      document: globalThis.document,
      rerender: DashClassManager.renderClassManager,
      confirm: globalThis.showConfirm,
      open: window.open,
    };
    globalThis.isDemoMode = () => true;
    globalThis.document = dom();
    DashClassManager.renderClassManager = () => mount();
    Questionnaires._reset();
    CmQuestionnaires._reset();
    saveCourses({
      [CID]: { id: CID, name: 'Science 8', gradeLevel: '8', gradingSystem: 'proficiency' },
      [OTHER]: { id: OTHER, name: 'Science 9', gradeLevel: '9', gradingSystem: 'proficiency' },
    });
    saveStudents(CID, [
      { id: 'e1', firstName: 'Maya', lastName: 'Ross', preferred: '' },
      { id: 'e2', firstName: 'Jayden', lastName: 'Lee', preferred: '' },
    ]);
    root = document.createElement('div');
    document.body.appendChild(root);
    await Questionnaires.load(CID);
  });

  afterEach(() => {
    root.remove();
    globalThis.isDemoMode = originals.isDemoMode;
    globalThis.document = originals.document;
    globalThis.showConfirm = originals.confirm;
    window.open = originals.open;
    DashClassManager.renderClassManager = originals.rerender;
  });

  it('builds one of every kind, saves it On, and shows its card', async () => {
    mount();
    click('[data-action="sqNew"]');
    expect(root.querySelector('.rb-build .cm-section-title').textContent).toBe('New Reflection');
    expect([...root.querySelectorAll('.rb-add-btn')].map(b => b.textContent)).toEqual([
      'Choice',
      'Text',
      'Rating',
      'Date',
      'Ranking',
      'Likert',
      'Heading',
    ]);
    type('#rb-name', 'Unit 2 Exit Reflection');
    type('#rb-desc', 'About 5 minutes.');
    // The first card is a Choice, open.
    type('.rb-q-on [data-rb-path="prompt"]', 'Which helped you learn the most?');
    type('.rb-q-on [data-rb-path="choices.0"]', 'Labs');
    type('.rb-q-on [data-rb-path="choices.1"]', 'Notes');
    click('.rb-q-on [data-action="sqBOther"][data-on="1"]');
    click('.rb-q-on [data-action="sqBToggle"][data-opt="required"]');
    click('.rb-q-on [data-action="sqBMenu"]');
    expect([...root.querySelectorAll('.rb-qmenu-item')].map(b => b.textContent)).toEqual([
      'Add a Subtitle',
      'Shuffle Options',
      'Show as a Drop-Down',
      'Move Up',
      'Move Down',
    ]);
    // The only card: it can move neither way.
    expect([...root.querySelectorAll('.rb-qmenu-item[data-action^="sqB"]')].filter(b => b.disabled)).toHaveLength(2);
    click('.rb-qmenu-item[data-opt="shuffle"]');
    expect(root.querySelector('.rb-qmenu')).toBeNull();

    click('[data-action="sqBAdd"][data-kind="text"]');
    type('.rb-q-on [data-rb-path="prompt"]', 'What do you understand better?');
    click('.rb-q-on [data-action="sqBToggle"][data-opt="long"]');

    click('[data-action="sqBAdd"][data-kind="rating"]');
    type('.rb-q-on [data-rb-path="prompt"]', 'How confident are you?');
    change('.rb-q-on [data-action-change="sqBLevels"]', '4');
    type('.rb-q-on [data-rb-path="low"]', 'Not Yet');
    type('.rb-q-on [data-rb-path="high"]', 'Could Teach It');

    click('[data-action="sqBAdd"][data-kind="date"]');
    type('.rb-q-on [data-rb-path="prompt"]', 'When is your test?');

    click('[data-action="sqBAdd"][data-kind="ranking"]');
    type('.rb-q-on [data-rb-path="prompt"]', 'Put these in order.');
    type('.rb-q-on [data-rb-path="choices.0"]', 'Labs');
    type('.rb-q-on [data-rb-path="choices.1"]', 'Notes');
    click('.rb-q-on [data-action="sqBOptRemove"][data-j="2"]');

    click('[data-action="sqBAdd"][data-kind="likert"]');
    type('.rb-q-on [data-rb-path="prompt"]', 'How often did you do each?');
    type('.rb-q-on [data-rb-path="statements.0"]', 'I asked questions');

    click('[data-action="sqBAdd"][data-kind="section"]');
    type('.rb-q-on [data-rb-path="prompt"]', 'Last Part');
    // The Likert moves down one, under the heading, from its ⋯ menu; it stays open.
    click('[data-action="sqBEdit"][data-i="5"]');
    click('.rb-q-on [data-action="sqBMenu"]');
    click('.rb-qmenu-item[data-action="sqBDown"]');
    expect(CmReflectBuilder._state().active).toBe(6);
    expect(
      CmReflectBuilder._state()
        .questions.map(d => d.kind)
        .slice(5),
    ).toEqual(['section', 'likert']);

    // The cards not being edited show as students see them.
    var views = [...root.querySelectorAll('.rb-q-view .rb-v-prompt')].map(b => b.textContent);
    expect(views[0]).toBe('1. Which helped you learn the most? *');
    expect(root.querySelectorAll('.rb-q-view .rb-v-kind')[2].textContent).toBe('Rating · 4 Levels');

    click('[data-action="sqBSave"][data-on="1"]');
    await tick();
    expect(root.querySelector('.rb-build')).toBeNull();
    var [q] = customs(CID);
    expect(q).toMatchObject({
      kind: 'custom',
      title: 'Unit 2 Exit Reflection',
      theme: 'About 5 minutes.',
      template_id: null,
      report_period: null,
      parent_id: null,
      is_on: true,
      closes_on: null,
    });
    expect(q.opens_on).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(
      q.questions.map(x => ({
        prompt: x.prompt,
        kind: x.kind,
        options: x.options,
        core_ids: x.core_ids,
        teacher_only: x.teacher_only,
      })),
    ).toEqual([
      {
        prompt: 'Which helped you learn the most?',
        kind: 'choice',
        options: { required: true, choices: ['Labs', 'Notes'], multiple: false, other: true, shuffle: true },
        core_ids: [],
        teacher_only: false,
      },
      {
        prompt: 'What do you understand better?',
        kind: 'text',
        options: { long: false },
        core_ids: [],
        teacher_only: false,
      },
      {
        prompt: 'How confident are you?',
        kind: 'rating',
        options: { levels: 4, low: 'Not Yet', high: 'Could Teach It' },
        core_ids: [],
        teacher_only: false,
      },
      { prompt: 'When is your test?', kind: 'date', options: {}, core_ids: [], teacher_only: false },
      {
        prompt: 'Put these in order.',
        kind: 'ranking',
        options: { choices: ['Labs', 'Notes'] },
        core_ids: [],
        teacher_only: false,
      },
      { prompt: 'Last Part', kind: 'section', options: {}, core_ids: [], teacher_only: false },
      {
        prompt: 'How often did you do each?',
        kind: 'likert',
        options: { statements: ['I asked questions'], choices: ['Never', 'Sometimes', 'Usually', 'Always'] },
        core_ids: [],
        teacher_only: false,
      },
    ]);
    expect(CmQuestionnaires.countOn(CID)).toBe(1);
    // Saved on this device.
    expect(JSON.parse(localStorage.getItem('gb-questionnaires-' + CID)).some(x => x.kind === 'custom')).toBe(true);

    var card = root.querySelector('[data-card="custom-' + q.id + '"]');
    expect(card.querySelector('.sq-name').textContent).toBe('Unit 2 Exit Reflection');
    expect(card.querySelector('.sq-desc').textContent).toBe('About 5 minutes. · 6 questions');
    expect(card.querySelector('.sq-facts').textContent).toContain('In Students’ Reflect TabUntil you turn it off');
    expect([...card.querySelectorAll('.sq-actions button')].map(b => b.textContent)).toEqual([
      'Show Questions',
      'Set a Closing Date',
      'Delete',
    ]);
    expect(card.querySelector('select[data-action-change="sqCopyTo"] option[value="' + OTHER + '"]').textContent).toBe(
      'Science 9',
    );
  });

  it('marks what stops a save beside the problem, and saves once it is fixed', async () => {
    mount();
    click('[data-action="sqNew"]');
    click('[data-action="sqBSave"][data-on="0"]');
    expect(customs(CID)).toHaveLength(0);
    expect([...root.querySelectorAll('.rb-err')].map(e => e.textContent)).toEqual([
      'Give the reflection a title.',
      'Write the question.',
    ]);
    expect(root.querySelector('.rb-msg').textContent).toBe('Fix the problems marked above, then save again.');
    type('#rb-name', 'Quick Check');
    type('.rb-q-on [data-rb-path="prompt"]', 'Pick one');
    type('.rb-q-on [data-rb-path="choices.0"]', 'Yes');
    click('[data-action="sqBSave"][data-on="0"]');
    expect(root.querySelector('.rb-q-bad .rb-err').textContent).toBe('Give at least two options.');
    type('.rb-q-on [data-rb-path="choices.1"]', 'No');
    click('[data-action="sqBSave"][data-on="0"]');
    await tick();
    var [q] = customs(CID);
    expect(q).toMatchObject({ title: 'Quick Check', is_on: false, opens_on: null, closes_on: null });
    mount();
    var card = root.querySelector('[data-card="custom-' + q.id + '"]');
    expect(card.classList.contains('sq-off')).toBe(true);
    expect(card.querySelector('.sq-desc').textContent).toBe(
      'Your own · 1 question · Students do not see this while it is off',
    );
  });

  it('Cancel with changes asks first; editing keeps the question ids; Preview writes the draft', async () => {
    var asked = [];
    globalThis.showConfirm = (title, msg, ok, style, go) => asked.push({ title, msg, ok, go });
    var q = await Questionnaires.saveCustom(CID, {
      title: 'Exit Ticket',
      theme: '',
      is_on: false,
      questions: [
        { prompt: 'One thing', kind: 'text', options: {} },
        { prompt: 'Rate it', kind: 'rating', options: { levels: 5 } },
      ],
    });
    var ids = q.questions.map(x => x.id);
    mount();
    click('[data-card="custom-' + q.id + '"] [data-action="sqEdit"]');
    expect(root.querySelector('.rb-build .cm-section-title').textContent).toBe('Edit Reflection');
    // Nothing changed: Cancel closes at once.
    click('[data-action="sqBCancel"]');
    expect(asked).toHaveLength(0);
    expect(root.querySelector('.rb-build')).toBeNull();

    click('[data-card="custom-' + q.id + '"] [data-action="sqEdit"]');
    click('[data-action="sqBEdit"][data-i="1"]');
    click('.rb-q-on [data-action="sqBMenu"]');
    click('.rb-qmenu-item[data-action="sqBUp"]');
    type('#rb-name', 'Exit Ticket 2');
    click('[data-action="sqBCancel"]');
    expect(asked.map(a => a.title)).toEqual(['Discard Your Changes?']);
    expect(root.querySelector('.rb-build')).toBeTruthy();

    var opened = [];
    window.open = url => (opened.push(url), {});
    click('[data-action="sqBPreview"]');
    expect(opened).toHaveLength(1);
    expect(opened[0]).toMatch(/^\/s\/\?preview=\d+#preview-reflection$/);
    var preview = JSON.parse(localStorage.getItem('fv-reflect-preview'));
    expect(preview.title).toBe('Exit Ticket 2');
    expect(preview.course).toEqual({ name: 'Science 8' });
    expect(preview.questions.map(x => x.id)).toEqual([ids[1], ids[0]]);

    click('[data-action="sqBSave"][data-on="0"]');
    await tick();
    var saved = Questionnaires.find(CID, x => x.id === q.id);
    expect(saved.title).toBe('Exit Ticket 2');
    expect(saved.questions.map(x => x.id)).toEqual([ids[1], ids[0]]);
  });

  it('a second Preview opens a new address, so a window already open reads the new draft', async () => {
    var q = await Questionnaires.saveCustom(CID, {
      title: 'Exit Ticket',
      is_on: false,
      questions: [{ prompt: 'One thing', kind: 'text', options: {} }],
    });
    mount();
    click('[data-card="custom-' + q.id + '"] [data-action="sqEdit"]');
    var opened = [];
    window.open = url => (opened.push(url), {});
    var now = Date.now;
    try {
      Date.now = () => 1000;
      click('[data-action="sqBPreview"]');
      Date.now = () => 2000;
      click('[data-action="sqBPreview"]');
    } finally {
      Date.now = now;
    }
    expect(opened).toEqual(['/s/?preview=1000#preview-reflection', '/s/?preview=2000#preview-reflection']);
  });

  it('a reflection on but past its closing date is Off in the builder: Keep Off leaves the date, Turn On clears it', async () => {
    var q = await Questionnaires.saveCustom(CID, {
      title: 'Exit Ticket',
      is_on: true,
      opens_on: '2000-01-01',
      closes_on: '2000-02-01',
      questions: [{ prompt: 'One thing', kind: 'text', options: {} }],
    });
    mount();
    click('[data-card="custom-' + q.id + '"] [data-action="sqEdit"]');
    expect([...root.querySelectorAll('.rb-buttons [data-action="sqBSave"]')].map(b => b.textContent)).toEqual([
      'Save, Keep Off',
      'Save and Turn On',
    ]);
    // The past date it already has is not refused, and stays.
    type('#rb-name', 'Exit Ticket 2');
    click('[data-action="sqBSave"][data-on="0"]');
    await tick();
    expect(root.querySelector('.rb-build')).toBeNull();
    var saved = Questionnaires.find(CID, x => x.id === q.id);
    expect(saved.title).toBe('Exit Ticket 2');
    expect(saved.is_on).toBe(false);
    expect(saved.closes_on).toBe('2000-02-01');

    // A past date the teacher picks is refused.
    click('[data-card="custom-' + q.id + '"] [data-action="sqEdit"]');
    type('#rb-closes', '2000-03-01');
    click('[data-action="sqBSave"][data-on="0"]');
    await tick();
    expect(root.querySelector('.rb-closes .rb-err').textContent).toBe('Pick today or a later day, or leave it empty.');
    type('#rb-closes', '2000-02-01');

    // Turned On with the past date untouched: on, and the date goes.
    click('[data-action="sqBSave"][data-on="1"]');
    await tick();
    saved = Questionnaires.find(CID, x => x.id === q.id);
    expect(saved.is_on).toBe(true);
    expect(saved.closes_on).toBe(null);
    expect(Questionnaires.status(saved).state).toBe('open');
  });

  it('a saved question changed to another kind loses its id; changed back, it has it again', async () => {
    var q = await Questionnaires.saveCustom(CID, {
      title: 'Exit Ticket',
      is_on: false,
      questions: [
        { prompt: 'One thing', kind: 'text', options: {} },
        { prompt: 'Rate it', kind: 'rating', options: { levels: 5 } },
      ],
    });
    var ids = q.questions.map(x => x.id);
    mount();
    click('[data-card="custom-' + q.id + '"] [data-action="sqEdit"]');
    click('[data-action="sqBEdit"][data-i="0"]');
    change('.rb-q-on [data-action-change="sqBType"]', 'choice');
    expect(B()._state().questions[0].id).toBeUndefined();
    expect(B().toContract(B()._state().questions[0])).not.toHaveProperty('id');
    change('.rb-q-on [data-action-change="sqBType"]', 'text');
    expect(B()._state().questions[0].id).toBe(ids[0]);
    change('.rb-q-on [data-action-change="sqBType"]', 'date');
    click('[data-action="sqBSave"][data-on="0"]');
    await tick();
    var saved = Questionnaires.find(CID, x => x.id === q.id);
    var live = saved.questions.filter(x => !x.archived);
    expect(live.map(x => x.kind)).toEqual(['date', 'rating']);
    expect(live[0].id).not.toBe(ids[0]);
    expect(live[1].id).toBe(ids[1]);
  });

  it('Copy to Another Class saves the same reflection there, Off, with no question ids', async () => {
    var q = await Questionnaires.saveCustom(CID, {
      title: 'Exit Ticket',
      theme: 'Two minutes',
      is_on: true,
      opens_on: '2026-11-01',
      questions: [{ prompt: 'One thing', kind: 'text', options: { required: true } }],
    });
    mount();
    change('[data-card="custom-' + q.id + '"] select[data-action-change="sqCopyTo"]', OTHER);
    await tick();
    var there = JSON.parse(localStorage.getItem('gb-questionnaires-' + OTHER));
    expect(there).toHaveLength(1);
    expect(there[0]).toMatchObject({ kind: 'custom', title: 'Exit Ticket', theme: 'Two minutes', is_on: false });
    expect(there[0].id).not.toBe(q.id);
    expect(there[0].questions[0]).toMatchObject({ prompt: 'One thing', kind: 'text', options: { required: true } });
    expect(there[0].questions[0].id).not.toBe(q.questions[0].id);
    expect(root.querySelector('.sq-msg').textContent).toBe(
      'Copied to Science 9. It is off there until you turn it on.',
    );
  });

  it('Delete asks first and deletes one nobody has answered; one with answers cannot be deleted', async () => {
    var asked = [];
    globalThis.showConfirm = (title, msg, ok, style, go) => asked.push({ title, msg, ok, style, go });
    var q = await Questionnaires.saveCustom(CID, {
      title: 'Exit Ticket',
      is_on: true,
      questions: [{ prompt: 'One thing', kind: 'text', options: {} }],
    });
    var answered = await Questionnaires.saveCustom(CID, {
      title: 'Answered One',
      is_on: true,
      questions: [{ prompt: 'One thing', kind: 'text', options: {} }],
    });
    answered.answered = ['e1'];
    mount();
    click('[data-card="custom-' + q.id + '"] [data-action="sqDelete"]');
    expect(asked[0]).toMatchObject({
      title: 'Delete This Reflection?',
      msg: '“Exit Ticket” is deleted from this class. This cannot be undone.',
      ok: 'Delete',
      style: 'danger',
    });
    expect(customs(CID)).toHaveLength(2);
    asked[0].go();
    await tick();
    expect(customs(CID).map(x => x.id)).toEqual([answered.id]);
    expect(JSON.parse(localStorage.getItem('gb-questionnaires-' + CID)).some(x => x.id === q.id)).toBe(false);

    var card = root.querySelector('[data-card="custom-' + answered.id + '"]');
    // One students have answered: Delete asks nothing and says why it can't be.
    expect(card.querySelector('.sq-msg')).toBeNull();
    click('[data-card="custom-' + answered.id + '"] [data-action="sqDelete"]');
    expect(asked).toHaveLength(1);
    expect(root.querySelector('[data-card="custom-' + answered.id + '"] .sq-msg').textContent).toBe(
      'Students have answered this, so it can’t be deleted. Turn it off to take it out of their Reflect tab.',
    );
    // Demo Mode's remove follows the server's rule.
    expect(await Questionnaires.remove(CID, answered.id)).toEqual({ refused: true });
    expect(customs(CID)).toHaveLength(1);
  });

  it('a delete the server refuses keeps the card and says why', async () => {
    var stubV2 = window.v2;
    try {
      globalThis.isDemoMode = () => false;
      Questionnaires._reset();
      var row = {
        id: '22222222-2222-2222-2222-222222222222',
        course_id: CID,
        kind: 'custom',
        title: 'Exit Ticket',
        is_on: true,
        opens_on: '2000-01-01',
        questions: [],
        answered: [],
      };
      window.v2 = Object.assign({}, stubV2, {
        listCourseQuestionnaires: () => Promise.resolve({ data: [row] }),
        listQuestionnaireTemplates: () => Promise.resolve({ data: null }),
        deleteQuestionnaire: () => Promise.resolve({ data: null, error: { code: '23503', message: 'refused' } }),
      });
      await Questionnaires.load(CID);
      globalThis.showConfirm = (t, m, o, s, go) => go();
      mount();
      click('[data-card="custom-' + row.id + '"] [data-action="sqDelete"]');
      await tick();
      expect(customs(CID)).toHaveLength(1);
      expect(root.querySelector('[data-card="custom-' + row.id + '"] .sq-msg').textContent).toBe(
        'Students have answered this, so it can’t be deleted. Turn it off to take it out of their Reflect tab.',
      );
    } finally {
      window.v2 = stubV2;
    }
  });
});
