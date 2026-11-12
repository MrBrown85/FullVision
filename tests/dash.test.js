/**
 * dash: the tests that were tests/dash-*.test.js, one describe
 * block per former file, named after it. Each block keeps its own setup
 * and hooks. Merged 2026-11-11 to cut the file count (CI time).
 */
import './setup.js';
import { parseHTML } from 'linkedom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { runInThisContext } from 'vm';
import { makeFakeSupabase, settle } from './helpers/fake-supabase.js';

describe('dash-card-strip', () => {
  /**
   * The dashboard card's competency strip (dashboard cards plan, part A):
   * labelled chips with codes up to eight columns, thin bars past that, an
   * instant pop-up per segment, "N not assessed" in the footer only when some
   * competency has no scored work, and the focus hook part B's filter uses.
   */

  const CID = 'card-strip';
  const SID = 'stu-1';
  const ST = { id: SID, firstName: 'Noor', lastName: 'Khan' };

  const tag = (id, code, label) => ({ id, code, label: label || id });
  const sec = (id, name, opts = {}) => ({ id, name, tags: [tag(id, opts.code, name)], groupId: opts.groupId });

  function setClass({ sections, groups = [], scores = [], mode = 'proficiency' }) {
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: mode };
    _cache.learningMaps[CID] = {
      subjects: [],
      sections,
      competencyGroups: groups,
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    const tagIds = [...new Set(scores.map(s => s.tagId))];
    _cache.assessments[CID] = scores.map(s => ({ id: s.assessmentId, title: s.assessmentId, tagIds }));
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    clearProfCache();
  }
  const sc = (n, tagId, score) => ({ assessmentId: 'a' + n, tagId, score, date: '2026-09-0' + ((n % 9) + 1) });

  function render(opts) {
    return DashStudentCards.renderStudentCards(CID, [ST], [ST], getSections(CID), getAssessments(CID), {}, {}, opts);
  }
  function dom(html) {
    return parseHTML(
      '<!doctype html><html><body><div id="root">' + html + '</div></body></html>',
    ).document.getElementById('root');
  }

  afterEach(() => delete COURSES[CID]);

  describe('DashInsights.columnCode', () => {
    it("a folder takes its competencies' common letter prefix", () => {
      setClass({
        groups: [{ id: 'g1', name: 'Questioning and Predicting', sortOrder: 0 }],
        sections: [
          sec('QP1', 'Curiosity', { code: 'QP1', groupId: 'g1' }),
          sec('QP2', 'Wonder', { code: 'QP2', groupId: 'g1' }),
        ],
      });
      expect(DashInsights.columnCode(CID, DashInsights.columns(CID)[0])).toBe('QP');
    });

    it('a folder without codes takes the initials of its first two words', () => {
      setClass({
        groups: [{ id: 'g1', name: 'Continuity & Change', sortOrder: 0 }],
        sections: [sec('s1', 'Causes', { groupId: 'g1' }), sec('s2', 'Effects', { code: 'CC2', groupId: 'g1' })],
      });
      expect(DashInsights.columnCode(CID, DashInsights.columns(CID)[0])).toBe('CC');
    });

    it("a section takes its code without digits, else its name's initials", () => {
      setClass({ sections: [sec('PA4', 'Patterns', { code: 'PA4' }), sec('s2', 'Using Evidence Well')] });
      const cols = DashInsights.columns(CID);
      expect(DashInsights.columnCode(CID, cols[0])).toBe('PA');
      expect(DashInsights.columnCode(CID, cols[1])).toBe('UE');
    });
  });

  describe('DashInsights.columnCodes: unique in the class (plan F.3)', () => {
    const CE = [
      'Self-Assessment',
      'Purpose & Community',
      'Public Identity',
      'Collaboration',
      'Perspectives on Work',
      'Workplace Safety',
      'Goal Setting',
      'Curriculum Choices',
      'Networks & Mentors',
      'Career Influences',
      'Career Research',
      'New Experiences',
      'Decision-Making',
    ];
    const shortSec = (id, code, short) => ({
      id,
      name: short + ' (Ministry wording)',
      shortName: short,
      tags: [tag(id, code, short)],
    });

    it('Career Education 8: thirteen "CE" codes become the initials of each short name', () => {
      setClass({ sections: CE.map((short, i) => shortSec('ce' + i, 'CE' + (i + 1), short)) });
      const codes = Object.values(DashInsights.columnCodes(CID));
      expect(codes).toEqual(['SA', 'PC', 'PI', 'COL', 'PW', 'WS', 'GS', 'CC', 'NM', 'CI', 'CR', 'NE', 'DM']);
      expect(new Set(codes).size).toBe(13);
      // columnCode agrees, one column at a time.
      expect(DashInsights.columnCode(CID, DashInsights.columns(CID)[3])).toBe('COL');
    });

    it('Significance and Significance Claims: "SIG, SIG" become SIG and SC; the others keep theirs', () => {
      setClass({
        sections: [
          shortSec('in', 'INQ', 'Inquiry'),
          shortSec('s1', 'SIG1', 'Significance'),
          shortSec('s2', 'SIG2', 'Significance Claims'),
        ],
      });
      expect(Object.values(DashInsights.columnCodes(CID))).toEqual(['INQ', 'SIG', 'SC']);
    });

    it('initials that still collide take the number from their code, else their place', () => {
      setClass({
        sections: [
          shortSec('a', 'CE1', 'Career Research'),
          shortSec('b', 'CE2', 'Career Reflection'),
          shortSec('c', 'XY', 'Alpha'),
          shortSec('d', 'XY', 'Alpha'),
        ],
      });
      expect(Object.values(DashInsights.columnCodes(CID))).toEqual(['CR1', 'CR2', 'ALP3', 'ALP4']);
    });
  });

  describe('the card strip', () => {
    const many = n => Array.from({ length: n }, (_, i) => sec('s' + i, 'Area ' + i, { code: 'AR' + i }));

    it('draws chips with codes at 8 columns and bars at 9', () => {
      setClass({ sections: many(8) });
      let el = dom(render());
      expect(el.querySelector('.dash-card-strip').classList.contains('is-chips')).toBe(true);
      const chips = el.querySelectorAll('.dash-card-strip button.dash-card-seg');
      expect(chips).toHaveLength(8);
      // Eight "AR" codes would collide: each takes its short name's
      // initials instead (Area 0 → A0; plan F.3).
      expect(chips[0].firstChild.textContent).toBe('A0');

      setClass({ sections: many(9) });
      el = dom(render());
      expect(el.querySelector('.dash-card-strip').classList.contains('is-chips')).toBe(false);
      expect(el.querySelectorAll('.dash-card-strip button')).toHaveLength(0);
      const bars = el.querySelectorAll('.dash-card-strip span.dash-card-seg');
      expect(bars).toHaveLength(9);
      expect(bars[0].firstChild.className).toBe('dist-tip');
    });

    it("the flag sits at the footer's bottom left, before the observation line; the name keeps a title", () => {
      setClass({ sections: many(3) });
      const el = dom(render());
      expect(el.querySelector('.dash-card-header .dash-flag-btn')).toBeNull();
      const foot = el.querySelector('.dash-card-footer');
      expect(foot.firstElementChild.classList.contains('dash-flag-btn')).toBe(true);
      expect(foot.firstElementChild.getAttribute('data-action')).toBe('toggleFlag');
      expect(foot.firstElementChild.getAttribute('aria-label')).toBe('Flag student');
      expect(foot.firstElementChild.nextElementSibling.classList.contains('dash-card-obs')).toBe(true);
      expect(el.querySelector('.dash-card-name').getAttribute('title')).toBe('Noor Khan');
    });

    it("the pop-up names the column, the level and word, and a folder's evidence", () => {
      setClass({
        groups: [{ id: 'g1', name: 'Questioning and Predicting', sortOrder: 0 }],
        sections: [
          sec('QP1', 'Curiosity', { code: 'QP1', groupId: 'g1' }),
          sec('QP2', 'Wonder', { code: 'QP2', groupId: 'g1' }),
          sec('EV1', 'Evaluating', { code: 'EV1' }),
        ],
        scores: [sc(1, 'QP1', 3), sc(2, 'QP1', 3)],
      });
      const el = dom(render());
      const [folder, section] = el.querySelectorAll('.dash-card-seg');
      const tipText = chip => [...chip.querySelectorAll('.dist-tip > span')].map(s => s.textContent);
      expect(tipText(folder)).toEqual([
        'Questioning and Predicting',
        formatLevel(CID, 3) + ' Proficient',
        '1 of 2 competencies with evidence',
      ]);
      expect(folder.getAttribute('aria-label')).toBe(
        'Questioning and Predicting: ' + formatLevel(CID, 3) + ' Proficient. 1 of 2 competencies with evidence',
      );
      expect(tipText(section)).toEqual(['Evaluating', 'Not assessed yet']);
      expect(section.classList.contains('is-none')).toBe(true);
      // The click still opens the student page on Competencies.
      expect(folder.closest('[data-student-tab]').dataset.studentTab).toBe('comps');
    });

    it('a Letter class shows the level without a proficiency word', () => {
      setClass({ sections: [sec('EV1', 'Evaluating', { code: 'EV1' })], scores: [sc(1, 'EV1', 3)], mode: 'letter' });
      const tip = dom(render()).querySelector('.dash-card-seg .dist-tip');
      expect(tip.textContent).toBe('Evaluating' + formatLevel(CID, 3));
    });

    it('a folder not counted as one says so last in its tip', () => {
      setClass({
        groups: [{ id: 'g1', name: 'Questioning and Predicting', sortOrder: 0, countsAsOne: false }],
        sections: [
          sec('QP1', 'Curiosity', { code: 'QP1', groupId: 'g1' }),
          sec('QP2', 'Wonder', { code: 'QP2', groupId: 'g1' }),
        ],
        scores: [sc(1, 'QP1', 3)],
      });
      const folder = dom(render()).querySelector('.dash-card-seg');
      const lines = [...folder.querySelectorAll('.dist-tip > span')].map(s => s.textContent);
      expect(lines[lines.length - 1]).toBe('Each competency counts on its own.');
      expect(folder.getAttribute('aria-label')).toMatch(/with evidence\. Each competency counts on its own\.$/);
    });

    it('a chip takes its level class for its colours, with no inline style', () => {
      setClass({
        sections: [
          sec('a', 'Alpha', { code: 'A1' }),
          sec('b', 'Beta', { code: 'B1' }),
          sec('c', 'Gamma', { code: 'C1' }),
        ],
        scores: [sc(1, 'a', 2), sc(2, 'b', 4)],
      });
      const [dev, ext, none] = dom(render()).querySelectorAll('.dash-card-seg');
      expect(dev.classList.contains('lv-2')).toBe(true);
      expect(ext.classList.contains('lv-4')).toBe(true);
      expect(none.classList.contains('is-none')).toBe(true);
      [dev, ext, none].forEach(c => expect(c.hasAttribute('style')).toBe(false));
    });
  });

  describe('the card footer', () => {
    it('shows "N not assessed" only when a competency has no scored work', () => {
      setClass({
        sections: [
          sec('a', 'Alpha', { code: 'A1' }),
          sec('b', 'Beta', { code: 'B1' }),
          sec('c', 'Gamma', { code: 'C1' }),
        ],
        scores: [sc(1, 'a', 3)],
      });
      let el = dom(render());
      const n = el.querySelector('.dash-card-footer .dash-card-unassessed');
      expect(n.textContent).toBe('2 not assessed');
      expect(n.getAttribute('title')).toBe('2 competencies have no scored work yet');
      expect(el.querySelector('.dash-card-meta')).toBeNull();
      expect(el.innerHTML).not.toContain('%&#x2192;');

      setClass({
        sections: [sec('a', 'Alpha', { code: 'A1' }), sec('b', 'Beta', { code: 'B1' })],
        scores: [sc(1, 'a', 3), sc(2, 'b', 2)],
      });
      el = dom(render());
      expect(el.querySelector('.dash-card-unassessed')).toBeNull();
    });
  });

  describe('the focus hook (opts.focusKey)', () => {
    function setTwo(level) {
      setClass({
        sections: [sec('a', 'Alpha', { code: 'A1' }), sec('b', 'Beta', { code: 'B1' })],
        scores: [sc(1, 'a', level), sc(2, 'a', level), sc(3, 'a', level), sc(4, 'b', 4)],
      });
    }

    it('outlines that chip, dims the others and names the level in the footer', () => {
      setTwo(2);
      const el = dom(render({ focusKey: 's:a' }));
      const strip = el.querySelector('.dash-card-strip');
      expect(strip.classList.contains('has-focus')).toBe(true);
      const [a, b] = strip.querySelectorAll('.dash-card-seg');
      expect(a.classList.contains('is-focus')).toBe(true);
      expect(b.classList.contains('is-focus')).toBe(false);
      const focus = el.querySelector('.dash-card-footer .dash-card-focus');
      expect(focus.textContent).toBe('Alpha: Developing');
      expect(focus.getAttribute('style')).toBe('color:var(--score-2-text)');
      expect(el.querySelector('.dash-card-unassessed')).toBeNull();
    });

    it('marks a card below Proficient on that column, under the Needs Attention rule', () => {
      setTwo(2);
      expect(
        dom(render({ focusKey: 's:a' }))
          .querySelector('.dash-card')
          .classList.contains('is-focus-below'),
      ).toBe(true);
      // Fewer than the rule's 3 scores is not enough to count.
      expect(
        dom(render({ focusKey: 's:a', rule: { below: 3, min: 4 } }))
          .querySelector('.dash-card')
          .classList.contains('is-focus-below'),
      ).toBe(false);
      setTwo(3);
      expect(
        dom(render({ focusKey: 's:a' }))
          .querySelector('.dash-card')
          .classList.contains('is-focus-below'),
      ).toBe(false);
    });

    it('does nothing without a key, or with a key the class does not have', () => {
      setTwo(2);
      [render(), render({ focusKey: 's:nope' })].forEach(html => {
        const el = dom(html);
        expect(el.querySelector('.has-focus, .is-focus, .is-focus-below, .dash-card-focus')).toBeNull();
      });
    });
  });
});

describe('dash-card-trend', () => {
  /**
   * The dashboard card's trend arrow (2026-11-01 math audit). It averaged raw
   * score entries, so points work counted as its points: a student going from
   * 5/10 and 6/10 (Developing) to two Proficient levels read as dropping from
   * 5.5 to 3. It now reads competency evidence as calc.js counts it.
   * Since Nov 5 it sits in the header, right after the grade badge.
   */

  const CID = 'card-trend';
  const SID = 'stu-1';
  const UP = '&#x2191;';
  const DOWN = '&#x2193;';

  function card(assessments, scores, statuses = {}) {
    COURSES[CID] = { id: CID, name: 'Science 8', gradingSystem: 'proficiency' };
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [{ id: 'sec', name: 'Inquiry', tags: [{ id: 't1', label: 'Inquiry' }] }],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    _cache.assessments[CID] = assessments;
    _cache.scores[CID] = { [SID]: scores };
    _cache.statuses[CID] = statuses;
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    clearProfCache();
    const st = { id: SID, firstName: 'Noor', lastName: 'Khan' };
    return DashStudentCards.renderStudentCards(CID, [st], [st], getSections(CID), assessments, getScores(CID), {});
  }
  const pts = id => ({ id, title: id, scoreMode: 'points', maxPoints: 10, tagIds: ['t1'] });
  const lvl = id => ({ id, title: id, tagIds: ['t1'] });
  const sc = (aid, score, date) => ({ assessmentId: aid, tagId: 't1', score, date });

  // The header's markup from the grade badge to the flag.
  function afterBadge(html) {
    const header = html.slice(html.indexOf('dash-card-header'), html.indexOf('dash-card-strip'));
    return header.slice(header.indexOf('dash-card-badge'));
  }

  describe('dashboard card trend', () => {
    afterEach(() => delete COURSES[CID]);

    it('reads points work as its level', () => {
      const html = card(
        [pts('a'), pts('b'), lvl('c'), lvl('d')],
        [sc('a', 5, '2026-09-01'), sc('b', 6, '2026-09-08'), sc('c', 3, '2026-09-15'), sc('d', 3, '2026-09-22')],
      );
      expect(html).toContain(UP);
      expect(html).not.toContain(DOWN);
    });

    it('leaves Excused work out', () => {
      const html = card(
        [lvl('a'), lvl('b'), lvl('c'), lvl('d'), lvl('e')],
        [
          sc('a', 2, '2026-09-01'),
          sc('b', 2, '2026-09-08'),
          sc('c', 3, '2026-09-15'),
          sc('d', 3, '2026-09-22'),
          sc('e', 1, '2026-09-29'),
        ],
        { [SID + ':e']: 'EXC' },
      );
      expect(html).toContain(UP);
    });

    it('sits right after the grade badge, the last thing in the header, with what it means', () => {
      const html = card(
        [lvl('a'), lvl('b'), lvl('c'), lvl('d')],
        [sc('a', 2, '2026-09-01'), sc('b', 2, '2026-09-08'), sc('c', 3, '2026-09-15'), sc('d', 3, '2026-09-22')],
      );
      const head = afterBadge(html);
      const trendAt = head.indexOf('dash-card-trend');
      expect(trendAt).toBeGreaterThan(0);
      // The header keeps the avatar, the name, the grade and the trend; the
      // flag and missing work are in the footer (plan F.6).
      expect(head).not.toContain('dash-flag-btn');
      expect(head).not.toContain('dash-card-missing');
      // Nothing else between the badge and the arrow.
      expect(head.slice(head.indexOf('</span>'), trendAt)).not.toMatch(/dash-card-missing/);
      expect(head).toContain('aria-label="Rising: later work scores higher than earlier work"');
      expect(head).toContain(UP);
      // Not in the strip or the footer any more.
      expect(html.slice(html.indexOf('dash-card-strip'))).not.toContain('dash-card-trend');
    });

    it('reads Falling and Steady', () => {
      const down = card(
        [lvl('a'), lvl('b'), lvl('c'), lvl('d')],
        [sc('a', 4, '2026-09-01'), sc('b', 4, '2026-09-08'), sc('c', 2, '2026-09-15'), sc('d', 2, '2026-09-22')],
      );
      expect(afterBadge(down)).toContain('title="Falling: later work scores lower than earlier work"');
      const flat = card([lvl('a')], [sc('a', 3, '2026-09-01')]);
      expect(afterBadge(flat)).toContain('aria-label="Steady"');
    });
  });
});

describe('dash-class-manager-active-course-handoff', () => {
  /**
   * The class manager must hand a course switch back to the parent page.
   *
   * page-dashboard keeps its own activeCourse for rendering and re-injects it
   * into the manager on every configure(). The manager can change the active
   * course while it is open — finishing the create wizard, or archiving the class
   * that was active — but it only mutated its own copy, so the parent stayed on
   * the previous class and pushed that stale id back on the next configure().
   *
   * The switch is deferred to close rather than announced immediately: the parent
   * responds by resetting manager state, which would tear down the panel the
   * teacher is still working in.
   */

  const A = 'course-a';
  const B = 'course-b';

  function stubEl(dataset) {
    return { dataset: dataset };
  }

  describe('class manager — active course handoff', () => {
    var switched;
    var rendered;
    var originalGetElementById;
    var originalAlert;

    function configureWith(activeCourse) {
      DashClassManager.configure({
        activeCourse: activeCourse,
        onRender: function () {
          rendered += 1;
        },
        onCourseChange: function (cid) {
          switched.push(cid);
        },
      });
    }

    beforeEach(() => {
      localStorage.clear();
      ['students', 'courseConfigs', 'learningMaps'].forEach(function (field) {
        if (_cache[field]) _cache[field] = {};
      });
      _cache.config = {};
      saveCourses({
        [A]: { id: A, name: 'Course A' },
        [B]: { id: B, name: 'Course B' },
      });
      switched = [];
      rendered = 0;
      originalGetElementById = document.getElementById;
      originalAlert = globalThis.alert;
      globalThis.alert = function () {};

      configureWith(A);
      DashClassManager.openClassManager();
    });

    afterEach(() => {
      document.getElementById = originalGetElementById;
      globalThis.alert = originalAlert;
      DashClassManager.resetState();
    });

    it('closing with nothing changed renders in place, without a course switch', () => {
      DashClassManager.handleAction('closeClassManager', stubEl({}));

      expect(switched).toEqual([]);
      expect(rendered).toBe(1);
    });

    it('hands the newly created class to the parent on close', async () => {
      // Drive the real wizard: name the class, then finish it.
      DashClassManager.handleAction('cmStartCreate', stubEl({}));
      document.getElementById = function (id) {
        if (id === 'cm-new-name') return { value: 'Humanities 8' };
        return originalGetElementById(id);
      };
      DashClassManager.handleAction('cwGoToStep3', stubEl({}));
      document.getElementById = originalGetElementById;

      await DashClassManager.handleAction('cwFinishCreate', stubEl({}));

      var created = Object.keys(COURSES).find(function (cid) {
        return COURSES[cid].name === 'Humanities 8';
      });
      expect(created).toBeTruthy();

      DashClassManager.handleAction('closeClassManager', stubEl({}));

      expect(switched).toEqual([created]);
    });

    it('hands the next class to the parent when the active one is archived', () => {
      DashClassManager.handleAction('cmToggleArchive', stubEl({ cid: A }));

      DashClassManager.handleAction('closeClassManager', stubEl({}));

      expect(switched).toEqual([B]);
    });

    it('drops a pending handoff once the parent reports the same course itself', () => {
      DashClassManager.handleAction('cmToggleArchive', stubEl({ cid: A }));
      // The parent switched on its own and is telling us where it landed.
      configureWith(B);

      DashClassManager.handleAction('closeClassManager', stubEl({}));

      expect(switched).toEqual([]);
      expect(rendered).toBe(1);
    });
  });
});

describe('dash-class-manager-backup', () => {
  /**
   * Class manager — Download Class Backup.
   *
   * The backup file carries each competency's I Can statements, curriculum
   * wording (source_text) and bank id, so a restore through
   * import_json_restore (migrations/20261102_import_json_restore_tag_fields.sql)
   * gets them back.
   */

  const CID = 'b0000000-0000-4000-8000-000000000001';
  const SUBJ = 'b0000000-0000-4000-8000-000000000002';
  const SEC = 'b0000000-0000-4000-8000-000000000003';
  const T1 = 'b0000000-0000-4000-8000-000000000004';
  const T2 = 'b0000000-0000-4000-8000-000000000005';

  /* The learning map as get_class_bundle sends it. */
  const serverMap = {
    subjects: [
      {
        id: SUBJ,
        name: 'Science',
        display_order: 0,
        sections: [
          {
            id: SEC,
            name: 'Questioning and Predicting',
            display_order: 0,
            tags: [
              {
                id: T1,
                code: 'QP1',
                label: 'Ask questions',
                i_can_text: 'I can ask questions\nI can make predictions',
                i_can_statements: ['I can ask questions', 'I can make predictions'],
                source_text: 'Demonstrate a sustained intellectual curiosity about a scientific topic',
                bank_id: 'bc.sci8.cc.1',
                display_order: 0,
              },
              { id: T2, code: 'QP2', label: 'Hand-made', i_can_text: '', display_order: 1 },
            ],
          },
        ],
      },
    ],
  };

  describe('class manager — download class backup', () => {
    var written;
    var originalBlob;
    var originalCreateObjectURL;
    var originalCreateElement;
    var link;

    beforeEach(() => {
      localStorage.clear();
      saveCourses({ [CID]: { id: CID, name: 'Science 8', gradingSystem: 'proficiency' } });
      _persistLoadedField(CID, 'learningMaps', _canonicalLearningMapToCache(CID, serverMap));
      written = null;
      originalBlob = globalThis.Blob;
      originalCreateObjectURL = URL.createObjectURL;
      globalThis.Blob = function (parts) {
        written = parts.join('');
      };
      URL.createObjectURL = () => 'blob:backup';
      originalCreateElement = document.createElement;
      link = { click: vi.fn() };
      document.createElement = () => link;
    });

    afterEach(() => {
      globalThis.Blob = originalBlob;
      URL.createObjectURL = originalCreateObjectURL;
      document.createElement = originalCreateElement;
    });

    it('keeps I Can statements, curriculum wording and bank ids', () => {
      DashClassManager.handleAction('cmDownloadBackup', { dataset: { cid: CID } });
      expect(link.click).toHaveBeenCalledTimes(1);
      expect(link.download).toMatch(/^gradebook-b0000000-.*\.json$/);

      const backup = JSON.parse(written);
      const tags = backup.learningMap.sections.flatMap(s => s.tags);
      const byId = Object.fromEntries(tags.map(t => [t.id, t]));
      expect(byId[T1]).toMatchObject({
        i_can_statements: ['I can ask questions', 'I can make predictions'],
        source_text: 'Demonstrate a sustained intellectual curiosity about a scientific topic',
        bank_id: 'bc.sci8.cc.1',
      });
      // A hand-made competency has none, and says so rather than dropping the keys.
      expect(byId[T2]).toMatchObject({ i_can_statements: [], source_text: null, bank_id: null });
    });
  });
});

describe('dash-class-manager-delete-course', () => {
  /**
   * Class manager — delete an archived class.
   *
   * Delete is offered only on archived classes, so a class leaves every class
   * menu before it can go. delete_course soft-deletes it and the daily retention
   * job erases it 30 days later.
   */

  const A = 'course-a';
  const B = 'course-b';

  function stubEl(dataset) {
    return { dataset: dataset };
  }

  describe('class manager — delete archived class', () => {
    var originalConfirm;
    var confirmed;
    var switched;

    beforeEach(() => {
      localStorage.clear();
      _cache.config = {};
      saveCourses({
        [A]: { id: A, name: 'Course A' },
        [B]: { id: B, name: 'Course B', archived: true },
      });
      switched = [];
      confirmed = null;
      originalConfirm = globalThis.showConfirm;
      globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
        confirmed = onConfirm;
      };

      DashClassManager.configure({
        activeCourse: A,
        onRender: function () {},
        onCourseChange: function (cid) {
          switched.push(cid);
        },
      });
      DashClassManager.openClassManager();
    });

    afterEach(() => {
      globalThis.showConfirm = originalConfirm;
      DashClassManager.resetState();
    });

    it('deletes an archived class once the teacher confirms', async () => {
      DashClassManager.handleAction('cmDeleteCourse', stubEl({ cid: B }));
      expect(COURSES[B]).toBeTruthy();

      await confirmed();

      expect(COURSES[B]).toBeUndefined();
      expect(COURSES[A]).toBeTruthy();
    });

    it('refuses to delete a class that is not archived', () => {
      DashClassManager.handleAction('cmDeleteCourse', stubEl({ cid: A }));

      expect(confirmed).toBeNull();
      expect(COURSES[A]).toBeTruthy();
    });

    it('leaves the active class alone when another class is deleted', async () => {
      DashClassManager.handleAction('cmDeleteCourse', stubEl({ cid: B }));
      await confirmed();

      DashClassManager.handleAction('closeClassManager', stubEl({}));

      expect(switched).toEqual([]);
    });
  });
});

describe('dash-class-manager-duplicate-course', () => {
  /**
   * Class manager — Duplicate Class.
   *
   * The copy gets the class settings, the learning map, sentence starters and
   * the categories with their weights, all as new rows. Reporting terms stay
   * behind: their dates belong to one school year (docs/DECISIONS.md,
   * Reporting periods 6). Signed in, the categories wait for the new class's
   * server id and then go up through save_categories.
   */

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runInThisContext(readFileSync(resolve(root, 'shared/offline-queue.js'), 'utf-8'), {
    filename: 'shared/offline-queue.js',
  });

  const SRC = '11111111-1111-4111-8111-111111111111';
  const NEW_CID = '55555555-5555-4555-8555-555555555555';
  const LAB = '66666666-6666-4666-8666-000000000001';
  const TEST = '66666666-6666-4666-8666-000000000002';

  const TERMS = [
    { ordinal: 1, label: 'Term 1', starts_on: '2026-09-02', ends_on: '2026-11-20' },
    { ordinal: 2, label: 'Term 2', starts_on: '2026-11-23', ends_on: '2027-01-30' },
  ];

  function stubEl(dataset) {
    return { dataset: dataset };
  }

  /* Duplicate Class asks for the new class's block in a dialog (covered in
   e2e/class-block.spec.js), then runs this copy step. */
  function duplicate(block) {
    DashClassManager.duplicateCourse(SRC, block || '');
  }

  function newCid() {
    return Object.keys(COURSES).find(id => id !== SRC);
  }

  function seedSource() {
    saveCourses({
      [SRC]: { id: SRC, name: 'Science 8', gradingSystem: 'both', calcMethod: 'decayingAvg', decayWeight: 0.7 },
    });
    _cache.courseConfigs[SRC] = {
      calcMethod: 'decayingAvg',
      decayWeight: 0.7,
      roundPercent: false,
      reportingTerms: TERMS,
    };
    // Stored out of order: the copy follows displayOrder.
    _cache.categories[SRC] = [
      { id: TEST, name: 'Tests', weight: 60, displayOrder: 1, calcMode: 'percent' },
      { id: LAB, name: 'Labs', weight: 40, displayOrder: 0 },
    ];
  }

  describe('class manager — duplicate class', () => {
    var fake;
    var originalGetSupabase;
    var originalUseSupabase;

    beforeEach(() => {
      localStorage.clear();
      Object.keys(_cache).forEach(function (field) {
        if (_cache[field] && typeof _cache[field] === 'object' && field !== 'courses' && field !== 'config') {
          _cache[field] = {};
        }
      });
      _categorySaveQueue = {};
      _serverState = {};
      _idRekeys = {};
      _idmapCache = null;
      _idmapRaw = null;
      _pendingLocalCids.clear();
      originalGetSupabase = globalThis.getSupabase;
      originalUseSupabase = _useSupabase;
      _useSupabase = false;
      window.v2Queue.clear();
      seedSource();
      DashClassManager.configure({ activeCourse: SRC, onRender: function () {}, onCourseChange: function () {} });
      DashClassManager.openClassManager();
    });

    afterEach(() => {
      DashClassManager.resetState();
      globalThis.getSupabase = originalGetSupabase;
      _useSupabase = originalUseSupabase;
      window.v2Queue.clear();
    });

    it('copies categories as new rows in order and leaves reporting terms behind', () => {
      duplicate();
      const cid = newCid();
      expect(COURSES[cid].name).toBe('Science 8 (Copy)');

      const cats = getCategories(cid);
      expect(cats.map(c => [c.name, c.weight, c.displayOrder])).toEqual([
        ['Labs', 40, 0],
        ['Tests', 60, 1],
      ]);
      expect(cats.map(c => c.id)).not.toContain(LAB);
      expect(cats.map(c => c.id)).not.toContain(TEST);

      const cc = getCourseConfig(cid);
      expect(cc).toMatchObject({ calcMethod: 'decayingAvg', decayWeight: 0.7, roundPercent: false });
      expect(cc.reportingTerms).toBeUndefined();
      expect(getReportingTerms(cid)).toEqual([]);

      // The source class is untouched.
      expect(getCategories(SRC).map(c => c.id)).toEqual([TEST, LAB]);
      expect(getCourseConfig(SRC).reportingTerms).toEqual(TERMS);
    });

    it('with a block chosen, keeps the class name and sets the block', () => {
      duplicate('B');
      const cid = newCid();
      expect(COURSES[cid].name).toBe('Science 8');
      expect(COURSES[cid].block).toBe('B');
      expect(courseDisplayName(COURSES[cid])).toBe('Block B \u00B7 Science 8');
    });

    it('copies nothing into categories when the source has none', () => {
      _cache.categories[SRC] = [];
      duplicate();
      expect(getCategories(newCid())).toEqual([]);
    });

    it('signed in, sends the categories with the new class id once it lands, and no terms', async () => {
      fake = makeFakeSupabase();
      fake.on('create_course', () => ({ data: NEW_CID, error: null }));
      globalThis.getSupabase = () => fake;
      _useSupabase = true;
      _supabaseDegraded = false;
      _teacherId = 'teacher-uuid';
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true });

      duplicate();
      await settle();

      const saves = fake.committed.filter(c => c.name === 'save_categories');
      expect(saves).toHaveLength(1);
      expect(saves[0].params.p_course_id).toBe(NEW_CID);
      expect(saves[0].params.p_categories).toEqual([
        { name: 'Labs', weight: 40, calc_mode: 'points' },
        { name: 'Tests', weight: 60, calc_mode: 'percent' },
      ]);

      // Re-keyed to the server's ids under the new class.
      const cats = getCategories(NEW_CID);
      expect(cats).toHaveLength(2);
      cats.forEach(c => expect(c.id).toMatch(/^aaaaaaaa-/));

      const patches = fake.calls.filter(c => c.name === 'update_course' && c.params.p_course_id === NEW_CID);
      expect(patches.length).toBeGreaterThan(0);
      patches.forEach(p => expect(p.params.p_patch).not.toHaveProperty('reporting_terms'));
      // Nothing is written to the source class.
      expect(fake.calls.filter(c => c.params.p_course_id === SRC && !/^list_/.test(c.name))).toEqual([]);
    });
  });
});

describe('dash-class-manager-remove-student', () => {
  /**
   * Class manager roster — the X button withdraws the student it is next to.
   *
   * The roster is rendered for cmSelectedCourse, but the remove action once
   * looked the student up in _activeCourse. Those diverge whenever the
   * manager's selection moves on its own (cmSelectClass), or when
   * page-dashboard re-injects its own activeCourse through CM.configure. The
   * lookup then searched the wrong course, found nothing, and returned — so the
   * X button silently did nothing.
   *
   * Removing a student withdraws them (docs/DECISIONS.md, "Students are
   * removed by withdrawal, not deletion"): the Withdrawn list under the roster
   * has Re-enrol and the permanent delete, the second step.
   */

  const A = 'course-a';
  const B = 'course-b';

  function student(id, first, last) {
    return { id: id, firstName: first, lastName: last, designations: [], sortName: last + ' ' + first };
  }

  function stubEl(dataset) {
    return { dataset: dataset };
  }

  function ids(cid) {
    return getStudents(cid).map(function (s) {
      return s.id;
    });
  }

  function withdrawnIds(cid) {
    return getWithdrawnStudents(cid).map(function (w) {
      return w.student.id;
    });
  }

  describe('class manager — remove student', () => {
    var originalConfirm;
    var originalToast;
    var confirms;
    var main;
    var originalGetElementById;

    // The page Class Settings last rendered (the test document is a stub).
    function page() {
      return main.innerHTML;
    }

    beforeEach(() => {
      localStorage.clear();
      [
        'students',
        'scores',
        'goals',
        'reflections',
        'notes',
        'flags',
        'statuses',
        'observations',
        'termRatings',
        'overrides',
        'studentProfileSummaries',
        'withdrawn',
        'assessments',
      ].forEach(function (field) {
        if (_cache[field]) _cache[field] = {};
      });
      _cache.config = {};
      main = { innerHTML: '' };
      originalGetElementById = document.getElementById;
      document.getElementById = function (id) {
        return id === 'main' ? main : originalGetElementById(id);
      };
      saveCourses({
        [A]: { id: A, name: 'Course A' },
        [B]: { id: B, name: 'Course B' },
      });
      saveStudents(A, [student('a1', 'Amara', 'Osei'), student('a2', 'Bo', 'Tran')]);
      saveStudents(B, [student('b1', 'Cass', 'Lund'), student('b2', 'Dev', 'Rao')]);

      originalConfirm = globalThis.showConfirm;
      originalToast = globalThis.showUndoToast;
      confirms = [];
      // Auto-accept the confirm dialog and swallow the undo toast.
      globalThis.showConfirm = function (title, message, okLabel, okStyle, onConfirm) {
        confirms.push({ title: title, message: message, okLabel: okLabel, okStyle: okStyle });
        onConfirm();
      };
      globalThis.showUndoToast = function () {};

      DashClassManager.configure({ activeCourse: A, onRender: function () {}, onCourseChange: function () {} });
      DashClassManager.openClassManager();
    });

    afterEach(() => {
      globalThis.showConfirm = originalConfirm;
      globalThis.showUndoToast = originalToast;
      DashClassManager.resetState();
      document.getElementById = originalGetElementById;
    });

    it('withdraws the student when the manager shows the dashboard active course', () => {
      DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

      expect(ids(A)).toEqual(['a2']);
      expect(withdrawnIds(A)).toEqual(['a1']);
    });

    it('withdraws from the selected class when it is not the active course', () => {
      // The manager's selection moves; _activeCourse stays on A. This is the
      // divergence that made the button a no-op.
      DashClassManager.handleAction('cmSelectClass', stubEl({ cid: B }));

      DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'b1' }));

      expect(ids(B)).toEqual(['b2']);
      expect(withdrawnIds(B)).toEqual(['b1']);
    });

    it('does not touch the active course when withdrawing from another class', () => {
      DashClassManager.handleAction('cmSelectClass', stubEl({ cid: B }));

      DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'b1' }));

      expect(ids(A)).toEqual(['a1', 'a2']);
      expect(withdrawnIds(A)).toEqual([]);
    });

    it('ignores a student id that is not in the selected class', () => {
      DashClassManager.handleAction('cmSelectClass', stubEl({ cid: B }));

      DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

      expect(ids(A)).toEqual(['a1', 'a2']);
      expect(ids(B)).toEqual(['b1', 'b2']);
    });

    it('says what withdrawing keeps, and never that it cannot be undone', () => {
      DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

      expect(confirms).toHaveLength(1);
      expect(confirms[0].title).toBe('Withdraw student');
      expect(confirms[0].okLabel).toBe('Withdraw');
      expect(confirms[0].okStyle).not.toBe('danger');
      expect(confirms[0].message).toContain('kept');
      expect(confirms[0].message).toContain('re-enrol');
      expect(confirms[0].message).not.toMatch(/cannot be undone/i);
    });

    it('keeps every record out of the class while withdrawn', () => {
      _saveCourseField('scores', A, {
        a1: [{ id: 'sc1', assessmentId: 'x', tagId: 't', score: 3 }],
        a2: [{ id: 'sc2', assessmentId: 'x', tagId: 't', score: 4 }],
      });
      _saveCourseField('observations', A, { a1: [{ id: 'ob1', text: 'Helped a classmate' }] });
      _saveCourseField('statuses', A, { 'a1:x': 'LATE', 'a2:x': 'NS' });

      DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

      expect(Object.keys(getScores(A))).toEqual(['a2']);
      expect(getQuickObs(A).a1).toBeUndefined();
      expect(getAssignmentStatuses(A)).toEqual({ 'a2:x': 'NS' });
      var entry = getWithdrawnStudents(A)[0];
      expect(entry.records.scores).toHaveLength(1);
      expect(entry.records.observations).toHaveLength(1);
      expect(entry.records.statuses).toEqual({ 'a1:x': 'LATE' });
    });

    it('Undo re-enrols the student with every record', () => {
      var undo = null;
      globalThis.showUndoToast = function (message, undoFn) {
        undo = undoFn;
      };
      _saveCourseField('scores', A, { a1: [{ id: 'sc1', assessmentId: 'x', tagId: 't', score: 3 }] });
      _saveCourseField('goals', A, { a1: { s1: 'Read more' } });
      _saveCourseField('reflections', A, { a1: { s1: { confidence: 3, text: '' } } });
      _saveCourseField('notes', A, { a1: 'Met with parent' });
      _saveCourseField('statuses', A, { 'a1:x': 'LATE' });
      _saveCourseField('observations', A, { a1: [{ id: 'ob1', text: 'Helped a classmate' }] });
      _saveCourseField('termRatings', A, { a1: { 1: { dims: {}, narrative: 'Term 1' } } });

      DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));
      expect(ids(A)).toEqual(['a2']);

      undo();

      expect(ids(A)).toEqual(['a1', 'a2']);
      expect(withdrawnIds(A)).toEqual([]);
      expect(getScores(A).a1).toHaveLength(1);
      expect(getGoals(A).a1).toEqual({ s1: 'Read more' });
      expect(getReflections(A).a1).toBeDefined();
      expect(getNotes(A).a1).toBe('Met with parent');
      expect(getAssignmentStatuses(A)['a1:x']).toBe('LATE');
      expect(getQuickObs(A).a1).toHaveLength(1);
      expect(getTermRatings(A).a1).toBeDefined();
    });

    it('lists withdrawn students under the roster with Re-enrol and Delete permanently', () => {
      DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));
      // The roster and the Withdrawn list live on the Students tab.
      DashClassManager.handleAction('cmSetTab', stubEl({ tab: 'students' }));

      var html = page();
      var section = html.slice(html.indexOf('id="cm-withdrawn"'));
      expect(html).toContain('id="cm-withdrawn"');
      expect(section).toContain('Withdrawn <span class="cm-section-count">(1)</span>');
      expect(section).toContain('data-withdrawn-sid="a1"');
      expect(section).toContain('Amara Osei');
      expect(section).toContain('data-action="cmReenrolStudent" data-sid="a1">Re-enrol</button>');
      expect(section).toContain('data-action="cmDeleteWithdrawn" data-sid="a1">Delete Permanently\u2026</button>');
      // The roster no longer shows them.
      expect(html).not.toContain('data-action="cmRemoveStudent" data-sid="a1"');
      expect(html).toContain('data-action="cmRemoveStudent" data-sid="a2"');
    });

    it('shows no Withdrawn list when nobody is withdrawn', () => {
      DashClassManager.handleAction('cmSelectClass', stubEl({ cid: A }));
      expect(page()).not.toContain('id="cm-withdrawn"');
    });

    it('Re-enrol puts the student back on the roster where they were', () => {
      _saveCourseField('scores', A, { a1: [{ id: 'sc1', assessmentId: 'x', tagId: 't', score: 3 }] });
      DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));

      DashClassManager.handleAction('cmReenrolStudent', stubEl({ sid: 'a1' }));

      expect(ids(A)).toEqual(['a1', 'a2']);
      expect(getScores(A).a1).toHaveLength(1);
      expect(page()).not.toContain('id="cm-withdrawn"');
    });

    it('Delete permanently asks first, warns it cannot be undone, and offers no Undo', () => {
      var toasts = 0;
      _saveCourseField('scores', A, { a1: [{ id: 'sc1', assessmentId: 'x', tagId: 't', score: 3 }] });
      DashClassManager.handleAction('cmRemoveStudent', stubEl({ sid: 'a1' }));
      globalThis.showUndoToast = function () {
        toasts++;
      };

      DashClassManager.handleAction('cmDeleteWithdrawn', stubEl({ sid: 'a1' }));

      var c = confirms[confirms.length - 1];
      expect(c.title).toBe('Delete Amara Osei Permanently?');
      expect(c.okLabel).toBe('Delete Permanently');
      expect(c.okStyle).toBe('danger');
      expect(c.message).toMatch(/cannot be undone/);
      expect(toasts).toBe(0);
      expect(withdrawnIds(A)).toEqual([]);
      expect(ids(A)).toEqual(['a2']);
      expect(getScores(A).a1).toBeUndefined();
      expect(page()).not.toContain('id="cm-withdrawn"');
    });

    it('offers no permanent delete for a student still on the roster', () => {
      DashClassManager.handleAction('cmDeleteWithdrawn', stubEl({ sid: 'a1' }));

      expect(confirms).toHaveLength(0);
      expect(ids(A)).toEqual(['a1', 'a2']);
    });
  });
});

describe('dash-comp-views', () => {
  /**
   * The dashboard's Curricular Competencies card (docs/plans/dashboard-cards-plan.md,
   * part B): four views (Class Average, Level Mix, Needs Support, Change) in
   * both grading styles, the default view per style and the remembered pick,
   * and the page's competency filter (the bar above the students, the cards
   * weakest first on the picked competency). competencyMonthlyAverages in
   * shared/calc.js gives the Change view its months.
   */

  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const CID = 'comp-views';
  const TODAY = '2026-11-15';
  const STUDENTS = [
    { id: 's1', firstName: 'Ava', lastName: 'Chan' },
    { id: 's2', firstName: 'Ben', lastName: 'Diaz' },
    { id: 's3', firstName: 'Cy', lastName: 'Eng' },
  ];
  const IDS = STUDENTS.map(s => s.id);
  const sec = (id, name, code) => ({ id, name, shortName: name, tags: [{ id, code, label: name }] });

  let n = 0;
  const sc = (tagId, score, date) => ({ assessmentId: 'a' + ++n, tagId, score, date });

  /* Inquiry (IN): Ava 2s (Developing), Ben 3s, Cy 4s. Evidence (EV): Ava 1s,
   Ben 2s, Cy not scored. Three scores each, so the rule (below Proficient,
   at least 3 scores) catches Ava on both and Ben on Evidence. */
  function setClass(mode) {
    n = 0;
    COURSES[CID] = { id: CID, name: 'Socials 9', gradingSystem: mode };
    _cache.students[CID] = STUDENTS;
    _cache.learningMaps[CID] = {
      subjects: [],
      sections: [sec('IN', 'Inquiry', 'IN1'), sec('EV', 'Evidence', 'EV1')],
      competencyGroups: [],
      _customized: true,
      _version: 1,
    };
    _cache.categories[CID] = [];
    const scores = {
      s1: [
        sc('IN', 2, '2026-09-05'),
        sc('IN', 2, '2026-09-20'),
        sc('IN', 2, '2026-11-03'),
        sc('EV', 1, '2026-09-08'),
        sc('EV', 1, '2026-10-08'),
        sc('EV', 1, '2026-11-08'),
      ],
      s2: [
        sc('IN', 3, '2026-09-10'),
        sc('IN', 3, '2026-11-10'),
        sc('IN', 3, '2026-11-12'),
        sc('EV', 2, '2026-09-11'),
        sc('EV', 2, '2026-09-12'),
        sc('EV', 2, '2026-09-13'),
      ],
      s3: [sc('IN', 4, '2026-09-01'), sc('IN', 4, '2026-11-01'), sc('IN', 4, '2026-11-02')],
    };
    _cache.scores[CID] = scores;
    _cache.assessments[CID] = Object.values(scores)
      .flat()
      .map(s => ({ id: s.assessmentId, title: s.assessmentId, date: s.date, tagIds: [s.tagId] }));
    _cache.statuses[CID] = {};
    _cache.rubrics[CID] = [];
    _cache.overrides[CID] = {};
    _cache.observations[CID] = {};
    _cache.courseConfigs[CID] = { calcMethod: 'average' };
    clearProfCache();
  }

  function card(extra) {
    return DashOverview.competenciesCardHtml(
      Object.assign(
        { cid: CID, allStudents: STUDENTS, assessments: [], tagsWithEvidence: 2, allTags: [1, 2], todayStr: TODAY },
        extra || {},
      ),
    );
  }
  function dom(html) {
    return parseHTML(
      '<!doctype html><html><body><div id="root">' + html + '</div></body></html>',
    ).document.getElementById('root');
  }
  const texts = (el, sel) => Array.from(el.querySelectorAll(sel)).map(x => x.textContent);

  afterEach(() => {
    delete COURSES[CID];
  });

  describe('the default view', () => {
    it('is Class Average in a Letter class and Level Mix in a Proficiency or Both class', () => {
      setClass('letter');
      expect(DashOverview.compView(CID, null)).toBe('avg');
      setClass('proficiency');
      expect(DashOverview.compView(CID, null)).toBe('mix');
      setClass('both');
      expect(DashOverview.compView(CID, undefined)).toBe('mix');
    });

    it('a saved view wins; anything else falls back', () => {
      setClass('letter');
      expect(DashOverview.compView(CID, 'trend')).toBe('trend');
      expect(DashOverview.compView(CID, 'nope')).toBe('avg');
    });
  });

  describe('the views', () => {
    for (const mode of ['letter', 'proficiency']) {
      describe(mode + ' class', () => {
        beforeEach(() => setClass(mode));

        it('draws the view menu with four views and the one in use', () => {
          const el = dom(card({ compView: 'below' }));
          expect(el.querySelector('#dash-view-btn-comp').textContent).toBe('Needs Support');
          expect(texts(el, '#dash-view-menu-comp .dash-view-name')).toEqual([
            'Class Average',
            'Level Mix',
            'Needs Support',
            'Change',
          ]);
          expect(el.querySelector('.dash-comp-card').getAttribute('data-view')).toBe('below');
        });

        it('Class Average: a bar and the average as the class shows it', () => {
          const el = dom(card({ compView: 'avg' }));
          expect(texts(el, '.dash-comp-labels span')).toEqual(['Competency', '', 'Average']);
          const vals = texts(el, '.dash-comp-row .dash-comp-val');
          expect(vals).toEqual([formatLevel(CID, 3), formatLevel(CID, 1.5)]);
          expect(vals[0]).toBe(mode === 'letter' ? '75%' : '3.0');
          const row = el.querySelector('.dash-comp-row');
          expect(row.tagName).toBe('BUTTON');
          expect(row.getAttribute('data-action')).toBe('naComp');
          expect(row.getAttribute('data-key')).toBe('s:IN');
          expect(row.getAttribute('aria-pressed')).toBe('false');
        });

        it('Level Mix: a count per level in the class order, the largest bold, "k of n" Proficient or above', () => {
          const el = dom(card({ compView: 'mix' }));
          expect(texts(el, '.dash-comp-lv-long')).toEqual(['EXT', 'PRF', 'DEV', 'EMG']);
          // On a narrow card one letter each (dashboard.css), the name in the title.
          expect(texts(el, '.dash-comp-lv-short')).toEqual(['X', 'P', 'D', 'E']);
          expect(el.querySelector('.dash-comp-lv-long').parentNode.getAttribute('title')).toBe('Extending');
          const rows = el.querySelectorAll('.dash-comp-row');
          expect(texts(rows[0], '.dash-comp-cell')).toEqual(['1', '1', '1', '–']);
          expect(texts(rows[1], '.dash-comp-cell')).toEqual(['–', '–', '1', '1']);
          expect(texts(el, '.dash-comp-row > .dash-comp-val')).toEqual(['2 of 3', '0 of 2']);
          const seg = rows[0].querySelector('[data-action="mixSeg"][data-level="4"]');
          expect(seg.getAttribute('aria-label')).toBe('Inquiry: 1 Extending');
          expect(seg.classList.contains('is-top')).toBe(true);
          // The row's name is the filter's button; its "below" count is Ava.
          const pick = rows[0].querySelector('.dash-comp-pick');
          expect(pick.getAttribute('data-below')).toBe('1');
          expect(rows[1].querySelector('.dash-comp-pick').getAttribute('data-below')).toBe('2');
        });

        it('Needs Support: the students below on the most competencies first, a cell per column', () => {
          const el = dom(card({ compView: 'below' }));
          expect(texts(el, '.dash-comp-code')).toEqual(['IN', 'EV']);
          expect(el.querySelector('.dash-comp-code').getAttribute('data-action')).toBe('naComp');
          const rows = el.querySelectorAll('.dash-comp-row.is-student');
          expect(texts(el, '.dash-comp-row.is-student .dash-comp-name')).toEqual(['Ava C.', 'Ben D.']);
          expect(texts(el, '.dash-comp-row.is-student .dash-comp-val')).toEqual(['2 of 2', '1 of 2']);
          expect(rows[0].getAttribute('data-href')).toBe('/student?id=s1&course=' + CID + '&tab=comps');
          expect(rows[0].querySelector('.dash-comp-tip-line').textContent).toBe('Below on Inquiry, Evidence');
          const cells = rows[1].querySelectorAll('.dash-comp-sq');
          expect(cells[0].getAttribute('style')).toBe('background:var(--score-3)');
          expect(cells[1].getAttribute('style')).toBe('background:var(--score-2)');
        });

        it('Needs Support: past seven students, "+N more" opens the grid', () => {
          const many = Array.from({ length: 9 }, (_, i) => ({ id: 'm' + i, firstName: 'M' + i, lastName: 'Z' }));
          const lists = [{ col: DashInsights.columns(CID)[0], ids: many.map(s => s.id), values: {} }];
          const el = dom(card({ compView: 'below', allStudents: many, belowLists: lists }));
          expect(el.querySelectorAll('.dash-comp-row.is-student')).toHaveLength(7);
          const more = el.querySelector('.dash-comp-more');
          expect(more.textContent).toBe('+2 more');
          expect(more.getAttribute('data-action')).toBe('studentView');
          expect(more.getAttribute('data-view')).toBe('grid');
          // A view sizes to its own rows (plan F.1): no room kept for another's.
          expect(card({ compView: 'avg', allStudents: many, belowLists: lists })).not.toContain('--comp-rows');
        });

        it('Change: a line per competency, the change, the months in the tip and the label row', () => {
          const el = dom(card({ compView: 'trend' }));
          expect(texts(el, '.dash-comp-lab-mid span')).toEqual(['Sept', 'Nov']);
          const rows = el.querySelectorAll('.dash-comp-row');
          expect(rows[0].querySelector('polyline')).toBeTruthy();
          expect(rows[0].querySelector('polyline').getAttribute('vector-effect')).toBe('non-scaling-stroke');
          // Inquiry: Sept (2 + 3 + 4) / 3 = 3, Nov (2 + 3 + 4) / 3 = 3. Evidence:
          // Sept (1 + 2) / 2 = 1.5, Oct 1, Nov 1.
          const val = texts(el, '.dash-comp-row > .dash-comp-val');
          if (mode === 'letter') {
            expect(val).toEqual(['→ 0', '↓ 13']);
            expect(rows[1].querySelector('.dash-comp-tip-line').textContent).toBe('Sept 38% · Oct 25% · Nov 25%');
          } else {
            expect(val).toEqual(['→ 0.0', '↓ 0.5']);
            expect(rows[1].querySelector('.dash-comp-tip-line').textContent).toBe('Sept 1.5 · Oct 1.0 · Nov 1.0');
          }
          expect(rows[1].querySelector('polyline').getAttribute('stroke')).toBe('var(--score-1)');
          expect(rows[0].querySelector('polyline').getAttribute('stroke')).toBe('var(--score-3)');
        });

        it('Change: fewer than two months shows "—" and says why', () => {
          const el = dom(card({ compView: 'trend', todayStr: '2026-09-30' }));
          const row = el.querySelector('.dash-comp-row');
          expect(row.querySelector('.dash-comp-val').textContent).toBe('—');
          expect(row.querySelector('polyline')).toBeNull();
          expect(row.querySelector('.dash-comp-tip-line').textContent).toBe('Not enough months yet');
        });

        it('marks the picked competency in every view', () => {
          for (const view of ['avg', 'mix', 'trend']) {
            const el = dom(card({ compView: view, naComp: 's:EV' }));
            const picked = el.querySelectorAll('[data-key="s:EV"][aria-pressed="true"]');
            expect(picked.length).toBe(1);
          }
          const el = dom(card({ compView: 'below', naComp: 's:EV' }));
          expect(el.querySelector('.dash-comp-code.is-picked').textContent).toBe('EV');
        });
      });
    }

    it('escapes names', () => {
      setClass('proficiency');
      _cache.learningMaps[CID].sections[0].shortName = '<b>Inquiry</b>';
      clearProfCache();
      for (const view of ['avg', 'mix', 'below', 'trend']) expect(card({ compView: view })).not.toContain('<b>');
    });
  });

  describe("the card's shape (plan F)", () => {
    beforeEach(() => setClass('proficiency'));

    // A class of n competencies, no scores needed for the shape.
    function setCols(nCols) {
      _cache.learningMaps[CID].sections = Array.from({ length: nCols }, (_, i) =>
        sec('c' + i, 'Area ' + String.fromCharCode(65 + i), 'C' + (i + 1)),
      );
      clearProfCache();
    }

    it('sizes to the rows the view draws: roomy with four or fewer, no reserved room', () => {
      let el = dom(card({ compView: 'avg' }));
      const sect = el.querySelector('.dash-comp-card');
      expect(sect.classList.contains('is-roomy')).toBe(true);
      expect(sect.querySelector('.dash-comp-body').getAttribute('style')).toBeNull();
      setCols(5);
      el = dom(card({ compView: 'avg' }));
      expect(el.querySelector('.dash-comp-card').classList.contains('is-roomy')).toBe(false);
    });

    it('past 12 rows the list scrolls inside the card, with "+N more" under it', () => {
      setCols(12);
      let el = dom(card({ compView: 'avg' }));
      expect(el.querySelector('.dash-comp-rows.is-scroll')).toBeNull();
      expect(el.querySelector('.dash-comp-moreline')).toBeNull();
      setCols(13);
      for (const view of ['avg', 'mix', 'trend']) {
        el = dom(card({ compView: view }));
        const list = el.querySelector('.dash-comp-scroll > .dash-comp-rows.is-scroll');
        expect(list.querySelectorAll('.dash-comp-row')).toHaveLength(13);
        expect(list.getAttribute('tabindex')).toBe('0');
        const more = el.querySelector('.dash-comp-moreline');
        expect(more.textContent).toBe('+1 more');
        expect(more.getAttribute('data-action')).toBe('compMore');
      }
    });

    it('Needs Support: a cell per column up to 8, which the card swaps for codes when narrow', () => {
      const el = dom(card({ compView: 'below' }));
      const sect = el.querySelector('.dash-comp-card');
      expect(sect.classList.contains('ns-cols-2')).toBe(true);
      expect(el.querySelectorAll('.dash-comp-labels.is-cells-form')).toHaveLength(1);
      const chipsLabel = el.querySelector('.dash-comp-labels.is-chips-form');
      expect(texts(chipsLabel, ':scope > span')).toEqual(['Student', 'Below on', 'Count']);
      const ava = el.querySelector('.dash-comp-row.is-student');
      expect(ava.querySelectorAll('.dash-comp-sq')).toHaveLength(2);
      // Weakest first: Evidence (1) before Inquiry (2).
      expect(texts(ava, '.dash-comp-bchip')).toEqual(['EV', 'IN']);
      expect(ava.querySelector('.dash-comp-bchip').getAttribute('style')).toBe(
        'background:var(--score-1-bg);color:var(--score-1-text)',
      );
      expect(ava.querySelector('.dash-comp-name').getAttribute('title')).toBe('Ava Chan');
    });

    it('Needs Support past 8 columns: only the codes, weakest first, four then "+N"', () => {
      setCols(9);
      const cols = DashInsights.columns(CID);
      const lists = cols.map((col, i) => ({ col, ids: i < 6 ? ['s1'] : [], values: { s1: 1 + i / 10 } }));
      const el = dom(card({ compView: 'below', belowLists: lists }));
      expect(el.querySelector('.dash-comp-card').classList.contains('is-chipform')).toBe(true);
      expect(el.querySelector('.dash-comp-labels.is-cells-form')).toBeNull();
      expect(el.querySelector('.dash-comp-sq')).toBeNull();
      const row = el.querySelector('.dash-comp-row.is-student');
      const codes = DashInsights.columnCodes(CID);
      expect(texts(row, '.dash-comp-bchip')).toEqual(cols.slice(0, 4).map(c => codes[c.key]));
      expect(row.querySelectorAll('.dash-comp-bchip.is-extra')).toHaveLength(2);
      expect(row.querySelector('.dash-comp-bmore.is-wide').textContent).toBe('+2');
      expect(row.querySelector('.dash-comp-bmore.is-narrow').textContent).toBe('+4');
    });

    it('Level Mix headings carry one letter for a narrow card', () => {
      const el = dom(card({ compView: 'mix' }));
      expect(texts(el, '.dash-comp-lv-short')).toEqual(['X', 'P', 'D', 'E']);
    });
  });

  describe('competencyMonthlyAverages', () => {
    beforeEach(() => {
      setClass('proficiency');
      // Two students; Ava in August and September, Ben in September and
      // November; nobody in October; Ben's December score is after today and
      // a 0 is no score.
      _cache.scores[CID] = {
        s1: [
          sc('IN', 1, '2026-08-30'),
          sc('IN', 3, '2026-09-05'),
          sc('IN', 2, '2026-09-20'),
          sc('IN', 0, '2026-10-01'),
        ],
        s2: [sc('IN', 3, '2026-09-10'), sc('IN', 4, '2026-11-03'), sc('IN', 2, '2026-12-01')],
      };
      _cache.assessments[CID] = Object.values(_cache.scores[CID])
        .flat()
        .map(s => ({ id: s.assessmentId, title: s.assessmentId, tagIds: [s.tagId] }));
      clearProfCache();
    });

    it("averages each student's month, then the class, skipping empty months", () => {
      expect(competencyMonthlyAverages(CID, ['s1', 's2'], { sectionId: 'IN' }, TODAY)).toEqual([
        { month: '2026-08', avg: 1, students: 1 },
        { month: '2026-09', avg: 2.75, students: 2 },
        { month: '2026-11', avg: 4, students: 1 },
      ]);
    });

    it("a score with no date takes its assessment's", () => {
      _cache.scores[CID].s1[0].date = '';
      _cache.assessments[CID][0].date = '2026-10-04';
      clearProfCache();
      const months = competencyMonthlyAverages(CID, ['s1'], { sectionId: 'IN' }, TODAY).map(m => m.month);
      expect(months).toEqual(['2026-09', '2026-10']);
    });

    it('prints the change in levels in a Proficiency class and in points of a percent otherwise', () => {
      expect(levelMoveText(CID, 1, 4)).toEqual({ text: '↑ 3.0', dir: 1 });
      expect(levelMoveText(CID, 2.75, 2.71)).toEqual({ text: '↓ 0.1', dir: -1 });
      COURSES[CID].gradingSystem = 'letter';
      expect(levelMoveText(CID, 1, 4)).toEqual({ text: '↑ 75', dir: 1 });
      COURSES[CID].gradingSystem = 'both';
      expect(levelMoveText(CID, 3, 3)).toEqual({ text: '→ 0', dir: 0 });
      expect(levelMoveText(CID, 0, 3)).toBeNull();
    });
  });

  describe('the page filter', () => {
    let stub, doc, active, saved;

    beforeEach(() => {
      localStorage.clear();
      stub = {
        document: globalThis.document,
        getComputedStyle: globalThis.getComputedStyle,
        PageDashboard: globalThis.PageDashboard,
        voiceLoaded: StudentVoice.loaded,
      };
      doc = parseHTML(
        '<!DOCTYPE html><html><body><div id="page-toolbar-mount"></div><div id="sidebar-mount"></div><main id="main"></main></body></html>',
      ).document;
      globalThis.document = doc;
      globalThis.getComputedStyle = () => ({ paddingLeft: '0', paddingRight: '0' });
      active = null;
      Object.defineProperty(doc, 'activeElement', { get: () => active || doc.body, configurable: true });
      doc.defaultView.HTMLElement.prototype.focus = function () {
        active = this;
      };
      Object.defineProperty(doc.defaultView.HTMLSelectElement.prototype, 'value', {
        get() {
          return this._value || '';
        },
        set(v) {
          this._value = v;
        },
        configurable: true,
      });
      StudentVoice.loaded = () => true;
      setClass('proficiency');
      _cache.coreSelf[CID] = {};
      setActiveCourse(CID);
      runInThisContext(readFileSync(resolve(root, 'teacher/page-dashboard.js'), 'utf-8'), {
        filename: 'teacher/page-dashboard.js',
      });
      PageDashboard.init({});
      saved = PageDashboard;
    });

    afterEach(() => {
      const remove = globalThis.removeEventListener;
      globalThis.removeEventListener = () => {};
      saved.destroy();
      globalThis.removeEventListener = remove;
      globalThis.document = stub.document;
      globalThis.getComputedStyle = stub.getComputedStyle;
      globalThis.PageDashboard = stub.PageDashboard;
      StudentVoice.loaded = stub.voiceLoaded;
      delete _cache.coreSelf[CID];
    });

    function click(el) {
      el.dispatchEvent(new doc.defaultView.Event('click', { bubbles: true, cancelable: true }));
    }
    function key(k) {
      const e = new doc.defaultView.Event('keydown', { bubbles: true, cancelable: true });
      Object.assign(e, { key: k });
      (doc.activeElement || doc.body).dispatchEvent(e);
    }
    const cardOrder = () =>
      Array.from(doc.querySelectorAll('.dash-grid > .dash-card')).map(c => c.getAttribute('data-sid'));
    const pick = k => doc.querySelector('.dash-comp-card .dash-comp-pick[data-key="' + k + '"]');

    it('remembers the view per class on this device', () => {
      expect(doc.getElementById('dash-view-btn-comp').textContent).toBe('Level Mix');
      click(doc.getElementById('dash-view-btn-comp'));
      click(doc.querySelector('#dash-view-menu-comp [data-view="trend"]'));
      expect(localStorage.getItem('fv-dash-comp-view:' + CID)).toBe('trend');
      PageDashboard.render();
      expect(doc.getElementById('dash-view-btn-comp').textContent).toBe('Change');
      expect(doc.querySelector('.dash-comp-card').getAttribute('data-view')).toBe('trend');
    });

    it('a row sorts the cards weakest first, focuses their chips and shows the bar; the chip clears it', () => {
      expect(cardOrder()).toEqual(['s1', 's2', 's3']);
      click(pick('s:EV'));
      // Evidence: Ava 1, Ben 2, Cy not scored (last).
      expect(cardOrder()).toEqual(['s1', 's2', 's3']);
      click(pick('s:EV'));
      expect(doc.querySelector('.dash-comp-filter')).toBeNull();

      // Reverse the names so the sort shows: Inquiry puts Ava (2) first.
      doc.querySelector('.dash-sort-select').value = 'last-desc';
      doc.querySelector('.dash-sort-select').dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
      expect(cardOrder()).toEqual(['s3', 's2', 's1']);
      click(pick('s:IN'));
      expect(cardOrder()).toEqual(['s1', 's2', 's3']);
      expect(pick('s:IN').getAttribute('aria-pressed')).toBe('true');
      expect(doc.activeElement).toBe(pick('s:IN'));

      const bar = doc.querySelector('.dash-comp-filter');
      const chip = bar.querySelector('.dash-comp-chip');
      expect(chip.getAttribute('aria-label')).toBe('Clear the Inquiry filter');
      expect(bar.querySelector('.dash-comp-filter-note').textContent).toBe('Weakest first');
      expect(bar.querySelector('.dash-comp-record').textContent).toBe('Record an Observation for the 1 Below');
      expect(bar.querySelector('.dash-comp-gb').textContent).toBe('View Inquiry in Gradebook →');
      expect(bar.querySelector('.dash-comp-gb').getAttribute('data-href')).toBe(
        '/gradebook?course=' + CID + '&section=IN',
      );
      expect(doc.querySelectorAll('.dash-card-seg.is-focus[data-key="s:IN"]')).toHaveLength(3);
      expect(doc.querySelector('.dash-card[data-sid="s1"]').classList.contains('is-focus-below')).toBe(true);
      // The teacher's sort is untouched.
      expect(doc.querySelector('.dash-sort-select').value).toBe('last-desc');

      click(chip);
      expect(doc.querySelector('.dash-comp-filter')).toBeNull();
      expect(cardOrder()).toEqual(['s3', 's2', 's1']);
      expect(doc.querySelectorAll('.dash-card-seg.is-focus')).toHaveLength(0);
      expect(doc.activeElement).toBe(pick('s:IN'));
    });

    it('the grid sorts the same way', () => {
      click(doc.querySelector('[data-action="studentView"][data-view="grid"]'));
      click(pick('s:IN'));
      const rows = Array.from(doc.querySelectorAll('.dash-sg tbody .dash-sg-name')).map(r => r.textContent);
      expect(rows).toEqual(['Ava C.', 'Ben D.', 'Cy E.']);
      expect(doc.querySelector('.dash-sg th[aria-sort="ascending"]')).toBeTruthy();
    });

    it('Escape clears the filter when nothing else is open', () => {
      click(pick('s:IN'));
      expect(doc.querySelector('.dash-comp-filter')).toBeTruthy();
      key('Escape');
      expect(doc.querySelector('.dash-comp-filter')).toBeNull();
      expect(doc.activeElement).toBe(pick('s:IN'));
    });

    it('Escape leaves the filter when the account menu took it', () => {
      click(pick('s:IN'));
      doc.getElementById('page-toolbar-mount').innerHTML =
        '<div class="tb-group tb-right"><div class="tb-user-menu open">' +
        '<button type="button" class="tb-user-btn" aria-expanded="true">Account</button>' +
        '<div class="tb-user-dropdown" role="menu"><button type="button" role="menuitem">Sign Out</button></div>' +
        '</div></div>';
      // The menu's own listener runs first: it closes and calls preventDefault.
      const menuEsc = e => {
        if (e.key !== 'Escape') return;
        doc.querySelector('.tb-user-btn').setAttribute('aria-expanded', 'false');
        e.preventDefault();
      };
      doc.addEventListener('keydown', menuEsc, true);
      doc.querySelector('[role="menuitem"]').focus();
      key('Escape');
      doc.removeEventListener('keydown', menuEsc, true);
      expect(doc.querySelector('.dash-comp-filter')).toBeTruthy();

      // With the menu open and the focus still on the page, Escape is the menu's too.
      doc.querySelector('.tb-user-btn').setAttribute('aria-expanded', 'true');
      pick('s:IN').focus();
      key('Escape');
      expect(doc.querySelector('.dash-comp-filter')).toBeTruthy();

      // Closed, Escape on the page clears it again.
      doc.querySelector('.tb-user-btn').setAttribute('aria-expanded', 'false');
      key('Escape');
      expect(doc.querySelector('.dash-comp-filter')).toBeNull();
    });

    it('choosing a sort clears the filter, so the sort wins', () => {
      click(doc.querySelector('[data-action="studentView"][data-view="cards"]'));
      click(pick('s:IN'));
      expect(cardOrder()).toEqual(['s1', 's2', 's3']);
      const sel = doc.querySelector('.dash-sort-select');
      sel.value = 'last-desc';
      sel.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
      expect(doc.querySelector('.dash-comp-filter')).toBeNull();
      expect(cardOrder()).toEqual(['s3', 's2', 's1']);

      click(doc.querySelector('[data-action="studentView"][data-view="grid"]'));
      click(pick('s:IN'));
      expect(doc.querySelector('.dash-comp-filter')).toBeTruthy();
      const hadCSS = 'CSS' in globalThis;
      const css = globalThis.CSS;
      globalThis.CSS = { escape: x => x };
      try {
        click(doc.querySelector('.dash-sg-sort[data-key="name"]'));
      } finally {
        if (hadCSS) globalThis.CSS = css;
        else delete globalThis.CSS;
      }
      expect(doc.querySelector('.dash-comp-filter')).toBeNull();
      const rows = Array.from(doc.querySelectorAll('.dash-sg tbody .dash-sg-name')).map(r => r.textContent);
      expect(rows).toEqual(['Ava C.', 'Ben D.', 'Cy E.']);
    });

    it('"Record an Observation" opens the capture with the students below picked', () => {
      const calls = [];
      const open = ObsCapture.openDialog;
      ObsCapture.openDialog = o => calls.push(o);
      try {
        click(pick('s:EV'));
        click(doc.querySelector('.dash-comp-record'));
      } finally {
        ObsCapture.openDialog = open;
      }
      expect(calls).toHaveLength(1);
      expect(calls[0].students).toEqual(['s1', 's2']);
      expect(calls[0].lockStudents).toBeFalsy();
      expect(calls[0].subtitle).toBe('Evidence · 2 students');
    });
  });
});

describe('dash-observations-layout', () => {
  /**
   * The dashboard Observations card's student columns: full week cells while
   * the rule's columns fit, compact cells (23px) when only those fit more
   * columns, so 16–30 students stay in two columns on narrower screens. A
   * compact cell keeps up to 3 marks; past 3 it shows 1 and "+N".
   */
  const H = DashObservations;
  const week = { tab: 'week', n: 22, cells: 8, minCell: 34, fixed: 154 };

  describe('Observations card layout', () => {
    it('uses full cells when two columns fit', () => {
      expect(H.obsGridLayout(Object.assign({}, week, { width: 958 }))).toEqual({
        cols: 2,
        minCell: 34,
        compact: false,
      });
    });

    it('switches to compact cells to keep two columns on a narrower card', () => {
      expect(H.obsGridLayout(Object.assign({}, week, { width: 787 }))).toEqual({ cols: 2, minCell: 23, compact: true });
    });

    it('stays one column with full cells when even compact ones do not fit', () => {
      expect(H.obsGridLayout(Object.assign({}, week, { width: 700 }))).toEqual({
        cols: 1,
        minCell: 34,
        compact: false,
      });
    });

    it('never goes compact for 15 students or fewer, or By competency', () => {
      expect(H.obsGridLayout(Object.assign({}, week, { n: 15, width: 787 })).compact).toBe(false);
      expect(H.obsGridLayout(Object.assign({}, week, { tab: 'competency', minCell: 44, width: 787 })).compact).toBe(
        false,
      );
    });

    it('a compact cell keeps 3 marks, and past 3 shows 1 and "+N"', () => {
      const obs = n =>
        Array.from({ length: n }, (_, i) => ({ id: 'o' + i, sentiment: 'strength', date: '2026-10-1' + i }));
      expect(H.weekMarks(obs(3), 1).marks).toHaveLength(3);
      const busy = H.weekMarks(obs(7), 1);
      expect(busy.marks).toHaveLength(1);
      expect(busy.moreLabel).toBe('+6');
    });
  });
});
