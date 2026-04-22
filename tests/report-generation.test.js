/**
 * Report-specific data-layer tests — shared/data.js
 *
 * Pins the two contracts the report generator uniquely depends on:
 * saveReportConfig/getReportConfig shape, and the reportAsPercentage
 * course-config toggle. Proficiency/trend functions are covered in
 * calc-integration.test.js and calc-advanced.test.js.
 */

const CID = 'rpttest';

beforeEach(() => {
  localStorage.clear();
  _cache.reportConfig[CID] = undefined;
  _cache.courseConfigs[CID] = undefined;
});

describe('report config persistence', () => {
  it('saveReportConfig stores and getReportConfig retrieves blocks + preset', () => {
    const config = {
      preset: 'standard',
      blocks: [
        { id: 'header', label: 'Header', enabled: true, locked: true },
        { id: 'academic-summary', label: 'Academic Summary', enabled: true, locked: false },
      ],
    };
    saveReportConfig(CID, config);
    const loaded = getReportConfig(CID);
    expect(loaded.preset).toBe('standard');
    expect(loaded.blocks).toHaveLength(2);
    expect(loaded.blocks[0].id).toBe('header');
  });

  it('getReportConfig returns null for an unconfigured course', () => {
    expect(getReportConfig(CID)).toBeNull();
  });
});

describe('course config reportAsPercentage toggle', () => {
  it('roundtrips the reportAsPercentage flag alongside calcMethod', () => {
    saveCourseConfig(CID, { reportAsPercentage: true, calcMethod: 'mostRecent' });
    const cc = getCourseConfig(CID);
    expect(cc.reportAsPercentage).toBe(true);
    expect(cc.calcMethod).toBe('mostRecent');
  });
});
