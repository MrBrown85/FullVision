/**
 * data/bc-curriculum-comment.json (a comment phrase and three next steps per
 * competency cluster) and data/bc-curriculum-proficiency.json (four
 * proficiency descriptors per competency) are written ahead of time and
 * shipped as data; the app makes no AI calls. Every card string also passes
 * the app's vocabulary lint (CommentLint), as every bank sentence does, and
 * a version 2 card (Nov 4 2026) carries three phrasings of each form.
 */
import './setup.js';
import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const read = f => JSON.parse(readFileSync(f, 'utf-8'));
const comment = read('data/bc-curriculum-comment.json');
const prof = read('data/bc-curriculum-proficiency.json');
const ican = read('data/bc-curriculum-ican.json');
const source = read('data/bc-curriculum-source.json');
const scale = read('data/bc-proficiency-scale.json');

const clusters = Object.entries(comment).filter(([k]) => !k.startsWith('_'));
const entries = Object.entries(prof).filter(([k]) => !k.startsWith('_'));
const icanIds = Object.keys(ican).filter(k => !k.startsWith('_'));

const grade = {};
for (const [key, c] of Object.entries(source)) {
  if (key.startsWith('_')) continue;
  for (const cat of c.categories) for (const x of cat.competencies) grade[x.id] = c.grade;
}

const LEVELS = ['emerging', 'developing', 'proficient', 'extending'];
// What each level's descriptors say, and the Ministry anchor it must come from.
const ECHO = {
  emerging: 'beginning to',
  developing: 'with growing consistency',
  proficient: 'consistently',
  extending: 'depth and complexity',
};
const SCALE_NAME = { emerging: 'Emerging', developing: 'Developing', proficient: 'Proficient', extending: 'Extending' };
const DEFICIT = /\b(not yet|unable|lacks?|fails?|failing|poor|poorly|still|struggles?|weak|weakness)\b/i;
const SHAME = /\b(again|only|finally|unfortunately)\b/i;
const PRAISE = /\b(best|most|strongest|excellent|amazing|great|perfect|perfectly|always|never)\b/i;
const FUTURE = /\bwill\b/i;
const PRONOUN = /\b(he|she|his|her|hers|him|their|theirs|my|our|I|me|you|your)\b/;
const CODE = /\b[A-Z]{2,}\b/;
const words = t => t.trim().split(/\s+/).length;
const cap = g => (g <= 8 ? 12 : g <= 10 ? 15 : 20);
const sha16 = t => createHash('sha256').update(t, 'utf8').digest('hex').slice(0, 16);

function phraseProblems(t, max) {
  const out = [];
  if (typeof t !== 'string' || !t) return ['missing'];
  if (words(t) > max) out.push(`${words(t)} words`);
  if (!/^[a-z]/.test(t)) out.push('not lowercase');
  if (/^\w+ing\b/.test(t) && !/^(bring|sing)\b/.test(t)) out.push('starts with an -ing word');
  if (/[.;:!?()]$|[;()]/.test(t)) out.push('punctuation');
  for (const re of [DEFICIT, SHAME, PRAISE, FUTURE]) if (re.test(t)) out.push('word: ' + t.match(re)[0]);
  if (PRONOUN.test(t)) out.push('pronoun: ' + t.match(PRONOUN)[0]);
  if (CODE.test(t)) out.push('code: ' + t.match(CODE)[0]);
  if (/competenc|curricul|learning standard/i.test(t)) out.push('curriculum term');
  return out;
}

describe('BC curriculum comment phrases', () => {
  it('has one entry for every I Can cluster, with its exemplar', () => {
    const fromIcan = new Set(icanIds.map(id => ican[id].cluster));
    expect(new Set(clusters.map(([k]) => k))).toEqual(fromIcan);
    for (const [k, c] of clusters) {
      expect(ican[c.exemplar], k).toBeTruthy();
      expect(ican[c.exemplar].cluster, k).toBe(k);
    }
  });

  it('gives every cluster a short plain phrase that finishes "{He} can …"', () => {
    const bad = clusters
      .map(([k, c]) => [k, phraseProblems(c.phrase, 9)])
      .filter(([, p]) => p.length)
      .map(([k, p]) => `${k}: ${p.join(', ')}`);
    expect(bad).toEqual([]);
  });

  it('gives every cluster three different next steps that finish "Next, {he} can …"', () => {
    const bad = [];
    for (const [k, c] of clusters) {
      const n = c.next_steps || {};
      for (const L of ['emerging', 'developing', 'proficient']) {
        const p = phraseProblems(n[L], 12);
        if (p.length) bad.push(`${k} ${L}: ${p.join(', ')}`);
      }
      if (new Set([n.emerging, n.developing, n.proficient]).size !== 3) bad.push(`${k}: next steps repeat`);
      // Version 2 adds the Extending step (plan v1 section 2); version 1 has three.
      const levels = Object.keys(n).sort().join();
      if (
        levels !== 'developing,emerging,proficient' &&
        !(c.forms && levels === 'developing,emerging,extending,proficient')
      )
        bad.push(`${k}: wrong next-step levels`);
    }
    expect(bad).toEqual([]);
  });

  it('ties each phrase to a skill key or to none', () => {
    for (const [k, c] of clusters) expect(c.skill_key === null || /^[a-z][A-Za-z]+$/.test(c.skill_key), k).toBe(true);
  });
});

/* Every string a card holds, with where it goes in a comment: the frame
   a string is said in, so the lint and the word cap read it as a family
   would. */
function cardStrings(k, c) {
  const out = [['phrase', c.phrase, '{He} can ' + c.phrase + '.']];
  for (const [L, t] of Object.entries(c.next_steps || {}))
    out.push(['next ' + L, t, '{His} next step is to ' + t + '.']);
  const f = c.forms || {};
  (f.base || []).forEach((t, i) => out.push(['base ' + i, t, 'Next, {he} can ' + t + '.']));
  (f.did || []).forEach((t, i) => out.push(['did ' + i, t, 'In {his} best piece, {he} ' + t + '.']));
  for (const [L, xs] of Object.entries(f.at || {}))
    xs.forEach((t, i) => out.push([`at ${L} ${i}`, t, 'In {his} work, {he} ' + t + '.']));
  (c.home || []).forEach((t, i) => out.push(['home ' + i, t, 'At home, ' + t + '.']));
  if (c.area) out.push(['area', c.area, '{His} strongest area is ' + c.area + '.']);
  if (c.evidence) out.push(['evidence', c.evidence, '{He} shows it in ' + c.evidence + '.']);
  return out;
}

describe('every card string passes the vocabulary lint', () => {
  it('has no phrasal verb, evaluative word, comparison or praise word, in its frame', () => {
    const bad = [];
    for (const [k, c] of clusters)
      for (const [where, , said] of cardStrings(k, c)) {
        const found = CommentLint.findings(said);
        if (found.length) bad.push(`${k} ${where}: ${found.join('; ')}`);
      }
    expect(bad).toEqual([]);
  });
});

describe('version 2 cards', () => {
  const v2 = clusters.filter(([, c]) => c.forms);
  const PAST = t => CommentLint.startsPastTense(t);
  // The eight sample cards, and every Science 8 cluster Demo Mode uses
  // (written Nov 4 2026 so the showcase class reads well; each marked for
  // Colin's five-card read).
  const SCIENCE8 = [
    'sci-assumptions-bias',
    'sci-contributing-to-care',
    'sci-data-recording',
    'sci-data-representation',
    'sci-drawing-conclusions',
    'sci-evidence',
    'sci-hypotheses',
    'sci-idea-generation',
    'sci-implications',
    'sci-informed-skepticism',
    'sci-inquiry-questions',
    'sci-investigation-plans',
    'sci-local-environment',
    'sci-method-reflection',
    'sci-observation',
    'sci-place-perspectives',
    'sci-predictions',
    'sci-project-design',
    'sci-safety-ethics',
    'sci-sharing-findings',
    'sci-sources-of-error',
    'sci-sustained-inquiry',
    'sci-transfer-of-learning',
    'sci-unit-conversions',
    'sci-variable-control',
    'sci-ways-of-knowing',
  ];
  it('marks every Science 8 card for the five-card read, and gives each level three other ways to say its step', () => {
    SCIENCE8.forEach(k => {
      const c = comment[k];
      expect(c.prov && c.prov.review, k).toMatch(/five-card read/);
      expect(c.prov.approved_by_owner, k).toBe(false);
      ['emerging', 'developing', 'proficient', 'extending'].forEach(L => {
        const xs = c.forms.next[L];
        expect(xs, k + ' ' + L).toHaveLength(3);
        expect(new Set(xs.concat(c.next_steps[L])).size, k + ' ' + L).toBe(4);
      });
    });
  });
  it('includes the eight sample cards and the Science 8 cards', () => {
    expect(v2.map(([k]) => k).sort()).toEqual(
      SCIENCE8.concat([
        'adst-prototype-testing',
        'arts-artistic-choices',
        'car-self-assessment',
        'ela-idea-exploration',
        'math-justification',
        'phe-movement-concepts',
        'sci-data-patterns',
        'ss-evi',
      ]).sort(),
    );
  });
  it('gives three phrasings of every form, the phrase first, and the rest of the schema', () => {
    const bad = [];
    for (const [k, c] of v2) {
      const f = c.forms;
      if (f.base[0] !== c.phrase) bad.push(`${k}: base[0] is not the phrase`);
      const three = {
        base: f.base,
        did: f.did,
        home: c.home,
        ...Object.fromEntries(Object.entries(f.at).map(([L, x]) => ['at ' + L, x])),
      };
      for (const [w, xs] of Object.entries(three)) {
        if (!Array.isArray(xs) || xs.length !== 3 || new Set(xs).size !== 3)
          bad.push(`${k} ${w}: not three different phrasings`);
      }
      if (Object.keys(f.at).sort().join() !== 'developing,extending,proficient') bad.push(`${k}: at levels`);
      if (!c.area || !c.evidence || !c.next_steps.extending) bad.push(`${k}: area, evidence or Extending step missing`);
      f.did.forEach(t => PAST(t) || bad.push(`${k} did: not past tense: ${t}`));
      c.home.forEach(
        t => /^(ask|invite|tell|show|talk|share|let)\b/.test(t) || bad.push(`${k} home: not an invitation verb: ${t}`),
      );
      for (const [where, t] of cardStrings(k, c)) {
        if (!/^[a-z{]/.test(t)) bad.push(`${k} ${where}: not lowercase`);
        if (/[.;!?]$/.test(t)) bad.push(`${k} ${where}: punctuation`);
        if (/\b(he|she|his|her|him|hers)\b/.test(t.replace(/\{\w+\}|\[[^\]]*\]/g, '')))
          bad.push(`${k} ${where}: a pronoun outside a slot`);
      }
    }
    expect(bad).toEqual([]);
  });
  it('fills every frame that takes a string within 24 words', () => {
    const bad = [];
    for (const [k, c] of clusters)
      for (const [where, , said] of cardStrings(k, c))
        if (CommentRealiser.wordCount(said) > 24) bad.push(`${k} ${where}: ${CommentRealiser.wordCount(said)} words`);
    expect(bad).toEqual([]);
  });
});

describe('BC curriculum proficiency descriptors', () => {
  it('covers every competency once, in its own cluster', () => {
    expect(entries.map(([k]) => k).sort()).toEqual([...icanIds].sort());
    for (const [id, e] of entries) expect(e.cluster, id).toBe(ican[id].cluster);
  });

  it("takes each level's wording from the Ministry scale", () => {
    for (const L of LEVELS) {
      const level = scale.levels.find(l => l.name === SCALE_NAME[L]);
      expect(level.anchor, L).toContain(ECHO[L]);
    }
  });

  it('writes four one-sentence teacher-voice levels, each with its anchor, under the grade cap', () => {
    const bad = [];
    for (const [id, e] of entries) {
      const lv = e.levels || {};
      if (Object.keys(lv).sort().join() !== [...LEVELS].sort().join()) bad.push(`${id}: levels`);
      for (const L of LEVELS) {
        const d = lv[L] || '';
        const why = [];
        if (!d.startsWith('The student ')) why.push('opening');
        if (!d.endsWith('.') || /[.;!?]\s/.test(d)) why.push('one sentence');
        if (words(d) > cap(grade[id])) why.push(`${words(d)} words, cap ${cap(grade[id])}`);
        if (!d.includes(ECHO[L])) why.push('anchor');
        if (L !== 'proficient' && L !== 'developing' && /\bconsistently\b/.test(d)) why.push('says consistently');
        for (const re of [DEFICIT, SHAME, PRAISE, FUTURE]) if (re.test(d)) why.push('word: ' + d.match(re)[0]);
        if (why.length) bad.push(`${id} ${L}: ${why.join(', ')}`);
      }
      if (new Set(LEVELS.map(L => lv[L])).size !== 4) bad.push(`${id}: levels repeat`);
    }
    expect(bad).toEqual([]);
  });

  it('puts the Emerging verb in base form', () => {
    const bad = entries
      .filter(([, e]) => /beginning to \w+(es|s)\b/.test(e.levels.emerging))
      .filter(
        ([, e]) =>
          !/beginning to (assess|discuss|express|process|access|address|focus|cross)\b/.test(e.levels.emerging),
      )
      .map(([id, e]) => `${id}: ${e.levels.emerging}`);
    expect(bad).toEqual([]);
  });

  it('keeps the same skill across the four levels', () => {
    // The key words of Proficient (5+ letters, past the qualifier) appear in the other three.
    const STOP = new Set(['student', 'consistently', 'growing', 'consistency', 'beginning', 'depth', 'complexity']);
    const key = t =>
      (t.toLowerCase().match(/[a-z]{5,}/g) || [])
        .filter(w => !STOP.has(w))
        .map(w =>
          w
            .replace(/ies$/, 'y')
            .replace(/([a-z])s$/, '$1')
            .slice(0, 5),
        );
    const bad = [];
    for (const [id, e] of entries) {
      const want = [...new Set(key(e.levels.proficient))];
      for (const L of ['emerging', 'developing', 'extending']) {
        const have = new Set(key(e.levels[L]));
        const miss = want.filter(w => !have.has(w));
        if (miss.length > Math.floor(want.length / 3)) bad.push(`${id} ${L}: ${miss.join(',')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('records what each entry was written from, so a change to either flags it', () => {
    const bad = [];
    for (const [id, e] of entries) {
      const p = e.prov || {};
      if (!['exemplar', 'reused', 'adapted'].includes(p.method)) bad.push(`${id}: method`);
      if (p.raw_sha !== ican[id].prov.raw_sha) bad.push(`${id}: raw_sha`);
      if (p.ican_sha !== sha16(ican[id].i_can_statements.join('\n'))) bad.push(`${id}: ican_sha`);
      if (ican[p.exemplar]?.cluster !== e.cluster) bad.push(`${id}: exemplar`);
      if (p.method === 'reused' && JSON.stringify(e.levels) !== JSON.stringify(prof[p.exemplar].levels))
        bad.push(`${id}: reused levels differ from the exemplar's`);
    }
    expect(bad).toEqual([]);
  });
});
