#!/usr/bin/env node
/* generate-measure.mjs — how Generate's drafts read across a class, in
 * numbers (docs/generate-measures.md; the Generate pipeline plan, Nov 4
 * 2026).
 *
 * It drafts Demo Mode's Science 8 class the way the Nov 4 audit did: 27
 * students × 4 presses of Generate, once as a Proficiency class and once as
 * a Letter class, with varied Work Habits ratings, then reports:
 *
 *   - first sentences: distinct shapes (the first three words, the name and
 *     pronouns as one word each), the top shape's share, and the share of
 *     each family (name-first, pronoun-first, course-first, grade-first,
 *     work-first, other);
 *   - frames: per draft step, how many bank sentences it used and the top
 *     one's share of the step;
 *   - consecutive sentences that open with the same word;
 *   - "this term", "so far" and "proficiency scale" per draft;
 *   - banned phrases (the lint's list) anywhere;
 *   - sentences and words per draft, words per sentence;
 *   - distinct-2 and distinct-3 (different word pairs and triples over all
 *     pairs and triples, per class set) and self-BLEU (each comment's
 *     BLEU-3 against the rest of its class set; lower is more varied);
 *   - mean normalised word edit distance between a student's four presses
 *     and between roster neighbours at the same press;
 *   - how many sentences each press changes from the one before, and how
 *     often adjacent students open with the same three words.
 *
 * It also builds a blind-test sheet: N generated comments shuffled with N
 * control comments (the blockquotes of docs/generate-gold-standin.md, or
 * --controls), numbered, with an answer key.
 *
 * Usage:
 *   node scripts/generate-measure.mjs --base http://localhost:PORT [--save drafts.json]
 *   node scripts/generate-measure.mjs --from drafts.json [--json] [--md]
 *   ... --blind 10 --seed 7 --sheet sheet.md --key key.md [--controls file.md]
 *
 * --base needs a local server (PORT=<port> node scripts/dev-local.mjs) and
 * Playwright; it never signs in (Demo Mode only). */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/* ── Sampling (the Nov 4 audit's harness) ───────────────────────────── */

export async function sample(base, offset = 0) {
  const { chromium } = await import('playwright');
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  await p.goto(base + '/login.html?demo=1');
  await p.waitForURL(/dashboard/);
  await p.goto(base + '/reports');
  await p.waitForSelector('.qn-left');
  await p.waitForTimeout(1500);
  const rows = await p.evaluate(async offset => {
    /* global getActiveCourse, ReportBlocks, getStudents, COURSES, clearProfCache, upsertTermRating, CommentBank */
    const cid = getActiveCourse();
    const term = ReportBlocks.getTermId();
    const studs = getStudents(cid);
    const keys = ['completes', 'ready', 'others', 'part', 'feedback', 'devices'];
    const run = mode => {
      COURSES[cid].gradingSystem = mode === 'letter' ? 'letter' : 'proficiency';
      if (typeof clearProfCache === 'function') clearProfCache();
      const out = [];
      const ctxs = studs.map((st, i) => {
        // Varied but realistic habit ratings (1 Rarely … 4 Consistently).
        const habits = {};
        keys.forEach((k, j) => (habits[k] = [4, 3, 3, 4, 2, 3, 4, 2, 1, 3][(i + j * 3) % 10]));
        upsertTermRating(cid, st.id, term, { habits });
        const f = CommentBank.facts(cid, st, term);
        return CommentBank.context(f, { habits });
      });
      // A teacher going down the roster: each press, every student in turn,
      // with the comments already drafted at that press as the class's
      // (Generate passes the classmates' comments the same way).
      const onScreen = [];
      // The class's comments so far, every press: a class set keeps no two
      // comments with the same sentence (blind sort 3).
      const comments = [];
      for (let k = 1; k <= 4; k++) {
        studs.forEach((st, i) => {
          const d = CommentBank.draft(ctxs[i], {
            seed: CommentBank.seedFor(st.id + '|' + term) + k + offset,
            // The text on screen from the press before, as Generate passes it.
            previous: onScreen[i] || '',
            // Not quiet: counted in the class, as a press of Generate is.
            comments: comments.filter(c => c.sid !== st.id),
          });
          comments.push({ sid: st.id, text: d.text });
          onScreen[i] = d.text;
          out.push({
            mode,
            sid: st.id,
            name: st.firstName,
            press: k,
            text: d.text,
            ids: (d.sentences || []).map(x => x.id),
            steps: (d.sentences || []).map(x => x.step),
            parts: (d.sentences || []).map(x => x.text),
            replaced: (d.replaced || []).length,
          });
        });
      }
      return out;
    };
    return run('proficiency').concat(run('letter'));
  }, offset);
  await b.close();
  if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  return rows;
}

/* ── Text helpers ───────────────────────────────────────────────────── */

const PRONOUNS = /^(he|she|they|his|her|their|him|them|hers|theirs)$/i;
export const BANNED = [
  'all six',
  'every one',
  'each skill',
  'across skills',
  'rated',
  'is able to',
  'ability to',
  'the work marked',
  'marked highest',
  'proficiency scale calls',
  'skill by skill',
  'marks are close',
  'this term',
  'work on',
  'keep going',
];

function words(text) {
  return String(text || '')
    .replace(/[“”"]/g, '')
    .split(/\s+/)
    .map(w => w.replace(/^[^A-Za-z0-9’'+-]+|[^A-Za-z0-9’'+-]+$/g, ''))
    .filter(Boolean);
}
/* A draft's words with the student's name and pronouns as one token each. */
function normWords(text, name) {
  return words(text).map(w => {
    const bare = w.replace(/[’']s$/, '');
    if (name && bare === name) return 'NAME';
    if (PRONOUNS.test(w)) return 'PRON';
    return w.toLowerCase();
  });
}
function count(text, phrase) {
  // "work on" is the phrasal verb, not "work on time" (the lint's own rule).
  const after = phrase === 'work on' ? '(?!\\s+time\\b)' : '';
  const re = new RegExp('\\b' + phrase.replace(/\s+/g, '\\s+') + '\\b' + after, 'gi');
  return (String(text).match(re) || []).length;
}
/* The family of a first sentence, by what it opens on: the student's name
   (or their possessive), a pronoun, the course, a grade or level word, the
   piece of work (a best-piece sentence opening "The", "Of", "For", "On" or
   "In"), a time phrase ("So far", "Over the year"), or anything else. */
function family(firstWords, row) {
  const w = firstWords[0] || '';
  if (w === 'NAME') return 'name-first';
  if ((row.steps || [])[0] === 'example' && /^(the|of|for|on|in)$/.test(w)) return 'work-first';
  if (w === 'PRON') return 'pronoun-first';
  if (w === 'science' || (w === 'in' && firstWords[1] === 'science')) return 'course-first';
  if (/^(extending|proficient|developing|emerging|ie|a|an|b|b\+|b-|c|c\+|c-|a-|a\+|with|marks?|grade|level)$/.test(w))
    return 'grade-first';
  if (/^(so|over|since|this|right|now|after|across|by|halfway)$/.test(w)) return 'time-first';
  return 'other';
}

function lev(a, b) {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}
/* Word-level edit distance over the longer draft's length: 0 the same
   words, 1 nothing in common position by position. */
export function editDistance(a, b) {
  const n = Math.max(a.length, b.length);
  return n ? lev(a, b) / n : 0;
}

function ngrams(ws, n) {
  const out = [];
  for (let i = 0; i + n <= ws.length; i++) out.push(ws.slice(i, i + n).join(' '));
  return out;
}
function distinctN(drafts, n) {
  let all = 0;
  const uniq = new Set();
  drafts.forEach(ws =>
    ngrams(ws, n).forEach(g => {
      all++;
      uniq.add(g);
    }),
  );
  return all ? uniq.size / all : 0;
}
/* BLEU up to 3-grams (clipped precision, geometric mean, brevity penalty
   against the closest reference length) of one draft against the rest. */
function bleu(hyp, refs, N = 3) {
  if (!hyp.length || !refs.length) return 0;
  let logSum = 0;
  for (let n = 1; n <= N; n++) {
    const h = ngrams(hyp, n);
    if (!h.length) return 0;
    const hc = {};
    h.forEach(g => (hc[g] = (hc[g] || 0) + 1));
    const maxRef = {};
    refs.forEach(r => {
      const rc = {};
      ngrams(r, n).forEach(g => (rc[g] = (rc[g] || 0) + 1));
      Object.keys(rc).forEach(g => (maxRef[g] = Math.max(maxRef[g] || 0, rc[g])));
    });
    let clipped = 0;
    Object.keys(hc).forEach(g => (clipped += Math.min(hc[g], maxRef[g] || 0)));
    // Add-one smoothing for the higher orders so one missing triple is not 0.
    const p = n === 1 ? clipped / h.length : (clipped + 1) / (h.length + 1);
    if (!p) return 0;
    logSum += Math.log(p);
  }
  const closest = refs
    .map(r => r.length)
    .reduce((best, l) => (Math.abs(l - hyp.length) < Math.abs(best - hyp.length) ? l : best), refs[0].length);
  const bp = hyp.length > closest ? 1 : Math.exp(1 - closest / hyp.length);
  return bp * Math.exp(logSum / N);
}

const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r2 = x => Math.round(x * 100) / 100;
const pct = x => Math.round(x * 1000) / 10;

/* ── The measures ───────────────────────────────────────────────────── */

export function measure(rows) {
  const out = {};
  const firstShapes = {};
  const families = {};
  const byStep = {};
  let sameOpener = 0;
  const perDraft = { thisTerm: [], soFar: [], scale: [], sentences: [], words: [] };
  const sentWords = [];
  const banned = {};
  rows.forEach(r => {
    const first = normWords(r.parts[0] || '', r.name).slice(0, 3);
    const shape = first.join(' ');
    firstShapes[shape] = (firstShapes[shape] || 0) + 1;
    const fam = family(first, r);
    families[fam] = (families[fam] || 0) + 1;
    r.steps.forEach((st, i) => {
      // A part as the questionnaire groups its steps: the habits sentence
      // and the strong-habits sentence are one part (Habits).
      const k = st === 'strongHabits' ? 'habits' : st || 'none';
      byStep[k] = byStep[k] || {};
      const id = r.ids[i];
      byStep[k][id] = (byStep[k][id] || 0) + 1;
    });
    for (let i = 1; i < r.parts.length; i++) {
      const a = (words(r.parts[i - 1])[0] || '').toLowerCase();
      const b = (words(r.parts[i])[0] || '').toLowerCase();
      if (a && a === b) sameOpener++;
    }
    perDraft.thisTerm.push(count(r.text, 'this term'));
    perDraft.soFar.push(count(r.text, 'so far'));
    perDraft.scale.push(count(r.text, 'proficiency scale'));
    // Facts said: each sentence, and a joined sentence twice (two facts).
    perDraft.sentences.push(r.parts.length + r.ids.filter(id => /^j:/.test(String(id))).length);
    perDraft.words.push(words(r.text).length);
    r.parts.forEach(t => sentWords.push(words(t).length));
    BANNED.forEach(b => {
      const n = count(r.text, b);
      if (n) banned[b] = (banned[b] || 0) + n;
    });
  });
  const n = rows.length;
  const shapes = Object.entries(firstShapes).sort((a, b) => b[1] - a[1]);
  out.drafts = n;
  out.firstShapes = { distinct: shapes.length, top: shapes[0] ? shapes[0][0] : '', topShare: pct(shapes[0][1] / n) };
  out.firstShapesTop5 = shapes.slice(0, 5).map(([s, c]) => [s, pct(c / n)]);
  out.families = Object.fromEntries(
    Object.entries(families)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => [k, pct(v / n)]),
  );
  out.frames = Object.fromEntries(
    Object.entries(byStep).map(([k, ids]) => {
      const total = Object.values(ids).reduce((a, b) => a + b, 0);
      const top = Object.entries(ids).sort((a, b) => b[1] - a[1])[0];
      return [k, { used: Object.keys(ids).length, sentences: total, top: top[0], topShare: pct(top[1] / total) }];
    }),
  );
  out.consecutiveSameOpener = sameOpener;
  out.thisTermPerDraft = r2(mean(perDraft.thisTerm));
  out.soFarPerDraft = { mean: r2(mean(perDraft.soFar)), max: Math.max(...perDraft.soFar) };
  out.scalePerDraft = { mean: r2(mean(perDraft.scale)), max: Math.max(...perDraft.scale) };
  out.banned = { total: Object.values(banned).reduce((a, b) => a + b, 0), by: banned };
  out.sentencesPerDraft = {
    mean: r2(mean(perDraft.sentences)),
    min: Math.min(...perDraft.sentences),
    max: Math.max(...perDraft.sentences),
  };
  out.wordsPerDraft = {
    mean: r2(mean(perDraft.words)),
    min: Math.min(...perDraft.words),
    max: Math.max(...perDraft.words),
  };
  out.wordsPerSentence = { mean: r2(mean(sentWords)), max: Math.max(...sentWords) };

  // Class sets: one mode, one press, the 27 students in roster order.
  const sets = {};
  rows.forEach(r => {
    const k = r.mode + '|' + r.press;
    (sets[k] = sets[k] || []).push(r);
  });
  const d2 = [];
  const d3 = [];
  const sb = [];
  const neigh = [];
  let sharedStarts = 0;
  let worstClassShared = 0;
  Object.values(sets).forEach(set => {
    const ws = set.map(r => normWords(r.text, r.name));
    d2.push(distinctN(ws, 2));
    d3.push(distinctN(ws, 3));
    ws.forEach((w, i) =>
      sb.push(
        bleu(
          w,
          ws.filter((_, j) => j !== i),
        ),
      ),
    );
    let shared = 0;
    for (let i = 1; i < set.length; i++) {
      neigh.push(editDistance(ws[i - 1], ws[i]));
      const a = normWords(set[i - 1].parts[0] || '', set[i - 1].name)
        .slice(0, 3)
        .join(' ');
      const b = normWords(set[i].parts[0] || '', set[i].name)
        .slice(0, 3)
        .join(' ');
      if (a === b) shared++;
    }
    sharedStarts += shared;
    worstClassShared = Math.max(worstClassShared, shared);
  });
  out.distinct2 = r2(mean(d2));
  out.distinct3 = r2(mean(d3));
  out.selfBleu3 = r2(mean(sb));
  out.neighbourEditDistance = r2(mean(neigh));
  // The blind sort's tells (Nov 4 2026): time openers, stock openers, a
  // three-word run said twice in a comment, near-copies within a class,
  // comments with no joined sentence, and phrases shared across a class.
  const TIME = /^(so|over|since|this|right|now|across|by|recent|recently)$/i;
  const STOCK = /^(right now|at this point|by now|for now|from the start of the term to now)\b/i;
  let timeComments = 0;
  let timeMax = 0;
  let stock = 0;
  let trigram = 0;
  let flat = 0;
  rows.forEach(r => {
    const t = r.parts.filter(x => TIME.test(words(x)[0] || '')).length;
    if (t) timeComments++;
    timeMax = Math.max(timeMax, t);
    stock += r.parts.filter(x => STOCK.test(x)).length;
    const seenG = {};
    let rep3 = false;
    r.parts.forEach((x, i) => {
      const w = normWords(x, r.name);
      const mine = {};
      for (let j = 0; j + 2 < w.length; j++) mine[w.slice(j, j + 3).join(' ')] = true;
      Object.keys(mine).forEach(g => {
        if (seenG[g] != null && seenG[g] !== i) rep3 = true;
        seenG[g] = i;
      });
    });
    if (rep3) trigram++;
    if (r.parts.length >= 5 && !r.ids.some(id => /^j:/.test(id))) flat++;
  });
  let near = 0;
  let shared4 = 0;
  Object.values(sets).forEach(set => {
    const ws = set.map(r => normWords(r.text, r.name));
    for (let i = 0; i < ws.length; i++)
      for (let j = i + 1; j < ws.length; j++) if (editDistance(ws[i], ws[j]) < 0.5) near++;
    const holds = {};
    ws.forEach(w => {
      const mine = {};
      for (let j = 0; j + 3 < w.length; j++) {
        const g = w.slice(j, j + 4);
        if (g.includes('NAME') || g.includes('PRON')) continue;
        mine[g.join(' ')] = true;
      }
      Object.keys(mine).forEach(g => (holds[g] = (holds[g] || 0) + 1));
    });
    const top = Math.max(0, ...Object.values(holds));
    shared4 = Math.max(shared4, top / set.length);
  });
  // Exact sentences said in the comments of two students of one class.
  const byMode = {};
  rows.forEach(r => {
    const m = (byMode[r.mode] = byMode[r.mode] || {});
    r.parts.forEach(t => {
      const k = normWords(t, r.name).join(' ');
      (m[k] = m[k] || new Set()).add(r.sid);
    });
  });
  let exact = 0;
  Object.values(byMode).forEach(m => Object.values(m).forEach(set => set.size > 1 && exact++));
  out.tells = {
    exact,
    timeComments: pct(timeComments / rows.length),
    timeMax,
    stock,
    trigram,
    flat,
    near,
    shared4: pct(shared4),
  };
  out.adjacentSameStart = { total: sharedStarts, worstClass: worstClassShared };

  // A student's four presses.
  const byStudent = {};
  rows.forEach(r => {
    const k = r.mode + '|' + r.sid;
    (byStudent[k] = byStudent[k] || []).push(r);
  });
  const pressDist = [];
  const changed = [];
  Object.values(byStudent).forEach(list => {
    list.sort((a, b) => a.press - b.press);
    const ws = list.map(r => normWords(r.text, r.name));
    for (let i = 0; i < ws.length; i++)
      for (let j = i + 1; j < ws.length; j++) pressDist.push(editDistance(ws[i], ws[j]));
    for (let i = 1; i < list.length; i++) {
      const before = new Set(list[i - 1].parts.map(t => normWords(t, list[i].name).join(' ')));
      changed.push(list[i].parts.filter(t => !before.has(normWords(t, list[i].name).join(' '))).length);
    }
  });
  out.pressEditDistance = r2(mean(pressDist));
  out.pressChangedSentences = {
    mean: r2(mean(changed)),
    min: Math.min(...changed),
    atLeast4: pct(changed.filter(c => c >= 4).length / changed.length),
  };
  out.replaced = rows.reduce((a, r) => a + (r.replaced || 0), 0);
  return out;
}

/* The targets (plan v1 section 4 as revised by plan v2), each { ok, want }. */
export function targets(m) {
  const fam = Math.max(...Object.values(m.families));
  const frame = Math.max(
    ...Object.entries(m.frames)
      .filter(([k]) => !['closer', 'support', 'lateWork', 'languageGoals'].includes(k))
      .map(([, v]) => v.topShare),
  );
  return [
    ['Top first-sentence shape', m.firstShapes.topShare + '%', '≤ 15%', m.firstShapes.topShare <= 15],
    ['Largest shape family', fam + '%', '≤ 25%', fam <= 25],
    ['Largest frame share of a part', frame + '%', '≤ 10%', frame <= 10],
    ['Consecutive same-opener pairs', m.consecutiveSameOpener, '0', m.consecutiveSameOpener === 0],
    ['"this term" per draft', m.thisTermPerDraft, '0', m.thisTermPerDraft === 0],
    ['"so far" per draft (max)', m.soFarPerDraft.max, '≤ 1', m.soFarPerDraft.max <= 1],
    ['"proficiency scale" per draft (max)', m.scalePerDraft.max, '≤ 1', m.scalePerDraft.max <= 1],
    ['Banned phrases', m.banned.total, '0', m.banned.total === 0],
    [
      'Presses changing ≥ 4 sentences',
      m.pressChangedSentences.atLeast4 + '% (min ' + m.pressChangedSentences.min + ')',
      '100%',
      m.pressChangedSentences.atLeast4 === 100,
    ],
    ['Neighbour edit distance', m.neighbourEditDistance, '≥ 0.6', m.neighbourEditDistance >= 0.6],
    [
      'Adjacent students sharing first 3 words',
      m.adjacentSameStart.total + ' (worst class ' + m.adjacentSameStart.worstClass + ')',
      '≤ 2 a class',
      m.adjacentSameStart.worstClass <= 2,
    ],
    [
      'Facts per draft (a joined sentence is two)',
      m.sentencesPerDraft.mean + ' (' + m.sentencesPerDraft.min + '–' + m.sentencesPerDraft.max + ')',
      '5–7',
      m.sentencesPerDraft.min >= 5 && m.sentencesPerDraft.max <= 7,
    ],
    [
      'Words per sentence',
      m.wordsPerSentence.mean + ' (max ' + m.wordsPerSentence.max + ')',
      'mean ≈ 15, max ≤ 24',
      m.wordsPerSentence.max <= 24,
    ],
    ['Press edit distance', m.pressEditDistance, '≥ 0.6', m.pressEditDistance >= 0.6],
    ['Comments with a time opener', m.tells.timeComments + '%', '≤ 25%', m.tells.timeComments <= 25],
    ['Time openers in one comment (max)', m.tells.timeMax, '≤ 1', m.tells.timeMax <= 1],
    ['Stock time openers', m.tells.stock, '0', m.tells.stock === 0],
    ["Sentences said in two students' comments", m.tells.exact, '0', m.tells.exact === 0],
    ['Comments repeating a 3-word run', m.tells.trigram, '0', m.tells.trigram === 0],
    ['Classmate pairs under 0.5 edit distance', m.tells.near, '0', m.tells.near === 0],
    ['Comments of 5+ sentences with no join', m.tells.flat, '0', m.tells.flat === 0],
    ['Most shared 4-word run in a class', m.tells.shared4 + '% of comments', 'reported', true],
    ['Self-BLEU-3', m.selfBleu3, 'reported (lower is more varied)', true],
    ['Distinct-2 / distinct-3', m.distinct2 + ' / ' + m.distinct3, 'reported', true],
  ];
}

export function markdown(m) {
  const lines = ['| Measure | Value | Target | Met |', '|---|---|---|---|'];
  targets(m).forEach(([k, v, want, ok]) => lines.push(`| ${k} | ${v} | ${want} | ${ok ? 'yes' : 'no'} |`));
  lines.push('');
  lines.push('Frames per part (bank sentences used; the top sentence and its share of the part):');
  lines.push('');
  lines.push('| Part | Used | Top | Share |');
  lines.push('|---|---|---|---|');
  Object.entries(m.frames).forEach(([k, v]) => lines.push(`| ${k} | ${v.used} | ${v.top} | ${v.topShare}% |`));
  lines.push('');
  lines.push(
    'First-sentence families: ' +
      Object.entries(m.families)
        .map(([k, v]) => `${k} ${v}%`)
        .join(', ') +
      '.',
  );
  lines.push(
    'Top first-sentence shapes: ' +
      m.firstShapesTop5.map(([s, v]) => `“${s}” ${v}%`).join(', ') +
      ` (${m.firstShapes.distinct} distinct).`,
  );
  if (m.banned.total)
    lines.push(
      'Banned phrases: ' +
        Object.entries(m.banned.by)
          .map(([k, v]) => `“${k}” ${v}`)
          .join(', ') +
        '.',
    );
  return lines.join('\n');
}

/* ── The blind test ─────────────────────────────────────────────────── */

function rng(seed) {
  let x = (Number(seed) || 1) >>> 0;
  return () => {
    x = (x + 0x6d2b79f5) >>> 0;
    let t = x;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(xs, rand) {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
/* The control comments: every blockquote paragraph of a Markdown file. */
export function controlsFrom(md) {
  return String(md)
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(p => p.startsWith('>'))
    .map(p =>
      p
        .split('\n')
        .map(l => l.replace(/^>\s?/, ''))
        .join(' ')
        .trim(),
    )
    .filter(Boolean);
}
/* N generated comments (one per student, mode and press drawn by seed)
   shuffled with N controls: { sheet, key } as Markdown. */
export function blindSheet(rows, controls, n, seed) {
  const rand = rng(seed);
  const bySid = {};
  rows.forEach(r => (bySid[r.sid] = bySid[r.sid] || []).push(r));
  const gen = shuffle(Object.keys(bySid), rand)
    .slice(0, n)
    .map(sid => {
      const list = bySid[sid];
      return { text: list[Math.floor(rand() * list.length)].text, src: 'generated' };
    });
  const ctl = shuffle(controls, rand)
    .slice(0, n)
    .map(text => ({ text, src: 'control' }));
  const all = shuffle(gen.concat(ctl), rand);
  const sheet = [
    '# Which Were Written by a Teacher?',
    '',
    `For each comment, write T (a teacher wrote it) or G (it was generated). ${all.length} comments; half are each.`,
    '',
  ];
  const key = ['# Answer Key', '', `Seed ${seed}.`, ''];
  all.forEach((x, i) => {
    sheet.push(`${i + 1}. ${x.text}`, '', '   T / G', '');
    key.push(`${i + 1}. ${x.src === 'control' ? 'T (control)' : 'G (generated)'}`);
  });
  return { sheet: sheet.join('\n'), key: key.join('\n') + '\n' };
}

/* ── CLI ────────────────────────────────────────────────────────────── */

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
async function main() {
  const base = arg('base');
  const from = arg('from');
  let rows;
  if (from) rows = JSON.parse(readFileSync(from, 'utf-8'));
  else if (base) rows = await sample(base);
  else {
    console.error('usage: generate-measure.mjs --base http://localhost:PORT | --from drafts.json');
    process.exit(2);
  }
  const save = arg('save');
  if (save) writeFileSync(save, JSON.stringify(rows, null, 1));
  const m = measure(rows);
  if (process.argv.includes('--json')) console.log(JSON.stringify(m, null, 1));
  else console.log(markdown(m));
  // Fresh seeds (the four-audience review, Nov 4 2026): the frame and
  // shape caps on presses no committed run used, worst of N runs.
  const fresh = Number(arg('fresh', 0));
  let freshFail = false;
  if (fresh && base) {
    const worst = { frame: 0, family: 0, shape: 0 };
    for (let i = 1; i <= fresh; i++) {
      const t = targets(measure(await sample(base, 1000 * i)));
      const num = row => parseFloat(String(row[1]));
      worst.shape = Math.max(worst.shape, num(t[0]));
      worst.family = Math.max(worst.family, num(t[1]));
      worst.frame = Math.max(worst.frame, num(t[2]));
      if (t.some(x => !x[3])) freshFail = true;
    }
    console.log(
      '\nFresh seeds (' +
        fresh +
        ' runs of 216, worst): top first-sentence shape ' +
        worst.shape +
        '%, largest shape family ' +
        worst.family +
        '%, largest frame share of a part ' +
        worst.frame +
        '%; every target met: ' +
        (freshFail ? 'no' : 'yes') +
        '.',
    );
  }
  const n = Number(arg('blind', 0));
  if (n) {
    const controls = controlsFrom(
      readFileSync(arg('controls', resolve(root, 'docs/generate-gold-standin.md')), 'utf-8'),
    );
    const { sheet, key } = blindSheet(rows, controls, n, Number(arg('seed', 7)));
    writeFileSync(arg('sheet', 'blind-sheet.md'), sheet + '\n');
    writeFileSync(arg('key', 'blind-key.md'), key);
  }
  if (process.argv.includes('--strict') && (freshFail || targets(m).some(t => !t[3]))) process.exit(1);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
