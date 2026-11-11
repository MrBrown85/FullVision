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

function seedDemo({ on = true, photos = true, send = true, keep = 'end_of_year' } = {}) {
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

  /* Changed on purpose (ruling 108's follow-up): this pin said Send Work off
     looked the same with photos as with none. Photos sent before Send Work
     was turned off are still deleted, so with photos Keep Photos Until and
     the reminder now show (below, "Send Work turned off after photos were
     sent"). With no photos and Send Work off nothing shows, as before. */
  it('Send Work off with no photos: no reminder, and no Keep Photos Until', () => {
    const dash = dashboardHtml(() => seedDemo({ send: false, photos: false }));
    expect(dash).not.toContain('photo-reminder');
    const settings = settingsHtml(() => seedDemo({ send: false, photos: false }));
    expect(settings).toContain('Send Work');
    expect(settings).not.toContain('Keep Photos Until');
    expect(settings).not.toContain('photo-reminder');
  });

  it('build switch on with no photos: no reminder on either screen, and Keep Photos Until waits for Send Work', () => {
    const dash = dashboardHtml(() => seedDemo({ photos: false }));
    expect(dash).not.toContain('photo-reminder');
    expect(dash).not.toContain('Photos of student work');
    const settings = settingsHtml(() => seedDemo({ photos: false, send: false }));
    expect(settings).toContain('Send Work');
    expect(settings).not.toContain('Keep Photos Until');
    expect(settings).not.toContain('photo-reminder');
    const sending = settingsHtml(() => seedDemo({ photos: false, send: true }));
    expect(sending).toContain('Keep Photos Until');
    expect(sending).not.toContain('photo-reminder');
    expect(sending).not.toContain('Change the Date');
  });
});

describe('The reminder', () => {
  it('shows in the week before June 30, on June 30, and not before or after', () => {
    seedDemo();
    expect(CmStudentPage.photoReminder(CID, '2027-06-22')).toBeNull();
    expect(CmStudentPage.photoReminder(CID, '2027-06-23')).toEqual({ date: '2027-06-30', text: LINE });
    expect(CmStudentPage.photoReminder(CID, '2027-06-30')).toEqual({ date: '2027-06-30', text: LINE });
    // July 1 is a new school year: the next date is a year away.
    expect(CmStudentPage.photoReminder(CID, '2027-07-01')).toBeNull();
    expect(CmStudentPage.photoReminder(CID, '2026-11-11')).toBeNull();
  });

  it('is at the top of the Dashboard, in Colin’s words, with Change the Date and Dismiss', () => {
    const html = dashboardHtml(() => seedDemo());
    expect(html).toContain('<p class="photo-reminder-text">' + LINE + '</p>');
    const main = html.slice(html.indexOf('<div class="photo-reminder"'));
    expect(main.indexOf('photo-reminder')).toBeLessThan(main.indexOf('dash-glance'));
    expect(html).toMatch(/data-action="dashPhotoReminderChange" data-cid="sci8">Change the Date<\/button>/);
    expect(html).toMatch(
      /data-action="dashPhotoReminderDismiss" data-cid="sci8" data-date="2027-06-30">Dismiss<\/button>/,
    );
  });

  it('is on Class Settings › Student Page, under its heading', () => {
    const html = settingsHtml(() => seedDemo());
    const card = html.slice(html.indexOf('<h2 class="cm-grade-title">Student Page</h2>'));
    expect(card.indexOf('<div class="photo-reminder" id="sp-photo-reminder"')).toBeGreaterThan(0);
    expect(card.indexOf('photo-reminder')).toBeLessThan(card.indexOf('Return Grades'));
    expect(card).toContain(LINE);
  });

  it('is not shown a week and a day before', () => {
    onDay('2027-06-22');
    expect(dashboardHtml(() => seedDemo())).not.toContain('photo-reminder');
    expect(settingsHtml(() => seedDemo())).not.toContain('photo-reminder');
  });

  /* Ruling 108's follow-up: a teacher who turns Send Work off after photos
     were sent still has photos that go on the date, so the setting and the
     reminder stay in sight. */
  it('Send Work turned off after photos were sent: the reminder and Keep Photos Until still show', () => {
    seedDemo({ send: false });
    expect(CmStudentPage.photoReminder(CID, '2027-06-25')).toEqual({ date: '2027-06-30', text: LINE });
    expect(dashboardHtml(() => seedDemo({ send: false }))).toContain(LINE);
    const settings = settingsHtml(() => seedDemo({ send: false }));
    expect(settings).toContain('Keep Photos Until');
    expect(settings).toContain('Photos of student work in this class are deleted on June 30.');
    expect(settings).toContain(LINE);
    expect(settings).not.toMatch(/id="sp-send-switch"[^>]*checked/);
    // Without photos it goes with Send Work, as before.
    seedDemo({ send: false, photos: false });
    expect(CmStudentPage.photoReminder(CID, '2027-06-25')).toBeNull();
  });

  it('Keep Photos Until can be changed with Send Work off while photos are kept', () => {
    const terms = globalThis.getReportingTerms;
    globalThis.getReportingTerms = () => [{ ends_on: '2027-06-28' }];
    try {
      page(
        () => seedDemo({ send: false }),
        doc => {
          DashClassManager.resetState();
          DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
          DashClassManager.openClassManager('student-page', CID);
          const btn = doc.getElementById('sp-keep-end_of_term');
          expect(btn).not.toBe(null);
          expect(DashClassManager.handleAction('spKeepPhotos', btn)).toBe(true);
          DashClassManager.resetState();
        },
      );
      expect(CmStudentPage.workSettings(CID).keep_photos_until).toBe('end_of_term');
    } finally {
      globalThis.getReportingTerms = terms;
    }
  });

  it('follows End of Term: the term’s last day', () => {
    const terms = globalThis.getReportingTerms;
    globalThis.getReportingTerms = () => [{ ends_on: '2027-01-29' }, { ends_on: '2027-06-28' }];
    try {
      seedDemo({ keep: 'end_of_term' });
      expect(CmStudentPage.photoReminder(CID, '2027-01-21')).toBeNull();
      expect(CmStudentPage.photoReminder(CID, '2027-01-22').text).toBe(
        "Photos of student work in Science 8 are deleted on January 29. Grades, comments and Mark Up stay. Deleted photos can't come back.",
      );
      expect(CmStudentPage.photoReminder(CID, '2027-06-25').date).toBe('2027-06-28');
    } finally {
      globalThis.getReportingTerms = terms;
    }
  });

  it('Dismiss hides it on both screens for that class and date; a new date brings it back', () => {
    withDashboard(
      () => seedDemo(),
      doc => {
        click(doc, doc.querySelector('[data-action="dashPhotoReminderDismiss"]'));
        expect(doc.getElementById('main').innerHTML).not.toContain('photo-reminder');
      },
    );
    expect(localStorage.getItem('fv-photo-reminder-dismissed:' + CID)).toBe('2027-06-30');
    expect(CmStudentPage.photoReminder(CID, '2027-06-26')).toBeNull();
    const settings = page(
      () => {},
      doc => {
        DashClassManager.resetState();
        DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
        DashClassManager.openClassManager('student-page', CID);
        return doc.getElementById('main').innerHTML;
      },
    );
    expect(settings).not.toContain('photo-reminder');
    // A new date (End of Term, ending June 28) brings it back.
    const terms = globalThis.getReportingTerms;
    globalThis.getReportingTerms = () => [{ ends_on: '2027-06-28' }];
    try {
      const all = getCourseSubmissions(CID);
      all.course = Object.assign({}, all.course, { keep_photos_until: 'end_of_term' });
      saveDemoStudentWork(CID, all);
      expect(CmStudentPage.photoReminder(CID, '2027-06-25')).toEqual({
        date: '2027-06-28',
        text: "Photos of student work in Science 8 are deleted on June 28. Grades, comments and Mark Up stay. Deleted photos can't come back.",
      });
    } finally {
      globalThis.getReportingTerms = terms;
    }
  });

  it('Dismiss on Class Settings hides it there and on the Dashboard', () => {
    page(
      () => seedDemo(),
      doc => {
        DashClassManager.resetState();
        DashClassManager.configure({ activeCourse: CID, onRender() {}, onCourseChange() {} });
        DashClassManager.openClassManager('student-page', CID);
        const btn = doc.querySelector('[data-action="spPhotoReminderDismiss"]');
        expect(btn.dataset.date).toBe('2027-06-30');
        expect(DashClassManager.handleAction('spPhotoReminderDismiss', btn)).toBe(true);
        expect(doc.getElementById('main').innerHTML).not.toContain('photo-reminder');
        DashClassManager.resetState();
      },
    );
    expect(dashboardHtml(() => {})).not.toContain('photo-reminder');
  });

  it('Change the Date on the Dashboard opens Class Settings › Student Page at Keep Photos Until', () => {
    withDashboard(
      () => seedDemo(),
      doc => {
        let focused = null;
        doc.defaultView.HTMLElement.prototype.focus = function () {
          focused = this;
        };
        click(doc, doc.querySelector('[data-action="dashPhotoReminderChange"]'));
        expect(DashClassManager.classManagerOpen).toBe(true);
        expect(doc.getElementById('main').innerHTML).toContain('<h2 class="cm-grade-title">Student Page</h2>');
        expect(focused && focused.id).toBe('sp-keep-end_of_year');
      },
    );
  });

  it('is not shown with the build switch off, or with only a paper copy kept', () => {
    seedDemo({ on: false });
    expect(CmStudentPage.classHasPhotos(CID)).toBe(false);
    expect(CmStudentPage.photoReminder(CID, '2027-06-25')).toBeNull();
    seedDemo();
    expect(CmStudentPage.classHasPhotos(CID)).toBe(true);
    const all = getCourseSubmissions(CID);
    all.submissions = all.submissions.map(s => Object.assign({}, s, { files: [], on_paper: true }));
    saveDemoStudentWork(CID, all);
    expect(CmStudentPage.photoReminder(CID, '2027-06-25')).toBeNull();
  });

  it('a signed-in teacher’s class has no photos here yet, so it never shows', () => {
    seedDemo();
    window.isDemoMode = () => false;
    expect(CmStudentPage.photoReminder(CID, '2027-06-25')).toBeNull();
    expect(CmStudentPage.photoReminderHtml(CID, 'dash', '2027-06-25')).toBe('');
  });
});
