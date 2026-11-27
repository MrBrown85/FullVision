/**
 * At a Glance sets up the comment (Questionnaire glance plan, step 2):
 * Strongest, Next Step and Biggest Change from the year to date as of the
 * report's end (the comment's own facts), with the change since the Term 1
 * report; Best Piece (the comment's), Missing and Late; then View All N
 * Skills. Demo Mode, Science 8 from the bank, Cece on Report 2.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const RQ = ReportQuestionnaire;
const CID = 'sci8';
let saved, hadDoc, oldDoc;
// The report on screen: Report 2, as the Reports page's menu says.
const period = { value: 'Report 2', options: [{ text: 'Report 2' }], selectedIndex: 0 };
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
  globalThis.document = { getElementById: id => (id === 'report-period' ? period : null), querySelectorAll: () => [] };
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

/* A box's HTML for a student, as the page draws it (every box open). */
function box(st, label) {
  RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === st.id);
  const html = RQ.renderTermQuestionnaire(CID);
  const at = html.indexOf('aria-label="' + label + '"');
  return html.slice(at, html.indexOf('</section>', at));
}

describe('the Strength, Best Piece and Missing Work boxes', () => {
  it('lists each skill with its mark, its pieces and the change since the report', () => {
    const html = box(cece(), 'Strength');
    expect(html).toContain('wc-fact-name">Data Representation</span>');
    expect(html).toContain('<span class="wc-chip up">Up From 3.0</span>');
    expect(html).toContain('<span class="wc-chip">5 pieces</span>');
    expect(html).toContain('<span class="wc-val">3.3</span>');
    expect(html).toContain('View All 27 Skills ›</button>');
    expect(html).toContain('data-action="tqOpenSkills"');
  });

  it('shows the highest skill with 3+ pieces when none clears the comment’s gate', () => {
    const f = CommentBank.facts(CID, cece(), 'term-2');
    expect(CommentBank.strongestOf(f.comps)).toEqual([]);
    expect(RQ.glanceRows(f).strongest.name).toBe('Data Representation');
    expect(box(cece(), 'Strength')).toContain('Data Representation · 3.3');
  });

  it('names the comment’s best piece first, with its mark, and opens the grader on it', () => {
    const f = CommentBank.facts(CID, cece(), 'term-2');
    const best = RQ.bestPiece(f);
    const html = box(cece(), 'Best Piece');
    expect(html.indexOf('wc-fact-name">' + best.title + '</span>')).toBeGreaterThan(0);
    expect(html).toContain('<span class="wc-val">' + f.levelText(best.v) + '</span>');
    expect(html).toContain('data-action="tqOpenGrader" data-aid="' + best.id + '"');
    expect(html).toContain('data-action="tqAddReportNote" data-aid="' + best.id + '"');
    expect(f.work.some(w => w.id === best.id)).toBe(true);
  });

  it('lists work labelled Missing with its count, each piece opening in the grader', () => {
    const st = getAssignmentStatuses(CID);
    const key = cece().id + ':sci8a3';
    st[key] = 'NS';
    clearProfCache();
    ReportWc.ui.seeMissing = true;
    try {
      const html = box(cece(), 'Missing Work');
      expect(html).toContain('<span class="wc-chip">1 of ');
      expect(html).toContain('Disease Research Poster');
      expect(html).toContain('data-action="tqOpenGrader" data-aid="sci8a3"');
      expect(
        RQ.missingAndLate(CID, cece().id)
          .filter(x => x.missing)
          .map(x => x.title),
      ).toEqual(RQ.notHandedIn(CID, cece().id));
    } finally {
      ReportWc.ui.seeMissing = false;
      delete st[key];
      clearProfCache();
    }
  });

  it('says the change from each skill’s level at the report', () => {
    const f = CommentBank.facts(CID, cece(), 'term-2');
    const by = name => f.comps.find(c => c.name === name);
    expect(RQ.glanceChange(CID, f, by('Predictions'))).toBe('New since the report');
    expect(RQ.glanceChange(CID, f, by('Local Environment'))).toBe('No change');
    expect(RQ.glanceChange(CID, f, by('Hypotheses'))).toBe('↑ from 2.8');
    expect(RQ.glanceChange(CID, f, by('Safety & Ethics'))).toBe('↓ from 3.0');
  });

  it('shows no change on the first report', () => {
    setActiveTerm(CID, 1);
    period.value = period.options[0].text = 'Report 1';
    try {
      const html = box(cece(), 'Strength');
      expect(html).not.toContain('Up From');
    } finally {
      period.value = period.options[0].text = 'Report 2';
      setActiveTerm(CID, 2);
    }
  });

  it('shows a % for a skill in a Letter class', () => {
    const was = COURSES[CID].gradingSystem;
    COURSES[CID].gradingSystem = 'letter';
    clearProfCache();
    try {
      const html = box(cece(), 'Strength');
      expect(html).toMatch(/<span class="wc-chip up">Up From \d+%<\/span>/);
      expect(html).toMatch(/<span class="wc-val">\d+%<\/span>/);
    } finally {
      COURSES[CID].gradingSystem = was;
      clearProfCache();
    }
  });
});
