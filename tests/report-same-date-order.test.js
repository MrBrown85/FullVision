/**
 * The report's list of a competency's work puts same-date pieces in the
 * order the grades count them in (S0-F1e): teacher/report-blocks.js
 * _sectionWork asks calc.js (samePieceDateOrder) and keeps no order of its
 * own. Next Steps' "Latest" line, Progress in One Area's "Latest", "Best"
 * and list, and Ways to Support at Home read that list.
 *
 * The class: History 12 with Current Events: Week 1, 2 and 3 all dated
 * Oct 20, all on Continuity and Change. Noor's marks on them are 3, 4, 4
 * (75%, 100%, 100%), and Continuity and Change is her focus area.
 */
import './setup.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { syntheticClass } from './eval-fixture.js';
import { loadClass } from '../scripts/eval/app.mjs';
import { FROZEN_AT } from './helpers/golden-grades.js';

// The server's times for the seven pieces: Week 3 made first, then Week 1, then Week 2.
const MADE = [
  '2026-09-01T16:00:00+00:00',
  '2026-09-02T16:00:00+00:00', // Week 1
  '2026-09-02T16:05:00+00:00', // Week 2
  '2026-09-01T16:30:00+00:00', // Week 3
  '2026-09-03T16:00:00+00:00',
  '2026-09-02T17:00:00+00:00',
  '2026-09-04T16:00:00+00:00',
];

function sameDateClass(made) {
  const bundle = syntheticClass();
  const pieces = bundle.gradebook.assessments;
  [1, 2, 3].forEach(i => (pieces[i].date_assigned = pieces[i].due_date = '2026-10-20'));
  if (made) pieces.forEach((a, i) => (a.created_at = made[i]));
  return bundle;
}

/* The same class with its pieces in the opposite order (as after a drag on
   the Assignments page) and its score rows in another order. */
function rearranged(bundle) {
  const out = JSON.parse(JSON.stringify(bundle));
  const g = out.gradebook;
  const last = g.assessments.length - 1;
  g.assessments.reverse();
  g.assessments.forEach((a, i) => (a.display_order = i));
  ['score_rows', 'tag_rows'].forEach(rows => {
    g[rows].forEach(r => (r[1] = last - r[1]));
    g[rows].reverse();
  });
  return out;
}

const text = html =>
  String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/* What Noor's report says about Continuity and Change. */
function noor(bundle) {
  const { cid, termId, students } = loadClass(bundle, 1);
  const student = students.find(s => s.firstName === 'Noor');
  const ctx = { termId, termLabel: 'Term 1' };
  expect(ReportBlocks.focusArea(cid, student, ctx).sec.name).toBe('Continuity and Change');
  const progress = text(ReportBlocks.renderBlockProgress(cid, student, ctx, {}));
  return {
    nextSteps: text(ReportBlocks.renderBlockNextSteps(cid, student, ctx, {})),
    best: progress.match(/Best (.*?) Latest /)[1],
    latest: progress.match(/ Latest (.*?) Date /)[1],
    list: progress.split('Every score this term Score ')[1],
    home: text(ReportBlocks.renderBlockSupportHome(cid, student, ctx, {})),
  };
}

describe('same-date work on a report', () => {
  beforeAll(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
  });
  afterAll(() => {
    vi.useRealTimers();
    localStorage.clear();
    clearProfCache();
  });

  const MADE_ORDER = {
    nextSteps:
      'Next Steps Continuity and Change Keep building on this competency. Latest: Current Events: Week 2, Oct 20 · 100%',
    best: 'Current Events: Week 2, Oct 20 · Current Events: Week 3, Oct 20 · 100%',
    latest: 'Current Events: Week 2, Oct 20 · 100%',
    list:
      'Oct 16 What Does the Poster Show, and What Does It Hide? 75% ' +
      'Oct 20 Current Events: Week 3 100% Oct 20 Current Events: Week 1 75% Oct 20 Current Events: Week 2 100%',
    home:
      'Ways to Support at Home Ask to see Current Events: Week 3, Oct 20 · 100% ' +
      'Ask about Current Events: Week 1, Oct 20 · 75%, her lowest this term',
  };
  const ID_ORDER = {
    nextSteps:
      'Next Steps Continuity and Change Keep building on this competency. Latest: Current Events: Week 3, Oct 20 · 100%',
    best: 'Current Events: Week 3, Oct 20 · Current Events: Week 2, Oct 20 · 100%',
    latest: 'Current Events: Week 3, Oct 20 · 100%',
    list:
      'Oct 16 What Does the Poster Show, and What Does It Hide? 75% ' +
      'Oct 20 Current Events: Week 1 75% Oct 20 Current Events: Week 2 100% Oct 20 Current Events: Week 3 100%',
    home:
      'Ways to Support at Home Ask to see Current Events: Week 2, Oct 20 · 100% ' +
      'Ask about Current Events: Week 1, Oct 20 · 75%, her lowest this term',
  };

  it('with the server’s times: the order made, Week 3 then Week 1 then Week 2, so Week 2 is the latest', () => {
    expect(noor(sameDateClass(MADE))).toEqual(MADE_ORDER);
  });

  it('the same after a drag and with the scores stored in another order', () => {
    expect(noor(rearranged(sameDateClass(MADE)))).toEqual(MADE_ORDER);
  });

  it('with no time known (today’s bundle): the order of the pieces’ ids, so Week 3 is the latest', () => {
    expect(noor(sameDateClass())).toEqual(ID_ORDER);
  });

  it('and that, too, is the same after a drag and with the scores stored in another order', () => {
    expect(noor(rearranged(sameDateClass()))).toEqual(ID_ORDER);
  });

  it('an area with two competencies: one order across both, not one competency’s work and then the other’s', () => {
    // Perspective joins Continuity and Change as its second competency, and
    // the Treaty Debate (on Perspective) moves to Oct 20 with the Weeks.
    const twoCompetencies = made => {
      const bundle = sameDateClass(made);
      const pieces = bundle.gradebook.assessments;
      pieces[5].date_assigned = pieces[5].due_date = '2026-10-20';
      const sections = bundle.learning_map.subjects[0].sections;
      sections[2].tags.push(Object.assign({}, sections[3].tags[0], { display_order: 1 }));
      sections.splice(3, 1);
      return bundle;
    };
    // Owen's work in the area this term, as Progress in One Area lists it (Week 3 is Missing).
    const owen = bundle => {
      const { cid, termId, students } = loadClass(bundle, 1);
      const student = students.find(s => s.firstName === 'Owen');
      const progress = text(ReportBlocks.renderBlockProgress(cid, student, { termId, termLabel: 'Term 1' }, {}));
      expect(progress).toMatch(/^Progress: Continuity and Change /);
      return progress.split('Oct 16 What Does the Poster Show, and What Does It Hide? 75% ')[1];
    };
    // The Treaty Debate made before the Weeks: it counts first, though its competency is the area's second.
    const treatyFirst = MADE.slice();
    treatyFirst[5] = '2026-09-01T15:00:00+00:00';
    const made =
      'Oct 20 Lesson 4: Treaty Debate 75% Oct 20 Current Events: Week 1 75% Oct 20 Current Events: Week 2 75%';
    expect(owen(twoCompetencies(treatyFirst))).toBe(made);
    expect(owen(rearranged(twoCompetencies(treatyFirst)))).toBe(made);
    // Made after them: last.
    const byId =
      'Oct 20 Current Events: Week 1 75% Oct 20 Current Events: Week 2 75% Oct 20 Lesson 4: Treaty Debate 75%';
    expect(owen(twoCompetencies(MADE))).toBe(byId);
    // With no time known, by id: the Treaty Debate's is the highest.
    expect(owen(twoCompetencies())).toBe(byId);
    expect(owen(rearranged(twoCompetencies()))).toBe(byId);
  });
});
