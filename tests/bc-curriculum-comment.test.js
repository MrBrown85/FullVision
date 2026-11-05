/**
 * data/bc-curriculum-comment.json (a comment phrase and three next steps per
 * competency cluster) and data/bc-curriculum-proficiency.json (four
 * proficiency descriptors per competency) are written ahead of time and
 * shipped as data; the app makes no AI calls. These checks are separate from
 * the lint the cards were written against.
 */
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
      if (Object.keys(n).sort().join() !== 'developing,emerging,proficient') bad.push(`${k}: wrong next-step levels`);
    }
    expect(bad).toEqual([]);
  });

  it('ties each phrase to a skill key or to none', () => {
    for (const [k, c] of clusters) expect(c.skill_key === null || /^[a-z][A-Za-z]+$/.test(c.skill_key), k).toBe(true);
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
