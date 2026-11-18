/**
 * Photos stay with the class (DECISIONS, Nov 17 2026). Colin: "Don't give
 * teachers a choice on when to keep photos until." Keep Photos Until, its
 * Delete Photos Now? question and the one-week reminder (S8-F1) are gone.
 * Class Settings › Student Page says how long photos stay in one sentence,
 * where Keep Photos Until was: while Send Work is on, or while the class has
 * photos kept. The Dashboard never shows a photo line.
 *
 * Demo Mode's Science 8, whose sample work has photos (Cell Microscope Lab).
 * The clock is June 25, inside the week the old reminder showed.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { parseHTML } from 'linkedom';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const STAY =
  '<div class="cm-hint sp-photos-stay" id="sp-photos-stay">Photos stay as long as this class exists. They\'re deleted when the class is deleted, or after a year without being opened.</div>';

let wasDemo;
let fetches;
let realFetch;

function seedDemo({ on = true, photos = true, send = true } = {}) {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
  if (on) setStudentPageSwitch(CID, true, 'on_return');
  const all = getCourseSubmissions(CID);
  expect(all.submissions.some(s => s.files && s.files.length)).toBe(true);
  saveDemoStudentWork(CID, {
    course: Object.assign({}, all.course, { send_work: send }),
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
  // Bulletins' change event (shared/data-bulletins.js), made by this document's window, as a browser makes it.
  const realEvent = globalThis.CustomEvent;
  globalThis.CustomEvent = doc.defaultView.CustomEvent;
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
    globalThis.CustomEvent = realEvent;
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

describe('The Dashboard', () => {
  it('has no photo line, with Send Work on or off, in the week the old reminder showed', () => {
    for (const send of [true, false]) {
      const html = dashboardHtml(() => seedDemo({ send }));
      expect(CmStudentPage.classHasPhotos(CID)).toBe(true);
      expect(html).not.toContain('photo-reminder');
      expect(html).not.toContain('deleted on');
      expect(html).not.toContain('Change the Date');
    }
  });

  it('has nothing left of the reminder to call', () => {
    expect(DashOverview.photoReminderHtml).toBeUndefined();
    expect(DashOverview.photoReminderDismissed).toBeUndefined();
    expect(CmStudentPage.photoReminder).toBeUndefined();
    expect(CmStudentPage.keepPhotosDate).toBeUndefined();
    expect(CmStudentPage.focusKeepPhotos).toBeUndefined();
  });
});

describe('Class Settings › Student Page: how long photos stay', () => {
  it('Send Work on: the sentence under it, and no choice to make', () => {
    const html = settingsHtml(() => seedDemo({ photos: false }));
    const send = html.slice(html.indexOf('<div class="sp-row sp-send">'));
    expect(send.indexOf(STAY)).toBeGreaterThan(send.indexOf('id="sp-send-switch"'));
    expect(html).not.toContain('Keep Photos Until');
    expect(html).not.toContain('sp-keep');
    expect(html).not.toContain('photo-reminder');
    expect(html).not.toContain('Change the Date');
  });

  it('Send Work off with photos kept: the sentence stays', () => {
    const html = settingsHtml(() => seedDemo({ send: false }));
    expect(html).not.toMatch(/id="sp-send-switch"[^>]*checked/);
    expect(html).toContain(STAY);
  });

  it('Send Work off with no photos: no sentence', () => {
    const html = settingsHtml(() => seedDemo({ send: false, photos: false }));
    expect(html).toContain('Send Work');
    expect(html).not.toContain('sp-photos-stay');
  });

  it('only a paper copy kept, with Send Work off: no sentence', () => {
    const html = settingsHtml(() => {
      seedDemo({ send: false });
      const all = getCourseSubmissions(CID);
      all.submissions = all.submissions.map(s => Object.assign({}, s, { files: [], on_paper: true }));
      saveDemoStudentWork(CID, all);
    });
    expect(CmStudentPage.classHasPhotos(CID)).toBe(false);
    expect(html).not.toContain('sp-photos-stay');
  });

  it('build switch off: no Student Page card, so no sentence', () => {
    const html = settingsHtml(() => seedDemo({ on: false }));
    expect(html).not.toContain('sp-photos-stay');
    expect(html).not.toContain('Keep Photos Until');
  });

  it('the old buttons do nothing: no Keep Photos Until action, no Dismiss', () => {
    seedDemo();
    const el = {
      dataset: { cid: CID, value: 'end_of_term', date: '2027-06-30' },
      closest: () => ({ dataset: { cid: CID } }),
    };
    expect(CmStudentPage.handleAction('spKeepPhotos', el)).toBe(false);
    expect(CmStudentPage.handleAction('spPhotoReminderDismiss', el)).toBe(false);
    expect(CmStudentPage.handleAction('spPhotoReminderChange', el)).toBe(false);
    expect(CmStudentPage.workSettings(CID)).toEqual({ offered: true, send_work: true });
    expect(getCourseSendWork(CID)).toEqual({ send_work: true });
  });

  it('a keep_photos_until a device saved before is read as nothing', () => {
    seedDemo();
    const all = getCourseSubmissions(CID);
    saveDemoStudentWork(CID, Object.assign({}, all, { course: { send_work: true, keep_photos_until: 'end_of_term' } }));
    expect(getCourseSendWork(CID)).toEqual({ send_work: true });
    expect(setCourseSendWork(CID, { keep_photos_until: 'end_of_year' })).toEqual({ ok: false });
  });
});
