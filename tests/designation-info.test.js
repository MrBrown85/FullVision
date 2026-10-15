/**
 * Support flags — constants.js :: designationInfo(), SUPPORT_FLAGS
 */

describe('designationInfo', () => {
  it('returns BC designations', () => {
    expect(designationInfo('G').name).toBe('Autism Spectrum Disorder');
  });

  it('returns ELL as a support flag that is neither IEP nor Modified', () => {
    const d = designationInfo('ELL');
    expect(d.name).toBe('English Language Learner');
    expect(d.iep).toBe(false);
    expect(d.modified).toBe(false);
  });

  it('keeps ELL out of the BC designation list', () => {
    expect(BC_DESIGNATIONS.ELL).toBeUndefined();
  });

  it('returns null for unknown codes', () => {
    expect(designationInfo('ZZ')).toBeNull();
  });
});
