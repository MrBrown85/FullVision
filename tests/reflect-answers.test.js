/**
 * See Answers (docs/plans/reflect-plan.md, board 3): teacher/cm-reflect-answers.js
 * counts one reflection's answers per question for every kind, lists who
 * has not answered, keeps answers to questions since removed, follows a
 * reflection with its Goal Check-In, and draws Summary and By Student.
 * Demo Mode's Unit 2 Exit Reflection (shared/seed-data.js) carries the
 * board's numbers.
 */
import './setup.js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { parseHTML } from 'linkedom';

runInThisContext(readFileSync('teacher/cm-reflect-answers.js', 'utf-8'), { filename: 'teacher/cm-reflect-answers.js' });
const RA = globalThis.CmReflectAnswers;

const row = (sid, v, at) => ({ sid, v, at: at || '2026-03-10T10:00:00Z' });
const text = t => ({ num: null, text: t, json: null });
const pick = (...xs) => ({ num: null, text: xs.join(', '), json: xs });
const counts = bars => bars.map(b => [b.label, b.n]);

describe('summarise: the counts for every kind', () => {
  it('text: every answer by student, newest first', () => {
    const s = RA.summarise({ kind: 'text', prompt: 'Q' }, [
      row('a', text('first'), '2026-03-10T10:00:00Z'),
      row('b', text('newest'), '2026-03-12T10:00:00Z'),
      row('c', text('middle'), '2026-03-11T10:00:00Z'),
    ]);
    expect(s.type).toBe('list');
    expect(s.items.map(x => x.text)).toEqual(['newest', 'middle', 'first']);
    expect(s.items[0].sid).toBe('b');
  });

  it('short_set: the parts with their labels on one line', () => {
    const q = { kind: 'short_set', options: { labels: ['A strength', 'An interest'] } };
    const s = RA.summarise(q, [row('a', { num: null, text: 'x', json: ['Curious', ''] })]);
    expect(s.items[0].text).toBe('A strength: Curious');
  });

  it('choice: a bar per choice, most chosen first, zero kept, typed Other answers beneath', () => {
    const q = {
      kind: 'choice',
      options: { choices: ['Labs', 'Notes', 'Practice Questions', 'Group Work'], other: true },
    };
    const s = RA.summarise(q, [
      row('a', pick('Labs')),
      row('b', pick('Practice Questions')),
      row('c', pick('Labs')),
      row('d', pick('the video about moles')),
      row('e', text('Practice Questions')),
      row('f', pick('Labs', 'Group Work')),
    ]);
    expect(counts(s.bars)).toEqual([
      ['Labs', 3],
      ['Practice Questions', 2],
      ['Group Work', 1],
      ['Notes', 0],
      ['Other', 1],
    ]);
    expect(s.other).toEqual([{ sid: 'd', text: 'the video about moles', at: expect.any(String) }]);
    expect(s.bars[0].sids).toEqual(['a', 'c', 'f']);
  });

  it('rating: a bar per level, highest first, the end words at the two ends, and no average', () => {
    const q = { kind: 'rating', options: { levels: 5, low: 'Not Yet', high: 'Could Teach It' } };
    const s = RA.summarise(q, [row('a', { num: 4 }), row('b', { num: 4 }), row('c', { num: 1 }), row('d', { num: 5 })]);
    expect(counts(s.bars)).toEqual([
      ['5 · Could Teach It', 1],
      ['4', 2],
      ['3', 0],
      ['2', 0],
      ['1 · Not Yet', 1],
    ]);
    expect(JSON.stringify(s)).not.toMatch(/avg|average|mean/i);
    // Levels absent means 5.
    expect(RA.summarise({ kind: 'rating', options: {} }, []).bars).toHaveLength(5);
  });

  it('date: the dates chosen, in order, in words, with counts', () => {
    const s = RA.summarise({ kind: 'date' }, [
      row('a', text('2026-11-20')),
      row('b', text('2026-11-18')),
      row('c', text('2026-11-20')),
    ]);
    expect(counts(s.bars)).toEqual([
      ['November 18, 2026', 1],
      ['November 20, 2026', 2],
    ]);
  });

  it("ranking: the class's order by average position, each with how many put it first", () => {
    const q = { kind: 'ranking', options: { choices: ['Labs', 'Notes', 'Practice Questions'] } };
    const s = RA.summarise(q, [
      row('a', { json: ['Notes', 'Labs', 'Practice Questions'] }),
      row('b', { json: ['Labs', 'Practice Questions', 'Notes'] }),
      row('c', { json: ['Labs', 'Notes', 'Practice Questions'] }),
      // Read back from value_text when the json is missing.
      row('d', { num: null, text: '1. Practice Questions · 2. Labs · 3. Notes', json: null }),
    ]);
    expect(s.rows.map(r => [r.label, r.first])).toEqual([
      ['Labs', 2],
      ['Notes', 1],
      ['Practice Questions', 1],
    ]);
    expect(s.rows[0].avg).toBeCloseTo(1.5);
    expect(s.rows[0].firstSids).toEqual(['b', 'c']);
  });

  it('likert: a count grid, statements by columns, with who chose each', () => {
    const q = {
      kind: 'likert',
      options: { statements: ['I asked', 'I checked'], choices: ['Never', 'Sometimes', 'Always'] },
    };
    const s = RA.summarise(q, [
      row('a', { json: { 'I asked': 'Never', 'I checked': 'Always' } }),
      row('b', { json: { 'I asked': 'Never' } }),
      row('c', { num: null, text: 'I asked: Sometimes · I checked: Always', json: null }),
    ]);
    expect(s.cells.map(r => r.map(c => c.n))).toEqual([
      [2, 1, 0],
      [0, 0, 2],
    ]);
    expect(s.cells[0][0].sids).toEqual(['a', 'b']);
    expect(s.max).toBe(2);
  });

  it('scale4 with Core Competencies: a bar per step for each, and the why sentences', () => {
    const q = { kind: 'scale4', core_ids: ['PAR', 'PPI'], options: {} };
    const s = RA.summarise(q, [
      row('a', { json: { levels: { PAR: 2, PPI: 3 }, why: { PAR: 'I forget goals.' } } }),
      row('b', { json: { levels: { PAR: 2 } } }),
    ]);
    expect(s.type).toBe('core');
    expect(s.comps.map(c => c.name)).toEqual(['Personal Awareness & Responsibility', 'Personal & Cultural Identity']);
    expect(counts(s.comps[0].bars)).toEqual([
      ['Beginning', 0],
      ['Growing', 2],
      ['Confident', 0],
      ['Leading', 0],
    ]);
    expect(s.comps[0].why).toEqual([{ sid: 'a', at: expect.any(String), text: 'I forget goals.' }]);
    expect(s.comps[1].bars[2].n).toBe(1);
  });

  it('scale4 without competencies: bars for 1 to 4', () => {
    const s = RA.summarise({ kind: 'scale4', core_ids: [] }, [row('a', { num: 3 }), row('b', { num: 3 })]);
    expect(counts(s.bars)).toEqual([
      ['1', 0],
      ['2', 0],
      ['3', 2],
      ['4', 0],
    ]);
  });

  it('goal_status in its order and core_pick most chosen first, a bar per choice', () => {
    const g = RA.summarise(
      { kind: 'goal_status', options: { choices: ['Not Started', 'Working On It', 'Mostly There', 'Done'] } },
      [row('a', { num: 2, text: 'Working On It' }), row('b', { num: 4, text: null })],
    );
    expect(counts(g.bars)).toEqual([
      ['Not Started', 0],
      ['Working On It', 1],
      ['Mostly There', 0],
      ['Done', 1],
    ]);
    const c = RA.summarise({ kind: 'core_pick', core_ids: ['COM', 'PAR'] }, [row('a', text('PAR'))]);
    expect(counts(c.bars)).toEqual([
      ['Personal Awareness & Responsibility', 1],
      ['Communicating', 0],
    ]);
  });

  it('a section takes no answer; a kind it does not know lists what was stored', () => {
    expect(RA.summarise({ kind: 'section' }, []).type).toBe('section');
    const s = RA.summarise({ kind: 'scale7' }, [row('a', { num: 6 })]);
    expect(s).toEqual({ type: 'list', items: [{ sid: 'a', at: expect.any(String), text: '6' }] });
  });
});

/* A small class: three students, a reflection with a section, a private
   question, a removed question still in the list (archived) and one gone
   from it, and a Goal Check-In after it. */
const CID = 'ra-class';
function seedSmall() {
  localStorage.setItem(
    'gb-students-' + CID,
    JSON.stringify([
      { id: 'e1', firstName: 'Cece', lastName: 'Adeyemi', preferred: 'Cece' },
      { id: 'e2', firstName: 'Noor', lastName: 'Al-Rashid' },
      { id: 'e3', firstName: 'Jasper', lastName: 'Gill', preferred: 'Jas' },
    ]),
  );
  const refl = {
    id: 'qr',
    course_id: CID,
    kind: 'custom',
    title: 'Unit <1>',
    is_on: true,
    questions: [
      { id: 'q1', kind: 'section', prompt: 'About the Unit', options: { subtitle: 'Think back.' } },
      { id: 'q2', kind: 'text', prompt: 'What <b>stuck</b>?', options: {} },
      { id: 'q3', kind: 'rating', prompt: 'How sure?', options: { levels: 4, low: 'Not', high: 'Very' } },
      { id: 'q4', kind: 'text', prompt: 'Anything for me?', options: {}, teacher_only: true },
      { id: 'q5', kind: 'choice', prompt: 'Old one', options: { choices: ['A', 'B'] }, archived: true },
    ],
  };
  const goal = {
    id: 'qg',
    course_id: CID,
    kind: 'goal_checkin',
    title: 'Goal Check-In',
    parent_id: 'qr',
    is_on: true,
    questions: [
      { id: 'g1', kind: 'goal_status', prompt: 'How is it going?', options: { choices: ['Not Started', 'Done'] } },
    ],
  };
  localStorage.setItem('gb-questionnaires-' + CID, JSON.stringify([refl, goal]));
  localStorage.setItem(
    'gb-responses-' + CID,
    JSON.stringify({
      qr: {
        e1: [
          { id: 'r0', submitted_at: '2026-03-01T10:00:00Z', answers: { q2: text('older answer') } },
          {
            id: 'r1',
            submitted_at: '2026-03-10T10:00:00Z',
            answers: {
              q2: text('Atoms <move>'),
              q3: { num: 4, text: null, json: null },
              q5: pick('B'),
              gone: text('an answer to a question no longer listed'),
            },
          },
        ],
        e3: [{ id: 'r2', submitted_at: '2026-03-11T10:00:00Z', answers: { q3: { num: 2 }, q4: text('I was sick') } }],
        // Withdrawn or not on the list: not counted.
        e9: [{ id: 'r9', submitted_at: '2026-03-11T10:00:00Z', answers: { q2: text('ghost') } }],
      },
      qg: { e1: [{ id: 'r3', submitted_at: '2026-03-10T10:00:00Z', answers: { g1: { num: 2, text: 'Done' } } }] },
    }),
  );
}

let saved;
function demoOn() {
  saved = globalThis.isDemoMode;
  globalThis.isDemoMode = () => true;
}
function demoOff() {
  globalThis.isDemoMode = saved;
}

describe('the model: who answered, removed questions, the check-in after', () => {
  beforeEach(() => {
    localStorage.clear();
    demoOn();
    Questionnaires._reset();
    StudentVoice._reset();
    RA._reset();
    seedSmall();
  });
  afterEach(demoOff);

  it('counts only the class list, the newest submission, and names who has not answered', () => {
    const m = RA.model(CID, 'qr');
    expect(m.answered).toEqual(['e1', 'e3']);
    expect(m.missing.map(s => s.id)).toEqual(['e2']);
    const text2 = m.forms[0].items.find(it => it.q.id === 'q2');
    expect(text2.sum.items.map(x => x.text)).toEqual(['Atoms <move>']);
  });

  it('numbers the questions past the section, the check-in after its own, and removed ones apart', () => {
    const m = RA.model(CID, 'qr');
    expect(m.forms[0].items.map(it => [it.q.id, it.num])).toEqual([
      ['q1', null],
      ['q2', 1],
      ['q3', 2],
      ['q4', 3],
    ]);
    expect(m.forms[1].form.id).toBe('qg');
    expect(m.forms[1].items[0].num).toBe(4);
    expect(counts(m.forms[1].items[0].sum.bars)).toEqual([
      ['Not Started', 0],
      ['Done', 1],
    ]);
    const removed = m.forms[0].removed;
    expect(removed.map(it => it.q.prompt)).toEqual(['Old one', 'A question since removed']);
    expect(counts(removed[0].sum.bars)).toEqual([
      ['B', 1],
      ['A', 0],
    ]);
  });

  it('Summary: the head, Not Answered with every name, labels, and everything escaped', () => {
    const html = RA.render(CID, 'qr');
    const { document } = parseHTML('<div id="x">' + html + '</div>');
    const box = document.querySelector('.ra');
    expect(box.getAttribute('data-cid')).toBe(CID);
    expect(box.querySelector('h2').textContent).toBe('Unit <1>');
    expect(box.querySelector('.ra-sub').textContent).toBe('2 of 3 answered · On until you turn it off');
    expect(box.querySelector('.ra-missing').textContent).toBe('Not Answered (1): Noor A.');
    expect(box.querySelector('.ra-missing .ra-name').getAttribute('data-action')).toBe('cmOpenStudentPage');
    expect(box.querySelector('.ra-section h3').textContent).toBe('About the Unit');
    expect(box.querySelector('.ra-private').textContent).toBe('Private note to you');
    expect([...box.querySelectorAll('.ra-form')].map(h => h.textContent)).toEqual([
      'Goal Check-In',
      'Questions Since Removed',
    ]);
    expect(html).not.toMatch(/<move>|<b>stuck|<1>/);
    expect(
      [...box.querySelectorAll('[data-action]')].every(b => /^(sqAns|cmOpenStudentPage)/.test(b.dataset.action)),
    ).toBe(true);
    expect(box.querySelector('[role=radio][aria-checked=true]').textContent).toBe('Summary');
  });

  it('a bar clicked lists who chose it, right there; clicked again it closes', () => {
    const click = sel => {
      const { document } = parseHTML('<div>' + RA.render(CID, 'qr') + '</div>');
      const el = document.querySelector(sel);
      expect(RA.handleAction(el.dataset.action, el)).toBe(true);
    };
    click('[data-key="q3"][data-pick="b2"]');
    let { document } = parseHTML('<div>' + RA.render(CID, 'qr') + '</div>');
    expect(document.querySelector('.ra-who').textContent).toBe('2 (1): Jas G.');
    click('[data-key="q3"][data-pick="b2"]');
    ({ document } = parseHTML('<div>' + RA.render(CID, 'qr') + '</div>'));
    expect(document.querySelector('.ra-who')).toBeNull();
  });

  it('By Student: the whole reflection with No answer, stepping on and back, and the way back left to the tab', () => {
    const act = (action, extra) => {
      const { document } = parseHTML('<div>' + RA.render(CID, 'qr') + '</div>');
      const el = document.querySelector(`[data-action="${action}"]${extra || ''}`);
      return RA.handleAction(action, el);
    };
    expect(act('sqAnsView', '[data-view="student"]')).toBe(true);
    let { document } = parseHTML('<div>' + RA.render(CID, 'qr') + '</div>');
    expect(document.querySelector('.ra-stu-pick option[selected]').textContent).toBe('Cece Adeyemi');
    const answers = [...document.querySelectorAll('.ra-one')].map(x => x.textContent);
    expect(answers[0]).toContain('Atoms <move>');
    expect(answers[1]).toContain('4 of 4 (Very)');
    expect(answers[2]).toContain('No answer');
    expect(document.querySelector('#ra-prev').hasAttribute('disabled')).toBe(true);
    act('sqAnsNext');
    ({ document } = parseHTML('<div>' + RA.render(CID, 'qr') + '</div>'));
    expect(document.querySelector('.ra-stu-pick option[selected]').textContent).toBe('Noor Al-Rashid · Not Answered');
    expect(document.querySelector('.ra-when').textContent).toBe('Noor hasn’t answered yet.');
    const sel = document.querySelector('.ra-stu-pick');
    expect(RA.handleChange({ dataset: sel.dataset, value: 'e3', closest: s => sel.closest(s) })).toBe(true);
    ({ document } = parseHTML('<div>' + RA.render(CID, 'qr') + '</div>'));
    expect(document.querySelector('.ra-stu-count').textContent).toBe('3 of 3');
    expect(document.querySelector('#ra-next').hasAttribute('disabled')).toBe(true);
    expect(act('sqAnsBack')).toBe(false);
  });

  it('Print: the Summary with every answer and no buttons, named for what was printed', () => {
    const m = RA.model(CID, 'qr');
    const html = RA.printHtml(m, 'summary');
    expect(html).not.toMatch(/<button/);
    expect(html).toContain('Not Answered (1)');
    const one = RA.printHtml(m, 'student');
    expect(one).toContain('Cece Adeyemi');
  });
});

describe("Demo Mode's Unit 2 Exit Reflection, as the board shows it", () => {
  let m;
  beforeAll(() => {
    localStorage.clear();
    demoOn();
    Questionnaires._reset();
    StudentVoice._reset();
    RA._reset();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    m = RA.model('sci8', 'q-demo-unit2');
  });
  afterAll(() => {
    demoOff();
    localStorage.clear();
  });

  it('is a teacher-built reflection, on, with no closing date, after the ready-made three', () => {
    const list = Questionnaires.list('sci8');
    expect(list.map(q => q.id)).toEqual(['q-demo-about', 'q-demo-nov', 'q-demo-goal', 'q-demo-unit2']);
    const q = list[3];
    expect(q).toMatchObject({
      kind: 'custom',
      title: 'Unit 2 Exit Reflection',
      theme: 'A few questions about how the unit went. About 5 minutes.',
      template_id: null,
      report_period: null,
      parent_id: null,
      is_on: true,
      closes_on: null,
    });
    expect(q.questions.map(x => x.kind)).toEqual(['text', 'rating', 'choice', 'likert', 'ranking']);
    expect(q.answered).toHaveLength(19);
  });

  it('19 of 27 answered, the eight who have not named', () => {
    expect(m.answered).toHaveLength(19);
    expect(m.students).toHaveLength(27);
    expect(m.missing.map(s => s.preferred)).toEqual([
      'Noor',
      'Liam',
      'Mateo',
      'Ethan',
      'Jas',
      'Fatima',
      'Priya',
      'Darius',
    ]);
  });

  it("the board's counts", () => {
    const it_ = n => m.forms[0].items[n].sum;
    expect(it_(1).bars.map(b => b.n)).toEqual([2, 7, 6, 3, 1]);
    expect(counts(it_(2).bars)).toEqual([
      ['Labs', 9],
      ['Practice Questions', 5],
      ['Group Work', 3],
      ['Notes', 1],
      ['Other', 1],
    ]);
    expect(it_(2).other[0].text).toBe('the video about moles');
    expect(it_(3).cells.map(r => r.map(c => c.n))).toEqual([
      [3, 8, 6, 2],
      [1, 5, 9, 4],
      [4, 7, 5, 3],
    ]);
    expect(it_(4).rows.map(r => [r.label, r.first])).toEqual([
      ['Labs', 11],
      ['Practice Questions', 6],
      ['Notes', 2],
    ]);
  });

  it('the grid: darker means more, every cell with its number', () => {
    const { document } = parseHTML('<div>' + RA.render('sci8', 'q-demo-unit2') + '</div>');
    const cells = [...document.querySelectorAll('.ra-cell')];
    expect(cells.map(c => c.textContent).slice(0, 4)).toEqual(['3', '8', '6', '2']);
    expect(cells[1].className).toContain('ra-t5');
    expect(cells[6].className).toContain('ra-t6');
    expect(document.querySelector('.ra').textContent).toContain(
      'Each number is how many students chose it. Darker means more.',
    );
    expect(document.querySelector('.ra-more').textContent).toBe('See All 19');
  });
});
