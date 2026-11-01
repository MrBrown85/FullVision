/* report-questionnaire.js — the Term Questionnaire's review screen
   (fullvision-generate-plan, PR 11a; the "Review screen" mockup). One
   student at a time: the header with the grade, Work Habits as a radio
   grid, At a Glance (Work and Skills), the student's Voice, the Teacher
   Comment with Generate Comment, and the one-line Attendance card. The
   comment is plain text; Generate drafts it from the bank
   (teacher/comment-bank.js). The class's roster is the app's sidebar, which
   this page marks Needs Approval or ticked. Approve and Next in the toolbar
   saves the comment as approved and opens the next student. */
window.ReportQuestionnaire = (function () {
  'use strict';

  /* ── Parent state injection ──────────────────────────────── */
  var _activeCourse = null;
  var _renderReports = null;
  var _onLastStudent = null;
  var _openEditStudent = null;

  function configure(opts) {
    _activeCourse = opts.activeCourse;
    _renderReports = opts.renderReports;
    if (opts.onLastStudent) _onLastStudent = opts.onLastStudent;
    if (opts.openEditStudent) _openEditStudent = opts.openEditStudent;
  }
  function rerender() {
    if (_renderReports) _renderReports();
  }

  var getTermId = ReportBlocks.getTermId;

  var tqStudentIndex = 0;
  var tqNarrativeDirty = false;
  var _notReadyOnly = false;
  var _commentTab = 'this'; // 'this' or an earlier report's term id
  var _saveTimer = null;

  /* What FullVision has for the student on screen, read once per drawing
     and again only after something it depends on changes (a habit,
     attendance); typing never re-reads it. */
  var _factsCache = null;
  function _facts(student, fresh) {
    var key = _activeCourse + '|' + student.id + '|' + getTermId();
    if (fresh || !_factsCache || _factsCache.key !== key) {
      _factsCache = { key: key, f: CommentBank.facts(_activeCourse, student, getTermId()) };
    }
    return _factsCache.f;
  }

  function getTqStudents() {
    return sortStudents(getStudents(_activeCourse), 'lastName');
  }
  function _current() {
    return getTqStudents()[tqStudentIndex] || null;
  }

  /* ── Moving between students ─────────────────────────────── */
  function _goTo(idx) {
    tqSaveCurrentIfNeeded();
    var students = getTqStudents();
    tqStudentIndex = Math.max(0, Math.min(students.length - 1, idx));
    _commentTab = 'this';
    rerender();
  }
  function tqPrevStudent() {
    _goTo(tqStudentIndex - 1);
  }
  /* The roster and ↑ ↓ move without approving. */
  function tqNextStudent() {
    var students = getTqStudents();
    if (tqStudentIndex >= students.length - 1) {
      tqSaveCurrentIfNeeded();
      if (_onLastStudent) _onLastStudent();
      return;
    }
    _goTo(tqStudentIndex + 1);
  }
  function tqSelectStudent(sid) {
    var idx = getTqStudents().findIndex(function (s) {
      return s.id === sid;
    });
    if (idx >= 0) _goTo(idx);
  }

  /* ── The comment ─────────────────────────────────────────── */

  /* A comment saved as HTML by the old editor, as plain text: block ends
     and line breaks become new lines, tags go, entities are read. */
  function plainComment(stored) {
    var s = String(stored || '');
    if (!/<\/?(p|div|br|ul|ol|li|b|i|u|strong|em|span)\b[^>]*>/i.test(s)) return s;
    s = s
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])\s*>/gi, '\n')
      .replace(/<li[^>]*>/gi, '')
      .replace(/<[^>]*>/g, '');
    s = s
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#(\d+);/g, function (m, n) {
        return String.fromCharCode(Number(n));
      })
      .replace(/&#x([0-9a-f]+);/gi, function (m, n) {
        return String.fromCharCode(parseInt(n, 16));
      })
      .replace(/&amp;/g, '&');
    return s
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function _box() {
    return document.getElementById('tq-narrative');
  }

  /* Saves the box's text for the class, student and report the box was
     drawn for (its data attributes), so a save that runs after the report,
     the class or the tab has changed still lands where it was typed. An
     edit after approval clears it (upsertTermRating does, as the server
     does). */
  function tqSaveNarrative() {
    var el = _box();
    clearTimeout(_saveTimer);
    if (!el || !el.dataset.sid) return;
    var cid = el.dataset.cid || _activeCourse;
    var sid = el.dataset.sid;
    var termId = el.dataset.term || getTermId();
    var before = getStudentTermRating(cid, sid, termId) || {};
    var text = el.value.replace(/\s+$/, '');
    tqNarrativeDirty = false;
    if (text === plainComment(before.narrative || '').replace(/\s+$/, '')) return;
    upsertTermRating(cid, sid, termId, { narrative: text });
    _syncStatus();
  }
  /* Before anything replaces the page: the class, the report, the tab, the
     student. */
  function tqSaveCurrentIfNeeded() {
    if (tqNarrativeDirty) tqSaveNarrative();
  }

  /* Typing: the box grows with its text, the count follows, and the text is
     saved shortly after the teacher pauses. */
  function tqNarrativeInput() {
    tqNarrativeDirty = true;
    _syncNote();
    _alignSoon();
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(tqSaveNarrative, 600);
  }

  /* The comment grows with its text: no inner scrolling. */
  function _fitBox() {
    var el = _box();
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  /* "1 character", "2 characters"; `count` when n is the number written
     out ("1,000"). */
  function _plural(n, one, many, count) {
    return n + ' ' + (Number(count == null ? n : count) === 1 ? one : many);
  }
  function _countText(text) {
    var n = String(text || '').length;
    var lim = _limit();
    // Over the limit: "1,032 of 1,000 characters" (the States mockup).
    if (lim && n > lim) return _thousands(n) + ' of ' + _plural(_thousands(lim), 'character', 'characters', lim);
    return _plural(n, 'character', 'characters');
  }
  function _thousands(n) {
    return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  /* The sentences of a comment over 20 words, a quoted title counting as
     one (the realiser's rule; a teacher's edit can pass it). */
  function longSentences(text) {
    return sentencesOf(text).filter(function (t) {
      return CommentRealiser.tooLong(t);
    });
  }
  /* After the count: why Approve and Next is off (the count turns orange),
     else the class's limit. */
  function _countTail(text) {
    if (_overLimit(text)) return ' · remove or shorten a sentence';
    var n = longSentences(text).length;
    if (n === 1) return ' · one sentence is over 20 words';
    if (n > 1) return ' · ' + CommentBank.numberWords(n) + ' sentences are over 20 words';
    return _limitText();
  }
  function _countFlag(text) {
    return _overLimit(text) || longSentences(text).length > 0;
  }
  function _syncCount() {
    var el = _box();
    var out = document.getElementById('tq-count');
    if (el && out) out.textContent = _countText(el.value);
    var tail = document.getElementById('tq-limit-text');
    if (el && tail) tail.textContent = _countTail(el.value);
    var btn = document.getElementById('tq-count-btn');
    if (el && btn) btn.classList.toggle('over', _countFlag(el.value));
    syncApprove();
  }

  /* ── The character limit (plan PR 8) ─────────────────────── */

  /* The class's character limit, or null for no limit. */
  function _limit() {
    return CommentBank.classSettings(_activeCourse).charLimit;
  }
  function _overLimit(text) {
    var lim = _limit();
    return !!lim && String(text || '').length > lim;
  }
  /* "· no limit" or "· limit 1000" after the count. */
  function _limitText() {
    var lim = _limit();
    return lim ? ' · limit ' + lim : ' · no limit';
  }
  var _limitOpen = false;
  /* The count as a button that opens the limit, and the limit's popover. */
  function _countHtml(cid, text) {
    var course = _courseName(cid);
    var pop = _limitOpen
      ? `<div class="qn-limit" role="dialog" aria-label="Character limit" id="tq-limit">
          <label class="qn-limit-field">Character limit for ${esc(course)}<input type="text" inputmode="numeric" autocomplete="off" placeholder="No limit" aria-label="Character limit" aria-describedby="tq-limit-msg" data-tq-limit="1" id="tq-limit-input" title="Leave it empty for no limit." value="${_limit() || ''}"></label>
          <span class="qn-limit-msg" id="tq-limit-msg" role="alert" hidden></span>
          <span class="qn-limit-hint">The longest comment your school’s report card allows. Approve stays off past it.</span>
        </div>`
      : '';
    return `<span class="qn-count-wrap"><button type="button" class="qn-count-btn${_countFlag(text) ? ' over' : ''}" id="tq-count-btn" data-action="tqLine" data-do="limitMenu" aria-haspopup="dialog" aria-expanded="${_limitOpen}" title="The comment’s length. Click to set the longest comment ${esc(course)} allows."><span class="qn-count-text" id="tq-count">${esc(_countText(text))}</span><span id="tq-limit-text">${esc(_countTail(text))}</span> ▾</button>${pop}</span>`;
  }
  /* A limit typed: saved for the class when it is a whole number from 100
     to 5000, or empty for no limit (CommentBank.parseLimit). Anything else
     is not saved: the limit stays as it was, the box stays open and says
     what it takes. Returns whether it was saved. */
  var LIMIT_MSG =
    'Enter a whole number from ' +
    CommentBank.LIMIT_MIN +
    ' to ' +
    CommentBank.LIMIT_MAX +
    ', or leave it empty for no limit.';
  var _limitCancelled = false;
  function _setLimit(value) {
    // The limit as saved, unchanged (one saved by older code below 100
    // too): kept as is. Only a new entry is held to 100 to 5000.
    if (String(value == null ? '' : value).trim() === String(_limit() || '')) {
      _limitMsg(false);
      _syncCount();
      return true;
    }
    var p = CommentBank.parseLimit(value);
    _limitMsg(!p.ok);
    if (!p.ok) return false;
    _saveSettings({ charLimit: p.limit });
    _syncCount();
    return true;
  }
  /* The limit's message under its box, shown or hidden. */
  function _limitMsg(on) {
    var msg = document.getElementById('tq-limit-msg');
    var input = document.getElementById('tq-limit-input');
    if (msg) {
      msg.textContent = on ? LIMIT_MSG : '';
      msg.hidden = !on;
    }
    if (input) {
      if (on) input.setAttribute('aria-invalid', 'true');
      else input.removeAttribute('aria-invalid');
    }
  }

  /* Copy: the comment as plain text, ready to paste (⌘⇧C too). */
  function tqCopyNarrative() {
    var el = _box();
    var text = el ? el.value : '';
    var btn = document.getElementById('tq-copy-btn');
    if (!text.trim() || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function () {
      if (!btn) return;
      var label = btn.querySelector('.qn-copy-label');
      if (!label) return;
      // A green "✓ Copied" pill for a moment (the States mockup).
      label.textContent = 'Copied';
      btn.classList.add('copied');
      setTimeout(function () {
        label.textContent = 'Copy';
        btn.classList.remove('copied');
      }, 1600);
    });
  }

  /* The next student not yet approved, after this one and round to the
     top; -1 once every comment is approved. */
  function _nextUnapproved() {
    var students = getTqStudents();
    for (var k = 1; k <= students.length; k++) {
      var i = (tqStudentIndex + k) % students.length;
      if (!_approved(students[i].id)) return i;
    }
    return -1;
  }

  /* Approve and Next: saves the comment as approved and opens the next
     student not yet approved, round to the top (⌘ Return too). Once every
     comment is approved it stays on this student, drawn as approved, and
     "Suggested for Your Bank" opens when there is anything to offer. */
  function tqApproveNext() {
    var st = _current();
    var el = _box();
    if (!st) return;
    if (_resync(st)) return;
    // The rows follow the box first, so the bank's suggestions read the
    // comment as approved (plan PR 10), and the claims are checked against
    // today's marks.
    clearTimeout(_alignTimer);
    _alignNow();
    _facts(st, true);
    var blocked = approveBlockers(st);
    if (blocked.length) {
      // A sentence found out of date just now: its row shows it.
      if (blocked.indexOf('claims') >= 0) rerender();
      syncApprove();
      return;
    }
    var termId = getTermId();
    var rating = getStudentTermRating(_activeCourse, st.id, termId) || {};
    var data = { approvedAt: new Date().toISOString() };
    if (el && el.value.replace(/\s+$/, '') !== plainComment(rating.narrative || '').replace(/\s+$/, '')) {
      data.narrative = el.value.replace(/\s+$/, '');
    }
    // What the comment was built from, kept with the approval (plan PR 12).
    data.draftMeta = metaFor(
      st,
      'narrative' in data ? data.narrative : plainComment(rating.narrative || ''),
      data.approvedAt,
    );
    clearTimeout(_saveTimer);
    upsertTermRating(_activeCourse, st.id, termId, data);
    tqNarrativeDirty = false;
    _noteForBank(st, true);
    _syncStatus();
    var next = _nextUnapproved();
    if (next >= 0) _goTo(next);
    else rerender();
    _offerBank(true);
  }

  /* ── The personal bank (plan PR 10, teacher/comment-personal.js) ── */

  /* An approved comment's sentences that the teacher wrote or changed, as
     suggestions for their bank, read with the facts that were true now. */
  function _noteForBank(st, current) {
    if (!window.PersonalBank) return;
    var termId = getTermId();
    var f = current ? _facts(st) : CommentBank.facts(_activeCourse, st, termId);
    var others = [];
    getStudents(_activeCourse).forEach(function (s) {
      if (s.id === st.id) return;
      _namesOf(s).forEach(function (n) {
        if (others.indexOf(n) < 0) others.push(n);
      });
    });
    var items = PersonalBank.fromRows(_rowsFor(st, f), _bankContext(_activeCourse, st, f), f, st, {
      others: others,
    });
    PersonalBank.noteApproved(_activeCourse, termId, st.id, displayNameWithLast(st), items);
  }

  /* "Suggested for Your Bank", once the class's last comment is approved
     (after), or again after Later. Comments approved before this visit
     are read from their saved text. */
  function _offerBank(after) {
    if (!window.PersonalBank) return;
    var termId = getTermId();
    var students = getTqStudents();
    if (!students.length || !students.every(s => _approved(s.id))) return;
    if (!PersonalBank.shouldOffer(_activeCourse, termId, after)) return;
    students.forEach(function (s) {
      if (!PersonalBank.hasNote(_activeCourse, termId, s.id)) _noteForBank(s, false);
    });
    PersonalBank.open({
      cid: _activeCourse,
      termId: termId,
      order: students.map(function (s) {
        return s.id;
      }),
      course: _courseName(_activeCourse),
      total: students.length,
    });
  }

  function _approved(sid) {
    var r = getStudentTermRating(_activeCourse, sid, getTermId());
    return !!(r && r.approvedAt);
  }

  /* ── In-place updates (no redraw while the teacher types) ─── */
  var _quotedTimer = null;
  function _syncQuotedSoon() {
    clearTimeout(_quotedTimer);
    _quotedTimer = setTimeout(function () {
      _syncQuoted();
    }, 300);
  }
  function _syncNote() {
    _fitBox();
    _syncEmpty();
    _syncCount();
    _syncMarks();
    _syncQuotedSoon();
    _syncWarnSoon();
  }

  /* ── In-text marks (the LayoutE mockup) ──────────────────── */

  /* The best-piece sentence tinted and the missing-work sentence ringed
     inside the comment: a layer behind the box carrying the same text,
     invisible except for the marks, so typing, undo and the count are the
     box's own. */
  function _marksHtml(rows, text) {
    var t = String(text || '');
    var spans = [];
    (rows || []).forEach(function (r) {
      var kind = _justAdded(r)
        ? 'added'
        : _isBestRow(r)
          ? 'best'
          : r.step === 'notHandedIn' || r.step === 'ieProblem'
            ? 'missing'
            : '';
      var s = String(r.text || '').trim();
      if (!kind || !s) return;
      var at = t.indexOf(s);
      if (at < 0) return;
      spans.push({ at: at, end: at + s.length, kind: kind });
    });
    spans.sort(function (a, b) {
      return a.at - b.at;
    });
    var out = '';
    var from = 0;
    spans.forEach(function (sp) {
      if (sp.at < from) return;
      out += esc(t.slice(from, sp.at)) + `<span class="qn-mark ${sp.kind}">${esc(t.slice(sp.at, sp.end))}</span>`;
      from = sp.end;
    });
    out += esc(t.slice(from));
    // A trailing line break needs a character after it to take height.
    return out + '​';
  }
  function _syncMarks() {
    var st = _current();
    var el = _box();
    var layer = document.getElementById('tq-marks');
    if (!st || !el || !layer || String(el.dataset.sid) !== String(st.id)) return;
    layer.innerHTML = _marksHtml(_rows[_rowKey(st)] || [], el.value);
  }

  /* The Ready count and the roster. */
  function _syncStatus() {
    syncRoster();
  }

  /* ── Before Generate (the States mockup) ─────────────────── */

  /* "No comment yet" over the empty box, with the habits rated so far.
     Clicking it puts the cursor in the box (it is the box's label). */
  function _emptyHtml(cid, student, text) {
    var habits = (getStudentTermRating(cid, student.id, getTermId()) || {}).habits || {};
    // Under the no-marks line (Generate pressed with no marked work), no
    // hint to press Generate.
    var noDraft = !!_noDraft[_rowKey(student)] && noMarkedWork(_facts(student));
    return `<label class="qn-empty" id="tq-empty" for="tq-narrative"${String(text || '').trim() ? ' hidden' : ''}>
          <span class="qn-empty-title">No comment yet</span>
          <span class="qn-empty-hint"${noDraft ? ' hidden' : ''}>Rate the six work habits, then press Generate Comment. You can also type here.</span>
          <span class="qn-empty-chip" id="tq-empty-rated">${_ratedCount(habits)} of 6 habits rated</span>
        </label>`;
  }
  function _syncEmpty() {
    var el = _box();
    var box = document.getElementById('tq-empty');
    // No count or Copy under "No comment yet" (the States mockup).
    var foot = document.getElementById('tq-comment-foot');
    if (el && foot) foot.hidden = !el.value.trim();
    if (el && box) box.hidden = !!el.value.trim();
  }

  /* ── Marks changed after approval (plan PR 12) ───────────── */

  /* With each approval the comment's record is kept (term_rating.draft_meta,
     CommentBank.draftMeta). When a mark it states has changed since, or a
     class sentence it used was edited, the Teacher Comment card shows the
     approved sentence struck through and the sentence that is true now,
     with Keep as Approved or Use the New Sentence, and the roster shows an
     orange dot in place of the ✓. The app never changes approved text by
     itself. A rating with no record (approved before the record was kept,
     or a server without the column) is never flagged. */
  var _staleCache = {};
  function staleFor(cid, student, termId) {
    termId = termId || getTermId();
    var r = getStudentTermRating(cid, student.id, termId) || {};
    var meta = r.draftMeta;
    if (!meta) return null;
    var marks = Array.isArray(meta.sentences) && meta.sentences.length > 0;
    // The pronouns changed since the approval (draft_meta.pronouns).
    var pron = !!r.approvedAt && !!meta.pronouns && !_samePronouns(meta.pronouns, ReportBlocks.getPronouns(student));
    if (!marks && !pron) return null;
    var text = plainComment(r.narrative || '');
    var key = cid + '|' + student.id + '|' + termId;
    var sig =
      JSON.stringify(meta) +
      '\u0000' +
      text +
      '\u0000' +
      (r.approvedAt || '') +
      '\u0000' +
      String(student.pronouns || '');
    var hit = _staleCache[key];
    if (hit && hit.sig === sig) return hit.v;
    var cur = _current();
    var f =
      cid === _activeCourse && termId === getTermId() && cur && cur.id === student.id
        ? _facts(student)
        : CommentBank.facts(cid, student, termId);
    var v = marks ? CommentBank.staleness(meta, f, _picksFor(cid, student, f, termId), { text: text }) : null;
    var p = pron ? pronounChanges(cid, student, r, f) : [];
    if (p.length) {
      // A sentence shows once: as a pronoun change when that is all that
      // changed in it, else as out of date for its marks.
      var only = function (c) {
        return p.some(function (x) {
          return x.before === c.before && x.after === c.after;
        });
      };
      var marksNow = ((v && v.changes) || []).filter(function (c) {
        return !(c.kind === 'marks' && only(c));
      });
      var seen = marksNow.map(function (c) {
        return c.before;
      });
      p = p.filter(function (c) {
        return !c.keptAsApproved && seen.indexOf(c.before) < 0;
      });
      v = v ? Object.assign({}, v, { changes: marksNow.concat(p) }) : { changes: p, pieces: [] };
      if (!v.changes.length) v = null;
    }
    _staleCache[key] = { sig: sig, v: v };
    return v;
  }
  /* An approved comment that no longer matches: the orange dot. */
  function _flagged(sid) {
    var st = (getStudents(_activeCourse) || []).find(function (s) {
      return String(s.id) === String(sid);
    });
    return !!st && !!staleFor(_activeCourse, st);
  }

  /* The record kept with an approval: the rows on screen as the box has
     them now. */
  function metaFor(st, text, at) {
    var f = _facts(st, true);
    var key = _rowKey(st);
    var rows = _rowsFor(st, f);
    if (text != null) {
      rows = alignRows(rows, text);
      _rows[key] = rows;
    }
    var prev = (getStudentTermRating(_activeCourse, st.id, getTermId()) || {}).draftMeta || null;
    return CommentBank.draftMeta(rows, f, { approvedAt: at, prev: prev });
  }

  /* Last report's approved sentences, for draft()'s exclude: the bank
     sentences in the record of the latest earlier report that was approved
     (none when that report has no record). */
  function lastTermIds(cid, sid, termId) {
    var n = Number(String(termId).replace(/\D/g, ''));
    var mine = (getTermRatings(cid) || {})[sid] || {};
    var best = null;
    var bestN = 0;
    Object.keys(mine).forEach(function (k) {
      if (!/^term-\d+$/.test(k)) return;
      var m = Number(k.replace(/\D/g, ''));
      var r = mine[k];
      if (!(m < n) || m <= bestN || !r || !r.approvedAt) return;
      best = r;
      bestN = m;
    });
    return best && best.draftMeta ? CommentBank.approvedIds(best.draftMeta) : [];
  }

  /* "Oct 28" */
  function _shortDay(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  var CLASS_SENTENCE_NAMES = {
    closing: 'the closing sentence',
    support: 'the support line',
    late_work: 'the late-work line',
  };
  function _cap(t) {
    return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
  }
  function _sentenceCount(n) {
    return n === 1 ? 'one sentence no longer matches' : CommentBank.numberWords(n) + ' sentences no longer match';
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
        return CommentRealiser.quoteTitle(t) || '“' + t + '”';
      });
      var who =
        p.length === 1
          ? q[0] + ' was marked'
          : p.length === 2
            ? q[0] + ' and ' + q[1] + ' were marked'
            : p.length > 2
              ? _cap(CommentBank.numberWords(p.length)) + ' assignments were marked'
              : 'Marks changed';
      out.push(who + ' after ' + day + ', so ' + _sentenceCount(marks) + ' the gradebook.');
    }
    var cls = stale.changes.filter(function (c) {
      return c.kind === 'class';
    });
    if (cls.length) {
      var names = CommentBank.list(
        cls.map(function (c) {
          return CLASS_SENTENCE_NAMES[c.key] || 'a class sentence';
        }),
      );
      out.push(_cap(names) + ' changed after ' + day + ', so ' + _sentenceCount(cls.length) + ' your class settings.');
    }
    var pron = stale.changes.filter(function (c) {
      return c.kind === 'pronouns';
    }).length;
    if (pron) out.push('The pronouns changed after ' + day + ', so ' + _sentenceCount(pron) + ' them.');
    out.push('Approved text is never changed for you.');
    return out.join(' ');
  }

  function _staleHtml(cid, student, rating, stale) {
    var meta = rating.draftMeta || {};
    var day = _shortDay(rating.approvedAt || meta.approved_at);
    var marks = stale.changes.some(function (c) {
      return c.kind === 'marks';
    });
    var grade = '';
    if (marks && stale.hasGrade) {
      grade =
        'The grade is now ' +
        headerGrade(cid, student.id, _facts(student), getTermId()).big +
        '.' +
        (stale.gradeChanged ? '' : ' The grade sentence still holds.');
    }
    var boxes = stale.changes
      .map(function (c, k) {
        var now = c.after
          ? `<span class="qn-stale-now">${esc(c.after)}</span>`
          : '<span class="qn-stale-none">Leave this sentence out.</span>';
        return `<div class="qn-stale-change">
          <div class="qn-stale-line"><span class="qn-stale-label">Approved</span><span class="qn-stale-was">${esc(c.before)}</span></div>
          <div class="qn-stale-line"><span class="qn-stale-label">Now true</span>${now}</div>
          <div class="qn-stale-foot"><span class="qn-stale-grade">${k === 0 ? esc(grade) : ''}</span><button type="button" class="qn-stale-keep" data-action="tqStale" data-do="keep" data-i="${k}" title="Keeps the approved sentence as it is. The comment stays approved.">Keep as Approved</button><button type="button" class="qn-stale-use" data-action="tqStale" data-do="use" data-i="${k}" title="Puts the sentence that is true now in the comment. The comment then needs your approval again.">Use the New Sentence</button></div>
        </div>`;
      })
      .join('');
    return `<div class="qn-stale" id="tq-stale">
        <div class="qn-stale-note">${esc(staleNote(stale, day))}</div>
        ${boxes}
        ${rating.approvedAt ? '<span class="qn-stale-hint">Using the new sentence clears the approval until you approve again. In the roster, flagged students show an orange dot instead of a ✓.</span>' : ''}
      </div>`;
  }

  /* Keep as Approved or Use the New Sentence on change i of the student on
     screen. Only the teacher's click changes the comment: Use the New
     Sentence puts the new sentence in place of the approved one, which
     clears the approval (upsertTermRating does). */
  function tqStale(what, i) {
    var st = _current();
    if (!st || _resync(st)) return;
    tqSaveCurrentIfNeeded();
    var termId = getTermId();
    var r = getStudentTermRating(_activeCourse, st.id, termId) || {};
    var stale = staleFor(_activeCourse, st, termId);
    var c = stale && stale.changes[Number(i)];
    if (!c) return;
    if (what === 'keep' && c.kind === 'pronouns') {
      var kept = (Array.isArray(r.draftMeta.pronoun_kept) ? r.draftMeta.pronoun_kept : []).concat(c.before);
      upsertTermRating(_activeCourse, st.id, termId, {
        draftMeta: Object.assign({}, r.draftMeta, { pronoun_kept: kept }),
      });
    } else if (what === 'keep') {
      upsertTermRating(_activeCourse, st.id, termId, {
        draftMeta: CommentBank.keepApproved(r.draftMeta, c, stale, _facts(st, true)),
      });
    } else if (what === 'use') {
      var text = plainComment(r.narrative || '');
      var key = _rowKey(st);
      var f = _facts(st, true);
      var rows = _rowsFor(st, f).slice();
      // The approval goes with the first new sentence, so a pronoun change
      // puts in every sentence the pronouns changed (as for a comment not
      // yet approved); one kept as approved stays.
      var todo =
        c.kind === 'pronouns'
          ? stale.changes.filter(function (x) {
              return x.kind === 'pronouns';
            })
          : [c];
      var next = text;
      todo.forEach(function (x) {
        var swapped = _swapSentence(next, x.before, x.after);
        if (swapped === next) return;
        next = swapped;
        var at = rows.findIndex(function (y) {
          return y.text === x.before;
        });
        if (at < 0) {
          rows = alignRows(rows, next);
          return;
        }
        var step = rows[at].step || (r.draftMeta.sentences[x.i] || {}).step || null;
        if (!x.after) rows.splice(at, 1);
        else if (x.kind === 'class') rows[at] = _classRow(step, x.after);
        else {
          var s = x.id ? _bankById(x.id) : null;
          var row = s ? rowFromSentence(s, _bankContext(_activeCourse, st, f), step, at === 0) : null;
          rows[at] = row || Object.assign({}, rows[at], { edited: false });
          rows[at].text = rows[at].drafted = x.after;
        }
      });
      if (next === text) return;
      _rows[key] = rows;
      upsertTermRating(_activeCourse, st.id, termId, { narrative: next });
      _syncLast(key, _rows[key], next);
    } else return;
    rerender();
    var b = document.querySelector('#tq-stale button') || _box();
    if (b) b.focus();
  }

  /* ── The roster (the app's sidebar) ───────────────────────── */

  /* The sidebar's annotator (ui.js setSidebarAnnotator): under each name
     Needs Approval until the comment is approved, then a tick in place of
     the grade; All · Not Ready above the list. The grades come back on any
     other tab (restoreRoster). */
  function syncRoster() {
    var students = getTqStudents();
    var ready = students.filter(function (s) {
      return _approved(s.id);
    }).length;
    _readyText = ready + ' of ' + students.length + ' Ready';
    _syncReadyLine();
    var cur = _current();
    var annotate = function (sid) {
      var ok = _approved(sid);
      var flag = ok && _flagged(sid);
      return {
        sub: ok ? '' : 'Needs Approval',
        mark: flag
          ? '<span class="student-row-mark flag" role="img" aria-label="Approved, Something Changed" title="Approved, but a sentence no longer matches the gradebook or your class settings. Open the student to see what changed.">●</span>'
          : ok
            ? '<span class="student-row-mark ok" aria-label="Ready">✓</span>'
            : '',
        hidden: _notReadyOnly && ok && !(cur && cur.id === sid),
      };
    };
    annotate.top = function () {
      var btn = function (filter, label, on) {
        return `<button type="button" class="seg-btn${on ? ' active' : ''}" data-action="tqRosterFilter" data-filter="${filter}" aria-pressed="${on}">${label}</button>`;
      };
      return `<div class="seg qn-roster-filter" role="group" aria-label="Show Students">${btn('all', 'All ' + students.length, !_notReadyOnly)}${btn('not-ready', 'Not Ready ' + (students.length - ready), _notReadyOnly)}</div>`;
    };
    if (typeof setSidebarAnnotator === 'function') setSidebarAnnotator(annotate);
    document.querySelectorAll('#gb-sidebar .student-row[data-sid]').forEach(function (row) {
      row.classList.toggle('selected', !!cur && cur.id === row.getAttribute('data-sid'));
    });
    document.body.classList.add('qn-roster');
  }
  /* The toolbar's Ready count; while the comment is over the limit or has
     a sentence over 20 words, "Approve and Next is off until the comment
     fits." in its place (the States mockup). */
  var _readyText = '';
  var _fitsBlocked = false;
  // While a sentence no longer matches the gradebook: 'draft' (its row
  // shows Keep as Written) or 'approved' (the card shows Keep as Approved).
  var _claimsBlocked = '';
  var CLAIMS_LINE = {
    draft: 'Approve and Next is off until you pick Use the New Sentence or Keep as Written.',
    approved: 'Approve and Next is off until you pick Keep as Approved or Use the New Sentence.',
  };
  function _syncReadyLine() {
    var line = document.getElementById('tq-ready');
    if (line)
      line.textContent = _fitsBlocked
        ? 'Approve and Next is off until the comment fits.'
        : _claimsBlocked
          ? CLAIMS_LINE[_claimsBlocked]
          : _readyText;
  }
  function restoreRoster() {
    if (typeof setSidebarAnnotator === 'function') setSidebarAnnotator(null);
    document.body.classList.remove('qn-roster');
  }
  function tqRosterFilter(which) {
    _notReadyOnly = which === 'not-ready';
    syncRoster();
  }

  /* ── The header ──────────────────────────────────────────── */

  /* The Letter Grades Order word for a letter, as the grade sentence says
     it (the plan's "The target comment", 1). Nothing for IE or F. */
  var STANDING = {
    A: 'Excellent',
    B: 'Very good',
    'C+': 'Good',
    C: 'Satisfactory',
    'C-': 'Minimally acceptable',
  };
  function standingWord(letter) {
    return STANDING[String(letter || '').trim()] || '';
  }

  /* The grade on the right of the header: the big line as the class shows
     it ("B · 82.9%" in a Letter class, the level in a Proficiency class,
     both in a Both class), and under it the standing word (a Letter class)
     or the proficiency word (grades 8–9), with the assignments handed in.
     With the report's term id, a reporting basis the teacher chose shows as
     the report prints it: "IE" over "Insufficient Evidence", or "No Letter
     Grade" over "Assessed on language goals" (calc.js). An IE from calc.js
     says Insufficient Evidence under it too. */
  function headerGrade(cid, sid, f, termId) {
    var mode = courseGradeMode(cid);
    var b = studentGradeBadges(cid, sid, termId);
    var big = [];
    if (b.prof) big.push(b.prof.text);
    var basis = b.letter && b.letter.basis;
    if (b.letter) big.push(basis || mode !== 'letter' ? b.letter.text : b.letter.grade + ' · ' + b.letter.pct);
    if (basis) return { big: big.join(' · '), small: REPORTING_BASIS_NOTE[basis] };
    if (b.letter && b.letter.grade === 'IE') return { big: big.join(' · '), small: REPORTING_BASIS_NOTE.ie };
    var standing = mode === 'proficiency' ? levelWord(cid, f.overall) : b.letter ? standingWord(b.letter.grade) : '';
    var rec = f.record || { handed: 0, total: 0 };
    var count = rec.total ? rec.handed + ' of ' + rec.total + ' assignments' : '';
    return {
      big: big.join(' · ') || '—',
      small: [standing, count].filter(Boolean).join(' · '),
    };
  }

  function _headerHtml(cid, student, f) {
    var sid = student.id;
    var first = student.firstName || displayNameFirst(student);
    var g = headerGrade(cid, sid, f, getTermId());
    // The designations that offer language or IEP goals, as the goals mockup
    // shows them beside the pronouns.
    var des = CommentBank.goalsOffered(f).map(function (b) {
      return b === 'language_goals' ? 'ELL' : 'IEP';
    });
    var link = `<a role="link" tabindex="0" data-href="/student?id=${esc(sid)}&course=${esc(cid)}" class="qn-head-link" title="${esc(
      'Opens ' + first + '’s Student Dashboard. Its Term Questionnaire button returns here, to the same student.',
    )}">Student Dashboard ›</a>`;
    return `<div class="qn-head">
      <span class="qn-avatar" style="background:${_avatarColor(sid)}" aria-hidden="true">${esc(initials(student))}</span>
      <div class="qn-who">
        <span class="qn-name">${esc(fullName(student))}</span>
        <span class="qn-head-sub">${student.pronouns ? esc(student.pronouns) + ' · ' : ''}${des.map(d => esc(d) + ' · ').join('')}${link}</span>
      </div>
      <div class="qn-grade">
        <span class="qn-grade-big">${esc(g.big)}</span>
        <span class="qn-grade-sub">${esc(g.small)}</span>
      </div>
    </div>`;
  }

  /* ── Work Habits ─────────────────────────────────────────── */

  /* The names and hints on the grid, as the mockup words them. */
  var HABIT_LABELS = { ready: 'Comes Ready, Uses Class Time' };
  var SCALE_TIPS = {
    Rarely: 'Rarely: hardly ever this term',
    Sometimes: 'Sometimes: some of the time, not most',
    Usually: 'Usually: most of the time',
    Consistently: 'Consistently: almost every time',
    'Not Seen': 'Not Seen: no chance to see it yet. The comment leaves it out.',
  };

  function _ratedCount(habits) {
    return CommentBank.HABITS.filter(function (h) {
      return habits && habits[h.key] != null;
    }).length;
  }

  function _habitsHtml(cid, f) {
    var stored = (getStudentTermRating(cid, f.sid, getTermId()) || {}).habits || {};
    var head = CommentBank.SCALE.map(function (label) {
      return `<span title="${esc(SCALE_TIPS[label] || label)}">${esc(label)}</span>`;
    }).join('');
    var rows = CommentBank.HABITS.map(function (h) {
      var v = stored[h.key];
      var name = HABIT_LABELS[h.key] || h.name;
      var opts = CommentBank.SCALE.map(function (label, i) {
        var val = i + 1;
        var on = v === val;
        return `<span class="qn-habit-cell"><button type="button" role="radio" aria-checked="${on}" class="qn-radio${on ? ' on' : ''}" data-action="tqRate" data-habit="${h.key}" data-value="${val}" aria-label="${esc(name + ': ' + label)}" title="${esc(SCALE_TIPS[label] || label)}"></button></span>`;
      }).join('');
      return `<div class="qn-habit-row" role="radiogroup" aria-label="${esc(name)}">
        <span class="qn-habit-name" title="${esc(h.hint)}">${esc(name)}</span>${opts}
      </div>`;
    }).join('');
    return `<div class="qn-card qn-habits">
      <div class="qn-card-top"><span class="qn-card-title">Work Habits</span><span class="qn-sub" id="tq-rated">${_ratedCount(stored)} of 6 rated</span></div>
      <div class="qn-habit-head"><span></span>${head}</div>
      ${rows}
    </div>`;
  }

  /* A habit picked on the grid: saved with the others (the whole map); the
     grid, the count and the comment's habits sentence change in place,
     nothing else redraws. */
  function tqRate(key, value) {
    var st = _current();
    if (!st) return;
    tqSaveCurrentIfNeeded();
    var termId = getTermId();
    var habits = Object.assign({}, (getStudentTermRating(_activeCourse, st.id, termId) || {}).habits || {});
    habits[key] = Number(value);
    upsertTermRating(_activeCourse, st.id, termId, { habits: habits });
    document.querySelectorAll('.qn-radio[data-habit="' + key + '"]').forEach(function (b) {
      var on = Number(b.dataset.value) === Number(value);
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    });
    var rated = document.getElementById('tq-rated');
    if (rated) rated.textContent = _ratedCount(habits) + ' of 6 rated';
    var chip = document.getElementById('tq-empty-rated');
    if (chip) chip.textContent = _ratedCount(habits) + ' of 6 habits rated';
    _facts(st, true);
    _redrawHabits(st);
  }

  /* After a rating: the comment's habits sentence written again for the new
     ratings (plan PR 7), when Generate wrote this comment and the teacher
     has not edited that sentence or approved the comment. The rest of the
     comment stays as it is. A comment with no habits sentence gets one only
     while it is exactly as Generate wrote it. The Sentences card redraws
     so its rows follow the comment (a row added, changed or taken out).
     steps: the attendance sentence instead (CommentBank.ATTENDANCE_STEPS),
     after the Attendance card changes. */
  function _redrawHabits(st, steps) {
    var termId = getTermId();
    var key = _activeCourse + '|' + st.id + '|' + termId;
    var last = _lastDraft[key];
    var el = _box();
    if (!last || !el || String(el.dataset.sid) !== String(st.id) || _approved(st.id)) return;
    var d = CommentBank.redrawHabits(_bankContext(_activeCourse, st, _facts(st)), last, {
      comments: _classmateComments(_activeCourse, st.id, termId),
      exclude: lastTermIds(_activeCourse, st.id, termId),
      steps: steps,
    });
    if (!d) return;
    var text = el.value;
    var before = d.habits.before;
    var after = d.habits.after;
    var next;
    if (text.trim() === last.text.trim()) next = d.text;
    else if (before && text.indexOf(before) >= 0) next = _swapSentence(text, before, after);
    else return;
    _lastDraft[key] = d;
    _adoptDraft(key, d);
    if (next !== text) {
      el.value = next;
      tqNarrativeDirty = true;
      tqSaveNarrative();
      _syncNote();
    }
    // The rows are the draft's now, so _alignNow sees no change of its
    // own: the card and the marks are redrawn here.
    _alignNow();
    _syncMarks();
    _syncRequired();
  }

  /* One sentence of the comment in place of another; with none, the old one
     and a space beside it taken out. */
  function _swapSentence(text, before, after) {
    if (after) return text.replace(before, after);
    if (text.indexOf(before + ' ') >= 0) return text.replace(before + ' ', '');
    if (text.indexOf(' ' + before) >= 0) return text.replace(' ' + before, '');
    return text.replace(before, '');
  }

  /* ── At a Glance ─────────────────────────────────────────── */

  /* Under the best piece: its Note for the Report, or when it has none
     Add one, which opens the grader on that piece for this student. */
  function _reportNoteNudge(best) {
    if (!best || !best.id) return '';
    var note = String(best.note || '').trim();
    // With a note: "Note for the report: “…”" (the LayoutE mockup).
    if (note) return `<span class="qn-muted qn-note-line">Note for the report: “${esc(note)}”</span>`;
    return `<span class="qn-muted qn-note-nudge">No note for the report yet · <button type="button" class="qn-card-link qn-note-add" data-action="tqAddReportNote" data-aid="${esc(best.id)}" title="Opens the grader on this piece. Write one line about what the student did, for the comment.">Add one</button></span>`;
  }

  /* Add one: the grader on the best piece, this student only. Closing it
     reads the facts again, so the note shows in the comment's sentence. */
  function tqAddReportNote(aid) {
    var st = _current();
    if (!st || !aid || !window.PageAssignments || !PageAssignments.openGrader) return;
    PageAssignments.openGrader(_activeCourse, aid, st.id, {
      studentIds: [st.id],
      onClose: function () {
        _facts(st, true);
        rerender();
      },
    });
  }

  /* The highest-marked piece this term; the latest when two tie. */
  function bestPiece(work) {
    var best = null;
    (work || []).forEach(function (w) {
      if (!best || w.v > best.v || (w.v === best.v && String(w.d) > String(best.d))) best = w;
    });
    return best;
  }

  /* Work labelled Missing this term (status NS), whatever its due date:
     the one rule everywhere (Decision 4; facts().notHandedIn counts the
     same work). */
  function notHandedIn(cid, sid) {
    return (getAssessments(cid) || [])
      .filter(function (a) {
        return assessmentInActiveTerm(cid, a) && assessmentCellValue(cid, sid, a).status === 'NS';
      })
      .map(function (a) {
        return a.title || '';
      });
  }

  /* Strongest: the competencies past the comment's "strongest" evidence
     gate (CommentBank.strongestOf), so the tag and the comment agree; Next
     step: the competency the comment's next step names
     (CommentBank.nextStepOf), the lowest with 3+ scored pieces. */
  function skillTags(comps) {
    var list = (comps || []).filter(function (c) {
      return c.level > 0;
    });
    var out = {};
    CommentBank.strongestOf(list).forEach(function (c) {
      out[c.id] = 'Strongest';
    });
    var low = CommentBank.nextStepOf(list);
    if (low) out[low.id] = 'Next step';
    return out;
  }

  function _glanceHtml(cid, student, f) {
    var best = bestPiece(f.work);
    // The best piece's mark as the comment prints it: in a Letter class,
    // points work's own % (CommentBank.workMark, calc.js), never its level
    // as a %.
    var bestMark = best
      ? courseGradeMode(cid) === 'letter'
        ? CommentBank.workMark(f, best)
        : formatLevel(cid, best.v)
      : '';
    var missing = notHandedIn(cid, student.id);
    var tags = skillTags(f.comps);
    var skills = f.comps
      .map(function (c) {
        var tag = tags[c.id];
        return `<div class="qn-skill">
          <span class="qn-skill-name">${esc(c.name)}</span>
          ${tag ? `<span class="qn-tag${tag === 'Strongest' ? ' strongest' : ''}">${tag}</span>` : ''}
          <span class="qn-level" data-level="${Math.max(1, Math.min(4, Math.round(c.level)))}">${esc(f.levelText(c.level))}</span>
        </div>`;
      })
      .join('');
    return `<div class="qn-card qn-glance">
      <div class="qn-card-top"><span class="qn-card-title">At a Glance</span></div>
      <div class="qn-band">Work</div>
      <div class="qn-fact qn-best">
        <span class="qn-fact-label">Best piece</span>
        <div class="qn-fact-body">${best ? `<span>${esc(best.title)} · ${esc(bestMark)}</span>${_reportNoteNudge(best)}` : '<span class="qn-muted">No marked work this term yet</span>'}</div>
      </div>
      <div class="qn-fact">
        <span class="qn-fact-label">Not handed in</span>
        <div class="qn-fact-body">${
          missing.length
            ? missing
                .map(function (t) {
                  return `<span>${esc(t)}</span>`;
                })
                .join('')
            : '<span class="qn-muted">None this term</span>'
        }</div>
        ${missing.length ? `<span class="qn-count">${missing.length}</span>` : ''}
      </div>
      <div class="qn-band">Skills</div>
      ${skills || '<div class="qn-fact"><span class="qn-muted">No scores this term yet</span></div>'}
    </div>`;
  }

  /* ── The student's Voice ─────────────────────────────────── */

  function _answer(it) {
    return it && it.v && it.v.text ? String(it.v.text).trim() : '';
  }

  /* The rows: the goal from the Goal Check-In, then the About Me answers
     with the mockup's labels; the "To you only" answer is marked Private.
     An answer the comment quotes is marked "In the comment". */
  function voiceRows(f) {
    var prof = f.voice && f.voice.profile;
    var about = prof && prof.about;
    var ck = prof && prof.checkin;
    var rows = [];
    var goal = ck ? _answer(ck.coreGoal) : '';
    rows.push({
      label: 'Goal',
      text: goal ? '“' + goal.replace(/[“”"]/g, '') + '”' + (f.voice.goalStatus ? ' · ' + f.voice.goalStatus : '') : '',
      empty: 'Not set yet',
    });
    var add = function (label, it, extra) {
      var a = _answer(it);
      if (!a) return;
      rows.push(Object.assign({ label: label, text: a, quote: true }, extra || {}));
    };
    add('Good at', about && about.goodAt);
    add('Hard right now', about && about.hard);
    add('Wants to get better at', about && about.goal);
    add('Learns best', about && about.learns, { quote: false });
    add('To you only', about && about.note, { quote: false, priv: true });
    return rows;
  }

  function _voiceHtml(cid, student, f, comment) {
    var first = student.firstName || displayNameFirst(student);
    var rows = voiceRows(f)
      .map(function (r) {
        var quoted = r.quote && r.text && _quotes(comment, r.text);
        var chip = r.priv
          ? '<span class="qn-chip-private" title="Only you see this. It is never printed and never used in the comment.">Private</span>'
          : r.quote
            ? `<span class="qn-chip-quoted" data-answer="${esc(r.text)}" title="Generate can quote this in the comment."${quoted ? '' : ' hidden'}>In the comment</span>`
            : '';
        return `<div class="qn-voice-row">
          <span class="qn-fact-label">${esc(r.label)}</span>
          <span class="qn-voice-text${r.text ? '' : ' qn-muted'}">${esc(r.text || r.empty)}</span>
          ${chip}
        </div>`;
      })
      .join('');
    return `<div class="qn-card qn-voice">
      <div class="qn-card-top">
        <span class="qn-card-title">${esc(first)}’s Voice</span>
        <a role="link" tabindex="0" data-href="/dashboard?course=${esc(cid)}&manage=questionnaires" class="qn-card-link" title="Opens this class’s Questionnaires in Class Management, where you choose and send the questions students answer.">Questionnaires ›</a>
      </div>
      ${rows}
    </div>`;
  }

  /* Whether the comment quotes an answer (its words, without a closing
     full stop). */
  function _quotes(comment, text) {
    var t = String(text || '')
      .replace(/[“”"]/g, '')
      .replace(/[.\s]+$/, '');
    return !!t && String(comment || '').indexOf(t) >= 0;
  }

  /* After the comment changes: which answers it quotes. */
  function _syncQuoted() {
    var el = _box();
    if (!el) return;
    var comment = el.value;
    document.querySelectorAll('.qn-chip-quoted[data-answer]').forEach(function (chip) {
      chip.hidden = !_quotes(comment, chip.dataset.answer);
    });
  }

  /* ── Attendance ──────────────────────────────────────────── */

  /* The report a term id names, as the report picker shows it. */
  function _reportLabel(termId) {
    var sel = document.getElementById('report-period');
    var n = String(termId || '').match(/(\d+)$/);
    var opt = sel && n ? Array.prototype.find.call(sel.options, o => o.value === 'Report ' + n[1]) : null;
    return opt ? opt.text : n ? 'Report ' + n[1] : '';
  }

  /* The line at the right of the card (the States mockup): "Added to the
     comment." once a total is entered, the note until then, and a warning
     when a total is lower than the last report's (totals are to date). */
  function _attendanceNoteHtml(att) {
    var lower = ['absences', 'lates'].find(function (f) {
      var prev = att['prev' + f[0].toUpperCase() + f.slice(1)];
      return att[f] != null && prev != null && att[f] < prev;
    });
    if (lower) {
      var prev = att[lower === 'absences' ? 'prevAbsences' : 'prevLates'];
      var what = lower === 'absences' ? _plural(prev, 'absence', 'absences') : _plural(prev, 'late', 'lates');
      return `<span class="qn-att-warn">Lower than the ${what} entered for the ${esc(
        _reportLabel(att[lower + 'PrevTerm']),
      )} report. Enter the total to date.</span>`;
    }
    var entered = att.absences != null || att.lates != null;
    return entered ? 'Added to the comment.' : 'Optional. Left out until entered.';
  }

  function _attendanceHtml(cid, student) {
    var sid = student.id;
    var att = getTermAttendance(cid, sid, getTermId());
    var warn = function (k, p) {
      return att[k] != null && att[p] != null && att[k] < att[p] ? ' warn' : '';
    };
    return `<div class="qn-card qn-att">
      <span class="qn-att-title">Attendance</span>
      <label class="qn-att-field">Classes Absent<input type="number" min="0" max="200" step="1" inputmode="numeric" class="qn-att-input${warn('absences', 'prevAbsences')}" id="tq-att-absences" data-tq-att="absences" data-sid="${sid}" aria-label="Classes Absent" title="Classes absent so far this year, as a total to date. Optional." value="${att.absences == null ? '' : att.absences}"></label>
      <label class="qn-att-field">Times Late<input type="number" min="0" max="200" step="1" inputmode="numeric" class="qn-att-input${warn('lates', 'prevLates')}" id="tq-att-lates" data-tq-att="lates" data-sid="${sid}" aria-label="Times Late" title="Times late so far this year, as a total to date. Optional." value="${att.lates == null ? '' : att.lates}"></label>
      <span class="qn-att-note" id="tq-att-note" aria-live="polite">${_attendanceNoteHtml(att)}</span>
    </div>`;
  }

  /* A box's total: a whole number from 0 to 200, '' for an empty box, or
     null for anything else (a decimal, a negative, 1e+21), which is never
     rounded, saved or printed. */
  var ATTENDANCE_MAX = 200;
  var ATTENDANCE_BAD = 'Enter a whole number from 0 to 200.';
  function attendanceValue(input) {
    if (input && input.validity && input.validity.badInput) return null;
    var v = String((input && input.value) == null ? '' : input.value).trim();
    if (v === '') return '';
    if (!/^\d+$/.test(v)) return null;
    var n = Number(v);
    return n <= ATTENDANCE_MAX ? n : null;
  }

  /* A box changed: save both totals and redraw only the note, so the
     cursor stays where the teacher put it. A box that does not hold a
     whole number from 0 to 200 saves nothing and says so. */
  function tqSetAttendance(sid) {
    var abs = document.getElementById('tq-att-absences');
    var late = document.getElementById('tq-att-lates');
    if (!abs || !late) return;
    var termId = getTermId();
    var a = attendanceValue(abs);
    var l = attendanceValue(late);
    var bad = function (el, v) {
      if (el.classList) el.classList.toggle('bad', v === null);
      if (v === null && el.setAttribute) el.setAttribute('aria-invalid', 'true');
      else if (el.removeAttribute) el.removeAttribute('aria-invalid');
    };
    bad(abs, a);
    bad(late, l);
    if (a === null || l === null) {
      var warnNote = document.getElementById('tq-att-note');
      if (warnNote) warnNote.innerHTML = `<span class="qn-att-warn">${ATTENDANCE_BAD}</span>`;
      return;
    }
    saveTermAttendance(_activeCourse, sid, termId, a, l);
    var att = getTermAttendance(_activeCourse, sid, termId);
    var note = document.getElementById('tq-att-note');
    if (note) note.innerHTML = _attendanceNoteHtml(att);
    abs.classList.toggle('warn', att.absences != null && att.prevAbsences != null && att.absences < att.prevAbsences);
    late.classList.toggle('warn', att.lates != null && att.prevLates != null && att.lates < att.prevLates);
    var st = _current();
    if (!st) return;
    _facts(st, true);
    // The comment's attendance sentence follows the totals, as the habits
    // sentence follows a rating: added once a total is entered, taken out
    // once both are cleared (the States mockup's "Attendance entered").
    _redrawHabits(st, CommentBank.ATTENDANCE_STEPS);
  }

  /* ── The class's report form ───────────────────────────── */

  function _form(cid) {
    return ReportSheets.formFor((typeof getReportConfig === 'function' && getReportConfig(cid)) || {});
  }
  function _blockLabel(id) {
    var b = ReportSheets.BLOCKS[id];
    return b ? b.label : id;
  }

  /* ── Where This Information Comes From ───────────────────── */

  var SCREEN_SOURCES = [
    ['Grade', 'Your gradebook: this term’s marks, with your category weights.', 'FullVision'],
    ['Work Habits', 'Your six ratings, Rarely to Consistently.', 'You'],
    ['Best Piece', 'The highest-marked assignment this term, and your note for the report on it.', 'FullVision'],
    ['Not Handed In', 'Assignments labelled Missing.', 'FullVision'],
    ['Skills', 'This term’s competency scores.', 'FullVision'],
    ['Goal and Voice', 'Answers to About Me and the goal check-in, sent from the student’s phone.', 'Student'],
    [
      'Attendance',
      'Classes absent and times late, typed in by you. Optional; left out of the comment until entered.',
      'You',
    ],
    [
      'Teacher Comment',
      'Written by Generate from everything above and your class settings. You edit and approve it.',
      'You',
    ],
  ];

  /* Where each block on the class's form gets its content. */
  function _blockSource(cid, id) {
    var phones = '';
    if (typeof Questionnaires !== 'undefined' && Questionnaires.list) {
      phones = Questionnaires.list(cid)
        .filter(function (q) {
          return (q.kind === 'core_reflection' || q.kind === 'goal_checkin') && !q.archived_at;
        })
        .map(function (q) {
          return q.title;
        })
        .filter(function (t, i, a) {
          return t && a.indexOf(t) === i;
        });
    }
    var map = {
      header: ['Nothing to fill in. Comes from Class Settings.', 'FullVision'],
      proficiency: ['Nothing to fill in. Comes from scores.', 'FullVision'],
      legend: ['Nothing to fill in. Same for everyone.', 'FullVision'],
      'competency-table': ['Nothing to fill in. Comes from scores.', 'FullVision'],
      'grade-table': ['Nothing to fill in. Comes from scores.', 'FullVision'],
      'missing-work': ['Nothing to fill in. Comes from assignments.', 'FullVision'],
      'teacher-narrative': [SCREEN_SOURCES[7][1], 'You'],
      'term-attendance': [SCREEN_SOURCES[6][1], 'You'],
      'learner-dimensions': [SCREEN_SOURCES[1][1], 'You'],
      'next-steps': ['The Focus Area: the competency that changed most this term.', 'FullVision'],
      progress: ['The Focus Area: the competency that changed most this term.', 'FullVision'],
      'support-home': [
        'The Focus Area: the competency that changed most this term. The work comes from scores.',
        'FullVision',
      ],
      'self-assessment': [
        (phones.length ? CommentBank.list(phones) : 'The reflection and Goal Check-In') + ', on phones.',
        'Student',
      ],
      'student-reflection-learning': ['Nothing to fill in. The student writes on the printed page.', 'Student'],
      'student-reflection-habits': ['Nothing to fill in. The student writes on the printed page.', 'Student'],
      'parent-response': ['Nothing to fill in. The family writes it.', 'Family'],
      'text-block': ['Nothing to fill in. Your text on the form, in Progress Reports.', 'You'],
    };
    return map[id] || ['Nothing to fill in. Comes from FullVision.', 'FullVision'];
  }

  function _whoChip(who) {
    return `<span class="qn-info-who who-${who.toLowerCase()}">${esc(who)}</span>`;
  }
  function _sourceRow(part, from, who) {
    return `<div class="qn-info-row"><span class="qn-info-part">${esc(part)}</span><span class="qn-info-from">${esc(from)}</span>${_whoChip(who)}</div>`;
  }

  /* Where the Work Habits come from for the student on screen: "Your six
     ratings" only once the teacher has rated all six; else how many so
     far, and Completes Work from the record while it is unrated. */
  function _habitsInfo(cid, st) {
    if (!st) return SCREEN_SOURCES[1][1];
    var f = _facts(st);
    var n = Object.keys(_ratedByYou(cid, st, f)).length;
    if (n === CommentBank.HABITS.length) return SCREEN_SOURCES[1][1];
    var so = n ? CommentBank.numberWords(n) + ' of six so far' : 'none yet';
    var record = !!_habitsOf(cid, st, f).completes && !_ratedByYou(cid, st, f).completes;
    return (
      'Rated by you, Rarely to Consistently: ' +
      so +
      '.' +
      (record ? ' Until you rate it, Completes Work comes from the assignment record.' : '')
    );
  }

  var INFO_ID = 'tq-info-overlay';
  function _infoHtml(cid) {
    var form = _form(cid);
    var on = ReportSheets.onForm(form);
    var course = (typeof COURSES !== 'undefined' && COURSES[cid] && COURSES[cid].name) || '';
    var report = _reportLabel(getTermId());
    var habitsFrom = _habitsInfo(cid, _current());
    var screen = SCREEN_SOURCES.map(function (r, i) {
      return _sourceRow(r[0], i === 1 ? habitsFrom : r[1], r[2]);
    }).join('');
    var blocks = on
      .map(function (id) {
        var s = _blockSource(cid, id);
        return _sourceRow(_blockLabel(id), id === 'learner-dimensions' ? habitsFrom : s[0], s[1]);
      })
      .join('');
    var off = Object.keys(ReportSheets.BLOCKS)
      .filter(function (id) {
        var b = ReportSheets.BLOCKS[id];
        return !b.retired && on.indexOf(id) < 0 && id !== 'header';
      })
      .map(_blockLabel);
    return `<div class="qn-info" role="document">
      <div class="qn-info-top"><span class="qn-info-title" id="tq-info-title">Where This Information Comes From</span><button type="button" class="qn-btn" data-action="tqCloseInfo">Done</button></div>
      <span class="qn-info-label">On This Screen</span>
      <div class="qn-info-card">${screen}</div>
      <span class="qn-info-label">On ${esc(course)}’s ${esc(report)}</span>
      <div class="qn-info-card">
        ${blocks}
        ${
          off.length
            ? `<div class="qn-info-off"><span class="qn-info-off-title">Not on this report</span><span>${esc(off.join(' · '))}</span><span>Add them in Progress Reports.</span></div>`
            : ''
        }
      </div>
      <div class="qn-info-card qn-info-never"><span class="qn-info-part">Never printed</span><span class="qn-info-from">Student Voice answers marked Private.</span></div>
    </div>`;
  }

  function tqOpenInfo() {
    tqCloseInfo();
    var overlay = document.createElement('div');
    overlay.id = INFO_ID;
    overlay.className = 'confirm-overlay qn-info-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tq-info-title');
    overlay.innerHTML = _infoHtml(_activeCourse);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) tqCloseInfo();
    });
    document.body.appendChild(overlay);
    var done = overlay.querySelector('[data-action="tqCloseInfo"]');
    if (done) done.focus();
  }
  /* Tab from the sheet's last control goes to its first, Shift-Tab from
     its first to its last; focus outside the sheet comes back to it. */
  function _trapTab(e, sheet) {
    var items = Array.prototype.slice
      .call(sheet.querySelectorAll('button:not([disabled]), a[href], input, select, textarea, [tabindex="0"]'))
      .filter(function (x) {
        return !x.hidden;
      });
    if (!items.length) return;
    var first = items[0];
    var last = items[items.length - 1];
    var at = document.activeElement;
    if (!sheet.contains(at)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && at === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && at === last) {
      e.preventDefault();
      first.focus();
    }
  }
  function tqCloseInfo() {
    var o = document.getElementById(INFO_ID);
    if (!o) return;
    o.remove();
    var b = document.getElementById('tq-info-btn');
    if (b) b.focus();
  }

  /* The Edit Student icon: the Student Dashboard's own dialog, for the
     student on screen. */
  function tqEditStudent() {
    var st = _current();
    if (!st || !_openEditStudent) return;
    tqSaveCurrentIfNeeded();
    _openEditStudent(_activeCourse, st.id);
  }

  /* ── The Teacher Comment ─────────────────────────────────── */

  /* Classmates' comments this report as { sid, text }, for the bank's
     least-used order (CommentBank.classUsage). */
  function _classmateComments(cid, sid, termId) {
    var all = getTermRatings(cid) || {};
    return Object.keys(all)
      .filter(function (k) {
        return k !== sid && all[k] && all[k][termId] && all[k][termId].narrative;
      })
      .map(function (k) {
        var s = getStudents(cid).find(function (x) {
          return x.id === k;
        });
        return { sid: k, text: plainComment(all[k][termId].narrative), names: s ? _namesOf(s) : [] };
      });
  }
  function _namesOf(student) {
    return [student.firstName, student.lastName, student.preferredName, _first(student)].filter(Boolean);
  }

  /* ── Class warnings (plan PR 5, PR 11c) ──────────────────── */

  /* The classmate whose comment shares the most sentences with this one
     (CommentBank.nearIdentical, five or more), as { student, shared,
     pairs: [[mine, theirs]] by sentence index }, else null. */
  function nearTwin(cid, student, text) {
    if (!String(text || '').trim()) return null;
    var termId = getTermId();
    var mine = { sid: student.id, text: text, names: _namesOf(student) };
    // The class's own lines and the grade sentence never count as shared.
    var out = CommentBank.nearIdentical([mine].concat(_classmateComments(cid, student.id, termId)), { cid: cid });
    var hit = out.find(function (p) {
      return p.a === student.id || p.b === student.id;
    });
    if (!hit) return null;
    var other = hit.a === student.id ? hit.b : hit.a;
    var twin = getStudents(cid).find(function (s) {
      return s.id === other;
    });
    if (!twin) return null;
    var pairs = hit.pairs.map(function (pr) {
      return hit.a === student.id ? pr : [pr[1], pr[0]];
    });
    return { student: twin, shared: hit.shared, pairs: pairs };
  }
  /* "Five of these sentences are also in Ava Martin’s comment. Press
     Generate Comment for another version, or change a sentence." with Show
     Both (the States mockup). Nothing when no comment is that alike. */
  function _warnHtml(cid, student, text) {
    var w = nearTwin(cid, student, text);
    if (!w) return '';
    var who = displayNameWithLast(w.student);
    var n = w.shared.toString();
    var count = CommentBank.numberWords(w.shared);
    count = count.charAt(0).toUpperCase() + count.slice(1);
    return `<div class="qn-warn" id="tq-warn" role="status">
        <span class="qn-warn-text">${esc(count)} of these sentences are also in ${esc(who)}’s comment. Press Generate Comment for another version, or change a sentence.</span>
        <button type="button" class="qn-warn-link" data-action="tqShowBoth" data-sid="${esc(w.student.id)}" aria-haspopup="dialog" title="Shows this comment beside ${esc(who)}’s, with the ${esc(n)} shared sentences marked.">Show Both</button>
      </div>`;
  }
  var _warnTimer = null;
  function _syncWarnSoon() {
    clearTimeout(_warnTimer);
    _warnTimer = setTimeout(_syncWarn, 300);
  }
  function _syncWarn() {
    var st = _current();
    var el = _box();
    var wrap = document.getElementById('tq-warn-wrap');
    if (!st || !el || !wrap || String(el.dataset.sid) !== String(st.id)) return;
    wrap.innerHTML = _warnHtml(_activeCourse, st, el.value);
  }

  /* Show Both: the two comments side by side, each shared sentence marked. */
  var BOTH_ID = 'tq-both-overlay';
  function _bothColumn(student, text, marks, grade) {
    var parts = sentencesOf(text).map(function (t, i) {
      return `<span class="qn-both-s${marks[i] ? ' shared' : ''}">${esc(t)}</span>`;
    });
    return `<div class="qn-both-col">
        <div class="qn-both-head"><span class="qn-both-name">${esc(displayNameWithLast(student))}</span>${grade ? `<span class="qn-both-grade">${esc(grade)}</span>` : ''}</div>
        <p class="qn-both-text">${parts.join(' ')}</p>
      </div>`;
  }
  function _bothHtml(cid, student, text, w) {
    var mine = {};
    var theirs = {};
    w.pairs.forEach(function (pr) {
      mine[pr[0]] = true;
      theirs[pr[1]] = true;
    });
    var other = plainComment((getStudentTermRating(cid, w.student.id, getTermId()) || {}).narrative || '');
    var gradeOf = function (s) {
      var h = headerGrade(cid, s.id, _facts(s, true), getTermId());
      return h && h.big ? h.big : '';
    };
    var g1 = gradeOf(student);
    var g2 = gradeOf(w.student);
    _facts(student, true);
    var n = CommentBank.numberWords(w.shared);
    return `<div class="qn-info qn-both" role="document">
      <div class="qn-info-top"><span class="qn-info-title" id="tq-both-title">Both Comments</span><span class="qn-sub">${esc(n.charAt(0).toUpperCase() + n.slice(1))} shared sentences are marked.</span><button type="button" class="qn-btn" data-action="tqCloseBoth">Done</button></div>
      <div class="qn-both-cols">${_bothColumn(student, text, mine, g1)}${_bothColumn(w.student, other, theirs, g2)}</div>
    </div>`;
  }
  function tqShowBoth() {
    var st = _current();
    var el = _box();
    if (!st) return;
    var text = el
      ? el.value
      : plainComment((getStudentTermRating(_activeCourse, st.id, getTermId()) || {}).narrative || '');
    var w = nearTwin(_activeCourse, st, text);
    if (!w) return;
    tqCloseBoth();
    var overlay = document.createElement('div');
    overlay.id = BOTH_ID;
    overlay.className = 'confirm-overlay qn-info-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tq-both-title');
    overlay.innerHTML = _bothHtml(_activeCourse, st, text, w);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) tqCloseBoth();
    });
    document.body.appendChild(overlay);
    var done = overlay.querySelector('[data-action="tqCloseBoth"]');
    if (done) done.focus();
  }
  function tqCloseBoth() {
    var o = document.getElementById(BOTH_ID);
    if (!o) return;
    o.remove();
    var link = document.querySelector('[data-action="tqShowBoth"]');
    if (link) link.focus();
  }

  /* The teacher's picks a draft is built with: the habit ratings and the
     focus. */
  function _picksFor(cid, student, f, termId) {
    var rating = getStudentTermRating(cid, student.id, termId || getTermId()) || {};
    return { habits: rating.habits || {}, focus: rating.focusSectionId || f.focusId };
  }
  function _bankContext(cid, student, f) {
    return CommentBank.context(f, _picksFor(cid, student, f));
  }

  /* Generate Comment: a draft from the bank, filled in for the student, in
     the box in place of what was there (typed in, so ⌘ Z brings the old
     text back). Each press gives another version; the student's own seed
     keeps the first draft the same between visits. */
  var _generated = {};
  // The last draft Generate wrote per student and report (as draft() gives
  // it), so choosing IE or goals can redraw a draft the teacher has not
  // edited, and a habit rating can redraw its habits sentence.
  var _lastDraft = {};
  // And the seed it was drafted with, so a class line's change can draft it
  // again with only that line different.
  var _lastSeed = {};
  function tqGenerate() {
    var st = _current();
    var el = _box();
    if (!st || !el) return;
    var termId = getTermId();
    var key = _rowKey(st);
    var f = _facts(st, true);
    // No marked work this term: nothing to draft from, so nothing is
    // drafted and the card says so.
    if (noMarkedWork(f)) {
      _noDraft[key] = true;
      var line = document.getElementById('tq-nodraft');
      var hint = document.querySelector('#tq-empty .qn-empty-hint');
      if (line) line.hidden = false;
      if (hint) hint.hidden = true;
      if (!line) rerender();
      return;
    }
    var n = (_generated[st.id] || 0) + 1;
    _generated[st.id] = n;
    // Sentences the teacher edited stay, as written, and so does the order
    // they set (plan PR 11b); every sentence they typed stays as a Your
    // Sentence row at its place in the order (keepTyped, the InsertRows
    // mockup), in a comment Generate wrote on an earlier visit and in one
    // typed entirely by hand, with the bank's parts filled in around it. A
    // fresh start is Remove From Comment or clearing the box; ⌘ Z brings
    // the previous text back either way.
    var wrote = !!_lastDraft[key];
    // The rows follow the box first, so a sentence just deleted (⌘A,
    // Delete, Generate at once) never comes back.
    clearTimeout(_alignTimer);
    _alignNow();
    var rows = _rowsFor(st, f);
    var kept = {};
    rows.forEach(function (r) {
      if (r.edited && r.step && !kept[r.step]) kept[r.step] = r.text;
    });
    var order = _ordered[key]
      ? rows
          .map(function (r) {
            return r.step;
          })
          .filter(Boolean)
      : undefined;
    var d = CommentBank.draft(_bankContext(_activeCourse, st, f), {
      seed: CommentBank.seedFor(st.id + '|' + termId) + n,
      comments: _classmateComments(_activeCourse, st.id, termId),
      // Each press gives another version: never the text already in the box.
      previous: el.value,
      // Last term's approved sentences are left out (its draft_meta).
      exclude: lastTermIds(_activeCourse, st.id, termId),
      kept: kept,
      order: order,
      // Within the class's character limit, the teacher's typed sentences
      // (kept by keepTyped) counted in.
      charLimit: _limit(),
      reserve: _typedLength(rows),
    });
    if (!d.text) return;
    _lastDraft[key] = d;
    _lastSeed[key] = d.seed;
    _adoptDraft(key, d);
    if (!_ordered[key])
      _original[key] = d.sentences
        .map(function (x) {
          return x.step;
        })
        .filter(Boolean);
    _wording = null;
    _addAt = null;
    _writeRows(st);
  }

  /* Whether the student has no marked work this term (a mark on none of
     the class's marked work), so Generate has nothing true to draft from.
     The IE comment, which is about the missing marks, still drafts. */
  var _noDraft = {}; // key: Generate was pressed with no marked work
  function noMarkedWork(f) {
    var g = (f && f.grade) || {};
    if (g.basis === 'ie') return false;
    return !(g.marked && g.marked.mine > 0);
  }
  function _noDraftHtml(student, f) {
    if (!noMarkedWork(f)) return '';
    var shown = !!_noDraft[_rowKey(student)];
    return `<div class="qn-hint qn-nodraft" id="tq-nodraft" role="status"${shown ? '' : ' hidden'}>No marked work for ${esc(
      _first(student),
    )} this term yet, so there is nothing to draft from. You can write the comment yourself.</div>`;
  }

  /* Earlier reports with a comment, newest first, as tabs beside This Report. */
  function _earlierReports(cid, sid, termId) {
    var n = Number(String(termId).replace(/\D/g, ''));
    var mine = (getTermRatings(cid) || {})[sid] || {};
    return Object.keys(mine)
      .filter(function (k) {
        var m = Number(String(k).replace(/\D/g, ''));
        return /^term-\d+$/.test(k) && m < n && plainComment(mine[k].narrative).trim();
      })
      .sort(function (a, b) {
        return Number(b.replace(/\D/g, '')) - Number(a.replace(/\D/g, ''));
      });
  }

  var COPY_ICON =
    '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="4" y="4" width="7.5" height="7.5" rx="1.5"></rect><path d="M8.5 4 V2.5 A1 1 0 0 0 7.5 1.5 H2.5 A1 1 0 0 0 1.5 2.5 V7.5 A1 1 0 0 0 2.5 8.5 H4"></path></svg>';

  function _commentHtml(cid, student) {
    var sid = student.id;
    var termId = getTermId();
    var rating = getStudentTermRating(cid, sid, termId) || {};
    var text = _shownText(rating);
    var earlier = _earlierReports(cid, sid, termId);
    if (_commentTab !== 'this' && earlier.indexOf(_commentTab) < 0) _commentTab = 'this';
    var thisTab = _commentTab === 'this';
    var tabs = earlier.length
      ? `<div class="seg seg-sm qn-comment-tabs" role="group" aria-label="Report">${[['this', 'This Report']]
          .concat(
            earlier.map(function (k) {
              return [k, _reportLabel(k)];
            }),
          )
          .map(function (t) {
            var pressed = _commentTab === t[0];
            var tip =
              t[0] === 'this'
                ? 'The comment for this report.'
                : 'The comment that went home in ' + t[1] + '. Read only.';
            return `<button type="button" class="seg-btn${pressed ? ' active' : ''}" data-action="tqCommentTab" data-tab="${esc(t[0])}" aria-pressed="${pressed}" title="${esc(tip)}">${esc(t[1])}</button>`;
          })
          .join('')}</div>`
      : '';
    var body;
    if (thisTab) {
      body = `${_noDraftHtml(student, _facts(student))}${_emptyHtml(cid, student, text)}<div class="qn-text-wrap"><div class="qn-marks" id="tq-marks" aria-hidden="true">${_marksHtml(_rowsFor(student, _facts(student)), text)}</div><textarea id="tq-narrative" class="qn-text" rows="1" spellcheck="true" aria-label="Teacher Comment" title="The student’s report comment. Type here, or change a sentence in the Sentences card below." data-cid="${esc(cid)}" data-sid="${esc(sid)}" data-term="${esc(termId)}">${esc(text)}</textarea></div>
        <div class="qn-comment-foot" id="tq-comment-foot"${text.trim() ? '' : ' hidden'}>
          ${_countHtml(cid, text)}
          <button type="button" class="qn-sel-add" id="tq-sel-add" hidden data-action="tqSentences" data-do="ownFromBox" title="Adds the selected sentence to your bank, for other students it fits.">Add to My Bank</button>
          <button type="button" class="qn-copy" data-action="tqCopyNarrative" id="tq-copy-btn" title="Copies the comment as plain text, ready to paste. ⌘⇧C">${COPY_ICON}<span class="qn-copy-label">Copy</span></button>
        </div>`;
    } else {
      var old = (getStudentTermRating(cid, sid, _commentTab) || {}).narrative;
      body = `<div class="qn-hint">Went home in ${esc(_reportLabel(_commentTab))} · read only</div>
        <div class="qn-earlier">${plainComment(old)
          .split(/\n\s*\n/)
          .map(function (p) {
            return '<p>' + esc(p.trim()) + '</p>';
          })
          .join('')}</div>`;
    }
    var stale = thisTab ? staleFor(cid, student) : null;
    return `<div class="qn-comment" id="tq-comment-card">
        <div class="qn-comment-top">
          <span class="qn-comment-title">Teacher Comment</span>
          ${stale && rating.approvedAt ? `<span class="qn-approved-chip">Approved ${esc(_shortDay(rating.approvedAt))}</span>` : ''}
          ${tabs}
          ${thisTab ? '<button type="button" class="qn-generate" data-action="tqGenerate" id="tq-generate" title="Writes the comment from the gradebook, your ratings and Student Voice. Press again for another version. Sentences you typed or edited and your order stay.">Generate Comment</button>' : ''}
        </div>
        ${stale ? _staleHtml(cid, student, rating, stale) : ''}
        ${thisTab ? _pronounNoticeHtml(rating, _facts(student)) : ''}
        ${thisTab ? _basisHtml(cid, student, _facts(student)) : ''}
        ${thisTab ? '<div id="tq-warn-wrap">' + _warnHtml(cid, student, text) + '</div>' : ''}
        ${body}
      </div>`;
  }

  function tqCommentTab(tab) {
    tqSaveCurrentIfNeeded();
    _commentTab = tab || 'this';
    rerender();
  }

  /* ── IE, language goals and IEP goals (plan PR 3) ────────── */

  /* What the Teacher Comment card's switch offers: { ie, goals, basis }.
     IE when the student has marks on fewer than half the class's marked
     work (CommentBank.ieOffered), unless calc.js already reports IE (that
     path needs no switch); Language Goals for an ELL designation and IEP
     Goals for an IEP; a stored choice always stays on offer so it can be
     undone. Nothing in a Proficiency class. */
  function basisChoices(f) {
    var g = f.grade || {};
    var basis = g.basis || 'grade';
    var ie = basis === 'ie' || (CommentBank.ieOffered(f) && g.letter !== 'IE');
    var goals = CommentBank.goalsOffered(f);
    if ((basis === 'language_goals' || basis === 'iep_goals') && goals.indexOf(basis) < 0) goals = goals.concat(basis);
    return { ie: ie, goals: goals, basis: basis };
  }

  var BASIS_LABEL = { grade: 'Letter Grade', ie: 'IE', language_goals: 'Language Goals', iep_goals: 'IEP Goals' };
  var BASIS_TIP = {
    ie: 'Report IE. The comment then must give the problem, a plan, a deadline and a chance to meet.',
    language_goals: 'No letter grade. The comment must say the student is assessed against language goals.',
    iep_goals: 'No letter grade. The comment must say the student is assessed against the goals in the IEP.',
  };

  /* The line beside the switch, per choice on offer, in plain sentences. */
  function _basisLines(student, f, c) {
    var first = student.firstName || displayNameFirst(student);
    var p = ReportBlocks.getPronouns(student);
    var m = (f.grade && f.grade.marked) || { mine: 0, all: 0 };
    var they = p.subj === 'they';
    var lines = [];
    if (c.ie)
      lines.push(
        'Only ' +
          m.mine +
          ' of ' +
          m.all +
          ' assignments are marked. You can report IE (Insufficient Evidence) instead of a letter grade.',
      );
    if (c.goals.indexOf('language_goals') >= 0)
      lines.push(
        first +
          ' has an ELL designation. If ' +
          p.poss +
          ' English level keeps ' +
          p.obj +
          ' from showing the learning, assess ' +
          p.obj +
          ' against ' +
          p.poss +
          ' language goals instead of a letter grade.',
      );
    if (c.goals.indexOf('iep_goals') >= 0)
      lines.push(
        first +
          ' has an IEP. If ' +
          p.subj +
          (they ? ' are' : ' is') +
          ' working on the goals in ' +
          p.poss +
          ' IEP instead of the course, assess ' +
          p.obj +
          ' against those goals instead of a letter grade.',
      );
    return lines;
  }

  /* The switch at the top of the Teacher Comment card: "Letter Grade | IE",
     "Letter Grade | Language Goals" or "Letter Grade | IEP Goals" (one
     group when more than one is on offer). Letter Grade is the default. */
  function _basisHtml(cid, student, f) {
    var c = basisChoices(f);
    var pending = c.ie && _iePending === _rowKey(student);
    var opts = ['grade'];
    if (c.ie) opts.push('ie');
    opts = opts.concat(c.goals);
    if (opts.length < 2) return '';
    var lg = getCourseLetterData(cid, student.id);
    var m = (f.grade && f.grade.marked) || { mine: 0 };
    var letterTip =
      c.ie && lg && lg.S && lg.R != null
        ? 'Report ' + lg.S + ' ' + lg.R + '% from the ' + m.mine + ' marked assignments.'
        : 'Report a letter grade, as for every other student.';
    var btns = opts
      .map(function (b) {
        // IE waiting for its date: shown as picked, not yet saved.
        var wait = pending && b === 'ie';
        var on = !pending && c.basis === b;
        return `<button type="button" role="radio" class="seg-btn${wait ? ' pending' : ''}" aria-checked="${on}" data-action="tqSetBasis" data-basis="${b}" title="${esc(wait ? IE_PENDING_TIP : b === 'grade' ? letterTip : BASIS_TIP[b])}">${esc(BASIS_LABEL[b])}</button>`;
      })
      .join('');
    var lines = _basisLines(student, f, c)
      .concat(pending ? [IE_PENDING_LINE] : [])
      .map(function (t) {
        return `<span>${esc(t)}</span>`;
      })
      .join('');
    return `<div class="qn-basis${pending ? ' has-cal' : ''}" id="tq-basis">
      <span class="qn-basis-text">${lines}</span>
      <div class="seg seg-sm qn-basis-seg" role="radiogroup" aria-label="${c.ie ? 'Report this term as' : 'Assess this student against'}">${btns}</div>
      ${pending ? _calendarHtml('') : ''}
    </div>`;
  }

  /* IE chosen with no deadline yet: nothing is saved until a date is
     picked (an IE without its date would stay on this device only). The
     calendar opens at once and the switch shows IE waiting; Escape, a click
     outside or Letter Grade leaves Letter Grade. */
  var _iePending = null; // the student's row key while IE waits for its date
  var IE_PENDING_TIP = 'IE once you pick the deadline. Press Escape to keep Letter Grade.';
  var IE_PENDING_LINE = 'Pick the deadline to report IE. Until then the report shows the letter grade.';
  function _cancelIePending() {
    if (!_iePending) return false;
    _iePending = null;
    _cal = null;
    rerender();
    _focusSel('#tq-basis [data-basis="ie"]');
    return true;
  }

  /* A choice on the switch: saved with the deadline for this report (the
     report and gradebook read it), then the screen redraws. IE with no
     deadline yet waits for the date (_iePending): picking it saves both
     together. A comment Generate wrote and the teacher has not edited is
     written again for the new path; an edited one is left as it is. */
  function tqSetBasis(basis) {
    var st = _current();
    if (!st || !BASIS_LABEL[basis]) return;
    tqSaveCurrentIfNeeded();
    var termId = getTermId();
    var rating = getStudentTermRating(_activeCourse, st.id, termId) || {};
    if (_iePending && basis !== 'ie') _cancelIePending();
    if ((rating.reportingBasis || 'grade') === basis) return;
    // A saved date that has passed or falls after the school year counts
    // as none.
    if (basis === 'ie' && !CommentBank.deadlineOk(_activeCourse, rating.ieDeadline, _today())) {
      _iePending = _rowKey(st);
      _cal = { month: _deadlineRange().min.slice(0, 7) };
      rerender();
      _focusAny(['#tq-cal .qn-cal-day:not([disabled])', '#tq-cal']);
      return;
    }
    var text = plainComment(rating.narrative || '').trim();
    var last = _lastDraft[_activeCourse + '|' + st.id + '|' + termId];
    var redraft = !!text && !!last && text === last.text.trim();
    upsertTermRating(_activeCourse, st.id, termId, { reportingBasis: basis, ieDeadline: rating.ieDeadline || null });
    _cal = null;
    _facts(st, true);
    rerender();
    if (redraft) tqGenerate();
  }

  /* ── Checks before approving ─────────────────────────────── */

  /* Rows the teacher ticks "I checked this" on before Approve and Next
     (plan PR 3 and PR 11c): the missing-work row, an IE comment's Problem
     row and the grade row of a low grade are highlighted until ticked.
     Ticks last for this session. */
  var _checked = {};
  function _checkKey(sid, id) {
    return _activeCourse + '|' + sid + '|' + getTermId() + '|' + id;
  }
  /* A low grade: C- (or F) in a Letter or Both class, Emerging in a
     Proficiency class. */
  function lowGrade(f) {
    var g = (f && f.grade) || {};
    if (g.mode === 'proficiency') return /^Emerging/.test(String(f.standing || ''));
    return g.letter === 'C-' || g.letter === 'F';
  }
  /* The checks a comment needs: 'missing' on the missing-work row (Not
     Handed In, or an IE comment's Problem row when its problem is the
     missing work), 'ie' on an IE comment's Problem row otherwise, 'low' on
     the grade row (once the comment has one) when the grade is low. A goals
     comment has no grade sentence to check. */
  function _checksFor(f, rows) {
    var path = CommentBank.reportPath(f);
    if (path === 'ie') return [CommentBank.ieProblemOf(f) === 'missing' ? 'missing' : 'ie'];
    if (path) return [];
    var out = [];
    if (f.notHandedIn && f.notHandedIn.count > 0) out.push('missing');
    var hasGrade = (rows || []).some(function (r) {
      return r.step === 'grade';
    });
    if (hasGrade && lowGrade(f)) out.push('low');
    return out;
  }
  var CHECK_TIPS = {
    missing: 'Tick once you have checked these are really missing. Approve and Next stays off until you do.',
    ie: 'Tick once you have checked that IE is right for this student. Approve and Next stays off until you do.',
    low: 'Tick once you have checked this grade is right. Approve and Next stays off until you do.',
  };
  /* The "I checked this" box on a row, green once ticked. */
  function _checkHtml(sid, id, tip) {
    var on = !!_checked[_checkKey(sid, id)];
    return `<label class="qn-req-ctrl${on ? ' on' : ''}" title="${esc(tip || CHECK_TIPS[id])}"><input type="checkbox" data-tq-check="${id}"${on ? ' checked' : ''}>I checked this</label>`;
  }
  function _isChecked(sid, id) {
    return !!_checked[_checkKey(sid, id)];
  }
  /* The row's source line with its check: "2 of 28 · check that both are
     really missing before you approve" until ticked, then "2 of 28 ·
     checked" (the States mockup). */
  function _checkSourceHtml(sid, id, off, on) {
    return `<span class="qn-req-source" data-check-source="${id}" data-check-off="${esc(off)}" data-check-on="${esc(on)}">${esc(_isChecked(sid, id) ? on : off)}</span>`;
  }
  /* A box ticked: the row's highlight, the box and its source line change
     in place, and Approve and Next follows. */
  function tqSetCheck(id, on) {
    var st = _current();
    if (!st) return;
    _checked[_checkKey(st.id, id)] = !!on;
    document.querySelectorAll('[data-tq-check="' + id + '"]').forEach(function (input) {
      input.checked = !!on;
      var label = input.closest('.qn-req-ctrl');
      if (label) label.classList.toggle('on', !!on);
      var row = input.closest('.qn-req-row');
      if (row) row.classList.toggle('flag', !on);
      var src = row && row.querySelector('[data-check-source]');
      if (src) src.textContent = on ? src.dataset.checkOn : src.dataset.checkOff;
    });
    syncApprove();
  }

  /* ── Sentences that no longer match the gradebook ───────── */

  /* The comment's bank sentences checked against today's facts before
     approval (CommentBank.verify, through staleness on the record the
     approval would keep): a sentence whose claim fails shows on its row
     what it says and what is true now, with Use the New Sentence or Keep as
     Written, and Approve and Next stays off until each is chosen. A sentence
     the teacher edited, wrote or kept is theirs and is not checked. An
     approved comment shows the same on the Teacher Comment card instead
     (staleFor). Each: { row, before, after, id }. */
  var _claimCache = {};
  function claimChanges(st) {
    if (!st) return [];
    var termId = getTermId();
    var r = getStudentTermRating(_activeCourse, st.id, termId) || {};
    if (r.approvedAt) return [];
    var f = _facts(st);
    var rows = _rowsFor(st, f);
    if (!rows.length) return [];
    var at = [];
    rows.forEach(function (x, i) {
      if (String(x.text || '').trim()) at.push(i);
    });
    // A sentence kept as approved before stays kept (as metaFor keeps it).
    var meta = CommentBank.draftMeta(rows, f, { prev: r.draftMeta || null });
    var key = _rowKey(st);
    var picks = _picksFor(_activeCourse, st, f, termId);
    var sig = JSON.stringify([meta.sentences, picks]) + '\u0000' + meta.facts_hash;
    var hit = _claimCache[key];
    if (hit && hit.sig === sig) return hit.v;
    var stale = CommentBank.staleness(meta, f, picks, {});
    var v = ((stale && stale.changes) || [])
      .filter(function (c) {
        return c.kind === 'marks' && at[c.i] != null;
      })
      .map(function (c) {
        return { row: at[c.i], before: c.before, after: c.after, id: c.id || null };
      });
    _claimCache[key] = { sig: sig, v: v };
    return v;
  }
  /* An approved comment with a sentence that no longer matches: Approve
     and Next waits for Keep as Approved or Use the New Sentence. */
  function _approvedChanged(st) {
    var r = getStudentTermRating(_activeCourse, st.id, getTermId()) || {};
    var stale = r.approvedAt ? staleFor(_activeCourse, st) : null;
    return (
      !!stale &&
      stale.changes.some(function (c) {
        return c.kind === 'marks' || c.kind === 'pronouns';
      })
    );
  }

  /* What a row says and what is true now, under the row (the marks-changed
     board of the States mockup, for a comment not yet approved). */
  function _claimHtml(c) {
    var now = c.after
      ? `<span class="qn-stale-now">${esc(c.after)}</span>`
      : '<span class="qn-stale-none">Leave this sentence out.</span>';
    return `<div class="qn-stale qn-claim" data-claim-row="${c.row}">
        <div class="qn-stale-change">
          <div class="qn-stale-line"><span class="qn-stale-label">Written</span><span class="qn-stale-was">${esc(c.before)}</span></div>
          <div class="qn-stale-line"><span class="qn-stale-label">Now true</span>${now}</div>
          <div class="qn-stale-foot"><span class="qn-stale-grade">This sentence no longer matches the gradebook.</span><button type="button" class="qn-stale-keep" data-action="tqClaim" data-do="keep" data-row="${c.row}" title="Keeps the sentence as it is written. It is yours, and it is not checked again.">Keep as Written</button><button type="button" class="qn-stale-use" data-action="tqClaim" data-do="use" data-row="${c.row}" title="Puts the sentence that is true now in the comment.">Use the New Sentence</button></div>
        </div>
      </div>`;
  }

  /* Use the New Sentence or Keep as Written on row i of the student on
     screen. */
  function tqClaim(what, i) {
    var st = _current();
    if (!st || _resync(st)) return;
    tqSaveCurrentIfNeeded();
    var key = _rowKey(st);
    var f = _facts(st, true);
    i = Number(i);
    var c = claimChanges(st).find(function (x) {
      return x.row === i;
    });
    var rows = (_rowsFor(st, f) || []).slice();
    if (!c || !rows[i]) return;
    if (what === 'keep') {
      rows[i] = Object.assign({}, rows[i], { kept: true });
      _rows[key] = rows;
      _syncRequired();
      syncApprove();
      _focusAny([
        '#tq-sentences [data-claim-row] .qn-stale-use',
        '#tq-sentences [data-row="' + i + '"] .qn-srow-handle[tabindex]',
      ]);
      return;
    }
    if (what !== 'use') return;
    if (!c.after) rows.splice(i, 1);
    else {
      var s = c.id ? _bankById(c.id) : null;
      var row = s ? rowFromSentence(s, _bankContext(_activeCourse, st, f), rows[i].step, i === 0) : null;
      rows[i] = row || Object.assign({}, rows[i], { edited: false });
      rows[i].text = rows[i].drafted = c.after;
    }
    _rows[key] = rows;
    _writeRows(st);
    _syncRequired();
    syncApprove();
    _focusAny(['#tq-sentences [data-claim-row] .qn-stale-use', '#tq-approve-next']);
  }

  /* What keeps Approve and Next off for the student on screen: 'deadline'
     until an IE's deadline is picked, each check not yet ticked, 'claims'
     while a sentence no longer matches the gradebook, 'limit' past the
     class's character limit (plan PR 8) and 'long' while a sentence is
     over 20 words. */
  function approveBlockers(st) {
    if (!st) return [];
    var f = _facts(st);
    var out = [];
    if (CommentBank.reportPath(f) === 'ie' && !_pickedDeadline(f))
      out.push(_staleDeadline(f) ? 'deadlineRange' : 'deadline');
    if (claimChanges(st).length || _approvedChanged(st)) out.push('claims');
    _checksFor(f, _rowsFor(st, f)).forEach(function (id) {
      if (!_checked[_checkKey(st.id, id)]) out.push(id);
    });
    var el = _box();
    var text =
      el && el.dataset.sid === String(st.id)
        ? el.value
        : plainComment((getStudentTermRating(_activeCourse, st.id, getTermId()) || {}).narrative || '');
    text = text.replace(/\s+$/, '');
    if (_overLimit(text)) out.push('limit');
    if (longSentences(text).length) out.push('long');
    return out;
  }

  var APPROVE_TIP = 'Saves this comment to the report card and opens the next student.';
  function syncApprove() {
    var btn = document.getElementById('tq-approve-next');
    var st = _current();
    var blocked = approveBlockers(st);
    _fitsBlocked = blocked.indexOf('limit') >= 0 || blocked.indexOf('long') >= 0;
    var approvedNow = !!st && !!(getStudentTermRating(_activeCourse, st.id, getTermId()) || {}).approvedAt;
    _claimsBlocked = blocked.indexOf('claims') < 0 ? '' : approvedNow ? 'approved' : 'draft';
    _syncReadyLine();
    if (!btn) return;
    var date = blocked.indexOf('deadline') >= 0;
    var ticks = blocked.filter(function (b) {
      return b !== 'deadline' && b !== 'deadlineRange' && b !== 'limit' && b !== 'long' && b !== 'claims';
    });
    var ie = st && CommentBank.reportPath(_facts(st)) === 'ie';
    var tail =
      date && ticks.length
        ? ' Pick the deadline and tick “I checked this” first.'
        : date
          ? ' Pick the deadline first.'
          : ticks.length
            ? ie
              ? ' Tick “I checked this” first.'
              : ' Tick “I checked this” on the highlighted sentence' + (ticks.length > 1 ? 's' : '') + ' first.'
            : '';
    if (blocked.indexOf('deadlineRange') >= 0) tail = ' ' + _rangeLine() + tail;
    if (_claimsBlocked) tail += ' ' + CLAIMS_LINE[_claimsBlocked];
    if (blocked.indexOf('limit') >= 0)
      tail += ' Shorten the comment to ' + _plural(_limit(), 'character', 'characters') + ' first.';
    var long = blocked.indexOf('long') >= 0 ? longSentences(_boxText(st)).length : 0;
    if (long) tail += ' Shorten the sentence' + (long > 1 ? 's' : '') + ' over 20 words first.';
    btn.disabled = blocked.length > 0;
    btn.title = APPROVE_TIP + (tail || ' ⌘ Return');
  }
  /* The comment on screen for the student, else as saved. */
  function _boxText(st) {
    var el = _box();
    if (!st) return '';
    if (el && el.dataset.sid === String(st.id)) return el.value;
    return plainComment((getStudentTermRating(_activeCourse, st.id, getTermId()) || {}).narrative || '');
  }

  /* ── The deadline calendar ───────────────────────────────── */

  /* The school year the deadline is picked in: the class's first reporting
     term's start to its last term's end; with no terms, September 1 to June
     30 of the school year today falls in. { start, end } as YYYY-MM-DD. */
  function schoolYear(cid, today) {
    return CommentBank.schoolYear(cid, today);
  }

  function _today() {
    return typeof courseToday === 'function' ? courseToday(_activeCourse) : new Date().toISOString().slice(0, 10);
  }
  function _pad(n) {
    return (n < 10 ? '0' : '') + n;
  }
  function _ymd(y, m, d) {
    return y + '-' + _pad(m) + '-' + _pad(d);
  }
  /* "January 26" for a YYYY-MM-DD. */
  function _longDay(iso) {
    var d = parseLocalDate(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  }

  var _cal = null; // { month: 'YYYY-MM' } while the calendar is open

  /* The days a deadline can fall on: from today (or the year's start) to
     the end of the school year. */
  function _deadlineRange() {
    return CommentBank.deadlineRange(_activeCourse, _today());
  }
  /* The deadline picked for the student, '' while none is picked or the
     saved one cannot stand (passed, or after the school year). */
  function _pickedDeadline(f) {
    var g = (f && f.grade) || {};
    return g.ieDeadline && g.ieDeadlineOk !== false ? g.ieDeadline : '';
  }
  /* A saved deadline that has passed or falls after the school year. */
  function _staleDeadline(f) {
    var g = (f && f.grade) || {};
    return !!g.ieDeadline && g.ieDeadlineOk === false;
  }
  /* The plain reason Approve and Next waits on such a date. */
  function _rangeLine() {
    return 'Pick a deadline from today to ' + _longDay(_deadlineRange().max) + '.';
  }

  function _calendarHtml(picked) {
    if (!_cal) return '';
    var range = _deadlineRange();
    var y = Number(_cal.month.slice(0, 4));
    var mo = Number(_cal.month.slice(5, 7));
    var first = new Date(y, mo - 1, 1);
    var days = new Date(y, mo, 0).getDate();
    var title = first.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    var cells = '';
    for (var i = 0; i < first.getDay(); i++) cells += '<span></span>';
    for (var d = 1; d <= days; d++) {
      var iso = _ymd(y, mo, d);
      var dow = new Date(y, mo - 1, d).getDay();
      var out = iso < range.min || iso > range.max;
      var cls = 'qn-cal-day' + (iso === picked ? ' on' : '') + (dow === 0 || dow === 6 ? ' weekend' : '');
      cells += `<button type="button" class="${cls}" data-action="tqPickDeadline" data-date="${iso}"${out ? ' disabled' : ''} aria-label="${esc(_longDay(iso))}"${iso === picked ? ' aria-pressed="true"' : ''}>${d}</button>`;
    }
    var prevOk = _cal.month > range.min.slice(0, 7);
    var nextOk = _cal.month < range.max.slice(0, 7);
    var term = typeof getActiveTerm === 'function' ? getActiveTerm(_activeCourse) : null;
    var note =
      term && term.endsOn && term.endsOn >= range.min
        ? `<span class="qn-cal-note">${esc(term.label || 'This term')} ends ${esc(_longDay(term.endsOn))}. Pick a date on or before ${esc(_longDay(term.endsOn))}.</span>`
        : '';
    return `<div class="qn-cal" role="dialog" aria-label="Pick a deadline" id="tq-cal" tabindex="-1">
      <div class="qn-cal-top"><span class="qn-cal-title">${esc(title)}</span>
        <span class="qn-cal-nav"><button type="button" data-action="tqDeadlineMonth" data-dir="-1" aria-label="Previous month" title="Previous month"${prevOk ? '' : ' disabled'}>‹</button><button type="button" data-action="tqDeadlineMonth" data-dir="1" aria-label="Next month" title="Next month"${nextOk ? '' : ' disabled'}>›</button></span></div>
      <div class="qn-cal-week" aria-hidden="true"><span>S</span><span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span></div>
      <div class="qn-cal-grid">${cells}</div>
      ${note}
    </div>`;
  }

  function tqOpenDeadline() {
    var st = _current();
    if (!st) return;
    // A saved date that has passed or falls after the school year is not
    // picked: the calendar opens on today's month, with its days to pick.
    var picked = _pickedDeadline(_facts(st));
    var range = _deadlineRange();
    var start = picked || range.min;
    _cal = { month: start.slice(0, 7) };
    _syncRequired();
    // The focus stays in the calendar: the picked day, else the first that
    // can be picked, else the calendar itself.
    var on =
      document.querySelector('#tq-cal .qn-cal-day.on') ||
      document.querySelector('#tq-cal .qn-cal-day:not([disabled])') ||
      document.getElementById('tq-cal');
    if (on) on.focus();
  }
  function tqCloseDeadline() {
    if (!_cal) return;
    if (_cancelIePending()) return;
    _cal = null;
    _syncRequired();
    var b = document.getElementById('tq-deadline-btn');
    if (b) b.focus();
  }
  function tqDeadlineMonth(dir) {
    if (!_cal) return;
    var y = Number(_cal.month.slice(0, 4));
    var m = Number(_cal.month.slice(5, 7)) + (Number(dir) || 0);
    if (m < 1) {
      m = 12;
      y--;
    } else if (m > 12) {
      m = 1;
      y++;
    }
    _cal.month = y + '-' + _pad(m);
    if (_iePending) {
      rerender();
      _focusSel('#tq-cal [data-dir="' + (Number(dir) < 0 ? -1 : 1) + '"]');
    } else _syncRequired();
  }

  /* Whether a sentence holds the date as the comment says it (`was`:
     "December 18", or [date] until one is picked), as a whole: "December 1"
     is not in "December 18". */
  function _holdsDate(text, was) {
    if (!was) return false;
    var at = String(text || '').indexOf(was);
    while (at >= 0) {
      if (!/[0-9]/.test(text.charAt(at + was.length))) return true;
      at = text.indexOf(was, at + 1);
    }
    return false;
  }
  /* The deadline sentence in a comment, whichever IE Deadline frame it is:
     the drafted sentence of that step (this session's draft, else the rows),
     never one the teacher edited; else, of the sentences of the text that
     hold the date, one that also says "IE" before any other, so a date the
     teacher typed elsewhere in the comment is left alone. '' when none
     holds it. */
  function _deadlineSentence(text, was, last, rows) {
    var drafted = ((last && last.sentences) || rows || []).find(function (x) {
      return x.step === 'ieDeadline' && !x.edited && !x.kept && _holdsDate(x.text, was);
    });
    if (drafted && text.indexOf(drafted.text) >= 0) return drafted.text;
    var holds = String(text || '')
      .split(/(?<=[.!?][”"]?)\s+/)
      .filter(function (x) {
        return _holdsDate(x, was);
      });
    return (
      holds.find(function (x) {
        return /\bIE\b/.test(x);
      }) ||
      holds[0] ||
      ''
    );
  }

  /* Where the Deadline sentence goes among the rows: after the Plan, else
     before the Support, Meeting or Closing row, else last (the IEPath
     mockup's order: Plan, Deadline, Support, Meeting). */
  function deadlineAt(rows) {
    var at = -1;
    rows.forEach(function (r, i) {
      if (r.step === 'iePlan') at = i + 1;
    });
    if (at >= 0) return at;
    at = rows.findIndex(function (r) {
      return r.step === 'support' || r.step === 'ieMeeting' || r.step === 'closer';
    });
    return at >= 0 ? at : rows.length;
  }

  /* The Deadline sentence's row once a date is picked: the frame a draft
     would use for the student now (the class's usage counted, last term's
     sentences left out), filled with the date. null when none fits. */
  function _deadlineRow(st, f) {
    var ctx = _bankContext(_activeCourse, st, f);
    var termId = getTermId();
    var key = _rowKey(st);
    var d = CommentBank.draft(ctx, {
      quiet: true,
      seed: _lastSeed[key] || CommentBank.seedFor(st.id + '|' + termId) + 1,
      comments: _classmateComments(_activeCourse, st.id, termId),
      exclude: lastTermIds(_activeCourse, st.id, termId),
    });
    var x = (d.sentences || []).find(function (y) {
      return y.step === 'ieDeadline';
    });
    var s = x ? _bankById(x.id) : CommentBank.stepPool(_stepDef('ieDeadline'), ctx, COMMENT_BANK)[0];
    return s ? rowFromSentence(s, ctx, 'ieDeadline') : null;
  }

  /* The rows written as the comment and saved, without the box (the screen
     redraws after). */
  function _saveRows(st, rows) {
    var key = _rowKey(st);
    _rows[key] = rows;
    var text = composeRows(rows);
    upsertTermRating(_activeCourse, st.id, getTermId(), { narrative: text });
    _syncLast(key, rows, text);
  }

  /* A day picked: saved with the reporting basis for this report. The
     comment has no Deadline sentence until then: picking the first date
     puts it in at its place (deadlineAt); a new date replaces the date in
     that sentence only (the date picked before, as a whole), whichever
     frame it is. */
  function tqPickDeadline(iso) {
    var st = _current();
    if (!st || !/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) return;
    var range = _deadlineRange();
    if (iso < range.min || iso > range.max) return;
    tqSaveCurrentIfNeeded();
    var termId = getTermId();
    var rating = getStudentTermRating(_activeCourse, st.id, termId) || {};
    var was = CommentBank.deadlineText(rating.ieDeadline);
    var now = CommentBank.deadlineText(iso);
    // IE waiting for this date: the choice and the date saved together. A
    // comment Generate wrote and the teacher has not edited is written again
    // for the IE path (tqSetBasis).
    var pending = _iePending === _rowKey(st);
    var redraft = false;
    if (pending) {
      var t0 = plainComment(rating.narrative || '').trim();
      var last0 = _lastDraft[_rowKey(st)];
      redraft = !!t0 && !!last0 && t0 === last0.text.trim();
      _iePending = null;
    }
    upsertTermRating(_activeCourse, st.id, termId, {
      reportingBasis: pending ? 'ie' : rating.reportingBasis || 'grade',
      ieDeadline: iso,
    });
    var f = _facts(st, true);
    if (redraft) {
      _cal = null;
      rerender();
      tqGenerate();
      _focusSel('#tq-deadline-btn');
      return;
    }
    var text = _shownText(getStudentTermRating(_activeCourse, st.id, termId));
    var key = _rowKey(st);
    var last = _lastDraft[key];
    var rows = text.trim() ? _rowsFor(st, f) : [];
    var before = was ? _deadlineSentence(text, was, last, rows) : '';
    var after = before ? before.replace(was, now) : '';
    if (before && after !== before && text.indexOf(before) >= 0) {
      upsertTermRating(_activeCourse, st.id, termId, { narrative: text.replace(before, after) });
      if (last) {
        last.text = last.text.replace(before, after);
        last.sentences.forEach(function (x) {
          if (x.text !== before) return;
          x.text = after;
          // Its realiser tokens hold the old date: keep the new text as written.
          delete x.toks;
        });
        _adoptDraft(key, last);
      } else if (_rows[key]) {
        _rows[key].forEach(function (r) {
          if (r.text !== before) return;
          r.text = r.drafted = after;
          if (r.raw) delete r.raw.toks;
        });
      }
    } else if (
      !before &&
      rows.length &&
      CommentBank.reportPath(f) === 'ie' &&
      !rows.some(function (r) {
        return r.step === 'ieDeadline';
      })
    ) {
      // No Deadline sentence yet: it goes in at its place, with the date.
      var row = _deadlineRow(st, f);
      if (row) {
        rows.splice(deadlineAt(rows), 0, row);
        _saveRows(st, rows);
      }
    }
    // A comment shown without its old [date] sentence (_shownText) is saved
    // as shown.
    var now2 = getStudentTermRating(_activeCourse, st.id, termId) || {};
    if (text.trim() && plainComment(now2.narrative || '').indexOf('[date]') >= 0 && !now2.approvedAt)
      upsertTermRating(_activeCourse, st.id, termId, { narrative: _shownText(now2) });
    _cal = null;
    rerender();
    var b = document.getElementById('tq-deadline-btn');
    if (b) b.focus();
  }

  /* The comment as the screen shows it. One saved before Nov 2 may still
     say [date] in its Deadline sentence: while it is not approved, the
     sentence is left out while no deadline is picked, else it says the
     date (CommentBank.withDeadline). Nothing is written on load; the
     cleaned text is saved the next time the teacher edits, generates,
     picks a date or approves. An approved comment is never changed
     (approval always waited for a picked date). */
  function _shownText(rating) {
    var text = plainComment((rating && rating.narrative) || '');
    if (!rating || rating.approvedAt) return text;
    var ok = !rating.ieDeadline || CommentBank.deadlineOk(_activeCourse, rating.ieDeadline, _today());
    return CommentBank.withDeadline(text, rating.ieDeadline, ok);
  }

  /* ── The Required sentences ──────────────────────────────── */

  var CAL_ICON =
    '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="1.5" y="2.5" width="10" height="9" rx="1.5"></rect><path d="M1.5 5.5 H11.5 M4.5 1 V3.5 M8.5 1 V3.5"></path></svg>';

  /* Where each Required sentence comes from, as the mockup words it. */
  function _requiredSource(cid, student, f, key) {
    var g = f.grade || {};
    var m = g.marked || { mine: 0, all: 0 };
    var problem = CommentBank.ieProblemOf(f);
    if (CommentBank.reportPath(f) !== 'ie')
      return (
        'Required when ' +
        (g.basis === 'iep_goals' ? 'IEP Goals' : 'Language Goals') +
        ' is chosen. Fixed wording; it cannot be reworded.'
      );
    if (key === 'grade') {
      if (CommentBank.ieSource(f) === 'calc') return 'Your gradebook: under 50%, so IE until the course ends';
      var lg = getCourseLetterData(cid, student.id);
      return (
        'You chose IE above' +
        (lg && lg.S && lg.R != null ? ' · ' + lg.S + ' ' + lg.R + '% from the ' + m.mine + ' marked assignments' : '')
      );
    }
    if (key === 'ieProblem') {
      if (problem === 'missing')
        return (
          (f.notHandedIn.count || 0) + ' of ' + (m.all || f.record.total) + ' · check that these are really missing'
        );
      if (problem === 'marks' || problem === 'noMarks') return m.mine + ' of ' + m.all + ' assignments marked';
      return 'Your gradebook';
    }
    if (key === 'iePlan')
      return problem === 'missing'
        ? 'From the work not handed in'
        : problem === 'marks' || problem === 'noMarks'
          ? 'From the work with no mark yet'
          : 'Your gradebook';
    if (key === 'ieDeadline')
      return _pickedDeadline(f)
        ? 'The date you picked'
        : _staleDeadline(f)
          ? _rangeLine()
          : 'Approve and Next stays off until you pick a date.';
    return 'Gives the student and family a chance to talk with you';
  }

  /* One Required row: the part, Required, the sentence, where it comes
     from, and on the IE path "I checked this" on the missing-work row and
     Pick a Date on the deadline row. `i` and `handle` place it among the
     draft's rows (the Sentences card); without them it stands alone. */
  function _requiredRowHtml(cid, student, f, p, path, i, handle) {
    var checks = _checksFor(f);
    var picked = _pickedDeadline(f);
    var check = p.key === 'ieProblem' && checks.length ? checks[0] : '';
    var date = p.key === 'ieDeadline';
    var flag = (check && !_isChecked(student.id, check)) || (date && !picked);
    var source = _requiredSource(cid, student, f, p.key);
    var sourceHtml = check
      ? _checkSourceHtml(student.id, check, source, source.replace(/ · check that .*$/, '') + ' · checked')
      : `<span class="qn-req-source">${esc(source)}</span>`;
    var ctrl = check
      ? _checkHtml(
          student.id,
          check,
          check === 'missing' ? 'Tick once you have checked these are really missing.' : CHECK_TIPS.ie,
        )
      : date
        ? `<button type="button" class="qn-req-ctrl" id="tq-deadline-btn" data-action="tqOpenDeadline" aria-haspopup="dialog" aria-expanded="${!!_cal}" title="Pick the date by which the IE must become a grade.">${CAL_ICON}${picked ? esc(_longDay(picked)) : 'Pick a Date'}</button>`
        : '';
    return `<div class="qn-req-row${flag ? ' flag' : ''}${path !== 'ie' ? ' statement' : ''}${date ? ' has-cal' : ''}"${_rowAttr(i)}>
          ${handle || ''}<div class="qn-req-part"><span class="qn-req-label">${esc(p.label)}</span><span class="qn-req-chip">Required</span></div>
          <div class="qn-req-body">${p.text ? `<span class="qn-req-text">${esc(p.text)}</span>` : ''}${sourceHtml}</div>
          ${ctrl}
          ${date ? _calendarHtml(picked) : ''}
        </div>`;
  }

  /* The Required parts of an IE or goals comment as rows, before Generate
     has written the comment; on the IE path the Support row follows the
     Deadline (the IEPath mockup). Nothing on the grade path. */
  function _requiredRows(cid, student, f) {
    var path = CommentBank.reportPath(f);
    if (!path) return '';
    return CommentBank.requiredParts(_bankContext(cid, student, f))
      .map(function (p) {
        var html = _requiredRowHtml(cid, student, f, p, path);
        return p.key === 'ieDeadline' ? html + _supportRowHtml(cid, student, f) : html;
      })
      .join('');
  }

  /* ── The Sentences card (plan PR 11b) ────────────────────── */

  /* The parts a sentence is labelled with, each the draft's steps it
     covers (CommentBank.DRAFT_STEPS). Browse Sentences is split the same
     way (the Browse Sentences mockup). `word`: the part in a thin-part
     line ("Only 4 habit sentences fit …"). */
  var PARTS = [
    { id: 'grade', label: 'Grade', steps: ['grade'] },
    { id: 'bestPiece', label: 'Best Piece', word: 'best piece', steps: ['example'] },
    { id: 'strengths', label: 'Strengths', word: 'strength', steps: ['opening', 'overall', 'growth'] },
    { id: 'habits', label: 'Habits', word: 'habit', steps: ['habits', 'attendance', 'strongHabits'] },
    { id: 'notHandedIn', label: 'Not Handed In', steps: ['notHandedIn', 'lateWork'] },
    { id: 'nextStep', label: 'Next Step', word: 'next step', steps: ['nextStep', 'goWords', 'home'] },
    { id: 'support', label: 'Support', steps: ['support'] },
    { id: 'closing', label: 'Closing', steps: ['closer'] },
  ];
  var IE_LABELS = { ieProblem: 'Problem', iePlan: 'Plan', ieDeadline: 'Deadline', ieMeeting: 'Meeting' };

  function partOf(step) {
    return (
      PARTS.find(function (p) {
        return p.steps.indexOf(step) >= 0;
      }) || null
    );
  }
  function _stepAt(step) {
    return CommentBank.DRAFT_STEPS.findIndex(function (x) {
      return x.key === step;
    });
  }
  function _stepDef(step) {
    return CommentBank.DRAFT_STEPS[_stepAt(step)] || null;
  }
  /* Whether a step is a Required part on the comment's path. */
  function _isRequired(step, path) {
    if (!path) return false;
    return step === 'grade' || (path === 'ie' && !!IE_LABELS[step]);
  }
  /* The row of the plan's best-piece sentence (n36: "{His} best piece was
     “{title}”, where {he} {note}."): the only one labelled Best Piece and
     tinted, on the card and in the comment (the LayoutE mockup). */
  function _isBestRow(row) {
    if (!row || row.step !== 'example') return false;
    // The plan's best-piece sentence (n36) and the frames around the same
    // title and note (bank expansion, Nov 1): any sentence claiming it.
    var s =
      row.s ||
      COMMENT_BANK.sentences.find(function (x) {
        return x.id === row.id;
      });
    return !!s && (s.claims || []).indexOf('bestPiece') >= 0;
  }
  /* A row's label: its part, or on the IE path Problem, Plan, Deadline and
     Meeting, and Statement for the goals sentence. In the example step
     only the best-piece sentence is Best Piece; a Student Voice quote is
     Voice and any other example Example. The attendance sentence is
     Attendance (the States mockup). A sentence the teacher typed is Your
     Sentence (the InsertRows mockup). */
  function rowLabel(row, path) {
    if (!row.step) return isTyped(row) ? 'Your Sentence' : '';
    if (_isRequired(row.step, path)) {
      if (row.step === 'grade') return path === 'ie' ? 'Grade' : 'Statement';
      return IE_LABELS[row.step];
    }
    if (row.step === 'example' && !_isBestRow(row)) {
      return row.s && row.s.group === "In the Student's Words" ? 'Voice' : 'Example';
    }
    if (row.step === 'attendance') return 'Attendance';
    var p = partOf(row.step);
    return p ? p.label : '';
  }

  /* A comment's sentences, as the realiser splits them: after . ! ? or …
     (and a closing quote) where the next sentence starts, never after a
     title such as Ms., e.g. or an initial, or inside a quotation. */
  function sentencesOf(text) {
    return CommentRealiser.sentences(text);
  }

  function _bankById(id) {
    return (
      COMMENT_BANK.sentences.find(function (s) {
        return s.id === id;
      }) || null
    );
  }

  /* The rows of the comment on screen, per class, student and report: one
     per sentence, { id, step, text, drafted (the text as the bank filled
     it, null for the teacher's own), edited, raw (the draft's sentence),
     prov (its provenance), s (the bank sentence), classLine }. The comment
     in the box follows the rows' order; typing in the box changes the
     rows (alignRows). Kept in memory only. */
  var _rows = {};
  var _ordered = {}; // key: true once the teacher moved a row
  var _original = {}; // key: the step order Generate gave, for Reset Order
  var _wording = null; // { index } while a row's Other Wording menu is open
  function _rowKey(st) {
    return _activeCourse + '|' + st.id + '|' + getTermId();
  }

  /* The rows for a draft (as draft() or redrawHabits() return it). A
     sentence kept as the teacher wrote it takes its row as it was (prev),
     so Edited and the bank text it replaced survive a redraw. */
  function rowsFromDraft(d, prev) {
    var prov = (d && d.provenance) || [];
    var old = (prev || []).slice();
    return ((d && d.sentences) || []).map(function (x, i) {
      var row = {
        id: x.id,
        step: x.step || null,
        text: x.text,
        drafted: x.text,
        edited: false,
        raw: x,
        prov: prov[i] || null,
        s: x.kept || x.classLine ? null : _bankById(x.id),
        classLine: !!x.classLine,
      };
      if (x.kept) {
        var at = old.findIndex(function (r) {
          return r.text === x.text && (!r.step || r.step === row.step);
        });
        var was = at >= 0 ? old.splice(at, 1)[0] : null;
        row.edited = was ? was.edited : true;
        row.drafted = was ? was.drafted : null;
        if (was) {
          row.id = was.id;
          row.raw = was.raw || x;
          row.prov = was.prov;
          row.s = was.s;
          row.classLine = was.classLine;
        }
      }
      return row;
    });
  }

  /* Whether a row is a sentence the teacher typed into the comment: no
     bank sentence, no class line (the Your Sentence row). */
  function isTyped(row) {
    return !!row && !row.step && !row.classLine && !row.placeholder;
  }
  /* The teacher's typed sentences (old rows with no step) put back among
     the new rows at their place in the order: after the row they followed,
     found by its text or its step; else before the row that followed them;
     else where they were, after the grade sentence when Generate put it
     first (the grade leads unless the teacher moved it). */
  function keepTyped(old, rows) {
    var out = rows.slice();
    var find = function (r) {
      if (!r) return -1;
      return out.findIndex(function (x) {
        return x.text === r.text || (!!r.step && x.step === r.step);
      });
    };
    old.forEach(function (r, i) {
      if (!isTyped(r) || find(r) >= 0) return;
      var at = find(old[i - 1]);
      if (at >= 0) at++;
      else {
        var next = -1;
        for (var k = i + 1; k < old.length && next < 0; k++) next = find(old[k]);
        at = next >= 0 ? next : Math.min(i, out.length);
        if (next < 0 && at === 0 && out[0] && out[0].step === 'grade') at = 1;
      }
      out.splice(at, 0, r);
    });
    return out;
  }
  /* A draft adopted as the rows: the teacher's typed sentences go back at
     their place (keepTyped). */
  function _adoptDraft(key, d) {
    var old = _rows[key] || [];
    var rows = keepTyped(old, rowsFromDraft(d, old));
    _rows[key] = rows;
    return rows;
  }
  /* The characters the teacher's typed rows add to a draft (keepTyped puts
     them back), each with the space before it. */
  function _typedLength(rows) {
    return (rows || []).filter(isTyped).reduce(function (n, r) {
      return n + String(r.text || '').length + 1;
    }, 0);
  }
  /* A row for a sentence the teacher typed. */
  function typedRow(text, n) {
    return {
      id: 'text:' + (n == null ? Date.now().toString(36) : n),
      step: null,
      text: text,
      drafted: null,
      edited: true,
      raw: null,
      prov: null,
      s: null,
      classLine: false,
    };
  }
  /* The rows with a row put in at `at` (a gap: how many rows come before
     it). */
  function insertRow(rows, row, at) {
    var out = rows.slice();
    var i = Math.max(0, Math.min(out.length, Number(at) || 0));
    out.splice(i, 0, row);
    return out;
  }

  /* Who a context is about, for the realiser. */
  function _whoOf(ctx) {
    return ctx._who || { name: ctx.name || '', p: ctx._p, onFile: !!ctx._p };
  }

  /* A row for a bank sentence filled for the student, in a step, with its
     tokens so the realiser can name the student in it when it comes first
     (composeRows). first: filled as the comment's first sentence. */
  function rowFromSentence(s, ctx, step, first) {
    var text = CommentBank.fill(s, ctx, { first: !!first });
    var at = step || CommentBank.stepOf(s);
    return {
      id: s.id,
      step: at,
      text: text,
      drafted: text,
      edited: false,
      raw: { id: s.id, part: s.part, step: at, text: text, toks: CommentBank.sentenceTokens(s, ctx), who: _whoOf(ctx) },
      prov: CommentBank.provenance(s, ctx),
      s: s,
      classLine: false,
    };
  }

  /* The rows after the box was typed in: each row's text found among the
     box's sentences stays; a sentence that changed takes the row it
     replaced, marked Edited (a run of changed sentences fills the run of
     rows they replaced, the last row taking the rest); a sentence with no
     row becomes the teacher's own row; a row whose sentence is gone goes.
     A row of several sentences (a teacher line) matches as a run. */
  function alignRows(rows, text) {
    var ss = sentencesOf(text);
    var units = rows.map(function (r) {
      var k = sentencesOf(r.text).length || 1;
      return { len: k, text: sentencesOf(r.text).join(' ') };
    });
    var n = rows.length;
    var m = ss.length;
    var hit = function (i, j) {
      var u = units[i];
      return j + u.len <= m && ss.slice(j, j + u.len).join(' ') === u.text;
    };
    // The most rows kept in place, as a longest common subsequence.
    var L = [];
    for (var i = n; i >= 0; i--) {
      L[i] = [];
      for (var j = m; j >= 0; j--) {
        if (i === n || j === m) L[i][j] = 0;
        else {
          var best = Math.max(L[i + 1][j], L[i][j + 1]);
          if (hit(i, j)) best = Math.max(best, 1 + L[i + 1][j + units[i].len]);
          L[i][j] = best;
        }
      }
    }
    var out = [];
    var pendR = [];
    var pendS = [];
    var flush = function () {
      pendR.forEach(function (r, k) {
        if (k >= pendS.length) return;
        var t = k === pendR.length - 1 ? pendS.slice(k).join(' ') : pendS[k];
        var c = Object.assign({}, r, { text: t });
        c.edited = c.drafted == null || t !== c.drafted;
        out.push(c);
      });
      if (!pendR.length)
        pendS.forEach(function (t) {
          out.push({
            id: 'text:' + out.length,
            step: null,
            text: t,
            drafted: null,
            edited: true,
            raw: null,
            prov: null,
            s: null,
            classLine: false,
          });
        });
      pendR = [];
      pendS = [];
    };
    var a = 0;
    var b = 0;
    while (a < n || b < m) {
      if (a < n && b < m && hit(a, b) && L[a][b] === 1 + L[a + 1][b + units[a].len]) {
        flush();
        out.push(rows[a]);
        b += units[a].len;
        a++;
      } else if (a < n && (b >= m || L[a + 1][b] >= L[a][b + 1])) {
        pendR.push(rows[a]);
        a++;
      } else {
        pendS.push(ss[b]);
        b++;
      }
    }
    flush();
    return out;
  }

  /* A class line's row: the support line, the closing sentence or the
     late-work line, as typed. */
  function _classRow(step, t) {
    var def = _stepDef(step);
    return {
      id: 'class:' + step,
      step: step,
      text: t,
      drafted: t,
      edited: false,
      raw: { id: 'class:' + step, part: def.part, step: step, text: t, classLine: true },
      prov: {
        sentenceId: 'class:' + step,
        part: def.part,
        claims: [],
        factKeys: ['class.' + step],
        values: {},
        classLine: true,
      },
      s: null,
      classLine: true,
    };
  }

  /* A row for a sentence of an approved comment, from its record
     (draft_meta's sentences): the bank sentence it was, with the values it
     was filled with, Edited as it was; a class line; or the teacher's own. */
  function _rowFromMeta(x, t, i, ctx) {
    var s = _bankById(x.id);
    if (s && !x.class_line) {
      var r = rowFromSentence(s, ctx, x.step || null, i === 0);
      // Its realiser tokens hold today's values: the text as written.
      if (t !== r.text) delete r.raw.toks;
      r.text = t;
      r.edited = !!x.edited;
      if (!r.edited) r.drafted = t;
      if (x.kept) r.kept = true;
      if (x.values) r.prov = Object.assign({}, r.prov, { values: x.values, sources: x.sources || r.prov.sources });
      return r;
    }
    if (x.class_line && x.step && _stepDef(x.step) && _stepDef(x.step).line && !x.edited) return _classRow(x.step, t);
    return {
      id: 'text:' + i,
      step: null,
      text: t,
      drafted: null,
      edited: true,
      raw: null,
      prov: null,
      s: null,
      classLine: false,
    };
  }

  /* The rows for a comment with no draft in memory (the page reloaded, or
     a comment typed by hand): each sentence matched to the sentence of the
     approved comment's record that it is (meta, draft_meta), exactly; else
     to the bank sentence that fills to it, else to one whose pattern it
     holds, else to a class line; the rest are the teacher's own. */
  function recoverRows(text, ctx, meta) {
    var ss = sentencesOf(text);
    var used = {};
    var mine = (meta && Array.isArray(meta.sentences) ? meta.sentences : []).map(function (x) {
      return x && x.id != null ? x : null;
    });
    var rows = ss.map(function (t, i) {
      var at = mine.findIndex(function (x) {
        return x && String(x.text) === t;
      });
      if (at >= 0) {
        var x = mine[at];
        mine[at] = null;
        used[x.id] = true;
        return _rowFromMeta(x, t, i, ctx);
      }
      var exact = COMMENT_BANK.sentences.find(function (s) {
        return (
          !used[s.id] &&
          CommentBank.fits(s, ctx) &&
          (CommentBank.fill(s, ctx) === t || CommentBank.fill(s, ctx, { first: true }) === t)
        );
      });
      if (exact) {
        used[exact.id] = true;
        var r = rowFromSentence(exact, ctx, null, i === 0);
        r.text = r.drafted = t;
        return r;
      }
      return { text: t, i: i };
    });
    return rows.map(function (r) {
      if (r.id) return r;
      var t = r.text;
      // A bank sentence's wording with other values in its slots (the marks
      // moved since it was written): the bank sentence, with the values as
      // written, so verify() checks it; only a real edit is Edited.
      // One that fits the student today first, then one on the comment's
      // own path (IE or not), then the first in the bank.
      var read = null;
      var b = null;
      var rank = -1;
      var ie = ctx._path === 'ie';
      COMMENT_BANK.sentences.forEach(function (x) {
        if (used[x.id] || rank === 2) return;
        var v = CommentBank.valuesIn(x, t);
        if (!v) return;
        var k = CommentBank.fits(x, ctx) ? 2 : (x.claims || []).indexOf('ie') >= 0 === ie ? 1 : 0;
        if (k > rank) {
          rank = k;
          b = x;
          read = v;
        }
      });
      if (b) {
        used[b.id] = true;
        var br = rowFromSentence(b, ctx);
        br.text = br.drafted = t;
        // A skill chosen among several valid ones is checked as named.
        br.prov = CommentBank.provenanceAs(b, ctx, read);
        // Its realiser tokens hold today's values: the text as written.
        delete br.raw.toks;
        return br;
      }
      var s = COMMENT_BANK.sentences.find(function (x) {
        return !used[x.id] && CommentBank.usedBy(x, [t]) > 0;
      });
      if (s) {
        used[s.id] = true;
        var row = rowFromSentence(s, ctx);
        row.text = t;
        row.edited = row.drafted == null || t !== row.drafted;
        if (!CommentBank.fits(s, ctx)) row.drafted = null;
        return row;
      }
      var line = ['closer', 'support', 'lateWork'].find(function (k) {
        var def = _stepDef(k);
        return String(ctx[def.line] || '').trim() === t;
      });
      if (line) return _classRow(line, t);
      return {
        id: 'text:' + r.i,
        step: null,
        text: t,
        drafted: null,
        edited: true,
        raw: null,
        prov: null,
        s: null,
        classLine: false,
      };
    });
  }

  /* Whether the rows in memory are still the saved comment. Another tab or
     device can save a newer one (the class bundle, the cross-tab sync):
     then they are not, unless the box on screen is this student's and the
     teacher is typing in it, or it holds the saved text (the rows follow
     the box, _alignNow). */
  function _sameSentences(a, b) {
    return sentencesOf(a).join(' ') === sentencesOf(b).join(' ');
  }
  function _rowsCurrent(student) {
    var rows = _rows[_rowKey(student)];
    if (!rows) return true;
    var rating = getStudentTermRating(_activeCourse, student.id, getTermId()) || {};
    var text = _shownText(rating);
    var mine = rows
      .map(function (r) {
        return r.text;
      })
      .join(' ');
    if (_sameSentences(mine, text)) return true;
    var el = _box();
    var shown =
      el &&
      String(el.dataset.sid) === String(student.id) &&
      (!el.dataset.cid || el.dataset.cid === String(_activeCourse)) &&
      (!el.dataset.term || el.dataset.term === getTermId());
    return !!shown && (tqNarrativeDirty || _sameSentences(el.value, text));
  }
  /* Before an action on the rows: rows built from an older comment are
     dropped and the screen is drawn again from the saved one, and the
     action does not run (its row numbers were the old rows'). */
  function _resync(st) {
    if (!st || _rowsCurrent(st)) return false;
    delete _rows[_rowKey(st)];
    _wording = null;
    _addAt = null;
    _own = null;
    rerender();
    return true;
  }

  /* The rows on screen for a student: the draft's, or recovered from the
     saved comment, or none before anything is written. Rows built from an
     older comment than the one saved are built again from the saved one. */
  function _rowsFor(student, f) {
    var key = _rowKey(student);
    if (_rows[key] && _rowsCurrent(student)) return _rows[key];
    delete _rows[key];
    var rating = getStudentTermRating(_activeCourse, student.id, getTermId()) || {};
    var text = _shownText(rating).trim();
    if (!text) return [];
    var ctx = _bankContext(_activeCourse, student, f);
    // The pronouns may have changed since the comment was written, with
    // the questionnaire closed (Class Management, the Student Dashboard).
    var was = writtenWith(rating, f, text, student);
    _pronounsSeen[key] = (f && f.pronouns) || null;
    if (!was || rating.approvedAt) {
      // An approved comment is never changed for the teacher: its sentences
      // that read with the old pronouns show on the card (staleFor) with
      // Keep as Approved or Use the New Sentence.
      if (was) _recordPronouns(student, was);
      _rows[key] = recoverRows(text, ctx, rating.draftMeta);
      return _rows[key];
    }
    return _applyPronouns(student, f, was, recoverRows(text, _pronounContext(student, f, was), rating.draftMeta));
  }

  /* ── Pronouns changed (Edit Student) ────────────────────── */

  /* The pronouns each student's rows were last drawn with, per row key.
     When they change, every bank sentence the teacher has not edited is
     filled again with the new ones at once (the realiser); a sentence the
     teacher typed or edited is left as written and, when it still holds
     an old pronoun, its row says "Pronouns changed". An approved comment
     is never changed for the teacher: its sentences show on the card as
     the marks-changed pattern does (staleFor, pronounChanges), and Use the
     New Sentence clears the approval. */
  var _pronounsSeen = {};
  function _pronounWords(p) {
    return p ? [p.subj, p.obj, p.poss, p.refl].filter(Boolean) : [];
  }
  function _holdsWord(text, words) {
    var t = String(text || '');
    return (words || []).some(function (w) {
      return new RegExp('(^|[^A-Za-z])' + w + '($|[^A-Za-z])', 'i').test(t);
    });
  }
  /* The rows with every bank sentence the teacher has not edited filled
     for the pronouns now; the rest as written. ctxWas: the context the
     rows were read with. A sentence is filled again from the values it
     was written with (CommentBank.valuesIn), so only its pronouns change;
     one too short to read back keeps its tokens, filled again from today's
     facts only when they still give the same sentence (a slot filled whole
     with the pronouns, like the best piece). */
  function _writtenToks(r, whoWas) {
    if (!r.s) return null;
    var v = CommentBank.valuesIn(r.s, r.text);
    if (!v) return null;
    var toks = CommentRealiser.tokens(r.s.text, function (k) {
      var x = v[k] == null ? '' : String(v[k]);
      // A title is read with its quotes; the realiser puts them back.
      return CommentRealiser.TITLE_SLOTS[k] ? x.replace(/^[“"]/, '').replace(/[”"]$/, '') : x;
    });
    var back = function (named) {
      return CommentRealiser.render(toks, whoWas, { named: named }) === r.text;
    };
    return back(true) || back(false) ? toks : null;
  }
  function pronounsChanged(rows, ctx, ctxWas) {
    var who = _whoOf(ctx);
    var whoWas = ctxWas ? _whoOf(ctxWas) : null;
    return rows.map(function (r) {
      if (r.edited || r.kept || r.classLine) return r;
      var toks = whoWas ? _writtenToks(r, whoWas) : null;
      if (!toks && r.raw && r.raw.toks) {
        toks = r.raw.toks;
        if (ctxWas && r.s && JSON.stringify(CommentBank.sentenceTokens(r.s, ctxWas)) === JSON.stringify(toks))
          toks = CommentBank.sentenceTokens(r.s, ctx);
      }
      if (!toks) return r;
      var raw = r.raw || { id: r.id, part: r.s ? r.s.part : null, step: r.step, text: r.text };
      return Object.assign({}, r, { raw: Object.assign({}, raw, { who: who, toks: toks }) });
    });
  }

  /* The pronouns as a comment's record keeps them (draft_meta.pronouns). */
  function pronounSet(p) {
    if (!p) return null;
    var out = {};
    ['subj', 'obj', 'poss', 'refl', 'verb', 'capSubj'].forEach(function (k) {
      if (p[k] != null) out[k] = p[k];
    });
    return out;
  }
  function _samePronouns(a, b) {
    return JSON.stringify(pronounSet(a)) === JSON.stringify(pronounSet(b));
  }
  /* A context for the student with other pronouns. */
  function _pronounContext(student, f, p) {
    var g = Object.assign({}, f, { pronouns: Object.assign({}, p, { onFile: true }), pronounsOnFile: true });
    return CommentBank.context(g, _picksFor(_activeCourse, student, f));
  }
  /* The bank sentences, not edited, that a comment's text holds word for
     word when read with a context's pronouns (a row read with other values
     has no realiser tokens). */
  function _bankRowCount(text, ctx) {
    return recoverRows(text, ctx, null).filter(function (r) {
      return !!r.s && !r.edited && !!r.raw && !!r.raw.toks;
    }).length;
  }
  var PRONOUN_SETS = ['he/him', 'she/her', 'they/them'];
  /* The pronouns a saved comment was written with, when they are not the
     student's now; null when they are the same. The set kept with the
     approval (draft_meta.pronouns) while the comment is still the approved
     text; else the set its bank sentences read with, when that finds more
     of them than the pronouns on file do (a comment written before the set
     was kept, or changed since). */
  function writtenWith(rating, f, text, student) {
    var now = f && f.pronouns;
    if (!now) return null;
    var meta = (rating && rating.draftMeta) || null;
    var stored = meta && meta.pronouns;
    var approvedText =
      meta && Array.isArray(meta.sentences)
        ? meta.sentences
            .map(function (x) {
              return x && x.text;
            })
            .join(' ')
        : null;
    var plain = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (stored && stored.subj && approvedText === plain) return _samePronouns(stored, now) ? null : stored;
    var nowWords = _pronounWords(now);
    var cands = PRONOUN_SETS.map(function (s) {
      return ReportBlocks.getPronouns({ pronouns: s });
    });
    if (stored && stored.subj) cands.unshift(stored);
    var best = null;
    var bestN = -1;
    var cur = null;
    cands.forEach(function (p) {
      if (_samePronouns(p, now) || (best && _samePronouns(p, best))) return;
      var extra = _pronounWords(p).filter(function (w) {
        return nowWords.indexOf(w) < 0;
      });
      if (!_holdsWord(plain, extra)) return;
      if (cur == null) cur = _bankRowCount(plain, _bankContext(_activeCourse, student, f));
      var n = _bankRowCount(plain, _pronounContext(student, f, p));
      if (n > cur && n > bestN) {
        best = p;
        bestN = n;
      }
    });
    return best;
  }

  function _syncPronouns(cid, student, f) {
    var key = _rowKey(student);
    var now = (f && f.pronouns) || null;
    if (!_rows[key]) {
      // First drawn since the page loaded: the saved comment is compared
      // with the pronouns on file as its rows are recovered (_rowsFor).
      _rowsFor(student, f);
      return;
    }
    var was = _pronounsSeen[key];
    _pronounsSeen[key] = now;
    var rows = _rows[key];
    if (!was || !rows || !rows.length || JSON.stringify(was) === JSON.stringify(now)) return;
    if ((getStudentTermRating(cid, student.id, getTermId()) || {}).approvedAt) _recordPronouns(student, was);
    else _applyPronouns(student, f, was, rows);
  }

  /* The record told which pronouns the comment was written with, when it
     does not say yet (draft_meta.pronouns); a comment with no record gets
     one that holds only them. */
  function _pronounRecord(meta, was, now) {
    var kept = meta && meta.pronouns;
    if (kept && kept.subj && !_samePronouns(kept, now)) return null;
    var out = Object.assign({}, meta || { v: 1, sentences: [] }, { pronouns: pronounSet(was) });
    delete out.pronoun_ok;
    delete out.pronoun_kept;
    return out;
  }
  function _recordPronouns(student, was) {
    var termId = getTermId();
    var rating = getStudentTermRating(_activeCourse, student.id, termId) || {};
    var meta = _pronounRecord(rating.draftMeta || null, was, ReportBlocks.getPronouns(student));
    if (meta) upsertTermRating(_activeCourse, student.id, termId, { draftMeta: meta });
  }

  /* An approved comment's sentences that read with the pronouns it was
     written with (draft_meta.pronouns), as changes for the card (the
     marks-changed pattern): { kind: 'pronouns', i, id, before, after,
     keptAsApproved }. Only bank sentences the teacher did not edit; one
     kept as approved (draft_meta.pronoun_kept) is marked so staleFor leaves
     it off the card. [] when the pronouns are the same. */
  function pronounChanges(cid, student, rating, f) {
    var meta = (rating && rating.draftMeta) || null;
    var was = meta && meta.pronouns;
    if (!rating || !rating.approvedAt || !was || !was.subj || !f || _samePronouns(was, f.pronouns)) return [];
    var text = plainComment(rating.narrative || '').trim();
    if (!text) return [];
    var keep = Array.isArray(meta.pronoun_kept) ? meta.pronoun_kept : [];
    var ctxWas = _pronounContext(student, f, was);
    var old = recoverRows(text, ctxWas, meta);
    var before = old.map(function (r) {
      return r.text;
    });
    var next = pronounsChanged(old, CommentBank.context(f, _picksFor(cid, student, f)), ctxWas);
    composeRows(next);
    var out = [];
    next.forEach(function (r, i) {
      if (r.edited || r.kept || r.text === before[i]) return;
      out.push({
        kind: 'pronouns',
        // Kept as approved (draft_meta.pronoun_kept): not shown again.
        keptAsApproved: keep.indexOf(before[i]) >= 0,
        id: r.s ? r.id : null,
        i: (meta.sentences || []).findIndex(function (x) {
          return x && x.text === before[i];
        }),
        before: before[i],
        after: r.text,
      });
    });
    return out;
  }

  /* Rows read with the pronouns `was` filled again with the student's
     pronouns now, the comment saved from them, and the record told which
     pronouns the comment was written with (draft_meta.pronouns), so the
     typed and edited sentences are checked against them on every load
     until the comment is approved again. A new text clears an approval
     (upsertTermRating), as Use the New Sentence does. */
  function _applyPronouns(student, f, was, rows) {
    var key = _rowKey(student);
    var termId = getTermId();
    var next = pronounsChanged(rows, _bankContext(_activeCourse, student, f), _pronounContext(student, f, was));
    _rows[key] = next;
    var text = composeRows(next);
    var rating = getStudentTermRating(_activeCourse, student.id, termId) || {};
    var data = {};
    if (text !== plainComment(rating.narrative || '').replace(/\s+$/, '')) data.narrative = text;
    var meta = _pronounRecord(rating.draftMeta || null, was, f.pronouns);
    if (meta) data.draftMeta = meta;
    if (Object.keys(data).length) upsertTermRating(_activeCourse, student.id, termId, data);
    _syncLast(key, next, text);
    return next;
  }

  /* The old pronoun words a typed or edited sentence is checked for: the
     words of the pronouns the comment was written with (draft_meta) that
     the student's pronouns now do not use, and the sentences the teacher
     kept as they are (Dismiss). Read on every load. */
  function pronounCheck(rating, f) {
    var meta = (rating && rating.draftMeta) || null;
    var was = meta && meta.pronouns;
    var now = f && f.pronouns;
    if (!was || !was.subj || !now || _samePronouns(was, now)) return { gone: [], ok: [] };
    return {
      gone: pronounWordsNotIn(now, was),
      ok: Array.isArray(meta.pronoun_ok) ? meta.pronoun_ok : [],
    };
  }
  /* Every pronoun word (he, she, they and the other sets ReportBlocks
     knows) that the pronouns `now` do not use, so a sentence written for
     any earlier set is caught, not only the last one. "it" and "its" are
     left out unless the comment was written with them: they are in most
     sentences about a thing. */
  function pronounWordsNotIn(now, was) {
    var sets = (window.ReportBlocks && ReportBlocks.PRONOUN_SETS) || {};
    var keep = _pronounWords(now).concat(sets[now && now.subj] || []);
    var all = [];
    Object.keys(sets).forEach(function (subj) {
      if (subj === 'it' && !(was && was.subj === 'it')) return;
      [subj].concat(sets[subj]).forEach(function (w) {
        if (all.indexOf(w) < 0) all.push(w);
      });
    });
    _pronounWords(was).forEach(function (w) {
      if (all.indexOf(w) < 0) all.push(w);
    });
    return all.filter(function (w) {
      return keep.indexOf(w) < 0;
    });
  }
  function _pronounCheckFor(student, f) {
    return pronounCheck(getStudentTermRating(_activeCourse, student.id, getTermId()) || {}, f);
  }
  /* Whether a row says "Pronouns changed": a sentence the teacher typed or
     edited that still holds an old pronoun word and was not kept as it is. */
  function pronounNote(row, check) {
    if (!row || !row.edited || row.classLine || row.placeholder || !check || !check.gone.length) return false;
    return check.ok.indexOf(row.text) < 0 && _holdsWord(row.text, check.gone);
  }
  /* The line in the comment card once the change took the approval away. */
  function _pronounNoticeHtml(rating, f) {
    var meta = (rating && rating.draftMeta) || null;
    if (!meta || !meta.approved_at || rating.approvedAt || !pronounCheck(rating, f).gone.length) return '';
    return '<div class="qn-hint qn-pron-notice" id="tq-pron-notice" role="status">Pronouns changed since this comment was approved. Check the marked sentences, then approve again.</div>';
  }
  /* Dismiss on a row's note: the sentence stays as written, unmarked. */
  function _pronounOk(st, unit) {
    var termId = getTermId();
    var rating = getStudentTermRating(_activeCourse, st.id, termId) || {};
    var meta = rating.draftMeta;
    if (!meta) return;
    var ok = (Array.isArray(meta.pronoun_ok) ? meta.pronoun_ok : []).slice();
    unit.forEach(function (r) {
      if (ok.indexOf(r.text) < 0) ok.push(r.text);
    });
    upsertTermRating(_activeCourse, st.id, termId, { draftMeta: Object.assign({}, meta, { pronoun_ok: ok }) });
  }

  /* The comment from the rows, in their order, through the realiser (plan
     PR 9, CommentBank.realise): the name moves to whichever sentence comes
     first and pronouns follow; a sentence the teacher edited, or a class
     line, is used as written. The rows' texts follow what was written. */
  function composeRows(rows) {
    var r = CommentBank.realise(
      rows.map(function (row) {
        return row.edited || row.kept || !row.raw
          ? { id: row.id, text: row.text }
          : Object.assign({}, row.raw, { text: row.text });
      }),
    );
    (r.sentences || []).forEach(function (x, i) {
      if (rows[i] && !rows[i].edited && !rows[i].kept && x.text) {
        rows[i].text = x.text;
        rows[i].drafted = x.text;
      }
    });
    return r.text;
  }

  /* The last draft kept in step with the rows, so a habit rating, a
     deadline or a class line's change redraws from what is on screen. Only
     a comment Generate wrote has one. */
  function _syncLast(key, rows, text) {
    var last = _lastDraft[key];
    if (!last) return;
    last.text = text;
    last.sentences = rows.map(function (r) {
      var def = r.step ? _stepDef(r.step) : null;
      var x = Object.assign({}, r.raw || { id: r.id, part: def ? def.part : null, step: r.step }, { text: r.text });
      if (r.edited) x.kept = true;
      else delete x.kept;
      return x;
    });
    last.provenance = rows.map(function (r) {
      return r.prov || { sentenceId: r.id, part: null, claims: [], factKeys: [], values: {}, sources: {}, kept: true };
    });
    last.ids = rows.map(function (r) {
      return r.id;
    });
  }

  /* Text into the box as typing would (one ⌘ Z step brings the old text
     back). */
  function _putText(el, text) {
    el.focus();
    el.select();
    var ok = false;
    try {
      ok = document.execCommand('insertText', false, text);
    } catch (e) {
      ok = false;
    }
    if (!ok || el.value !== text) el.value = text;
  }

  /* The rows written to the box, saved, and the card redrawn. */
  function _writeRows(st) {
    var key = _rowKey(st);
    var rows = _rows[key] || [];
    var text = composeRows(rows);
    var el = _box();
    if (el && String(el.dataset.sid) === String(st.id)) {
      _putText(el, text);
      tqNarrativeDirty = true;
      tqSaveNarrative();
      _syncNote();
      _syncMarks();
    } else {
      upsertTermRating(_activeCourse, st.id, getTermId(), { narrative: text });
    }
    _syncLast(key, rows, text);
    _syncRequired();
  }

  /* After typing: the rows follow the box, and the card redraws only when
     a row changed. */
  var _alignTimer = null;
  function _alignSoon() {
    clearTimeout(_alignTimer);
    _alignTimer = setTimeout(_alignNow, 300);
  }
  function _alignNow() {
    var st = _current();
    var el = _box();
    if (!st || !el || String(el.dataset.sid) !== String(st.id)) return;
    var key = _rowKey(st);
    var rows = _rows[key] || _rowsFor(st, _facts(st));
    var next = alignRows(rows, el.value);
    var mark = function (xs) {
      return JSON.stringify(
        xs.map(function (r) {
          return [r.id, r.text, r.edited];
        }),
      );
    };
    if (mark(next) === mark(rows)) return;
    _rows[key] = next;
    _syncLast(key, next, el.value);
    _syncMarks();
    _syncRequired();
  }

  /* ── Moving rows ─────────────────────────────────────────── */

  /* The rows as the card shows them: the Not Handed In sentence and the
     late-work line after it are one row, and the next-step sentences (the
     next step, the student's own words, the family's part) are one Next
     Step row; a support row among them is shown after that row, never
     between its sentences (the LayoutE and InContext mockups). */
  var NEXT_KEYS = ['nextStep', 'goWords', 'home'];
  function _isNext(row) {
    return !!row && NEXT_KEYS.indexOf(row.step) >= 0;
  }
  function _units(rows) {
    var out = [];
    for (var i = 0; i < rows.length; i++) {
      var u = [rows[i]];
      if (rows[i].step === 'notHandedIn' && rows[i + 1] && rows[i + 1].step === 'lateWork') {
        u.push(rows[++i]);
      } else if (_isNext(rows[i])) {
        var held = [];
        while (rows[i + 1] && (_isNext(rows[i + 1]) || (rows[i + 1].step === 'support' && _isNext(rows[i + 2])))) {
          i++;
          if (rows[i].step === 'support') held.push([rows[i]]);
          else u.push(rows[i]);
        }
        out.push(u);
        held.forEach(function (h) {
          out.push(h);
        });
        continue;
      }
      out.push(u);
    }
    return out;
  }
  function _unitOf(units, row) {
    return units.findIndex(function (u) {
      return u.indexOf(row) >= 0;
    });
  }
  function _flat(units) {
    return [].concat.apply([], units);
  }
  /* The rows with row i moved one place up (dir -1) or down (1); null at
     the end. */
  function moveRow(rows, i, dir) {
    var us = _units(rows);
    var u = _unitOf(us, rows[i]);
    var v = u + (dir < 0 ? -1 : 1);
    if (u < 0 || v < 0 || v >= us.length) return null;
    var m = us.splice(u, 1)[0];
    us.splice(v, 0, m);
    return _flat(us);
  }
  /* The rows with row i dropped before or after row j; null when nothing
     moves. */
  function dropRow(rows, i, j, before) {
    var us = _units(rows);
    var u = _unitOf(us, rows[i]);
    var v = _unitOf(us, rows[j]);
    if (u < 0 || v < 0 || u === v) return null;
    var m = us.splice(u, 1)[0];
    if (u < v) v--;
    us.splice(before ? v : v + 1, 0, m);
    return _flat(us);
  }
  /* The rows back in the order Generate gave (step keys); a sentence of
     the teacher's own stays after the row it follows. */
  function resetOrder(rows, original) {
    var at = [];
    var last = -1;
    rows.forEach(function (r, i) {
      var k = r.step ? original.indexOf(r.step) : -1;
      if (k < 0) k = r.step ? original.length + i : last + 0.5;
      else last = k;
      at.push(k);
    });
    return rows
      .map(function (r, i) {
        return { r: r, k: at[i], i: i };
      })
      .sort(function (x, y) {
        return x.k - y.k || x.i - y.i;
      })
      .map(function (x) {
        return x.r;
      });
  }

  function _moveRow(i, dir) {
    var st = _current();
    if (!st || _resync(st)) return;
    var key = _rowKey(st);
    var rows = _rows[key] || [];
    var next = moveRow(rows, i, dir);
    if (!next) return;
    _rows[key] = next;
    _ordered[key] = true;
    _wording = null;
    _addAt = null;
    _writeRows(st);
    _focusRow(next.indexOf(rows[i]));
  }
  function _dropRow(i, j, before) {
    var st = _current();
    if (!st || _resync(st)) return;
    var key = _rowKey(st);
    var rows = _rows[key] || [];
    var next = dropRow(rows, i, j, before);
    if (!next) return;
    _rows[key] = next;
    _ordered[key] = true;
    _wording = null;
    _addAt = null;
    _writeRows(st);
  }
  function _resetOrder() {
    var st = _current();
    if (!st) return;
    var key = _rowKey(st);
    _rows[key] = resetOrder(_rows[key] || [], _original[key] || []);
    _ordered[key] = false;
    _wording = null;
    _addAt = null;
    _writeRows(st);
    _focusSel('#tq-browse-btn');
  }
  function _focusRow(i) {
    _focusSel('#tq-sentences [data-row="' + i + '"] .qn-srow-handle[tabindex]');
  }

  /* Drag and drop between the rows, wired once on the document: the
     handle starts it, a blue line shows where the row will land. */
  var _dnd = false;
  var _drag = null;
  function _wireDrag() {
    if (_dnd || typeof document === 'undefined' || !document.addEventListener) return;
    _dnd = true;
    document.addEventListener('dragstart', function (e) {
      var h = e.target && e.target.closest && e.target.closest('.qn-srow-handle[draggable]');
      var row = h && h.closest('#tq-sentences [data-row]');
      if (!row) return;
      _drag = Number(row.dataset.row);
      try {
        e.dataTransfer.setData('text/plain', String(_drag));
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setDragImage(row, 24, 20);
      } catch (x) {
        /* a browser without a data transfer */
      }
      row.classList.add('dragging');
    });
    document.addEventListener('dragover', function (e) {
      if (_drag == null) return;
      var row = e.target && e.target.closest && e.target.closest('#tq-sentences [data-row]');
      if (!row) return;
      e.preventDefault();
      var r = row.getBoundingClientRect();
      _dropLine(row, e.clientY < r.top + r.height / 2);
    });
    document.addEventListener('drop', function (e) {
      if (_drag == null) return;
      var from = _drag;
      var row = e.target && e.target.closest && e.target.closest('#tq-sentences [data-row]');
      e.preventDefault();
      _endDrag();
      if (!row) return;
      var r = row.getBoundingClientRect();
      _dropRow(from, Number(row.dataset.row), e.clientY < r.top + r.height / 2);
    });
    document.addEventListener('dragend', _endDrag);
  }
  function _dropLine(row, before) {
    var line = document.getElementById('tq-drop-line');
    if (!line) {
      line = document.createElement('div');
      line.id = 'tq-drop-line';
      line.className = 'qn-drop-line';
      line.setAttribute('aria-hidden', 'true');
    }
    row.parentNode.insertBefore(line, before ? row : row.nextSibling);
  }
  function _endDrag() {
    _drag = null;
    var line = document.getElementById('tq-drop-line');
    if (line) line.remove();
    document.querySelectorAll('#tq-sentences .dragging').forEach(function (el) {
      el.classList.remove('dragging');
    });
  }

  /* ── Other Wording ───────────────────────────────────────── */

  /* How many classmates have each bank sentence this report. */
  function _usage(cid, student) {
    return CommentBank.classUsage(COMMENT_BANK, _classmateComments(cid, student.id, getTermId()), cid, student.id);
  }
  function _usedMeta(n) {
    return n ? 'Used for ' + _plural(n, 'classmate', 'classmates') : 'Not used yet in this class';
  }

  /* Up to two other sentences that fit the same facts as a row's: the
     same step, fitting the student, claiming the same things, not in the
     comment already, the least used in the class first. On a Habit Ratings
     row (one habit at one rating, `habit` and `level`), only that cell's
     other frames; on the summary row, the summary's frames and any cell
     frame whose rating matches. */
  function alternatives(row, ctx, usage, taken, bank) {
    var step = row.step ? _stepDef(row.step) : null;
    if (!step || step.line || !row.s) return [];
    var claims = function (s) {
      return (s.claims || []).slice().sort().join(',');
    };
    var same = claims(row.s);
    var cell = row.s.habit ? { habit: row.s.habit, level: row.s.level } : null;
    var at = {};
    (bank || COMMENT_BANK).sentences.forEach(function (s, i) {
      at[s.id] = i;
    });
    return (bank || COMMENT_BANK).sentences
      .filter(function (s) {
        if (s.id === row.id || s.part !== step.part || step.groups.indexOf(s.group) < 0) return false;
        if (cell && (s.habit !== cell.habit || s.level !== cell.level)) return false;
        if (taken[s.id] || !CommentBank.fits(s, ctx) || claims(s) !== same) return false;
        if (step.prefer && ctx[step.prefer] && (s.needs || []).indexOf(step.prefer) < 0) return false;
        if (
          step.never &&
          (s.needs || []).some(function (k) {
            return step.never.indexOf(k) >= 0;
          })
        )
          return false;
        return true;
      })
      .sort(function (a, b) {
        return (usage[a.id] || 0) - (usage[b.id] || 0) || at[a.id] - at[b.id];
      })
      .slice(0, 2);
  }

  /* How many bank sentences of a part fit the student. */
  function _fitCount(part, ctx) {
    return COMMENT_BANK.sentences.filter(function (s) {
      return part.steps.indexOf(CommentBank.stepOf(s)) >= 0 && CommentBank.fits(s, ctx);
    }).length;
  }

  function _wordingMenuHtml(cid, student, ctx, rows, i) {
    var row = rows[i];
    var first = _first(student);
    var usage = _usage(cid, student);
    var taken = {};
    rows.forEach(function (r) {
      taken[r.id] = true;
    });
    var part = partOf(row.step);
    var item = function (id, text, meta, on) {
      return `<button type="button" role="menuitemradio" aria-checked="${on}" class="qn-menu-item${on ? ' on' : ''}" data-action="tqSentences" data-do="pick" data-row="${i}" data-sentence="${esc(id)}" title="${on ? 'The sentence in use.' : 'Use this wording instead.'}"><span class="qn-menu-mark" aria-hidden="true">${on ? '✓' : ''}</span><span class="qn-menu-body"><span class="qn-menu-text">${esc(text)}</span><span class="qn-menu-meta">${esc(meta)}</span></span></button>`;
    };
    var n = usage[row.id] || 0;
    var mine = item(
      row.id,
      row.text,
      'In use' + (n ? ' · used for ' + _plural(n, 'classmate', 'classmates') : ''),
      true,
    );
    var others = alternatives(row, ctx, usage, taken)
      .map(function (s) {
        return item(s.id, CommentBank.fill(s, ctx, { first: i === 0 }), _usedMeta(usage[s.id] || 0), false);
      })
      .join('');
    var low = part.label.toLowerCase();
    return `<div class="qn-menu qn-wording" role="menu" aria-label="Other ways to say the ${esc(low)} sentence" id="tq-wording-menu">
      <span class="qn-menu-head">Other ways to say this</span>
      ${mine}${others}
      <div class="qn-menu-sep" role="separator"></div>
      <button type="button" role="menuitem" class="qn-menu-add qn-menu-all" data-action="tqSentences" data-do="all" data-row="${i}" title="Opens Browse Sentences on ${esc(part.label)}: every sentence that fits ${esc(first)}.">All ${_plural(_fitCount(part, ctx), esc(low) + ' sentence', esc(low) + ' sentences')}…</button>
      ${
        window.PersonalBank && PersonalBank.stepAllowed(row.step)
          ? `<button type="button" role="menuitem" class="qn-menu-add" data-action="tqSentences" data-do="ownOpen" data-where="row" data-mode="write" data-row="${i}" title="Write a sentence of your own for this part. It goes in your bank and into ${esc(first)}’s comment here.">+ Write Your Own</button>`
          : ''
      }
    </div>`;
  }

  function _pickWording(st, i, id) {
    var key = _rowKey(st);
    var rows = _rows[key] || [];
    var s = _bankById(id);
    _wording = null;
    _addAt = null;
    if (!rows[i] || !s || rows[i].id === id) {
      _syncRequired();
      _focusSel('#tq-sentences [data-row="' + i + '"] [data-do="wording"]');
      return;
    }
    rows[i] = rowFromSentence(s, _bankContext(_activeCourse, st, _facts(st)), rows[i].step, i === 0);
    _writeRows(st);
    _focusSel('#tq-sentences [data-row="' + i + '"] [data-do="wording"]');
  }

  /* ── Where each sentence's fact came from ────────────────── */

  function _gradeSource(cid, f) {
    var g = f.grade || {};
    if (g.mode === 'proficiency' || g.letter == null) {
      return f.overall > 0
        ? levelWord(cid, f.overall) + ' overall, from this term’s scores'
        : 'No scores this term yet';
    }
    var head = g.letter + ' · ' + g.pct + '%';
    var nx = g.next;
    if (!nx) return head;
    var gap = Math.round((nx.min - Number(g.pct)) * 10) / 10;
    var next = CommentBank.aOrAn(nx.letter);
    if (CommentBank.closeTo(g)) return head + '. Close to ' + next + ': ' + gap + ' points short.';
    var why =
      gap > 2
        ? gap + ' points short'
        : (g.pieces || []).length < 6
          ? 'fewer than six marked pieces'
          : 'the marks are going down';
    return head + '. Not called close to ' + next + ': ' + why + '.';
  }

  function _habitName(k) {
    var h = CommentBank.HABITS.find(function (x) {
      return x.key === k;
    });
    return HABIT_LABELS[k] || (h ? h.name : k);
  }
  function _habitsOf(cid, student, f) {
    return CommentBank.effectiveHabits(
      (getStudentTermRating(cid, student.id, getTermId()) || {}).habits || f.habits,
      f.record,
      f,
    );
  }
  /* The habits the teacher rated for the student this report (Not Seen
     included), as { key: true }; Completes Work from the record is not
     one of them (CommentBank.effectiveHabits). */
  function _ratedByYou(cid, student, f) {
    var stored = (getStudentTermRating(cid, student.id, getTermId()) || {}).habits || f.habits || {};
    var out = {};
    CommentBank.HABITS.forEach(function (h) {
      var v = Number(stored[h.key]);
      if (v >= 1 && v <= CommentBank.NOT_SEEN) out[h.key] = true;
    });
    return out;
  }
  /* "From the record: Completes Work, Sometimes": a habit the teacher has
     not rated, read from the assignment record. */
  function _fromRecord(k, habits) {
    return 'From the record: ' + _habitName(k) + ', ' + CommentBank.SCALE[habits[k] - 1];
  }
  /* The habits sentence's source line: what the teacher rated ("Collaborates
     rated Sometimes", "All six rated Consistently") and, apart, what came
     from the record, never one called the other. */
  function _habitsSource(cid, student, f) {
    var habits = _habitsOf(cid, student, f);
    var h = CommentBank.habitSummary(habits);
    var mine = _ratedByYou(cid, student, f);
    var rated = function (k) {
      return mine[k] ? _habitName(k) + ' rated ' + CommentBank.SCALE[habits[k] - 1] : _fromRecord(k, habits);
    };
    var yours = function (ks) {
      return ks.filter(function (k) {
        return mine[k];
      });
    };
    var record = function (ks) {
      return ks
        .filter(function (k) {
          return !mine[k];
        })
        .map(function (k) {
          return _fromRecord(k, habits);
        });
    };
    if (h.excellent || h.good) {
      var how = h.excellent ? ' rated Consistently' : ' rated Usually or Consistently';
      var n = yours(h.seen).length;
      var from = record(h.seen);
      if (!from.length) return 'All ' + CommentBank.numberWords(n) + how;
      return [n ? _cap(CommentBank.numberWords(n)) + how : ''].concat(from).filter(Boolean).join(' · ');
    }
    if (h.build.length) return h.build.map(rated).join(' · ');
    if (h.strong.length) {
      var strong = yours(h.strong);
      return (strong.length ? [strong.map(_habitName).join(', ') + ' rated Consistently'] : [])
        .concat(record(h.strong))
        .join(' · ');
    }
    return 'From your Work Habits ratings';
  }

  /* One fact key of a sentence's provenance in plain words. */
  function _factWords(k, cid, student, f, ctx) {
    var first = _first(student);
    var course = _courseName(cid);
    var g = f.grade || {};
    var m;
    var find = function (xs, id) {
      return (xs || []).find(function (x) {
        return String(x.id) === String(id);
      });
    };
    if (k === 'grade.letter') return g.letter != null ? g.letter + ' · ' + g.pct + '%' : '';
    if (k === 'grade.marked') return g.marked ? g.marked.mine + ' of ' + g.marked.all + ' assignments marked' : '';
    if (k === 'overall' || k === 'letter') return f.overall > 0 ? 'Overall ' + f.levelText(f.overall) : '';
    if (k === 'work') return 'This term’s marks';
    if (k === 'picture') return ctx.picture ? 'The term’s picture: ' + ctx.picture : '';
    if ((m = k.match(/^comp:(.+)$/))) {
      var c = find(f.comps, m[1]);
      return c ? c.name + ' · ' + f.levelText(c.level) : '';
    }
    if ((m = k.match(/^work:(.+)$/))) {
      var w = find(f.work, m[1]);
      return w ? w.title + ' · ' + f.levelText(w.v) : '';
    }
    if ((m = k.match(/^habit:(.+)$/))) {
      var hs = _habitsOf(cid, student, f);
      var v = hs[m[1]];
      if (!v) return '';
      return _ratedByYou(cid, student, f)[m[1]]
        ? _habitName(m[1]) + ' rated ' + CommentBank.SCALE[v - 1]
        : _fromRecord(m[1], hs);
    }
    if (/^confidence:/.test(k)) return first + '’s self-assessment';
    if (k === 'voice.goal') return 'From ' + first + '’s goal check-in';
    if (/^voice\./.test(k)) return 'From ' + first + '’s About Me answers';
    if (k === 'attendance.absent') return f.absent > 0 ? f.absent + ' absent' : '';
    if (k === 'attendance.late') return f.late > 0 ? f.late + ' late' : '';
    if (k === 'notHandedIn') return _missingSource(f);
    if (k === 'record.late') return f.record && f.record.late ? f.record.late + ' handed in late' : '';
    if (k === 'class.closer') return 'From your class settings';
    if (k === 'class.support') return 'One of your support lines for ' + course;
    if (k === 'class.lateWork') return course + '’s Late Work Policy';
    return '';
  }

  /* One source line for a row of several sentences: each sentence's
     source once, the "general sentence" note only when no sentence states
     a fact. */
  function _unitSource(unit, cid, student, f, ctx) {
    var out = [];
    var general = '';
    unit.forEach(function (r) {
      var src = rowSource(r, cid, student, f, ctx);
      if (/^A general sentence\./.test(src)) general = src;
      else if (out.indexOf(src) < 0) out.push(src);
    });
    return out.join(' · ') || general;
  }

  /* Where a row's fact came from, in plain words: the grade and its
     distance from the next band, the piece and its mark, the ratings, the
     weakest skill. An edited sentence says so instead. */
  function rowSource(row, cid, student, f, ctx) {
    var first = _first(student);
    if (isTyped(row)) return 'Typed by you · kept when you regenerate';
    if (row.edited) return 'Edited by you · kept when you regenerate';
    if (row.step === 'attendance') return 'From Attendance above · new';
    if (row.step === 'grade') return _gradeSource(cid, f);
    if (row.step === 'habits' || row.step === 'strongHabits') return _habitsSource(cid, student, f);
    var keys = ((row.prov && row.prov.factKeys) || []).slice();
    var bits = [];
    var next = row.step === 'nextStep' ? CommentBank.nextSkillOf(f) : null;
    // Every competency at the same level: said once, not as a list.
    var comps = keys.filter(function (k) {
      return /^comp:/.test(k);
    });
    if (comps.length > 2 && comps.length === (f.comps || []).length) {
      var levels = f.comps.map(function (c) {
        return f.levelText(c.level);
      });
      if (
        levels.every(function (l) {
          return l === levels[0];
        })
      ) {
        bits.push('All ' + CommentBank.numberWords(comps.length) + ' competencies at ' + levels[0]);
        keys = keys.filter(function (k) {
          return !/^comp:/.test(k);
        });
      }
    }
    keys.forEach(function (k) {
      var w;
      if (next && k === 'comp:' + next.comp.id)
        w = 'Weakest skill: ' + next.comp.name + ', ' + _plural((next.comp.scores || []).length, 'piece', 'pieces');
      else w = _factWords(k, cid, student, f, ctx);
      if (w && bits.indexOf(w) < 0) bits.push(w);
    });
    if (_isBestRow(row)) {
      var top = bestPiece(f.work);
      if (top && String(top.note || '').trim()) bits.push('your note for the report');
    }
    return bits.join(' · ') || 'A general sentence. It states no fact about ' + first + '.';
  }

  /* ── Thin parts of the bank (plan PR 13) ─────────────────── */

  /* The class's bank strength (CommentBank.bankStrength), worked out once
     per drawing of the page and again when a habit rating changes. */
  var _strength = null;
  function _bankStrength(cid) {
    var termId = getTermId();
    var students = getTqStudents();
    var key =
      cid +
      '|' +
      termId +
      '|' +
      students
        .map(function (s) {
          return s.id + ':' + JSON.stringify((getStudentTermRating(cid, s.id, termId) || {}).habits || {});
        })
        .join('|');
    if (!_strength || _strength.key !== key) {
      _strength = { key: key, r: CommentBank.bankStrength(cid, { termId: termId, students: students }) };
    }
    return _strength.r;
  }

  /* Under a row's source line, when its part of the bank is thin for this
     student (the class warnings mockup): how many sentences fit how many
     students, and a link to Browse Sentences on that part. A sentence the
     teacher edited is their own, so it has none. */
  function thinLine(st, part) {
    return (
      'Only ' +
      st.sentences +
      ' ' +
      part.word +
      (st.sentences === 1 ? ' sentence fits ' : ' sentences fit ') +
      st.students +
      ' students, so some will repeat.'
    );
  }
  function _thinHtml(cid, student, row, i) {
    if (row.edited || !row.step || !row.s) return '';
    var part = partOf(row.step);
    var st = (_bankStrength(cid).byStudent[student.id] || {})[row.step];
    if (!part || !part.word || !st || !st.thin) return '';
    return `<span class="qn-req-thin">${esc(thinLine(st, part))} <button type="button" class="qn-thin-link" data-action="tqSentences" data-do="all" data-row="${i}" title="Opens Browse Sentences on ${esc(part.label)}, where you can pick another sentence for this part.">Write one of your own</button> to add more.</span>`;
  }

  /* ── The card ────────────────────────────────────────────── */

  var DOTS_ICON =
    '<svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true"><circle cx="2.5" cy="2.5" r="1.3"></circle><circle cx="7.5" cy="2.5" r="1.3"></circle><circle cx="2.5" cy="7" r="1.3"></circle><circle cx="7.5" cy="7" r="1.3"></circle><circle cx="2.5" cy="11.5" r="1.3"></circle><circle cx="7.5" cy="11.5" r="1.3"></circle></svg>';
  var HANDLE = `<span role="button" tabindex="0" class="qn-srow-handle" draggable="true" aria-label="Move this sentence" title="Drag to move this sentence. ⌥↑ and ⌥↓ move it too.">${DOTS_ICON}</span>`;
  var SPACER = '<span class="qn-srow-handle qn-srow-spacer" aria-hidden="true"></span>';

  function _rowAttr(i) {
    return i != null && i >= 0 ? ' data-row="' + i + '"' : '';
  }

  /* One row of the card. unit: its rows (_units), the first leading; i:
     the first's index among the rows (none for a class row the comment has
     no sentence for yet). */
  function _rowHtml(cid, student, f, ctx, rows, unit, i, path) {
    var row = unit[0];
    var fixed = i < 0 || _isRequired(row.step, path);
    var handle = fixed ? SPACER : HANDLE;
    if (row.step === 'notHandedIn') return _missingRowHtml(cid, f, handle, i);
    if (row.step === 'support') return _supportRowHtml(cid, student, f, handle, i);
    if (row.step === 'languageGoals') return _langRowHtml(cid, student, f, handle, i);
    if (row.step === 'closer') return _closingRowHtml(cid, handle, i);
    if (_isRequired(row.step, path))
      return _requiredRowHtml(
        cid,
        student,
        f,
        { key: row.step, label: rowLabel(row, path), text: row.text },
        path,
        i,
        handle,
      );
    var open = !!_wording && _wording.index === i;
    var low = row.step === 'grade' && _checksFor(f, rows).indexOf('low') >= 0;
    var typed = isTyped(row);
    var edited =
      !typed &&
      unit.some(function (r) {
        return r.edited;
      });
    // A sentence the teacher changed can go to their bank.
    var addBank =
      i >= 0 && window.PersonalBank && !row.classLine && !row.placeholder && edited
        ? `<button type="button" class="qn-own-add" data-action="tqSentences" data-do="ownAdd" data-row="${i}" title="Adds this sentence to your bank, for other students it fits.">Add to My Bank</button>`
        : '';
    // A sentence the teacher typed: Options (Add to My Bank, Remove From
    // Comment), the InsertRows mockup.
    var act = typed
      ? `<button type="button" class="qn-line-menu${open ? ' on' : ''}" data-action="tqSentences" data-do="options" data-row="${i}" aria-haspopup="menu" aria-expanded="${open}" title="Add this sentence to your bank, or remove it.">Options ▾</button>`
      : edited
        ? '<span class="qn-edited" title="You changed this sentence. Generate Comment keeps it.">Edited</span>' +
          addBank
        : row.step && row.s
          ? `<button type="button" class="qn-line-menu${open ? ' on' : ''}" data-action="tqSentences" data-do="wording" data-row="${i}" aria-haspopup="menu" aria-expanded="${open}" title="Shows other ways to say this sentence. Pick one to use it.">Other Wording ▾</button>`
          : addBank;
    var ownBox = _own && _own.where === 'row' && _own.index === i ? _ownBoxHtml(student) : '';
    var added = _justAdded(row);
    var tint = added ? ' added' : _isBestRow(row) ? ' best' : row.step === 'attendance' ? ' attendance' : '';
    var text = unit
      .map(function (r) {
        return r.text;
      })
      .join(' ');
    var thin = unit
      .map(function (r) {
        return _thinHtml(cid, student, r, i);
      })
      .join('');
    var source = _unitSource(unit, cid, student, f, ctx) + (added ? ' · added just now' : '');
    var pron = _pronounCheckFor(student, f);
    return `<div class="qn-req-row qn-srow${tint}${open ? ' has-menu' : ''}${low && !_isChecked(student.id, 'low') ? ' flag' : ''}"${_rowAttr(i)}>
      ${handle}<div class="qn-req-part"><span class="qn-req-label">${esc(rowLabel(row, path))}</span></div>
      <div class="qn-req-body"><span class="qn-req-text">${esc(text)}</span><span class="qn-req-source">${esc(source)}</span>${
        unit.some(function (r) {
          return pronounNote(r, pron);
        })
          ? `<span class="qn-pron-note" title="The student’s pronouns changed after you wrote this sentence. Check its pronouns.">Pronouns changed · <button type="button" class="qn-thin-link" data-action="tqSentences" data-do="pronounOk" data-row="${i}" title="Keeps this sentence as written and takes this note away.">Dismiss</button></span>`
          : ''
      }${thin}${ownBox}</div>
      ${act}
      ${low ? _checkHtml(student.id, 'low') : ''}
      ${open ? (typed ? _optionsMenuHtml(i) : _wordingMenuHtml(cid, student, ctx, rows, i)) : ''}
    </div>`;
  }

  /* ── Typed rows and adding between rows (the InsertRows mockup) ── */

  /* The row put in just now, tinted for a few seconds with "added just
     now" on its source line. */
  var ADDED_FOR = 5000;
  var _added = null; // { row, at }
  var _addedTimer = null;
  function _justAdded(row) {
    return !!_added && _added.row === row && Date.now() - _added.at < ADDED_FOR;
  }
  /* When the fade ends, the tint and "added just now" go from the row and
     the comment's mark, in place (no redraw, so an open menu or box
     stays). */
  function _markAdded(st, row) {
    _added = { row: row, at: Date.now() };
    clearTimeout(_addedTimer);
    _addedTimer = setTimeout(function () {
      _added = null;
      if (typeof document === 'undefined' || !document.querySelectorAll) return;
      document.querySelectorAll('#tq-sentences .qn-srow.added').forEach(function (el) {
        el.classList.remove('added');
        var src = el.querySelector('.qn-req-source');
        if (src) src.textContent = src.textContent.replace(/ · added just now$/, '');
      });
      _syncMarks();
    }, ADDED_FOR);
  }

  /* The Options menu of a Your Sentence row. */
  function _optionsMenuHtml(i) {
    var bank = window.PersonalBank
      ? `<button type="button" role="menuitem" class="qn-menu-item" data-action="tqSentences" data-do="ownAdd" data-row="${i}" title="Adds this sentence to your bank, for other students it fits."><span class="qn-menu-body"><span class="qn-menu-text">Add to My Bank</span><span class="qn-menu-meta">For other students it fits</span></span></button>`
      : '';
    return `<div class="qn-menu qn-options" role="menu" aria-label="Your sentence" id="tq-options-menu">
      <span class="qn-menu-head">Your Sentence</span>
      ${bank}
      <button type="button" role="menuitem" class="qn-menu-item" data-action="tqSentences" data-do="remove" data-row="${i}" title="Takes this sentence out of the comment. ⌘Z puts it back."><span class="qn-menu-body"><span class="qn-menu-text">Remove From Comment</span></span></button>
    </div>`;
  }

  /* The sentences the + menu offers at a gap: one for each part missing
     from the comment that has a sentence fitting the student, drafted
     around the comment's own sentences (CommentBank.draft with every row
     kept in its place), so the engine's rules hold: never a second grade
     sentence, a second next step or a second advising sentence, and a
     class line only when the class has one. A Required part (the grade on
     the IE and goals paths, the IE parts; the Deadline sentence comes
     only from picking a date) is never offered. Each: { step, part, label,
     id, s, classLine, text }. */
  function insertChoices(rows, ctx, opts) {
    opts = opts || {};
    var path = opts.path !== undefined ? opts.path : CommentBank.reportPath(ctx._f || {});
    var has = {};
    var kept = {};
    var order = [];
    rows.forEach(function (r) {
      if (!r.step) return;
      if (has[r.step]) return;
      has[r.step] = true;
      order.push(r.step);
      // Keyed by the bank sentence when it is one, so its facts count as
      // said; by the step otherwise.
      var byId = r.s && !r.edited && CommentBank.stepOf(r.s) === r.step;
      kept[byId ? r.id : r.step] = r.text;
    });
    var d = CommentBank.draft(ctx, {
      seed: opts.seed || 1,
      comments: opts.comments,
      exclude: opts.exclude,
      kept: kept,
      order: order,
      bank: opts.bank,
      quiet: true,
    });
    var out = [];
    PARTS.forEach(function (p) {
      if (
        p.steps.some(function (k) {
          return has[k];
        })
      )
        return;
      var at = (d.sentences || []).findIndex(function (x) {
        return !x.kept && !!x.step && p.steps.indexOf(x.step) >= 0;
      });
      if (at < 0) return;
      var x = d.sentences[at];
      if (_isRequired(x.step, path)) return;
      var s = x.classLine ? null : _bankById(x.id);
      if (!x.classLine && !s) return;
      out.push({ step: x.step, part: p.id, label: p.label, id: x.id, s: s, classLine: !!x.classLine, text: x.text });
    });
    return out;
  }
  /* A row for a choice, filled for the student. */
  function _choiceRow(c, ctx) {
    if (c.classLine) return _classRow(c.step, c.text);
    return rowFromSentence(c.s, ctx, c.step);
  }
  function _insertOpts(cid, st) {
    var termId = getTermId();
    var key = _rowKey(st);
    return {
      seed: _lastSeed[key] || CommentBank.seedFor(st.id + '|' + termId),
      comments: _classmateComments(cid, st.id, termId),
      exclude: lastTermIds(cid, st.id, termId),
    };
  }

  /* A choice put in at a gap: the row there with a brief tint, the
     sentence at the same place in the comment (the realiser moves the name
     to the first sentence), the count, the checks and Approve following
     (_writeRows), and the Options or Other Wording of the new row focused. */
  function _insertAt(st, g, step, id) {
    var f = _facts(st);
    var ctx = _bankContext(_activeCourse, st, f);
    var key = _rowKey(st);
    var rows = _rows[key] || _rowsFor(st, f);
    var c = insertChoices(rows, ctx, _insertOpts(_activeCourse, st)).find(function (x) {
      return x.id === id && (!step || x.step === step);
    });
    if (!c) {
      _addAt = null;
      _syncRequired();
      _focusGap(g);
      return;
    }
    var row = _choiceRow(c, ctx);
    _rows[key] = insertRow(rows, row, g);
    _markAdded(st, row);
    _addAt = null;
    _wording = null;
    _writeRows(st);
    _focusAny([
      '#tq-sentences [data-row="' + Math.min(g, _rows[key].length - 1) + '"] .qn-line-menu',
      '#tq-browse-btn',
    ]);
  }
  /* A sentence of the teacher's own, typed at a gap (Write Your Own…):
     a Your Sentence row there. Its Options menu offers Add to My Bank. */
  function _insertTyped(st, g, text) {
    var t = String(text || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t) return false;
    if (!/[.!?…]["”]?$/.test(t)) t += '.';
    var key = _rowKey(st);
    var rows = _rows[key] || _rowsFor(st, _facts(st));
    var row = typedRow(t);
    _rows[key] = insertRow(rows, row, g);
    _markAdded(st, row);
    _addAt = null;
    _wording = null;
    _writeRows(st);
    _focusSel('#tq-sentences [data-row="' + Math.min(g, _rows[key].length - 1) + '"] [data-do="options"]');
    return true;
  }

  /* The + menu at a gap. */
  var _addAt = null; // the gap (rows before it) whose menu is open
  function _addMenuHtml(cid, student, f, ctx, rows, g) {
    var first = _first(student);
    var items = insertChoices(rows, ctx, _insertOpts(cid, student))
      .map(function (c) {
        var row = _choiceRow(c, ctx);
        return `<button type="button" role="menuitem" class="qn-menu-item qn-add-item" data-action="tqSentences" data-do="insert" data-gap="${g}" data-step="${esc(c.step)}" data-sentence="${esc(c.id)}" title="Puts this sentence in the comment here."><span class="qn-add-part">${esc(c.label)}</span><span class="qn-menu-body"><span class="qn-menu-text">${esc(row.text)}</span><span class="qn-menu-meta">${esc(rowSource(row, cid, student, f, ctx))}</span></span></button>`;
      })
      .join('');
    var none = items
      ? ''
      : `<span class="qn-menu-meta qn-add-none">Every part with a sentence that fits ${esc(first)} is in the comment.</span>`;
    return `<div class="qn-menu qn-add-menu" role="menu" aria-label="Add a sentence here" id="tq-add-menu">
      <span class="qn-menu-head">Add Here</span>
      ${items}${none}
      <div class="qn-menu-sep" role="separator"></div>
      <button type="button" role="menuitem" class="qn-menu-add" data-action="tqSentences" data-do="ownOpen" data-where="gap" data-gap="${g}" title="Opens a line here for a sentence of your own. It goes into the comment at this place.">Write Your Own…</button>
      <button type="button" role="menuitem" class="qn-menu-add" data-action="tqSentences" data-do="browseAt" data-gap="${g}" title="Opens the full sentence bank. The sentence you pick goes here.">Browse Sentences…</button>
    </div>`;
  }
  /* The gap after a row: a thin line and a + on hover or focus, nothing
     in the flow (the rows do not move); the + opens the Add Here menu. */
  function _gapHtml(cid, student, f, ctx, rows, g) {
    var open = _addAt === g;
    return `<div class="qn-gap${open ? ' open' : ''}" data-gap="${g}">
      <span class="qn-gap-line" aria-hidden="true"></span>
      <button type="button" class="qn-gap-add" data-action="tqSentences" data-do="addMenu" data-gap="${g}" aria-label="Add a sentence here" aria-haspopup="menu" aria-expanded="${open}">+</button>
      <span class="qn-gap-tip" role="tooltip">Add a sentence here</span>
      ${open ? _addMenuHtml(cid, student, f, ctx, rows, g) : ''}
    </div>`;
  }
  /* The box for a sentence of the teacher's own at a gap, drawn as the
     row it will be. */
  function _gapOwnHtml(student) {
    return `<div class="qn-req-row qn-srow qn-own-row">
      ${SPACER}<div class="qn-req-part"><span class="qn-req-label">Your Sentence</span></div>
      <div class="qn-req-body">${_ownBoxHtml(student)}</div>
    </div>`;
  }

  /* The IE comment's parts in its order (the IEPath mockup): where a
     Required row the comment has no sentence for goes. */
  var IE_ORDER = [
    'grade',
    'ieProblem',
    'habits',
    'strongHabits',
    'attendance',
    'iePlan',
    'ieDeadline',
    'support',
    'ieMeeting',
    'closer',
  ];

  /* The rows in order (as units), with a class row (Not Handed In,
     Support, Language Goals, Closing) the comment has no sentence for where
     its step would fall; on the IE path the Support row sits before Meeting
     (the IEPath mockup), and each Required row the comment has no sentence
     for (a comment written without Generate) stays, with its "I checked
     this", where its sentence would go. */
  function _rowListHtml(cid, student, f, rows, path) {
    var ctx = _bankContext(cid, student, f);
    var claims = claimChanges(student);
    var ie = path === 'ie';
    var has = {};
    rows.forEach(function (r) {
      has[r.step] = true;
    });
    var items = _units(rows).map(function (u) {
      return { unit: u, i: rows.indexOf(u[0]) };
    });
    // An IE comment has no Deadline sentence until a date is picked: its
    // Required row stays, with Pick a Date, where the sentence will go.
    if (ie && !has.ieDeadline) {
      var at = deadlineAt(rows);
      var pos =
        at < rows.length
          ? items.findIndex(function (it) {
              return it.unit.indexOf(rows[at]) >= 0;
            })
          : -1;
      items.splice(pos < 0 ? items.length : pos, 0, {
        unit: [{ step: 'ieDeadline', placeholder: true, text: '' }],
        i: -1,
      });
    }
    if (ie)
      ['grade', 'ieProblem', 'iePlan', 'ieMeeting'].forEach(function (step) {
        if (has[step]) return;
        var si = IE_ORDER.indexOf(step);
        var next = items.findIndex(function (it) {
          return IE_ORDER.indexOf(it.unit[0].step) > si;
        });
        items.splice(next < 0 ? items.length : next, 0, {
          unit: [{ step: step, placeholder: true, text: '' }],
          i: -1,
        });
      });
    var extra = [];
    if (!ie && f.notHandedIn && f.notHandedIn.count > 0 && !has.notHandedIn) extra.push('notHandedIn');
    if (path === 'language_goals' && !has.languageGoals) extra.push('languageGoals');
    if (!has.support) extra.push('support');
    if (!has.closer) extra.push('closer');
    extra.forEach(function (step) {
      var si = _stepAt(step);
      // Closing last; on the IE path Support before Meeting; else before
      // the first row of a later step, or last.
      var pos =
        step === 'closer'
          ? -1
          : items.findIndex(function (it) {
              var lead = it.unit[0].step;
              if (ie && step === 'support') return lead === 'ieMeeting';
              return !!lead && _stepAt(lead) > si;
            });
      items.splice(pos < 0 ? items.length : pos, 0, { unit: [{ step: step, placeholder: true }], i: -1 });
    });
    // After each row of the comment, the gap where a sentence can be put in
    // (the InsertRows mockup): its index is how many rows come before it.
    return items
      .map(function (it) {
        var html = _rowHtml(cid, student, f, ctx, rows, it.unit, it.i, path);
        if (it.i < 0) return html;
        claims.forEach(function (c) {
          if (it.unit.indexOf(rows[c.row]) >= 0) html += _claimHtml(c);
        });
        var g = rows.indexOf(it.unit[it.unit.length - 1]) + 1;
        html += _gapHtml(cid, student, f, ctx, rows, g);
        if (_own && _own.where === 'gap' && _own.gap === g) html += _gapOwnHtml(student);
        return html;
      })
      .join('');
  }

  /* The Sentences card: one row per sentence of the comment, its part, its
     source line, a drag handle and Other Wording; Edited on a sentence the
     teacher changed; Reset Order once the teacher moved one; Browse
     Sentences… opens the bank. Before Generate has written anything, an IE
     or goals comment's Required rows and the class's rows (plan PR 8). */
  function _sentencesHtml(cid, student, f) {
    var path = CommentBank.reportPath(f);
    var key = _rowKey(student);
    var rows = _rowsFor(student, f);
    var ordered = !!_ordered[key];
    var hint = path
      ? path === 'ie'
        ? 'An IE comment needs every part marked Required.'
        : 'The grade sentence is replaced by the required statement.'
      : ordered
        ? 'Your order is kept when you generate again.'
        : 'Reword, edit or drag to reorder. The comment above follows.';
    var reset = ordered
      ? '<button type="button" class="qn-card-link qn-reset" data-action="tqSentences" data-do="reset" title="Puts the sentences back in the order Generate Comment gave them.">Reset Order</button>'
      : '';
    var browse =
      '<button type="button" class="qn-card-link" id="tq-browse-btn" data-action="tqSentences" data-do="browse" aria-haspopup="dialog" title="Opens the full sentence bank so you can pick a sentence yourself.">Browse Sentences…</button>';
    var body = rows.length
      ? _rowListHtml(cid, student, f, rows, path)
      : _requiredRows(cid, student, f) + _classRowsHtml(cid, student, f);
    return `<div class="qn-card qn-sentences${path ? ' qn-required' : ''}" id="tq-sentences">
      <div class="qn-req-top"><span class="qn-card-title">Sentences</span><span class="qn-sub">${esc(hint)}</span>${reset}${browse}</div>
      ${body}
    </div>`;
  }

  /* The card redrawn in place (a row moved, a menu opened, the calendar
     opened or moved a month). */
  function _syncRequired() {
    var st = _current();
    var card = document.getElementById('tq-sentences');
    if (!st || !card) return;
    card.outerHTML = _sentencesHtml(_activeCourse, st, _facts(st));
  }

  /* ── Browse Sentences ────────────────────────────────────── */

  var BROWSE_ID = 'tq-browse-overlay';
  var HEIGHT_KEY = 'fv-browse-sentences-height';
  var SHEET_DEFAULT = 420;
  var SHEET_MIN = 160;
  var _browse = null; // { part, fits, q, menu } while the sheet is open

  /* The list's height on this device, as last dragged; the mockup's
     until then. */
  function sheetHeight() {
    try {
      var v = Number(localStorage.getItem(HEIGHT_KEY));
      return v >= SHEET_MIN ? v : SHEET_DEFAULT;
    } catch (e) {
      return SHEET_DEFAULT;
    }
  }
  function _saveHeight(h) {
    try {
      localStorage.setItem(HEIGHT_KEY, String(Math.round(h)));
    } catch (e) {
      /* no storage: the height lasts for this sheet only */
    }
  }
  function _heightMax() {
    return Math.max(SHEET_MIN, (window.innerHeight || 900) - 300);
  }
  function _setHeight(h, save) {
    var list = document.getElementById('tq-browse-list');
    h = Math.max(SHEET_MIN, Math.min(_heightMax(), Math.round(h)));
    if (list) list.style.maxHeight = h + 'px';
    if (save) _saveHeight(h);
    return h;
  }

  /* A sentence's text for the student (named in a grade sentence, which
     comes first), missing facts shown as …, so a sentence that does not
     fit still reads. `over` fills slots for a case the student is not in
     (the letter and standing word of another grade): the sentence then
     reads as it would print for that case. */
  function _preview(s, ctx, over) {
    var first = { first: CommentBank.stepOf(s) === 'grade' };
    if (!over && CommentBank.fits(s, ctx)) return CommentBank.fill(s, ctx, first);
    var c = over ? Object.assign({}, ctx, over) : ctx;
    var own = Object.prototype.hasOwnProperty;
    var text = String(s.text).replace(/\{(\w+)\}/g, function (m, k) {
      if (/^(He|he|him|His|his|himself|name)$/.test(k) || (own.call(c, k) && c[k])) return m;
      return '…';
    });
    return CommentBank.fill(Object.assign({}, s, { text: text }), c, first);
  }

  /* ── Browse Sentences: the cases ─────────────────────────── */

  /* Within a part the sentences sit under headings that name the case
     each one is for, in a fixed order, the student's own case first
     (Colin, Nov 1: "the teacher must be able to select the appropriate
     comments if they don't see something reflective of the student"). A
     sentence's case is read from its taxonomy fields where the bank has
     them (standing, story, skill, habit, level, subjects) and derived from
     `when` and `needs` otherwise, so the grouping works on today's bank. A
     frame that serves several cases (a grade sentence with the letter as
     a slot) is listed under every case it serves, previewed for that case.
     Headings are plain words in Title Case: no competency codes, no
     pronouns. */
  var FAMILY_ORDER = ['socials', 'science', 'math', 'ela', 'arts', 'pe', 'adst', 'career', 'languages'];
  var FAMILY_NAMES = {
    socials: 'Social Studies',
    science: 'Science',
    math: 'Mathematics',
    ela: 'English Language Arts',
    arts: 'Arts Education',
    pe: 'Physical and Health Education',
    adst: 'Applied Design, Skills and Technologies',
    career: 'Career Education',
    languages: 'Languages',
  };
  var LEVEL_WORDS = { 4: 'Consistently', 3: 'Usually', 2: 'Sometimes', 1: 'Rarely' };
  // The letter grades by standing (the Letter Grades Order), and the next
  // letter up for the "close to" frames; A has none.
  var LETTERS = ['A', 'B', 'C+', 'C', 'C-'];
  var NEXT_LETTER = { B: 'A', 'C+': 'B', C: 'C+', 'C-': 'C' };
  var PROFICIENCY_WORDS = ['Extending', 'Proficient', 'Developing', 'Emerging'];
  // The stories a strengths sentence can be written for (CommentBank.ANGLES
  // ids); any other story reads as steady.
  var STORIES = [
    ['steady', 'Steady'],
    ['climb', 'Marks Climbed'],
    ['slide', 'Marks Slid'],
    ['split', 'Strong in One Skill'],
    ['hidden', 'Hidden by Missing Work'],
    ['newcomer', 'New to the Class'],
  ];
  var SUMMARY_CASES = [
    ['sum:excellent', 'Summary · Excellent'],
    ['sum:good', 'Summary · Good'],
    ['sum:one', 'Summary · One Habit to Build'],
    ['sum:two', 'Summary · Two Habits to Build'],
    ['sum:any', 'Summary'],
  ];
  var ATTENDANCE_CASES = [
    ['att:absent', 'Absences Only'],
    ['att:late', 'Lates Only'],
    ['att:both', 'Absences and Lates'],
  ];
  var MISSING_CASES = ['one', 'two', 'count', 'group'];

  function _titleCase(w) {
    return String(w || '').replace(/\b[a-z]/g, function (c) {
      return c.toUpperCase();
    });
  }
  /* A grade case from a standing: a letter (A to C-), a Letter Grades
     Order word or a proficiency word; '' when it is none of them. */
  function _standingCase(w) {
    var s = String(w || '').trim();
    if (CommentBank.STANDING[s]) s = CommentBank.STANDING[s];
    var low = s.toLowerCase();
    var letter = LETTERS.find(function (l) {
      return CommentBank.STANDING[l] === low;
    });
    if (letter) return 'w:' + letter;
    var pw = PROFICIENCY_WORDS.find(function (x) {
      return x.toLowerCase() === low;
    });
    return pw ? 'p:' + pw : '';
  }
  /* A habit rating as the stored scale, 1 Rarely to 4 Consistently, from a
     number or its word; 0 when it is neither. */
  function _levelNum(v) {
    var n = Number(v);
    if (n >= 1 && n <= 4) return n;
    var w = String(v || '').toLowerCase();
    var k = Object.keys(LEVEL_WORDS).find(function (x) {
      return LEVEL_WORDS[x].toLowerCase() === w;
    });
    return k ? Number(k) : 0;
  }
  function _storyCase(id) {
    return STORIES.some(function (x) {
      return x[0] === id;
    })
      ? id
      : 'steady';
  }
  function _familyOfSkill(key) {
    return (
      FAMILY_ORDER.find(function (fam) {
        return (CommentBank.SKILLS[fam] || []).some(function (r) {
          return r.key === key;
        });
      }) || ''
    );
  }

  /* The cases of a part, in their fixed order: [{ id, label }]. Support and
     Closing list the class's own lines and have no bank cases. */
  function browseCases(part) {
    var out = [];
    var add = function (id, label) {
      out.push({ id: id, label: label });
    };
    if (part === 'grade') {
      LETTERS.forEach(function (l) {
        add('w:' + l, _titleCase(CommentBank.STANDING[l]));
      });
      PROFICIENCY_WORDS.forEach(function (w) {
        add('p:' + w, w);
      });
      add('ie', 'Not Enough Evidence');
      add('languageGoals', 'Language Goals');
      add('iepGoals', 'IEP Goals');
    } else if (part === 'bestPiece') {
      add('note', 'With a Note');
      add('noNote', 'Without a Note');
    } else if (part === 'strengths') {
      STORIES.forEach(function (x) {
        add(x[0], x[1]);
      });
      // Even results (CommentBank.evenComps), by the overall proficiency
      // word the frame's verb is bound to (bank n5xx).
      PROFICIENCY_WORDS.forEach(function (w) {
        add('even:' + w, 'Even Results · ' + w);
      });
      // The student's own highest-marked skill (CommentBank.highestSkills),
      // by the competency's proficiency word (bank n1001-n1027).
      PROFICIENCY_WORDS.forEach(function (w) {
        add('high:' + w, 'Highest Marks · ' + w);
      });
      PROFICIENCY_WORDS.forEach(function (w) {
        add('st:' + w, w);
      });
      FAMILY_ORDER.forEach(function (fam) {
        // The strongest skill, under its kind of class (bank n6xx-n7xx).
        (CommentBank.SKILLS[fam] || []).forEach(function (r) {
          add('skill:' + fam + ':' + r.key, FAMILY_NAMES[fam] + ' · ' + r.name);
        });
        add('fam:' + fam, FAMILY_NAMES[fam]);
        PROFICIENCY_WORDS.forEach(function (w) {
          add('fam:' + fam + ':' + w, FAMILY_NAMES[fam] + ' · ' + w);
        });
      });
    } else if (part === 'habits') {
      // Every habit at every rating is its own case (Colin, Nov 1: "each
      // rating of each habit needs its own selection"), then the summary
      // sentences, the IE comment's strong habits, and attendance.
      CommentBank.HABITS.forEach(function (h) {
        [4, 3, 2, 1].forEach(function (l) {
          add('cell:' + h.key + ':' + l, h.name + ' · ' + LEVEL_WORDS[l]);
        });
      });
      SUMMARY_CASES.forEach(function (x) {
        add(x[0], x[1]);
      });
      add('strong', 'Strong Habits');
      ATTENDANCE_CASES.forEach(function (x) {
        add(x[0], x[1]);
      });
    } else if (part === 'notHandedIn') {
      add('one', 'One Title');
      add('two', 'Two Titles');
      add('count', 'A Count');
      add('group', 'A Count and a Group');
    } else if (part === 'nextStep') {
      FAMILY_ORDER.forEach(function (fam) {
        (CommentBank.SKILLS[fam] || []).forEach(function (r) {
          add('skill:' + fam + ':' + r.key, FAMILY_NAMES[fam] + ' · ' + r.name);
        });
        add('fam:' + fam, FAMILY_NAMES[fam]);
        (CommentBank.SKILLS[fam] || []).forEach(function (r) {
          add('home:' + fam + ':' + r.key, FAMILY_NAMES[fam] + ' · ' + r.name + ' · For the Family');
        });
        add('home:' + fam, FAMILY_NAMES[fam] + ' · For the Family');
      });
      add('any', 'Any Class');
      add('home:any', 'Any Class · For the Family');
    }
    add('other', 'Other');
    return out;
  }

  /* The cases a bank sentence is for, within a part: one, or every case a
     frame with a slot can serve. */
  function browseCase(part, s) {
    var when = s.when || {};
    var needs = s.needs || [];
    var has = function (k) {
      return needs.indexOf(k) >= 0;
    };
    var fam = s.subjects && s.subjects.length === 1 ? s.subjects[0] : '';
    var step = CommentBank.stepOf(s);
    if (part === 'grade') {
      if (s.standing) return [_standingCase(s.standing) || 'other'];
      var g = when.grade;
      if (g === 'letter')
        return LETTERS.slice(0, 4).map(function (l) {
          return 'w:' + l;
        });
      if (g === 'letterClose')
        return LETTERS.slice(1, 4).map(function (l) {
          return 'w:' + l;
        });
      if (g === 'cminus' || g === 'cminusClose') return ['w:C-'];
      if (g === 'proficiency')
        return PROFICIENCY_WORDS.map(function (w) {
          return 'p:' + w;
        });
      return /^(ie|languageGoals|iepGoals)$/.test(g || '') ? [g] : ['other'];
    }
    if (part === 'bestPiece') return has('bestNote') ? ['note'] : has('assignment') ? ['noNote'] : ['note', 'noNote'];
    if (part === 'strengths') {
      if (s.story) return [_storyCase(s.story)];
      var story = ['climb', 'slide', 'split', 'hidden', 'newcomer'].find(has);
      if (story) return [story];
      if (has('new')) return ['newcomer'];
      // A frame for the strongest skill, or for a strength among a tie at
      // the top (`when.topSkill`), under its kind of class; an even-results
      // frame under the word its verb is bound to.
      var skillKey = when.strongSkill || when.topSkill;
      if (skillKey) {
        var sf = fam || _familyOfSkill(skillKey);
        return [sf ? 'skill:' + sf + ':' + skillKey : 'other'];
      }
      if (when.evenWord) return ['even:' + when.evenWord];
      if (when.highestWord) return ['high:' + when.highestWord];
      if (fam) return ['fam:' + fam + (when.standing ? ':' + when.standing : '')];
      return [when.standing ? 'st:' + when.standing : 'steady'];
    }
    if (part === 'habits') {
      var habit = s.habit || '';
      var level = _levelNum(s.level);
      if (!habit) {
        var keys = Object.keys(when).filter(function (k) {
          return CommentBank.HABITS.some(function (h) {
            return h.key === k;
          });
        });
        if (keys.length === 1) {
          habit = keys[0];
          level = _levelNum(when[habit]);
        }
      }
      if (habit && level) return ['cell:' + habit + ':' + level];
      if (step === 'attendance' || s.group === 'Attendance') {
        if (has('absentOnly')) return ['att:absent'];
        if (has('lateOnly')) return ['att:late'];
        if (has('absentClasses') && has('lateTimes')) return ['att:both'];
        if (has('absentClasses')) return ['att:absent'];
        if (has('lateTimes')) return ['att:late'];
        return ATTENDANCE_CASES.map(function (x) {
          return x[0];
        });
      }
      if (step === 'strongHabits' || s.group === 'Strong Habits' || has('habitStrengths') || has('strongHabits'))
        return ['strong'];
      if (has('habitsExcellent')) return ['sum:excellent'];
      if (has('habitsGood')) return ['sum:good'];
      if (has('habitToBuild')) return ['sum:one'];
      if (has('habitsToBuild')) return ['sum:two'];
      return ['sum:any'];
    }
    if (part === 'notHandedIn') {
      if (has('missingTitle')) return ['one'];
      if (has('missingTitles')) return ['two'];
      if (has('missingGroup')) return ['group'];
      if (has('missingMany') || has('missingCount')) return ['count'];
      return MISSING_CASES.slice();
    }
    if (part === 'nextStep') {
      var key = s.skill || when.nextSkill || '';
      if (step === 'home' || s.group === 'For the Family') {
        var hf = fam || (key && _familyOfSkill(key)) || '';
        return ['home:' + (hf || 'any') + (key && hf ? ':' + key : '')];
      }
      if (key) {
        var sf = fam || _familyOfSkill(key);
        return [sf ? 'skill:' + sf + ':' + key : 'other'];
      }
      return [fam ? 'fam:' + fam : 'any'];
    }
    return ['other'];
  }

  /* The slot values that preview a frame for a case the student is not
     in: another letter's grade words, or a slot left blank (shown as …)
     for attendance or missing work the student does not have. null when
     the preview needs no change. */
  function _caseFill(part, id, s) {
    if (part === 'grade') {
      var m = /^w:(.+)$/.exec(id);
      if (m && LETTERS.indexOf(m[1]) >= 0) {
        var next = NEXT_LETTER[m[1]];
        return {
          gradeLetter: CommentBank.aOrAn(m[1]),
          gradeStanding: CommentBank.STANDING[m[1]],
          gradeNext: next ? CommentBank.aOrAn(next) : '',
        };
      }
      var p = /^p:(.+)$/.exec(id);
      return p ? { gradeWord: p[1] } : null;
    }
    var needs = s.needs || [];
    if (part === 'habits' && /^att:/.test(id) && needs.indexOf('attendance') >= 0) return { attendance: '' };
    if (part === 'notHandedIn' && needs.indexOf('missingWork') >= 0) return { missingWork: '' };
    return null;
  }

  /* The student's own cases in a part, the most specific first, from the
     facts the context was built on: the grade sentence's kind and standing,
     whether the best piece has a note, the term's story, standing and kind
     of class, each habit's rating, the attendance entered, how much work is
     not handed in, and the next step's skill. */
  function browseOwn(part, ctx) {
    var f = ctx._f || {};
    var out = [];
    var fam = ctx._family || '';
    if (part === 'grade') {
      var gr = CommentBank.gradeOf(f) || {};
      var k = gr.kind || '';
      if (gr.letter) out.push('w:' + gr.letter);
      else if (k === 'proficiency') out.push('p:' + gr.word);
      else if (k) out.push(k);
    } else if (part === 'bestPiece') {
      out.push(ctx._bestNote ? 'note' : 'noNote');
    } else if (part === 'strengths') {
      var story = 'steady';
      try {
        story = _storyCase(CommentBank.angle(f, ctx._picks || {}).id);
      } catch (e) {
        /* a context built by hand: the steady story */
      }
      // The strength's skill (the strongest, else one of a tie at the top),
      // else even results, else the highest-marked skill, come before the
      // story.
      if (fam && ctx._topSkill) out.push('skill:' + fam + ':' + ctx._topSkill);
      if (ctx._evenWord) out.push('even:' + ctx._evenWord);
      if (ctx._highestWord) out.push('high:' + ctx._highestWord);
      out.push(story);
      if (fam && f.standing) out.push('fam:' + fam + ':' + f.standing);
      if (fam) out.push('fam:' + fam);
      if (f.standing) out.push('st:' + f.standing);
    } else if (part === 'habits') {
      var h = ctx._habits || {};
      CommentBank.HABITS.forEach(function (x) {
        var v = Number(h[x.key]);
        if (v >= 1 && v <= 4) out.push('cell:' + x.key + ':' + v);
      });
      if (ctx.habitsExcellent) out.push('sum:excellent');
      else if (ctx.habitsGood) out.push('sum:good');
      else if (ctx.habitToBuild) out.push('sum:one');
      else if (ctx.habitsToBuild) out.push('sum:two');
      out.push('sum:any');
      if (ctx._path === 'ie') out.push('strong');
      var absent = Number(f.absent) > 0;
      var late = Number(f.late) > 0;
      if (absent && late) out.push('att:both');
      else if (absent) out.push('att:absent');
      else if (late) out.push('att:late');
    } else if (part === 'notHandedIn') {
      var nh = f.notHandedIn || {};
      var n = Number(nh.count) || 0;
      if (n === 1) out.push('one');
      else if (n === 2) out.push('two');
      else if (n > 2) {
        if ((nh.groups || []).length) out.push('group');
        out.push('count');
      }
    } else if (part === 'nextStep') {
      if (fam && ctx._nextSkill) out.push('skill:' + fam + ':' + ctx._nextSkill);
      if (fam) out.push('fam:' + fam);
      if (fam && ctx._nextSkill) out.push('home:' + fam + ':' + ctx._nextSkill);
      if (fam) out.push('home:' + fam);
      else out.push('any', 'home:any');
    }
    return out.filter(function (id, i, xs) {
      return !!id && xs.indexOf(id) === i;
    });
  }

  /* The bank's sentences for a part, the least used in the class first:
     [{ id, text, fits, used, mine, inUse, case }], one row per sentence and
     case (a frame that serves several cases has a row under each,
     previewed for that case; it fits only under the student's own), with
     how many sentences fit and how many there are, and the rows under
     their cases (groups: [{ id, label, own, rows }], the student's own
     cases first, then the fixed order; empty cases left out, except the
     habit cells, which stay so a teacher sees which have no sentences
     yet). opts: { fits: only those that fit, q: a search, usage, inUse: {
     id: true }, bank, own: the student's own case ids (browseOwn by
     default) }. */
  function browseList(part, ctx, opts) {
    opts = opts || {};
    var p = typeof part === 'string' ? PARTS.find(x => x.id === part) : part;
    var pid = p ? p.id : '';
    var bank = opts.bank || COMMENT_BANK;
    var usage = opts.usage || {};
    var inUse = opts.inUse || {};
    var q = String(opts.q || '')
      .trim()
      .toLowerCase();
    var all = bank.sentences.filter(function (s) {
      return !!p && p.steps.indexOf(CommentBank.stepOf(s)) >= 0;
    });
    var fit = all.filter(function (s) {
      return CommentBank.fits(s, ctx);
    });
    var cases = browseCases(pid);
    var known = function (id) {
      return cases.some(function (c) {
        return c.id === id;
      });
    };
    var own = (opts.own || browseOwn(pid, ctx)).filter(known);
    var rows = [];
    all.forEach(function (s, i) {
      var ids = browseCase(pid, s).map(function (c) {
        return known(c) ? c : 'other';
      });
      var fitsStudent = CommentBank.fits(s, ctx);
      ids.forEach(function (c) {
        // A frame under a case that is not the student's: previewed for
        // that case, and not one that fits.
        var elsewhere = ids.length > 1 && own.indexOf(c) < 0;
        var fits = fitsStudent && !elsewhere;
        if (opts.fits && !fits) return;
        rows.push({
          id: s.id,
          text: _preview(s, ctx, elsewhere ? _caseFill(pid, c, s) : null),
          fits: fits,
          used: usage[s.id] || 0,
          mine: !!s.mine,
          general: !!s.general,
          inUse: !!inUse[s.id] && !elsewhere,
          case: c,
          at: i,
        });
      });
    });
    rows = rows
      .filter(function (r) {
        return !q || r.text.toLowerCase().indexOf(q) >= 0;
      })
      .sort(function (a, b) {
        return a.used - b.used || a.at - b.at;
      });
    var ordered = own
      .map(function (id) {
        return cases.find(function (c) {
          return c.id === id;
        });
      })
      .concat(
        cases.filter(function (c) {
          return own.indexOf(c.id) < 0;
        }),
      );
    var groups = ordered
      .map(function (c) {
        return {
          id: c.id,
          label: c.label,
          own: own.indexOf(c.id) >= 0,
          rows: rows.filter(function (r) {
            return r.case === c.id;
          }),
        };
      })
      .filter(function (g) {
        if (g.rows.length) return true;
        // The habit cells stay, every one with Every sentence and the
        // student's rated ones with Fits, so an empty cell is seen.
        return pid === 'habits' && /^cell:/.test(g.id) && !q && (!opts.fits || g.own);
      });
    return { rows: rows, fit: fit.length, total: all.length, groups: groups, own: own };
  }

  /* Whether a case's group is open: the student's own cases open when a
     part is first shown, the rest closed; while a search is typed every
     group with a match opens, until it is closed by hand. */
  function _groupKey(part, id) {
    return part + '|' + id;
  }
  function _groupOpen(part, id) {
    var b = _browse;
    var k = _groupKey(part, id);
    if (b.q.trim()) return b.openQ[k] !== false;
    return !!b.open[k];
  }
  function _initGroups(part, own) {
    var b = _browse;
    if (b.init[part]) return;
    b.init[part] = true;
    own.forEach(function (id) {
      b.open[_groupKey(part, id)] = true;
    });
  }
  var CHEVRON =
    '<svg width="8" height="10" viewBox="0 0 8 10" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 1.5 L6 5 L2 8.5"></path></svg>';
  /* A case's heading and its rows: the heading opens and closes the
     group; the student's own case is marked with the first name. A case
     with no sentences yet says so. */
  function _groupHtml(part, id, label, own, first, rowsHtml, n, extra) {
    var isOpen = _groupOpen(part, id);
    var chip = own
      ? `<span class="qn-chip-own" title="${esc(first)}’s own case, from what FullVision has on file.">${esc(first)}</span>`
      : '';
    var body = (n ? rowsHtml : '<div class="qn-browse-none">No sentences yet.</div>') + (extra || '');
    return `<div class="qn-browse-group${own ? ' own' : ''}" data-case="${esc(id)}"><button type="button" class="qn-browse-head" aria-expanded="${isOpen}" data-action="tqSentences" data-do="group" data-case="${esc(id)}" title="${isOpen ? 'Hides' : 'Shows'} the sentences for this case.">${CHEVRON}<span class="qn-browse-head-label">${esc(label)}</span>${chip}<span class="qn-browse-head-n">${n}</span></button><div class="qn-browse-group-rows"${isOpen ? '' : ' hidden'}>${body}</div></div>`;
  }

  /* The rows for a part. Support lists the lines ticked for the class and
     Closing the class's sentence, as their rows on the card use them. */
  function _browseRowsHtml(cid, student, f, ctx) {
    var b = _browse;
    var first = _first(student);
    var course = _courseName(cid);
    var q = b.q.trim().toLowerCase();
    var match = function (t) {
      return !q || t.toLowerCase().indexOf(q) >= 0;
    };
    // yours: null, or { id, general } for a sentence of the teacher's own:
    // the Yours chip ("Yours · Any Case" when it is bound to no case) and
    // a × that removes it from their bank, with Undo.
    var row = function (text, meta, ctrl, on, yours) {
      var chip = yours
        ? `<span class="qn-chip-yours" title="${yours.general ? 'A sentence of your own for this part, with no case: Generate uses it when nothing more specific fits.' : 'A sentence of your own.'}">${yours.general ? 'Yours · Any Case' : 'Yours'}</span>`
        : '';
      var del = yours
        ? `<button type="button" class="qn-browse-del" data-action="tqSentences" data-do="ownDelete" data-sentence="${esc(yours.id)}" aria-label="Delete this sentence from your bank" title="Removes this sentence from your bank. Undo for a few seconds.">×</button>`
        : '';
      return `<div class="qn-browse-row${on ? ' on' : ''}" tabindex="-1"><div class="qn-browse-text"><span class="qn-browse-sentence">${esc(text)}</span><span class="qn-browse-meta">${esc(meta)}</span></div>${chip}${ctrl}${del}</div>`;
    };
    // "+ Write Your Own" under each case heading of a part a sentence of
    // the teacher's own can take, or the box once it is open there, bound
    // to that case.
    var addFor = function (caseId) {
      if (!_ownStep(b.part)) return '';
      if (_own && _own.where === 'browse' && _own.caseId === caseId)
        return `<div class="qn-browse-own">${_ownBoxHtml(student)}</div>`;
      return `<div class="qn-browse-addrow"><button type="button" class="qn-menu-add qn-browse-add" data-action="tqSentences" data-do="ownOpen" data-where="browse" data-mode="write" data-part="${esc(b.part)}" data-case="${esc(caseId)}" title="Write a sentence of your own for this case. It goes in your bank, marked Yours, and is offered here.">+ Write Your Own</button></div>`;
    };
    var inUse = '<span class="qn-browse-inuse">In Use</span>';
    var none = function (text) {
      return `<div class="qn-browse-empty">${esc(text)}</div>`;
    };
    var group = function (id, label, own, rowsHtml, n, extra) {
      return _groupHtml(b.part, id, label, own, first, rowsHtml, n, extra);
    };
    if (b.part === 'support') {
      // The class's ticked lines, under the class's name; the checklist is
      // managed from the Support Line menu on the Sentences card.
      var habits = _habitsOf(cid, student, f);
      var choice = CommentBank.supportChoice(f, habits);
      var lines = CommentBank.supportChecklist(cid, f.family).filter(function (l) {
        return l.on && match(l.text);
      });
      if (!lines.length)
        return none(
          q
            ? 'No support lines match “' + b.q.trim() + '”.'
            : 'No support lines are ticked for ' + course + '. Tick some under Support Line on the Sentences card.',
        );
      _initGroups(b.part, ['class']);
      var ticked = lines
        .map(function (l) {
          var on = !!choice && choice.line.id === l.id && !(f.classLines && f.classLines.pick === 'none');
          return row(
            l.text,
            on ? 'In use' : 'One of your support lines for ' + course,
            on
              ? inUse
              : `<button type="button" class="qn-browse-use" data-action="tqSentences" data-do="useLine" data-line="${esc(l.id)}" title="Uses this line in ${esc(first)}’s comment.">Use</button>`,
            on,
            null,
          );
        })
        .join('');
      return group('class', course, true, ticked, lines.length);
    }
    if (b.part === 'closing') {
      var closing = CommentBank.classSettings(cid).closing;
      if (!closing) return none('No closing sentence for ' + course + '. Add one in its row on the Sentences card.');
      if (!match(closing)) return none('No sentences match “' + b.q.trim() + '”.');
      _initGroups(b.part, ['class']);
      return group('class', course, true, row(closing, 'From your class settings', inUse, true, null), 1);
    }
    var rows = _rowsFor(student, f);
    var used = {};
    rows.forEach(function (r) {
      used[r.id] = true;
    });
    var list = browseList(b.part, ctx, { fits: b.fits, q: b.q, usage: _usage(cid, student), inUse: used });
    _initGroups(b.part, list.own);
    if (!list.rows.length)
      return none(
        q
          ? 'No sentences match “' + b.q.trim() + '”.'
          : b.fits
            ? 'No sentences here fit ' + first + '. Choose every sentence to see them all.'
            : 'No sentences for this part.',
      );
    var rowHtml = function (r) {
      var n = r.used;
      var meta = r.inUse ? 'In use' + (n ? ' · used for ' + _plural(n, 'classmate', 'classmates') : '') : _usedMeta(n);
      var ctrl = r.inUse
        ? inUse
        : `<button type="button" class="qn-browse-use" data-action="tqSentences" data-do="use" data-sentence="${esc(r.id)}"${r.fits ? '' : ' disabled'} title="${esc(
            !r.fits
              ? 'This sentence needs a fact FullVision does not have for ' + first + '.'
              : b.gap != null && _replacedBy(rows, _bankById(r.id) || {}) < 0
                ? 'Puts this sentence in ' + first + '’s comment, at the place you chose.'
                : 'Puts this sentence in ' + first + '’s comment.',
          )}">Use</button>`;
      return row(r.text, meta, ctrl, r.inUse, r.mine ? { id: r.id, general: r.general } : null);
    };
    return list.groups
      .map(function (g) {
        return group(g.id, g.label, g.own, g.rows.map(rowHtml).join(''), g.rows.length, addFor(g.id));
      })
      .join('');
  }

  var CHEVRONS =
    '<svg width="10" height="12" viewBox="0 0 10 12" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M2 4.5 L5 1.8 L8 4.5 M2 7.5 L5 10.2 L8 7.5"></path></svg>';

  /* The Fits pop-up: only the sentences that fit the student, or every
     sentence for the part, with the counts. */
  function _fitsHtml(student, ctx) {
    var b = _browse;
    var first = _first(student);
    var p = PARTS.find(function (x) {
      return x.id === b.part;
    });
    var list = browseList(p, ctx, {});
    // Support and Closing hold the class's own lines, all of which fit.
    if (b.part === 'support' || b.part === 'closing') {
      var f = ctx._f || {};
      var n =
        b.part === 'support'
          ? CommentBank.supportChecklist(_activeCourse, f.family).filter(function (l) {
              return l.on;
            }).length
          : CommentBank.classSettings(_activeCourse).closing
            ? 1
            : 0;
      list = { fit: n, total: n };
    }
    var count = b.fits ? list.fit + ' of ' + list.total : String(list.total);
    var opt = function (fits, label, n) {
      var on = b.fits === fits;
      return `<button type="button" role="option" aria-selected="${on}" class="qn-menu-item${on ? ' on' : ''}" data-action="tqSentences" data-do="fits" data-fits="${fits ? '1' : '0'}"><span class="qn-menu-mark" aria-hidden="true">${on ? '✓' : ''}</span><span class="qn-menu-body"><span class="qn-menu-text">${esc(label)}</span><span class="qn-menu-meta">${n}</span></span></button>`;
    };
    var menu = b.menu
      ? `<div class="qn-menu qn-fits-menu" role="listbox" aria-label="Which sentences to show" id="tq-fits-menu">${opt(true, 'Fits ' + first, list.fit)}${opt(false, 'Every sentence for this part', list.total)}</div>`
      : '';
    return `<span class="qn-browse-fitwrap"><button type="button" class="qn-browse-fits" id="tq-browse-fits" data-action="tqSentences" data-do="fitsMenu" aria-haspopup="listbox" aria-expanded="${b.menu}" title="Show only sentences that fit ${esc(first)}, or every sentence for this part.">${b.fits ? 'Fits ' + esc(first) : 'Every sentence'} <span class="qn-browse-n" id="tq-browse-n">${count}</span>${CHEVRONS}</button>${menu}</span>`;
  }

  function _browseHtml(cid, student, f) {
    var b = _browse;
    var first = _first(student);
    var ctx = _bankContext(cid, student, f);
    var tabs = PARTS.map(function (p) {
      var on = p.id === b.part;
      return `<button type="button" role="tab" class="qn-browse-tab" aria-selected="${on}" data-action="tqSentences" data-do="part" data-part="${p.id}" title="${esc(p.label)} sentences.">${esc(p.label)}</button>`;
    }).join('');
    return `<div class="qn-browse" role="document">
      <div class="qn-browse-top">
        <span class="qn-browse-title" id="tq-browse-title">Sentences for ${esc(first)}</span>
        <input type="search" class="qn-browse-search" id="tq-browse-search" placeholder="Search sentences" aria-label="Search sentences" value="${esc(b.q)}" title="Finds sentences with these words in this part.">
        <button type="button" class="qn-browse-done" data-action="tqSentences" data-do="close" title="Closes Browse Sentences.">Done</button>
      </div>
      <div class="qn-browse-body">
        <div class="qn-browse-parts" role="tablist" aria-label="Part">${tabs}</div>
        <div class="qn-browse-bar">${_fitsHtml(student, ctx)}<button type="button" class="qn-browse-add-top" data-action="tqSentences" data-do="ownOpen" data-where="top" data-mode="write" title="Write a sentence of your own and choose the part it belongs under.">+ Add to My Bank</button><span class="qn-browse-order">Least used first</span></div>
        ${_own && _own.where === 'top' ? `<div class="qn-browse-ownwrap">${_ownBoxHtml(student)}</div>` : ''}
        <div class="qn-browse-listwrap"><div class="qn-browse-list" id="tq-browse-list" style="max-height:${sheetHeight()}px">${_browseRowsHtml(cid, student, f, ctx)}</div></div>
        <span class="qn-browse-hint">The list scrolls. Drag the bottom edge to show more at once.</span>
      </div>
      <div class="qn-browse-handle" id="tq-browse-handle" role="separator" aria-orientation="horizontal" aria-label="Resize the sentence list" tabindex="0" title="Drag to make the sheet taller or shorter. It stays that size next time."><span class="qn-browse-grip"></span></div>
    </div>`;
  }

  function browseOpen() {
    return !!_browse && !!document.getElementById(BROWSE_ID);
  }

  /* The sheet, over the page, on a part. From a gap's + menu (gap: the
     rows before it), Use puts the sentence in at that gap instead of in
     the row of its step; each pick goes after the one before. */
  function _openBrowse(part, gap) {
    var st = _current();
    if (!st) return;
    tqSaveCurrentIfNeeded();
    _closeBrowse(true);
    _wording = null;
    _addAt = null;
    // open: the groups opened by hand per part and case; openQ: the same
    // while a search is typed; init: the parts whose own cases were opened.
    _browse = {
      part: part || 'grade',
      fits: true,
      q: '',
      menu: false,
      open: {},
      openQ: {},
      init: {},
      gap: gap == null ? null : Number(gap),
    };
    var overlay = document.createElement('div');
    overlay.id = BROWSE_ID;
    overlay.className = 'confirm-overlay qn-info-overlay qn-browse-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'tq-browse-title');
    overlay.innerHTML = _browseHtml(_activeCourse, st, _facts(st));
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) _closeBrowse();
    });
    // The bottom edge drags the list taller or shorter.
    overlay.addEventListener('pointerdown', function (e) {
      var h = e.target && e.target.closest && e.target.closest('#tq-browse-handle');
      var list = document.getElementById('tq-browse-list');
      if (!h || !list) return;
      e.preventDefault();
      var y0 = e.clientY;
      var h0 = parseFloat(list.style.maxHeight) || sheetHeight();
      var last = h0;
      var move = function (ev) {
        last = _setHeight(h0 + (ev.clientY - y0), false);
      };
      var up = function () {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        _saveHeight(last);
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    document.body.appendChild(overlay);
    _syncRequired();
    var search = document.getElementById('tq-browse-search');
    if (search) search.focus();
  }
  function _closeBrowse(quiet) {
    var o = document.getElementById(BROWSE_ID);
    var gap = _browse ? _browse.gap : null;
    _browse = null;
    if (!o) return;
    o.remove();
    if (quiet) return;
    if (gap != null) _focusGap(gap);
    else _focusSel('#tq-browse-btn');
  }
  function _focusGap(g) {
    _focusSel('#tq-sentences .qn-gap[data-gap="' + g + '"] .qn-gap-add');
  }
  /* The sheet redrawn for a new part, filter or comment. */
  function _syncBrowse(focusId) {
    var st = _current();
    var o = document.getElementById(BROWSE_ID);
    if (!st || !o || !_browse) return;
    o.innerHTML = _browseHtml(_activeCourse, st, _facts(st));
    var el = focusId && document.getElementById(focusId);
    if (el) el.focus();
  }
  /* Only the list and the count, so the search box keeps its cursor. */
  function _syncBrowseList() {
    var st = _current();
    var list = document.getElementById('tq-browse-list');
    if (!st || !list || !_browse) return;
    var f = _facts(st);
    list.innerHTML = _browseRowsHtml(_activeCourse, st, f, _bankContext(_activeCourse, st, f));
  }

  /* Use: the sentence in the row of its step, or a new row where its step
     falls. */
  function useSentence(rows, s, ctx) {
    var step = CommentBank.stepOf(s);
    if (!step) return rows;
    var row = rowFromSentence(s, ctx, step);
    var out = rows.slice();
    var at = out.findIndex(function (r) {
      return r.step === step;
    });
    if (at >= 0) {
      out[at] = row;
      return out;
    }
    var si = _stepAt(step);
    var pos = 0;
    out.forEach(function (r, i) {
      if (r.step && _stepAt(r.step) <= si) pos = i + 1;
    });
    out.splice(pos, 0, row);
    return out;
  }
  /* The row a bank sentence picked at a gap replaces, or -1 to put it in
     there: the row of the same step (one grade sentence, one next step, one
     Not Handed In), or, for an advising sentence, the comment's advising
     row (one next step a comment, the engine's rule). */
  function _replacedBy(rows, s) {
    var step = CommentBank.stepOf(s);
    var at = rows.findIndex(function (r) {
      return !!step && r.step === step;
    });
    if (at >= 0) return at;
    if (!CommentBank.advises(s)) return -1;
    return rows.findIndex(function (r) {
      return !!r.s && CommentBank.advises(r.s);
    });
  }
  /* The part Browse Sentences opens on from a gap: the first that can be
     put in there, else the first the comment has no row for, else Grade. */
  function _gapPart(rows, ctx, opts) {
    var missing = insertChoices(rows, ctx, opts);
    if (missing.length) return missing[0].part;
    var p = PARTS.find(function (x) {
      return !rows.some(function (r) {
        return !!r.step && x.steps.indexOf(r.step) >= 0;
      });
    });
    return p ? p.id : 'grade';
  }
  function _useSentence(st, id) {
    var s = _bankById(id);
    var f = _facts(st);
    var ctx = _bankContext(_activeCourse, st, f);
    if (!s || !CommentBank.fits(s, ctx)) return;
    var key = _rowKey(st);
    var rows = _rowsFor(st, f);
    var at = _browse && _browse.gap != null ? _replacedBy(rows, s) : -1;
    if (_browse && _browse.gap != null && at < 0) {
      var row = rowFromSentence(s, ctx, CommentBank.stepOf(s));
      _rows[key] = insertRow(rows, row, _browse.gap);
      _markAdded(st, row);
      _browse.gap++;
    } else if (at >= 0) {
      // From a gap, a part the comment has once only (its step, or an
      // advising sentence) takes the place of that row, never a second
      // time; the gap stays for the next pick.
      var next = rows.slice();
      next[at] = rowFromSentence(s, ctx, rows[at].step, at === 0);
      _rows[key] = next;
    } else _rows[key] = useSentence(rows, s, ctx);
    _writeRows(st);
    _syncBrowse();
    _focusSel('#tq-browse-list .qn-browse-row.on');
  }

  /* The Sentences card's and Browse Sentences' controls:
     data-action="tqSentences" with data-do. */
  function tqSentences(what, el) {
    var st = _current();
    if (!st || _resync(st)) return;
    var ds = (el && el.dataset) || {};
    var key = _rowKey(st);
    var i = Number(ds.row);
    switch (what) {
      case 'pronounOk': {
        tqSaveCurrentIfNeeded();
        var unitAt = _units(_rows[key] || []).find(function (u) {
          return u[0] === (_rows[key] || [])[i];
        });
        if (!unitAt) return;
        _pronounOk(st, unitAt);
        _syncRequired();
        return;
      }
      case 'wording':
      case 'options': {
        var open = !!_wording && _wording.index === i;
        _wording = open ? null : { index: i };
        _addAt = null;
        _supportMenu = false;
        _langMenu = false;
        _limitOpen = false;
        _syncRequired();
        if (!open)
          _focusSel(what === 'options' ? '#tq-options-menu .qn-menu-item' : '#tq-wording-menu .qn-menu-item.on');
        else _focusSel('#tq-sentences [data-row="' + i + '"] [data-do="' + what + '"]');
        return;
      }
      case 'remove': {
        tqSaveCurrentIfNeeded();
        var gone = (_rows[key] || [])[i];
        if (!gone) return;
        _rows[key] = (_rows[key] || []).filter(function (r) {
          return r !== gone;
        });
        _wording = null;
        _writeRows(st);
        _focusAny([
          '#tq-sentences [data-row="' + Math.min(i, _rows[key].length - 1) + '"] .qn-srow-handle[tabindex]',
          '#tq-browse-btn',
        ]);
        return;
      }
      case 'addMenu': {
        var g = Number(ds.gap);
        var was = _addAt === g;
        _addAt = was ? null : g;
        _wording = null;
        _supportMenu = false;
        _langMenu = false;
        _limitOpen = false;
        _syncRequired();
        if (!was) _focusSel('#tq-add-menu [role="menuitem"]');
        else _focusGap(g);
        return;
      }
      case 'insert': {
        tqSaveCurrentIfNeeded();
        _insertAt(st, Number(ds.gap), ds.step, ds.sentence);
        return;
      }
      case 'browseAt': {
        var at = Number(ds.gap);
        var rowsNow = _rows[key] || [];
        _openBrowse(_gapPart(rowsNow, _bankContext(_activeCourse, st, _facts(st)), _insertOpts(_activeCourse, st)), at);
        return;
      }
      case 'pick':
        tqSaveCurrentIfNeeded();
        _pickWording(st, i, ds.sentence);
        return;
      case 'all': {
        var row = (_rows[key] || [])[i];
        var p = row && row.step ? partOf(row.step) : null;
        _openBrowse(p ? p.id : 'grade');
        return;
      }
      case 'browse':
        _openBrowse('grade');
        return;
      case 'close':
        _closeBrowse();
        return;
      case 'reset':
        tqSaveCurrentIfNeeded();
        _resetOrder();
        return;
      case 'part':
        if (!_browse) return;
        _browse.part = PARTS.some(function (p) {
          return p.id === ds.part;
        })
          ? ds.part
          : 'grade';
        _browse.menu = false;
        _syncBrowse();
        _focusSel('#tq-browse-overlay [role="tab"][aria-selected="true"]');
        return;
      case 'fitsMenu':
        if (!_browse) return;
        _browse.menu = !_browse.menu;
        _syncBrowse(_browse.menu ? null : 'tq-browse-fits');
        if (_browse.menu) _focusSel('#tq-fits-menu [aria-selected="true"]');
        return;
      case 'fits':
        if (!_browse) return;
        _browse.fits = ds.fits === '1';
        _browse.menu = false;
        _syncBrowse('tq-browse-fits');
        return;
      case 'search':
        if (!_browse) return;
        _browse.q = String(el.value || '');
        _browse.openQ = {};
        _syncBrowseList();
        return;
      case 'group': {
        if (!_browse) return;
        var gid = String(ds.case || '');
        var map = _browse.q.trim() ? _browse.openQ : _browse.open;
        map[_groupKey(_browse.part, gid)] = !_groupOpen(_browse.part, gid);
        _syncBrowseList();
        _focusSel('#tq-browse-list .qn-browse-head[data-case="' + gid + '"]');
        return;
      }
      case 'use':
        tqSaveCurrentIfNeeded();
        _useSentence(st, ds.sentence);
        return;
      case 'useLine':
        tqLine('pickSupport', { dataset: { line: ds.line } });
        _syncBrowse();
        _focusSel('#tq-browse-list .qn-browse-row.on');
        return;
      case 'up':
        _moveRow(i, -1);
        return;
      case 'down':
        _moveRow(i, 1);
        return;
      case 'ownOpen':
        _ownOpen(ds.where, ds.mode || 'write', {
          index: i,
          part: ds.part || '',
          caseId: ds.case || '',
          gap: ds.gap,
        });
        return;
      case 'ownAdd': {
        var own = (_rows[key] || [])[i];
        _ownOpen('row', 'add', { index: i, text: own ? own.text : '' });
        return;
      }
      case 'ownFromBox': {
        var at = Number(ds.row);
        var sel = (_rows[key] || [])[at];
        if (!(at >= 0) || !sel) return;
        _ownOpen('row', 'add', { index: at, text: sel.text });
        return;
      }
      case 'ownInput':
        if (!_own) return;
        _own.text = String(el.value || '');
        _ownSync(st);
        return;
      case 'ownBind':
        if (!_own) return;
        if (ds.tqOwn === 'part') {
          _own.part = String(el.value || '');
          _own.caseKey = '';
          _ownRedraw(st, 'tq-own-part');
        } else {
          _own.caseKey = String(el.value || '');
          _ownSync(st);
        }
        return;
      case 'ownCancel':
        _ownCancel();
        return;
      case 'ownSave':
        _ownSave();
        return;
      case 'ownDelete':
        _ownDelete(ds.sentence);
        return;
    }
  }

  /* ── A sentence of the teacher's own (Colin, Nov 1) ──────────
     "Can teachers just write their own and add to a bank easily?" One
     line, written for the student on screen, into the teacher's bank
     (PersonalBank.compose and keep) from four places: "+ Write Your Own"
     at the end of a part in Browse Sentences and as the last item of a
     row's Other Wording menu (bound to that row's case and used in the
     row); "+ Add to My Bank" at the top of Browse Sentences; and "Add to
     My Bank" on a sentence the teacher typed or changed (its row on the
     Sentences card, or the sentence selected in the comment box). A
     sentence with no row's case takes a "Belongs Under" picker: the part,
     and a case or Any Case. The box shows the slotted result in plain
     words ("Saved as: …") and the lint's advice in orange; only a health
     or designation word or a classmate's name stops the save. */
  var _own = null; // { where: 'browse' | 'top' | 'row', mode: 'write' | 'add', index, text, part, caseId, caseKey }

  /* The parts a sentence of the teacher's own can take, and a part's
     first such step. */
  function _ownParts() {
    return PARTS.filter(function (p) {
      return !!_ownStep(p.id);
    });
  }
  function _ownStep(partId) {
    var p = PARTS.find(function (x) {
      return x.id === partId;
    });
    if (!p || !window.PersonalBank) return null;
    return (
      p.steps.find(function (k) {
        return PersonalBank.stepAllowed(k);
      }) || null
    );
  }
  function _ownRow(st) {
    if (!_own || _own.where !== 'row') return null;
    return (_rows[_rowKey(st)] || [])[_own.index] || null;
  }
  /* Whether the open box is bound already (no picker): to its row's case,
     or to the case heading it was opened under in Browse Sentences. */
  function _ownBound(st) {
    if (_own && _own.where === 'browse' && _own.caseId) return true;
    var r = _ownRow(st);
    return !!r && !!r.step && !!r.s && PersonalBank.stepAllowed(r.step);
  }
  /* The facts a case needs, beyond the slots a sentence names. */
  var CASE_NEEDS = [
    'habitsExcellent',
    'habitsGood',
    'habitToBuild',
    'habitsToBuild',
    'missingWork',
    'missingTitle',
    'missingTitles',
    'missingGroup',
    'missingMany',
    'missingCount',
    'climb',
    'slide',
    'split',
    'hidden',
    'newcomer',
    'new',
    'bestNote',
    'assignment',
    'absentOnly',
    'lateOnly',
    'absentClasses',
    'lateTimes',
    'attendance',
  ];
  /* What a case heading binds a sentence to: a habit cell or summary by
     its id; any other case by the shared sentence written for it (its
     `when`, the facts it needs, its group and step); a case with no
     sentence yet, or one with no condition, binds to the part alone. */
  function _ownCaseBind(part, id, ctx) {
    var p = PARTS.find(function (x) {
      return x.id === part;
    });
    var step = _ownStep(part);
    if (!p || !step) return null;
    var m = /^cell:(\w+):([1-4])$/.exec(id || '');
    if (m) {
      var when = {};
      when[m[1]] = Number(m[2]);
      return { step: 'habits', when: when, group: 'Work Habits' };
    }
    var sum = {
      'sum:excellent': 'habitsExcellent',
      'sum:good': 'habitsGood',
      'sum:one': 'habitToBuild',
      'sum:two': 'habitsToBuild',
    }[id];
    if (sum) return { step: 'habits', needs: [sum], group: 'Work Habits' };
    var ok = COMMENT_BANK.sentences.filter(function (x) {
      var st = CommentBank.stepOf(x);
      return (
        !x.mine && p.steps.indexOf(st) >= 0 && PersonalBank.stepAllowed(st) && browseCase(part, x).indexOf(id) >= 0
      );
    });
    var one = ok.filter(function (x) {
      return browseCase(part, x).length === 1;
    });
    var pool = one.length ? one : ok;
    var s =
      pool.find(function (x) {
        return CommentBank.fits(x, ctx);
      }) || pool[0];
    if (!s) return { step: step };
    var needs = (s.needs || []).filter(function (k) {
      return CASE_NEEDS.indexOf(k) >= 0;
    });
    return { step: CommentBank.stepOf(s), when: Object.assign({}, s.when || {}), needs: needs, group: s.group };
  }
  function _ownGeneral(bind) {
    return !bind || (!Object.keys(bind.when || {}).length && !(bind.needs || []).length);
  }
  /* The cases the "Belongs under" picker offers: the student's own cases
     of the part, as the sheet's headings name them, each one that binds
     to something. */
  function _ownCases(ctx) {
    var part = _own.part;
    var labels = {};
    browseCases(part).forEach(function (c) {
      labels[c.id] = c.label;
    });
    return browseOwn(part, ctx)
      .filter(function (id) {
        return !!labels[id] && !_ownGeneral(_ownCaseBind(part, id, ctx));
      })
      .map(function (id) {
        return { key: id, label: labels[id] };
      });
  }
  function _ownBind(st, ctx) {
    if (_own.where === 'browse' && _own.caseId)
      return _ownCaseBind(_own.part, _own.caseId, ctx) || { step: _ownStep(_own.part) };
    if (_ownBound(st)) return { row: _ownRow(st) };
    if (_own.caseKey) return _ownCaseBind(_own.part, _own.caseKey, ctx) || { step: _ownStep(_own.part) };
    return { step: _ownStep(_own.part) };
  }
  /* Classmates' names, so a sentence naming one is not saved. */
  function _othersOf(st) {
    var others = [];
    getStudents(_activeCourse).forEach(function (s) {
      if (s.id === st.id) return;
      _namesOf(s).forEach(function (n) {
        if (others.indexOf(n) < 0) others.push(n);
      });
    });
    return others;
  }
  function _ownCompose(st) {
    if (!_own || !window.PersonalBank) return null;
    var f = _facts(st);
    var ctx = _bankContext(_activeCourse, st, f);
    var bind = _ownBind(st, ctx);
    if (!bind.row && !bind.step) return null;
    return PersonalBank.compose(_own.text, bind, ctx, f, st, { others: _othersOf(st) });
  }
  /* What the box shows under the line: the sentence as it will be saved,
     when it is offered, and any advice. */
  function _ownOutHtml(c) {
    if (!c || !c.template) return '';
    var out = `<span class="qn-own-saved">Saved as: ${esc(c.preview)}</span><span class="qn-own-offered">${esc(c.offered)}</span>`;
    if (c.blocked) return out + `<span class="qn-own-why">${esc(c.blocked)}</span>`;
    return (
      out +
      c.advice
        .map(function (a) {
          return `<span class="qn-own-why">${esc(a)}</span>`;
        })
        .join('')
    );
  }
  function _ownBoxHtml(st) {
    var o = _own;
    var first = _first(st);
    if (o.where === 'gap') {
      // At a gap: the sentence goes into the comment there, not the bank.
      return `<div class="qn-own qn-own-gap" id="tq-own" role="group" aria-label="A sentence of your own">
      <input type="text" class="qn-line-input" id="tq-own-input" value="${esc(o.text)}" autocomplete="off" aria-label="A sentence of your own for ${esc(first)}" title="One sentence in plain words about ${esc(first)}. It goes into the comment here.">
      <span class="qn-own-hint">One sentence for this student. Its row’s Options menu can add it to your bank.</span>
      <div class="qn-line-actions"><button type="button" class="qn-line-cancel" data-action="tqSentences" data-do="ownCancel" title="Closes without adding anything.">Cancel</button><button type="button" class="qn-line-save" id="tq-own-save" data-action="tqSentences" data-do="ownSave"${o.text.trim() ? '' : ' disabled'} title="Puts this sentence in the comment here.">Add Here</button></div>
    </div>`;
    }
    var c = _ownCompose(st);
    var picker = '';
    if (!_ownBound(st)) {
      var ctx = _bankContext(_activeCourse, st, _facts(st));
      var parts = _ownParts()
        .map(function (p) {
          return `<option value="${esc(p.id)}"${p.id === o.part ? ' selected' : ''}>${esc(p.label)}</option>`;
        })
        .join('');
      var cases = _ownCases(ctx)
        .map(function (x) {
          return `<option value="${esc(x.key)}"${x.key === o.caseKey ? ' selected' : ''}>${esc(x.label)}</option>`;
        })
        .join('');
      picker = `<div class="qn-own-under"><span class="qn-own-label">Belongs Under</span><select class="qn-own-select" id="tq-own-part" data-tq-own="part" aria-label="The part of the comment this sentence belongs under" title="The part of the comment this sentence belongs under.">${parts}</select><select class="qn-own-select" id="tq-own-case" data-tq-own="case" aria-label="The case this sentence is for" title="When Generate may use it: a case that is true for ${esc(first)} now, or any case."><option value=""${o.caseKey ? '' : ' selected'}>Any Case</option>${cases}</select></div>`;
    }
    var ok = !!c && !!c.template && !c.blocked;
    return `<div class="qn-own" id="tq-own" role="group" aria-label="A sentence of your own">
      <input type="text" class="qn-line-input" id="tq-own-input" value="${esc(o.text)}" autocomplete="off" aria-label="A sentence of your own for ${esc(first)}" title="One sentence in plain words about ${esc(first)}.">
      <span class="qn-own-hint">Write it for this student; FullVision turns the name and pronouns into slots.</span>
      ${picker}
      <div class="qn-own-out" id="tq-own-out">${_ownOutHtml(c)}</div>
      <div class="qn-line-actions"><button type="button" class="qn-line-cancel" data-action="tqSentences" data-do="ownCancel" title="Closes without saving.">Cancel</button><button type="button" class="qn-line-save" id="tq-own-save" data-action="tqSentences" data-do="ownSave"${ok ? '' : ' disabled'} title="Adds this sentence to your bank.">Save</button></div>
    </div>`;
  }
  /* The preview and advice follow typing in place, so the line keeps its
     cursor. */
  function _ownSync(st) {
    var out = document.getElementById('tq-own-out');
    var save = document.getElementById('tq-own-save');
    if (_own && _own.where === 'gap') {
      if (save) save.disabled = !_own.text.trim();
      return;
    }
    if (!out || !_own) return;
    var c = _ownCompose(st);
    out.innerHTML = _ownOutHtml(c);
    if (save) save.disabled = !(c && c.template && !c.blocked);
  }
  /* The box drawn again (the part changed, so the cases change). */
  function _ownRedraw(st, focusId) {
    var box = document.getElementById('tq-own');
    if (!box || !_own) return;
    box.outerHTML = _ownBoxHtml(st);
    var el = focusId && document.getElementById(focusId);
    if (el) el.focus();
  }
  function _ownFocus() {
    var input = document.getElementById('tq-own-input');
    if (!input) return;
    input.focus();
    var n = input.value.length;
    try {
      input.setSelectionRange(n, n);
    } catch (e) {
      /* not a text field */
    }
    if (input.scrollIntoView) input.scrollIntoView({ block: 'nearest' });
  }
  /* Open the box: where (browse: the end of the part's list; top: under
     the sheet's bar; row: under a row of the Sentences card), mode
     (write: a new sentence, used in the row when opened from Other
     Wording; add: the row's own text), opts { index, text, part }. */
  function _ownOpen(where, mode, opts) {
    var st = _current();
    opts = opts || {};
    if (!st || (where !== 'gap' && !window.PersonalBank)) return;
    tqSaveCurrentIfNeeded();
    _wording = null;
    _addAt = null;
    _supportMenu = false;
    _limitOpen = false;
    if (_browse) _browse.menu = false;
    if (where === 'gap') {
      _own = {
        where: 'gap',
        mode: 'write',
        gap: Number(opts.gap) || 0,
        text: '',
        part: '',
        caseId: '',
        caseKey: '',
        key: _rowKey(st),
      };
      _syncRequired();
      _ownFocus();
      return;
    }
    var part = opts.part || '';
    var index = Number(opts.index);
    if (where === 'row' && !part) {
      var r = (_rows[_rowKey(st)] || [])[index];
      var p = r && r.step ? partOf(r.step) : null;
      part = p && _ownStep(p.id) ? p.id : '';
    }
    // The sheet's top button starts on the part that is open.
    if (where === 'top' && !part && _browse && _ownStep(_browse.part)) part = _browse.part;
    if (where === 'browse' && !_ownStep(part)) part = '';
    if (!part) part = (_ownParts()[0] || {}).id || '';
    _own = {
      where: where,
      mode: mode,
      index: index,
      text: String(opts.text || ''),
      part: part,
      caseId: where === 'browse' ? String(opts.caseId || '') : '',
      caseKey: '',
      key: _rowKey(st),
    };
    if (where === 'row') _syncRequired();
    else _syncBrowse();
    _ownFocus();
  }
  function _ownCancel() {
    var was = _own;
    _own = null;
    if (!was) return;
    if (was.where === 'gap') {
      _syncRequired();
      _focusGap(was.gap);
      return;
    }
    if (was.where === 'row') {
      _syncRequired();
      _focusSel(
        '#tq-sentences [data-row="' +
          was.index +
          '"] [data-do="wording"], #tq-sentences [data-row="' +
          was.index +
          '"] .qn-own-add',
      );
    } else {
      _syncBrowse();
      _focusSel(
        was.where === 'top' ? '.qn-browse-add-top' : '.qn-browse-add[data-case="' + was.caseId + '"], .qn-browse-add',
      );
    }
  }
  /* Save: into the bank now (and to the server through the outbox); from
     Other Wording, into the row as well. In Browse Sentences the sheet
     shows it under its part, marked Yours. */
  function _ownSave() {
    var st = _current();
    if (!st || !_own) return;
    // Opened for another student, class or report: dropped, never saved
    // into this comment.
    if (_own.key !== _rowKey(st)) {
      _own = null;
      _syncRequired();
      return;
    }
    if (_resync(st)) return;
    if (_own.where === 'gap') {
      var atGap = _own;
      if (!atGap.text.trim()) return;
      _own = null;
      _insertTyped(st, atGap.gap, atGap.text);
      return;
    }
    var c = _ownCompose(st);
    if (!c || !c.template || c.blocked) return;
    var entry = PersonalBank.keep(c.template);
    var was = _own;
    _own = null;
    var s = entry ? _bankById('mine:' + entry.id) : null;
    var key = _rowKey(st);
    if (was.where === 'row') {
      var rows = _rows[key] || [];
      var row = rows[was.index];
      var ctx = _bankContext(_activeCourse, st, _facts(st));
      if (was.mode === 'write' && s && row && row.step && !row.edited && CommentBank.fits(s, ctx)) {
        rows[was.index] = rowFromSentence(s, ctx, row.step, was.index === 0);
        _writeRows(st);
      } else _syncRequired();
      _focusSel(
        '#tq-sentences [data-row="' +
          was.index +
          '"] [data-do="wording"], #tq-sentences [data-row="' +
          was.index +
          '"] .qn-own-add',
      );
      return;
    }
    if (_browse && s) {
      var p = partOf(CommentBank.stepOf(s));
      if (p) _browse.part = p.id;
      // The new sentence's case opens, so it is seen at once.
      browseCase(_browse.part, s).forEach(function (c) {
        _browse.open[_groupKey(_browse.part, c)] = true;
        _browse.openQ[_groupKey(_browse.part, c)] = true;
      });
    }
    _syncBrowse();
    if (s) _focusSel('#tq-browse-list [data-sentence="' + s.id + '"]');
  }
  /* The × on a Yours row: gone from the bank now, with Undo; the server
     is told when the toast closes. */
  function _ownDelete(id) {
    var entry = PersonalBank.forget(id);
    if (!entry) return;
    _syncBrowseList();
    var undo = function () {
      PersonalBank.restore(entry);
      _syncBrowseList();
    };
    var commit = function () {
      PersonalBank.purge(entry);
    };
    if (typeof showUndoToast === 'function') showUndoToast('Removed from your bank.', undo, commit, 6000);
    else commit();
  }

  /* "Add to My Bank" in the comment's foot while a sentence the teacher
     typed or changed is selected in the box: the row the selection sits
     in, or -1. */
  function _selRow(st) {
    var el = _box();
    if (!el || el.selectionStart == null || el.selectionStart === el.selectionEnd) return -1;
    var a = el.selectionStart;
    var b = el.selectionEnd;
    var text = el.value;
    var rows = _rows[_rowKey(st)] || _rowsFor(st, _facts(st));
    var at = 0;
    var hit = -1;
    sentencesOf(text).forEach(function (sent, i) {
      var from = text.indexOf(sent, at);
      if (from < 0) from = at;
      var to = from + sent.length;
      if (hit < 0 && a < to && b > from) hit = i;
      at = to;
    });
    if (hit < 0) return -1;
    var k = 0;
    for (var r = 0; r < rows.length; r++) {
      var n = sentencesOf(rows[r].text).length || 1;
      if (hit < k + n) return !rows[r].classLine && (rows[r].edited || !rows[r].step) ? r : -1;
      k += n;
    }
    return -1;
  }
  function _syncSelAdd() {
    var st = _current();
    var btn = document.getElementById('tq-sel-add');
    if (!st || !btn) return;
    var r = _selRow(st);
    btn.hidden = r < 0;
    btn.dataset.row = String(r);
  }
  function _wireSelAdd() {
    var el = _box();
    if (!el || el._selAdd) return;
    el._selAdd = true;
    ['select', 'keyup', 'mouseup'].forEach(function (ev) {
      el.addEventListener(ev, _syncSelAdd);
    });
    var btn = document.getElementById('tq-sel-add');
    // The button keeps the box's selection: no blur on its mousedown.
    if (btn)
      btn.addEventListener('mousedown', function (e) {
        e.preventDefault();
      });
  }

  /* ── The class's lines (plan PR 8) ───────────────────────── */

  /* Each class line is edited where it shows, and saved with the class's
     report settings (report_config, under commentSettings); the late-work
     line is the class's Late Work Policy (course.late_work_policy, as Class
     Management edits it). Teacher text is used exactly as typed. */
  var _lineEdit = null; // 'closing', 'late' or 'own' while its box is open
  var _supportMenu = false;
  var _langMenu = false; // the Language Goals row's menu

  function _courseName(cid) {
    return (typeof COURSES !== 'undefined' && COURSES[cid] && COURSES[cid].name) || 'this class';
  }

  /* Merges a patch into the class's comment settings and saves the report
     settings, as Progress Reports saves them. */
  function _saveSettings(patch) {
    var rc = Object.assign({}, (typeof getReportConfig === 'function' && getReportConfig(_activeCourse)) || {});
    rc.commentSettings = Object.assign({}, rc.commentSettings || {}, patch);
    saveReportConfig(_activeCourse, rc);
  }

  function _first(student) {
    return student.firstName || displayNameFirst(student);
  }

  /* "2 of 28 · check that both are really missing before you approve". */
  function _missingSource(f) {
    var n = (f.notHandedIn && f.notHandedIn.count) || 0;
    var total = (f.record && f.record.total) || n;
    var which = n === 1 ? 'it is' : n === 2 ? 'both are' : 'these are';
    return n + ' of ' + total + ' · check that ' + which + ' really missing before you approve';
  }

  function _missingRowHtml(cid, f, handle, i) {
    var course = _courseName(cid);
    var late = String((COURSES[cid] && COURSES[cid].lateWorkPolicy) || '').trim();
    var sentence = CommentBank.notHandedInSentence(f.notHandedIn);
    var line;
    if (_lineEdit === 'late') {
      line = `<div class="qn-line-edit">
          <input type="text" class="qn-line-input" id="tq-line-late" data-tq-line-input="late" aria-label="Late work line for ${esc(course)}" title="Used exactly as you type it, after the missing-work sentence." value="${esc(late)}">
          <button type="button" class="qn-line-save" data-action="tqLine" data-do="saveLate" title="Saves this as ${esc(course)}’s Late Work Policy.">Save for Class</button>
        </div>
        <span class="qn-req-source">This is the class’s Late Work Policy. It follows the missing-work sentence for every student who has some.</span>`;
    } else if (late) {
      line = '';
    } else {
      line = `<span class="qn-line-empty-row"><span class="qn-line-empty">No late work line for this class.</span><button type="button" class="qn-line-choose" data-action="tqLine" data-do="editLate" title="Write the line that follows the missing-work sentence. It is ${esc(course)}’s Late Work Policy.">Add One…</button></span>`;
    }
    var lateBtn =
      late && _lineEdit !== 'late'
        ? ` <button type="button" class="qn-line-text" data-action="tqLine" data-do="editLate" title="Change ${esc(course)}’s late-work line. It is the class’s Late Work Policy.">${esc(late)}</button>`
        : '';
    var n = (f.notHandedIn && f.notHandedIn.count) || 0;
    var total = (f.record && f.record.total) || n;
    return `<div class="qn-req-row${_isChecked(f.sid, 'missing') ? '' : ' flag'} qn-line-row" id="tq-row-missing"${_rowAttr(i)}>
      ${handle || ''}<div class="qn-req-part"><span class="qn-req-label">Not Handed In</span></div>
      <div class="qn-req-body">
        <span class="qn-req-text">${esc(sentence)}${lateBtn}</span>
        ${line}
        ${_checkSourceHtml(f.sid, 'missing', _missingSource(f), n + ' of ' + total + ' · checked')}
      </div>
      ${_checkHtml(f.sid, 'missing')}
    </div>`;
  }

  /* What a support line fits, in words: the fit for this student, else the
     first skill or habit it names that this class has. */
  function _fitWords(line, f, fit) {
    if (fit) return CommentBank.fitName(fit, f);
    for (var i = 0; i < line.fits.length; i++) {
      var n = CommentBank.fitName(line.fits[i], f);
      if (n) return n;
    }
    return '';
  }

  function _supportMenuHtml(cid, student, f, choice) {
    var course = _courseName(cid);
    var first = _first(student);
    var habits = CommentBank.effectiveHabits(
      (getStudentTermRating(cid, student.id, getTermId()) || {}).habits || f.habits,
      f.record,
      f,
    );
    var lines = CommentBank.supportChecklist(cid, f.family);
    var on = lines.filter(function (l) {
      return l.on;
    });
    var left = f.classLines && f.classLines.pick === 'none';
    var item = function (id, text, meta, checked, tip) {
      return `<button type="button" role="menuitemradio" aria-checked="${checked}" class="qn-menu-item${checked ? ' on' : ''}" data-action="tqLine" data-do="pickSupport" data-line="${esc(id)}" title="${esc(tip)}"><span class="qn-menu-mark" aria-hidden="true">${checked ? '✓' : ''}</span><span class="qn-menu-body"><span class="qn-menu-text">${esc(text)}</span>${meta ? `<span class="qn-menu-meta">${esc(meta)}</span>` : ''}</span></button>`;
    };
    var use = on
      .map(function (l) {
        var inUse = !left && !!choice && choice.line.id === l.id;
        var fit = CommentBank.supportFit(l, f, habits);
        var words = _fitWords(l, f, fit);
        // In use: what it fits for this student, when it does; else what
        // the line is for.
        var meta = inUse ? 'In use' + (fit ? ' · fits ' + words : '') : words ? 'Fits ' + words : '';
        return item(l.id, l.text, meta, inUse, 'Use this line in ' + first + '’s comment.');
      })
      .join('');
    var useHtml = on.length
      ? `<span class="qn-menu-head">Use for ${esc(first)}</span>${use}${item('none', 'Leave this sentence out', 'For ' + first + ' only', left, 'Leaves the support line out of ' + first + '’s comment only.')}<div class="qn-menu-sep" role="separator"></div>`
      : '';
    var checks = lines
      .map(function (l) {
        return `<label class="qn-menu-check" title="${esc(l.on ? 'Untick to stop using this line in ' + course + '.' : 'Tick if you will do this in ' + course + '.')}"><input type="checkbox" data-tq-support="${esc(l.id)}"${l.on ? ' checked' : ''}>${esc(l.text)}</label>`;
      })
      .join('');
    var own =
      _lineEdit === 'own'
        ? `<div class="qn-line-edit qn-menu-own">
            <input type="text" class="qn-line-input" id="tq-line-own" data-tq-line-input="own" aria-label="Your own support line for ${esc(course)}" title="Write what you will do in class. It is used exactly as you type it.">
            <div class="qn-line-actions"><button type="button" class="qn-line-cancel" data-action="tqLine" data-do="cancel" title="Closes without adding a line.">Cancel</button><button type="button" class="qn-line-save" data-action="tqLine" data-do="saveOwn" title="Adds this line to ${esc(course)}’s list and ticks it.">Save for Class</button></div>
          </div>`
        : `<button type="button" class="qn-menu-add" data-action="tqLine" data-do="writeOwn" title="Write a support line of your own for ${esc(course)}.">+ Write Your Own</button>`;
    return `<div class="qn-menu" role="menu" aria-label="Support lines for ${esc(course)}" id="tq-support-menu">
      ${useHtml}
      <span class="qn-menu-head">Lines you will do in ${esc(course)}</span>
      ${checks}
      ${own}
    </div>`;
  }

  function _supportRowHtml(cid, student, f, handle, i) {
    var course = _courseName(cid);
    var first = _first(student);
    var habits = CommentBank.effectiveHabits(
      (getStudentTermRating(cid, student.id, getTermId()) || {}).habits || f.habits,
      f.record,
      f,
    );
    var any = ((f.classLines && f.classLines.support) || []).length > 0;
    var choice = CommentBank.supportChoice(f, habits);
    var menu = _supportMenu ? _supportMenuHtml(cid, student, f, choice) : '';
    var open = ` aria-haspopup="menu" aria-expanded="${_supportMenu}"`;
    handle = handle || '';
    if (!any)
      return `<div class="qn-req-row qn-line-row has-menu" id="tq-row-support"${_rowAttr(i)}>
        ${handle}<div class="qn-req-part"><span class="qn-req-label">Support</span></div>
        <span class="qn-line-empty">No support lines chosen for this class. The comment leaves this sentence out.</span>
        <button type="button" class="qn-line-choose" data-action="tqLine" data-do="supportMenu"${open} title="Tick the support lines you will do in ${esc(course)}.">Choose…</button>
        ${menu}
      </div>`;
    var body = choice
      ? `<span class="qn-req-text">${esc(choice.line.text)}</span><span class="qn-req-source">One of your support lines for ${esc(course)}</span>`
      : `<span class="qn-req-text qn-line-off">Left out of this comment.</span><span class="qn-req-source">For ${esc(first)} only</span>`;
    return `<div class="qn-req-row qn-line-row has-menu" id="tq-row-support"${_rowAttr(i)}>
      ${handle}<div class="qn-req-part"><span class="qn-req-label">Support</span></div>
      <div class="qn-req-body">${body}</div>
      <button type="button" class="qn-line-menu${_supportMenu ? ' on' : ''}" data-action="tqLine" data-do="supportMenu"${open} title="Pick the support line for ${esc(first)}, or tick the lines you will do in ${esc(course)}.">Support Line ▾</button>
      ${menu}
    </div>`;
  }

  /* The Language Goals row (plan PR 3b): only for a student assessed on
     language goals. FullVision has no language-proficiency facts, so the
     teacher ticks the lines used in the class and picks one for each
     student here; until one is picked the comment leaves the sentence
     out. Each line is a template, shown filled for the student. */
  function _langMenuHtml(cid, student, f, choice) {
    var course = _courseName(cid);
    var first = _first(student);
    var ctx = _bankContext(cid, student, f);
    var filled = function (text) {
      return CommentBank.fill({ text: text }, ctx);
    };
    var lines = CommentBank.languageGoalsChecklist(cid);
    var on = lines.filter(function (l) {
      return l.on;
    });
    var item = function (id, text, meta, checked, tip) {
      return `<button type="button" role="menuitemradio" aria-checked="${checked}" class="qn-menu-item${checked ? ' on' : ''}" data-action="tqLine" data-do="pickLang" data-line="${esc(id)}" title="${esc(tip)}"><span class="qn-menu-mark" aria-hidden="true">${checked ? '✓' : ''}</span><span class="qn-menu-body"><span class="qn-menu-text">${esc(text)}</span>${meta ? `<span class="qn-menu-meta">${esc(meta)}</span>` : ''}</span></button>`;
    };
    var use = on
      .map(function (l) {
        var inUse = !!choice && choice.line.id === l.id;
        return item(l.id, filled(l.text), inUse ? 'In use' : '', inUse, 'Use this line in ' + first + '’s comment.');
      })
      .join('');
    var useHtml = on.length
      ? `<span class="qn-menu-head">Use for ${esc(first)}</span>${use}${item('none', 'Leave this sentence out', 'For ' + first + ' only', !choice, 'Leaves the language goal out of ' + first + '’s comment.')}<div class="qn-menu-sep" role="separator"></div>`
      : '';
    var checks = lines
      .map(function (l) {
        return `<label class="qn-menu-check" title="${esc(l.on ? 'Untick to stop using this line in ' + course + '.' : 'Tick if you use this line in ' + course + '.')}"><input type="checkbox" data-tq-lang="${esc(l.id)}"${l.on ? ' checked' : ''}>${esc(filled(l.text))}</label>`;
      })
      .join('');
    var own =
      _lineEdit === 'ownLang'
        ? `<div class="qn-line-edit qn-menu-own">
            <input type="text" class="qn-line-input" id="tq-line-own-lang" data-tq-line-input="ownLang" aria-label="Your own language goal line for ${esc(course)}" title="Say what the student can do in English and one next step. Write {He} and {his} where the pronouns go.">
            <div class="qn-line-actions"><button type="button" class="qn-line-cancel" data-action="tqLine" data-do="cancel" title="Closes without adding a line.">Cancel</button><button type="button" class="qn-line-save" data-action="tqLine" data-do="saveOwnLang" title="Adds this line to ${esc(course)}’s list and ticks it.">Save for Class</button></div>
          </div>`
        : `<button type="button" class="qn-menu-add" data-action="tqLine" data-do="writeOwnLang" title="Write a language goal line of your own for ${esc(course)}.">+ Write Your Own</button>`;
    return `<div class="qn-menu" role="menu" aria-label="Language goal lines for ${esc(course)}" id="tq-lang-menu">
      ${useHtml}
      <span class="qn-menu-head">Lines you use in ${esc(course)}</span>
      ${checks}
      ${own}
    </div>`;
  }

  function _langRowHtml(cid, student, f, handle, i) {
    var course = _courseName(cid);
    var first = _first(student);
    var any = ((f.classLines && f.classLines.languageGoals) || []).length > 0;
    var choice = CommentBank.languageGoalChoice(f);
    var menu = _langMenu ? _langMenuHtml(cid, student, f, choice) : '';
    var open = ` aria-haspopup="menu" aria-expanded="${_langMenu}"`;
    handle = handle || '';
    if (!any)
      return `<div class="qn-req-row qn-line-row has-menu" id="tq-row-languageGoals"${_rowAttr(i)}>
        ${handle}<div class="qn-req-part"><span class="qn-req-label">Language Goals</span></div>
        <span class="qn-line-empty">No language goal lines chosen for this class. The comment leaves this sentence out.</span>
        <button type="button" class="qn-line-choose" data-action="tqLine" data-do="langMenu"${open} title="Tick the language goal lines you use in ${esc(course)}.">Choose…</button>
        ${menu}
      </div>`;
    var body = choice
      ? `<span class="qn-req-text">${esc(CommentBank.fill({ text: choice.line.text }, _bankContext(cid, student, f)))}</span><span class="qn-req-source">One of your language goal lines for ${esc(course)}</span>`
      : `<span class="qn-req-text qn-line-off">No language goal picked for ${esc(first)}. The comment leaves this sentence out.</span><span class="qn-req-source">For ${esc(first)} only</span>`;
    return `<div class="qn-req-row qn-line-row has-menu" id="tq-row-languageGoals"${_rowAttr(i)}>
      ${handle}<div class="qn-req-part"><span class="qn-req-label">Language Goals</span></div>
      <div class="qn-req-body">${body}</div>
      <button type="button" class="qn-line-menu${_langMenu ? ' on' : ''}" data-action="tqLine" data-do="langMenu"${open} title="Pick the language goal for ${esc(first)}, or tick the lines you use in ${esc(course)}.">Language Goal ▾</button>
      ${menu}
    </div>`;
  }

  function _closingRowHtml(cid, handle, i) {
    var course = _courseName(cid);
    var closing = CommentBank.classSettings(cid).closing;
    handle = handle || '';
    if (_lineEdit === 'closing')
      return `<div class="qn-req-row qn-line-row" id="tq-row-closing"${_rowAttr(i)}>
        ${handle}<div class="qn-req-part"><span class="qn-req-label">Closing</span></div>
        <div class="qn-req-body qn-line-edit-body">
          <input type="text" class="qn-line-input" id="tq-line-closing" data-tq-line-input="closing" aria-label="Closing sentence for ${esc(course)}" title="Used exactly as you type it, at the end of each new comment." value="${esc(closing)}">
          <span class="qn-req-source">Ends every new comment in ${esc(course)}. Approved comments are flagged so you can update or keep each one. Leave it empty to end without one.</span>
          <div class="qn-line-actions"><button type="button" class="qn-line-cancel" data-action="tqLine" data-do="cancel" title="Keeps the closing sentence as it was.">Cancel</button><button type="button" class="qn-line-save" data-action="tqLine" data-do="saveClosing" title="Saves this closing sentence for every comment in ${esc(course)}.">Save for Class</button></div>
        </div>
      </div>`;
    if (!closing)
      return `<div class="qn-req-row qn-line-row" id="tq-row-closing"${_rowAttr(i)}>
        ${handle}<div class="qn-req-part"><span class="qn-req-label">Closing</span></div>
        <span class="qn-line-empty">No closing sentence for this class.</span>
        <button type="button" class="qn-line-choose" data-action="tqLine" data-do="editClosing" title="Write a sentence to end every comment in ${esc(course)}.">Add One…</button>
      </div>`;
    return `<div class="qn-req-row qn-line-row" id="tq-row-closing"${_rowAttr(i)}>
      ${handle}<div class="qn-req-part"><span class="qn-req-label">Closing</span></div>
      <div class="qn-req-body">
        <button type="button" class="qn-line-text qn-req-text" data-action="tqLine" data-do="editClosing" title="Change the closing sentence for ${esc(course)}.">${esc(closing)}</button>
        <span class="qn-req-source">From your class settings</span>
      </div>
    </div>`;
  }

  /* The rows for the class's lines, in the comment's order. On the IE
     path the Support row is drawn among the Required rows (_requiredRows),
     so only the closing row is added here. */
  function _classRowsHtml(cid, student, f) {
    var ie = CommentBank.reportPath(f) === 'ie';
    var rows = '';
    if (!ie && f.notHandedIn && f.notHandedIn.count > 0) rows += _missingRowHtml(cid, f);
    if (CommentBank.reportPath(f) === 'language_goals') rows += _langRowHtml(cid, student, f);
    if (!ie) rows += _supportRowHtml(cid, student, f);
    return rows + _closingRowHtml(cid);
  }

  /* After a class line changes: the comment on screen, when it is still
     the draft Generate wrote, is drafted again with the same seed, so only
     the class's lines differ; otherwise the old line is swapped for the new
     where it appears (taken out when the new is empty). With `everyone`,
     every other comment this report not yet approved gets the same swap.
     An approved comment is never rewritten (Decision 1; PR 12 flags it). */
  function _swapLine(oldText, newText, everyone) {
    var st = _current();
    var termId = getTermId();
    var swap = function (text) {
      if (!oldText || text.indexOf(oldText) < 0) return null;
      if (newText) return text.replace(oldText, newText);
      return text
        .replace(oldText, '')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();
    };
    var all = getTermRatings(_activeCourse) || {};
    var sids = everyone ? Object.keys(all) : st ? [String(st.id)] : [];
    sids.forEach(function (sid) {
      var r = (all[sid] || {})[termId];
      if (!r || r.approvedAt) return;
      var key = _activeCourse + '|' + sid + '|' + termId;
      var text = plainComment(r.narrative || '');
      var last = _lastDraft[key];
      if (st && String(st.id) === sid && text && last && text.trim() === last.text.trim()) {
        _redraft(st);
        return;
      }
      var next = swap(text);
      if (next == null || next === text) return;
      upsertTermRating(_activeCourse, sid, termId, { narrative: next });
      if (last) {
        last.text = swap(last.text) || last.text;
        last.sentences = last.sentences
          .map(function (x) {
            return x.text === oldText ? Object.assign({}, x, { text: newText }) : x;
          })
          .filter(function (x) {
            return x.text;
          });
        last.provenance = last.provenance.filter(function (p, i) {
          return !!last.sentences[i];
        });
        _adoptDraft(key, last);
      } else if (_rows[key]) {
        _rows[key] = alignRows(_rows[key], next);
      }
    });
  }

  /* The draft on screen again, with the seed it was drafted with, the
     teacher's edited sentences and order kept. */
  function _redraft(st) {
    var termId = getTermId();
    var key = _activeCourse + '|' + st.id + '|' + termId;
    _facts(st, true);
    var rows = _rows[key] || [];
    var kept = {};
    rows.forEach(function (r) {
      if (r.edited && r.step && !kept[r.step]) kept[r.step] = r.text;
    });
    var d = CommentBank.draft(_bankContext(_activeCourse, st, _facts(st)), {
      seed: _lastSeed[key] || CommentBank.seedFor(st.id + '|' + termId) + (_generated[st.id] || 1),
      comments: _classmateComments(_activeCourse, st.id, termId),
      exclude: lastTermIds(_activeCourse, st.id, termId),
      kept: kept,
      order: _ordered[key]
        ? rows
            .map(function (r) {
              return r.step;
            })
            .filter(Boolean)
        : undefined,
      charLimit: _limit(),
      reserve: _typedLength(rows),
    });
    if (!d.text) return;
    _lastDraft[key] = d;
    _lastSeed[key] = d.seed;
    _adoptDraft(key, d);
    var text = composeRows(_rows[key]);
    upsertTermRating(_activeCourse, st.id, termId, { narrative: text });
    _syncLast(key, _rows[key], text);
  }

  /* The text in a line's box. */
  function _lineValue(which) {
    var el = document.getElementById('tq-line-' + which);
    return el ? String(el.value || '').trim() : '';
  }

  function _redrawLines(focusId) {
    var st = _current();
    if (st) _facts(st, true);
    rerender();
    var el = focusId && document.getElementById(focusId);
    if (el) el.focus();
  }

  /* The class lines' controls: data-action="tqLine" with data-do. */
  function tqLine(what, el) {
    var st = _current();
    if (!st) return;
    tqSaveCurrentIfNeeded();
    var termId = getTermId();
    var cs = CommentBank.classSettings(_activeCourse);
    // The lines as the comment had them, before a save changes one.
    var before = /^save|^pick/.test(what) ? _bankContext(_activeCourse, st, _facts(st, true)) : null;
    switch (what) {
      case 'limitMenu':
        _limitOpen = !_limitOpen;
        _limitCancelled = false;
        _supportMenu = false;
        _langMenu = false;
        _redrawLines(_limitOpen ? 'tq-limit-input' : 'tq-count-btn');
        return;
      case 'supportMenu':
        _supportMenu = !_supportMenu;
        _langMenu = false;
        _limitOpen = false;
        if (_lineEdit === 'own') _lineEdit = null;
        _redrawLines(_supportMenu ? null : 'tq-row-support');
        _focusMenu();
        return;
      case 'pickSupport': {
        var picks = Object.assign({}, cs.supportFor);
        picks[termId] = Object.assign({}, picks[termId] || {});
        picks[termId][st.id] = el && el.dataset.line ? String(el.dataset.line) : null;
        _saveSettings({ supportFor: picks });
        _supportMenu = false;
        _afterLine(before, 'supportLine', false);
        _redrawLines(null);
        _focusSel('#tq-row-support .qn-line-menu');
        return;
      }
      case 'writeOwn':
        _lineEdit = 'own';
        _redrawLines('tq-line-own');
        return;
      case 'langMenu':
        _langMenu = !_langMenu;
        _supportMenu = false;
        _limitOpen = false;
        if (_lineEdit === 'ownLang') _lineEdit = null;
        _redrawLines(_langMenu ? null : 'tq-row-languageGoals');
        _focusSel('#tq-lang-menu .qn-menu-item.on, #tq-lang-menu .qn-menu-item, #tq-lang-menu input');
        return;
      case 'pickLang': {
        var goalPicks = Object.assign({}, cs.languageGoalsFor);
        goalPicks[termId] = Object.assign({}, goalPicks[termId] || {});
        var lineId = el && el.dataset.line ? String(el.dataset.line) : null;
        goalPicks[termId][st.id] = lineId === 'none' ? null : lineId;
        _saveSettings({ languageGoalsFor: goalPicks });
        _langMenu = false;
        _afterLine(before, 'languageGoalLine', false);
        _redrawLines(null);
        _focusSel('#tq-row-languageGoals .qn-line-menu');
        return;
      }
      case 'writeOwnLang':
        _lineEdit = 'ownLang';
        _redrawLines('tq-line-own-lang');
        return;
      case 'saveOwnLang': {
        var langText = _lineValue('own-lang');
        if (!langText) return;
        var langId = 'own-' + Date.now().toString(36);
        _saveSettings({
          languageGoalsOwn: cs.languageGoalsOwn.concat([{ id: langId, text: langText }]),
          languageGoalsChosen: cs.languageGoalsChosen.concat([langId]),
        });
        _lineEdit = null;
        _afterLine(before, 'languageGoalLine', false);
        _redrawLines(null);
        _focusSel('#tq-lang-menu .qn-menu-add');
        return;
      }
      case 'saveOwn': {
        var text = _lineValue('own');
        if (!text) return;
        var id = 'own-' + Date.now().toString(36);
        _saveSettings({
          supportOwn: cs.supportOwn.concat([{ id: id, text: text }]),
          supportChosen: cs.supportChosen.concat([id]),
        });
        _lineEdit = null;
        _afterLine(before, 'supportLine', false);
        _redrawLines(null);
        _focusSel('#tq-support-menu .qn-menu-add');
        return;
      }
      case 'editClosing':
        _lineEdit = 'closing';
        _supportMenu = false;
        _langMenu = false;
        _redrawLines('tq-line-closing');
        return;
      case 'saveClosing':
        _saveSettings({ closing: _lineValue('closing') });
        _lineEdit = null;
        _afterLine(before, 'closingLine', true);
        _redrawLines(null);
        _focusSel('#tq-row-closing button');
        return;
      case 'editLate':
        _lineEdit = 'late';
        _supportMenu = false;
        _langMenu = false;
        _redrawLines('tq-line-late');
        return;
      case 'saveLate': {
        var late = _lineValue('late');
        if (late !== String((COURSES[_activeCourse] && COURSES[_activeCourse].lateWorkPolicy) || '').trim())
          updateCourse(_activeCourse, { lateWorkPolicy: late || null });
        _lineEdit = null;
        _afterLine(before, 'lateLine', true);
        _redrawLines(null);
        _focusSel('#tq-row-missing button');
        return;
      }
      case 'cancel': {
        var was = _lineEdit;
        _lineEdit = null;
        _redrawLines(null);
        _focusSel(
          was === 'own'
            ? '#tq-support-menu .qn-menu-add'
            : was === 'ownLang'
              ? '#tq-lang-menu .qn-menu-add'
              : was === 'closing'
                ? '#tq-row-closing button'
                : null,
        );
        return;
      }
    }
  }

  /* After a save: the line as it was against the line now, in the comment
     on screen (and, for a class-wide line, the others not yet approved). */
  function _afterLine(before, slot, everyone) {
    var st = _current();
    if (!st || !before) return;
    var after = _bankContext(_activeCourse, st, _facts(st, true));
    if (before[slot] !== after[slot]) _swapLine(before[slot], after[slot], everyone);
  }

  /* A checkbox in the support list, or the character limit, changed. */
  function tqLineChange(el) {
    if (!el || !el.dataset) return;
    if (el.dataset.tqLimit) {
      // The box closing on Escape blurs it: that change is not a save.
      if (_limitCancelled) return;
      _setLimit(el.value);
      return;
    }
    var langId = el.dataset.tqLang;
    if (langId) {
      var stu = _current();
      if (!stu) return;
      tqSaveCurrentIfNeeded();
      var was = _bankContext(_activeCourse, stu, _facts(stu, true));
      var langChosen = CommentBank.classSettings(_activeCourse).languageGoalsChosen.filter(function (x) {
        return x !== langId;
      });
      if (el.checked) langChosen.push(langId);
      _saveSettings({ languageGoalsChosen: langChosen });
      _afterLine(was, 'languageGoalLine', false);
      _redrawLines(null);
      _focusSel('#tq-lang-menu [data-tq-lang="' + langId + '"]');
      return;
    }
    var id = el.dataset.tqSupport;
    if (!id) return;
    var st = _current();
    if (!st) return;
    tqSaveCurrentIfNeeded();
    var before = _bankContext(_activeCourse, st, _facts(st, true));
    var chosen = CommentBank.classSettings(_activeCourse).supportChosen.filter(function (x) {
      return x !== id;
    });
    if (el.checked) chosen.push(id);
    _saveSettings({ supportChosen: chosen });
    _afterLine(before, 'supportLine', false);
    _redrawLines(null);
    _focusSel('#tq-support-menu [data-tq-support="' + id + '"]');
  }

  function _focusSel(sel) {
    var el = sel && document.querySelector(sel);
    if (el) el.focus();
  }
  /* The first of some selectors that finds anything, in their order. */
  function _focusAny(sels) {
    var sel = sels.find(function (x) {
      return !!document.querySelector(x);
    });
    if (sel) _focusSel(sel);
  }
  function _focusMenu() {
    _focusSel('#tq-support-menu .qn-menu-item.on, #tq-support-menu .qn-menu-item, #tq-support-menu input');
  }

  /* Whether a popover or a line's box is open. */
  function linesOpen() {
    return (
      _supportMenu ||
      _langMenu ||
      _limitOpen ||
      !!_lineEdit ||
      !!_wording ||
      _addAt != null ||
      !!_own ||
      !!(_browse && _browse.menu)
    );
  }
  /* A click outside an open menu or the limit closes it; a box being
     edited stays until Cancel, Save for Class or Escape. */
  function clickOutside(target) {
    if (!target || !target.closest) return;
    var redraw = false;
    if (_supportMenu && !target.closest('#tq-support-menu, #tq-row-support [data-do="supportMenu"]')) {
      _supportMenu = false;
      if (_lineEdit === 'own') _lineEdit = null;
      redraw = true;
    }
    if (_langMenu && !target.closest('#tq-lang-menu, #tq-row-languageGoals [data-do="langMenu"]')) {
      _langMenu = false;
      if (_lineEdit === 'ownLang') _lineEdit = null;
      redraw = true;
    }
    if (_limitOpen && !target.closest('#tq-limit, #tq-count-btn')) {
      // An entry that is not a limit keeps the box open with its message.
      var input = document.getElementById('tq-limit-input');
      if (!input || _setLimit(input.value)) {
        _limitOpen = false;
        redraw = true;
      }
    }
    if (_wording && !target.closest('#tq-wording-menu, #tq-options-menu, [data-do="wording"], [data-do="options"]')) {
      _wording = null;
      _syncRequired();
    }
    if (_addAt != null && !target.closest('#tq-add-menu, [data-do="addMenu"]')) {
      _addAt = null;
      _syncRequired();
    }
    if (_browse && _browse.menu && !target.closest('#tq-fits-menu, #tq-browse-fits')) {
      _browse.menu = false;
      _syncBrowse();
    }
    if (redraw) _redrawLines(null);
  }
  /* Escape: the open menu, the limit or the box being edited closes. */
  function closeLines() {
    if (!linesOpen()) return false;
    if (_own) {
      _ownCancel();
      return true;
    }
    if (_browse && _browse.menu) {
      _browse.menu = false;
      _syncBrowse('tq-browse-fits');
      return true;
    }
    if (_addAt != null) {
      var gap = _addAt;
      _addAt = null;
      _syncRequired();
      _focusGap(gap);
      return true;
    }
    if (_wording) {
      var at = _wording.index;
      _wording = null;
      _syncRequired();
      _focusSel(
        '#tq-sentences [data-row="' +
          at +
          '"] [data-do="wording"], #tq-sentences [data-row="' +
          at +
          '"] [data-do="options"]',
      );
      return true;
    }
    // Escape in the limit cancels: the limit stays as saved, and the blur
    // as the box closes saves nothing (_limitCancelled).
    var limit = _limitOpen;
    if (limit) _limitCancelled = true;
    var menu = _supportMenu || _langMenu;
    var langWas = _langMenu;
    var was = _lineEdit;
    _supportMenu = false;
    _langMenu = false;
    _limitOpen = false;
    _lineEdit = null;
    _redrawLines(null);
    _focusSel(
      limit
        ? '#tq-count-btn'
        : menu
          ? langWas
            ? '#tq-row-languageGoals [data-do="langMenu"]'
            : '#tq-row-support [data-do="supportMenu"]'
          : was === 'closing'
            ? '#tq-row-closing button'
            : was === 'late'
              ? '#tq-row-missing button'
              : null,
    );
    return true;
  }
  /* Return in the limit: saved, and only the limit closes; an entry that
     is not a limit keeps it open with its message. */
  function closeLimit() {
    var input = document.getElementById('tq-limit-input');
    if (input && !_setLimit(input.value)) return;
    _limitOpen = false;
    _redrawLines('tq-count-btn');
  }
  /* Return in a line's box saves it. */
  function _saveFromKey(which) {
    tqLine(which === 'own' ? 'saveOwn' : which === 'closing' ? 'saveClosing' : 'saveLate');
  }

  /* ── The page ────────────────────────────────────────────── */

  /* A new student, report or class on screen: nothing left open from the
     one before follows (the Write Your Own box, a menu, a gap's menu, the
     calendar, an IE choice waiting for its date, Browse Sentences and the
     gap it inserts at). */
  var _screen = null;
  function _enterScreen(cid, student) {
    var key = cid + '|' + student.id + '|' + getTermId();
    if (_screen === key) return;
    _screen = key;
    _own = null;
    _wording = null;
    _addAt = null;
    _cal = null;
    _iePending = null;
    _supportMenu = false;
    _langMenu = false;
    _limitOpen = false;
    if (_lineEdit === 'own' || _lineEdit === 'ownLang') _lineEdit = null;
    if (_browse) _closeBrowse(true);
  }

  function renderTermQuestionnaire(cid) {
    var students = getTqStudents();
    if (students.length === 0) return '<div class="empty-state"><div class="empty-state-title">No students</div></div>';
    if (tqStudentIndex >= students.length) tqStudentIndex = 0;
    var student = students[tqStudentIndex];
    _enterScreen(cid, student);
    var f = _facts(student, true);
    // The pronouns may have changed (Edit Student) since the rows were drawn.
    _syncPronouns(cid, student, f);
    // Marks may have changed since the page was last drawn.
    _strength = null;
    _staleCache = {};
    _claimCache = {};
    var comment = plainComment((getStudentTermRating(cid, student.id, getTermId()) || {}).narrative || '');
    return `<div class="qn" data-sid="${student.id}">
      <div class="qn-left">
        ${_headerHtml(cid, student, f)}
        ${_habitsHtml(cid, f)}
        ${_glanceHtml(cid, student, f)}
        ${_voiceHtml(cid, student, f, comment)}
      </div>
      <div class="qn-right">
        ${_commentHtml(cid, student)}
        ${_attendanceHtml(cid, student)}
        ${_commentTab === 'this' ? _sentencesHtml(cid, student, f) : ''}
        <!-- The rest of the Sentences card (PR 11b) goes here. -->
      </div>
    </div>`;
  }

  /* After the page is drawn: the roster, the box's height, and drag and
     drop on the Sentences card. */
  function afterRender() {
    syncRoster();
    _fitBox();
    syncApprove();
    _wireDrag();
    _wireSelAdd();
    // The teacher's own sentences in the bank (plan PR 10), and the
    // suggestions again after Later.
    if (window.PersonalBank) {
      PersonalBank.load();
      _offerBank(false);
    }
  }

  /* ⌘ Return approves and moves on; ⌘⇧C copies; ↑ ↓ change the student
     outside a text field (the sidebar handles them while it has the
     focus); ⌥↑ ⌥↓ move a sentence of the card; Escape closes the sheet. */
  function handleKey(e) {
    // The grader opened from At a Glance keeps its own keys.
    if (window.PageAssignments && PageAssignments.graderOpen && PageAssignments.graderOpen()) return;
    var t = e.target;
    // "Suggested for Your Bank" keeps the keys while it is open.
    if (window.PersonalBank && PersonalBank.isOpen()) {
      if (e.key === 'Escape') PersonalBank.close('later');
      return;
    }
    if (e.key === 'Escape') {
      if (document.getElementById(BOTH_ID)) tqCloseBoth();
      else if (document.getElementById(INFO_ID)) tqCloseInfo();
      else if (browseOpen()) {
        if (!closeLines()) _closeBrowse();
      } else if (_cal) tqCloseDeadline();
      else closeLines();
      return;
    }
    // Tab and Shift-Tab stay inside the ⓘ sheet while it is open.
    if (e.key === 'Tab' && document.getElementById(INFO_ID)) {
      _trapTab(e, document.getElementById(INFO_ID));
      return;
    }
    if (document.getElementById(INFO_ID) || document.getElementById(BOTH_ID)) return;
    // Return in the box for a sentence of the teacher's own saves it.
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && t && t.id === 'tq-own-input') {
      e.preventDefault();
      _ownSave();
      return;
    }
    if (browseOpen()) {
      // ↑ ↓ on the sheet's bottom edge make the list shorter or taller.
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && t && t.id === 'tq-browse-handle') {
        e.preventDefault();
        var list = document.getElementById('tq-browse-list');
        var h = (list && parseFloat(list.style.maxHeight)) || sheetHeight();
        _setHeight(h + (e.key === 'ArrowDown' ? 24 : -24), true);
      }
      return;
    }
    // ⌥↑ and ⌥↓ move the sentence whose row has the focus.
    if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.altKey && !e.metaKey && !e.ctrlKey) {
      var row = t && t.closest && t.closest('#tq-sentences [data-row]');
      if (row && row.querySelector('.qn-srow-handle[tabindex]')) {
        e.preventDefault();
        _moveRow(Number(row.dataset.row), e.key === 'ArrowUp' ? -1 : 1);
        return;
      }
    }
    // Return in a class line's box saves it; in the limit, closes it.
    var lineBox = (e.target && e.target.dataset && e.target.dataset.tqLineInput) || '';
    if (
      e.key === 'Enter' &&
      !e.metaKey &&
      !e.ctrlKey &&
      (lineBox || (e.target && e.target.dataset && e.target.dataset.tqLimit))
    ) {
      e.preventDefault();
      if (lineBox) _saveFromKey(lineBox);
      else closeLimit();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      // An earlier report's tab is read only: ⌘ Return does nothing there.
      if (_commentTab === 'this') tqApproveNext();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === 'c' || e.key === 'C')) {
      e.preventDefault();
      tqCopyNarrative();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    // Arrow keys in the open calendar stay there: they never move to
    // another student (which would drop an IE waiting for its date).
    if (_cal && t && t.closest && t.closest('#tq-cal')) {
      if (e.stopPropagation) e.stopPropagation();
      return;
    }
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    if (t && (t.closest('input, textarea, select, [contenteditable="true"]') || t.closest('#gb-sidebar'))) return;
    e.preventDefault();
    if (e.key === 'ArrowDown') tqNextStudent();
    else tqPrevStudent();
  }

  /* ── Namespace ──────────────────────────────────────────── */
  return {
    configure: configure,
    getTqStudents: getTqStudents,
    tqPrevStudent: tqPrevStudent,
    tqNextStudent: tqNextStudent,
    tqApproveNext: tqApproveNext,
    tqSaveCurrentIfNeeded: tqSaveCurrentIfNeeded,
    tqSaveNarrative: tqSaveNarrative,
    tqNarrativeInput: tqNarrativeInput,
    tqCopyNarrative: tqCopyNarrative,
    tqCommentTab: tqCommentTab,
    tqRosterFilter: tqRosterFilter,
    tqGenerate: tqGenerate,
    tqRate: tqRate,
    tqOpenInfo: tqOpenInfo,
    tqCloseInfo: tqCloseInfo,
    tqEditStudent: tqEditStudent,
    tqSetAttendance: tqSetAttendance,
    noMarkedWork: noMarkedWork,
    attendanceValue: attendanceValue,
    tqAddReportNote: tqAddReportNote,
    tqSelectStudent: tqSelectStudent,
    tqSetBasis: tqSetBasis,
    tqSetCheck: tqSetCheck,
    tqOpenDeadline: tqOpenDeadline,
    tqCloseDeadline: tqCloseDeadline,
    deadlineOpen: function () {
      return !!_cal;
    },
    iePending: function () {
      return !!_iePending;
    },
    tqDeadlineMonth: tqDeadlineMonth,
    tqPickDeadline: tqPickDeadline,
    deadlineAt: deadlineAt,
    shownText: _shownText,
    deadlineSentence: _deadlineSentence,
    tqLine: tqLine,
    tqLineChange: tqLineChange,
    tqSentences: tqSentences,
    tqStale: tqStale,
    tqClaim: tqClaim,
    claimChanges: claimChanges,
    staleFor: staleFor,
    staleNote: staleNote,
    metaFor: metaFor,
    lastTermIds: lastTermIds,
    browseOpen: browseOpen,
    ownOpen: function () {
      return !!_own;
    },
    PARTS: PARTS,
    partOf: partOf,
    rowLabel: rowLabel,
    sentencesOf: sentencesOf,
    rowsFromDraft: rowsFromDraft,
    rowFromSentence: rowFromSentence,
    alignRows: alignRows,
    isTyped: isTyped,
    typedRow: typedRow,
    keepTyped: keepTyped,
    insertRow: insertRow,
    insertChoices: insertChoices,
    replacedBy: _replacedBy,
    gapPart: _gapPart,
    recoverRows: recoverRows,
    composeRows: composeRows,
    pronounsChanged: pronounsChanged,
    pronounSet: pronounSet,
    writtenWith: writtenWith,
    pronounNote: pronounNote,
    pronounCheck: pronounCheck,
    pronounWordsNotIn: pronounWordsNotIn,
    pronounChanges: pronounChanges,
    units: _units,
    moveRow: moveRow,
    dropRow: dropRow,
    resetOrder: resetOrder,
    alternatives: alternatives,
    useSentence: useSentence,
    browseList: browseList,
    browseCases: browseCases,
    browseCase: browseCase,
    browseOwn: browseOwn,
    rowSource: rowSource,
    thinLine: thinLine,
    sheetHeight: sheetHeight,
    linesOpen: linesOpen,
    clickOutside: clickOutside,
    closeLines: closeLines,
    approveBlockers: approveBlockers,
    syncApprove: syncApprove,
    checksFor: _checksFor,
    lowGrade: lowGrade,
    longSentences: longSentences,
    nearTwin: nearTwin,
    tqShowBoth: tqShowBoth,
    tqCloseBoth: tqCloseBoth,
    bothOpen: function () {
      return !!document.getElementById(BOTH_ID);
    },
    schoolYear: schoolYear,
    basisChoices: basisChoices,
    renderTermQuestionnaire: renderTermQuestionnaire,
    afterRender: afterRender,
    fitBox: _fitBox,
    syncRoster: syncRoster,
    restoreRoster: restoreRoster,
    handleKey: handleKey,
    plainComment: plainComment,
    standingWord: standingWord,
    headerGrade: headerGrade,
    bestPiece: bestPiece,
    notHandedIn: notHandedIn,
    skillTags: skillTags,
    voiceRows: voiceRows,
    SCREEN_SOURCES: SCREEN_SOURCES,
    get tqStudentIndex() {
      return tqStudentIndex;
    },
    set tqStudentIndex(v) {
      tqStudentIndex = v;
    },
    get tqNarrativeDirty() {
      return tqNarrativeDirty;
    },
    set tqNarrativeDirty(v) {
      tqNarrativeDirty = v;
    },
  };
})();
