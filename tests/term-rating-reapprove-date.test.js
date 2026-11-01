/**
 * migrations/20261102_term_rating_reapprove_date.sql: re-approving a comment
 * in the same save that changes its narrative dates the approval now, not the
 * old approval date. The behaviour itself is tested on a local Postgres by
 * migrations/local-test/term_rating_reapprove.py.
 */
import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('migrations/20261102_term_rating_reapprove_date.sql', 'utf-8');
const prev = readFileSync('migrations/20261031_term_rating_draft_meta.sql', 'utf-8');
const fn = s => s.slice(s.indexOf('create or replace function public.save_term_rating'), s.indexOf('$function$;'));

describe('save_term_rating re-approval date', () => {
  it('dates a re-approval now when the narrative changed, and keeps the old date otherwise', () => {
    expect(sql).toMatch(
      /when p_payload \? 'approved' and \(p_payload->>'approved'\)::boolean then\s+case when _new_nar is distinct from _old\.narrative_html then now\(\)\s+else coalesce\(_old\.approved_at, now\(\)\) end/,
    );
    expect(sql).not.toMatch(/::boolean then coalesce\(_old\.approved_at, now\(\)\)/);
  });

  it('still clears on approved: false and on an edit without the approved key', () => {
    expect(sql).toMatch(
      /when p_payload \? 'approved' then null\s+when _new_nar is distinct from _old\.narrative_html then null/,
    );
  });

  it('changes nothing else in the function', () => {
    const before = fn(prev).replace(
      'then coalesce(_old.approved_at, now())\n',
      'then\n            case when _new_nar is distinct from _old.narrative_html then now()\n                 else coalesce(_old.approved_at, now()) end\n',
    );
    expect(fn(sql)).toBe(before);
  });
});
