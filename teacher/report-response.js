// @ts-check
/* report-response.js — the Parent / Guardian Response: how it prints and
   where (DECISIONS, "The Parent / Guardian Response's place and options",
   2026-11-27).

   Place: At the Bottom docks it at the foot of the report's last side, as
   it always printed; After Part Above prints it straight after the part
   above it, and it moves in One Report's panel like any part. Either way it
   is one piece. Its options add the student's name beside its heading, a
   dashed cut line over it and a return-by date in its instruction; Comment
   Lines (the form engine's) sets its comments box.

   report-blocks.js draws it through html() with the class's wording;
   report-one.js reads OPTIONS, docks() and dock(); the panel reads
   where(). Loaded with report-blocks.js, before report-one.js. */
window.ReportResponse = (function () {
  'use strict';

  var KEY = 'parent-response';

  /* The part's options in One Report's panel. */
  var OPTIONS = [
    {
      key: 'place',
      label: 'Place',
      def: 'foot',
      choices: [
        { v: 'foot', label: 'At the Bottom' },
        { v: 'follow', label: 'After Part Above' },
      ],
    },
    { key: 'name', label: 'Student’s Name', def: false },
    { key: 'cut', label: 'Cut Line', def: false },
    { key: 'due', label: 'Return By', date: true },
  ];

  /* Does the response dock at the foot of the last side (as it always
     did), or print after the part above it. m: One Report's model. */
  function docks(m) {
    var o = (m && m.options && m.options[KEY]) || {};
    return o.place !== 'follow';
  }
  /* The line under the part's name in the panel. */
  function where(m) {
    return docks(m) ? 'At the bottom of the last page' : 'After the part above';
  }

  /* Docks the response, px tall, at the foot of the last side of the
     report (before the sides printed after it), or on a side of its own
     when there is no room left there. Returns the sides. */
  function dock(sides, px, H, headPx, GAP) {
    var ph = Math.min(px, H - headPx - GAP);
    var afters = sides.filter(function (sd) {
      return sd.kind === 'after';
    });
    sides = sides.filter(function (sd) {
      return sd.kind !== 'after';
    });
    var last = sides[sides.length - 1];
    var bottom = last
      ? last.rows.reduce(
          function (y, row) {
            return Math.max(y, row.y + row.h);
          },
          last.head ? headPx : 0,
        )
      : 0;
    if (!last || bottom + GAP + ph > H) {
      last = { rows: [], kind: 'continued', from: 0, head: sides.length > 0 };
      sides.push(last);
    }
    last.pinned = { id: KEY, size: 'row', h: ph, y: H - ph };
    return sides.concat(afters);
  }

  /* ── Drawing it ── */
  var DUE_INTRO = 'Please review this report with your child and return this section to {teacher} by {date}.';
  var DUE_SCHOOL = 'Please review this report with your child and return this section to the school by {date}.';

  /* A return-by date (YYYY-MM-DD) as it prints: "Friday, December 4". */
  function dueDate(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return '';
    // Noon UTC, read in UTC: the day picked, in any time zone.
    var d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
    return isNaN(d.getTime())
      ? ''
      : d.toLocaleDateString('en-CA', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' });
  }
  /* The instruction with the return-by date in it. Today's wording reads
     "return this section to {teacher} by {date}"; a class's own can name
     {date}, and one that does not gets "Please return it by {date}." after
     it. */
  function _introHtml(w, student, o, h) {
    var due = dueDate(o.due);
    var text = w.intro == null ? '' : String(w.intro);
    if (due) {
      var teacher = (typeof getConfig === 'function' && getConfig().displayName) || '';
      if (text === h.today) text = teacher ? DUE_INTRO : DUE_SCHOOL;
      else if (!/\{date\}/.test(text)) text = (text ? text + ' ' : '') + 'Please return it by {date}.';
    }
    return h.intro(text, student).replace(/\{date\}/g, function () {
      return esc(due);
    });
  }
  function _titleHtml(cid, student, o, title) {
    if (!o.name) return '<div class="report-block-title">' + title + '</div>';
    var course = COURSES[cid] || {};
    var who = [printedStudentName(student), course.name].filter(Boolean).join(' · ');
    return (
      '<div class="report-parent-head"><div class="report-block-title">' +
      title +
      '</div><div class="report-parent-who">' +
      esc(who) +
      '</div></div>'
    );
  }

  /* The response's HTML. options: the part's (lines, wording, cut, name,
     due). h: from report-blocks.js, { wording (the class's, over today's),
     say (prints a string of today's wording as is, else escaped), intro
     (fills {name} and {teacher}), today (today's instruction) }. With none
     of the options on it prints as it always did. */
  function html(cid, student, options, h) {
    var o = options || {};
    var lines = Math.max(1, Number(o.lines || 3));
    var w = h.wording;
    var say = h.say;
    var out = '<div class="report-block-box report-parent-response' + (o.cut ? ' has-cut' : '') + '">';
    if (o.cut)
      out += '<div class="report-parent-cut" aria-hidden="true"><span class="report-parent-cut-mark">✂</span></div>';
    out += _titleHtml(cid, student, o, say(w.title));
    out += `<div class="report-parent-intro" data-wt="intro" data-wraw="${esc(w.intro == null ? '' : String(w.intro))}" style="font-size:0.78rem;color:var(--text-2);margin-bottom:14px;line-height:1.5">${_introHtml(w, student, o, h)}</div>`;
    // The labelled lines, two to a row: Signature + Date, Phone + Email
    var field = function (/** @type {string} */ f, /** @type {number} */ i) {
      return `<div class="report-parent-line" data-wrow="fields.${i}"${f === 'Date' ? ' style="max-width:180px"' : ''}><span class="report-parent-label" data-wt="fields.${i}">${say(f)}</span><span class="report-parent-field"></span></div>`;
    };
    for (var i = 0; i < w.fields.length; i += 2) {
      var at = i;
      out += `<div class="report-parent-lines">
    ${w.fields
      .slice(i, i + 2)
      .map((/** @type {string} */ f, /** @type {number} */ j) => field(f, at + j))
      .join('\n    ')}
  </div>`;
    }
    // Checkboxes
    if (w.checks.length) {
      out += `<div class="report-parent-checks">
    ${w.checks.map((/** @type {string} */ c, /** @type {number} */ k) => `<div class="report-parent-check" data-wrow="checks.${k}"><span class="report-parent-checkbox"></span> <span data-wt="checks.${k}">${say(c)}</span></div>`).join('\n    ')}
  </div>`;
    }
    // Comments
    w.open.forEach((/** @type {string} */ label, /** @type {number} */ k) => {
      out += `<div class="report-parent-comments" data-wrow="open.${k}" style="margin-top:14px">
    <div class="report-parent-label" data-wt="open.${k}" style="margin-bottom:6px">${say(label)}</div>
    <div class="report-parent-comments-box" style="border:1.5px solid var(--border);border-radius:8px;min-height:${lines * 22 + 16}px;padding:8px"></div>
  </div>`;
    });
    out += `</div>`;
    return out;
  }

  return { KEY: KEY, OPTIONS: OPTIONS, docks: docks, where: where, dock: dock, dueDate: dueDate, html: html };
})();
