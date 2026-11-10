/**
 * Which functions in each report file ask calc.js for a grade, pinned
 * (S2-F1; the S2-T1 review's first point).
 *
 * The seam's behaviour tests watch calc.js while the report surfaces are
 * drawn, so they only see what those draws reach. A new function in a
 * report file that asks calc.js for a grade from somewhere they never run
 * (a dialog, a count beside a button) would pass them, and on returned
 * grades it would count drafts. This reads the source instead: every call a
 * report file makes to a calc.js function that reads grades, by the
 * function it sits in. A function new to this list must be one that runs
 * inside withReportScores (one of the file's doors, or reached only from
 * them), and is added here with that said in review.
 *
 *   UPDATE_REPORT_CALC_CALLERS=1 npx vitest run tests/report-calc-callers.test.js
 *   prints the list as it is now.
 */
import './setup.js';
import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_FILE =
  /^(page-reports|report-.*|comment-.*|grade-report|grades-print|rubric-print|phone-reports|export-all)\.js$/;
const FILES = readdirSync(resolve(ROOT, 'teacher'))
  .filter(name => REPORT_FILE.test(name) && name !== 'report-scores.js')
  .map(name => 'teacher/' + name)
  .concat(['shared/phone-report-view.js'])
  .sort();

// calc.js functions that read no score (as tests/report-score-seam.test.js lists them).
const NO_SCORE = new Set(['courseGradeMode', 'formatLevel', 'levelWord', 'getActiveTerm', 'setActiveTerm']);
const CALC = new Set(Object.keys(Calc).filter(name => !NO_SCORE.has(name)));

/* { functionName: [calc functions it calls] } for one file. A call outside
   any named function is filed under '(top level)'. */
function callers(source) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'script' });
  const out = {};
  const walk = (node, owner) => {
    if (!node || typeof node.type !== 'string') return;
    let here = owner;
    if (node.type === 'FunctionDeclaration' && node.id) here = node.id.name;
    if (
      node.type === 'VariableDeclarator' &&
      node.id.type === 'Identifier' &&
      node.init &&
      /Function/.test(node.init.type)
    )
      here = node.id.name;
    if (node.type === 'Property' && node.key && /Function/.test((node.value || {}).type || ''))
      here = node.key.name || node.key.value || here;
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && CALC.has(node.callee.name)) {
      const list = (out[here] = out[here] || []);
      if (list.indexOf(node.callee.name) < 0) list.push(node.callee.name);
    }
    Object.keys(node).forEach(key => {
      const value = node[key];
      if (Array.isArray(value)) value.forEach(child => walk(child, here));
      else if (value && typeof value.type === 'string') walk(value, here);
    });
  };
  walk(ast, '(top level)');
  const sorted = {};
  Object.keys(out)
    .sort()
    .forEach(name => (sorted[name] = Object.keys(out[name]).length ? out[name].slice().sort() : []));
  return sorted;
}

const now = () => {
  const map = {};
  FILES.forEach(file => {
    const found = callers(readFileSync(resolve(ROOT, file), 'utf-8'));
    if (Object.keys(found).length) map[file] = Object.keys(found);
  });
  return map;
};

/* The functions, file by file, that ask calc.js for a grade today. Each
   runs inside withReportScores: it is one of the file's doors (pinned in
   tests/report-score-seam.test.js), or it is reached only from one. */
const PINNED = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/report-calc-callers.json'), 'utf-8'));

describe('the functions in report files that ask calc.js for a grade', () => {
  it('are the ones pinned', () => {
    if (process.env.UPDATE_REPORT_CALC_CALLERS === '1') {
      console.log(JSON.stringify(now(), null, 2));
      return;
    }
    expect(now()).toEqual(PINNED);
  });

  it('page-reports.js asks calc.js only from inside the seam', () => {
    // The Reports page itself draws through the blocks; the one function of its own that asks is a door.
    expect(PINNED['teacher/page-reports.js']).toEqual(['_draftsInPrint']);
    expect(readFileSync(resolve(ROOT, 'teacher/page-reports.js'), 'utf-8')).toContain(
      '_draftsInPrint = _inReportScores(_draftsInPrint);',
    );
  });

  it('sees a new function that asks', () => {
    const found = callers(
      '(function () { function _issueCounts(cid, sid) { return getOverallProficiency(cid, sid); } var x = function () { formatLevel(1); }; })();',
    );
    expect(found).toEqual({ _issueCounts: ['getOverallProficiency'] });
  });
});
