/**
 * Tag resolution and custom tag tests — gb-data.js
 */

const CID = 'test';

beforeEach(() => {
  _cache.customTags[CID] = undefined;
  localStorage.clear();
});

describe('resolveTag', () => {
  it('resolves core competency with cc: prefix', () => {
    const result = resolveTag('cc:COM');
    expect(result.type).toBe('cc');
    expect(result.label).toBe('Communicating');
    expect(result.group).toBe('Communication');
  });

  it('handles unknown core competency gracefully', () => {
    const result = resolveTag('cc:UNKNOWN');
    expect(result.type).toBe('cc');
    expect(result.label).toBe('UNKNOWN');
  });

  it('resolves custom tag with tag: prefix', () => {
    const result = resolveTag('tag:Homework');
    expect(result.type).toBe('custom');
    expect(result.label).toBe('Homework');
    expect(result.group).toBe('Custom');
  });

  it('resolves observation dimension by key', () => {
    const result = resolveTag('engagement');
    expect(result.type).toBe('dim');
    expect(result.label).toBe('Engagement');
  });

  it('returns unknown for unrecognized tag', () => {
    const result = resolveTag('foobar');
    expect(result.type).toBe('unknown');
    expect(result.label).toBe('foobar');
  });
});

describe('addCustomTag', () => {
  it('adds a new tag', () => {
    saveCustomTags(CID, []);
    addCustomTag(CID, 'Homework');
    expect(getCustomTags(CID)).toContain('Homework');
  });

  it('trims whitespace', () => {
    saveCustomTags(CID, []);
    const result = addCustomTag(CID, '  Homework  ');
    expect(result).toBe('Homework');
    expect(getCustomTags(CID)).toContain('Homework');
  });

  it('rejects duplicates', () => {
    saveCustomTags(CID, ['Homework']);
    addCustomTag(CID, 'Homework');
    expect(getCustomTags(CID).filter(t => t === 'Homework')).toHaveLength(1);
  });

  it('sorts alphabetically after adding', () => {
    saveCustomTags(CID, ['Zzz']);
    addCustomTag(CID, 'Aaa');
    const tags = getCustomTags(CID);
    expect(tags[0]).toBe('Aaa');
    expect(tags[1]).toBe('Zzz');
  });
});

describe('removeCustomTag', () => {
  it('removes existing tag', () => {
    saveCustomTags(CID, ['Homework', 'Participation']);
    removeCustomTag(CID, 'Homework');
    expect(getCustomTags(CID)).toEqual(['Participation']);
  });

  it('no-op for non-existent tag', () => {
    saveCustomTags(CID, ['Homework']);
    removeCustomTag(CID, 'Nonexistent');
    expect(getCustomTags(CID)).toEqual(['Homework']);
  });
});
