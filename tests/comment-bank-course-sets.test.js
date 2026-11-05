/**
 * Per-course-set wording (Colin, Nov 4: "each set of courses gets its own
 * wording"): data/bc-curriculum-sets.json (scripts/build-course-sets.mjs),
 * shipped as shared/bank-sets.js. Generate names a competency by its own
 * set's phrase and next step at the student's level, drafts the set's
 * strength, next-step and home sentences for the competencies the comment
 * is about, and verify() proves each by competency and level. A sensitive
 * set (abuse and exploitation) is never drafted from.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const data = JSON.parse(readFileSync('data/bc-curriculum-sets.json', 'utf-8'));
const ican = JSON.parse(readFileSync('data/bc-curriculum-ican.json', 'utf-8'));
const courses = JSON.parse(readFileSync('curriculum_by_course.json', 'utf-8'));
const SHE = { subj: 'she', obj: 'her', poss: 'her', refl: 'herself' };

function day(n) {
  const d = new Date(2026, 8, 1 + n);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
/* A competency from the BC bank, scored on three pieces of its own. */
const comp = (id, name, level, bankId, n = 3) => ({
  id,
  name,
  bankId,
  scores: Array.from({ length: n }, (_, i) => ({ id: id + 'w' + i, d: day(i * 7), v: level, title: name + ' ' + i })),
  start: level,
  now: level,
  level,
  iCans: [],
});
function student(course, family, comps, over) {
  const work = [];
  comps.forEach(c =>
    c.scores.forEach(s => work.push({ id: s.id, title: s.title, d: s.d, v: s.v, pct: null, note: '' })),
  );
  return Object.assign(
    {
      cid: 'sets-' + course,
      sid: 's1',
      name: 'Ava',
      first: 'Ava',
      course,
      family,
      pronouns: SHE,
      pronounsOnFile: true,
      comps,
      work,
      voice: {},
      confidence: [],
      record: { total: work.length, handed: work.length, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: { completes: 4, ready: 4, others: 3, part: 3, feedback: 4, devices: 4 },
      overall: 3,
      standing: 'Proficient',
      letter: '',
      grade: { mode: 'proficiency', pieces: [] },
      levelText: v => ['', 'Emerging', 'Developing', 'Proficient', 'Extending'][Math.round(v)] || '',
      enrolled: '',
      classStart: '',
      termStart: '',
      classLines: { support: [], pick: null, closing: '', late: '', charLimit: null },
    },
    over,
  );
}
const draftOf = (f, seed = 1) => CommentBank.draft(CommentBank.context(f, {}), { seed });
const fill = t => CommentRealiser.render(CommentRealiser.tokens(t), { name: 'Ava', p: SHE }, { named: true });

describe('the data (scripts/build-course-sets.mjs)', () => {
  const gradeOf = {};
  Object.values(courses).forEach(c =>
    c.categories.forEach(cat => cat.competencies.forEach(x => (gradeOf[x.id] = Number(c.grade)))),
  );

  it('puts every competency in exactly one set, at the band for its course grade', () => {
    const ids = Object.keys(ican).filter(k => !k.startsWith('_'));
    expect(Object.keys(data.competencies).sort()).toEqual(ids.sort());
    ids.forEach(id => {
      const key = data.competencies[id];
      expect(data.sets[key], id).toBeTruthy();
      const band = key.split('|')[1];
      if (band !== 'all') expect(band, id).toBe(gradeOf[id] >= 10 ? '10-12' : '8-9');
    });
  });

  it('ships the same wording in shared/bank-sets.js, every field filled', () => {
    Object.keys(data.competencies).forEach(id => {
      const x = data.sets[data.competencies[id]];
      const e = CommentBank.setEntry(id);
      expect(e.phrase, id).toBe(x.phrase);
      expect(e.steps.Developing, id).toBe(x.next_steps.developing);
      expect(e.strength, id).toEqual(x.strength);
      expect(e.next.Extending, id).toBe(x.next.extending);
      expect(e.home, id).toBe(x.home || '');
      expect(e.sensitive, id).toBe(!!x.sensitive);
      if (!x.sensitive) expect(e.home, id).not.toBe('');
    });
  });

  it('every set sentence and phrase passes the vocabulary lint', () => {
    const bad = [];
    Object.keys(data.sets).forEach(k => {
      const x = data.sets[k];
      const all = x.strength.concat(Object.values(x.next), x.home ? [x.home] : []);
      all.forEach(t => CommentLint.findings(t).length && bad.push([k, t, CommentLint.findings(t)]));
      [x.phrase].concat(Object.values(x.next_steps)).forEach(t => {
        const f = CommentLint.findings('She can ' + t + '.');
        if (f.length) bad.push([k, t, f]);
      });
    });
    expect(bad).toEqual([]);
  });
});

describe('Generate in a course set’s own words', () => {
  it('a Philosophy 12 student gets philosophy wording, never the history phrasing', () => {
    const f = student('Philosophy 12', 'socials', [
      comp('ev', 'Evidence', 3.1, 'bc.phil12.cc.4'),
      comp('pe', 'Perspective', 3.7, 'bc.phil12.cc.7'),
      comp('ca', 'Cause & Consequence', 2.1, 'bc.phil12.cc.6'),
    ]);
    expect(CommentBank.skillFor(f, f.comps[1]).skill).toBe(CommentBank.setEntry('bc.phil12.cc.7').phrase);
    expect(CommentBank.levelStepOf(f).text).toBe(CommentBank.setEntry('bc.phil12.cc.6').steps.Developing);
    for (let seed = 1; seed <= 6; seed++) {
      const d = draftOf(f, seed);
      expect(d.text, d.text).toMatch(/philosoph|thinker|idea|argument|perspective|system of thought/i);
      expect(d.text, d.text).not.toMatch(
        /\b(past event|an event|historical|primary source|source and its evidence)\b/i,
      );
      expect(d.replaced).toEqual([]);
      expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    }
  });

  it('a Food Studies student gets food wording; the set sentences are drafted and proved', () => {
    const f = student('Food Studies 10', 'adst', [
      comp('ws', 'Workspace Capacity', 3.7, 'bc.fs10.cc.5'),
      comp('pv', 'Points of View', 3.1, 'bc.fs10.cc.2'),
      comp('cf', 'Competing Factors', 2.1, 'bc.fs10.cc.7'),
    ]);
    const seen = {};
    for (let seed = 1; seed <= 8; seed++) {
      const d = draftOf(f, seed);
      expect(d.text, d.text).toMatch(/food|kitchen|meal|cook/i);
      d.ids.filter(id => /^set:/.test(id)).forEach(id => (seen[id] = true));
      expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
    }
    // The strength's set sentences and the next step's home line.
    expect(Object.keys(seen).some(id => /^set:ws:s[01]$/.test(id))).toBe(true);
    expect(seen['set:cf:h']).toBe(true);
    const d = draftOf(f, 1);
    const home = d.sentences.find(x => x.step === 'home');
    expect(home.text).toBe(fill(CommentBank.setEntry('bc.fs10.cc.7').home).replace(/^Ava/, 'Ava'));
  });

  it('verify() fails a set sentence once its competency drops below Proficient or changes level', () => {
    const f = student('Food Studies 10', 'adst', [
      comp('ws', 'Workspace Capacity', 3.7, 'bc.fs10.cc.5'),
      comp('pv', 'Points of View', 3.1, 'bc.fs10.cc.2'),
      comp('cf', 'Competing Factors', 2.1, 'bc.fs10.cc.7'),
    ]);
    let d = null;
    for (let seed = 1; seed <= 12 && !d; seed++) {
      const x = draftOf(f, seed);
      if (x.ids.some(id => /^set:ws:s/.test(id))) d = x;
    }
    expect(d).toBeTruthy();
    const lower = { ...f, comps: f.comps.map(c => (c.id === 'ws' ? { ...c, level: 2.2, now: 2.2 } : c)) };
    const v = CommentBank.verify(d, lower, {});
    expect(v.replaced.some(r => /^set:ws:s/.test(r.sentenceId))).toBe(true);
    // Before the set file loads, a saved set sentence stands as written.
    const saved = window.BANK_SETS;
    window.BANK_SETS = null;
    try {
      const w = CommentBank.verify(d, f, {});
      expect(w.text).toContain(d.sentences.find(x => /^set:ws:s/.test(x.id)).text);
    } finally {
      window.BANK_SETS = saved;
    }
  });

  it('Browse offers the set sentences under each of the student’s competencies, by name', () => {
    const f = student('Food Studies 10', 'adst', [
      comp('ws', 'Workspace Capacity', 3.7, 'bc.fs10.cc.5'),
      comp('pv', 'Points of View', 3.1, 'bc.fs10.cc.2'),
      comp('cf', 'Competing Factors', 2.1, 'bc.fs10.cc.7'),
    ]);
    const ctx = CommentBank.context(f, {});
    const strengths = ReportQuestionnaire.browseList('strengths', ctx, {});
    const ws = strengths.groups.find(g => g.label === 'Workspace Capacity');
    expect(ws.rows.length).toBe(2);
    expect(strengths.groups.find(g => g.label === 'Points of View').rows.length).toBe(2);
    // No strength for the competency at Developing; its next step and home.
    expect(strengths.groups.find(g => g.label === 'Competing Factors')).toBeUndefined();
    const next = ReportQuestionnaire.browseList('nextStep', ctx, {});
    expect(next.groups.find(g => g.label === 'Competing Factors').rows.length).toBe(1);
    expect(next.groups.find(g => g.label === 'Competing Factors · For the Family').rows.length).toBe(1);
    expect(next.rows.filter(r => /^set:cf:/.test(r.id)).every(r => r.fits)).toBe(true);
  });
});

describe('a sensitive set (abuse and exploitation) is never drafted from', () => {
  it('a student whose lowest competency is Safety Strategies gets the next competency’s step, and no abuse wording', () => {
    const f = student('Physical and Health Education 9', 'pe', [
      comp('sa', 'Safety Strategies', 1.6, 'bc.phe9.cc.12'),
      comp('mv', 'Movement Skills', 2.4, 'bc.phe9.cc.1'),
      comp('ht', 'Healthy Choices', 3.6, 'bc.phe9.cc.8'),
    ]);
    expect(CommentBank.isSensitive(f.comps[0])).toBe(true);
    expect(CommentBank.nextStepOf(f.comps).id).toBe('mv');
    expect(CommentBank.skillFor(f, f.comps[0])).toBeNull();
    const e = CommentBank.setEntry('bc.phe9.cc.12');
    const words = /abus|exploit|unsafe|trusted adult|warning sign/i;
    for (let seed = 1; seed <= 8; seed++) {
      const d = draftOf(f, seed);
      expect(d.text, d.text).not.toMatch(words);
      d.sentences.forEach(x => expect([e.phrase].concat(e.strength, Object.values(e.next))).not.toContain(x.text));
      expect(d.ids.filter(id => /^set:sa:/.test(id))).toEqual([]);
    }
    // Browse may offer its strength and next sentences, never a home line.
    const ctx = CommentBank.context(f, {});
    const sa = ctx._extra.filter(s => /^set:sa:/.test(s.id));
    expect(sa.length).toBeGreaterThan(0);
    expect(sa.every(s => s.browse)).toBe(true);
    expect(sa.some(s => /:h$/.test(s.id))).toBe(false);
    expect(e.home).toBe('');
  });
});

describe('comments written before the course sets', () => {
  it('a sentence in the cluster wording still verifies once the sets load: a change of wording is not a change of marks', () => {
    const f = student('Philosophy 12', 'socials', [
      comp('ev', 'Evidence', 3.1, 'bc.phil12.cc.4'),
      comp('pe', 'Perspective', 3.7, 'bc.phil12.cc.7'),
      comp('ca', 'Cause & Consequence', 2.1, 'bc.phil12.cc.6'),
    ]);
    const saved = window.BANK_SETS;
    window.BANK_SETS = null;
    let d;
    try {
      d = draftOf(f, 1);
    } finally {
      window.BANK_SETS = saved;
    }
    expect(d.ids.some(id => /^set:/.test(id))).toBe(false);
    expect(CommentBank.verify(d, f, {}).replaced).toEqual([]);
  });
});
