/**
 * The shared observation capture strip — teacher/obs-capture.js.
 *
 * Shorthand parsing (@name, #tag, !type, /starter), and the strip itself in
 * a real DOM: picks, Add, Keep tags, the flag offer on a concern, the
 * competency and level, locked hosts, and a draft that survives a remount.
 * docs/DECISIONS.md, "Observations (2026-10-18)".
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const H = ObsCapture._helpers;
const CID = 'c-obs';

const STUDENTS = [
  { id: 's1', name: 'Mei Wong', first: 'Mei', last: 'Wong' },
  { id: 's2', name: 'Sofia Bianchi', first: 'Sofia', last: 'Bianchi' },
  { id: 's3', name: 'Ethan Dubois', first: 'Ethan', last: 'Dubois' },
  { id: 's4', name: 'Ethan Ma', first: 'Ethan', last: 'Ma' },
];
const TAGS = [
  { key: 'collaboration', label: 'Collaboration' },
  { key: 'engagement', label: 'Engagement' },
  { key: 'cc:3', label: 'Critical and Reflective Thinking' },
  { key: 'tag:Lab safety', label: 'Lab safety' },
];

describe('parseShorthand', () => {
  const lists = { students: STUDENTS, tags: TAGS };

  it('turns @name, #tag and !type into picks and takes them out of the text', () => {
    const r = H.parseShorthand('@Mei calibrated the balance #collab !strength', lists);
    expect(r.studentIds).toEqual(['s1']);
    expect(r.dims).toEqual(['collaboration']);
    expect(r.sentiment).toBe('strength');
    expect(r.text).toBe('calibrated the balance');
  });

  it('leaves a token that names more than one thing, or nothing', () => {
    const r = H.parseShorthand('@Ethan helped @Zed', lists);
    expect(r.studentIds).toEqual([]);
    expect(r.text).toBe('@Ethan helped @Zed');
  });

  it('matches a full name written without spaces, and a type by its start', () => {
    const r = H.parseShorthand('@EthanMa left early !con', lists);
    expect(r.studentIds).toEqual(['s4']);
    expect(r.sentiment).toBe('concern');
  });

  it('keeps punctuation after a token', () => {
    const r = H.parseShorthand('Great question from @Sofia.', lists);
    expect(r.studentIds).toEqual(['s2']);
    expect(r.text).toBe('Great question from.');
  });

  it('matches a word inside a tag label and custom tags', () => {
    expect(H.parseShorthand('#critical', lists).dims).toEqual(['cc:3']);
    expect(H.parseShorthand('#safety', lists).dims).toEqual(['tag:Lab safety']);
  });

  it('ignores emails, exclamation marks, numbers and starters', () => {
    const r = H.parseShorthand('Emailed a@b.ca. Great job! #3 /start', lists);
    expect(r.studentIds).toEqual([]);
    expect(r.dims).toEqual([]);
    expect(r.sentiment).toBeNull();
    expect(r.text).toBe('Emailed a@b.ca. Great job! #3 /start');
  });

  it('keeps line breaks', () => {
    expect(H.parseShorthand('Line one\nLine two #engagement', lists).text).toBe('Line one\nLine two');
  });
});

describe('tokenAt', () => {
  it('finds the token the caret is in', () => {
    expect(H.tokenAt('Hello @Me', 9)).toEqual({ kind: '@', query: 'Me', start: 6, end: 9 });
    expect(H.tokenAt('#', 1)).toEqual({ kind: '#', query: '', start: 0, end: 1 });
    expect(H.tokenAt('/', 1)).toEqual({ kind: '/', query: '', start: 0, end: 1 });
  });
  it('is null in plain words and mid-word sigils', () => {
    expect(H.tokenAt('Hello there', 11)).toBeNull();
    expect(H.tokenAt('a@b', 3)).toBeNull();
  });
});

/* ── The strip in a DOM ─────────────────────────────────── */
describe('capture strip', () => {
  let doc, win, saved, added, flagged;

  function setGlobal(name, value) {
    if (!(name in saved)) saved[name] = globalThis[name];
    globalThis[name] = value;
  }

  beforeEach(() => {
    const dom = parseHTML('<!doctype html><html><body><div id="host"></div></body></html>');
    doc = dom.document;
    win = dom.window;
    saved = {};
    added = [];
    flagged = {};
    setGlobal('document', doc);
    setGlobal('getStudents', () => [
      { id: 's1', firstName: 'Mei', lastName: 'Wong' },
      { id: 's2', firstName: 'Sofia', lastName: 'Bianchi' },
      { id: 's3', firstName: 'Ethan', lastName: 'Dubois' },
    ]);
    setGlobal('sortStudents', arr => arr);
    setGlobal('getCustomTags', () => ['Lab safety']);
    setGlobal('getAssessments', () => [
      { id: 'a1', title: 'Mid-year lab skills check', dueDate: '2026-10-10' },
      { id: 'a2', title: 'Density investigation', dueDate: '2026-09-17' },
    ]);
    setGlobal('getSections', () => [
      { id: 'sec1', name: 'Questioning and predicting', tags: [{ id: 't1', label: 'Make observations' }] },
      { id: 'sec2', name: 'Planning and conducting', tags: [{ id: 't2', label: 'Collect data safely' }] },
    ]);
    setGlobal(
      'getTagById',
      (cid, id) =>
        ({ t1: { id: 't1', label: 'Make observations' }, t2: { id: 't2', label: 'Collect data safely' } })[id],
    );
    setGlobal('getScores', () => ({}));
    setGlobal('getLastScoredAssessment', () => null);
    setGlobal('addQuickOb', (cid, sid, text, dims, sentiment, context, ac, link) => {
      added.push({ cid, sid, text, dims, sentiment, context, ac, link });
      return true;
    });
    setGlobal('isStudentFlagged', (cid, sid) => !!flagged[sid]);
    setGlobal('toggleFlag', (cid, sid) => {
      flagged[sid] = !flagged[sid];
    });
    localStorage.clear();
    Object.keys(H.drafts).forEach(k => delete H.drafts[k]);
  });

  afterEach(() => {
    Object.keys(saved).forEach(k => {
      globalThis[k] = saved[k];
    });
  });

  function mount(opts) {
    const cap = ObsCapture.create(Object.assign({ cid: CID }, opts || {}));
    cap.mount(doc.getElementById('host'));
    return cap;
  }
  function click(el) {
    expect(el, 'element to click').toBeTruthy();
    el.dispatchEvent(new win.Event('click', { bubbles: true }));
  }
  function type(cap, text) {
    const input = cap.el.querySelector('textarea');
    input.value = text;
    input.selectionStart = text.length;
    input.dispatchEvent(new win.Event('input', { bubbles: true }));
    return input;
  }
  function press(cap, key, opts) {
    const input = cap.el.querySelector('textarea');
    const e = new win.Event('keydown', { bubbles: true, cancelable: true });
    e.key = key;
    e.shiftKey = !!(opts && opts.shift);
    input.dispatchEvent(e);
    return e;
  }
  function chipText(cap) {
    return Array.from(cap.el.querySelectorAll('.obsc-chip')).map(c => c.textContent.replace('×', '').trim());
  }

  it('renders the chips in plain sentence-case text with no emoji', () => {
    const cap = mount();
    const text = cap.el.textContent;
    expect(chipText(cap)).toEqual(
      expect.arrayContaining([
        'Select students…',
        'Strength',
        'Growth',
        'Concern',
        'Context',
        '+ Tag',
        '+ Assessment',
        '+ Competency',
      ]),
    );
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(cap.el.querySelector('#capture-input')).toBeTruthy();
    expect(cap.el.querySelector('#capture-add-btn').disabled).toBe(true);
  });

  it('Enter adds for every picked student; students stay, text and tags clear', () => {
    const cap = mount({ students: ['s1', 's2'] });
    click(cap.el.querySelector('[data-obsc="type"][data-value="strength"]'));
    click(cap.el.querySelector('#tag-btn'));
    click(cap.el.querySelector('[data-obsc="toggleTag"][data-value="collaboration"]'));
    type(cap, 'Calibrated the balance');
    const e = press(cap, 'Enter');
    expect(e.defaultPrevented).toBe(true);
    expect(added.map(a => a.sid)).toEqual(['s1', 's2']);
    expect(added[0]).toMatchObject({ text: 'Calibrated the balance', dims: ['collaboration'], sentiment: 'strength' });
    expect(cap.getStudents()).toEqual(['s1', 's2']);
    expect(cap.getText()).toBe('');
    expect(cap.getState().dims).toEqual([]);
    expect(cap.getState().sentiment).toBeNull();
  });

  it('Shift+Enter does not send', () => {
    const cap = mount({ students: ['s1'] });
    type(cap, 'Line one');
    const e = press(cap, 'Enter', { shift: true });
    expect(e.defaultPrevented).toBe(false);
    expect(added).toHaveLength(0);
  });

  it('Keep tags keeps the type, context and tags after Add', () => {
    const cap = mount({ students: ['s1'] });
    const keep = cap.el.querySelector('[data-obsc="keepTags"]');
    keep.checked = true;
    keep.dispatchEvent(new win.Event('change', { bubbles: true }));
    click(cap.el.querySelector('[data-obsc="type"][data-value="growth"]'));
    type(cap, 'Needed a prompt to start #engagement ');
    expect(cap.getState().dims).toEqual(['engagement']);
    cap.submit();
    expect(added[0].dims).toEqual(['engagement']);
    expect(cap.getState().dims).toEqual(['engagement']);
    expect(cap.getState().sentiment).toBe('growth');
  });

  it('a finished @name becomes a student chip as you type', () => {
    const cap = mount();
    type(cap, '@Sofia ');
    expect(cap.getStudents()).toEqual(['s2']);
    expect(cap.getText()).toBe('');
    expect(cap.el.querySelector('.obsc-chip-student').textContent).toContain('Sofia Bianchi');
  });

  it('shorthand left in the box is applied on Add', () => {
    const cap = mount();
    type(cap, 'Left the data table blank @Ethan !concern');
    cap.submit();
    expect(added).toHaveLength(1);
    expect(added[0]).toMatchObject({ sid: 's3', text: 'Left the data table blank', sentiment: 'concern' });
  });

  it('a slash shows an empty starters menu until the starters bank exists', () => {
    const cap = mount({ students: ['s1'] });
    type(cap, '/');
    expect(cap.el.querySelector('#capture-suggest').textContent).toContain('No sentence starters yet.');
  });

  it('with no student, Add opens the student menu instead of saving', () => {
    const cap = mount();
    type(cap, 'Something');
    cap.submit();
    expect(added).toHaveLength(0);
    expect(cap.el.querySelector('#student-dropdown')).toBeTruthy();
    click(cap.el.querySelector('#student-dropdown [data-value="s3"]'));
    expect(cap.getStudents()).toEqual(['s3']);
  });

  it('pickStudent: click picks, shift-click adds or removes', () => {
    const cap = mount();
    cap.pickStudent('s1');
    cap.pickStudent('s2');
    expect(cap.getStudents()).toEqual(['s2']);
    cap.pickStudent('s3', true);
    expect(cap.getStudents()).toEqual(['s2', 's3']);
    cap.pickStudent('s2', true);
    expect(cap.getStudents()).toEqual(['s3']);
  });

  it('a concern offers to flag each unflagged student; Flag uses the flag setter', () => {
    flagged.s2 = true;
    const cap = mount({ students: ['s1', 's2'] });
    click(cap.el.querySelector('[data-obsc="type"][data-value="concern"]'));
    type(cap, 'Did not start the task');
    cap.submit();
    const offer = cap.el.querySelector('[data-part="flag"]');
    expect(offer.textContent).toContain('Flag Mei');
    expect(offer.textContent).not.toContain('Flag Sofia');
    expect(offer.textContent).toContain('Not now');
    click(offer.querySelector('[data-obsc="flag"]'));
    expect(flagged.s1).toBe(true);
    expect(cap.el.querySelector('[data-part="flag"]').textContent).toBe('');
  });

  it('Not now dismisses the flag offer without flagging', () => {
    const cap = mount({ students: ['s1'] });
    click(cap.el.querySelector('[data-obsc="type"][data-value="concern"]'));
    type(cap, 'Off task');
    cap.submit();
    click(cap.el.querySelector('[data-obsc="notNow"]'));
    expect(flagged.s1).toBeUndefined();
    expect(cap.getState().flagOffer).toEqual([]);
  });

  it('no flag offer for a strength', () => {
    const cap = mount({ students: ['s1'] });
    click(cap.el.querySelector('[data-obsc="type"][data-value="strength"]'));
    type(cap, 'Helped a peer');
    cap.submit();
    expect(cap.getState().flagOffer).toEqual([]);
  });

  it('a competency and its level go with the observation; Level is offered only after a competency', () => {
    const cap = mount({ students: ['s1'] });
    expect(cap.el.querySelector('#level-btn')).toBeNull();
    click(cap.el.querySelector('#competency-btn'));
    const menu = cap.el.querySelector('[data-menu="competency"]');
    expect(menu.textContent).toContain('Planning and conducting');
    click(menu.querySelector('[data-value="t2"]'));
    expect(cap.el.textContent).toContain('Competency: Collect data safely');
    click(cap.el.querySelector('#level-btn'));
    const levels = Array.from(cap.el.querySelectorAll('[data-menu="level"] .obsc-item-label')).map(e => e.textContent);
    expect(levels).toEqual(['Emerging', 'Developing', 'Proficient', 'Extending', 'No level']);
    expect(cap.el.querySelector('[data-menu="level"]').textContent).toContain('never changes a grade');
    click(cap.el.querySelector('[data-menu="level"] [data-value="3"]'));
    expect(cap.el.querySelector('#level-btn').textContent).toBe('Level: looks Proficient');
    type(cap, 'Set up the equipment safely');
    cap.submit();
    expect(added[0].link).toEqual({ competencyId: 't2', level: 3 });
    // Cleared after Add unless Keep tags is on.
    expect(cap.getState().competencyId).toBeNull();
    expect(cap.getState().level).toBeNull();
  });

  it('clearing the competency clears its level', () => {
    const cap = mount({ students: ['s1'], competencyId: 't1' });
    click(cap.el.querySelector('#level-btn'));
    click(cap.el.querySelector('[data-menu="level"] [data-value="2"]'));
    expect(cap.getState().level).toBe(2);
    click(cap.el.querySelector('[data-obsc="clearCompetency"]'));
    expect(cap.getState().level).toBeNull();
  });

  it('the tag menu offers dispositions, Core Competencies and custom tags', () => {
    const cap = mount();
    click(cap.el.querySelector('#tag-btn'));
    const text = cap.el.querySelector('#tag-dropdown').textContent;
    expect(text).toContain('Learning dispositions');
    expect(text).toContain('Core competencies');
    expect(text).toContain('Custom tags');
    expect(text).toContain('Lab safety');
  });

  it('the assessment pre-fills from what was scored today', () => {
    globalThis.getLastScoredAssessment = () => 'a1';
    const cap = mount({ defaultAssessment: true, students: ['s1'] });
    expect(cap.el.textContent).toContain('Assessment: Mid-year lab skills check');
    type(cap, 'Careful measurements');
    cap.submit();
    expect(added[0].ac).toEqual({ assessmentId: 'a1', assessmentTitle: 'Mid-year lab skills check' });
  });

  it('without a score today, + Assessment opens a menu', () => {
    const cap = mount({ defaultAssessment: true });
    expect(cap.el.querySelector('#assessment-btn')).toBeTruthy();
    click(cap.el.querySelector('#assessment-btn'));
    click(cap.el.querySelector('[data-menu="assessment"] [data-value="a2"]'));
    expect(cap.getState().assessmentId).toBe('a2');
  });

  it('a locked host hides what it cannot change', () => {
    const cap = mount({ students: ['s2'], lockStudents: true, assessmentId: 'a1', lockAssessment: true });
    expect(cap.el.querySelector('#student-btn')).toBeNull();
    expect(cap.el.querySelector('[data-obsc="removeStudent"]')).toBeNull();
    expect(cap.el.querySelector('[data-obsc="clearAssessment"]')).toBeNull();
    expect(cap.el.textContent).toContain('Sofia Bianchi');
    // @ does not pick other students in a locked host.
    type(cap, 'Shared her method @Mei ');
    expect(cap.getStudents()).toEqual(['s2']);
  });

  it('unsent text survives leaving and coming back (same course and host)', () => {
    let cap = mount({ draftKey: 'obs-page' });
    type(cap, 'Half a thought');
    cap.destroy();
    cap = mount({ draftKey: 'obs-page' });
    expect(cap.getText()).toBe('Half a thought');
    const other = ObsCapture.create({ cid: 'another-course', draftKey: 'obs-page' });
    expect(other.getText()).toBe('');
  });

  it('linkPillsHtml shows the competency and "Looks <level>"', () => {
    const html = ObsCapture.linkPillsHtml(CID, { competencyId: 't1', level: 4 });
    expect(html).toContain('Make observations');
    expect(html).toContain('Looks Extending');
    expect(ObsCapture.linkPillsHtml(CID, { level: 4 })).toBe('');
  });
});
