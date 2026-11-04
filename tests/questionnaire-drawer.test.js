/**
 * The drawer over the left column (Questionnaire glance plan, step 3), and
 * the Skills drawer in it: every skill so far this year in its curriculum
 * folder, with its figure, pieces, the change since the Term 1 report and
 * its word. Escape closes the drawer before a sheet; changing student
 * closes it. Demo Mode, Science 8 from the bank, Cece on Report 2.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const RQ = ReportQuestionnaire;
const CID = 'sci8';
const period = { value: 'Report 2', options: [{ text: 'Report 2' }], selectedIndex: 0 };
const els = {};
let saved, hadDoc, oldDoc;
const cece = () => getStudents(CID).find(s => s.firstName === 'Cece');

beforeAll(() => {
  saved = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
  seedIfNeeded();
  setActiveTerm(CID, 2);
  hadDoc = 'document' in globalThis;
  oldDoc = globalThis.document;
  globalThis.document = {
    getElementById: id => (id === 'report-period' ? period : els[id] || null),
    querySelector: () => null,
    querySelectorAll: () => [],
    activeElement: null,
    body: {},
  };
  RQ.configure({ activeCourse: CID, renderReports: () => {} });
});

afterAll(() => {
  if (hadDoc) globalThis.document = oldDoc;
  else delete globalThis.document;
  setActiveTerm(CID, null);
  window.isDemoMode = saved;
  CURRICULUM_INDEX = null;
  localStorage.clear();
});

beforeEach(() => {
  RQ.tqCloseDrawer();
  RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === cece().id);
  RQ.renderTermQuestionnaire(CID);
});

/* The page's HTML from the drawer on. */
function drawer() {
  const html = RQ.renderTermQuestionnaire(CID);
  const at = html.indexOf('<div class="qno-panel"');
  return at < 0 ? '' : html.slice(at);
}
const text = html =>
  html
    .replace(/<[^>]+>/g, '\n')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean)
    .join(' | ');

describe('the Skills drawer', () => {
  it('is closed until View All Skills opens it', () => {
    expect(drawer()).toBe('');
    RQ.tqOpenSkills();
    expect(RQ.drawerOpen()).toBe(true);
    expect(drawer()).toContain('id="tq-drawer" data-kind="skills" role="dialog"');
  });

  it('is drawn after the page, outside the two columns', () => {
    RQ.tqOpenSkills();
    const html = RQ.renderTermQuestionnaire(CID);
    expect(html.lastIndexOf('<div class="qn-right">')).toBeLessThan(html.indexOf('<div class="qno-panel"'));
    expect(html.startsWith('<div class="qn"')).toBe(true);
  });

  it('has the title, the sub-line and the ✕', () => {
    RQ.tqOpenSkills();
    const d = drawer();
    expect(d).toContain('>Cece’s Skills</span>');
    expect(d).toContain('<span class="qn-sub">27 skills · so far this year · change since the Term 1 report</span>');
    expect(d).toContain(
      'class="qno-close" data-action="tqCloseDrawer" title="Close (Esc)" aria-label="Close skills">✕</button>',
    );
  });

  it('lists 27 skills in the six folders, with their counts', () => {
    RQ.tqOpenSkills();
    const d = drawer();
    expect((d.match(/class="qn-skill"/g) || []).length).toBe(27);
    const heads = [...d.matchAll(/qno-month"><span>([^<]+)<\/span><span class="obs-feed-date-count">([^<]+)</g)].map(
      m => [m[1], m[2]],
    );
    expect(heads).toEqual([
      ['Questioning and Predicting', '5 skills'],
      ['Planning and Conducting', '5 skills'],
      ['Processing and Analyzing', '5 skills'],
      ['Evaluating', '6 skills'],
      ['Applying and Innovating', '4 skills'],
      ['Communicating', '2 skills'],
    ]);
  });

  it('gives each row its figure, pieces, change and word', () => {
    RQ.tqOpenSkills();
    const rows = drawer()
      .split('<div class="qn-skill">')
      .slice(1)
      .map(r => text(r.split('</div>')[0]));
    expect(rows[0]).toBe('Sustained Inquiry | 2.5 · 2 pieces | New since the report | Proficient');
    expect(rows[1]).toBe('Observation | 2.9 · 3 pieces | ↓ from 3.0 | Proficient');
    expect(rows[2]).toBe('Inquiry Questions | 3.2 · 7 pieces | ↑ from 3.0 | Proficient');
    expect(rows[4]).toBe('Predictions | 4.0 · 1 piece | New since the report | Extending');
    expect(rows[10]).toBe('Local Environment | 3.0 · 3 pieces | No change | Proficient');
    expect(rows[25]).toBe('Sharing Findings | 3.2 · 11 pieces | ↑ from 2.8 | Proficient');
  });

  it('has one group for a class without folders', () => {
    const comps = CommentBank.facts(CID, cece(), 'term-2').year.comps;
    const was = globalThis.getCompetencyGroups;
    globalThis.getCompetencyGroups = () => [];
    try {
      const groups = RQ.skillGroups(CID, comps);
      expect(groups.map(g => g.label)).toEqual(['All Skills']);
      expect(groups[0].items).toHaveLength(27);
    } finally {
      globalThis.getCompetencyGroups = was;
    }
  });

  it('closes with ✕', () => {
    RQ.tqOpenSkills();
    RQ.tqCloseDrawer();
    expect(RQ.drawerOpen()).toBe(false);
    expect(drawer()).toBe('');
  });
});

describe('closing the drawer', () => {
  it('Escape closes the drawer before the sheet', () => {
    let closed = 0;
    els['tq-info-overlay'] = { remove: () => closed++ };
    try {
      RQ.tqOpenSkills();
      const e = { key: 'Escape', target: { closest: () => null }, preventDefault() {} };
      RQ.handleKey(e);
      expect(RQ.drawerOpen()).toBe(false);
      expect(closed).toBe(0);
      RQ.handleKey(e);
      expect(closed).toBe(1);
    } finally {
      delete els['tq-info-overlay'];
    }
  });

  it('changing student closes it', () => {
    RQ.tqOpenSkills();
    RQ.tqNextStudent();
    expect(RQ.drawerOpen()).toBe(false);
    RQ.tqOpenSkills();
    RQ.tqPrevStudent();
    expect(RQ.drawerOpen()).toBe(false);
  });

  it('is wired to the reports page', () => {
    const src = readFileSync('teacher/page-reports.js', 'utf-8');
    expect(src).toContain('RQ.tqOpenSkills(el)');
    expect(src).toContain('RQ.tqCloseDrawer()');
  });
});
