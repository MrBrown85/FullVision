/**
 * My Learning on a real card (S13-W1; s/student-data.js, shared/student-view.js),
 * from `page` as my-learning-contract.md writes it (Batch E, E9): with Show My
 * Learning on, `show_my_learning: true` and `learning` (the class's settings,
 * categories, folders and learning map, in the class bundle's shapes), and
 * `category_id` on each piece. The student's returned scores are the ones
 * `page` already sends.
 *
 * - With the switch off (no key), nothing changes: no My Learning, and the
 *   page's readers are exactly the four the Assignments list uses.
 * - With it on, My Learning is worked out on the device from that page alone,
 *   by the same calc.js as Preview as Student, and reads no name the page lacks.
 */
import { describe, expect, it } from 'vitest';
import { openStudentPage } from './helpers/student-page-context.js';

const WATCHED = [
  'shared/calc.js',
  'shared/constants.js',
  'shared/student-view.js',
  's/student-data.js',
  's/assignments.js',
];

// The sample class's page, with Show My Learning on: one course, one folder, a section per competency.
function withLearning(reply) {
  const tags = Object.keys(reply.tags || {});
  return Object.assign({}, reply, {
    show_my_learning: true,
    learning: {
      course: {
        grading_system: reply.course.grading_system,
        calc_method: 'mostRecent',
        decay_weight: 0.65,
        recent_score_limit: null,
        grading_scale: null,
        category_weights: null,
        round_percent: true,
        level_order: 'desc',
        reporting_terms: [],
        timezone: 'America/Vancouver',
        folders_count_as_one: false,
        courses_count_equally: false,
      },
      categories: [{ id: 'cat-1', name: 'Assignments', weight: 100, display_order: 0, calc_mode: 'points' }],
      section_overrides: {},
      // Each skill's Next Step sentences, as the edge sends them from the comment bank (bank-steps.json).
      next_steps: Object.fromEntries(
        tags.map(id => [
          'bank-' + id,
          {
            Emerging: 'Next from Emerging on ' + id,
            Developing: 'Next from Developing on ' + id,
            Proficient: 'Next from Proficient on ' + id,
            sensitive: false,
          },
        ]),
      ),
      competency_groups: [
        { id: 'grp-1', name: 'Questioning and Predicting', color: '#0891b2', display_order: 0, counts_as_one: false },
      ],
      subjects: [
        {
          id: 'sub-1',
          name: 'Science 8',
          display_order: 0,
          sections: tags.map((id, i) => ({
            id: 'sec-' + id,
            name: reply.tags[id].label,
            display_order: i,
            competency_group_id: i === 0 ? 'grp-1' : null,
            tags: [
              {
                id,
                code: reply.tags[id].code || '',
                label: reply.tags[id].label,
                i_can_text: '',
                i_can_statements: reply.tags[id].i_can || [],
                bank_id: 'bank-' + id,
                display_order: 0,
              },
            ],
          })),
        },
      ],
    },
    assessments: reply.assessments.map(a => Object.assign({}, a, { category_id: 'cat-1' })),
  });
}

async function open() {
  const page = openStudentPage();
  page.T.whenGradesAreIn();
  await page.settle();
  const view = reply => {
    const read = page.run('StudentData.fromServer')(reply);
    page.run('StudentData.use')(read);
    return page.T.viewOf({ page: read, reply });
  };
  return { page, view };
}

describe('My Learning on a real card', () => {
  it('a hand-set level and the Next Step read as Preview reads them', async () => {
    const { page, view } = await open();
    const reply = withLearning(page.T.demoPage('proficiency'));
    const tags = Object.keys(reply.tags);
    const base = view(reply).learning.groups.flatMap(g => g.skills);
    // A skill with a level below Extending names its own Next Step, the bank's sentence for its level.
    const graded = base.find(s => s.level > 0 && s.level < 4);
    expect(graded.next).toEqual({
      top: false,
      text: expect.stringMatching(/^Next from (Emerging|Developing|Proficient) on /),
    });
    // The teacher's hand-set level is the skill's level, as in Preview.
    const target = base.find(s => s.level !== 4);
    reply.learning.section_overrides = { [target.id]: { level: 4, date: null } };
    const set = view(reply)
      .learning.groups.flatMap(g => g.skills)
      .find(s => s.id === target.id);
    expect(set.level).toBe(4);
    expect(set.next).toEqual({ top: true, text: '' });
    // A sensitive set's skill is never the Next Step My Learning names.
    const next = view(withLearning(page.T.demoPage('proficiency'))).learning.next;
    if (next) {
      const r2 = withLearning(page.T.demoPage('proficiency'));
      const bank = 'bank-' + tags.find(id => 'sec-' + id === next.id);
      r2.learning.next_steps[bank].sensitive = true;
      const again = view(r2).learning.next;
      expect(again && again.id).not.toBe(next.id);
    }
  });

  it('with Show My Learning off: no My Learning, and only the Assignments list’s four readers', async () => {
    const { page, view } = await open();
    const v = view(page.T.demoPage('proficiency'));
    expect(v.learning).toBeNull();
    expect(page.run('typeof getSections')).toBe('undefined');
    expect(page.run('StudentData.readers')).toEqual([
      'getScores',
      'getAssignmentStatuses',
      'getRubricById',
      'getGradingScale',
    ]);
  });

  it.each(['proficiency', 'letter', 'both'])(
    'a %s class with it on: worked out on the device from the page alone, reading no name the page lacks',
    async system => {
      const { page, view } = await open();
      const reply = withLearning(page.T.demoPage(system));
      // The page with My Learning in puts its readers on; then every other name is watched.
      view(reply);
      const reached = page.watchGlobals(WATCHED);
      const v = view(reply);
      expect(v.learning).not.toBeNull();
      expect(v.learning.mode).toBe(system);
      expect(v.learning.empty).toBe(false);
      // Every competency of the map is a skill, in its folder or not.
      const skills = v.learning.groups.flatMap(g => g.skills);
      expect(skills.length).toBe(Object.keys(reply.tags).length);
      expect(v.learning.groups[0].folder).toBe('Questioning and Predicting');
      expect(skills.some(s => s.level > 0 && s.text)).toBe(true);
      expect(v.learning.overall.text).not.toBe('');
      if (system !== 'proficiency') expect(v.learning.categories.map(c => c.name)).toEqual(['Assignments']);
      // Every name it reaches is given: the comment bank's two readers come from `learning.next_steps`.
      expect([...reached]).toEqual([]);
      // Off again (another class, or the switch turned off): the readers go with it.
      view(page.T.demoPage(system));
      expect(page.run('typeof getSections')).toBe('undefined');
    },
  );

  it('the My Learning tab draws from it, and says it is off without it', async () => {
    const { page, view } = await open();
    const reply = withLearning(page.T.demoPage('proficiency'));
    const read = page.run('StudentData.fromServer')(reply);
    page.run('StudentData.use')(read);
    const on = page.T.render({ screen: 'assignments', page: read, reply, tab: 'learning', demo: false });
    expect(on).not.toContain('hasn’t turned on My Learning');
    const plain = page.T.demoPage('proficiency');
    const off = page.run('StudentData.fromServer')(plain);
    page.run('StudentData.use')(off);
    expect(page.T.render({ screen: 'assignments', page: off, reply: plain, tab: 'learning', demo: false })).toContain(
      'hasn’t turned on My Learning',
    );
    expect(view(plain).learning).toBeNull();
  });
});
