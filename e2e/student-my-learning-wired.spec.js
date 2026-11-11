import { test, expect } from '@playwright/test';
import { PHONE, TODAY, serve } from './student-card-fake.js';
import { fakeStudentSubmit, sampleCard } from '../tests/helpers/fake-student-submit.js';

/* My Learning from a real card (S13-W1), on a phone, against the built site
   with the live site's CSP: the student-submit function's own handler over a
   stand-in database, with `page` answering as my-learning-contract.md writes
   it once Show My Learning is on (Batch E, E9): `show_my_learning` and
   `learning`. The My Learning tab draws the student's skills from that page
   alone; with the switch off it says so and nothing else changes. */

test.use(PHONE);

function withLearning(json) {
  const tags = Object.keys(json.tags || {});
  return Object.assign({}, json, {
    show_my_learning: true,
    learning: {
      course: {
        grading_system: json.course.grading_system,
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
      categories: [],
      competency_groups: [],
      subjects: [
        {
          id: 'sub-1',
          name: json.course.name,
          display_order: 0,
          sections: tags.map((id, i) => ({
            id: 'sec-' + i,
            name: json.tags[id].label,
            display_order: i,
            competency_group_id: null,
            tags: [
              {
                id,
                code: json.tags[id].code || '',
                label: json.tags[id].label,
                i_can_text: '',
                i_can_statements: json.tags[id].i_can || [],
                bank_id: null,
                display_order: 0,
              },
            ],
          })),
        },
      ],
    },
  });
}

async function open(page, on) {
  const fn = fakeStudentSubmit({ cards: [sampleCard(TODAY)] });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await serve(page, fn, {
    answer: async body => {
      if (!on || body.route !== 'page') return null;
      const res = await fn.respond(body);
      return { status: res.status, json: res.json && res.json.ok ? withLearning(res.json) : res.json };
    },
  });
  await page.goto('/s/#P3R8-WDK4');
  await page.getByLabel('Student Number').fill('0123456');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await page.locator('[data-act="tab"][data-tab="learning"]:visible').first().click();
  return errors;
}

test('with Show My Learning on, the My Learning tab draws the student’s skills from the page', async ({ page }) => {
  const errors = await open(page, true);
  await expect(page.locator('.sp-page')).not.toContainText('hasn’t turned on My Learning');
  // Each competency of the class's map is a skill on the tab.
  const tags = sampleCard(TODAY).page.tags;
  for (const id of Object.keys(tags)) await expect(page.locator('.sp-page')).toContainText(tags[id].label);
  expect(errors).toEqual([]);
});

test('with it off, the tab says so', async ({ page }) => {
  const errors = await open(page, false);
  await expect(page.locator('.sp-page')).toContainText('Your teacher hasn’t turned on My Learning for this class.');
  expect(errors).toEqual([]);
});
