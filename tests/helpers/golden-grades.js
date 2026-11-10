/**
 * The golden grades' extraction (tests/golden-grades.test.js): loading the
 * Demo class and the eval fixture, reading every grade the golden file
 * records through shared/calc.js, and comparing two records. Shared so that
 * returned-only grades (tests/returned-only-invariant.test.js) are read
 * through exactly the same fields, views, styles and switches.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { expect } from 'vitest';
import { newBankIndex } from './bc-bank-fixture.js';
import { syntheticClass } from '../eval-fixture.js';
import { loadClass } from '../../scripts/eval/app.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
export const GOLDEN = resolve(HERE, '../fixtures/golden-grades.json');
export const FROZEN_AT = '2026-11-09T12:00:00.000Z';

const STYLES = ['proficiency', 'letter', 'both'];
const METHODS = ['average', 'mostRecent', 'highest', 'median', 'mode', 'decayingAvg'];

/* ── Loading the two classes ─────────────────────────────────── */

export function loadDemoClass() {
  window.isDemoMode = () => true;
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  runInThisContext(readFileSync(resolve(ROOT, 'shared/seed-data.js'), 'utf-8'), { filename: 'shared/seed-data.js' });
  seedIfNeeded();
  return 'sci8';
}

export function loadEvalClass() {
  window.isDemoMode = () => false;
  return loadClass(syntheticClass(), 1).cid;
}

/* ── Reading one class's grades ──────────────────────────────── */

function categoryAssessments(cid, categoryId) {
  return getAssessments(cid).filter(
    a => (a.categoryId || a.category_id || null) === categoryId && assessmentInYearToDate(cid, a),
  );
}

// What does not depend on the grading style.
export function levelsOf(cid, sid, withWork) {
  const out = { overall: getOverallProficiency(cid, sid), competencies: {}, sections: {}, folders: {} };
  getAllTags(cid).forEach(t => (out.competencies[t.id] = getTagProficiency(cid, sid, t.id)));
  getSections(cid).forEach(s => (out.sections[s.id] = getSectionProficiency(cid, sid, s.id)));
  getGroupedSections(cid).groups.forEach(g => (out.folders[g.group.id] = getGroupProficiency(cid, sid, g.group.id)));
  if (withWork) {
    out.workLevel = {};
    out.workPercent = {};
    getAssessments(cid).forEach(a => {
      const pct = getAssessmentGroupPercentage(cid, sid, [a]);
      out.workLevel[a.id] = getAssessmentOverallScore(cid, sid, a.id);
      out.workPercent[a.id] = pct ? pct.pct : null;
    });
  }
  return out;
}

// What the grading style can change, and the grade as the class shows it.
export function shownOf(cid, sid, termId) {
  const course = getCourseLetterData(cid, sid);
  const summary = studentGradeSummary(cid, sid, termId);
  const out = {
    courseLevel: course.Q,
    percent: course.R,
    letter: course.S,
    overallText: formatLevel(cid, getOverallProficiency(cid, sid)),
    summaryText: summary.text,
    summaryLevel: summary.level,
    competencyText: {},
    folderText: {},
    categories: {},
  };
  getAllTags(cid).forEach(t => (out.competencyText[t.id] = formatLevel(cid, getTagProficiency(cid, sid, t.id))));
  getGroupedSections(cid).groups.forEach(
    g => (out.folderText[g.group.id] = formatLevel(cid, getGroupProficiency(cid, sid, g.group.id))),
  );
  getCategories(cid).forEach(c => {
    const pct = getAssessmentGroupPercentage(cid, sid, categoryAssessments(cid, c.id), categoryCalcMode(c));
    out.categories[c.id] = { level: getCategoryAverage(cid, sid, c.id), percent: pct ? pct.pct : null };
  });
  return out;
}

function settingsOf(cid) {
  const cc = getCourseConfig(cid) || {};
  const course = COURSES[cid] || {};
  const out = {
    gradingStyle: courseGradeMode(cid),
    calcMethod: cc.calcMethod || course.calcMethod || 'average',
    decayWeight: cc.decayWeight != null ? cc.decayWeight : course.decayWeight || 0.65,
    recentScoreLimit: getRecentScoreLimit(cid),
    foldersCountAsOne: getFoldersCountAsOne(cid),
    coursesCountEqually: getCoursesCountEqually(cid),
    roundWholePercent: getRoundWholePercent(cid),
    today: courseToday(cid),
    categories: {},
    terms: {},
  };
  getCategories(cid).forEach(
    c => (out.categories[c.id] = { weight: Number(c.weight || 0), calc: categoryCalcMode(c) }),
  );
  getReportingTerms(cid).forEach(t => (out.terms['term-' + t.ordinal] = { startsOn: t.starts_on, endsOn: t.ends_on }));
  return out;
}

// Runs read() with target[field] = value, then puts the saved value back.
function withValue(target, field, value, read) {
  const had = Object.prototype.hasOwnProperty.call(target, field);
  const kept = target[field];
  try {
    target[field] = value;
    clearProfCache();
    return read();
  } finally {
    if (had) target[field] = kept;
    else delete target[field];
    clearProfCache();
  }
}

// The year so far in the class's own style, with each switch set each way.
function switchesOf(cid, sids) {
  const cc = getCourseConfig(cid);
  const overalls = () => Object.fromEntries(sids.map(sid => [sid, getOverallProficiency(cid, sid)]));
  const out = { foldersCountAsOne: {}, categoryCalculation: {}, calcMethod: {} };
  [true, false].forEach(on => {
    out.foldersCountAsOne[on ? 'on' : 'off'] = withValue(cc, 'foldersCountAsOne', on, () => {
      expect(getFoldersCountAsOne(cid)).toBe(on);
      return overalls();
    });
  });
  ['points', 'percent'].forEach(mode => {
    const categories = getCategories(cid);
    const kept = categories.map(c => ({ had: Object.prototype.hasOwnProperty.call(c, 'calcMode'), value: c.calcMode }));
    try {
      categories.forEach(c => (c.calcMode = mode));
      clearProfCache();
      expect(getCategories(cid).every(c => categoryCalcMode(c) === mode)).toBe(true);
      out.categoryCalculation[mode] = Object.fromEntries(
        sids.map(sid => {
          const course = getCourseLetterData(cid, sid);
          return [sid, { percent: course.R, letter: course.S }];
        }),
      );
    } finally {
      categories.forEach((c, i) => {
        if (kept[i].had) c.calcMode = kept[i].value;
        else delete c.calcMode;
      });
      clearProfCache();
    }
  });
  METHODS.forEach(method => {
    out.calcMethod[method] = withValue(cc, 'calcMethod', method, overalls);
  });
  return out;
}

/* One class's whole record, and `drift`: every level that came out
   different in another grading style (there should be none). */
export function recordClass(cid) {
  const course = COURSES[cid];
  const hadStyle = Object.prototype.hasOwnProperty.call(course, 'gradingSystem');
  const ownStyle = course.gradingSystem;
  const sids = getStudents(cid).map(s => s.id);
  const record = { settings: settingsOf(cid), views: {}, switches: null };
  const drift = [];
  try {
    setActiveTerm(cid, null);
    clearProfCache();
    record.switches = switchesOf(cid, sids);
    [null].concat(getReportingTerms(cid).map(t => t.ordinal)).forEach(ordinal => {
      const termId = ordinal == null ? null : 'term-' + ordinal;
      const viewName = termId || 'year';
      const view = { levels: null, styles: {} };
      setActiveTerm(cid, ordinal);
      STYLES.forEach(style => {
        course.gradingSystem = style;
        clearProfCache();
        const levels = {};
        const shown = {};
        sids.forEach(sid => {
          levels[sid] = levelsOf(cid, sid, ordinal == null);
          shown[sid] = shownOf(cid, sid, termId);
        });
        view.styles[style] = shown;
        if (!view.levels) view.levels = levels;
        else differences(canonical(view.levels), canonical(levels)).forEach(d => drift.push(viewName + ' › ' + d));
      });
      record.views[viewName] = view;
    });
  } finally {
    if (hadStyle) course.gradingSystem = ownStyle;
    else delete course.gradingSystem;
    setActiveTerm(cid, null);
    clearProfCache();
  }
  return { record, drift };
}

/* ── Comparing ───────────────────────────────────────────────── */

// A copy with sorted keys, as JSON keeps it. A number JSON can't keep is a bug.
export function canonical(value, path) {
  if (typeof value === 'number' && !isFinite(value)) throw new Error('Not a finite number at ' + path + ': ' + value);
  if (value === undefined) throw new Error('No value at ' + path);
  if (Array.isArray(value)) throw new Error('A list at ' + path + '; the golden file holds no lists');
  if (value === null || typeof value !== 'object') return Object.is(value, -0) ? 0 : value;
  const out = {};
  Object.keys(value)
    .sort()
    .forEach(k => (out[k] = canonical(value[k], path ? path + ' › ' + k : k)));
  return out;
}

// Every place two records differ: "path: golden X, now Y".
export function differences(golden, now, path, out) {
  out = out || [];
  const isObj = v => v !== null && typeof v === 'object';
  if (isObj(golden) && isObj(now)) {
    const keys = Array.from(new Set(Object.keys(golden).concat(Object.keys(now)))).sort();
    keys.forEach(k => differences(golden[k], now[k], path ? path + ' › ' + k : k, out));
    return out;
  }
  if (golden !== now) {
    const say = v => (v === undefined ? 'nothing' : isObj(v) ? 'a group' : JSON.stringify(v));
    out.push(path + ': golden ' + say(golden) + ', now ' + say(now));
  }
  return out;
}
