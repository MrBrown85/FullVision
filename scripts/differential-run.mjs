#!/usr/bin/env node
/**
 * The differential run: proves two builds of FullVision behave the same for
 * a teacher. It drives build A and build B with the same seeded sequence of
 * teacher actions and, after every step, compares the device's saved copy,
 * the calls sent to the server and, every few steps, what the teacher and a
 * student see. It stops at the first difference.
 *
 *   node scripts/differential-run.mjs --a <dir or URL> --b <dir or URL>
 *        --seed <n> --steps <n> [--mode signed-in|demo|both]
 *        [--offline] [--two-tabs] [--screens-every <n>]
 *
 * A build is a repo checkout with dist/ built (npm run build:e2e), a built
 * site folder, or a URL serving one. See docs/differential-run.md.
 *
 * Exit code: 0 when nothing differed, 1 at the first difference, 2 when the
 * run could not be done.
 */
import { chromium } from '@playwright/test';

// e2e/helpers.js is an ES module in a package without "type": "module", and
// Node says so once when it loads. The warning is about the repo, not the
// run, so it is dropped; the run's own modules load after this.
process.removeAllListeners('warning');
process.on('warning', w => {
  if (w.code !== 'MODULE_TYPELESS_PACKAGE_JSON') console.warn(w);
});
const { ACTIONS } = await import('./differential/actions.mjs');
const { compareCalls, compareScreens, compareStorage } = await import('./differential/compare.mjs');
const { makeRng } = await import('./differential/prng.mjs');
const { go, readIndexedDb, readScreens, readStorage, readView, takeCalls, tick } =
  await import('./differential/probe.mjs');
const { serve } = await import('./differential/serve.mjs');
const { DRAIN_CHUNKS, PHONE, advance, newSession, openTab, tabsOf, waitForApp } =
  await import('./differential/session.mjs');

function parseArgs(argv) {
  const opts = { mode: 'both', seed: 1, steps: 100, offline: false, twoTabs: false, screensEvery: 25, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    const v = () => argv[++i];
    if (k === '--a') opts.a = v();
    else if (k === '--b') opts.b = v();
    else if (k === '--seed') opts.seed = Number(v());
    else if (k === '--steps') opts.steps = Number(v());
    else if (k === '--mode') opts.mode = v();
    else if (k === '--offline') opts.offline = true;
    else if (k === '--two-tabs') opts.twoTabs = true;
    else if (k === '--screens-every') opts.screensEvery = Number(v());
    else if (k === '--quiet') opts.quiet = true;
    else if (k === '--help' || k === '-h') opts.help = true;
    else throw new Error('Unknown option ' + k);
  }
  return opts;
}

const USAGE =
  'node scripts/differential-run.mjs --a <dir or URL> --b <dir or URL> --seed <n> --steps <n>\n' +
  '  [--mode signed-in|demo|both] [--offline] [--two-tabs] [--screens-every <n>]';

/* The run's own actions, beside the teacher actions in actions.mjs. */
const RELOAD = { kind: 'reload', weight: 1 };
const PHONE_ACTIONS = [
  { kind: 'phoneGrade', weight: 60 },
  { kind: 'phoneUndo', weight: 30 },
];

class Difference extends Error {
  constructor(step, action, lines) {
    super('difference');
    this.step = step;
    this.action = action;
    this.lines = lines;
  }
}

function describe(kind, args) {
  return kind + (args && Object.keys(args).length ? ' ' + JSON.stringify(args) : '');
}

/* Who the screens show, picked by name. */
function screenWho(view, mode) {
  const byName = name => view.students.find(s => s.name === name);
  const names =
    mode === 'demo'
      ? ['Sam Blackwood', 'Cece Adeyemi', 'Liam Chen']
      : ['Student3 L03', 'Student8 L08', 'Student12 L12'];
  const chosen = names.map(byName).filter(Boolean);
  while (chosen.length < 3 && view.students.length > chosen.length) {
    const next = view.students.find(s => !chosen.includes(s));
    if (!next) break;
    chosen.push(next);
  }
  const piece =
    view.assessments.find(a => a.rubricId && a.criteria.length) ||
    view.assessments.find(a => a.scoreMode !== 'points') ||
    view.assessments[0];
  return {
    grader: chosen[0] && piece ? [chosen[0].id, piece.id] : null,
    student: chosen[0] && chosen[0].id,
    preview: chosen.slice(1, 3).map(s => s.id),
  };
}

/* The run's fixed blocks, by step. In every stretch of up to 200 steps: a
   second tab open for a block (--two-tabs), the device offline for ten
   steps then back online with the outbox drained (--offline), and the
   phone app open for a block. Outside them one desktop tab does it all. */
function blocksFor(opts) {
  const c = Math.min(200, opts.steps);
  const at = f => Math.floor(f * c);
  return {
    cycle: c,
    tab2: opts.twoTabs ? [at(0.2), at(0.2) + Math.max(5, at(0.15))] : null,
    offline: opts.offline ? [at(0.5), at(0.5) + 10] : null,
    phone: [at(0.75), at(0.75) + Math.max(5, at(0.125))],
  };
}
const inBlock = (b, off) => !!b && off >= b[0] && off < b[1];

const STEP_LIMIT_MS = 30000;
const SCREENS_LIMIT_MS = 90000;

class StepTimeout extends Error {}

function withLimit(promise, ms, what) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, fail) => {
      timer = setTimeout(() => fail(new StepTimeout(what + ' took over ' + ms / 1000 + ' s')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function runMode(browser, urls, mode, opts) {
  const rng = makeRng(opts.seed * 2654435761 + (mode === 'demo' ? 17 : 0));
  const counts = { steps: 0, actions: {}, keys: 0, calls: 0, screens: 0, records: 0 };
  const blocks = blocksFor(opts);
  const sides = [];
  for (const [label, url] of [
    ['A', urls.a],
    ['B', urls.b],
  ]) {
    const s = await newSession(browser, { url, mode, seed: opts.seed });
    s.label = label;
    sides.push(s);
  }
  const both = fn => Promise.all(sides.map(fn));
  let offline = false;
  try {
    await both(async s => {
      s.tab1 = await openTab(s, '/gradebook');
    });

    /* Set-up, the same in A and B: the gradebook on its Scores view and
       Reports on the Quick Report, so reading the screens later changes
       nothing that is saved. */
    await both(async s => {
      const p = s.tab1;
      const cid = await p.evaluate(() => getActiveCourse());
      await go(p, '/reports?course=' + cid);
      const tab = p.locator('[data-action="switchTab"]', { hasText: 'Progress Reports' });
      if (await tab.count()) await tab.click();
      await tick(p);
      const quick = p.locator('[data-action="progressMode"][data-mode="grade"]');
      if (await quick.count()) await quick.click();
      await tick(p);
      await go(p, '/gradebook?course=' + cid);
      const scores = p.locator('[data-action="setView"][data-mode="scores"]');
      if (await scores.count()) await scores.click();
      await advance(s);
    });

    const named = s =>
      [
        ['tab1', s.tab1],
        ['tab2', s.tab2],
        ['phone', s.phone],
      ].filter(([, p]) => p && !p.isClosed());

    const takeAll = s =>
      (async () => {
        const out = [];
        for (const [name, p] of named(s)) for (const c of await takeCalls(p)) out.push({ tab: name, ...c });
        return out;
      })();

    async function compareNow(step, action, withScreens) {
      const lines = [];
      const [sa, sb] = await both(s => readStorage(s.tab1));
      lines.push(...compareStorage(sa, sb));
      counts.keys += Object.keys(sa).length;
      const [ia, ib] = await both(s => readIndexedDb(s.tab1));
      const flat = x =>
        Object.fromEntries(
          Object.entries(x).flatMap(([store, rows]) => Object.entries(rows).map(([k, v]) => [store + ' ' + k, v])),
        );
      const fa = flat(ia);
      lines.push(...compareStorage(fa, flat(ib), 'IndexedDB'));
      counts.records += Object.keys(fa).length;
      const [ca, cb] = await both(takeAll);
      lines.push(...compareCalls(ca, cb));
      counts.calls += ca.length;
      const [ea, eb] = sides.map(s => s.errors.splice(0));
      if (JSON.stringify(ea) !== JSON.stringify(eb))
        lines.push('page errors: A ' + JSON.stringify(ea) + ' | B ' + JSON.stringify(eb));
      if (!lines.length && withScreens) {
        const view = await readView(sides[0].tab1);
        const who = screenWho(view, mode);
        const [xa, xb] = await withLimit(
          both(async s => {
            const out = await readScreens(s.tab1, view.cid, who);
            await go(s.tab1, '/gradebook?course=' + view.cid);
            await advance(s);
            return out;
          }),
          SCREENS_LIMIT_MS,
          'Reading the screens after step ' + step,
        );
        lines.push(...compareScreens(xa, xb));
        counts.screens += Object.keys(xa).length;
        // Reading the screens sends nothing and saves nothing; if it did, it shows here.
        const [sa2, sb2] = await both(s => readStorage(s.tab1));
        lines.push(...compareStorage(sa2, sb2));
        const [ra, rb] = await both(takeAll);
        lines.push(...compareCalls(ra, rb));
      }
      if (lines.length) throw new Difference(step, action, lines);
    }

    await compareNow(0, 'set-up', true);

    async function setOffline(off) {
      offline = off;
      await both(async s => {
        await s.context.setOffline(off);
        await Promise.all(tabsOf(s).map(p => p.evaluate(off => (window.__e2eFailWrites = off), off)));
      });
    }

    /* Open or close a block's tab in A and B. Not a step: what it saved and
       sent is compared at once. */
    async function openExtra(name, path, viewport) {
      await both(async s => {
        s[name] = await openTab(s, path, viewport);
        if (offline) await s[name].evaluate(() => (window.__e2eFailWrites = true));
        await advance(s);
      });
      await compareNow(counts.steps, 'opening ' + name, false);
    }
    async function closeExtra(name) {
      await both(async s => {
        // The app's beforeunload handler would keep the page open (a dialog
        // Playwright dismisses), so the tab is told it is going (pagehide:
        // the outbox lets go, a pending Undo commits) and then closed.
        await s[name].evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
        await advance(s);
        await s[name].close();
        s.pages = s.pages.filter(p => p !== s[name]);
        s[name] = null;
        await advance(s);
      });
      await compareNow(counts.steps, 'closing ' + name, false);
    }

    const teacherActions = ACTIONS.filter(a => !a.modes || a.modes.includes(mode));
    for (let step = 1; step <= opts.steps; step++) {
      counts.steps = step;
      const off = (step - 1) % blocks.cycle;
      const wantTab2 = inBlock(blocks.tab2, off);
      const wantPhone = inBlock(blocks.phone, off);
      const wantOffline = inBlock(blocks.offline, off);
      if (wantTab2 && !sides[0].tab2) await openExtra('tab2', '/assignments');
      if (!wantTab2 && sides[0].tab2) await closeExtra('tab2');
      if (wantPhone && !sides[0].phone) await openExtra('phone', '/teacher-mobile/', PHONE);
      if (!wantPhone && sides[0].phone) await closeExtra('phone');
      if (wantOffline && !offline) await setOffline(true);

      const alone = !wantTab2 && !wantPhone && !wantOffline;
      const menu = [...teacherActions, ...(alone ? [RELOAD] : []), ...(wantPhone ? PHONE_ACTIONS : [])];
      let chosen = null;
      let args = null;
      let tabName = 'tab1';
      for (let tries = 0; tries < 50 && !chosen; tries++) {
        const act = rng.weighted(menu);
        if (!alone && act.kind === 'switchClass') continue;
        tabName = wantTab2 && rng.chance(0.4) && !act.screen ? 'tab2' : 'tab1';
        if (act.kind.startsWith('phone')) {
          tabName = 'phone';
          args = phonePick(act.kind, rng, await readView(sides[0].phone));
        } else if (act.pick) {
          args = act.pick(rng, await readView(sides[0][tabName]), { mode });
          if (!args) continue;
        } else args = {};
        chosen = act;
      }
      if (!chosen) throw new Error('No action could be picked at step ' + step);
      let label = describe(chosen.kind, args) + (tabName !== 'tab1' ? ' (' + tabName + ')' : '');
      counts.actions[chosen.kind] = (counts.actions[chosen.kind] || 0) + 1;

      const t0 = Date.now();
      const doStep = async () => {
        let results;
        if (chosen.kind === 'reload') {
          await both(async s => {
            await s.context.clock.setSystemTime(s.context.__diffNow);
            await s.tab1.reload();
            await waitForApp(s, s.tab1);
          });
          results = ['ok', 'ok'];
        } else if (chosen.kind === 'phoneGrade' || chosen.kind === 'phoneUndo') {
          results = await both(s => phoneRun(s.phone, chosen.kind, args).catch(e => 'threw: ' + e.message));
        } else {
          results = await both(s =>
            chosen.run(s[tabName], args, { mode }).catch(e => 'threw: ' + String(e.message).split('\n')[0]),
          );
        }
        if (JSON.stringify(results[0]) !== JSON.stringify(results[1])) {
          throw new Difference(step, label, [
            'the action answered differently: A ' + JSON.stringify(results[0]) + ' | B ' + JSON.stringify(results[1]),
          ]);
        }
        if (process.env.DIFF_TRACE) console.log(mode, step, label, JSON.stringify(results[0]));
        if (process.env.DIFF_TRACE && String(results[0]).startsWith('threw'))
          await sides[0][tabName].screenshot({ path: '/tmp/fv-s19/diff-threw-' + step + '.png' });
        const ta = Date.now();
        await both(s => advance(s));
        if (process.env.DIFF_TRACE)
          console.log(
            '  advance ' +
              (Date.now() - ta) +
              ' ms, tabs ' +
              tabsOf(sides[0]).length +
              ' ' +
              tabsOf(sides[0])
                .map(p => p.url())
                .join(' '),
          );
        // The last offline step: back online, and the outbox drains with the
        // clock moved past every backoff.
        if (offline && !inBlock(blocks.offline, off + 1)) {
          await setOffline(false);
          await both(async s => {
            await Promise.all(tabsOf(s).map(p => p.evaluate(() => window.v2Queue && window.v2Queue.flush())));
            await advance(s, DRAIN_CHUNKS);
          });
          label += ', then back online';
        }
      };
      await withLimit(doStep(), STEP_LIMIT_MS, 'Step ' + step + ' (' + label + ')');
      if (process.env.DIFF_TRACE) console.log('  ' + (Date.now() - t0) + ' ms');
      const screensNow = opts.screensEvery > 0 && (step % opts.screensEvery === 0 || step === opts.steps);
      await compareNow(step, label, screensNow);
      if (step % 25 === 0 && step < opts.steps)
        console.log(mode + ': step ' + step + ' of ' + opts.steps + ', 0 differences so far');
    }
    return { counts };
  } finally {
    await Promise.all(sides.map(s => s.context.close().catch(() => {})));
  }
}

/* The phone's Grade tab. */
function phonePick(kind, rng, view) {
  const pieces = view.assessments.filter(a => !a.rubricId && a.scoreMode !== 'points' && a.scoreMode !== 'complete');
  const a = rng.pick(pieces);
  const s = rng.pick(view.students);
  if (kind === 'phoneUndo') return {};
  return a && s ? { sid: s.id, aid: a.id, level: rng.pick([1, 2, 3, 4]), mod: rng.pick([0, 0, 1, -1]) } : {};
}

async function phoneRun(page, kind, args) {
  return page.evaluate(
    ({ kind, args }) => {
      // teacher-mobile/tab-grade.js setScore and undoLastScore, through the
      // phone's own Grader actions, with the phone's undo list kept here.
      const cid = getActiveCourse();
      window.__diffPhoneUndo = window.__diffPhoneUndo || [];
      if (kind === 'phoneUndo') {
        const entry = window.__diffPhoneUndo.pop();
        if (!entry) return 'nothing to undo';
        const allScores = getScores(entry.cid);
        const before = structuredClone(allScores);
        const kept = (allScores[entry.sid] || []).filter(s => !(s.assessmentId === entry.aid && s.tagId === entry.tid));
        entry.prev.forEach(p => kept.push(p));
        allScores[entry.sid] = kept;
        Grader.undoOnPhone(entry.cid, entry.sid, entry.aid, before, allScores);
        return 'undone';
      }
      if (!args.sid) return 'nothing to grade';
      const a = getAssessments(cid).find(x => x.id === args.aid);
      const tid = a ? scoreTagIds(a, cid)[0] : null;
      if (!tid) return 'no key';
      const prev = (getScores(cid)[args.sid] || []).filter(s => s.assessmentId === args.aid && s.tagId === tid);
      window.__diffPhoneUndo.push({ cid, sid: args.sid, aid: args.aid, tid, prev: JSON.parse(JSON.stringify(prev)) });
      const existing = prev[prev.length - 1];
      const level = existing && existing.score === args.level ? 0 : args.level;
      Grader.setLevelOnPhone(cid, args.sid, args.aid, tid, level);
      if (level && args.mod) Grader.setPlusMinusOnPhone(cid, args.sid, args.aid, tid, level, args.mod, '');
      return 'ok';
    },
    { kind, args },
  );
}

function summaryLine(mode, counts) {
  const kinds = Object.entries(counts.actions)
    .sort((x, y) => (x[0] < y[0] ? -1 : 1))
    .map(([k, n]) => k + ' ' + n)
    .join(', ');
  return (
    mode +
    ': ' +
    counts.steps +
    ' steps; actions: ' +
    kinds +
    '; keys compared ' +
    counts.keys +
    ', IndexedDB records compared ' +
    counts.records +
    ', calls compared ' +
    counts.calls +
    ', screens compared ' +
    counts.screens +
    '; 0 differences'
  );
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(e.message + '\n' + USAGE);
    return 2;
  }
  if (opts.help || !opts.a || !opts.b) {
    console.log(USAGE);
    return opts.help ? 0 : 2;
  }
  const modes = opts.mode === 'both' ? ['signed-in', 'demo'] : [opts.mode];
  if (!modes.every(m => m === 'signed-in' || m === 'demo')) {
    console.error('--mode is signed-in, demo or both');
    return 2;
  }
  const servers = [];
  let browser = null;
  const started = Date.now();
  try {
    const a = await serve(opts.a, 'A');
    servers.push(a);
    const b = await serve(opts.b, 'B');
    servers.push(b);
    browser = await chromium.launch();
    const flags = (opts.offline ? ' --offline' : '') + (opts.twoTabs ? ' --two-tabs' : '');
    for (const mode of modes) {
      const t0 = Date.now();
      try {
        const { counts } = await runMode(browser, { a: a.url, b: b.url }, mode, opts);
        console.log(
          summaryLine(mode, counts) +
            (opts.quiet ? '' : ' (seed ' + opts.seed + flags + ', ' + Math.round((Date.now() - t0) / 1000) + ' s)'),
        );
      } catch (e) {
        if (e instanceof StepTimeout) {
          console.log(mode + ': STOPPED (seed ' + opts.seed + flags + '): ' + e.message);
          return 2;
        }
        if (!(e instanceof Difference)) throw e;
        console.log(mode + ': DIFFERENCE at step ' + e.step + ' (seed ' + opts.seed + flags + ')');
        console.log('action: ' + e.action);
        for (const line of e.lines.slice(0, 60)) console.log('  ' + line);
        if (e.lines.length > 60) console.log('  … and ' + (e.lines.length - 60) + ' more lines');
        return 1;
      }
    }
    if (!opts.quiet) console.log('Total ' + Math.round((Date.now() - started) / 1000) + ' s');
    return 0;
  } catch (e) {
    console.error('The run could not be done: ' + (e && e.stack ? e.stack : e));
    return 2;
  } finally {
    if (browser) await browser.close().catch(() => {});
    for (const s of servers) await s.stop().catch(() => {});
  }
}

process.exitCode = await main();
