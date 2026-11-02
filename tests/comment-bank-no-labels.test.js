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
            .filter(s => s.group !== 'Teacher' && CommentBank.fits(s, ctx))
            .forEach(s => {
              offered++;
              const text = CommentBank.fill(s, ctx);
              expect(text, s.id).not.toMatch(/“I can/);
              labels.forEach(l => expect(text.includes(l), s.id + ': ' + l + ' in ' + text).toBe(false));
            });
        });
      });
      expect(offered).toBeGreaterThan(100);
    });
  });
});
