/**
 * Issued copies on the server (migrations/20261020_report_issue.sql):
 * ReportIssues writes the device copy first, then v2.createReportIssue
 * and records the serverId; sync() merges the server's list into the
 * index; load() falls back to v2.getReportIssue; remove() deletes the
 * server row. With no server the device copy stands.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = '11111111-1111-4111-8111-111111111111';
const ENR1 = '33333333-3333-4333-8333-000000000001';
const ENR2 = '33333333-3333-4333-8333-000000000002';
const I1 = '77777777-7777-4777-8777-000000000001';
const I2 = '77777777-7777-4777-8777-000000000002';

describe('ReportIssues with the server', () => {
  var calls;
  var answers;
  var original;

  beforeEach(() => {
    localStorage.clear();
    calls = [];
    answers = {};
    original = {
      create: window.v2.createReportIssue,
      list: window.v2.listReportIssues,
      get: window.v2.getReportIssue,
      del: window.v2.deleteReportIssue,
    };
    window.v2.createReportIssue = p => {
      calls.push(['create', p]);
      return Promise.resolve({ data: answers.create || null, error: null });
    };
    window.v2.listReportIssues = cid => {
      calls.push(['list', cid]);
      return Promise.resolve({ data: answers.list === undefined ? null : answers.list, error: null });
    };
    window.v2.getReportIssue = id => {
      calls.push(['get', id]);
      return Promise.resolve({ data: answers.get || null, error: null });
    };
    window.v2.deleteReportIssue = id => {
      calls.push(['delete', id]);
      return Promise.resolve({ data: { id: id, deleted: true }, error: null });
    };
  });

  afterEach(() => {
    window.v2.createReportIssue = original.create;
    window.v2.listReportIssues = original.list;
    window.v2.getReportIssue = original.get;
    window.v2.deleteReportIssue = original.del;
  });

  const students = () => [
    { sid: ENR1, name: 'A', sheets: 2, html: '<p>a</p>' },
    { sid: ENR2, name: 'B', sheets: 1, html: '<p>b</p>' },
  ];

  it('issue sends the class, term number, paper, form and students, and records the server id', async () => {
    answers.create = { id: I1, issued_at: '2026-10-20T20:00:00Z', student_count: 2 };
    const form = ReportSheets.normalizeForm(undefined);
    const res = await ReportIssues.issue({
      cid: CID,
      termId: 'term-2',
      termLabel: 'Nov Report Card',
      paper: 'legal',
      form: form,
      students: students(),
    });
    expect(res.server).toBe(true);
    expect(res.stored).toBe(false);
    expect(calls[0][0]).toBe('create');
    expect(calls[0][1]).toMatchObject({
      courseId: CID,
      term: 2,
      termLabel: 'Nov Report Card',
      paper: 'legal',
      form: form,
    });
    expect(calls[0][1].students).toEqual([
      { enrollmentId: ENR1, sheets: 2, hash: ReportIssues.hash('<p>a</p>'), html: '<p>a</p>' },
      { enrollmentId: ENR2, sheets: 1, hash: ReportIssues.hash('<p>b</p>'), html: '<p>b</p>' },
    ]);
    const entry = ReportIssues.latest(CID, 'term-2');
    expect(entry.serverId).toBe(I1);
    expect(entry.issuedAt).toBe('2026-10-20T20:00:00Z');
    expect(res.entry.serverId).toBe(I1);
  });

  it('issue keeps the device copy when the server does not answer', async () => {
    answers.create = null;
    const res = await ReportIssues.issue({ cid: CID, termId: 'term-1', paper: 'letter', students: students() });
    expect(res.server).toBe(false);
    expect(ReportIssues.latest(CID, 'term-1').serverId).toBeUndefined();
    expect(ReportIssues.latest(CID, 'term-1').count).toBe(2);
  });

  it('a class without a server id never calls the server', async () => {
    await ReportIssues.issue({ cid: 'c-local', termId: 'term-1', paper: 'letter', students: students() });
    expect(calls).toEqual([]);
    expect(await ReportIssues.sync('c-local')).toBe(false);
  });

  it('sync merges the server list into the index, keeps an unsent issue and drops one deleted elsewhere', async () => {
    answers.create = { id: I1, issued_at: '2026-10-01T20:00:00Z', student_count: 2 };
    const sent = await ReportIssues.issue({ cid: CID, termId: 'term-1', paper: 'letter', students: students() });
    answers.create = null;
    const unsent = await ReportIssues.issue({ cid: CID, termId: 'term-1', paper: 'letter', students: students() });
    answers.list = [
      {
        id: I2,
        course_id: CID,
        term: 2,
        term_label: 'Nov Report Card',
        paper: 'legal',
        issued_at: '2026-10-15T20:00:00Z',
        student_count: 1,
        hashes: { [ENR1]: 'h1' },
      },
    ];
    expect(await ReportIssues.sync(CID)).toBe(true);
    // Newest first: the unsent issue was made just now, the server's in October.
    const ids = ReportIssues.list(CID).map(e => [e.id, e.serverId]);
    expect(ids).toEqual([
      [unsent.entry.id, undefined],
      [I2, I2],
    ]);
    expect(ReportIssues.list(CID).map(e => e.id)).not.toContain(sent.entry.id);
    const fromServer = ReportIssues.latest(CID, 'term-2');
    expect(fromServer).toMatchObject({
      termId: 'term-2',
      termLabel: 'Nov Report Card',
      paper: 'legal',
      count: 1,
      hashes: { [ENR1]: 'h1' },
    });
    expect(await ReportIssues.sync(CID)).toBe(false);
  });

  it('sync keeps the device index when there is no server', async () => {
    answers.create = null;
    await ReportIssues.issue({ cid: CID, termId: 'term-1', paper: 'letter', students: students() });
    answers.list = null;
    expect(await ReportIssues.sync(CID)).toBe(false);
    expect(ReportIssues.list(CID)).toHaveLength(1);
  });

  it('load fetches a copy the device does not hold from the server', async () => {
    answers.list = [
      {
        id: I2,
        course_id: CID,
        term: 1,
        paper: 'letter',
        issued_at: '2026-10-15T20:00:00Z',
        student_count: 1,
        hashes: {},
      },
    ];
    await ReportIssues.sync(CID);
    answers.get = { id: I2, students: [{ enrollment_id: ENR1, sheets: 2, hash: 'h', html: '<p>from server</p>' }] };
    const rec = await ReportIssues.load(I2, CID);
    expect(calls.filter(c => c[0] === 'get')).toEqual([['get', I2]]);
    expect(rec.students).toEqual([{ sid: ENR1, name: '', sheets: 2, html: '<p>from server</p>' }]);
    expect(rec.paper).toBe('letter');
    expect(await ReportIssues.load('nope', CID)).toBeNull();
  });

  it('remove deletes the server row when there is one', async () => {
    answers.create = { id: I1, issued_at: '2026-10-01T20:00:00Z', student_count: 2 };
    const sent = await ReportIssues.issue({ cid: CID, termId: 'term-1', paper: 'letter', students: students() });
    await ReportIssues.remove(CID, sent.entry.id);
    expect(ReportIssues.list(CID)).toEqual([]);
    expect(calls.filter(c => c[0] === 'delete')).toEqual([['delete', I1]]);
  });
});
