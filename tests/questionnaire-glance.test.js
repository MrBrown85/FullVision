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

/* The At a Glance card's HTML for a student, as the page draws it. */
function glance(st) {
  RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === st.id);
  const html = RQ.renderTermQuestionnaire(CID);
  const at = html.indexOf('<div class="qn-card qn-glance');
  const end = html.indexOf('<div class="qn-card qn-voice', at);
  return html.slice(at, end > at ? end : undefined);
}
/* The card's rows as text: label, body, word. */
function rows(html) {
  return html
    .split(/<div class="qn-fact(?: qn-best| qn-glance-row)?">/)
    .slice(1)
    .map(r =>
      r
        .split(/<div class="(?:qn-band|qno-foot)/)[0]
        .replace(/<ul class="qn-glance-list[\s\S]*?<\/ul>/, '')
        .replace(/<[^>]+>/g, '\n')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean)
        .join(' | '),
    );
}

describe('At a Glance', () => {
  it('names the earlier report in its sub-line', () => {
    expect(glance(cece())).toContain('<span class="qn-sub">So far this year · change since the Term 1 report</span>');
  });

  it('has the Skills rows, then the Work rows, in order', () => {
    const html = glance(cece());
    expect(html.indexOf('>Skills<')).toBeLessThan(html.indexOf('>Work<'));
    const r = rows(html);
    expect(r.map(x => x.split(' | ')[0])).toEqual([
      'Strongest',
      'Next Step',
      'Biggest Change',
      'Best Piece',
      'Missing and Late',
    ]);
    // The competency's name, its own wording from the learning map (the tag's
    // text, as Class Management shows it), the figure and pieces, then the
    // word and the change.
    expect(r[0]).toBe(
      'Strongest | Data Representation | Construct and use a range of methods to represent patterns or relationships in data, including tables, graphs, keys, models, and digital technologies as appropriate | 3.3 · 5 pieces | Proficient · ↑ from 3.0',
    );
    // The comment's next step: the lowest with 2+ pieces in the year to date
    // (NEXT_STEP_PIECES), first assessed in Term 2.
    expect(r[1]).toMatch(
      /^Next Step \| Sustained Inquiry \| [^|]+ \| 2\.5 · 2 pieces \| Proficient · New since the report$/,
    );
    expect(r[2]).toMatch(/^Biggest Change \| Sharing Findings \| [^|]+ \| 3\.2 · 11 pieces \| 2\.8 → 3\.2$/);
    expect(r[4]).toBe('Missing and Late | None so far this year');
  });

  it('shows the highest skill with 3+ pieces when none clears the comment’s gate', () => {
    const f = CommentBank.facts(CID, cece(), 'term-2');
    expect(CommentBank.strongestOf(f.comps)).toEqual([]);
    expect(RQ.glanceRows(f).strongest.name).toBe('Data Representation');
  });

  it('keeps the comment’s best piece', () => {
    const f = CommentBank.facts(CID, cece(), 'term-2');
    const best = RQ.bestPiece(f);
    expect(rows(glance(cece()))[3]).toBe(
      'Best Piece | ' + best.title + ' | Open in Grader › | Add a note for the report › | ' + formatLevel(CID, best.v),
    );
    expect(glance(cece())).toContain('data-action="tqOpenGrader" data-aid="' + best.id + '"');
    expect(f.work.some(w => w.id === best.id)).toBe(true);
  });

  it('colours the figure by its level', () => {
    expect(glance(cece())).toMatch(/<span class="qn-level" data-level="3">3\.3 · 5 pieces<\/span>/);
  });

  it('opens a skill row to the pieces behind its figure, each linked to the grader', () => {
    const f = CommentBank.facts(CID, cece(), 'term-2');
    const c = RQ.glanceRows(f).strongest;
    const html = glance(cece());
    const list = html.match(/<ul class="qn-glance-list" id="tq-glance-strongest" hidden>([\s\S]*?)<\/ul>/)[1];
    const items = [...list.matchAll(/data-aid="([^"]+)"[^>]*>([^<]*)<\/button><span class="qn-glance-mark">([^<]*)</g)];
    expect(items.map(m => m[1])).toEqual(c.scores.map(s => s.id));
    expect(items.map(m => m[3])).toEqual(c.scores.map(s => formatLevel(CID, s.v)));
    expect(html).toContain('data-action="tqGlanceToggle" data-row="strongest" aria-expanded="false"');
  });

  it('opens all 27 skills from the foot', () => {
    expect(glance(cece())).toContain('data-action="tqOpenSkills" aria-haspopup="dialog">View All 27 Skills ›</button>');
  });

  it('lists work labelled Missing in Term 1 with its count', () => {
    const st = getAssignmentStatuses(CID);
    const key = cece().id + ':sci8a3';
    st[key] = 'NS';
    clearProfCache();
    try {
      const r = rows(glance(cece()));
      expect(r[4]).toBe('Missing and Late | 1 missing | 1');
      expect(glance(cece())).toMatch(
        /data-aid="sci8a3"[^>]*>Disease Research Poster<\/button><span class="qn-glance-mark missing">Missing</,
      );
      expect(
        RQ.missingAndLate(CID, cece().id)
          .filter(x => x.missing)
          .map(x => x.title),
      ).toEqual(RQ.notHandedIn(CID, cece().id));
    } finally {
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

  it('has no Biggest change and no change text on the first report', () => {
    setActiveTerm(CID, 1);
    period.value = period.options[0].text = 'Report 1';
    try {
      const html = glance(cece());
      expect(html).toContain('<span class="qn-sub">So far this year</span>');
      expect(html).not.toContain('Biggest Change');
      expect(html).not.toContain('from 3.0');
    } finally {
      period.value = period.options[0].text = 'Report 2';
      setActiveTerm(CID, 2);
    }
  });

  it('shows a % in the figure in a Letter class', () => {
    const was = COURSES[CID].gradingSystem;
    COURSES[CID].gradingSystem = 'letter';
    clearProfCache();
    try {
      const r = rows(glance(cece()));
      expect(r[0]).toMatch(/^Strongest \| [^|]+ \| [^|]+ \| \d+% · \d+ pieces \| [↑↓] from \d+%$/);
      expect(r[2]).toMatch(/^Biggest Change \| Sharing Findings \| [^|]+ \| \d+% · 11 pieces \| \d+% → \d+%$/);
    } finally {
      COURSES[CID].gradingSystem = was;
      clearProfCache();
    }
  });
});
