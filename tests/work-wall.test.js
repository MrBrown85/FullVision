/**
 * The Work Wall and the Work tab (S14-F1 to F2, Demo Mode).
 *
 * The plan's tests: thumbnails only until a page is opened (a class of 28
 * asks for 28 thumbnails and no page); sorting; the level filters. Also:
 * the counts are GraderWork's; levels show through calc.js in the class's
 * grading style, drafts included and marked (a teacher's view); Grade in
 * This Order opens the grader on the students shown, in the order shown;
 * an answer that comes after the wall closed is let go; with Send Work off
 * there is no wall and no Work tab.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const PIECE = U(31);
const OTHER = U(32);
const Q = U(41);
const P = U(42);
const LAST = [
  'Abbott', 'Baker', 'Chen', 'Diaz', 'Evans', 'Ford', 'Gill', 'Hall', 'Iqbal', 'Jones',
  'Kaur', 'Lal', 'Moss', 'Nash', 'Owen', 'Park', 'Quinn', 'Ross', 'Shaw', 'Tran',
  'Ueda', 'Vance', 'Wong', 'Xu', 'Young', 'Zane', 'Zhou', 'Zorn',
]; // prettier-ignore
const IDS = LAST.map((_, i) => U(100 + i));
// Board's counts: Extending 3, Proficient 10, Developing 4, Emerging 1, To Grade 6, Not In 4.
const LEVEL_OF = [4, 4, 4, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2, 2, 2, 2, 1];
const GRADED = IDS.slice(0, 18);
const TO_GRADE = IDS.slice(18, 24);
const NOT_IN = IDS.slice(24);

let doc;
let stubDocument;
let wasDemo;
let realOpen;
let asked;
let realPA;

const text = el => el.textContent.replace(/\s+/g, ' ').trim();
const $ = sel => doc.querySelector(sel);
const $$ = sel => [...doc.querySelectorAll(sel)];
const settle = () => new Promise(r => setTimeout(r, 0));
const click = el => el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true }));

function file(sid, n) {
  const k = sid.slice(-3);
  return { id: 'f' + k + n, page: n, path: 'w' + k + '-' + n + '.jpg', thumb_path: 'w' + k + '-' + n + '-thumb.jpg' };
}
function sub(sid, aid, files, extra) {
  return Object.assign(
    {
      id: 'w-' + aid.slice(-2) + sid.slice(-3),
      assessment_id: aid,
      enrollment_id: sid,
      version: 1,
      state: 'sent',
      sent_by: 'student',
      on_paper: false,
      is_late: false,
      note: null,
      sent_at: '2026-10-30T20:41:00Z',
      created_at: '2026-10-30T20:41:00Z',
      files,
    },
    extra || {},
  );
}

function seed({ sendWork = true, all = false, gradingSystem = 'proficiency', statuses = {} } = {}) {
  const scores = {};
  GRADED.forEach((sid, i) => {
    const lv = LEVEL_OF[i];
    // Q at the level; P one lower (or the same at 1), so the Competency view differs.
    scores[sid] = [
      { assessmentId: PIECE, tagId: Q, score: lv, date: '2026-10-30' },
      { assessmentId: PIECE, tagId: P, score: Math.max(1, lv - 1), date: '2026-10-30' },
    ];
  });
  seedClass(CID, {
    students: LAST.map((last, i) => ({ id: IDS[i], firstName: 'S' + i, lastName: last })),
    learningMaps: {
      subjects: [],
      sections: [
        { id: U(51), name: 'Question', tags: [{ id: Q, label: 'Question', text: 'Ask questions' }] },
        { id: U(52), name: 'Plan', tags: [{ id: P, label: 'Plan', text: 'Plan a test' }] },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [
      { id: PIECE, title: 'Conscription', tagIds: [Q, P], date: '2026-10-20', dueDate: '2026-10-30' },
      { id: OTHER, title: 'Vimy Ridge', tagIds: [Q], date: '2026-10-10', dueDate: '2026-10-16' },
    ],
    scores,
    statuses,
    courseConfigs: { student_page_enabled: true, return_grades: 'on_save' },
  });
  COURSES[CID].name = 'Socials 10';
  COURSES[CID].gradingSystem = gradingSystem;
  const withWork = all ? IDS : IDS.slice(0, 24);
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [
      { id: PIECE, students_send: 'photos' },
      { id: OTHER, students_send: 'photos' },
    ],
    submissions: [
      ...withWork.map((sid, i) => sub(sid, PIECE, i === 3 ? [file(sid, 1), file(sid, 2)] : [file(sid, 1)])),
      sub(IDS[0], OTHER, [file(IDS[0], 9)], { sent_at: '2026-10-16T18:00:00Z' }),
    ],
  });
  clearProfCache();
}

beforeEach(() => {
  localStorage.clear();
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  stubDocument = globalThis.document;
  doc = parseHTML(
    '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
  ).document;
  globalThis.document = doc;
  globalThis.requestAnimationFrame = fn => fn();
  realOpen = globalThis.openStudentWorkPage;
  realPA = window.PageAssignments;
  window.PageAssignments = { openGrader: vi.fn(), graderOpen: vi.fn(() => false) };
  asked = [];
  globalThis.openStudentWorkPage = (cid, f, which) => {
    asked.push(which + ':' + (which === 'thumb' ? f.thumb_path : f.path));
    return realOpen(cid, f, which);
  };
});
afterEach(() => {
  WorkWall.close(true);
  WorkWall.unmountTab(true);
  if (window.PageStudent && PageStudent.destroy) PageStudent.destroy();
  globalThis.openStudentWorkPage = realOpen;
  window.PageAssignments = realPA;
  globalThis.document = stubDocument;
  clearClass(CID);
  localStorage.clear();
  window.isDemoMode = wasDemo;
  vi.restoreAllMocks();
});

const names = () => $$('.ww-card .ww-name').map(text);
const nameOf = sid => {
  const st = getStudents(CID).find(s => s.id === sid);
  return displayName(st);
};
const pill = f => $('.ww-pill[data-filter="' + f + '"]');

describe('the Work Wall opens where work is on or in', () => {
  const emptied = () =>
    saveDemoStudentWork(CID, {
      course: { send_work: false },
      assessments: [{ id: PIECE, students_send: 'photos' }],
      submissions: [],
    });

  it('Send Work off, nothing in: no wall', () => {
    seed({ sendWork: false });
    emptied();
    expect(WorkWall.open(CID, PIECE)).toBe(false);
    expect($('#work-wall-overlay')).toBeNull();
    expect(asked).toEqual([]);
  });

  it('Send Work off, work in: the wall shows it', () => {
    seed({ sendWork: false });
    expect(WorkWall.open(CID, PIECE)).toBe(true);
    expect($('#work-wall-overlay')).not.toBeNull();
    WorkWall.close();
  });

  it('Demo Mode with the build switch off: no wall, work in or not', () => {
    seed();
    setStudentPageSwitch(CID, false);
    expect(WorkWall.open(CID, PIECE)).toBe(false);
    expect($('#work-wall-overlay') === null).toBe(true);
    expect(WorkWall.seeWorkHtml(CID, PIECE, IDS[0])).toBe('');
    expect(WorkWall.pieceHtml(CID, IDS[0], PIECE)).toBe('');
    expect(WorkWall.tabOn(CID)).toBe(false);
  });
});

describe('the wall', () => {
  it("says the board's words and GraderWork's counts", () => {
    seed();
    expect(WorkWall.open(CID, PIECE)).toBe(true);
    expect(text($('.ww-title'))).toBe('Work Wall');
    expect(text($('.ww-sub'))).toBe('Conscription · Socials 10');
    expect($('.ww-back').getAttribute('aria-label')).toBe('Back to Assignments');
    expect($$('.ww-seg-btn').map(text)).toEqual(['Name', 'To Grade First', 'Level']);
    expect(text($('.ww-grade'))).toBe('Grade in This Order');
    expect($$('.ww-pill').map(text)).toEqual([
      'All 28',
      'Extending 3',
      'Proficient 10',
      'Developing 4',
      'Emerging 1',
      'To Grade 6',
      'Not In 4',
    ]);
    const c = GraderWork.workCounts(CID, PIECE);
    expect(c.tograde).toBe(6);
    expect(c.notin).toBe(4);
    expect($$('.ww-card').length).toBe(28);
  });

  it('a class of 28 loads thumbnails only, once, until a page is opened', async () => {
    seed({ all: true });
    WorkWall.open(CID, PIECE);
    await settle();
    expect(asked.length).toBe(28);
    expect(asked.every(a => a.startsWith('thumb:'))).toBe(true);
    expect($$('.ww-card img').every(img => /-thumb\.jpg$/.test(img.getAttribute('src')))).toBe(true);
    // A sort and a filter draw the wall again and ask for nothing new.
    click($('.ww-seg-btn[data-sort="name"]'));
    click(pill('3'));
    click(pill('3'));
    await settle();
    expect(asked.length).toBe(28);
    // Opening a card asks for that one page, full size.
    click($('.ww-card[data-sid="' + IDS[3] + '"]'));
    await settle();
    expect(asked.slice(28)).toEqual(['page:' + file(IDS[3], 1).path]);
    expect($('.wv-img').getAttribute('src')).toMatch(/w103-1\.jpg$/);
  });

  it('a thumbnail that comes after the wall closed is let go, not drawn', async () => {
    seed();
    const release = vi.fn();
    let answer;
    globalThis.openStudentWorkPage = () => new Promise(r => (answer = r));
    WorkWall.open(CID, PIECE);
    const img = $('.ww-card img');
    WorkWall.close();
    answer({ url: '/x.jpg', release });
    await settle();
    expect(release).toHaveBeenCalledTimes(1);
    expect(img.getAttribute('src')).toBe(null);
  });

  it('cards: the first page, the name, the level through calc.js', async () => {
    seed();
    WorkWall.open(CID, PIECE);
    click($('.ww-seg-btn[data-sort="name"]'));
    const card = sid => $('.ww-card[data-sid="' + sid + '"]');
    const a = getAssessments(CID).find(x => x.id === PIECE);
    expect(text(card(IDS[0]).querySelector('.ww-chip'))).toBe(assessmentCellValue(CID, IDS[0], a).text);
    expect(card(IDS[0]).querySelector('.ww-chip').classList.contains('ww-lv-4')).toBe(true);
    expect(text(card(TO_GRADE[0]).querySelector('.ww-chip'))).toBe('To Grade');
    expect(text(card(NOT_IN[0]).querySelector('.ww-nopic'))).toBe('Not In');
    expect(card(NOT_IN[0]).querySelector('img')).toBeNull();
    expect(text(card(IDS[3]).querySelector('.ww-count'))).toBe('2 pages');
    expect(card(IDS[0]).querySelector('img').getAttribute('alt')).toBe(nameOf(IDS[0]) + "'s first page");
  });

  it('a Letter class shows its levels as the class does', () => {
    seed({ gradingSystem: 'letter' });
    WorkWall.open(CID, PIECE);
    const a = getAssessments(CID).find(x => x.id === PIECE);
    const chip = text($('.ww-card[data-sid="' + IDS[0] + '"] .ww-chip'));
    expect(chip).toBe(assessmentCellValue(CID, IDS[0], a).text);
    expect(chip).toMatch(/%$/);
  });

  it('Missing shows as the gradebook does and counts no level', () => {
    seed({ statuses: { [IDS[0] + ':' + PIECE]: 'NS' } });
    WorkWall.open(CID, PIECE);
    expect(text($('.ww-card[data-sid="' + IDS[0] + '"] .ww-chip'))).toBe('M');
    expect(text(pill('4'))).toBe('Extending 2');
  });

  it('a draft shows (a teacher view) and is marked', () => {
    seed();
    saveReturnSettings(CID, { return_grades: 'on_return' });
    Grader.setLevel(CID, TO_GRADE[0], PIECE, Q, 3, 0);
    clearProfCache();
    WorkWall.open(CID, PIECE);
    const chip = $('.ww-card[data-sid="' + TO_GRADE[0] + '"] .ww-chip');
    expect(chip.classList.contains('is-draft')).toBe(true);
    expect(chip.getAttribute('title')).toBe('Draft: graded, not returned');
    expect(text(pill('tograde'))).toBe('To Grade 5');
  });
});

describe('sorting', () => {
  it('To Grade First is the first sort while work waits: the 6 first, Not In last', () => {
    seed();
    WorkWall.open(CID, PIECE);
    expect($('.ww-seg-btn[data-sort="tograde"]').getAttribute('aria-pressed')).toBe('true');
    const shown = $$('.ww-card').map(c => c.dataset.sid);
    expect(shown.slice(0, 6)).toEqual(TO_GRADE);
    expect(shown.slice(-4)).toEqual(NOT_IN);
  });

  it('Name: the class in last-name order', () => {
    seed();
    WorkWall.open(CID, PIECE);
    click($('.ww-seg-btn[data-sort="name"]'));
    expect(names()).toEqual(IDS.map(nameOf));
    expect($$('.ww-group-head')).toEqual([]);
  });

  it('Level: highest first, under a heading per level, then No Level Yet and Not In', () => {
    seed();
    WorkWall.open(CID, PIECE);
    click($('.ww-seg-btn[data-sort="level"]'));
    expect($$('.ww-group-head').map(text)).toEqual([
      'Extending3 students',
      'Proficient10 students',
      'Developing4 students',
      'Emerging1 student',
      'No Level Yet6 students',
      'Not In4 students',
    ]);
    expect($$('.ww-card').map(c => c.dataset.sid)).toEqual([...GRADED, ...TO_GRADE, ...NOT_IN]);
  });

  it('all graded: Level is the first sort', () => {
    seed();
    TO_GRADE.forEach(sid => Grader.setLevel(CID, sid, PIECE, Q, 3, 0));
    clearProfCache();
    WorkWall.open(CID, PIECE);
    expect($('.ww-seg-btn[data-sort="level"]').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('the level filters', () => {
  it('a level shows only its students, under its heading; again shows everyone', () => {
    seed();
    WorkWall.open(CID, PIECE);
    click(pill('3'));
    expect(pill('3').getAttribute('aria-pressed')).toBe('true');
    expect($$('.ww-card').map(c => c.dataset.sid)).toEqual(GRADED.slice(3, 13));
    expect($$('.ww-group-head').map(text)).toEqual(['Proficient10 students']);
    click(pill('3'));
    expect($$('.ww-card').length).toBe(28);
    expect(pill('all').getAttribute('aria-pressed')).toBe('true');
  });

  it('To Grade and Not In', () => {
    seed();
    WorkWall.open(CID, PIECE);
    click(pill('tograde'));
    expect($$('.ww-card').map(c => c.dataset.sid)).toEqual(TO_GRADE);
    click(pill('notin'));
    expect($$('.ww-card').map(c => c.dataset.sid)).toEqual(NOT_IN);
    click(pill('1'));
    expect($$('.ww-card').map(c => c.dataset.sid)).toEqual([GRADED[17]]);
  });

  it('a filter with nobody says so, and Grade in This Order is off', () => {
    seed({ statuses: { [GRADED[17] + ':' + PIECE]: 'NS' } });
    WorkWall.open(CID, PIECE);
    click(pill('1'));
    expect(text($('.ww-empty'))).toBe('No students match this filter.');
    expect($('.ww-grade').disabled).toBe(true);
  });

  it('by Competency: the levels and the counts follow it', () => {
    seed();
    WorkWall.open(CID, PIECE);
    expect(text($('label[for="ww-by"]'))).toBe('Competency');
    expect($$('#ww-by option').map(text)).toEqual(['Whole Piece', 'Question', 'Plan']);
    const select = $('#ww-by');
    Object.defineProperty(select, 'value', { value: P, configurable: true });
    select.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
    // P is one lower: no Extending, the old Extending now Proficient.
    expect(text(pill('4'))).toBe('Extending 0');
    expect(text(pill('3'))).toBe('Proficient 3');
    const chip = text($('.ww-card[data-sid="' + IDS[0] + '"] .ww-chip'));
    expect(chip).toBe(formatLevel(CID, 3, ''));
  });
});

describe('the door into the grader', () => {
  it('Grade in This Order: the grader on the students shown, in the order shown', () => {
    seed();
    const spy = PageAssignments.openGrader;
    WorkWall.open(CID, PIECE);
    click(pill('3'));
    click($('.ww-seg-btn[data-sort="name"]'));
    click($('.ww-grade'));
    expect(spy).toHaveBeenCalledTimes(1);
    const [cid, aid, sid, opts] = spy.mock.calls[0];
    expect([cid, aid, sid]).toEqual([CID, PIECE, GRADED[3]]);
    expect(opts.studentIds).toEqual(GRADED.slice(3, 13));
    // Closing the grader draws the wall again.
    Grader.setLevel(CID, GRADED[3], PIECE, Q, 4, 0);
    Grader.setLevel(CID, GRADED[3], PIECE, P, 4, 0);
    clearProfCache();
    opts.onClose();
    expect(text(pill('3'))).toBe('Proficient 9');
  });

  it('a screen with its own grader (the phone) passes its way in; with none there is no Grade button', () => {
    seed();
    const onGrade = vi.fn();
    WorkWall.open(CID, PIECE, { onGrade });
    click(pill('tograde'));
    click($('.ww-grade'));
    expect(onGrade).toHaveBeenCalledWith(TO_GRADE[0], TO_GRADE);
    expect(PageAssignments.openGrader).not.toHaveBeenCalled();
    WorkWall.close(true);
    window.PageAssignments = {};
    WorkWall.open(CID, PIECE);
    expect($('.ww-grade')).toBeNull();
    click($('.ww-card[data-sid="' + IDS[0] + '"]'));
    expect($('[data-wv="grade"]')).toBeNull();
  });

  it('a card with nothing to look at opens the grader on that student', () => {
    seed();
    const spy = PageAssignments.openGrader;
    WorkWall.open(CID, PIECE);
    click($('.ww-card[data-sid="' + NOT_IN[0] + '"]'));
    expect(spy.mock.calls[0][2]).toBe(NOT_IN[0]);
    expect($('#work-viewer-overlay')).toBeNull();
  });

  it("a page opened full size: step through the students' work, then Open in Grader", async () => {
    seed();
    const spy = PageAssignments.openGrader;
    WorkWall.open(CID, PIECE);
    click($('.ww-seg-btn[data-sort="name"]'));
    click($('.ww-card[data-sid="' + IDS[3] + '"]'));
    expect(text($('.wv-title'))).toBe(nameOf(IDS[3]));
    expect(text($('.wv-at'))).toBe('1 of 2');
    click($('[data-wv="page"][data-dir="1"]'));
    expect(text($('.wv-at'))).toBe('2 of 2');
    click($('[data-wv="item"][data-dir="1"]'));
    expect(text($('.wv-title'))).toBe(nameOf(IDS[4]));
    expect($('[data-wv="item"][data-dir="1"]').getAttribute('aria-label')).toBe('Next Student');
    click($('[data-wv="grade"]'));
    expect($('#work-viewer-overlay')).toBeNull();
    expect(spy.mock.calls[0][2]).toBe(IDS[4]);
  });

  it('Escape closes the page, then the wall; not while the grader is open', () => {
    seed();
    WorkWall.open(CID, PIECE);
    click($('.ww-card[data-sid="' + IDS[0] + '"]'));
    const esc = () => doc.dispatchEvent(Object.assign(new doc.defaultView.Event('keydown'), { key: 'Escape' }));
    globalThis.document = doc;
    PageAssignments.graderOpen.mockReturnValue(true);
    esc();
    expect($('#work-viewer-overlay')).not.toBeNull();
    PageAssignments.graderOpen.mockReturnValue(false);
    esc();
    expect($('#work-viewer-overlay')).toBeNull();
    expect(WorkWall.isOpen()).toBe(true);
    esc();
    expect(WorkWall.isOpen()).toBe(false);
  });
});

describe("work on the teacher's other screens", () => {
  const last = IDS[IDS.length - 1]; // nothing in

  it('See the Work on a row of the whole-class grid: only where work is in for the student', () => {
    seed({ sendWork: false });
    const html = WorkWall.seeWorkHtml(CID, PIECE, IDS[0]);
    expect(html).toContain('data-action="gradeSubmissions"');
    expect(html).toContain('data-cid="' + CID + '" data-aid="' + PIECE + '" data-sid="' + IDS[0] + '"');
    expect(html).toContain('>See the Work<');
    expect(WorkWall.seeWorkHtml(CID, PIECE, last)).toBe('');
  });

  it('See the Work with focus: a glance at the first two pages, gone when focus leaves', async () => {
    seed({ sendWork: false });
    const main = doc.getElementById('main');
    const fire = (el, type) => el.dispatchEvent(new doc.defaultView.Event(type, { bubbles: true }));
    // IDS[3] sent two pages, IDS[0] one.
    main.innerHTML = WorkWall.seeWorkHtml(CID, PIECE, IDS[3]) + WorkWall.seeWorkHtml(CID, PIECE, IDS[0]);
    const [two, one] = $$('.rsg-see-work');
    fire(two, 'focusin');
    expect($$('.ww-glance .ww-glance-img')).toHaveLength(2);
    expect($('.ww-glance').getAttribute('aria-hidden')).toBe('true');
    expect($('.ww-glance-more')).toBeNull();
    await settle();
    // Each page and its thumbnail, asked for once.
    expect([...asked].sort()).toEqual(
      [
        'page:' + file(IDS[3], 1).path,
        'page:' + file(IDS[3], 2).path,
        'thumb:' + file(IDS[3], 1).thumb_path,
        'thumb:' + file(IDS[3], 2).thumb_path,
      ].sort(),
    );
    // The full pages are shown once they are in.
    expect($$('.ww-glance-img').map(img => img.getAttribute('data-sharp'))).toEqual(['1', '1']);
    fire(two, 'focusout');
    expect($('.ww-glance')).toBeNull();
    // A second look is drawn from what is kept: sharp at once, nothing asked for again.
    fire(two, 'focusin');
    expect($$('.ww-glance-img').every(img => !!img.getAttribute('src'))).toBe(true);
    expect($$('.ww-glance-img').map(img => img.getAttribute('data-sharp'))).toEqual(['1', '1']);
    expect(asked).toHaveLength(4);
    fire(two, 'focusout');
    fire(one, 'focusin');
    expect($$('.ww-glance .ww-glance-img')).toHaveLength(1);
    // A click on the button opens the grader; the glance goes.
    fire(one, 'click');
    expect($('.ww-glance')).toBeNull();
  });

  it('the pointer coming into an open card fetches every row’s thumbnails, ahead of any glance', async () => {
    seed({ sendWork: false });
    const main = doc.getElementById('main');
    const fire = (el, type) => el.dispatchEvent(new doc.defaultView.Event(type, { bubbles: true }));
    // Students no glance in this file has looked at: kept pictures outlive a test.
    main.innerHTML =
      '<div class="assess-card open"><span class="name">Row</span>' +
      IDS.slice(10, 16)
        .map(sid => WorkWall.seeWorkHtml(CID, PIECE, sid))
        .join('') +
      '</div>';
    fire(main.querySelector('.name'), 'mouseover');
    await settle();
    const want = [];
    IDS.slice(10, 16).forEach(sid => {
      const sub = getStudentSubmission(CID, sid, PIECE);
      if (sub) sub.files.slice(0, 2).forEach(f => want.push('thumb:' + f.thumb_path));
    });
    expect(want.length).toBeGreaterThan(4);
    expect([...asked].sort()).toEqual(want.sort());
    // Coming in again asks for nothing more.
    fire(main.querySelector('.name'), 'mouseover');
    await settle();
    expect(asked).toHaveLength(want.length);
  });

  it('an open row of All Your Work: the pages whole, each opening full size', async () => {
    seed({ sendWork: false });
    expect(WorkWall.pieceHtml(CID, last, PIECE)).toBe('');
    const main = doc.getElementById('main');
    main.innerHTML = WorkWall.pieceHtml(CID, IDS[3], PIECE);
    expect($$('.stu-ov-work .ovw-page').map(b => b.getAttribute('aria-label'))).toEqual([
      'Page 1 of 2, full size',
      'Page 2 of 2, full size',
    ]);
    WorkWall.mountPiece(main, CID, IDS[3]);
    await settle();
    expect(asked).toEqual(['page:' + file(IDS[3], 1).path, 'page:' + file(IDS[3], 2).path]);
    expect($$('.ovw-img').every(img => !!img.getAttribute('src'))).toBe(true);
    // Drawn again: nothing new is asked for.
    WorkWall.mountPiece(main, CID, IDS[3]);
    await settle();
    expect(asked).toHaveLength(2);
    click($$('.ovw-page')[1]);
    expect(text($('.wv-title'))).toBe(nameOf(IDS[3]));
    expect(text($('.wv-at'))).toBe('2 of 2');
    WorkWall.unmountTab(true);
    expect($('#work-viewer-overlay')).toBeNull();
  });
});

describe("the Work tab on the teacher's student page", () => {
  function openStudent(sid) {
    runInThisContext(readFileSync('teacher/page-student.js', 'utf-8'), { filename: 'teacher/page-student.js' });
    PageStudent.init({ id: sid, course: CID, tab: 'work' });
    return doc.getElementById('main');
  }

  it('Send Work off, nothing in for the class: no Work tab', () => {
    seed({ sendWork: false });
    saveDemoStudentWork(CID, { course: { send_work: false }, assessments: [], submissions: [] });
    const main = openStudent(IDS[0]);
    expect(main.querySelector('#stu-tab-work')).toBeNull();
    expect(main.querySelector('.sw-tab')).toBeNull();
  });

  it('Send Work off, work in: the Work tab shows it', () => {
    seed({ sendWork: false });
    const main = openStudent(IDS[0]);
    expect(main.querySelector('#stu-tab-work')).not.toBeNull();
    expect(main.querySelector('.sw-tab')).not.toBeNull();
  });

  it('the tile and the cards, newest first, thumbnails only', async () => {
    seed();
    const main = openStudent(IDS[0]);
    const tile = main.querySelector('#stu-tab-work');
    // Vimy Ridge came in and is not graded yet: a blue badge in place of the count.
    expect(text(tile)).toBe('Work1 to Grade');
    expect(tile.querySelector('.stu-tab-badge.todo')).not.toBeNull();
    expect(tile.getAttribute('aria-selected')).toBe('true');
    expect($$('.sw-card .sw-title').map(text)).toEqual(['Conscription', 'Vimy Ridge']);
    expect($$('.sw-card .sw-date').map(text)).toEqual(['Oct 30', 'Oct 16']);
    expect(text($('.sw-head'))).toBe('All Work');
    await settle();
    expect(asked).toEqual(['thumb:' + file(IDS[0], 1).thumb_path, 'thumb:' + file(IDS[0], 9).thumb_path]);
  });

  it('a piece waiting shows To Grade, and the tile counts it', () => {
    seed();
    const main = openStudent(TO_GRADE[0]);
    expect(text(main.querySelector('#stu-tab-work'))).toBe('Work1 to Grade');
    expect(text($('.sw-card .ww-chip'))).toBe('To Grade');
  });

  it('reads all work: a draft shows, marked', () => {
    seed();
    saveReturnSettings(CID, { return_grades: 'on_return' });
    Grader.setLevel(CID, TO_GRADE[0], PIECE, Q, 2, 0);
    clearProfCache();
    openStudent(TO_GRADE[0]);
    const chip = $('.sw-card .ww-chip');
    const a = getAssessments(CID).find(x => x.id === PIECE);
    expect(text(chip)).toContain(assessmentCellValue(CID, TO_GRADE[0], a).text);
    expect(chip.classList.contains('is-draft')).toBe(true);
  });

  it('the competency chips filter the work', () => {
    seed();
    openStudent(IDS[0]);
    expect($$('.sw-chip').map(text)).toEqual(['All Competencies', 'Question', 'Plan']);
    click($('.sw-chip[data-comp="' + U(52) + '"]'));
    expect($$('.sw-card .sw-title').map(text)).toEqual(['Conscription']);
    expect($('.sw-chip[data-comp="' + U(52) + '"]').getAttribute('aria-pressed')).toBe('true');
    click($('.sw-chip[data-comp=""]'));
    expect($$('.sw-card').length).toBe(2);
  });

  it('View Full Size steps through the pieces; Open in Grader opens that piece for this student', () => {
    seed();
    const spy = PageAssignments.openGrader;
    openStudent(IDS[0]);
    click($('[data-sw="full"]'));
    expect(text($('.wv-sub'))).toBe('Conscription');
    expect($('[data-wv="item"][data-dir="1"]').getAttribute('aria-label')).toBe('Next Piece');
    click($('[data-wv="item"][data-dir="1"]'));
    expect(text($('.wv-sub'))).toBe('Vimy Ridge');
    click($('[data-wv="grade"]'));
    const [cid, aid, sid, opts] = spy.mock.calls[0];
    expect([cid, aid, sid]).toEqual([CID, OTHER, IDS[0]]);
    expect(opts.studentIds).toEqual([IDS[0]]);
  });

  it('leaving the page lets the pictures go', async () => {
    seed();
    const release = vi.fn();
    globalThis.openStudentWorkPage = () => Promise.resolve({ url: '/x.jpg', release });
    openStudent(IDS[0]);
    await settle();
    expect(release).not.toHaveBeenCalled();
    PageStudent.destroy();
    expect(release).toHaveBeenCalledTimes(2);
  });
});

describe('no server', () => {
  it('names no server function', () => {
    const src = readFileSync(new URL('../shared/work-wall.js', import.meta.url), 'utf-8');
    expect(src).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|_writeRpc|\.rpc\(|getSupabase/);
  });
});
