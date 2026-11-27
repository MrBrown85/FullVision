// @ts-check
/* report-wc-boxes.js — Write Comments: what each box holds for the student
   on screen (docs/plans/write-comments-plan.md, decisions 3 to 6). It turns
   the facts FullVision has and the comment's sentences into the boxes: each
   fact with its mark, the sentence the comment already says about it or a
   Say This for it, and each box's closed line. It draws nothing, saves
   nothing and words no grade: levels and marks come from calc.js through
   env (formatLevel, the piece mark, the grade line). */
window.ReportWcBoxes = (function () {
  'use strict';

  var P = ReportWcParts;
  var M = ReportWcBoxesMore;

  /* A fact row of a box. */
  function fact(o) {
    return Object.assign(
      {
        id: '',
        tag: '',
        tagTint: '',
        name: '',
        quote: '',
        up: '',
        chip: '',
        bar: null,
        val: '',
        say: '',
        sayLabel: 'Say This',
        sayData: null,
        extra: [],
        lines: [],
        subs: [],
        slider: '',
        html: '',
        look: '',
        tip: '',
      },
      o,
    );
  }
  function btn(label, act, data, on) {
    return { label: label, act: act, data: data || {}, on: !!on };
  }

  /* The rows of the comment sitting in a box, as { ri, row }. */
  function rowsIn(env, key) {
    var out = [];
    env.rows.forEach(function (row, ri) {
      if (env.required(row)) return;
      if (P.boxOf(row, env.isBest(row)) === key) out.push({ ri: ri, row: row });
    });
    return out;
  }
  /* The lines of a fact: the rows of the box that rest on its key, each
     row under one fact only (the first that claims it). */
  function takeLines(env, mine, taken, key, pick) {
    var out = [];
    mine.forEach(function (x) {
      if (taken[x.ri] || !(pick ? pick(x.row) : P.has(x.row, key))) return;
      taken[x.ri] = true;
      out.push(env.line(x));
    });
    return out;
  }

  /* ── Say This: the sentence a fact would add ─────────────── */

  /* The first bank sentence of the box's steps that fits the context, is not
     in the comment, and (with a fact key) rests on that fact; the least
     used in the class first. null when there is none. */
  function _usable(pool, taken, factKey, ctx) {
    return pool.filter(function (s) {
      if (taken[s.id] || !CommentBank.fits(s, ctx)) return false;
      return !factKey || CommentBank.provenance(s, ctx).factKeys.indexOf(factKey) >= 0;
    });
  }
  /* The best tier of the step first; every bank sentence of the step when
     that tier has none that fits. */
  function _poolFor(step, taken, factKey, ctx) {
    var ok = _usable(CommentBank.stepPool(step, ctx) || [], taken, factKey, ctx);
    if (ok.length) return ok;
    var all = COMMENT_BANK.sentences.filter(function (s) {
      return CommentBank.stepOf(s) === step;
    });
    return _usable(all, taken, factKey, ctx);
  }
  function candidate(env, boxKey, factKey, ctx) {
    var taken = {};
    env.rows.forEach(function (r) {
      taken[r.id] = true;
    });
    var steps = P.BOX_STEPS[boxKey] || [];
    for (var i = 0; i < steps.length; i++) {
      var ok = _poolFor(steps[i], taken, factKey, ctx);
      ok.sort(function (a, b) {
        return (env.usage[a.id] || 0) - (env.usage[b.id] || 0);
      });
      if (ok.length) return { s: ok[0], step: steps[i], ctx: ctx };
    }
    return null;
  }
  /* A context that names this skill as the strength or the next step. */
  function ctxFor(env, kind, comp) {
    var f = Object.assign({}, env.f);
    if (kind === 'strength') f.strengthPickId = comp.id;
    if (kind === 'best') f.bestPickId = comp.id;
    var ctx = CommentBank.context(f, env.picks);
    if (kind === 'next') {
      var sk = CommentBank.skillFor(env.f, comp);
      if (!sk) return null;
      var facts = Object.assign({}, ctx._facts || {}, { nextSkill: ['comp:' + comp.id] });
      ctx = Object.assign({}, ctx, { nextSkill: sk.skill, levelStep: '', _facts: facts });
    }
    return ctx;
  }

  /* ── The boxes ───────────────────────────────────────────── */

  function gradeBox(env, mine) {
    var said = {};
    var g = fact({
      id: 'grade',
      name: 'Grade So Far This Year',
      val: env.gradeText,
      chip: env.gradeNote,
      lines: takeLines(env, mine, said, '', function (r) {
        return !/^close:/.test(String(r.id));
      }),
    });
    if (!g.lines.length && !env.path) g.sayData = { box: 'grade', fact: '' };
    var facts = [g];
    if (env.close) {
      var closeRows = mine.filter(function (x) {
        return /^close:/.test(String(x.row.id));
      });
      facts.push(
        fact({
          id: 'close',
          name: 'Close to ' + CommentBank.aOrAn(env.close.letter),
          lines: closeRows.map(env.line),
          sayData: closeRows.length ? null : { box: 'grade', fact: 'close' },
        }),
      );
    }
    return { facts: facts, head: env.gradeText, foot: [], top: [] };
  }

  function bestBox(env, mine) {
    var taken = {};
    var order = env.bestOrder;
    var named = mine.length
      ? order.find(function (w) {
          return mine.some(function (x) {
            return P.has(x.row, 'work:' + w.id);
          });
        })
      : null;
    var shown = env.piecesAll ? order : order.slice(0, 6);
    var aim = named || order[0];
    var note = aim ? String(aim.note || '').trim() : '';
    var facts = shown.map(function (w) {
      var lines = takeLines(env, mine, taken, 'work:' + w.id);
      var f = fact({ id: 'work:' + w.id, name: w.title || 'Untitled', val: env.pieceMark(w), lines: lines });
      if (w === aim && note) f.quote = 'Note for the report: “' + note + '”';
      if (!lines.length) {
        f.sayLabel = mine.length ? 'Name This One' : 'Say This';
        f.sayData = { box: 'best', fact: 'work:' + w.id, aid: w.id };
      }
      return f;
    });
    var foot = [];
    if (order.length > 6)
      foot.push(btn(env.piecesAll ? 'Show Fewer' : 'All ' + order.length + ' Assignments…', 'wcPieces', {}));
    var top = order[0];
    if (aim) {
      foot.push(btn('Open in Grader ›', 'tqOpenGrader', { aid: aim.id }, false));
      if (!note) foot.push(btn('Add a note for the report ›', 'tqAddReportNote', { aid: aim.id }, false));
    }
    var left = mine.filter(function (x) {
      return !taken[x.ri];
    });
    return {
      facts: facts,
      head: (named || (mine.length ? top : null) || {}).title || '',
      foot: foot,
      top: left.map(env.line),
    };
  }

  function strengthBox(env, mine) {
    var taken = {};
    var comps = env.comps
      .filter(function (c) {
        return c.level > 0;
      })
      .sort(function (a, b) {
        return b.level - a.level;
      })
      .slice(0, env.open ? 10 : 0);
    var facts = comps.map(function (c) {
      var lines = takeLines(env, mine, taken, 'comp:' + c.id);
      var f = fact({
        id: 'comp:' + c.id,
        name: c.name,
        up: env.upFrom(c),
        chip: env.pieces(c),
        bar: env.barOf(c.level),
        val: formatLevel(env.cid, c.level),
        lines: lines,
      });
      if (!lines.length) f.sayData = { box: 'strength', fact: 'comp:' + c.id, comp: c.id };
      return f;
    });
    var first = mine
      .map(function (x) {
        return env.compOf(x.row);
      })
      .filter(Boolean)[0];
    var strongest = env.strongest;
    var pick = first || strongest;
    var left = mine.filter(function (x) {
      return !taken[x.ri];
    });
    var foot = env.comps.length ? [btn('View All ' + env.comps.length + ' Skills ›', 'tqOpenSkills', {})] : [];
    return {
      facts: facts,
      head: pick ? pick.name + ' · ' + formatLevel(env.cid, pick.level) : '',
      foot: foot,
      top: left.map(env.line),
    };
  }

  function habitsBox(env, mine) {
    var taken = {};
    var keys = CommentBank.HABITS.map(function (h) {
      return h.key;
    });
    // A sentence sits under the last habit it names.
    var lastOf = function (row) {
      var at = -1;
      keys.forEach(function (k, i) {
        if (P.has(row, 'habit:' + k)) at = i;
      });
      return at;
    };
    var facts = CommentBank.HABITS.map(function (h, i) {
      var lines = takeLines(env, mine, taken, '', function (r) {
        return lastOf(r) === i;
      });
      var v = env.habitValue(h.key);
      var f = fact({
        id: 'habit:' + h.key,
        name: h.name,
        tip: /** @type {any} */ (h).desc || /** @type {any} */ (h).hint,
        slider: h.key,
        val: v ? CommentBank.SCALE[v - 1] : 'Not Rated',
      });
      f.lines = lines;
      f.sayData = !lines.length && !mine.length && i === 0 ? { box: 'habits', fact: '' } : null;
      f.sayLabel = 'Say This';
      return f;
    });
    var left = mine.filter(function (x) {
      return !taken[x.ri];
    });
    var more = !mine.length || left.length ? null : candidate(env, 'habits', '', env.ctx);
    var foot = [];
    if (more && mine.length) foot.push(btn('+ Say More About Work Habits', 'wcSay', { box: 'habits', fact: '' }));
    return { facts: facts, head: env.habitsText, foot: foot, top: left.map(env.line) };
  }

  var BUILD = {
    grade: gradeBox,
    best: bestBox,
    strength: strengthBox,
    habits: habitsBox,
    att: M.att,
    voice: M.voice,
    obs: M.obs,
    missing: M.missing,
    next: M.next,
    cls: M.cls,
    yours: M.yours,
  };

  /* Whether a typed search finds this fact or one of its lines. */
  function hit(f, q) {
    if (!q) return true;
    var has = function (t) {
      return (
        String(t || '')
          .toLowerCase()
          .indexOf(q) >= 0
      );
    };
    return (
      has(f.name) ||
      has(f.quote) ||
      f.lines.some(function (l) {
        return has(l.text);
      })
    );
  }

  /* The boxes for the student on screen, each { key, label, tint, icon,
     head, only, said (rows it holds), open, facts, top, foot, note }. */
  /* The Browse Sentences part each box opens ("All N Strength Sentences…"). */
  var BROWSE_PART = {
    grade: 'grade',
    best: 'bestPiece',
    strength: 'strengths',
    habits: 'habits',
    att: 'habits',
    missing: 'notHandedIn',
    next: 'nextStep',
    cls: 'support',
  };

  /* A Say This shows only when the bank has a sentence for the fact; a skill or piece it has none for says so. */
  function settleSay(env, key, facts) {
    facts.forEach(function (f) {
      if (f.sayData && !env.canSay(f.sayData)) {
        if (/^(comp|work):/.test(f.sayData.fact)) f.writeBox = key;
        f.sayData = null;
      }
    });
  }

  function build(env) {
    var q = String(env.q || '')
      .trim()
      .toLowerCase();
    return P.BOXES.map(function (b) {
      var mine = rowsIn(env, b.key);
      var requiredHere = env.requiredHtml(b.key);
      // A box that holds something to settle (a sentence that no longer matches, a pronoun to check,
      // a Required part, an earlier comment's sentence) is open.
      var attention = mine.some(function (x) {
        return env.attention(x);
      });
      var openNow = env.openOf(b.key) || !!q || !!requiredHere || attention;
      var model = BUILD[b.key](Object.assign({}, env, { open: true }), mine);
      var facts = model.facts.filter(function (f) {
        return hit(f, q);
      });
      if (openNow) settleSay(env, b.key, facts);
      var top = (model.top || []).filter(function (l) {
        return !q || String(l.text).toLowerCase().indexOf(q) >= 0;
      });
      var label = b.key === 'voice' ? env.first + '’s Voice' : b.label;
      var show = b.key === 'yours' ? mine.length > 0 : !q || facts.length > 0 || top.length > 0;
      var part = BROWSE_PART[b.key];
      var count = part && openNow ? env.fitCount(part) : 0;
      return {
        key: b.key,
        label: label,
        tint: b.tint,
        icon: b.icon,
        head: model.head || '',
        only: model.only || '',
        said: mine.length,
        open: openNow,
        facts: facts,
        top: top,
        foot: model.foot || [],
        required: requiredHere,
        writable: b.key !== 'obs' && b.key !== 'yours',
        browse: count ? { part: part, label: 'All ' + count + ' ' + b.label + ' Sentences…' } : null,
        show: show,
      };
    }).filter(function (b) {
      return b.show;
    });
  }

  return { build: build, candidate: candidate, ctxFor: ctxFor, fact: fact, btn: btn, takeLines: takeLines };
})();
