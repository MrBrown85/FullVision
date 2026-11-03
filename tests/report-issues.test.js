/**
 * ReportIssues: the pure parts (hash, the index, "changed since") and that
 * issuing still records the index when IndexedDB is not there.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const CID = 'course-issues';

beforeEach(() => localStorage.clear());
afterEach(() => vi.useRealTimers());

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

  it('a report printed another day is not changed: the Missing Work "As of" date is left out of the hash', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const MW = 'course-issues-asof';
    const st = { id: 's1', firstName: 'Noor', lastName: 'Khan' };
    COURSES[MW] = { id: MW, name: 'Socials 9', gradingSystem: 'proficiency' };
    _cache.students[MW] = [st];
    _cache.assessments[MW] = [];
    _cache.scores[MW] = {};
    _cache.statuses[MW] = {};
    const on = (day, options) => {
      vi.setSystemTime(new Date(day + 'T19:00:00Z'));
      return ReportBlocks.renderReportBlock('missing-work', MW, st, {}, options);
    };
    ['row', 'half'].forEach(size => {
      const nov20 = on('2026-11-20', { size });
      const nov21 = on('2026-11-21', { size });
      expect(nov20).toContain('As of Nov 20, 2026');
      expect(nov21).toContain('As of Nov 21, 2026');
      expect(ReportIssues.hash(nov21)).toBe(ReportIssues.hash(nov20));
    });
    // Anything else in the report still counts.
    expect(ReportIssues.hash(on('2026-11-21', {}) + '<p>a</p>')).not.toBe(ReportIssues.hash(on('2026-11-20', {})));
    delete COURSES[MW];
  });

  it('after a partial print each student is compared with their own last printed copy', async () => {
    const s = (sid, html) => ({ sid, name: sid, sheets: 1, html });
    const issue = students =>
      ReportIssues.issue({ cid: CID, termId: 'term-1', termLabel: 'Nov Report Card', paper: 'letter', students });
    await issue([s('s1', '<p>a</p>'), s('s2', '<p>b</p>'), s('s3', '<p>c</p>')]);
    // s2 changed and was printed alone ("Changed since the last print").
    await issue([s('s2', '<p>b2</p>')]);
    const printed = ReportIssues.printedHashes(CID, 'term-1');
    const now = h => ReportIssues.hash(h);
    expect(
      ReportIssues.changedSince(
        { hashes: printed },
        { s1: now('<p>a</p>'), s2: now('<p>b2</p>'), s3: now('<p>c</p>') },
      ),
    ).toEqual([]);
    expect(
      ReportIssues.changedSince(
        { hashes: printed },
        { s1: now('<p>a2</p>'), s2: now('<p>b</p>'), s3: now('<p>c</p>'), s4: now('<p>d</p>') },
      ),
    ).toEqual(['s1', 's2', 's4']);
    // Another term's copies are not used.
    expect(ReportIssues.printedHashes(CID, 'term-2')).toEqual({});
  });

  it('labels an issue by when it went home', () => {
    expect(ReportIssues.label({ issuedAt: '2026-10-20T22:40:00.000Z' }, '2026-11-01')).toMatch(/^Printed Oct 20, \d/);
    expect(ReportIssues.label({ issuedAt: '2026-10-20T22:40:00.000Z' }, '2027-02-01')).toMatch(/^Printed Oct 20, 2026/);
  });
});
