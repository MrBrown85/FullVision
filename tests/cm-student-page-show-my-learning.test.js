/**
 * Class Settings › Student Page: Show My Learning for a signed-in class
 * (S13-W2; teacher/cm-student-page.js learningSettings and _turnLearning).
 *
 * - Offered where Reflect on Feedback is: Demo Mode, or a signed-in class
 *   the server keeps student-page rows for (studentWorkLive), with the
 *   student page on. Not offered for a signed-in class without those rows.
 * - Read from the class's server options (getCourseFeedbackOptions), and
 *   written through setCourseFeedbackOptions: set_course_feedback_options
 *   with { show_my_learning } and an idempotency key.
 * - A save the server refuses puts the switch back. Nothing but the switch
 *   changes on screen: no toast, no banner, no line under the row.
 * - The row names the class's grading style (Letter for History 12).
 * - A class with a level set by hand is offered the same as any other: a
 *   student's card receives their own hand-set levels (Batch E, E9).
 * - Demo Mode is as before (tests/cm.test.js, cm-student-page-my-learning).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, clearClass, seedClass, serverSaysStudentPageOn, settle, signIn } from './helpers/pin-save-paths.js';

const REAL = U(71);
const LOCAL = 'c-local-ml';
const S1 = U(72);
const SECTION = 'sec1';
const HELD = { student_page_enabled: true, return_grades: 'on_return' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('Show My Learning for a signed-in class', () => {
  let doc;
  let stub;
  let original;
  let session;

  function seed(cid, gradingSystem, config) {
    clearClass(cid);
    seedClass(cid, {
      students: [{ id: S1, firstName: 'Jordan', lastName: 'Reyes' }],
      assessments: [],
      learningMaps: { sections: [{ id: SECTION, name: 'Questioning', tags: [{ id: 't1', label: 'Questioning' }] }] },
      courseConfigs: config || structuredClone(HELD),
    });
    COURSES[cid] = { id: cid, name: 'History 12', block: 'A', gradingSystem, gradeLevel: '12' };
  }
  function openSettings(cid) {
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: cid, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager('student-page', cid);
  }
  const sw = () => doc.getElementById('sp-learning-switch');
  const row = () => doc.querySelector('.sp-learning');
  const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const sent = name => session.sent().filter(c => c[0] === name);
  // Every write through the outbox, answered.
  async function drain() {
    for (let i = 0; i < 4; i++) {
      await settle();
      if (window.v2Queue) await window.v2Queue.flush();
    }
    await settle();
  }
  function turn(on) {
    const el = sw();
    expect(el).toBeTruthy();
    el.checked = on;
    return DashClassManager.handleChange(el);
  }

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-12T20:00:00Z'));
    stub = globalThis.document;
    doc = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
    ).document;
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
    original = { setUrl: Router.setUrl, isDemoMode: window.isDemoMode, toast: globalThis.showToast };
    Router.setUrl = () => {};
    window.isDemoMode = () => false;
    session = signIn();
    seed(REAL, 'letter');
    serverSaysStudentPageOn(REAL);
  });

  afterEach(async () => {
    await settle();
    DashClassManager.resetState();
    CmStudentPage._reset();
    serverSaysStudentPageOn(REAL, false);
    session.signOut();
    Router.setUrl = original.setUrl;
    window.isDemoMode = original.isDemoMode;
    globalThis.showToast = original.toast;
    globalThis.document = stub;
    delete _fbCourseRow[REAL];
    delete _fbCourseHere[REAL];
    clearClass(REAL);
    clearClass(LOCAL);
    vi.useRealTimers();
  });

  it('is offered where Reflect on Feedback is, off until the server says it is on, naming the Letter style', () => {
    expect(studentWorkLive(REAL)).toBe(true);
    expect(CmStudentPage.reflectSettings(REAL).offered).toBe(true);
    expect(CmStudentPage.learningSettings(REAL)).toEqual({ offered: true, on: false });
    openSettings(REAL);
    expect([...doc.querySelectorAll('.sp-card .sp-row-title')].map(text)).toEqual([
      'Return Grades',
      'Send Work',
      'Reflect on Feedback',
      'Show My Learning',
      'Questionnaires and Reports',
    ]);
    expect(sw().hasAttribute('checked')).toBe(false);
    expect(text(row().querySelector('#sp-learning-would'))).toBe(
      "Students would see their level on each skill and their grade in this class’s grading style (Letter), only from work you've returned.",
    );
    // Nothing says students' own devices can't show it: they can.
    expect(text(row())).not.toMatch(/can't show|can’t show|only Preview/);
    expect(row().querySelector('#sp-learning-device')).toBeNull();
  });

  it('names the Proficiency style in a Proficiency class', () => {
    seed(REAL, 'proficiency');
    openSettings(REAL);
    expect(text(row().querySelector('#sp-learning-would'))).toContain('grading style (Proficiency),');
  });

  it('reads the class’s server options', () => {
    _noteCourseFeedbackOptions(REAL, { reflect_on_feedback: false, show_my_learning: true });
    expect(CmStudentPage.learningSettings(REAL)).toEqual({ offered: true, on: true });
    // The class's settings on this device are not what it reads.
    expect(getCourseConfig(REAL).show_my_learning).toBeUndefined();
    expect(StudentView.learningOn(REAL)).toBe(true);
    openSettings(REAL);
    expect(sw().hasAttribute('checked')).toBe(true);
    expect(CmStudentPage.reflectSettings(REAL).on).toBe(false);
  });

  it('turned on, it sends set_course_feedback_options with show_my_learning and a key, and stays on', async () => {
    session.fake.on('set_course_feedback_options', () => ({
      data: { reflect_on_feedback: false, show_my_learning: true },
      error: null,
    }));
    openSettings(REAL);
    expect(turn(true)).toBe(true);
    // Shown at once.
    expect(CmStudentPage.learningSettings(REAL).on).toBe(true);
    expect(sw().hasAttribute('checked')).toBe(true);
    expect(doc.activeElement.id).toBe('sp-learning-switch');
    await drain();
    const calls = session.fake.calls.filter(c => c.name === 'set_course_feedback_options').map(c => c.params);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      p_course_id: REAL,
      p_patch: { show_my_learning: true },
      p_idempotency_key: expect.stringMatching(UUID),
    });
    expect(CmStudentPage.learningSettings(REAL).on).toBe(true);
    expect(sw().hasAttribute('checked')).toBe(true);
    expect(doc.activeElement.id).toBe('sp-learning-switch');
    // Only this switch: Reflect on Feedback is not sent, and nothing is kept in the class's settings.
    expect(JSON.stringify(calls)).not.toContain('reflect_on_feedback');
    expect(getCourseConfig(REAL).show_my_learning).toBeUndefined();
  });

  it('turned off, it sends show_my_learning false', async () => {
    _noteCourseFeedbackOptions(REAL, { reflect_on_feedback: true, show_my_learning: true });
    session.fake.on('set_course_feedback_options', () => ({
      data: { reflect_on_feedback: true, show_my_learning: false },
      error: null,
    }));
    openSettings(REAL);
    turn(false);
    await drain();
    expect(sent('set_course_feedback_options')).toEqual([
      [
        'set_course_feedback_options',
        { p_course_id: REAL, p_patch: { show_my_learning: false }, p_idempotency_key: '<key>' },
      ],
    ]);
    expect(CmStudentPage.learningSettings(REAL).on).toBe(false);
    expect(sw().hasAttribute('checked')).toBe(false);
  });

  it('refused by the server, the switch goes back, and nothing but the sync dot says so', async () => {
    const toasts = [];
    globalThis.showToast = (...a) => toasts.push(a);
    session.fake.on('set_course_feedback_options', () => ({
      data: null,
      error: { code: '42501', message: 'not your class' },
    }));
    openSettings(REAL);
    const before = doc.getElementById('main').innerHTML;
    turn(true);
    await drain();
    expect(session.fake.calls.filter(c => c.name === 'set_course_feedback_options')).toHaveLength(1);
    expect(CmStudentPage.learningSettings(REAL).on).toBe(false);
    expect(sw().hasAttribute('checked')).toBe(false);
    expect(doc.getElementById('main').innerHTML).toBe(before);
    expect(toasts).toEqual([]);
    expect(doc.querySelector('.sp-learning [role="status"], .sp-learning [role="alert"]')).toBeNull();
  });

  it('a class with a level set by hand is offered the same, with no line about it', () => {
    _cache.overrides[REAL] = { [S1]: { [SECTION]: { level: 4, reason: 'Talked it over', date: '2026-11-10' } } };
    expect(getSectionOverride(REAL, S1, SECTION).level).toBe(4);
    expect(CmStudentPage.learningSettings(REAL)).toEqual({ offered: true, on: false });
    openSettings(REAL);
    expect(sw()).toBeTruthy();
    expect(sw().hasAttribute('disabled')).toBe(false);
    expect(text(row())).not.toMatch(/by hand|calculated/i);
    delete _cache.overrides[REAL];
  });

  it('is not offered for a signed-in class the server keeps no student-page rows for, and a stray change sends nothing', async () => {
    seed(LOCAL, 'letter');
    expect(studentWorkLive(LOCAL)).toBe(false);
    expect(CmStudentPage.learningSettings(LOCAL)).toEqual({ offered: false, on: false });
    CmStudentPage.handleChange({
      checked: true,
      dataset: { actionChange: 'spShowLearning' },
      closest: () => ({ dataset: { cid: LOCAL } }),
    });
    await settle();
    expect(session.sent().filter(c => /show_my_learning/.test(JSON.stringify(c)))).toEqual([]);
  });

  it('is not offered with the class’s student page off', () => {
    seed(REAL, 'letter', { return_grades: 'on_return' });
    expect(CmStudentPage.learningSettings(REAL)).toEqual({ offered: false, on: false });
    expect(CmStudentPage.render(REAL)).not.toContain('sp-card');
  });
});
