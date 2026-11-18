#!/usr/bin/env node
/**
 * Refresh tests/fixtures/adblock-hidden-names.txt from EasyList: its generic
 * element-hiding rules that name one class or id (##.name, ###name) or a
 * name's start (##[class^="..."], ##[id^="..."]). tests/adblock-names.test.js
 * fails if FullVision uses one of them, because ad blockers hide it.
 */
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://easylist.to/easylist/easylist.txt';
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'adblock-hidden-names.txt');

const res = await fetch(URL);
if (!res.ok) throw new Error('EasyList answered ' + res.status);
const keep = new Set();
for (const line of (await res.text()).split('\n')) {
  const l = line.trim();
  if (/^##[.#][A-Za-z0-9_-]+$/.test(l) || /^##\[(class|id)\^="[^"]+"\]$/.test(l)) keep.add(l.slice(2));
}
const today = new Date().toISOString().slice(0, 10);
const head = [
  "! EasyList's generic element-hiding rules that name one class or id (##.name, ###name) or match a name's start ([class^=...]),",
  '! from ' + URL + ' on ' + today + '. Ad blockers (Wipr, uBlock, AdBlock) hide any element they match,',
  '! so FullVision must never use these names: tests/adblock-names.test.js. Refresh with: node scripts/refresh-adblock-names.mjs',
];
writeFileSync(OUT, head.concat([...keep].sort()).join('\n') + '\n');
console.log('Wrote ' + keep.size + ' names to ' + OUT);
