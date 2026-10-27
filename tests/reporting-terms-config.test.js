/**
 * Reporting terms live on the course row (migrations/20261017_course_reporting_terms.sql)
 * and travel in the course config like the grading scale: saveReportingTerms
 * sends them through update_course, get_class_bundle brings them back, and
 * the rules the server's check constraint enforces are checked here first.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'e0000000-0000-4000-8000-00000000007e';

const QUARTERS = [
  { ordinal: 1, label: 'Term 1', starts_on: '2026-09-01', ends_on: '2026-11-15' },
  { ordinal: 2, label: 'Term 2', starts_on: '2026-11-16', ends_on: '2027-01-31' },
];

function fakeServer() {
  var server = { patches: [] };
  server.client = function () {
    return {
      rpc(name, payload) {
        if (name === 'update_course') {
          server.patches.push(payload.p_patch);
          return Promise.resolve({ data: null, error: null });
        }
        return Promise.resolve({ data: null, error: null });
      },
    };
  };
  return server;
}

describe('reportingTermsError', () => {
  it('accepts an empty list and a valid list', () => {
    expect(reportingTermsError([])).toBeNull();
    expect(reportingTermsError(QUARTERS)).toBeNull();
  });
  it('names the problem in plain words', () => {
    expect(reportingTermsError(QUARTERS.concat([{}, {}, {}, {}, {}]))).toMatch(/up to 6/);
    expect(reportingTermsError([{ ordinal: 0, label: 'x', starts_on: '2026-09-01', ends_on: '2026-09-02' }])).toMatch(
      /1 to 6/,
    );
    expect(reportingTermsError([QUARTERS[0], Object.assign({}, QUARTERS[1], { ordinal: 1 })])).toMatch(/same number/);
    expect(reportingTermsError([{ ordinal: 1, label: ' ', starts_on: '2026-09-01', ends_on: '2026-09-02' }])).toMatch(
      /needs a name/,
    );
    expect(reportingTermsError([{ ordinal: 1, label: 'T', starts_on: '2026-09-01', ends_on: '' }])).toMatch(/end date/);
    expect(reportingTermsError([{ ordinal: 1, label: 'T', starts_on: '2026-09-09', ends_on: '2026-09-01' }])).toMatch(
      /ends before it starts/,
    );
    expect(
      reportingTermsError([
        QUARTERS[0],
        { ordinal: 2, label: 'Term 2', starts_on: '2026-11-15', ends_on: '2027-01-31' },
      ]),
    ).toMatch(/overlap/);
  });
});

describe('saveReportingTerms', () => {
  var server;
  var originals;
  beforeEach(() => {
    localStorage.clear();
    server = fakeServer();
    originals = { getSupabase: globalThis.getSupabase, isDemoMode: globalThis.isDemoMode };
    globalThis.getSupabase = server.client;
    globalThis.isDemoMode = () => false;
    _useSupabase = true;
    saveCourses({ [CID]: { id: CID, name: 'Math 9', gradingSystem: 'proficiency', calcMethod: 'mean' } });
    _cache.courseConfigs[CID] = {};
    setActiveTerm(CID, null);
  });
  afterEach(() => {
    _useSupabase = false;
    globalThis.getSupabase = originals.getSupabase;
    globalThis.isDemoMode = originals.isDemoMode;
    setActiveTerm(CID, null);
  });

  it('numbers terms by start date and sends them as reporting_terms', async () => {
    var err = saveReportingTerms(CID, [
      { ordinal: 1, label: 'Later', starts_on: '2027-02-01', ends_on: '2027-06-30' },
      { ordinal: 2, label: 'Earlier ', starts_on: '2026-09-01', ends_on: '2027-01-31' },
    ]);
    expect(err).toBeNull();
    var terms = getReportingTerms(CID);
    expect(terms.map(t => [t.ordinal, t.label])).toEqual([
      [1, 'Earlier'],
      [2, 'Later'],
    ]);
    await new Promise(r => setTimeout(r, 10));
    expect(server.patches).toHaveLength(1);
    expect(server.patches[0].reporting_terms).toEqual(terms);
  });

  it('refuses an invalid list and saves nothing', async () => {
    var err = saveReportingTerms(CID, [{ ordinal: 1, label: 'T', starts_on: '2026-09-09', ends_on: '2026-09-01' }]);
    expect(err).toMatch(/ends before it starts/);
    expect(getReportingTerms(CID)).toEqual([]);
    await new Promise(r => setTimeout(r, 10));
    expect(server.patches).toHaveLength(0);
  });

  it('drops a chosen term that no longer exists', () => {
    expect(saveReportingTerms(CID, QUARTERS)).toBeNull();
    setSelectedTermOrdinal(CID, 2);
    expect(getActiveTerm(CID).ordinal).toBe(2);
    expect(saveReportingTerms(CID, [QUARTERS[0]])).toBeNull();
    expect(getSelectedTermOrdinal(CID)).toBeNull();
  });

  it('finds the term containing a date', () => {
    saveReportingTerms(CID, QUARTERS);
    expect(reportingTermOn(CID, '2026-12-25').ordinal).toBe(2);
    expect(reportingTermOn(CID, '2027-05-01')).toBeNull();
  });
});

describe('the bundle brings reporting terms back', () => {
  beforeEach(() => {
    localStorage.clear();
    _cache.courseConfigs[CID] = {};
  });

  it('hydrates reportingTerms from the course_config section', () => {
    _applyBundleCourseConfig(CID, { grading_scale: null, category_weights: null, reporting_terms: QUARTERS }, {});
    expect(getReportingTerms(CID)).toEqual(QUARTERS);
  });

  // The live get_class_bundle's course_config has only the scale and the
  // weights; the terms come on gradebook.course. After a sign-out wiped this
  // device, a class came back with no terms.
  it('hydrates reportingTerms from the course row when course_config leaves them out', () => {
    _applyBundleCourseConfig(
      CID,
      { grading_scale: null, category_weights: null },
      { id: CID, name: 'Humanities 8', reporting_terms: QUARTERS },
    );
    expect(getReportingTerms(CID)).toEqual(QUARTERS);
  });

  it('keeps no terms when the course row has none', () => {
    _applyBundleCourseConfig(CID, { grading_scale: null, category_weights: null }, { id: CID, reporting_terms: null });
    expect(getReportingTerms(CID)).toEqual([]);
  });
});
