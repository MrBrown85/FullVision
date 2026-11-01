/**
 * The docs say what the code does. docs/ARCHITECTURE.md's shared script
 * order matches teacher/app.html, every page and phone module is named
 * there, and no doc points sessions at the old work lists as current.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = rel => readFileSync(new URL('../' + rel, import.meta.url), 'utf-8');
const arch = read('docs/ARCHITECTURE.md');

describe('docs/ARCHITECTURE.md', () => {
  it("lists the shared scripts in teacher/app.html's order", () => {
    const loaded = [...read('teacher/app.html').matchAll(/<script src="\/([^"]+)"/g)]
      .map(m => m[1])
      .filter(src => src.startsWith('shared/') || src.startsWith('vendor/'));
    const section = arch.slice(
      arch.indexOf('Shared runtime modules load'),
      arch.indexOf('The phone loads the same list'),
    );
    const listed = [...section.matchAll(/^\d+\. .*?`((?:shared|vendor)\/[^`]+)`/gm)].map(m => m[1]);
    // Every shared script up to rubric-checks.js; later ones belong to features.
    const core = loaded.slice(0, loaded.indexOf('shared/rubric-checks.js') + 1);
    expect(listed).toEqual(core);
  });

  it('names every desktop page module and every phone module', () => {
    const pages = readdirSync(new URL('../teacher/', import.meta.url)).filter(f => /^page-.*\.js$/.test(f));
    const phone = readdirSync(new URL('../teacher-mobile/', import.meta.url)).filter(f => f.endsWith('.js'));
    const missing = [...pages, ...phone].filter(f => !arch.includes('`' + f + '`') && !arch.includes(f));
    expect(missing).toEqual([]);
  });

  it('names the boot RPC the app calls', () => {
    expect(read('shared/data.js')).toContain("'get_class_bundle'");
    expect(arch).toContain('get_class_bundle');
  });
});

describe('docs/DECISIONS.md', () => {
  it('links only to files in the repo', () => {
    const decisions = read('docs/DECISIONS.md');
    expect(decisions).not.toMatch(/`~\//);
    const broken = [...decisions.matchAll(/\]\(([^)#:]+)\)/g)]
      .map(m => m[1])
      .filter(link => {
        try {
          readFileSync(new URL('../docs/' + link, import.meta.url));
          return false;
        } catch (e) {
          return true;
        }
      });
    expect(broken).toEqual([]);
  });
});

describe('the work list', () => {
  it('no doc calls codex.md or HANDOFF.md the current work list', () => {
    ['README.md', 'CLAUDE.md', 'docs/ARCHITECTURE.md'].forEach(rel => {
      expect(read(rel)).not.toMatch(/only (?:active|live) work list/i);
    });
  });
});
