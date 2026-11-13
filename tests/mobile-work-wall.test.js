/**
 * The Grade tab's row menu on the phone (S14 follow-up): Work Wall, which
 * opens shared/work-wall.js, and Add Work for the N Not In; and the phone
 * grader in the order the wall shows (renderSwiper's `ids`). Demo Mode's
 * sample work (Science 8, Cell Microscope Lab).
 */
import './setup-mobile.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { newBankIndex } from './helpers/bc-bank-fixture.js';
import { ungradeLabNotSent } from './helpers/demo-lab-not-in.js';

const CID = 'sci8';
const LAB = 'sci8a1';
let wasDemo;
let stubDocument;

function seedDemo() {
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
}

function turnOn({ sendWork = true } = {}) {
  setStudentPageSwitch(CID, true, 'on_return');
  const work = getCourseSubmissions(CID);
  work.course.send_work = sendWork;
  saveDemoStudentWork(CID, work);
}

function page() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.focus = function () {};
  globalThis.document = dom.document;
}

const lab = () => getAssessments(CID).find(a => a.id === LAB);
const sheet = () => document.getElementById('m-sheet-container');
const item = action => sheet().querySelector('[data-action="' + action + '"]');

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
  stubDocument = globalThis.document;
  page();
  seedDemo();
  // The students who sent nothing have no grade yet, so they are Not In.
  ungradeLabNotSent(CID, LAB);
});
afterEach(() => {
  globalThis.document = stubDocument;
});

describe('the row menu', () => {
  it('with Send Work off has no Work Wall and no Add Work', () => {
    turnOn({ sendWork: false });
    MGrade.openRowMenu(CID, LAB);
    expect(item('m-work-wall')).toBeNull();
    expect(item('m-add-work')).toBeNull();
  });

  it('has the board’s Work Wall, “Everyone’s work side by side”, before Grade Everyone', () => {
    turnOn();
    MGrade.openRowMenu(CID, LAB);
    const wall = item('m-work-wall');
    expect(wall.querySelector('.m-tg-menu-title').textContent).toBe('Work Wall');
    expect(wall.querySelector('.m-tg-menu-sub').textContent).toBe('Everyone’s work side by side');
    expect(wall.getAttribute('data-aid')).toBe(LAB);
    const titles = [...sheet().querySelectorAll('.m-tg-menu-item .m-tg-menu-title')].map(t => t.textContent);
    expect(titles.indexOf('Work Wall')).toBe(titles.indexOf('Grade Everyone') - 1);
  });

  it('has Add Work for the N Not In with their names, starting with the first', () => {
    turnOn();
    const pile = MGradePhotos.notIn(CID, lab());
    expect(pile.length).toBeGreaterThan(0);
    MGrade.openRowMenu(CID, LAB);
    const add = item('m-add-work');
    expect(add.querySelector('.m-tg-menu-title').textContent).toBe('Add Work for the ' + pile.length + ' Not In');
    const st = getStudents(CID).find(s => s.id === pile[0]);
    expect(add.querySelector('.m-tg-menu-sub').textContent).toMatch(
      new RegExp('^' + displayNameFirst(st) + ' ' + st.lastName.charAt(0) + '\\.'),
    );
    expect(add.getAttribute('data-sid')).toBe(pile[0]);
  });
});

describe('the grader in the wall’s order', () => {
  beforeEach(() => turnOn());
  const order = () => [...document.querySelectorAll('#m-swiper .m-swiper-card')].map(c => c.getAttribute('data-sid'));

  it('shows the students given, in that order, without “to grade”', () => {
    const roster = sortStudents(getStudents(CID).slice(), 'alpha').map(s => s.id);
    const ids = [roster[4], roster[1], roster[7]];
    // html-safe: MGrade.renderSwiper escapes names and text; a test page
    document.getElementById('m-nav-stack').innerHTML = MGrade.renderSwiper(CID, LAB, {
      ids: [...ids, 'nobody', ids[0]],
    });
    expect(order()).toEqual(ids);
    expect(document.querySelector('.m-nav-bar').textContent).toMatch(/1 of 3(?! to grade)/);
    expect(MGrade.studentCardIndex(CID, LAB, ids[2])).toBe(2);
  });

  it('a fresh open without ids shows everyone again, in roster order', () => {
    const roster = sortStudents(getStudents(CID).slice(), 'alpha').map(s => s.id);
    // html-safe: a test page
    document.getElementById('m-nav-stack').innerHTML = MGrade.renderSwiper(CID, LAB, { ids: [roster[3], roster[0]] });
    // html-safe: a test page
    document.getElementById('m-nav-stack').innerHTML = MGrade.renderSwiper(CID, LAB);
    expect(order()).toEqual(roster);
  });
});

describe('the phone loads the Work Wall', () => {
  it('in its page; the shell opens it and grades in its order', () => {
    const html = readFileSync('teacher-mobile/index.html', 'utf-8');
    expect(html).toContain('<script src="../shared/work-thumbs.js"></script>');
    expect(html).toContain('<script src="../shared/work-wall.js"></script>');
    expect(html).toContain('<link rel="stylesheet" href="../teacher/work-wall.css" />');
    const shell = readFileSync('teacher-mobile/shell.js', 'utf-8');
    expect(shell).toContain("action === 'm-work-wall'");
    expect(shell).toContain('WorkWall.open(');
    expect(shell).toContain('onGrade:');
  });
});
