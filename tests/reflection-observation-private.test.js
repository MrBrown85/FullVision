/**
 * A saved reflection is never offered to a report (S10 follow-up, Colin's
 * ruling 110, "Keep private"): a student's reflection on feedback stays
 * between the student and the teacher, so the observation Save as
 * Observation makes from it (S10-F3, teacher/page-assignments.js) is
 * marked as from a reflection (its context, REFLECTION_OBS_CONTEXT) and
 * never printed, whatever the teacher later makes its type or link.
 *
 * The doors an observation has to a report, a comment or anything a
 * family or student reads, each tested here:
 * - the Observations block of a printed report (ReportBlocks);
 * - the Observations card of the grade report (ReportFeedback.observations);
 * - Generate, which reads no observation at all (Colin, Oct 30; also
 *   tests/private-observations.test.js);
 * - the Term Questionnaire's Add Here, whose only source is the comment
 *   bank (no observation source is registered).
 * The teacher still sees it in their own lists, labelled "From a
 * reflection. Not used in reports." And the mark survives the trip to the
 * server and back (observation.context_type).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'f1111111-1111-4111-8111-1111111111bb';
const SID = 'f3333333-3333-4333-8333-3333333333bb';
const AID = 'f2222222-2222-4222-8222-2222222222bb';
const ST = { id: SID, firstName: 'Cy', lastName: 'Young' };
const WORDS = 'Next time I’ll find all three reasons first.';

function ob(id, sentiment, text, day, more) {
  return { id, text, sentiment, dims: [], date: day, created: day + 'T18:00:00.000Z', ...more };
}
// The teacher made the saved reflection a Strength and took off its link:
// only the mark keeps it out.
const FROM_REFLECTION = ob('r', 'strength', 'Plan after Letter: “' + WORDS + '”', '2026-10-10', {
  context: 'reflection',
});

beforeEach(() => {
  localStorage.clear();
  if (typeof COURSES === 'undefined') globalThis.COURSES = {};
  COURSES[CID] = { id: CID, name: 'English 10', gradingSystem: 'proficiency' };
  if (_cache.observations) delete _cache.observations[CID];
  saveQuickObs(CID, {
    [SID]: [FROM_REFLECTION, ob('s', 'strength', 'Led the lab group.', '2026-10-11')],
  });
});
afterEach(() => {
  delete COURSES[CID];
});

describe('the mark', () => {
  it('an observation from a reflection is private, whatever its type', () => {
    expect(isReflectionObservation(FROM_REFLECTION)).toBe(true);
    ['strength', 'growth', 'concern', 'note', null].forEach(s =>
      expect(isPrivateObservation({ ...FROM_REFLECTION, sentiment: s }), String(s)).toBe(true),
    );
    expect(isReflectionObservation({ sentiment: 'strength', context: 'discussion' })).toBe(false);
    expect(isReflectionObservation(null)).toBe(false);
  });

  it('goes to the server as its context and comes back with it', () => {
    const blob = _observationsPayloadToBlob(
      {
        observations: [
          { id: 'o1', body: 'Plan after Letter', sentiment: 'note', context_type: 'reflection', enrollment_ids: [SID] },
        ],
      },
      CID,
    );
    expect(isReflectionObservation(blob[SID][0])).toBe(true);
  });
});

describe('never printed', () => {
  it('the Observations block of a printed report leaves it out', () => {
    const html = ReportBlocks.renderBlockObservations(CID, ST);
    expect(html).toContain('Led the lab group.');
    expect(html).not.toContain(WORDS);
    expect(html).not.toContain('Plan after Letter');
  });

  it('the grade report’s Observations card leaves it out', () => {
    const rows = ReportFeedback.observations(CID, ST, null);
    expect(rows.map(r => r.text)).toEqual(['Led the lab group.']);
  });

  it('Generate has nothing of it', () => {
    const f = {
      name: 'Cy',
      pronouns: { subj: 'he', obj: 'him', poss: 'his', refl: 'himself' },
      comps: [],
      work: [],
      record: { total: 0, handed: 0, late: 0, missing: 0 },
      obs: [{ id: 'r', text: FROM_REFLECTION.text, day: 'Oct 10', sentiment: 'strength' }],
      voice: {},
      confidence: [],
      habits: {},
      levelText: () => '',
    };
    const ctx = CommentBank.context(f, { note: 'r' });
    Object.keys(ctx)
      .filter(k => typeof ctx[k] === 'string')
      .forEach(k => expect(ctx[k], k).not.toContain(WORDS));
  });
});

describe('the teacher still sees it, labelled', () => {
  it('every list’s label says why it is not offered', () => {
    expect(obsPrivateLabelHtml(FROM_REFLECTION)).toContain('From a reflection. Not used in reports.');
    expect(obsPrivateLabelHtml({ sentiment: 'note' })).not.toContain('reflection');
    const ctx = { cid: CID, quoted: {}, hasTerms: false, sameCapture: {}, studentsById: { [SID]: ST } };
    const html = ObsCard.html({ ...FROM_REFLECTION, studentId: SID }, ctx);
    expect(html).toContain('Plan after Letter');
    expect(html).toContain('From a reflection. Not used in reports.');
  });
});
