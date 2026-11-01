#!/usr/bin/env node
/* The simulation (plan PR 13): runs Generate over Demo Mode's class and over
 * synthetic classes (scripts/eval/synthetic.mjs: invented names, several
 * kinds of class and grade modes) and reports
 *   - sentences never picked: bank sentences no draft used, each marked
 *     "never fit" (no student met its conditions) or "fit N, never picked"
 *     (it was in students' choices and lost to other sentences);
 *   - sentences over-picked: a sentence in more than CommentBank.USED_BY
 *     comments of one class, past the point the app calls it crowded;
 *   - near-identical pairs: CommentBank.nearIdentical() over each class's
 *     drafts, the class's own lines and the grade sentence set aside;
 *   - thin parts: CommentBank.bankStrength() for each class.
 * Synthetic data only: no real student data is read. The grade sentence,
 * the attendance sentence and the work not handed in have one wording per
 * fact, so they are not counted as over-picked.
 *
 * Usage:
 *   node scripts/eval/simulate.mjs [--presses <N>] [--kinds <a,b>] [--no-demo]
 *        [--out <folder>]
 *
 *   --presses  how many presses of Generate Comment per class (1 when left
 *              out): press 2 is the second version of every comment
 *   --kinds    the synthetic classes to run (all when left out): history12,
 *              english10, science9, math11, pe8, art11, foods10, career10
 *   --no-demo  leave out Demo Mode's class
 *   --out      a folder outside the FullVision folder for simulate.json */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { pathToFileURL } from 'url';
import { runInThisContext } from 'vm';
import { assertOutsideRepo, loadApp, loadClass, ROOT } from './app.mjs';
import { draftStudents } from './generate.mjs';
import { KINDS, syntheticClass } from './synthetic.mjs';

const DEMO_CID = 'sci8';
const DEMO_REPORTS = [1, 2];

/* Demo Mode's class, seeded as the app seeds it (shared/seed-data.js),
   which it does only into an empty data layer: any class loaded before is
   cleared first. */
export function loadDemo() {
  loadApp();
  const g = globalThis;
  const was = g.isDemoMode;
  g.isDemoMode = () => true;
  try {
    g.localStorage.clear();
    // data.js keeps these as script-level let/var, which only another
    // script can reach.
    runInThisContext('_useSupabase = false; COURSES = {}; _cache.courses = COURSES;', { filename: 'eval-demo' });
    runInThisContext(readFileSync(resolve(ROOT, 'shared/seed-data.js'), 'utf-8'), { filename: 'shared/seed-data.js' });
    g.seedIfNeeded();
  } finally {
    g.isDemoMode = was;
  }
  return g.sortStudents(g.getStudents(DEMO_CID) || [], 'lastName');
}

const nameOf = s => [s.preferred || s.firstName, s.lastName].filter(Boolean).join(' ');

/* One class, drafted `presses` times: what was picked, what could have
   been, the near-identical pairs and the thin parts. */
export function runClass(label, cid, termId, students, presses) {
  const CB = globalThis.CommentBank;
  const bank = globalThis.COMMENT_BANK;
  const strength = CB.bankStrength(cid, { termId, students });
  const steps = strength.parts.map(p => p.step);
  // How many students had each sentence among their choices for a part.
  const inPool = {};
  students.forEach(st => {
    const f = CB.facts(cid, st, termId);
    const rating = globalThis.getStudentTermRating(cid, st.id, termId) || {};
    const ctx = CB.context(f, { habits: rating.habits || {}, focus: rating.focusSectionId || f.focusId });
    const seen = {};
    CB.DRAFT_STEPS.forEach(step => {
      if (!step.groups) return;
      CB.stepPool(step, ctx, bank).forEach(s => {
        if (seen[s.id]) return;
        seen[s.id] = true;
        inPool[s.id] = (inPool[s.id] || 0) + 1;
      });
    });
  });
  const passes = [];
  for (let press = 1; press <= (presses || 1); press++) {
    const drafts = draftStudents(cid, termId, students, press);
    const picked = {};
    const stepOf = {};
    drafts.forEach(d =>
      d.sentences.forEach(x => {
        if (!bank.sentences.some(s => s.id === x.id)) return;
        picked[x.id] = (picked[x.id] || 0) + 1;
        stepOf[x.id] = x.step;
      }),
    );
    const comments = drafts.map(d => ({
      sid: d.student.id,
      name: d.facts.name,
      names: [d.student.firstName, d.student.preferred].filter(Boolean),
      text: d.text,
    }));
    const near = CB.nearIdentical(comments, { cid });
    const who = {};
    drafts.forEach(d => (who[d.student.id] = nameOf(d.student)));
    passes.push({
      press,
      picked,
      stepOf,
      replaced: drafts.reduce((n, d) => n + d.replaced.length, 0),
      near: near.map(p => ({ a: who[p.a], b: who[p.b], shared: p.shared })),
    });
  }
  const n = students.length;
  return {
    label,
    cid,
    termId,
    students: n,
    pairs: (n * (n - 1)) / 2,
    steps,
    inPool,
    passes,
    thin: strength.parts.filter(p => p.thin).map(p => ({ step: p.step, ...p.worst })),
  };
}

/* Everything, run in one process: Demo Mode first (loading a synthetic
   class clears the data layer), then each synthetic kind. opts: { demo:
   true, kinds: all, presses: 1 }. */
export function simulate(opts) {
  const o = Object.assign({ demo: true, kinds: Object.keys(KINDS), presses: 1 }, opts || {});
  const runs = [];
  if (o.demo) {
    const students = loadDemo();
    DEMO_REPORTS.forEach(r => {
      globalThis.setActiveTerm(DEMO_CID, r);
      runs.push(runClass('Demo Mode: Science 8, Report ' + r, DEMO_CID, 'term-' + r, students, o.presses));
    });
    globalThis.setActiveTerm(DEMO_CID, null);
  }
  o.kinds.forEach(kind => {
    const { cid, termId, students } = loadClass(syntheticClass(kind), 1);
    runs.push(runClass(KINDS[kind].name + ' (synthetic)', cid, termId, students, o.presses));
  });
  return summarise(runs);
}

/* The report across every run. */
export function summarise(runs) {
  const CB = globalThis.CommentBank;
  const bank = globalThis.COMMENT_BANK;
  const over = CB.USED_BY + 1;
  const total = {};
  const fit = {};
  runs.forEach(run => {
    Object.keys(run.inPool).forEach(id => (fit[id] = (fit[id] || 0) + run.inPool[id]));
    run.passes.forEach(p => Object.keys(p.picked).forEach(id => (total[id] = (total[id] || 0) + p.picked[id])));
  });
  const neverPicked = bank.sentences
    .filter(s => !total[s.id])
    .map(s => ({ id: s.id, group: s.group, text: s.text, fit: fit[s.id] || 0 }));
  const overPicked = [];
  runs.forEach(run =>
    run.passes.forEach(p =>
      Object.keys(p.picked).forEach(id => {
        if (p.picked[id] < over || run.steps.indexOf(p.stepOf[id]) < 0) return;
        const s = bank.sentences.find(x => x.id === id);
        overPicked.push({
          id,
          text: s.text,
          step: p.stepOf[id],
          class: run.label,
          press: p.press,
          comments: p.picked[id],
          students: run.students,
        });
      }),
    ),
  );
  overPicked.sort((a, b) => b.comments / b.students - a.comments / a.students || a.id.localeCompare(b.id));
  return {
    bank: bank.sentences.length,
    classes: runs.map(run => ({
      label: run.label,
      students: run.students,
      pairs: run.pairs,
      presses: run.passes.length,
      nearIdentical: run.passes.map(p => p.near),
      verifierReplaced: run.passes.reduce((n, p) => n + p.replaced, 0),
      thin: run.thin,
    })),
    neverPicked,
    overPicked,
    overAt: over,
  };
}

/* The report as plain text. */
export function formatReport(r) {
  const lines = [];
  const groups = {};
  r.neverPicked.forEach(s => (groups[s.group] = (groups[s.group] || 0) + 1));
  lines.push('Simulation: ' + r.classes.length + ' classes, ' + r.bank + ' bank sentences.');
  lines.push('');
  lines.push('Per class (near-identical = pairs sharing five or more sentences, per press):');
  r.classes.forEach(c => {
    const near = c.nearIdentical.map(n => n.length).join(', ');
    lines.push(
      '  ' +
        c.label +
        ': ' +
        c.students +
        ' students, near-identical ' +
        near +
        ' of ' +
        c.pairs +
        ' pairs' +
        (c.verifierReplaced ? ', ' + c.verifierReplaced + ' replaced by the verifier' : ''),
    );
    c.nearIdentical.forEach((pairs, i) =>
      pairs
        .slice(0, 3)
        .forEach(p => lines.push('      press ' + (i + 1) + ': ' + p.a + ' and ' + p.b + ', ' + p.shared + ' shared')),
    );
    c.thin.forEach(t =>
      lines.push(
        '      thin: ' +
          t.step +
          ', ' +
          t.sentences +
          (t.sentences === 1 ? ' sentence fits ' : ' sentences fit ') +
          t.students +
          ' students',
      ),
    );
  });
  lines.push('');
  lines.push('Never picked: ' + r.neverPicked.length + ' of ' + r.bank + '.');
  Object.keys(groups)
    .sort((a, b) => groups[b] - groups[a])
    .forEach(g => lines.push('  ' + g + ': ' + groups[g]));
  r.neverPicked.forEach(s =>
    lines.push('  ' + s.id + ' (' + (s.fit ? 'fit ' + s.fit + ', never picked' : 'never fit') + '): ' + s.text),
  );
  lines.push('');
  lines.push('Over-picked (in ' + r.overAt + ' or more comments of one class): ' + r.overPicked.length + '.');
  r.overPicked.forEach(o =>
    lines.push(
      '  ' +
        o.id +
        ' in ' +
        o.comments +
        ' of ' +
        o.students +
        ', ' +
        o.class +
        (o.press > 1 ? ' (press ' + o.press + ')' : '') +
        ': ' +
        o.text,
    ),
  );
  return lines.join('\n');
}

function parseArgs(argv) {
  const out = { demo: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--no-demo') out.demo = false;
    else if (a === '--presses') out.presses = Math.max(1, Math.floor(Number(argv[++i])) || 1);
    else if (a === '--kinds')
      out.kinds = String(argv[++i] || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);
    else if (a === '--out') out.out = argv[++i];
    else throw new Error('Unknown option ' + a + '. See the usage at the top of scripts/eval/simulate.mjs.');
  }
  (out.kinds || []).forEach(k => {
    if (!KINDS[k]) throw new Error('No synthetic class "' + k + '". Kinds: ' + Object.keys(KINDS).join(', '));
  });
  return out;
}

export function main(argv) {
  const args = parseArgs(argv);
  const r = simulate(args);
  if (args.out) {
    const dir = assertOutsideRepo(args.out, 'The --out folder');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'simulate.json'), JSON.stringify(r, null, 2));
  }
  return r;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  try {
    console.log(formatReport(main(process.argv.slice(2))));
  } catch (e) {
    console.error(e.message);
    process.exit(1);
  }
}
