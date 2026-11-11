/**
 * S8-F1, the one-week reminder before a class's photos of student work are
 * deleted (docs/plans/student-page-build-plan.md S8; Colin's words, ruling
 * 102, s8-f1-wording-draft.md item 2). In the app only: a line at the top of
 * the class's Dashboard and of Class Settings › Student Page, from one week
 * before its Keep Photos Until date until that date, or until Dismiss.
 *
 * Demo Mode's Science 8, whose sample work has photos (Cell Microscope Lab).
 * Its Keep Photos Until is End of Year: June 30. The day is set with a fake
 * clock for the screens, and passed as an argument to photoReminder.
 *
 * First the pin: with the build switch off, or with no photos kept, both
 * screens draw exactly what they draw with no photos at all.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { parseHTML } from 'linkedom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LINE =
  "Photos of student work in Science 8 are deleted on June 30. Grades, comments and Mark Up stay. Deleted photos can't come back.";

let wasDemo;
let fetches;
let realFetch;

function seedDemo({ on = true, photos = true, send = false, keep = 'end_of_year' } = {}) {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
  if (on) setStudentPageSwitch(CID, true, 'on_return');
  const all = getCourseSubmissions(CID);
  expect(all.submissions.some(s => s.files && s.files.length)).toBe(true);
  saveDemoStudentWork(CID, {
    course: Object.assign({}, all.course, { send_work: send, keep_photos_until: keep }),
    assessments: all.assessments,
    submissions: photos ? all.submissions : [],
  });
}

function onDay(iso) {
  vi.setSystemTime(new Date(iso + 'T18:00:00.000Z'));
}

function page(prep, open) {
  const stub = {
    document: globalThis.document,
    getComputedStyle: globalThis.getComputedStyle,
    CSS: globalThis.CSS,
    setUrl: Router.setUrl,
    pathname: location.pathname,
  };
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
  Router.setUrl = () => {};
  location.pathname = '/dashboard';
  prep();
  clearProfCache();
  try {
    return open(doc);
  } finally {
    globalThis.document = stub.document;
    globalThis.getComputedStyle = stub.getComputedStyle;
    globalThis.CSS = stub.CSS;
    Router.setUrl = stub.setUrl;
    location.pathname = stub.pathname;
  }
}

function withDashboard(prep, during) {
  return page(prep, doc => {
    setActiveCourse(CID);
    DashClassManager.resetState();
    runInThisContext(readFileSync('teacher/page-dashboard.js', 'utf-8'), { filename: 'teacher/page-dashboard.js' });
    PageDashboard.init({});
    let out;
    try {
      out = during(doc);
    } finally {
      const remove = globalThis.removeEventListener;
      globalThis.removeEventListener = () => {};
      PageDashboard.destroy();
      globalThis.removeEventListener = remove;
      DashClassManager.resetState();
    }
    return out;
  });
}

const dashboardHtml = prep =>
  withDashboard(prep, doc => doc.getElementById('page-toolbar-mount').innerHTML + doc.getElementById('main').innerHTML);

function settingsHtml(prep) {
  return page(prep, doc => {
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager('student-page', CID);
    const html = doc.getElementById('main').innerHTML;
    DashClassManager.resetState();
    return html;
  });
}

function click(doc, el) {
  el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true, cancelable: true }));
}

beforeAll(() => {
  // Demo Mode's sample work is seeded by this file (as tests/demo-student-work.test.js loads it).
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
});

afterAll(() => {
  CURRICULUM_INDEX = null;
});

beforeEach(() => {
  wasDemo = window.isDemoMode;
  vi.useFakeTimers({ toFake: ['Date'] });
  onDay('2027-06-25');
  fetches = [];
  realFetch = globalThis.fetch;
  globalThis.fetch = (...args) => {
    fetches.push(String(args[0]));
    return Promise.reject(new Error('no server in this test'));
  };
});

afterEach(() => {
  expect(fetches).toEqual([]);
  globalThis.fetch = realFetch;
  vi.useRealTimers();
  CmStudentPage._reset();
  window.isDemoMode = wasDemo;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
});

describe('Pin: with the build switch off, or no photos, both screens are as they were', () => {
  it('build switch off: the Dashboard is the same with photos as with none, and no reminder', () => {
    const withPhotos = dashboardHtml(() => seedDemo({ on: false }));
    const without = dashboardHtml(() => seedDemo({ on: false, photos: false }));
    expect(withPhotos).toBe(without);
    expect(withPhotos).not.toContain('photo-reminder');
  });

  it('build switch on with no photos: no reminder on either screen, and Keep Photos Until waits for Send Work', () => {
    const dash = dashboardHtml(() => seedDemo({ photos: false }));
    expect(dash).not.toContain('photo-reminder');
    expect(dash).not.toContain('Photos of student work');
    const settings = settingsHtml(() => seedDemo({ photos: false }));
    expect(settings).toContain('Send Work');
    expect(settings).not.toContain('Keep Photos Until');
    expect(settings).not.toContain('photo-reminder');
    const sending = settingsHtml(() => seedDemo({ photos: false, send: true }));
    expect(sending).toContain('Keep Photos Until');
    expect(sending).not.toContain('photo-reminder');
    expect(sending).not.toContain('Change the Date');
  });
});
