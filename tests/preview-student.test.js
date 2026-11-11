/**
 * Preview as Student (teacher/preview-student.js, S4-F6; board "Teacher:
 * Preview as Student"), opened from Class Settings › Student Page.
 *
 * - The door is there only for a class whose student page is on, with the
 *   board's words.
 * - The preview draws the student's page from shared/student-view.js
 *   alone: returned grades only, results worded by calc.js. A draft's
 *   words, level and result are nowhere in it.
 * - Phone and Chromebook; Jordan Sees and Jordan Doesn't See.
 * - Back to Class Settings and Escape close it, and the focus goes back to
 *   Open Preview.
 * - Not loaded draws "Loading this class…"; when the rows load and Class
 *   Settings draws again, the preview draws the page. A redraw for another
 *   class closes it.
 * - Demo Mode: opening and using it sends nothing.
 */
import './setup.js';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signIn, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = 'pv-class';
const OTHER = 'pv-other';
const S1 = 'pv-jordan';
const S2 = 'pv-avery';
const SECRET = /DRAFT-SECRET/;
const HELD = { student_page_enabled: true, return_grades: 'on_return' };

const piece = (id, title, date, extra) =>
  Object.assign({ id, title, date, dueDate: date, type: 'summative', weight: 1, tagIds: ['t1'] }, extra);
const ASSESSMENTS = [
  piece('essay', 'Returned Essay', '2026-10-01'),
  piece('poster', 'Draft Poster', '2026-10-05'),
  piece('reflect', 'Changed Reflection', '2026-10-08'),
  piece('quiz', 'Quick Check', '2026-10-10', { scoreMode: 'points', maxPoints: 10 }),
];
const lv = value => ({ value, modifier: 0, comment: null });
const copy = parts =>
  Object.assign({ v: 1, value: null, modifier: 0, comment: null, tags: {}, criteria: {}, checks: [] }, parts);
const cell = w => ({
  score: { value: w.value == null ? null : w.value, modifier: 0, comment: w.comment || null, status: null },
  tag_scores: Object.entries(w.tags || {}).map(([tag_id, r]) => Object.assign({ tag_id }, r)),
  rubric_scores: [],
});

let doc;
let stub;

function seed(config, gradingSystem) {
  localStorage.clear();
  clearClass(CID);
  const assessments = structuredClone(ASSESSMENTS);
  const cells = {
    [S1]: {
      essay: cell({ comment: 'Well done.', tags: { t1: lv(3) } }),
      poster: cell({ comment: 'DRAFT-SECRET poster', tags: { t1: lv(1) } }),
      reflect: cell({ comment: 'DRAFT-SECRET reflection', tags: { t1: lv(1) } }),
      quiz: cell({ value: 8 }),
    },
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
      reflect: {
        [S1]: {
          is_draft: true,
          returned_at: '2026-11-01T18:00:00Z',
          returned_copy: copy({ comment: 'Good start.', tags: { t1: lv(3) } }),
        },
      },
      quiz: { [S1]: { is_draft: false, returned_at: '2026-11-04T18:00:00Z' } },
    },
  });
  COURSES[CID] = { id: CID, name: 'Socials 10', block: 'C', gradingSystem: gradingSystem || 'both', gradeLevel: '10' };
  delete _returnedSets[CID];
  clearProfCache();
}

function openSettings(cid) {
  DashClassManager.resetState();
  DashClassManager.configure({ activeCourse: cid || CID, onRender() {}, onCourseChange() {} });
  DashClassManager.openClassManager('student-page');
}
const overlay = () => doc.getElementById('preview-student');
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
function key(target, k, opts) {
  const e = new doc.defaultView.Event('keydown', { bubbles: true, cancelable: true });
  e.key = k;
  Object.assign(e, opts || {});
  target.dispatchEvent(e);
  return e;
}
function click(target) {
  target.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true, cancelable: true }));
}
// All Assignments, pressed inside the device: every piece and its result in one list.
function showAll(el) {
  const b = el.querySelector('.ps-screen [data-act="all-open"]');
  if (b && b.getAttribute('aria-pressed') !== 'true') click(b);
}
// Chooses a student in the list (linkedom's select has no value setter).
function pick(select, value) {
  [...select.querySelectorAll('option')].forEach(o => {
    if (o.getAttribute('value') === value) o.setAttribute('selected', '');
    else o.removeAttribute('selected');
  });
}
function openPreview() {
  const button = doc.getElementById('sp-preview-open');
  expect(button).toBeTruthy();
  DashClassManager.handleAction('spPreview', button);
  return overlay();
}

let original;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-10T20:00:00Z'));
  stub = globalThis.document;
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
  );
  doc = dom.document;
  // linkedom keeps no focus: focus() sets document.activeElement.
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
  original = { setUrl: Router.setUrl, getSupabase: globalThis.getSupabase, useSupabase: _useSupabase };
  Router.setUrl = () => {};
  seed();
});
afterEach(() => {
  PreviewStudent.close();
  DashClassManager.resetState();
  CmStudentPage._reset();
  Router.setUrl = original.setUrl;
  globalThis.getSupabase = original.getSupabase;
  _useSupabase = original.useSupabase;
  globalThis.document = stub;
  clearClass(CID);
  clearClass(OTHER);
  vi.useRealTimers();
});

describe('the door in Class Settings › Student Page', () => {
  it('is there with the board’s words, a student list and Open Preview', () => {
    openSettings();
    const card = doc.querySelector('.sp-preview');
    expect(text(card.querySelector('h2'))).toBe('Preview as Student');
    expect(text(card.querySelector('.cm-hint'))).toBe('See the page exactly as one student sees it. Nothing is sent.');
    const select = card.querySelector('#sp-preview-student');
    expect(select.getAttribute('aria-label')).toBe('Student');
    expect([...select.querySelectorAll('option')].map(o => text(o))).toEqual(['Avery Kim', 'Jordan Reyes']);
    expect(text(doc.getElementById('sp-preview-open'))).toBe('Open Preview');
  });

  it('is not there for a class whose student page is off', () => {
    seed({});
    openSettings();
    expect(doc.querySelector('.sp-preview')).toBeNull();
    expect(DashClassManager.handleAction('spPreview', { dataset: {}, closest: () => null })).not.toBe(true);
    expect(overlay()).toBeNull();
  });

  it('opens the student chosen in the list', () => {
    openSettings();
    const select = doc.getElementById('sp-preview-student');
    pick(select, S1);
    DashClassManager.handleChange(select);
    openPreview();
    expect(text(overlay().querySelector('#ps-title'))).toBe('Previewing as Jordan Reyes');
    // The list remembers the student while Class Settings is open.
    PreviewStudent.close();
    openSettings();
    expect(doc.getElementById('sp-preview-student').value).toBe(S1);
  });
});

describe('the preview', () => {
  function openJordan() {
    openSettings();
    const select = doc.getElementById('sp-preview-student');
    pick(select, S1);
    DashClassManager.handleChange(select);
    return openPreview();
  }

  it('is a dialog with the board’s bar: who, Nothing is sent, Phone and Chromebook, Back', () => {
    const el = openJordan();
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-modal')).toBe('true');
    expect(text(el.querySelector('#ps-line'))).toBe('This is Jordan’s page now. Nothing is sent.');
    const seg = [...el.querySelectorAll('[data-ps-device]')];
    expect(seg.map(b => [text(b), b.getAttribute('aria-checked')])).toEqual([
      ['Phone', 'true'],
      ['Chromebook', 'false'],
    ]);
    expect(text(el.querySelector('[data-ps-close]'))).toBe('Back to Class Settings');
    expect(doc.activeElement).toBe(el.querySelector('[data-ps-close]'));
  });

  it('draws the page StudentView builds: returned grades only, worded by calc.js', () => {
    const el = openJordan();
    const { view } = StudentView.fromCache(CID, S1);
    showAll(el);
    const rows = [...el.querySelectorAll('.sp-row')].map(r => ({
      title: text(r.querySelector('.sp-row-title')),
      result: text(r.querySelector('.sp-row-result')),
    }));
    expect(rows).toEqual(view.work.map(p => ({ title: p.title, result: p.result.text })));
    expect(rows.find(r => r.title === 'Draft Poster').result).toBe('');
    // The changed reflection shows the grade returned, not the draft.
    const reflect = getAssessments(CID).find(a => a.id === 'reflect');
    const returned = withReturnedOnly(() => assessmentCellValue(CID, S1, reflect)).text;
    expect(rows.find(r => r.title === 'Changed Reflection').result).toBe(returned);
    expect(assessmentCellValue(CID, S1, reflect).text).not.toBe(returned);
    expect(el.innerHTML).not.toMatch(SECRET);
    expect(text(el.querySelector('.sp-head-title'))).toBe('Socials 10');
    expect(text(el.querySelector('.sp-pill'))).toBe('Block C');
  });

  it('the page inside the device answers presses as the student’s does: tabs, To Do, Sent and Back, search, a card', () => {
    const el = openJordan();
    const screen = () => el.querySelector('.ps-screen');
    const { view } = StudentView.fromCache(CID, S1);
    // It opens as the student's does: Assignments, To Do.
    expect(screen().querySelector('.sp-segment[aria-pressed="true"]').textContent).toMatch(/^To Do \d+$/);
    click(screen().querySelector('[data-segment="back"]'));
    const back = view.work.filter(p => p.kind === 'back').map(p => p.title);
    expect([...screen().querySelectorAll('.sp-deck .sp-piece-title')].map(t => text(t))).toEqual(back);
    // The page inside the device is the student page's own drawing for that choice.
    const same = doc.createElement('div');
    same.innerHTML = StudentPageView.html(view, { tab: 'assignments', segment: 'back', all: false, pick: '' });
    expect(screen().innerHTML === same.innerHTML).toBe(true);
    click(screen().querySelector('.sp-tabs-bottom [data-tab="reports"]'));
    expect(text(screen().querySelector('.sp-page-title'))).toBe('My Reports');
    click(screen().querySelector('[data-act="all-open"]'));
    const box = screen().querySelector('#sp-search');
    box.value = 'reflection';
    box.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true }));
    expect([...screen().querySelectorAll('.sp-row-title')].map(t => text(t))).toEqual(
      view.work.filter(p => /reflection/i.test(p.title)).map(p => p.title),
    );
    // Done and Your Classes reach for the student's session: here they do nothing.
    const before = screen().innerHTML;
    click(screen().querySelector('[data-act="card-done"]'));
    click(screen().querySelector('[data-act="classes-open"]'));
    expect(screen().innerHTML).toBe(before);
    expect(overlay()).toBeTruthy();
  });

  it('lists what Jordan sees and doesn’t see, in the board’s words', () => {
    const el = openJordan();
    const cards = [...el.querySelectorAll('.ps-card')].map(c => ({
      title: text(c.querySelector('.ps-card-title')),
      items: [...c.querySelectorAll('.ps-item')].map(i => [
        text(i.querySelector('.ps-item-title')),
        text(i.querySelector('.ps-item-line')),
      ]),
    }));
    expect(cards).toEqual([
      {
        title: 'Jordan Sees',
        items: [['Your Result', 'Each returned piece, in this class’s grading style (Both).']],
      },
      {
        title: 'Jordan Doesn’t See',
        items: [
          [
            'Grades you haven’t returned',
            'Drafts never reach the student page. 2 grades are waiting for you to return them.',
          ],
          ['Other students', 'No class average, no one else’s work.'],
          ['Your private notes', 'Observations marked Private stay with you.'],
        ],
      },
    ]);
  });

  it.each([
    ['proficiency', 'Proficiency'],
    ['letter', 'Letter'],
  ])('names the class’s grading style (%s)', (system, word) => {
    seed(undefined, system);
    const el = openJordan();
    expect(text(el.querySelector('.ps-item-line'))).toBe(
      'Each returned piece, in this class’s grading style (' + word + ').',
    );
  });

  it('switches between Phone and Chromebook, keeping the focus on the toggle', () => {
    const el = openJordan();
    expect(el.querySelector('.ps-device-phone')).toBeTruthy();
    click(el.querySelector('[data-ps-device="chromebook"]'));
    expect(el.querySelector('.ps-device-chromebook')).toBeTruthy();
    expect(el.querySelector('.ps-device-phone')).toBeNull();
    expect(el.querySelector('[data-ps-device="chromebook"]').getAttribute('aria-checked')).toBe('true');
    // The same page in either, and what the student chose to look at is kept.
    showAll(el);
    click(el.querySelector('[data-ps-device="phone"]'));
    expect(el.querySelector('.ps-screen [data-act="all-open"]').getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelectorAll('.sp-row').length).toBe(4);
  });

  it('Back to Class Settings and Escape close it, and the focus goes back to Open Preview', () => {
    let el = openJordan();
    click(el.querySelector('[data-ps-close]'));
    expect(overlay()).toBeNull();
    expect(doc.activeElement).toBe(doc.getElementById('sp-preview-open'));
    el = openPreview();
    key(el, 'Escape');
    expect(overlay()).toBeNull();
    expect(PreviewStudent.isOpen()).toBe(false);
  });

  it('keeps Tab inside it', () => {
    const el = openJordan();
    const buttons = [...el.querySelectorAll('button')];
    buttons[buttons.length - 1].focus();
    const e = key(el, 'Tab');
    expect(e.defaultPrevented).toBe(true);
    expect(doc.activeElement).toBe(buttons[0]);
  });

  it('a redraw of Class Settings for another class closes it; for this class it draws again', () => {
    seedClass(OTHER, { students: [{ id: 'x', firstName: 'X', lastName: 'Y' }], courseConfigs: structuredClone(HELD) });
    COURSES[OTHER] = { id: OTHER, name: 'Other', gradingSystem: 'proficiency' };
    openJordan();
    CmStudentPage.render(CID);
    expect(PreviewStudent.isOpen()).toBe(true);
    CmStudentPage.render(OTHER);
    expect(PreviewStudent.isOpen()).toBe(false);
    expect(overlay()).toBeNull();
    // A refresh with nothing open does nothing.
    PreviewStudent.refresh(CID);
    expect(overlay()).toBeNull();
  });

  it('closes when the class’s student page is turned off', () => {
    openJordan();
    saveCourseConfig(CID, Object.assign({}, getCourseConfig(CID), { student_page_enabled: false }));
    CmStudentPage.render(CID);
    expect(PreviewStudent.isOpen()).toBe(false);
  });
});

describe('a signed-in class whose Draft and Returned rows have not loaded', () => {
  let session;
  beforeEach(() => {
    session = signIn();
    _setServerStudentPage(CID, true);
    delete _gradeReturnsLoadedFor[CID];
    delete _returnedSets[CID];
  });
  afterEach(() => {
    session.signOut();
    delete _serverStudentPage[CID];
    localStorage.removeItem('gb-bundle-meta-' + CID);
  });

  it('draws Loading this class…, then the page once the rows load and Class Settings draws again', () => {
    expect(PreviewStudent.open(CID, S1, null)).toBe(true);
    const el = overlay();
    expect(text(el.querySelector('.ps-waiting'))).toBe('Loading this class…');
    expect(el.querySelectorAll('.sp-row').length).toBe(0);
    expect(el.innerHTML).not.toMatch(SECRET);
    // No draft count is said while the rows are not known.
    expect(text(el.querySelectorAll('.ps-item-line')[1])).toBe('Drafts never reach the student page.');
    _loadGradeReturns(CID, structuredClone(_cache.gradeReturns[CID] || {}));
    CmStudentPage.render(CID);
    showAll(overlay());
    expect(overlay().querySelectorAll('.sp-row').length).toBe(4);
    expect(overlay().innerHTML).not.toMatch(SECRET);
  });
});

describe('Demo Mode', () => {
  it('opening and using the preview sends nothing', () => {
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
    _useSupabase = false;
    const el = PreviewStudent.open(CID, S1, null) && overlay();
    click(el.querySelector('[data-ps-device="chromebook"]'));
    PreviewStudent.refresh(CID);
    click(overlay().querySelector('[data-ps-close]'));
    expect(calls).toEqual([]);
    // Nothing was saved either.
    expect(localStorage.getItem('gb-grade-returns-' + CID)).toBe(JSON.stringify(_cache.gradeReturns[CID]));
  });
});

describe('S9-F3: See Your Work in the preview, from the marks the student was given', () => {
  const MARKS = { v: 1, marks: [{ type: 'note', x: 0.4, y: 0.3, text: 'Name your source.' }] };
  const READERS = ['getStudentMarkCounts', 'getStudentMarkup', 'getStudentSubmission', 'openStudentWorkPage'];
  let saved;
  // The data layer's Mark Up readers (PR 1063's), answering for Jordan's essay only.
  function stubMarkup(opts) {
    saved = {};
    READERS.forEach(n => (saved[n] = globalThis[n]));
    const given = (cid, sid, aid) => cid === CID && sid === S1 && aid === 'essay';
    globalThis.getStudentMarkCounts = (cid, sid, aid) => (given(cid, sid, aid) ? { pages: 1, notes: 1 } : null);
    globalThis.getStudentMarkup = (cid, sid, aid) => ({
      ok: true,
      files: given(cid, sid, aid) ? [{ file_id: 'f1', marks: MARKS, given_at: '2026-11-03T18:00:00Z' }] : [],
    });
    globalThis.getStudentSubmission = (cid, sid, aid) =>
      given(cid, sid, aid) ? { id: 's1', files: [{ id: 'f1', page: 1, path: 'cell-lab-jordan-1.jpg' }] } : null;
    globalThis.openStudentWorkPage = (cid, file) =>
      (opts && opts.hold) || Promise.resolve({ url: '/assets/sample-work/' + file.path, release() {} });
  }
  afterEach(() => {
    Object.keys(saved || {}).forEach(n => (globalThis[n] = saved[n]));
    saved = null;
  });
  const screen = () => overlay().querySelector('.ps-screen');
  function openEssayFeedback() {
    PreviewStudent.open(CID, S1, null);
    click(screen().querySelector('[data-segment="back"]'));
    click(screen().querySelector('.sp-piece[data-piece="essay"] [data-act="feedback"]'));
  }

  it('Jordan Sees names the notes; Your Feedback has See Your Work; it opens the page with the marks', async () => {
    stubMarkup();
    openEssayFeedback();
    const sees = [...overlay().querySelectorAll('.ps-side-left .ps-item')].map(li => [
      text(li.querySelector('.ps-item-title')),
      text(li.querySelector('.ps-item-line')),
    ]);
    expect(sees).toContainEqual(['1 note on Jordan’s work', 'Your Mark Up, on the photos.']);
    expect(text(screen().querySelector('.sp-fb-work-line'))).toBe('1 page · 1 note on your work');
    click(screen().querySelector('[data-act="work"]'));
    await vi.waitFor(() => expect(screen().querySelector('.sp-work-img')).toBeTruthy());
    expect(screen().querySelector('.sp-work-img').getAttribute('src')).toBe(
      '/assets/sample-work/cell-lab-jordan-1.jpg',
    );
    expect(text(screen().querySelector('.sp-work-notes li span:last-child'))).toBe('Name your source.');
  });

  it('with no marks given (no reader yet, or none), nothing of Mark Up shows', () => {
    stubMarkup();
    globalThis.getStudentMarkCounts = () => null;
    openEssayFeedback();
    expect(screen().querySelector('[data-act="work"]')).toBeNull();
    expect(overlay().textContent).not.toMatch(/Mark Up/);
  });

  it('a page that arrives after See Your Work closed is let go and not drawn', async () => {
    let settle;
    const hold = new Promise(r => (settle = r));
    stubMarkup({ hold });
    openEssayFeedback();
    click(screen().querySelector('[data-act="work"]'));
    expect(text(screen().querySelector('.sp-work [role="status"]'))).toBe('Getting your work…');
    click(screen().querySelector('[data-act="work-close"]'));
    let released = 0;
    settle({ url: '/assets/sample-work/x.jpg', release: () => (released += 1) });
    await vi.waitFor(() => expect(released).toBe(1));
    expect(screen().querySelector('.sp-work')).toBeNull();
    expect(text(screen().querySelector('#sp-fb-title'))).toBe('Returned Essay');
  });
});
