/**
 * The phone grader's frame (docs/plans/phone-look-plan.md):
 * teacher-mobile/grade-look.js (the top bar's name, the class list, the ⋯
 * sheet, All Caught Up, the comment waiting as a suggestion, the return held
 * seven seconds for Undo) and the pieces of tab-grade.js it frames: the
 * progress line, the marks in a card of their own, the Overall Comment named
 * for the student, and each level on the track by its code.
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

// The grading screen, parsed, so a test can look inside it.
function draw() {
  return parseHTML('<!doctype html><html><body>' + MGrade.renderSwiper(CID, 'a1') + '</body></html>').document;
}
const students = () => getStudents(CID);

beforeEach(() => {
  clearProfCache();
  localStorage.clear();
  globalThis.COURSES = { test: { id: 'test', name: 'Test Course', calcMethod: 'mostRecent', decayWeight: 0.65 } };
  mockDataLayer({});
});

afterEach(() => {
  Object.keys(originals).forEach(fn => {
    if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
  });
  vi.restoreAllMocks();
});

describe('the top bar and the progress line', () => {
  it('the bar names the first card, opens the class list from the name, and carries ⋯', () => {
    const screen = draw();
    const title = screen.querySelector('#m-nav-bar-grade-swiper .m-nav-title-btn');
    expect(title.getAttribute('data-action')).toBe('m-grade-roster');
    expect(title.querySelector('.m-nav-title-text').textContent).toBe('Cece Adams');
    expect(screen.querySelector('#m-nav-bar-grade-swiper').textContent).not.toContain('Lab Quiz');
    expect(screen.querySelector('.m-grade-more[data-action="m-grade-more"]').getAttribute('aria-label')).toBe('More');
    // Back is the chevron alone, named for the screen reader.
    const back = screen.querySelector('#m-nav-bar-grade-swiper .m-nav-bar-back');
    expect(back.getAttribute('aria-label')).toBe('Grade');
    expect(back.querySelector('span')).toBeNull();
    // The sync dot stays: it is the only place a sync problem shows.
    expect(screen.querySelector('#sync-indicator-dot')).toBeTruthy();
  });

  it('the progress line is a segment for each card, dark once graded, none of them a control', () => {
    const screen = draw();
    const segs = [...screen.querySelectorAll('#m-grade-progress .m-prog-seg')];
    expect(segs.map(s => s.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN']);
    expect(segs.map(s => s.classList.contains('is-graded'))).toEqual([true, false, false]);
    expect(segs.map(s => s.classList.contains('is-current'))).toEqual([true, false, false]);
    expect(screen.querySelector('#m-grade-progress').getAttribute('aria-hidden')).toBe('true');
    expect(screen.querySelector('#m-grade-progress button')).toBeNull();
  });

  it('one student’s work keeps its own bar, with ⋯, and no title button', () => {
    const unit = { st: students()[0], label: 'Cece Adams' };
    expect(MGradeLook.bar(CID, 'a1', [unit], true)).toMatchObject({ title: '', titleAction: '' });
    expect(MGradeLook.bar(CID, 'a1', [], true).more).toContain('m-grade-more');
  });

  it('names a pair by its two students and a bigger group by its label', () => {
    const st = students()[0];
    const pair = { st, label: 'Pair 1', view: { members: ['stu1', 'stu2'] } };
    const three = { st, label: 'Group 2', view: { members: ['stu1', 'stu2', 'stu3'] } };
    expect(MGradeLook.unitName(CID, pair)).toBe('Cece and Noor');
    expect(MGradeLook.unitName(CID, three)).toBe('Group 2');
    expect(MGradeLook.unitName(CID, { st, label: 'Cece Adams' })).toBe('Cece Adams');
    expect(MGradeLook.commentLabel(CID, st, pair)).toBe('Comment for Both');
    expect(MGradeLook.commentLabel(CID, st, three)).toBe('Comment for the Group');
    expect(MGradeLook.commentLabel(CID, st, null)).toBe('Comment for Cece');
  });

  it('the class list has a row for each card, the one on screen marked', () => {
    const present = vi.spyOn(MComponents, 'presentSheet').mockImplementation(() => {});
    const units = students().map(st => ({ st, label: displayName(st) }));
    MGradeLook.bar(CID, 'a1', units, false);
    MGradeLook.openRoster();
    const list = parseHTML('<div>' + present.mock.calls[0][0] + '</div>').document;
    const rows = [...list.querySelectorAll('.m-roster-row')];
    expect(rows.map(r => r.textContent)).toEqual(['Cece Adams', 'Noor Khan', 'Liam Chen']);
    expect(rows.map(r => r.getAttribute('data-idx'))).toEqual(['0', '1', '2']);
    expect(rows.map(r => r.getAttribute('data-action'))).toEqual(['m-grade-jump', 'm-grade-jump', 'm-grade-jump']);
    expect(rows.map(r => r.getAttribute('data-sid'))).toEqual(['stu1', 'stu2', 'stu3']);
  });
});

describe('the card', () => {
  it('the marks sit in a card of their own, with the comment named for the student', () => {
    const card = draw().querySelector('.m-swiper-card[data-sid="stu2"]');
    const marks = card.querySelector('.m-grade-card-surface > .m-grade-marks');
    expect(marks.querySelectorAll('.m-score-group').length).toBe(1);
    expect(marks.querySelector('.m-overall-label').textContent).toBe('Comment for Noor');
    expect(card.querySelector('.m-grade-student-header')).toBeNull();
    expect(card.querySelector('.m-grade-avatar')).toBeNull();
  });

  it('each level is its code on one track, the chosen one with its + or −', () => {
    const screen = draw();
    const codes = sid =>
      [...screen.querySelectorAll('.m-swiper-card[data-sid="' + sid + '"] .m-level-btn')].map(b => b.textContent);
    expect(codes('stu2').slice().sort()).toEqual(['DEV', 'EMG', 'EXT', 'PRF']);
    expect(codes('stu1')).toContain('PRF +');
    // A save repaints the row without drawing it again.
    const btns = screen.querySelectorAll('.m-swiper-card[data-sid="stu1"] .m-level-btn');
    MComponents.paintLevelButtons(btns, 2, -1);
    expect([...btns].find(b => b.getAttribute('data-score') === '2').textContent).toBe('DEV −');
    expect([...btns].find(b => b.getAttribute('data-score') === '3').textContent).toBe('PRF');
  });

  it('− and + are signs, read out as Minus and Plus, and show once a level is chosen', () => {
    const screen = draw();
    const group = sid => screen.querySelector('.m-swiper-card[data-sid="' + sid + '"] .m-score-group');
    expect(group('stu1').getAttribute('data-level')).toBe('3');
    expect(group('stu2').getAttribute('data-level')).toBe('0');
    expect([...group('stu1').querySelectorAll('.m-mod-btn .m-sr')].map(w => w.textContent)).toEqual(['Minus', 'Plus']);
    expect([...group('stu1').querySelectorAll('.m-mod-sign')].map(w => w.textContent)).toEqual(['−', '+']);
  });

  it('a status that is set is one chip on the card, and IEP only for a student who has one', () => {
    mockDataLayer({
      getStudents: () => [
        { id: 'stu1', firstName: 'Cece', lastName: 'Adams', preferred: '', designations: ['G'] },
        { id: 'stu2', firstName: 'Noor', lastName: 'Khan', preferred: 'Noor', designations: [] },
      ],
      getAssignmentStatuses: () => ({ 'stu2:a1': 'LATE' }),
    });
    const screen = draw();
    const chips = sid => screen.querySelector('.m-swiper-card[data-sid="' + sid + '"] .m-grade-chips');
    expect([...chips('stu1').children].map(c => c.textContent)).toEqual(['IEP']);
    expect([...chips('stu2').children].map(c => c.textContent)).toEqual(['Late']);
    expect(chips('stu2').children[0].classList.contains('m-grade-chip-late')).toBe(true);
  });
});

describe('⋯', () => {
  let present;
  const ctx = more => ({
    cid: CID,
    a: { id: 'a1', title: 'Lab Quiz' },
    unit: { st: students()[1], label: 'Noor Khan' },
    scoredBy: null,
    canUnsubmit: false,
    ...more,
  });
  const sheet = () => parseHTML('<div>' + present.mock.calls.at(-1)[0] + '</div>').document;
  beforeEach(() => {
    present = vi.spyOn(MComponents, 'presentSheet').mockImplementation(() => {});
    globalThis.canSetAssignmentStatus = () => true;
    globalThis.isGradedSeparately = () => false;
    globalThis.displayNameWithLast = st => st.firstName + ' ' + st.lastName;
  });
  const open = more => {
    vi.spyOn(MGrade, 'moreContext').mockReturnValue(ctx(more));
    MGradeLook.openMore();
  };

  it('a student: Late, Missing and Excused as one track, and nothing else', () => {
    open();
    const doc = sheet();
    expect(doc.querySelector('.m-group-sheet-title').textContent).toBe('Noor Khan');
    expect([...doc.querySelectorAll('.m-status-row .m-status-pill')].map(b => b.textContent)).toEqual([
      'Late',
      'Missing',
      'Excused',
    ]);
    expect([...doc.querySelectorAll('.m-status-pill')].every(b => b.getAttribute('data-sid') === 'stu2')).toBe(true);
    expect(doc.querySelector('[data-action="m-grade-view"], [data-action="m-work-unsubmit"]')).toBeNull();
    expect(doc.querySelector('.m-more-hint')).toBeNull();
  });

  it('Missing and Excused are off, with the reason, on work with a score', () => {
    globalThis.canSetAssignmentStatus = () => false;
    open();
    const pills = [...sheet().querySelectorAll('.m-status-pill')];
    expect(pills.map(b => b.hasAttribute('disabled'))).toEqual([false, true, true]);
    expect(sheet().querySelector('.m-more-hint').textContent).toBe(
      'Clear the score and comment to mark Missing or Excused.',
    );
  });

  it('a status that is set is the pressed one', () => {
    globalThis.getAssignmentStatus = (cid, sid) => (sid === 'stu2' ? 'LATE' : null);
    open();
    expect([...sheet().querySelectorAll('.m-status-pill')].map(b => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
      'false',
    ]);
  });

  it('a pair: each member has their own track and Grade Separately', () => {
    open({
      unit: {
        st: students()[0],
        label: 'Pair 1',
        view: { members: ['stu1', 'stu2'], group: {}, linked: ['stu1', 'stu2'] },
      },
    });
    const doc = sheet();
    expect(doc.querySelector('.m-group-sheet-title').textContent).toBe('Cece and Noor');
    expect([...doc.querySelectorAll('.m-more-member-name')].map(n => n.textContent)).toEqual([
      'Cece Adams',
      'Noor Khan',
    ]);
    const separate = [...doc.querySelectorAll('[data-action="m-grade-separate"]')];
    expect(separate.map(b => b.getAttribute('data-sid'))).toEqual(['stu1', 'stu2']);
    expect(separate.every(b => b.textContent === 'Grade Separately')).toBe(true);
    expect(doc.querySelectorAll('.m-status-row').length).toBe(2);
  });

  it('a member graded on their own can go Back to Group Grade', () => {
    open({ unit: { st: students()[1], label: 'Noor Khan', separateFrom: { index: 0 } } });
    const back = sheet().querySelector('[data-action="m-grade-rejoin"]');
    expect(back.textContent).toBe('Back to Group Grade');
    expect(back.getAttribute('data-sid')).toBe('stu2');
  });

  it('rubric work offers the other view, and Unsubmit shows only where there is work to take back', () => {
    open({ scoredBy: 'rubric', canUnsubmit: true });
    let doc = sheet();
    const view = doc.querySelector('[data-action="m-grade-view"]');
    expect(view.textContent).toBe('Grade by Competencies');
    expect(view.getAttribute('data-view')).toBe('tags');
    expect(doc.querySelector('[data-action="m-work-unsubmit"]').textContent).toBe('Unsubmit');
    open({ scoredBy: 'tags' });
    doc = sheet();
    expect(doc.querySelector('[data-action="m-grade-view"]').textContent).toBe('Grade by Rubric');
    expect(doc.querySelector('[data-action="m-grade-view"]').getAttribute('data-view')).toBe('rubric');
  });

  it('does nothing when no card is on screen', () => {
    vi.spyOn(MGrade, 'moreContext').mockReturnValue(null);
    MGradeLook.openMore();
    expect(present).not.toHaveBeenCalled();
  });
});

describe('All Caught Up', () => {
  it('says what went back and what is not in, and offers the next piece and Done', () => {
    const doc = parseHTML(
      '<div>' +
        MGradeLook.caughtUp({ done: 4, verb: 'returned', notIn: 20, next: { id: 'a2', title: 'Cell Lab' } }) +
        '</div>',
    ).document;
    expect(doc.querySelector('.m-grade-done-title').textContent).toBe('All Caught Up');
    expect(doc.querySelector('.m-grade-done-line').textContent).toBe('4 returned · 20 not handed in');
    const next = doc.querySelector('[data-action="m-grade-next-piece"]');
    expect(next.textContent).toBe('Grade Cell Lab');
    expect(next.getAttribute('data-aid')).toBe('a2');
    expect(doc.querySelector('[data-action="m-back"]').textContent).toBe('Done');
  });

  it('leaves out what is not there, and never lets a title be markup', () => {
    const none = parseHTML(
      '<div>' + MGradeLook.caughtUp({ done: 1, verb: 'graded', notIn: 0, next: null }) + '</div>',
    ).document;
    expect(none.querySelector('.m-grade-done-line').textContent).toBe('1 graded');
    expect(none.querySelector('[data-action="m-grade-next-piece"]')).toBeNull();
    const html = MGradeLook.caughtUp({ done: 1, verb: 'graded', notIn: 0, next: { id: 'a2', title: '<b>Lab</b>' } });
    expect(html).not.toContain('<b>');
  });
});

describe('the comment last written on a criterion waits as a suggestion', () => {
  it('is kept by class and criterion, on this phone', () => {
    expect(MGradeLook.suggestion(CID, 'a1', 'c1')).toBe('');
    MGradeLook.rememberComment(CID, 'a1', 'c1', 'Use "refraction" and "normal".');
    expect(MGradeLook.suggestion(CID, 'a1', 'c1')).toBe('Use "refraction" and "normal".');
    expect(MGradeLook.suggestion(CID, 'a1', 'c2')).toBe('');
    expect(MGradeLook.suggestion('other', 'a1', 'c1')).toBe('');
    MGradeLook.rememberComment(CID, 'a1', 'c1', 'Newer.');
    expect(MGradeLook.suggestion(CID, 'a1', 'c1')).toBe('Newer.');
  });

  it('is a convenience: a phone that keeps nothing suggests nothing, and nothing breaks', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => MGradeLook.rememberComment(CID, 'a1', 'c1', 'x')).not.toThrow();
    expect(MGradeLook.suggestion(CID, 'a1', 'c1')).toBe('');
  });
});

describe('Return and Next, held for Undo', () => {
  const unit = () => ({ st: students()[0], label: 'Cece Adams' });
  let toast;
  let refresh;
  let jump;
  let caught;

  beforeEach(() => {
    vi.useFakeTimers();
    toast = vi.spyOn(MComponents, 'showToast').mockImplementation(() => {});
    vi.spyOn(MComponents, 'hideToast').mockImplementation(() => {});
    refresh = vi.spyOn(MGrade, 'refreshToReturn').mockImplementation(() => {});
    jump = vi.spyOn(MGrade, 'jumpToStudent').mockImplementation(() => {});
    caught = vi.spyOn(MGrade, 'hideCaughtUp').mockImplementation(() => {});
    vi.spyOn(MGrade, 'studentCardIndex').mockImplementation(() => 2);
  });
  afterEach(() => {
    MGradeLook.flush();
    vi.useRealTimers();
  });

  it('waits seven seconds, then is sent', () => {
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

  it('Undo sends nothing, goes back to the card, and takes All Caught Up away', () => {
    const send = vi.fn();
    MGradeLook.hold(CID, 'a1', unit(), send);
    toast.mock.calls[0][1].onUndo();
    expect(MGradeLook.held(CID, 'a1', 'stu1')).toBe(false);
    expect(jump).toHaveBeenCalledWith(2);
    expect(caught).toHaveBeenCalled();
    vi.advanceTimersByTime(20000);
    expect(send).not.toHaveBeenCalled();
  });

  it('the next return sends the one held, and is held in its place', () => {
    const first = vi.fn();
    const second = vi.fn();
    MGradeLook.hold(CID, 'a1', unit(), first);
    const pair = { st: students()[1], label: 'Pair 1', view: { members: ['stu2', 'stu3'] } };
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
    MGradeLook.flush();
    expect(refresh).not.toHaveBeenCalled();
  });
});
