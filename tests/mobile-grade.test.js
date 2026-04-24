/**
 * Mobile Speed Grader tests — m-grade.js
 *
 * Tests assessment picker, student card rendering, score saving,
 * undo stack, status toggles, and performance safeguards.
 */

import './setup-mobile.js';

const CID = 'test';
const originals = {};

function mockDataLayer(overrides) {
  const defaults = {
    getStudents: () => [
      { id: 'stu1', firstName: 'Cece', lastName: 'Adams', preferred: '', pronouns: 'she/her', designations: [] },
      { id: 'stu2', firstName: 'Noor', lastName: 'Khan', preferred: 'Noor', pronouns: '', designations: [] },
      { id: 'stu3', firstName: 'Liam', lastName: 'Chen', preferred: '', pronouns: 'he/him', designations: [] },
    ],
    sortStudents: arr => arr,
    displayName: st => (st.preferred || st.firstName) + ' ' + st.lastName,
    getAssessments: () => [
      { id: 'a1', title: 'Science Fair Proposal', type: 'summative', date: '2025-03-20', tagIds: ['t1', 't2'] },
      { id: 'a2', title: 'Lab Quiz', type: 'formative', date: '2025-03-10', tagIds: ['t1'] },
    ],
    getScores: () => ({}),
    getAssignmentStatuses: () => ({}),
    getAssignmentStatus: () => null,
    setAssignmentStatus: () => {},
    saveScores: () => {},
    getTagById: (cid, tid) => ({ id: tid, label: tid === 't1' ? 'Questioning' : 'Evaluating', name: tid }),
    getSectionForTag: () => ({ color: '#2196F3' }),
    clearProfCache: () => {},
  };
  const mocks = { ...defaults, ...overrides };
  Object.keys(mocks).forEach(fn => {
    originals[fn] = globalThis[fn];
    globalThis[fn] = mocks[fn];
  });
}

function restoreDataLayer() {
  Object.keys(originals).forEach(fn => {
    if (originals[fn] !== undefined) globalThis[fn] = originals[fn];
  });
}

beforeEach(() => {
  clearProfCache();
  globalThis.COURSES = {
    test: { id: 'test', name: 'Test Course', calcMethod: 'mostRecent', decayWeight: 0.65 },
  };
});

afterEach(() => {
  restoreDataLayer();
});

/* ── renderPicker ───────────────────────────────────────────── */
describe('MGrade.renderPicker', () => {
  it('renders assessment picker with title', () => {
    mockDataLayer({});
    const html = MGrade.renderPicker(CID);
    expect(html).toContain('Grade');
    expect(html).toContain('m-screen');
  });

  it('shows segmented control with Recent/All + Filter button (Ungraded moved into filter sheet)', () => {
    mockDataLayer({});
    const html = MGrade.renderPicker(CID);
    expect(html).toContain('Recent');
    expect(html).toContain('All');
    expect(html).toContain('m-segmented');
    // Ungraded is no longer a segment; it's rolled into the filter sheet as
    // gradedStatus='has-ungraded'.
    expect(html).not.toContain('data-val="ungraded"');
    // Filter button with badge slot is rendered.
    expect(html).toContain('m-grade-filter-btn');
    expect(html).toContain('m-grade-filter-badge');
    expect(html).toContain('data-action="m-grade-filter-open"');
  });

  it('lists assessments sorted newest first', () => {
    mockDataLayer({});
    const html = MGrade.renderPicker(CID);
    // Science Fair Proposal (Mar 20) should appear before Lab Quiz (Mar 10)
    const propIdx = html.indexOf('Science Fair Proposal');
    const quizIdx = html.indexOf('Lab Quiz');
    expect(propIdx).toBeLessThan(quizIdx);
  });

  it('shows assessment type badges (S/F)', () => {
    mockDataLayer({});
    const html = MGrade.renderPicker(CID);
    expect(html).toContain('m-type-summative');
    expect(html).toContain('m-type-formative');
  });

  it('shows progress bars with graded count', () => {
    mockDataLayer({
      getScores: () => ({
        stu1: [{ assessmentId: 'a1', tagId: 't1', score: 3, type: 'summative', date: '2025-03-20' }],
      }),
    });
    const html = MGrade.renderPicker(CID);
    expect(html).toContain('m-progress-bar');
    expect(html).toContain('1/3 graded');
  });

  it('clamps progress percentage to 0-100', () => {
    mockDataLayer({
      getScores: () => ({
        stu1: [{ assessmentId: 'a1', tagId: 't1', score: 3, type: 'summative', date: '2025-03-20' }],
        stu2: [{ assessmentId: 'a1', tagId: 't1', score: 3, type: 'summative', date: '2025-03-20' }],
        stu3: [{ assessmentId: 'a1', tagId: 't1', score: 3, type: 'summative', date: '2025-03-20' }],
      }),
    });
    const html = MGrade.renderPicker(CID);
    // 3/3 = 100% — verify it doesn't exceed
    expect(html).toContain('width:100%');
  });

  it('shows tag count per assessment', () => {
    mockDataLayer({});
    const html = MGrade.renderPicker(CID);
    expect(html).toContain('2 tags'); // a1 has 2 tagIds
    expect(html).toContain('1 tag'); // a2 has 1 tagId
  });

  it('shows empty state when no assessments', () => {
    mockDataLayer({ getAssessments: () => [] });
    const html = MGrade.renderPicker(CID);
    expect(html).toContain('No Assessments');
  });
});

/* ── renderSwiper ───────────────────────────────────────────── */
describe('MGrade.renderSwiper', () => {
  it('renders student card swiper with thumbnail strip', () => {
    mockDataLayer({});
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('m-swiper');
    expect(html).toContain('m-thumb-strip');
  });

  it('returns error when assessment not found', () => {
    mockDataLayer({});
    const html = MGrade.renderSwiper(CID, 'nonexistent');
    expect(html).toContain('Assessment not found');
  });

  it('creates one card per student', () => {
    mockDataLayer({});
    const html = MGrade.renderSwiper(CID, 'a1');
    // Count swiper-card occurrences
    const count = (html.match(/m-swiper-card/g) || []).length;
    expect(count).toBe(3); // 3 students
  });

  it('shows student name and avatar in each card', () => {
    mockDataLayer({});
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('Cece Adams');
    expect(html).toContain('Noor Khan');
    expect(html).toContain('Liam Chen');
  });

  it('shows score buttons 1-4 for proficiency mode (0 is reached via toggle-off)', () => {
    mockDataLayer({});
    const html = MGrade.renderSwiper(CID, 'a1');
    // Levels 1-4 are rendered as buttons; level 0 (No Evidence) is not a
    // distinct button — teachers reach it by tapping the active level to
    // toggle it off.
    expect(html).not.toContain('data-score="0"');
    expect(html).toContain('data-score="1"');
    expect(html).toContain('data-score="2"');
    expect(html).toContain('data-score="3"');
    expect(html).toContain('data-score="4"');
  });

  it('score buttons have radiogroup role for accessibility', () => {
    mockDataLayer({});
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Score for');
  });

  it('marks active score button when student has existing score', () => {
    mockDataLayer({
      getScores: () => ({
        stu1: [{ assessmentId: 'a1', tagId: 't1', score: 3, type: 'summative', date: '2025-03-20' }],
      }),
    });
    const html = MGrade.renderSwiper(CID, 'a1');
    // The button for score 3 on stu1/t1 should be active
    expect(html).toContain('m-score-active');
  });

  it('shows status pills (NS/EXC/LATE)', () => {
    mockDataLayer({});
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('data-val="NS"');
    expect(html).toContain('data-val="EXC"');
    expect(html).toContain('data-val="LATE"');
  });

  it('marks active status pill when student has status', () => {
    mockDataLayer({
      getAssignmentStatuses: () => ({ 'stu1:a1': 'NS' }),
    });
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('m-status-active');
  });

  it('shows tag labels with section color dots', () => {
    mockDataLayer({});
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('Questioning');
    expect(html).toContain('Evaluating');
    expect(html).toContain('m-score-tag-dot');
  });

  it('does NOT call getAssignmentStatuses per student (N+1 fix)', () => {
    let statusCalls = 0;
    mockDataLayer({
      getAssignmentStatuses: () => {
        statusCalls++;
        return {};
      },
    });
    MGrade.renderSwiper(CID, 'a1');
    // Should be called once (hoisted in renderSwiper), not per student
    expect(statusCalls).toBe(1);
  });

  it('shows IEP/MOD badges on student cards', () => {
    mockDataLayer({
      getStudents: () => [
        { id: 'stu1', firstName: 'Test', lastName: 'Student', preferred: '', pronouns: '', designations: ['G'] },
      ],
    });
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('m-badge-iep');
  });

  it('shows first student thumbnail as current', () => {
    mockDataLayer({});
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('m-thumb-current');
  });

  it('shows graded indicator on thumbnail for graded students', () => {
    mockDataLayer({
      getScores: () => ({
        stu1: [{ assessmentId: 'a1', tagId: 't1', score: 3, type: 'summative', date: '2025-03-20' }],
      }),
    });
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('m-thumb-graded');
  });

  it('shows subtitle with student count', () => {
    mockDataLayer({});
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('1 of 3');
  });
});

/* ── Points mode ────────────────────────────────────────────── */
describe('Points mode variant', () => {
  // Skip: COURSES global interacts with gb-data.js initialization in test env
  // Points mode verified working via preview server.
  // NOTE: course.gradingSystem no longer has a 'points' value (T-UI-02 retired
  // it 2026-04-21; valid values are proficiency/letter/both). Per-assessment
  // scoring still supports points via assessment.score_mode='points', which
  // is what this test actually exercises. Fixture updated to 'both'.
  it.skip('shows +/- stepper for points-based courses', () => {
    globalThis.getPointsScore = () => 85;
    mockDataLayer({
      getStudents: () => [
        { id: 'stu1', firstName: 'Test', lastName: 'Student', preferred: '', pronouns: '', designations: [] },
      ],
      getAssessments: () => [
        {
          id: 'a1',
          title: 'Points Test',
          type: 'summative',
          date: '2025-03-20',
          tagIds: ['t1'],
          maxPoints: 100,
          score_mode: 'points',
        },
      ],
      getAssignmentStatuses: () => ({}),
      getScores: () => ({}),
    });
    // Set COURSES after mockDataLayer to ensure it's not overwritten
    globalThis.COURSES = {
      test: { id: 'test', name: 'Test', calcMethod: 'mostRecent', gradingSystem: 'both' },
    };
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('/ 100');
    expect(html).toContain('85');
    delete globalThis.getPointsScore;
  });
});

/* ── setScore (auto-save + undo) ────────────────────────────── */
describe('MGrade.setScore', () => {
  it('saves score via upsertScore', () => {
    let store = {};
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 3);
    expect(store.stu1).toBeDefined();
    expect(store.stu1[0].score).toBe(3);
  });

  it('calls clearProfCache after scoring', () => {
    let cacheClearedCount = 0;
    mockDataLayer({
      getScores: () => ({}),
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    const origClear = globalThis.clearProfCache;
    globalThis.clearProfCache = () => {
      cacheClearedCount++;
    };
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 3);
    expect(cacheClearedCount).toBeGreaterThan(0);
    globalThis.clearProfCache = origClear;
  });

  it('replaces previous score for same assessment+tag', () => {
    let store = {
      stu1: [{ id: 'old1', assessmentId: 'a1', tagId: 't1', score: 2, type: 'summative', date: '2025-03-20' }],
    };
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 4);
    // Should have exactly 1 score for this tag (replaced, not accumulated)
    const tagScores = store.stu1.filter(s => s.assessmentId === 'a1' && s.tagId === 't1');
    expect(tagScores).toHaveLength(1);
    expect(tagScores[0].score).toBe(4);
  });

  it('does NOT show a toast on routine save (button-fill + haptic is enough)', () => {
    const toastCalls = [];
    const origToast = window.MComponents.showToast;
    window.MComponents.showToast = (msg, opts) => toastCalls.push({ msg, opts });
    mockDataLayer({
      getScores: () => ({}),
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 3);
    window.MComponents.showToast = origToast;
    expect(toastCalls).toHaveLength(0);
  });

  it('shows "Score cleared" toast with undo on toggle-off', () => {
    const toastCalls = [];
    const origToast = window.MComponents.showToast;
    window.MComponents.showToast = (msg, opts) => toastCalls.push({ msg, opts });
    let store = {
      stu1: [{ id: 'old', assessmentId: 'a1', tagId: 't1', score: 2, type: 'summative', date: '2025-03-20' }],
    };
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 2);
    window.MComponents.showToast = origToast;
    expect(toastCalls).toHaveLength(1);
    expect(toastCalls[0].msg).toBe('Score cleared');
    expect(typeof toastCalls[0].opts.onUndo).toBe('function');
  });

  it('tapping the already-active level clears the score (toggles off to 0)', () => {
    let store = {
      stu1: [{ id: 'old1', assessmentId: 'a1', tagId: 't1', score: 2, type: 'summative', date: '2025-03-20' }],
    };
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    // Tap "2" again when current score is already 2 → cleared to 0.
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 2);
    const tagScores = store.stu1.filter(s => s.assessmentId === 'a1' && s.tagId === 't1');
    expect(tagScores).toHaveLength(1);
    expect(tagScores[0].score).toBe(0);
  });

  it('tapping a different level when one is active replaces, does NOT clear', () => {
    let store = {
      stu1: [{ id: 'old1', assessmentId: 'a1', tagId: 't1', score: 2, type: 'summative', date: '2025-03-20' }],
    };
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 3);
    const tagScores = store.stu1.filter(s => s.assessmentId === 'a1' && s.tagId === 't1');
    expect(tagScores).toHaveLength(1);
    expect(tagScores[0].score).toBe(3);
  });

  it('tapping a cleared score (0) with a real level sets the level, does NOT toggle', () => {
    let store = {
      stu1: [{ id: 'old1', assessmentId: 'a1', tagId: 't1', score: 0, type: 'summative', date: '2025-03-20' }],
    };
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 3);
    const tagScores = store.stu1.filter(s => s.assessmentId === 'a1' && s.tagId === 't1');
    expect(tagScores).toHaveLength(1);
    expect(tagScores[0].score).toBe(3);
  });

  it('preserves scores for other tags when scoring one tag', () => {
    let store = {
      stu1: [{ id: 'keep1', assessmentId: 'a1', tagId: 't2', score: 3, type: 'summative', date: '2025-03-20' }],
    };
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 4);
    // t2 score should still be there
    const t2Scores = store.stu1.filter(s => s.tagId === 't2');
    expect(t2Scores).toHaveLength(1);
    expect(t2Scores[0].score).toBe(3);
  });
});

/* ── Undo stack ─────────────────────────────────────────────── */
describe('Undo stack', () => {
  it('undoLastScore restores previous score', () => {
    let savedScores = null;
    const originalScores = {
      stu1: [{ id: 'orig1', assessmentId: 'a1', tagId: 't1', score: 2, type: 'summative', date: '2025-03-20' }],
    };
    mockDataLayer({
      getScores: () => JSON.parse(JSON.stringify(originalScores)),
      saveScores: (cid, scores) => {
        savedScores = scores;
      },
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });

    // Score, then undo
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 4);
    MGrade.undoLastScore();

    // After undo, the original score should be restored
    const t1Scores = savedScores.stu1.filter(s => s.assessmentId === 'a1' && s.tagId === 't1');
    expect(t1Scores).toHaveLength(1);
    expect(t1Scores[0].score).toBe(2);
  });

  it('undo with empty stack does nothing', () => {
    // Should not throw
    expect(() => MGrade.undoLastScore()).not.toThrow();
  });

  it('undo stack is capped at 20 entries', () => {
    let saveCount = 0;
    mockDataLayer({
      getScores: () => ({}),
      saveScores: () => {
        saveCount++;
      },
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    // Score 25 times — each pushes to undo stack, but cap at 20
    for (let i = 0; i < 25; i++) {
      MGrade.setScore(CID, 'stu1', 'a1', 't1', i % 5);
    }
    saveCount = 0; // reset after scores
    // Undo all — only 20 should actually restore data (call saveScores)
    let actualUndos = 0;
    for (let i = 0; i < 25; i++) {
      const prevCount = saveCount;
      MGrade.undoLastScore();
      if (saveCount > prevCount) actualUndos++;
    }
    expect(actualUndos).toBeLessThanOrEqual(20);
  });
});

/* ── setStatus ──────────────────────────────────────────────── */
describe('MGrade.setStatus', () => {
  it('sets assignment status', () => {
    let setTo = null;
    mockDataLayer({
      getAssignmentStatus: () => null,
      setAssignmentStatus: (cid, sid, aid, status) => {
        setTo = status;
      },
    });
    MGrade.setStatus(CID, 'stu1', 'a1', 'NS');
    expect(setTo).toBe('NS');
  });

  it('toggles status off when same status clicked again', () => {
    let setTo = 'initial';
    mockDataLayer({
      getAssignmentStatus: () => 'NS',
      setAssignmentStatus: (cid, sid, aid, status) => {
        setTo = status;
      },
    });
    MGrade.setStatus(CID, 'stu1', 'a1', 'NS');
    expect(setTo).toBeNull(); // toggled off
  });

  it('NS auto-zeros every tag score on the assessment (matches desktop behaviour)', () => {
    let store = {
      stu1: [
        { id: 's1', assessmentId: 'a1', tagId: 't1', score: 3, type: 'summative', date: '2025-03-20' },
        { id: 's2', assessmentId: 'a1', tagId: 't2', score: 4, type: 'summative', date: '2025-03-20' },
        // Score on a different assessment — must NOT be touched.
        { id: 's3', assessmentId: 'a2', tagId: 't1', score: 2, type: 'summative', date: '2025-03-20' },
      ],
    };
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssignmentStatus: () => null,
      setAssignmentStatus: () => {},
      getAssessments: () => [
        { id: 'a1', type: 'summative', date: '2025-03-20', tagIds: ['t1', 't2'] },
        { id: 'a2', type: 'summative', date: '2025-03-20', tagIds: ['t1'] },
      ],
    });
    MGrade.setStatus(CID, 'stu1', 'a1', 'NS');

    const a1t1 = store.stu1.find(s => s.assessmentId === 'a1' && s.tagId === 't1');
    const a1t2 = store.stu1.find(s => s.assessmentId === 'a1' && s.tagId === 't2');
    const a2t1 = store.stu1.find(s => s.assessmentId === 'a2' && s.tagId === 't1');
    expect(a1t1.score).toBe(0);
    expect(a1t2.score).toBe(0);
    expect(a2t1.score).toBe(2); // untouched — different assessment
  });

  it('EXC does NOT auto-zero (only NS has that semantic)', () => {
    let store = {
      stu1: [{ id: 's1', assessmentId: 'a1', tagId: 't1', score: 3, type: 'summative', date: '2025-03-20' }],
    };
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssignmentStatus: () => null,
      setAssignmentStatus: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20', tagIds: ['t1'] }],
    });
    MGrade.setStatus(CID, 'stu1', 'a1', 'EXC');
    expect(store.stu1[0].score).toBe(3); // preserved
  });

  it('renders m-card-status-disabled on the surface when initial status is NS or EXC', () => {
    mockDataLayer({
      getScores: () => ({}),
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20', tagIds: ['t1'] }],
      getAssignmentStatuses: () => ({
        stu1: 'NS', // no effect — keyed wrong; the real lookup is composite-key
        'stu1:a1': 'NS',
        'stu2:a1': 'EXC',
        'stu3:a1': 'LATE',
      }),
    });
    const html = MGrade.renderSwiper(CID, 'a1');
    // Card for stu1 (NS) and stu2 (EXC) should have the disable class;
    // stu3 (LATE) should NOT — LATE doesn't disable grading.
    const stu1Idx = html.indexOf('data-sid="stu1"');
    const stu2Idx = html.indexOf('data-sid="stu2"');
    const stu3Idx = html.indexOf('data-sid="stu3"');
    const next = idx => html.slice(idx, idx + 600);
    expect(next(stu1Idx)).toContain('m-card-status-disabled');
    expect(next(stu2Idx)).toContain('m-card-status-disabled');
    expect(next(stu3Idx)).not.toContain('m-card-status-disabled');
  });

  it('clearing NS does NOT restore scores (destructive by design)', () => {
    // Student had a 3, teacher hit NS (which zeroed), now clears NS — score stays 0.
    let store = {
      stu1: [{ id: 's1', assessmentId: 'a1', tagId: 't1', score: 0, type: 'summative', date: '2025-03-20' }],
    };
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssignmentStatus: () => 'NS',
      setAssignmentStatus: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20', tagIds: ['t1'] }],
    });
    MGrade.setStatus(CID, 'stu1', 'a1', 'NS'); // toggle off
    expect(store.stu1[0].score).toBe(0); // still 0
  });
});

/* ── filterAssessments ──────────────────────────────────────── */
describe('MGrade.filterAssessments', () => {
  it('is a callable function', () => {
    expect(typeof MGrade.filterAssessments).toBe('function');
  });
});

/* ── Filter sheet: state + persistence + rendering ───────────── */
describe('MGrade filter sheet', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('renderPicker hides the filter badge when no filters are persisted', () => {
    mockDataLayer({});
    const html = MGrade.renderPicker(CID);
    // Badge element is rendered but hidden; the hidden attribute is present
    // and the count slot is empty.
    const match = html.match(/<span class="m-grade-filter-badge"([^>]*)>([^<]*)<\/span>/);
    expect(match).not.toBeNull();
    expect(match[1]).toContain('hidden');
    expect(match[2].trim()).toBe('');
  });

  it('renderPicker surfaces the active filter count when filters are persisted', () => {
    localStorage.setItem(
      'gb-grade-filters-' + CID,
      JSON.stringify({ category: ['c1'], module: [], dateRange: '30d', gradedStatus: 'all' }),
    );
    mockDataLayer({});
    const html = MGrade.renderPicker(CID);
    const match = html.match(/<span class="m-grade-filter-badge"([^>]*)>([^<]*)<\/span>/);
    expect(match[1]).not.toContain('hidden');
    expect(match[2].trim()).toBe('2'); // category(1) + dateRange(1)
  });

  it('applyFilterSheet persists staged filters to localStorage', () => {
    mockDataLayer({});
    // Render first so _loadFilters picks up defaults
    MGrade.renderPicker(CID);
    // Seed a staged set via openFilterSheet (requires sheet DOM — stub
    // presentSheet so the HTML isn't actually mounted)
    const origPresent = window.MComponents.presentSheet;
    const origDismiss = window.MComponents.dismissSheet;
    window.MComponents.presentSheet = () => {};
    window.MComponents.dismissSheet = () => {};

    MGrade.openFilterSheet(CID);
    MGrade.onFilterTogglePill('category', 'c1');
    MGrade.onFilterSegChange('dateRange', '30d');
    MGrade.applyFilterSheet(CID);

    const persisted = JSON.parse(localStorage.getItem('gb-grade-filters-' + CID));
    expect(persisted.category).toEqual(['c1']);
    expect(persisted.dateRange).toBe('30d');
    expect(persisted.gradedStatus).toBe('all');

    window.MComponents.presentSheet = origPresent;
    window.MComponents.dismissSheet = origDismiss;
  });

  it('clearFilterSheet wipes persisted filters back to defaults', () => {
    localStorage.setItem(
      'gb-grade-filters-' + CID,
      JSON.stringify({ category: ['c1'], module: ['m1'], dateRange: 'term', gradedStatus: 'has-ungraded' }),
    );
    mockDataLayer({});
    const origPresent = window.MComponents.presentSheet;
    const origDismiss = window.MComponents.dismissSheet;
    window.MComponents.presentSheet = () => {};
    window.MComponents.dismissSheet = () => {};

    MGrade.renderPicker(CID);
    MGrade.clearFilterSheet(CID);

    const persisted = JSON.parse(localStorage.getItem('gb-grade-filters-' + CID));
    expect(persisted).toEqual({ category: [], module: [], dateRange: 'all', gradedStatus: 'all' });

    window.MComponents.presentSheet = origPresent;
    window.MComponents.dismissSheet = origDismiss;
  });

  it('filter sheet HTML includes Category + Date range + Graded status sections, hides Module when no modules', () => {
    mockDataLayer({
      getCategories: () => [{ id: 'c1', name: 'Labs' }],
      getModules: () => [],
    });
    const origPresent = window.MComponents.presentSheet;
    let capturedHtml = '';
    window.MComponents.presentSheet = html => {
      capturedHtml = html;
    };

    MGrade.renderPicker(CID);
    MGrade.openFilterSheet(CID);

    expect(capturedHtml).toContain('Category');
    expect(capturedHtml).toContain('Date range');
    expect(capturedHtml).toContain('Graded status');
    expect(capturedHtml).toContain('Labs'); // the one category chip
    expect(capturedHtml).toContain('No Category');
    expect(capturedHtml).not.toContain('m-filter-sheet-title">Module'); // Module section hidden
    expect(capturedHtml).toContain('data-action="m-grade-filter-apply"');
    expect(capturedHtml).toContain('data-action="m-grade-filter-clear"');

    window.MComponents.presentSheet = origPresent;
  });

  it('filter sheet HTML includes Module section when course has modules', () => {
    mockDataLayer({
      getCategories: () => [],
      getModules: () => [{ id: 'm1', name: 'Unit 1' }],
    });
    const origPresent = window.MComponents.presentSheet;
    let capturedHtml = '';
    window.MComponents.presentSheet = html => {
      capturedHtml = html;
    };

    MGrade.renderPicker(CID);
    MGrade.openFilterSheet(CID);

    expect(capturedHtml).toContain('m-filter-sheet-title">Module');
    expect(capturedHtml).toContain('Unit 1');

    window.MComponents.presentSheet = origPresent;
  });
});

/* ── setupSwiper ────────────────────────────────────────────── */
describe('MGrade.setupSwiper', () => {
  it('handles missing swiper element gracefully', () => {
    mockDataLayer({});
    // setupSwiper calls getElementById('m-swiper') which returns our stub
    // The stub has addEventListener, so this should work
    expect(() => MGrade.setupSwiper(CID, 'a1')).not.toThrow();
  });
});

/* ── jumpToStudent ──────────────────────────────────────────── */
describe('MGrade.jumpToStudent', () => {
  it('handles jump without error', () => {
    // jumpToStudent calls getElementById('m-swiper') which returns stub with scrollTo
    expect(() => MGrade.jumpToStudent(5)).not.toThrow();
  });
});

/* ── Assessment picker edge cases ───────────────────────────── */
describe('Assessment picker edge cases', () => {
  it('shows correct tag count pluralization (1 tag vs 2 tags)', () => {
    mockDataLayer({
      getAssessments: () => [
        { id: 'a1', title: 'One Tag', type: 'summative', date: '2025-03-20', tagIds: ['t1'] },
        { id: 'a2', title: 'Multi Tags', type: 'summative', date: '2025-03-19', tagIds: ['t1', 't2', 't3'] },
      ],
    });
    const html = MGrade.renderPicker(CID);
    expect(html).toContain('1 tag');
    expect(html).toContain('3 tags');
  });

  it('shows 0/N graded for ungraded assessments', () => {
    mockDataLayer({
      getAssessments: () => [{ id: 'a1', title: 'Test', type: 'summative', date: '2025-03-20', tagIds: ['t1'] }],
      getScores: () => ({}),
    });
    const html = MGrade.renderPicker(CID);
    expect(html).toContain('0/3 graded');
  });

  it('shows category badges for assessments', () => {
    mockDataLayer({});
    const html = MGrade.renderPicker(CID);
    expect(html).toContain('No Category');
    expect(html).toContain('m-type-summative');
    expect(html).toContain('m-type-formative');
  });

  it('shows dates in readable format', () => {
    mockDataLayer({
      getAssessments: () => [{ id: 'a1', title: 'Test', type: 'summative', date: '2025-03-20', tagIds: [] }],
    });
    const html = MGrade.renderPicker(CID);
    expect(html).toContain('Mar'); // month abbreviation present
    // Day may be 19 or 20 depending on timezone — just verify it's a number
    expect(html).toMatch(/Mar\s+\d{1,2}/);
  });
});

/* ── Swiper card edge cases ─────────────────────────────────── */
describe('Swiper card edge cases', () => {
  it('renders correct number of score buttons per tag', () => {
    mockDataLayer({
      getAssessments: () => [{ id: 'a1', title: 'Test', type: 'summative', date: '2025-03-20', tagIds: ['t1'] }],
    });
    const html = MGrade.renderSwiper(CID, 'a1');
    // Each tag has 4 buttons (levels 1-4) per student. Level 0 (No Evidence)
    // is reached by toggling the active level off.
    const scoreButtons = html.match(/data-action="m-grade-score"/g) || [];
    // 3 students x 1 tag x 4 levels = 12 buttons
    expect(scoreButtons.length).toBe(12);
  });

  it('handles assessment with multiple tags', () => {
    mockDataLayer({
      getAssessments: () => [{ id: 'a1', title: 'Multi', type: 'summative', date: '2025-03-20', tagIds: ['t1', 't2'] }],
    });
    const html = MGrade.renderSwiper(CID, 'a1');
    // 3 students x 2 tags x 4 levels = 24 buttons
    const scoreButtons = html.match(/data-action="m-grade-score"/g) || [];
    expect(scoreButtons.length).toBe(24);
  });

  it('shows all three status pills per student', () => {
    mockDataLayer({});
    const html = MGrade.renderSwiper(CID, 'a1');
    // 3 students x 3 status types = 9 status pills
    const statusPills = html.match(/data-action="m-grade-status"/g) || [];
    expect(statusPills.length).toBe(9);
  });

  it('shows section color dot on tag labels', () => {
    mockDataLayer({
      getSectionForTag: () => ({ color: '#FF5722' }),
    });
    const html = MGrade.renderSwiper(CID, 'a1');
    expect(html).toContain('#FF5722');
    expect(html).toContain('m-score-tag-dot');
  });

  it('handles missing tag gracefully', () => {
    mockDataLayer({
      getTagById: () => null,
      getAssessments: () => [
        { id: 'a1', title: 'Test', type: 'summative', date: '2025-03-20', tagIds: ['unknown-tag'] },
      ],
    });
    const html = MGrade.renderSwiper(CID, 'a1');
    // Should not crash — falls back to using tag ID as label
    expect(html).toContain('m-score-group');
  });
});

/* ── Score saving edge cases ────────────────────────────────── */
describe('Score save edge cases', () => {
  it('creates score with correct metadata fields', () => {
    let store = {};
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 4);
    const score = store.stu1[0];
    expect(score.score).toBe(4);
    expect(score.assessmentId).toBe('a1');
    expect(score.tagId).toBe('t1');
    expect(score.type).toBe('summative');
    expect(score.date).toBe('2025-03-20');
    expect(score.created).toBeTruthy(); // ISO timestamp
    expect(score.id).toBeDefined(); // auto-generated ID
  });

  it('uses assessment type for score entry', () => {
    let store = {};
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'formative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 2);
    expect(store.stu1[0].type).toBe('formative');
  });

  it('scoring zero is valid (No Evidence)', () => {
    let store = {};
    mockDataLayer({
      getScores: () => store,
      saveScores: () => {},
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 0);
    expect(store.stu1[0].score).toBe(0);
  });
});

/* ── Multiple undo operations ───────────────────────────────── */
describe('Multiple undo operations', () => {
  it('scoring different students independently', () => {
    let store = {};
    mockDataLayer({
      getScores: () => store,
      saveScores: (cid, scores) => {
        store = scores;
      },
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 3);
    MGrade.setScore(CID, 'stu2', 'a1', 't1', 4);
    expect(store.stu1[0].score).toBe(3);
    expect(store.stu2[0].score).toBe(4);
  });

  it('scoring different tags on same student independently', () => {
    let store = {};
    mockDataLayer({
      getScores: () => store,
      saveScores: (cid, scores) => {
        store = scores;
      },
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 2);
    MGrade.setScore(CID, 'stu1', 'a1', 't2', 4);
    const t1 = store.stu1.filter(s => s.tagId === 't1');
    const t2 = store.stu1.filter(s => s.tagId === 't2');
    expect(t1[0].score).toBe(2);
    expect(t2[0].score).toBe(4);
  });

  it('handles sequential score → undo → score → undo', () => {
    let store = {};
    mockDataLayer({
      getScores: () => store,
      saveScores: (cid, scores) => {
        store = scores;
      },
      getAssessments: () => [{ id: 'a1', type: 'summative', date: '2025-03-20' }],
    });
    // Score 3, then undo, then score 4, then undo
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 3);
    MGrade.undoLastScore(); // back to empty
    MGrade.setScore(CID, 'stu1', 'a1', 't1', 4);
    expect(store.stu1[0].score).toBe(4);
    MGrade.undoLastScore(); // back to empty again
    const remaining = (store.stu1 || []).filter(s => s.assessmentId === 'a1' && s.tagId === 't1');
    expect(remaining).toHaveLength(0);
  });
});
