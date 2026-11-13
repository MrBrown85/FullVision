/**
 * scripts/db-rebuild.mjs: its pure helpers. The rebuild itself needs a
 * local PostgreSQL and is run by hand (docs/database-rebuild.md).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HEADER,
  isLocalUrl,
  lineDifferences,
  parseColumn,
  parseSnapshot,
  splitBaseline,
  statementAt,
  tablesFromSnapshot,
  withoutHeader,
  withoutKnown,
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
procedure public.nightly()
event trigger ensure_rls on ddl_command_end runs public.rls_auto_enable()
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
      { schema: 'public', name: 'nightly', args: '', returns: null, definer: false },
    ]);
  });

  it('reads the committed snapshot whole', () => {
    const snap = parseSnapshot(readFileSync(new URL('../docs/schema.generated.sql', import.meta.url), 'utf-8'));
    expect(snap.tables.length).toBeGreaterThan(50);
    expect(snap.functions.length).toBeGreaterThan(200);
  });
});

describe('tablesFromSnapshot', () => {
  const { tables, keys } = tablesFromSnapshot(SAMPLE);

  it('makes each table with bare columns', () => {
    expect(tables).toContain('create table public.note (\n  id uuid not null,\n  body text,');
    expect(tables).not.toContain('default');
  });

  it('adds defaults, then keys, then foreign keys, indexes, triggers and row security', () => {
    const at = s => keys.indexOf(s);
    expect(at('set default gen_random_uuid()')).toBeLessThan(at('add constraint note_pkey'));
    expect(at('add constraint note_pkey')).toBeLessThan(at('add constraint note_course_id_fkey'));
    expect(keys).toContain('CREATE INDEX note_course_idx');
    expect(keys).toContain('CREATE TRIGGER note_touch AFTER UPDATE');
    expect(keys).toContain('alter table public.note enable row level security;');
  });

  it('leaves out an index a constraint already made, and the policies', () => {
    expect(keys).not.toContain('CREATE UNIQUE INDEX note_pkey');
    expect(keys).not.toContain('policy');
  });
});

describe('splitBaseline', () => {
  it('splits the output at its file lines', () => {
    const out = 'set\n-- @file a.sql\ncreate x;\n\n-- @file b.txt\n\n-- @file c.sql\none\ntwo\n';
    expect(splitBaseline(out)).toEqual({ 'a.sql': 'create x;\n', 'b.txt': '\n', 'c.sql': 'one\ntwo\n' });
  });

  it('strips the header a committed part starts with', () => {
    expect(withoutHeader(HEADER + 'create x;\n')).toBe('create x;\n');
    expect(withoutHeader('create x;\n')).toBe('create x;\n');
  });
});

describe('withoutKnown', () => {
  const live = "  constraint tag_score_modifier_check CHECK ((((m >= '-1'::integer) AND (m <= 1)) AND (NOT (v = 1))))";
  const rebuilt = "  constraint tag_score_modifier_check CHECK (((m >= '-1'::integer) AND (m <= 1) AND (NOT (v = 1))))";

  it('accepts the flattened AND in a named check', () => {
    expect(withoutKnown({ onlyA: [live], onlyB: [rebuilt] })).toEqual({
      onlyA: [],
      onlyB: [],
      accepted: ['tag_score_modifier_check'],
    });
  });

  it('keeps any other difference, even in a named check', () => {
    const other = rebuilt.replace('v = 1', 'v = 2');
    expect(withoutKnown({ onlyA: [live], onlyB: [other] }).onlyA).toEqual([live]);
    const a = live.replace('tag_score', 'note');
    const b = rebuilt.replace('tag_score', 'note');
    expect(withoutKnown({ onlyA: [a], onlyB: [b] }).onlyA).toEqual([a]);
  });
});

describe('lineDifferences', () => {
  it('lists lines only on each side, counting repeats', () => {
    expect(lineDifferences('a\nb\nb', 'b\nc')).toEqual({ onlyA: ['a', 'b'], onlyB: ['c'] });
  });
});
