/**
 * competency: the tests that were tests/competency-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('competency-bucket-reload', () => {
  /**
   * A competency level is the same before and after a reload (2026-11-01
   * math audit). Work outside a category counts toward a competency only when
   * it has no categorized evidence. That was read from the assessment's type,
   * but the server loads uncategorized work as formative while work just made
   * on this device was created summative, so in a class with no categories a
   * new quiz outweighed everything until the page was reloaded.
   */

  const CID = 'bucket-reload';
  const TERMS = [];

  function seed(o) {
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency', gradeLevel: '8' };
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [{ id: 'sa', name: 'A', tags: [{ id: 't1' }] }],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = o.categories || [];
    _cache.assessments[CID] = o.assessments;
    _cache.scores[CID] = o.scores;
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = Object.assign({ reportingTerms: TERMS }, o.config);
    clearProfCache();
  }

  describe('a competency level is the same before and after a reload', () => {
    afterEach(() => delete COURSES[CID]);

    /* A class with no categories. Assessments loaded from the server have no
     category, so they load as formative; one the teacher has just made on
     this device was created summative. */
    it('counts work made on this device the way it will count once reloaded', () => {
      const loaded = id => ({ id, title: id, date: '2026-09-0' + id.slice(1), tagIds: ['t1'], type: 'formative' });
      const made = { id: 'a3', title: 'New Quiz', date: '2026-09-09', tagIds: ['t1'], type: 'summative' };
      const scores = {
        s1: [
          { assessmentId: 'a1', tagId: 't1', score: 2, date: '2026-09-01' },
          { assessmentId: 'a2', tagId: 't1', score: 2, date: '2026-09-02' },
          { assessmentId: 'a3', tagId: 't1', score: 4, date: '2026-09-09' },
        ],
      };
      seed({ assessments: [loaded('a1'), loaded('a2'), made], scores, config: { calcMethod: 'average' } });
      const onThisDevice = getTagProficiency(CID, 's1', 't1');
      seed({
        assessments: [loaded('a1'), loaded('a2'), { ...made, type: 'formative' }],
        scores,
        config: { calcMethod: 'average' },
      });
      const afterReload = getTagProficiency(CID, 's1', 't1');
      expect(afterReload).toBeCloseTo(8 / 3, 9);
      expect(onThisDevice).toBe(afterReload);
    });
  });

  describe('the growth line and the level read work the same way', () => {
    afterEach(() => delete COURSES[CID]);

    it('ends at the level when categorized work was scored as formative', () => {
      seed({
        categories: [{ id: 'k1', name: 'Labs', weight: 100 }],
        assessments: [
          { id: 'a1', title: 'Lab 1', date: '2026-09-01', tagIds: ['t1'], categoryId: 'k1', type: 'formative' },
          { id: 'a2', title: 'Lab 2', date: '2026-09-08', tagIds: ['t1'], categoryId: 'k1', type: 'summative' },
        ],
        scores: {
          s1: [
            { assessmentId: 'a1', tagId: 't1', score: 2, date: '2026-09-01', type: 'formative' },
            { assessmentId: 'a2', tagId: 't1', score: 4, date: '2026-09-08', type: 'summative' },
          ],
        },
        config: { calcMethod: 'average' },
      });
      const line = getSectionGrowthData(CID, 's1', 'sa');
      expect(getSectionProficiency(CID, 's1', 'sa')).toBe(3);
      expect(line[line.length - 1].prof).toBe(3);
    });
  });
});

describe('competency-descriptors', () => {
  /**
   * A teacher's own wording for a competency's rubric levels
   * (shared/data.js, migrations/20261018_competency_descriptor.sql): kept per
   * teacher, offline-first, written through the outbox, never overwritten by
   * an older server copy while a save is still queued.
   */

  describe('competency descriptors', () => {
    const saved = {};
    beforeEach(() => {
      localStorage.clear();
      _competencyDescriptors = null;
      _competencyDescriptorsLoad = null;
      _useSupabase = false;
      saved.writeRpc = globalThis._writeRpc;
      saved.rpcOrNoop = globalThis._rpcOrNoop;
      saved.getSupabase = globalThis.getSupabase;
    });
    afterEach(() => {
      globalThis._writeRpc = saved.writeRpc;
      globalThis._rpcOrNoop = saved.rpcOrNoop;
      globalThis.getSupabase = saved.getSupabase;
      _useSupabase = false;
    });

    it('keeps wording on this device when not signed in, and forgets an emptied level', async () => {
      await saveCompetencyDescriptors([
        { key: 'k1', level: 4, text: '  Mine  ' },
        { key: 'k1', level: 3, text: 'Also mine' },
        { key: '', level: 2, text: 'no key: ignored' },
        { key: 'k1', level: 7, text: 'bad level: ignored' },
      ]);
      expect(getCompetencyDescriptor('k1')).toEqual({ 4: 'Mine', 3: 'Also mine' });
      _competencyDescriptors = null; // a reload reads localStorage
      expect(getCompetencyDescriptor('k1')).toEqual({ 4: 'Mine', 3: 'Also mine' });
      await saveCompetencyDescriptors([{ key: 'k1', level: 4, text: '' }]);
      expect(getCompetencyDescriptor('k1')).toEqual({ 3: 'Also mine' });
      await saveCompetencyDescriptors([{ key: 'k1', level: 3, text: '' }]);
      expect(getCompetencyDescriptor('k1')).toBe(null);
    });

    it('sends only real changes when signed in', async () => {
      _useSupabase = true;
      const calls = [];
      globalThis._writeRpc = (name, params) => {
        calls.push([name, params]);
        return Promise.resolve({ data: 1, error: null });
      };
      await saveCompetencyDescriptors([{ key: 'k1', level: 4, text: 'Mine' }]);
      await saveCompetencyDescriptors([{ key: 'k1', level: 4, text: 'Mine' }]); // no change
      expect(calls).toEqual([['save_competency_descriptors', { p_entries: [{ key: 'k1', level: 4, text: 'Mine' }] }]]);
    });

    it('loads the server copy once, keeping a save that is still queued', async () => {
      _useSupabase = true;
      globalThis.getSupabase = () => ({});
      let reads = 0;
      globalThis._rpcOrNoop = name => {
        reads++;
        expect(name).toBe('list_competency_descriptors');
        return Promise.resolve({
          data: [
            { competency_key: 'k1', level: 4, text: 'Old server text' },
            { competency_key: 'k2', level: 1, text: 'Server only' },
          ],
          error: null,
        });
      };
      localStorage.setItem(
        'fv-sync-queue-v1',
        JSON.stringify({
          entries: [
            {
              endpoint: 'save_competency_descriptors',
              payload: { p_entries: [{ key: 'k1', level: 4, text: 'Newer, not sent yet' }] },
            },
          ],
        }),
      );
      const bank = await loadCompetencyDescriptors();
      await loadCompetencyDescriptors();
      expect(reads).toBe(1);
      expect(bank).toEqual({ k1: { 4: 'Newer, not sent yet' }, k2: { 1: 'Server only' } });
      expect(JSON.parse(localStorage.getItem('gb-competency-descriptors'))).toEqual(bank);
    });

    it('keeps the stored copy and retries later when the load fails', async () => {
      _useSupabase = true;
      globalThis.getSupabase = () => ({});
      localStorage.setItem('gb-competency-descriptors', JSON.stringify({ k1: { 2: 'Stored' } }));
      globalThis._rpcOrNoop = () => Promise.resolve({ data: null, error: { message: 'offline' } });
      expect(await loadCompetencyDescriptors()).toEqual({ k1: { 2: 'Stored' } });
      expect(_competencyDescriptorsLoad).toBe(null);
    });
  });
});

describe('competency-evidence', () => {
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
    it('names the counts it has, with the right plurals', () => {
      expect(H.countLabel(3, 2)).toBe('3 scores · 2 observations');
      expect(H.countLabel(1, 1)).toBe('1 score · 1 observation');
      expect(H.countLabel(2, 0)).toBe('2 scores');
      expect(H.countLabel(0, 3)).toBe('3 observations');
      expect(H.countLabel(0, 1)).toBe('1 observation');
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
      expect(H.tagObservations(obs, 't1', term).map(o => o.id)).toEqual([
        'in',
        'first-day',
        'last-day',
        'created-only',
      ]);
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

    it('on one day lists the piece made later first, whatever order the scores are stored in', () => {
      const CID = 'merge-order';
      const piece = (id, created) => ({ id, title: id, date: '2026-10-05', tagIds: ['t1'], created });
      COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
      _cache.assessments[CID] = [
        piece('later', '2026-10-01T09:05:00.000Z'),
        piece('first', '2026-10-01T09:00:00.000Z'),
      ];
      _cache.scores[CID] = {};
      _cache.statuses[CID] = {};
      _cache.rubrics[CID] = [];
      _cache.categories[CID] = [];
      clearProfCache();
      try {
        const stored = [sc('first', '2026-10-05', 2), sc('later', '2026-10-05', 3)];
        const rows = H.mergeEvidence(stored, [], CID);
        expect(rows.map(r => r.score.assessmentId)).toEqual(['later', 'first']);
      } finally {
        delete COURSES[CID];
        clearProfCache();
      }
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

    it('follows the report in view, like the level badge: the year to date as of its end', () => {
      setActiveTerm(CID, 1);
      clearProfCache();
      draw();
      expect($('.dash-tag-evidence').textContent).toBe('3 scores · 1 observation');
      expect(rowIds().map(r => r.split(':')[0] + ':' + (r.startsWith('obs') ? r.slice(4) : r.slice(7, 12)))).toEqual([
        'score:Lab 2',
        'obs:o1',
        'score:Lab 1',
        'score:Summe',
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
});

describe('competency-wording', () => {
  /**
   * A competency level's three lines for the hovers (Nov 2 mockup): the level
   * and its descriptor by the printed rubric's rule (the teacher's own, else
   * the bank's, else the BC general wording), what Proficient means as the I
   * Can statements, and the bank cluster's next step below Extending.
   */

  const BANK = {
    ids: { 'bc.sci8.cc.14': 0 },
    levels: [
      [
        'The student is beginning to find patterns and connections in data.',
        'The student finds patterns and connections in data with growing consistency.',
        'The student consistently finds patterns and connections in data.',
        'The student finds patterns and connections in data with depth and complexity.',
      ],
    ],
  };
  const tag = (over = {}) =>
    Object.assign(
      {
        id: 'IP',
        label: 'Identify Patterns',
        bank_id: 'bc.sci8.cc.14',
        i_can_statements: ['I can find patterns in data', ' ', 'I can find connections in data'],
      },
      over,
    );
  const step = lv => {
    const b = window.BANK_COMMENT;
    return b.clusters[b.ids['bc.sci8.cc.14']][lv + 1];
  };

  describe('CompetencyWording', () => {
    afterEach(() => {
      delete window.BANK_PROFICIENCY;
      localStorage.removeItem('gb-competency-descriptors');
      _competencyDescriptors = null;
    });

    it('gives the bank’s descriptor as the level’s name, the I Can statements and the next step', () => {
      window.BANK_PROFICIENCY = BANK;
      const l = CompetencyWording.lines(tag(), 2);
      expect(l.word).toBe('Developing');
      expect(l.descriptor).toBe('Finds patterns and connections in data with growing consistency.');
      expect(l.iCans).toEqual(['I can find patterns in data', 'I can find connections in data']);
      expect(l.next.toLowerCase()).toBe(step(2).toLowerCase() + '.');
      expect(l.ready).toBe(true);
      const html = CompetencyWording.html(l);
      expect(html).toContain('<b>Developing:</b> Finds patterns');
      expect(html).toContain('<b>Proficient means:</b> I can find patterns in data · I can find connections in data');
      expect(html).toContain('<b>Next step:</b> ');
    });

    it('has no next step at Extending', () => {
      window.BANK_PROFICIENCY = BANK;
      expect(CompetencyWording.lines(tag(), 4).next).toBe('');
      expect(CompetencyWording.html(CompetencyWording.lines(tag(), 4))).not.toContain('Next step');
    });

    it('uses the general wording, not ready, until the bank’s wording loads', () => {
      const l = CompetencyWording.lines(tag(), 3);
      expect(l.ready).toBe(false);
      expect(l.descriptor).toBe(
        RubricPrint.GENERAL_LEVELS[3].replace(/^The student /, '').replace(/^./, c => c.toUpperCase()),
      );
    });

    it('lets the teacher’s own wording win, as the printed rubric does', () => {
      window.BANK_PROFICIENCY = BANK;
      const t = tag();
      localStorage.setItem(
        'gb-competency-descriptors',
        JSON.stringify({ [RubricDraft.competencyKey(t)]: { 3: 'finds a trend and names the outlier' } }),
      );
      _competencyDescriptors = null;
      expect(CompetencyWording.lines(t, 3).descriptor).toBe('Finds a trend and names the outlier.');
    });

    it('a competency with no bank id has no next step and is ready at once', () => {
      const l = CompetencyWording.lines(tag({ bank_id: undefined }), 2);
      expect(l.next).toBe('');
      expect(l.ready).toBe(true);
      expect(l.descriptor).toBeTruthy();
    });

    it('escapes its text', () => {
      const l = CompetencyWording.lines(tag({ bank_id: undefined, i_can_statements: ['I can <b>bold</b>'] }), 1);
      expect(CompetencyWording.html(l)).toContain('I can &lt;b&gt;bold&lt;/b&gt;');
    });

    it('reads the bank’s next steps as CommentBank does, and the general wording as print does', () => {
      const b = window.BANK_COMMENT;
      Object.keys(b.ids)
        .slice(0, 400)
        .forEach(id => {
          const e = CommentBank.bankEntry(id);
          [1, 2, 3].forEach(lv => {
            const want = e.steps[['Emerging', 'Developing', 'Proficient'][lv - 1]];
            const got = CompetencyWording.nextStep({ bank_id: id }, lv);
            expect(got.toLowerCase().replace(/\.$/, ''), id + ' ' + lv).toBe(
              String(want).toLowerCase().replace(/\.$/, ''),
            );
          });
        });
      expect(CompetencyWording.GENERAL).toEqual(RubricPrint.GENERAL_LEVELS);
    });

    it('is the rule RubricPrint.levelWording reads', () => {
      window.BANK_PROFICIENCY = BANK;
      [1, 2, 3, 4].forEach(lv => {
        expect(RubricPrint.levelWording(tag(), lv)).toEqual(CompetencyWording.levelWording(tag(), lv));
      });
    });
  });
});
