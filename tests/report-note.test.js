/**
 * The Note for the Report (Generate plan, PR 7; migrations/20261031_score_report_note.sql):
 * one line about what the student did on a piece of work, stored on
 * score.report_note, cached as `reportNote` on the student's score entries,
 * read from the class bundle's seventh score value, written through
 * save_score_report_note with an idempotency key, and used by the comment's
 * best-piece sentence.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const CID = '11111111-1111-1111-1111-111111111111';
const AID = '22222222-2222-4222-8222-222222222222';
const SID = '33333333-3333-4333-8333-333333333333';
const SID2 = '44444444-4444-4444-8444-444444444444';
const TAG_1 = '88888888-8888-4888-8888-888888888888';
const TAG_2 = '99999999-9999-4999-8999-999999999999';

function seedClass() {
  saveStudents(CID, [
    { id: SID, firstName: 'Ada', lastName: 'Lovelace' },
    { id: SID2, firstName: 'Alan', lastName: 'Turing' },
  ]);
  saveAssessments(CID, [
    { id: AID, title: 'Levels lab', date: '2026-10-03', type: 'summative', tagIds: [TAG_1, TAG_2], rubricId: '' },
  ]);
  saveScores(CID, {
    [SID]: [
      { id: 'e1', assessmentId: AID, tagId: TAG_1, score: 3, date: '2026-10-03', type: 'summative', note: 'Good lab.' },
      { id: 'e2', assessmentId: AID, tagId: TAG_2, score: 4, date: '2026-10-03', type: 'summative', note: 'Good lab.' },
    ],
  });
}

describe('the note in the data layer', () => {
  var originalGetSupabase;
  var originalUseSupabase;
  var client;

  beforeEach(() => {
    localStorage.clear();
    ['scores', 'assessments', 'students'].forEach(function (field) {
      if (_cache[field]) delete _cache[field][CID];
    });
    seedClass();
    originalGetSupabase = getSupabase;
    originalUseSupabase = _useSupabase;
    _useSupabase = true;
    _teacherId = 'teacher-uuid';
    client = {
      calls: [],
      rpc(name, payload) {
        client.calls.push({ name: name, payload: payload || {} });
        return Promise.resolve({ data: null, error: null });
      },
    };
    globalThis.getSupabase = () => client;
  });

  afterEach(() => {
    globalThis.getSupabase = originalGetSupabase;
    _useSupabase = originalUseSupabase;
  });

  const noteCalls = () => client.calls.filter(c => c.name === 'save_score_report_note');

  it('has no note until one is saved', () => {
    expect(getScoreReportNote(CID, SID, AID)).toBe('');
  });

  it('saves on every entry of the work, keeps the overall comment, and sends save_score_report_note', () => {
    saveScoreReportNote(CID, SID, AID, '  linked the poster   to the Act  ');
    expect(getScoreReportNote(CID, SID, AID)).toBe('linked the poster to the Act');
    getScores(CID)[SID].forEach(function (e) {
      expect(e.reportNote).toBe('linked the poster to the Act');
      expect(e.note).toBe('Good lab.');
    });
    expect(JSON.parse(localStorage.getItem('gb-scores-' + CID))[SID][0].reportNote).toBe(
      'linked the poster to the Act',
    );
    const calls = noteCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].payload).toMatchObject({
      p_enrollment_id: SID,
      p_assessment_id: AID,
      p_note: 'linked the poster to the Act',
    });
  });

  it('sends an idempotency key, the same one on a retry of the queued write', () => {
    saveScoreReportNote(CID, SID, AID, 'showed each step');
    const key = noteCalls()[0].payload.p_idempotency_key;
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(FV_IDEMPOTENT_RPCS.save_score_report_note).toBe(true);
  });

  it('clears the note with an empty string, sending null', () => {
    saveScoreReportNote(CID, SID, AID, 'showed each step');
    saveScoreReportNote(CID, SID, AID, '   ');
    expect(getScoreReportNote(CID, SID, AID)).toBe('');
    getScores(CID)[SID].forEach(function (e) {
      expect('reportNote' in e).toBe(false);
    });
    expect(noteCalls()[1].payload.p_note).toBeNull();
  });

  it('does nothing when the note is unchanged', () => {
    saveScoreReportNote(CID, SID, AID, 'showed each step');
    saveScoreReportNote(CID, SID, AID, 'showed each step ');
    expect(noteCalls()).toHaveLength(1);
  });

  it('keeps at most 300 characters', () => {
    saveScoreReportNote(CID, SID, AID, 'x'.repeat(320));
    expect(getScoreReportNote(CID, SID, AID)).toHaveLength(300);
  });

  it('writes nothing for work with no score entry', () => {
    expect(saveScoreReportNote(CID, SID2, AID, 'linked two sources')).toBe(false);
    expect(getScoreReportNote(CID, SID2, AID)).toBe('');
    expect(noteCalls()).toHaveLength(0);
  });

  it('stores the note locally and sends nothing in Demo Mode', () => {
    const original = globalThis.isDemoMode;
    globalThis.isDemoMode = () => true;
    try {
      saveScoreReportNote(CID, SID, AID, 'linked two sources');
      expect(getScoreReportNote(CID, SID, AID)).toBe('linked two sources');
      expect(noteCalls()).toHaveLength(0);
    } finally {
      globalThis.isDemoMode = original;
    }
  });

  it('queues and coalesces like the other score writes', () => {
    const queue = readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8');
    const coalesce = queue.slice(queue.indexOf('var COALESCE_ENDPOINTS'), queue.indexOf('function _target'));
    expect(coalesce).toContain('save_score_report_note: true');
  });
});

describe('the note in the class bundle', () => {
  beforeEach(() => {
    localStorage.clear();
    ['scores', 'assessments', 'students'].forEach(function (field) {
      if (_cache[field]) delete _cache[field][CID];
    });
    seedClass();
  });

  const gb = scoreRow => ({
    students: [{ enrollment_id: SID }],
    assessments: [{ id: AID }],
    tag_index: [TAG_1],
    criterion_index: [],
    score_rows: [scoreRow],
    tag_rows: [[0, 0, 0, 3, 0, null]],
    criterion_rows: [],
  });

  it('reads the seventh score value as the note', () => {
    const cells = _bundleCells(gb([0, 0, 3, null, 'Good lab.', 0, 'linked two sources']));
    expect(cells[SID][AID].score.report_note).toBe('linked two sources');
    const cache = _gradebookCellsToScoreCache(CID, getAssessments(CID), cells);
    expect(cache.scores[SID][0].reportNote).toBe('linked two sources');
    expect(cache.scores[SID][0].note).toBe('Good lab.');
  });

  it('reads a six-value score row, from before the migration, as no note', () => {
    const cells = _bundleCells(gb([0, 0, 3, null, 'Good lab.', 0]));
    expect(cells[SID][AID].score.report_note).toBeNull();
    const cache = _gradebookCellsToScoreCache(CID, getAssessments(CID), cells);
    expect('reportNote' in cache.scores[SID][0]).toBe(false);
  });
});

describe('the best-piece sentence', () => {
  const he = ReportBlocks.getPronouns({ pronouns: 'he/him' });
  const they = ReportBlocks.getPronouns({ pronouns: 'they/them' });
  const S = o => CommentBank.bestPieceSentence(o);

  it('reads as the mockup with a note and pronouns on file', () => {
    expect(
      S({
        title: '4.3 What Does the Poster Show, and What Does It Hide?',
        note: 'linked Animal Farm to false equality and Trotsky’s erasure',
        name: 'Gabriel',
        pronouns: he,
        onFile: true,
      }),
    ).toBe(
      'His best piece was “What Does the Poster Show, and What Does It Hide?”, where he linked Animal Farm to false equality and Trotsky’s erasure.',
    );
  });

  it('uses they/them when no pronouns are on file, the same as they/them on file (Colin, Nov 1)', () => {
    expect(S({ title: 'Trench Letter', note: 'wrote from a soldier’s view', name: 'Chris', pronouns: they })).toBe(
      'Their best piece was “Trench Letter”, where they wrote from a soldier’s view.',
    );
    // The grader's Note for the Report preview reads the same sentence.
    expect(
      S(
        Object.assign(
          { title: 'Trench Letter', note: 'wrote from a soldier’s view' },
          CommentBank.studentRef({ firstName: 'Chris', pronouns: '' }),
        ),
      ),
    ).toBe('Their best piece was “Trench Letter”, where they wrote from a soldier’s view.');
  });

  it('uses singular they when on file', () => {
    expect(
      S({ title: 'Trench Letter', note: 'wrote from a soldier’s view', name: 'Sam', pronouns: they, onFile: true }),
    ).toBe('Their best piece was “Trench Letter”, where they wrote from a soldier’s view.');
  });

  it('without a note ends inside the quotes, keeping a title’s own question mark', () => {
    expect(S({ title: '4.3 What Does the Poster Show?', name: 'Ava', pronouns: they })).toBe(
      'Their best piece was “What Does the Poster Show?”',
    );
    expect(S({ title: 'Trench Letter', note: '   ', name: 'Ava', pronouns: they })).toBe(
      'Their best piece was “Trench Letter.”',
    );
  });

  it('starts the note lower case and ends it with one period', () => {
    expect(S({ title: 'Map Quiz', note: 'Labelled every river.', name: 'Ava', pronouns: they })).toBe(
      'Their best piece was “Map Quiz”, where they labelled every river.',
    );
    expect(S({ title: 'Map Quiz', note: 'Built a DNA model to scale', name: 'Ava', pronouns: they })).toBe(
      'Their best piece was “Map Quiz”, where they built a DNA model to scale.',
    );
  });

  it('leaves out a note that does not start with a past-tense verb, so the sentence takes its no-note form', () => {
    expect(S({ title: 'Graphs Lab', note: 'clear graphs and a careful method', name: 'Ava', pronouns: they })).toBe(
      'Their best piece was “Graphs Lab.”',
    );
    expect(S({ title: 'Map Quiz', note: 'DNA model built to scale', name: 'Ava', pronouns: they })).toBe(
      'Their best piece was “Map Quiz.”',
    );
    expect(CommentBank.reportNoteText('Clear graphs and a careful method.')).toBe('');
    expect(CommentBank.reportNoteText('Showed clear graphs and a careful method.')).toBe(
      'showed clear graphs and a careful method',
    );
  });
});

describe('the past-tense check (teacher/comment-lint.js, shared by the grader card and the engine)', () => {
  const ok = CommentLint.startsPastTense;
  it('passes a first word ending in -ed, or an irregular past form, whatever its case', () => {
    expect(ok('linked Animal Farm to false equality')).toBe(true);
    expect(ok('Labelled every river.')).toBe(true);
    expect(ok('  wrote from a soldier’s view')).toBe(true);
    expect(ok('Built a DNA model to scale')).toBe(true);
    expect(ok('understood the source')).toBe(true);
    ['drew', 'chose', 'read', 'put', 'set', 'used', 'began', 'brought', 'ran', 'won', 'went'].forEach(w =>
      expect(ok(w + ' it well')).toBe(true),
    );
    expect(CommentLint.PAST_FORMS).toContain('showed');
    expect(new Set(CommentLint.PAST_FORMS).size).toBe(CommentLint.PAST_FORMS.length);
  });
  it('fails a note that starts with anything else, and an empty one', () => {
    expect(ok('clear graphs and a careful method')).toBe(false);
    expect(ok('DNA model built to scale')).toBe(false);
    expect(ok('links two sources')).toBe(false);
    expect(ok('writes with care')).toBe(false);
    expect(ok('a careful method')).toBe(false);
    expect(ok('')).toBe(false);
    expect(ok('   ')).toBe(false);
    expect(ok(null)).toBe(false);
  });
});

describe('the engine uses the note only when it passes the check', () => {
  const f = (note, pronouns) => ({
    name: 'Gabriel',
    pronouns: ReportBlocks.getPronouns({ pronouns: pronouns || '' }),
    pronounsOnFile: !!pronouns,
    comps: [],
    work: [
      { id: 'a1', title: '4.2 Map Quiz', d: '2026-10-01', v: 3, note: 'labelled every river' },
      { id: 'a2', title: '4.3 What Does the Poster Show?', d: '2026-10-20', v: 4, note: note },
    ],
    record: { total: 0, handed: 0, late: 0, missing: 0 },
    obs: [],
    voice: {},
    confidence: [],
    habits: {},
    levelText: () => 'Extending',
  });
  it('drafts the no-note form for a note that is not a past-tense phrase, and never prints the note', () => {
    const ctx = CommentBank.context(f('clear graphs and a careful method', 'he/him'), {});
    expect(ctx.bestPiece).toBe('His best piece was “What Does the Poster Show?”');
    expect(ctx._bestNote).toBe(false);
    for (let seed = 1; seed < 12; seed++) {
      const text = CommentBank.draft(ctx, { seed }).text;
      expect(text).not.toContain('clear graphs');
      expect(text).not.toContain(', where he');
    }
  });
  it('verify() reads the note the same way: a draft with the note stands only while the note passes', () => {
    const good = f('showed clear graphs and a careful method', 'he/him');
    const d = CommentBank.draft(CommentBank.context(good, {}), { seed: 3 });
    expect(d.text).toContain(', where he showed clear graphs and a careful method.');
    expect(CommentBank.verify(d, good, {}).replaced).toEqual([]);
    const bad = f('clear graphs and a careful method', 'he/him');
    const r = CommentBank.verify(d, bad, {});
    expect(r.replaced.map(x => x.sentenceId)).toContain('n36');
    expect(r.text).not.toContain('clear graphs');
    // The same note, now a past-tense phrase, verifies as drafted.
    expect(CommentBank.verify(CommentBank.draft(CommentBank.context(bad, {}), { seed: 3 }), bad, {}).replaced).toEqual(
      [],
    );
  });
});

describe('the grader card’s hint', () => {
  const src = readFileSync(resolve(root, 'teacher/page-assignments.js'), 'utf-8');
  const css = readFileSync(resolve(root, 'teacher/assignments.css'), 'utf-8');
  it('turns orange when the note does not start with a past-tense verb, saving the note anyway', () => {
    const preview = src.slice(src.indexOf('function _reportNotePreview('), src.indexOf('function _saveReportNote('));
    expect(preview).toContain('CommentLint.startsPastTense(typed)');
    expect(preview).toContain("preview.classList.toggle('warn', off)");
    expect(preview).toContain("hint.className = 'grader-report-note-hint'");
    expect(css).toContain('.grader-report-note-preview.warn .grader-report-note-hint');
    expect(css).toMatch(
      /\.grader-report-note-preview\.warn \.grader-report-note-hint \{\n  color: var\(--score-2-text\);/,
    );
    const save = src.slice(src.indexOf('function _saveReportNote('), src.indexOf('function _graderGrade('));
    expect(save).toContain('saveScoreReportNote(cid, sid, aid, input.value)');
    expect(save).not.toContain('startsPastTense');
  });
});

describe('the best-piece sentence, without a title', () => {
  const they = ReportBlocks.getPronouns({ pronouns: 'they/them' });
  const S = o => CommentBank.bestPieceSentence(o);

  it('drops the lesson number, not a number that is the title', () => {
    expect(CommentBank.workTitle('4.3 What Does the Poster Show?')).toBe('What Does the Poster Show?');
    expect(CommentBank.workTitle('Lesson 2: Trench Life')).toBe('Trench Life');
    expect(CommentBank.workTitle('3. Map Quiz')).toBe('Map Quiz');
    expect(CommentBank.workTitle('1984 Essay')).toBe('1984 Essay');
    expect(CommentBank.workTitle('12')).toBe('12');
  });

  it('is nothing without a title', () => {
    expect(S({ title: '', note: 'linked two sources', name: 'Ava', pronouns: they })).toBe('');
  });
});

describe('the comment engine', () => {
  const f = (work, pronouns) => ({
    name: 'Gabriel',
    pronouns: ReportBlocks.getPronouns({ pronouns: pronouns || '' }),
    pronounsOnFile: !!pronouns,
    comps: [],
    work: work,
    record: { total: 0, handed: 0, late: 0, missing: 0 },
    obs: [],
    voice: {},
    confidence: [],
    habits: {},
    levelText: () => 'Extending',
  });
  const work = note => [
    { id: 'a1', title: '4.2 Map Quiz', d: '2026-10-01', v: 3, note: 'labelled every river' },
    { id: 'a2', title: '4.3 What Does the Poster Show?', d: '2026-10-20', v: 4, note: note },
  ];

  it('gives the best piece with its note', () => {
    const ctx = CommentBank.context(f(work('linked the poster to the Act'), 'he/him'), {});
    expect(ctx.bestPiece).toBe(
      'His best piece was “What Does the Poster Show?”, where he linked the poster to the Act.',
    );
  });

  it('gives the no-note form when the best piece has none, never another piece’s note', () => {
    const ctx = CommentBank.context(f(work(''), 'he/him'), {});
    expect(ctx.bestPiece).toBe('His best piece was “What Does the Poster Show?”');
  });

  it('gives nothing with no marked work', () => {
    expect(CommentBank.context(f([]), {}).bestPiece).toBe('');
  });

  it('puts the best-piece sentence with the note in the draft', () => {
    const ctx = CommentBank.context(f(work('linked the poster to the Act'), 'he/him'), {});
    // No grade sentence here (no marks), so the best piece leads and
    // names him.
    for (let seed = 1; seed < 20; seed++) {
      expect(CommentBank.draft(ctx, { seed }).text).toContain(
        'Gabriel’s best piece was “What Does the Poster Show?”, where he linked the poster to the Act.',
      );
    }
  });

  it('verifies the sentence against the facts, and replaces it once the note changes', () => {
    const facts = f(work('linked the poster to the Act'), 'he/him');
    const d = CommentBank.draft(CommentBank.context(facts, {}), { seed: 3 });
    const at = d.ids.indexOf('n36');
    expect(at).toBeGreaterThanOrEqual(0);
    expect(d.provenance[at].factKeys).toContain('work:a2');
    expect(CommentBank.verify(d, facts, {}).replaced).toEqual([]);
    const edited = f(work('showed each step'), 'he/him');
    const r = CommentBank.verify(d, edited, {});
    expect(r.replaced.map(x => x.sentenceId)).toContain('n36');
  });

  it('reads the note from the data layer in facts()', () => {
    const src = readFileSync(resolve(root, 'teacher/comment-bank.js'), 'utf-8');
    const facts = src.slice(src.indexOf('function facts('), src.indexOf('function focusOptions('));
    expect(facts).toContain('getScoreReportNote(cid, sid, a.id)');
    expect(facts).toContain('pronounsOnFile');
  });
});

describe('the grader card', () => {
  const src = readFileSync(resolve(root, 'teacher/page-assignments.js'), 'utf-8');
  const css = readFileSync(resolve(root, 'teacher/assignments.css'), 'utf-8');

  it('sits under the grading with the mockup’s wording', () => {
    const at = src.indexOf('<div class="grader-body"></div>');
    const card = src.indexOf('<section class="grader-report-note"');
    expect(at).toBeGreaterThan(0);
    expect(card).toBeGreaterThan(at);
    expect(src).toContain('Note for the Report</h2>');
    expect(src).toContain('Optional. One line about what the student did, written about them, not to them.');
    expect(src).toContain('aria-label="Note for the report"');
    expect(src).toContain('When this is the student\\u2019s best piece, the comment reads: \\u201C');
    expect(src).toContain(
      'Start with what the student did, like \\u201Clinked \\u2026\\u201D or \\u201Cshowed \\u2026\\u201D.',
    );
  });

  it('saves on change and on Enter, and previews on every key', () => {
    const open = src.slice(src.indexOf('function openGrader('), src.indexOf('function _graderKeydown('));
    expect(open).toContain('_reportNotePreview(e.target)');
    expect(open).toContain('_saveReportNote(e.target)');
    expect(open).toContain("e.key !== 'Enter'");
  });

  it('explains itself on hover, and waits for a score', () => {
    expect(src).toContain('input.title = scored ? _REPORT_NOTE_TITLE : _REPORT_NOTE_LOCKED_TITLE');
    expect(css).toContain('.grader-report-note[hidden]');
  });
});
