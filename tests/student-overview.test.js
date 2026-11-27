/**
 * The student page's Overview tab: the grade now, the grade if the missing
 * work were handed in, and the work still to do.
 *
 * 1. calc.js: withMissingLeftOut is the same calculation with one
 *    student's Missing work read as Excused. It moves only that student,
 *    only the pieces named, shares no cached number with the real grade,
 *    and puts everything back after.
 * 2. The tab: opens by default, shows both grades in a Letter class, says
 *    on each missing piece what handing it in adds, hides the projection
 *    when too little is marked, and never shows it in a Proficiency class.
 * 3. The picture of the grade (teacher/student-overview.js, DECISIONS "The
 *    student Overview pictures the grade"): calc.js gradeOverYear gives the
 *    grade on each day; the line has one point a day work counted, then
 *    today; All Your Work shows each piece's feedback without a click.
 * 4. Your Competencies at a glance (teacher/student-comps.js, DECISIONS
 *    "Your Competencies at a glance (2026-11-27)"): the strongest and the
 *    next to work on by name, ranked by the rule the Competencies tab's
 *    line uses.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';

const CID = 'cOV';
const STUDENTS = [
  { id: 's1', firstName: 'Ava', lastName: 'Test', designations: [] },
  { id: 's2', firstName: 'Ben', lastName: 'Test', designations: [] },
];
const pts = (id, title, max, date) => ({
  id,
  title,
  scoreMode: 'points',
  maxPoints: max,
  tagIds: ['T1'],
  date,
  type: 'summative',
});
const ASSESSMENTS = [
  pts('q1', 'Quiz One', 10, '2026-10-01'),
  pts('q2', 'Quiz Two', 10, '2026-10-05'),
  pts('m1', 'Short Response', 10, '2026-10-10'),
  pts('m2', 'Source Essay', 20, '2026-10-20'),
];
const entry = (aid, score) => ({ assessmentId: aid, tagId: 'T1', score, date: '2026-10-10', note: '' });

function seed(gradingSystem, statuses, scores) {
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem, gradeLevel: '12' };
  _cache.students[CID] = STUDENTS;
  _cache.assessments[CID] = ASSESSMENTS;
  _cache.scores[CID] = scores || { s1: [entry('q1', 9), entry('q2', 7)], s2: [entry('q1', 5), entry('q2', 5)] };
  _cache.statuses[CID] = statuses || { 's1:m1': 'NS', 's1:m2': 'NS', 's2:m1': 'NS' };
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

/* ── 1. calc.js ──────────────────────────────────────────────── */

describe('withMissingLeftOut', () => {
  beforeEach(() => {
    localStorage.clear();
    seed('letter');
  });

  it('counts Missing as 0 normally, and leaves it out inside', () => {
    // 16 of 50 points with both Missing pieces at 0.
    expect(getCourseLetterData(CID, 's1').R).toBe(32);
    const all = withMissingLeftOut('s1', null, () => getCourseLetterData(CID, 's1'));
    expect(all.R).toBe(80); // 16 of 20
    const one = withMissingLeftOut('s1', ['m1'], () => getCourseLetterData(CID, 's1'));
    expect(one.R).toBe(40); // 16 of 40: the essay still counts as 0
  });

  it('gives the same grade as marking those pieces Excused', () => {
    const left = withMissingLeftOut('s1', null, () => getCourseLetterData(CID, 's1'));
    seed('letter', { 's1:m1': 'EXC', 's1:m2': 'EXC', 's2:m1': 'NS' });
    expect(getCourseLetterData(CID, 's1')).toEqual(left);
  });

  it('moves only the student named', () => {
    const ben = getCourseLetterData(CID, 's2').R;
    const inside = withMissingLeftOut('s1', null, () => getCourseLetterData(CID, 's2').R);
    expect(inside).toBe(ben);
  });

  it('shares no cached number with the real grade, and puts the state back', () => {
    withMissingLeftOut('s1', null, () => getCourseLetterData(CID, 's1'));
    expect(getCourseLetterData(CID, 's1').R).toBe(32);
    expect(() =>
      withMissingLeftOut('s1', null, () => {
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(getCourseLetterData(CID, 's1').R).toBe(32);
  });

  it('refuses work that does not finish at once', () => {
    expect(() => withMissingLeftOut('s1', null, () => Promise.resolve(1))).toThrow(/does not finish at once/);
    expect(getCourseLetterData(CID, 's1').R).toBe(32);
  });
});

/* ── 2. The tab ──────────────────────────────────────────────── */

describe('gradeOverYear', () => {
  beforeEach(() => seed('letter'));
  it('reads the grade as it stood on each day, in the class’s grading style', () => {
    const [d1, d2, none] = gradeOverYear(CID, 's1', ['2026-10-01', '2026-10-05', '2026-09-01']);
    expect(d1).toMatchObject({ day: '2026-10-01', value: 90 });
    expect(d1.text).toContain('90%');
    expect(d2.value).toBe(80);
    expect(none.value).toBeNull();
  });

  it('on today, gives the grade the page shows now, in either grading style', () => {
    const today = courseToday(CID);
    expect(gradeOverYear(CID, 's1', [today])[0].value).toBe(getCourseLetterData(CID, 's1').R);
    seed('proficiency');
    const v = getOverallProficiency(CID, 's1');
    const [p] = gradeOverYear(CID, 's1', [today]);
    expect(p.value).toBe(v > 0 ? v : null);
    if (v > 0) expect(p.text).toBe(formatLevel(CID, v));
  });
});

describe('the Overview tab', () => {
  let stubDocument;
  let doc;

  function open(params) {
    PageStudent.init(Object.assign({ id: 's1', course: CID }, params || {}));
    return doc.getElementById('main');
  }

  beforeEach(() => {
    localStorage.clear();
    stubDocument = globalThis.document;
    doc = parseHTML(
      '<!DOCTYPE html><html><body><div id="page-layout"><div id="sidebar-mount"></div><div id="main"></div></div></body></html>',
    ).document;
    globalThis.document = doc;
    globalThis.requestAnimationFrame = fn => fn();
    runInThisContext(readFileSync('teacher/student-overview.js', 'utf-8'), { filename: 'teacher/student-overview.js' });
    runInThisContext(readFileSync('teacher/page-student.js', 'utf-8'), { filename: 'teacher/page-student.js' });
    seed('letter');
  });

  afterEach(() => {
    if (window.PageStudent) PageStudent.destroy();
    globalThis.document = stubDocument;
  });

  describe('Competencies summary: Strongest and Next to Work On', () => {
    const pick = items => PageStudent._helpers.cpPick(items);
    const c = (name, v, n, enough) => ({ name, v, n, enough });

    it('leaves out a competency with too few scores for Since the Start', () => {
      const r = pick([c('One score', 4, 1, false), c('Strong', 3.2, 5, true), c('Weak', 2.1, 4, true)]);
      expect(r.hi.name).toBe('Strong');
      expect(r.lo.name).toBe('Weak');
    });

    it('leaves an item out when nothing has enough evidence, and shows one when only one does', () => {
      expect(pick([c('A', 4, 1, false), c('B', 2, 1, false)])).toEqual({ hi: null, lo: null });
      const one = pick([c('A', 4, 1, false), c('B', 3, 6, true)]);
      expect(one.hi.name).toBe('B');
      expect(one.lo).toBeNull();
    });

    it('breaks a tie by the one with more scores', () => {
      const r = pick([
        c('Few', 3, 3, true),
        c('Many', 3, 8, true),
        c('Low few', 2, 2, true),
        c('Low many', 2, 9, true),
      ]);
      expect(r.hi.name).toBe('Many');
      expect(r.lo.name).toBe('Low many');
    });
  });

  it('is the first tab and opens when no tab was saved', () => {
    const main = open();
    const tabs = Array.from(main.querySelectorAll('.stu-tab'));
    expect(tabs[0].textContent).toContain('Overview');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(main.querySelector('.stu-ov')).not.toBeNull();
  });

  it('shows the grade now and the grade if the missing work is handed in', () => {
    const main = open();
    const now = main.querySelector('.stu-ov-now').textContent;
    const proj = main.querySelector('.stu-ov-proj').textContent;
    expect(now).toContain('32%');
    expect(proj).toContain('80%');
    expect(main.querySelector('.stu-ov-miss').textContent).toContain('Costing you 48%');
    expect(main.querySelector('.stu-tab').textContent).toContain('2 Missing');
  });

  it('folder tabs: a name and one figure each; missing work is an orange badge', () => {
    const main = open();
    const tab = main.querySelector('#stu-tab-overview');
    expect(tab.querySelector('.stu-tab-label').textContent).toBe('Overview');
    expect(tab.querySelector('.stu-tab-badge.miss').textContent).toBe('2 Missing');
    expect(tab.querySelector('.stu-tab-stat')).toBeNull();
    // No grey second line on any tab, and none under the panel's heading.
    expect(main.querySelector('.stu-tab-sub')).toBeNull();
    expect(main.querySelector('.stu-ov-head p')).toBeNull();
    Array.from(main.querySelectorAll('.stu-tab')).forEach(t => {
      expect(t.querySelectorAll('.stu-tab-stat, .stu-tab-badge').length).toBe(1);
    });
  });

  it('says missing work counts as 0 in the Missing tile, where it applies', () => {
    const main = open();
    expect(main.querySelector('.stu-ov-miss').textContent).toContain('Each counts as 0 until it’s in.');
  });

  it('says on each missing piece what handing it in adds', () => {
    const main = open();
    // The essay (20 points) adds more than the short response (10).
    const essay = Number(main.querySelector('#stu-ov-row-m2 .stu-ov-gain').textContent.match(/\+(\d+)%/)[1]);
    const short = Number(main.querySelector('#stu-ov-row-m1 .stu-ov-gain').textContent.match(/\+(\d+)%/)[1]);
    expect(essay).toBeGreaterThan(short);
    expect(main.querySelector('#stu-ov-row-m2').textContent).toContain('when it’s in');
    // Start With These and Next to Work On are gone (Colin, 2026-11-17).
    expect(main.querySelector('.stu-ov-todo, .stu-ov-better')).toBeNull();
  });

  it('the Missing tile shows the missing work in All Your Work', () => {
    let main = open();
    main.querySelector('button.stu-ov-miss').click();
    main = doc.getElementById('main');
    const rows = Array.from(main.querySelectorAll('.stu-ov-all .stu-ov-row')).map(r => r.id);
    expect(rows.sort()).toEqual(['stu-ov-row-m1', 'stu-ov-row-m2']);
  });

  it('shows each piece’s comment without a click', () => {
    seed('letter', undefined, {
      s1: [Object.assign(entry('q1', 9), { note: 'Clear steps; check units.' }), entry('q2', 7)],
      s2: [],
    });
    const main = open();
    expect(main.querySelector('#stu-ov-row-q1 .stu-ov-fb-note').textContent).toBe('Clear steps; check units.');
    expect(main.querySelector('.stu-ov-row-btn')).toBeNull();
  });

  it('pictures the grade over the year: a point a day work counted, then today', () => {
    const main = open();
    const points = Array.from(main.querySelectorAll('.stu-gp-pt'));
    // Oct 1, Oct 5, Oct 10 and Oct 20 (the last two missing, counted as 0), then today.
    expect(points).toHaveLength(5);
    expect(points[0].getAttribute('aria-label')).toContain('Quiz One');
    expect(points[0].getAttribute('aria-label')).toContain('90%');
    expect(points[0].dataset.aids).toBe('q1');
    expect(points[4].getAttribute('aria-label')).toMatch(/^Today: .*32%/);
    // Handing in the missing work: a forecast point, dashed.
    expect(main.querySelector('.stu-gp-projpt').getAttribute('title')).toContain('80%');
  });

  it('opens a piece of work in place on the Grades tab', () => {
    let main = open({ tab: 'grades' });
    main.querySelector('.stu-ov-row-btn[data-aid="m2"]').click();
    main = doc.getElementById('main');
    const row = main.querySelector('#stu-ov-row-m2');
    expect(row.classList.contains('open')).toBe(true);
    expect(row.querySelector('.stu-ov-facts').textContent).toContain('Adds About');
  });

  it('shows no projection when under a third of the work is marked', () => {
    seed('letter', { 's1:q2': 'NS', 's1:m1': 'NS', 's1:m2': 'NS' }, { s1: [entry('q1', 9)], s2: [] });
    const main = open();
    expect(main.querySelector('.stu-ov-thin')).not.toBeNull();
    expect(main.querySelector('.stu-ov-gain')).toBeNull();
    expect(main.querySelector('.stu-ov-miss').textContent).not.toContain('Costing');
  });

  it('shows no projection in a Proficiency class, where Missing is left out already', () => {
    seed('proficiency');
    const main = open();
    expect(main.querySelector('.stu-ov-proj')).toBeNull();
    expect(main.querySelector('.stu-ov').textContent).not.toContain('counts as 0');
  });
});

/* ── 4. Your Competencies at a glance ────────────────────────── */

describe('Your Competencies at a glance', () => {
  let doc;
  const comp = (name, v, n, more) =>
    Object.assign(
      {
        id: name,
        name,
        v,
        n,
        enough: n > 1,
        lv: Math.round(v),
        text: v.toFixed(1),
        word: ['', 'Emerging', 'Developing', 'Proficient', 'Extending'][Math.round(v)],
        trend: '',
        dir: 'none',
        aids: ['a1'],
        pieces: 1,
      },
      more || {},
    );
  const names = list => list.map(x => x.name);
  const draw = (items, more) => {
    const scored = items.filter(x => x.v > 0).length;
    const m = Object.assign({ comps: { items, counts: [], scored, total: items.length }, compFilter: '' }, more || {});
    doc = parseHTML('<!DOCTYPE html><html><body>' + StudentComps.html(m) + '</body></html>').document;
    return doc.querySelector('.stu-gp-comps');
  };
  const group = (card, label) =>
    Array.from(card.querySelectorAll('.stu-gp-group')).find(
      g => g.querySelector('.stu-ov-label').textContent === label,
    );
  const bars = g => Array.from(g.querySelectorAll('.stu-gp-tile .stu-gp-name')).map(n => n.textContent);

  it('ranks up to three each way, a third of what has enough scores', () => {
    const nine = [3.5, 3.4, 3.1, 3.0, 2.9, 2.8, 2.5, 2.3, 2.1].map((v, i) => comp('C' + i, v, 4));
    const r = StudentComps.rank(nine);
    expect(names(r.hi)).toEqual(['C0', 'C1', 'C2']);
    expect(names(r.lo)).toEqual(['C8', 'C7', 'C6']);
    // Seven with enough: two each way. Twenty-seven: still three.
    const seven = StudentComps.rank(nine.slice(0, 7));
    expect([seven.hi.length, seven.lo.length]).toEqual([2, 2]);
    const many = StudentComps.rank(Array.from({ length: 27 }, (_, i) => comp('M' + i, 1 + i / 10, 3)));
    expect([many.hi.length, many.lo.length]).toEqual([3, 3]);
  });

  it('leaves out a competency scored once, and breaks a tie by more scores', () => {
    const r = StudentComps.rank([
      comp('Once', 4, 1),
      comp('Few', 3, 2),
      comp('Many', 3, 8),
      comp('Low few', 2, 2),
      comp('Low many', 2, 9),
      comp('Mid', 2.5, 3),
    ]);
    expect(names(r.hi)).toEqual(['Many']);
    expect(names(r.lo)).toEqual(['Low many']);
  });

  it('never shows one level on both sides', () => {
    // One Extending and six at 3.0: the six cannot be both strongest and next to work on.
    const r = StudentComps.rank([comp('Top', 4, 3)].concat([5, 4, 3, 2, 6, 7].map((n, i) => comp('P' + i, 3, n))));
    expect(names(r.hi)).toEqual(['Top']);
    expect(names(r.lo)).toEqual(['P5', 'P4']);
    // Every competency at one level: a strongest by more scores, and nothing to work on next.
    const flat = StudentComps.rank([comp('A', 3, 2), comp('B', 3, 5), comp('C', 3, 4)]);
    expect(names(flat.hi)).toEqual(['B']);
    expect(flat.lo).toEqual([]);
  });

  it('draws the strongest and the next to work on by name, with the level as the class shows it', () => {
    const items = [3.5, 3.4, 3.1, 3.0, 2.9, 2.8, 2.5, 2.3, 2.1].map((v, i) => comp('Competency ' + i, v, 4));
    items[0] = comp('Data Recording', 3.5, 4, { dir: 'down', trend: '↓ Down from 4.0', pieces: 2, aids: ['a1', 'a2'] });
    const card = draw(items);
    expect(bars(group(card, 'Strongest'))).toEqual(['Data Recording', 'Competency 1', 'Competency 2']);
    expect(bars(group(card, 'Next to Work On'))).toEqual(['Competency 8', 'Competency 7', 'Competency 6']);
    const bar = card.querySelector('.stu-gp-tile[data-sec="Data Recording"]');
    expect(bar.querySelector('.stu-gp-val').textContent).toBe('3.5Extending↓');
    expect(bar.getAttribute('aria-label')).toBe('Data Recording: 3.5 Extending, ↓ Down from 4.0');
    expect(bar.getAttribute('data-action')).toBe('stuGpComp');
    expect(bar.getAttribute('data-aids')).toBe('a1 a2');
    expect(bar.querySelector('.stu-gp-tip').textContent).toBe('↓ Down from 4.0Show its 2 pieces');
    // See All opens the Competencies tab.
    const all = card.querySelector('.stu-gp-all');
    expect(all.textContent).toBe('See All 9');
    expect([all.getAttribute('data-action'), all.getAttribute('data-tab')]).toEqual(['stuTab', 'comps']);
  });

  it('in a Letter class, shows the % and no proficiency word', () => {
    const pct = (name, v, dir) => comp(name, v, 4, { text: v + '%', word: '', lv: v >= 90 ? 4 : 3, dir });
    const card = draw([pct('Evidence', 90, 'up'), pct('Perspective', 89, 'none'), pct('Inquiry', 83, 'down')]);
    expect(bars(group(card, 'Strongest'))).toEqual(['Evidence']);
    expect(bars(group(card, 'Next to Work On'))).toEqual(['Inquiry']);
    expect(card.querySelector('.stu-gp-tile[data-sec="Evidence"] .stu-gp-val').textContent).toBe('90%↑');
    expect(card.querySelector('.stu-gp-tile[data-sec="Inquiry"]').getAttribute('aria-label')).toBe('Inquiry: 83%');
    expect(card.querySelector('.stu-gp-seg')).toBeNull();
  });

  it('marks the competency All Your Work is narrowed to', () => {
    const items = [3.5, 3.0, 2.1].map((v, i) => comp('C' + i, v, 4));
    const card = draw(items, { compFilter: 'C0' });
    const on = card.querySelector('.stu-gp-tile[aria-pressed="true"]');
    expect(on.getAttribute('data-sec')).toBe('C0');
    expect(on.querySelector('.stu-gp-tip').textContent).toBe('Show all work');
  });

  it('keeps how the levels split above the names', () => {
    const items = [3.5, 3.0, 2.1].map((v, i) => comp('C' + i, v, 4));
    const m = {
      comps: {
        items,
        counts: [
          { lv: 4, n: 1, name: 'Extending' },
          { lv: 3, n: 2, name: 'Proficient' },
        ],
        scored: 3,
        total: 3,
      },
      compFilter: '',
    };
    const card = parseHTML(
      '<!DOCTYPE html><html><body>' + StudentComps.html(m) + '</body></html>',
    ).document.querySelector('.stu-gp-comps');
    expect(card.querySelector('.stu-gp-seg').getAttribute('aria-label')).toBe('1 Extending, 2 Proficient');
    expect(Array.from(card.querySelectorAll('.stu-gp-seg-part')).map(p => p.textContent)).toEqual(['1', '2']);
  });

  it('with each competency scored once, shows what is assessed so far and ranks nothing', () => {
    const card = draw([comp('Comprehension', 3, 1), comp('Not Yet', 0, 0), comp('Writing Process', 2, 1)]);
    expect(group(card, 'Strongest')).toBeUndefined();
    expect(bars(group(card, 'Assessed So Far'))).toEqual(['Comprehension', 'Writing Process']);
    expect(card.querySelector('.stu-gp-all').textContent).toBe('See All 3');
  });

  it('with nothing assessed, is one line', () => {
    const card = draw([comp('A', 0, 0), comp('B', 0, 0)]);
    expect(card.querySelector('.stu-gp-sub').textContent).toBe('None of 2 assessed yet');
    expect(card.querySelector('.stu-gp-tile, .stu-gp-all, .stu-gp-groups')).toBeNull();
  });

  it('escapes a competency name a teacher typed', () => {
    const card = draw([comp('<img src=x onerror=1>', 3, 1)]);
    expect(card.querySelector('img')).toBeNull();
    expect(card.querySelector('.stu-gp-name').textContent).toBe('<img src=x onerror=1>');
  });
});
