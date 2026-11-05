/**
 * Generate for a student with no marks, or almost none, this term (live
 * run, Nov 1 2026: a student with no marks got only a family line,
 * labelled Next Step and placed after Support). With no marked work
 * Generate drafts nothing and the comment card says so; with one marked
 * piece the draft says only what is true; the family line never comes
 * without the Next Step sentence it belongs to.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;

describe('Generate with no marks or one mark (Demo Mode, Science 8, Report 2)', () => {
  let cid, saved, hadDoc, oldDoc, box;
  const byName = first => getStudents(cid).find(s => s.firstName === first);
  const draftFor = (st, seed) => {
    const f = CommentBank.facts(cid, st, 'term-2');
    return CommentBank.draft(CommentBank.context(f, {}), { seed });
  };
  const open = st => {
    RQ.tqStudentIndex = RQ.getTqStudents().findIndex(s => s.id === st.id);
    box.value = '';
    return RQ.renderTermQuestionnaire(cid);
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
    box = {
      value: '',
      dataset: {
        cid,
        term: 'term-2',
        get sid() {
          return RQ.getTqStudents()[RQ.tqStudentIndex].id;
        },
      },
      style: {},
      scrollHeight: 0,
      focus() {},
      select() {},
    };
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    globalThis.document = {
      getElementById: id => (id === 'tq-narrative' ? box : id === 'report-period' ? period : null),
      querySelector: () => null,
      querySelectorAll: () => [],
      execCommand: () => false,
      body: { classList: { add() {}, remove() {} } },
    };
    RQ.configure({ activeCourse: cid, renderReports: () => {} });
    // Olivia: no marks at all. Raj: one marked piece this term.
    const scores = getScores(cid);
    const work = CommentBank.facts(cid, byName('Ethan'), 'term-2').work.map(w => w.id);
    const raj = byName('Raj').id;
    const one = scores[raj].find(x => work.includes(x.assessmentId)).assessmentId;
    scores[byName('Olivia').id] = [];
    scores[raj] = scores[raj].filter(x => x.assessmentId === one);
    saveScores(cid, scores);
    clearProfCache();
    [byName('Olivia'), byName('Raj')].forEach(s => upsertTermRating(cid, s.id, 'term-2', { narrative: '' }));
  });
  afterAll(async () => {
    // The card's timers (the class warning, the quoted chips) run first.
    await new Promise(r => setTimeout(r, 700));
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });

  it('with no marked work, Generate drafts nothing and the card says so; Approve is gated as before', () => {
    const st = byName('Olivia');
    const f = CommentBank.facts(cid, st, 'term-2');
    expect(f.grade.marked.mine).toBe(0);
    expect(RQ.noMarkedWork(f)).toBe(true);
    const before = open(st);
    const line =
      'No marked work for Olivia yet, so there is nothing to draft from. You can write the comment yourself.';
    // Not shown until Generate is pressed.
    expect(before).toContain(`id="tq-nodraft" role="status" hidden>${line}</div>`);
    const blockers = RQ.approveBlockers(st);
    RQ.tqGenerate();
    expect(box.value).toBe('');
    expect((getStudentTermRating(cid, st.id, 'term-2') || {}).narrative || '').toBe('');
    const after = RQ.renderTermQuestionnaire(cid);
    expect(after).toContain(`id="tq-nodraft" role="status">${line}</div>`);
    // Under the line, no hint to rate habits and press Generate.
    expect(after).toContain('<span class="qn-empty-hint" hidden>');
    expect(before).toContain('<span class="qn-empty-hint">Rate the six work habits');
    expect(RQ.approveBlockers(st)).toEqual(blockers);
  });

  it('with one marked piece, drafts the grade, the best piece, a next step and its family line (Colin, Nov 4)', () => {
    const st = byName('Raj');
    const f = CommentBank.facts(cid, st, 'term-2');
    expect(f.grade.marked.mine).toBe(1);
    expect(RQ.noMarkedWork(f)).toBe(false);
    expect(open(st)).not.toContain('id="tq-nodraft"');
    for (let seed = 1; seed <= 12; seed++) {
      const steps = draftFor(st, seed).sentences.map(x => x.step);
      expect(steps).toContain('grade');
      expect(steps).toContain('example');
      // Every comment has a next step and a family line: a generic one
      // that claims nothing when no competency names one.
      expect(steps).toContain('nextStep');
      expect(steps).toContain('home');
    }
    RQ.tqGenerate();
    expect(box.value).toContain('Raj');
  });

  it('never drafts the family line without the Next Step sentence it belongs to', () => {
    getStudents(cid).forEach(st => {
      for (let seed = 1; seed <= 6; seed++) {
        const steps = draftFor(st, seed).sentences.map(x => x.step);
        if (steps.includes('home')) expect(steps).toContain('nextStep');
      }
    });
    // A student with marks still gets both.
    const steps = draftFor(byName('Ethan'), 1).sentences.map(x => x.step);
    expect(steps).toContain('nextStep');
    expect(steps).toContain('home');

    // On the language-goals path the goal line never sits between the Next
    // Step sentence and its family line: it comes before the Next Step.
    const ethan = byName('Ethan');
    const was = { designations: ethan.designations, rating: getStudentTermRating(cid, ethan.id, 'term-2') };
    // Goals replace a letter grade: a Letter class.
    const mode = COURSES[cid].gradingSystem;
    COURSES[cid].gradingSystem = 'letter';
    clearProfCache();
    const roster = getStudents(cid).map(x => (x.id === ethan.id ? Object.assign({}, x, { designations: ['ELL'] }) : x));
    saveStudents(cid, roster);
    upsertTermRating(cid, ethan.id, 'term-2', { reportingBasis: 'language_goals' });
    const cfg = getReportConfig(cid) || {};
    saveReportConfig(
      cid,
      Object.assign({}, cfg, {
        commentSettings: Object.assign({}, cfg.commentSettings || {}, {
          languageGoalsChosen: ['lg-discussions'],
          languageGoalsFor: { 'term-2': { [ethan.id]: 'lg-discussions' } },
        }),
      }),
    );
    try {
      for (let seed = 1; seed <= 6; seed++) {
        const goal = draftFor(byName('Ethan'), seed).sentences.map(x => x.step);
        expect(goal, 'seed ' + seed).toContain('languageGoals');
        if (!goal.includes('home')) continue;
        expect(goal.indexOf('home'), 'seed ' + seed).toBeGreaterThan(goal.indexOf('nextStep'));
        const at = goal.indexOf('languageGoals');
        expect(at < goal.indexOf('nextStep') || at > goal.indexOf('home'), 'seed ' + seed + ': ' + goal.join(' ')).toBe(
          true,
        );
        expect(at, 'seed ' + seed).toBe(goal.indexOf('nextStep') - 1);
      }
    } finally {
      saveStudents(
        cid,
        getStudents(cid).map(x => (x.id === ethan.id ? Object.assign({}, x, { designations: was.designations }) : x)),
      );
      upsertTermRating(cid, ethan.id, 'term-2', { reportingBasis: (was.rating || {}).reportingBasis || 'grade' });
      saveReportConfig(cid, cfg);
      COURSES[cid].gradingSystem = mode;
      clearProfCache();
    }
  });
});
