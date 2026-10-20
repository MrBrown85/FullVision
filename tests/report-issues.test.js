/**
 * ReportIssues: the pure parts (hash, the index, "changed since") and that
 * issuing still records the index when IndexedDB is not there.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-issues';

beforeEach(() => localStorage.clear());

describe('ReportIssues', () => {
  it('hashes stably and differently', () => {
    expect(ReportIssues.hash('<div>a</div>')).toBe(ReportIssues.hash('<div>a</div>'));
    expect(ReportIssues.hash('<div>a</div>')).not.toBe(ReportIssues.hash('<div>b</div>'));
  });

  it('issues into the index without IndexedDB and lists newest first', async () => {
    const one = await ReportIssues.issue({
      cid: CID,
      termId: 'term-1',
      termLabel: 'Nov Report Card',
      paper: 'letter',
      students: [{ sid: 's1', name: 'A', sheets: 1, html: '<p>a</p>' }],
    });
    expect(one.stored).toBe(false);
    expect(one.entry.count).toBe(1);
    expect(one.entry.hashes.s1).toBe(ReportIssues.hash('<p>a</p>'));
    const two = await ReportIssues.issue({
      cid: CID,
      termId: 'term-1',
      termLabel: 'Nov Report Card',
      paper: 'letter',
      students: [{ sid: 's1', name: 'A', sheets: 1, html: '<p>b</p>' }],
    });
    expect(ReportIssues.list(CID, 'term-1').map(e => e.id)).toEqual([two.entry.id, one.entry.id]);
    expect(ReportIssues.list(CID, 'term-2')).toEqual([]);
    expect(ReportIssues.latest(CID, 'term-1').id).toBe(two.entry.id);
  });

  it('changedSince names the students whose sheets differ or who are new', async () => {
    const res = await ReportIssues.issue({
      cid: CID,
      termId: 'term-1',
      termLabel: 'Nov Report Card',
      paper: 'letter',
      students: [
        { sid: 's1', name: 'A', sheets: 1, html: '<p>a</p>' },
        { sid: 's2', name: 'B', sheets: 1, html: '<p>b</p>' },
      ],
    });
    const now = {
      s1: ReportIssues.hash('<p>a</p>'),
      s2: ReportIssues.hash('<p>b2</p>'),
      s3: ReportIssues.hash('<p>c</p>'),
    };
    expect(ReportIssues.changedSince(res.entry, now)).toEqual(['s2', 's3']);
    expect(ReportIssues.changedSince(null, now)).toEqual(['s1', 's2', 's3']);
  });

  it('labels an issue by when it went home', () => {
    expect(ReportIssues.label({ issuedAt: '2026-10-20T22:40:00.000Z' })).toMatch(/^Issued Oct 20, 2026/);
  });
});
