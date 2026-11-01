/**
 * Pronouns changed after a comment exists (live run, Nov 1 2026: Edit
 * Student changed the pronouns and the comment kept the old ones). The
 * bank sentences the teacher has not edited are filled again with the new
 * pronouns at once; sentences the teacher typed or edited stay as written,
 * with "Pronouns changed" on the row while they hold an old pronoun; an
 * approved comment changed this way needs approving again.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let RQ = ReportQuestionnaire;
/* The page loaded again: the questionnaire with nothing in memory. */
const reload = () => {
  runInThisContext(readFileSync('teacher/report-questionnaire.js', 'utf-8'), {
    filename: 'teacher/report-questionnaire.js',
  });
  RQ = window.ReportQuestionnaire;
  RQ.configure({ activeCourse: 'sci8', renderReports: () => {} });
};
const HE = /\b(he|him|his|himself)\b/i;

describe('pronouns changed after the comment was written (Demo Mode, Science 8, Report 2)', () => {
  let cid, saved, hadDoc, oldDoc;
  const ethan = () => getStudents(cid).find(s => s.firstName === 'Ethan');
  const comment = () => RQ.plainComment((getStudentTermRating(cid, ethan().id, 'term-2') || {}).narrative || '');

  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
    const period = { value: 'Report 2', selectedIndex: 0, options: [{ value: 'Report 2', text: 'Report 2' }] };
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    globalThis.document = {
      getElementById: id => (id === 'report-period' ? period : null),
      querySelector: () => null,
      querySelectorAll: () => [],
    };
    RQ.configure({ activeCourse: cid, renderReports: () => {} });
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });

  it('pronounsChanged: unedited bank rows take the new pronouns; typed and edited rows are left alone and noted', () => {
    const st = ethan();
    const f = CommentBank.facts(cid, st, 'term-2');
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) });
    const rows = RQ.rowsFromDraft(d);
    expect(HE.test(RQ.composeRows(rows))).toBe(true);
    const typed = RQ.typedRow('He helped clean up after the lab.', 1);
    const plain = RQ.typedRow('The lab went well.', 2);
    const edited = Object.assign({}, rows[1], { text: 'Ethan finished his poster early.', edited: true });
    const before = [rows[0], edited, ...rows.slice(2), typed, plain];
    const was = f.pronouns;
    st.pronouns = 'she/her';
    try {
      const f2 = CommentBank.facts(cid, st, 'term-2');
      const next = RQ.pronounsChanged(before, CommentBank.context(f2, {}), was, f2.pronouns);
      const text = RQ.composeRows(next);
      const bank = next.filter(r => !r.edited).map(r => r.text);
      expect(bank.some(t => /\b(she|her|herself)\b/i.test(t))).toBe(true);
      expect(bank.some(t => HE.test(t))).toBe(false);
      expect(text).toContain('He helped clean up after the lab.');
      expect(text).toContain('Ethan finished his poster early.');
      expect(next.filter(RQ.pronounNote).map(r => r.text)).toEqual([
        'Ethan finished his poster early.',
        'He helped clean up after the lab.',
      ]);
      // Once the teacher fixes the sentence, the note goes.
      expect(RQ.pronounNote(Object.assign({}, next.find(RQ.pronounNote), { text: 'Ethan finished early.' }))).toBe(
        false,
      );
    } finally {
      st.pronouns = 'he/him';
    }
  });

  it('on screen: the comment follows at once, a typed sentence is noted, and an approved comment needs approving again', () => {
    const st = ethan();
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === st.id);
    const f = CommentBank.facts(cid, st, 'term-2');
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) });
    const mine = 'He helped clean up after the lab.';
    upsertTermRating(cid, st.id, 'term-2', { narrative: d.text + ' ' + mine });
    RQ.renderTermQuestionnaire(cid);
    upsertTermRating(cid, st.id, 'term-2', { approvedAt: '2026-11-01T10:00:00.000Z' });
    RQ.renderTermQuestionnaire(cid);
    expect(comment()).toBe(d.text + ' ' + mine);
    st.pronouns = 'she/her';
    try {
      const html = RQ.renderTermQuestionnaire(cid);
      const text = comment();
      expect(text.endsWith(' ' + mine)).toBe(true);
      const drafted = text.slice(0, -mine.length);
      expect(HE.test(drafted)).toBe(false);
      expect(/\b(she|her|herself)\b/i.test(drafted)).toBe(true);
      expect(getStudentTermRating(cid, st.id, 'term-2').approvedAt).toBeFalsy();
      // The note sits on the typed sentence's row only.
      expect((html.match(/class="qn-pron-note"/g) || []).length).toBe(1);
      const at = html.indexOf('class="qn-pron-note"');
      const rowStart = html.lastIndexOf('<div class="qn-req-row', at);
      expect(html.slice(rowStart, at)).toContain(mine);
      expect(html).toContain('>Pronouns changed</span>');
      // Drawn again with the same pronouns, nothing more changes.
      RQ.renderTermQuestionnaire(cid);
      expect(comment()).toBe(text);
    } finally {
      st.pronouns = 'he/him';
    }
  });

  /* An approved comment for Ethan as written with the pronouns on file:
     the draft and a typed sentence, with its record (draft_meta). */
  const approvedFor = (st, mine) => {
    const f = CommentBank.facts(cid, st, 'term-2');
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) + 3 });
    const rows = RQ.rowsFromDraft(d).concat(mine ? [RQ.typedRow(mine, 9)] : []);
    const text = RQ.composeRows(rows);
    const at = '2026-11-01T10:00:00.000Z';
    const draftMeta = CommentBank.draftMeta(rows, f, { approvedAt: at });
    upsertTermRating(cid, st.id, 'term-2', { narrative: text, approvedAt: at, draftMeta });
    return { text, draftMeta };
  };
  const open = st => {
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === st.id);
    return RQ.renderTermQuestionnaire(cid);
  };

  it('keeps the pronouns with the approval (draft_meta.pronouns)', () => {
    const { draftMeta } = approvedFor(ethan());
    expect(draftMeta.pronouns).toMatchObject({ subj: 'he', obj: 'him', poss: 'his', refl: 'himself' });
  });

  it('changed with the questionnaire closed, then a reload: the approved comment follows, is noted, and needs approving again', () => {
    const st = ethan();
    const mine = 'He helped clean up after the lab.';
    const { text: before } = approvedFor(st, mine);
    reload();
    // Class Management or the Student Dashboard changes the pronouns.
    st.pronouns = 'she/her';
    try {
      reload();
      const html = open(st);
      const text = comment();
      expect(text).not.toBe(before);
      expect(text.endsWith(' ' + mine)).toBe(true);
      const drafted = text.slice(0, -mine.length);
      expect(HE.test(drafted)).toBe(false);
      expect(/\b(she|her|herself)\b/i.test(drafted)).toBe(true);
      expect(getStudentTermRating(cid, st.id, 'term-2').approvedAt).toBeFalsy();
      expect((html.match(/class="qn-pron-note"/g) || []).length).toBe(1);
      // Re-rendered rows are bank rows, not Edited.
      expect((html.match(/>Edited</g) || []).length).toBe(0);
      // Opened again after another reload, nothing more changes.
      reload();
      open(st);
      expect(comment()).toBe(text);
    } finally {
      st.pronouns = 'he/him';
    }
  });

  it('a comment with no record (not approved) is read with the pronouns its sentences use', () => {
    const st = ethan();
    const f = CommentBank.facts(cid, st, 'term-2');
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) + 5 });
    upsertTermRating(cid, st.id, 'term-2', { narrative: d.text, approvedAt: null, draftMeta: null });
    // Same pronouns: nothing changes.
    reload();
    open(st);
    expect(comment()).toBe(d.text);
    st.pronouns = 'they/them';
    try {
      reload();
      open(st);
      const text = comment();
      expect(HE.test(text)).toBe(false);
      expect(/\b(they|them|their|themselves)\b/i.test(text)).toBe(true);
      reload();
      open(st);
      expect(comment()).toBe(text);
    } finally {
      st.pronouns = 'he/him';
    }
  });
});
