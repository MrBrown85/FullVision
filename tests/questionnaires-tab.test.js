/**
 * The Reflect tab in Class Settings (docs/STUDENT-VOICE-PLAN.md, PR 5;
 * docs/plans/reflect-plan.md): shared/questionnaires.js,
 * and teacher/cm-questionnaires.js.
 *
 * In Demo Mode a reflection turns on from its template and saves on this
 * device; the switch is the gate (no closing date set by itself; one past
 * its closing date shows Off and turning it On clears the date); a
 * Core Competency reflection brings its Goal Check-In; status, answered
 * counts and the question editor follow what is saved. No slips print here.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';

// The builder, which tests/setup.js does not load.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (typeof CmReflectBuilder === 'undefined')
  runInThisContext(readFileSync(resolve(ROOT, 'teacher/cm-reflect-builder.js'), 'utf-8'), {
    filename: 'teacher/cm-reflect-builder.js',
  });

const CID = 'course-sq';
const tick = () => new Promise(r => setTimeout(r, 10));

function students() {
  return [
    { id: 'e1', firstName: 'Maya', lastName: 'Ross', preferred: '' },
    { id: 'e2', firstName: 'Jayden', lastName: 'Lee', preferred: 'Jay' },
    { id: 'e3', firstName: 'Ava', lastName: 'Chen', preferred: '' },
  ];
}

describe('Questionnaires module', () => {
  var originals;

  beforeEach(() => {
    localStorage.clear();
    originals = { isDemoMode: globalThis.isDemoMode };
    globalThis.isDemoMode = () => true;
    Questionnaires._reset();
  });

  afterEach(() => {
    globalThis.isDemoMode = originals.isDemoMode;
  });

  it('finds the grade, the reporting period and the templates', () => {
    expect(Questionnaires.courseGrade({ gradeLevel: '8' })).toBe(8);
    expect(Questionnaires.courseGrade({ gradeLevel: '10-12' })).toBeNull();
    expect(Questionnaires.courseGrade({ gradeLevel: '6' })).toBeNull();
    expect(Questionnaires.periodFor(new Date(2026, 9, 24))).toBe(1);
    expect(Questionnaires.periodFor(new Date(2027, 1, 10))).toBe(2);
    expect(Questionnaires.periodFor(new Date(2027, 4, 10))).toBe(3);
    expect(Questionnaires.reflectionTemplate(8, 1).title).toBe('November Reflection');
    expect(Questionnaires.template('about-me').questions.length).toBe(8);
  });

  it('turns on from a template, keeps it on this device, and turns off', async () => {
    await Questionnaires.load(CID);
    var q = await Questionnaires.turnOn(CID, { kind: 'about_me', template_id: 'about-me' });
    expect(q.id).toMatch(/^q/);
    expect(q.is_on).toBe(true);
    expect(q.questions).toHaveLength(8);
    expect(q.questions[7].teacher_only).toBe(true);
    Questionnaires._reset();
    await Questionnaires.load(CID);
    expect(Questionnaires.list(CID)).toHaveLength(1);
    await Questionnaires.setOn(CID, q.id, false);
    expect(Questionnaires.list(CID)[0].is_on).toBe(false);
  });

  it('says whether a reflection is off, opens later, is in the Reflect tab or has closed', () => {
    var q = { is_on: true, opens_on: '2026-11-03', closes_on: '2026-11-14' };
    expect(Questionnaires.status(q, '2026-10-24')).toEqual({ state: 'upcoming', text: 'Opens Nov 3' });
    expect(Questionnaires.status(q, '2026-11-05')).toEqual({
      state: 'open',
      text: 'In Students’ Reflect Tab',
      until: 'Until Nov 14',
    });
    expect(Questionnaires.status(q, '2026-11-14').state).toBe('open');
    expect(Questionnaires.status(q, '2026-11-20')).toEqual({ state: 'closed', text: 'Closed Nov 14' });
    expect(Questionnaires.status(Object.assign({}, q, { is_on: false })).state).toBe('off');
    expect(Questionnaires.status({ is_on: true, opens_on: '2026-11-03', closes_on: null }, '2026-11-05').until).toBe(
      'Until you turn it off',
    );
    expect(Questionnaires.visible(q, '2026-11-05')).toBe(true);
    expect(Questionnaires.visible(q, '2026-11-20')).toBe(false);
  });

  it('the switch is the gate: On opens today with no closing date', async () => {
    await Questionnaires.load(CID);
    var q = await Questionnaires.turnOn(CID, { kind: 'about_me', template_id: 'about-me' }, '2026-11-16');
    expect(q).toMatchObject({ is_on: true, opens_on: '2026-11-16', closes_on: null });
    expect(Questionnaires.status(q, '2026-12-25').state).toBe('open');
    await Questionnaires.setOn(CID, q.id, false);
    expect(
      Questionnaires.status(
        Questionnaires.find(CID, x => x.id === q.id),
        '2026-11-16',
      ).state,
    ).toBe('off');
  });

  it('turning On one past its closing date clears the date; a later date is kept', async () => {
    await Questionnaires.load(CID);
    var q = await Questionnaires.save(CID, {
      kind: 'about_me',
      template_id: 'about-me',
      title: 'About Me',
      opens_on: '2026-10-01',
      closes_on: '2026-11-01',
      is_on: true,
      questions: null,
    });
    expect(Questionnaires.status(q, '2026-11-16')).toEqual({ state: 'closed', text: 'Closed Nov 1' });
    var back = await Questionnaires.turnOn(CID, { id: q.id }, '2026-11-16');
    expect(back).toMatchObject({ id: q.id, is_on: true, opens_on: '2026-10-01', closes_on: null });
    expect(back.questions).toHaveLength(8);
    // Off with a closing date still ahead: On keeps it.
    await Questionnaires.save(CID, Object.assign({}, back, { is_on: false, closes_on: '2026-12-01' }));
    var again = await Questionnaires.turnOn(CID, { id: q.id }, '2026-11-16');
    expect(again).toMatchObject({ is_on: true, closes_on: '2026-12-01' });
  });
});

function dom() {
  return parseHTML('<!doctype html><html><head></head><body></body></html>').document;
}

describe('Questionnaires tab', () => {
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

  beforeEach(async () => {
    localStorage.clear();
    originals = {
      isDemoMode: globalThis.isDemoMode,
      document: globalThis.document,
      rerender: DashClassManager.renderClassManager,
    };
    globalThis.isDemoMode = () => true;
    globalThis.document = dom();
    DashClassManager.renderClassManager = () => {};
    Questionnaires._reset();
    CmQuestionnaires._reset();
    saveCourses({ [CID]: { id: CID, name: 'Science 8', gradeLevel: '8', gradingSystem: 'proficiency' } });
    saveStudents(CID, students());
    root = document.createElement('div');
    document.body.appendChild(root);
    await Questionnaires.load(CID);
  });

  afterEach(() => {
    root.remove();
    globalThis.isDemoMode = originals.isDemoMode;
    globalThis.document = originals.document;
    DashClassManager.renderClassManager = originals.rerender;
  });

  it('the tab count is there before the Reflect tab is opened (Nov 25: the Dashboard no longer reads the reflections first)', async () => {
    Questionnaires._reset();
    expect(Questionnaires.loaded(CID)).toBe(false);
    expect(CmQuestionnaires.countOn(CID)).toBe(0);
  });

  it('in Demo Mode the tab draws its list on the first draw, with nothing read before it (Nov 25: it stayed on Loading)', () => {
    Questionnaires._reset();
    expect(Questionnaires.loaded(CID)).toBe(false);
    mount();
    expect(root.textContent).not.toContain('Loading reflections');
    expect(root.querySelector('[data-action="sqNew"]').textContent).toBe('New Reflection');
  });

  it('shows About Me and this period’s reflection, both off, under Reflections', () => {
    mount();
    expect(root.querySelector('.cm-section-title').textContent).toBe('Reflections');
    expect(root.querySelector('.sq-section-head .cm-hint').textContent).toBe(
      'Students open these from the Reflect tab after they sign in with their card. Turn one on to show it.',
    );
    expect(root.querySelector('[data-action="sqNew"]').textContent).toBe('New Reflection');
    expect(root.textContent).not.toMatch(/questionnaire|slip/i);
    var cards = root.querySelectorAll('.sq-card');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.sq-name').textContent).toBe('About Me');
    expect(cards[0].querySelector('.sq-desc').textContent).toBe(
      'Start of course · 7 questions and a private note to you · Students do not see this while it is off',
    );
    expect(cards[0].classList.contains('sq-off')).toBe(true);
    expect(cards[0].querySelector('.sq-facts')).toBeNull();
    expect(cards[1].querySelector('.sq-desc').textContent).toMatch(
      /^Grade 8 theme: .+ · for Report \d · Students do not see this while it is off$/,
    );
    expect(CmQuestionnaires.countOn(CID)).toBe(0);
  });

  it('a reflection on but past its closing date shows Off with Closed under it, and On clears the date', async () => {
    var q = await Questionnaires.save(CID, {
      kind: 'about_me',
      template_id: 'about-me',
      title: 'About Me',
      opens_on: '2026-01-05',
      closes_on: '2026-01-10',
      is_on: true,
      questions: null,
    });
    expect(CmQuestionnaires.countOn(CID)).toBe(0);
    mount();
    var card = root.querySelector('[data-card="about-me"]');
    expect(card.classList.contains('sq-off')).toBe(true);
    expect(card.querySelector('.seg-btn[data-on="0"]').getAttribute('aria-checked')).toBe('true');
    expect(card.querySelector('.sq-closed').textContent).toBe('Closed Jan 10');
    click('[data-card="about-me"] .seg-btn[data-on="1"]');
    await tick();
    expect(Questionnaires.find(CID, x => x.id === q.id)).toMatchObject({ is_on: true, closes_on: null });
    expect(CmQuestionnaires.countOn(CID)).toBe(1);
    mount();
    card = root.querySelector('[data-card="about-me"]');
    expect(card.querySelector('.sq-closed')).toBeNull();
    expect(card.querySelector('.sq-facts').textContent).toContain('In Students’ Reflect TabUntil you turn it off');
  });

  it('turning on a reflection brings its Goal Check-In, with no closing date', async () => {
    mount();
    click('[data-card^="core-"] .seg-btn[data-on="1"]');
    await tick();
    var list = Questionnaires.list(CID);
    var refl = list.find(q => q.kind === 'core_reflection');
    var goal = list.find(q => q.kind === 'goal_checkin');
    expect(refl.is_on).toBe(true);
    expect(goal.parent_id).toBe(refl.id);
    expect(refl.closes_on).toBeNull();
    expect(goal.closes_on).toBeNull();
    expect(CmQuestionnaires.countOn(CID)).toBe(1);
    mount();
    var card = root.querySelector('[data-card^="core-"]');
    expect(card.querySelector('.sq-desc').textContent).toMatch(/ · with Goal Check-In$/);
    expect(card.querySelector('.sq-q-slip')).toBeNull();
    expect([...card.querySelectorAll('.sq-actions button')].map(b => b.textContent)).toEqual([
      'Show Questions',
      'Set a Closing Date',
    ]);
    expect(card.querySelector('.sq-facts').textContent).toContain('Answered0 of 3');
    expect(card.querySelector('.sq-facts').textContent).toContain('Not AnsweredAll 3 students');
  });

  it('counts who has answered; no slips; See Answers shows the answers in place of the list', async () => {
    var q = await Questionnaires.turnOn(CID, { kind: 'about_me', template_id: 'about-me' });
    q.answered = ['e1', 'e3'];
    var seen = [];
    window.CmReflectAnswers = {
      render: (cid, qid) => '<div class="ans-view">' + qid + '</div>',
      handleAction: action => (seen.push(action), true),
      handleChange: el => (seen.push('change:' + el.dataset.actionChange), true),
    };
    try {
      mount();
      var card = root.querySelector('[data-card="about-me"]');
      expect(card.querySelector('.sq-facts').textContent).toContain('2 of 3');
      expect(card.querySelector('.sq-facts').textContent).toContain('Jay L.');
      expect(card.textContent).not.toMatch(/slip/i);
      expect([...card.querySelectorAll('.sq-actions button')].map(b => b.textContent)).toEqual([
        'See Answers',
        'Show Questions',
        'Set a Closing Date',
      ]);
      click('[data-card="about-me"] [data-action="sqSeeAnswers"]');
      mount();
      expect(root.querySelector('.ans-view').textContent).toBe(q.id);
      expect(root.querySelector('.sq-card')).toBeNull();
      var btn = document.createElement('button');
      btn.dataset.action = 'sqAnsTab';
      root.querySelector('.sq-answers').appendChild(btn);
      expect(DashClassManager.handleAction('sqAnsTab', btn)).toBe(true);
      var pick = document.createElement('select');
      pick.dataset.actionChange = 'sqAnsSort';
      root.querySelector('.sq-answers').appendChild(pick);
      expect(DashClassManager.handleChange(pick)).toBe(true);
      expect(seen).toEqual(['sqAnsTab', 'change:sqAnsSort']);
      // The view's own way back is the tab's to take.
      var back = document.createElement('button');
      back.dataset.action = 'sqAnsBack';
      root.querySelector('.sq-answers').appendChild(back);
      expect(DashClassManager.handleAction('sqAnsBack', back)).toBe(true);
      mount();
      expect(root.querySelectorAll('.sq-card').length).toBe(2);
    } finally {
      delete window.CmReflectAnswers;
    }
  });

  it('edits questions: a prompt saves on blur, an empty one goes back, a new one waits for words', async () => {
    var q = await Questionnaires.turnOn(CID, { kind: 'about_me', template_id: 'about-me' });
    mount();
    click('[data-action="sqToggleQuestions"]');
    mount();
    var first = root.querySelector('textarea[data-action-blur="sqPrompt"][data-idx="0"]');
    first.value = 'What should I call you?';
    DashClassManager.handleBlur(first);
    await tick();
    expect(Questionnaires.find(CID, x => x.id === q.id).questions[0].prompt).toBe('What should I call you?');

    first.value = '   ';
    DashClassManager.handleBlur(first);
    expect(first.value).toBe('What should I call you?');

    click('[data-action="sqAddQuestion"]');
    mount();
    var draft = root.querySelector('textarea[data-action-blur="sqDraft"]');
    expect(draft).toBeTruthy();
    expect(Questionnaires.find(CID, x => x.id === q.id).questions).toHaveLength(8);
    draft.value = 'What is your favourite book?';
    DashClassManager.handleBlur(draft);
    await tick();
    var saved = Questionnaires.find(CID, x => x.id === q.id).questions;
    expect(saved).toHaveLength(9);
    expect(saved[8]).toMatchObject({ kind: 'text', prompt: 'What is your favourite book?' });

    mount();
    click('[data-action="sqRemoveQuestion"][data-idx="8"]');
    await tick();
    expect(Questionnaires.find(CID, x => x.id === q.id).questions).toHaveLength(8);
  });

  it('Remove offers Undo, which puts the question back in its place with its id', async () => {
    var toasts = [];
    var stub = globalThis.showUndoToast;
    globalThis.showUndoToast = (msg, undo) => toasts.push({ msg, undo });
    try {
      var q = await Questionnaires.turnOn(CID, { kind: 'about_me', template_id: 'about-me' });
      var before = Questionnaires.find(CID, x => x.id === q.id).questions.map(x => x.id);
      mount();
      click('[data-action="sqToggleQuestions"]');
      mount();
      expect(root.querySelector('[data-action="sqRemoveQuestion"][data-idx="1"]').getAttribute('aria-label')).toBe(
        'Remove question 2',
      );
      click('[data-action="sqRemoveQuestion"][data-idx="1"]');
      await tick();
      expect(Questionnaires.find(CID, x => x.id === q.id).questions).toHaveLength(7);
      expect(toasts.map(t => t.msg)).toEqual(['Question 2 removed']);
      toasts[0].undo();
      await tick();
      expect(Questionnaires.find(CID, x => x.id === q.id).questions.map(x => x.id)).toEqual(before);
    } finally {
      globalThis.showUndoToast = stub;
    }
  });

  it('the switch shows On as soon as it is clicked, while the save is still going', async () => {
    var stubV2 = window.v2;
    var finish;
    try {
      globalThis.isDemoMode = () => false;
      Questionnaires._reset();
      window.v2 = Object.assign({}, stubV2, {
        listCourseQuestionnaires: () => Promise.resolve({ data: [] }),
        listQuestionnaireTemplates: () => Promise.resolve({ data: null }),
        upsertQuestionnaire: () => new Promise(r => (finish = r)),
      });
      await Questionnaires.load(CID);
      var draws = 0;
      DashClassManager.renderClassManager = () => {
        draws++;
        mount();
      };
      mount();
      click('[data-card="about-me"] .seg-btn[data-on="1"]');
      expect(draws).toBe(1);
      expect(root.querySelector('[data-card="about-me"] .seg-btn[data-on="1"]').getAttribute('aria-checked')).toBe(
        'true',
      );
      finish({ data: null });
      await tick();
      // A save that failed goes back to Off and says so.
      var card = root.querySelector('[data-card="about-me"]');
      expect(card.querySelector('.seg-btn[data-on="0"]').getAttribute('aria-checked')).toBe('true');
      expect(card.querySelector('.sq-msg').textContent).toContain('Could not turn this on');
    } finally {
      window.v2 = stubV2;
    }
  });

  it('answers sent since the last read show when the tab is opened again', async () => {
    var stubV2 = window.v2;
    var realNow = Date.now;
    var answered = [];
    try {
      globalThis.isDemoMode = () => false;
      Questionnaires._reset();
      var row = {
        id: '11111111-1111-1111-1111-111111111111',
        course_id: CID,
        kind: 'about_me',
        title: 'About Me',
        template_id: 'about-me',
        is_on: true,
        opens_on: '2000-01-01',
        closes_on: '2999-01-01',
        questions: [],
      };
      var reads = 0;
      window.v2 = Object.assign({}, stubV2, {
        listCourseQuestionnaires: () => {
          reads++;
          return Promise.resolve({ data: [Object.assign({}, row, { answered: answered.slice() })] });
        },
        listQuestionnaireTemplates: () => Promise.resolve({ data: null }),
      });
      await Questionnaires.load(CID);
      DashClassManager.renderClassManager = () => mount();
      mount();
      expect(root.querySelector('[data-card="about-me"] .sq-facts').textContent).toContain('0 of 3');
      expect(reads).toBe(1);

      // Maya answers; a teacher opening the tab again within 15 s reads nothing new.
      answered = ['e1'];
      mount();
      expect(reads).toBe(1);
      // Later, opening it reads again and shows her answer.
      var t = realNow() + 20000;
      Date.now = () => t;
      mount();
      await tick();
      expect(reads).toBe(2);
      expect(root.querySelector('[data-card="about-me"] .sq-facts').textContent).toContain('1 of 3');
    } finally {
      Date.now = realNow;
      window.v2 = stubV2;
    }
  });

  it('one optional closing date: set, refused when past, cleared', async () => {
    var q = await Questionnaires.turnOn(CID, { kind: 'about_me', template_id: 'about-me' });
    mount();
    click('[data-action="sqToggleDates"]');
    mount();
    expect(root.querySelector('#sq-opens-' + q.id)).toBeNull();
    root.querySelector('#sq-closes-' + q.id).value = '2020-01-01';
    click('[data-action="sqSaveDates"]');
    mount();
    expect(root.querySelector('.sq-msg').textContent).toBe('That day has passed. Pick today or a later day.');
    expect(root.querySelector('#sq-closes-' + q.id).value).toBe('2020-01-01');
    root.querySelector('#sq-closes-' + q.id).value = '2999-11-30';
    click('[data-action="sqSaveDates"]');
    await tick();
    expect(Questionnaires.find(CID, x => x.id === q.id).closes_on).toBe('2999-11-30');
    mount();
    expect(root.querySelector('.sq-facts').textContent).toContain('Until Nov 30');
    expect(root.querySelector('[data-action="sqToggleDates"]').textContent).toBe('Change Closing Date');
    click('[data-action="sqToggleDates"]');
    mount();
    click('[data-action="sqClearDates"]');
    await tick();
    expect(Questionnaires.find(CID, x => x.id === q.id).closes_on).toBeNull();
    mount();
    expect(root.querySelector('[data-action="sqToggleDates"]').textContent).toBe('Set a Closing Date');
  });

  it('a class with no single grade picks one before the reflection can turn on', () => {
    saveCourses({ [CID]: { id: CID, name: 'Science', gradeLevel: '10-12', gradingSystem: 'proficiency' } });
    mount();
    var on = root.querySelector('[data-card^="core-"] .seg-btn[data-on="1"]');
    expect(on.disabled).toBe(true);
    var pick = root.querySelector('select[data-action-change="sqGrade"]');
    pick.querySelector('option[value="11"]').setAttribute('selected', '');
    DashClassManager.handleChange(pick);
    mount();
    expect(root.querySelector('[data-card^="core-"] .sq-desc').textContent).toMatch(/^Grade 11 theme: /);
    expect(root.querySelector('[data-card^="core-"] .seg-btn[data-on="1"]').disabled).toBe(false);
  });
});
