/**
 * scripts/db-rebuild.mjs: its pure helpers. The rebuild itself needs a
 * local PostgreSQL and is run by hand (docs/database-rebuild.md).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isLocalUrl,
  lineDifferences,
  missingTypes,
  parseColumn,
  parseSnapshot,
  shellFromSnapshot,
  statementAt,
} from '../scripts/db-rebuild.mjs';

const SAMPLE = `-- header

table public.note (rls on)
  id uuid not null default gen_random_uuid()
  body text
  created_at timestamp with time zone not null default now()
  course_id uuid not null
  constraint note_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.course(id) ON DELETE CASCADE
  constraint note_pkey PRIMARY KEY (id)
  CREATE INDEX note_course_idx ON public.note USING btree (course_id)
  CREATE UNIQUE INDEX note_pkey ON public.note USING btree (id)
  CREATE TRIGGER note_touch AFTER UPDATE ON public.note FOR EACH ROW EXECUTE FUNCTION public._touch()
  policy note_owner for all to public using ((EXISTS ( SELECT 1
   FROM public.course c
  WHERE (c.id = note.course_id))))
function public._touch() returns trigger
function public.result_of(p_id uuid) returns public.score_result security definer
`;

describe('isLocalUrl', () => {
  it('accepts only this computer', () => {
    expect(isLocalUrl('postgresql://postgres@127.0.0.1:54417/x')).toBe(true);
    expect(isLocalUrl('postgresql://postgres@localhost/x')).toBe(true);
    expect(isLocalUrl('postgresql://u:p@db.abc.supabase.co:5432/postgres')).toBe(false);
    expect(isLocalUrl('not a url')).toBe(false);
  });
});

describe('statementAt', () => {
  it('gives the whole statement around a line', () => {
    const sql = 'create table a (x int);\ncreate table b (\n  y int\n);\nselect 1;';
    expect(statementAt(sql, 3)).toBe('create table b (\n  y int\n);');
    expect(statementAt(sql, 1)).toBe('create table a (x int);');
  });
});

describe('parseColumn', () => {
  it('splits name, type, not null and default', () => {
    expect(parseColumn('created_at timestamp with time zone not null default now()')).toEqual({
      name: 'created_at',
      type: 'timestamp with time zone',
      notNull: true,
      dflt: 'now()',
    });
    expect(parseColumn('body text')).toEqual({ name: 'body', type: 'text', notNull: false, dflt: null });
  });
});

describe('parseSnapshot', () => {
  it('reads tables, their parts, a policy over several lines, and functions', () => {
    const { tables, functions } = parseSnapshot(SAMPLE);
    expect(tables).toHaveLength(1);
    const t = tables[0];
    expect([t.schema, t.name, t.rls]).toEqual(['public', 'note', true]);
    expect(t.cols.map(c => c.name)).toEqual(['id', 'body', 'created_at', 'course_id']);
    expect(t.cons).toHaveLength(2);
    expect(t.idx).toHaveLength(2);
    expect(t.trg).toHaveLength(1);
    expect(t.pol).toHaveLength(1);
    expect(t.pol[0].split('\n')).toHaveLength(3);
    expect(functions).toEqual([
      { schema: 'public', name: '_touch', args: '', returns: 'trigger', definer: false },
      { schema: 'public', name: 'result_of', args: 'p_id uuid', returns: 'public.score_result', definer: true },
    ]);
  });

  it('reads the committed snapshot whole', () => {
    const snap = parseSnapshot(readFileSync(new URL('../docs/schema.generated.sql', import.meta.url), 'utf-8'));
    expect(snap.tables.length).toBeGreaterThan(50);
    expect(snap.functions.length).toBeGreaterThan(200);
  });
});

describe('missingTypes', () => {
  it('names types a signature uses that no table makes', () => {
    expect(missingTypes(parseSnapshot(SAMPLE))).toEqual(['public.score_result']);
  });
});

describe('shellFromSnapshot', () => {
  const shell = shellFromSnapshot(SAMPLE);
  const at = s => shell.indexOf(s);

  it('makes the table bare, then functions, then defaults and keys', () => {
    expect(shell).toContain('create table public.note (\n  id uuid not null,\n  body text,');
    expect(at('create type public.score_result as ();')).toBeLessThan(at('create table public.note'));
    expect(at('create table public.note')).toBeLessThan(at('create function public._touch()'));
    expect(at('create function public._touch()')).toBeLessThan(at('set default gen_random_uuid()'));
    expect(at('add constraint note_pkey')).toBeLessThan(at('add constraint note_course_id_fkey'));
  });

  it('gives every function a body that only raises', () => {
    expect(shell).toContain(
      'create function public.result_of(p_id uuid) returns public.score_result security definer language plpgsql',
    );
    expect(shell).toContain("raise exception 'shell: public._touch has no body'");
  });

  it('leaves out an index a constraint already made', () => {
    expect(shell).toContain('CREATE INDEX note_course_idx');
    expect(shell).not.toContain('CREATE UNIQUE INDEX note_pkey');
  });

  it('keeps the trigger, row security and the policy as listed', () => {
    expect(shell).toContain('CREATE TRIGGER note_touch AFTER UPDATE');
    expect(shell).toContain('alter table public.note enable row level security;');
    expect(shell).toContain(
      'create policy note_owner on public.note for all to public using ((EXISTS ( SELECT 1\n   FROM public.course c\n  WHERE (c.id = note.course_id))));',
    );
  });
});

describe('lineDifferences', () => {
  it('lists lines only on each side, counting repeats', () => {
    expect(lineDifferences('a\nb\nb', 'b\nc')).toEqual({ onlyA: ['a', 'b'], onlyB: ['c'] });
  });
});
