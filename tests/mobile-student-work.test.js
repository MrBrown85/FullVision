/**
 * The phone's Grade tab with student work (S7-F1, S7-F2), on Demo Mode's
 * sample work (Science 8, Cell Microscope Lab).
 *
 * - With the build switch or Send Work off, nothing new is drawn: the list
 *   opens on Recent, no To Grade, no row menu, no work on a card.
 * - With both on: the counts (to grade, not in) come from
 *   teacher-mobile/grade-photos.js, the list opens on To Grade, the ⋯ menu
 *   offers Grade the N Waiting, and the grading screen can grade only the
 *   work waiting, with the pages and the student's note on the card.
 */
import './setup-mobile.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const LAB = 'sci8a1';
let wasDemo;

function seedDemo() {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
}

// Clear `sid`'s grade on the lab with the switch off, so their work waits.
function clearLab(sid) {
  const a = getAssessments(CID).find(x => x.id === LAB);
  const keys = [...new Set((getScores(CID)[sid] || []).filter(e => e.assessmentId === LAB).map(e => e.tagId))];
  Grader.setOverallComment(CID, sid, LAB, '');
  getRubricCheckIds(CID, sid, LAB).forEach(id => Grader.setTick(CID, sid, LAB, id, false));
  if (keys.length) Grader.clearScore(CID, getScores(CID), sid, a, keys);
}

function turnOn({ sendWork = true, page = true } = {}) {
  if (page) setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = sendWork;
  saveDemoStudentWork(CID, work);
}

/* A linkedom page with the holders teacher-mobile/index.html has. */
let stubDocument = null;
function page() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  globalThis.document = dom.document;
}
const stack = () => document.getElementById('m-nav-stack');

// The Grade tab's list, drawn as shell.js draws a tab.
function picker() {
  // html-safe: MGrade.renderPicker escapes names and text; a test page
  stack().innerHTML = MGrade.renderPicker(CID);
  MGrade.filterAssessments(CID);
  return stack();
}
// A grading screen, drawn as shell.js draws it.
function grading(opts) {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  stack().innerHTML = MGrade.renderSwiper(CID, LAB, opts);
  return stack();
}

beforeAll(() => {
  wasDemo = window.isDemoMode;
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
});
afterAll(() => {
  window.isDemoMode = wasDemo;
  CURRICULUM_INDEX = null;
  localStorage.clear();
});
afterEach(() => {
  globalThis.document = stubDocument;
});
beforeEach(() => {
  stubDocument = globalThis.document;
  page();
  seedDemo();
  clearLab('st2');
  clearLab('st3');
});

describe('with the build switch or Send Work off', () => {
  it.each([
    ['nothing on', { page: false, sendWork: false }],
    ['the student page on, Send Work off', { page: true, sendWork: false }],
    ['Send Work on, the student page off', { page: false, sendWork: true }],
  ])('%s: the list is as it was', (_, opts) => {
    turnOn(opts);
    expect(MGradePhotos.on(CID)).toBe(false);
    expect(
      MGradePhotos.toGrade(
        CID,
        getAssessments(CID).find(a => a.id === LAB),
      ),
    ).toEqual([]);
    const root = picker();
    expect(root.querySelector('[data-val="tograde"]')).toBeNull();
    expect(root.querySelector('[data-val="recent"]')).not.toBeNull();
    expect(root.querySelector('.m-tg-row, #m-grade-caught')).toBeNull();
    expect(grading().querySelector('.m-work')).toBeNull();
  });
});

describe('with the student page and Send Work on', () => {
  beforeEach(() => turnOn());

  it('counts the work waiting and the students not in', () => {
    const a = getAssessments(CID).find(x => x.id === LAB);
    expect(MGradePhotos.toGrade(CID, a)).toEqual(['st2', 'st3']);
    // Ten sent (one on paper): everyone else is not in.
    expect(MGradePhotos.notIn(CID, a)).toHaveLength(getStudents(CID).length - 10);
    expect(MGradePhotos.classToGrade(CID)).toBe(2);
    // A grade started is no longer waiting.
    Grader.setOverallComment(CID, 'st2', LAB, 'Good labels.');
    expect(MGradePhotos.toGrade(CID, a)).toEqual(['st3']);
  });

  it('opens on To Grade, with the row’s counts and the ⋯ menu', () => {
    const root = picker();
    const seg = root.querySelector('[data-val="tograde"]');
    expect(seg.classList.contains('m-seg-active')).toBe(true);
    expect(seg.textContent).toBe('To Grade2');
    const row = root.querySelector('.m-tg-row[data-aid="' + LAB + '"]');
    expect(row.style.display).not.toBe('none');
    expect(row.querySelector('.m-tg-pill').textContent).toBe('2 to grade');
    expect(row.querySelector('.m-tg-notin').textContent).toBe(getStudents(CID).length - 10 + ' not in');
    expect(row.querySelector('[data-action="m-grade-row-menu"]').getAttribute('aria-label')).toBe(
      'More for Cell Microscope Lab',
    );
    // A piece with nothing waiting is not on To Grade.
    const other = [...root.querySelectorAll('.m-tg-row')].filter(r => r.getAttribute('data-aid') !== LAB);
    expect(other.length).toBeGreaterThan(0);
    other.forEach(r => expect(r.style.display).toBe('none'));
    expect(root.querySelector('#m-grade-caught').style.display).toBe('none');
  });

  it('says All Caught Up when nothing waits', () => {
    Grader.setOverallComment(CID, 'st2', LAB, 'Done.');
    Grader.setOverallComment(CID, 'st3', LAB, 'Done.');
    const caught = picker().querySelector('#m-grade-caught');
    expect(caught.style.display).not.toBe('none');
    expect(caught.textContent).toBe('All Caught UpNothing is waiting to grade in Science 8.See All Assessments');
  });

  it('the row menu: Grade the 2 Waiting, from the first, and Grade Everyone', () => {
    picker();
    MGrade.openRowMenu(CID, LAB);
    const menu = document.querySelector('#m-sheet-container .m-tg-menu');
    const items = [...menu.querySelectorAll('.m-tg-menu-item')].map(b => b.textContent);
    expect(items).toEqual([
      'Grade the 2 WaitingStarts with Noor Al-Rashid',
      'Grade Everyone' + 'All ' + getStudents(CID).length + ', in roster order',
    ]);
    expect(menu.querySelector('[data-only="tograde"]').getAttribute('data-aid')).toBe(LAB);
    MComponents.dismissSheet();
  });

  it('grades only the work waiting, with the pages and the note on the card', () => {
    grading({ only: 'tograde' });
    const cards = document.querySelectorAll('.m-swiper-card');
    expect([...cards].map(c => c.getAttribute('data-sid'))).toEqual(['st2', 'st3']);
    expect(document.body.textContent).toContain('1 of 2 to grade');
    expect(MGrade.gradingOnly()).toBe('tograde');
    const noor = cards[0];
    expect(noor.querySelector('.m-work-sent').textContent).toMatch(/^Submitted .+ · 2 photos$/);
    expect(noor.querySelector('.m-work-note').textContent).toBe('Page 2 has my answers.');
    expect(noor.querySelectorAll('.m-work-page img')).toHaveLength(2);
    expect(noor.querySelectorAll('.m-work-dot')).toHaveLength(2);
    expect(noor.querySelector('.m-work-pin-btn').getAttribute('aria-label')).toBe('Show Noor’s photos');
    // The strip's circles say whose work is in.
    expect(document.querySelectorAll('.m-thumb.m-thumb-work')).toHaveLength(2);
    // Graded on the way, a card stays in the strip.
    Grader.setOverallComment(CID, 'st2', LAB, 'Good labels.');
    expect(MGrade.studentCardIndex(CID, LAB, 'st3')).toBe(1);
    // Opened for everyone, it is the whole class again.
    grading();
    expect(MGrade.gradingOnly()).toBeNull();
  });

  it('a student’s note is text, never markup', () => {
    const work = getCourseSubmissions(CID);
    work.submissions.find(s => s.enrollment_id === 'st2' && s.assessment_id === LAB).note = '<b>hi</b>';
    saveDemoStudentWork(CID, work);
    grading({ only: 'tograde' });
    const note = document.querySelector('.m-work-note');
    expect(note.querySelector('b')).toBeNull();
    expect(note.textContent).toBe('<b>hi</b>');
  });

  it('the filter applies as it is tapped and counts what it shows', () => {
    picker();
    MGrade.filterAssessments(CID, 'all');
    MGrade.openFilterSheet(CID);
    const total = getAssessments(CID).length;
    const count = () => document.querySelector('#m-sheet-container .m-live-filter-count').textContent;
    expect(count()).toBe('Showing ' + total + ' of ' + total);
    MGrade.onFilterSegChange('gradedStatus', 'has-ungraded');
    const shown = [...document.querySelectorAll('#m-grade-list .m-cell')].filter(c => c.style.display !== 'none');
    expect(shown.length).toBeLessThan(total);
    expect(count()).toBe('Showing ' + shown.length + ' of ' + total);
    // Kept, as Apply keeps it.
    expect(JSON.parse(localStorage.getItem('gb-grade-filters-' + CID)).gradedStatus).toBe('has-ungraded');
    // Tapped again, it lets go.
    MGrade.onFilterSegChange('gradedStatus', 'has-ungraded');
    expect(count()).toBe('Showing ' + total + ' of ' + total);
    MGrade.doneFilterSheet();
  });
});
