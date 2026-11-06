/**
 * The dashboard card's competency strip (dashboard cards plan, part A):
 * labelled chips with codes up to eight columns, thin bars past that, an
 * instant pop-up per segment, "N not assessed" in the footer only when some
 * competency has no scored work, and the focus hook part B's filter uses.
 */
import './setup.js';
import { parseHTML } from 'linkedom';
import { afterEach, describe, expect, it } from 'vitest';

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

describe('the card strip', () => {
  const many = n => Array.from({ length: n }, (_, i) => sec('s' + i, 'Area ' + i, { code: 'AR' + i }));

  it('draws chips with codes at 8 columns and bars at 9', () => {
    setClass({ sections: many(8) });
    let el = dom(render());
    expect(el.querySelector('.dash-card-strip').classList.contains('is-chips')).toBe(true);
    const chips = el.querySelectorAll('.dash-card-strip button.dash-card-seg');
    expect(chips).toHaveLength(8);
    expect(chips[0].firstChild.textContent).toBe('AR');

    setClass({ sections: many(9) });
    el = dom(render());
    expect(el.querySelector('.dash-card-strip').classList.contains('is-chips')).toBe(false);
    expect(el.querySelectorAll('.dash-card-strip button')).toHaveLength(0);
    const bars = el.querySelectorAll('.dash-card-strip span.dash-card-seg');
    expect(bars).toHaveLength(9);
    expect(bars[0].firstChild.className).toBe('dist-tip');
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

  it('Developing chips take dark text, the others white', () => {
    setClass({
      sections: [sec('a', 'Alpha', { code: 'A1' }), sec('b', 'Beta', { code: 'B1' })],
      scores: [sc(1, 'a', 2), sc(2, 'b', 4)],
    });
    const [dev, ext] = dom(render()).querySelectorAll('.dash-card-seg');
    expect(dev.getAttribute('style')).toContain('--chip-bg:var(--score-2);--chip-fg:#2b1a00');
    expect(ext.getAttribute('style')).toContain('--chip-bg:var(--score-4);--chip-fg:#fff');
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
