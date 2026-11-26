/**
 * Add From Another Class: the dialog that picks assessments in another
 * class (teacher/add-from-class.js; Colin, Nov 17 2026). What a copy holds
 * is AssessmentCopy's and is tested in tests/assessment.test.js; this file
 * holds what the list shows, what Search, Category, Module and Select All
 * do, the count on the button, and that Add hands the ticked pieces to the
 * same copy as before: a Draft stays a Draft, the dates come along, and no
 * score moves.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseHTML } from 'linkedom';

const A = 'cls-eng9-a';
const B = 'cls-eng9-b';
const H = 'cls-hist12';

function seed(cid, o) {
  _cache.categories[cid] = o.categories || [];
  _cache.learningMaps[cid] = { subjects: [], sections: o.sections || [], _customized: true, _version: 1 };
  _cache.rubrics[cid] = o.rubrics || [];
  _cache.modules[cid] = o.modules || [];
  _cache.assessments[cid] = o.assessments || [];
  _cache.scores[cid] = o.scores || {};
}

const settle = () => new Promise(r => setTimeout(r, 0));
const dialog = () => document.querySelector('.afrom-overlay');
const rows = () => Array.from(document.querySelectorAll('.afrom-row'));
const row = id => document.querySelector('.afrom-row[data-afrom-row="' + id + '"]');
const box = id => row(id).querySelector('.afrom-box');
const titles = () => rows().map(r => r.querySelector('.afrom-name').textContent);
/* linkedom's checked is a plain property: a box drawn ticked has only the attribute. */
const isOn = b => (b.checked === undefined ? b.hasAttribute('checked') : !!b.checked);
const ticked = () =>
  Array.from(document.querySelectorAll('.afrom-list .afrom-box'))
    .filter(isOn)
    .map(b => b.getAttribute('data-afrom-pick'));
const allBox = () => document.querySelector('#afrom-all');
const addBtn = () => document.querySelector('[data-afrom-add]');
const status = () => document.querySelector('#afrom-status').textContent;
const options = sel => Array.from(document.querySelectorAll(sel + ' option')).map(o => o.textContent);
const chip = cid => document.querySelector('[data-afrom-class="' + cid + '"]');

/* A linkedom page: real elements, events and selectors, no layout. It keeps
   no focus and its checkboxes don't tick on a click, so these helpers do
   what a browser does. */
let win = null;
let stubDocument = null;
function page() {
  stubDocument = globalThis.document;
  const dom = parseHTML('<!DOCTYPE html><html><body></body></html>');
  win = dom.window;
  let active = null;
  Object.defineProperty(dom.document, 'activeElement', {
    configurable: true,
    get: () => (active && active.isConnected ? active : dom.document.body),
  });
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(dom.document.createElement('div')));
  proto.focus = function () {
    active = this;
  };
  globalThis.document = dom.document;
}
function fire(el, type, more) {
  const e = new win.Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, more || {});
  el.dispatchEvent(e);
}
const click = el => fire(el, 'click');
function setBox(el, on, shift) {
  fire(el, 'mousedown', { shiftKey: !!shift });
  el.checked = on;
  fire(el, 'click');
  fire(el, 'change');
}
const tick = (id, shift) => setBox(box(id), !isOn(box(id)), shift);
const tickAll = () => setBox(allBox(), !isOn(allBox()));
function type(value) {
  const el = document.querySelector('#afrom-search');
  el.value = value;
  fire(el, 'input');
}
/* Choose an option the way a select reports it: its value is the chosen option's. */
function choose(sel, value) {
  const el = document.querySelector(sel);
  Object.defineProperty(el, 'value', { configurable: true, writable: true, value: value });
  fire(el, 'change');
}

describe('Add From Another Class', () => {
  let originalInit;

  beforeEach(() => {
    localStorage.clear();
    page();
    _useSupabase = false;
    originalInit = globalThis.initData;
    globalThis.initData = () => Promise.resolve();
    saveCourses({
      [A]: { id: A, name: 'English 9 - Block A' },
      [B]: { id: B, name: 'English 9 B' },
      [H]: { id: H, name: 'History 12' },
    });
    seed(A, {
      categories: [
        { id: 'a-quiz', name: 'Quizzes', weight: 40, displayOrder: 0 },
        { id: 'a-ess', name: 'Essays', weight: 60, displayOrder: 1 },
      ],
      rubrics: [
        { id: 'a-rub', name: 'Essay Rubric', criteria: [{ id: 'a-c1', name: 'Ideas', tagIds: [], weight: 1 }] },
      ],
      modules: [{ id: 'a-mod', name: 'Short Stories' }],
      assessments: [
        {
          id: 'a1',
          title: 'Theme Essay',
          date: '2026-11-04',
          categoryId: 'a-ess',
          rubricId: 'a-rub',
          moduleId: 'a-mod',
          tagIds: [],
        },
        {
          id: 'a2',
          title: 'Vocabulary Quiz',
          date: '2026-10-20',
          categoryId: 'a-quiz',
          scoreMode: 'points',
          maxPoints: 12.5,
          tagIds: [],
        },
        { id: 'a3', title: 'Reading Log', date: '2026-10-28', scoreMode: 'complete', tagIds: [] },
        {
          id: 'a4',
          title: 'Point of View',
          date: '2026-11-10',
          categoryId: 'a-ess',
          moduleId: 'a-mod',
          tagIds: [],
          copyGroup: 'g-pov',
        },
        {
          id: 'a5',
          title: 'Conflict',
          date: '2026-11-12',
          dueDate: '2026-11-19',
          categoryId: 'a-ess',
          tagIds: [],
          isDraft: true,
        },
        { id: 'a6', title: 'Fall Benchmark', date: '2026-09-15', scoreMode: 'dibels', tagIds: [] },
        { id: 'a7', title: '  figurative   LANGUAGE ', date: '2026-10-30', categoryId: 'a-ess', tagIds: [] },
      ],
      scores: { 'stu-1': [{ assessmentId: 'a1', score: 3 }] },
    });
    seed(B, {
      categories: [
        { id: 'b-quiz', name: 'Quizzes', weight: 40, displayOrder: 0 },
        { id: 'b-ess', name: 'Essays', weight: 60, displayOrder: 1 },
      ],
      rubrics: [
        { id: 'b-rub', name: 'Essay Rubric', criteria: [{ id: 'b-c1', name: 'Ideas', tagIds: [], weight: 1 }] },
      ],
      modules: [{ id: 'b-mod', name: 'Short Stories' }],
      assessments: [
        { id: 'b4', title: 'Point of View', date: '2026-11-10', categoryId: 'b-ess', tagIds: [], copyGroup: 'g-pov' },
        { id: 'b7', title: 'Figurative Language', date: '2026-10-30', categoryId: 'b-ess', tagIds: [] },
      ],
    });
    seed(H, {});
  });

  afterEach(() => {
    globalThis.document = stubDocument;
    globalThis.initData = originalInit;
  });

  describe('what the list reads', () => {
    it('lists the other class newest first, with category, module, scoring and Draft', () => {
      const list = AddFromClass.rowsFor(A, B);
      expect(list.map(r => r.title)).toEqual([
        'Conflict',
        'Point of View',
        'Theme Essay',
        '  figurative   LANGUAGE ',
        'Reading Log',
        'Vocabulary Quiz',
        'Fall Benchmark',
      ]);
      const by = id => list.find(r => r.id === id);
      expect(by('a1')).toMatchObject({
        category: 'Essays',
        module: 'Short Stories',
        scoring: 'Rubric',
        isDraft: false,
      });
      expect(by('a2')).toMatchObject({ category: 'Quizzes', module: '', scoring: '12.5 Points' });
      expect(by('a3')).toMatchObject({ category: '', scoring: 'Complete/Incomplete' });
      expect(by('a4').scoring).toBe('Competencies');
      expect(by('a5').isDraft).toBe(true);
      expect(by('a6').scoring).toBe('DIBELS');
    });

    it('marks a linked copy this class holds, a same-titled piece, and DIBELS the class cannot take', () => {
      const by = id => AddFromClass.rowsFor(A, B).find(r => r.id === id);
      expect(by('a4')).toMatchObject({ state: 'here', sameTitle: false });
      // Same title, capitals and spacing aside, and not linked: flagged, still addable.
      expect(by('a7')).toMatchObject({ state: 'ok', sameTitle: true });
      expect(by('a1')).toMatchObject({ state: 'ok', sameTitle: false });
      // English 9 is no ELA course by curriculum tag here, so DIBELS is refused, as the copy refuses it.
      expect(by('a6').state).toBe(AssessmentCopy.offersScoreMode(B, { scoreMode: 'dibels' }) ? 'ok' : 'refused');
      expect(AssessmentCopy.offersScoreMode(B, { scoreMode: 'dibels' })).toBe(false);
    });

    it('Search reads the title, category, module and scoring; Category and Module narrow, "-" is none', () => {
      const list = AddFromClass.rowsFor(A, B);
      const ids = f => AddFromClass.filterRows(list, f).map(r => r.id);
      expect(ids({})).toHaveLength(7);
      expect(ids({ q: '  THEME ' })).toEqual(['a1']);
      expect(ids({ q: 'quizzes' })).toEqual(['a2']);
      expect(ids({ q: 'short stories' })).toEqual(['a4', 'a1']);
      expect(ids({ q: 'points' })).toEqual(['a2']);
      expect(ids({ cat: 'a-ess' })).toEqual(['a5', 'a4', 'a1', 'a7']);
      expect(ids({ cat: '-' })).toEqual(['a3', 'a6']);
      expect(ids({ mod: 'a-mod' })).toEqual(['a4', 'a1']);
      expect(ids({ mod: '-', cat: 'a-ess' })).toEqual(['a5', 'a7']);
      expect(ids({ q: 'nothing like this' })).toEqual([]);
    });
  });

  describe('the dialog', () => {
    async function open(done) {
      AddFromClass.open(B, done);
      await settle();
    }

    it('has a Title Case name, says what a copy holds, and offers the same course first', async () => {
      await open();
      expect(document.querySelector('#afrom-title').textContent).toBe('Add From Another Class');
      expect(dialog().getAttribute('role')).toBe('dialog');
      expect(dialog().getAttribute('aria-modal')).toBe('true');
      expect(document.querySelector('#afrom-what').textContent).toBe(
        'Into English 9 B. Each copy brings its dates, settings, rubric and competencies. Student scores are never copied.',
      );
      const chips = Array.from(document.querySelectorAll('[data-afrom-class]'));
      expect(chips.map(c => c.textContent)).toEqual(['English 9 - Block A', 'History 12']);
      expect(chips.map(c => c.getAttribute('aria-checked'))).toEqual(['true', 'false']);
      expect(document.activeElement).toBe(chips[0]);
      expect(titles()).toHaveLength(7);
      expect(status()).toBe('7 assessments, 1 already here.');
      expect(addBtn().disabled).toBe(true);
      expect(addBtn().textContent).toBe('Add');
      // The toolbar's ▾ menu item has the dialog's name.
      const src = readFileSync(new URL('../teacher/assign-toolbar.js', import.meta.url), 'utf-8');
      expect(src).toContain("_item('addFromClass', LINE_ICONS.bringIn, 'Add From Another Class')");
    });

    it('shows a date as the app writes it, never 2026-11-04', async () => {
      await open();
      expect(row('a1').querySelector('.afrom-date').textContent).toBe(formatShortDate('2026-11-04'));
      expect(dialog().textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    });

    it('a piece already here and refused DIBELS cannot be ticked; a same title is flagged', async () => {
      await open();
      expect(row('a4').querySelector('.afrom-chip').textContent).toBe('Already Here');
      expect(box('a4').disabled).toBe(true);
      expect(row('a6').querySelector('.afrom-chip').textContent).toBe('DIBELS Is Only for ELA and Social Studies 8');
      expect(box('a6').disabled).toBe(true);
      expect(row('a7').querySelector('.afrom-chip').textContent).toBe('Same Title Here');
      expect(box('a7').disabled).toBe(false);
      expect(row('a5').querySelector('.draft-badge').textContent).toBe('Draft');
    });

    it('the button counts what is ticked, and Clear unticks it', async () => {
      await open();
      tick('a1');
      expect(addBtn().textContent).toBe('Add 1');
      expect(addBtn().disabled).toBe(false);
      expect(row('a1').classList.contains('is-on')).toBe(true);
      tick('a5');
      expect(addBtn().textContent).toBe('Add 2');
      expect(status()).toBe('2 selected. A Draft stays a Draft until you assign it here. Clear');
      tick('a5');
      expect(addBtn().textContent).toBe('Add 1');
      click(document.querySelector('[data-afrom-clear]'));
      expect(addBtn().textContent).toBe('Add');
      expect(addBtn().disabled).toBe(true);
      expect(ticked()).toEqual([]);
    });

    it('Select All ticks what is shown and can be added, and leaves a same title to the teacher', async () => {
      await open();
      tickAll();
      // Of 7: one is already here, DIBELS is refused, one has a title this class has.
      expect(ticked()).toEqual(['a5', 'a1', 'a3', 'a2']);
      expect(addBtn().textContent).toBe('Add 4');
      expect(status()).toContain('Select All left out 1 with a title this class already has.');
      expect(allBox().checked).toBe(true);
      // One unticked: Select All shows part.
      tick('a1');
      expect(allBox().checked).toBe(false);
      expect(allBox().indeterminate).toBe(true);
      tickAll();
      expect(addBtn().textContent).toBe('Add 4');
      tickAll();
      expect(addBtn().textContent).toBe('Add');

      // Only what is shown.
      choose('#afrom-mod', 'a-mod');
      expect(titles()).toEqual(['Point of View', 'Theme Essay']);
      tickAll();
      expect(addBtn().textContent).toBe('Add 1');
      choose('#afrom-mod', '');
      expect(ticked()).toEqual(['a1']);
    });

    it('Search and Category narrow the list; what is ticked stays ticked and is counted', async () => {
      await open();
      tick('a2');
      type('essay');
      expect(titles()).toEqual(['Conflict', 'Point of View', 'Theme Essay', '  figurative   LANGUAGE ']);
      expect(addBtn().textContent).toBe('Add 1');
      expect(status()).toBe('1 selected (1 not shown). Clear');
      type('zzz');
      expect(titles()).toEqual([]);
      expect(document.querySelector('#afrom-list').textContent).toContain('No assessments match.');
      click(document.querySelector('[data-afrom-reset]'));
      expect(titles()).toHaveLength(7);
      expect(ticked()).toEqual(['a2']);

      expect(options('#afrom-cat')).toEqual(['All Categories', 'Essays', 'Quizzes', 'No Category']);
      expect(options('#afrom-mod')).toEqual(['All Modules', 'Short Stories', 'No Module']);
      choose('#afrom-cat', 'a-quiz');
      expect(titles()).toEqual(['Vocabulary Quiz']);
      expect(status()).toBe('1 selected. Clear');
    });

    it('Shift and a click ticks the run between; the arrow keys walk the rows that can be ticked', async () => {
      await open();
      tick('a5');
      tick('a3', true);
      // Conflict to Reading Log: Point of View is already here and stays unticked.
      expect(ticked()).toEqual(['a5', 'a1', 'a7', 'a3']);
      expect(addBtn().textContent).toBe('Add 4');

      const pick = () => document.activeElement.getAttribute('data-afrom-pick');
      const inTab = () =>
        Array.from(document.querySelectorAll('.afrom-list .afrom-box[tabindex="0"]')).map(b =>
          b.getAttribute('data-afrom-pick'),
        );
      box('a5').focus();
      fire(document, 'keydown', { key: 'ArrowDown' });
      // Past the row that can't be ticked.
      expect(pick()).toBe('a1');
      fire(document, 'keydown', { key: 'End' });
      expect(pick()).toBe('a2');
      expect(inTab()).toEqual(['a2']);
      fire(document, 'keydown', { key: 'Home' });
      expect(pick()).toBe('a5');

      // The class chips: an arrow moves and chooses, as radio buttons do.
      chip(A).focus();
      fire(document, 'keydown', { key: 'ArrowRight' });
      await settle();
      expect(document.activeElement).toBe(chip(H));
      expect(chip(H).getAttribute('aria-checked')).toBe('true');
      expect(document.querySelector('#afrom-list').textContent).toBe('History 12 has no assessments yet.');
    });

    it('another class: its own list, nothing carried over, and no pickers with nothing to pick', async () => {
      await open();
      tick('a1');
      click(chip(H));
      await settle();
      expect(document.querySelector('#afrom-list').textContent).toBe('History 12 has no assessments yet.');
      expect(addBtn().textContent).toBe('Add');
      expect(allBox().disabled).toBe(true);
      expect(document.querySelector('#afrom-cat').hidden).toBe(true);
      expect(document.querySelector('#afrom-mod').hidden).toBe(true);
      click(chip(A));
      await settle();
      expect(ticked()).toEqual([]);
      expect(document.querySelector('#afrom-cat').hidden).toBe(false);
    });

    it('Escape and Cancel close it and add nothing', async () => {
      await open();
      tick('a1');
      fire(document, 'keydown', { key: 'Escape' });
      expect(dialog()).toBeNull();
      await open();
      expect(addBtn().textContent).toBe('Add');
      click(document.querySelector('[data-afrom-cancel]'));
      expect(dialog()).toBeNull();
      expect(getAssessments(B)).toHaveLength(2);
    });

    it('Add copies the ticked pieces as before: linked, dates kept, a Draft still a Draft, no scores', async () => {
      let done = 0;
      await open(() => done++);
      tick('a5');
      tick('a1');
      click(addBtn());
      expect(dialog()).toBeNull();
      await settle();
      await settle();
      expect(done).toBe(1);

      const mine = getAssessments(B);
      expect(mine).toHaveLength(4);
      const src = id => getAssessments(A).find(a => a.id === id);
      const copyOf = id => mine.find(a => a.copyGroup && a.copyGroup === src(id).copyGroup);
      // Each source got a link to its copy.
      expect(src('a1').copyGroup).toBeTruthy();
      expect(src('a5').copyGroup).toBeTruthy();
      expect(copyOf('a1')).toMatchObject({
        title: 'Theme Essay',
        dateAssigned: '2026-11-04',
        categoryId: 'b-ess',
        rubricId: 'b-rub',
        moduleId: 'b-mod',
      });
      expect(copyOf('a1').isDraft).toBeFalsy();
      expect(copyOf('a5')).toMatchObject({
        title: 'Conflict',
        dateAssigned: '2026-11-12',
        dueDate: '2026-11-19',
        categoryId: 'b-ess',
        isDraft: true,
      });
      // The copies' ids are new, and no score came with them.
      expect(['a1', 'a5']).not.toContain(copyOf('a1').id);
      expect(getScores(B)).toEqual({});
      expect(getScores(A)).toEqual({ 'stu-1': [{ assessmentId: 'a1', score: 3 }] });

      // Opened again: both are marked.
      await open();
      expect(row('a1').querySelector('.afrom-chip').textContent).toBe('Already Here');
      expect(row('a5').querySelector('.afrom-chip').textContent).toBe('Already Here');
      expect(status()).toBe('7 assessments, 3 already here.');
    });

    it('opens on the class last copied from', async () => {
      seed(H, {
        categories: [{ id: 'h-ess', name: 'Essays', weight: 100, displayOrder: 0 }],
        assessments: [{ id: 'h1', title: 'Cold War Timeline', date: '2026-11-01', categoryId: 'h-ess', tagIds: [] }],
      });
      await open();
      click(chip(H));
      await settle();
      tick('h1');
      click(addBtn());
      await settle();
      await settle();
      expect(getAssessments(B).map(a => a.title)).toContain('Cold War Timeline');
      await open();
      expect([chip(A), chip(H)].map(c => c.getAttribute('aria-checked'))).toEqual(['false', 'true']);
      expect(titles()).toEqual(['Cold War Timeline']);
    });

    it('with no other class there is nothing to open', () => {
      saveCourses({ [B]: { id: B, name: 'English 9 B' } });
      AddFromClass.open(B);
      expect(dialog()).toBeNull();
    });
  });
});
