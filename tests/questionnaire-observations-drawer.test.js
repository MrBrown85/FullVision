/**
 * The Observations drawer (Questionnaire glance plan, step 5): the card's
 * strip or View All opens it on a type; the strip filters it (the chosen
 * type filled), the search box finds text, tags, linked work, context and
 * type; month headings with their counts; the "Term 1 report · Jul 14"
 * line where that report fell; a card's row opens the drawer at that row,
 * in full; Escape closes it. Demo Mode, Science 8, Cece on Report 2, with
 * one more observation linked to a piece of work.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const RQ = ReportQuestionnaire;
const CID = 'sci8';
const period = { value: 'Report 2', options: [{ text: 'Report 2' }], selectedIndex: 0 };
let saved, hadDoc, oldDoc, linked;
const cece = () => getStudents(CID).find(s => s.firstName === 'Cece');

beforeAll(() => {
  saved = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
  seedIfNeeded();
  setActiveTerm(CID, 2);
  // A growth observation on Cece's Disease Research Poster, in Term 1.
  const sid = cece().id;
  addQuickOb(CID, sid, 'Labelled every part of the poster after feedback.', ['collaboration'], 'growth', null, {
    assessmentId: 'sci8a3',
    assessmentTitle: 'Disease Research Poster',
  });
  const list = getQuickObs(CID)[sid];
  linked = list[list.length - 1];
  linked.date = '2026-06-20';
  linked.created = '2026-06-20T18:00:00.000Z';
  hadDoc = 'document' in globalThis;
  oldDoc = globalThis.document;
  globalThis.document = {
    getElementById: id => (id === 'report-period' ? period : null),
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

function drawer() {
  const html = RQ.renderTermQuestionnaire(CID);
  const at = html.indexOf('<div class="qno-panel"');
  return at < 0 ? '' : html.slice(at);
}
/* The rows the drawer shows, by observation id, in order. */
const shown = d => [...d.matchAll(/<div class="qno-item" data-obid="([^"]+)" data-day="[^"]+">/g)].map(m => m[1]);
const all = d => [...d.matchAll(/<div class="qno-item" data-obid="([^"]+)"/g)].map(m => m[1]);
/* The month headings shown, with their counts. */
const months = d =>
  [
    ...d.matchAll(
      /<div class="qno-group" data-month="[^"]+">\s*<div class="obs-feed-date-label qno-month"><span>([^<]+)<\/span><span class="obs-feed-date-count">([^<]+)</g,
    ),
  ].map(m => m[1] + ' · ' + m[2]);

describe('the Observations drawer', () => {
  it('opens from View All with every observation, newest first', () => {
    RQ.tqOpenObs('all');
    const d = drawer();
    expect(d).toContain('id="tq-drawer" data-kind="obs" role="dialog"');
    expect(d).toContain('>Cece’s Observations</span>');
    expect(d).toContain('<span class="qn-sub">6 so far this year · newest first</span>');
    expect(shown(d)).toEqual(RQ.studentObs(CID, cece().id).map(o => o.id));
    expect(shown(d)).toHaveLength(6);
    expect(d).toContain(
      'class="qno-seg on" data-sentiment="all" data-action="tqObsFilter" data-filter="all" aria-pressed="true"',
    );
    expect(d).toContain('<span class="qno-showing" id="tq-obs-showing"></span>');
    expect(d).not.toContain('obs-card-delete');
  });

  it('groups by month with each month’s count', () => {
    RQ.tqOpenObs('all');
    const heads = months(drawer());
    expect(heads).toHaveLength(new Set(RQ.studentObs(CID, cece().id).map(o => ObsCard.obDay(o).slice(0, 7))).size);
    heads.forEach(h => expect(h).toMatch(/^[A-Z][a-z]+ \d{4} · \d+ observations?$/));
  });

  it('opens from the strip on one type, filled, with Showing N of M', () => {
    RQ.tqOpenObs('strength');
    const d = drawer();
    expect(d).toContain('class="qno-seg on" data-sentiment="strength"');
    expect(shown(d)).toHaveLength(4);
    expect(all(d)).toHaveLength(6);
    expect(d).toContain('>Showing 4 of 6</span>');
  });

  it('filters by type from its own strip, in place', () => {
    RQ.tqOpenObs('all');
    RQ.tqObsFilter('note');
    const d = drawer();
    expect(shown(d)).toEqual(['qo_seed_st1_4']);
    expect(d).toContain('>Showing 1 of 6</span>');
    expect(months(drawer())).toEqual([expect.stringMatching(/ · 1 observation$/)]);
  });

  it('searches the text, a tag, the linked work, the context and the type', () => {
    RQ.tqOpenObs('all');
    RQ.tqObsSearch('microscope');
    expect(shown(drawer())).toEqual(['qo_seed_st1_4']);
    RQ.tqObsSearch('Self-Regulation');
    expect(shown(drawer())).toEqual(['qo_seed_st1_2', 'qo_seed_st1_1']);
    RQ.tqObsSearch('disease research');
    expect(shown(drawer())).toEqual([linked.id]);
    RQ.tqObsSearch('presentation');
    expect(shown(drawer())).toEqual(['qo_seed_st1_3']);
    RQ.tqObsSearch('growth');
    expect(shown(drawer())).toEqual([linked.id]);
    expect(drawer()).toContain('value="growth"');
  });

  it('says so when nothing matches, with Show All', () => {
    RQ.tqOpenObs('concern');
    const d = drawer();
    expect(shown(d)).toEqual([]);
    expect(d).toContain('>Showing 0 of 6</span>');
    expect(d).toContain(
      '<div class="qno-empty qno-nomatch">No observations match. <button type="button" class="qn-card-link" data-action="tqObsShowAll">Show All</button></div>',
    );
    RQ.tqObsShowAll();
    expect(shown(drawer())).toHaveLength(6);
    expect(drawer()).toContain('qno-nomatch" hidden');
  });

  it('marks where the Term 1 report fell, before the newest observation on or before it', () => {
    RQ.tqOpenObs('all');
    const d = drawer();
    const cp = d.indexOf('<div class="qno-checkpoint"><span>Term 1 report · ');
    expect(cp).toBeGreaterThan(-1);
    expect(d).toMatch(/<div class="qno-checkpoint"><span>Term 1 report · [A-Z][a-z]{2} \d{1,2}<\/span><\/div>/);
    const ends = CommentBank.facts(CID, cece(), 'term-2').asOfReport.endsOn;
    const list = RQ.studentObs(CID, cece().id);
    const first = list.find(o => ObsCard.obDay(o) <= ends);
    const before = d.lastIndexOf('<div class="qno-item" data-obid="', cp);
    expect(d.slice(before, cp)).toContain('data-obid="' + first.id + '"');
    expect(list.filter(o => ObsCard.obDay(o) > ends)).toHaveLength(3);
  });

  it('cuts rows to four lines until one is opened', () => {
    RQ.tqOpenObs('all');
    expect(drawer()).toContain('class="obs-card qno-clamp" tabindex="-1"');
    expect(drawer()).not.toContain('qno-open');
  });

  it('opens at a card’s row, in full', () => {
    RQ.tqOpenObsAt('qo_seed_st1_3');
    const d = drawer();
    expect(shown(d)).toHaveLength(6);
    expect(d).toMatch(
      /data-obid="qo_seed_st1_3"[^>]*>(<div class="qno-checkpoint">.*?<\/div>)?<div class="obs-card qno-open"/,
    );
    expect((d.match(/qno-open/g) || []).length).toBe(1);
  });

  it('Show More opens a row and Show Less cuts it again', () => {
    RQ.tqOpenObs('all');
    RQ.tqObsMore('qo_seed_st1_2');
    expect(drawer()).toMatch(/data-obid="qo_seed_st1_2"[^>]*><div class="obs-card qno-open"/);
    RQ.tqObsMore('qo_seed_st1_2');
    expect(drawer()).not.toContain('qno-open');
  });

  it('Escape closes it', () => {
    RQ.tqOpenObs('all');
    RQ.handleKey({ key: 'Escape', target: { closest: () => null }, preventDefault() {} });
    expect(RQ.drawerOpen()).toBe(false);
    expect(drawer()).toBe('');
  });

  it('Return on a card’s row opens it', () => {
    let prevented = false;
    const row = {
      getAttribute: k => (k === 'data-obid' ? 'qo_seed_st1_4' : null),
      closest: sel => (sel.indexOf('tqOpenObsAt') >= 0 ? row : null),
    };
    RQ.handleKey({ key: 'Enter', target: row, preventDefault: () => (prevented = true) });
    expect(prevented).toBe(true);
    expect(drawer()).toMatch(/data-obid="qo_seed_st1_4"[^>]*><div class="obs-card qno-open"/);
  });

  it('is wired to the reports page, the search box through the input handler', () => {
    const src = readFileSync('teacher/page-reports.js', 'utf-8');
    expect(src).toContain('RQ.tqOpenObs(el.dataset.filter, el)');
    expect(src).toContain('RQ.tqOpenObsAt(el.dataset.obid, el)');
    expect(src).toContain('RQ.tqObsFilter(el.dataset.filter)');
    expect(src).toContain('RQ.tqObsMore(el.dataset.obid)');
    expect(src).toContain('RQ.tqObsShowAll()');
    expect(src).toContain("e.target.id === 'tq-obs-search') RQ.tqObsSearch(e.target.value)");
  });
});
