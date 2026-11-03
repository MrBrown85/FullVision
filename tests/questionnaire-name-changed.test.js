/**
 * A preferred name changed after a comment exists (bug sweep, Nov 3 2026:
 * the teacher approved a comment for Dev, then set his preferred name to
 * Zed; the approved comment still said Dev, nothing flagged it, and the
 * report card printed it under a header that said Zed). A sentence that
 * still calls the student by the old name shows what it says and the same
 * sentence with the name now, as a pronoun change does: on the Teacher
 * Comment card once approved, on the row before. Nothing changes until the
 * teacher picks.
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
const ETHAN = /\bEthan\b/;
const ZED = /\bZed\b/;

describe('preferred name changed after the comment was written (Demo Mode, Science 8, Report 2)', () => {
  let cid, saved, hadDoc, oldDoc;
  const ethan = () => getStudents(cid).find(s => s.firstName === 'Ethan');
  const comment = () => RQ.plainComment((getStudentTermRating(cid, ethan().id, 'term-2') || {}).narrative || '');
  const open = st => {
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === st.id);
    return RQ.renderTermQuestionnaire(cid);
  };
  /* An approved comment for Ethan: the draft and a typed sentence that
     names him, with its record (draft_meta). */
  const mine = 'Ethan helped clean up after the lab.';
  const approvedFor = st => {
    const f = CommentBank.facts(cid, st, 'term-2');
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) + 3 });
    const rows = RQ.rowsFromDraft(d).concat([RQ.typedRow(mine, 9)]);
    const text = RQ.composeRows(rows);
    const at = '2026-11-01T10:00:00.000Z';
    const draftMeta = CommentBank.draftMeta(rows, f, { approvedAt: at });
    upsertTermRating(cid, st.id, 'term-2', { narrative: text, approvedAt: at, draftMeta });
    return { text, draftMeta };
  };

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

  it('keeps the name with the approval (draft_meta.name)', () => {
    expect(approvedFor(ethan()).draftMeta.name).toBe('Ethan');
  });

  it('approved, then renamed: flagged on the card; Keep as Approved or Use the New Sentence', () => {
    const st = ethan();
    const { text: before } = approvedFor(st);
    expect(ETHAN.test(before)).toBe(true);
    reload();
    st.preferred = 'Zed';
    try {
      reload();
      let html = open(st);
      // Approved text is never changed for the teacher.
      expect(comment()).toBe(before);
      expect(getStudentTermRating(cid, st.id, 'term-2').approvedAt).toBeTruthy();
      let changes = RQ.staleFor(cid, st).changes;
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.every(c => c.kind === 'name' && ETHAN.test(c.before) && ZED.test(c.after))).toBe(true);
      expect(changes.map(c => c.before)).toContain(mine);
      expect(changes.find(c => c.before === mine).after).toBe('Zed helped clean up after the lab.');
      expect(html).toContain('Keep as Approved');
      expect(html).toContain('The name changed after');
      expect(RQ.approveBlockers(st)).toContain('claims');
      // Keep as Approved on one: it goes from the card, the comment stays approved.
      const kept = changes[0].before;
      RQ.tqStale('keep', 0);
      reload();
      open(st);
      changes = (RQ.staleFor(cid, st) || { changes: [] }).changes;
      expect(changes.map(c => c.before)).not.toContain(kept);
      expect(getStudentTermRating(cid, st.id, 'term-2').approvedAt).toBeTruthy();
      if (changes.length) {
        // Use the New Sentence: every sentence with the old name, and the approval goes.
        RQ.tqStale('use', 0);
        reload();
        open(st);
        const text = comment();
        expect(text).toContain(kept);
        expect(text.replace(kept, '')).not.toMatch(ETHAN);
        expect(text).toMatch(ZED);
        expect(getStudentTermRating(cid, st.id, 'term-2').approvedAt).toBeFalsy();
      }
    } finally {
      st.preferred = '';
    }
  });

  it('a name and pronoun change together: one card per sentence, with both', () => {
    const st = ethan();
    approvedFor(st);
    st.preferred = 'Zed';
    st.pronouns = 'she/her';
    try {
      reload();
      open(st);
      const changes = RQ.staleFor(cid, st).changes;
      const befores = changes.map(c => c.before);
      expect(new Set(befores).size).toBe(befores.length);
      expect(changes.some(c => c.kind === 'pronouns' && ETHAN.test(c.before) && ZED.test(c.after))).toBe(true);
      expect(changes.every(c => !ETHAN.test(c.after))).toBe(true);
      expect(RQ.staleNote(RQ.staleFor(cid, st), 'Nov 1')).toContain('The name and pronouns changed after Nov 1');
      // Use the New Sentence on one puts in every name and pronoun change.
      const marks = changes.filter(c => c.kind === 'marks').map(c => c.before);
      RQ.tqStale(
        'use',
        changes.findIndex(c => c.kind === 'pronouns'),
      );
      let text = comment();
      expect(text).not.toMatch(ETHAN);
      marks.forEach(t => {
        text = text.replace(t, '');
      });
      expect(text).not.toMatch(/\b(he|him|his|himself)\b/i);
    } finally {
      st.preferred = '';
      st.pronouns = 'he/him';
    }
  });

  it('a draft, then renamed: each sentence with the old name shows on its row until the teacher picks', () => {
    const st = ethan();
    const f = CommentBank.facts(cid, st, 'term-2');
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) + 3 });
    const drafted = d.text + ' ' + mine;
    upsertTermRating(cid, st.id, 'term-2', { narrative: drafted, approvedAt: null, draftMeta: null });
    reload();
    // Drawn with the name on file, then renamed with the questionnaire open (Edit Student).
    open(st);
    expect(ETHAN.test(drafted)).toBe(true);
    st.preferred = 'Zed';
    try {
      open(st);
      // The draft is not changed for the teacher.
      expect(comment()).toBe(drafted);
      let claims = RQ.claimChanges(st);
      expect(claims.length).toBeGreaterThan(0);
      expect(claims.every(c => c.kind === 'name' && ETHAN.test(c.before) && ZED.test(c.after))).toBe(true);
      expect(RQ.approveBlockers(st)).toContain('claims');
      claims.forEach(c => RQ.tqClaim('use', c.row));
      open(st);
      expect(comment()).not.toMatch(ETHAN);
      expect(comment()).toMatch(ZED);
      expect(RQ.claimChanges(st)).toEqual([]);
    } finally {
      st.preferred = '';
    }
  });

  it('a draft saved, the page reloaded, then renamed: still flagged (draft_meta.name from the save)', () => {
    const st = ethan();
    const f = CommentBank.facts(cid, st, 'term-2');
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) + 3 });
    upsertTermRating(cid, st.id, 'term-2', { narrative: '', approvedAt: null, draftMeta: null });
    reload();
    // The teacher's box autosaves the draft (tqSaveNarrative).
    const box = { value: d.text + ' ' + mine, dataset: { sid: st.id, cid, term: 'term-2' } };
    const getById = globalThis.document.getElementById;
    globalThis.document.getElementById = id => (id === 'tq-narrative' ? box : getById(id));
    globalThis.document.body = { classList: { add: () => {}, remove: () => {}, toggle: () => {} } };
    try {
      RQ.tqSaveNarrative();
    } finally {
      globalThis.document.getElementById = getById;
      delete globalThis.document.body;
    }
    expect(getStudentTermRating(cid, st.id, 'term-2').draftMeta).toMatchObject({ name: 'Ethan' });
    expect(getStudentTermRating(cid, st.id, 'term-2').approvedAt).toBeFalsy();
    reload();
    st.preferred = 'Zed';
    try {
      reload();
      open(st);
      const claims = RQ.claimChanges(st);
      expect(claims.length).toBeGreaterThan(0);
      expect(claims.every(c => c.kind === 'name' && ETHAN.test(c.before) && ZED.test(c.after))).toBe(true);
      expect(claims.map(c => c.before)).toContain(mine);
      // Keep as Written on one: it stays kept after a reload.
      const kept = claims[0].before;
      RQ.tqClaim('keep', claims[0].row);
      reload();
      open(st);
      expect(RQ.claimChanges(st).map(c => c.before)).not.toContain(kept);
    } finally {
      st.preferred = '';
    }
  });

  it('a sentence kept as approved is not flagged again on its row once the approval clears', () => {
    const st = ethan();
    approvedFor(st);
    st.preferred = 'Zed';
    try {
      reload();
      open(st);
      const kept = RQ.staleFor(cid, st).changes.find(c => c.kind === 'name').before;
      RQ.tqStale(
        'keep',
        RQ.staleFor(cid, st).changes.findIndex(c => c.before === kept),
      );
      // An edit clears the approval: the comment is a draft again.
      const r = getStudentTermRating(cid, st.id, 'term-2');
      upsertTermRating(cid, st.id, 'term-2', { narrative: RQ.plainComment(r.narrative) + ' The lab went well.' });
      expect(getStudentTermRating(cid, st.id, 'term-2').approvedAt).toBeFalsy();
      reload();
      open(st);
      const claims = RQ.claimChanges(st).map(c => c.before);
      expect(claims.length).toBeGreaterThan(0);
      expect(claims).not.toContain(kept);
    } finally {
      st.preferred = '';
    }
  });
});
