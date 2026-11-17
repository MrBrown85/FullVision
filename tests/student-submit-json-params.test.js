import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/* student-submit hands the database JSON as text. postgres.js serializes a
   parameter the server types as jsonb with JSON.stringify, so JSON text
   passed to `$4::jsonb` reaches the function as a JSON string, not an
   object: on Nov 17 2026 every student's About Me was refused as invalid
   that way (and sending work, Reflect, replies and revisions would have
   been). `$4::text::jsonb` types the parameter as text and the cast makes
   the object. A value built with sql.json (index.ts, submit) is the other
   safe way. */
const dir = join(__dirname, '..', 'supabase', 'functions', 'student-submit');

describe('student-submit: JSON parameters go as text', () => {
  const files = readdirSync(dir).filter(f => f.endsWith('.ts'));
  it('no statement casts a numbered parameter straight to jsonb or json', () => {
    const bad = [];
    files.forEach(f => {
      readFileSync(join(dir, f), 'utf-8')
        .split('\n')
        .forEach((line, i) => {
          if (/\$\d+::jsonb?\b/.test(line)) bad.push(f + ':' + (i + 1));
        });
    });
    expect(bad).toEqual([]);
  });
  it('the eight statements that take JSON cast it from text', () => {
    const all = files.map(f => readFileSync(join(dir, f), 'utf-8')).join('\n');
    const fns = [
      'answer',
      'reflect',
      'reply',
      'revision_start',
      'revision_finish',
      'send_start',
      'replace',
      'send_finish',
    ];
    fns.forEach(fn => {
      const m = all.match(new RegExp("'select student_submit\\." + fn + '\\(([^)]*)\\) as r'));
      expect(m, fn).toBeTruthy();
      expect(m[1], fn).toContain('$4::text::jsonb');
    });
  });
});
