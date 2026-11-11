/**
 * Return for Revision on the phone (S11-F1, the board "Phone: Return for
 * Revision"): For Revision beside Return and Next, the bottom sheet, the
 * Revising bar with Take Back, and the counts the phone draws. The grade is
 * always kept: the board's Hide is left out (Colin, Nov 11). Demo Mode only,
 * behind the build switch and Send Work; signed in nothing new shows.
 */
import './setup-mobile.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHTML } from 'linkedom';
import { U, seedClass, clearClass } from './helpers/pin-save-paths.js';

const CID = U(1);
const PIECE = U(31);
const SUPPORT = U(41);
const LETTER = U(42);
const JORDAN = U(100);
const HANNAH = U(101);
const FIX = 'Add a third reason from Bourassa to the letter.';
let stubDocument = null;
let wasDemo;

function seed({ sendWork = true } = {}) {
  seedClass(CID, {
    students: [
      { id: HANNAH, firstName: 'Hannah', lastName: 'Berg' },
      { id: JORDAN, firstName: 'Jordan', lastName: 'Reyes' },
    ],
    learningMaps: {
      subjects: [],
      sections: [
        {
          id: U(51),
          name: 'Conscription',
          tags: [
            { id: SUPPORT, label: 'Support and Opposition', text: 'Explain' },
            { id: LETTER, label: 'Letter to the Editor', text: 'Argue' },
          ],
        },
      ],
      _customized: true,
      _version: 1,
      _flatVersion: 2,
    },
    assessments: [{ id: PIECE, title: '2.6 The Conscription Crisis', tagIds: [SUPPORT, LETTER], date: '2026-10-20' }],
    courseConfigs: { student_page_enabled: true, return_grades: 'on_return' },
  });
  saveDemoStudentWork(CID, {
    course: { send_work: sendWork },
    assessments: [{ id: PIECE, students_send: 'photos' }],
    submissions: [],
  });
  [HANNAH, JORDAN].forEach(sid => {
    Grader.setLevel(CID, sid, PIECE, SUPPORT, 3, 0);
    Grader.setLevel(CID, sid, PIECE, LETTER, 2, 1);
  });
}

function page() {
  const dom = parseHTML(
    '<!DOCTYPE html><html><body><div id="m-nav-stack"></div>' +
      '<div id="m-sheet-backdrop" class="u-hidden"></div><div id="m-sheet-container"></div>' +
      '<div id="m-toast"></div></body></html>',
  );
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.focus = function () {};
  globalThis.document = dom.document;
}
function openGrading() {
  // html-safe: MGrade.renderSwiper escapes names and text; a test page
  document.getElementById('m-nav-stack').innerHTML = MGrade.renderSwiper(CID, PIECE);
  MGrade.setupSwiper(CID, PIECE);
}
// A tap, sent as teacher-mobile/shell.js sends it.
function tap(el) {
  if (!el) throw new Error('no such control on the screen');
  const a = name => el.getAttribute('data-' + name);
  const action = a('action');
  if (action === 'm-sheet-cancel') return MComponents.dismissSheet();
  if (action === 'm-grade-revision') return MGrade.openRevisionSheet(CID, a('aid'), a('sid'));
  if (action === 'm-grade-revision-send') return MGrade.sendRevision(CID, a('aid'), a('sid'), el);
  if (action === 'm-grade-revision-takeback') return MGrade.takeBackRevision(CID, a('aid'), a('sid'), a('id'));
  if (action === 'm-grade-return-next') return MGrade.returnAndNext();
  throw new Error('not one of this change’s controls: ' + action);
}
const text = el => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
const buttons = () => [...document.querySelectorAll('#m-grade-return-act button')];
const barState = () => text(document.getElementById('m-grade-return-state'));
const flush = () => new Promise(r => setTimeout(r, 0));

beforeEach(() => {
  stubDocument = globalThis.document;
  wasDemo = window.isDemoMode;
  window.isDemoMode = () => true;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T18:00:00.000Z'));
  localStorage.clear();
  page();
});
afterEach(() => {
  vi.useRealTimers();
  globalThis.document = stubDocument;
  window.isDemoMode = wasDemo;
  clearClass(CID);
  localStorage.clear();
});

describe('the phone: Return for Revision', () => {
  it('For Revision beside Return and Next; the sheet in the board’s words, with no Hide', () => {
    seed();
    openGrading();
    expect(buttons().map(b => b.textContent)).toEqual(['For Revision', 'Return and Next']);
    tap(buttons()[0]);
    const sheet = document.querySelector('#m-sheet-container .m-revision-sheet');
    expect(text(sheet.querySelector('.m-revision-cancel'))).toBe('Cancel');
    expect(text(sheet.querySelector('.m-revision-title'))).toBe('Return for Revision');
    expect(text(sheet.querySelector('.m-revision-sub'))).toBe('Hannah Berg · 2.6 The Conscription Crisis');
    expect([...sheet.querySelectorAll('.m-revision-label')].map(text)).toEqual([
      'What to Fix',
      'Revise By',
      'Until the New Version Is Graded',
    ]);
    expect(text(sheet.querySelector('.m-revision-keep'))).toBe('Keep this grade. The new version replaces it.');
    expect(sheet.textContent).not.toContain('Hide');
    expect(text(sheet.querySelector('.m-revision-send'))).toBe('Return for Revision');
    tap(sheet.querySelector('[data-action="m-sheet-cancel"]'));
    expect(getRevisionRequest(CID, HANNAH, PIECE)).toBeNull();
  });

  it('Return for Revision returns the work and asks; the bar says Revising with Take Back; Take Back withdraws it', async () => {
    seed();
    openGrading();
    tap(buttons()[0]);
    const sheet = document.querySelector('.m-revision-sheet');
    tap(sheet.querySelector('.m-revision-send'));
    expect(text(sheet.querySelector('.m-revision-msg'))).toBe('Write what to fix first.');
    sheet.querySelector('.m-revision-fix').value = FIX;
    sheet.querySelector('.m-revision-by').value = '2026-11-10';
    tap(sheet.querySelector('.m-revision-send'));
    await flush();
    expect(getRevisionRequest(CID, HANNAH, PIECE)).toMatchObject({ what_to_fix: FIX, keep_grade: true, state: 'open' });
    expect(GradeState.stateOf(CID, HANNAH, PIECE)).toBe('returned');
    expect(barState()).toBe('RevisingReturned for Revision · Revise by Tue, Nov 10');
    expect(buttons().map(b => b.textContent)).toEqual(['Take Back']);
    tap(buttons()[0]);
    await flush();
    expect(getRevisionRequest(CID, HANNAH, PIECE).state).toBe('cancelled');
    expect(buttons().map(b => b.textContent)).toEqual(['For Revision']);
  });

  it('an answer that comes after the screen moved on draws nothing', async () => {
    seed();
    openGrading();
    tap(buttons()[0]);
    const sheet = document.querySelector('.m-revision-sheet');
    sheet.querySelector('.m-revision-fix').value = FIX;
    tap(sheet.querySelector('.m-revision-send'));
    const dismissed = vi.spyOn(MComponents, 'dismissSheet');
    // The grading screen goes before the answer comes.
    document.getElementById('m-nav-stack').innerHTML = '';
    await flush();
    expect(dismissed).not.toHaveBeenCalled();
    dismissed.mockRestore();
    expect(document.querySelector('.m-revision-sheet')).not.toBeNull();
    expect(document.getElementById('m-grade-return')).toBeNull();
  });

  it('Return and Next and Return N leave out a student out for revision', async () => {
    seed();
    await Grader.returnForRevision(CID, HANNAH, PIECE, { what_to_fix: FIX }, 'k1');
    Grader.setLevel(CID, HANNAH, PIECE, SUPPORT, 4, 0);
    expect(GradeState.draftsIn(CID, PIECE, [HANNAH, JORDAN])).toEqual([HANNAH, JORDAN]);
    expect(MGrade.studentDrafts(CID, HANNAH)).toEqual([]);
    openGrading();
    // Hannah's card: Revising, no Return.
    expect(buttons().map(b => b.textContent)).toEqual(['Take Back']);
  });

  it('with Send Work off, or signed in, no For Revision', () => {
    seed({ sendWork: false });
    openGrading();
    expect(buttons().map(b => b.textContent)).toEqual(['Return and Next']);
    window.isDemoMode = () => false;
    seed();
    openGrading();
    expect(document.querySelector('[data-action="m-grade-revision"]')).toBeNull();
  });
});
