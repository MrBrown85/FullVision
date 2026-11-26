#!/usr/bin/env node
// scripts/split/map.mjs — a map of one big file, for splitting it.
//
//   node scripts/split/map.mjs teacher/page-assignments.js          the sections
//   node scripts/split/map.mjs teacher/page-assignments.js --free   what can leave now
//   node scripts/split/map.mjs teacher/page-assignments.js --json   everything, as JSON
//   node scripts/split/map.mjs <file> --piece 120-480,900-1010      one candidate piece
//
// A section is the run of statements under a banner comment. For each it
// says what a move would take: the main file's functions it calls (each a
// one-line stand-in), the variables it shares, and what stops the move.
import { analyzeFile, pieceReport } from './analyze.mjs';

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
if (!file) {
  console.error('usage: node scripts/split/map.mjs <file> [--free] [--json] [--piece from-to,from-to]');
  process.exit(2);
}
const a = analyzeFile(file);
const flag = name => args.includes(name);
const short = (list, n = 6) =>
  list.length > n ? list.slice(0, n).join(', ') + ' +' + (list.length - n) : list.join(', ');

export function statementsIn(a, ranges) {
  const picked = [];
  for (const st of a.statements) {
    const hit = ranges.some(([from, to]) => st.from >= from && st.to <= to);
    const partly = ranges.some(([from, to]) => st.to >= from && st.from <= to);
    if (hit) picked.push(st.i);
    else if (partly) throw new Error('lines ' + st.from + '-' + st.to + ' are one statement; a range cuts through it');
  }
  return picked;
}

if (flag('--json')) {
  const plain = {
    file: a.file,
    lines: a.lines,
    closure: a.closure,
    sections: a.sections.map(s => ({ ...s, ...pieceReport(a, s.statements) })),
    statements: a.statements.map(s => ({
      i: s.i,
      type: s.type,
      from: s.from,
      to: s.to,
      declares: s.declares,
      reads: [...s.reads],
      assigns: [...s.assigns],
      changes: [...s.changes],
    })),
    names: Object.values(a.names).map(n => ({
      name: n.name,
      kind: n.kind,
      line: a.statements[n.declaredIn].own,
      reassignedIn: [...n.reassignedIn],
    })),
  };
  console.log(JSON.stringify(plain, null, 1));
} else if (args.includes('--piece')) {
  const ranges = args[args.indexOf('--piece') + 1].split(',').map(r => r.split('-').map(Number));
  const picked = statementsIn(a, ranges);
  const r = pieceReport(a, picked);
  console.log(`${picked.length} statements, ${r.lines} lines`);
  console.log('calls into the main file:', r.needs.fn.join(', ') || 'none');
  console.log('handed over once:', r.needs.fixed.join(', ') || 'none');
  console.log('the main file uses:', [...r.gives.fn, ...r.gives.fixed].join(', ') || 'none');
  console.log(r.blockers.length ? 'STOPPED BY:\n  ' + r.blockers.join('\n  ') : 'nothing stops this move');
} else {
  const names = Object.values(a.names);
  console.log(
    `${a.file}: ${a.lines} lines, ${a.closure ? 'one closure (' + a.closure.name + ')' : 'plain top-level code'}, ` +
      `${a.statements.length} statements, ${names.filter(n => n.kind === 'function').length} functions, ` +
      `${names.filter(n => n.kind !== 'function').length} variables (${names.filter(n => n.kind !== 'function' && n.reassignedIn.size).length} reassigned)`,
  );
  let free = 0;
  for (const s of a.sections) {
    const r = pieceReport(a, s.statements);
    const open = r.blockers.length === 0;
    if (open) free += r.lines;
    if (flag('--free') && !open) continue;
    console.log(
      `\n${s.id}  ${s.from}-${s.to}  ${r.lines} lines  ${open ? 'CAN LEAVE' : 'held'}  ${s.title}` +
        `\n    calls ${r.needs.fn.length}: ${short(r.needs.fn)}` +
        `\n    handed ${r.needs.fixed.length}: ${short(r.needs.fixed)}` +
        `\n    used by main ${r.gives.fn.length + r.gives.fixed.length}: ${short([...r.gives.fn, ...r.gives.fixed])}` +
        (open ? '' : `\n    stopped by ${r.blockers.length}: ${short(r.blockers, 4)}`),
    );
  }
  console.log(
    `\n${a.sections.length} sections; ${free} of ${a.lines} lines are in sections that can leave as they are.`,
  );
}
