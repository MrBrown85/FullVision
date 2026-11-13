/**
 * The Progress Report's Assignment Grades block matches the Assessments
 * list (once the Quick Report)
 * (DECISIONS, "Student-facing levels are proficiencies", the Assignment
 * Grades block, 2026-11-12). Colin: "go with your recommendations on all
 * four".
 *
 * 1. A piece with no mark yet leaves its mark cell blank, as the
 *    Assessments list does: no dash.
 * 2. Points read "7 / 10", with spaces, as the Assessments list writes them.
 * 3. In a Proficiency or Both class a points piece prints no proficiency
 *    word beside its points (the word was only the band its points fall
 *    in). The points, and a Both class's %, are as scored.
 *
 * Everything else is what main printed. tests/fixtures/assignment-grades-
 * main.json holds the block's HTML as main printed it, in a Proficiency,
 * Both and Letter class, for every kind of piece, with each option on and
 * off; it was written by this file in a checkout of origin/main before the
 * change. Each case must now print exactly main's HTML with only the three
 * changes above made to it (two in a Letter class).
 *
 *   UPDATE_ASSIGNMENT_GRADES_MAIN=1 npx vitest run tests/assignment-grades-block.test.js
 */
import './setup.js';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = resolve(HERE, 'fixtures/assignment-grades-main.json');
const UPDATE = process.env.UPDATE_ASSIGNMENT_GRADES_MAIN === '1';
/* The block's HTML as origin/main printed it on Nov 12 at 9eddcecb, after
   the rulings above and before the Proficiency Word column left a
   Proficiency or Both class; written by this file in a checkout of that
   commit:
     UPDATE_ASSIGNMENT_GRADES_BEFORE_LAYOUT=1 npx vitest run tests/assignment-grades-block.test.js */
const BEFORE_FILE = resolve(HERE, 'fixtures/assignment-grades-before-layout.json');
const UPDATE_BEFORE = process.env.UPDATE_ASSIGNMENT_GRADES_BEFORE_LAYOUT === '1';

const CID = 'agb-course';
const SID = 'agb-stu';
const STUDENT = { id: SID, firstName: 'Ada', lastName: 'Lovelace' };
const T1 = 'agb-t1';
const T2 = 'agb-t2';

/* One piece of every kind: a level with its +, a late level, points, late
   points, Complete, Incomplete, Missing, Excused, and no mark yet. */
const WORK = [
  { id: 'lvl', title: 'Plate Tectonics', date: '2026-09-10', categoryId: 'c1', tagIds: [T1] },
  { id: 'lvl-late', title: 'Rock Cycle Poster', date: '2026-09-12', categoryId: 'c1', tagIds: [T2] },
  { id: 'pts', title: 'Energy Quiz', date: '2026-09-15', categoryId: 'c2', scoreMode: 'points', maxPoints: 10 },
  {
    id: 'pts-late',
    title: 'Formulas Quiz',
    date: '2026-09-18',
    categoryId: 'c2',
    scoreMode: 'points',
    maxPoints: 15,
  },
  { id: 'done', title: 'Reading Log', date: '2026-09-20', categoryId: 'c1', scoreMode: 'complete' },
  { id: 'not-done', title: 'Safety Contract', date: '2026-09-21', categoryId: 'c1', scoreMode: 'complete' },
  { id: 'missing', title: 'Density Lab', date: '2026-10-02', categoryId: 'c1', tagIds: [T1] },
  { id: 'excused', title: 'Field Trip Form', date: '2026-10-05', categoryId: 'c1', tagIds: [T1] },
  { id: 'none', title: 'Cells Sketch', date: '2026-10-08', categoryId: 'c1', tagIds: [T1] },
];
const POINTS_TITLES = ['Energy Quiz', 'Formulas Quiz'];

function seed(gradingSystem) {
  COURSES[CID] = { id: CID, name: 'Science 9', gradingSystem };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [
      { id: 'sec1', name: 'Questioning', tags: [{ id: T1, label: 'Questioning' }] },
      { id: 'sec2', name: 'Planning', tags: [{ id: T2, label: 'Planning' }] },
    ],
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [
    { id: 'c1', name: 'Labs', weight: 40 },
    { id: 'c2', name: 'Quizzes', weight: 60 },
  ];
  _cache.assessments[CID] = WORK.map(a => Object.assign({}, a));
  _cache.scores[CID] = {
    [SID]: [
      { assessmentId: 'lvl', tagId: T1, score: 3, mod: 1, date: '2026-09-10' },
      { assessmentId: 'lvl-late', tagId: T2, score: 2, date: '2026-09-12' },
      { assessmentId: 'pts', tagId: null, score: 7, points: 7, date: '2026-09-15' },
      { assessmentId: 'pts-late', tagId: null, score: 12, points: 12, date: '2026-09-18' },
      { assessmentId: 'done', tagId: '', score: 1, date: '2026-09-20' },
      { assessmentId: 'not-done', tagId: '', score: 0, date: '2026-09-21' },
    ],
  };
  _cache.statuses[CID] = {
    [SID + ':lvl-late']: 'LATE',
    [SID + ':pts-late']: 'LATE',
    [SID + ':missing']: 'NS',
    [SID + ':excused']: 'EXC',
  };
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}

/* Each way the block can be set: Show's Score, Percent and Proficiency
   Word on and off, each Organize By, two columns and the half-width
   (Side by Side) layout. */
const CASES = [['default', {}]];
[true, false].forEach(score =>
  [true, false].forEach(percent =>
    [true, false].forEach(word =>
      CASES.push([`score ${score} · percent ${percent} · word ${word}`, { score, percent, word }]),
    ),
  ),
);
CASES.push(
  ['by category', { organize: 'category' }],
  ['by category, no category grades', { organize: 'category', categoryGrade: false }],
  ['by competency', { organize: 'competency' }],
  ['two columns', { columns: 'two' }],
  ['half width', { size: 'half' }],
  ['oldest first, no course grade', { order: 'oldest', course: false }],
);
const MODES = ['proficiency', 'both', 'letter'];

const render = (mode, opts) => {
  seed(mode);
  return ReportBlocks.renderBlockGradeTable(CID, STUDENT, opts, {});
};

/* The rows read back: { title, figs, word } (word null when the row has no
   word cell). */
const ROW = /<div class="report-grades-row">((?:(?!<\/div>).)*)<\/div>/g;
function rows(html) {
  return [...html.matchAll(ROW)].map(m => {
    const cell = name => {
      const c = m[1].match(new RegExp(`<span class="report-grades-${name}">([^<]*)</span>`));
      return c ? c[1] : null;
    };
    return { title: cell('title'), figs: cell('figs'), word: cell('word') };
  });
}
const row = (html, title) => rows(html).find(r => r.title === title);

/* Main's HTML with only the rulings' changes made: no-mark cell blank,
   points spaced, and (Proficiency, Both) no word beside points. Since
   then (DECISIONS, the same entry, Assignment Grades layout, 2026-11-12)
   a Proficiency or Both class prints no Proficiency Word column at all,
   whatever Word says, and its legend keeps the scale line Word's default
   gives it (noWordColumn). */
function rulings(mode, html) {
  return noWordColumn(mode, ruledRows(mode, html));
}
function noWordColumn(mode, html) {
  if (mode === 'letter') return html;
  const scale = 'Proficiency: Emerging · Developing · Proficient · Extending.';
  return html
    .replace(/<span class="report-grades-word">[^<]*<\/span>/g, '')
    .replace(/^<div class="report-block-box report-grades( report-grades-half)?">/, m =>
      m.replace('">', ' report-grades-noword">'),
    )
    .replace(/<div class="report-grades-legend">([^<]*)<\/div>/, (m, text) => {
      if (text.indexOf(scale) >= 0) return m;
      const score = 'Points shown as scored; other work shown as its proficiency.';
      const parts = text.indexOf(score) === 0 ? [score, scale, text.slice(score.length).trim()] : [scale, text.trim()];
      return '<div class="report-grades-legend">' + parts.filter(Boolean).join(' ') + '</div>';
    });
}
function ruledRows(mode, html) {
  return html.replace(ROW, (whole, inner) => {
    let r = inner
      .replace(/(<span class="report-grades-figs">)—(<\/span>)/, '$1$2')
      .replace(/(<span class="report-grades-figs">)(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)/, '$1$2 / $3');
    const title = (inner.match(/<span class="report-grades-title">([^<]*)<\/span>/) || [])[1];
    if (mode !== 'letter' && POINTS_TITLES.indexOf(title) >= 0) {
      r = r.replace(/(<span class="report-grades-word">)[^<]*(<\/span>)/, '$1$2');
    }
    return '<div class="report-grades-row">' + r + '</div>';
  });
}

let NOW;
let MAIN;
let BEFORE;
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-01T12:00:00Z'));
  NOW = {};
  MODES.forEach(mode => CASES.forEach(([name, opts]) => (NOW[mode + ' › ' + name] = render(mode, opts))));
  if (UPDATE) writeFileSync(FILE, JSON.stringify(NOW, null, 2) + '\n');
  if (UPDATE_BEFORE) writeFileSync(BEFORE_FILE, JSON.stringify(NOW, null, 2) + '\n');
  MAIN = JSON.parse(readFileSync(FILE, 'utf8'));
  BEFORE = JSON.parse(readFileSync(BEFORE_FILE, 'utf8'));
});
afterAll(() => {
  vi.useRealTimers();
  delete COURSES[CID];
});

describe('Assignment Grades: what main printed, with only the rulings changed', () => {
  it('pins every case', () => {
    expect(Object.keys(MAIN).sort()).toEqual(Object.keys(NOW).sort());
  });
  MODES.forEach(mode =>
    CASES.forEach(([name]) => {
      const key = mode + ' › ' + name;
      it(key, () => {
        expect(MAIN[key]).toContain('report-grades-row');
        expect(NOW[key]).toBe(rulings(mode, MAIN[key]));
      });
    }),
  );
});

describe('Assignment Grades: each kind of row', () => {
  const get = (mode, name) => NOW[mode + ' › ' + name];

  it('a piece with no mark is blank in every class and layout, never a dash', () => {
    MODES.forEach(mode =>
      CASES.forEach(([name]) => {
        const r = row(get(mode, name), 'Cells Sketch');
        if (!r) return; // not in this range or competency (no mark: no competency row)
        expect(r.figs).toBe('');
        expect(r.word === null || r.word === '').toBe(true);
      }),
    );
    // The row keeps its cells, so its grid does not collapse.
    expect(get('proficiency', 'default')).toContain(
      '<span class="report-grades-title">Cells Sketch</span><span class="report-grades-figs"></span></div>',
    );
    expect(get('letter', 'score true · percent true · word true')).toContain(
      '<span class="report-grades-title">Cells Sketch</span><span class="report-grades-figs"></span><span class="report-grades-word"></span></div>',
    );
  });

  it('points read "7 / 10", with spaces, in every class', () => {
    expect(row(get('proficiency', 'default'), 'Energy Quiz').figs).toBe('7 / 10');
    expect(row(get('proficiency', 'default'), 'Formulas Quiz').figs).toBe('12 / 15');
    expect(row(get('both', 'default'), 'Energy Quiz').figs).toBe('7 / 10 · 70%');
    expect(row(get('letter', 'default'), 'Energy Quiz').figs).toBe('7 / 10 · 70%');
    MODES.forEach(mode => CASES.forEach(([name]) => expect(get(mode, name)).not.toMatch(/\d\/\d/)));
  });

  it('a Proficiency or Both class prints no word beside points, whatever Word says', () => {
    ['proficiency', 'both'].forEach(mode =>
      CASES.forEach(([name]) => {
        POINTS_TITLES.forEach(t => {
          const r = row(get(mode, name), t);
          if (r && r.word !== null) expect(r.word).toBe('');
        });
      }),
    );
    // Main printed the band's word there.
    expect(row(MAIN['proficiency › default'], 'Energy Quiz').word).toBe('Developing');
    expect(row(MAIN['both › default'], 'Energy Quiz').word).toBe('Developing');
  });

  it('a Letter class keeps the word beside points when Word is on', () => {
    const on = get('letter', 'score true · percent true · word true');
    expect(row(on, 'Energy Quiz')).toEqual({ title: 'Energy Quiz', figs: '7 / 10 · 70%', word: 'Developing' });
  });

  it('levels, Complete, Incomplete, Missing and Excused read as on main', () => {
    const p = get('proficiency', 'default');
    expect(row(p, 'Plate Tectonics')).toEqual({ title: 'Plate Tectonics', figs: 'Proficient +', word: null });
    expect(row(p, 'Rock Cycle Poster').figs).toBe('Developing');
    expect(row(p, 'Reading Log').figs).toBe('✓ Complete');
    expect(row(p, 'Safety Contract').figs).toBe('✗ Incomplete');
    expect(row(p, 'Density Lab').figs).toBe('Missing');
    expect(row(p, 'Field Trip Form').figs).toBe('Excused');
    expect(p).not.toContain('Late');
    const l = get('letter', 'default');
    expect(row(l, 'Plate Tectonics').figs).toBe(row(MAIN['letter › default'], 'Plate Tectonics').figs);
  });

  it('the legend stays true', () => {
    const p = get('proficiency', 'default');
    expect(p).toContain('Points shown as scored; other work shown as its proficiency.');
    expect(get('letter', 'default')).toContain('Points shown as scored; other work scored out of 4.');
  });
});

/* The Proficiency Word column in a Proficiency or Both class (DECISIONS,
   the same entry, Assignment Grades layout, 2026-11-12): it printed
   nothing there, so it is not printed and not offered, and a saved form's
   Word is not read. A Letter class prints exactly what it did. */
describe('Assignment Grades: the word column only in a Letter class', () => {
  const WORD_ROWS = /<span class="report-grades-word">/;

  it('a Letter class prints what main printed, every case', () => {
    CASES.forEach(([name]) => expect(NOW['letter › ' + name]).toBe(BEFORE['letter › ' + name]));
    // The word column is there with Word on, as before.
    expect(NOW['letter › score true · percent true · word true']).toMatch(WORD_ROWS);
    expect(NOW['letter › score true · percent true · word false']).not.toMatch(WORD_ROWS);
  });

  it('a Proficiency or Both class prints no word column, Word on or off, and nothing else moves', () => {
    ['proficiency', 'both'].forEach(mode =>
      CASES.forEach(([name]) => {
        const html = NOW[mode + ' › ' + name];
        expect(html).not.toMatch(WORD_ROWS);
        expect(html).toMatch(/^<div class="report-block-box report-grades( report-grades-half)? report-grades-noword"/);
        expect(html).toBe(noWordColumn(mode, BEFORE[mode + ' › ' + name]));
      }),
    );
    // Main printed an empty word cell beside every mark there.
    expect(BEFORE['proficiency › default']).toMatch(WORD_ROWS);
    expect(BEFORE['both › default']).toMatch(WORD_ROWS);
  });

  it('a saved form with Word on or off draws the same in a Proficiency or Both class', () => {
    ['proficiency', 'both'].forEach(mode =>
      [true, false].forEach(score =>
        [true, false].forEach(percent => {
          const on = NOW[`${mode} › score ${score} · percent ${percent} · word true`];
          expect(NOW[`${mode} › score ${score} · percent ${percent} · word false`]).toBe(on);
        }),
      ),
    );
  });

  it('a saved form keeps its Word option: it loads, draws without the column, and is not rewritten', () => {
    const S = ReportSheets;
    const saved = S.normalizeForm({
      v: 6,
      sides: [{ rows: [] }, { rows: [{ cells: [{ block: 'grade-table', options: { word: true } }] }] }],
    });
    const cellOf = (f, id) => f.sides[1].rows.map(r => r.cells[0]).find(c => c.block === id);
    const json = JSON.stringify(saved);
    const loaded = S.normalizeForm(JSON.parse(json));
    expect(cellOf(loaded, 'grade-table').options.word).toBe(true);
    MODES.forEach(mode => {
      seed(mode);
      const html = ReportBlocks.renderReportBlock(
        'grade-table',
        CID,
        STUDENT,
        {},
        S.optionsFor(cellOf(loaded, 'grade-table')),
      );
      if (mode === 'letter') expect(html).toMatch(WORD_ROWS);
      else expect(html).not.toMatch(WORD_ROWS);
    });
    expect(JSON.stringify(loaded)).toBe(JSON.stringify(S.normalizeForm(JSON.parse(json))));
    expect(JSON.stringify(saved)).toBe(json);
  });

  it('with no layout to measure, the mark column keeps its usual width (no style on the block)', () => {
    MODES.forEach(mode => CASES.forEach(([name]) => expect(NOW[mode + ' › ' + name]).not.toContain('--grades-mark')));
  });
});
