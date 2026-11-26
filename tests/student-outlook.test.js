/**
 * The Gradebook's card on a student's name (teacher/student-outlook.js).
 *
 * The card used to list every competency's level, which teachers did not
 * read (Colin, Nov 25: "they'd rather have a view of what's been submitted,
 * not, trends in growth/decline"). It now shows the grade with how it has
 * moved in a month and a line of it over the year, a bar a category, and
 * the missing work with what handing each piece in adds: the student page's
 * own "if handed in" figures, from the one model both screens read
 * (StudentOutlook.model), so the two never disagree.
 */
import './setup.js';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseHTML } from 'linkedom';

const CID = 'cSO';
const STUDENT = { id: 's1', firstName: 'Ava', lastName: 'Test', designations: [] };
// Days counted back from now, so "a month ago" stays between the scored work and the missing work.
const ago = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const pts = (id, title, max, date, categoryId) => ({
  id,
  title,
  scoreMode: 'points',
  maxPoints: max,
  tagIds: ['T1'],
  date,
  type: 'summative',
  categoryId,
});
const entry = (aid, score, date) => ({ assessmentId: aid, tagId: 'T1', score, date, note: '' });

function seed(gradingSystem, assessments, scores, statuses, categories) {
  localStorage.clear();
  COURSES[CID] = { id: CID, name: 'History 12', gradingSystem, gradeLevel: '12' };
  _cache.students[CID] = [STUDENT];
  _cache.assessments[CID] = assessments;
  _cache.scores[CID] = { s1: scores };
  _cache.statuses[CID] = statuses;
  _cache.categories[CID] = categories || [];
  _cache.courseConfigs[CID] = {};
  clearProfCache();
}

// Two quizzes scored two months ago, two pieces missing this month.
function usual(gradingSystem) {
  seed(
    gradingSystem,
    [
      pts('q1', 'Quiz One', 10, ago(60)),
      pts('q2', 'Quiz Two', 10, ago(45)),
      pts('m1', 'Short Response', 10, ago(10)),
      pts('m2', 'Source Essay', 20, ago(5)),
    ],
    [entry('q1', 9, ago(60)), entry('q2', 7, ago(45))],
    { 's1:m1': 'NS', 's1:m2': 'NS' },
  );
}

const card = () => parseHTML('<div id="c">' + StudentOutlook.cardHtml(CID, STUDENT) + '</div>').document;
const text = (doc, sel) => Array.from(doc.querySelectorAll(sel)).map(el => el.textContent);

describe('StudentOutlook.model', () => {
  beforeEach(() => usual('letter'));

  it('gives the grade with the missing work in, and what each piece adds, the largest first', () => {
    const o = StudentOutlook.model(CID, 's1', getAssessments(CID));
    expect(o.lg.R).toBe(32);
    expect(o.proj.lg.R).toBe(80);
    expect(o.proj.cost).toBe(48);
    expect(o.missing.map(a => a.id)).toEqual(['m2', 'm1']);
    expect(o.gains.m2).toBeGreaterThan(o.gains.m1);
    expect(o.handedIn).toBe(2);
  });

  it('gives none when under a third of the work is assessed', () => {
    _cache.scores[CID] = { s1: [entry('q1', 9, ago(60))] };
    _cache.statuses[CID] = { 's1:q2': 'NS', 's1:m1': 'NS', 's1:m2': 'NS' };
    clearProfCache();
    const o = StudentOutlook.model(CID, 's1', getAssessments(CID));
    expect(o.thin).toBe(true);
    expect(o.proj).toBeNull();
    expect(o.missing).toHaveLength(3);
  });

  it('gives none in a Proficiency class, where Missing lowers nothing', () => {
    usual('proficiency');
    const o = StudentOutlook.model(CID, 's1', getAssessments(CID));
    expect(o.lg).toBeNull();
    expect(o.proj).toBeNull();
    expect(o.missing).toHaveLength(2);
  });
});

describe('the card on a student’s name', () => {
  it('shows the grade, how it has moved in a month, and a line of it over the year', () => {
    usual('letter');
    const doc = card();
    expect(doc.querySelector('.gb-tip-name').textContent).toBe('Ava Test');
    expect(doc.querySelector('.gb-tip-grade').textContent).toContain('32%');
    // 80% a month ago, 32% now.
    const move = doc.querySelector('.gb-card-move');
    expect(move.classList.contains('is-down')).toBe(true);
    expect(move.textContent).toBe('48% Since ' + formatShortDate(monthAgoDate(courseToday(CID))));
    expect(doc.querySelector('svg.gb-card-line polyline').getAttribute('points').split(' ').length).toBeGreaterThan(2);
  });

  it('lists the missing work with what each piece adds, then the grade with all of it in', () => {
    usual('letter');
    const doc = card();
    expect(text(doc, '.gb-card-head span')).toEqual(['Missing Work', 'If Handed In']);
    expect(text(doc, '.gb-card-row .gb-card-what')).toEqual(['Source Essay', 'Short Response']);
    const o = StudentOutlook.model(CID, 's1', getAssessments(CID));
    expect(text(doc, '.gb-card-gain')).toEqual(['+' + o.gains.m2 + '%', '+' + o.gains.m1 + '%']);
    expect(doc.querySelector('.gb-card-total').textContent).toBe('With All 2 Handed InB 80%');
  });

  it('says With It Handed In for one piece', () => {
    usual('letter');
    _cache.statuses[CID] = { 's1:m1': 'NS' };
    clearProfCache();
    expect(card().querySelector('.gb-card-total span').textContent).toBe('With It Handed In');
  });

  it('shows no competencies', () => {
    usual('letter');
    const doc = card();
    expect(doc.body.textContent).not.toContain('Competencies');
    expect(doc.body.textContent).not.toContain('Evidence in');
  });

  it('lists the missing work without If Handed In in a Proficiency class', () => {
    usual('proficiency');
    const doc = card();
    expect(text(doc, '.gb-card-head span')).toEqual(['Missing Work']);
    expect(text(doc, '.gb-card-row .gb-card-what')).toEqual(['Short Response', 'Source Essay']);
    expect(doc.querySelector('.gb-card-gain')).toBeNull();
    expect(doc.querySelector('.gb-card-total')).toBeNull();
  });

  it('and without it when under a third of the work is assessed', () => {
    usual('letter');
    _cache.scores[CID] = { s1: [entry('q1', 9, ago(60))] };
    _cache.statuses[CID] = { 's1:q2': 'NS', 's1:m1': 'NS', 's1:m2': 'NS' };
    clearProfCache();
    const doc = card();
    expect(text(doc, '.gb-card-head span')).toEqual(['Missing Work']);
    expect(doc.querySelector('.gb-card-total')).toBeNull();
  });

  it('shows four pieces and how many more when over five are missing', () => {
    const scored = [1, 2, 3].map(i => pts('q' + i, 'Quiz ' + i, 10, ago(70 - i)));
    const missing = [1, 2, 3, 4, 5, 6].map(i => pts('m' + i, 'Piece ' + i, 10, ago(20 - i)));
    const statuses = {};
    missing.forEach(a => (statuses['s1:' + a.id] = 'NS'));
    seed(
      'letter',
      scored.concat(missing),
      scored.map(a => entry(a.id, 8, a.date)),
      statuses,
    );
    const doc = card();
    expect(text(doc, '.gb-card-row .gb-card-what')).toHaveLength(4);
    expect(doc.querySelector('.gb-card-more').textContent).toBe('2 More');
    expect(doc.querySelector('.gb-card-total span').textContent).toBe('With All 6 Handed In');
  });

  it('shows five when five are missing', () => {
    const scored = [1, 2, 3].map(i => pts('q' + i, 'Quiz ' + i, 10, ago(70 - i)));
    const missing = [1, 2, 3, 4, 5].map(i => pts('m' + i, 'Piece ' + i, 10, ago(20 - i)));
    const statuses = {};
    missing.forEach(a => (statuses['s1:' + a.id] = 'NS'));
    seed(
      'letter',
      scored.concat(missing),
      scored.map(a => entry(a.id, 8, a.date)),
      statuses,
    );
    const doc = card();
    expect(text(doc, '.gb-card-row .gb-card-what')).toHaveLength(5);
    expect(doc.querySelector('.gb-card-more')).toBeNull();
  });

  it('draws a bar a category, as wide as its share of the grade, and leaves out a 0% one', () => {
    seed(
      'letter',
      [
        pts('p1', 'Essay', 10, ago(60), 'cat-p'),
        pts('t1', 'Test', 10, ago(45), 'cat-t'),
        pts('x1', 'Practice', 10, ago(40), 'cat-x'),
      ],
      [entry('p1', 9, ago(60)), entry('t1', 6, ago(45)), entry('x1', 2, ago(40))],
      {},
      [
        { id: 'cat-p', name: 'Projects & Papers', weight: 70 },
        { id: 'cat-t', name: 'Tests', weight: 30 },
        { id: 'cat-x', name: 'Practice', weight: 0 },
      ],
    );
    const doc = card();
    const segs = Array.from(doc.querySelectorAll('.gb-card-seg'));
    expect(segs.map(s => s.getAttribute('style'))).toEqual(['flex:70 1 0', 'flex:30 1 0']);
    expect(segs.map(s => s.firstElementChild.getAttribute('style').split(';')[0])).toEqual(['width:90%', 'width:60%']);
    expect(text(doc, '.gb-card-cat .gb-card-what')).toEqual(['Projects & Papers', 'Tests']);
    expect(text(doc, '.gb-card-cat small')).toEqual(['70%', '30%']);
    expect(doc.querySelector('.gb-card-cats').getAttribute('aria-label')).toContain('Tests');
    expect(doc.querySelector('.gb-card-cats').getAttribute('aria-label')).toContain('30% of the grade');
    // Nothing is missing: no list.
    expect(doc.querySelector('.gb-card-head')).toBeNull();
  });

  it('draws no bars in a class with no categories, and no line from one day’s work', () => {
    seed('letter', [pts('q1', 'Quiz One', 10, ago(0))], [entry('q1', 9, ago(0))], {});
    const doc = card();
    expect(doc.querySelector('.gb-card-cats')).toBeNull();
    expect(doc.querySelector('.gb-card-line')).toBeNull();
    expect(doc.querySelector('.gb-card-move')).toBeNull();
  });

  it('escapes a title', () => {
    usual('letter');
    _cache.assessments[CID][2].title = '<b>Bold</b>';
    clearProfCache();
    const html = StudentOutlook.cardHtml(CID, STUDENT);
    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt;');
    expect(html).not.toContain('<b>Bold</b>');
  });
});
