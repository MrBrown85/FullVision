/**
 * Every report surface drawn for one class, as text
 * (tests/report-surfaces-output.test.js, tests/report-score-seam.test.js):
 * what a family, a student or the teacher's printer is given, read through
 * the same functions the app calls.
 *
 * - Progress Reports: every block a report can print, with its default
 *   options, at both widths; the Focus Area picks; the letterhead.
 * - The Assessments list (GradeReport; the 'quick' parts, once the Quick
 *   Report): its rows, the summary by category, and the Feedback
 *   Pages (the cards, their rubric sheets, the extra cards).
 * - The Term Questionnaire: the facts, the header grade, the lists, the
 *   whole screen, the checks on a comment, and what Generate drafts.
 * - Sent to Phones: each student's phone copy.
 * - Print Grades: the pages, each way the scores can print.
 * - Export: every sheet of Download All My Data.
 *
 * Each is drawn for the year so far and as of each reporting term, the way
 * the Reports page sets the term before it draws.
 *
 * surfaces(cid) gives { 'view › surface › part': text }. The text is the
 * output itself; a test hashes it or searches it.
 *
 * freshGenerate() makes Generate forget the stories it has told, so the
 * same class drafts the same comments again.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { expect } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');

/* Generate remembers, for this session, the stories and strengths it has
   told each class, and picks the least used. Loading its file again starts
   that memory empty, as a reload of the page does. */
export function freshGenerate() {
  runInThisContext(readFileSync(resolve(ROOT, 'teacher/comment-bank.js'), 'utf-8'), {
    filename: 'teacher/comment-bank.js',
  });
}

/* Which of the five surfaces a part belongs to: the part's name starts with it. */
export const SURFACES = ['progress', 'quick', 'questionnaire', 'printGrades', 'export'];

let _exportLoaded = false;
function loadExport() {
  if (_exportLoaded || typeof ExportAll !== 'undefined') return;
  runInThisContext(readFileSync(resolve(ROOT, 'teacher/export-all.js'), 'utf-8'), {
    filename: 'teacher/export-all.js',
  });
  _exportLoaded = true;
}

// JSON with keys in the order they were made; functions are left out.
const text = value => (typeof value === 'string' ? value : JSON.stringify(value === undefined ? null : value));

/* The page as the Reports page has it while one report is in view: the term
   picker reads "Report N". Puts the old document back. */
function withReportPicked(ordinal, label, fn) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'document');
  const old = globalThis.document;
  const period = {
    value: ordinal == null ? '' : 'Report ' + ordinal,
    options: [{ text: label }],
    selectedIndex: 0,
  };
  globalThis.document = Object.assign({}, old, {
    getElementById: id => (id === 'report-period' ? period : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    activeElement: null,
    body: {},
  });
  try {
    return fn();
  } finally {
    if (had) globalThis.document = old;
    else delete globalThis.document;
  }
}

function progress(cid, students, ctx, out, view) {
  const autos = ReportBlocks.showDefaults(cid);
  // Assignment Grades and Missing Work are the Assessments part now (the
  // 'quick' surface): their ids are kept only so a saved form is read.
  Object.keys(ReportSheets.BLOCKS).forEach(id => {
    if (id === 'grade-table' || id === 'missing-work') return;
    ['row', 'half'].forEach(size => {
      const options = ReportSheets.optionsFor({ block: id, size }, autos);
      out[view + ' › progress › ' + id + ' (' + size + ')'] = students
        .map(st => st.id + '\n' + ReportBlocks.renderReportBlock(id, cid, st, ctx, options))
        .join('\n\n');
    });
  });
  out[view + ' › progress › focus area'] = text(
    students.map(st =>
      [undefined, 'focus', 'highest', 'lowest'].map(which => ReportBlocks.focusArea(cid, st, ctx, which)),
    ),
  );
  out[view + ' › progress › letterhead'] = students
    .map(
      st =>
        ReportBlocks.renderBlockHeader(cid, st, ctx, { name: 'preferred' }) +
        ReportBlocks.renderContinuedLine(cid, st, { name: 'preferred' }),
    )
    .join('\n');
}

function quick(cid, students, ctx, out, view, handout) {
  const assessments = getAssessments(cid);
  students.forEach(st => {
    const part = view + ' › quick › ' + st.id;
    const o = GradeReport.options({ ungraded: true, summary: true, comments: true, rubrics: true });
    const items = GradeReport.feedbackItems(cid, st, o);
    out[part] = text({
      rows: GradeReport.rows(cid, st, o),
      newestFirst: GradeReport.rows(cid, st, GradeReport.options({ order: 'newest' })),
      categories: GradeReport.categorySummary(cid, st, o),
      feedback: ReportFeedback.forStudent(cid, st, { order: 'oldest' }),
      cards: items.map(item => ReportFeedback.cardHtml(item, {})),
      extra: GradeReport.extraCards(cid, st, ctx, { observations: true, termComment: true }),
      observations: ReportFeedback.observations(cid, st, ctx.termId),
      termComment: ReportFeedback.termComment(cid, st, ctx.termId),
      // The rubric sheet itself, as Print Rubrics draws it: inside the handout's own surface, not a report.
      sheets: !handout
        ? undefined
        : ReportScores.withReportScores('handout', () =>
            assessments.map(a => {
              const sheet = RubricPrint.sheetData(cid, a.id, st.id);
              return (
                sheet && {
                  status: sheet.status,
                  scored: sheet.scored,
                  rows: sheet.rows.map(r => [r.criterion.id, r.level, r.mod, r.mixed, r.comment, r.beyond]),
                  overall: sheet.overall,
                  feedback: sheet.feedback,
                  ticked: sheet.ticked,
                }
              );
            }),
          ),
      comments: handout
        ? ReportScores.withReportScores('handout', () =>
            assessments.map(a => RubricPrint.feedbackItems(cid, st.id, a.id)),
          )
        : undefined,
    });
  });
}

function questionnaire(cid, students, ctx, out, view, ordinal) {
  const RQ = ReportQuestionnaire;
  withReportPicked(ordinal, ctx.termLabel, () => {
    RQ.configure({ activeCourse: cid, renderReports: () => {} });
    const roster = RQ.getTqStudents();
    students.forEach(st => {
      const part = view + ' › questionnaire › ' + st.id;
      const f = CommentBank.facts(cid, st, ctx.termId);
      const rating = getStudentTermRating(cid, st.id, ctx.termId) || {};
      const picks = { habits: rating.habits || {}, focus: rating.focusSectionId || f.focusId };
      const draft = CommentBank.draft(CommentBank.context(f, picks), {
        seed: CommentBank.seedFor(st.id + '|' + ctx.termId) + 1,
      });
      RQ.tqStudentIndex = roster.findIndex(s => s.id === st.id);
      out[part] = text({
        facts: f,
        hash: CommentBank.factsHash(f),
        header: RQ.headerGrade(cid, st.id, f, ctx.termId),
        notHandedIn: RQ.notHandedIn(cid, st.id),
        missingAndLate: RQ.missingAndLate(cid, st.id),
        glance: RQ.glanceRows(f),
        marked: CommentBank.markedCounts(cid, st.id, getAssessments(cid)),
        basis: RQ.basisChoices(f),
        generated: draft && draft.text,
        sentences: draft && (draft.sentences || []).map(s => [s.step, s.text]),
        stale: RQ.staleFor(cid, st, ctx.termId),
        claims: RQ.claimChanges(st),
        screen: RQ.renderTermQuestionnaire(cid),
      });
    });
  });
}

function printGrades(cid, out, view, ordinal) {
  const GP = GradesPrint;
  [{}, { scoresAs: 'proficiency' }, { scoresAs: 'percent' }, { scoresAs: 'both' }, { sortBy: 'first' }].forEach(o => {
    const opts = Object.assign(ordinal == null ? {} : { term: String(ordinal) }, o);
    const model = GP.buildModel(cid, opts);
    // The time printed reads in the runner's own time zone; the rest is the class's.
    expect(model.header.printed).toMatch(/\d/);
    model.header.printed = '(the time printed)';
    out[view + ' › printGrades › ' + JSON.stringify(o)] = GP.renderPages(model) + '\n' + text(GP.keyLines(model));
  });
}

function exported(cid, out, view) {
  loadExport();
  const sheets = ExportAll.rows({ cids: [cid], teacher: 'A Teacher', date: '2026-11-09' });
  out[view + ' › export › workbook'] = text(sheets);
}

/** Every surface for the class, for the year so far and as of each reporting term.
 * only: the surfaces to draw (all five without it). opts.handout false leaves
 * out the rubric sheets asked for as Print Rubrics asks, which are the
 * grader's handout and not part of a report. opts.students: draw only the
 * students with these ids (all of them without it). */
export function surfaces(cid, only, opts) {
  const want = name => !only || only.indexOf(name) >= 0;
  const handout = !(opts && opts.handout === false);
  const ids = opts && opts.students;
  const students = sortStudents(getStudents(cid), 'lastName').filter(s => !ids || ids.indexOf(s.id) >= 0);
  const was = getActiveTerm(cid);
  const out = {};
  try {
    [null].concat(getReportingTerms(cid).map(t => t.ordinal)).forEach(ordinal => {
      const term = getReportingTerms(cid).find(t => t.ordinal === ordinal);
      const view = ordinal == null ? 'year' : 'term-' + ordinal;
      // With no reporting term in view the picker reads Report 1, as a class with no terms has it.
      const ctx = { termId: 'term-' + (ordinal == null ? 1 : ordinal), termLabel: term ? term.label : 'Report 1' };
      setActiveTerm(cid, ordinal);
      if (want('progress')) progress(cid, students, ctx, out, view);
      if (want('quick')) quick(cid, students, ctx, out, view, handout);
      if (want('questionnaire')) questionnaire(cid, students, ctx, out, view, ordinal == null ? 1 : ordinal);
      // Print Grades sets its own period; Export reads the year so far.
      if (want('printGrades')) printGrades(cid, out, view, ordinal);
      if (want('export') && ordinal == null) exported(cid, out, view);
    });
  } finally {
    setActiveTerm(cid, was ? was.ordinal : null);
  }
  return out;
}

/** Which surface a part of surfaces() belongs to. */
export function surfaceOf(key) {
  return key.split(' › ')[1];
}
