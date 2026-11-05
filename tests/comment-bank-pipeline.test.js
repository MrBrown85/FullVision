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
      const studs = getStudents(cid).map((st, i) => {
        const habits = {};
        KEYS.forEach((k, j) => (habits[k] = [4, 3, 3, 4, 2, 3, 4, 2, 1, 3][(i + j * 3) % 10]));
        upsertTermRating(cid, st.id, term, { habits });
        const f = CommentBank.facts(cid, st, term);
        return { st, habits, f, ctx: CommentBank.context(f, { habits }) };
      });
      // A teacher going down the roster at each press, the class's comments
      // so far passed in, as Generate passes the saved ones.
      const onScreen = [];
      for (let k = 1; k <= 4; k++) {
        const comments = [];
        studs.forEach(({ st, habits, f, ctx }, i) => {
          const d = CommentBank.draft(ctx, {
            seed: CommentBank.seedFor(st.id + '|' + term) + k,
            // The text on screen from the press before, as Generate passes it.
            previous: onScreen[i] || '',
            // Not quiet: counted in the class, as a press of Generate is.
            comments: comments.slice(),
          });
          comments.push({ sid: st.id, text: d.text });
          onScreen[i] = d.text;
          // Verified against the facts as they are now (the class's mode
          // changes below).
          const v = CommentBank.verify(d, f, { habits });
          drafts.push({ mode, i, k, name: f.name, f, habits, d, v });
        });
      }
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
          // (Unless the facts allow the student one shape only: an F with no
          // strength leads with the piece, whatever the student before did.)
          const cx = CommentBank.context(set[i].f, { habits: set[i].habits });
          const only =
            CommentPipeline.shapesFor({
              ie: cx._path === 'ie',
              grade: !!cx._grade && cx._path !== 'ie',
              strength: !!cx.strengthAt,
              growth: !!cx.progressDoing,
              piece: !!cx.pieceTitle,
            }).length < 2;
          expect(
            set[i].d.shape === set[i - 1].d.shape && set[i].d.shape !== 'ie' && !only,
            mode + ' ' + k + ' ' + i,
          ).toBe(false);
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
  // its part; counted here per sentence, a joined one apart, it is held to a
  // tenth rounded up plus one sentence, so a small part (the home line, in a
  // third of the comments) is not failed by one sentence of rounding.
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
      Object.entries(ids).forEach(([id, c]) =>
        expect(c, part + ' ' + id + ' of ' + n).toBeLessThanOrEqual(Math.ceil(n / 10) + 1),
      );
    });
  });

  // The coordinator's review of the twelve drafts (Nov 4 2026).
  it('names the course once, and says what a level means at most once and not in every draft', () => {
    let meant = 0;
    drafts.forEach(({ d, f, name }) => {
      expect(count(d.text, f.course), name + ': ' + d.text).toBeLessThanOrEqual(1);
      const m = d.sentences.filter(s => /\bwhich means\b/.test(s.text)).length;
      expect(m, name).toBeLessThanOrEqual(1);
      if (m) meant++;
    });
    expect(meant).toBeGreaterThan(0);
    expect(meant).toBeLessThan(drafts.length / 2);
  });

  it('never says the Ministry descriptor, a frequency, or a throat-clearing lead', () => {
    const BAD =
      /depth and complexity|consistently or most of the time|expected learning|it is clear that|marks show that|in class tasks|day after day|each week|most days|every lesson|as a rule|as a habit|in (his|her|their) work habits|top marks went to|on the lesson|task at hand/i;
    drafts.forEach(({ d, name }) => expect(d.text, name).not.toMatch(BAD));
  });

  it('starts every grade frame with the student or the course', () => {
    COMMENT_BANK.sentences
      .filter(s => s.v === 2 && s.group === 'Grade')
      .forEach(s => expect(s.text, s.id).toMatch(/^(\{He\}|\{His\}|\{course\}|In \{course\}|For \{course\})/));
  });

  // The four-audience review's truth check (Nov 4 2026): every claim of
  // every draft, recomputed from the facts, independently of verify().
  it('says only what the facts hold: level, strict highest, top strength, habits as rated, the lowest non-safety step', () => {
    const P = COMMENT_BANK.pipeline.habits;
    const key = t =>
      String(t || '')
        .toLowerCase()
        .replace(/\{(he|his|him)\}/g, 'P')
        .replace(/\b(he|she|they|him|her|them|his|their)\b/g, 'P')
        .replace(/\[([^|\]]*)\|[^\]]*\]/g, '$1');
    const habitOf = (phrase, form) =>
      Object.keys(P).filter(k =>
        P[k][form].some(t => {
          const a = key(t);
          const b = key(phrase);
          // "[comes|come]" said as "comes" or "come".
          return a === b || a.replace(/(\w)s\b/g, '$1') === b.replace(/(\w)s\b/g, '$1');
        }),
      );
    const raw = (f, w) => (f.grade && f.grade.mode === 'letter' && w.pct != null ? Number(w.pct) : Number(w.v));
    // Falling: the term's trend (the engine's trendOf, the same rule the
    // "improved" gate reads) below zero.
    const trend = c => {
      const t = CommentBank.trendOf(c.termScores || c.scores);
      if (t != null && t < 0) return t;
      if (c.start > 0 && c.now > 0 && c.now < c.start - 1e-9) return c.now - c.start;
      return 0;
    };
    const safety = c => /\b(safe|safely|safety|ethical|ethics)\b/i.test(c.name || '');
    let checked = 0;
    drafts.forEach(({ d, f, habits, name, mode, k }) => {
      const at = name + ' ' + mode + ' ' + k + ': ';
      d.provenance.forEach((pv, i) => {
        const v = pv.values || {};
        const src = pv.sources || {};
        const text = d.sentences[i].text;
        const comp = slot => {
          const id = String(((src[slot] || [])[0] || '').replace(/^comp:/, ''));
          return f.comps.find(c => String(c.id) === id);
        };
        // The level as the gradebook has it.
        if (v.standing) expect(text, at + text).toContain(f.standing);
        if (v.gradeLetter) expect(v.gradeLetter.replace(/^an? /, ''), at + text).toBe(f.grade.letter);
        // The best piece: strictly highest before rounding, else a tie-safe frame.
        if (v.pieceTitle) {
          const id = String((src.pieceTitle || [])[0] || '').replace(/^work:/, '');
          const w = f.work.find(x => String(x.id) === id);
          expect(w, at + text).toBeTruthy();
          const shared = f.work.some(x => x !== w && raw(f, x) >= raw(f, w) - 1e-9);
          if (!v.pieceTie) expect(shared, at + 'not strictly highest: ' + text).toBe(false);
          checked++;
        }
        // The strength: the top competency, or one within 0.2 of it and
        // not falling.
        const sc = comp('strengthAt') || comp('strengthDoing');
        if (sc) {
          const scored = f.comps.filter(c => c.level > 0);
          const top = Math.max(...scored.map(c => c.level));
          const strong = CommentBank.strongestOf(f.comps);
          const ok = strong.length
            ? strong.indexOf(sc) >= 0 || top - sc.level <= 0.2 + 1e-9
            : top - sc.level <= 0.2 + 1e-9;
          expect(ok, at + 'not the top strength: ' + text).toBe(true);
          if (strong.indexOf(sc) < 0) expect(trend(sc) >= 0, at + 'falling: ' + text).toBe(true);
          checked++;
        }
        // Habits said as behaviour only at Consistently; to build only at
        // Sometimes or Rarely.
        ['habitDoes', 'habitDoes2'].forEach(s => {
          if (!v[s]) return;
          const ks = habitOf(v[s], 'does');
          expect(ks.length, at + v[s]).toBeGreaterThan(0);
          expect(
            ks.some(h => habits[h] === 4),
            at + v[s],
          ).toBe(true);
          checked++;
        });
        ['habitInvite', 'habitInvite2'].forEach(s => {
          if (!v[s]) return;
          const ks = habitOf(v[s], 'invite');
          expect(ks.length, at + v[s]).toBeGreaterThan(0);
          expect(
            ks.some(h => habits[h] <= 2),
            at + v[s],
          ).toBe(true);
          checked++;
        });
        // The next step: the lowest competency, never a safety one from a tie.
        const nc = comp('step') || comp('stepDoing');
        if (nc) {
          expect(nc, at + text).toBe(CommentBank.nextStepOf(f.comps));
          const low = f.comps.filter(
            c => c.level > 0 && (c.scores || []).length >= 2 && Math.round(c.level * 10) === Math.round(nc.level * 10),
          );
          if (safety(nc)) expect(low.filter(c => !safety(c)).length, at + 'safety from a tie: ' + text).toBe(0);
          checked++;
        }
      });
      // No frequency or trend the facts do not hold.
      expect(d.text, at).not.toMatch(
        /\b(more often|more and more|most of the time|with growing consistency|when asked)\b/i,
      );
    });
    expect(checked).toBeGreaterThan(1000);
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
