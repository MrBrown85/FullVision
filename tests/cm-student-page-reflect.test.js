/**
 * Class Settings › Student Page: the Reflect on Feedback switch (S10
 * follow-up; board "Teacher: Class Settings, Student Page", which draws it
 * between Send Work and Show My Learning).
 *
 * - Demo Mode first, as Show My Learning (PR 1054): the row is drawn in
 *   Demo Mode only, with the class's build switch on, and written only
 *   through setCourseFeedbackOptions (shared/data.js, PR 1067), which keeps
 *   courseConfig.reflect_on_feedback and sends nothing in Demo Mode. A
 *   signed-in teacher's class has no row (Batch C is not applied) and
 *   nothing is asked of the server.
 * - Off until turned on. Off, none of the reflection screens shows
 *   anything; on, Demo Mode's sample shows Jordan's question and a student
 *   can reflect on returned work.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { parseHTML } from 'linkedom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
const JORDAN = 'st10';
const CECE = 'st1';
const HINT =
  'After you return work, students can say if it made sense, ask you a question and make a plan for next time.';

let doc;
let stub;
let original;
let fetches;

function seedDemo({ on = true } = {}) {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
  if (on) setStudentPageSwitch(CID, true, 'on_return');
}

function openSettings() {
  DashClassManager.resetState();
  DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
  DashClassManager.openClassManager('student-page', CID);
}
const html = () => doc.getElementById('main').innerHTML;
const sw = () => doc.getElementById('sp-reflect-switch');
async function turn(on) {
  const el = sw();
  expect(el).toBeTruthy();
  el.checked = on;
  expect(DashClassManager.handleChange(el)).toBe(true);
  await Promise.resolve();
  await Promise.resolve();
}

beforeAll(() => {
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
});
afterAll(() => {
  CURRICULUM_INDEX = null;
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-11T20:00:00Z'));
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
  globalThis.document = doc;
  globalThis.CSS = globalThis.CSS || { escape: s => String(s) };
  original = {
    setUrl: Router.setUrl,
    isDemoMode: window.isDemoMode,
    useSupabase: _useSupabase,
    fetch: globalThis.fetch,
  };
  Router.setUrl = () => {};
  _useSupabase = false;
  fetches = [];
  globalThis.fetch = (...args) => {
    fetches.push(String(args[0]));
    return Promise.reject(new Error('no server in this test'));
  };
  seedDemo();
});

afterEach(() => {
  expect(fetches).toEqual([]);
  DashClassManager.resetState();
  CmStudentPage._reset();
  Router.setUrl = original.setUrl;
  window.isDemoMode = original.isDemoMode;
  _useSupabase = original.useSupabase;
  globalThis.fetch = original.fetch;
  globalThis.document = stub;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  vi.useRealTimers();
});

describe('Reflect on Feedback in Class Settings › Student Page', () => {
  it('is off at first, in the board’s words, between Send Work and Show My Learning', () => {
    openSettings();
    expect([...doc.querySelectorAll('.sp-card .sp-row-title')].map(el => el.textContent)).toEqual([
      'Return Grades',
      'Send Work',
      // The sample class has photos, so Keep Photos Until shows with Send Work off (ruling 108's follow-up).
      'Keep Photos Until',
      'Reflect on Feedback',
      'Show My Learning',
      'Questionnaires and Reports',
    ]);
    expect(doc.querySelector('label[for="sp-reflect-switch"]').textContent).toBe('Reflect on Feedback');
    expect(doc.getElementById('sp-reflect-hint').textContent).toBe(HINT);
    expect(sw().hasAttribute('checked')).toBe(false);
    expect(sw().getAttribute('role')).toBe('switch');
    expect(sw().getAttribute('aria-describedby')).toBe('sp-reflect-hint');
    expect(CmStudentPage.reflectSettings(CID)).toEqual({ offered: true, on: false });
    expect(getReflectOnFeedback(CID)).toBe(false);
  });

  it('off: none of the reflection screens shows anything', () => {
    openSettings();
    expect(getQuestionsWaiting(CID)).toEqual([]);
    expect(DashOverview.questionsCardHtml(CID)).toBe('');
    expect(getStudentReflections(CID, JORDAN)).toEqual([]);
    expect(getStudentFeedback(CID, CECE).reflect_on_feedback).toBe(false);
    expect(StudentView.fromCache(CID, CECE).view.reflectOn).toBe(false);
    expect(sendStudentReflection(CID, CECE, LAB, { makes_sense: 'yes', plan: 'Label it.' }, CECE)).toEqual({
      ok: false,
      error: 'reflect_off',
    });
  });

  it('turned on, it is kept in the class’s settings; Jordan’s question shows and a student can reflect', async () => {
    openSettings();
    const before = Object.assign({}, getCourseConfig(CID));
    await turn(true);
    expect(getCourseConfig(CID)).toEqual(Object.assign({}, before, { reflect_on_feedback: true }));
    expect(getReflectOnFeedback(CID)).toBe(true);
    expect(sw().hasAttribute('checked')).toBe(true);
    expect(doc.activeElement).toBe(sw());
    // The teacher's screens.
    expect(getQuestionsWaiting(CID).map(r => r.enrollment_id)).toEqual([JORDAN]);
    expect(DashOverview.questionsCardHtml(CID)).toContain('How do I know which cell is which?');
    // The student's: Reflect on Feedback on returned work, in Preview as Student and on their page.
    expect(StudentView.fromCache(CID, CECE).view.reflectOn).toBe(true);
    expect(getStudentFeedback(CID, CECE).reflect_on_feedback).toBe(true);
    expect(sendStudentReflection(CID, CECE, LAB, { makes_sense: 'yes', plan: 'Label it.' }, CECE).ok).toBe(true);
    // Off again.
    await turn(false);
    expect(getReflectOnFeedback(CID)).toBe(false);
    expect(getQuestionsWaiting(CID)).toEqual([]);
    expect(sw().hasAttribute('checked')).toBe(false);
  });

  it('a change made while Class Settings has closed is kept, and nothing is drawn', async () => {
    openSettings();
    const el = sw();
    el.checked = true;
    DashClassManager.handleChange(el);
    DashClassManager.closeClassManager();
    doc.getElementById('main').innerHTML = '<p>Elsewhere</p>';
    await Promise.resolve();
    await Promise.resolve();
    expect(getReflectOnFeedback(CID)).toBe(true);
    expect(html()).toBe('<p>Elsewhere</p>');
  });

  it('an answer that comes once Class Settings is on another class draws nothing there', async () => {
    openSettings();
    const el = sw();
    el.checked = true;
    DashClassManager.handleChange(el);
    // Class Settings now asks the tab about another class, as it does when it draws one.
    CmStudentPage.isShown('another-class');
    doc.getElementById('main').innerHTML = '<p>Another class</p>';
    await Promise.resolve();
    await Promise.resolve();
    expect(getReflectOnFeedback(CID)).toBe(true);
    expect(html()).toBe('<p>Another class</p>');
  });

  it('with the build switch off there is no row, and a stray change saves nothing', () => {
    seedDemo({ on: false });
    expect(CmStudentPage.reflectSettings(CID)).toEqual({ offered: false, on: false });
    const box = { dataset: { cid: CID } };
    const stray = {
      checked: true,
      dataset: { actionChange: 'spReflect' },
      closest: s => (s === '[data-cid]' ? box : null),
    };
    CmStudentPage.handleChange(stray);
    expect((getCourseConfig(CID) || {}).reflect_on_feedback).toBeUndefined();
  });

  it('a signed-in teacher’s class has no row and nothing is sent', () => {
    window.isDemoMode = () => false;
    openSettings();
    expect(html()).not.toContain('sp-reflect');
    expect(CmStudentPage.reflectSettings(CID)).toEqual({ offered: false, on: false });
  });
});
