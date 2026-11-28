// @ts-check
/* comment-bank-habits.js — the teacher's choice of which work habits a comment
   names (the Work Habits switches on Write Comments, Colin, Nov 27). The
   choice is { on: [habit keys], off: [habit keys] }, kept with the comment's
   record (draft_meta.habit_choice). The bank's habit plan (habitPlan in
   comment-bank.js) follows it, and the page adds or takes out one habit with
   habitAdd and habitRemove on the sentences' parts ({ slot, keys }). Nothing
   here words a grade or writes a sentence: the words are the bank's frames
   and the realiser's, through the tokens comment-bank.js hands in. It reads
   the bank's own tables through make(), so it loads before comment-bank.js. */
window.CommentBankHabits = (function () {
  'use strict';

  /* The habits a sentence names at most, and the words a list of them may run to (a Generate
     sentence keeps within 20 words). */
  var SOME_MOST = 2;
  var LIST_WORDS = 17;
  /* What comment-bank.js keeps: d.fit (habitsThatFit), d.tokens (habitListTokens) and
     d.text (the list as text); its tables are read from CommentBank as they are used. */
  var d = /** @type {any} */ (null);
  var C = () => /** @type {any} */ (window).CommentBank;
  function make(/** @type {any} */ deps) {
    d = deps;
    return API;
  }

  /* ── The teacher's choice of which habits the comment names ─────────── */

  /* The habits a sentence names are the teacher's to choose (Nov 27): a
     switch on each habit's row adds it to the comment or takes it out.
     The choice is { on: [keys], off: [keys] }, kept with the comment's
     record (draft_meta.habit_choice). The plan with a choice names every
     habit switched on that a sentence can hold and none switched off. */
  var HABIT_FORM_SLOTS = {
    well: ['habitsStrong', 'habitsStrongMore'],
    usual: ['habitsUsually', 'habitsUsuallyMore'],
    some: ['habitsSomeDays'],
    help: ['habitHelpOne'],
  };
  // The forms a habit at a rating can be named in, the first that has room.
  var HABIT_FORMS_AT = { 4: ['well'], 3: ['usual'], 2: ['help', 'some'], 1: ['help'] };
  var HABIT_MOST = { well: 3, usual: 3, some: SOME_MOST, help: 2 };
  function habitChoiceOf(c) {
    var ok = function (xs) {
      return (Array.isArray(xs) ? xs : []).filter(function (k) {
        return C().HABITS.some(function (h) {
          return h.key === k;
        });
      });
    };
    return { on: ok(c && c.on), off: ok(c && c.off) };
  }
  function habitChosen(c) {
    var x = habitChoiceOf(c);
    return x.on.length + x.off.length > 0;
  }
  function _formOfSlot(slot) {
    return C().HABIT_SLOTS[slot] ? C().HABIT_SLOTS[slot].form : '';
  }
  function _inGridOrder(keys) {
    return C()
      .HABITS.map(function (h) {
        return h.key;
      })
      .filter(function (k) {
        return keys.indexOf(k) >= 0;
      });
  }
  /* Parts ({ slot, keys }) with a habit named in one of them, else with a
     part of its own; null when no sentence can hold it (the forms for its
     rating are full or it is unrated). */
  function habitAdd(parts, habits, family, key, taken) {
    var out = (parts || []).map(function (p) {
      return Object.assign({}, p, { keys: p.keys.slice() });
    });
    // `taken`: the slots other sentences (the teacher's own) already hold.
    var held = taken || [];
    var named = out.some(function (p) {
      return p.keys.indexOf(key) >= 0;
    });
    if (named) return out;
    var forms = HABIT_FORMS_AT[(habits || {})[key]];
    if (!forms) return null;
    var fit = function (form, keys) {
      return (
        form === 'help' ||
        d.fit(keys, C().HABIT_SLOTS[HABIT_FORM_SLOTS[form][0]].form, family, HABIT_MOST[form], LIST_WORDS).length ===
          keys.length
      );
    };
    for (var i = 0; i < forms.length; i++) {
      var p = out.find(function (x) {
        return _formOfSlot(x.slot) === forms[i] && x.keys.length < HABIT_MOST[forms[i]];
      });
      var ks = p ? _inGridOrder(p.keys.concat(key)) : null;
      if (p && fit(forms[i], ks)) {
        p.keys = ks;
        if (forms[i] === 'help') p.slot = 'habitsHelpTwo';
        return out;
      }
    }
    for (var j = 0; j < forms.length; j++) {
      var slot = HABIT_FORM_SLOTS[forms[j]].find(function (sl) {
        return !out
          .concat(
            held.map(function (h) {
              return { slot: h };
            }),
          )
          .some(function (x) {
            return x.slot === sl || (sl === 'habitsUsually' && x.slot === 'habitsSteady');
          });
      });
      if (slot && fit(forms[j], [key])) {
        out.push({ slot: slot, keys: [key] });
        return out;
      }
    }
    return null;
  }
  /* Parts with a habit taken out of the one that names it; a part left
     with none goes, and the help sentence changes its slot with its count. */
  function habitRemove(parts, key) {
    return (parts || [])
      .map(function (p) {
        var keys = p.keys.filter(function (k) {
          return k !== key;
        });
        var slot = _formOfSlot(p.slot) === 'help' ? (keys.length === 1 ? 'habitHelpOne' : 'habitsHelpTwo') : p.slot;
        return Object.assign({}, p, { slot: slot, keys: keys });
      })
      .filter(function (p) {
        return p.keys.length;
      });
  }
  var LEAD_SLOTS = { habitsStrong: 1, habitsUsually: 1, habitsSteady: 1, habitsSomeDays: 1 };
  var MORE_SLOTS = { habitsStrongMore: 1, habitsUsuallyMore: 1 };
  var LEAD_OF_MORE = { habitsStrongMore: 'habitsStrong', habitsUsuallyMore: 'habitsUsually' };
  function chosenPlan(plan, habits, family, choice) {
    var c = habitChoiceOf(choice);
    if (!c.on.length && !c.off.length) return plan;
    var parts = [plan.lead, plan.more].filter(Boolean).map(function (p) {
      return { slot: p.slot, keys: p.keys.slice() };
    });
    if (plan.help.length)
      parts.push({ slot: plan.help.length === 1 ? 'habitHelpOne' : 'habitsHelpTwo', keys: plan.help });
    c.off.forEach(function (k) {
      parts = habitRemove(parts, k);
    });
    c.on.forEach(function (k) {
      if (c.off.indexOf(k) >= 0) return;
      parts = habitAdd(parts, habits, family, k) || parts;
    });
    var help = parts.find(function (p) {
      return _formOfSlot(p.slot) === 'help';
    });
    var rest = parts.filter(function (p) {
      return p !== help;
    });
    var lead = rest.find(function (p) {
      return LEAD_SLOTS[p.slot];
    });
    var more = rest.find(function (p) {
      return MORE_SLOTS[p.slot];
    });
    // A second sentence needs a first: with none, it takes the first's place.
    if (!lead && more && LEAD_OF_MORE[more.slot]) {
      lead = { slot: LEAD_OF_MORE[more.slot], keys: more.keys };
      more = undefined;
    }
    return {
      lead: lead || null,
      more: more || null,
      extra: rest.filter(function (p) {
        return p !== lead && p !== more;
      }),
      help: help ? help.keys : [],
      ie: plan.ie,
    };
  }
  /* A context with one habit slot said for these habits (a sentence
     rewritten to name another habit, or a new one for it): the slot's
     words, tokens and facts, as the context builds them for the plan. */
  function withHabitPart(ctx, slot, keys) {
    var def = C().HABIT_SLOTS[slot];
    if (!def) return ctx;
    var f = ctx._f || {};
    var toks = d.tokens(keys, def.form, f.family || '');
    var out = Object.assign({}, ctx);
    out[slot] = d.text(toks, f);
    out._toks = Object.assign({}, ctx._toks);
    out._toks[slot] = toks;
    out._facts = Object.assign({}, ctx._facts);
    out._facts[slot] = keys.map(function (k) {
      return 'habit:' + k;
    });
    if (slot === 'habitsUsually' || slot === 'habitsUsuallyMore') {
      var short = keys.length <= 2 ? 'yes' : '';
      out[slot + 'Short'] = short;
      out._facts[slot + 'Short'] = out._facts[slot];
    }
    return out;
  }
  /* The habit slot a sentence is made for ('' for any other sentence): a {slot} in its words
     or a slot it needs. */
  function habitSlotOf(s) {
    var slots = ((s && s.text && String(s.text).match(/\{\w+\}/g)) || [])
      .map(function (t) {
        return t.slice(1, -1);
      })
      .concat((s && s.needs) || []);
    return (
      slots.find(function (k) {
        return !!C().HABIT_SLOTS[k];
      }) || ''
    );
  }
  /* The step a habit slot's sentence fills. */
  function habitStepOf(slot) {
    return /More$/.test(slot) ? 'habitsMore' : _formOfSlot(slot) === 'help' ? 'habitsBuild' : 'habits';
  }
  /* The most habits a sentence of this slot names. */
  function habitMostOf(slot) {
    return HABIT_MOST[_formOfSlot(slot)] || 3;
  }

  /* Whether a sentence names the habits the plan has, each at the rating its slot
     says. With the teacher's choice (the Work Habits switches) it names any
     habits at that rating that are not switched off. */
  function ok(ids, ok, want, eff, choice) {
    var off = habitChoiceOf(choice).off;
    return (
      ids.length > 0 &&
      (habitChosen(choice) || ids.join() === want.join()) &&
      ids.every(function (k) {
        return ok.indexOf(eff[k]) >= 0 && off.indexOf(k) < 0;
      })
    );
  }

  var API = {
    SOME_MOST: SOME_MOST,
    LIST_WORDS: LIST_WORDS,
    chosenPlan: chosenPlan,
    add: habitAdd,
    remove: habitRemove,
    of: habitChoiceOf,
    chosen: habitChosen,
    slotOf: habitSlotOf,
    stepOf: habitStepOf,
    mostOf: habitMostOf,
    withPart: withHabitPart,
    formOf: _formOfSlot,
    ok: ok,
    partOf: function (plan, slot) {
      return (
        (plan.extra || []).find(function (p) {
          return p.slot === slot;
        }) || null
      );
    },
  };

  return { make: make };
})();
