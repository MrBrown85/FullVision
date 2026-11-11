/**
 * Class Settings › Student Page: Show My Learning and See What They'd See
 * (S13-F1, docs/plans/student-page-build-plan.md; board "Teacher: Class
 * Settings, Student Page").
 *
 * - Demo Mode first, as Send Work: the row is drawn in Demo Mode only and
 *   kept in the class's settings (courseConfig.show_my_learning, what the
 *   screens read). A signed-in teacher's class does not have it (Batch C is
 *   not applied) and nothing is asked of the server.
 * - Off until turned on. Off, the My Learning tab in Preview as Student
 *   shows nothing of a grade; on, it shows My Learning.
 * - See What They'd See opens Preview as Student on My Learning for the
 *   student chosen under Preview as Student, as it would be with the switch
 *   on, and saves nothing.
 */
import './setup.js';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn, seedClass, clearClass, serverSaysStudentPageOn } from './helpers/pin-save-paths.js';

const CID = 'ml-class';
const S1 = 'ml-jordan';
const S2 = 'ml-avery';
const SECRET = /DRAFT-SECRET/;
const HELD = { student_page_enabled: true, return_grades: 'on_return' };

const piece = (id, title, date) => ({ id, title, date, dueDate: date, type: 'summative', weight: 1, tagIds: ['t1'] });
const ASSESSMENTS = [piece('essay', 'Returned Essay', '2026-10-01'), piece('poster', 'Draft Poster', '2026-10-05')];
const cell = (comment, level) => ({
  score: { value: null, modifier: 0, comment, status: null },
  tag_scores: [{ tag_id: 't1', value: level, modifier: 0, comment: null }],
  rubric_scores: [],
});

let doc;
let stub;
let original;

function seed(config, gradingSystem) {
  localStorage.clear();
  clearClass(CID);
  const assessments = structuredClone(ASSESSMENTS);
  const cells = {
    [S1]: { essay: cell('Well done.', 3), poster: cell('DRAFT-SECRET poster', 1) },
  };
  seedClass(CID, {
    students: [
      { id: S1, firstName: 'Jordan', lastName: 'Reyes' },
      { id: S2, firstName: 'Avery', lastName: 'Kim' },
    ],
    assessments,
    scores: _gradebookCellsToScoreCache(CID, assessments, cells).scores,
    learningMaps: { sections: [{ id: 'sec1', name: 'Questioning', tags: [{ id: 't1', label: 'Questioning' }] }] },
    courseConfigs: config === undefined ? structuredClone(HELD) : config,
    gradeReturns: {
      essay: { [S1]: { is_draft: false, returned_at: '2026-11-03T18:00:00Z' } },
      poster: { [S1]: { is_draft: true } },
    },
  });
  COURSES[CID] = { id: CID, name: 'Socials 10', block: 'C', gradingSystem: gradingSystem || 'both', gradeLevel: '10' };
  delete _returnedSets[CID];
  clearProfCache();
}

function openSettings() {
  DashClassManager.resetState();
  DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
  DashClassManager.openClassManager('student-page');
}
const overlay = () => doc.getElementById('preview-student');
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
const row = () => doc.querySelector('.sp-learning');
const saved = () => JSON.parse(localStorage.getItem('gb-courseconfig-' + CID) || '{}');
function click(target) {
  target.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true, cancelable: true }));
}
function turn(on) {
  const sw = doc.getElementById('sp-learning-switch');
  expect(sw).toBeTruthy();
  sw.checked = on;
  return DashClassManager.handleChange(sw);
}
// The My Learning tab inside the device, as the student presses it.
function pressMyLearning() {
  const tab = overlay().querySelector('.ps-screen .sp-tabs-bottom [data-act="tab"][data-tab="learning"]');
  expect(tab).toBeTruthy();
  click(tab);
  return overlay().querySelector('.ps-screen');
}
function pick(select, value) {
  [...select.querySelectorAll('option')].forEach(o => {
    if (o.getAttribute('value') === value) o.setAttribute('selected', '');
    else o.removeAttribute('selected');
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-11T20:00:00Z'));
  stub = globalThis.document;
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
  );
  doc = dom.document;
  let active = null;
  Object.defineProperty(doc, 'activeElement', {
    configurable: true,
    get: () => (active && active.isConnected ? active : doc.body),
  });
  const proto = Object.getPrototypeOf(Object.getPrototypeOf(doc.createElement('div')));
  proto.focus = function () {
    active = this;
  };
  if (!proto.scrollIntoView) proto.scrollIntoView = function () {};
  globalThis.document = doc;
  globalThis.CSS = globalThis.CSS || { escape: s => String(s) };
  original = {
    setUrl: Router.setUrl,
    getSupabase: globalThis.getSupabase,
    useSupabase: _useSupabase,
    isDemoMode: window.isDemoMode,
  };
  Router.setUrl = () => {};
  window.isDemoMode = () => true;
  _useSupabase = false;
  seed();
});
afterEach(() => {
  PreviewStudent.close();
  DashClassManager.resetState();
  CmStudentPage._reset();
  Router.setUrl = original.setUrl;
  globalThis.getSupabase = original.getSupabase;
  _useSupabase = original.useSupabase;
  window.isDemoMode = original.isDemoMode;
  globalThis.document = stub;
  clearClass(CID);
  vi.useRealTimers();
});

describe('Show My Learning', () => {
  it('is off at first, in the board’s words, with the line about students’ own devices', () => {
    openSettings();
    const r = row();
    expect(r).toBeTruthy();
    // After Return Grades, Send Work and Reflect on Feedback (S10 follow-up),
    // inside the Student Page card, before Questionnaires and Reports.
    expect([...doc.querySelectorAll('.sp-card .sp-row-title')].map(text)).toEqual([
      'Return Grades',
      'Send Work',
      'Reflect on Feedback',
      'Show My Learning',
      'Questionnaires and Reports',
    ]);
    expect(text(r.querySelector('label[for="sp-learning-switch"]'))).toBe('Show My Learning');
    expect(text(r.querySelector('#sp-learning-hint'))).toBe(
      'Students see their skills, their grade and how it changes over the term.',
    );
    expect(text(r.querySelector('#sp-learning-would'))).toBe(
      "Students would see their level on each skill and their grade in this class’s grading style (Both), only from work you've returned.",
    );
    expect(text(r.querySelector('#sp-learning-device'))).toBe(
      "Students' own phones and Chromebooks can't show My Learning yet, even with this on. For now only Preview as Student shows it.",
    );
    expect(text(r.querySelector('#sp-learning-see'))).toBe("See What They'd See");
    const sw = r.querySelector('#sp-learning-switch');
    expect(sw.getAttribute('role')).toBe('switch');
    expect(sw.hasAttribute('checked')).toBe(false);
    expect(CmStudentPage.learningSettings(CID)).toEqual({ offered: true, on: false });
    expect(StudentView.learningOn(CID)).toBe(false);
  });

  it('names the class’s own grading style', () => {
    seed(undefined, 'letter');
    openSettings();
    expect(text(row().querySelector('#sp-learning-would'))).toContain('grading style (Letter),');
    seed(undefined, 'proficiency');
    openSettings();
    expect(text(row().querySelector('#sp-learning-would'))).toContain('grading style (Proficiency),');
  });

  it('turned on, it is kept in the class’s settings, which is what the screens read; off again, it is off', () => {
    openSettings();
    expect(turn(true)).toBe(true);
    expect(getCourseConfig(CID).show_my_learning).toBe(true);
    expect(saved().show_my_learning).toBe(true);
    expect(StudentView.learningOn(CID)).toBe(true);
    expect(doc.getElementById('sp-learning-switch').hasAttribute('checked')).toBe(true);
    expect(doc.activeElement.id).toBe('sp-learning-switch');
    // Nothing else of the class's settings changed.
    expect(getReturnSettings(CID)).toEqual({ student_page: true, return_grades: 'on_return' });
    expect(GradeState.stateOf(CID, S1, 'poster')).toBe(GradeState.DRAFT);
    turn(false);
    expect(saved().show_my_learning).toBe(false);
    expect(StudentView.learningOn(CID)).toBe(false);
  });

  it('off, the My Learning tab in Preview as Student shows nothing of a grade', () => {
    openSettings();
    DashClassManager.handleAction('spPreview', doc.getElementById('sp-preview-open'));
    const screen = pressMyLearning();
    expect(text(screen)).toContain('Your teacher hasn’t turned on My Learning for this class.');
    expect(screen.querySelector('.sp-ml')).toBeNull();
    expect(text(screen)).not.toMatch(/Proficient|Developing|Emerging|Extending|%/);
    expect(text(overlay().querySelector('#ps-sees-title').parentNode)).not.toContain('My Learning');
  });

  it('on, Preview as Student shows My Learning, from returned work only', () => {
    openSettings();
    turn(true);
    const select = doc.getElementById('sp-preview-student');
    pick(select, S1);
    DashClassManager.handleChange(select);
    DashClassManager.handleAction('spPreview', doc.getElementById('sp-preview-open'));
    const screen = pressMyLearning();
    expect(screen.querySelector('.sp-ml')).toBeTruthy();
    expect(text(screen.querySelector('.sp-ml-title'))).toBe('My Learning');
    expect(text(screen)).toContain('Questioning');
    expect(overlay().innerHTML).not.toMatch(SECRET);
    expect(text(overlay().querySelector('#ps-sees-title').parentNode)).toContain('My Learning');
  });

  it('a stray change where the row is not drawn saves nothing', () => {
    seed({});
    expect(CmStudentPage.learningSettings(CID)).toEqual({ offered: false, on: false });
    expect(CmStudentPage.render(CID)).toBe('');
    const at = {
      checked: true,
      dataset: { actionChange: 'spShowLearning' },
      closest: () => ({ dataset: { cid: CID } }),
    };
    CmStudentPage.handleChange(at);
    expect(getCourseConfig(CID).show_my_learning).toBeUndefined();
    expect(saved().show_my_learning).toBeUndefined();
  });
});

describe('a signed-in teacher', () => {
  it('with the build switch off, the class is unchanged: no tab, nothing saved, nothing sent', () => {
    window.isDemoMode = () => false;
    const session = signIn();
    try {
      seed({});
      expect(CmStudentPage.isShown(CID)).toBe(false);
      expect(CmStudentPage.render(CID)).toBe('');
      expect(CmStudentPage.learningSettings(CID).offered).toBe(false);
      const at = {
        checked: true,
        dataset: { actionChange: 'spShowLearning' },
        closest: () => ({ dataset: { cid: CID } }),
      };
      CmStudentPage.handleChange(at);
      CmStudentPage.handleAction('spSeeLearning', at);
      expect(getCourseConfig(CID).show_my_learning).toBeUndefined();
      expect(overlay()).toBeNull();
      expect(session.sent()).toEqual([]);
    } finally {
      session.signOut();
    }
  });

  it('with the student page on, has no Show My Learning row and nothing is sent (Batch C is not applied)', () => {
    window.isDemoMode = () => false;
    const session = signIn();
    serverSaysStudentPageOn(CID);
    try {
      seed(HELD);
      expect(getReturnSettings(CID).student_page).toBe(true);
      const drawn = CmStudentPage.render(CID);
      expect(drawn).toContain('Return Grades');
      expect(drawn).not.toContain('Show My Learning');
      expect(drawn).not.toContain('See What They');
      expect(session.sent().filter(c => /show_my_learning/.test(JSON.stringify(c)))).toEqual([]);
    } finally {
      serverSaysStudentPageOn(CID, false);
      session.signOut();
    }
  });
});

describe("See What They'd See", () => {
  it('opens Preview as Student on My Learning for the student chosen, as it would be on, and saves nothing', () => {
    openSettings();
    const select = doc.getElementById('sp-preview-student');
    pick(select, S1);
    DashClassManager.handleChange(select);
    const before = localStorage.getItem('gb-courseconfig-' + CID);
    const see = doc.getElementById('sp-learning-see');
    expect(DashClassManager.handleAction('spSeeLearning', see)).toBe(true);
    const el = overlay();
    expect(el).toBeTruthy();
    expect(text(el.querySelector('#ps-title'))).toBe('Previewing as Jordan Reyes');
    const screen = el.querySelector('.ps-screen');
    // On the My Learning tab, drawn as with the switch on.
    expect(screen.querySelector('.sp-tabs-bottom .sp-tab-on')).toBeTruthy();
    expect(text(screen.querySelector('.sp-tabs-bottom .sp-tab-on'))).toBe('My Learning');
    expect(screen.querySelector('.sp-ml')).toBeTruthy();
    expect(text(screen)).toContain('Questioning');
    expect(el.innerHTML).not.toMatch(SECRET);
    expect(text(el.querySelector('#ps-sees-title').parentNode)).toContain('My Learning');
    // A press inside keeps My Learning shown (Assignments, then back).
    click(screen.querySelector('.sp-tabs-bottom [data-act="tab"][data-tab="assignments"]'));
    expect(pressMyLearning().querySelector('.sp-ml')).toBeTruthy();
    // The class is still off: nothing saved, and every other screen reads it as it is.
    expect(StudentView.learningOn(CID)).toBe(false);
    expect(getCourseConfig(CID).show_my_learning).toBeUndefined();
    expect(localStorage.getItem('gb-courseconfig-' + CID)).toBe(before);
    expect(StudentView.fromCache(CID, S1).view.learning).toBeNull();
    // Closed, the focus goes back to See What They'd See.
    click(el.querySelector('[data-ps-close]'));
    expect(overlay()).toBeNull();
    expect(doc.activeElement.id).toBe('sp-learning-see');
    // Open Preview afterwards shows the class as it is: off.
    DashClassManager.handleAction('spPreview', doc.getElementById('sp-preview-open'));
    expect(pressMyLearning().querySelector('.sp-ml')).toBeNull();
  });

  it('opens the first student by last name when none has been chosen', () => {
    openSettings();
    DashClassManager.handleAction('spSeeLearning', doc.getElementById('sp-learning-see'));
    expect(text(overlay().querySelector('#ps-title'))).toBe('Previewing as Avery Kim');
  });

  it('sends nothing', () => {
    const calls = [];
    globalThis.getSupabase = () => ({
      rpc(name) {
        calls.push(name);
        return Promise.resolve({ data: null, error: null });
      },
      from(table) {
        calls.push('from:' + table);
        return { select: () => Promise.resolve({ data: [], error: null }) };
      },
    });
    openSettings();
    turn(true);
    turn(false);
    DashClassManager.handleAction('spSeeLearning', doc.getElementById('sp-learning-see'));
    pressMyLearning();
    expect(calls).toEqual([]);
  });
});
