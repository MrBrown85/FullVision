/**
 * Demo Mode's Science 8 is built from the curriculum bank, the way the New
 * Class wizard builds a class (shared/seed-data.js): Science 8's 27
 * competencies in six Ministry folders, with the Ministry's wording, I Can
 * statements and bank ids. The sample work was written against six broad
 * areas; each area becomes a competency from its folder, so every score
 * lands on a competency the class has and every competency has evidence.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newBankIndex } from './helpers/bc-bank-fixture.js';

const CID = 'sci8';
let saved;

beforeAll(() => {
  saved = window.isDemoMode;
  window.isDemoMode = () => true;
  localStorage.clear();
  CURRICULUM_INDEX = newBankIndex(['SCI8']);
  runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
  seedIfNeeded();
});

afterAll(() => {
  window.isDemoMode = saved;
  CURRICULUM_INDEX = null;
  localStorage.clear();
});

describe('the demo class from the curriculum bank', () => {
  it('has Science 8’s 27 competencies in six Ministry folders, with their wording and I Can statements', () => {
    const map = getLearningMap(CID);
    expect(map.sections).toHaveLength(27);
    expect((map.competencyGroups || []).map(g => g.name)).toEqual([
      'Questioning and Predicting',
      'Planning and Conducting',
      'Processing and Analyzing',
      'Evaluating',
      'Applying and Innovating',
      'Communicating',
    ]);
    map.sections.forEach(sec => {
      const tag = sec.tags[0];
      expect(tag.bank_id, sec.id).toMatch(/^bc\.sci8\.cc\.\d+$/);
      expect(tag.text, sec.id).toBeTruthy();
      expect(tag.i_can_statements.length, sec.id).toBeGreaterThan(1);
      expect(sec.groupId, sec.id).toBeTruthy();
    });
    const qp1 = map.sections.find(s => s.id === 'QP1').tags[0];
    expect(qp1.label).toBe('Sustained Inquiry');
    expect(qp1.text).toMatch(/^Demonstrate a sustained intellectual curiosity about a scientific topic/);
  });

  it('scores work only on competencies the class has', () => {
    const ids = new Set(getLearningMap(CID).sections.map(s => s.id));
    getAssessments(CID).forEach(a => (a.tagIds || []).forEach(t => expect(ids.has(t), a.title + ' → ' + t).toBe(true)));
    getRubrics(CID).forEach(r =>
      r.criteria.forEach(c => (c.tagIds || []).forEach(t => expect(ids.has(t), r.name + ' → ' + t).toBe(true))),
    );
    Object.values(getScores(CID))
      .flat()
      .forEach(e => {
        const a = getAssessments(CID).find(x => x.id === e.assessmentId);
        if (a && !a.rubricId && a.tagIds && a.tagIds.length) expect(ids.has(e.tagId), e.tagId).toBe(true);
      });
  });

  it('puts a rubric’s assessments on every competency its criteria feed', () => {
    const rubrics = {};
    getRubrics(CID).forEach(r => (rubrics[r.id] = r));
    getAssessments(CID)
      .filter(a => a.rubricId && rubrics[a.rubricId])
      .forEach(a => {
        const fed = rubrics[a.rubricId].criteria.flatMap(c => c.tagIds || []);
        fed.forEach(t => expect(a.tagIds, a.title + ' → ' + t).toContain(t));
      });
  });

  it('gives every competency scores', () => {
    // A score on rubric work is evidence for the competencies its criteria
    // feed; on other work, for the assessment's own competencies.
    const rubrics = {};
    getRubrics(CID).forEach(r => (rubrics[r.id] = r));
    const byId = {};
    getAssessments(CID).forEach(a => (byId[a.id] = a));
    const scored = new Set();
    Object.values(getScores(CID))
      .flat()
      .forEach(e => {
        const a = byId[e.assessmentId];
        if (!a || !(e.score > 0)) return;
        const rubric = a.rubricId && rubrics[a.rubricId];
        if (rubric) {
          const crit = rubric.criteria.find(c => c.id === e.tagId);
          (crit ? crit.tagIds || [] : []).forEach(t => scored.add(t));
        } else scored.add(e.tagId);
      });
    const missing = getLearningMap(CID)
      .sections.map(s => s.id)
      .filter(id => !scored.has(id));
    expect(missing).toEqual([]);
  });
});
