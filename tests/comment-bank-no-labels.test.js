/**
 * No shared bank sentence names a competency by its bare label or quotes a
 * first-person I Can into the third-person comment (Colin's comment
 * standard; Nov 2). The 15 Next Step frames that did ({focus}: “{nextStep}”,
 * {focusLow}, {growthAreas}) are retired; the next step comes from the
 * bank's level step or the skill table. The label slots stay for a
 * teacher's own sentences (comment-personal.js), where the teacher typed the
 * label. Demo Mode (Science 8), both reports.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { runInThisContext } from 'vm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const LABEL_SLOTS = ['focus', 'focusLow', 'growthAreas', 'nextStep', 'rise', 'fall', 'selfStrong', 'selfLow'];

describe('no bare competency labels in the shared bank', () => {
  it('no shared sentence prints a label slot or a quoted I Can', () => {
    COMMENT_BANK.sentences.forEach(s => {
      LABEL_SLOTS.forEach(k => expect(s.text, s.id).not.toContain('{' + k + '}'));
    });
    ['g01', 'g03', 'g101', 'g104', 'g107', 'g201', 'g223'].forEach(id =>
      expect(
        COMMENT_BANK.sentences.some(s => s.id === id),
        id,
      ).toBe(false),
    );
  });

  it('keeps a retired sentence in a saved draft as written', () => {
    const f = {
      cid: 'retired',
      sid: 's1',
      name: 'Noor',
      first: 'Noor',
      family: 'science',
      pronouns: { subj: 'they', obj: 'them', poss: 'their', refl: 'themselves' },
      pronounsOnFile: true,
      comps: [],
      work: [],
      voice: {},
      confidence: [],
      record: { total: 0, handed: 0, late: 0, missing: 0 },
      notHandedIn: { count: 0, titles: [], groups: [] },
      habits: {},
      overall: 0,
      standing: '',
      letter: '',
      grade: { mode: 'proficiency', pieces: [] },
      levelText: () => '',
      classLines: { support: [], pick: null, closing: '', late: '', charLimit: null },
    };
    const text = 'Their next step is in Evidence: “I can weigh evidence.”';
    const d = {
      text,
      sentences: [{ id: 'g01', step: 'nextStep', text }],
      provenance: [{ sentenceId: 'g01', values: {}, sources: {}, facts: [] }],
    };
    const r = CommentBank.verify(d, f, {});
    expect(r.replaced).toEqual([]);
    expect(r.sentences[0].text).toBe(text);
  });

  describe('Demo Mode: every sentence a student is offered', () => {
    let cid, saved;
    beforeAll(() => {
      saved = window.isDemoMode;
      window.isDemoMode = () => true;
      localStorage.clear();
      runInThisContext(readFileSync('shared/seed-data.js', 'utf-8'), { filename: 'shared/seed-data.js' });
      seedIfNeeded();
      cid = 'sci8';
    });
    afterAll(() => {
      setActiveTerm(cid, null);
      window.isDemoMode = saved;
      localStorage.clear();
    });

    it('names no competency label and quotes no I Can', () => {
      let offered = 0;
      [1, 2].forEach(r => {
        setActiveTerm(cid, r);
        getStudents(cid).forEach(st => {
          const f = CommentBank.facts(cid, st, 'term-' + r);
          const ctx = CommentBank.context(f, {});
          const labels = f.comps.map(c => c.name).filter(Boolean);
          COMMENT_BANK.sentences
            .filter(s => CommentBank.fits(s, ctx))
            .forEach(s => {
              offered++;
              const text = CommentBank.fill(s, ctx);
              expect(text, s.id).not.toMatch(/“I can/);
              labels.forEach(l => {
                const word = new RegExp('(^|[^A-Za-z])' + l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z])');
                expect(word.test(text), s.id + ': ' + l + ' in ' + text).toBe(false);
              });
            });
        });
      });
      expect(offered).toBeGreaterThan(100);
    });
  });
});
