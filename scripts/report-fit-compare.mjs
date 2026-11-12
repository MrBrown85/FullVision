#!/usr/bin/env node
/**
 * Where every block of a Progress Report lands, for every Demo student, so
 * two builds can be compared side for side (Assignment Grades layout,
 * 2026-11-12: no report may gain a sheet and no block may land on a later
 * side than on main).
 *
 * Lays out, in Demo Mode on a served build: every built-in template, with
 * Assignment Grades' Proficiency Word on, off and auto; a custom form
 * (Letterhead, Proficiency, Assignment Grades in two columns, a 6-line
 * comment); Letterhead + Assignment Grades in one and two columns at Row
 * and Side by Side width; and e2e/report-studio.spec.js's Report Card with
 * Assignment Grades on the Back and on the Front. Each in a Proficiency,
 * Both and Letter class, on Letter and Legal paper, in the machine's fonts
 * and with a wider font forced on the sheet (Verdana / DejaVu Sans, letters
 * 0.03em further apart, as the browser specs do).
 *
 * For each layout it records the sheets and sides, each block's first and
 * last side, and every Assignment Grades mark cut off in its cell.
 *
 *   npm run build:e2e && PORT=8445 node scripts/e2e-server.mjs   # in each checkout
 *   node scripts/report-fit-compare.mjs --base http://localhost:8445 --out main.json
 *   node scripts/report-fit-compare.mjs --compare main.json branch.json
 */
/* global document, window, getStudents, getAssessments, ReportSheets, ReportBlocks, COURSES, displayNameWithLast */
import { chromium } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';

const WIDE_FONT = `.report-sheet, .report-sheet * {
  font-family: Verdana, 'DejaVu Sans', sans-serif !important;
  letter-spacing: 0.03em !important;
}`;

const arg = name => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
};

async function collect(base, wide) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ timezoneId: 'UTC' });
    await page.goto(base + '/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 30000 });
    await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
    if (wide) await page.addStyleTag({ content: WIDE_FONT });
    await page.evaluate(r => window.Router.navigate(r), '/reports');
    await page.getByRole('tab', { name: 'Progress Reports' }).click();
    await page.waitForSelector('#studio');
    return await page.evaluate(() => {
      const cid = 'sci8';
      const S = ReportSheets;
      const form = sides =>
        S.normalizeForm({ v: 6, id: 'custom', name: 'Custom', type: 'standard', sides, perStudent: {} });
      const row = (...cells) => ({ cells });
      const gt = options => ({ block: 'grade-table', size: 'row', options });
      const withWord = (f, word) => {
        const copy = JSON.parse(JSON.stringify(f));
        copy.sides.forEach(sd =>
          sd.rows.forEach(r =>
            r.cells.forEach(c => {
              if (c.block === 'grade-table') c.options = Object.assign({}, c.options, { word });
            }),
          ),
        );
        return S.normalizeForm(copy);
      };
      const forms = {};
      const WORDS = [true, false, 'auto'];
      S.starters().forEach(st =>
        WORDS.forEach(w => (forms[`starter ${st.id} word ${w}`] = withWord(S.starter(st.id), w))),
      );
      WORDS.forEach(w => {
        forms[`review form word ${w}`] = form([
          {
            rows: [
              row({ block: 'header', size: 'row' }),
              row({ block: 'proficiency', size: 'row' }),
              row(gt({ columns: 'two', word: w })),
              row({ block: 'teacher-narrative', size: 'row', lines: 6 }),
            ],
          },
        ]);
        for (const columns of ['one', 'two'])
          for (const half of [false, true])
            forms[`grades ${columns} ${half ? 'half' : 'row'} word ${w}`] = form([
              {
                rows: [
                  row({ block: 'header', size: 'row' }),
                  row(...[gt({ columns, word: w })].concat(half ? [{ block: 'proficiency', size: 'half' }] : [])),
                ],
              },
            ]);
        for (const front of [false, true]) {
          const g = gt({ range: 'term', columns: 'two', organize: 'category', word: w });
          forms[`studio report card, grades on the ${front ? 'Front' : 'Back'}, word ${w}`] = S.normalizeForm({
            v: 6,
            id: 'report-card',
            name: 'Report Card',
            type: 'standard',
            pinned: 'parent-response',
            perStudent: {},
            sides: [
              {
                rows: [
                  row({ block: 'header', size: 'row' }),
                  row({ block: 'proficiency', size: 'row' }),
                  row({ block: 'legend', size: 'row' }),
                  row({ block: 'teacher-narrative', size: 'row', lines: 10 }),
                  row({ block: 'term-attendance', size: 'half' }, { block: 'missing-work', size: 'half' }),
                ].concat(front ? [row(g)] : []),
              },
              {
                rows: [row({ block: 'self-assessment', size: 'row' })]
                  .concat(front ? [] : [row(g)])
                  .concat([row({ block: 'parent-response', size: 'row', lines: 3 })]),
              },
            ],
          });
        }
      });
      const host = document.createElement('div');
      host.className = 'rb-preview';
      host.style.cssText = 'position:absolute;left:0;top:0;width:1200px;';
      document.body.appendChild(host);
      const out = {};
      const ctx = ReportBlocks.reportContext();
      const students = getStudents(cid);
      const was = COURSES[cid].gradingSystem;
      try {
        for (const mode of ['proficiency', 'both', 'letter']) {
          COURSES[cid].gradingSystem = mode;
          for (const [name, f] of Object.entries(forms))
            for (const paper of ['letter', 'legal']) {
              const preview = document.createElement('div');
              host.appendChild(preview);
              const sum = S.renderPreview({ preview, paper, form: f, cid, students, ctx });
              students.forEach(st => {
                const el = preview.querySelector('.sheet-student[data-sid="' + st.id + '"]');
                const place = {};
                [...el.querySelectorAll('.sheet-zoom')].forEach((z, i) =>
                  z.querySelectorAll('.sheet-cell[data-block]').forEach(c => {
                    const b = c.getAttribute('data-block');
                    place[b] = place[b] ? [place[b][0], i] : [i, i];
                  }),
                );
                const cut = [...el.querySelectorAll('.report-grades-figs')]
                  .filter(c => c.scrollWidth > c.clientWidth + 1)
                  .map(c => c.textContent);
                const past = [...el.querySelectorAll('.report-sheet .sheet-body')].filter(
                  b => b.scrollHeight > b.clientHeight + 1,
                ).length;
                const ps = sum.perStudent[st.id];
                out[[mode, name, paper, displayNameWithLast(st)].join(' | ')] = {
                  sheets: ps.sheets,
                  sides: ps.sides,
                  place,
                  cut: [...new Set(cut)],
                  past,
                  html: [...el.querySelectorAll('.report-grades')].map(g => g.outerHTML).join(''),
                };
              });
              preview.remove();
            }
        }
      } finally {
        COURSES[cid].gradingSystem = was;
        host.remove();
      }
      return out;
    });
  } finally {
    await browser.close();
  }
}

function compare(mainFile, nowFile) {
  const a = JSON.parse(readFileSync(mainFile, 'utf8'));
  const b = JSON.parse(readFileSync(nowFile, 'utf8'));
  const rows = {};
  const worse = [];
  const letterDiff = [];
  for (const font of Object.keys(a)) {
    for (const k of Object.keys(a[font])) {
      const x = a[font][k];
      const y = b[font][k];
      const mode = k.split(' | ')[0];
      const key = font + ' | ' + mode;
      const r = rows[key] || (rows[key] = { identical: 0, improved: 0, worse: 0 });
      let later = false;
      let earlier = x.sheets > y.sheets || x.sides > y.sides;
      if (y.sheets > x.sheets || y.sides > x.sides) later = true;
      Object.keys(x.place).forEach(blk => {
        const p = x.place[blk];
        const q = y.place[blk] || p;
        if (q[0] > p[0] || q[1] > p[1]) later = true;
        if (q[0] < p[0] || q[1] < p[1]) earlier = true;
      });
      if (mode === 'letter' && (x.html !== y.html || JSON.stringify(x.place) !== JSON.stringify(y.place)))
        letterDiff.push(font + ' | ' + k);
      if (later) {
        r.worse++;
        worse.push({
          font,
          layout: k,
          main: [x.sheets, x.sides, x.place],
          now: [y.sheets, y.sides, y.place],
          mainCut: x.cut,
        });
      } else if (earlier) r.improved++;
      else r.identical++;
    }
  }
  return { rows, worse, letterDiff };
}

if (process.argv.includes('--compare')) {
  const i = process.argv.indexOf('--compare');
  const res = compare(process.argv[i + 1], process.argv[i + 2]);
  console.log('font | class | identical | improved | worse');
  Object.entries(res.rows).forEach(([k, r]) => console.log(`${k} | ${r.identical} | ${r.improved} | ${r.worse}`));
  console.log('Letter layouts whose block HTML or placement differ:', res.letterDiff.length);
  res.worse.forEach(w =>
    console.log(
      'WORSE',
      w.font,
      '|',
      w.layout,
      '| main',
      JSON.stringify(w.main),
      '| now',
      JSON.stringify(w.now),
      '| cut on main:',
      JSON.stringify(w.mainCut),
    ),
  );
} else {
  const base = arg('--base') || 'http://localhost:8445';
  const outFile = arg('--out');
  const res = { own: await collect(base, false), wide: await collect(base, true) };
  writeFileSync(outFile, JSON.stringify(res));
  console.log('wrote', outFile, Object.keys(res.own).length, 'layouts per font');
}
