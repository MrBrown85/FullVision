/**
 * The Quick Report's Feedback Pages cards (teacher/report-feedback-cards.js):
 * the HTML for each kind of item from ReportFeedback.forStudent, plus the
 * observations and Term Comment cards.
 */
import './setup.js';
import { describe, expect, it } from 'vitest';

const F = ReportFeedback;

/* The tests run without a DOM, so this is a small parser for the markup the
   cards produce: nested tags, class and colspan attributes, text with the
   five escaped entities. querySelector takes compound selectors (b.fb-lvl)
   joined by spaces (thead th). */
const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'" };

class El {
  constructor(tag, attrs) {
    this.tag = tag;
    this.attrs = attrs || {};
    this.nodes = [];
  }
  get className() {
    return this.attrs.class || '';
  }
  get classList() {
    const list = this.className.split(/\s+/).filter(Boolean);
    return { contains: c => list.indexOf(c) >= 0 };
  }
  get children() {
    return this.nodes.filter(n => n instanceof El);
  }
  get firstElementChild() {
    return this.children[0] || null;
  }
  get lastElementChild() {
    return this.children[this.children.length - 1] || null;
  }
  get textContent() {
    return this.nodes.map(n => (typeof n === 'string' ? n : n.textContent)).join('');
  }
  getAttribute(name) {
    return this.attrs[name] == null ? null : this.attrs[name];
  }
  matches(compound) {
    const m = compound.match(/^([a-z0-9]*)((?:\.[\w-]+)*)$/i);
    if (m[1] && m[1] !== this.tag) return false;
    return m[2]
      .split('.')
      .filter(Boolean)
      .every(c => this.classList.contains(c));
  }
  querySelectorAll(selector) {
    const parts = selector.split(/\s+/);
    const out = [];
    const walk = (el, idx) => {
      el.children.forEach(child => {
        const hit = child.matches(parts[idx]);
        if (hit && idx === parts.length - 1) out.push(child);
        walk(child, hit && idx < parts.length - 1 ? idx + 1 : idx);
      });
    };
    walk(this, 0);
    return out;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function dom(html) {
  const root = new El('root');
  const stack = [root];
  const re = /<(\/?)([a-z0-9]+)([^>]*)>|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    const top = stack[stack.length - 1];
    if (m[4] != null) {
      top.nodes.push(m[4].replace(/&(amp|lt|gt|quot|#39);/g, e => ENT[e]));
    } else if (m[1]) {
      stack.pop();
    } else {
      const attrs = {};
      m[3].replace(/([\w-]+)="([^"]*)"/g, (_, k, v) => (attrs[k] = v));
      const el = new El(m[2].toLowerCase(), attrs);
      top.nodes.push(el);
      stack.push(el);
    }
  }
  return root;
}

function fb(text) {
  return { text: text, date: 'Oct 6', dateIso: '2026-10-06' };
}

function row(over) {
  return Object.assign(
    {
      criterionId: 'k1',
      name: 'Inquiry',
      codes: [],
      levels: { 4: 'Four.', 3: 'Three.', 2: 'Two.', 1: 'One.' },
      level: 3,
      mod: 0,
      mixed: false,
      comment: '',
      beyond: '',
      checks: null,
    },
    over,
  );
}

function item(over) {
  return Object.assign(
    {
      id: 'a1',
      title: 'Cell Lab',
      date: 'Oct 3',
      dateIso: '2026-10-03',
      category: 'Labs',
      kind: 'rubric',
      grade: { text: 'Proficient', word: 'Proficient', letter: '' },
      status: '',
      feedback: [],
      rubric: { name: 'Lab Rubric', style: 'standard', levelOrder: [4, 3, 2, 1], rows: [row()] },
    },
    over,
  );
}

const pointsItem = over =>
  item(
    Object.assign(
      {
        kind: 'points',
        title: 'Energy Quiz',
        rubric: null,
        score: '8',
        outOf: '10',
        percent: '80%',
        feedback: [fb('Review questions 4 and 7.')],
      },
      over,
    ),
  );

const completeItem = over =>
  item(
    Object.assign(
      {
        kind: 'complete',
        title: 'Reading Log',
        rubric: null,
        mark: 'complete',
        grade: { text: 'Complete', word: '', letter: '' },
        feedback: [fb('All five entries done.')],
      },
      over,
    ),
  );

describe('card title bar', () => {
  it('shows the title, "Category · Date", the grade pill and no student name', () => {
    const el = dom(F.cardHtml(item()));
    expect(el.querySelector('.fb-title').textContent).toBe('Cell Lab');
    expect(el.querySelector('.fb-meta').textContent).toBe('Labs · Oct 3');
    expect(el.querySelector('.fb-pill').textContent).toBe('Proficient');
    expect(el.querySelector('.fb-status')).toBeNull();
  });

  it('shows a Letter class grade as the pill text', () => {
    const el = dom(F.cardHtml(pointsItem({ grade: { text: 'C+ 70%', word: '', letter: 'C+ 70%' } })));
    expect(el.querySelector('.fb-pill').textContent).toBe('C+ 70%');
  });

  it('puts Late, Missing or Excused under the pill, or alone with no grade', () => {
    const late = dom(F.cardHtml(item({ status: 'Late' })));
    expect(late.querySelector('.fb-right').children[0].className).toBe('fb-pill');
    expect(late.querySelector('.fb-right').children[1].textContent).toBe('Late');
    const missing = dom(F.cardHtml(item({ status: 'Missing', grade: null, feedback: [fb('Hand it in.')] })));
    expect(missing.querySelector('.fb-pill')).toBeNull();
    expect(missing.querySelector('.fb-status').textContent).toBe('Missing');
  });

  it('shows the number box only when opts.number is given', () => {
    expect(dom(F.cardHtml(item())).querySelector('.fb-num')).toBeNull();
    expect(dom(F.cardHtml(item(), {})).querySelector('.fb-num')).toBeNull();
    const el = dom(F.cardHtml(item(), { number: 17 }));
    expect(el.querySelector('.fb-num').textContent).toBe('17');
    // The box sits before the title.
    expect(el.querySelector('.fb-title-row').firstElementChild.className).toBe('fb-num');
  });

  it('returns an empty string with no item', () => {
    expect(F.cardHtml(null)).toBe('');
  });
});

describe('points and Complete/Incomplete cards', () => {
  it('points: a score box with the percent and "Points", beside the Feedback', () => {
    const el = dom(F.cardHtml(pointsItem()));
    expect(el.querySelector('.fb-score-n').textContent).toBe('8');
    expect(el.querySelector('.fb-score-of').textContent).toBe('out of 10');
    expect(el.querySelector('.fb-score').textContent).toContain('80% · Points');
    const split = el.querySelector('.fb-split');
    expect(split.children).toHaveLength(2);
    expect(split.children[0].className).toBe('fb-score');
    expect(split.children[1].textContent).toBe('Feedback Review questions 4 and 7.');
    expect(el.querySelector('.fb-rb')).toBeNull();
  });

  it('points with no score (Missing) leaves the score box off', () => {
    const el = dom(F.cardHtml(pointsItem({ score: '', percent: '', grade: null, status: 'Missing' })));
    expect(el.querySelector('.fb-score')).toBeNull();
    expect(el.querySelector('.fb-feedback')).not.toBeNull();
  });

  it('complete: a filled ✓ square and "Complete", beside the Feedback', () => {
    const el = dom(F.cardHtml(completeItem()));
    expect(el.querySelector('.fb-sq').classList.contains('is-on')).toBe(true);
    expect(el.querySelector('.fb-sq').textContent).toBe('✓');
    expect(el.querySelector('.fb-complete-word').textContent).toBe('Complete');
    expect(el.querySelector('.fb-split').children).toHaveLength(2);
  });

  it('incomplete: an empty square and "Incomplete"', () => {
    const el = dom(
      F.cardHtml(completeItem({ mark: 'incomplete', grade: { text: 'Incomplete', word: '', letter: '' } })),
    );
    expect(el.querySelector('.fb-sq').classList.contains('is-on')).toBe(false);
    expect(el.querySelector('.fb-sq').textContent).toBe('');
    expect(el.querySelector('.fb-complete-word').textContent).toBe('Incomplete');
  });

  it('with no feedback there is no Feedback box and never filler text', () => {
    const html = F.cardHtml(pointsItem({ feedback: [] }));
    expect(dom(html).querySelector('.fb-feedback')).toBeNull();
    expect(html).not.toMatch(/No feedback/i);
  });
});

describe('rubric tables', () => {
  it('header = rubric name + the four level names, rows in the class order', () => {
    const el = dom(F.cardHtml(item()));
    const heads = [...el.querySelectorAll('thead th')].map(h => h.textContent);
    expect(heads).toEqual(['Lab Rubric', 'Extending', 'Proficient', 'Developing', 'Emerging']);
    const cells = [...el.querySelectorAll('tbody tr')[0].querySelectorAll('td')].map(c => c.textContent);
    expect(cells.map(c => c.replace('✓', ''))).toEqual(['Four.', 'Three.', 'Two.', 'One.']);
  });

  it('reverses the columns when the class lists Emerging first', () => {
    const rubric = { name: 'Lab Rubric', style: 'standard', levelOrder: [1, 2, 3, 4], rows: [row()] };
    const el = dom(F.cardHtml(item({ rubric })));
    expect([...el.querySelectorAll('thead th')].map(h => h.textContent)).toEqual([
      'Lab Rubric',
      'Emerging',
      'Developing',
      'Proficient',
      'Extending',
    ]);
    const tds = [...el.querySelectorAll('tbody tr')[0].querySelectorAll('td')];
    expect(tds.map(c => c.textContent.replace('✓', ''))).toEqual(['One.', 'Two.', 'Three.', 'Four.']);
    // The chosen level follows its column.
    expect(tds[2].classList.contains('fb-on')).toBe(true);
  });

  it('marks only the chosen level: grey cell, ✓, and ✓+ or ✓− for a modifier', () => {
    const marked = mod =>
      dom(
        F.cardHtml(item({ rubric: { name: 'R', style: 'standard', levelOrder: [4, 3, 2, 1], rows: [row({ mod })] } })),
      );
    const plain = marked(0);
    expect(plain.querySelectorAll('.fb-on')).toHaveLength(1);
    expect(plain.querySelector('.fb-on').textContent).toBe('✓Three.');
    expect(plain.querySelectorAll('.fb-mk')).toHaveLength(1);
    expect(marked(1).querySelector('.fb-mk').textContent).toBe('✓+');
    expect(marked(-1).querySelector('.fb-mk').textContent).toBe('✓−');
  });

  it('marks nothing on an unscored criterion', () => {
    const el = dom(
      F.cardHtml(
        item({ rubric: { name: 'R', style: 'standard', levelOrder: [4, 3, 2, 1], rows: [row({ level: 0 })] } }),
      ),
    );
    expect(el.querySelector('.fb-on')).toBeNull();
    expect(el.querySelector('.fb-mk')).toBeNull();
  });

  it('adds a comment row under a criterion only when it has a comment', () => {
    const rows = [
      row({ name: 'Inquiry', comment: 'Ask a sharper question.' }),
      row({ name: 'Communication', comment: '  ' }),
    ];
    const el = dom(F.cardHtml(item({ rubric: { name: 'R', style: 'standard', levelOrder: [4, 3, 2, 1], rows } })));
    const trs = [...el.querySelectorAll('tbody tr')];
    expect(trs.map(t => t.className)).toEqual(['', 'fb-cm', '']);
    expect(trs[1].textContent).toBe('Comment Ask a sharper question.');
    expect(trs[1].querySelector('td').getAttribute('colspan')).toBe('5');
    expect(trs[0].querySelector('th').textContent).toBe('Inquiry');
  });

  it('a Tag Rubric and a General Rubric use the same table with their own name', () => {
    const tags = dom(
      F.cardHtml(
        item({
          kind: 'tags',
          rubric: {
            name: 'Tag Rubric',
            style: 'standard',
            levelOrder: [4, 3, 2, 1],
            rows: [row({ name: 'Questioning' })],
          },
        }),
      ),
    );
    expect(tags.querySelector('thead th').textContent).toBe('Tag Rubric');
    expect(tags.querySelector('.fb-card').classList.contains('fb-tags')).toBe(true);
    const general = dom(
      F.cardHtml(
        item({
          kind: 'general',
          rubric: {
            name: 'General Rubric',
            style: 'standard',
            levelOrder: [4, 3, 2, 1],
            rows: [row({ name: 'Overall' })],
          },
        }),
      ),
    );
    expect(general.querySelector('tbody th').textContent).toBe('Overall');
  });

  it('Advanced: every check at every level, ticked and unticked', () => {
    const checks = {
      4: [{ id: 'k4', label: 'Tests two designs', ticked: false }],
      3: [
        { id: 'k3a', label: 'Draws a plan', ticked: true },
        { id: 'k3b', label: 'Labels parts', ticked: false },
      ],
      2: [{ id: 'k2', label: 'Builds a model', ticked: true }],
      1: [],
    };
    const el = dom(
      F.cardHtml(
        item({ rubric: { name: 'Build', style: 'advanced', levelOrder: [4, 3, 2, 1], rows: [row({ checks })] } }),
      ),
    );
    const tds = [...el.querySelectorAll('tbody td')];
    expect(tds.map(td => td.querySelectorAll('.fb-ck').length)).toEqual([1, 2, 1, 0]);
    expect(tds[0].querySelector('.fb-bx').classList.contains('is-on')).toBe(false);
    const level3 = [...tds[1].querySelectorAll('.fb-bx')];
    expect(level3.map(b => b.classList.contains('is-on'))).toEqual([true, false]);
    expect(level3.map(b => b.textContent)).toEqual(['✓', '']);
    expect(tds[1].textContent).toContain('Labels parts');
    // Unchosen levels still list their checks; the chosen cell keeps its mark.
    expect(tds[1].classList.contains('fb-on')).toBe(true);
    expect(tds[0].classList.contains('fb-on')).toBe(false);
    expect(tds[2].querySelectorAll('.fb-bx.is-on')).toHaveLength(1);
  });

  it('single-point: Work On | Proficient Standard | Went Beyond, the standard names the level', () => {
    const rubric = {
      name: 'Speech',
      style: 'single_point',
      levelOrder: [4, 3, 2, 1],
      rows: [
        row({
          name: 'Delivery',
          level: 4,
          comment: 'Slow down.',
          beyond: 'Used a prop.',
          levels: { 4: '', 3: 'Speaks clearly.', 2: '', 1: '' },
        }),
        row({ name: 'Volume', level: 0, comment: '', beyond: '' }),
      ],
    };
    const el = dom(F.cardHtml(item({ kind: 'rubric', rubric })));
    expect([...el.querySelectorAll('thead th')].map(h => h.textContent)).toEqual([
      'Speech',
      'Work On',
      'Proficient Standard',
      'Went Beyond',
    ]);
    const tds = [...el.querySelectorAll('tbody tr')[0].querySelectorAll('td')];
    expect(tds.map(t => t.textContent)).toEqual(['Slow down.', 'ExtendingSpeaks clearly.', 'Used a prop.']);
    expect(tds[1].querySelector('b.fb-lvl').textContent).toBe('Extending');
    expect(tds[1].classList.contains('fb-on')).toBe(true);
    expect(el.querySelectorAll('.fb-cm')).toHaveLength(0);
    // An unscored row names no level and has no grey cell.
    const second = el.querySelectorAll('tbody tr')[1];
    expect(second.querySelector('.fb-on')).toBeNull();
    expect(second.querySelector('.fb-lvl')).toBeNull();
  });

  it('puts the Feedback box under the table, and none when feedback is empty', () => {
    const withFb = dom(F.cardHtml(item({ feedback: [fb('Good lab.'), fb('Redo part 2.')] })));
    const box = withFb.querySelector('.fb-card').lastElementChild;
    expect(box.className).toBe('fb-feedback');
    expect(box.textContent).toBe('Feedback Good lab.Redo part 2.');
    const none = F.cardHtml(item());
    expect(dom(none).querySelector('.fb-feedback')).toBeNull();
    expect(none).not.toMatch(/No feedback/i);
  });
});

describe('observations and Term Comment cards', () => {
  it('observations: a row each with date, text and tags', () => {
    const el = dom(
      F.observationsCardHtml([
        {
          id: 'o1',
          date: 'Oct 6',
          dateIso: '2026-10-06',
          text: 'Led the group.',
          tags: ['Collaboration', 'Leadership'],
        },
        { id: 'o2', date: 'Oct 9', dateIso: '2026-10-09', text: 'Asked a good question.', tags: [] },
      ]),
    );
    expect(el.querySelector('.fb-title').textContent).toBe('Observations');
    const rows = el.querySelectorAll('.fb-obs');
    expect(rows).toHaveLength(2);
    expect(rows[0].querySelector('b').textContent).toBe('Oct 6');
    expect(rows[0].textContent).toContain('Led the group.');
    expect(rows[0].querySelector('.fb-tags').textContent).toBe('Collaboration, Leadership');
    expect(rows[1].querySelector('.fb-tags')).toBeNull();
    expect(el.querySelector('.fb-pill')).toBeNull();
  });

  it('observations: nothing for an empty list', () => {
    expect(F.observationsCardHtml([])).toBe('');
    expect(F.observationsCardHtml(null)).toBe('');
  });

  it('term comment: a paragraph per line, nothing when empty', () => {
    const el = dom(F.termCommentCardHtml('First thought.\nSecond thought.'));
    expect(el.querySelector('.fb-title').textContent).toBe('Term Comment');
    expect([...el.querySelectorAll('.fb-para')].map(p => p.textContent)).toEqual(['First thought.', 'Second thought.']);
    expect(F.termCommentCardHtml('')).toBe('');
    expect(F.termCommentCardHtml('  \n ')).toBe('');
  });
});

describe('escaping', () => {
  const evil = '<img src=x onerror=alert(1)> & "quoted"';

  it('escapes every field on a rubric card', () => {
    const html = F.cardHtml(
      item({
        title: evil,
        category: evil,
        status: evil,
        grade: { text: evil, word: '', letter: '' },
        feedback: [fb(evil)],
        rubric: {
          name: evil,
          style: 'advanced',
          levelOrder: [4, 3, 2, 1],
          rows: [
            row({
              name: evil,
              comment: evil,
              levels: { 4: evil, 3: evil, 2: evil, 1: evil },
              checks: { 4: [{ id: 'x', label: evil, ticked: true }], 3: [], 2: [], 1: [] },
            }),
          ],
        },
      }),
      { number: evil },
    );
    expect(html).not.toContain('<img');
    expect(dom(html).querySelector('img')).toBeNull();
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quoted&quot;');
  });

  it('escapes points, single-point, observation and term comment text', () => {
    const htmls = [
      F.cardHtml(pointsItem({ title: evil, score: evil, outOf: evil, percent: evil, feedback: [fb(evil)] })),
      F.cardHtml(
        item({
          rubric: {
            name: 'S',
            style: 'single_point',
            levelOrder: [4, 3, 2, 1],
            rows: [row({ name: evil, comment: evil, beyond: evil, levels: { 3: evil } })],
          },
        }),
      ),
      F.observationsCardHtml([{ id: 'o', date: evil, dateIso: '', text: evil, tags: [evil] }]),
      F.termCommentCardHtml(evil),
    ];
    htmls.forEach(html => {
      expect(dom(html).querySelector('img')).toBeNull();
      expect(html).not.toContain('<img');
    });
  });
});
