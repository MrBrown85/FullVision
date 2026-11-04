/**
 * The Observations card on the Term Questionnaire (Questionnaire glance
 * plan, step 4): below At a Glance, above the student's Voice; the strip of
 * Strength, Growth, Concern, Note and All with their counts; the newest
 * three observations as the Observations page's card, read only; "View All
 * N" and "Newest first"; one plain line when there are none. For reading
 * only: nothing here feeds Generate. Demo Mode, Science 8, Cece on Report 2.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const RQ = ReportQuestionnaire;
const CID = 'sci8';
const period = { value: 'Report 2', options: [{ text: 'Report 2' }], selectedIndex: 0 };
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

function page(st) {
  RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === st.id);
  return RQ.renderTermQuestionnaire(CID);
}
/* The Observations card's HTML. */
function card(st) {
  const html = page(st);
  const at = html.indexOf('<div class="qn-card qn-obs">');
  return at < 0 ? '' : html.slice(at, html.indexOf('<div class="qn-card qn-voice', at));
}

describe('the Observations card', () => {
  it('sits between At a Glance and the Voice', () => {
    const html = page(cece());
    const glance = html.indexOf('<div class="qn-card qn-glance');
    const obs = html.indexOf('<div class="qn-card qn-obs">');
    const voice = html.indexOf('<div class="qn-card qn-voice');
    expect(glance).toBeGreaterThan(-1);
    expect(obs).toBeGreaterThan(glance);
    expect(voice).toBeGreaterThan(obs);
  });

  it('says how many came in since the Term 1 report', () => {
    expect(card(cece())).toContain('<span class="qn-sub">So far this year · 3 since the Term 1 report</span>');
  });

  it('counts each type and all of them, in order', () => {
    const segs = [
      ...card(cece()).matchAll(
        /data-filter="(\w+)"[^>]*><span class="qno-seg-n">(\d+)<\/span><span class="qno-seg-word">(\w+)<\/span>/g,
      ),
    ].map(m => [m[1], m[2], m[3]]);
    expect(segs).toEqual([
      ['strength', '4', 'Strength'],
      ['growth', '0', 'Growth'],
      ['concern', '0', 'Concern'],
      ['note', '1', 'Note'],
      ['all', '5', 'All'],
    ]);
    expect(card(cece())).toContain(
      'class="qno-seg" data-sentiment="concern" data-action="tqOpenObs" data-filter="concern"',
    );
  });

  it('shows the newest three, newest first, dated, with no delete button', () => {
    const c = card(cece());
    const ids = [...c.matchAll(/class="obs-card" data-action="tqOpenObsAt"[^>]*data-obid="([^"]+)"/g)].map(m => m[1]);
    expect(ids).toEqual(['qo_seed_st1_4', 'qo_seed_st1_3', 'qo_seed_st1_2']);
    expect(c).not.toContain('obs-card-delete');
    expect(c).not.toContain('obs-card-student');
    expect(c).toContain('tabindex="0"');
    // The date alone ("Sun, Nov 1"): the seed's dates move with today.
    const newest = RQ.studentObs(CID, cece().id)[0];
    expect(ObsCard.cardWhen(newest, true)).not.toContain('·');
    expect(c).toContain('<span class="obs-card-time">' + ObsCard.cardWhen(newest, true) + '</span>');
    expect(c).toContain('<span class="obs-card-context">Independent</span>');
  });

  it('has View All and Newest first', () => {
    const c = card(cece());
    expect(c).toContain('data-action="tqOpenObs" data-filter="all" aria-haspopup="dialog">View All 5</button>');
    expect(c).toContain('<span class="qno-foot-note">Newest first</span>');
  });

  it('is one plain line for a student with none', () => {
    const was = globalThis.getStudentQuickObs;
    const sid = cece().id;
    globalThis.getStudentQuickObs = (cid, s) => (s === sid ? [] : was(cid, s));
    try {
      const c = card(cece());
      expect(c).toContain(
        '<div class="qno-empty">No observations for Cece yet. Observations you record for her this year show here.</div>',
      );
      expect(c).toContain('<span class="qn-sub">So far this year</span>');
      expect(c).not.toContain('qno-strip');
      expect(c).not.toContain('View All');
    } finally {
      globalThis.getStudentQuickObs = was;
    }
  });

  it('leaves the shared card as it was on the other pages', () => {
    const ob = getStudentQuickObs(CID, cece().id)[0];
    const html = ObsCard.html(ob, ObsCard.context(CID), { showStudent: false, when: 'date' });
    expect(html).toContain('class="obs-card-delete"');
    expect(html).toContain('data-action="openFocus" tabindex="0"');
    expect(html).toContain('<span class="obs-card-time">' + ObsCard.cardWhen(ob) + '</span>');
    expect(ObsCard.cardWhen(ob)).toContain(' · ');
  });

  it('feeds nothing to Generate', () => {
    const src = readFileSync('teacher/comment-bank.js', 'utf-8');
    expect(src).not.toContain('studentObs');
    expect(src).not.toContain('obsCounts');
  });
});

describe('the card’s observations', () => {
  it('are the student’s own: no “with” line naming the student', () => {
    const c = card(cece());
    expect(c).not.toContain('obs-card-with');
    expect(c).toContain('data-sid="' + cece().id + '"');
  });
});
