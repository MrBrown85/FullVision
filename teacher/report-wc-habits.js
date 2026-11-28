// @ts-check
/* report-wc-habits.js — Write Comments: the switch on each Work Habits row,
   "In the Comment" (Colin, Nov 27). It says whether the comment names a
   habit, and adds the habit to the comment or takes it out. A sentence the
   bank wrote is worded again from the bank for the habits it now names (or
   dropped when it names none); a sentence the teacher typed or edited is
   never touched. The choice is kept with the comment's record
   (draft_meta.habit_choice), so Generate keeps it (CommentBank.habitPlan
   follows it, and reconcile() puts back what a draft left out). All the
   words come from the bank's own frames and the realiser. No grade math. */
window.ReportWcHabits = (function () {
  'use strict';

  var P = ReportWcParts;
  var B = ReportWcBoxes;
  var H = /** @type {any} */ (null);
  var mk = /** @type {any} */ (null);
  var redraw = /** @type {any} */ (null);
  function configure(host, makeEnv, draw) {
    H = host;
    mk = makeEnv;
    redraw = draw;
  }

  function CB() {
    return /** @type {any} */ (window).CommentBank;
  }

  /* ── What a row says about the habits ─────────────────────── */

  /* The habits a row names, in the grid's order. */
  function keysOf(row) {
    var named = P.factKeys(row)
      .filter(function (k) {
        return /^habit:/.test(k);
      })
      .map(function (k) {
        return k.slice(6);
      });
    return CB()
      .HABITS.map(function (h) {
        return h.key;
      })
      .filter(function (k) {
        return named.indexOf(k) >= 0;
      });
  }
  /* Whether the bank wrote this row for one habit slot and the teacher has not
     made it theirs: only such a row is worded again or dropped. */
  function mine(row) {
    return !!row && !!row.s && !row.edited && !row.kept && !row.earlier && !row.classLine && !!row.prov;
  }
  function slotOf(row) {
    return mine(row) ? CB().habitChoice.slotOf(row.s) : '';
  }
  function inBox(env, row) {
    return !env.required(row) && P.boxOf(row, env.isBest(row)) === 'habits';
  }

  /* Each habit's switch: on when a sentence names it; locked (on, not to be
     turned off) while a sentence the teacher wrote, or one the bank wrote
     for something other than one slot, names it. The habits box's rows are
     the `mine` the box is built from: { ri, row }. */
  function state(mineRows, ratings) {
    var out = {};
    CB().HABITS.forEach(function (h) {
      var held = mineRows.filter(function (x) {
        return P.has(x.row, 'habit:' + h.key);
      });
      var rated = ratings[h.key] >= 1 && ratings[h.key] < 5;
      out[h.key] = {
        on: held.length > 0,
        locked: held.some(function (x) {
          return !slotOf(x.row);
        }),
        disabled: !held.length && !rated,
        held: held.map(function (x) {
          return x.ri;
        }),
      };
    });
    return out;
  }

  /* ── The note when two sentences name one habit ──────────── */

  function entries(rows) {
    return rows.map(function (row, ri) {
      return { ri: ri, row: row };
    });
  }
  var NUMBERS = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  /* { text, buttons } for the first habit two sentences name, when the later
     of them is one the bank wrote; null otherwise. */
  function duplicateNote(rows) {
    var list = entries(rows).filter(function (x) {
      return P.boxOf(x.row, false) === 'habits' && keysOf(x.row).length;
    });
    var hs = CB().HABITS;
    for (var i = 0; i < hs.length; i++) {
      var held = list.filter(function (x) {
        return keysOf(x.row).indexOf(hs[i].key) >= 0;
      });
      if (held.length < 2 || !held.slice(1).some(duplicateOf)) continue;
      return {
        text: (NUMBERS[Math.min(held.length, 6)] || String(held.length)) + ' sentences name ' + hs[i].name + '.',
        buttons: [{ label: 'Remove One', act: 'wcHabitDup', data: { habit: hs[i].key } }],
      };
    }
    return null;
  }
  function duplicateOf(x) {
    return !!slotOf(x.row);
  }

  /* Takes out the later bank sentence that repeats a habit, and keeps the
     teacher's choice: a habit only that sentence named is switched off. */
  function removeOne(key) {
    var st = H.current();
    if (!st) return;
    var env = mk(st, H.facts(st, true));
    var held = entries(env.rows).filter(function (x) {
      return inBox(env, x.row) && keysOf(x.row).indexOf(key) >= 0;
    });
    var gone = held.slice(1).filter(duplicateOf).pop();
    if (!gone) return;
    var others = env.rows.filter(function (r, ri) {
      return ri !== gone.ri && inBox(env, r);
    });
    var lost = keysOf(gone.row).filter(function (k) {
      return !others.some(function (r) {
        return keysOf(r).indexOf(k) >= 0;
      });
    });
    if (lost.length) save(st, lost, false);
    H.setRows(
      st,
      env.rows.filter((r, ri) => ri !== gone.ri),
      null,
      '',
    );
  }

  /* ── The choice, kept with the comment ───────────────────── */

  function ratingOf(st) {
    return getStudentTermRating(H.cid(), st.id, ReportBlocks.getTermId()) || {};
  }
  /* Which habits the teacher put in the comment or took out (draft_meta.habit_choice). */
  function choiceOf(st) {
    return CB().habitChoice.of((ratingOf(st).draftMeta || {}).habit_choice);
  }
  function saveChoice(st, choice) {
    var meta = Object.assign({ v: 1, sentences: [] }, ratingOf(st).draftMeta, { habit_choice: choice });
    upsertTermRating(H.cid(), st.id, ReportBlocks.getTermId(), { draftMeta: meta });
  }

  function save(st, keys, on) {
    var c = CB().habitChoice.of(choiceOf(st));
    keys.forEach(function (k) {
      c.on = c.on.filter(function (x) {
        return x !== k;
      });
      c.off = c.off.filter(function (x) {
        return x !== k;
      });
      (on ? c.on : c.off).push(k);
    });
    saveChoice(st, c);
  }

  /* ── Turning a switch on or off ──────────────────────────── */

  /* The sentence a habit slot holds, for these habits: the same bank
     sentence when only its habits changed, another for the same slot. */
  function sentenceFor(env, rows, slot, keys, ctx, prefer) {
    if (prefer && CB().habitChoice.slotOf(prefer) === slot) return prefer;
    var taken = {};
    rows.forEach(function (r) {
      taken[r.id] = true;
    });
    var pool = B.poolFor(CB().habitChoice.stepOf(slot), taken, 'habit:' + keys[0], ctx).filter(function (s) {
      return CB().habitChoice.slotOf(s) === slot;
    });
    pool.sort(function (a, b) {
      return (env.usage[a.id] || 0) - (env.usage[b.id] || 0);
    });
    return pool[0] || null;
  }

  /* The rows with each habit part worded as `parts` says: a part with a row
     (ri) rewrites it, a part with none gets a new row after the box's last,
     a row whose part is gone goes. Returns { rows, added } or null when the
     bank has no sentence for a part. */
  function apply(env, st, parts, was) {
    var rows = env.rows.slice();
    var ctx = env.ctx;
    var added = null;
    var drop = {};
    was.forEach(function (w) {
      drop[w.ri] = true;
    });
    var fresh = [];
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var ctxP = CB().habitChoice.withPart(ctx, p.slot, p.keys);
      var old = p.ri != null ? env.rows[p.ri] : null;
      if (old) {
        delete drop[p.ri];
        var sameWords = was.some(function (w) {
          return w.ri === p.ri && w.slot === p.slot && w.keys.join() === p.keys.join();
        });
        if (sameWords) continue;
      }
      var s = sentenceFor(env, rows, p.slot, p.keys, ctxP, old && old.s);
      if (!s) return null;
      var row = H.rowFromSentence(s, ctxP, CB().habitChoice.stepOf(p.slot), false);
      if (old) rows[p.ri] = row;
      else fresh.push(row);
    }
    rows = rows.filter(function (r, ri) {
      return !drop[ri];
    });
    fresh.forEach(function (row) {
      var boxes = rows.map(function (r) {
        return P.boxOf(r, env.isBest(r));
      });
      rows = H.insertRow(rows, row, P.insertAt(boxes, 'habits'));
      added = row;
    });
    return { rows: rows, added: added };
  }

  /* The habit parts the comment holds: { ri, slot, keys } for each sentence the bank wrote for
     a habit slot, and the slots the teacher's own sentences hold. */
  function partsOf(env) {
    var parts = [];
    var held = [];
    env.rows.forEach(function (row, ri) {
      if (!inBox(env, row)) return;
      var slot = slotOf(row);
      var keys = keysOf(row);
      if (slot && keys.length) parts.push({ ri: ri, slot: slot, keys: keys });
      else if (row.s && CB().habitChoice.slotOf(row.s)) held.push(CB().habitChoice.slotOf(row.s));
    });
    return { parts: parts, held: held };
  }

  function ratingsOf(st) {
    return CB().effectiveHabits(H.habitsStored(st));
  }

  /* A change to one habit's place in the comment: the rows after it, or null. */
  function change(env, st, key, on) {
    var have = partsOf(env);
    var next = on
      ? CB().habitChoice.add(have.parts, ratingsOf(st), env.f.family || '', key, have.held)
      : CB().habitChoice.remove(have.parts, key);
    return next ? apply(env, st, next, have.parts) : null;
  }

  /* The habits the comment names now, in the grid's order. */
  function namedNow(env) {
    var out = [];
    env.rows.forEach(function (r) {
      if (inBox(env, r)) out = out.concat(keysOf(r));
    });
    return CB()
      .HABITS.map(function (h) {
        return h.key;
      })
      .filter(function (k) {
        return out.indexOf(k) >= 0;
      });
  }

  function toggle(key, on) {
    var st = H.current();
    if (!st) return;
    var was = choiceOf(st);
    // Every habit the switches show on stays on when Generate writes the comment again.
    save(
      st,
      namedNow(mk(st, H.facts(st, true))).filter(function (k) {
        return k !== key;
      }),
      true,
    );
    save(st, [key], on);
    var env = mk(st, H.facts(st, true));
    var named = env.rows.some(function (r) {
      return inBox(env, r) && keysOf(r).indexOf(key) >= 0;
    });
    // On when a sentence already names it, or off when none the bank wrote does: only the choice changes.
    var made = on && named ? { rows: env.rows, added: null } : change(env, st, key, on);
    if (!made) {
      saveChoice(st, was);
      return H.nothingFits();
    }
    if (
      made.rows.length === env.rows.length &&
      made.rows.every(function (r, i) {
        return r === env.rows[i];
      })
    ) {
      redraw();
      return;
    }
    H.setRows(st, made.rows, made.added, '');
  }

  /* After Generate: every habit switched on is named and none switched off, by the same
     changes the switches make. */
  function reconcile(st) {
    var c = CB().habitChoice.of(choiceOf(st));
    if (!c.on.length && !c.off.length) return;
    var changed = false;
    var run = function (key, on) {
      var env = mk(st, H.facts(st, true));
      var named = env.rows.some(function (r) {
        return inBox(env, r) && keysOf(r).indexOf(key) >= 0;
      });
      if (named === on) return;
      var made = change(env, st, key, on);
      if (!made) return;
      H.putRows(st, made.rows);
      changed = true;
    };
    c.off.forEach(function (k) {
      run(k, false);
    });
    c.on.forEach(function (k) {
      if (c.off.indexOf(k) < 0) run(k, true);
    });
    return changed;
  }

  /* The Work Habits box: the six habits with their switches, each sentence under the first habit it names. */
  function box(env, mine) {
    var taken = {};
    var keys = CommentBank.HABITS.map(function (h) {
      return h.key;
    });
    // A sentence sits under the first habit it names; the others it names show it by their switch.
    var firstOf = function (row) {
      for (var i = 0; i < keys.length; i++) if (P.has(row, 'habit:' + keys[i])) return i;
      return -1;
    };
    var sw = ReportWcHabits.state(mine, env.habitRatings);
    var rkOf = {};
    var facts = CommentBank.HABITS.map(function (h, i) {
      var lines = B.takeLines(env, mine, taken, '', function (r) {
        return firstOf(r) === i;
      });
      lines.forEach(function (l) {
        rkOf[l.ri] = l.rk;
      });
      var v = env.habitValue(h.key);
      var f = B.fact({
        id: 'habit:' + h.key,
        name: h.name,
        tip: /** @type {any} */ (h).desc || /** @type {any} */ (h).hint,
        slider: h.key,
        val: v ? CommentBank.SCALE[v - 1] : 'Not Rated',
      });
      f.lines = lines;
      f.sw = sw[h.key];
      return f;
    });
    // Each habit's row is lit with every sentence that names it.
    facts.forEach(function (f) {
      f.cover = f.sw.held
        .map(function (ri) {
          return rkOf[ri];
        })
        .filter(Boolean);
    });
    var left = mine.filter(function (x) {
      return !taken[x.ri];
    });
    var more = !mine.length || left.length ? null : B.candidate(env, 'habits', '', env.ctx);
    var foot = [];
    // Under the six ratings, not beside the first, so the six bars line up.
    if (!mine.length) foot.push(B.btn('+ Say This About Work Habits', 'wcSay', { box: 'habits', fact: '' }));
    else if (more) foot.push(B.btn('+ Say More About Work Habits', 'wcSay', { box: 'habits', fact: '' }));
    return { facts: facts, head: env.habitsText, foot: foot, top: left.map(env.line) };
  }

  return {
    box: box,
    choiceOf: choiceOf,
    configure: configure,
    state: state,
    keysOf: keysOf,
    duplicateNote: duplicateNote,
    removeOne: removeOne,
    toggle: toggle,
    reconcile: reconcile,
  };
})();
