/**
 * Term rating tests — gb-data.js
 */

const CID = 'test';

beforeEach(() => {
  _cache.termRatings[CID] = undefined;
  localStorage.clear();
});

describe('getStudentTermRating', () => {
  it('returns rating when it exists', () => {
    saveTermRatings(CID, {
      stu1: { term1: { dims: { engagement: 3 }, narrative: 'Good work' } },
    });
    const result = getStudentTermRating(CID, 'stu1', 'term1');
    expect(result.narrative).toBe('Good work');
    expect(result.dims.engagement).toBe(3);
  });

  it('returns null when student has no ratings', () => {
    saveTermRatings(CID, {});
    expect(getStudentTermRating(CID, 'stu1', 'term1')).toBeNull();
  });

  it('returns null when term not found', () => {
    saveTermRatings(CID, { stu1: { term1: { narrative: 'x' } } });
    expect(getStudentTermRating(CID, 'stu1', 'term2')).toBeNull();
  });
});

describe('upsertTermRating', () => {
  it('creates new rating with default dims', () => {
    saveTermRatings(CID, {});
    upsertTermRating(CID, 'stu1', 'term1', { narrative: 'First report' });
    const result = getStudentTermRating(CID, 'stu1', 'term1');
    expect(result.narrative).toBe('First report');
    expect(result.dims.engagement).toBe(0);
    expect(result.dims.collaboration).toBe(0);
    expect(result.created).toBeDefined();
    expect(result.modified).toBeDefined();
  });

  it('merges data into existing rating', () => {
    saveTermRatings(CID, {
      stu1: { term1: { dims: { engagement: 2 }, narrative: 'Old', created: '2025-01-01', modified: '2025-01-01' } },
    });
    upsertTermRating(CID, 'stu1', 'term1', { narrative: 'Updated' });
    const result = getStudentTermRating(CID, 'stu1', 'term1');
    expect(result.narrative).toBe('Updated');
    expect(result.dims.engagement).toBe(2); // preserved
  });

  it('sets modified timestamp on update', () => {
    saveTermRatings(CID, {
      stu1: { term1: { dims: {}, narrative: '', created: '2025-01-01T00:00:00Z', modified: '2025-01-01T00:00:00Z' } },
    });
    upsertTermRating(CID, 'stu1', 'term1', { narrative: 'New' });
    const result = getStudentTermRating(CID, 'stu1', 'term1');
    expect(result.modified).not.toBe('2025-01-01T00:00:00Z');
  });

  it('preserves existing dims when updating only narrative', () => {
    saveTermRatings(CID, {});
    upsertTermRating(CID, 'stu1', 'term1', { dims: { engagement: 4, collaboration: 3 } });
    upsertTermRating(CID, 'stu1', 'term1', { narrative: 'Added narrative' });
    const result = getStudentTermRating(CID, 'stu1', 'term1');
    expect(result.dims.engagement).toBe(4);
    expect(result.narrative).toBe('Added narrative');
  });
});
