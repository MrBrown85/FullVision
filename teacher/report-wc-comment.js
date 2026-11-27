// @ts-check
/* report-wc-comment.js — Write Comments: the Teacher Comment card
   (docs/plans/write-comments-plan.md, decisions 8 and 9). The comment reads
   as the sentences it is made of, each lit with its line in its box; a
   click makes it a box to type in, and the typed text is read back into
   sentences when the box loses the focus (ReportWc.endTyping). Under it,
   the checks of the comment as a whole, each with one action, and the
   count, the reading grade, Generate Again and Copy. The main file keeps
   the comment's record and what the card shares with it (the stale
   sentences, the basis switch, the class warning); they come through
   configure(). */
window.ReportWcComment = (function () {
  'use strict';

  var P = ReportWcParts;
  var H = /** @type {any} */ (null);
  var ui = /** @type {any} */ (null);
  function configure(host, state) {
    H = host;
    ui = state;
  }

  /* ── The comment as its sentences ────────────────────────── */

  /* The comment as spans, one for each sentence row, each carrying its
     row's key so the line in its box lights with it. When the rows do not
     read as the saved text (a comment typed a moment ago), the text is
     shown as it is. */
  // html-safe: every sentence esc()'d; keys are ids esc()'d
  function readingHtml(rows, text) {
    var joined = rows
      .map(function (r) {
        return r.text;
      })
      .join(' ');
    var squash = function (t) {
      return String(t || '')
        .replace(/\s+/g, ' ')
        .trim();
    };
    if (!rows.length || squash(joined) !== squash(text)) return esc(text);
    var seen = {};
    return rows
      .map(function (r) {
        seen[r.id] = (seen[r.id] || 0) + 1;
        var rk = esc(String(r.id)) + '#' + (seen[r.id] - 1);
        var last = r.id && H.lastIds().indexOf(r.id) >= 0 && !r.classLine ? ' last' : '';
        return `<span class="wc-sent${last}" data-rk="${rk}">${esc(r.text)}</span>`;
      })
      .join(' ');
  }

  /* ── The checks ──────────────────────────────────────────── */

  /* The notes under the comment: [{ text, buttons: [{ label, act, data }] }]. */
  function notes() {
    var st = H.current();
    if (!st) return [];
    var rows = H.rows(st, H.facts(st));
    var out = [];
    var run = P.sameOpening(
      rows.map(function (r) {
        return r.text;
      }),
    );
    if (run) out.push({ text: P.openingNote(run), buttons: [{ label: 'Vary Them', act: 'wcVary', data: {} }] });
    var habit = H.habitNote(st, rows);
    if (habit) out.push(habit);
    return out;
  }
  // html-safe: the note's words and buttons esc()'d
  function notesHtml() {
    return notes()
      .map(function (n) {
        var btns = n.buttons
          .map(function (b) {
            var data = Object.keys(b.data || {})
              .map(function (k) {
                return ` data-${k}="${esc(b.data[k])}"`;
              })
              .join('');
            return `<button type="button" class="wc-link" data-action="tqSentences" data-do="${esc(b.act)}"${data}>${esc(b.label)}</button>`;
          })
          .join('');
        return `<div class="wc-note" role="status"><span class="wc-note-text">${esc(n.text)}</span>${btns}</div>`;
      })
      .join('');
  }
  function syncNotes() {
    var el = document.getElementById('wc-notes');
    // html-safe: notesHtml() esc()s every word
    if (el) el.innerHTML = notesHtml();
    syncReads();
  }

  /* The reading grade of the comment, 3 to 12. */
  function readsText(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    var n = H.sentenceCount(t);
    return 'Reads at Grade ' + P.readingGrade(t, n);
  }
  function syncReads() {
    var el = document.getElementById('wc-reads');
    var box = H.box();
    if (el && box) el.textContent = readsText(box.value);
  }

  /* Vary Them: the second sentence of a run that opens alike is worded
     another way (a bank wording that opens differently), one by one; Undo
     puts the comment back. */
  function vary() {
    var st = H.current();
    if (!st) return;
    var f = H.facts(st);
    var rows = H.rows(st, f).slice();
    var run = P.sameOpening(
      rows.map(function (r) {
        return r.text;
      }),
    );
    if (!run) return;
    var snap = H.snapshot(st);
    var changed = false;
    for (var i = run.from + 1; i < run.from + run.n; i += 2) {
      var next = H.otherOpening(st, f, rows, i, run.word);
      if (next) {
        rows[i] = next;
        changed = true;
      }
    }
    if (!changed) return H.nothingFits();
    H.setRows(st, rows, null, '');
    H.undoToast(st, 'Openings changed.', snap);
  }

  function keepNote(kind) {
    if (kind === 'habit') H.keepHabitNote();
    syncNotes();
  }

  /* The Teacher Comment card's note for an approved comment that no longer
     matches (staleFor), from the card's own pieces. */
  var CLASS_SENTENCE_NAMES = {
    closing: 'the closing sentence',
    support: 'the support line',
    late_work: 'the late-work line',
  };
  var CB = function () {
    return window.CommentBank;
  };
  var CR = function () {
    return /** @type {any} */ (window).CommentRealiser;
  };
  function _cap(t) {
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }
  function _sentenceCount(n) {
    return n === 1 ? 'one sentence no longer matches' : CB().numberWords(n) + ' sentences no longer match';
  }
  /* What changed, as the card's note says it: the pieces marked since the
     approval (the States mockup's "“…” was marked …, so one sentence no
     longer matches the gradebook."), and any class sentence edited since.
     The day a mark was entered is not kept, so the note says "after" the
     approval's day. */
  function staleNote(stale, day) {
    var out = [];
    var marks = stale.changes.filter(function (c) {
      return c.kind === 'marks';
    }).length;
    if (marks && stale.moved === false) {
      // The facts are as they were at approval: the sentence was already
      // out of date then.
      out.push(_cap(_sentenceCount(marks)) + ' the gradebook.');
    } else if (marks) {
      var p = stale.pieces || [];
      var q = p.map(function (t) {
        return CR().quoteTitle(t) || '“' + t + '”';
      });
      var who =
        p.length === 1
          ? q[0] + ' was marked'
          : p.length === 2
            ? q[0] + ' and ' + q[1] + ' were marked'
            : p.length > 2
              ? _cap(CB().numberWords(p.length)) + ' assignments were marked'
              : // No piece was marked since: the grades worked out from the
                // same marks changed.
                'Grades changed';
      out.push(who + ' after ' + day + ', so ' + _sentenceCount(marks) + ' the gradebook.');
    }
    var cls = stale.changes.filter(function (c) {
      return c.kind === 'class';
    });
    if (cls.length) {
      var names = CB().list(
        cls.map(function (c) {
          return CLASS_SENTENCE_NAMES[c.key] || 'a class sentence';
        }),
      );
      out.push(_cap(names) + ' changed after ' + day + ', so ' + _sentenceCount(cls.length) + ' your class settings.');
    }
    var pron = stale.changes.filter(function (c) {
      return c.kind === 'pronouns';
    }).length;
    var named = stale.changes.filter(function (c) {
      return c.kind === 'name';
    }).length;
    if (pron || named) {
      var whose = pron && stale.renamed ? 'The name and pronouns' : pron ? 'The pronouns' : 'The name';
      out.push(whose + ' changed after ' + day + ', so ' + _sentenceCount(pron + named) + (pron ? ' them.' : ' it.'));
    }
    out.push('Approved text is never changed for you.');
    return out.join(' ');
  }

  /* ── The card ────────────────────────────────────────────── */

  function _tabs(p) {
    if (!p.tabs.length) return '';
    var btn = function (t) {
      return `<button type="button" class="seg-btn${t.on ? ' active' : ''}" data-action="tqCommentTab" data-tab="${esc(t.key)}" aria-pressed="${t.on}" title="${esc(t.tip)}">${esc(t.label)}</button>`;
    };
    return `<div class="seg seg-sm qn-comment-tabs" role="group" aria-label="Report">${p.tabs.map(btn).join('')}</div>`;
  }
  // html-safe: the text, labels and every sub-card (stale, basis, warning, count) esc()'d by the host
  function _body(p) {
    if (!p.thisTab)
      return `<div class="qn-hint">Went home in ${esc(p.earlierLabel)} · read only</div>
        <div class="qn-earlier">${p.earlierParas
          .map(function (t) {
            return '<p>' + esc(t) + '</p>';
          })
          .join('')}</div>`;
    var hasText = !!p.text.trim();
    var reads = readsText(p.text);
    return `${p.noDraft}${p.empty}
      <div class="wc-textwrap">
        <p class="wc-read" id="tq-read" role="textbox" tabindex="0" aria-label="Teacher comment. Click to type." title="Click to type" data-action="tqSentences" data-do="wcType"${hasText ? '' : ' hidden'}>${readingHtml(p.rows, p.text)}</p>
        <textarea id="tq-narrative" class="wc-textarea" rows="1" spellcheck="true" aria-label="Teacher Comment" hidden data-cid="${esc(p.cid)}" data-sid="${esc(p.sid)}" data-term="${esc(p.termId)}">${esc(p.text)}</textarea>
      </div>
      <div id="wc-notes">${notesHtml()}</div>
      <div class="qn-comment-foot wc-foot-row" id="tq-comment-foot"${hasText ? '' : ' hidden'}>
        ${p.count}
        <span class="wc-chip" id="wc-reads" title="How hard the comment is to read, as a school grade">${esc(reads)}</span>
        <button type="button" class="qn-sel-add" id="tq-sel-add" hidden data-action="tqSentences" data-do="ownFromBox" title="Adds the selected sentence to your bank, for other students it fits.">Add to My Bank</button>
        <span class="wc-spacer"></span>
        <button type="button" class="wc-btn" data-action="tqGenerate" id="tq-generate" title="Writes the comment again from the gradebook, your ratings and Student Voice. Sentences you typed or edited and your order stay.">Generate Again</button>
        <button type="button" class="wc-btn qn-copy" data-action="tqCopyNarrative" id="tq-copy-btn" title="Copies the comment as plain text, ready to paste. ⌘⇧C">${p.copyIcon}<span class="qn-copy-label">Copy</span></button>
      </div>`;
  }

  /* The card. p: the parts the main file keeps (host.commentParts). */
  // html-safe: see _body; the title row's words esc()'d
  function card(cid, student, f) {
    var p = H.commentParts(cid, student, f);
    var first = p.thisTab
      ? `<button type="button" class="wc-btn wc-btn-main" data-action="tqGenerate" id="tq-generate-first"${p.text.trim() ? ' hidden' : ''} title="Writes the comment from the gradebook, your ratings and Student Voice.">Generate Comment</button>`
      : '';
    return `<div class="qn-comment wc-comment" id="tq-comment-card">
      <div class="qn-comment-top wc-comment-top">
        <h2 class="wc-comment-title">Teacher Comment</h2>
        ${p.approved}${_tabs(p)}${first}
      </div>
      ${p.stale}${p.pronoun}${p.basis}
      <div id="tq-warn-wrap">${p.warn}</div>
      ${_body(p)}
    </div>`;
  }

  return {
    configure: configure,
    staleNote: staleNote,
    card: card,
    readingHtml: readingHtml,
    notes: notes,
    syncNotes: syncNotes,
    syncReads: syncReads,
    readsText: readsText,
    vary: vary,
    keepNote: keepNote,
  };
})();
