/**
 * The phone's student page lists same-date pieces in the order they were
 * made (DECISIONS, "the one made later counts later"; calc.js
 * samePieceDateOrder). No grade changes: only which of two pieces on one
 * date comes first on the page.
 *
 * - Grade Newest names the piece made later, however the pieces are stored.
 * - A competency's last-five timeline lists same-date scores in made order
 *   even when two competencies hold them (the timeline joins the competencies'
 *   scores one after the other).
 * - shell.js's own Grade Newest choice (it boots itself, so the source is
 *   read, as other mobile tests read it).
 */
import './setup-mobile.js';
import { readFileSync } from 'fs';
import { afterEach, describe, expect, it } from 'vitest';

const CID = 'mobile-order';
const SID = 'sam';
const DAY = '2026-10-05';
const piece = (id, tag, n) => ({
  id,
  title: 'Piece ' + id,
  date: DAY,
  tagIds: [tag],
  created: '2026-10-01T09:0' + n + ':00.000Z',
});

// Made first: "first" on t2. Made later: "later" on t1. A section lists t1's scores before t2's.
// Pieces stored in made order for Grade Newest to tie-break; the timeline's disagreement comes from the tag order.
function seed() {
  COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
  _cache.students[CID] = [{ id: SID, firstName: 'Sam', lastName: 'Test', designations: [] }];
  _cache.learningMaps[CID] = {
    subjects: [],
    sections: [
      {
        id: 'sec',
        name: 'Inquiry',
        tags: [
          { id: 't1', label: 'Questioning' },
          { id: 't2', label: 'Designing' },
        ],
      },
    ],
    _customized: true,
    _version: 1,
  };
  _cache.categories[CID] = [];
  _cache.assessments[CID] = [piece('first', 't2', 1), piece('later', 't1', 5)];
  _cache.scores[CID] = {
    [SID]: [
      { assessmentId: 'later', tagId: 't1', score: 3, date: DAY },
      { assessmentId: 'first', tagId: 't2', score: 2, date: DAY },
    ],
  };
  _cache.statuses[CID] = {};
  _cache.rubrics[CID] = [];
  _cache.overrides[CID] = {};
  _cache.courseConfigs[CID] = { calcMethod: 'average' };
  clearProfCache();
}

const detail = () => MStudentDetail.renderDetail({ cid: CID, sid: SID, renderBadges: () => '' });

describe('the phone student page: same-date pieces in the order they were made', () => {
  afterEach(() => delete COURSES[CID]);

  it('Grade Newest names the piece made later', () => {
    seed();
    expect(detail()).toContain('Grade Newest: Piece later');
  });

  it('the last-five timeline lists the piece made first before the piece made later', () => {
    seed();
    const html = detail();
    const first = html.indexOf('m-sec-tl-name">Piece first');
    const later = html.indexOf('m-sec-tl-name">Piece later');
    expect(first).toBeGreaterThan(0);
    expect(later).toBeGreaterThan(first);
  });

  it('shell.js picks the newest piece to grade with the same tie-break', () => {
    const shell = readFileSync('teacher-mobile/shell.js', 'utf-8');
    expect(shell).toContain("(b.date || '').localeCompare(a.date || '') || samePieceDateOrder(_cid, b.id, a.id)");
  });
});
