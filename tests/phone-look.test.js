/**
 * The phone's new look, L1 (docs/plans/phone-look-plan.md):
 * teacher-mobile/grade-look.js and the four places tab-grade.js asks it.
 *
 * With the phoneLook switch off the grading screen is what it was (the
 * byte-for-byte walk in tests/phone-return.test.js holds that too). On, the
 * bar names the card on screen, the marks sit in a box of their own, the
 * Overall Comment is named for the student, and each level button carries
 * its code for the track. L3: Return and Next is held seven seconds for Undo.
 */
import './setup-mobile.js';
import { parseHTML } from 'linkedom';
import { vi } from 'vitest';

const CID = 'test';
const originals = {};

function mockDataLayer(overrides) {
  const mocks = {
    getStudents: () => [
      { id: 'stu1', firstName: 'Cece', lastName: 'Adams', preferred: '', designations: [] },
      { id: 'stu2', firstName: 'Noor', lastName: 'Khan', preferred: 'Noor', designations: [] },
      { id: 'stu3', firstName: 'Liam', lastName: 'Chen', preferred: '', designations: [] },
    ],
    sortStudents: arr => arr,
    displayName: st => (st.preferred || st.firstName) + ' ' + st.lastName,
    getAssessments: () => [{ id: 'a1', title: 'Lab Quiz', type: 'summative', date: '2025-03-20', tagIds: ['t1'] }],
    getScores: () => ({ stu1: [{ assessmentId: 'a1', tagId: 't1', score: 3, mod: 1 }] }),
    getAssignmentStatuses: () => ({}),
    getAssignmentStatus: () => null,
    getTagById: (cid, tid) => ({ id: tid, label: 'Questioning', name: tid }),
    getSectionForTag: () => ({ color: '#2196F3' }),
    clearProfCache: () => {},
    ...overrides,
  };
  Object.keys(mocks).forEach(fn => {
    originals[fn] = globalThis[fn];
    globalThis[fn] = mocks[fn];
  });
}

const look = on =>
  on ? localStorage.setItem('fv-build-phoneLook', '1') : localStorage.removeItem('fv-build-phoneLook');

// The grading screen, parsed, so a test can look inside it.
function draw() {
  return parseHTML('<!doctype html><html><body>' + MGrade.renderSwiper(CID, 'a1') + '</body></html>').document;
}

beforeEach(() => {
  clearProfCache();
  globalThis.COURSES = { test: { id: 'test', name: 'Test Course', calcMethod: 'mostRecent', decayWeight: 0.65 } };
  mockDataLayer({});
});

afterEach(() => {
  look(false);
  Object.keys(originals).forEach(fn => {
    if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
  });
});

describe('with the switch off', () => {
  it('the grading screen draws none of it', () => {
    expect(MGradeLook.on()).toBe(false);
    const html = MGrade.renderSwiper(CID, 'a1');
    ['m-grade-marks', 'data-code', 'm-grade-more', 'm-nav-title-btn', 'Comment for'].forEach(piece =>
      expect(html, piece).not.toContain(piece),
    );
    expect(html).toContain('>Overall Comment</label>');
    expect(html).toContain('Lab Quiz');
  });

  it('grade-look.js answers with nothing', () => {
    expect(MGradeLook.bar(CID, [], false)).toEqual({ title: '', titleAction: '', more: '', strip: '' });
    expect(MGradeLook.quiet('Ines')).toBe('Ines');
    expect(MGradeLook.commentLabel(CID, getStudents(CID)[0], null)).toBe('');
    expect(MGradeLook.marks('<p>x</p>')).toBe('<p>x</p>');
  });
});

describe('with the switch on', () => {
  beforeEach(() => look(true));

  it('the bar names the first card, opens the class list from the name, and carries ⋯', () => {
    const screen = draw();
    const title = screen.querySelector('#m-nav-bar-grade-swiper .m-nav-title-btn');
    expect(title.getAttribute('data-action')).toBe('m-grade-roster');
    expect(title.querySelector('.m-nav-title-text').textContent).toBe('Cece Adams');
    expect(screen.querySelector('#m-nav-bar-grade-swiper').textContent).not.toContain('Lab Quiz');
    expect(screen.querySelector('.m-grade-more[data-action="m-grade-more"]').getAttribute('aria-label')).toBe('More');
    // The sync dot stays: it is the only place a sync problem shows.
    expect(screen.querySelector('#sync-indicator-dot')).toBeTruthy();
    // The strip, drawn as a line, is out of the tab order.
    expect(screen.querySelector('#m-thumb-strip').hasAttribute('inert')).toBe(true);
  });

  it('text the look does not show is still there for a screen reader', () => {
    const card = draw().querySelector('.m-swiper-card[data-sid="stu2"]');
    expect(card.querySelector('.m-grade-student-name .m-look-sr').textContent).toBe('Noor Khan');
    expect([...card.querySelectorAll('.m-mod-word')].map(w => w.textContent)).toEqual(['Minus', 'Plus']);
  });

  it('the marks sit in a box of their own, with the comment named for the student', () => {
    const card = draw().querySelector('.m-swiper-card[data-sid="stu2"]');
    const marks = card.querySelector('.m-grade-card-surface > .m-grade-marks');
    expect(marks.querySelectorAll('.m-score-group').length).toBe(1);
    expect(marks.querySelector('.m-overall-label').textContent).toBe('Comment for Noor');
    expect(card.querySelectorAll('.m-score-group').length).toBe(1);
  });

  it('each level carries its code, and the chosen one its + or −', () => {
    const screen = draw();
    const codes = sid =>
      [...screen.querySelectorAll('.m-swiper-card[data-sid="' + sid + '"] .m-level-btn')].map(b =>
        b.getAttribute('data-code'),
      );
    expect(codes('stu2').slice().sort()).toEqual(['DEV', 'EMG', 'EXT', 'PRF']);
    expect(codes('stu1')).toContain('PRF +');
    // A save repaints the row without drawing it again.
    const btns = screen.querySelectorAll('.m-swiper-card[data-sid="stu1"] .m-level-btn');
    MComponents.paintLevelButtons(btns, 2, -1);
    expect([...btns].find(b => b.getAttribute('data-score') === '2').getAttribute('data-code')).toBe('DEV −');
    expect([...btns].find(b => b.getAttribute('data-score') === '3').getAttribute('data-code')).toBe('PRF');
  });

  it('one student’s work keeps its own bar, with ⋯', () => {
    expect(MGradeLook.bar(CID, [{ st: getStudents(CID)[0], label: 'Cece Adams' }], true)).toMatchObject({
      title: '',
      titleAction: '',
    });
    expect(MGradeLook.bar(CID, [], true).more).toContain('m-grade-more');
  });

  it('names a pair by its two students and a bigger group by its label', () => {
    const st = getStudents(CID)[0];
    const pair = { st, label: 'Pair 1', view: { members: ['stu1', 'stu2'] } };
    const three = { st, label: 'Group 2', view: { members: ['stu1', 'stu2', 'stu3'] } };
    expect(MGradeLook.unitName(CID, pair)).toBe('Cece and Noor');
    expect(MGradeLook.unitName(CID, three)).toBe('Group 2');
    expect(MGradeLook.unitName(CID, { st, label: 'Cece Adams' })).toBe('Cece Adams');
    expect(MGradeLook.commentLabel(CID, st, pair)).toBe('Comment for Cece and Noor');
  });
});

describe('Return and Next, held for Undo (L3)', () => {
  const unit = () => ({ st: getStudents(CID)[0], label: 'Cece Adams' });
  let toast;
  let refresh;
  let jump;

  beforeEach(() => {
    vi.useFakeTimers();
    toast = vi.spyOn(MComponents, 'showToast').mockImplementation(() => {});
    vi.spyOn(MComponents, 'hideToast').mockImplementation(() => {});
    refresh = vi.spyOn(MGrade, 'refreshToReturn').mockImplementation(() => {});
    jump = vi.spyOn(MGrade, 'jumpToStudent').mockImplementation(() => {});
    vi.spyOn(MGrade, 'studentCardIndex').mockImplementation(() => 2);
  });
  afterEach(() => {
    MGradeLook.flush();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('with the switch off the return is sent at once, with no toast', () => {
    const send = vi.fn();
    MGradeLook.hold(CID, 'a1', unit(), send);
    expect(send).toHaveBeenCalledWith(false);
    expect(toast).not.toHaveBeenCalled();
    expect(MGradeLook.held(CID, 'a1', 'stu1')).toBe(false);
  });

  it('with the switch on it waits seven seconds, then is sent', () => {
    look(true);
    const send = vi.fn();
    MGradeLook.hold(CID, 'a1', unit(), send);
    expect(send).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('Returned to Cece', expect.objectContaining({ duration: 7000, low: true }));
    expect(MGradeLook.held(CID, 'a1', 'stu1')).toBe(true);
    expect(MGradeLook.held(CID, 'a1', 'stu2')).toBe(false);
    vi.advanceTimersByTime(6999);
    expect(send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(true);
    expect(MGradeLook.held(CID, 'a1', 'stu1')).toBe(false);
    expect(refresh).toHaveBeenCalledWith(CID);
  });

  it('Undo sends nothing and goes back to the card', () => {
    look(true);
    const send = vi.fn();
    MGradeLook.hold(CID, 'a1', unit(), send);
    toast.mock.calls[0][1].onUndo();
    expect(MGradeLook.held(CID, 'a1', 'stu1')).toBe(false);
    expect(jump).toHaveBeenCalledWith(2);
    vi.advanceTimersByTime(20000);
    expect(send).not.toHaveBeenCalled();
  });

  it('the next return sends the one held, and is held in its place', () => {
    look(true);
    const first = vi.fn();
    const second = vi.fn();
    MGradeLook.hold(CID, 'a1', unit(), first);
    const pair = { st: getStudents(CID)[1], label: 'Pair 1', view: { members: ['stu2', 'stu3'] } };
    MGradeLook.hold(CID, 'a1', pair, second);
    expect(first).toHaveBeenCalledWith(true);
    expect(second).not.toHaveBeenCalled();
    expect(toast).toHaveBeenLastCalledWith('Returned to Noor and Liam', expect.anything());
    expect(MGradeLook.held(CID, 'a1', 'stu2')).toBe(true);
    vi.advanceTimersByTime(7000);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(true);
  });

  it('sending now, with nothing held, does nothing', () => {
    look(true);
    MGradeLook.flush();
    expect(refresh).not.toHaveBeenCalled();
  });
});
