/**
 * No "Only 4 habit sentences fit 30 students, so some will repeat." under
 * a row (Colin, 2026-11-06: distracting; teachers don't need a count of how
 * often a wording is used). A part thin for the class shows nothing on the
 * Sentences card. Demo Mode only.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;

describe('the Sentences card in Demo Mode (Science 8, Report 2)', () => {
  let cid, saved, hadDoc, oldDoc, fullBank;
  beforeAll(() => {
    // The bank as it was before Nov 1 (the first 18 family sentences), so
    // the family part is thin for the class: four sentences for Science.
    fullBank = COMMENT_BANK.sentences;
    COMMENT_BANK.sentences = fullBank.filter(s => s.group !== 'For the Family' || Number(s.id.slice(1)) <= 18);
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
    RQ.configure({ activeCourse: cid, renderReports: () => {} });
  });
  afterAll(() => {
    COMMENT_BANK.sentences = fullBank;
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });

  /* The card for a student with a saved draft, and the draft. */
  function card(first, edit) {
    const students = RQ.getTqStudents();
    const st = students.find(s => s.firstName === first);
    RQ.tqStudentIndex = students.indexOf(st);
    const termId = ReportBlocks.getTermId();
    const f = CommentBank.facts(cid, st, termId);
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) });
    upsertTermRating(cid, st.id, termId, { narrative: edit ? edit(d.text, d) : d.text });
    const html = RQ.renderTermQuestionnaire(cid);
    return { html: html.slice(html.indexOf('id="tq-sentences"')), d, students, st, termId };
  }

  it('says nothing under a row whose part is thin for the class', () => {
    const { html, d, st, termId, students } = card('Noor');
    const strength = CommentBank.bankStrength(cid, { termId, students });
    expect(d.sentences.some(x => (strength.byStudent[st.id][x.step] || {}).thin)).toBe(true);
    expect(html).toContain('class="qn-req-row');
    expect(html).not.toContain('some will repeat');
    expect(html).not.toContain('Write one of your own');
  });
});
