// @ts-check
/* page-bulletins.js — Bulletins: a one-way class feed (docs/plans/bulletins-plan.md, slice B1c).
   The teacher writes to the class, students read it, and the teacher sees who
   has seen each bulletin. The tab, the address and this page exist only while
   the `bulletins` build switch is on (shared/build-flags.js).

   All reading and writing is shared/data-bulletins.js. This file draws:
   the header, the box that opens in place (the composer), the feed (pinned
   first, then newest first, under day headings), and each bulletin's Seen by
   list. The feed and the header draw again when the data changes; the
   composer never does, so what the teacher is typing stays put. The page
   reads when it opens, after each of its own writes, and every 15 seconds
   while the document is visible and this is the page showing. */
/** @type {any} */ (window).PageBulletins = (function () {
  'use strict';

  var REFRESH_MS = 15000;
  var FACES_LINE = "Check the photo for students' faces before you post.";
  var REACT_HINT = 'Students see Got It, Done and I Have a Question. Only you see who chose what.';

  var _cid = '';
  var _alive = false;
  var _timer = 0;
  /** @type {{ type: string, handler: any, options?: any }[]} */
  var _listeners = [];
  /** The open ⋯ menu's bulletin id, or ''. */
  var _menuId = '';
  /** @type {Record<string, { loading: boolean, data: any, names: boolean, again: string }>} */
  var _seen = {};
  /** @type {Record<string, Draft>} */
  var _drafts = {};
  var _opening = false;
  /** Where a link from the Dashboard's Bulletins tile points: a bulletin to scroll to, outline and (seen) open its Seen by list. */
  var _arrival = { id: '', seen: false };
  /** The bulletin outlined for a few seconds after an arrival, or ''. */
  var _arrivedId = '';
  var _arrivedTimer = 0;
  /** A sentence about one bulletin, shown beside it: bulletin id → sentence. */
  /** @type {Record<string, string>} */
  var _notes = {};
  var _lastHead = '';
  var _lastFeed = '';
  var _lastReturned = '';
  /** The bulletins drawn so far, by key, so a new one glides in; null before the first draw. @type {Record<string, boolean> | null} */
  var _known = null;

  /** @typedef {{ key: string, kind: string, title: string, pageCount: number, pages: any[] }} DraftFile */
  /** @typedef {{ open: boolean, editId: string, kind: string, body: string, linkOn: boolean, linkUrl: string, linkTitle: string, until: string, assessmentId: string, reactions: boolean, files: DraftFile[], note: string, busy: boolean, focus: string, nextFile: number }} Draft */

  /* ── Pure helpers (also exported for tests) ──────────────────── */

  /* ── Words and focus keepers: teacher/bulletins-format.js ────── */
  var F = /** @type {any} */ (window).BulletinsFormat;
  var dateLabel = F.dateLabel;
  var dayHeading = F.dayHeading;
  var returnedWhen = F.returnedWhen;
  var timeLabel = F.timeLabel;
  var kindLabel = F.kindLabel;
  var canSeeText = F.canSeeText;
  var headerNotes = F.headerNotes;
  var _focusSpec = F.focusSpec;
  var _controlOf = F.controlOf;
  var _applyFocus = F.applyFocus;

  /* ── Small DOM helpers ───────────────────────────────────────── */

  /** @param {string} id @returns {HTMLElement | null} */
  function _el(id) {
    return document.getElementById(id);
  }
  /** @param {string} id @returns {any} */
  function _any(id) {
    return document.getElementById(id);
  }
  /** Focus a bulletin's ⋯ button. @param {string} bid */
  function _focusMenuButton(bid) {
    var btn = _controlOf(_el('bulletin-feed'), bid, 'menu');
    if (btn) btn.focus();
  }

  /** Focus the closed box's Write to… button, when nothing else holds focus. */
  function _focusBar() {
    var a = document.activeElement;
    if (a && a !== document.body) return;
    var btn = /** @type {any} */ (document.querySelector('.bulletin-bar-open'));
    if (btn && typeof btn.focus === 'function') btn.focus();
  }

  /** @param {string} type @param {any} handler @param {any} [options] */
  function _listen(type, handler, options) {
    document.addEventListener(type, handler, options);
    _listeners.push({ type: type, handler: handler, options: options });
  }

  /** @param {string} cid @returns {Draft} */
  function _draft(cid) {
    if (!_drafts[cid]) {
      _drafts[cid] = {
        open: false,
        editId: '',
        kind: 'announcement',
        body: '',
        linkOn: false,
        linkUrl: '',
        linkTitle: '',
        until: '',
        assessmentId: '',
        reactions: false,
        files: [],
        note: '',
        busy: false,
        focus: '',
        nextFile: 1,
      };
    }
    return _drafts[cid];
  }

  /** @param {string} cid */
  function _resetDraft(cid) {
    delete _drafts[cid];
    return _draft(cid);
  }

  /** @param {string} id */
  function _nameOf(id) {
    var list = (typeof getStudents === 'function' && getStudents(_cid)) || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === id) return displayName(list[i]);
    }
    return 'A student';
  }
  /** @param {string[]} ids */
  function _names(ids) {
    return (ids || []).map(_nameOf).join(', ');
  }

  function _className() {
    var c = typeof COURSES !== 'undefined' && COURSES[_cid];
    return c && c.name ? String(c.name) : 'your class';
  }

  /* ── Header ──────────────────────────────────────────────────── */

  function _pausedNames() {
    var options = typeof getStudentPageOptions === 'function' ? getStudentPageOptions(_cid) : {};
    return Object.keys(options)
      .filter(function (id) {
        return options[id] && options[id].paused_at;
      })
      .map(_nameOf);
  }

  function _headHtml() {
    var meta = getBulletinsMeta(_cid);
    var h = '<h1 class="bulletin-title">Bulletins</h1>';
    if (bulletinsState(_cid) !== 'ok' && !_isDemo()) return h;
    if (!meta.page_on) {
      return (
        h +
        '<span class="bulletin-sub">Students cannot see Bulletins until the Student Page is turned on. ' +
        '<a href="' +
        esc(_manageHref()) +
        '">Class Settings →</a></span>'
      );
    }
    var notes = headerNotes(meta, _pausedNames());
    var s = esc(canSeeText(meta.can_see));
    if (notes.noCard) s += ' · <a href="' + esc(_manageHref()) + '">' + esc(notes.noCard) + '</a>';
    if (notes.paused) s += ' · ' + esc(notes.paused);
    return h + '<span class="bulletin-sub">' + s + '</span>';
  }

  function _isDemo() {
    return typeof isDemoMode === 'function' && isDemoMode();
  }
  function _manageHref() {
    return '/dashboard?course=' + encodeURIComponent(_cid) + '&manage=student-page';
  }

  function _drawHead() {
    var el = _el('bulletin-head');
    if (!el) return;
    var html = _headHtml();
    if (html === _lastHead && el.firstChild) return;
    _lastHead = html;
    // html-safe: the class name never reaches here; counts are numbers; names and the address are escaped above.
    el.innerHTML = html;
  }

  /* ── Composer ────────────────────────────────────────────────── */

  var ICON_FILE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/></svg>';
  var ICON_LINK =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/></svg>';

  /** @param {Draft} d */
  function _hasPhoto(d) {
    return d.files.some(function (f) {
      return f.kind === 'photo';
    });
  }
  /** @param {Draft} d */
  function _pageTotal(d) {
    return d.files.reduce(function (n, f) {
      return n + f.pageCount;
    }, 0);
  }

  /** The words in the box, with a link and files, as bulletinDraftProblem reads them. @param {Draft} d */
  function _asDraft(d) {
    return {
      cid: _cid,
      kind: d.kind,
      body: d.body,
      link_url: d.linkOn ? d.linkUrl : '',
      link_title: d.linkOn ? d.linkTitle : '',
      pinned_until: d.kind === 'reminder' ? d.until : '',
      assessment_id: d.assessmentId,
      reactions_on: d.reactions,
      files: d.files.map(function (f) {
        return { pages: f.pageCount };
      }),
    };
  }

  /** What stops a draft being posted: a sentence, or ''. Empty is '' too. @param {Draft} d */
  function _problem(d) {
    var p = bulletinDraftProblem(_asDraft(d));
    return p === 'Write something, add a link or add a file.' ? '' : p;
  }
  /** @param {Draft} d */
  function _canPost(d) {
    if (d.busy) return false;
    if (d.editId) {
      var current = getBulletins(_cid).filter(function (b) {
        return b.id === d.editId;
      })[0];
      var files = current ? current.files.length : 0;
      var body = d.body.trim();
      var link = d.linkOn ? d.linkUrl.trim() : '';
      return !!(body || link || files) && !_problem(d);
    }
    return !bulletinDraftProblem(_asDraft(d));
  }

  function _assessmentOptions(selected) {
    var list = (typeof getAssessments === 'function' && getAssessments(_cid)) || [];
    // An assessment still waiting to be saved has an id made here, which the server would not know: not offered.
    list = list.filter(function (a) {
      return _isDemo() || _isUuid(a.id);
    });
    var sorted = list.slice().sort(function (a, b) {
      return String(b.date || '') < String(a.date || '') ? -1 : 1;
    });
    return (
      '<option value="">None</option>' +
      sorted
        .map(function (a) {
          return (
            '<option value="' +
            esc(a.id) +
            '"' +
            (a.id === selected ? ' selected' : '') +
            '>' +
            esc(a.title || 'Untitled') +
            '</option>'
          );
        })
        .join('')
    );
  }

  /** @param {Draft} d */
  function _composerHtml(d) {
    var klass = esc(_className());
    var editing = !!d.editId;
    var h = '';
    // The closed bar.
    h +=
      '<div class="bulletin-card bulletin-bar" id="bulletin-bar"' +
      (d.open ? ' hidden' : '') +
      '>' +
      '<button type="button" class="bulletin-bar-open" data-bulletin="open">Write to ' +
      klass +
      '…</button>' +
      '<button type="button" class="bulletin-icon-btn" data-bulletin="open-file" aria-label="Add a File" title="Add a File">' +
      ICON_FILE +
      '</button>' +
      '<button type="button" class="bulletin-icon-btn" data-bulletin="open-link" aria-label="Add a Link" title="Add a Link">' +
      ICON_LINK +
      '</button></div>';
    // The open box.
    h +=
      '<div class="bulletin-card bulletin-compose' +
      (_opening ? ' bulletin-compose-opening' : '') +
      '" id="bulletin-compose"' +
      (d.open ? '' : ' hidden') +
      '><fieldset class="bulletin-set"' +
      (d.busy ? ' disabled' : '') +
      '>';
    h +=
      '<div class="seg bulletin-kinds" role="group" aria-label="Kind of Bulletin">' +
      ['announcement', 'reminder']
        .map(function (k) {
          return (
            '<button type="button" class="seg-btn" data-bulletin="kind" data-kind="' +
            k +
            '" aria-pressed="' +
            (d.kind === k) +
            '"' +
            (editing ? ' disabled' : '') +
            '>' +
            (k === 'reminder' ? 'Reminder' : 'Announcement') +
            '</button>'
          );
        })
        .join('') +
      '</div>';
    h +=
      '<label class="bulletin-vh" for="bulletin-words">Words</label>' +
      '<textarea class="bulletin-field" id="bulletin-words" rows="3" placeholder="Write to ' +
      klass +
      '">' +
      esc(d.body) +
      '</textarea>' +
      '<span class="bulletin-count" id="bulletin-count" hidden></span>';
    if (d.kind === 'reminder') {
      var current = editing
        ? getBulletins(_cid).filter(function (b) {
            return b.id === d.editId;
          })[0]
        : null;
      var canDate = !editing || (current && current.pinned);
      h += '<div class="bulletin-pair">';
      if (canDate) {
        h +=
          '<label class="bulletin-label" for="bulletin-until">Stays Pinned Until<input class="bulletin-field" type="date" id="bulletin-until" min="' +
          esc(typeof courseToday === 'function' ? courseToday(_cid) : getTodayStr()) +
          '" value="' +
          esc(d.until) +
          '"></label>';
      }
      h +=
        '<label class="bulletin-label" for="bulletin-linked">Linked To<select class="bulletin-field" id="bulletin-linked">' +
        _assessmentOptions(d.assessmentId) +
        '</select></label></div>';
    }
    if (d.linkOn) {
      h +=
        '<div class="bulletin-pair"><label class="bulletin-label" for="bulletin-link-url">Link Address' +
        '<input class="bulletin-field" type="url" inputmode="url" id="bulletin-link-url" placeholder="https://" value="' +
        esc(d.linkUrl) +
        '" autocomplete="off"></label>' +
        '<label class="bulletin-label" for="bulletin-link-title">Link Name (Optional)' +
        '<input class="bulletin-field" type="text" id="bulletin-link-title" value="' +
        esc(d.linkTitle) +
        '" autocomplete="off"></label></div>' +
        '<span class="bulletin-problem" id="bulletin-link-note" hidden></span>';
    }
    if (editing) {
      var cur = getBulletins(_cid).filter(function (b) {
        return b.id === d.editId;
      })[0];
      if (cur && cur.files.length) {
        h +=
          '<div class="bulletin-chips">' +
          cur.files
            .map(function (f) {
              return (
                '<div class="bulletin-chip"><span class="bulletin-chip-name">' +
                esc(f.title || (f.kind === 'pdf' ? 'PDF' : 'Photo')) +
                '</span><span class="bulletin-chip-pages">' +
                esc(f.page_count + (f.page_count === 1 ? ' page' : ' pages')) +
                '</span></div>'
              );
            })
            .join('') +
          '</div>';
      }
      h +=
        '<span class="bulletin-hint">Files cannot be changed after posting. Delete the bulletin and post it again to change one.</span>';
    } else if (d.files.length) {
      h +=
        '<div class="bulletin-chips">' +
        d.files
          .map(function (f, i) {
            return (
              '<div class="bulletin-chip"><span class="bulletin-chip-name">' +
              esc(f.title) +
              '</span><span class="bulletin-chip-pages">' +
              esc(f.pageCount + (f.pageCount === 1 ? ' page' : ' pages')) +
              '</span><button type="button" class="bulletin-text-btn is-danger" data-bulletin="remove-file" data-index="' +
              i +
              '">Remove</button></div>'
            );
          })
          .join('') +
        '</div>';
      if (_hasPhoto(d)) h += '<span class="bulletin-hint">' + esc(FACES_LINE) + '</span>';
    }
    h +=
      '<span class="bulletin-problem" id="bulletin-note" role="status"' +
      (d.note ? '' : ' hidden') +
      '>' +
      esc(d.note) +
      '</span>';
    h += '<div class="bulletin-actions">';
    if (!editing) {
      if (!d.linkOn)
        h += '<button type="button" class="bulletin-text-btn" data-bulletin="add-link">Add a Link</button>';
      h += '<button type="button" class="bulletin-text-btn" data-bulletin="add-file">Add a File</button>';
    }
    h +=
      '<button type="button" class="bulletin-switch" role="switch" data-bulletin="reactions" aria-checked="' +
      d.reactions +
      '"><span class="bulletin-switch-track" aria-hidden="true"><span class="bulletin-switch-knob"></span></span>Let Students React</button>' +
      '<span class="bulletin-actions-end"><button type="button" class="btn btn-ghost" data-bulletin="cancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" id="bulletin-post" data-bulletin="post"' +
      (_canPost(d) ? '' : ' disabled') +
      '>' +
      (editing ? 'Save' : d.busy ? 'Posting…' : 'Post') +
      '</button></span></div>';
    h += '<span class="bulletin-hint">' + esc(REACT_HINT) + '</span>';
    h +=
      '<input type="file" class="bulletin-file-input" id="bulletin-file-input" accept="image/*,.heic,.heif,application/pdf" multiple hidden>';
    h += '</fieldset></div>';
    return h;
  }

  /** Read what is typed into the box into the draft, before the box draws again. */
  function _readInputs() {
    var d = _draft(_cid);
    var words = _any('bulletin-words');
    if (words) d.body = String(words.value);
    var until = _any('bulletin-until');
    if (until) d.until = String(until.value || '');
    var linked = _any('bulletin-linked');
    if (linked) d.assessmentId = String(linked.value || '');
    var url = _any('bulletin-link-url');
    if (url) d.linkUrl = String(url.value);
    var title = _any('bulletin-link-title');
    if (title) d.linkTitle = String(title.value);
  }

  /** @param {boolean} [fresh] true when the draft was just set, so the old box's words are not read back over it */
  function _drawComposer(fresh) {
    var host = _el('bulletin-composer');
    if (!host) return;
    if (!fresh) _readInputs();
    var d = _draft(_cid);
    var held = d.focus ? null : _focusSpec(host);
    // html-safe: every word, name, date and address in the box is escaped; the rest is fixed markup.
    host.innerHTML = _composerHtml(d);
    _opening = false;
    var box = _el('bulletin-compose');
    if (box) {
      var animated = box;
      animated.addEventListener('animationend', function () {
        animated.classList.remove('bulletin-compose-opening');
      });
    }
    _syncBits();
    if (held && !_applyFocus(host, held) && d.open) {
      // The control is gone (a file taken out): focus goes to the next thing to do in the box.
      var next = /** @type {any} */ (host.querySelector('[data-bulletin="add-file"], #bulletin-words'));
      if (next) next.focus();
    }
    if (d.focus) {
      var focus = d.focus;
      d.focus = '';
      var target = focus === 'link' ? _any('bulletin-link-url') : focus === 'words' ? _any('bulletin-words') : null;
      if (target && typeof target.focus === 'function') target.focus();
      if (focus === 'file') {
        var input = _any('bulletin-file-input');
        if (input) input.click();
      }
    }
  }

  /** The count, the link note and the Post button follow what is typed, without drawing the box again. */
  function _syncBits() {
    var d = _draft(_cid);
    var len = d.body.trim().length;
    var count = _el('bulletin-count');
    if (count) {
      var near = len >= Math.floor(BULLETIN_WORDS_MAX * 0.9);
      count.hidden = !near;
      count.classList.toggle('is-over', len > BULLETIN_WORDS_MAX);
      count.textContent =
        len > BULLETIN_WORDS_MAX
          ? 'Over by ' + (len - BULLETIN_WORDS_MAX) + ' characters'
          : len + ' of ' + BULLETIN_WORDS_MAX;
    }
    var note = _el('bulletin-link-note');
    if (note) {
      var why = bulletinLinkProblem(d.linkUrl);
      note.hidden = !why;
      note.textContent = why;
    }
    var post = /** @type {HTMLButtonElement | null} */ (_el('bulletin-post'));
    if (post) post.disabled = !_canPost(d);
  }

  /** @param {string} note */
  function _say(note) {
    var d = _draft(_cid);
    d.note = note;
    var el = _el('bulletin-note');
    if (el) {
      el.textContent = note;
      el.hidden = !note;
    }
  }

  /** @param {{ focus?: string }} [opts] */
  function _openComposer(opts) {
    var d = _draft(_cid);
    _readInputs();
    var was = d.open;
    d.open = true;
    d.focus = (opts && opts.focus) || 'words';
    _opening = !was;
    _drawComposer();
  }

  function _closeComposer() {
    _resetDraft(_cid);
    _opening = false;
    _drawComposer(true);
    _focusBar();
  }

  /** Files chosen: each photo or PDF made into JPEG pages (shared/photo-shrink.js), added to the box. @param {FileList | File[]} chosen */
  function _addFiles(chosen) {
    var d = _draft(_cid);
    var list = Array.prototype.slice.call(chosen);
    if (!list.length) return Promise.resolve();
    if (!window.PhotoShrink) {
      _say("The file reader couldn't load. Check the connection and try again.");
      return Promise.resolve();
    }
    var chain = Promise.resolve();
    list.forEach(function (/** @type {File} */ file) {
      chain = chain.then(function () {
        return window.PhotoShrink.prepare(file, {
          openPdf: window.PhotoReaders && window.PhotoReaders.openPdf,
          maxPages: BULLETIN_PAGES_MAX,
        })
          .then(null, function () {
            return { ok: false };
          })
          .then(function (/** @type {any} */ out) {
            if (!out || !out.ok) return _say(_refusal(out));
            var pages = out.pages || [];
            if (_pageTotal(d) + pages.length > BULLETIN_PAGES_MAX) {
              return _say('A bulletin can hold up to ' + BULLETIN_PAGES_MAX + ' pages in all.');
            }
            var isPdf = out.kind === 'pdf';
            d.files.push({
              key: 'f' + d.nextFile++,
              kind: isPdf ? 'pdf' : 'photo',
              title: _fileTitle(file.name, isPdf),
              pageCount: pages.length,
              pages: pages,
            });
            _say('');
          });
      });
    });
    return chain.then(function () {
      if (_alive) _drawComposer();
    });
  }

  /** A file's name as students see it: without its ending, cleaned up. @param {string} name @param {boolean} isPdf */
  function _fileTitle(name, isPdf) {
    var t = String(name || '')
      .replace(/\.[A-Za-z0-9]{1,5}$/, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return (t || (isPdf ? 'PDF' : 'Photo')).slice(0, BULLETIN_NAME_MAX);
  }

  /** @param {any} out */
  function _refusal(out) {
    var R = (window.PhotoShrink && window.PhotoShrink.REASONS) || {};
    if (out && out.reason === R.TOO_MANY_PAGES) return 'That PDF has more than ' + BULLETIN_PAGES_MAX + ' pages.';
    if (out && out.reason === R.PDF_TOO_LARGE) return 'That PDF is too large. Save a smaller copy, then add it.';
    if (out && out.locked) return 'That PDF has a password. Save a copy without one, then add it.';
    // The words Add Work uses (shared/add-work-files.js): a photo the browser cannot read, and a PDF reader that did not load.
    if (out && out.kind === 'heic' && out.reason === R.NO_DECODER)
      return 'Save that photo as a JPEG first, then add it.';
    if (out && out.kind === 'pdf' && out.reason === R.NO_DECODER)
      return "The PDF reader couldn't load. Check the connection and try again.";
    if (out && out.reason === R.NO_DECODER) return "The file reader couldn't load. Check the connection and try again.";
    if (out && out.reason === R.OFFICE) return 'Save it as a PDF first.';
    if (out && out.reason === R.UNSUPPORTED) return 'Choose a photo or a PDF.';
    return "That file couldn't be read. Try another copy of it.";
  }

  /** The patch an edit sends: only what changed. @param {Draft} d @param {any} b */
  function _editPatch(d, b) {
    /** @type {Record<string, any>} */
    var patch = {};
    var body = d.body.trim();
    if (body !== b.body) patch.body = body;
    var link = d.linkOn ? d.linkUrl.trim() : '';
    if (link !== (b.link_url || '')) patch.link_url = link || null;
    var title = d.linkOn ? d.linkTitle.trim() : '';
    if (link && title !== (b.link_title || '')) patch.link_title = title || null;
    if (b.kind === 'reminder' && b.pinned) {
      if ((d.until || '') !== (b.pinned_until || '')) patch.pinned_until = d.until || null;
    }
    if (b.kind === 'reminder' && (d.assessmentId || '') !== (b.assessment_id || ''))
      patch.assessment_id = d.assessmentId || null;
    if (d.reactions !== b.reactions_on) patch.reactions_on = d.reactions;
    return patch;
  }

  function _post() {
    _readInputs();
    var d = _draft(_cid);
    if (d.busy) return;
    var cid = _cid;
    if (d.editId) {
      var b = getBulletins(cid).filter(function (x) {
        return x.id === d.editId;
      })[0];
      if (!b) return _closeComposer();
      var patch = _editPatch(d, b);
      if (!Object.keys(patch).length) return _closeComposer();
      var problem = bulletinDraftProblem(
        Object.assign(_asDraft(d), {
          files: b.files.map(function () {
            return { pages: 1 };
          }),
        }),
      );
      if (problem) return _say(problem);
      d.busy = true;
      _drawComposer();
      return void editBulletin(cid, b.id, patch).then(function (out) {
        var cur = _draft(cid);
        cur.busy = false;
        if (!out.ok) {
          cur.note = out.message || '';
          cur.focus = 'words';
          if (_alive && cid === _cid) _drawComposer(true);
          return;
        }
        _resetDraft(cid);
        if (_alive && cid === _cid) {
          _drawComposer(true);
          _focusBar();
        }
      });
    }
    var problemNow = bulletinDraftProblem(_asDraft(d));
    if (problemNow) return _say(problemNow);
    var withFiles = d.files.length > 0;
    if (withFiles && typeof navigator !== 'undefined' && navigator.onLine === false) {
      return _say('A file needs a connection. Your draft is kept; post it when you are back online.');
    }
    // What goes: a refusal gives the words back through the data layer's returned list (never over what is typed since).
    var snapshot = Object.assign({}, d, { files: d.files.slice() });
    var files = d.files.map(function (f) {
      return { kind: f.kind, title: f.title, pages: f.pages };
    });
    if (withFiles) {
      d.busy = true;
      _drawComposer();
    } else {
      _resetDraft(cid);
      _drawComposer(true);
      _focusBar();
    }
    postBulletin(cid, _asDraftForPost(snapshot), files).then(function (out) {
      // A post with no file that is refused is given back by the data layer (getReturnedBulletins): the
      // box is not touched here, so what is typed since is never overwritten or lost.
      if (withFiles) {
        var cur = _draft(cid);
        cur.busy = false;
        if (out.ok) _resetDraft(cid);
        else if (out.message) {
          // Nothing was posted and the draft was never cleared: the sentence goes beside it.
          cur.note = out.message;
          cur.focus = 'words';
        }
        if (_alive && cid === _cid) {
          _drawComposer(true);
          if (out.ok) _focusBar();
        }
      }
      if (_alive && cid === _cid) _drawFeed();
    });
  }

  /** @param {Draft} d */
  function _asDraftForPost(d) {
    return {
      kind: d.kind,
      body: d.body,
      link_url: d.linkOn ? d.linkUrl : '',
      link_title: d.linkOn ? d.linkTitle : '',
      pinned: d.kind === 'reminder',
      pinned_until: d.kind === 'reminder' ? d.until : '',
      assessment_id: d.kind === 'reminder' ? d.assessmentId : '',
      reactions_on: d.reactions,
    };
  }

  /** Open the box on a bulletin. @param {string} id */
  function _edit(id) {
    var b = getBulletins(_cid).filter(function (x) {
      return x.id === id;
    })[0];
    if (!b || b.waiting) return;
    var d = _resetDraft(_cid);
    d.open = true;
    d.editId = b.id;
    d.kind = b.kind;
    d.body = b.body;
    d.linkOn = !!b.link_url;
    d.linkUrl = b.link_url || '';
    d.linkTitle = b.link_title || '';
    d.until = b.pinned ? b.pinned_until || '' : '';
    d.assessmentId = b.assessment_id || '';
    d.reactions = b.reactions_on;
    d.focus = 'words';
    _opening = true;
    _menuId = '';
    _drawComposer(true);
    _drawFeed();
    var main = _el('main');
    if (main) main.scrollTop = 0;
  }

  /* ── Feed ────────────────────────────────────────────────────── */

  /** @param {any} f @param {string} bid */
  function _fileHtml(f, bid) {
    var shown = Math.min(4, f.page_count);
    var thumbs = '';
    if (f.status === 'ready' || f.paths.length) {
      for (var i = 0; i < shown; i++) {
        thumbs +=
          '<a class="bulletin-thumb-link" target="_blank" rel="noopener noreferrer" data-bulletin-page="' +
          i +
          '" data-file="' +
          esc(f.id) +
          '" data-bulletin-id="' +
          esc(bid) +
          '"><img class="bulletin-thumb" alt="Page ' +
          (i + 1) +
          ' of ' +
          esc(f.title || 'the file') +
          '"></a>';
      }
      if (f.page_count > shown)
        thumbs += '<span class="bulletin-thumb-more">+' + (f.page_count - shown) + ' more</span>';
    }
    return (
      '<div class="bulletin-file"><span class="bulletin-file-name">' +
      esc((f.kind === 'pdf' ? 'PDF · ' : '') + (f.title || (f.kind === 'pdf' ? 'PDF' : 'Photo'))) +
      '<span class="bulletin-file-pages">' +
      esc(f.page_count + (f.page_count === 1 ? ' page' : ' pages')) +
      '</span></span>' +
      (thumbs ? '<div class="bulletin-thumbs">' + thumbs + '</div>' : '') +
      '</div>'
    );
  }

  /** @param {any} b */
  function _linkHtml(b) {
    // From a real parse: the site's host, with any user name or password dropped (never split from the string).
    var shown = bulletinLinkShown(b.link_url);
    if (!shown) return '';
    return (
      '<a class="bulletin-linkcard" href="' +
      esc(shown.href) +
      '" target="_blank" rel="noopener noreferrer"><span class="bulletin-icon-btn" aria-hidden="true">' +
      ICON_LINK +
      '</span><span class="bulletin-linkcard-text"><span>' +
      esc(b.link_title || shown.host) +
      '</span><span class="bulletin-linkcard-host">' +
      esc(shown.host) +
      '</span><span class="bulletin-linkcard-host">Students are asked before it opens</span></span></a>'
    );
  }

  /** @param {any} b */
  function _factsHtml(b) {
    if (b.stalled) {
      return '<span class="bulletin-problem">Its file didn\'t finish uploading. Delete it and post again.</span>';
    }
    if (b.waiting) {
      var back = b.key && bulletinCanTakeBack(_cid, b.key);
      return (
        '<span>Not Sent Yet</span>' +
        (back
          ? '<button type="button" class="bulletin-text-btn" data-bulletin="take-back" data-key="' +
            esc(b.key) +
            '">Take It Back</button>'
          : '')
      );
    }
    var seen = Number(b.seen) || 0;
    var canSee = Number(b.can_see) || 0;
    var label = bulletinSeenText(seen, canSee);
    var split = label.indexOf(' · ');
    var inner =
      split < 0
        ? esc(label)
        : esc(label.slice(0, split)) + ' · <span class="bulletin-not-seen">' + esc(label.slice(split + 3)) + '</span>';
    var open = !!(_seen[b.id] && _seen[b.id].data !== undefined);
    var h =
      '<button type="button" class="bulletin-seen-btn" data-bulletin="seen" data-id="' +
      esc(b.id) +
      '" aria-expanded="' +
      open +
      '">' +
      inner +
      '</button>';
    var react = bulletinReactionText(b);
    if (react) h += '<span>' + esc(react) + '</span>';
    if (b.assessment_id) {
      var list = (typeof getAssessments === 'function' && getAssessments(_cid)) || [];
      var a = list.filter(function (x) {
        return x.id === b.assessment_id;
      })[0];
      if (a) {
        h +=
          '<span>Linked to <a href="/assignments?course=' +
          esc(encodeURIComponent(_cid)) +
          '&amp;open=' +
          esc(encodeURIComponent(a.id)) +
          '">' +
          esc(a.title || 'Untitled') +
          '</a></span>';
      }
    }
    return h;
  }

  /** @param {any} b */
  function _menuHtml(b) {
    if (b.waiting) {
      // A bulletin the server holds whose file did not finish uploading can only be deleted.
      if (b.stalled) {
        return (
          '<div class="bulletin-more"><button type="button" class="bulletin-more-btn" data-bulletin="menu" data-id="' +
          esc(b.id) +
          '" aria-label="More" aria-haspopup="menu" aria-expanded="' +
          (_menuId === b.id) +
          '">⋯</button><div class="bulletin-menu" role="menu"' +
          (_menuId === b.id ? '' : ' hidden') +
          '><button type="button" role="menuitem" class="bulletin-menu-item is-danger" data-bulletin="delete" data-id="' +
          esc(b.id) +
          '">Delete</button></div></div>'
        );
      }
      return '';
    }
    var id = esc(b.id);
    var open = _menuId === b.id;
    return (
      '<div class="bulletin-more"><button type="button" class="bulletin-more-btn" data-bulletin="menu" data-id="' +
      id +
      '" aria-label="More" aria-haspopup="menu" aria-expanded="' +
      open +
      '">⋯</button><div class="bulletin-menu" role="menu"' +
      (open ? '' : ' hidden') +
      '><button type="button" role="menuitem" class="bulletin-menu-item" data-bulletin="edit" data-id="' +
      id +
      '">Edit</button><button type="button" role="menuitem" class="bulletin-menu-item" data-bulletin="pin" data-id="' +
      id +
      '" data-pinned="' +
      b.pinned +
      '">' +
      (b.pinned ? 'Unpin' : 'Pin') +
      '</button><button type="button" role="menuitem" class="bulletin-menu-item is-danger" data-bulletin="delete" data-id="' +
      id +
      '">Delete</button></div></div>'
    );
  }

  /** The list under a bulletin: who has not seen it first. @param {any} b */
  function _seenHtml(b) {
    var st = _seen[b.id];
    var open = !!st && st.data !== undefined;
    var h = '<div class="bulletin-seenlist" data-for="' + esc(b.id) + '"' + (open ? '' : ' hidden') + '>';
    if (open) {
      var data = st.data;
      if (st.loading && !data) h += '<span class="bulletin-seen-aside">Reading…</span>';
      else if (!data || !data.ok)
        h += '<span class="bulletin-seen-aside">Who has seen it could not be read. Try again in a moment.</span>';
      else {
        var n = data.not_seen.length;
        if (n) {
          h +=
            '<span class="bulletin-seen-head">Not Seen Yet · ' +
            n +
            '</span><span class="bulletin-seen-names">' +
            esc(_names(data.not_seen)) +
            '</span>';
          if (st.again === 'done')
            h +=
              '<span class="bulletin-seen-aside">Shown again on ' + n + (n === 1 ? ' phone.' : ' phones.') + '</span>';
          else
            h +=
              '<button type="button" class="btn btn-ghost bulletin-seen-act" data-bulletin="again" data-id="' +
              esc(b.id) +
              '"' +
              (st.again === 'busy' ? ' disabled' : '') +
              '>Show It Again on ' +
              (n === 1 ? 'This 1 Phone' : 'These ' + n + ' Phones') +
              '</button>';
        } else if (b.can_see > 0) h += '<span class="bulletin-seen-aside">Everyone who can see it has seen it.</span>';
        if (data.paused.length) {
          h +=
            '<span class="bulletin-seen-aside">' +
            esc(
              data.paused.length <= 2
                ? _names(data.paused).replace(/, /g, ' and ') + ' Not Counted (Page Paused)'
                : data.paused.length + ' Not Counted (Page Paused)',
            ) +
            '</span>';
        }
        if (data.no_card.length) {
          h +=
            '<span class="bulletin-seen-aside"><a href="' +
            esc(_manageHref()) +
            '" class="bulletin-note-link">' +
            esc(data.no_card.length + ' Have No Card Yet') +
            '</a></span>';
        }
        // Names only where they are for acting on (board B3): who has a question. Got It and Done are counts on the facts line.
        if (b.reactions_on && data.reactions.question && data.reactions.question.length) {
          h +=
            '<span class="bulletin-seen-head">' +
            esc(BULLETIN_REACTION_WORDS.question) +
            ' · ' +
            data.reactions.question.length +
            '</span><span class="bulletin-seen-names">' +
            esc(_names(data.reactions.question)) +
            '</span>';
        }
        if (data.seen.length) {
          h +=
            '<button type="button" class="bulletin-text-btn bulletin-seen-act" data-bulletin="seen-names" data-id="' +
            esc(b.id) +
            '">' +
            (st.names ? 'Hide Who Has Seen It' : 'Show Who Has Seen It (' + data.seen.length + ')') +
            '</button>';
          if (st.names) h += '<span class="bulletin-seen-names">' + esc(_names(data.seen)) + '</span>';
        }
      }
    }
    return h + '</div>';
  }

  /** @param {any} b */
  function _postHtml(b) {
    var when = b.posted_at || b.created_at || '';
    var h =
      '<article class="bulletin-card bulletin-post' +
      (b.id === _arrivedId ? ' bulletin-arrived" tabindex="-1' : '') +
      '" data-bulletin-id="' +
      esc(b.id) +
      '" data-bulletin-key="' +
      esc(b.key || b.idempotency_key || b.id) +
      '">';
    h +=
      '<div class="bulletin-meta"><span class="bulletin-kind-label">' +
      esc(kindLabel(b)) +
      '</span><span class="bulletin-time">' +
      esc(timeLabel(when)) +
      '</span></div>';
    if (b.body) h += '<div class="bulletin-body">' + esc(b.body) + '</div>';
    h += _linkHtml(b);
    (b.files || []).forEach(function (/** @type {any} */ f) {
      h += _fileHtml(f, b.id);
    });
    h += '<div class="bulletin-foot">' + _factsHtml(b) + _menuHtml(b) + '</div>';
    if (_notes[b.id]) h += '<span class="bulletin-problem" role="status">' + esc(_notes[b.id]) + '</span>';
    if (!b.waiting) h += _seenHtml(b);
    return h + '</article>';
  }

  function _feedHtml() {
    var state = bulletinsState(_cid);
    if (!_isDemo()) {
      if (state === 'missing')
        return '<div class="bulletin-card bulletin-unavailable">Bulletins are not available yet.</div>';
      if (state !== 'ok') {
        return state === 'failed'
          ? '<div class="bulletin-card bulletin-unavailable">Bulletins could not be read. Try again in a moment.</div>'
          : '';
      }
    }
    var list = getBulletins(_cid);
    if (!list.length) return '<div class="bulletin-empty">Nothing posted yet. Write the first bulletin above.</div>';
    var h = '';
    var pinned = list.filter(function (b) {
      return b.pinned;
    });
    if (pinned.length) {
      h += '<span class="bulletin-day">Pinned</span>';
      pinned.forEach(function (b) {
        h += _postHtml(b);
      });
    }
    var lastDay = '';
    list.forEach(function (b) {
      if (b.pinned) return;
      var day = dayHeading(b.posted_at || b.created_at || '');
      if (day !== lastDay) {
        h += '<span class="bulletin-day">' + esc(day) + '</span>';
        lastDay = day;
      }
      h += _postHtml(b);
    });
    return h;
  }

  /** @param {boolean} [force] draw even when the markup is the same */
  function _drawFeed(force) {
    var el = _el('bulletin-feed');
    if (!el) return;
    var html = _feedHtml();
    // Nothing changed (the 15-second read found the same bulletins): the page is left as it is, focus included.
    if (!force && html === _lastFeed && el.firstChild) return;
    _lastFeed = html;
    var held = _focusSpec(el);
    // html-safe: every word, name, date, address and title in the feed is escaped; counts are numbers; the rest is fixed markup.
    el.innerHTML = html;
    var cards = el.querySelectorAll('article[data-bulletin-id]');
    /** @type {Record<string, boolean>} */
    var now = {};
    for (var i = 0; i < cards.length; i++) {
      var card = /** @type {HTMLElement} */ (cards[i]);
      var key = card.getAttribute('data-bulletin-key') || '';
      now[key] = true;
      // A bulletin that was not here before glides in (150 to 250 ms; none under Reduce Motion, in the CSS).
      if (_known && !_known[key]) {
        card.classList.add('bulletin-glide');
        card.addEventListener('animationend', function (/** @type {any} */ e) {
          if (e.currentTarget) e.currentTarget.classList.remove('bulletin-glide');
        });
        // Under Reduce Motion there is no animation to end: the class goes anyway.
        window.setTimeout(card.classList.remove.bind(card.classList, 'bulletin-glide'), 400);
      }
    }
    _known = now;
    if (held) _applyFocus(el, held);
    _loadPictures();
  }

  /** The first pages of each file draw as pictures once their addresses are ready. */
  function _loadPictures() {
    var cid = _cid;
    var list = getBulletins(cid);
    var links = document.querySelectorAll('#bulletin-feed .bulletin-thumb-link');
    Array.prototype.forEach.call(links, function (/** @type {HTMLAnchorElement} */ link) {
      var b = list.filter(function (x) {
        return x.id === link.dataset.bulletinId;
      })[0];
      var f =
        b &&
        b.files.filter(function (x) {
          return x.id === link.dataset.file;
        })[0];
      if (!f) return;
      var i = Number(link.dataset.bulletinPage) || 0;
      getBulletinPage(cid, f, i).then(function (pic) {
        if (!pic || !_alive || cid !== _cid || !link.isConnected) return;
        var img = link.querySelector('img');
        if (img) img.src = pic.url;
        // Opens in a new tab only from a blob: or this site's own picture; never from a data: address.
        if (/^(blob:|\/assets\/)/.test(pic.url)) link.href = pic.url;
      });
    });
  }

  /* ── Refreshing ──────────────────────────────────────────────── */

  /** @param {boolean} [force] */
  function _refresh(force) {
    var cid = _cid;
    return refreshBulletins(cid, {
      force: !!force,
      stillShown: function () {
        return _alive && cid === _cid;
      },
    });
  }

  /** The data changed: the header and the feed draw again; each open Seen by list reads again. */
  function _onChanged(e) {
    if (!_alive) return;
    var cid = e && e.detail && e.detail.cid;
    if (cid && cid !== _cid) return;
    var wantComposer = _isDemo() || bulletinsState(_cid) !== 'missing';
    if (!!_el('bulletin-composer') !== wantComposer) render();
    _drawHead();
    _drawFeed();
    _syncBits();
    _adoptReturned();
    _arrive();
    Object.keys(_seen).forEach(function (id) {
      if (_seen[id] && _seen[id].data !== undefined && !_seen[id].loading) _loadSeen(id, true);
    });
  }

  /** @param {string} id @returns {HTMLElement | null} */
  function _cardOf(id) {
    var cards = document.querySelectorAll('.bulletin-post');
    for (var i = 0; i < cards.length; i++) {
      var c = /** @type {HTMLElement} */ (cards[i]);
      if (c.dataset.bulletinId === id) return c;
    }
    return null;
  }

  /** A link from the Dashboard's tile (?open=<id> or ?seen=<id>): scroll to that bulletin and outline it; ?seen also opens its Seen by list. Waits until the bulletin is on the page. */
  function _arrive() {
    var id = _arrival.id;
    if (!id || !_alive || !_cardOf(id)) return;
    var withSeen = _arrival.seen && id.indexOf('waiting:') !== 0;
    _arrival = { id: '', seen: false };
    _arrivedId = id;
    if (withSeen && !_seen[id]) _loadSeen(id, false);
    _drawFeed();
    var card = _cardOf(id);
    if (card) card.scrollIntoView({ block: 'start' });
    // Keyboard focus goes with the eye: the Seen by control for ?seen, else the card.
    var target = (withSeen && _controlOf(_el('bulletin-feed'), id, 'seen')) || card;
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
    if (_arrivedTimer) window.clearTimeout(_arrivedTimer);
    _arrivedTimer = window.setTimeout(function () {
      _arrivedTimer = 0;
      var now = _cardOf(id);
      _arrivedId = '';
      if (now) now.classList.remove('bulletin-arrived');
    }, 4000);
  }

  /** @param {string} id @param {boolean} [quiet] */
  function _loadSeen(id, quiet) {
    var cid = _cid;
    var st = _seen[id] || (_seen[id] = { loading: false, data: undefined, names: false, again: '' });
    st.loading = true;
    if (!quiet && st.data === undefined) st.data = null;
    return getBulletinSeen(cid, id).then(function (data) {
      if (!_alive || cid !== _cid || !_seen[id]) return;
      st.loading = false;
      st.data = data;
      _drawFeed();
    });
  }

  function _startTimer() {
    _stopTimer();
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    _timer = window.setInterval(function () {
      if (_alive && document.visibilityState !== 'hidden') _refresh(false);
    }, REFRESH_MS);
  }
  function _stopTimer() {
    if (_timer) window.clearInterval(_timer);
    _timer = 0;
  }
  function _onVisibility() {
    if (!_alive) return;
    if (document.visibilityState === 'hidden') _stopTimer();
    else {
      _refresh(false);
      _startTimer();
    }
  }

  /* ── Events ──────────────────────────────────────────────────── */

  /** Focus the first item of a bulletin's open menu. @param {string} bid */
  function _focusMenuItem(bid) {
    var menu = _controlOf(_el('bulletin-feed'), bid, 'menu');
    var item = menu && menu.parentNode ? menu.parentNode.querySelector('[role="menuitem"]') : null;
    if (item) item.focus();
  }

  /** @param {Draft} d */
  function _draftEmpty(d) {
    return !d.editId && !d.body.trim() && !d.linkUrl.trim() && !d.files.length;
  }

  /** Put a returned bulletin's words in the box. @param {Draft} d @param {{ bulletin: Record<string, any> }} e */
  function _loadReturned(d, e) {
    var b = e.bulletin || {};
    d.editId = '';
    d.kind = b.kind === 'reminder' ? 'reminder' : 'announcement';
    d.body = String(b.body || '');
    d.linkOn = !!b.link_url;
    d.linkUrl = String(b.link_url || '');
    d.linkTitle = String(b.link_title || '');
    d.until = String(b.pinned_until || '');
    d.assessmentId = String(b.assessment_id || '');
    d.reactions = b.reactions_on === true;
    d.files = [];
  }

  /**
   * Bulletins that were not posted (refused, or lost from the outbox) come
   * back: into the box when it is empty, with one plain sentence; otherwise
   * as a line under the box that asks before it replaces what is typed.
   */
  function _adoptReturned() {
    var list = getReturnedBulletins(_cid);
    if (list.length && _el('bulletin-composer')) {
      _readInputs();
      var d = _draft(_cid);
      if (!d.busy && _draftEmpty(d)) {
        var e = list[list.length - 1];
        _loadReturned(d, e);
        dropReturnedBulletin(_cid, e.key);
        d.note =
          'Your bulletin from ' +
          returnedWhen(e.at) +
          " wasn't posted, so its words are back in the box." +
          (e.message ? ' ' + e.message : '');
        d.open = true;
        d.focus = '';
        _opening = true;
        _drawComposer(true);
      }
    }
    _drawReturned();
  }

  function _drawReturned() {
    var host = _el('bulletin-returned');
    if (!host) return;
    var html = getReturnedBulletins(_cid)
      .map(function (e) {
        return (
          '<div class="bulletin-card bulletin-returned-line" role="status"><span>Your bulletin from ' +
          esc(returnedWhen(e.at)) +
          " wasn't posted." +
          (e.message ? ' ' + esc(e.message) : '') +
          '</span><button type="button" class="bulletin-text-btn" data-bulletin="put-back" data-key="' +
          esc(e.key) +
          '">Put It Back in the Box</button><button type="button" class="bulletin-text-btn" data-bulletin="drop-returned" data-key="' +
          esc(e.key) +
          '">Dismiss</button></div>'
        );
      })
      .join('');
    if (html === _lastReturned) return;
    _lastReturned = html;
    var held = _focusSpec(host);
    // html-safe: the time and the sentence are escaped; the key is a uuid made on this device; the rest is fixed markup.
    host.innerHTML = html;
    if (held) _focusBar();
  }

  /** Put a returned bulletin back in the box, asking first when the box holds words. @param {string} key */
  function _putBack(key) {
    var cid = _cid;
    var e = getReturnedBulletins(cid).filter(function (x) {
      return x.key === key;
    })[0];
    if (!e) return;
    var go = function () {
      var d = _draft(cid);
      _loadReturned(d, e);
      d.note = '';
      d.open = true;
      d.focus = 'words';
      _opening = true;
      dropReturnedBulletin(cid, key);
      if (_alive && cid === _cid) {
        _drawComposer(true);
        _drawReturned();
      }
    };
    _readInputs();
    if (_draftEmpty(_draft(cid))) return go();
    showConfirm(
      'Put It Back in the Box?',
      'The box holds words you have not posted. Put the other bulletin there instead? What is in the box now is replaced.',
      'Put It Back',
      'primary',
      go,
      'Keep What I Have',
    );
  }

  function _closeMenu() {
    if (!_menuId) return;
    _menuId = '';
    _drawFeed();
  }

  /** @param {any} e */
  function _onClick(e) {
    if (!_alive) return;
    var target = /** @type {Element | null} */ (e.target);
    var el = target && target.closest ? /** @type {HTMLElement | null} */ (target.closest('[data-bulletin]')) : null;
    // A click outside an open menu closes it.
    if (_menuId && !(target && target.closest && target.closest('.bulletin-more'))) _closeMenu();
    if (!el || !el.closest('.bulletin-page')) return;
    var action = el.dataset.bulletin;
    var id = el.dataset.id || '';
    var d = _draft(_cid);
    // Whatever was said beside a bulletin is cleared when the teacher does something else to it.
    if (id && _notes[id]) delete _notes[id];
    switch (action) {
      case 'open':
        return _openComposer();
      case 'open-file':
        return _openComposer({ focus: 'file' });
      case 'open-link':
        d.linkOn = true;
        return _openComposer({ focus: 'link' });
      case 'add-link':
        _readInputs();
        d.linkOn = true;
        d.focus = 'link';
        return _drawComposer();
      case 'add-file': {
        var input = _any('bulletin-file-input');
        if (input) input.click();
        return;
      }
      case 'remove-file':
        _readInputs();
        d.files.splice(Number(el.dataset.index), 1);
        _say('');
        return _drawComposer();
      case 'kind':
        _readInputs();
        d.kind = el.dataset.kind === 'reminder' ? 'reminder' : 'announcement';
        return _drawComposer();
      case 'reactions':
        _readInputs();
        d.reactions = !d.reactions;
        return _drawComposer();
      case 'cancel':
        return _closeComposer();
      case 'post':
        return _post();
      case 'menu': {
        var opening = _menuId !== id;
        _menuId = opening ? id : '';
        _drawFeed();
        if (opening) _focusMenuItem(id);
        else _focusMenuButton(id);
        return;
      }
      case 'edit':
        return _edit(id);
      case 'pin': {
        _menuId = '';
        _drawFeed();
        _focusMenuButton(id);
        var pinned = el.dataset.pinned === 'true';
        var cidNow = _cid;
        return void setBulletinPinned(cidNow, id, !pinned).then(function (out) {
          // Said beside the bulletin it is about, where the teacher is looking.
          if (!out.ok && out.message && _alive && cidNow === _cid) {
            _notes[id] = out.message;
            _drawFeed();
          }
        });
      }
      case 'delete':
        _menuId = '';
        _drawFeed();
        // The confirm gives focus back to what had it when it opened: the ⋯ button.
        _focusMenuButton(id);
        return _confirmDelete(id);
      case 'put-back':
        return _putBack(el.dataset.key || '');
      case 'drop-returned':
        dropReturnedBulletin(_cid, el.dataset.key || '');
        _drawReturned();
        // The line had focus and is gone: it goes to the words when the box is open, else to the box's bar.
        if (_draft(_cid).open && _any('bulletin-words')) return _any('bulletin-words').focus();
        return _focusBar();
      case 'seen': {
        var st = _seen[id];
        if (st && st.data !== undefined) {
          delete _seen[id];
          return _drawFeed();
        }
        _seen[id] = { loading: true, data: null, names: false, again: '' };
        _drawFeed();
        return void _loadSeen(id, false);
      }
      case 'seen-names':
        if (_seen[id]) _seen[id].names = !_seen[id].names;
        return _drawFeed();
      case 'again':
        return _showAgain(id);
      case 'take-back':
        takeBackBulletin(_cid, el.dataset.key || '');
        _drawFeed();
        return _focusBar();
    }
  }

  /** @param {string} id */
  function _confirmDelete(id) {
    var b = getBulletins(_cid).filter(function (x) {
      return x.id === id;
    })[0];
    if (!b) return;
    var message = 'Delete this bulletin? Students will no longer see it, and who has seen it is deleted too.';
    if (b.files && b.files.length) message += " Its file is deleted and can't come back.";
    var cid = _cid;
    showConfirm(
      'Delete Bulletin',
      message,
      'Delete',
      'danger',
      function () {
        delete _seen[id];
        deleteBulletin(cid, id).then(function (out) {
          if (!_alive || cid !== _cid) return;
          if (!out.ok && out.message && !out.gone) {
            _notes[id] = out.message;
            _drawFeed();
          }
          // The bulletin that had focus is gone: focus goes to the box at the top.
          _focusBar();
        });
      },
      'Keep It',
    );
  }

  /** @param {string} id */
  function _showAgain(id) {
    var st = _seen[id];
    if (!st || st.again === 'busy') return;
    st.again = 'busy';
    _drawFeed();
    var cid = _cid;
    showBulletinAgain(cid, id).then(function (out) {
      if (!_alive || cid !== _cid) return;
      if (out.gone) {
        // Deleted a moment before: it is gone, so it leaves the page.
        delete _seen[id];
        _notes[id] = out.message || '';
        _drawFeed();
        return;
      }
      if (!_seen[id]) return;
      _seen[id].again = out.ok ? 'done' : '';
      if (!out.ok && out.message) _notes[id] = out.message;
      _drawFeed();
      var a = document.activeElement;
      if (!a || a === document.body) {
        var back = _controlOf(_el('bulletin-feed'), id, 'seen');
        if (back) back.focus();
      }
    });
  }

  /** @param {any} e */
  function _onInput(e) {
    if (!_alive) return;
    var id = e.target && e.target.id;
    if (
      id === 'bulletin-words' ||
      id === 'bulletin-link-url' ||
      id === 'bulletin-link-title' ||
      id === 'bulletin-until' ||
      id === 'bulletin-linked'
    ) {
      _readInputs();
      _syncBits();
    }
  }

  /** @param {any} e */
  function _onChange(e) {
    if (!_alive) return;
    var t = e.target;
    if (t && t.id === 'bulletin-file-input') {
      var files = t.files ? Array.prototype.slice.call(t.files) : [];
      t.value = '';
      _addFiles(files);
    } else if (t && (t.id === 'bulletin-until' || t.id === 'bulletin-linked')) {
      _readInputs();
      _syncBits();
    }
  }

  /** @param {any} e */
  function _onKeydown(e) {
    if (!_alive) return;
    if (e.key === 'Escape' && _menuId) {
      var was = _menuId;
      _closeMenu();
      _focusMenuButton(was);
    }
  }

  /* ── Class switch, init, destroy ─────────────────────────────── */

  /** @param {string} cid */
  async function switchCourse(cid) {
    _cid = cid;
    if (!(await switchActiveCourse(cid))) return;
    var side = document.getElementById('sidebar-mount');
    if (side) side.innerHTML = renderSidebar(cid);
    _menuId = '';
    _seen = {};
    _notes = {};
    releaseBulletinPictures();
    render();
  }

  function render() {
    var main = _el('main');
    if (!main) return;
    _readInputs();
    var offeredNothing = !_isDemo() && bulletinsState(_cid) === 'missing';
    // html-safe: fixed markup; the header, composer and feed draw their own escaped parts below.
    main.innerHTML =
      '<div class="bulletin-page"><div class="bulletin-col">' +
      '<div class="bulletin-top" id="bulletin-head"></div>' +
      (offeredNothing ? '' : '<div id="bulletin-composer"></div>') +
      '<div id="bulletin-returned"></div>' +
      '<div id="bulletin-feed"></div>' +
      '</div></div>';
    _lastHead = '';
    _lastFeed = '';
    _lastReturned = '';
    _known = null;
    _drawHead();
    if (!offeredNothing) _drawComposer();
    _drawFeed(true);
    _adoptReturned();
  }

  /** @param {{ course?: string, write?: string, open?: string, seen?: string }} [params] */
  function init(params) {
    _cid = (params && params.course) || getActiveCourse();
    setActiveCourse(_cid);
    _alive = true;
    _menuId = '';
    _seen = {};
    _notes = {};
    _opening = false;
    _arrivedId = '';
    var side = document.getElementById('sidebar-mount');
    if (side) {
      side.style.display = '';
      side.innerHTML = renderSidebar(_cid);
    }
    var layout = document.getElementById('page-layout');
    if (layout) layout.classList.remove('sidebar-hidden');
    if (typeof initSidebarToggle === 'function') initSidebarToggle();
    /** @type {any} */ (window)._pageSwitchCourse = switchCourse;

    _listen('click', _onClick);
    _listen('input', _onInput);
    _listen('change', _onChange);
    _listen('keydown', _onKeydown);
    _listen('visibilitychange', _onVisibility);
    _listen('fv:bulletins-changed', _onChanged);

    render();
    // The Dashboard tile's links: ?write=1 opens the box, ?open=<id> and ?seen=<id> go to a bulletin.
    var p = params || {};
    _arrival = { id: p.seen || p.open || '', seen: !!p.seen };
    if (p.write === '1') _openComposer();
    if (p.write || p.open || p.seen) {
      try {
        history.replaceState(null, '', '/bulletins?course=' + encodeURIComponent(_cid));
      } catch (e) {
        /* the address stays as it was */
      }
    }
    _arrive();
    var cid = _cid;
    _refresh(true);
    // Who is paused comes from the class's per-student options.
    if (typeof loadStudentPageOptions === 'function') {
      Promise.resolve(loadStudentPageOptions(cid, false)).then(function () {
        if (_alive && cid === _cid) _drawHead();
      });
    }
    _startTimer();
    requestAnimationFrame(function () {
      var main = _el('main');
      if (main) main.scrollTop = 0;
    });
  }

  function destroy() {
    _alive = false;
    _stopTimer();
    if (_arrivedTimer) window.clearTimeout(_arrivedTimer);
    _arrivedTimer = 0;
    _arrival = { id: '', seen: false };
    _listeners.forEach(function (l) {
      document.removeEventListener(l.type, l.handler, l.options);
    });
    _listeners = [];
    _menuId = '';
    _seen = {};
    releaseBulletinPictures();
    delete (/** @type {any} */ (window)._pageSwitchCourse);
  }

  return {
    init: init,
    destroy: destroy,
    render: render,
    _helpers: {
      dayHeading: dayHeading,
      timeLabel: timeLabel,
      kindLabel: kindLabel,
      dateLabel: dateLabel,
      canSeeText: canSeeText,
      headerNotes: headerNotes,
      returnedWhen: returnedWhen,
      refusal: _refusal,
    },
  };
})();
