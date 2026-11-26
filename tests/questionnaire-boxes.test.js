/* The Sentences card draws one box per part (term-questionnaire-redesign-plan,
   slice 1): rows of a part that sit together share a box with a head line
   (tile, name, evidence), the grey source line under a sentence is gone and
   its words are the sentence's tooltip, an empty part is one tinted button,
   and the header drops the word under the grade. */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const RQ = ReportQuestionnaire;

describe('ReportQnBoxes', () => {
  const B = ReportQnBoxes;
  const entry = (kind, html, label) => ({ kind, html, row: { step: kind }, label });
  const names = html => (html.match(/class="qn-box-name">[^<]*/g) || []).map(x => x.replace(/^[^>]*>/, ''));

  it('puts rows of one part in one box and a row of another part in a new one', () => {
    const html = B.wrap([entry('grade', '<i>a</i>'), entry('habits', '<i>b</i>'), entry('habits', '<i>c</i>')], {
      first: 'Liam',
      facts: () => ({}),
    });
    expect(names(html)).toEqual(['Grade', 'Work Habits']);
    expect(html.match(/<i>/g)).toHaveLength(3);
  });

  it('puts Support into the Next Step box it follows, and names the Voice for the student', () => {
    const html = B.wrap([entry('nextStep', 'a'), entry('support', 'b'), entry('voice', 'c'), entry('support', 'd')], {
      first: 'Liam',
      facts: () => ({}),
    });
    expect(names(html)).toEqual(['Next Step', 'Liam’s Voice', 'Support']);
  });

  it('draws the evidence as data: the grade, a piece with its result, the six habit bars, the missing share', () => {
    expect(B.evidence('grade', { grade: 'C · 65.8%' })).toContain('C · 65.8%');
    expect(B.evidence('bestPiece', { piece: { title: 'Lab', mark: '92%' } })).toMatch(/Lab.*qn-ev-badge">92%/);
    const bars = B.evidence('habits', {
      habits: [4, 3, 2, 1, 0, 4].map((v, i) => ({ name: 'H' + i, v })),
      scale: ['Rarely', 'Sometimes', 'Usually', 'Consistently'],
    });
    expect(bars.match(/qn-ev-bar"/g)).toHaveLength(5);
    expect(bars).toContain('height:15px');
    expect(bars).toContain('H4: Not rated');
    expect(B.evidence('notHandedIn', { missing: 10, total: 31 })).toContain('10 of 31');
    expect(B.evidence('attendance', { absent: 2, late: 1 })).toContain('2 Absent · 1 Late');
    expect(B.evidence('voice', { goal: true })).toContain('Goal Check-In');
  });
});

describe('the card drawn for a Demo Mode student', () => {
  let cid, saved, hadDoc, oldDoc;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
    hadDoc = 'document' in globalThis;
    oldDoc = globalThis.document;
    globalThis.document = { getElementById: () => null, querySelectorAll: () => [] };
    RQ.configure({ activeCourse: cid, renderReports: () => {} });
  });
  afterAll(() => {
    if (hadDoc) globalThis.document = oldDoc;
    else delete globalThis.document;
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });

  it('draws one box per part, a head line in each, and no grey source line under a sentence', () => {
    const students = RQ.getTqStudents();
    const st = students.find(s => s.firstName === 'Noor');
    RQ.tqStudentIndex = students.indexOf(st);
    const termId = ReportBlocks.getTermId();
    const f = CommentBank.facts(cid, st, termId);
    const d = CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id) });
    upsertTermRating(cid, st.id, termId, { narrative: d.text });
    const html = RQ.renderTermQuestionnaire(cid);
    const card = html.slice(html.indexOf('id="tq-sentences"'));
    const boxes = card.match(/class="qn-box"/g) || [];
    expect(boxes.length).toBeGreaterThan(2);
    expect((card.match(/class="qn-box-head"/g) || []).length).toBe(boxes.length);
    expect(card).not.toContain('qn-srow-facts');
    expect(card).not.toMatch(/<span class="qn-req-source">[^<]*(from|rated|Weakest|Typed by you)/);
    expect(card).not.toContain('Reword, edit or drag to reorder');
    // The sentence's tooltip has the source's words.
    expect(card).toMatch(/class="qn-req-text" title="[^"]+"/);
    // Strength, Work Habits and Missing Work carry their new names; the old ones are gone.
    expect(card).not.toMatch(/class="qn-box-name">(Strengths|Habits|Not Handed In)</);
  });

  it('shows an empty part as one button, not a grey sentence', () => {
    const students = RQ.getTqStudents();
    const st = students[0];
    RQ.tqStudentIndex = 0;
    const html = RQ.renderTermQuestionnaire(cid);
    const card = html.slice(html.indexOf('id="tq-sentences"'));
    expect(card).toContain('+ Support Line ▾</button>');
    expect(card).toContain('+ Closing Sentence for the Class</button>');
    expect(card).not.toContain('No support lines chosen');
    expect(card).not.toContain('No closing sentence for this class');
    expect(st).toBeTruthy();
  });

  it('the header reads "N of M handed in" with no standing word under the grade', () => {
    const st = RQ.getTqStudents()[0];
    const f = CommentBank.facts(cid, st, 'term-2');
    expect(RQ.headerGrade(cid, st.id, f).small).toBe(f.record.handed + ' of ' + f.record.total + ' handed in');
  });
});
