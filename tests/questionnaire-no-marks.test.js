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
      'No marked work for Olivia this term yet, so there is nothing to draft from. You can write the comment yourself.';
    // Not shown until Generate is pressed.
    expect(before).toContain(`id="tq-nodraft" role="status" hidden>${line}</div>`);
    const blockers = RQ.approveBlockers(st);
    RQ.tqGenerate();
    expect(box.value).toBe('');
    expect((getStudentTermRating(cid, st.id, 'term-2') || {}).narrative || '').toBe('');
    expect(RQ.renderTermQuestionnaire(cid)).toContain(`id="tq-nodraft" role="status">${line}</div>`);
    expect(RQ.approveBlockers(st)).toEqual(blockers);
  });

  it('with one marked piece, drafts only what is true: the grade and the best piece, no lone family line', () => {
    const st = byName('Raj');
    const f = CommentBank.facts(cid, st, 'term-2');
    expect(f.grade.marked.mine).toBe(1);
    expect(RQ.noMarkedWork(f)).toBe(false);
    expect(open(st)).not.toContain('id="tq-nodraft"');
    for (let seed = 1; seed <= 12; seed++) {
      const steps = draftFor(st, seed).sentences.map(x => x.step);
      expect(steps).toContain('grade');
      expect(steps).toContain('example');
      expect(steps).not.toContain('home');
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
  });
});
