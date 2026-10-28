/**
 * The layout model behind Page Studio (teacher/report-sheets.js): sides
 * of rows, each row one block at Row width or one or two at Side by Side
 * width, migration from every earlier shape, and the pure helpers the
 * Studio calls. docs/DECISIONS.md "Report forms" 13.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const S = ReportSheets;
const ids = f => S.onForm(f);
const rowsOf = (f, side) =>
  f.sides[side].rows.map(r => r.cells.map(c => c.block + (c.size === 'half' ? '/half' : '')).join('+'));

describe('normalizeForm', () => {
  it('is the Report Card when nothing is saved', () => {
    const f = S.normalizeForm(undefined);
    expect(f.v).toBe(6);
    expect(Object.keys(f)).toEqual(['v', 'id', 'name', 'type', 'sides', 'pinned', 'perStudent']);
    expect(f.sides).toHaveLength(2);
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'competency-table',
      'legend',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    expect(rowsOf(f, 1)).toEqual(['learner-dimensions', 'parent-response']);
    expect(S.cellOf(f, 'teacher-narrative')).toEqual({ block: 'teacher-narrative', size: 'row', lines: 10 });
    expect(S.cellOf(f, 'parent-response')).toEqual({ block: 'parent-response', size: 'row', lines: 3 });
    expect(f.pinned).toBe('parent-response');
    expect(f.type).toBe('standard');
    expect(f).not.toHaveProperty('pagesPerStudent');
    expect(f).not.toHaveProperty('pages');
  });

  it('migrates a v5 grid form: blocks in (row, column) order become rows, two half-wide blocks on one grid row a pair, a fill block’s rows its lines', () => {
    const f = S.normalizeForm({
      v: 5,
      id: 'mine',
      name: 'Mine',
      pages: [
        {
          blocks: [
            { block: 'header', x: 0, y: 0, w: 12 },
            { block: 'teacher-narrative', x: 0, y: 5, w: 12, h: 13, options: { x: 1 } },
            { block: 'legend', x: 6, y: 18, w: 6, h: 6 },
            { block: 'support-home', x: 0, y: 18, w: 6, h: 6 },
            { block: 'competency-table', x: 0, y: 24, w: 8, h: 13 },
            { block: 'observations', x: 8, y: 24, w: 4, h: 13 },
            { block: 'growth', x: 0, y: 37, w: 5, h: 8 },
          ],
        },
        { blocks: [{ block: 'parent-response', x: 0, y: 30, w: 12, h: 10 }] },
      ],
      pinned: 'parent-response',
      perStudent: { st1: { hide: ['legend'] } },
    });
    expect(f.v).toBe(6);
    expect(f.id).toBe('mine');
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'teacher-narrative',
      'support-home/half+legend/half',
      'competency-table',
      'observations/half',
      'growth/half',
    ]);
    // 13 rows × 20px less the box's 40px, in 22px lines: 10.
    expect(S.cellOf(f, 'teacher-narrative')).toEqual({
      block: 'teacher-narrative',
      size: 'row',
      lines: 10,
      options: { x: 1 },
    });
    expect(S.cellOf(f, 'parent-response').lines).toBe(7);
    expect(f.pinned).toBe('parent-response');
    expect(f.perStudent).toEqual({ st1: { hide: ['legend'] } });
  });

  it('migrates a v4 form through v5: spans become widths, lines stay lines', () => {
    const f = S.normalizeForm({
      v: 4,
      pages: [
        {
          rows: [
            { cells: [{ block: 'header', span: 12 }] },
            { cells: [{ block: 'teacher-narrative', span: 12, height: 'fixed', lines: 6 }] },
            {
              cells: [
                { block: 'competency-table', span: 6 },
                { block: 'legend', span: 6 },
              ],
            },
          ],
        },
        { rows: [{ cells: [{ block: 'parent-response', span: 12 }] }] },
      ],
      pinned: 'parent-response',
    });
    expect(rowsOf(f, 0)).toEqual(['header', 'teacher-narrative', 'competency-table/half+legend/half']);
    expect(S.cellOf(f, 'teacher-narrative').lines).toBe(6);
    expect(rowsOf(f, 1)).toEqual(['parent-response']);
  });

  it('migrates a v3 form through v4: a pair is two halves, the pin is the form’s', () => {
    const f = S.normalizeForm({
      v: 3,
      front: [{ block: 'header' }, { pair: [{ block: 'competency-table' }, { block: 'legend' }] }],
      back: [{ block: 'learner-dimensions' }, { block: 'parent-response', pinned: true }],
    });
    expect(rowsOf(f, 0)).toEqual(['header', 'competency-table/half+legend/half']);
    expect(rowsOf(f, 1)).toEqual(['learner-dimensions', 'parent-response']);
    expect(f.pinned).toBe('parent-response');
  });

  it('drops unknown blocks, duplicates and extra fields, keeps empty sides, and makes the pinned block last at Row width', () => {
    const f = S.normalizeForm({
      v: 6,
      sides: [
        {
          rows: [
            {
              cells: [
                { block: 'parent-response', size: 'half', extra: 1 },
                { block: 'legend', size: 'half' },
              ],
            },
            { cells: [{ block: 'nope' }] },
            { cells: [{ block: 'legend' }] },
            {
              cells: [
                { block: 'student-reflection-learning', size: 'half' },
                { block: 'observations', size: 'half' },
              ],
            },
            { cells: [{ block: 'header', options: { school: false } }] },
          ],
        },
        { rows: [] },
        { rows: [{ cells: [{ block: 'teacher-narrative', lines: 99 }] }] },
      ],
      pinned: 'parent-response',
    });
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'legend/half',
      'student-reflection-learning',
      'observations/half',
      'parent-response',
    ]);
    expect(S.cellOf(f, 'parent-response')).toEqual({ block: 'parent-response', size: 'row', lines: 3 });
    expect(S.cellOf(f, 'header')).toEqual({ block: 'header', size: 'row', options: { school: false } });
    expect(f.sides[1].rows).toEqual([]);
    expect(S.cellOf(f, 'teacher-narrative').lines).toBe(16);
    expect(S.canHalf('student-reflection-learning')).toBe(false);
    expect(S.canHalf('parent-response')).toBe(false);
    expect(S.canHalf('legend')).toBe(true);
  });

  it('formFor opens an old Brief class on the Interim Update and anything else on the Report Card', () => {
    expect(S.formFor({ preset: 'brief' }).id).toBe('interim-update');
    expect(S.formFor({ preset: 'brief' }).sides).toHaveLength(1);
    expect(S.formFor({ preset: 'standard' }).id).toBe('report-card');
    expect(S.formFor(null).id).toBe('report-card');
    expect(S.formFor({ form: { v: 6, id: 'x', sides: [] } }).id).toBe('x');
  });
});

describe('editing', () => {
  it('insert puts a new block in its own row at the end of a side, before the pinned row; at a row index on request', () => {
    let f = S.insert(S.form(), 'observations', { side: 1 });
    expect(rowsOf(f, 1)).toEqual(['learner-dimensions', 'observations', 'parent-response']);
    f = S.insert(f, 'next-steps', { side: 0, row: 2 });
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'competency-table',
      'next-steps',
      'legend',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    // Row 0 on the Front is the letterhead's: a block asked there goes under it.
    f = S.insert(f, 'growth', { side: 0, row: 0 });
    expect(rowsOf(f, 0)[1]).toBe('growth');
    // A moved block keeps its options and leaves its pair.
    f = S.insert(S.setOption(f, 'missing-work', 'x', 1), 'missing-work', { side: 1, row: 0 });
    expect(rowsOf(f, 0)).toContain('term-attendance/half');
    expect(rowsOf(f, 1)[0]).toBe('missing-work/half');
    expect(S.cellOf(f, 'missing-work').options).toEqual({ x: 1 });
    expect(S.insert(f, 'header', { side: 1 })).toBe(f);
    expect(S.insert(f, 'nope', { side: 1 })).toBe(f);
  });

  it('beside pairs two blocks that may go Side by Side when the target is alone; otherwise nothing changes', () => {
    const f0 = S.form();
    const f = S.beside(f0, 'legend', 'competency-table');
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'competency-table/half+legend/half',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    expect(S.partnerOf(f, 'legend')).toBe('competency-table');
    expect(S.partnerOf(f, 'teacher-narrative')).toBeNull();
    // A full pair takes no third; the reflections never pair; the response never pairs.
    expect(S.beside(f, 'teacher-narrative', 'legend')).toEqual(f);
    expect(S.beside(f0, 'student-reflection-habits', 'legend')).toBe(f0);
    expect(S.beside(f0, 'legend', 'parent-response')).toBe(f0);
    // A new block from the palette pairs too.
    const g = S.beside(f0, 'support-home', 'legend');
    expect(rowsOf(g, 0)[2]).toBe('legend/half+support-home/half');
  });

  it('moveRow moves a row up or down on its side; the letterhead and the pinned row stay put', () => {
    let f = S.moveRow(S.form(), 'teacher-narrative', -1);
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'competency-table',
      'teacher-narrative',
      'legend',
      'term-attendance/half+missing-work/half',
    ]);
    f = S.moveRow(f, 'missing-work', -1);
    expect(rowsOf(f, 0)[3]).toBe('term-attendance/half+missing-work/half');
    expect(S.moveRow(f, 'competency-table', -1)).toBe(f); // under the letterhead already
    expect(S.moveRow(f, 'learner-dimensions', 1)).toBe(f); // above the pinned row already
    expect(S.moveRow(f, 'parent-response', -1)).toBe(f);
    expect(S.moveRow(f, 'header', 1)).toBe(f);
  });

  it('moveToSide appends a row to another side before its pinned row', () => {
    const f = S.moveToSide(S.form(), 'legend', 1);
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'competency-table',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    expect(rowsOf(f, 1)).toEqual(['learner-dimensions', 'legend', 'parent-response']);
    expect(S.moveToSide(f, 'legend', 1)).toBe(f);
    expect(S.moveToSide(f, 'legend', 5)).toBe(f);
    expect(S.moveToSide(f, 'parent-response', 0)).toBe(f);
  });

  it('setSize: Side by Side pairs with a lone Side by Side neighbour; Row splits a pair, the partner staying at half width', () => {
    let f = S.setSize(S.form(), 'legend', 'half');
    expect(rowsOf(f, 0)[2]).toBe('legend/half');
    f = S.setSize(f, 'competency-table', 'half');
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'competency-table/half+legend/half',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    f = S.setSize(f, 'competency-table', 'row');
    expect(rowsOf(f, 0)).toEqual([
      'header',
      'competency-table',
      'legend/half',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
    ]);
    expect(S.setSize(f, 'student-reflection-habits', 'half')).toEqual(f);
    expect(rowsOf(S.setSize(S.form(), 'parent-response', 'half'), 1)).toEqual([
      'learner-dimensions',
      'parent-response',
    ]);
  });

  it('setLines clamps to the block’s range and only applies to writing boxes', () => {
    const f = S.form();
    expect(S.cellOf(S.setLines(f, 'teacher-narrative', 14), 'teacher-narrative').lines).toBe(14);
    expect(S.cellOf(S.setLines(f, 'teacher-narrative', 1), 'teacher-narrative').lines).toBe(3);
    expect(S.cellOf(S.setLines(f, 'teacher-narrative', 40), 'teacher-narrative').lines).toBe(16);
    expect(S.cellOf(S.setLines(f, 'parent-response', 5), 'parent-response').lines).toBe(5);
    expect(S.setLines(f, 'legend', 5)).toEqual(f);
    expect(S.optionsFor(S.cellOf(f, 'teacher-narrative')).lines).toBe(10);
    expect(S.optionsFor({ block: 'teacher-narrative' }).lines).toBe(10);
  });

  it('removeCell drops the block (and the pin if it was pinned); its partner stays alone at half width', () => {
    let f = S.removeCell(S.form(), 'term-attendance');
    expect(rowsOf(f, 0)[4]).toBe('missing-work/half');
    expect(S.available(f)).toContain('term-attendance');
    f = S.removeCell(f, 'parent-response');
    expect(f.pinned).toBeNull();
    expect(rowsOf(f, 1)).toEqual(['learner-dimensions']);
    expect(S.removeCell(f, 'header')).toBe(f);
    expect(S.removeCell(f, 'nope')).toBe(f);
  });

  it('addSide, removeSide (only an empty side past the second) and setSides (Front Only folds the Back onto the Front)', () => {
    let f = S.addSide(S.form());
    expect(f.sides).toHaveLength(3);
    expect(S.removeSide(f, 1)).toBe(f);
    expect(S.removeSide(f, 2).sides).toHaveLength(2);
    f = S.insert(f, 'observations', { side: 2 });
    expect(S.removeSide(f, 2)).toBe(f);
    const one = S.setSides(S.form(), 1);
    expect(one.sides).toHaveLength(1);
    expect(rowsOf(one, 0)).toEqual([
      'header',
      'competency-table',
      'legend',
      'teacher-narrative',
      'term-attendance/half+missing-work/half',
      'learner-dimensions',
      'parent-response',
    ]);
    expect(one.pinned).toBe('parent-response');
    const two = S.setSides(one, 2);
    expect(two.sides).toHaveLength(2);
    expect(two.sides[1].rows).toEqual([]);
    expect(S.setSides(S.form(), 2).sides).toHaveLength(2);
  });

  it('setOption, setNoEvidence, setPinned, setType', () => {
    let f = S.setOption(S.form(), 'competency-table', 'evidence', false);
    expect(S.cellOf(f, 'competency-table').options).toEqual({ evidence: false });
    f = S.setNoEvidence(f, 'competency-table', 'hide');
    expect(S.cellOf(f, 'competency-table').noEvidence).toBe('hide');
    f = S.setPinned(f, null);
    expect(f.pinned).toBeNull();
    expect(S.setPinned(f, 'parent-response').pinned).toBe('parent-response');
    expect(S.setPinned(f, 'legend').pinned).toBeNull();
    expect(S.setType(f, 'compact').type).toBe('compact');
    expect(S.setType(f, 'x').type).toBe('standard');
  });

  it('hideFor hides a block for one student and leaves the class layout alone', () => {
    let f = S.hideFor(S.form(), 'st1', 'legend', true);
    expect(S.hiddenFor(f, 'st1')).toEqual(['legend']);
    expect(S.hiddenFor(f, 'st2')).toEqual([]);
    expect(rowsOf(f, 0)).toEqual(rowsOf(S.form(), 0));
    f = S.hideFor(f, 'st1', 'legend', false);
    expect(f.perStudent).toEqual({});
  });

  it('the letterhead keeps its options through normalizeForm and any later edit', () => {
    let f = S.setOption(S.form(), 'header', 'studentNumber', false);
    expect(S.cellOf(f, 'header').options).toEqual({ studentNumber: false });
    f = S.insert(f, 'legend', { side: 1 });
    expect(S.cellOf(f, 'header').options).toEqual({ studentNumber: false });
    expect(S.normalizeForm(f).sides[0].rows[0].cells[0].options).toEqual({ studentNumber: false });
  });
});

describe('starters', () => {
  it('are whole v6 forms: the letterhead first, the Response last on the Back, every block once', () => {
    S.starters().forEach(st => {
      const f = S.starter(st.id);
      expect(f.v).toBe(6);
      expect(f.sides[0].rows[0].cells[0].block).toBe('header');
      const all = ids(f);
      expect(new Set(all).size).toBe(all.length);
      if (f.pinned) {
        const last = f.sides[f.sides.length - 1].rows.slice(-1)[0];
        expect(last.cells.map(c => c.block)).toEqual([f.pinned]);
      }
    });
    expect(S.starter('interim-update').sides).toHaveLength(1);
    expect(S.starter('conference-pack').sides).toHaveLength(2);
    expect(S.optionsFor(S.cellOf(S.starter('conference-pack'), 'grade-table')).range).toBe('all');
    expect(S.starter('nope')).toBeNull();
  });

  it('optionsFor fills the registry defaults and adds the no-evidence rule and the lines', () => {
    expect(S.optionsFor({ block: 'competency-table' })).toEqual({
      evidence: true,
      ican: false,
      assignments: false,
      noEvidence: 'show',
    });
    expect(S.optionsFor({ block: 'competency-table', options: { ican: true }, noEvidence: 'hide' })).toMatchObject({
      ican: true,
      noEvidence: 'hide',
    });
    expect(S.optionsFor({ block: 'parent-response', lines: 5 })).toEqual({ lines: 5 });
    expect(S.optionsFor({ block: 'legend' })).toEqual({});
  });

  it('every option in the registry has a key, a Title Case label and a default; every block a label and a group', () => {
    Object.keys(S.BLOCKS).forEach(id => {
      const def = S.BLOCKS[id];
      expect(def.label).toMatch(/^[A-Z]/);
      if (id !== 'header') expect(S.PALETTE_GROUPS).toContain(def.group);
      expect(def).not.toHaveProperty('rows');
      (def.options || []).forEach(o => {
        expect(o.key).toMatch(/^[a-z][A-Za-z]*$/);
        expect(o.label).toMatch(/^[A-Z]/);
        expect(o).toHaveProperty('def');
      });
      if (def.fill && def.lines) {
        expect(def.minLines).toBeLessThanOrEqual(def.lines);
        expect(def.maxLines).toBeGreaterThanOrEqual(def.lines);
      }
    });
  });
});

describe('rendering with options', () => {
  it('the text block prints its title and text, and nothing when empty', () => {
    expect(ReportBlocks.renderReportBlock('text-block', 'c1', {}, {}, {})).toBe('');
    const html = ReportBlocks.renderReportBlock(
      'text-block',
      'c1',
      {},
      {},
      {
        title: 'Upcoming',
        text: 'Science fair\non Nov 30 <b>',
      },
    );
    expect(html).toContain('Upcoming');
    expect(html).toContain('Science fair<br>on Nov 30 &lt;b&gt;');
  });

  it('the Parent / Guardian Response sizes its comments box by its lines and keeps its wording', () => {
    const three = ReportBlocks.renderReportBlock(
      'parent-response',
      'c1',
      { firstName: 'A', lastName: 'B' },
      {},
      { lines: 3 },
    );
    expect(three).toContain('min-height:82px');
    expect(three).toContain('Please review this report with your child and return this section to the school.');
    const six = ReportBlocks.renderReportBlock(
      'parent-response',
      'c1',
      { firstName: 'A', lastName: 'B' },
      {},
      { lines: 6 },
    );
    expect(six).toContain('min-height:148px');
  });
});

describe('stage 3 blocks', () => {
  const CID = 'course-s3';
  const CECE = { id: 's1', firstName: 'Cece', lastName: 'Adeyemi', pronouns: 'she/her' };
  const keep = {};
  const stub = (name, fn) => {
    if (!(name in keep)) keep[name] = globalThis[name];
    globalThis[name] = fn;
  };
  const text = html =>
    html
      .replace(/<[^>]+>/g, ' ')
      .replace(/&mdash;/g, '—')
      .replace(/\s+/g, ' ')
      .trim();
  const tags = [
    { id: 't1', label: 'Plan', i_can_statements: ['I can plan a fair test with my partner.'] },
    { id: 't2', label: 'Share', i_can_statements: ['I can explain my thinking to myself and others'] },
    { id: 't3', label: 'Ask', i_can_statements: ['Asks good questions'] },
  ];
  const prof = { t1: 2, t2: 3, t3: 4 };
  beforeEach(() => {
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    stub('getAllTags', () => tags);
    stub('getTagProficiency', (cid, sid, tid) => prof[tid] || 0);
    stub('getSectionForTag', () => ({ name: 'Questioning and Predicting' }));
  });
  afterEach(() => {
    Object.keys(keep).forEach(k => (globalThis[k] = keep[k]));
    Object.keys(keep).forEach(k => delete keep[k]);
  });

  it('Ways to Support at Home turns the weakest I-can statements into lines for the family, with the teacher’s own line', () => {
    const html = ReportBlocks.renderReportBlock(
      'support-home',
      CID,
      CECE,
      {},
      { lines: 2, note: 'Read together each night.' },
    );
    expect(text(html)).toBe(
      'Ways to Support at Home Ask Cece to show you how she can plan a fair test with her partner. Ask Cece to show you how she can explain her thinking to herself and others. Read together each night.',
    );
    expect(text(ReportBlocks.renderReportBlock('support-home', CID, CECE, {}, { lines: 3 }))).toContain(
      'Talk with Cece about this: Asks good questions',
    );
    stub('getTagProficiency', () => 0);
    expect(ReportBlocks.renderReportBlock('support-home', CID, CECE, {}, {})).toBe('');
  });

  it('Growth and Next Steps says Keep going with the strongest competency when nothing is under Proficient', () => {
    stub('getFocusAreas', () => [{ tag: tags[1], prof: 3, section: { name: 'Questioning and Predicting' } }]);
    const html = text(ReportBlocks.renderReportBlock('next-steps', CID, CECE, {}, { ican: 1 }));
    expect(html).toContain('Keep going — Questioning and Predicting: Ask, Extending.');
    expect(html).toContain('Asks good questions');
    stub('getTagProficiency', () => 0);
    expect(ReportBlocks.renderReportBlock('next-steps', CID, CECE, {}, {})).toBe('');
  });

  it('Missing Work lists this term’s past-due and not-submitted work, and nothing when there is none', () => {
    const work = [
      { id: 'a1', title: 'Lab Report', dueDate: '2026-10-02' },
      { id: 'a2', title: 'Quiz', date: '2026-10-05' },
      { id: 'a3', title: 'Poster', date: '2026-10-07' },
    ];
    stub('getAssessments', () => work);
    stub('assessmentInActiveTerm', () => true);
    stub('assessmentCellValue', (cid, sid, a) =>
      a.id === 'a1' ? { kind: 'missing' } : a.id === 'a2' ? { kind: 'status', status: 'NS' } : { kind: 'level' },
    );
    const html = text(ReportBlocks.renderReportBlock('missing-work', CID, CECE, {}, {}));
    expect(html).toBe('Missing Work Assignment Due Status Lab Report Oct 2 Past Due Quiz Oct 5 Missing');
    stub('assessmentCellValue', () => ({ kind: 'level' }));
    expect(ReportBlocks.renderReportBlock('missing-work', CID, CECE, {}, {})).toBe('');
  });

  it('This Term at a Glance counts the term’s work and names the strongest and growing competency', () => {
    const work = [{ id: 'a1' }, { id: 'a2' }, { id: 'a3' }, { id: 'a4' }];
    const cells = {
      a1: { kind: 'level', late: true },
      a2: { kind: 'points' },
      a3: { kind: 'missing' },
      a4: { kind: 'status', status: 'NS' },
    };
    stub('getAssessments', () => work);
    stub('assessmentInActiveTerm', () => true);
    stub('assessmentCellValue', (cid, sid, a) => cells[a.id]);
    stub('getActiveTerm', () => ({ ordinal: 2, startsOn: '2026-09-01', endsOn: '2026-11-30' }));
    stub('getStudentQuickObs', () => [
      { date: '2026-10-01' },
      { created: '2026-09-15T10:00:00Z' },
      { date: '2026-06-01' },
    ]);
    stub('getGroupedSections', () => ({ groups: [], ungrouped: [] }));
    stub('getSections', () => [
      { id: 'q', name: 'Questioning' },
      { id: 'p', name: 'Planning' },
      { id: 'c', name: 'Communicating', shortName: 'Comm.' },
    ]);
    stub('getSectionProficiency', (cid, sid, id) => ({ q: 3, p: 2.2, c: 3.6 })[id]);
    expect(text(ReportBlocks.renderReportBlock('term-glance', CID, CECE, {}, {}))).toBe(
      'This Term at a Glance 2 Assessed 1 Late 2 Missing 2 Observations Comm. Strongest Planning Growing',
    );
    stub('getAssessments', () => []);
    expect(ReportBlocks.renderReportBlock('term-glance', CID, CECE, {}, {})).toBe('');
  });

  it('Growth Since Last Report reads the previous term through calc.js and puts the term back', () => {
    let term = 2;
    const set = [];
    stub('getActiveTerm', () => ({ ordinal: term, label: 'Term ' + term }));
    stub('setActiveTerm', (cid, n) => {
      set.push(n);
      term = n;
    });
    stub('getReportingTerms', () => [
      { ordinal: 1, label: 'Term 1' },
      { ordinal: 2, label: 'Term 2' },
    ]);
    stub('getGroupedSections', () => ({ groups: [], ungrouped: [] }));
    stub('getSections', () => [
      { id: 'q', name: 'Questioning' },
      { id: 'p', name: 'Planning' },
    ]);
    stub('getSectionProficiency', (cid, sid, id) => (term === 1 ? { q: 2, p: 3 } : { q: 3, p: 3 })[id]);
    const html = ReportBlocks.renderReportBlock('growth', CID, CECE, {}, {});
    expect(set).toEqual([1, 2]);
    expect(term).toBe(2);
    expect(text(html)).toBe(
      'Growth Since Last Report Competency Term 1 Term 2 Questioning ●●○○ Developing ●●●○ Proficient ↑ Planning ●●●○ Proficient ●●●○ Proficient →',
    );
    // No earlier term, or nothing in it: nothing prints.
    term = 1;
    expect(ReportBlocks.renderReportBlock('growth', CID, CECE, {}, {})).toBe('');
    term = 2;
    stub('getSectionProficiency', (cid, sid, id) => (term === 1 ? 0 : 3));
    expect(ReportBlocks.renderReportBlock('growth', CID, CECE, {}, {})).toBe('');
  });

  it('retired blocks leave the palette but a saved layout keeps them', () => {
    const html = ReportStudio.paletteHtml(S.form(), 'blocks', []);
    ['section-outcomes', 'score-distribution', 'section-chart'].forEach(id =>
      expect(html).not.toContain(`data-block="${id}"`),
    );
    ['support-home', 'term-glance', 'growth', 'missing-work'].forEach(id =>
      expect(html).toContain(`data-block="${id}"`),
    );
    const kept = S.insert(S.form(), 'section-chart', { side: 1 });
    expect(S.onForm(kept)).toContain('section-chart');
    expect(ReportStudio.paletteHtml(kept, 'blocks', [])).toMatch(
      /class="studio-blk placed"[^>]*data-block="section-chart"/,
    );
  });

  it('Assignment Grades offers Last 10, This Term and All; This Term is the default', () => {
    const f = S.insert(S.form(), 'grade-table', { side: 1 });
    expect(S.optionsFor(S.cellOf(f, 'grade-table')).range).toBe('term');
    const pop = ReportStudio.popoverHtml(f, 'grade-table');
    expect(pop).toContain('aria-label="Assessments"');
    expect(pop).toMatch(/data-value="last10"[^>]*>Last 10</);
    expect(pop).toMatch(/data-value="term" role="radio" aria-checked="true">This Term</);
    expect(pop).toMatch(/data-value="all"[^>]*>All</);
    const sup = ReportStudio.popoverHtml(S.insert(S.form(), 'support-home', { side: 1 }), 'support-home');
    expect(sup).toContain('Your Own Line');
    expect(sup).toContain('data-action="studioText" data-block="support-home" data-key="note"');
  });
});
