/**
 * "Keep a copy first" before a permanent delete: the CSV shows each score the
 * same way whether the records came from this device or from the server
 * (get_withdrawn_student_records): points as "8 / 10", Complete/Incomplete
 * as words, a proficiency as teachers write it ("3+").
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-00000000d0a1';
const originalV2 = window.v2;

afterEach(() => {
  window.v2 = originalV2;
});

describe('withdrawn student records download', () => {
  it('formats server records like this device does', async () => {
    window.v2 = Object.assign({}, originalV2, {
      getWithdrawnStudentRecords: () =>
        Promise.resolve({
          data: {
            scores: [
              { assessment: 'Quiz', date: '2026-10-01', score_mode: 'points', max_points: 10, value: 8 },
              { assessment: 'Writing Sample', date: '2026-09-15', score_mode: 'complete', max_points: 1, value: 1 },
              { assessment: 'Exit Slip', date: '2026-09-16', score_mode: 'complete', max_points: 1, value: 0 },
            ],
            tag_scores: [{ assessment: 'Lab', date: '2026-10-02', competency: 'Questioning', value: 3, modifier: 1 }],
            rubric_scores: [],
            observations: [],
          },
          error: null,
        }),
    });
    const rows = await DashClassManager.withdrawnRecordRows(CID, { student: { id: 'enr-1' }, records: {} });
    expect(rows.map(r => r[4])).toEqual(['8 / 10', 'Complete', 'Incomplete', '3+']);
  });

  it('formats this device’s records the same way', async () => {
    saveCourses({ [CID]: { id: CID, name: 'Science 8' } });
    _cache.assessments[CID] = [
      { id: 'q', title: 'Quiz', scoreMode: 'points', maxPoints: 10 },
      { id: 'w', title: 'Writing Sample', scoreMode: 'complete', maxPoints: 1 },
    ];
    const rows = await DashClassManager.withdrawnRecordRows(CID, {
      student: { id: 'enr-1' },
      records: {
        scores: [
          { assessmentId: 'q', tagId: '', score: 8 },
          { assessmentId: 'w', tagId: '', score: 1 },
        ],
      },
    });
    expect(rows.map(r => r[4])).toEqual(['8 / 10', 'Complete']);
  });
});
