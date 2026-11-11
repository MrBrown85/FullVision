/**
 * Questions From Students in the teacher's three places (S10-F4): the
 * gradebook's Question Waiting mark, the dashboard's Questions From
 * Students, and the Learner Profile's Working On, Reflecting So Far and
 * Reflections on Feedback. Demo Mode's Science 8, whose sample (PR 1067)
 * has Jordan's question on Cell Microscope Lab waiting, Noor's answered and
 * Liam's plan.
 *
 * First the pin: with Reflect on Feedback off, or the build switch off,
 * each screen draws exactly what it draws with no reflection stored at all.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { parseHTML } from 'linkedom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';
import { mount, unmount } from './helpers/gradebook-dom.js';

const CID = 'sci8';
let wasDemo;
let voiceLoaded;

function seedDemo(cfg) {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
  if (cfg) saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID) || {}, cfg));
}

// No reflection stored at all: what every screen drew before S10.
function dropReflections() {
  const k = 'gb-student-feedback-' + CID;
  const stored = JSON.parse(localStorage.getItem(k) || 'null');
  expect(stored && Object.keys(stored.reflections || {}).length).toBeGreaterThan(0);
  delete stored.reflections;
  localStorage.setItem(k, JSON.stringify(stored));
}

function gradebookHtml(prep) {
  mount(prep, { course: CID });
  const html = document.getElementById('main').innerHTML;
  unmount();
  return html;
}

function page(prep, open) {
  const stub = { document: globalThis.document, getComputedStyle: globalThis.getComputedStyle, CSS: globalThis.CSS };
  const doc = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="page-layout"><div id="sidebar-mount"></div><main id="main"></main></div></body></html>',
  ).document;
  globalThis.document = doc;
  globalThis.getComputedStyle = () => ({ paddingLeft: '0', paddingRight: '0' });
  globalThis.CSS = { escape: s => String(s) };
  globalThis.requestAnimationFrame = fn => fn();
  Object.defineProperty(doc.defaultView.HTMLSelectElement.prototype, 'value', {
    get() {
      return this._value || '';
    },
    set(v) {
      this._value = v;
    },
    configurable: true,
  });
  prep();
  clearProfCache();
  let html = '';
  try {
    html = open(doc);
  } finally {
    globalThis.document = stub.document;
    globalThis.getComputedStyle = stub.getComputedStyle;
    globalThis.CSS = stub.CSS;
  }
  return html;
}

function dashboardHtml(prep) {
  return page(prep, doc => {
    setActiveCourse(CID);
    runInThisContext(readFileSync('teacher/page-dashboard.js', 'utf-8'), { filename: 'teacher/page-dashboard.js' });
    PageDashboard.init({});
    const html = doc.getElementById('page-toolbar-mount').innerHTML + doc.getElementById('main').innerHTML;
    const remove = globalThis.removeEventListener;
    globalThis.removeEventListener = () => {};
    PageDashboard.destroy();
    globalThis.removeEventListener = remove;
    return html;
  });
}

function profileHtml(prep, sid = 'st10') {
  return page(prep, doc => {
    runInThisContext(readFileSync('teacher/page-student.js', 'utf-8'), { filename: 'teacher/page-student.js' });
    PageStudent.init({ id: sid, course: CID, tab: 'profile' });
    const html = doc.getElementById('main').innerHTML;
    PageStudent.destroy();
    return html;
  });
}

const SCREENS = { gradebook: gradebookHtml, dashboard: dashboardHtml, profile: profileHtml };

beforeAll(() => {
  wasDemo = window.isDemoMode;
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
});
afterAll(() => {
  window.isDemoMode = wasDemo;
  CURRICULUM_INDEX = null;
  localStorage.clear();
});
beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-11T19:00:00Z'), toFake: ['Date'] });
  voiceLoaded = StudentVoice.loaded;
  StudentVoice.loaded = () => true;
});
afterEach(() => {
  StudentVoice.loaded = voiceLoaded;
  vi.useRealTimers();
});

describe('the pin: with either switch off, each screen is as it was', () => {
  const OFF = {
    'Reflect on Feedback off': { student_page_enabled: true },
    'the build switch off': { reflect_on_feedback: true },
  };
  Object.keys(OFF).forEach(name => {
    Object.keys(SCREENS).forEach(screen => {
      it(screen + ', ' + name, () => {
        const draw = SCREENS[screen];
        const withSample = draw(() => seedDemo(OFF[name]));
        expect(withSample.length).toBeGreaterThan(500);
        const without = draw(() => {
          seedDemo(OFF[name]);
          dropReflections();
        });
        expect(withSample).toBe(without);
      });
    });
  });
});
