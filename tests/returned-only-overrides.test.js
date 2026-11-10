/**
 * Section overrides in returned-only grades (S0-F1b).
 *
 * Colin's ruling (DECISIONS, "Student page build rulings" 14): a section
 * level set by hand counts at once on every screen, as today; it has no
 * Draft or Returned state.
 *
 * "As today" has one edge, and this file pins it. In shared/calc.js an
 * override replaces a section's calculated level; it is only looked at once
 * the section has a calculated level to replace (getSectionProficiency
 * returns 0 before it reads the override when no competency in the section
 * has scored evidence). That is true in all work today: a section with no
 * scored work shows nothing, whatever was set by hand. Returned-only follows
 * the same rule on the evidence it has, so when every piece in a section is
 * a draft never returned, the override does not show there, while the
 * teacher's view (which has the drafts as evidence) shows it.
 *
 * QUESTION FOR COLIN (S0-F1b's PR): Jordan's section has two pieces, both
 * drafts, and you set the section to Extending by hand. Should a report show
 * Extending now, or nothing until one piece is returned? As built: nothing
 * until one is returned. If the answer is "Extending now", the change is in
 * getSectionProficiency (read the override first), it also changes all work
 * for a section with no scored evidence, and the two tests marked PINNED
 * below change with it.
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
    expect(studentGradeSummary(cid, jordan).text).toBe('3.0');
  });

  it('all work: the override replaces the calculated level at once', () => {
    setByHand();
    expect(section()).toBe(EXTENDING);
    expect(getSectionProficiencyRaw(cid, jordan, SECTION)).toBe(3);
    expect(overall()).toBeCloseTo(3.0569, 4);
    expect(studentGradeSummary(cid, jordan).text).toBe('3.1');
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

  it('PINNED: returned only, both pieces drafts: the override does not show; the teacher sees it', () => {
    setByHand();
    drafts = new Set([quiz, exam]);
    clearProfCache();
    // The teacher's view has the drafts as evidence, so the override applies.
    expect(section()).toBe(EXTENDING);
    expect(overall()).toBeCloseTo(3.0569, 4);
    expect(studentGradeSummary(cid, jordan).text).toBe('3.1');
    // Returned-only has no evidence in the section: nothing to replace.
    expect(withReturnedOnly(section)).toBe(0);
    expect(withReturnedOnly(() => formatLevel(cid, section()))).toBe('—');
    // The section is left out of the overall, as any section with no evidence is.
    expect(withReturnedOnly(overall)).toBeCloseTo(3.0203, 4);
    expect(withReturnedOnly(() => studentGradeSummary(cid, jordan).text)).toBe('3.0');
    // The override itself is on file in both sets; it is not a draft.
    expect(withReturnedOnly(() => sectionOverrideInView(cid, jordan, SECTION))).toMatchObject({ level: EXTENDING });
    expect(sectionOverrideInView(cid, jordan, SECTION)).toMatchObject({ level: EXTENDING });
  });

  it('PINNED: all work behaves the same way today: an override on a section with no scored work does not show', () => {
    setByHand();
    // The two pieces have no score at all (cleared), for the teacher too.
    _cache.scores[cid][jordan] = _cache.scores[cid][jordan].filter(
      e => e.assessmentId !== quiz && e.assessmentId !== exam,
    );
    clearProfCache();
    expect(sectionOverrideInView(cid, jordan, SECTION)).toMatchObject({ level: EXTENDING });
    expect(section()).toBe(0);
    expect(formatLevel(cid, section())).toBe('—');
    // And returned-only with both pieces drafts gives exactly this class's numbers.
    const cleared = { section: section(), overall: overall(), summary: studentGradeSummary(cid, jordan).text };
    _cache.scores[cid] = structuredClone(scores);
    drafts = new Set([quiz, exam]);
    clearProfCache();
    expect(
      withReturnedOnly(() => ({
        section: section(),
        overall: overall(),
        summary: studentGradeSummary(cid, jordan).text,
      })),
    ).toEqual(cleared);
  });

  it('once one piece is returned, the override shows in returned-only too', () => {
    setByHand();
    drafts = new Set([quiz, exam]);
    expect(fresh(() => withReturnedOnly(section))).toBe(0);
    drafts = new Set([exam]);
    expect(fresh(() => withReturnedOnly(section))).toBe(EXTENDING);
  });
});
