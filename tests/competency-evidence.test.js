/**
 * The evidence drawer on a student page competency card —
 * teacher/competency-evidence.js.
 *
 * The merged list (scores and linked observations, newest first), term
 * scoping, the row's count wording, the explanation line, and the drawer in
 * a DOM: jump to the Evidence panel, and Add observation with a level.
 * Adding a competency-linked observation with a level leaves
 * getTagProficiency and getSectionProficiency exactly as they were.
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const H = CompetencyEvidence._helpers;
const ob = (id, date, extra = {}) => ({
  id,
  date,
  created: date + 'T15:00:00.000Z',
  text: 'Note ' + id,
  dims: [],
  ...extra,
});
const sc = (assessmentId, date, score) => ({ assessmentId, date, score, tagId: 't1' });

describe('countLabel', () => {
  it('names both counts with the right plurals', () => {
    expect(H.countLabel(3, 2)).toBe('3 scores · 2 observations');
    expect(H.countLabel(1, 1)).toBe('1 score · 1 observation');
    expect(H.countLabel(2, 0)).toBe('2 scores · 0 observations');
    expect(H.countLabel(0, 1)).toBe('0 scores · 1 observation');
  });
  it('says "No evidence yet" when there is neither', () => {
    expect(H.countLabel(0, 0)).toBe('No evidence yet');
  });
});

describe('tagObservations and obsInTerm', () => {
  const term = { startsOn: '2026-09-01', endsOn: '2026-11-30' };
  const obs = [
    ob('in', '2026-10-01', { competencyId: 't1' }),
    ob('first-day', '2026-09-01', { competencyId: 't1' }),
    ob('last-day', '2026-11-30', { competencyId: 't1' }),
    ob('before', '2026-08-20', { competencyId: 't1' }),
    ob('other', '2026-10-02', { competencyId: 't2' }),
    ob('none', '2026-10-03'),
    { id: 'created-only', created: '2026-10-04T09:00:00Z', competencyId: 't1', text: '' },
  ];

  it('keeps only observations linked to the competency', () => {
    expect(H.tagObservations(obs, 't1', null).map(o => o.id)).toEqual([
      'in',
      'first-day',
      'last-day',
      'before',
      'created-only',
    ]);
  });

  it('limits them to the term, ends included', () => {
    expect(H.tagObservations(obs, 't1', term).map(o => o.id)).toEqual(['in', 'first-day', 'last-day', 'created-only']);
    expect(H.obsInTerm({ id: 'x' }, term)).toBe(false);
    expect(H.obsInTerm({ id: 'x' }, null)).toBe(true);
  });
});

describe('mergeEvidence', () => {
  it('puts scores and observations on one list, newest first', () => {
    const rows = H.mergeEvidence(
      [sc('a1', '2026-09-10', 2), sc('a2', '2026-10-05', 3)],
      [ob('o1', '2026-09-20'), ob('o2', '2026-10-12')],
    );
    expect(rows.map(r => r.kind + ':' + (r.kind === 'obs' ? r.ob.id : r.score.assessmentId))).toEqual([
      'obs:o2',
      'score:a2',
      'obs:o1',
      'score:a1',
    ]);
    expect(rows[1].date).toBe('2026-10-05');
  });

  it('on one day lists observations first, the later one first', () => {
    const rows = H.mergeEvidence(
      [sc('a1', '2026-10-05', 2)],
      [
        ob('early', '2026-10-05', { created: '2026-10-05T09:00:00Z' }),
        ob('late', '2026-10-05', { created: '2026-10-05T14:00:00Z' }),
      ],
    );
    expect(rows.map(r => (r.kind === 'obs' ? r.ob.id : r.score.assessmentId))).toEqual(['late', 'early', 'a1']);
  });

  it('is empty with nothing to list', () => {
    expect(H.mergeEvidence([], [])).toEqual([]);
  });
});

describe('explainText', () => {
  it('names the method', () => {
    expect(H.explainText('Most recent score', null, '')).toBe('Competency level: Most recent score.');
  });
  it('adds the override and its reason', () => {
    expect(H.explainText('Highest score', { level: 4, reason: 'Portfolio shows more' }, 'Extending')).toBe(
      'Competency level: Highest score. Overridden to Extending: Portfolio shows more.',
    );
    expect(H.explainText('Highest score', { level: 4, reason: '' }, 'Extending')).toBe(
      'Competency level: Highest score. Overridden to Extending.',
    );
  });
});

/* ── The drawer in a page ───────────────────────────────────── */

const CID = 'ced-course';
const SID = 'stu1';

describe('Evidence drawer in the page', () => {
  let dom;
  let observations;
  let overrides;
  let config;
  const saved = {};
  const swap = (k, v) => {
    if (!(k in saved)) saved[k] = globalThis[k];
    globalThis[k] = v;
  };
  const tag = { id: 't1', label: 'Make observations' };
  const section = { id: 'sec1', name: 'Questioning and predicting', color: '#888', tags: [tag] };

  function draw() {
    const main = dom.document.getElementById('main');
    main.innerHTML =
      '<div class="dash-section"><button type="button" class="dash-tag-row open" data-tagid="t1" aria-expanded="true" aria-controls="ced-sec1">' +
      '<span class="dash-tag-evidence">' +
      CompetencyEvidence.rowCount(CID, SID, 't1') +
      '</span></button>' +
      CompetencyEvidence.drawerHtml(CID, SID, section, tag, 'ced-sec1') +
      '</div>';
    CompetencyEvidence.mount(CID, SID, main, { onAdd: onAdd });
  }
  let onAdd;

  beforeEach(async () => {
    const { parseHTML } = await import('linkedom');
    dom = parseHTML('<!doctype html><html><body><main id="main"></main></body></html>');
    clearProfCache();
    setActiveTerm(CID, null);
    globalThis.COURSES = { [CID]: { id: CID, name: 'Science 8', calcMethod: 'mostRecent', decayWeight: 0.65 } };
    observations = {
      [SID]: [
        ob('o-old', '2026-08-25', { competencyId: 't1', sentiment: 'growth', text: 'Summer note' }),
        ob('o1', '2026-10-03', {
          competencyId: 't1',
          sentiment: 'strength',
          level: 3,
          text: 'Recorded every reading\nThen compared with a partner',
        }),
        ob('o-other', '2026-10-04', { competencyId: 't2', text: 'Other competency' }),
        ob('o-none', '2026-10-06', { text: 'Not linked' }),
      ],
    };
    overrides = {};
    config = {
      calcMethod: 'mostRecent',
      decayWeight: 0.65,
      reportingTerms: [{ ordinal: 1, label: 'Term 1', startsOn: '2026-09-01', endsOn: '2026-11-30' }],
    };
    onAdd = vi.fn();
    swap('document', dom.document);
    swap('getScores', () => ({
      [SID]: [
        { score: 2, tagId: 't1', assessmentId: 'a0', date: '2026-08-28', type: 'summative' },
        { score: 2, tagId: 't1', assessmentId: 'a1', date: '2026-10-01', type: 'summative' },
        { score: 3, tagId: 't1', assessmentId: 'a2', date: '2026-10-08', type: 'summative' },
      ],
    }));
    swap('getAssessments', () => [
      { id: 'a0', title: 'Summer lab', type: 'summative', tagIds: ['t1'], date: '2026-08-28' },
      { id: 'a1', title: 'Lab 1', type: 'summative', tagIds: ['t1'], date: '2026-10-01' },
      { id: 'a2', title: 'Lab 2', type: 'summative', tagIds: ['t1'], date: '2026-10-08' },
    ]);
    swap('getAssignmentStatuses', () => ({}));
    swap('getCourseConfig', () => config);
    swap('getSections', () => [section]);
    swap('getOverrides', () => overrides);
    swap('getAllTags', () => [tag]);
    swap('getTagById', (cid, id) => (id === 't1' ? tag : null));
    swap('getSectionForTag', () => section);
    swap('getGradingScale', () => DEFAULT_GRADING_SCALE);
    swap('getStudents', () => [{ id: SID, firstName: 'Mei', lastName: 'Wong' }]);
    swap('getQuickObs', () => observations);
    swap('getStudentQuickObs', (cid, sid) =>
      (observations[sid] || []).slice().sort((a, b) => (b.created || '').localeCompare(a.created || '')),
    );
    swap('getAllQuickObs', () =>
      Object.keys(observations).flatMap(sid => observations[sid].map(o => ({ studentId: sid, ...o }))),
    );
    swap('getTodayStr', () => '2026-10-18');
    draw();
  });

  afterEach(() => {
    CompetencyEvidence.destroy();
    setActiveTerm(CID, null);
    Object.keys(saved).forEach(k => (globalThis[k] = saved[k]));
    Object.keys(saved).forEach(k => delete saved[k]);
    vi.restoreAllMocks();
  });

  const $ = sel => dom.document.querySelector(sel);
  const $$ = sel => Array.from(dom.document.querySelectorAll(sel));
  const rowIds = () =>
    $$('.ced-list .tag-assess-row').map(r =>
      r.getAttribute('data-obid') ? 'obs:' + r.getAttribute('data-obid') : 'score:' + r.textContent.trim(),
    );

  it('lists scores and linked observations together, newest first', () => {
    expect($('.dash-tag-evidence').textContent).toBe('3 scores · 2 observations');
    expect(rowIds()).toEqual([
      'score:3Lab 2' + formatDate('2026-10-08'),
      'obs:o1',
      'score:2Lab 1' + formatDate('2026-10-01'),
      'score:2Summer lab' + formatDate('2026-08-28'),
      'obs:o-old',
    ]);
    const o1 = $('.ced-obs-row[data-obid="o1"]');
    expect(o1.querySelector('.obs-pill-type').textContent).toBe('Strength');
    expect(o1.querySelector('.ced-obs-first').textContent).toBe('Recorded every reading');
    expect(o1.getAttribute('title')).toBe('Recorded every reading\nThen compared with a partner');
    expect(o1.querySelector('.obsc-pill-level').textContent).toBe('Looks Proficient');
    expect($('.ced-obs-row[data-obid="o-old"] .obsc-pill-level')).toBeNull();
    expect($('.ced-explain').textContent).toBe('Competency level: Most recent score.');
  });

  it('follows the active term, like the level badge', () => {
    setActiveTerm(CID, 1);
    clearProfCache();
    draw();
    expect($('.dash-tag-evidence').textContent).toBe('2 scores · 1 observation');
    expect(rowIds().map(r => r.split(':')[0] + ':' + (r.startsWith('obs') ? r.slice(4) : r.slice(7, 12)))).toEqual([
      'score:Lab 2',
      'obs:o1',
      'score:Lab 1',
    ]);
  });

  it('says "No evidence yet" when there is nothing', () => {
    swap('getScores', () => ({}));
    observations[SID] = [];
    clearProfCache();
    draw();
    expect($('.dash-tag-evidence').textContent).toBe('No evidence yet');
    expect($('.ced-list').textContent).toBe('No evidence yet');
  });

  it('shows the override and its reason in the explanation line', () => {
    overrides = { [SID]: { sec1: { level: 4, reason: 'Portfolio shows more', date: '2026-10-10', calculated: 3 } } };
    draw();
    expect($('.ced-explain').textContent).toBe(
      'Competency level: Most recent score. Overridden to Extending: Portfolio shows more.',
    );
  });

  it('an observation row jumps to its card in the Evidence panel', () => {
    const jump = vi.spyOn(StudentEvidence, 'jumpTo').mockImplementation(() => {});
    $('.ced-obs-row[data-obid="o1"]').click();
    expect(jump).toHaveBeenCalledWith('o1');
  });

  it('Add observation opens the strip for this student and competency, and leaves every grade as it was', () => {
    function grades() {
      clearProfCache();
      return {
        tag: getTagProficiency(CID, SID, 't1'),
        section: getSectionProficiency(CID, SID, 'sec1'),
      };
    }
    const before = grades();
    expect(before).toEqual({ tag: 3, section: 3 });

    $('[data-ced="add"]').click();
    const strip = $('.ced-capture .obsc');
    expect(strip).toBeTruthy();
    expect($('[data-ced="add"]').hidden).toBe(true);
    expect($('[data-ced="done"]').hidden).toBe(false);
    expect(strip.textContent).toContain('Mei Wong');
    expect(strip.textContent).toContain('Competency: Make observations');
    expect(strip.querySelector('#ced-student-btn')).toBeNull();

    // Pick a level well above the scores: Extending.
    strip.querySelector('#ced-level-btn').click();
    strip.querySelector('[data-obsc="setLevel"][data-value="4"]').click();
    const input = strip.querySelector('textarea');
    input.value = 'Planned a fair test on her own';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    strip.querySelector('[data-obsc="add"]').click();

    const added = observations[SID].find(o => o.text === 'Planned a fair test on her own');
    expect(added).toMatchObject({ competencyId: 't1', level: 4 });
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect($('.dash-tag-evidence').textContent).toBe('3 scores · 3 observations');
    const row = $('.ced-obs-row[data-obid="' + added.id + '"]');
    expect(row).toBeTruthy();
    expect(row.querySelector('.obsc-pill-level').textContent).toBe('Looks Extending');

    expect(grades()).toEqual(before);
  });

  it('keeps an open strip across a page redraw, and Done closes it', () => {
    $('[data-ced="add"]').click();
    $('.ced-capture textarea').value = 'Half a thought';
    draw();
    expect($('.ced-capture textarea').value).toBe('Half a thought');
    expect($('[data-ced="add"]').hidden).toBe(true);
    $('[data-ced="done"]').click();
    expect($('.ced-capture .obsc')).toBeNull();
    expect($('[data-ced="add"]').hidden).toBe(false);
  });
});
