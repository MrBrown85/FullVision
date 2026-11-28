// @ts-check
/* report-wc-env.js — Write Comments: what ReportWcBoxes is built from for
   the student on screen. The facts come from the main file through the
   host (calc.js's levels and marks included); the rows are the comment's
   sentences. Nothing here words a grade. */
window.ReportWcEnv = (function () {
  'use strict';

  var P = ReportWcParts;
  var B = ReportWcBoxes;
  var H = /** @type {any} */ (null);
  var ui = /** @type {any} */ (null);
  function configure(host, state) {
    H = host;
    ui = state;
  }

  /* Whether a sentence of the teacher's own is already in My Bank: what it
     would be saved as for this student (the wording PersonalBank.compose
     keeps, the name and pronouns made slots) is a kept template's text. Each
     line's answer is kept until the bank or the sentence changes, so a
     redraw does not word every sentence again. */
  var _banked = { list: null, seen: {} };
  function inBank(env, row) {
    var bank = /** @type {any} */ (window).PersonalBank;
    if (!bank || !row || !row.text) return false;
    var kept = bank.list();
    if (_banked.list !== kept) _banked = { list: kept, seen: {} };
    var key = (env.student && env.student.id) + '|' + row.text;
    if (!(key in _banked.seen)) {
      // The wording as compose saves it: the name and pronouns made slots.
      var said = String(row.text).replace(/\s+/g, ' ').trim();
      var e = bank.entities(env.ctx, env.f, env.student, said);
      e.loose = true;
      var text = String(bank.slotify(said, e).text || '')
        .trim()
        .toLowerCase();
      _banked.seen[key] =
        !!text &&
        kept.some(function (x) {
          return (
            String(x.text || '')
              .trim()
              .toLowerCase() === text
          );
        });
    }
    return _banked.seen[key];
  }

  function comp(f, id) {
    return (f.comps || []).find(function (c) {
      return String(c.id) === String(id);
    });
  }
  function compOf(f, row) {
    var k = P.factKeys(row).find(function (x) {
      return /^comp:/.test(x);
    });
    return k ? comp(f, k.slice(5)) : null;
  }
  function upFrom(cid, f, c) {
    var t = H.glanceChange(cid, f, c);
    if (/^↑ from /.test(t)) return t.replace('↑ from ', 'Up From ');
    if (/^↓ from /.test(t)) return t.replace('↓ from ', 'Down From ');
    return /^New since/.test(t) ? 'New Since the Report' : '';
  }

  /* The context a row's sentence was written with: the skill the teacher
     named when it is not the one the bank would pick. */
  function ctxForRow(env, row) {
    var c = compOf(env.f, row);
    if (!c || !row.s) return env.ctx;
    if (P.BOX_STEPS.strength.indexOf(row.step) >= 0) return B.ctxFor(env, 'strength', c) || env.ctx;
    if (row.step === 'nextStep') return B.ctxFor(env, 'next', c) || env.ctx;
    return env.ctx;
  }

  /* The other wordings of a row: the bank's, filled for the same fact, or
     the other frame of a quoted answer. [{ id, text, used, usedTip }]. */
  function wordsWays(env, row) {
    var a = H.wordsAnswers(env.f).find(function (x) {
      return x.key === row.words;
    });
    if (!a) return [];
    return [0, 1]
      .map(function (k) {
        return { id: 'words:' + a.key + ':' + k, text: H.wordsSentence(env.student, a, k), used: '', usedTip: '' };
      })
      .filter(function (w) {
        return w.text !== row.text;
      });
  }
  function bankWays(env, ri, row) {
    var taken = {};
    env.rows.forEach(function (r) {
      taken[r.id] = true;
    });
    var ctx = ctxForRow(env, row);
    var fill = function (s) {
      return CommentBank.fill(s, ctx, { first: ri === 0 });
    };
    var ways = H.alternatives(row, ctx, env.usage, taken, 4).map(function (s) {
      var n = env.usage[s.id] || 0;
      return {
        id: s.id,
        text: fill(s),
        used: n ? String(n) : '',
        usedTip: 'Used for ' + n + ' other students in this class',
      };
    });
    if (row.edited) ways.push({ id: row.id, text: fill(row.s), used: '', usedTip: '' });
    return ways;
  }
  function waysFor(env, ri) {
    var row = env.rows[ri];
    if (!row) return [];
    if (row.words) return wordsWays(env, row);
    return row.s && row.step ? bankWays(env, ri, row) : [];
  }

  /* One row of the comment as a line in its box. */
  function lineOf(env, x) {
    var row = x.row;
    var fixed = '';
    if (row.classLine) fixed = { closer: 'editClosing', lateWork: 'editLate', support: 'supportMenu' }[row.step] || '';
    var claims = env.claims.filter(function (c) {
      return c.row === x.ri;
    });
    var alts = !fixed && !row.earlier ? waysFor(env, x.ri) : [];
    var open = ui.ways === x.ri;
    return {
      ri: x.ri,
      rk: String(row.id) + '#' + env.dupe(x.ri),
      box: P.boxOf(row, env.isBest(row)),
      text: row.text,
      yours: !fixed && (!!row.edited || !row.step) && !row.earlier,
      inBank: !fixed && (!!row.edited || !row.step) && !row.earlier && !row.classLine && inBank(env, row),
      earlier: !!row.earlier,
      last: !!(row.id && env.lastIds.indexOf(row.id) >= 0 && !row.classLine),
      classLine: !!row.classLine,
      fixed: fixed,
      added: env.justAdded(row),
      hasWays: alts.length > 0,
      waysOpen: open,
      ways: open ? alts : [],
      claim: claims.length > 0,
      claimHtml: claims.map(H.claimHtml).join(''),
      own: H.ownBox(x.ri),
      pronounNote: H.pronounNote(row, x.ri),
    };
  }

  /* ── The facts of each box ───────────────────────────────── */

  function habitFacts(env, st, f) {
    var stored = H.habitsStored(st);
    var rated = CommentBank.HABITS.filter(function (h) {
      return H.habitValue(h.key) > 0;
    }).length;
    var att = H.attendance(st);
    var entered = att.absences != null || att.lates != null;
    env.habitValue = H.habitValue;
    env.habitRatings = CommentBank.effectiveHabits(stored);
    env.habitsText = rated === 6 ? 'Six Ratings' : rated + ' of 6 Rated';
    env.attCount = att.absences == null ? '—' : String(att.absences);
    env.attHead = entered ? (att.absences || 0) + ' Absent · ' + (att.lates || 0) + ' Late' : 'Not Entered';
    env.attEntered = entered;
    env.habitsLow = CommentBank.HABITS.map(function (h) {
      return { key: h.key, name: h.name, v: Number(stored[h.key]) || 0 };
    })
      .filter(function (h) {
        return h.v >= 1 && h.v < 4;
      })
      .sort(function (a, b) {
        return a.v - b.v;
      })
      .map(function (h) {
        return { key: h.key, name: h.name, word: CommentBank.SCALE[h.v - 1] };
      });
  }

  var VOICE_KEYS = { Goal: 'goal', 'Good at': 'good', 'Hard right now': 'hard', 'Wants to get better at': 'better' };
  function voiceFacts(env, f) {
    var words = H.wordsAnswers(f).map(function (a) {
      return a.key;
    });
    env.voice = H.voiceRows(f).map(function (r) {
      var key = VOICE_KEYS[r.label];
      return Object.assign({}, r, {
        key: key || r.label,
        say: key && words.indexOf(key) >= 0 ? key : '',
        priv: !!r.priv,
      });
    });
    var has = function (k) {
      return env.voice.some(function (v) {
        return (!k || v.key === k) && v.text;
      });
    };
    env.voiceHead = has('goal') ? 'Goal Check-In' : has('') ? 'About Me' : 'No Answers Yet';
  }

  function skillFacts(env, f) {
    var cid = env.cid;
    env.comps = f.comps || [];
    env.strongest = H.glanceRows(f).strongest;
    env.pieces = H.pieces;
    env.upFrom = function (c) {
      return upFrom(cid, f, c);
    };
    env.barOf = function (lvl) {
      return Math.max(0, Math.min(1, (Number(lvl) || 0) / 4));
    };
    env.compOf = function (row) {
      return compOf(f, row);
    };
    env.nextComps = env.comps
      .filter(function (c) {
        return c.level > 0;
      })
      .sort(function (a, b) {
        return a.level - b.level;
      })
      .slice(0, 6);
    var n = CommentBank.nextSkillOf(f);
    env.nextDefault = n ? n.comp.name + ' · ' + formatLevel(cid, n.comp.level) : '';
    env.nextHead = function (mine) {
      var c = mine
        .map(function (x) {
          return compOf(f, x.row);
        })
        .filter(Boolean)[0];
      return c ? c.name + ' · ' + formatLevel(cid, c.level) : '';
    };
  }

  function base(st, f, rows) {
    var cid = H.cid();
    var path = CommentBank.reportPath(f);
    var ctx = H.ctx(st, f);
    return {
      cid: cid,
      student: st,
      f: f,
      rows: rows,
      ctx: ctx,
      picks: H.picks(st, f),
      path: path,
      first: H.first(st),
      usage: H.usageMap(st),
      lastIds: H.lastIds(st),
      claims: H.claims(st),
      q: ui.q,
      piecesAll: ui.piecesAll,
      seeMissing: ui.seeMissing,
      isBest: H.isBest,
      required: function (row) {
        return !!path && (H.isRequired(row.step, path) || rows.indexOf(row) === H.meetingRowAt(rows, path));
      },
      justAdded: H.justAdded,
      dupe: function (ri) {
        var n = 0;
        for (var k = 0; k < ri; k++) if (rows[k].id === rows[ri].id) n++;
        return n;
      },
      gradeText: H.gradeText(st, f),
      gradeNote: H.gradeNote(st, f),
      close: H.closeNext(f, rows),
      bestOrder: CommentBank.bestOrderOf(f) || [],
      pieceMark: function (w) {
        return H.pieceMark(f, w);
      },
      obsList: H.studentObs(st),
      missing: H.missingAndLate(st),
      recordTotal: (f.record && f.record.total) || 0,
      openOf: function (key) {
        return !!ui.open[key];
      },
      requiredHtml: function (key) {
        return H.requiredHtml(st, f, rows, path, key);
      },
      fitCount: function (part) {
        return H.fitCount(part, ctx);
      },
    };
  }

  function make(st, f, canSay) {
    var env = base(st, f, H.rows(st, f));
    habitFacts(env, st, f);
    voiceFacts(env, f);
    skillFacts(env, f);
    env.canSay = function (d) {
      return canSay(env, d);
    };
    env.classFacts = function (mine) {
      return H.classFacts(st, f, mine, env.line);
    };
    env.line = function (x) {
      return lineOf(env, x);
    };
    env.attention = function (x) {
      return (
        !!x.row.earlier ||
        env.claims.some(function (c) {
          return c.row === x.ri;
        }) ||
        !!H.pronounNote(x.row, x.ri) ||
        !!H.ownBox(x.ri)
      );
    };
    env.waysFor = function (ri) {
      return waysFor(env, ri);
    };
    env.ctxForRow = function (row) {
      return ctxForRow(env, row);
    };
    return env;
  }

  /* The same, for the comment box's Add to My Bank: row r of the student's
     comment. */
  function rowInBank(st, r) {
    var f = H.facts(st);
    var row = (H.rows(st, f) || [])[r];
    return !!row && inBank({ student: st, f: f, ctx: H.ctx(st, f) }, row);
  }

  return { configure: configure, make: make, comp: comp, rowInBank: rowInBank };
})();
