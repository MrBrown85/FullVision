/**
 * The Proficiency block's Highest Now and Lowest Now lines (DECISIONS,
 * "Student-facing levels are proficiencies", rulings of 2026-11-12; Colin:
 * "go with your recommendations on all four").
 *
 * In a Proficiency or Both class the two lines print together or not at
 * all: only when the highest and lowest competencies read different words.
 * With every competency at one word (or only one competency with a level)
 * neither prints, since "highest" would rest on a figure the report does not
 * show. A Letter class is exactly as before: Highest Now always, Lowest Now
 * when the lowest prints a different figure
 * (tests/fixtures/report-highest-lowest-letter.json, written by this file on
 * main before the change:
 * UPDATE_HIGHEST_LOWEST=1 npx vitest run tests/report-highest-lowest-now.test.js).
 */
import './setup.js';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const FILE = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures/report-highest-lowest-letter.json');
const UPDATE = process.env.UPDATE_HIGHEST_LOWEST === '1';

const CID = 'report-hi-lo';
const SID = 'stu-1';
const STUDENT = { id: SID, firstName: 'Owen', lastName: 'Martens' };

/* Two competencies, each scored on its own piece: Evidence at `a`,
   Perspective at `b`. */
function seed(mode, a, b) {
  COURSES[CID] = { id: CID, name: 'Socials 10', gradingSystem: mode };
  _cache.students[CID] = [STUDENT];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [
      { id: 'sec-1', name: 'Evidence', tags: [{ id: 't1', label: 'Evidence' }] },
      { id: 'sec-2', name: 'Perspective', tags: [{ id: 't2', label: 'Perspective' }] },
    ],
    competencyGroups: [],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [
    { id: 'p1', title: 'Source Analysis', date: '2026-10-02', tagIds: ['t1'] },
    { id: 'p2', title: 'Map Study', date: '2026-10-06', tagIds: ['t2'] },
  ];
  _cache.scores[CID] = {
    [SID]: [
      { assessmentId: 'p1', tagId: 't1', score: a, date: '2026-10-02' },
      { assessmentId: 'p2', tagId: 't2', score: b, date: '2026-10-06' },
    ],
  };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}

const facts = html => (html.match(/<div class="report-prof-fact">[\s\S]*?<\/div>/g) || []).join('\n');
const draw = () => ReportBlocks.renderBlockProficiency(CID, STUDENT, {}, {});

// Every competency at one word (3 and 3+, both Proficient), and at two (3 and 1).
const SAME = [3, 3 + 1 / 3];
const APART = [3, 1];

describe('Highest Now and Lowest Now', () => {
  afterEach(() => delete COURSES[CID]);

  it.each(['proficiency', 'both'])('a %s class prints neither when every competency reads the same word', mode => {
    seed(mode, ...SAME);
    const html = draw();
    expect(html).toContain('Proficient');
    expect(html).not.toContain('Highest now');
    expect(html).not.toContain('Lowest now');
    expect(html).not.toContain('report-prof-facts');
  });

  it.each(['proficiency', 'both'])('a %s class with one competency scored prints neither', mode => {
    seed(mode, 3, 0);
    expect(facts(draw())).toBe('');
  });

  it.each(['proficiency', 'both'])('a %s class prints both when the words differ', mode => {
    seed(mode, ...APART);
    const f = facts(draw()).replace(/<[^>]+>/g, '');
    const pct = mode === 'both' ? ' · 75%' : '';
    const low = mode === 'both' ? ' · 25%' : '';
    expect(f).toContain(
      'Highest now: Evidence Proficient' + pct + '. Best work: Source Analysis (Oct 2), Proficient' + pct + '.',
    );
    expect(f).toContain(
      'Lowest now: Perspective Emerging' + low + '. Lowest work: Map Study (Oct 6), Emerging' + low + '.',
    );
  });

  it('a Letter class prints what it printed before, byte for byte', () => {
    const now = {};
    [
      ['same', SAME],
      ['equal', [3, 3]],
      ['one', [3, 0]],
      ['apart', APART],
    ].forEach(([name, [a, b]]) => {
      seed('letter', a, b);
      now[name] = draw();
    });
    if (UPDATE) writeFileSync(FILE, JSON.stringify(now, null, 2) + '\n');
    const was = JSON.parse(readFileSync(FILE, 'utf-8'));
    expect(now).toEqual(was);
    // As before: Highest Now always, Lowest Now only when the figures differ.
    expect(now.equal).toContain('Highest now');
    expect(now.equal).not.toContain('Lowest now');
    expect(now.one).toContain('Highest now');
    expect(now.apart).toContain('Lowest now');
  });
});

/* Two pieces at the same mark on one date are named in the order they were
   made (calc.js samePieceDateOrder), not by where they are stored
   (ROADMAP 1.9: a cleared returned grade moves its entry to the end). */
describe('Best work and Lowest work: tied pieces come out in the order they were made', () => {
  afterEach(() => delete COURSES[CID]);

  // Four competencies: t1 and t2 tie at the top, t3 and t4 tie at the bottom. The piece made first
  // sits on the later competency of each pair, so reading by competency puts it second.
  function seedTies(storedOrder) {
    seed('proficiency', 3, 1);
    const sec = (n, tag) => ({ id: 'sec-' + n, name: 'Skill ' + n, tags: [{ id: tag, label: 'Skill ' + n }] });
    _cache.learningMaps[CID].sections = [sec(1, 't1'), sec(2, 't2'), sec(3, 't3'), sec(4, 't4')];
    const day = '2026-10-06';
    const made = n => '2026-10-01T09:0' + n + ':00.000Z';
    const piece = (id, title, tag, n) => ({ id, title, date: day, tagIds: [tag], created: made(n) });
    const all = {
      hiFirst: piece('h1', 'High Made First', 't2', 1),
      hiLater: piece('h2', 'High Made Later', 't1', 2),
      loFirst: piece('l1', 'Low Made First', 't4', 3),
      loLater: piece('l2', 'Low Made Later', 't3', 4),
    };
    const entry = (a, score) => ({ assessmentId: a.id, tagId: a.tagIds[0], score, date: day });
    const score = k => (k.startsWith('hi') ? 3 : 1);
    _cache.assessments[CID] = storedOrder.map(k => all[k]);
    _cache.scores[CID] = { [SID]: storedOrder.map(k => entry(all[k], score(k))) };
    clearProfCache();
  }

  it.each([
    ['made order', ['hiFirst', 'hiLater', 'loFirst', 'loLater']],
    ['the other way round', ['loLater', 'loFirst', 'hiLater', 'hiFirst']],
  ])('stored in %s', (_name, stored) => {
    seedTies(stored);
    const f = facts(draw()).replace(/<[^>]+>/g, '');
    expect(f).toContain('Best work: High Made First (Oct 6) and High Made Later (Oct 6)');
    expect(f).toContain('Lowest work: Low Made First (Oct 6) and Low Made Later (Oct 6)');
  });
});
