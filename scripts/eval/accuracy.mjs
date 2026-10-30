#!/usr/bin/env node
/* The accuracy audit (plan PR 14; research report, section D, "Accuracy"):
 * runs Generate for each student and marks every wrong name, assignment
 * title, mark on a piece, count or grade in the draft against the
 * gradebook. The target is zero.
 *
 * Usage:
 *   node scripts/eval/accuracy.mjs --class <class.json> --out <folder>
 *        [--gold <gold.json>] [--edited <edited.json>] [--report <N>]
 *
 *   --class   the class file: get_class_bundle's data (scripts/eval/app.mjs)
 *   --gold    [{ studentName, comment }]: only these students are checked
 *             (all students when left out)
 *   --edited  [{ studentName, comment }]: the teacher's edited drafts, checked
 *             the same way ("zero errors after approval")
 *   --report  the report number (Report N), 1 when left out
 *   --out     a folder for accuracy.json: each error with its sentence
 *
 * Every path must be outside the FullVision folder. Only counts are printed.
 *
 * What is checked, each against FullVision's own facts (CommentBank.facts,
 * so calc.js for every grade):
 *   name    a classmate's name in the comment
 *   title   a quoted title that is no assignment in the class; one in a
 *           "not handed in" sentence that is not labelled Missing; one called
 *           the best or strongest that is not the student's highest mark; one
 *           given a mark the student has no mark on
 *   level   the mark printed beside a title is not the student's mark on it
 *   number  a count of work not handed in (and its group), classes missed,
 *           times late, assignments marked, competencies that fell from
 *           Extending, or a course % that is not the student's
 *   grade   the letter, its standing word, the "close to" letter, or the
 *           proficiency word for the course
 * Numerals nothing above explains are listed as "unchecked" for a person to
 * look at; they are not counted as errors. */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { assertOutsideRepo, readJson } from './app.mjs';
import { generateClass, matchEntries } from './generate.mjs';

export const ERROR_TYPES = ['name', 'title', 'level', 'number', 'grade'];

/* ── Reading numbers and titles ──────────────────────────────────────── */

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const NUMBER_WORD =
  '(?:\\d+|(?:' + TENS.slice(2).join('|') + ')(?:-(?:' + ONES.slice(1, 10).join('|') + '))?|' + ONES.join('|') + ')';

/* "three", "Twenty-one", "14" → a number; null when it is none. */
export function parseCount(word) {
  const w = String(word || '')
    .trim()
    .toLowerCase();
  if (/^\d+$/.test(w)) return Number(w);
  if (w === 'once') return 1;
  if (w === 'twice') return 2;
  const one = ONES.indexOf(w);
  if (one >= 0) return one;
  const m = w.match(/^([a-z]+)(?:-([a-z]+))?$/);
  if (!m) return null;
  const tens = TENS.indexOf(m[1]);
  if (tens < 2) return null;
  const unit = m[2] ? ONES.indexOf(m[2]) : 0;
  return unit >= 0 && unit < 10 ? tens * 10 + unit : null;
}

/* A title as the comment prints it (the lesson number dropped, no closing
   period), folded for comparing. */
function titleKey(title) {
  const R = globalThis.CommentRealiser;
  return R.workTitle(title)
    .replace(/[.\s]+$/, '')
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function fold(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/* ── What the gradebook says about one student ───────────────────────── */

/* Everything a comment can be checked against, from the facts Generate
   itself drafts from (CommentBank.facts) and the class's roster and
   assignment list. */
export function truthOf(cid, student, f, classStudents) {
  const g = globalThis;
  const CB = g.CommentBank;
  const own = new Set(
    [student.firstName, student.preferred, student.lastName]
      .filter(Boolean)
      .flatMap(n => String(n).split(/[\s-]+/))
      .map(fold),
  );
  const others = new Set();
  classStudents.forEach(s => {
    if (s.id === student.id) return;
    [s.firstName, s.preferred, s.lastName]
      .filter(Boolean)
      .flatMap(n => String(n).split(/[\s-]+/))
      .forEach(t => {
        if (t.length >= 2 && !own.has(fold(t))) others.add(t);
      });
  });
  const assessments = g.getAssessments(cid) || [];
  const titles = new Set(assessments.map(a => titleKey(a.title)));
  // A title written without quotes ("on the Unit 2 Test"): the full title or
  // the one the comment prints, eight characters or more, longest first.
  const plainTitles = [];
  assessments.forEach(a => {
    const key = titleKey(a.title);
    new Set([String(a.title || '').trim(), globalThis.CommentRealiser.workTitle(a.title)]).forEach(t => {
      t = t.replace(/[.\s]+$/, '');
      if (t.length >= 8) plainTitles.push({ text: t, key });
    });
  });
  plainTitles.sort((x, y) => y.text.length - x.text.length);
  // Each marked piece as the gradebook shows it: the cell (calc.js
  // assessmentCellValue: a % in a Letter class, points on points work), its
  // proficiency word, and the piece's % (calc.js), whichever the comment
  // prints.
  const pctOf = new Map(((f.grade && f.grade.pieces) || []).map(p => [p.id, p.pct]));
  const byId = new Map(assessments.map(a => [a.id, a]));
  const work = new Map();
  (f.work || []).forEach(w => {
    const cell = byId.has(w.id) ? g.assessmentCellValue(cid, student.id, byId.get(w.id)) : null;
    work.set(titleKey(w.title), {
      cell: cell ? cell.text : '',
      word: cell && cell.kind === 'level' ? g.levelWord(cid, cell.value) : '',
      pct: pctOf.has(w.id) ? pctOf.get(w.id) : null,
    });
  });
  const top = Math.max(0, ...(f.work || []).map(w => w.v));
  const best = new Set((f.work || []).filter(w => w.v === top).map(w => titleKey(w.title)));
  const gr = f.grade || {};
  const fell = (f.comps || []).filter(
    c => c.start > 0 && c.now > 0 && Math.round(c.start) === 4 && Math.round(c.now) === 3,
  ).length;
  return {
    others: [...others],
    titles,
    plainTitles,
    work,
    best,
    missing: new Set((f.notHandedIn.titles || []).map(titleKey)),
    notHandedIn: f.notHandedIn,
    mode: gr.mode,
    letter: gr.basis === 'ie' || gr.letter === 'IE' ? 'IE' : gr.letter || null,
    standing: gr.letter ? CB.STANDING[gr.letter] || null : null,
    // "Close to" holds only inside the plan's gate (CommentBank.closeTo).
    next: gr.mode !== 'proficiency' && CB.closeTo(gr) ? CB.closeTo(gr).letter : null,
    pct: gr.pct != null ? Number(gr.pct) : null,
    word: f.standing || null,
    course: f.course || '',
    absent: Number(f.absent) || 0,
    late: Number(f.late) || 0,
    marked: gr.marked || { mine: 0, all: 0 },
    fell,
  };
}

/* ── Checking one comment ────────────────────────────────────────────── */

/* The comment's sentences, each with its quoted titles taken out so a
   title's own punctuation never splits a sentence. */
function sentencesOf(text) {
  const quoted = [];
  // A title that ends in . ? or ! can end its sentence: \u0002 marks it.
  const masked = String(text || '').replace(/[“"]([^”"]+)[”"]/g, (m, t) => {
    quoted.push(t);
    return '\u0000' + (quoted.length - 1) + (/[.!?]$/.test(t) ? '\u0002' : '\u0000');
  });
  const title = /\u0000(\d+)[\u0000\u0002]/g;
  return masked
    .split(/(?<=[.!?\u0002])\s+(?=[A-Z\u0000])/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => {
      const titles = [];
      const plain = s.replace(title, (m, i) => {
        titles.push(quoted[Number(i)]);
        return ' \u0001 ';
      });
      return { text: s.replace(title, (m, i) => '“' + quoted[Number(i)] + '”'), plain, titles };
    });
}

const LEVEL_RE =
  /(?:\d+(?:\.\d+)?\s*·\s*)?(\d+(?:\.\d+)?)\s?%|\b(Emerging|Developing|Proficient|Extending)\b(?:\s?[+\-−](?![\w]))?/g;

function normLevel(s) {
  return String(s || '')
    .replace(/−/g, '-')
    .replace(/\s+/g, '')
    .toLowerCase();
}

function samePct(found, pct) {
  if (pct == null) return false;
  const x = Number(found);
  return Number.isInteger(x) && !/\./.test(String(found)) ? Math.abs(x - pct) < 0.5 : Math.abs(x - pct) < 0.05;
}

const STANDING_WORDS = 'excellent|very good|good|satisfactory|minimally acceptable';

/* Every error in one comment: { errors: [{ type, found, expected, sentence
   }], unchecked: [{ found, sentence }] }. */
export function checkComment(text, truth) {
  const errors = [];
  const unchecked = [];
  const err = (type, found, expected, sentence) => errors.push({ type, found, expected, sentence });

  sentencesOf(text).forEach(s => {
    const sentence = s.text;
    const plain = s.plain;
    // Spans already explained, so their numerals are not "unchecked".
    const used = [];
    const take = re => {
      const out = [];
      plain.replace(re, (...m) => {
        out.push(m);
        used.push([m[m.length - 2], m[m.length - 2] + m[0].length]);
        return m[0];
      });
      return out;
    };

    // Names: a classmate's name anywhere outside a title.
    truth.others.forEach(n => {
      if (new RegExp('(^|[^\\p{L}])' + escapeRe(n) + '(?![\\p{L}])', 'u').test(plain)) err('name', n, '', sentence);
    });

    // Titles: the quoted ones, or, in a sentence with none, any of the
    // class's titles written out without quotes. In the order written.
    let pieces = [];
    plain.replace(/\u0001/g, (m, at) => {
      const title = s.titles[pieces.length];
      pieces.push({ title, key: titleKey(title), at, quoted: true });
      return m;
    });
    if (!pieces.length) {
      const lower = plain.toLowerCase();
      truth.plainTitles.forEach(t => {
        const re = new RegExp('(^|[^\\p{L}\\d])' + escapeRe(t.text.toLowerCase()) + '(?![\\p{L}\\d])', 'gu');
        let m;
        while ((m = re.exec(lower))) {
          const at = m.index + m[1].length;
          const end = at + t.text.length;
          if (used.some(([a, b]) => at < b && end > a)) continue;
          used.push([at, end]);
          pieces.push({ title: plain.slice(at, end), key: t.key, at, quoted: false });
        }
      });
      pieces.sort((x, y) => x.at - y.at);
    }
    pieces.forEach(p => {
      if (p.quoted && !truth.titles.has(p.key)) err('title', p.title, 'an assignment in this class', sentence);
    });
    pieces = pieces.filter(p => truth.titles.has(p.key));
    const notIn = /not (?:yet )?(?:been )?handed in|not submitted|missing/i.test(plain);
    if (notIn) {
      pieces.forEach(p => {
        if (!truth.missing.has(p.key)) err('title', p.title, 'work labelled Missing', sentence);
      });
    }
    if (pieces.length === 1 && /\b(best|strongest)\b/i.test(plain) && !truth.best.has(pieces[0].key)) {
      err('title', pieces[0].title, 'one of the highest-marked pieces', sentence);
    }

    // Marks beside titles: paired in order when each title has one.
    const levels = take(LEVEL_RE);
    if (pieces.length && levels.length === pieces.length) {
      pieces.forEach((p, i) => {
        const expected = truth.work.get(p.key);
        const m = levels[i];
        if (expected == null) {
          err('title', p.title, 'a piece the student has a mark on', sentence);
          return;
        }
        // A % is the cell's % or the piece's % (calc.js); a proficiency word
        // is the cell's word.
        const cellPct = (String(expected.cell).match(/(\d+(?:\.\d+)?)%/) || [])[1];
        const ok =
          m[1] != null
            ? (expected.pct != null && samePct(m[1], expected.pct)) ||
              (cellPct != null && samePct(m[1], Number(cellPct)))
            : !!expected.word && normLevel(m[2]) === normLevel(expected.word).replace(/[+-]$/, '');
        const shown =
          m[1] != null
            ? [
                cellPct != null ? cellPct + '%' : '',
                expected.pct != null ? Math.round(expected.pct * 10) / 10 + '%' : '',
              ]
                .filter((v, i, all) => v && all.indexOf(v) === i)
                .join(' or ') || expected.cell
            : expected.word || expected.cell;
        if (!ok) err('level', m[0], shown, sentence);
      });
    } else if (!pieces.length) {
      // A course % with no title beside it: the student's grade.
      levels.forEach(m => {
        if (m[1] != null && !samePct(m[1], truth.pct))
          err('number', m[0], truth.pct == null ? 'no course %' : truth.pct + '%', sentence);
      });
    } else {
      levels.forEach(m => unchecked.push({ found: m[0], sentence }));
    }

    // Counts.
    const N = NUMBER_WORD;
    take(
      new RegExp(
        '\\b(' +
          N +
          '|an?) (?:assignments?|pieces? of work|tasks?)(?:, [^,]+,)? (?:is|are|has|have) not (?:yet )?(?:been )?handed in',
        'gi',
      ),
    ).forEach(m => {
      const n = /^an?$/i.test(m[1]) ? 1 : parseCount(m[1]);
      if (n !== truth.notHandedIn.count) err('number', m[0], String(truth.notHandedIn.count), sentence);
    });
    take(new RegExp('\\bincluding (' + N + ') (.+?) assignments', 'gi')).forEach(m => {
      const n = parseCount(m[1]);
      const group = (truth.notHandedIn.groups || []).find(gp => fold(gp.name) === fold(m[2]));
      if (!group || group.count !== n) err('number', m[0], group ? String(group.count) : 'no such group', sentence);
    });
    take(new RegExp('\\bmissed (' + N + ') class(?:es)?', 'gi')).forEach(m => {
      if (parseCount(m[1]) !== truth.absent) err('number', m[0], String(truth.absent), sentence);
    });
    take(new RegExp('\\blate (once|twice|' + N + ' times)', 'gi')).forEach(m => {
      if (parseCount(m[1].replace(/ times$/i, '')) !== truth.late) err('number', m[0], String(truth.late), sentence);
    });
    take(new RegExp('\\bmark on (' + N + ') of the (' + N + ') assignments', 'gi')).forEach(m => {
      if (parseCount(m[1]) !== truth.marked.mine || parseCount(m[2]) !== truth.marked.all) {
        err('number', m[0], truth.marked.mine + ' of ' + truth.marked.all, sentence);
      }
    });
    take(new RegExp('\\bExtending in (' + N + ') competencies', 'gi')).forEach(m => {
      if (parseCount(m[1]) !== truth.fell) err('number', m[0], String(truth.fell), sentence);
    });

    // The grade: the letter the student is earning, "close to" (or "within
    // reach of") the next one, and the standing word.
    take(/\b(?:close to|within reach of) (?:a|an) (A|B|C\+|C|C[-−]|F)(?![\w+\-−])/g).forEach(m => {
      if (m[1].replace('−', '-') !== truth.next)
        err('grade', m[0], truth.next ? 'close to ' + truth.next : 'not close to a band', sentence);
    });
    take(
      /\b(?:earning|earned|earns|has|have|getting|got|receiving|received|grade is|mark is)\s(?:an?\s)?(A|B|C\+|C|C[-−]|F|IE)(?![\w+\-−])/g,
    ).forEach(m => {
      if (m[1].replace('−', '-') !== truth.letter) err('grade', m[0], truth.letter || 'no letter grade', sentence);
    });
    if (/\bmark this term is IE\b/.test(plain) && truth.letter !== 'IE')
      err('grade', 'IE', truth.letter || '', sentence);
    const standing = '(' + STANDING_WORDS + ')';
    take(new RegExp('which is ' + standing + ' work|\\ban? ' + standing + ' standing', 'gi')).forEach(m => {
      const said = (m[1] || m[2]).toLowerCase();
      if (said !== truth.standing) err('grade', m[0], truth.standing || 'no standing word', sentence);
    });
    take(/\b(?:is|are) (\w+) on the BC proficiency scale/g).forEach(m => {
      if (m[1] !== truth.word) err('grade', m[0], truth.word || 'no proficiency word', sentence);
    });

    // Numerals nothing above explains (the course's own name, "History 12",
    // explains itself).
    if (truth.course) take(new RegExp(escapeRe(truth.course), 'g'));
    plain.replace(/\d+(?:\.\d+)?%?/g, (m, at) => {
      if (!used.some(([a, b]) => at >= a && at < b)) unchecked.push({ found: m, sentence });
      return m;
    });
  });
  return { errors, unchecked };
}

/* ── The run ─────────────────────────────────────────────────────────── */

function tally(results) {
  const counts = Object.fromEntries(ERROR_TYPES.map(t => [t, 0]));
  let unchecked = 0;
  results.forEach(r => {
    r.errors.forEach(e => (counts[e.type] = (counts[e.type] || 0) + 1));
    unchecked += r.unchecked.length;
  });
  const total = ERROR_TYPES.reduce((n, t) => n + counts[t], 0);
  return {
    comments: results.length,
    total,
    byType: counts,
    withErrors: results.filter(r => r.errors.length).length,
    unchecked,
  };
}

/* Generates for the class and checks the drafts (and the edited versions,
   when given). Returns { summary, students }: summary has counts only;
   students has each comment, its errors and the sentences behind them, so it
   is student data and stays on this computer. */
export function runAccuracy({ classData, gold, edited, report }) {
  const run = generateClass(classData, report);
  const { cid, students, drafts } = run;
  const byId = new Map(drafts.map(d => [d.student.id, d]));
  let chosen = drafts;
  let goldUnmatched = 0;
  if (gold) {
    const m = matchEntries(students, gold, 'The gold file');
    goldUnmatched = m.unmatched;
    chosen = m.matched.map(x => byId.get(x.student.id));
  }
  const editedBy = new Map();
  let editedUnmatched = 0;
  if (edited) {
    const m = matchEntries(students, edited, 'The edited file');
    editedUnmatched = m.unmatched;
    m.matched.forEach(x => editedBy.set(x.student.id, x.comment));
  }
  const out = chosen.map(d => {
    const truth = truthOf(cid, d.student, d.facts, students);
    const gen = checkComment(d.text, truth);
    const row = {
      student: globalThis.displayNameWithLast(d.student),
      generated: { text: d.text, angle: d.angle, verifierReplaced: d.replaced.length, ...gen },
    };
    if (editedBy.has(d.student.id))
      row.edited = { text: editedBy.get(d.student.id), ...checkComment(editedBy.get(d.student.id), truth) };
    return row;
  });
  const summary = {
    report: run.termId,
    students: out.length,
    goldUnmatched,
    generated: tally(out.map(r => r.generated)),
    verifierReplaced: out.reduce((n, r) => n + r.generated.verifierReplaced, 0),
  };
  if (edited) {
    summary.edited = tally(out.filter(r => r.edited).map(r => r.edited));
    summary.editedUnmatched = editedUnmatched;
  }
  return { summary, students: out };
}

/* ── Command line ────────────────────────────────────────────────────── */

export function parseArgs(argv, known) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const m = String(argv[i]).match(/^--([a-z-]+)$/);
    if (!m || known.indexOf(m[1]) < 0) throw new Error('Unknown argument: ' + argv[i]);
    const v = argv[i + 1];
    if (v == null || /^--/.test(v)) throw new Error('--' + m[1] + ' needs a value.');
    out[m[1]] = v;
    i++;
  }
  return out;
}

function line(name, t) {
  const types = ERROR_TYPES.map(k => k + ' ' + t.byType[k]).join(', ');
  return `${name}: ${t.total} errors in ${t.comments} comments (${t.withErrors} with any): ${types}; ${t.unchecked} numerals unchecked`;
}

export function main(argv) {
  const args = parseArgs(argv, ['class', 'gold', 'edited', 'out', 'report']);
  if (!args.class || !args.out) {
    throw new Error(
      'Usage: node scripts/eval/accuracy.mjs --class <class.json> --out <folder> [--gold <gold.json>] [--edited <edited.json>]',
    );
  }
  const outDir = assertOutsideRepo(args.out, 'The output folder');
  const result = runAccuracy({
    classData: readJson(args.class, 'The class file'),
    gold: args.gold ? readJson(args.gold, 'The gold file') : null,
    edited: args.edited ? readJson(args.edited, 'The edited file') : null,
    report: args.report,
  });
  mkdirSync(outDir, { recursive: true });
  const file = join(outDir, 'accuracy.json');
  writeFileSync(file, JSON.stringify(result, null, 2) + '\n');
  const s = result.summary;
  const lines = [
    line('Generated', s.generated),
    'Verifier replaced ' + s.verifierReplaced + ' sentences while drafting',
  ];
  if (s.edited) lines.push(line('Edited', s.edited));
  if (s.goldUnmatched) lines.push(s.goldUnmatched + ' gold entries matched no student');
  if (s.editedUnmatched) lines.push(s.editedUnmatched + ' edited entries matched no student');
  lines.push('Details: ' + file);
  return lines.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    console.log(main(process.argv.slice(2)));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
