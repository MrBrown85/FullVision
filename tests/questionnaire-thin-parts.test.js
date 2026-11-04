/**
 * Thin parts of the bank on the review screen (plan PR 13; the class
 * warnings mockup): a row whose part is thin for the student (a sentence
 * must serve three or more students) says so under its source line, with "Write one of your own" opening Browse Sentences on
 * that part. Demo Mode only.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;

describe('thinLine', () => {
  it('says how many sentences fit how many students, in the mockup’s words', () => {
    expect(RQ.thinLine({ sentences: 4, students: 30, thin: true }, RQ.partOf('habits'))).toBe(
      'Only 4 habit sentences fit 30 students, so some will repeat.',
    );
    expect(RQ.thinLine({ sentences: 1, students: 27, thin: true }, RQ.partOf('nextStep'))).toBe(
      'Only 1 next step sentence fits 27 students, so some will repeat.',
    );
    expect(RQ.thinLine({ sentences: 3, students: 5 }, RQ.partOf('example'))).toMatch(/^Only 3 best piece sentences/);
    expect(RQ.thinLine({ sentences: 3, students: 5 }, RQ.partOf('overall'))).toMatch(/^Only 3 strength sentences/);
  });
});

describe('the Sentences card in Demo Mode (Science 8, Report 2)', () => {
  let cid, saved, hadDoc, oldDoc, fullBank;
  beforeAll(() => {
    // A bank with four habit frames (the pipeline's first four invitation
    // frames, Nov 4 2026), so the habits part is thin for the class.
    fullBank = COMMENT_BANK.sentences;
    COMMENT_BANK.sentences = fullBank.filter(s => !(s.v === 2 && s.part === 'habits') || /^vhi0[1-4]$/.test(s.id));
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
    // Every student with one habit to build, so each comment has a habits
    // sentence from the four frames.
    getStudents(cid).forEach(st =>
      upsertTermRating(cid, st.id, ReportBlocks.getTermId(), {
        habits: { completes: 3, ready: 3, others: 3, part: 3, feedback: 2, devices: 3 },
      }),
    );
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
    RQ.configure({ activeCourse: cid, renderReports: () => {} });
  });
  afterAll(() => {
    COMMENT_BANK.sentences = fullBank;
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });

  /* The card for a student with a saved draft, and the draft. */
  function card(first, edit) {
    const students = RQ.getTqStudents();
    const st = students.find(s => s.firstName === first);
    RQ.tqStudentIndex = students.indexOf(st);
    const termId = ReportBlocks.getTermId();
    const f = CommentBank.facts(cid, st, termId);
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) });
    upsertTermRating(cid, st.id, termId, { narrative: edit ? edit(d.text, d) : d.text });
    const html = RQ.renderTermQuestionnaire(cid);
    return { html: html.slice(html.indexOf('id="tq-sentences"')), d, students, st, termId };
  }

  /* The first student whose draft has a habits sentence, with its card. */
  function thinCard() {
    const names = RQ.getTqStudents().map(s => s.firstName);
    for (const first of names) {
      const c = card(first);
      if (c.d.sentences.some(x => x.step === 'habits')) return c;
    }
    return null;
  }

  it('shows the thin line under the row of a thin part, linking to Browse Sentences on that part', () => {
    // The habits sentence: a few frames fit the whole class.
    const { html, d, students } = thinCard();
    const i = d.sentences.findIndex(x => x.step === 'habits');
    expect(i).toBeGreaterThanOrEqual(0);
    // (How many fit moves with the bank; the line says the count, and the
    // part is thin when the class has three or more students per sentence.)
    const n = Number((html.match(/Only (\d+) habit sentences fit/) || [])[1]);
    expect(n * 3).toBeLessThanOrEqual(students.length);
    const line =
      '<span class="qn-req-thin">Only ' +
      n +
      ' habit sentences fit ' +
      students.length +
      ' students, so some will repeat. <button type="button" class="qn-thin-link" data-action="tqSentences" data-do="all" data-row="' +
      i +
      '" title="Opens Browse Sentences on Habits, where you can pick another sentence for this part.">Write one of your own</button> to add more.</span>';
    expect(html).toContain(line);
    // In that row, after its source line.
    const row = html.slice(html.lastIndexOf('<div class="qn-req-row', html.indexOf(line)), html.indexOf(line));
    expect(row).toContain('<span class="qn-req-label">Habits</span>');
    expect(row).toContain('class="qn-req-source"');
  });

  it('shows it only for the parts that are thin for the student, never the grade, best piece or next step sentence', () => {
    const { html, d, st, termId, students } = thinCard();
    const strength = CommentBank.bankStrength(cid, { termId, students });
    const thin = d.sentences.filter(x => (strength.byStudent[st.id][x.step] || {}).thin);
    expect(thin.length).toBeGreaterThan(0);
    expect(thin.map(x => x.step)).not.toContain('example');
    expect(thin.map(x => x.step)).not.toContain('nextStep');
    expect((html.match(/class="qn-req-thin"/g) || []).length).toBe(thin.length);
    const at = html.indexOf('<span class="qn-req-label">Grade</span>');
    expect(html.slice(at, html.indexOf('<div class="qn-req-row', at))).not.toContain('qn-req-thin');
  });

  it('shows none on a sentence the teacher edited', () => {
    // Another student: the card keeps a student's rows once drawn.
    // The next-step sentence, whichever frame it is, edited by hand.
    const { html } = card('Hannah', (t, d) => {
      const next = d.sentences.find(x => x.step === 'nextStep');
      return t.replace(next.text, 'Hannah should try to do this next.');
    });
    const at = html.indexOf('Hannah should try to do this next.');
    expect(at).toBeGreaterThan(0);
    const end = html.indexOf('<div class="qn-req-row', at);
    expect(html.slice(at, end < 0 ? undefined : end)).not.toContain('qn-req-thin');
  });
});
