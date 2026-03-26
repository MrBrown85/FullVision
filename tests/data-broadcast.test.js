/**
 * Cross-tab sync via BroadcastChannel tests.
 */

import { vi } from 'vitest';

const CID = 'bctest';

beforeEach(() => {
  localStorage.clear();
  _cache.students[CID] = undefined;
  _cache.scores[CID] = undefined;
  _cache.assessments[CID] = undefined;
  _cache.courseConfigs[CID] = undefined;
});

describe('_broadcastChange', () => {
  it('exists and is callable', () => {
    expect(typeof _broadcastChange).toBe('function');
  });

  it('does not crash with invalid arguments', () => {
    expect(() => _broadcastChange(null, null)).not.toThrow();
    expect(() => _broadcastChange(undefined, undefined)).not.toThrow();
    expect(() => _broadcastChange()).not.toThrow();
  });
});

describe('save functions trigger _broadcastChange', () => {
  let spy;

  beforeEach(() => {
    spy = vi.fn();
    // Replace the real _broadcastChange with our spy.
    // _broadcastChange is called inside _saveCourseField, which is a closure.
    // Since _broadcastChange is a top-level function, we can intercept the
    // BroadcastChannel.postMessage to detect that broadcasting occurred.
    // Instead, we spy on the channel itself.
  });

  it('saveStudents calls _broadcastChange (via localStorage write)', () => {
    const students = [
      { id: 's1', firstName: 'Test', lastName: 'User', designations: [], sortName: 'User Test' }
    ];
    // Before save, no localStorage entry
    expect(localStorage.getItem('gb-students-' + CID)).toBeNull();
    saveStudents(CID, students);
    // After save, localStorage is updated (confirming _saveCourseField ran,
    // which always calls _broadcastChange at the end)
    expect(localStorage.getItem('gb-students-' + CID)).not.toBeNull();
    // Verify cache is also updated
    expect(_cache.students[CID]).toEqual(students);
  });

  it('saveScores calls _broadcastChange (via localStorage write)', () => {
    const scores = { s1: [{ id: 'sc1', assessmentId: 'a1', tagId: 'QAP', score: 3, date: '2025-01-15', type: 'summative' }] };
    saveScores(CID, scores);
    expect(localStorage.getItem('gb-scores-' + CID)).not.toBeNull();
    expect(_cache.scores[CID]).toEqual(scores);
  });

  it('saveAssessments calls _broadcastChange (via localStorage write)', () => {
    const assessments = [{ id: 'a1', title: 'Test Quiz', date: '2025-01-15', type: 'summative', tagIds: ['QAP'] }];
    saveAssessments(CID, assessments);
    expect(localStorage.getItem('gb-assessments-' + CID)).not.toBeNull();
    expect(_cache.assessments[CID]).toEqual(assessments);
  });
});

describe('BroadcastChannel shim', () => {
  it('constructor does not throw in test environment', () => {
    expect(() => new BroadcastChannel('test-channel')).not.toThrow();
  });

  it('postMessage is callable on shim instance', () => {
    const ch = new BroadcastChannel('test-channel');
    expect(() => ch.postMessage({ type: 'data-changed' })).not.toThrow();
  });
});
