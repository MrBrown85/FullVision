/**
 * The S2-F1 review's proofs, kept (student page build plan, S2-F1).
 *
 * 1. Every grade in a holding class turned into a draft (levels, points,
 *    marks, comments, ticks, Went Beyond, notes): Progress Reports, the
 *    Quick Report with its Feedback Pages and the rubric handout are what
 *    they were, and none holds a draft's words; Print Grades moves.
 * 2. Nothing kept from an all-work drawing reaches a report.
 * 3. Grades never returned print nowhere.
 * 4. The surfaces this PR leaves on all work are the same in a holding class
 *    with drafts as in a class that returns at once.
 * 5. Delete Rubric counts the students whose scores it deletes: all work,
 *    drafts included (teacher/rubric-bank.js deleteImpact).
 * 6. The handout's Printed and Changed Since Printed marks never throw and
 *    never stop a page: with the Draft and Returned rows not loaded there is
 *    no mark, and once they load the marks are drawn again.
 *
 * Demo Mode's Science 8, graded through the one grader.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';
import { freshGenerate, surfaceOf, surfaces } from './helpers/report-surfaces.js';
import { U, signIn, seedClass, clearClass } from './helpers/pin-save-paths.js';
import { parseHTML } from 'linkedom';

/* A real page for the duration of `fn` (the tests' own document is a stub). */
function onAPage(fn) {
  const stub = globalThis.document;
  const { document } = parseHTML('<!DOCTYPE html><html><body></body></html>');
  globalThis.document = document;
  try {
    return fn(document);
  } finally {
    globalThis.document = stub;
  }
}

const HELD = { student_page_enabled: true, return_grades: 'on_return' };

let base = null;
function freshClass(config) {
  if (!base) {
    const cid = loadDemoClass();
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) ls[localStorage.key(i)] = localStorage.getItem(localStorage.key(i));
    base = { cid, ls, cache: structuredClone(_cache) };
  }
  localStorage.clear();
  Object.keys(base.ls).forEach(k => localStorage.setItem(k, base.ls[k]));
  Object.keys(base.cache).forEach(k => (_cache[k] = structuredClone(base.cache[k])));
  _returnedSets = {};
  clearProfCache();
  const cid = base.cid;
  if (config) saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), config));
  return cid;
}

// A handout's ticks are a set: their order is not what is compared.
const norm = drawn => {
  Object.keys(drawn).forEach(k => {
    if (surfaceOf(k) !== 'quick') return;
    const o = JSON.parse(drawn[k]);
    (o.sheets || []).forEach(sh => sh && sh.ticked && sh.ticked.sort());
    drawn[k] = JSON.stringify(o);
  });
  return drawn;
};
const draw = (cid, only) => {
  clearProfCache();
  freshGenerate();
  return norm(surfaces(cid, only));
};

/* Changes a grade on a cell: `every` changes every cell, else every third. */
function grade(cid, every, mark) {
  const students = sortStudents(getStudents(cid), 'lastName');
  getAssessments(cid).forEach((a, ai) => {
    if (isDibelsScored(a)) return;
    const rubric = a.rubricId ? getRubricById(cid, a.rubricId) : null;
    students.forEach((st, si) => {
      if (!every && (ai + si) % 3) return;
      const sid = st.id;
      const status = getAssignmentStatus(cid, sid, a.id);
      if (status === 'NS' || status === 'EXC') return;
      const tag = mark + '-' + sid + '-' + a.id;
      if (isCompletionScored(a)) {
        Grader.setMark(cid, sid, a.id, getCompletionMark(cid, sid, a.id) === 'complete' ? 'incomplete' : 'complete');
      } else if (isPointsScored(a)) {
        const p = getPointsScore(cid, sid, a.id);
        Grader.setPoints(cid, sid, a.id, p == null ? 1 : p > 0 ? p - 1 : p + 1);
      } else if (rubric) {
        (rubric.criteria || []).forEach((c, i) => {
          const entries = (getScores(cid)[sid] || []).filter(e => e.assessmentId === a.id);
          const lv = RubricPrint.criterionLevel(entries, a.id, c).level;
          Grader.setLevel(cid, sid, a.id, c.id, (lv % 4) + 1, 0);
          if (!every) return;
          Grader.setCriterionComment(cid, sid, a.id, c.id, tag + '-crit' + i);
          Grader.setWentBeyond(cid, sid, a.id, c.id, tag + '-beyond' + i);
          (c.checks || []).forEach(x => {
            const on = getRubricCheckIds(cid, sid, a.id).indexOf(x.id) >= 0;
            Grader.setTick(cid, sid, a.id, x.id, !on);
          });
        });
      } else {
        (a.tagIds || []).forEach((tid, i) => {
          const e = (getScores(cid)[sid] || []).find(x => x.assessmentId === a.id && x.tagId === tid);
          Grader.setLevel(cid, sid, a.id, tid, ((e ? Number(e.score) || 0 : 0) % 4) + 1, 0);
          if (every) Grader.setCompetencyComment(cid, sid, a.id, tid, tag + '-tag' + i);
        });
      }
      Grader.setOverallComment(cid, sid, a.id, tag + '-overall');
      if (every) Grader.setReportNote(cid, sid, a.id, tag + '-note');
    });
  });
}

describe('a holding class full of drafts', { timeout: 240000 }, () => {
  let wasDemo;
  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
  });
  afterAll(() => {
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  it('every grade a draft: the reports and the handout are what they were; Print Grades moves', () => {
    const cid = freshClass(HELD);
    const before = draw(cid, ['progress', 'quick', 'printGrades']);
    grade(cid, true, 'ZZSTORM');
    expect(GradeState.draftsWaiting(cid)).toBeGreaterThan(100);
    const after = draw(cid, ['progress', 'quick', 'printGrades']);
    const moved = Object.keys(before).filter(k => before[k] !== after[k]);
    const reports = moved.filter(k => surfaceOf(k) !== 'printGrades');
    const leaks = Object.keys(after).filter(k => surfaceOf(k) !== 'printGrades' && after[k].indexOf('ZZSTORM') >= 0);
    expect(moved.length - reports.length, 'Print Grades moved').toBeGreaterThan(0);
    expect(leaks).toEqual([]);
    expect(reports).toEqual([]);
  });

  it('nothing kept from an all-work drawing reaches a report', () => {
    const cid = freshClass(HELD);
    const before = draw(cid, ['progress', 'quick']);
    grade(cid, false, 'ZZSOME');
    // The teacher's sheet first (all work), so anything kept from it would be in reach of the report.
    surfaces(cid, ['printGrades']);
    getAssessments(cid).forEach(a => getStudents(cid).forEach(s => getAssessmentOverallScore(cid, s.id, a.id)));
    getStudents(cid).forEach(s => getOverallProficiency(cid, s.id));
    const after = norm(surfaces(cid, ['progress', 'quick']));
    expect(GradeState.draftsWaiting(cid)).toBeGreaterThan(100);
    expect(Object.keys(before).filter(k => before[k] !== after[k])).toEqual([]);
  });

  it('grades never returned print nowhere', () => {
    const cid = freshClass(null);
    const pieces = [
      getAssessments(cid).find(a => a.rubricId && !isPointsScored(a)),
      getAssessments(cid).find(a => isPointsScored(a) && !isCompletionScored(a)),
      getAssessments(cid).find(a => !a.rubricId && !isPointsScored(a) && !isDibelsScored(a)),
    ];
    const kept = structuredClone(getScores(cid));
    const scores = getScores(cid);
    Object.keys(scores).forEach(sid => {
      scores[sid] = scores[sid].filter(e => !pieces.some(p => p.id === e.assessmentId));
    });
    saveScores(cid, scores);
    saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), HELD));
    const before = draw(cid, ['progress', 'quick']);
    let n = 0;
    getStudents(cid).forEach(st => {
      pieces.forEach(p => {
        const status = getAssignmentStatus(cid, st.id, p.id);
        if (status === 'NS' || status === 'EXC') return;
        (kept[st.id] || [])
          .filter(e => e.assessmentId === p.id && Number(e.score) > 0)
          .forEach(e => {
            if (isPointsScored(p)) Grader.setPoints(cid, st.id, p.id, Number(e.score));
            else Grader.setLevel(cid, st.id, p.id, e.tagId, Number(e.score), 0);
            n++;
          });
        Grader.setOverallComment(cid, st.id, p.id, 'ZZNEVER ' + st.id);
      });
    });
    const after = draw(cid, ['progress', 'quick']);
    expect(n).toBeGreaterThan(30);
    expect(Object.keys(after).filter(k => after[k].indexOf('ZZNEVER') >= 0)).toEqual([]);
    expect(Object.keys(before).filter(k => before[k] !== after[k])).toEqual([]);
  });

  it('the surfaces left on all work are the same with drafts held as with grades returned at once', () => {
    const drawn = config => {
      const cid = freshClass(config);
      grade(cid, false, 'ZZSOME');
      clearProfCache();
      freshGenerate();
      return [surfaces(cid, ['questionnaire', 'phones', 'printGrades', 'export']), GradeState.draftsWaiting(cid)];
    };
    const [atOnce, none] = drawn({ student_page_enabled: true, return_grades: 'on_save' });
    const [held, waiting] = drawn(HELD);
    expect(none).toBe(0);
    expect(waiting).toBeGreaterThan(100);
    expect(Object.keys(atOnce).filter(k => atOnce[k] !== held[k])).toEqual([]);
  });

  it('Delete Rubric counts the students whose scores it deletes, drafts included', () => {
    const cid = freshClass(null);
    const rid = getAssessments(cid).find(a => a.rubricId).rubricId;
    const allWork = RubricBank.deleteImpact(cid, rid);
    expect(allWork.scored).toBeGreaterThan(0);
    // The same scores, every one a draft never returned, in a class that holds grades.
    const kept = structuredClone(getScores(cid));
    const uses = getAssessments(cid).filter(a => a.rubricId === rid);
    const scores = getScores(cid);
    Object.keys(scores).forEach(sid => {
      scores[sid] = scores[sid].filter(e => !uses.some(p => p.id === e.assessmentId));
    });
    saveScores(cid, scores);
    saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), HELD));
    getStudents(cid).forEach(st => {
      uses.forEach(p => {
        const status = getAssignmentStatus(cid, st.id, p.id);
        if (status === 'NS' || status === 'EXC') return;
        (kept[st.id] || [])
          .filter(e => e.assessmentId === p.id && Number(e.score) > 0)
          .forEach(e => Grader.setLevel(cid, st.id, p.id, e.tagId, Number(e.score), 0));
      });
    });
    expect(GradeState.draftsWaiting(cid)).toBeGreaterThan(0);
    expect(RubricBank.deleteImpact(cid, rid)).toEqual(allWork);
  });

  it('the Printed mark: no mark while the returned grades cannot be read, the mark again once they can', () => {
    const cid = freshClass(null);
    const lab = getAssessments(cid).find(a => a.rubricId);
    const st = getStudents(cid).find(s => RubricPrint.isStudentScored(cid, lab.id, s.id));
    RubricPrint.markPrinted(cid, lab.id, [st.id]);
    expect(RubricPrint.markHtml(cid, lab.id, st.id)).toContain('Printed');
    saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), HELD));
    expect(RubricPrint.markHtml(cid, lab.id, st.id)).toContain('Printed');
    onAPage(doc => {
      // On the page, as the Assignments page and the grader draw it.
      const host = doc.createElement('div');
      host.innerHTML = RubricPrint.markHtml(cid, lab.id, st.id);
      doc.body.appendChild(host);
      const real = window.getReturnedScores;
      // What shared/data.js does for a signed-in holding class whose rows have not loaded.
      window.getReturnedScores = () => {
        throw Object.assign(
          new Error(
            'This class holds grades until they are returned, and which of its grades are returned has not loaded.',
          ),
          { code: 'RETURNED_NOT_LOADED' },
        );
      };
      try {
        clearProfCache();
        let html;
        expect(() => (html = RubricPrint.markHtml(cid, lab.id, st.id))).not.toThrow();
        expect(html).not.toContain('Printed');
        expect(() => RubricPrint.refreshMarks(cid, host)).not.toThrow();
        expect(host.querySelector('[data-rp-mark-sid]').hidden).toBe(true);
        // The teacher's own views and the Rubric Bank's count read all work: they answer.
        expect(() => getOverallProficiency(cid, st.id)).not.toThrow();
        expect(() => RubricBank.deleteImpact(cid, lab.rubricId)).not.toThrow();
        expect(RubricPrint.isStudentScored(cid, lab.id, st.id)).toBe(true);
      } finally {
        window.getReturnedScores = real;
      }
      // Loaded: drawn again.
      clearProfCache();
      RubricPrint.refreshMarks(cid, host);
      expect(host.querySelector('[data-rp-mark-sid]').hidden).toBe(false);
      expect(host.textContent).toContain('Printed');
      host.remove();
    });
  });
});

describe('a signed-in holding class whose rows have not loaded', () => {
  const LIVE = U(1);
  let session;
  let realSettings;
  beforeEach(() => {
    seedClass(LIVE, {
      students: [{ id: U(11), firstName: 'Jordan', lastName: 'Test' }],
      assessments: [
        { id: U(31), title: 'Lab', date: '2026-10-10', type: 'summative', tagIds: [U(51)], rubricId: U(61) },
      ],
      rubrics: [
        { id: U(61), name: 'Lab Report', criteria: [{ id: U(71), name: 'Method', tagIds: [U(51)], levels: {} }] },
      ],
      scores: {
        [U(11)]: [
          { id: 'e1', assessmentId: U(31), tagId: U(71), score: 3, date: '2026-10-10', type: 'summative', note: '' },
        ],
      },
    });
    session = signIn();
    realSettings = globalThis.getReturnSettings;
  });
  afterEach(() => {
    globalThis.getReturnSettings = realSettings;
    session.signOut();
    clearClass(LIVE);
  });

  it('the Printed mark and Delete Rubric’s count draw; Print Rubrics does not open, and nothing throws', () => {
    // A print recorded before the class held grades.
    setRubricPrints(LIVE, U(31), [{ sid: U(11), hash: 'printed-before', at: '2026-11-01T12:00:00.000Z' }]);
    globalThis.getReturnSettings = () => ({ student_page: true, return_grades: 'on_return' });
    delete _gradeReturnsLoadedFor[LIVE];
    delete _returnedSets[LIVE];
    expect(() => getReturnedScores(LIVE)).toThrow(/has not loaded/);
    let html;
    expect(() => (html = RubricPrint.markHtml(LIVE, U(31), U(11)))).not.toThrow();
    expect(html).not.toContain('Printed');
    expect(() => RubricBank.deleteImpact(LIVE, 'no-such-rubric')).not.toThrow();
    expect(ReportScores.ready(LIVE)).toBe(false);
    onAPage(doc => {
      expect(() => RubricPrint.open(LIVE, U(31))).not.toThrow();
      expect(doc.getElementById('rubric-print-overlay')).toBe(null);
      // Loaded: it opens.
      _loadGradeReturns(LIVE, {});
      expect(ReportScores.ready(LIVE)).toBe(true);
      RubricPrint.open(LIVE, U(31));
      expect(doc.getElementById('rubric-print-overlay')).not.toBe(null);
      RubricPrint.close();
    });
  });
});

/* The handout's Printed and Changed Since Printed marks (the second
   review). They compare what the handout would print now with what was
   printed; while a holding class's rows are not loaded there is no mark,
   no timer is left running, and nothing touches another class's marks. */
describe('the Printed marks', { timeout: 120000 }, () => {
  let cid, lab, crit, roster;
  beforeAll(() => {
    cid = freshClass(null);
    lab = getAssessments(cid).find(a => a.rubricId);
    crit = getRubricById(cid, lab.rubricId).criteria[0];
    roster = getStudents(cid).filter(s => RubricPrint.isStudentScored(cid, lab.id, s.id));
  });
  const kind = sid => {
    const h = RubricPrint.markHtml(cid, lab.id, sid);
    return /Changed Since Printed/.test(h) ? 'changed' : /Printed/.test(h) ? 'printed' : 'none';
  };

  it('a print recorded before this change (an all-work fingerprint) is compared sanely', () => {
    const at = '2026-11-01T12:00:00.000Z';
    const old = sid => ({ sid, hash: RubricPrint.fingerprint(cid, lab.id, sid), at });
    setRubricPrints(
      cid,
      lab.id,
      roster.map(s => old(s.id)),
    );
    const count = () => {
      const c = { printed: 0, changed: 0, none: 0 };
      roster.forEach(s => c[kind(s.id)]++);
      return c;
    };
    expect(count().printed).toBe(roster.length);
    saveCourseConfig(cid, Object.assign({}, getCourseConfig(cid), HELD));
    expect(count().printed).toBe(roster.length);
    // A draft on a printed, returned grade: a level, a comment and a tick. It is not "changed" until returned.
    const s0 = roster[0].id;
    const e = (getScores(cid)[s0] || []).find(x => x.assessmentId === lab.id && x.tagId === crit.id);
    Grader.setLevel(cid, s0, lab.id, crit.id, (Number(e.score) % 4) + 1, 0);
    Grader.setOverallComment(cid, s0, lab.id, 'a new draft comment');
    const ticks = getRubricCheckIds(cid, s0, lab.id);
    const all = (getRubricById(cid, lab.rubricId).criteria || []).flatMap(c => (c.checks || []).map(x => x.id));
    const add = all.find(id => ticks.indexOf(id) < 0);
    if (add) Grader.setTick(cid, s0, lab.id, add, true);
    expect(kind(s0)).toBe('printed');
    Grader.returnGrades(cid, lab.id, [s0]);
    expect(kind(s0)).toBe('changed');
    // A print main made with a draft in it (main printed drafts): changed until the draft is returned.
    const s1 = roster[1].id;
    const e1 = (getScores(cid)[s1] || []).find(x => x.assessmentId === lab.id && x.tagId === crit.id);
    Grader.setLevel(cid, s1, lab.id, crit.id, (Number(e1.score) % 4) + 1, 0);
    setRubricPrints(cid, lab.id, [old(s1)]);
    expect(kind(s1)).toBe('changed');
    Grader.returnGrades(cid, lab.id, [s1]);
    expect(kind(s1)).toBe('printed');
  });

  it('not loaded: no mark, no timer left running, and another class’s marks are left alone', () => {
    const sid = roster[2].id;
    RubricPrint.markPrinted(cid, lab.id, [sid]);
    const real = window.getReturnedScores;
    vi.useFakeTimers();
    try {
      onAPage(doc => {
        const host = doc.createElement('div');
        host.innerHTML = RubricPrint.markHtml(cid, lab.id, sid);
        doc.body.appendChild(host);
        expect(host.textContent).toContain('Printed');
        window.getReturnedScores = () => {
          throw Object.assign(new Error('which of its grades are returned has not loaded'), {
            code: 'RETURNED_NOT_LOADED',
          });
        };
        clearProfCache();
        const t0 = vi.getTimerCount();
        for (let i = 0; i < 200; i++) expect(RubricPrint.markHtml(cid, lab.id, sid)).not.toContain('Printed');
        RubricPrint.refreshMarks(cid);
        expect(host.querySelector('[data-rp-mark-sid]').hidden).toBe(true);
        expect(vi.getTimerCount() - t0).toBe(0);
        // The teacher switches class: the other class's marks are on screen, drawn Printed.
        host.innerHTML =
          '<span class="rp-mark" data-rp-mark-sid="other-student" data-rp-mark-aid="other-piece">Printed Oct 30</span>';
        const other = host.querySelector('[data-rp-mark-sid]');
        vi.advanceTimersByTime(60000);
        expect(other.hidden).toBe(false);
        expect(other.textContent).toBe('Printed Oct 30');
        host.remove();
      });
    } finally {
      vi.useRealTimers();
      window.getReturnedScores = real;
    }
  });
});

describe('ReportScores.ready', () => {
  const withStub = (fn, body) => {
    const real = window.getReturnedScores;
    window.getReturnedScores = fn;
    try {
      return body();
    } finally {
      window.getReturnedScores = real;
    }
  };

  it('answers no only for the data layer’s not-loaded refusal', () => {
    const refusal = () => {
      throw Object.assign(new Error('has not loaded'), { code: 'RETURNED_NOT_LOADED' });
    };
    expect(withStub(refusal, () => ReportScores.ready('c'))).toBe(false);
    expect(
      withStub(
        () => ({}),
        () => ReportScores.ready('c'),
      ),
    ).toBe(true);
  });

  it('lets any other error surface: a fault is never shown as loading', () => {
    const fault = () => {
      throw new TypeError("Cannot read properties of undefined (reading 'returned_copy')");
    };
    expect(() => withStub(fault, () => ReportScores.ready('c'))).toThrow(TypeError);
    // Even one worded like the refusal, without its code.
    const lookalike = () => {
      throw new Error('which of its grades are returned has not loaded');
    };
    expect(() => withStub(lookalike, () => ReportScores.ready('c'))).toThrow(/has not loaded/);
    expect(ReportScores.running()).toBe(null);
  });

  it('the data layer’s refusal carries the code', () => {
    const LIVE = U(2);
    seedClass(LIVE, { students: [{ id: U(12), firstName: 'Ava', lastName: 'Test' }] });
    const session = signIn();
    const was = globalThis.getReturnSettings;
    globalThis.getReturnSettings = () => ({ student_page: true, return_grades: 'on_return' });
    try {
      delete _gradeReturnsLoadedFor[LIVE];
      delete _returnedSets[LIVE];
      let caught = null;
      try {
        getReturnedScores(LIVE);
      } catch (e) {
        caught = e;
      }
      expect(caught && caught.code).toBe('RETURNED_NOT_LOADED');
      expect(ReportScores.ready(LIVE)).toBe(false);
    } finally {
      globalThis.getReturnSettings = was;
      session.signOut();
      clearClass(LIVE);
    }
  });
});
