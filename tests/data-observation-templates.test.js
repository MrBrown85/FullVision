/**
 * Sentence starters (observation_template) in shared/data.js.
 *
 * getObservationTemplates / saveObservationTemplates and the helpers My
 * Sentence Starters calls: one list per teacher, whatever class is open
 * (migrations/20261022_teacher_sentence_starters.sql). A new starter is
 * created through the outbox with a local id and re-keyed to the server's;
 * an edit, a reorder and a delete each send only what changed; writes made
 * offline wait in the outbox; Demo Mode stays local; the lists classes kept
 * before fold into one; the menus sort by Times Used.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
  filename: 'shared/offline-queue.js',
});

const CID = '11111111-1111-4111-8111-111111111111';
const CID2 = '11111111-1111-4111-8111-222222222222';
const T1 = '88888888-8888-4888-8888-000000000001';
const T2 = '88888888-8888-4888-8888-000000000002';

// Starters are the teacher's: any class's cid reads and writes one list.
function seed(cid, rows) {
  _cache.observationTemplates.teacher = rows;
  localStorage.setItem('gb-obs-templates-teacher', JSON.stringify(rows));
  _rememberServerState('observationTemplates', 'teacher', rows);
}

const QUESTION = { text: 'Asked a great question', sentiment: 'strength', context: null, dims: ['curiosity'] };

describe('sentence starters data', () => {
  var fake;
  var online;
  var originalGetSupabase;
  var originalUseSupabase;

  beforeEach(() => {
    localStorage.clear();
    Object.keys(_cache).forEach(function (field) {
      if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config') {
        _cache[field] = {};
      }
    });
    _templateSaveQueue = {};
    _serverState = {};
    _idRekeys = {};
    _idmapCache = null;
    _idmapRaw = null;
    fake = makeFakeSupabase();
    originalGetSupabase = globalThis.getSupabase;
    originalUseSupabase = _useSupabase;
    globalThis.getSupabase = () => fake;
    _useSupabase = true;
    _supabaseDegraded = false;
    _teacherId = 'teacher-uuid';
    online = true;
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online });
    window.v2Queue.clear();
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
    online = true;
    window.v2Queue.clear();
  });

  it('creates a starter with its tags and re-keys it to the server id', async () => {
    seed(CID, []);
    var row = addObservationTemplate(CID, QUESTION);
    expect(row.id).toMatch(/^ot/);
    expect(getObservationTemplates(CID)).toEqual([Object.assign({ id: row.id, uses: 0 }, QUESTION)]);
    await settle();

    var calls = fake.committed.filter(c => c.name === 'upsert_observation_template');
    expect(calls).toHaveLength(1);
    expect(calls[0].params).toMatchObject({
      p_id: null,
      p_course_id: null,
      p_body: 'Asked a great question',
      p_default_sentiment: 'strength',
      p_default_context_type: null,
      p_default_dims: ['curiosity'],
      p_display_order: 0,
    });
    expect(_isUuid(calls[0].params.p_idempotency_key)).toBe(true);
    var id = getObservationTemplates(CID)[0].id;
    expect(_isUuid(id)).toBe(true);
    expect(JSON.parse(localStorage.getItem('gb-obs-templates-teacher'))[0].id).toBe(id);
    expect(resolveObservationTemplateId(CID, row.id)).toBe(id);
  });

  it('an edit made before the create lands updates that row instead of adding another', async () => {
    seed(CID, []);
    fake.hold();
    var row = addObservationTemplate(CID, QUESTION);
    await settle();
    updateObservationTemplate(CID, row.id, { text: 'Asked a sharp question', dims: ['curiosity', 'cc:3'] });
    await settle();
    await fake.release();
    await settle();
    await fake.release();
    await settle();

    var calls = fake.committed.filter(c => c.name === 'upsert_observation_template');
    var inserts = calls.filter(c => c.params.p_id === null);
    expect(inserts).toHaveLength(1);
    var id = getObservationTemplates(CID)[0].id;
    expect(_isUuid(id)).toBe(true);
    expect(calls[calls.length - 1].params).toMatchObject({
      p_id: id,
      p_body: 'Asked a sharp question',
      p_default_dims: ['curiosity', 'cc:3'],
    });
  });

  it('a reorder sends the two rows that moved, and nothing else changes', async () => {
    var a = { id: T1, text: 'First', sentiment: null, context: null, dims: [] };
    var b = { id: T2, text: 'Second', sentiment: 'growth', context: 'independent', dims: ['engagement'] };
    seed(CID, [a, b]);
    moveObservationTemplate(CID, T2, -1);
    await settle();
    expect(getObservationTemplates(CID).map(t => t.id)).toEqual([T2, T1]);
    var calls = fake.committed.filter(c => c.name === 'upsert_observation_template');
    expect(calls.map(c => [c.params.p_id, c.params.p_display_order])).toEqual([
      [T2, 0],
      [T1, 1],
    ]);
    expect(calls[0].params.p_default_dims).toEqual(['engagement']);

    // Saving the same list again sends nothing.
    fake.committed.length = 0;
    saveObservationTemplates(CID, getObservationTemplates(CID));
    await settle();
    expect(fake.committed).toHaveLength(0);
    // The ends do not move.
    expect(moveObservationTemplate(CID, T2, -1)).toBe(false);
  });

  it('deletes a saved starter on the server; one removed before it was sent never goes', async () => {
    seed(CID, [{ id: T1, text: 'First', sentiment: null, context: null, dims: [] }]);
    removeObservationTemplate(CID, T1);
    await settle();
    expect(fake.committed.filter(c => c.name === 'delete_observation_template').map(c => c.params)).toEqual([
      { p_id: T1 },
    ]);
    expect(getObservationTemplates(CID)).toEqual([]);

    // Added and removed before the save ran: nothing reaches the server and
    // the local id is forgotten.
    fake.committed.length = 0;
    var row = addObservationTemplate(CID, QUESTION);
    removeObservationTemplate(CID, row.id);
    await settle();
    expect(fake.committed).toHaveLength(0);
    expect(window.v2Queue.stats().queued).toBe(0);
    expect(_isPendingLocalId(row.id)).toBe(false);
    expect(getObservationTemplates(CID)).toEqual([]);
  });

  it('a delete queued behind its create goes out with the server id', async () => {
    seed(CID, []);
    fake.hold();
    var row = addObservationTemplate(CID, QUESTION);
    await settle();
    removeObservationTemplate(CID, row.id);
    await settle();
    await fake.release();
    await settle();
    await fake.release();
    await settle();
    var created = fake.committed.find(c => c.name === 'upsert_observation_template');
    var del = fake.committed.find(c => c.name === 'delete_observation_template');
    expect(created).toBeTruthy();
    expect(del).toBeTruthy();
    expect(_isUuid(del.params.p_id)).toBe(true);
  });

  it('writes made offline wait in the outbox and go out when back online', async () => {
    seed(CID, []);
    online = false;
    var row = addObservationTemplate(CID, QUESTION);
    await settle();
    expect(fake.committed).toHaveLength(0);
    expect(window.v2Queue.stats().queued).toBe(1);
    expect(getObservationTemplates(CID)[0].id).toBe(row.id);

    online = true;
    await window.v2Queue.flush();
    await settle();
    expect(fake.committed.filter(c => c.name === 'upsert_observation_template')).toHaveLength(1);
    expect(_isUuid(getObservationTemplates(CID)[0].id)).toBe(true);
  });

  it('Demo Mode keeps starters on this device and calls nothing', async () => {
    localStorage.setItem('gb-demo-mode', '1');
    seed('sci8', []);
    addObservationTemplate('sci8', QUESTION);
    await settle();
    expect(fake.calls).toHaveLength(0);
    expect(getObservationTemplates('sci8')[0].text).toBe('Asked a great question');
  });

  it('is one list in every class, without custom tags', async () => {
    seed(CID, []);
    addObservationTemplate(CID, { text: 'Kept the lab tidy', dims: ['respect', 'tag:Lab safety'] });
    expect(getObservationTemplates(CID2).map(t => t.text)).toEqual(['Kept the lab tidy']);
    expect(getObservationTemplates(CID2)[0].dims).toEqual(['respect']);
  });

  it('folds the lists classes kept before into one, one row per wording', () => {
    localStorage.setItem(
      'gb-obs-templates-' + CID,
      JSON.stringify([
        { id: T1, text: 'First', sentiment: 'growth', context: null, dims: ['respect', 'tag:Lab safety'] },
        { id: T2, text: 'Second', sentiment: null, context: null, dims: [] },
      ]),
    );
    localStorage.setItem(
      'gb-obs-templates-' + CID2,
      JSON.stringify([{ id: 'x', text: ' first ', sentiment: null, context: null, dims: [] }]),
    );
    var list = getObservationTemplates();
    expect(list.map(t => t.id)).toEqual([T1, T2]);
    expect(list[0].dims).toEqual(['respect']);
    expect(JSON.parse(localStorage.getItem('gb-obs-templates-teacher'))).toHaveLength(2);
  });

  it('counts a use and lists the most used first, then in list order', () => {
    var a = { id: T1, text: 'First', sentiment: null, context: null, dims: [], uses: 1 };
    var b = { id: T2, text: 'Second', sentiment: null, context: null, dims: [], uses: 1 };
    seed(CID, [a, b]);
    expect(getObservationTemplatesByUse().map(t => t.id)).toEqual([T1, T2]);
    noteObservationTemplateUse(T2);
    expect(getObservationTemplates()[1].uses).toBe(2);
    expect(getObservationTemplatesByUse().map(t => t.id)).toEqual([T2, T1]);
    // A count is not an edit: nothing is sent.
    saveObservationTemplates(CID, getObservationTemplates());
    return settle().then(() => {
      expect(fake.committed.filter(c => c.name === 'upsert_observation_template')).toHaveLength(0);
    });
  });

  it('cleans what it stores: unknown types dropped, tags deduped, empty text skipped', () => {
    seed(CID, []);
    var added = addObservationTemplates(CID, [
      { text: '  Spaced  ', sentiment: 'great', dims: ['a', 'a', '', 'b'] },
      { text: '   ' },
    ]);
    expect(added).toHaveLength(1);
    expect(getObservationTemplates(CID)[0]).toMatchObject({ text: 'Spaced', sentiment: null, dims: ['a', 'b'] });
  });
});
