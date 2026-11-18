/**
 * The Dashboard's two-card row with the dashRow switch off: a guard that
 * nothing inside renderOverviewPanel, either card or the top bar changed.
 * tests/fixtures/dash-overview-flag-off.json holds the panel's output for the
 * sample class (Demo Mode's Science 8, the clock fixed) in every Curricular
 * view x every Core view. It was recorded from teacher/dash-overview.js as it
 * stood at d754b421, the commit before D2, and is never regenerated from
 * current code. A change that moves a byte of it is a change to today's
 * Dashboard: make it on purpose, with the reviewer told.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
const COMP_VIEWS = ['mix', 'avg', 'below', 'trend'];
const CORE_VIEWS = ['self', 'evidence'];
let wasDemo;

function panelOpts(compView, coreView) {
  const allStudents = getStudents(CID);
  const ids = allStudents.map(s => s.id);
  const assessments = getAssignedAssessments(CID);
  const ccCounts = {};
  const ccAssessments = {};
  assessments.forEach(a => {
    (a.coreCompetencyIds || []).forEach(id => {
      ccCounts[id] = (ccCounts[id] || 0) + 1;
      (ccAssessments[id] = ccAssessments[id] || []).push(a.title || 'Untitled');
    });
  });
  return {
    cid: CID,
    sections: getSections(CID),
    allStudents,
    assessments,
    classAvg: 0,
    classR: 0,
    ccCounts,
    ccAssessments,
    ccObs: {},
    coreSelf: coreSelfRatings(CID, ids),
    coreView,
    compView,
    obs: {},
    classChange: classGradeChange(CID, ids),
    mixPop: null,
    helpRule: null,
    naComp: null,
  };
}

function renderAll() {
  const out = {};
  for (const comp of COMP_VIEWS)
    for (const core of CORE_VIEWS) out[comp + '/' + core] = DashOverview.renderOverviewPanel(panelOpts(comp, core));
  return out;
}

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-17T12:00:00'));
  wasDemo = window.isDemoMode;
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
  window.isDemoMode = () => true;
  Object.keys(COURSES).forEach(cid => _clearCourseLocalState(cid));
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  seedIfNeeded();
});

afterAll(() => {
  window.isDemoMode = wasDemo;
  vi.useRealTimers();
});

describe('renderOverviewPanel with the dashRow switch off', () => {
  it('is the recorded output from before D2, byte for byte, in all eight view pairs', () => {
    localStorage.removeItem('fv-build-dashRow');
    const now = renderAll();
    const recorded = JSON.parse(readFileSync('tests/fixtures/dash-overview-flag-off.json', 'utf-8'));
    expect(Object.keys(now)).toEqual(Object.keys(recorded));
    expect(Object.keys(now)).toHaveLength(8);
    for (const key of Object.keys(recorded)) {
      expect(now[key].length).toBeGreaterThan(3000);
      expect(now[key]).toBe(recorded[key]);
    }
  });
});
