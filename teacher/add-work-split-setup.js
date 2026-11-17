// @ts-check
/* ── add-work-split-setup.js — Split the Scan: Set Up Like Last Time (B5) ─
   When this teacher has split a scan before on this computer, Split the
   Scan opens with two of the choices they used last time: whether blank
   pages are left out, and Pages per Student when this scan does not show
   its own. One line says exactly what was set and which assessment it
   came from; Start Fresh puts the usual start back. Every choice stays on
   screen to change. The line shows only when something was set.

   The order of the pile is never carried over. Class List Order names
   every piece from the class list, and only the teacher can say this
   pile is sorted: a new scan always opens with names typed.

   Pages per Student: blank pages are set as last time first; then, when
   the pages kept divide evenly among the students (what startPer finds),
   the scan's own number stays. Last time's number is used only when the
   scan gives none.

   What is kept, in localStorage under KEY: the class id and assessment id
   it came from, Pages per Student, and whether blank pages were left out.
   Nothing about a student: no name, no student id, no file name, no page.
   The key starts with fv-, so signing out wipes it with the rest of this
   teacher's data (_clearDeviceData in shared/supabase.js).

   AddWorkSplitSetup.load()              the kept choices, or null.
   AddWorkSplitSetup.save(cid, aid, m)   keep the model's choices.
   AddWorkSplitSetup.apply(s, fresh)     set them on s.m where they change
                                         the usual start `fresh` ({ per,
                                         leaveOut }); s.setup says what.
   AddWorkSplitSetup.html(s)             the line and Start Fresh.
   AddWorkSplitSetup.click(s, what, btn, ctx) */
/** @type {any} */ (window).AddWorkSplitSetup = (function () {
  'use strict';

  var KEY = 'fv-add-work-split-setup';

  // Only these four fields are read or written; anything else (an `order`
  // kept by an earlier version of this key) is dropped.
  function _clean(o) {
    if (!o || typeof o !== 'object') return null;
    var per = Math.round(Number(o.per));
    if (!(per >= 1 && per <= 30)) return null;
    if (typeof o.leaveOut !== 'boolean') return null;
    return {
      cid: typeof o.cid === 'string' ? o.cid : '',
      aid: typeof o.aid === 'string' ? o.aid : '',
      per: per,
      leaveOut: o.leaveOut,
    };
  }

  function load() {
    try {
      return _clean(JSON.parse(localStorage.getItem(KEY) || 'null'));
    } catch (e) {
      return null;
    }
  }

  function save(cid, aid, m) {
    var o = _clean({ cid: cid, aid: aid, per: m.per(), leaveOut: m.leaveOut() });
    if (!o) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch (e) {
      /* a full or blocked store: next time starts fresh */
    }
  }

  // Whether the kept pages divide evenly among the students, 1 to 30 each.
  function _fits(kept, students) {
    var max = window.AddWorkSplitModel ? AddWorkSplitModel.maxPiece() : 30;
    return !!students && kept > 0 && kept % students === 0 && kept / students <= max;
  }

  function apply(s, fresh) {
    s.setup = null;
    var last = load();
    if (!last) return false;
    var set = {};
    if (last.leaveOut !== fresh.leaveOut) {
      s.m.setLeaveOut(last.leaveOut);
      set.leaveOut = last.leaveOut;
    }
    var students = (s.list || []).length;
    var kept = s.m.counts().kept;
    var per = _fits(kept, students) ? kept / students : last.per;
    if (per !== s.m.per() || set.leaveOut !== undefined) s.m.setPer(per);
    if (per !== fresh.per) set.per = per;
    if (set.per === undefined && set.leaveOut === undefined) {
      // Nothing changed from the usual start: put it back as it was.
      if (s.m.leaveOut() !== fresh.leaveOut) s.m.setLeaveOut(fresh.leaveOut);
      if (s.m.per() !== fresh.per) s.m.setPer(fresh.per);
      return false;
    }
    s.setup = { last: last, fresh: fresh, set: set };
    return true;
  }

  // "2 pages per student, blank pages kept": only the choices given.
  function words(c) {
    var out = [];
    if (c.per !== undefined) out.push(c.per + (c.per === 1 ? ' page' : ' pages') + ' per student');
    if (c.leaveOut !== undefined) out.push(c.leaveOut ? 'blank pages left out' : 'blank pages kept');
    return out.join(', ');
  }

  function _from(last) {
    var a =
      last.cid && last.aid && typeof getAssessments === 'function'
        ? (getAssessments(last.cid) || []).find(function (x) {
            return x && x.id === last.aid;
          })
        : null;
    return a && a.title ? 'From ' + a.title + ': ' : 'From your last scan: ';
  }

  // html-safe: the assessment's title and fixed words go through esc
  function html(s) {
    if (!s.setup) return '';
    var w = words(s.setup.set);
    return (
      '<section class="aws-sec aws-setup" aria-labelledby="aws-setup-h">' +
      '<h3 class="aws-h" id="aws-setup-h">Set Up Like Last Time</h3>' +
      '<p class="aws-hint">' +
      esc(_from(s.setup.last) + w.charAt(0).toUpperCase() + w.slice(1) + '. Change anything below.') +
      '</p>' +
      '<button type="button" class="aws-fresh" data-aws="fresh" data-key="fresh">Start Fresh</button>' +
      '</section>'
    );
  }

  function click(s, what, btn, ctx) {
    if (what !== 'fresh' || !s.setup) return false;
    var f = s.setup.fresh;
    s.m.setLeaveOut(f.leaveOut);
    s.m.setPer(f.per);
    s.setup = null;
    s.headNote = 'Started fresh: ' + words(f) + '.';
    ctx.draw({ glide: true, focus: 'per:+', fallback: '.aws-step' });
    return true;
  }

  return { KEY: KEY, load: load, save: save, apply: apply, html: html, click: click, words: words };
})();
