/**
 * The derived verb forms (teacher/comment-forms.js; Colin, Nov 4 2026,
 * decision 4): "does" and "doing" come from each card's base phrases by
 * rule, with a spelling table and a per-card override. The listing of every
 * derived form is tests/__forms__/derived-forms.txt, for review: a change
 * to the rule or to any card's wording shows there.
 */
import './setup.js';
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { cardV2 } from '../scripts/build-curriculum-bank.mjs';

const F = CommentForms;
const comment = JSON.parse(readFileSync('data/bc-curriculum-comment.json', 'utf-8'));
const cards = Object.entries(comment).filter(([k]) => !k.startsWith('_'));

describe('the spelling rule', () => {
  it.each([
    ['find', 'finds', 'finding'],
    ['explain', 'explains', 'explaining'],
    ['use', 'uses', 'using'],
    ['make', 'makes', 'making'],
    ['plan', 'plans', 'planning'],
    ['set', 'sets', 'setting'],
    ['carry', 'carries', 'carrying'],
    ['identify', 'identifies', 'identifying'],
    ['analyze', 'analyzes', 'analyzing'],
    ['discuss', 'discusses', 'discussing'],
    ['reach', 'reaches', 'reaching'],
    ['do', 'does', 'doing'],
    ['have', 'has', 'having'],
    ['be', 'is', 'being'],
    ['see', 'sees', 'seeing'],
    ['tie', 'ties', 'tying'],
    ['agree', 'agrees', 'agreeing'],
    ['argue', 'argues', 'arguing'],
    ['play', 'plays', 'playing'],
    ['leave', 'leaves', 'leaving'],
  ])('%s → %s, %s', (v, does, doing) => {
    expect(F.third(v)).toBe(does);
    expect(F.gerund(v)).toBe(doing);
  });

  it('inflects a second verb after "and" or "or", never a noun', () => {
    expect(F.does('explore and explain the local environment')).toBe('explores and explains the local environment');
    expect(F.doing('explain and justify math ideas and decisions')).toBe(
      'explaining and justifying math ideas and decisions',
    );
    expect(F.does('show data patterns in tables, graphs and models')).toBe(
      'shows data patterns in tables, graphs and models',
    );
    expect(F.does('compare and the rest')).toBe('compares and the rest');
    // After a one-word object, the second predicate's verb too; a describing
    // word or a compound noun stays as written.
    expect(F.does('observe nature and ask questions about it')).toBe('observes nature and asks questions about it');
    expect(F.doing('find problems and troubleshoot them')).toBe('finding problems and troubleshooting them');
    expect(F.does('use feedback and test results to make changes')).toBe(
      'uses feedback and test results to make changes',
    );
    expect(F.does('use personal and work networks to explore opportunities')).toBe(
      'uses personal and work networks to explore opportunities',
    );
  });

  it('takes a card override over the rule', () => {
    const o = { 'proofread a draft': { does: 'proofreads a draft', doing: 'proofreading a draft' } };
    expect(F.does('proofread a draft', o)).toBe('proofreads a draft');
    expect(F.doing('lead a warm-up', { 'lead a warm-up': { doing: 'leading the warm-up' } })).toBe(
      'leading the warm-up',
    );
  });
});

describe('every derived form, printed for review', () => {
  it('matches tests/__forms__/derived-forms.txt', async () => {
    const lines = [];
    for (const [k, c] of cards.sort(([a], [b]) => a.localeCompare(b))) {
      const v = cardV2(c);
      v.forms.base.forEach(b => {
        lines.push(`${k}: ${b} | she ${F.does(b, v.forms.override)} | at ${F.doing(b, v.forms.override)}`);
      });
    }
    await expect(lines.join('\n') + '\n').toMatchFileSnapshot('./__forms__/derived-forms.txt');
  });
});

describe('schema version 2 in the build step and the engine', () => {
  it('migrates a version 1 card: forms.base is the phrase, the rest empty', () => {
    const v = cardV2({
      phrase: 'ask a clear question',
      skill_key: 'q',
      next_steps: { emerging: 'a', developing: 'b', proficient: 'c' },
      exemplar: 'x',
    });
    expect(v.version).toBe(1);
    expect(v.forms).toEqual({
      base: ['ask a clear question'],
      did: [],
      at: { developing: [], proficient: [], extending: [] },
      override: {},
    });
    expect(v.next_steps.extending).toBe('');
    expect(v.home).toEqual([]);
    expect(v.area).toBe('');
  });

  it('reads a version 2 card with its forms, and a version 1 card with the phrase alone', () => {
    const v2 = CommentBank.bankEntry('bc.sci8.cc.14');
    expect(v2.v2).toBe(true);
    expect(v2.forms.base[0]).toBe('find patterns and trends in data');
    expect(v2.forms.does[0]).toBe('finds patterns and trends in data');
    expect(v2.forms.doing[1]).toBe('finding the pattern in a set of results');
    expect(v2.forms.at.Extending).toHaveLength(3);
    expect(v2.steps.Extending).toBe('explain why a result that does not fit the pattern might have happened');
    expect(v2.area).toBe('reading data');
    const v1 = CommentBank.bankEntry('bc.sci8.cc.11');
    expect(v1.v2).toBe(false);
    expect(v1.forms.base).toEqual([v1.phrase]);
    expect(v1.forms.did).toEqual([]);
    expect(v1.forms.at.Proficient).toEqual([]);
    expect(v1.steps.Extending).toBe('');
  });
});
