/**
 * Grade From Paper on the phone's not-in card (S7-F3 follow-up): Set Logan
 * To, on Demo Mode's sample work (Science 8, Cell Microscope Lab). The rule
 * is the desktop's, GraderWork.setToFromPaper in shared/grader.js
 * (tests/grader-work-pane.test.js holds it); these hold the phone's card,
 * its sheet and what a tap does.
 */
import './setup-mobile.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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
      '<nav id="m-tab-bar"><button class="m-tab-item" data-tab="grade"><span class="m-tab-label">Grade</span></button></nav>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.focus = function () {};
  globalThis.document = dom.document;
}

const stack = () => document.getElementById('m-nav-stack');
const lab = () => getAssessments(CID).find(a => a.id === LAB);
const name = sid => getStudents(CID).find(s => s.id === sid);
const sheet = () => document.getElementById('m-sheet-container');
const card = sid => stack().querySelector('.m-swiper-card[data-sid="' + sid + '"]');
const keysOn = (sid, aid) => (getScores(CID)[sid] || []).filter(e => e.assessmentId === aid && e.score > 0);

function clearGrade(sid, aid) {
  const a = getAssessments(CID).find(x => x.id === aid);
  const keys = [...new Set((getScores(CID)[sid] || []).filter(e => e.assessmentId === aid).map(e => e.tagId))];
  Grader.setOverallComment(CID, sid, aid, '');
  getRubricCheckIds(CID, sid, aid).forEach(id => Grader.setTick(CID, sid, aid, id, false));
  if (keys.length) Grader.clearScore(CID, getScores(CID), sid, a, keys);
}

function open(aid = LAB) {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  stack().innerHTML = MGrade.renderSwiper(CID, aid);
  MGrade.setupSwiper(CID, aid);
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
beforeEach(() => {
  stubDocument = globalThis.document;
  page();
  seedDemo();
  // The students who sent nothing have no grade yet, so they are Not In.
  ungradeLabNotSent(CID, LAB);
});
afterEach(() => {
  globalThis.document = stubDocument;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('with Send Work off', () => {
  it('a card has no Grade From Paper', () => {
    turnOn({ sendWork: false });
    open();
    expect(stack().querySelector('[data-action="m-work-setto-menu"]')).toBeNull();
    expect(stack().textContent).not.toContain('Grade From Paper');
  });
});

describe('with the student page and Send Work on', () => {
  let sid;
  beforeEach(() => {
    turnOn();
    sid = MGradePhotos.notIn(CID, lab())[0];
    clearGrade(sid, LAB);
  });

  it('the not-in card has Grade From Paper with Set Logan To; a card with work has none', () => {
    open();
    const btn = card(sid).querySelector('[data-action="m-work-setto-menu"]');
    expect(card(sid).querySelector('.m-work-paper-head').textContent).toBe('Grade From Paper');
    expect(btn.textContent).toBe('Set ' + displayNameFirst(name(sid)) + ' To');
    expect(btn.disabled).toBe(false);
    expect(card('st1').querySelector('[data-action="m-work-setto-menu"]')).toBeNull();
  });

  it('the not-in card has its status under Add Work and each criterion "Not scored" until one is tapped', () => {
    open();
    const crits = getRubricById(CID, lab().rubricId).criteria;
    expect(card(sid).querySelector('.m-grade-student-header .m-status-row')).toBeNull();
    expect(card(sid).querySelectorAll('.m-work-notin-status .m-status-pill').length).toBe(3);
    const rows = [...card(sid).querySelectorAll('[data-action="m-paper-crit"]')];
    expect(rows.map(r => r.querySelector('.m-paper-crit-name').textContent)).toEqual(crits.map(c => c.name));
    expect(rows.map(r => r.querySelector('.m-paper-crit-now').textContent)).toEqual(crits.map(() => 'Not scored'));
    expect(card(sid).querySelector('.m-score-btn')).toBeNull();
    MGrade.openPaperCriterion(CID, sid, LAB, 1);
    expect(card(sid).querySelector('[data-action="m-paper-crit"]')).toBeNull();
    expect([...card(sid).querySelectorAll('.m-crit-group .m-crit-name')].map(n => n.textContent)).toEqual(
      crits.map(c => c.name),
    );
  });

  it('under Missing, Set Logan To is off and does nothing', () => {
    expect(setAssignmentStatus(CID, sid, LAB, 'NS')).not.toBe(false);
    open();
    expect(card(sid).querySelector('[data-action="m-work-setto-menu"]').disabled).toBe(true);
    MGrade.openSetTo(CID, LAB, sid);
    expect(sheet().innerHTML).toBe('');
  });

  it('a piece scored by points or Complete has no Set Logan To', () => {
    expect(MGradePhotos.paperLevels(CID, lab())).toBeGreaterThan(0);
    expect(MGradePhotos.paperLevels(CID, { ...lab(), scoreMode: 'points', rubricId: null })).toBe(0);
    expect(MGradePhotos.paperLevels(CID, { ...lab(), scoreMode: 'complete', rubricId: null })).toBe(0);
  });

  it('the sheet lists the four levels in the class’s order, with Cancel', () => {
    open();
    MGrade.openSetTo(CID, LAB, sid);
    const s = sheet();
    expect(s.querySelector('.m-tg-menu-name').textContent).toBe('Set ' + displayNameFirst(name(sid)) + ' To');
    expect(s.querySelector('.m-tg-menu-sub').textContent).toBe(lab().title);
    const items = [...s.querySelectorAll('[data-action="m-work-setto"]')];
    expect(items.map(b => Number(b.getAttribute('data-level')))).toEqual(levelOrderFor(CID));
    expect(items.map(b => b.querySelector('.m-tg-menu-title').textContent)).toEqual(
      levelOrderFor(CID).map(l => PROF_LABELS[l]),
    );
    expect(s.querySelector('[data-action="m-sheet-cancel"]').textContent).toBe('Cancel');
  });

  it('a level sets every criterion through GraderWork.setToFromPaper, records paper, and Undo puts the levels back', async () => {
    vi.useFakeTimers();
    open();
    const spy = vi.spyOn(GraderWork, 'setToFromPaper');
    expect(keysOn(sid, LAB)).toHaveLength(0);
    const done = MGrade.setToFromPaper(CID, LAB, sid, 3);
    expect(spy).toHaveBeenCalledWith(CID, LAB, sid, 3);
    expect(done.set).toBeGreaterThan(0);
    expect(keysOn(sid, LAB).every(e => e.score === 3)).toBe(true);
    expect(keysOn(sid, LAB)).toHaveLength(done.set);
    expect(document.querySelector('#m-toast').textContent).toContain(
      displayNameFirst(name(sid)) + ' set to ' + PROF_LABELS[3],
    );
    const undo = document.querySelector('#m-toast [data-action="m-toast-undo"]');
    await done.paper;
    await vi.runAllTimersAsync();
    expect(getStudentSubmission(CID, sid, LAB)).toMatchObject({ on_paper: true, sent_by: 'teacher' });
    // The card now says it was handed in on paper, and has no Add Work.
    expect(card(sid).querySelector('.m-work-sent').textContent).toBe('Handed in on paper');
    expect(card(sid).querySelector('[data-action="m-add-work"]')).toBeNull();
    undo.onclick();
    expect(keysOn(sid, LAB)).toHaveLength(0);
  });

  it('a level tapped after the grader moved to another piece sets nothing', () => {
    open();
    MGrade.openSetTo(CID, LAB, sid);
    // The grader now shows another piece.
    open('sci8a2');
    const spy = vi.spyOn(GraderWork, 'setToFromPaper');
    expect(MGrade.setToFromPaper(CID, LAB, sid, 3)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(keysOn(sid, LAB)).toHaveLength(0);
  });

  it('the paper mark answered after the grader moved to another piece draws nothing', async () => {
    open();
    let answer;
    vi.spyOn(GraderWork, 'setToFromPaper').mockImplementation(() => ({
      set: 1,
      paper: new Promise(r => (answer = r)),
    }));
    MGrade.setToFromPaper(CID, LAB, sid, 3);
    // The grader now shows another piece.
    open('sci8a2');
    const before = stack().querySelector('#m-swiper').innerHTML;
    answer({ result: 'sent', marked: 1, submissions: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(stack().querySelector('#m-swiper').innerHTML).toBe(before);
  });
});

describe('the phone dispatches Set Logan To', () => {
  it('from the card’s button and the sheet’s levels', () => {
    const shell = readFileSync('teacher-mobile/shell.js', 'utf-8');
    expect(shell).toContain("action === 'm-work-setto-menu'");
    expect(shell).toContain('MGrade.openSetTo(');
    expect(shell).toContain("action === 'm-work-setto'");
    expect(shell).toContain('MGrade.setToFromPaper(');
  });
});
