/**
 * A teacher's own wording for a competency's rubric levels
 * (shared/data.js, migrations/20261018_competency_descriptor.sql): kept per
 * teacher, offline-first, written through the outbox, never overwritten by
 * an older server copy while a save is still queued.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

describe('competency descriptors', () => {
  const saved = {};
  beforeEach(() => {
    localStorage.clear();
    _competencyDescriptors = null;
    _competencyDescriptorsLoad = null;
    _useSupabase = false;
    saved.writeRpc = globalThis._writeRpc;
    saved.rpcOrNoop = globalThis._rpcOrNoop;
    saved.getSupabase = globalThis.getSupabase;
  });
  afterEach(() => {
    globalThis._writeRpc = saved.writeRpc;
    globalThis._rpcOrNoop = saved.rpcOrNoop;
    globalThis.getSupabase = saved.getSupabase;
    _useSupabase = false;
  });

  it('keeps wording on this device when not signed in, and forgets an emptied level', async () => {
    await saveCompetencyDescriptors([
      { key: 'k1', level: 4, text: '  Mine  ' },
      { key: 'k1', level: 3, text: 'Also mine' },
      { key: '', level: 2, text: 'no key: ignored' },
      { key: 'k1', level: 7, text: 'bad level: ignored' },
    ]);
    expect(getCompetencyDescriptor('k1')).toEqual({ 4: 'Mine', 3: 'Also mine' });
    _competencyDescriptors = null; // a reload reads localStorage
    expect(getCompetencyDescriptor('k1')).toEqual({ 4: 'Mine', 3: 'Also mine' });
    await saveCompetencyDescriptors([{ key: 'k1', level: 4, text: '' }]);
    expect(getCompetencyDescriptor('k1')).toEqual({ 3: 'Also mine' });
    await saveCompetencyDescriptors([{ key: 'k1', level: 3, text: '' }]);
    expect(getCompetencyDescriptor('k1')).toBe(null);
  });

  it('sends only real changes when signed in', async () => {
    _useSupabase = true;
    const calls = [];
    globalThis._writeRpc = (name, params) => {
      calls.push([name, params]);
      return Promise.resolve({ data: 1, error: null });
    };
    await saveCompetencyDescriptors([{ key: 'k1', level: 4, text: 'Mine' }]);
    await saveCompetencyDescriptors([{ key: 'k1', level: 4, text: 'Mine' }]); // no change
    expect(calls).toEqual([['save_competency_descriptors', { p_entries: [{ key: 'k1', level: 4, text: 'Mine' }] }]]);
  });

  it('loads the server copy once, keeping a save that is still queued', async () => {
    _useSupabase = true;
    globalThis.getSupabase = () => ({});
    let reads = 0;
    globalThis._rpcOrNoop = name => {
      reads++;
      expect(name).toBe('list_competency_descriptors');
      return Promise.resolve({
        data: [
          { competency_key: 'k1', level: 4, text: 'Old server text' },
          { competency_key: 'k2', level: 1, text: 'Server only' },
        ],
        error: null,
      });
    };
    localStorage.setItem(
      'fv-sync-queue-v1',
      JSON.stringify({
        entries: [
          {
            endpoint: 'save_competency_descriptors',
            payload: { p_entries: [{ key: 'k1', level: 4, text: 'Newer, not sent yet' }] },
          },
        ],
      }),
    );
    const bank = await loadCompetencyDescriptors();
    await loadCompetencyDescriptors();
    expect(reads).toBe(1);
    expect(bank).toEqual({ k1: { 4: 'Newer, not sent yet' }, k2: { 1: 'Server only' } });
    expect(JSON.parse(localStorage.getItem('gb-competency-descriptors'))).toEqual(bank);
  });

  it('keeps the stored copy and retries later when the load fails', async () => {
    _useSupabase = true;
    globalThis.getSupabase = () => ({});
    localStorage.setItem('gb-competency-descriptors', JSON.stringify({ k1: { 2: 'Stored' } }));
    globalThis._rpcOrNoop = () => Promise.resolve({ data: null, error: { message: 'offline' } });
    expect(await loadCompetencyDescriptors()).toEqual({ k1: { 2: 'Stored' } });
    expect(_competencyDescriptorsLoad).toBe(null);
  });
});
