/**
 * Generate as a data-to-text pipeline (Nov 4 2026; plan
 * ~/reports/generate-ideal-comments-plan-v2.md), over Demo Mode's Science 8
 * class as docs/generate-measures.md samples it: 27 students, four presses,
 * Proficiency and Letter, varied Work Habits ratings. Each rule here is one
 * the plan sets as a floor; each failed before the pipeline (the baseline in
 * docs/generate-measures.md).
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const KEYS = ['completes', 'ready', 'others', 'part', 'feedback', 'devices'];
const BANNED = CommentLint.BANNED_PHRASES;
const count = (t, p) => (t.match(new RegExp('\\b' + p.replace(/ /g, '\\s+') + '\\b', 'gi')) || []).length;
const first = t => (t.match(/^[“"]?([A-Za-z’'-]+)/) || ['', ''])[1].toLowerCase();

describe('the pipeline over the Demo class', () => {
  let cid, term, saved, drafts;
  beforeAll(() => {
    saved = window.isDemoMode;
    window.isDemoMode = () => true;
    localStorage.clear();
    runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
    seedIfNeeded();
    cid = 'sci8';
    setActiveTerm(cid, 2);
    term = ReportBlocks.getTermId();
    drafts = [];
    ['proficiency', 'letter'].forEach(mode => {
      COURSES[cid].gradingSystem = mode;
      clearProfCache();
      getStudents(cid).forEach((st, i) => {
        const habits = {};
        KEYS.forEach((k, j) => (habits[k] = [4, 3, 3, 4, 2, 3, 4, 2, 1, 3][(i + j * 3) % 10]));
        upsertTermRating(cid, st.id, term, { habits });
        const f = CommentBank.facts(cid, st, term);
        const ctx = CommentBank.context(f, { habits });
        for (let k = 1; k <= 4; k++) {
          const d = CommentBank.draft(ctx, { seed: CommentBank.seedFor(st.id + '|' + term) + k, quiet: true });
          // Verified against the facts as they are now (the class's mode
          // changes below).
          const v = CommentBank.verify(d, f, { habits });
          drafts.push({ mode, i, k, name: f.name, f, habits, d, v });
        }
      });
    });
    COURSES[cid].gradingSystem = 'proficiency';
    clearProfCache();
  });
  afterAll(() => {
    setActiveTerm(cid, null);
    window.isDemoMode = saved;
    localStorage.clear();
  });

  it('verifies every draft unchanged: every sentence is true of the facts', () => {
    drafts.forEach(x => {
      expect(x.d.replaced, x.name + ' ' + x.mode + ' ' + x.k).toEqual([]);
      expect(x.v.replaced, x.name).toEqual([]);
      expect(x.v.text).toBe(x.d.text);
    });
  });

  it('says no banned phrase, "so far" and the scale at most once, and never "this term"', () => {
    drafts.forEach(({ d, name }) => {
      BANNED.forEach(b => expect(count(d.text, b), name + ': ' + b).toBe(0));
      expect(count(d.text, 'so far'), name).toBeLessThanOrEqual(1);
      expect(count(d.text, 'proficiency scale'), name).toBeLessThanOrEqual(1);
    });
  });

  it('never opens two sentences in a row on the same word, and keeps every sentence within 24 words', () => {
    drafts.forEach(({ d, name }) => {
      for (let i = 1; i < d.sentences.length; i++)
        expect(first(d.sentences[i].text), name + ': ' + d.text).not.toBe(first(d.sentences[i - 1].text));
      d.sentences.forEach(s => expect(CommentRealiser.wordCount(s.text), s.text).toBeLessThanOrEqual(24));
    });
  });

  it('changes four or more sentences from one press to the next', () => {
    drafts.forEach(x => {
      if (x.k === 1) return;
      const prev = drafts.find(y => y.mode === x.mode && y.i === x.i && y.k === x.k - 1);
      const was = new Set(prev.d.sentences.map(s => s.text));
      expect(
        x.d.sentences.filter(s => !was.has(s.text)).length,
        x.name + ' ' + x.mode + ' ' + x.k,
      ).toBeGreaterThanOrEqual(4);
    });
  });

  it('never gives roster neighbours the same opening, or the same first sentence shape', () => {
    ['proficiency', 'letter'].forEach(mode =>
      [1, 2, 3, 4].forEach(k => {
        const set = drafts.filter(x => x.mode === mode && x.k === k).sort((a, b) => a.i - b.i);
        let shared = 0;
        for (let i = 1; i < set.length; i++) {
          const a = CommentPipeline.opening(set[i - 1].d.sentences[0].text, set[i - 1].name);
          const b = CommentPipeline.opening(set[i].d.sentences[0].text, set[i].name);
          if (a === b) shared++;
          expect(set[i].d.shape === set[i - 1].d.shape && set[i].d.shape !== 'ie', mode + ' ' + k + ' ' + i).toBe(
            false,
          );
        }
        expect(shared).toBeLessThanOrEqual(2);
      }),
    );
  });

  it('gives a home line to at most a third of the class at a press', () => {
    ['proficiency', 'letter'].forEach(mode =>
      [1, 2, 3, 4].forEach(k => {
        const set = drafts.filter(x => x.mode === mode && x.k === k);
        const home = set.filter(x => x.d.sentences.some(s => s.step === 'home')).length;
        expect(home).toBeLessThanOrEqual(Math.ceil(set.length / 3));
      }),
    );
  });

  // The measure (docs/generate-measures.md) holds every frame to a tenth of
  // its part; counted here per sentence, a joined one apart, it is held to
  // 11% so a rounding step does not fail it.
  it('uses no frame for much more than a tenth of a part, across the class', () => {
    const by = {};
    drafts.forEach(({ d }) =>
      d.sentences.forEach(s => {
        const part = s.step === 'strongHabits' ? 'habits' : s.step;
        if (!part || s.classLine) return;
        by[part] = by[part] || {};
        by[part][s.id] = (by[part][s.id] || 0) + 1;
      }),
    );
    Object.entries(by).forEach(([part, ids]) => {
      const n = Object.values(ids).reduce((a, b) => a + b, 0);
      if (n < 40) return;
      Object.entries(ids).forEach(([id, c]) => expect(c / n, part + ' ' + id).toBeLessThanOrEqual(0.11));
    });
  });

  it('is repeatable: the same press gives the same draft', () => {
    const st = getStudents(cid)[1];
    const f = CommentBank.facts(cid, st, term);
    const press = () =>
      CommentBank.draft(CommentBank.context(f, {}), { seed: CommentBank.seedFor(st.id + '|' + term) + 2, quiet: true })
        .text;
    expect(press()).toBe(press());
  });
});
