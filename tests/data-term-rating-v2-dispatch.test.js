/**
 * v2 term-rating dispatch test — shared/data.js (Phase 4.7)
 *
 * Covers window.v2.saveTermRating camelCase → snake_case payload translation
 * for save_term_rating. Omitted keys must NOT appear in the wire payload so
 * the server leaves fields / sets alone. Empty [] for a set wipes it.
 */
import './setup.js';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';

const ENR = '11111111-1111-1111-1111-111111111111';
const SEC = '22222222-2222-2222-2222-222222222222';
const TAG1 = '33333333-3333-3333-3333-333333333333';
const TAG2 = '44444444-4444-4444-4444-444444444444';
const AID = '55555555-5555-5555-5555-555555555555';
const OB = '66666666-6666-4666-8666-666666666666';

function makeRecordingClient() {
  var calls = [];
  return {
    calls: calls,
    rpc(name, payload) {
      calls.push({ name: name, payload: payload || {} });
      return Promise.resolve({ data: null, error: null });
    },
  };
}

describe('v2 saveTermRating', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    client = makeRecordingClient();
    globalThis.getSupabase = () => client;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  it('translates full camelCase payload to snake_case wire payload', async () => {
    await window.v2.saveTermRating(ENR, 2, {
      narrativeHtml: '<p>Great</p>',
      workHabitsRating: 4,
      participationRating: 3,
      socialTraits: ['kind', 'curious'],
      dimensions: [
        { sectionId: SEC, rating: 4 },
        { sectionId: SEC, rating: '3' }, // coerce
      ],
      strengthTagIds: [TAG1, 'junk'],
      growthTagIds: [TAG2],
      mentionAssessmentIds: [AID],
      mentionObservationIds: [OB],
    });
    var call = client.calls.find(function (c) { return c.name === 'save_term_rating'; });
    expect(call.payload.p_enrollment_id).toBe(ENR);
    expect(call.payload.p_term).toBe(2);
    expect(call.payload.p_payload).toEqual({
      narrative_html: '<p>Great</p>',
      work_habits_rating: 4,
      participation_rating: 3,
      social_traits: ['kind', 'curious'],
      dimensions: [
        { section_id: SEC, rating: 4 },
        { section_id: SEC, rating: 3 },
      ],
      strength_tags: [TAG1],
      growth_tags: [TAG2],
      mention_assessments: [AID],
      mention_observations: [OB],
    });
  });

  it('omits keys that are not in the input payload (partial update)', async () => {
    await window.v2.saveTermRating(ENR, 1, { narrativeHtml: 'x' });
    var call = client.calls.find(function (c) { return c.name === 'save_term_rating'; });
    expect(Object.keys(call.payload.p_payload)).toEqual(['narrative_html']);
  });

  it('preserves empty arrays (wipe signal) when explicitly passed', async () => {
    await window.v2.saveTermRating(ENR, 1, {
      strengthTagIds: [],
      growthTagIds: [],
      mentionAssessmentIds: [],
      mentionObservationIds: [],
    });
    var call = client.calls.find(function (c) { return c.name === 'save_term_rating'; });
    expect(call.payload.p_payload.strength_tags).toEqual([]);
    expect(call.payload.p_payload.growth_tags).toEqual([]);
    expect(call.payload.p_payload.mention_assessments).toEqual([]);
    expect(call.payload.p_payload.mention_observations).toEqual([]);
  });

  it('coerces term to Number', async () => {
    await window.v2.saveTermRating(ENR, '3', {});
    var call = client.calls.find(function (c) { return c.name === 'save_term_rating'; });
    expect(call.payload.p_term).toBe(3);
  });

  it('defaults socialTraits to [] when the key is present but value is falsy', async () => {
    await window.v2.saveTermRating(ENR, 1, { socialTraits: null });
    var call = client.calls.find(function (c) { return c.name === 'save_term_rating'; });
    expect(call.payload.p_payload.social_traits).toEqual([]);
  });
});
