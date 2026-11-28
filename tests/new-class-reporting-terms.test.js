/**
 * New Class › Reporting Terms (Colin, 2026-11-27: "just reuse this"). Change
 * on the row draws Class Settings' own Reporting Terms section for the class
 * being made (teacher/cm-terms-start.js), and Create Class saves exactly the
 * terms it holds: the default school's, another school's, a semester's,
 * the teacher's own, another class's, or none. A row with a problem keeps
 * Create Class off.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

var main;
var originalGetElementById;
var originalAlert;
var originalScrollTo;

// A day in the 2026-27 school year the Surrey presets cover.
const TODAY = '2026-11-27T20:00:00Z';

function act(action, dataset) {
  return DashClassManager.handleAction(action, { dataset: dataset || {}, tagName: 'BUTTON', closest: () => null });
}
function pickDates(value) {
  DashClassManager.handleChange({ dataset: { actionChange: 'cmTermSchool' }, value: value, tagName: 'SELECT' });
}
function setSpan(span) {
  act('cmCreateToggle', { group: 'cm-cg-span', val: span });
}
const school = id => reportingTermPreset(id, '2026-11-27');

async function startWizard() {
  DashClassManager.resetState();
  DashClassManager.configure({ activeCourse: null, onRender() {}, onCourseChange() {} });
  DashClassManager.openClassManager();
  act('cmStartCreate');
  await new Promise(r => setTimeout(r, 0));
  act('cwSkipToCustom');
}

// Create Class with this name; resolves to the new class's id.
async function create(name) {
  var original = document.getElementById;
  document.getElementById = id => (id === 'cm-new-name' ? { value: name } : original(id));
  try {
    await act('cwFinishCreate');
  } finally {
    document.getElementById = original;
  }
  await new Promise(r => setTimeout(r, 50));
  return Object.keys(COURSES).find(id => COURSES[id].name === name);
}

const termsRow = () => {
  const m = main.innerHTML.match(/Reporting Terms<\/span><span class="cw-set-value">([^<]*)</);
  return m ? m[1] : null;
};
const createOff = () => /data-action="cwFinishCreate" disabled/.test(main.innerHTML);
// A typed Class Name, so only the terms can keep Create Class off.
const typeName = value => DashClassManager.handleInput({ dataset: { actionInput: 'cwNameInput' }, value: value });
// Draws the step again where it was, as Change and Done do.
const redraw = () => CmWizard.redraw();
const bare = terms => terms.map(t => [t.ordinal, t.label, t.starts_on, t.ends_on]);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(TODAY));
  localStorage.clear();
  localStorage.setItem('gb-demo-mode', '1');
  _useSupabase = false;
  saveCourses({});
  main = { innerHTML: '' };
  originalGetElementById = document.getElementById;
  document.getElementById = id => (id === 'main' ? main : originalGetElementById(id));
  originalAlert = globalThis.alert;
  globalThis.alert = function () {};
  originalScrollTo = window.scrollTo;
  window.scrollTo = function () {};
});

afterEach(() => {
  document.getElementById = originalGetElementById;
  globalThis.alert = originalAlert;
  window.scrollTo = originalScrollTo;
  DashClassManager.resetState();
  vi.useRealTimers();
});

describe('New Class › Reporting Terms', () => {
  it('starts on Grandview Heights, and Create Class saves its terms', async () => {
    await startWizard();
    typeName('Default 8');
    redraw();
    expect(termsRow()).toBe('Grandview Heights Secondary, 4 terms');
    expect(main.innerHTML).not.toContain('Change them in Reporting Terms');
    expect(createOff()).toBe(false);
    const cid = await create('Default 8');
    expect(bare(getReportingTerms(cid))).toEqual(bare(school('grandviewheights')));
  });

  it("Change opens Class Settings' section: tiles, Dates From and Create New, with no span, Save or Also Use In", async () => {
    saveCourses({ other: { id: 'other', name: 'Other' } });
    await startWizard();
    act('cwOpenRow', { row: 'terms' });
    const html = main.innerHTML;
    expect(html).toContain('cm-term-tile');
    expect(html).toContain('id="cm-term-school-new-class"');
    expect(html).toContain('data-action="cmTermNew"');
    expect(html).toContain('data-action="cmTermEdit"');
    expect(html).not.toContain('data-action="cmTermSpan"');
    act('cmTermEdit');
    expect(main.innerHTML).toContain('data-action="cmTermAdd"');
    expect(main.innerHTML).not.toContain('data-action="cmTermSave"');
    expect(main.innerHTML).not.toContain('data-action="cmTermAlso"');
    expect(main.innerHTML).not.toContain('data-action="cmTermSpan"');
  });

  it("saves another school's terms when the teacher picks it", async () => {
    await startWizard();
    act('cwOpenRow', { row: 'terms' });
    pickDates('fraserheights');
    act('cmTermSchoolPreset');
    expect(termsRow()).toBe('Fraser Heights Secondary, 4 terms');
    const cid = await create('Fraser 8');
    expect(bare(getReportingTerms(cid))).toEqual(bare(school('fraserheights')));
  });

  it("a Semester 2 class saves the school's Terms 3 and 4, keeping their numbers", async () => {
    await startWizard();
    setSpan('s2');
    expect(CmTermsStart.summary()).toBe('Grandview Heights Secondary, 2 terms');
    const cid = await create('Spring 8');
    expect(getReportingTerms(cid).map(t => t.ordinal)).toEqual([3, 4]);
    expect(bare(getReportingTerms(cid))).toEqual(bare(school('grandviewheights').slice(2)));
  });

  it("This Class Runs cuts a picked school's terms again", async () => {
    await startWizard();
    act('cwOpenRow', { row: 'terms' });
    pickDates('fraserheights');
    act('cmTermSchoolPreset');
    setSpan('s1');
    redraw();
    expect(termsRow()).toBe('Fraser Heights Secondary, 2 terms');
    const cid = await create('Fall 8');
    expect(bare(getReportingTerms(cid))).toEqual(bare(school('fraserheights').slice(0, 2)));
  });

  it('saves the teacher’s own dates, which This Class Runs leaves alone once typed', async () => {
    await startWizard();
    act('cwOpenRow', { row: 'terms' });
    act('cmTermNew');
    act('cmTermPreset', { value: 'trimesters' });
    expect(termsRow()).toBe('Your own dates, 3 terms');
    CmTerms.cmTermLive(0, 'label', 'Fall');
    expect(termsRow()).toBe('Your own dates, 3 terms');
    setSpan('s2');
    const cid = await create('Own 8');
    expect(getReportingTerms(cid).map(t => [t.label, t.starts_on, t.ends_on])).toEqual([
      ['Fall', '2026-09-01', '2026-11-30'],
      ['Term 2', '2026-12-01', '2027-03-15'],
      ['Term 3', '2027-03-16', '2027-06-30'],
    ]);
  });

  it('editing a school’s date makes them the teacher’s own dates', async () => {
    await startWizard();
    act('cwOpenRow', { row: 'terms' });
    act('cmTermEdit');
    CmTerms.cmTermLive(1, 'ends_on', '2027-01-20');
    const cid = await create('Edited 8');
    expect(getReportingTerms(cid)[1].ends_on).toBe('2027-01-20');
    expect(getReportingTerms(cid)).toHaveLength(4);
  });

  it('names another class whose own dates it takes', async () => {
    const own = CmTermsStart.layoutRows(null, 'trimesters');
    saveCourses({ other: { id: 'other', name: 'Art 9' } });
    saveReportingTerms('other', own);
    await startWizard();
    act('cwOpenRow', { row: 'terms' });
    pickDates('class:other');
    act('cmTermSchoolPreset');
    expect(termsRow()).toBe('Same as Art 9, 3 terms');
    const cid = await create('Copy 9');
    expect(bare(getReportingTerms(cid))).toEqual(bare(own));
  });

  it('saves no terms when every row is removed', async () => {
    await startWizard();
    typeName('None 8');
    act('cwOpenRow', { row: 'terms' });
    act('cmTermEdit');
    [0, 0, 0, 0].forEach(i => act('cmTermDelete', { idx: String(i) }));
    expect(termsRow()).toBe('None');
    expect(createOff()).toBe(false);
    const cid = await create('None 8');
    expect(cid).toBeTruthy();
    expect(getReportingTerms(cid)).toEqual([]);
  });

  it('keeps Create Class off, and makes no class, while a term row has a problem', async () => {
    await startWizard();
    typeName('Broken 8');
    act('cwOpenRow', { row: 'terms' });
    act('cmTermEdit');
    CmTerms.cmTermLive(1, 'ends_on', '2026-01-01');
    expect(CmTermsStart.error()).toMatch(/ends before it starts/);
    redraw();
    expect(createOff()).toBe(true);
    expect(main.innerHTML).toMatch(/cm-term-row-wrap cm-term-row-bad" id="cm-term-row-new-class-1"/);
    expect(await create('Broken 8')).toBeUndefined();
    CmTerms.cmTermLive(1, 'ends_on', '2027-01-26');
    expect(CmTermsStart.error()).toBeNull();
    redraw();
    expect(createOff()).toBe(false);
  });

  it('a new wizard starts again from the school’s terms', async () => {
    await startWizard();
    act('cwOpenRow', { row: 'terms' });
    pickDates('fraserheights');
    act('cmTermSchoolPreset');
    setSpan('s1');
    act('cmCancelCreate');
    await startWizard();
    expect(termsRow()).toBe('Grandview Heights Secondary, 4 terms');
  });
});
