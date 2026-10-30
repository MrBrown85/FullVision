/**
 * Concern and Note observations are private (Colin, Oct 29 2026): they never
 * print or go home on a report, Generate never quotes them, and every list of
 * observations marks them "Private".
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CID = 'f1111111-1111-4111-8111-1111111111aa';
const SID = 'f3333333-3333-4333-8333-3333333333aa';
const ST = { id: SID, firstName: 'Ada', lastName: 'Lovelace' };

function ob(id, sentiment, text, day) {
  return { id, text, sentiment, dims: [], date: day, created: day + 'T18:00:00.000Z' };
}

describe('isPrivateObservation', () => {
  it('is true for Concern and Note only', () => {
    expect(isPrivateObservation({ sentiment: 'concern' })).toBe(true);
    expect(isPrivateObservation({ sentiment: 'note' })).toBe(true);
    expect(isPrivateObservation({ sentiment: 'strength' })).toBe(false);
    expect(isPrivateObservation({ sentiment: 'growth' })).toBe(false);
    expect(isPrivateObservation({})).toBe(false);
    expect(isPrivateObservation(null)).toBe(false);
  });

  it('draws the Private label only for a private observation', () => {
    expect(obsPrivateLabelHtml({ sentiment: 'note' })).toContain('Private');
    expect(obsPrivateLabelHtml({ sentiment: 'concern' })).toContain('obs-private');
    expect(obsPrivateLabelHtml({ sentiment: 'growth' })).toBe('');
    expect(obsPrivateLabelHtml({})).toBe('');
  });
});

describe('printed blocks', () => {
  beforeEach(() => {
    localStorage.clear();
    if (typeof COURSES === 'undefined') globalThis.COURSES = {};
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    if (_cache.observations) delete _cache.observations[CID];
    saveQuickObs(CID, {
      [SID]: [
        ob('c', 'concern', 'Meeting with her parents Friday.', '2026-10-05'),
        ob('n', 'note', 'Away on vacation next week.', '2026-10-06'),
        ob('s', 'strength', 'Led the lab group.', '2026-10-07'),
        ob('g', 'growth', 'Check the units.', '2026-10-08'),
        ob('u', null, 'Asked a good question.', '2026-10-09'),
      ],
    });
  });
  afterEach(() => {
    delete COURSES[CID];
  });

  it('the Observations block skips private observations', () => {
    const html = ReportBlocks.renderBlockObservations(CID, ST);
    expect(html).toContain('Led the lab group.');
    expect(html).toContain('Check the units.');
    expect(html).toContain('Asked a good question.');
    expect(html).not.toContain('Meeting with her parents');
    expect(html).not.toContain('vacation');
  });

  it('the Observations block is empty when every observation is private', () => {
    saveQuickObs(CID, { [SID]: [ob('c', 'concern', 'Private one.', '2026-10-05')] });
    expect(ReportBlocks.renderBlockObservations(CID, ST)).toBe('');
  });
});

describe('Generate', () => {
  const facts = obs => ({
    name: 'Ava',
    pronouns: { subj: 'she', obj: 'her', poss: 'her', refl: 'herself' },
    comps: [],
    work: [],
    record: { total: 0, handed: 0, late: 0, missing: 0 },
    obs,
    voice: {},
    confidence: [],
    habits: {},
    levelText: () => '',
  });
  const o = (id, sentiment, text) => ({ id, text, day: 'Oct 24', sentiment });

  it('never quotes a private note, even when it is the newest or picked', () => {
    const f = facts([
      o('n', 'note', 'Away on vacation.'),
      o('c', 'concern', 'Parent meeting.'),
      o('s', 'strength', 'Led the group.'),
    ]);
    expect(CommentBank.context(f, {}).note).toBe('Led the group.');
    expect(CommentBank.context(f, { note: 'n' }).note).toBe('Led the group.');
    expect(CommentBank.context(f, { note: 'c' }).note).toBe('Led the group.');
  });

  it('has no note when every observation is private', () => {
    const f = facts([o('n', 'note', 'Away on vacation.'), o('c', 'concern', 'Parent meeting.')]);
    const ctx = CommentBank.context(f, {});
    expect(ctx.note).toBe('');
    expect(ctx.concernNote).toBe('');
  });

  it('takes the work-on pick from Growth only', () => {
    const f = facts([
      o('c', 'concern', 'Parent meeting.'),
      o('s', 'strength', 'Led the group.'),
      o('g', 'growth', 'Check the units.'),
    ]);
    expect(CommentBank.context(f, {}).concernNote).toBe('Check the units.');
    const none = facts([o('c', 'concern', 'Parent meeting.'), o('s', 'strength', 'Led the group.')]);
    expect(CommentBank.context(none, {}).concernNote).toBe('');
  });
});

describe('ObsCard', () => {
  const ctx = { cid: CID, quoted: {}, hasTerms: false, sameCapture: {}, studentsById: { [SID]: ST } };
  it('labels Concern and Note cards Private and leaves the others alone', () => {
    const html = s =>
      ObsCard.html({ id: 'x', studentId: SID, text: 'Text.', sentiment: s, created: '2026-10-05T18:00:00.000Z' }, ctx);
    expect(html('concern')).toContain('Private');
    expect(html('note')).toContain('Private');
    expect(html('strength')).not.toContain('Private');
    expect(html('growth')).not.toContain('Private');
    expect(html(null)).not.toContain('Private');
  });
});
