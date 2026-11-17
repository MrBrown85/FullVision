/**
 * Sticker codes (shared/data-scan-labels.js, B4). Signed in, the three calls
 * ask list_scan_labels, issue_scan_labels and reissue_scan_label, each write
 * with its own idempotency key, awaited and never queued. Offline, or with a
 * class or student whose id is still local-shaped, they ask nothing and say
 * why. Demo Mode answers the same shapes on the device.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { runInThisContext } from 'vm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { U, signIn, seedClass, clearClass } from './helpers/pin-save-paths.js';

runInThisContext(readFileSync(resolvePath(import.meta.dirname, '..', 'shared/data-scan-labels.js'), 'utf-8'), {
  filename: 'shared/data-scan-labels.js',
});

const CODE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{12}$/;

describe('sticker codes in Demo Mode', () => {
  const CID = 'c-demo-stickers';
  beforeEach(() => {
    localStorage.setItem('gb-demo-mode', '1');
    seedClass(CID, {
      students: [
        { id: 's1', firstName: 'Jas', lastName: 'Bains' },
        { id: 's2', firstName: 'Noor', lastName: 'Chen' },
      ],
    });
  });
  afterEach(() => {
    localStorage.removeItem('gb-demo-mode');
    localStorage.removeItem('gb-scan-labels-' + CID);
    clearClass(CID);
  });

  it('gives every student a code once, and the same codes again', async () => {
    const first = await issueScanLabels(CID);
    expect(first.refused).toBeNull();
    expect(first.data.labels.map(l => l.enrollment_id)).toEqual(['s1', 's2']);
    first.data.labels.forEach(l => expect(l.code).toMatch(CODE));
    expect(first.data.labels[0].code).not.toBe(first.data.labels[1].code);
    const again = await issueScanLabels(CID);
    expect(again.data).toEqual(first.data);
    // Kept with Demo Mode's other data, under a gb- key its reset wipes.
    expect(JSON.parse(localStorage.getItem('gb-scan-labels-' + CID))).toHaveLength(2);
  });

  it('a new code retires the old one, and the list shows both', async () => {
    const before = (await issueScanLabels(CID)).data.labels.find(l => l.enrollment_id === 's1').code;
    const res = await reissueScanLabel(CID, 's1');
    expect(res.data.label.enrollment_id).toBe('s1');
    expect(res.data.label.code).toMatch(CODE);
    expect(res.data.label.code).not.toBe(before);
    const list = (await listScanLabels(CID)).data.labels;
    expect(list.filter(l => l.enrollment_id === 's1')).toEqual([
      { enrollment_id: 's1', code: before, retired: true },
      { enrollment_id: 's1', code: res.data.label.code, retired: false },
    ]);
    // Issuing again keeps the new code.
    const live = (await issueScanLabels(CID)).data.labels.find(l => l.enrollment_id === 's1');
    expect(live.code).toBe(res.data.label.code);
  });

  it('a student not in the class gets no code', async () => {
    expect((await reissueScanLabel(CID, 'someone-else')).data).toEqual({ label: null });
  });

  it('a student who has left keeps their codes on the list but gets no live one handed out', async () => {
    await issueScanLabels(CID);
    seedClass(CID, { students: [{ id: 's2', firstName: 'Noor', lastName: 'Chen' }] });
    const issued = (await issueScanLabels(CID)).data.labels;
    expect(issued.map(l => l.enrollment_id)).toEqual(['s2']);
    expect((await listScanLabels(CID)).data.labels.map(l => l.enrollment_id)).toEqual(['s1', 's2']);
  });
});

describe('sticker codes signed in', () => {
  const CID = U(501);
  const S1 = U(511);
  let session;
  beforeEach(() => {
    session = signIn();
    seedClass(CID, { students: [{ id: S1, firstName: 'Jas', lastName: 'Bains' }] });
  });
  afterEach(() => {
    session.signOut();
    clearClass(CID);
    Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  });

  it('asks the three server calls, each write with its own key, and keeps only the contract’s fields', async () => {
    session.fake.on('list_scan_labels', () => ({
      data: {
        labels: [
          { enrollment_id: S1, code: 'AAAABBBBCCCC', retired: true, extra: 'dropped' },
          { enrollment_id: S1, code: 'DDDDEEEEFFFF', retired: false },
          { enrollment_id: S1, code: 'not a code', retired: false },
        ],
      },
      error: null,
    }));
    session.fake.on('issue_scan_labels', () => ({
      data: { labels: [{ enrollment_id: S1, code: 'DDDDEEEEFFFF' }] },
      error: null,
    }));
    session.fake.on('reissue_scan_label', () => ({
      data: { label: { enrollment_id: S1, code: 'GGGGHHHHJJJJ' } },
      error: null,
    }));

    const list = await listScanLabels(CID);
    expect(list.data.labels).toEqual([
      { enrollment_id: S1, code: 'AAAABBBBCCCC', retired: true },
      { enrollment_id: S1, code: 'DDDDEEEEFFFF', retired: false },
    ]);
    expect((await issueScanLabels(CID)).data.labels).toEqual([{ enrollment_id: S1, code: 'DDDDEEEEFFFF' }]);
    expect((await reissueScanLabel(CID, S1)).data.label).toEqual({ enrollment_id: S1, code: 'GGGGHHHHJJJJ' });
    expect(session.sent()).toEqual([
      ['list_scan_labels', { p_course_id: CID }],
      ['issue_scan_labels', { p_course_id: CID, p_idempotency_key: '<key>' }],
      ['reissue_scan_label', { p_enrollment_id: S1, p_idempotency_key: '<key>' }],
    ]);
    // Nothing waits in the outbox.
    expect(JSON.parse(localStorage.getItem('fv-sync-queue-v1') || '{"entries":[]}').entries).toEqual([]);
  });

  it('each press sends a key of its own, and a sign-in retry of one press sends the same key', async () => {
    const keys = [];
    session.fake.on('reissue_scan_label', p => {
      keys.push(p.p_idempotency_key);
      return { data: { label: { enrollment_id: S1, code: 'GGGGHHHHJJJJ' } }, error: null };
    });
    await reissueScanLabel(CID, S1);
    await reissueScanLabel(CID, S1);
    expect(keys).toHaveLength(2);
    keys.forEach(k => expect(k).toMatch(/^[0-9a-f-]{36}$/));
    expect(keys[0]).not.toBe(keys[1]);

    // The session ran out: the data layer refreshes the sign-in and sends the press again with its key.
    const sent = [];
    session.fake.on('issue_scan_labels', (p, n) => {
      sent.push(p.p_idempotency_key);
      return n === 1
        ? { data: null, error: { message: 'JWT expired', code: 'PGRST301', status: 401 } }
        : { data: { labels: [] }, error: null };
    });
    const was = globalThis.refreshSupabaseSession;
    globalThis.refreshSupabaseSession = async () => ({ session: {} });
    try {
      await issueScanLabels(CID);
    } finally {
      globalThis.refreshSupabaseSession = was;
    }
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
  });

  it('says when the student is not this teacher’s', async () => {
    session.fake.on('reissue_scan_label', () => ({ data: { label: null }, error: null }));
    expect((await reissueScanLabel(CID, S1)).data).toEqual({ label: null });
  });

  it('a failed call says so plainly and is not retried later', async () => {
    session.fake.on('issue_scan_labels', () => ({ data: null, error: { message: 'network: failed to fetch' } }));
    const res = await issueScanLabels(CID);
    expect(res.data).toBeNull();
    expect(res.refused).toBe(SCAN_LABEL_REFUSED.failed);
    expect(session.sent()).toHaveLength(1);
  });

  it('asks nothing offline', async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    for (const res of [await listScanLabels(CID), await issueScanLabels(CID), await reissueScanLabel(CID, S1)]) {
      expect(res).toEqual({ data: null, error: null, refused: SCAN_LABEL_REFUSED.offline });
    }
    expect(session.sent()).toEqual([]);
  });

  it('never sends a local-shaped class or student id', async () => {
    const local = 'c' + Date.now().toString(36);
    for (const res of [
      await listScanLabels(local),
      await issueScanLabels(local),
      await reissueScanLabel(CID, 'c' + (Date.now() + 1).toString(36)),
    ]) {
      expect(res).toEqual({ data: null, error: null, refused: SCAN_LABEL_REFUSED.saving });
    }
    expect(session.sent()).toEqual([]);
  });
});
