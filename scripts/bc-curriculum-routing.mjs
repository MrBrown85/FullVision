#!/usr/bin/env node
/* Which bank names the Comment Bank cannot use.

   The design's name rule says every competency name must route through its
   family's Comment Bank skill table (CommentBank.skillOf in
   teacher/comment-bank.js), and the build must list the names that route
   nowhere: the Comment Bank leaves those competencies out of every strength
   and next-step sentence. This reads data/bc-curriculum-derived.json and
   reports them. It changes nothing; whether to add skill rows or rename is
   the owner's call. It cannot tell a name that routes to the wrong skill
   (a keyword inside another word, as "sequence" in "Consequences"); those
   still need reading by hand.

   Usage: node scripts/bc-curriculum-routing.mjs [--list] */
import { readFileSync } from 'fs';
import vm from 'vm';

const source = JSON.parse(readFileSync('data/bc-curriculum-source.json', 'utf-8'));
const derived = JSON.parse(readFileSync('data/bc-curriculum-derived.json', 'utf-8'));

const ctx = { console };
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ['shared/comment-bank.js', 'teacher/comment-realiser.js', 'teacher/comment-bank.js'])
  vm.runInContext(readFileSync(f, 'utf-8'), ctx, { filename: f });
const CB = ctx.CommentBank;

// The bank's subject strings, as CommentBank's own FAMILIES maps them.
const FAMILY = {
  'Applied Design, Skills and Technologies': 'adst',
  'Arts Education': 'arts',
  'Career Education': 'career',
  'English Language Arts': 'ela',
  Mathematics: 'math',
  'Physical and Health Education': 'pe',
  Science: 'science',
  'Social Studies': 'socials',
};

const unrouted = {};
let rows = 0;
let missed = 0;
for (const [key, course] of Object.entries(derived)) {
  if (key.startsWith('_')) continue;
  const family = FAMILY[source[key].subject];
  for (const cat of course.categories)
    for (const c of cat.competencies) {
      rows++;
      if (CB.skillOf(family, c.short_label)) continue;
      missed++;
      const names = (unrouted[family] = unrouted[family] || {});
      (names[c.short_label] = names[c.short_label] || []).push(key);
    }
}

// A name can be unrouted in more than one family ("Collaboration").
const pairs = Object.values(unrouted).reduce((n, names) => n + Object.keys(names).length, 0);
const distinct = new Set(Object.values(unrouted).flatMap(names => Object.keys(names))).size;
console.log(
  `${missed} of ${rows} competencies route to no Comment Bank skill: ` +
    `${pairs} family and name pairs, ${distinct} distinct names`,
);
for (const [family, names] of Object.entries(unrouted).sort()) {
  console.log(`  ${family}: ${Object.keys(names).length} names`);
  if (process.argv.includes('--list'))
    for (const [name, keys] of Object.entries(names).sort())
      console.log(
        `    ${name} (${keys.length}: ${[...new Set(keys)].slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''})`,
      );
}
