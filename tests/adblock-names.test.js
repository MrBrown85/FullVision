/**
 * No class or id in FullVision may be one an ad blocker hides.
 *
 * Nov 17, 2026: on Colin's Mac (Safari web app with Wipr) Add From Another
 * Class lost every checkbox. EasyList hides `.afc-box` ("AdSense for
 * Content"), the dialog's checkbox class, so each title slid into the
 * checkbox's 18 px column and wrapped one letter to a line. Chrome without a
 * blocker drew it fine, so no test saw it. Students use blockers too.
 *
 * tests/fixtures/adblock-hidden-names.txt is EasyList's generic hiding rules
 * that name one class or id, or a name's start. Refresh it with
 * `node scripts/refresh-adblock-names.mjs`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOT = join(__dirname, '..');
const DIRS = ['teacher', 'teacher-mobile', 'shared', 's', 'help'];
const EXTS = new Set(['.js', '.css', '.html']);

function files(dir) {
  const out = [];
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const n of names) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (EXTS.has(extname(n)) && !/\.min\.js$/.test(n)) out.push(p);
  }
  return out;
}

function rules() {
  const exact = new Set();
  const prefixes = [];
  for (const line of readFileSync(join(__dirname, 'fixtures/adblock-hidden-names.txt'), 'utf8').split('\n')) {
    if (!line || line.startsWith('!')) continue;
    const m = line.match(/^\[(class|id)\^="([^"]+)"\]$/);
    if (m) prefixes.push({ kind: m[1] === 'class' ? '.' : '#', start: m[2] });
    else exact.add(line);
  }
  return { exact, prefixes };
}

// Every class and id the app names: CSS selectors, class="..." and id="..."
// in markup strings, and classList / className / getElementById calls.
function namesIn(text, ext) {
  const out = new Set();
  const add = (sigil, list) =>
    list
      .split(/\s+/)
      .filter(n => /^[A-Za-z_][\w-]*$/.test(n))
      .forEach(n => out.add(sigil + n));
  if (ext === '.css') {
    for (const m of text.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([.#])([A-Za-z_][\w-]*)(?=[^{}]*\{)/g))
      out.add(m[1] + m[2]);
  }
  for (const m of text.matchAll(/class(?:Name)?\s*=\s*["']([^"'<>{}$]+)["']/g)) add('.', m[1]);
  for (const m of text.matchAll(/\bid\s*=\s*["']([A-Za-z_][\w-]*)["']/g)) out.add('#' + m[1]);
  for (const m of text.matchAll(/classList\.(?:add|toggle|contains|remove)\(\s*["']([A-Za-z_][\w-]*)["']/g))
    out.add('.' + m[1]);
  for (const m of text.matchAll(/getElementById\(\s*["']([A-Za-z_][\w-]*)["']/g)) out.add('#' + m[1]);
  for (const m of text.matchAll(/querySelector(?:All)?\(\s*["']([^"']+)["']/g)) {
    for (const s of m[1].matchAll(/([.#])([A-Za-z_][\w-]*)/g)) out.add(s[1] + s[2]);
  }
  return out;
}

describe('ad-blocker names', () => {
  it('the fixture holds the rule that hid Add From Another Class', () => {
    expect(rules().exact.has('.afc-box')).toBe(true);
  });

  it('no class or id in the app is one an ad blocker hides', () => {
    const { exact, prefixes } = rules();
    const hits = [];
    for (const d of DIRS) {
      for (const f of files(join(ROOT, d))) {
        for (const name of namesIn(readFileSync(f, 'utf8'), extname(f))) {
          const bad = exact.has(name) || prefixes.some(p => name[0] === p.kind && name.slice(1).startsWith(p.start));
          if (bad) hits.push(f.slice(ROOT.length + 1) + ': ' + name);
        }
      }
    }
    expect(hits, 'rename these: ad blockers hide them (tests/fixtures/adblock-hidden-names.txt)').toEqual([]);
  });

  it('finds a hidden name where the app would write one', () => {
    const found = namesIn('<input class="row afc-box" id="x">', '.js');
    expect(found.has('.afc-box')).toBe(true);
  });
});
