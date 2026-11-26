// @ts-check
/* shared/health.js — the owner's page, fullvision.ca/health (health.html).
 *
 * Three questions, each answered live when the page opens and every ten
 * minutes while it stays open:
 *   Release: is main safe to release, what is on main and not yet live, and
 *     when was the last release. From GitHub's public data for the repository
 *     (no key): the newest merged pull request into production, the commits
 *     between production and main, and main's CI runs with their jobs.
 *   App health: main's browser tests, and a link to Sentry for errors (the
 *     page holds no Sentry key).
 *   Who uses it: counts across every class from fv_owner_health(), which
 *     answers only to the accounts in fv_private.owner
 *     (migrations/2026112603_owner_health.sql).
 * Text from GitHub goes into the page only as textContent. */
(function () {
  'use strict';

  var REPO = 'MrBrown85/FullVision';
  var API = 'https://api.github.com/repos/' + REPO;
  var EVERY_MS = 10 * 60 * 1000;
  var SHARDS = 4;

  /** @param {string} id @returns {HTMLElement} */
  function $(id) {
    var el = document.getElementById(id);
    if (!el) throw new Error('health.html has no #' + id);
    return el;
  }
  /** @param {string} id @param {string} text */
  function setText(id, text) {
    $(id).textContent = text;
  }
  /** @param {number} n */
  function num(n) {
    return Number(n).toLocaleString('en-CA');
  }
  /** @param {string | number | Date} d */
  function when(d) {
    return new Date(d).toLocaleString('en-CA', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
  /** @param {string} d a YYYY-MM-DD week start */
  function day(d) {
    return new Date(d + 'T00:00:00Z').toLocaleDateString('en-CA', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  }
  /** @param {string} tag @param {string} text @param {string} [cls] */
  function el(tag, text, cls) {
    var node = document.createElement(tag);
    node.textContent = text;
    if (cls) node.className = cls;
    return node;
  }
  /** A link that opens GitHub; only addresses on github.com become links. @param {string} href @param {string} text */
  function link(href, text) {
    if (!/^https:\/\/github\.com\//.test(href)) return el('span', text);
    var a = /** @type {HTMLAnchorElement} */ (el('a', text));
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener';
    return a;
  }
  /** @param {string} id @param {string} text @param {'ok' | 'warn' | 'bad' | ''} tone */
  function pill(id, text, tone) {
    var p = $(id);
    p.textContent = text;
    p.dataset.tone = tone;
  }
  /** One row of cells in a table body. @param {Node[]} cells */
  function row(cells) {
    var tr = document.createElement('tr');
    cells.forEach(function (c) {
      var td = document.createElement('td');
      td.appendChild(c);
      tr.appendChild(td);
    });
    return tr;
  }
  /** A table body with one line of text across it. @param {string} id @param {string} text */
  function tableNote(id, text) {
    var td = el('td', text, 'hl-note');
    td.setAttribute('colspan', '3');
    var tr = document.createElement('tr');
    tr.appendChild(td);
    $(id).replaceChildren(tr);
  }

  /* ── GitHub ─────────────────────────────────────────────────────── */

  /** @param {string} path @returns {Promise<any>} */
  async function gh(path) {
    var res = await fetch(API + path, { headers: { Accept: 'application/vnd.github+json' } });
    if (res.ok) return res.json();
    var reset = Number(res.headers.get('x-ratelimit-reset') || 0);
    if (res.status === 403 || res.status === 429) {
      throw new Error(
        'GitHub’s limit for this hour is used up; ' +
          (reset ? 'it resets at ' + when(reset * 1000) + '.' : 'try again later.'),
      );
    }
    throw new Error('GitHub answered ' + res.status + '.');
  }

  /** The newest pull request merged into production. */
  async function lastRelease() {
    var prs = await gh('/pulls?base=production&state=closed&sort=updated&direction=desc&per_page=20');
    var merged = prs.filter(/** @param {any} p */ p => p.merged_at);
    merged.sort(/** @param {any} a @param {any} b */ (a, b) => Date.parse(b.merged_at) - Date.parse(a.merged_at));
    return merged[0] || null;
  }

  /** Each pull request on main and not on production, newest first, from the commit messages. @param {any[]} commits */
  function prsFrom(commits) {
    /** @type {{ pr: number, title: string, at: string }[]} */
    var out = [];
    commits.forEach(function (c) {
      var lines = String(c.commit.message || '').split('\n');
      var merge = /^Merge pull request #(\d+)/.exec(lines[0]);
      var squash = /\(#(\d+)\)\s*$/.exec(lines[0]);
      if (!merge && !squash) return;
      var n = Number((merge || squash || [])[1]);
      var title = merge ? lines.slice(1).join(' ').trim() : lines[0].replace(/\s*\(#\d+\)\s*$/, '');
      if (!out.some(p => p.pr === n)) out.push({ pr: n, title: title || lines[0], at: c.commit.committer.date });
    });
    return out.reverse();
  }

  /** What the newest runs on main say of the browser tests, newest first, down to the first run whose
      browser tests all finished (and at most three looked into: GitHub allows 60 calls an hour without a key). */
  async function mainRuns() {
    var data = await gh('/actions/workflows/ci.yml/runs?branch=main&per_page=8');
    /** @type {{ sha: string, title: string, url: string, result: string }[]} */
    var out = [];
    var looked = 0;
    for (var run of data.workflow_runs || []) {
      var item = {
        sha: String(run.head_sha).slice(0, 8),
        title: String(run.display_title || ''),
        url: run.html_url,
        result: 'Running',
      };
      if (run.status === 'completed') {
        if (looked === 3) break;
        looked++;
        item.result = await e2eResult(run.id);
      }
      out.push(item);
      if (item.result === 'Passed' || item.result === 'Failed') break;
    }
    return out;
  }

  /** Passed only when all four browser-test jobs passed. @param {number} runId */
  async function e2eResult(runId) {
    var jobs = (await gh('/actions/runs/' + runId + '/jobs?per_page=50')).jobs || [];
    var e2e = jobs
      .filter(/** @param {any} j */ j => /^e2e \(\d+\)$/.test(j.name))
      .map(/** @param {any} j */ j => j.conclusion);
    if (!e2e.length || e2e.every(/** @param {string} c */ c => c === 'skipped')) return 'Not run';
    if (e2e.includes('failure')) return 'Failed';
    if (e2e.length >= SHARDS && e2e.every(/** @param {string} c */ c => c === 'success')) return 'Passed';
    return 'Cut short';
  }

  /* ── Drawing ────────────────────────────────────────────────────── */

  /** @param {any} release @param {{ pr: number, title: string, at: string }[]} waiting */
  function drawRelease(release, waiting) {
    setText('hl-last', release ? 'PR ' + release.number : 'None');
    setText('hl-last-sub', release ? 'Merged ' + when(release.merged_at) : '');
    setText('hl-waiting', num(waiting.length));
    setText(
      'hl-waiting-sub',
      waiting.length === 1 ? 'pull request merged since then' : 'pull requests merged since then',
    );
    if (!waiting.length) return tableNote('hl-unreleased', 'Nothing waits: main is what is live.');
    $('hl-unreleased').replaceChildren(
      ...waiting.map(p =>
        row([
          link('https://github.com/' + REPO + '/pull/' + p.pr, '#' + p.pr),
          el('span', p.title),
          el('span', when(p.at)),
        ]),
      ),
    );
  }

  /** @param {{ sha: string, title: string, url: string, result: string }[]} runs */
  function drawRuns(runs) {
    if (!runs.length) return tableNote('hl-runs', 'No runs on main yet.');
    $('hl-runs').replaceChildren(
      ...runs.map(function (r) {
        var p = el('span', r.result, 'hl-pill');
        p.dataset.tone = r.result === 'Passed' ? 'ok' : r.result === 'Failed' ? 'bad' : 'warn';
        return row([link(r.url, r.sha), el('span', r.title), p]);
      }),
    );
  }

  /** Safe when the newest run on main finished all its browser tests and passed. @param {{ result: string }[]} runs @param {number} waiting */
  function drawReady(runs, waiting) {
    var full = runs.findIndex(r => r.result === 'Passed' || r.result === 'Failed');
    if (!waiting) {
      pill('hl-ready', 'Nothing to Release', 'ok');
      return setText('hl-ready-why', 'Main and the live site are the same.');
    }
    if (full < 0) {
      pill('hl-ready', 'Wait', 'warn');
      return setText('hl-ready-why', 'No run on main has finished its browser tests yet.');
    }
    if (runs[full].result === 'Failed') {
      pill('hl-ready', 'Not Yet', 'bad');
      return setText('hl-ready-why', 'The newest complete run of the browser tests failed.');
    }
    if (full === 0) {
      pill('hl-ready', 'Yes', 'ok');
      return setText('hl-ready-why', 'The newest run on main passed every browser test.');
    }
    pill('hl-ready', 'Wait for Tests', 'warn');
    setText(
      'hl-ready-why',
      'An earlier run passed; ' +
        full +
        ' newer ' +
        (full === 1 ? 'run is' : 'runs are') +
        ' still testing or cut short.',
    );
  }

  /** @param {any} u what fv_owner_health() answered */
  function drawUsage(u) {
    setText('hl-teachers', num(u.teachers_with_students));
    setText('hl-accounts', num(u.teachers) + ' accounts in all');
    setText('hl-opened', num(u.teachers_opened_7d));
    setText('hl-opened-sub', 'teachers; ' + num(u.classes_opened_7d) + ' classes');
    setText('hl-classes', num(u.classes));
    setText('hl-students', num(u.students));
    var weeks = Array.isArray(u.weekly) ? u.weekly : [];
    var top = Math.max(1, ...weeks.map(/** @param {any} w */ w => Number(w.pieces)));
    $('hl-weekly').replaceChildren(
      ...weeks.map(function (/** @type {any} */ w) {
        var bar = el('div', '', 'hl-bar');
        bar.title = 'Week of ' + day(w.week) + ': ' + num(w.pieces) + ' pieces, ' + w.teachers + ' teachers';
        var fill = el('span', '');
        fill.style.height = Math.round((Number(w.pieces) / top) * 120) + 'px';
        bar.append(el('b', num(w.pieces)), fill, el('span', day(w.week)));
        return bar;
      }),
    );
    var last = weeks[weeks.length - 1];
    $('hl-weekly').setAttribute(
      'aria-label',
      'Student work assessed each week for ten weeks; this week ' + (last ? num(last.pieces) : '0') + ' pieces.',
    );
  }

  /** @param {any} u @param {{ waiting: number } | null} g */
  function drawLede(u, g) {
    var parts = [];
    if (g) parts.push(num(g.waiting) + (g.waiting === 1 ? ' change waits' : ' changes wait') + ' on main');
    if (u)
      parts.push(
        num(u.teachers_opened_7d) +
          ' of ' +
          num(u.teachers_with_students) +
          ' teachers with students opened a class this week',
      );
    setText('hl-lede', parts.length ? parts.join('; ') + '.' : 'Nothing could be loaded.');
  }

  /* ── Loading ────────────────────────────────────────────────────── */

  /** The usage counts, or null with the reason shown. */
  async function loadUsage() {
    var w = /** @type {any} */ (window);
    var sb = w.getSupabase ? w.getSupabase() : null;
    var session = sb ? (await sb.auth.getSession()).data.session : null;
    var gate = $('hl-gate');
    if (!sb || !session) {
      gate.hidden = false;
      setText(
        'hl-gate-text',
        'Sign in to FullVision to see who uses it. Release and test results below need no sign-in.',
      );
      return null;
    }
    var res = await sb.rpc('fv_owner_health');
    if (res.error) {
      gate.hidden = false;
      setText(
        'hl-gate-text',
        res.error.code === '42501'
          ? 'Usage counts are for the site owner’s account.'
          : 'Usage counts did not load: ' + res.error.message,
      );
      return null;
    }
    gate.hidden = true;
    return res.data;
  }

  /** The GitHub half: release and test results. */
  async function loadGitHub() {
    var [release, runs] = await Promise.all([lastRelease(), mainRuns()]);
    var waiting = prsFrom((await gh('/compare/production...main')).commits || []);
    drawRelease(release, waiting);
    drawRuns(runs);
    drawReady(runs, waiting.length);
    return { runs: runs, waiting: waiting.length };
  }

  async function load() {
    var button = /** @type {HTMLButtonElement} */ ($('hl-refresh'));
    button.disabled = true;
    var [ru, rg] = await Promise.allSettled([loadUsage(), loadGitHub()]);
    var u = ru.status === 'fulfilled' ? ru.value : null;
    if (u) drawUsage(u);
    if (ru.status === 'rejected') setText('hl-gate-text', 'Usage counts did not load.');
    var g = rg.status === 'fulfilled' ? rg.value : null;
    if (rg.status === 'rejected') {
      var why = String((rg.reason && rg.reason.message) || rg.reason);
      pill('hl-ready', 'Unknown', 'warn');
      setText('hl-ready-why', why);
      tableNote('hl-unreleased', why);
      tableNote('hl-runs', why);
    }
    drawLede(u, g);
    setText('hl-updated', 'Updated ' + when(Date.now()));
    button.disabled = false;
  }

  $('hl-refresh').addEventListener('click', load);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') load();
  });
  setInterval(function () {
    if (document.visibilityState === 'visible') load();
  }, EVERY_MS);
  load();
})();
