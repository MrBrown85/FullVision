/**
 * Section overrides in returned-only grades (S0-F1b, changed by S0-F1c).
 *
 * Colin's rulings: a section level set by hand counts at once on every
 * screen and has no Draft or Returned state (DECISIONS, "Student page build
 * rulings" 14); and it shows even when no piece under it has a score
 * ("Show the hand-set level now", his answer to S0-F1b's question,
 * 2026-11-09).
 *
 * S0-F1b pinned the behaviour before that answer: an override was only read
 * once its section had a calculated level to replace, so when every piece
 * in a section was a draft never returned, returned-only showed nothing
 * while the teacher's view showed the override. S0-F1c changed
 * getSectionProficiency to read the override first. The two tests marked
 * CHANGED below are the ones that pinned the old answer:
 *   - both pieces drafts: returned-only showed a dash and an overall of 3.0;
 *     it now shows Extending and 3.1, as the teacher's view does;
 *   - both scores cleared, all work: the section showed a dash and the
 *     overall was 3.0 (rounded from 3.0203); it now shows Extending and the
 *     overall counts it.
 * The rule itself, in all work, is tested in
 * tests/section-override-without-evidence.test.js.
 *
 * On the Demo class (Science 8). Jordan Kim's Sustained Inquiry competency
 * (section QP1) has two pieces of evidence: the Plate Tectonics Quiz and
 * the Mid-Year Comprehensive Exam. The clock is frozen as in the golden
 * test. The returned set is given straight to calc.js.
 */
import './setup.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FROZEN_AT, loadDemoClass } from './helpers/golden-grades.js';

const SECTION = 'QP1';
const EXTENDING = 4;

describe('a section level set by hand, in returned-only grades', () => {
  let cid;
  let jordan;
  let quiz;
  let exam;
  let scores;
  let wasDemo;
  // The pieces whose grades are drafts never returned, for Jordan.
  let drafts;

  beforeAll(() => {
    wasDemo = window.isDemoMode;
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(FROZEN_AT));
    cid = loadDemoClass();
    setActiveTerm(cid, null);
    jordan = getStudents(cid).find(s => s.firstName === 'Jordan').id;
    quiz = getAssessments(cid).find(a => a.title === 'Plate Tectonics Quiz').id;
    exam = getAssessments(cid).find(a => a.title === 'Mid-Year Comprehensive Exam').id;
    scores = structuredClone(getScores(cid));
    // The section's only evidence is those two pieces.
    const evidence = getTagScores(cid, jordan, SECTION).map(e => e.assessmentId);
    expect(evidence.sort()).toEqual([quiz, exam].sort());
    globalThis.getReturnedScores = c => {
      const all = getScores(c);
      return Object.assign({}, all, { [jordan]: all[jordan].filter(e => !drafts.has(e.assessmentId)) });
    };
  });
  beforeEach(() => {
    _cache.scores[cid] = structuredClone(scores);
    _cache.overrides[cid] = {};
    drafts = new Set();
    clearProfCache();
  });
  afterAll(() => {
    delete globalThis.getReturnedScores;
    _cache.overrides[cid] = {};
    vi.useRealTimers();
    window.isDemoMode = wasDemo;
    CURRICULUM_INDEX = null;
    localStorage.clear();
    clearProfCache();
  });

  const section = () => getSectionProficiency(cid, jordan, SECTION);
  const overall = () => getOverallProficiency(cid, jordan);
  const summary = () => studentGradeSummary(cid, jordan).text;
  const setByHand = () => {
    setSectionOverride(cid, jordan, SECTION, EXTENDING, 'Conference on Nov 6');
    clearProfCache();
  };
  const fresh = read => {
    clearProfCache();
    return read();
  };

  it('with no override, the section is its calculated level: Proficient', () => {
    expect(section()).toBe(3);
    expect(withReturnedOnly(section)).toBe(3);
    expect(overall()).toBeCloseTo(3.0236, 4);
    expect(summary()).toBe('3.0');
  });

  it('all work: the override replaces the calculated level at once', () => {
    setByHand();
    expect(section()).toBe(EXTENDING);
    expect(getSectionProficiencyRaw(cid, jordan, SECTION)).toBe(3);
    expect(overall()).toBeCloseTo(3.0569, 4);
    expect(summary()).toBe('3.1');
  });

  it('returned only, nothing a draft: the override counts at once, the same number', () => {
    setByHand();
    expect(withReturnedOnly(section)).toBe(EXTENDING);
    expect(withReturnedOnly(overall)).toBe(overall());
  });

  it('returned only, one of the two pieces a draft: the override still counts at once', () => {
    setByHand();
    drafts = new Set([exam]);
    expect(fresh(() => withReturnedOnly(section))).toBe(EXTENDING);
    // Under the override, returned-only has the quiz alone as evidence.
    expect(withReturnedOnly(() => getTagScores(cid, jordan, SECTION).map(e => e.assessmentId))).toEqual([quiz]);
    expect(section()).toBe(EXTENDING);
  });

  it('CHANGED: returned only, both pieces drafts: the override shows, as the teacher sees it', () => {
    setByHand();
    drafts = new Set([quiz, exam]);
    clearProfCache();
    // The teacher's view, drafts and all.
    expect(section()).toBe(EXTENDING);
    expect(overall()).toBeCloseTo(3.0569, 4);
    expect(summary()).toBe('3.1');
    // Returned-only has no evidence in the section. Before S0-F1c that hid
    // the override (section 0, a dash, overall 3.0203, "3.0"). Now the
    // hand-set level stands on its own.
    expect(withReturnedOnly(section)).toBe(EXTENDING);
    expect(withReturnedOnly(() => formatLevel(cid, section()))).toBe('4.0');
    expect(withReturnedOnly(overall)).toBeCloseTo(3.0523, 4);
    expect(withReturnedOnly(summary)).toBe('3.1');
    // It is still not evidence: the calculated level and the count say none.
    expect(withReturnedOnly(() => getSectionProficiencyRaw(cid, jordan, SECTION))).toBe(0);
    expect(withReturnedOnly(() => getSectionEvidenceCount(cid, jordan, SECTION))).toBe(0);
    expect(getSectionEvidenceCount(cid, jordan, SECTION)).toBe(2);
    // The override itself is on file in both sets; it is not a draft.
    expect(withReturnedOnly(() => sectionOverrideInView(cid, jordan, SECTION))).toMatchObject({ level: EXTENDING });
    expect(sectionOverrideInView(cid, jordan, SECTION)).toMatchObject({ level: EXTENDING });
  });

  it('CHANGED: all work, both scores cleared: the override shows there too, and both sets agree', () => {
    setByHand();
    // The two pieces have no score at all (cleared), for the teacher too.
    _cache.scores[cid][jordan] = _cache.scores[cid][jordan].filter(
      e => e.assessmentId !== quiz && e.assessmentId !== exam,
    );
    clearProfCache();
    expect(sectionOverrideInView(cid, jordan, SECTION)).toMatchObject({ level: EXTENDING });
    // Before S0-F1c: section 0, a dash, overall 3.0203.
    expect(section()).toBe(EXTENDING);
    expect(formatLevel(cid, section())).toBe('4.0');
    expect(overall()).toBeCloseTo(3.0523, 4);
    // And returned-only with both pieces drafts gives exactly this class's numbers.
    const cleared = { section: section(), overall: overall(), summary: summary() };
    _cache.scores[cid] = structuredClone(scores);
    drafts = new Set([quiz, exam]);
    clearProfCache();
    expect(withReturnedOnly(() => ({ section: section(), overall: overall(), summary: summary() }))).toEqual(cleared);
  });

  it('the override shows in returned-only before and after a piece is returned', () => {
    setByHand();
    drafts = new Set([quiz, exam]);
    expect(fresh(() => withReturnedOnly(section))).toBe(EXTENDING);
    drafts = new Set([exam]);
    expect(fresh(() => withReturnedOnly(section))).toBe(EXTENDING);
    // Taking the override off leaves returned-only with what was returned.
    setSectionOverride(cid, jordan, SECTION, 0, '');
    expect(fresh(() => withReturnedOnly(section))).toBe(3);
    drafts = new Set([quiz, exam]);
    expect(fresh(() => withReturnedOnly(section))).toBe(0);
  });
});
