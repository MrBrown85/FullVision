/**
 * The Questionnaires tab in Class Management (docs/STUDENT-VOICE-PLAN.md,
 * PR 5): teacher/questionnaires.js, teacher/cm-questionnaires.js and
 * teacher/qr-slips.js.
 *
 * In Demo Mode a questionnaire turns on from its template and saves on this
 * device; a reflection brings its Goal Check-In on the same slip; status,
 * answered counts and the question editor follow what is saved; and the
 * slips print eight to a page with each student's own code in the QR.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

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

  it('says whether a questionnaire is off, opens later, is open or has closed', () => {
    var q = { is_on: true, opens_on: '2026-11-03', closes_on: '2026-11-14' };
    expect(Questionnaires.status(q, '2026-10-24')).toEqual({ state: 'upcoming', text: 'Opens Nov 3' });
    expect(Questionnaires.status(q, '2026-11-05').state).toBe('open');
    expect(Questionnaires.status(q, '2026-11-20').state).toBe('closed');
    expect(Questionnaires.status(Object.assign({}, q, { is_on: false })).state).toBe('off');
  });
});

function dom() {
  return parseHTML('<!doctype html><html><head></head><body></body></html>').document;
}

describe('QR slips', () => {
  it('makes one slip per code, sorted by last name, with the code after #', () => {
    var slips = QrSlips.buildSlips(
      students(),
      [
        { enrollment_id: 'e1', code: 'K7M-4QX' },
        { enrollment_id: 'e2', code: 'ABC-234' },
        { enrollment_id: 'gone', code: 'ZZZ-999' },
      ],
      'https://fullvision.ca',
    );
    expect(slips.map(s => s.name)).toEqual(['Jay Lee', 'Maya Ross']);
    expect(slips[1].url).toBe('https://fullvision.ca/s/#K7M-4QX');
  });

  it('puts eight slips on a page and draws a real QR for each', () => {
    var codes = [];
    var roster = [];
    for (var i = 0; i < 9; i++) {
      roster.push({ id: 'e' + i, firstName: 'Student', lastName: String.fromCharCode(65 + i) });
      codes.push({ enrollment_id: 'e' + i, code: 'AAA-22' + i });
    }
    var slips = QrSlips.buildSlips(roster, codes, 'https://fullvision.ca');
    var html = QrSlips.buildPages(slips, { title: 'About Me', closes_on: '2026-11-14' }, 'Science 8 · Block A');
    var box = dom().createElement('div');
    box.innerHTML = html;
    var pages = box.querySelectorAll('.qs-page');
    expect(pages).toHaveLength(2);
    expect(pages[0].querySelectorAll('.qs-slip')).toHaveLength(8);
    expect(pages[1].querySelectorAll('.qs-slip')).toHaveLength(1);
    expect(box.querySelectorAll('.qs-qr svg')).toHaveLength(9);
    expect(box.querySelector('.qs-type strong').textContent).toBe('AAA-220');
    expect(box.querySelector('.qs-dates').textContent).toBe('Open until Nov 14');
    expect(box.querySelector('.qs-type span').textContent).toBe('No camera? Go to fullvision.ca/s and type');
  });
});

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

  it('shows About Me and this period’s reflection, both off', () => {
    mount();
    var cards = root.querySelectorAll('.sq-card');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.sq-name').textContent).toBe('About Me');
    expect(cards[0].querySelector('.sq-desc').textContent).toBe(
      'Start of course · 7 questions and a private note to you',
    );
    expect(cards[0].classList.contains('sq-off')).toBe(true);
    expect(cards[1].querySelector('.sq-desc').textContent).toMatch(/^Grade 8 theme: .+ · for Report \d$/);
    expect(CmQuestionnaires.countOn(CID)).toBe(0);
  });

  it('turning on a reflection brings its Goal Check-In on the same slip', async () => {
    mount();
    click('[data-card^="core-"] .seg-btn[data-on="1"]');
    await tick();
    var list = Questionnaires.list(CID);
    var refl = list.find(q => q.kind === 'core_reflection');
    var goal = list.find(q => q.kind === 'goal_checkin');
    expect(refl.is_on).toBe(true);
    expect(goal.parent_id).toBe(refl.id);
    expect(goal.closes_on).toBe(refl.closes_on);
    expect(CmQuestionnaires.countOn(CID)).toBe(1);
    mount();
    var card = root.querySelector('[data-card^="core-"]');
    expect(card.querySelector('.sq-facts').textContent).toContain('Answered0 of 3');
    expect(card.querySelector('.sq-facts').textContent).toContain('Not AnsweredAll 3 students');
  });

  it('counts who has answered and offers slips for the rest', async () => {
    var q = await Questionnaires.turnOn(CID, { kind: 'about_me', template_id: 'about-me' });
    q.answered = ['e1', 'e3'];
    mount();
    var card = root.querySelector('[data-card="about-me"]');
    expect(card.querySelector('.sq-facts').textContent).toContain('2 of 3');
    expect(card.querySelector('.sq-facts').textContent).toContain('Jay L.');
    expect(card.querySelector('[data-missing="1"]').textContent).toBe('Print Slips for 1 Not Answered');
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

  it('refuses dates that close before they open', async () => {
    var q = await Questionnaires.turnOn(CID, { kind: 'about_me', template_id: 'about-me' });
    mount();
    click('[data-action="sqToggleDates"]');
    mount();
    root.querySelector('#sq-opens-' + q.id).value = '2026-11-10';
    root.querySelector('#sq-closes-' + q.id).value = '2026-11-01';
    click('[data-action="sqSaveDates"]');
    mount();
    expect(root.querySelector('.sq-msg').textContent).toBe('The closing date comes before the opening date.');
    expect(root.querySelector('#sq-opens-' + q.id).value).toBe('2026-11-10');
    root.querySelector('#sq-closes-' + q.id).value = '2026-11-20';
    click('[data-action="sqSaveDates"]');
    await tick();
    expect(Questionnaires.find(CID, x => x.id === q.id)).toMatchObject({
      opens_on: '2026-11-10',
      closes_on: '2026-11-20',
    });
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
