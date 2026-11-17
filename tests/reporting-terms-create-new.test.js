/**
 * Class Settings > Reporting Terms > Create New (docs/DECISIONS.md, "Your own
 * reporting dates"): a teacher's own terms start from a copy of the class's
 * dates, the row with a problem says so, saved reports stay with their
 * number, and other classes reuse the dates through Your Classes and Also
 * Use In. Demo Mode: nothing reaches a server.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const A = 'course-terms-a';
const B = 'course-terms-b';
const GRANDVIEW = () => reportingTermPreset('grandviewheights', '2026-11-03');

describe('Create New reporting terms', () => {
  var originals;
  const act = (action, dataset) => DashClassManager.handleAction(action, { dataset: dataset || {} });
  const type = (idx, field, value) =>
    DashClassManager.handleInput({
      dataset: { actionInput: 'cmTermLive', idx: String(idx), field: field },
      value: String(value),
    });
  const pick = value => DashClassManager.handleChange({ dataset: { actionChange: 'cmTermSchool' }, value: value });
  const draft = () => DashClassManager.reportingTermsDraft(A);
  const html = () => CmTerms._cmRenderReportingTermsField(A);

  beforeEach(async () => {
    localStorage.clear();
    localStorage.setItem('gb-demo-mode', '1');
    originals = {
      getSupabase: globalThis.getSupabase,
      isDemoMode: globalThis.isDemoMode,
      today: globalThis.courseToday,
    };
    globalThis.isDemoMode = () => true;
    globalThis.getSupabase = () => null;
    globalThis.courseToday = () => '2026-11-17';
    saveCourses({
      [A]: { id: A, name: 'Science 8', block: 'A', gradingSystem: 'proficiency', calcMethod: 'mean' },
      [B]: { id: B, name: 'Science 8', block: 'B', gradingSystem: 'proficiency', calcMethod: 'mean' },
    });
    [A, B].forEach(c => {
      _cache.assessments[c] = [];
      _cache.courseConfigs[c] = {};
    });
    saveReportingTerms(A, GRANDVIEW());
    CmTerms.reset();
    DashClassManager.resetState();
    DashClassManager.configure({ activeCourse: A, onRender() {}, onCourseChange() {} });
    DashClassManager.openClassManager();
    await new Promise(r => setTimeout(r, 20));
  });

  afterEach(() => {
    globalThis.getSupabase = originals.getSupabase;
    globalThis.isDemoMode = originals.isDemoMode;
    globalThis.courseToday = originals.today;
    CmTerms.reset();
    DashClassManager.resetState();
  });

  it('shows Create New beside the school menu, which reads Dates From', () => {
    var h = html();
    expect(h).toContain('data-action="cmTermNew"');
    expect(h).toContain('Create New');
    expect(h).toContain('>Dates From<');
    expect(h).toContain('<option value="grandviewheights" selected>');
  });

  it('starts from a copy of the class’s dates, and Save stays off until something changes', () => {
    act('cmTermNew');
    expect(draft().rows.map(r => r.ends_on)).toEqual(GRANDVIEW().map(t => t.ends_on));
    expect(draft().dirty).toBe(false);
    var h = html();
    expect(h).toContain('Your Own Dates');
    expect(h).toContain('This Class’s Dates');
    expect(h).toMatch(/id="cm-term-save-course-terms-a" data-action="cmTermSave" disabled/);
    // No school to pick in Your Own Dates.
    expect(h).not.toContain('cm-term-school-select');
  });

  it('saves the teacher’s own dates, and the tiles then read Your Own Dates', async () => {
    act('cmTermNew');
    type(0, 'ends_on', '2026-11-20');
    type(1, 'starts_on', '2026-11-21');
    type(0, 'label', 'Fall Report');
    expect(draft().error).toBeNull();
    act('cmTermSave');
    await new Promise(r => setTimeout(r, 10));
    var saved = getReportingTerms(A);
    expect(saved[0]).toMatchObject({ ordinal: 1, label: 'Fall Report', ends_on: '2026-11-20' });
    expect(saved.map(t => t.ordinal)).toEqual([1, 2, 3, 4]);
    var h = html();
    expect(h).toContain('cm-term-tiles');
    expect(h).toContain('<option value="own" selected>Your Own Dates</option>');
    // Edit Dates opens Your Own Dates again.
    act('cmTermEdit');
    expect(html()).toContain('Your Own Dates');
  });

  it('Start With fills 4 Terms, 2 Semesters or one blank term', () => {
    act('cmTermNew');
    act('cmTermPreset', { value: 'quarters' });
    expect(draft().rows).toHaveLength(4);
    expect(draft().rows[0].starts_on).toBe('2026-09-01');
    act('cmTermPreset', { value: 'semesters' });
    expect(draft().rows.map(r => r.ends_on)).toEqual(['2027-01-31', '2027-06-30']);
    act('cmTermPreset', { value: 'blank' });
    expect(draft().rows).toEqual([{ label: 'Term 1', starts_on: '', ends_on: '' }]);
    expect(draft().error).toMatch(/start date/);
    act('cmTermPreset', { value: 'current' });
    expect(draft().rows).toHaveLength(4);
    expect(draft().dirty).toBe(false);
  });

  it('a class with no terms makes its own without picking a school', async () => {
    saveReportingTerms(A, []);
    CmTerms.reset();
    var h = html();
    expect(h).toContain('Create New');
    expect(h).not.toContain('This Class’s Dates');
    act('cmTermNew');
    expect(draft().rows).toHaveLength(4);
    expect(draft().dirty).toBe(true);
    act('cmTermSave');
    await new Promise(r => setTimeout(r, 10));
    expect(getReportingTerms(A)).toHaveLength(4);
  });

  it('marks the row with the problem: an overlap names the later term’s start', () => {
    var rows = [
      { label: 'Term 1', starts_on: '2026-09-08', ends_on: '2026-11-20' },
      { label: 'Term 2', starts_on: '2026-11-23', ends_on: '2027-02-03' },
      { label: 'Term 3', starts_on: '2027-02-01', ends_on: '2027-04-16' },
    ];
    expect(CmTerms.rowProblem(rows)).toEqual({
      idx: 1,
      field: 'ends_on',
      text: 'Term 2 and Term 3 overlap: Term 3 starts Feb 1.',
    });
    rows[2].ends_on = '2027-01-01';
    rows[1].ends_on = '2027-01-31';
    expect(CmTerms.rowProblem(rows)).toMatchObject({ idx: 2, field: 'ends_on', text: 'Term 3 ends before it starts.' });
    expect(CmTerms.rowProblem([{ label: ' ', starts_on: '', ends_on: '' }])).toMatchObject({ idx: 0, field: 'label' });
    expect(CmTerms.rowProblem(rows.slice(0, 2))).toBeNull();
  });

  it('the year strip draws each term, escapes names and marks an overlap', () => {
    var strip = CmTerms.stripHtml([
      { label: '<b>T1</b>', starts_on: '2026-09-01', ends_on: '2026-12-31' },
      { label: 'T2', starts_on: '2026-12-15', ends_on: '2027-06-30' },
      { label: 'Half done', starts_on: '2027-01-01', ends_on: '' },
    ]);
    expect(strip).toContain('&lt;b&gt;T1&lt;/b&gt;');
    expect(strip).not.toContain('<b>');
    expect(strip.match(/cm-term-strip-term/g)).toHaveLength(2);
    expect(strip).toContain('cm-term-strip-overlap');
    expect(strip).toContain('>Sep<');
    expect(strip).toContain('>Jun<');
    expect(CmTerms.stripHtml([{ label: 'x', starts_on: '', ends_on: '' }])).toBe('');
  });

  it('removing a term with saved reports says they stay saved; Save keeps every rating', async () => {
    saveTermRatings(A, {
      s1: { 4: { narrative: 'Strong year' }, 1: { narrative: 'Good start' } },
      s2: { 4: { narrative: 'Kept' } },
    });
    act('cmTermNew');
    act('cmTermDelete', { idx: '3' });
    var kept = CmTerms.keptHtml(A);
    expect(kept).toContain(
      'Report 4 has 2 saved reports. They stay saved and come back if this class has a Term 4 again.',
    );
    expect(kept).not.toContain('Report 1');
    act('cmTermSave');
    await new Promise(r => setTimeout(r, 10));
    expect(getReportingTerms(A)).toHaveLength(3);
    expect(getTermRatings(A).s1[4].narrative).toBe('Strong year');
    expect(getTermRatings(A).s2[4].narrative).toBe('Kept');
  });

  it('moving a term’s dates clear of where its reports were written says where they will show', () => {
    saveTermRatings(A, { s1: { 1: { narrative: 'Fall' } } });
    act('cmTermNew');
    act('cmTermPreset', { value: 'blank' });
    type(0, 'starts_on', '2027-02-01');
    type(0, 'ends_on', '2027-06-25');
    expect(CmTerms.keptHtml(A)).toContain(
      'Report 1’s 1 saved report was written for Sep 8 – Nov 27. They will show under Term 1 (Feb 1 – Jun 25).',
    );
  });

  it('Also Use In gives another class the same terms on Save', async () => {
    act('cmTermNew');
    type(3, 'ends_on', '2027-06-25');
    expect(html()).toContain('data-action="cmTermAlso" data-cid="course-terms-b"');
    act('cmTermAlso', { cid: B });
    expect(html()).toContain('Save gives those classes these terms too.');
    act('cmTermSave');
    await new Promise(r => setTimeout(r, 30));
    expect(getReportingTerms(B).map(t => t.ends_on)).toEqual(getReportingTerms(A).map(t => t.ends_on));
    expect(getReportingTerms(B)[3].ends_on).toBe('2027-06-25');
  });

  it('another class’s own dates are listed under Your Classes, previewed, then used', () => {
    saveReportingTerms(B, [
      { label: 'Fall', starts_on: '2026-09-02', ends_on: '2027-01-29' },
      { label: 'Spring', starts_on: '2027-02-01', ends_on: '2027-06-25' },
    ]);
    var h = html();
    expect(h).toContain('<optgroup label="Your Classes">');
    expect(h).toContain('value="class:course-terms-b"');
    expect(h).toContain('(2 terms, Sep 2 – Jun 25)');
    pick('class:' + B);
    h = html();
    expect(h).toContain('Use These Dates');
    expect(h).toContain('Fall Sep 2 – Jan 29');
    act('cmTermSchoolPreset');
    expect(draft().rows.map(r => r.label)).toEqual(['Fall', 'Spring']);
    expect(draft().dirty).toBe(true);
    expect(html()).toContain('Your Own Dates');
  });

  it('a school’s dates are not repeated under Your Classes', () => {
    saveReportingTerms(B, GRANDVIEW());
    saveReportingTerms(A, [{ label: 'Year', starts_on: '2026-09-02', ends_on: '2027-06-25' }]);
    CmTerms.reset();
    expect(html()).not.toContain('Your Classes');
  });

  it('Cancel puts back the class’s dates and leaves Your Own Dates', () => {
    act('cmTermNew');
    act('cmTermPreset', { value: 'semesters' });
    act('cmTermCancel');
    expect(draft().rows).toHaveLength(4);
    expect(html()).toContain('cm-term-tiles');
    expect(html()).toContain('<option value="grandviewheights" selected>');
  });
});
