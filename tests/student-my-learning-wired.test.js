/**
 * My Learning on a real card (S13-W1; s/student-data.js, shared/student-view.js),
 * from `page` as my-learning-contract.md writes it (Batch E, E9): with Show My
 * Learning on, `show_my_learning: true` and `learning` (the class's settings,
 * categories, folders and learning map, in the class bundle's shapes), and
 * `category_id` on each piece. The student's returned scores are the ones
 * `page` already sends.
 *
 * - With the switch off (no key), no grade: My Learning lists the work alone,
 *   and the page's readers are exactly the four the Assignments list uses.
 * - With it on, the grade is worked out on the device from that page alone,
 *   by the same calc.js as Preview as Student, and reads no name the page lacks.
 * - Demo Mode sends it on, as the server does with the switch on, except
 *   #demo-card-no-learning.
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

/* The sample class's page as the server sends it with Show My Learning
   off: Demo Mode's page with the switch's keys taken out (Demo Mode sends
   them, as the server does with it on). */
function plainPage(page, system) {
  const reply = page.T.demoPage(system);
  delete reply.show_my_learning;
  delete reply.learning;
  reply.assessments = reply.assessments.map(a => {
    const out = Object.assign({}, a);
    delete out.category_id;
    return out;
  });
  return reply;
}

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
    const reply = withLearning(plainPage(page, 'proficiency'));
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
    const next = view(withLearning(plainPage(page, 'proficiency'))).learning.next;
    if (next) {
      const r2 = withLearning(plainPage(page, 'proficiency'));
      const bank = 'bank-' + tags.find(id => 'sec-' + id === next.id);
      r2.learning.next_steps[bank].sensitive = true;
      const again = view(r2).learning.next;
      expect(again && again.id).not.toBe(next.id);
    }
  });

  it('with Show My Learning off: no grade, and only the Assignments list’s four readers', async () => {
    const { page, view } = await open();
    const v = view(plainPage(page, 'proficiency'));
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
      const reply = withLearning(plainPage(page, system));
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
      view(plainPage(page, system));
      expect(page.run('typeof getSections')).toBe('undefined');
    },
  );

  it('the My Learning tab draws the grade from it; without it, the list of work and no grade', async () => {
    const { page, view } = await open();
    const reply = withLearning(plainPage(page, 'proficiency'));
    const read = page.run('StudentData.fromServer')(reply);
    page.run('StudentData.use')(read);
    const on = page.T.render({ screen: 'assignments', page: read, reply, tab: 'learning', demo: false });
    expect(on).toContain('sp-ml-overall');
    expect(on).toContain('This Year So Far');
    expect(on).toContain('sp-ml-work');
    const plain = plainPage(page, 'proficiency');
    const off = page.run('StudentData.fromServer')(plain);
    page.run('StudentData.use')(off);
    const drawn = page.T.render({ screen: 'assignments', page: off, reply: plain, tab: 'learning', demo: false });
    expect(drawn).not.toContain('sp-ml-overall');
    expect(drawn).not.toContain('You’re at');
    expect(drawn).not.toContain('What Makes Up Your Grade');
    expect(drawn).not.toContain('hasn’t turned on My Learning');
    // The same rows, in the same order, with the switch on or off.
    const rows = html => html.match(/<li[^>]*><(?:button|span) [^>]*class="sp-ml-row[^"]*"[^>]*>/g);
    expect(rows(drawn)).toEqual(rows(on));
    expect(rows(drawn).length).toBe(7);
    expect(view(plain).learning).toBeNull();
  });

  it('Demo Mode sends Show My Learning on, and #demo-card-no-learning sends it off', async () => {
    const shown = async hash => {
      const page = openStudentPage();
      await page.start(hash);
      await page.submit('form[data-form="card"]');
      page.type('#sp-ident', page.T.DEMO.number);
      await page.click('[data-act="card-yes"]');
      await page.click('.sp-tabs-bottom [data-tab="learning"]');
      return page;
    };
    const on = await shown('#demo-card');
    expect(on.T.state().reply.show_my_learning).toBe(true);
    expect(on.root().querySelector('.sp-ml-overall .sp-ml-period').textContent).toBe('This Year So Far');
    const off = await shown('#demo-card-no-learning');
    expect(off.T.state().reply.show_my_learning).toBe(false);
    expect(off.T.state().reply.learning).toBeNull();
    expect(off.root().querySelector('.sp-ml-overall')).toBeNull();
    expect(off.root().querySelector('.sp-ml-title').classList.contains('sp-hidden-title')).toBe(false);
    expect([...off.root().querySelectorAll('.sp-ml-work .sp-row-title')].map(el => el.textContent)).toEqual(
      [...on.root().querySelectorAll('.sp-ml-work .sp-row-title')].map(el => el.textContent),
    );
    expect(off.calls).toEqual([]);
  });
});

/* Per-student options in Demo Mode (docs/plans/per-student-options-plan.md):
   the sample card is Cece's, st1 in the teacher's sample class sci8, and the
   page honours the teacher's options kept on this device as the server does. */
describe('Demo Mode honours the teacher’s per-student options', () => {
  const KEY = 'gb-student-page-options-sci8';
  const signIn = async (page, hash) => {
    await page.start(hash);
    await page.submit('form[data-form="card"]');
  };

  it('Hide: no overall grade on My Learning, and the work still listed', async () => {
    const page = openStudentPage({
      store: { [KEY]: JSON.stringify({ st1: { show_overall_grade: 'hide', paused_at: null } }) },
    });
    await signIn(page, '#demo-card');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    await page.click('.sp-tabs-bottom [data-tab="learning"]');
    expect(page.T.state().reply.show_my_learning).toBe(false);
    expect(page.root().querySelector('.sp-ml-overall')).toBeNull();
    expect(page.root().querySelectorAll('.sp-ml-work .sp-row-title').length).toBeGreaterThan(0);
    expect(page.calls).toEqual([]);
  });

  it('Show over #demo-card-no-learning: the grade shows', async () => {
    const page = openStudentPage({
      store: { [KEY]: JSON.stringify({ st1: { show_overall_grade: 'show', paused_at: null } }) },
    });
    await signIn(page, '#demo-card-no-learning');
    page.type('#sp-ident', page.T.DEMO.number);
    await page.click('[data-act="card-yes"]');
    expect(page.T.state().reply.show_my_learning).toBe(true);
  });

  it('Paused: the card is refused with the closed message', async () => {
    const page = openStudentPage({
      store: { [KEY]: JSON.stringify({ st1: { show_overall_grade: 'class', paused_at: '2026-11-17T20:00:00Z' } }) },
    });
    await signIn(page, '#demo-card');
    expect(page.root().textContent).toContain('The student page is turned off for this class. Ask your teacher.');
    expect(page.root().querySelector('.sp-tabs-bottom')).toBeNull();
    expect(page.calls).toEqual([]);
  });
});
