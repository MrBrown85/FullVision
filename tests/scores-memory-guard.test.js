/**
 * The guard on the Draft and Returned rule's one-cell way (PR #1434).
 *
 * After a score click the rule compares only the cell that changed while
 * the saved copy of the class's scores is this tab's own
 * (_savedScoresAreMine, shared/data.js): the text in storage is letter for
 * letter what this tab last read or wrote, _scoresApart is down, and
 * memory holds no rubric score under a competency. That is right only if
 * every change to the scores in memory (_cache.scores[cid], what
 * getScores(cid) hands back) is saved to storage or raises _scoresApart.
 * A change that does neither leaves another student's grade changed in
 * memory but not compared: a returned grade would stay Returned, and the
 * change would show on the student's page.
 *
 * This file holds the source to that. tests/helpers/scores-mutations.js
 * finds every place in shared/, teacher/, teacher-mobile/ and s/ that
 * changes the scores in memory in place. Each must be listed in ALLOWED
 * below, with its reason and how memory and storage agree again:
 * - 'saves': a whole-list save comes after every change in the function
 *   (saveScores, _saveCourseField, _safeLSSet on 'gb-scores-…', or a
 *   function that calls one, such as Grader.undoCell).
 * - 'apart': the function raises _scoresApart['gb-scores-' + cid].
 * - 'callers': the function does not save; every call to it that passes a
 *   live value is followed by a save in the caller, or the caller raises
 *   _scoresApart.
 * - 'load': memory is set from the saved copy, read with keep on
 *   (_safeParseLS(…, true)), so the two agree and the text is kept.
 * A new place fails, saying what to do. A listed place that no longer
 * changes the scores fails too, so the list stays exact.
 *
 * tests/grade-rule-one-cell.test.js holds the same thing at run time:
 * after every step it plays, with _scoresApart down, memory serialised as
 * the save does is what storage holds.
 */
import { readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { describe, expect, it } from 'vitest';
import { findScoreMutations, namedFunctionAround, calleeName, each } from './helpers/scores-mutations.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['shared', 'teacher', 'teacher-mobile', 's'];
const FILES = DIRS.flatMap(dir =>
  readdirSync(resolve(ROOT, dir))
    .filter(name => name.endsWith('.js'))
    .map(name => dir + '/' + name),
).sort();

/* Every place that changes a class's scores in memory in place, by file
   and function, with why and how memory and storage agree again. */
const ALLOWED = {
  'shared/data.js: _upsertScoreOne': {
    how: 'saves',
    why: 'a level, + or −: the one-cell writer; saves the list with _safeLSSet, which raises _scoresApart if it fails',
  },
  'shared/data.js: _saveRubricCriterionNote': {
    how: 'saves',
    why: "a criterion's comment or Went Beyond: one-cell writer, saved with _safeLSSet",
  },
  'shared/data.js: _saveTagCommentOne': {
    how: 'saves',
    why: "a competency's comment: one-cell writer, saved with _safeLSSet",
  },
  'shared/data.js: _saveScoreCommentOne': {
    how: 'saves',
    why: 'the Overall Comment: one-cell writer, saved with _safeLSSet',
  },
  'shared/data.js: saveScoreReportNote': { how: 'saves', why: 'the Note for the Report, saved with _safeLSSet' },
  'shared/data.js: _setPointsScoreOne': { how: 'saves', why: 'points: the list is saved with saveScores' },
  'shared/data.js: _setCompletionMarkOne': { how: 'saves', why: 'Complete/Incomplete cleared: saved with saveScores' },
  'shared/data.js: _applyIdRekeysToScores': {
    how: 'callers',
    why: "local ids swapped for the server's; only saveScores runs it, after raising _scoresApart",
  },
  'shared/data.js: clearScoreEntries': {
    how: 'callers',
    why: 'Clear Score; Grader.clearScore saves the list after it',
  },
  'shared/data.js: _migrateRubricScoreKeys': {
    how: 'apart',
    why: 'old rubric keys moved under their criteria; nothing is saved, so it raises _scoresApart',
  },
  'shared/data.js: _replaceGroupEntries': {
    how: 'apart',
    why: "a group member's copy of the group grade; raises _scoresApart, the save comes later",
  },
  'shared/data.js: _loadCourseFromLS': {
    how: 'load',
    why: 'a class read from storage: memory is the saved copy, kept',
  },
  'shared/data-assessments.js: dropScores': {
    how: 'callers',
    why: "deleted work's scores dropped; _cleanOrphanedScores saves the list after",
  },
  'shared/seed-data.js: seedIfNeeded': {
    how: 'saves',
    why: "Demo Mode's notes on the sample class, saved with saveScores",
  },
  'teacher/page-gradebook.js: _restoreUndo': { how: 'saves', why: 'Cmd+Z of a cell: Grader.undoCell saves the list' },
  'teacher/page-gradebook.js: _commitDeleteAssess': {
    how: 'saves',
    why: 'Delete Assignment: Grader.deleteAssessmentScores saves the list',
  },
  'teacher/page-assignments.js: _confirmDeleteAssess': {
    how: 'saves',
    why: 'Delete Assignment: Grader.deleteAssessmentScores saves the list',
  },
  'teacher-mobile/tab-grade.js: undoLastScore': {
    how: 'saves',
    why: "the phone's Undo: Grader.undoOnPhone saves the list",
  },
  'teacher-mobile/tab-grade.js: _undoCriterion': {
    how: 'saves',
    why: "the phone's Undo of a criterion: Grader.undoOnPhone saves the list",
  },
};

const WHAT_TO_DO =
  "Each changes a class's scores in memory in place (getScores(cid) / _cache.scores). The Draft and Returned rule " +
  'trusts memory to match storage while _scoresApart is down (_savedScoresAreMine), so after the change save the ' +
  "whole list (saveScores), or raise _scoresApart['gb-scores-' + cid] = true before it; then add the function to " +
  'ALLOWED in tests/scores-memory-guard.test.js with a one-line reason and how it is saved. Or change a copy ' +
  '(structuredClone) instead.';

function guard(files) {
  const { found, isLive, called, programs } = findScoreMutations(ROOT, files);
  const fns = [];
  programs.forEach(({ ast }) => each(ast, n => /Function/.test(n.type) && fns.push(n)));

  // A direct whole-list save: _safeLSSet on 'gb-scores-…'.
  const scoresKey = a =>
    !!a &&
    ((a.type === 'Literal' && /^gb-scores-/.test(a.value)) ||
      (a.type === 'BinaryExpression' && scoresKey(a.left)) ||
      (a.type === 'TemplateLiteral' && /^gb-scores-/.test(a.quasis[0].value.raw)));
  const directSave = n =>
    n.type === 'CallExpression' &&
    ((calleeName(n.callee) === '_safeLSSet' && scoresKey(n.arguments[0])) ||
      ['saveScores', '_saveCourseField'].includes(n.callee.type === 'Identifier' ? n.callee.name : null));
  // The functions that save the list, and those that call one (Grader.undoCell), to a fixed point.
  const saving = new Set();
  for (let more = true; more; ) {
    more = false;
    fns.forEach(fn => {
      if (saving.has(fn)) return;
      let saves = false;
      each(fn.body, n => {
        if (saves || n.type !== 'CallExpression') return;
        if (directSave(n) || called(n.callee).some(f => saving.has(f))) saves = true;
      });
      if (saves) {
        saving.add(fn);
        more = true;
      }
    });
  }
  const isSave = n => n.type === 'CallExpression' && (directSave(n) || called(n.callee).some(f => saving.has(f)));
  const savesAfter = (fn, at) => {
    let ok = false;
    each(fn.body, n => {
      if (!ok && n.start >= at && isSave(n)) ok = true;
    });
    return ok;
  };
  const raisesApart = fn => {
    let ok = false;
    each(fn.body, n => {
      if (
        n.type === 'AssignmentExpression' &&
        n.left.type === 'MemberExpression' &&
        n.left.object.name === '_scoresApart' &&
        n.right.type === 'Literal' &&
        n.right.value === true
      )
        ok = true;
    });
    return ok;
  };

  const sites = {};
  found.forEach(f => {
    const key = f.file + ': ' + f.fn;
    (sites[key] = sites[key] || { fn: namedFunctionAround(f.node), changes: [] }).changes.push(f);
  });

  // Why a listed place fails its check, or null.
  function fails(key, how) {
    const site = sites[key];
    const fn = site.fn;
    if (how === 'saves') {
      const unsaved = site.changes.filter(c => !savesAfter(fn, c.node.end));
      return unsaved.length
        ? 'no whole-list save after the change at line ' + unsaved.map(c => c.line).join(', ')
        : null;
    }
    if (how === 'apart') return raisesApart(fn) ? null : 'it no longer raises _scoresApart';
    if (how === 'load') {
      const bad = site.changes.filter(c => {
        const r = c.node.right;
        return !(
          r &&
          r.type === 'CallExpression' &&
          calleeName(r.callee) === '_safeParseLS' &&
          scoresKey(r.arguments[0]) &&
          r.arguments[2] &&
          r.arguments[2].value === true
        );
      });
      return bad.length ? 'line ' + bad.map(c => c.line).join(', ') + ' is not a kept read of the saved copy' : null;
    }
    if (how === 'callers') {
      const bad = [];
      let calls = 0;
      programs.forEach(({ file, ast }) =>
        each(ast, n => {
          if (n.type !== 'CallExpression' || !called(n.callee).includes(fn) || !n.arguments.some(isLive)) return;
          calls++;
          const caller = namedFunctionAround(n);
          if (!caller || !(raisesApart(caller) || savesAfter(caller, n.end))) bad.push(file + ':' + n.loc.start.line);
        }),
      );
      if (!calls) return 'nothing calls it with the scores in memory: list it as saves or apart, or take it off';
      return bad.length ? 'a call with the scores in memory is not followed by a save: ' + bad.join(', ') : null;
    }
    return 'unknown how: ' + how;
  }
  return { sites, fails };
}

/* What is wrong with `files` against `allowed`: places not listed, listed
   places gone, and listed places that fail their check. */
function problems(files, allowed) {
  const { sites, fails } = guard(files);
  const extra = Object.keys(sites)
    .filter(key => !allowed[key])
    .map(key => 'not listed: ' + key + ' (line ' + sites[key].changes.map(c => c.line + ' ' + c.what).join(', ') + ')');
  const stale = Object.keys(allowed)
    .filter(key => !sites[key])
    .map(key => 'listed but no longer changes the scores in memory, take it off: ' + key);
  const bad = Object.keys(allowed)
    .filter(key => sites[key])
    .map(key => {
      const { how, why } = allowed[key];
      if (!why || !String(why).trim()) return key + ': no reason given';
      const wrong = fails(key, how);
      return wrong ? key + ' (' + how + '): ' + wrong : null;
    })
    .filter(Boolean);
  return { sites, extra, stale, bad };
}

describe('every change to the scores in memory saves the list or raises _scoresApart', () => {
  const { sites, extra, stale, bad } = problems(FILES, ALLOWED);

  it('finds the places it is meant to find', () => {
    // If these go, the finder has stopped seeing.
    [
      'shared/data.js: _upsertScoreOne',
      'shared/data.js: _replaceGroupEntries',
      'teacher/page-gradebook.js: _restoreUndo',
    ].forEach(key => expect(Object.keys(sites), key).toContain(key));
  });

  it('no place outside the allow-list changes them', () => {
    expect(extra, extra.length ? WHAT_TO_DO : '').toEqual([]);
  });

  it('every listed place still changes them (the list stays exact)', () => {
    expect(stale).toEqual([]);
  });

  it('every listed place has a reason and is saved, or raises _scoresApart, as it says', () => {
    expect(bad, WHAT_TO_DO).toEqual([]);
  });
});

describe('the finder and the checks, on small sources', () => {
  const run = source => findScoreMutations(ROOT, [{ file: 'x.js', source }]).found.map(f => f.fn + ' ' + f.what);

  it('sees each shape of change in place', () => {
    expect(
      run(`
      function a(cid, sid) { var s = getScores(cid); s[sid] = []; }
      function b(cid, sid) { getScores(cid)[sid].push({}); }
      function c(cid, sid) { var e = getScores(cid)[sid].find(function (x) { return x; }); e.score = 3; }
      function d(cid, sid) { delete getScores(cid)[sid]; }
      function e(cid) { Object.keys(getScores(cid)).forEach(function (k) { getScores(cid)[k].splice(0, 1); }); }
      function f(cid, sid) { (getScores(cid)[sid] || []).filter(Boolean).forEach(function (x) { x.note = ''; }); }
      function g(cid) { Object.assign(getScores(cid), {}); }
      function h(cid, v) { _cache.scores[cid] = v; }
      function i(cid) { j(getScores(cid)); }
      function j(scores) { scores.x = 1; }
      function k(cid) { var e = getScores(cid).a[0]; e.n++; }
      function l(cid) { var m = keep(getScores(cid)); m.y = 2; }
      function keep(o) { return o; }
      function m(cid) { for (var e of getScores(cid).a) e.x = 1; }
      var M = { set: function (cid) { M.put(getScores(cid)); }, put: function (o) { o.z = 1; } };
      `),
    ).toEqual([
      'a assignment',
      'b push',
      'c assignment',
      'd delete',
      'e splice',
      'f assignment',
      'g Object.assign',
      'h assignment',
      'j assignment',
      'k update',
      'l assignment',
      'm assignment',
      'put assignment',
    ]);
  });

  it('does not see a change to a copy, or to a new list', () => {
    expect(
      run(`
      function a(cid, sid) { var s = structuredClone(getScores(cid)); s[sid] = []; }
      function b(cid, sid) { var l = getScores(cid)[sid].filter(Boolean); l.push({}); l.sort(); }
      function c(cid, sid) { var l = getScores(cid)[sid].map(function (e) { return Object.assign({}, e); }); l[0].x = 1; }
      function d(cid) { var t = JSON.parse(JSON.stringify(getScores(cid))); delete t.a; }
      function e(o) { o.x = 1; }
      function f(cid) { e(getStatuses(cid)); }
      function g(o) { return o; }
      function h(cid) { g(getScores(cid)); var s = g({}); s.x = 1; }
      `),
    ).toEqual([]);
  });

  const SAVE = 'function saveScores(cid, s) { _saveCourseField("scores", cid, s); }\n';
  const one = (body, allowed) =>
    problems([{ file: 'x.js', source: SAVE + 'function poke(cid, sid) {' + body + '}' }], allowed);

  it('a new change with no save fails, and names the function and line', () => {
    expect(one('getScores(cid)[sid] = [];', {}).extra).toEqual(['not listed: x.js: poke (line 2 assignment)']);
  });

  it('a listed change fails its check until it is saved or raises _scoresApart', () => {
    const saves = { 'x.js: poke': { how: 'saves', why: 'a test' } };
    const apart = { 'x.js: poke': { how: 'apart', why: 'a test' } };
    expect(one('getScores(cid)[sid] = [];', saves).bad).toEqual([
      'x.js: poke (saves): no whole-list save after the change at line 2',
    ]);
    // A save before the change does not count; one after does.
    expect(one('saveScores(cid, getScores(cid)); getScores(cid)[sid] = [];', saves).bad.length).toBe(1);
    expect(one('var s = getScores(cid); s[sid] = []; saveScores(cid, s);', saves).bad).toEqual([]);
    expect(one('getScores(cid)[sid] = [];', apart).bad).toEqual([
      'x.js: poke (apart): it no longer raises _scoresApart',
    ]);
    expect(one("_scoresApart['gb-scores-' + cid] = true; getScores(cid)[sid] = [];", apart).bad).toEqual([]);
    expect(one('var x = 1;', saves).stale.length).toBe(1);
    expect(one('getScores(cid)[sid] = [];', { 'x.js: poke': { how: 'saves', why: ' ' } }).bad).toEqual([
      'x.js: poke: no reason given',
    ]);
  });

  it('a helper that leaves the save to its callers fails when a caller does not save', () => {
    const helper = 'function drop(s) { s.a = []; }\n';
    const allowed = { 'x.js: drop': { how: 'callers', why: 'a test' } };
    const of = caller => problems([{ file: 'x.js', source: SAVE + helper + caller }], allowed).bad;
    expect(of('function ok(cid) { var s = getScores(cid); drop(s); saveScores(cid, s); }')).toEqual([]);
    expect(of('function no(cid) { drop(getScores(cid)); }')).toEqual([
      'x.js: drop (callers): a call with the scores in memory is not followed by a save: x.js:3',
    ]);
  });
});
