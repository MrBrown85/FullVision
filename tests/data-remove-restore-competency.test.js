/**
 * Removing a competency and putting it back (Re-link's "add back"). From the
 * Nov 3 sweep: after Remove the class still counted the removed competency,
 * and Re-link put QP1 back at the end of its folder (QP2, QP3, QP1).
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';

const CID = 'course-remove-restore';

function sec(id) {
  return {
    id,
    name: id,
    subject: 'SCI9',
    groupId: 'g1',
    tags: [{ id, code: id, label: id, subject: 'SCI9' }],
  };
}

beforeEach(() => {
  localStorage.clear();
  _cache.learningMaps[CID] = {
    _flatVersion: 2,
    _customized: true,
    subjects: [{ id: 'SCI9', name: 'Science 9' }],
    competencyGroups: [{ id: 'g1', name: 'Questioning and Predicting', sortOrder: 0 }],
    sections: [sec('QP1'), sec('QP2'), sec('QP3'), sec('PC1')],
  };
});

const codes = () => getSections(CID).map(s => s.id);

describe('removeCompetencies', () => {
  it('drops the competency from the counts at once', () => {
    expect(getAllTags(CID)).toHaveLength(4);
    removeCompetencies(CID, ['QP1']);
    expect(getAllTags(CID)).toHaveLength(3);
    expect(getSectionForTag(CID, 'QP1')).toBeUndefined();
  });
});

describe('restoreCompetency', () => {
  it('puts a competency back where it was', () => {
    removeCompetencies(CID, ['QP1']);
    expect(codes()).toEqual(['QP2', 'QP3', 'PC1']);
    restoreCompetency(CID, 'QP1');
    expect(codes()).toEqual(['QP1', 'QP2', 'QP3', 'PC1']);
    expect(getAllTags(CID)).toHaveLength(4);
  });

  it('puts several back in their places, whatever order they come back in', () => {
    removeCompetencies(CID, ['QP2', 'QP3']);
    expect(codes()).toEqual(['QP1', 'PC1']);
    restoreCompetency(CID, 'QP3');
    restoreCompetency(CID, 'QP2');
    expect(codes()).toEqual(['QP1', 'QP2', 'QP3', 'PC1']);
  });

  it('puts one removed before places were kept at the end', () => {
    removeCompetencies(CID, ['QP1']);
    const list = getRemovedSections(CID).map(r => ({ section: r.section, removedAt: r.removedAt }));
    localStorage.setItem('gb-removed-sections-' + CID, JSON.stringify(list));
    restoreCompetency(CID, 'QP1');
    expect(codes()).toEqual(['QP2', 'QP3', 'PC1', 'QP1']);
  });
});
