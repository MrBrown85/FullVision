// @ts-check
/* ── add-work-split-setup.js — Split the Scan: Set Up Like Last Time (B5) ─
   When this teacher has split a scan before on this computer, Split the
   Scan opens with the choices they used last time: Pages per Student, the
   order of the pile, and whether blank pages are left out. One line says
   what was set and which assessment it came from; Start Fresh puts the
   usual start back. Every choice stays on screen to change.

   What is kept, in localStorage under KEY: the class id and assessment id
   it came from, and the three choices. Nothing about a student: no name,
   no student id, no file name, no page. The key starts with fv-, so
   signing out wipes it with the rest of this teacher's data
   (_clearDeviceData in shared/supabase.js).

   AddWorkSplitSetup.load()              the kept choices, or null.
   AddWorkSplitSetup.save(cid, aid, m)   keep the model's choices.
   AddWorkSplitSetup.apply(s, fresh)     set them on s.m when they differ
                                         from `fresh` ({ per, order,
                                         leaveOut }); s.setup says so.
   AddWorkSplitSetup.html(s)             the line and Start Fresh.
   AddWorkSplitSetup.click(s, what, btn, ctx) */
/** @type {any} */ (window).AddWorkSplitSetup = (function () {
  'use strict';

  var KEY = 'fv-add-work-split-setup';

  function _clean(o) {
    if (!o || typeof o !== 'object') return null;
    var per = Math.round(Number(o.per));
    if (!(per >= 1 && per <= 30)) return null;
    if (o.order !== 'list' && o.order !== 'typed') return null;
    if (typeof o.leaveOut !== 'boolean') return null;
    return {
      cid: typeof o.cid === 'string' ? o.cid : '',
      aid: typeof o.aid === 'string' ? o.aid : '',
      per: per,
      order: o.order,
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

  // Only these five fields are ever written.
  function save(cid, aid, m) {
    var o = _clean({ cid: cid, aid: aid, per: m.per(), order: m.order(), leaveOut: m.leaveOut() });
    if (!o) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(o));
    } catch (e) {
      /* a full or blocked store: next time starts fresh */
    }
  }

  function _same(a, b) {
    return a.per === b.per && a.order === b.order && a.leaveOut === b.leaveOut;
  }

  function apply(s, fresh) {
    s.setup = null;
    var last = load();
    if (!last || _same(last, fresh)) return false;
    // Blank pages first: Pages per Student counts the pages kept.
    s.m.setLeaveOut(last.leaveOut);
    s.m.setOrder(last.order);
    s.m.setPer(last.per);
    s.setup = { last: last, fresh: fresh };
    return true;
  }

  // "2 pages per student, Class List Order, blank pages left out"
  function words(c) {
    return [
      c.per + (c.per === 1 ? ' page' : ' pages') + ' per student',
      c.order === 'list' ? 'Class List Order' : 'names typed',
      c.leaveOut ? 'blank pages left out' : 'blank pages kept',
    ].join(', ');
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
    return (
      '<section class="aws-sec aws-setup" aria-labelledby="aws-setup-h">' +
      '<h3 class="aws-h" id="aws-setup-h">Set Up Like Last Time</h3>' +
      '<p class="aws-hint">' +
      esc(_from(s.setup.last) + words(s.setup.last) + '. Change anything below.') +
      '</p>' +
      '<button type="button" class="aws-fresh" data-aws="fresh" data-key="fresh">Start Fresh</button>' +
      '</section>'
    );
  }

  function click(s, what, btn, ctx) {
    if (what !== 'fresh' || !s.setup) return false;
    var f = s.setup.fresh;
    s.m.setLeaveOut(f.leaveOut);
    s.m.setOrder(f.order);
    s.m.setPer(f.per);
    s.setup = null;
    s.headNote = 'Started fresh: ' + words(f) + '.';
    ctx.draw({ glide: true, focus: 'per:+', fallback: '.aws-step' });
    return true;
  }

  return { KEY: KEY, load: load, save: save, apply: apply, html: html, click: click, words: words };
})();
