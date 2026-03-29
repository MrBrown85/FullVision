/**
 * Cross-tab sync via BroadcastChannel tests.
 */

import { vi } from 'vitest';

const CID = 'bctest';

// Capture postMessage calls on BroadcastChannel instances
let postMessageSpy;

beforeEach(() => {
  localStorage.clear();
  _cache.students[CID] = undefined;
  _cache.scores[CID] = undefined;
  _cache.assessments[CID] = undefined;
  _cache.courseConfigs[CID] = undefined;

  // Spy on BroadcastChannel.prototype.postMessage to detect broadcasts
  postMessageSpy = vi.spyOn(BroadcastChannel.prototype, 'postMessage');
});

afterEach(() => {
  postMessageSpy.mockRestore();
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
  it('saveStudents broadcasts a data-changed message', () => {
    const students = [
      { id: 's1', firstName: 'Test', lastName: 'User', designations: [], sortName: 'User Test' }
    ];
    postMessageSpy.mockClear();
    saveStudents(CID, students);
    expect(postMessageSpy).toHaveBeenCalled();
    const call = postMessageSpy.mock.calls.find(c => c[0] && c[0].field === 'students');
    expect(call).toBeTruthy();
    expect(call[0].cid).toBe(CID);
  });

  it('saveScores broadcasts a data-changed message', () => {
    const scores = { s1: [{ id: 'sc1', assessmentId: 'a1', tagId: 'QAP', score: 3, date: '2025-01-15', type: 'summative' }] };
    postMessageSpy.mockClear();
    saveScores(CID, scores);
    expect(postMessageSpy).toHaveBeenCalled();
    const call = postMessageSpy.mock.calls.find(c => c[0] && c[0].field === 'scores');
    expect(call).toBeTruthy();
    expect(call[0].cid).toBe(CID);
  });

  it('saveAssessments broadcasts a data-changed message', () => {
    const assessments = [{ id: 'a1', title: 'Test Quiz', date: '2025-01-15', type: 'summative', tagIds: ['QAP'] }];
    postMessageSpy.mockClear();
    saveAssessments(CID, assessments);
    expect(postMessageSpy).toHaveBeenCalled();
    const call = postMessageSpy.mock.calls.find(c => c[0] && c[0].field === 'assessments');
    expect(call).toBeTruthy();
    expect(call[0].cid).toBe(CID);
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
