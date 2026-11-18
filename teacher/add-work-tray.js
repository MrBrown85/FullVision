// @ts-check
/* ── add-work-tray.js — Add Work for the Class: files matched by name (B3) ──
   The files a teacher drops on the page but not on a student, or chooses
   from the tray's buttons (Choose Files…, Choose a Folder…), and the
   Waiting for a Student tray for those that can't be matched for certain
   (docs/plans/add-work-for-class-plan.md, B3; the "Column, Files Waiting"
   and "Grid" boards).

   Each file's name is read here, in the browser, by NameMatch
   (shared/name-match.js), and only the screen shows it: pages are renamed
   page-1.jpg … as they are held, and again by the staging model. A
   doubtful match is never taken. A certain one ('one') is placed on its
   student; a close spelling, two students who fit, and no fit wait here
   for the teacher, who places each one with a click or a drag.

   Exactly one PDF that matches no student for certain opens Split the
   Scan (teacher/add-work-split.js, B2) when that page is there.

   AddWorkTray.create(host) → a tray for one open class page. host:
     alive()           the page is still the one this tray was made for
     busy()            Add Work is running, or the page shows its summary
     roster()          every student of the class (names are matched to all)
     rows()            the ids the page lists, in roster order
     full(sid), first(sid)   names for the screen
     place(pieces)     [{ sid, from, pages, url }] onto the stage, no draw:
                       → [{ ok, piece, reason }]
     draw(opts)        the page drawn again ({ focus, glideFrom })
     layout()          'column' or 'grid'
     cid, aid */
/** @type {any} */ (window).AddWorkTray = (function () {
  'use strict';

  // The page's own chooser takes these (teacher/add-work-class.js).
  var ACCEPT = 'image/*,.heic,.heif,application/pdf';
  var MAX_FILES = 300;
  var DRAW_MS = 120;
  // What PhotoShrink reads, and the Office files it refuses with "Save it as a PDF first."
  var READS = /\.(jpe?g|png|webp|heic|heif|gif|bmp|tiff?|pdf|docx?|docm|dotx?|pptx?|pptm|ppsx?|potx?)$/i;

  var UP_ICON =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V4M7 9l5-5 5 5"></path><path d="M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"></path></svg>';
  var X_ICON =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg>';
  var DOWN_ICON =
    '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"></path></svg>';

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function _fileName(file) {
    return String((file && file.name) || '');
  }

  // A hidden file or one inside a hidden folder (.DS_Store, __MACOSX).
  function _hidden(file) {
    var path = String((file && (file.webkitRelativePath || file.name)) || '');
    return path.split('/').some(function (part) {
      return part.charAt(0) === '.' || part === '__MACOSX';
    });
  }

  function _readable(file) {
    var type = String((file && file.type) || '');
    return type.indexOf('image/') === 0 || type === 'application/pdf' || READS.test(_fileName(file));
  }

  function _isPdf(file) {
    return String((file && file.type) || '') === 'application/pdf' || /\.pdf$/i.test(_fileName(file));
  }

  function _thumbUrl(page) {
    if (!page || !page.thumb || typeof URL === 'undefined' || !URL.createObjectURL) return '';
    try {
      return URL.createObjectURL(page.thumb);
    } catch (e) {
      return '';
    }
  }
  function _revoke(url) {
    if (!url) return;
    try {
      URL.revokeObjectURL(url);
    } catch (e) {
      /* nothing held */
    }
  }

  // Each page a copy with no file name in it; the stage renames them again.
  function _nameless(pages) {
    return (pages || []).map(function (p, i) {
      var copy = Object.assign({}, p);
      copy.name = 'page-' + (i + 1) + '.jpg';
      return copy;
    });
  }

  /* A folder dropped: every file in it and its sub-folders, hidden ones
     left out, until MAX_FILES + 1 photos and PDFs are found (so the page
     knows there were more).
     → Promise of File[]. */
  function _walk(entries) {
    var out = [];
    var used = 0;
    function full() {
      return used > MAX_FILES;
    }
    function entry(e) {
      if (!e || full() || String(e.name || '').charAt(0) === '.' || e.name === '__MACOSX') return Promise.resolve();
      if (e.isFile) {
        return new Promise(function (done) {
          e.file(
            function (f) {
              if (!full()) {
                out.push(f);
                if (_readable(f)) used++;
              }
              done(undefined);
            },
            function () {
              done(undefined);
            },
          );
        });
      }
      if (!e.isDirectory || !e.createReader) return Promise.resolve();
      var reader = e.createReader();
      // readEntries hands back a batch at a time, then an empty one.
      function batch() {
        return new Promise(function (done) {
          reader.readEntries(
            function (list) {
              done(list || []);
            },
            function () {
              done([]);
            },
          );
        }).then(function (list) {
          if (!list.length || full()) return;
          return list
            .reduce(function (p, x) {
              return p.then(function () {
                return entry(x);
              });
            }, Promise.resolve())
            .then(batch);
        });
      }
      return batch();
    }
    return entries
      .reduce(function (p, e) {
        return p.then(function () {
          return entry(e);
        });
      }, Promise.resolve())
      .then(function () {
        return out;
      });
  }

  function create(host) {
    var _seq = 0;
    /** @type {any[]} */
    var items = []; // { id, from, pages, url, match, why, said, refused, picking, query, say, note }
    var queue = [];
    /** @type {Promise<void> | null} */
    var working = null;
    var done = 0;
    var total = 0;
    var lines = { passed: 0, more: false };

    function _students() {
      return host.rows().map(function (sid) {
        return { id: sid, name: host.full(sid), first: host.first(sid) };
      });
    }

    function _listed(sid) {
      return host.rows().indexOf(sid) >= 0;
    }

    /* The name read against the whole class, so a student graded with a
       group on this assessment (not listed here) is never mistaken for a
       classmate of the same name. */
    function _match(name) {
      var m = NameMatch.match(name, host.roster() || []);
      if ((m.kind === 'one' || m.kind === 'close') && !_listed(m.sid)) return { kind: 'none', why: 'not_listed' };
      if (m.kind === 'many') {
        var sids = m.sids.filter(_listed);
        if (!sids.length) return { kind: 'none', why: 'not_listed' };
        return Object.assign({}, m, { sids: sids, count: m.sids.length });
      }
      return m;
    }

    function _why(m) {
      if (!m) return '';
      // Certain, but it couldn't be placed (the note says why when there is one).
      if (m.kind === 'one') return 'Choose where it goes.';
      if (m.kind === 'many') {
        var n = m.count || m.sids.length;
        if (!m.word) return 'More than one student could fit.';
        return (n === 2 ? 'Two students' : n + ' students') + ' are named ' + m.word + '.';
      }
      if (m.kind === 'close') {
        if (m.why === 'spelling') return 'The spelling is close, not the same.';
        if (m.why === 'part') return 'The file name also says “' + m.word + '”.';
        return 'Another student’s name is in it too.';
      }
      if (m.why === 'not_listed') return 'That student is graded with a group on this assessment.';
      if (m.why === 'unknown') {
        var names = host.classes ? host.classes() : [];
        return names.length > 1
          ? 'No student in ' + names.join(' or ') + ' has that name.'
          : 'No student here has that name.';
      }
      return 'No name in the file name.';
    }

    function _waitingItem(id) {
      for (var i = 0; i < items.length; i++) if (items[i].id === id) return items[i];
      return null;
    }

    // A file's pages, held here until the teacher places them.
    function hold(from, pages, m, note) {
      var kept = _nameless(pages);
      var item = {
        id: 'w' + ++_seq,
        from: String(from || ''),
        pages: kept,
        url: _thumbUrl(kept[0]),
        match: m || { kind: 'none', why: 'no_name' },
        note: note || '',
        picking: false,
        query: '',
        refused: false,
        said: '',
      };
      items.push(item);
      return item;
    }

    function _refused(from, said) {
      items.push({
        id: 'w' + ++_seq,
        from: String(from || ''),
        pages: [],
        url: '',
        match: null,
        refused: true,
        said: said || "That file couldn't be used. Try another photo.",
      });
    }

    function _drop(item) {
      items = items.filter(function (x) {
        return x !== item;
      });
    }

    /* ── Reading files ── */
    function reading() {
      return !!working;
    }

    function progress() {
      return working && total ? 'Reading ' + Math.min(done + 1, total) + ' of ' + total + '…' : '';
    }

    function _one(file) {
      var name = _fileName(file);
      return AddWorkFiles.prepare([file]).then(
        function (got) {
          if (!host.alive()) return;
          done++;
          if (got.said || !got.pages.length) return _refused(name, got.said);
          // Matched once read, against the classes on the page now (a second may have come).
          var m = _match(name);
          // byName: placed or held by the app from its name, not by the teacher.
          if (m.kind === 'one') {
            var res = host.place([{ sid: m.sid, from: name, pages: got.pages, byName: true }])[0];
            if (res && res.ok) return;
            hold(
              name,
              got.pages,
              m,
              res && res.reason === 'too_many_pages' ? 'A piece of work can have 30 pages at most.' : '',
            ).byName = true;
            return;
          }
          hold(name, got.pages, m).byName = true;
        },
        function () {
          if (!host.alive()) return;
          done++;
          _refused(name, '');
        },
      );
    }

    function _work() {
      if (working) return working;
      /** @type {() => void} */
      var finish = function () {};
      working = /** @type {Promise<void>} */ (
        new Promise(function (resolve) {
          finish = function () {
            resolve(undefined);
          };
        })
      ).then(function () {
        working = null;
        done = 0;
        total = 0;
        if (host.alive()) host.draw();
      });
      /* One file at a time. The page is drawn as they land, at most every
         DRAW_MS while a pile is read: a folder of 300 is not drawn 300 times. */
      var drawn = 0;
      function next() {
        if (!host.alive()) return finish();
        var file = queue.shift();
        if (!file) return finish();
        var now = Date.now();
        if (now - drawn >= DRAW_MS) {
          drawn = now;
          host.draw();
        }
        _one(file).then(next, next);
      }
      next();
      return working;
    }

    function _splits(file) {
      var split = /** @type {any} */ (window).AddWorkSplit;
      if (!split || typeof split.takes !== 'function' || typeof split.open !== 'function') return false;
      if (!_isPdf(file) || !split.takes([file])) return false;
      return _match(_fileName(file)).kind !== 'one';
    }

    /* Files dropped off a student or chosen here: the ones that can be read
       go on in the natural order of their names. → Promise, settled when
       every file has been read. */
    function take(files) {
      if (!host.alive() || host.busy()) return Promise.resolve();
      var list = Array.prototype.slice.call(files || []).filter(function (f) {
        return f && !_hidden(f);
      });
      var use = list.filter(_readable);
      lines.passed = list.length - use.length;
      lines.more = use.length > MAX_FILES;
      if (lines.more) use = use.slice(0, MAX_FILES);
      if (!working && use.length === 1 && _splits(use[0])) {
        host.draw();
        return Promise.resolve(split(use[0]));
      }
      use.sort(function (a, b) {
        return NameMatch.compare(_fileName(a), _fileName(b));
      });
      if (!use.length) {
        host.draw();
        return Promise.resolve();
      }
      queue = queue.concat(use);
      total += use.length;
      return _work();
    }

    /* A drop that may hold folders: their files are found first (the
       entries must be asked for during the drop itself). → Promise. */
    function takeDrop(dt) {
      var items = dt && dt.items ? Array.prototype.slice.call(dt.items) : [];
      var entries = items
        .map(function (it) {
          return it && it.kind === 'file' && typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null;
        })
        .filter(Boolean);
      var folder = entries.some(function (e) {
        return e.isDirectory;
      });
      if (!folder) return take((dt && dt.files) || []);
      return _walk(entries).then(take);
    }

    // Whether a drop holds a folder (it is matched by name wherever it lands).
    function hasFolder(dt) {
      var list = dt && dt.items ? Array.prototype.slice.call(dt.items) : [];
      return list.some(function (it) {
        var e = it && it.kind === 'file' && typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null;
        return !!(e && e.isDirectory);
      });
    }

    /* ── Split the Scan (B2) ── */
    function split(file) {
      var s = /** @type {any} */ (window).AddWorkSplit;
      if (!s || !host.alive()) return false;
      // Two classes on (B6): both lists, each name with its class.
      var more = (host.split && host.split()) || {};
      return !!s.open(host.cid, host.aid, file, {
        list: more.list,
        label: more.label,
        had: more.had,
        noListOrder: more.noListOrder,
        cids: more.cids,
        onPieces: function (pieces) {
          // Marked as off the scan, for Grade in Scan Order (B5).
          if (host.alive())
            placeOrHold(
              (pieces || []).map(function (p) {
                return Object.assign({}, p, { scan: true });
              }),
            );
        },
        onClose: function () {
          if (!host.alive()) return;
          host.draw({ focus: 'awt-files' });
        },
      });
    }

    /* Pieces placed on their students; any that can't be (no such student
       here, too many pages) wait in the tray, so no page is lost.
       → { placed, waiting }. */
    function placeOrHold(pieces) {
      var list = Array.prototype.slice.call(pieces || []);
      var res = host.place(list);
      var out = { placed: 0, waiting: 0 };
      list.forEach(function (piece, i) {
        var r = res[i] || {};
        if (r.ok) {
          out.placed++;
          return;
        }
        if (!piece || !(piece.pages || []).length) return;
        out.waiting++;
        hold(
          piece.from,
          piece.pages,
          { kind: 'none', why: piece.sid ? 'unknown' : 'no_name' },
          r.reason === 'too_many_pages' ? 'A piece of work can have 30 pages at most.' : '',
        );
      });
      host.draw();
      return out;
    }

    /* The classes on the page changed (B6): each file waiting by its name is
       matched again, so what it says is true. With `place` (a second class
       came), a certain one goes on its student, as if it were dropped now,
       unless it went back from a student (noAuto); the rest wait, saying
       why. Without (the second class left), nothing is placed.
       → how many were placed. */
    function again(place) {
      var went = 0;
      items.slice().forEach(function (item) {
        if (!item.byName || item.refused) return;
        var m = _match(item.from);
        item.match = m;
        // A note on the old match (no room left on that student) is not this one's.
        if (m.kind !== 'one') item.note = '';
        if (m.kind !== 'one' || !place || item.noAuto) return;
        var res =
          host.place([{ sid: m.sid, from: item.from, pages: item.pages, url: item.url, byName: true }])[0] || {};
        if (res.ok) {
          _drop(item);
          went++;
        } else item.note = res.reason === 'too_many_pages' ? 'A piece of work can have 30 pages at most.' : '';
      });
      return went;
    }

    /* ── Placing from the tray ── */
    function _rect(id) {
      var el = document.querySelector('.awt-item[data-awt-item="' + id + '"]');
      return el && el.getBoundingClientRect ? el.getBoundingClientRect() : null;
    }

    // The next waiting file's first button, else the tray's Choose Files….
    function _nextKey(id) {
      var at = items.findIndex(function (x) {
        return x.id === id;
      });
      var next = items[at + 1] || items[at - 1];
      return next && next.id !== id ? 'awt-lead:' + next.id : 'awt-files';
    }

    function placeItem(id, sid) {
      var item = _waitingItem(id);
      if (!item || item.refused || host.busy()) return false;
      var focus = _nextKey(id);
      var before = _rect(id);
      var res =
        host.place([
          { sid: sid, from: item.from, pages: item.pages, url: item.url, forCid: item.forCid, forAid: item.forAid },
        ])[0] || {};
      if (!res.ok) {
        item.note = res.reason === 'too_many_pages' ? 'A piece of work can have 30 pages at most.' : '';
        item.picking = false;
        host.draw({ focus: 'awt-lead:' + id });
        return false;
      }
      _drop(item);
      var glide = {};
      if (before) glide[res.piece.id] = before;
      host.draw({ focus: focus, glideFrom: glide });
      return true;
    }

    function remove(id) {
      var item = _waitingItem(id);
      if (!item) return;
      var focus = _nextKey(id);
      _revoke(item.url);
      _drop(item);
      host.draw({ focus: focus });
    }

    function release() {
      items.forEach(function (x) {
        _revoke(x.url);
      });
      items = [];
      queue = [];
    }

    // Files with pages waiting (a refused file holds none).
    function count() {
      return items.filter(function (x) {
        return !x.refused;
      }).length;
    }

    /* ── Drawing ── */
    function _optionHits(item) {
      var q = NameMatch.plain(item.query || '')
        .toLowerCase()
        .trim();
      return _students().filter(function (st) {
        if (!q) return true;
        var name = NameMatch.plain(st.name).toLowerCase();
        return (
          name.indexOf(q) === 0 ||
          name.split(/\s+/).some(function (w) {
            return w.indexOf(q) === 0;
          })
        );
      });
    }

    // html-safe: names go through esc; ids are ours (esc too)
    function _optionsHtml(item) {
      var hits = _optionHits(item);
      if (!hits.length) return '<li class="awt-none" role="presentation">No student by that name.</li>';
      return hits
        .map(function (st) {
          return (
            '<li role="presentation"><button type="button" role="option" aria-selected="false" class="awt-option" data-awt="to" data-item="' +
            esc(item.id) +
            '" data-sid="' +
            esc(st.id) +
            '">' +
            esc(st.name) +
            '</button></li>'
          );
        })
        .join('');
    }

    // html-safe: names go through esc; ids are ours (esc too)
    function _pickerHtml(item) {
      return (
        '<div class="awt-picker">' +
        '<input type="text" class="awt-find" autocomplete="off" spellcheck="false" placeholder="Type a name" aria-label="Type to find a student" data-awt-find="' +
        esc(item.id) +
        '" data-key="awt-find:' +
        esc(item.id) +
        '" value="' +
        esc(item.query || '') +
        '">' +
        '<ul class="awt-options" role="listbox" aria-label="Students" data-awt-options="' +
        esc(item.id) +
        '">' +
        _optionsHtml(item) +
        '</ul>' +
        // Said when Return found more than one student: the teacher picks.
        '<span class="awt-why is-note" role="status" data-awt-say="' +
        esc(item.id) +
        '">' +
        esc(item.say || '') +
        '</span></div>'
      );
    }

    /* Return in Choose a Student found more than one student (the same
       name, the same name in each class, or a surname they share): nothing
       is placed and the list stays open (rule 9). → the plain sentence. */
    function _sayMany(hits) {
      var name = host.name(hits[0].id);
      var same = hits.every(function (st) {
        return NameMatch.plain(host.name(st.id)).toLowerCase() === NameMatch.plain(name).toLowerCase();
      });
      if (!same) return 'More than one student could fit. Choose one.';
      return (hits.length === 2 ? 'Two students' : hits.length + ' students') + ' are named ' + name + '. Choose one.';
    }

    function _btn(cls, what, item, label, extra, lead) {
      return (
        '<button type="button" class="' +
        cls +
        '" data-awt="' +
        what +
        '" data-item="' +
        esc(item.id) +
        '"' +
        (extra || '') +
        ' data-key="' +
        esc(lead ? 'awt-lead:' + item.id : 'awt-' + what + ':' + item.id + (extra ? ':' + label : '')) +
        '"' +
        (host.busy() ? ' disabled' : '') +
        '>' +
        esc(label) +
        '</button>'
      );
    }

    // html-safe: names and file names go through esc; ids are ours (esc too); icons are fixed
    function _actionsHtml(item) {
      var m = item.match || {};
      if (item.refused) return _btn('awt-act', 'off', item, 'Dismiss', '', true);
      var html = '';
      if (m.kind === 'many' && !item.picking) {
        html += m.sids
          .map(function (sid, i) {
            return _btn('awt-act', 'to', item, host.full(sid), ' data-sid="' + esc(sid) + '"', i === 0);
          })
          .join('');
        html += _btn('awt-act is-quiet', 'else', item, 'Someone Else');
        return '<div class="awt-acts">' + html + '</div>';
      }
      /* One student, but not placed (matched again when the classes changed):
         offered as a close spelling is, never taken. A file with no room on
         that student (its note) is not offered there again. */
      if ((m.kind === 'close' || (m.kind === 'one' && !item.note)) && !item.picking) {
        var first = host.first(m.sid);
        return (
          '<span class="awt-ask">' +
          esc('Is this ' + first + '?') +
          '</span><div class="awt-acts">' +
          _btn('awt-act is-main', 'to', item, 'Yes, ' + first, ' data-sid="' + esc(m.sid) + '"', true) +
          _btn('awt-act', 'else', item, 'Someone Else') +
          '</div>'
        );
      }
      if (item.picking) return _pickerHtml(item);
      return (
        '<button type="button" class="awt-act awt-choose" data-awt="pick" data-item="' +
        esc(item.id) +
        '" data-key="awt-lead:' +
        esc(item.id) +
        '" aria-expanded="false"' +
        (host.busy() ? ' disabled' : '') +
        '>Choose a Student' +
        DOWN_ICON +
        '</button>'
      );
    }

    // html-safe: names and file names go through esc; ids are ours (esc too); icons are fixed
    function _itemHtml(item) {
      var off = host.busy() ? ' disabled' : '';
      var pages = item.refused ? '' : ' · ' + _plural(item.pages.length, 'page', 'pages');
      return (
        '<li class="awt-item' +
        (item.refused ? ' is-refused' : '') +
        '" data-awt-item="' +
        esc(item.id) +
        '" draggable="' +
        (item.refused || host.busy() ? 'false' : 'true') +
        '">' +
        (item.refused
          ? ''
          : /** @type {any} */ (window).AddWorkPageView
            ? // B5: the picture shows the file's pages full size.
              '<button type="button" class="awt-pic" data-awt="view" data-item="' +
              esc(item.id) +
              '" data-key="awt-view:' +
              esc(item.id) +
              '" aria-label="' +
              esc('See ' + item.from + ' full size') +
              '">' +
              (item.url
                ? '<img src="' + esc(item.url) + '" alt="' + esc('First page of ' + item.from) + '" draggable="false">'
                : '') +
              '</button>'
            : '<span class="awt-pic">' +
              (item.url ? '<img src="' + esc(item.url) + '" alt="' + esc('First page of ' + item.from) + '">' : '') +
              '</span>') +
        '<div class="awt-body">' +
        '<span class="awt-file"><span class="awt-file-name">' +
        esc(item.from || 'File') +
        '</span>' +
        esc(pages) +
        '</span>' +
        '<span class="awt-why">' +
        esc(item.refused ? item.said : _why(item.match)) +
        '</span>' +
        (item.note ? '<span class="awt-why is-note">' + esc(item.note) + '</span>' : '') +
        _actionsHtml(item) +
        '</div>' +
        (item.refused
          ? ''
          : '<button type="button" class="awt-off" data-awt="off" data-item="' +
            esc(item.id) +
            '" data-key="awt-off:' +
            esc(item.id) +
            '" aria-label="Take this file off" title="Take this file off"' +
            off +
            '>' +
            X_ICON +
            '</button>') +
        '</li>'
      );
    }

    function _inputs() {
      return (
        '<input type="file" class="awt-input" data-awt-input="files" multiple accept="' +
        ACCEPT +
        '" hidden tabindex="-1" aria-hidden="true">' +
        '<input type="file" class="awt-input" data-awt-input="folder" multiple webkitdirectory hidden tabindex="-1" aria-hidden="true">' +
        '<input type="file" class="awt-input" data-awt-input="scan" accept="application/pdf,.pdf" hidden tabindex="-1" aria-hidden="true">'
      );
    }

    function _chooseBtn(what, label) {
      return (
        '<button type="button" class="awt-pick-btn" data-awt="' +
        what +
        '" data-key="awt-' +
        what +
        '"' +
        (host.busy() ? ' disabled' : '') +
        '>' +
        esc(label) +
        '</button>'
      );
    }

    // html-safe: every word goes through esc; the rest is fixed markup
    function _statusHtml() {
      var parts = [];
      var now = progress();
      if (now) parts.push(now);
      if (lines.more) parts.push('Only the first ' + MAX_FILES + ' files were read. Add the rest after these.');
      if (lines.passed)
        parts.push(
          lines.passed === 1
            ? '1 file that isn’t a photo or PDF was passed over.'
            : lines.passed + ' files that aren’t photos or PDFs were passed over.',
        );
      return '<p class="awt-status" role="status">' + esc(parts.join(' ')) + '</p>';
    }

    // html-safe: every name, file name and word goes through esc; icons are fixed
    function html() {
      var grid = host.layout() === 'grid';
      var split = /** @type {any} */ (window).AddWorkSplit;
      var n = count();
      var buttons =
        _chooseBtn('files', 'Choose Files…') +
        _chooseBtn('folder', 'Choose a Folder…') +
        (split && typeof split.open === 'function' ? _chooseBtn('scan', 'Split a Scan…') : '');
      var drop =
        '<div class="awt-drop" data-awt-drop>' +
        UP_ICON +
        '<span class="awt-drop-title">Drop the Scan, a Folder or Files</span>' +
        (grid ? '' : '<span class="awt-drop-hint">Photos or PDFs. Files are matched to students by name.</span>') +
        '<div class="awt-pick">' +
        buttons +
        '</div>' +
        _inputs() +
        '</div>';
      var head =
        '<div class="awt-head"><h3 class="awt-title">Waiting for a Student</h3><span class="awt-count">' +
        esc(n ? _plural(n, 'file', 'files') : '') +
        '</span></div>';
      var list = items.length
        ? '<ul class="awt-list" aria-label="Waiting for a Student" data-keep-scroll="awt-list">' +
          items.map(_itemHtml).join('') +
          '</ul>'
        : '<p class="awt-empty">' +
          esc(grid ? 'Nothing is waiting.' : 'Files that don’t match a student wait here.') +
          '</p>';
      var hint = items.length ? '<p class="awt-hint">Drag each onto a student, or choose one.</p>' : '';
      // The footer already says nothing is added until Add Work.
      var note =
        '<p class="awt-note">File names are read on this computer to find each student. Only the pages upload, made smaller; the names are not kept.</p>';
      return (
        '<section class="awt-tray' +
        (grid ? ' is-strip' : '') +
        '" aria-label="Files to Match" data-keep-scroll="awt-tray">' +
        drop +
        _statusHtml() +
        '<div class="awt-wait">' +
        head +
        hint +
        list +
        '</div>' +
        (grid ? '' : note) +
        '</section>'
      );
    }

    /* ── Events, handed on by the class page ── */
    function _openPicker(item) {
      items.forEach(function (x) {
        if (x !== item) x.picking = false;
      });
      item.picking = true;
      item.query = '';
      item.say = '';
      host.draw({ focus: 'awt-find:' + item.id });
    }

    function _closePicker(item) {
      item.picking = false;
      item.query = '';
      item.say = '';
      host.draw({ focus: 'awt-lead:' + item.id });
    }

    // A click on a [data-awt] button. → true when the tray took it.
    function click(btn) {
      var what = btn && btn.getAttribute('data-awt');
      if (!what) return false;
      if (host.busy()) return true;
      if (what === 'files' || what === 'folder' || what === 'scan') {
        var input = /** @type {HTMLInputElement | null} */ (
          document.querySelector('.awt-input[data-awt-input="' + what + '"]')
        );
        if (input) input.click();
        return true;
      }
      var item = _waitingItem(btn.getAttribute('data-item'));
      if (!item) return true;
      if (what === 'view') _view(item, 'awt-view:' + item.id);
      else if (what === 'to') placeItem(item.id, btn.getAttribute('data-sid'));
      else if (what === 'off') remove(item.id);
      else if (what === 'else' || what === 'pick') _openPicker(item);
      return true;
    }

    // A chooser's files. → true when the input was the tray's.
    function change(input) {
      var kind = input && input.getAttribute && input.getAttribute('data-awt-input');
      if (!kind) return false;
      var files = Array.prototype.slice.call(input.files || []);
      input.value = '';
      if (!files.length) return true;
      if (kind === 'scan' && files.length === 1 && _isPdf(files[0]) && /** @type {any} */ (window).AddWorkSplit) {
        split(files[0]);
        return true;
      }
      take(files);
      return true;
    }

    // Typing in Choose a Student: only the list is drawn again.
    function input(el) {
      var id = el && el.getAttribute && el.getAttribute('data-awt-find');
      var item = id && _waitingItem(id);
      if (!item) return false;
      item.query = String(el.value || '');
      item.say = '';
      var say = document.querySelector('[data-awt-say="' + id + '"]');
      if (say) say.textContent = '';
      var list = document.querySelector('.awt-options[data-awt-options="' + id + '"]');
      // html-safe: _optionsHtml escapes every name; ids are ours
      if (list) list.innerHTML = _optionsHtml(item);
      return true;
    }

    // A waiting file's pages full size; the focus comes back to `key`.
    function _view(item, key) {
      var view = /** @type {any} */ (window).AddWorkPageView;
      if (!view) return false;
      return view.open({
        title: item.from || 'File',
        pages: item.pages.map(function (pg, i) {
          return { blob: pg && pg.blob, label: 'Page ' + (i + 1) };
        }),
        onClose: function () {
          var el = /** @type {any} */ (document.querySelector('[data-key="' + key + '"]'));
          if (el) el.focus();
        },
      });
    }

    /* Keys inside an open Choose a Student: arrows move through the list,
       Return takes the student found when only one is, Escape closes it. → true when
       the tray took the key. */
    function keydown(e) {
      var el = /** @type {any} */ (document.activeElement);
      var picker = el && el.closest ? el.closest('.awt-picker') : null;
      if (!picker) return false;
      var host_ = picker.closest('.awt-item');
      var item = host_ && _waitingItem(host_.getAttribute('data-awt-item'));
      if (!item) return false;
      var options = Array.prototype.slice.call(picker.querySelectorAll('.awt-option'));
      var at = options.indexOf(el);
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        _closePicker(item);
        return true;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        if (!options.length) return true;
        e.preventDefault();
        var down = e.key === 'ArrowDown';
        var next = at < 0 ? (down ? 0 : options.length - 1) : at + (down ? 1 : -1);
        if (next < 0) return (picker.querySelector('.awt-find').focus(), true);
        options[Math.min(next, options.length - 1)].focus();
        return true;
      }
      // Space in an empty box: the file full size, as in Split the Scan.
      if (e.key === ' ' && at < 0 && el.classList.contains('awt-find') && !String(el.value || '').trim()) {
        e.preventDefault();
        _view(item, 'awt-find:' + item.id);
        return true;
      }
      if (e.key === 'Enter' && at < 0 && el.classList.contains('awt-find')) {
        e.preventDefault();
        // An empty box lists the whole class: Return takes no one until a name is typed.
        if (!String(el.value || '').trim()) return true;
        var hits = _optionHits(item);
        if (hits.length === 1) placeItem(item.id, hits[0].id);
        else if (hits.length > 1) {
          // Never the first of several (rule 9): the list stays, and says why.
          item.say = _sayMany(hits);
          var say = picker.querySelector('[data-awt-say]');
          if (say) say.textContent = item.say;
        }
        return true;
      }
      return false;
    }

    return {
      html: html,
      take: take,
      takeDrop: takeDrop,
      hasFolder: hasFolder,
      placeOrHold: placeOrHold,
      // Two classes (B6): a name matched as a drop is; a placed file held again.
      match: _match,
      // more: { byName, noAuto, forCid, forAid } (a For choice the teacher made).
      hold: function (from, pages, m, more) {
        Object.assign(hold(from, pages, m), more || {});
      },
      again: again,
      placeItem: placeItem,
      remove: remove,
      release: release,
      count: count,
      reading: reading,
      progress: progress,
      click: click,
      change: change,
      input: input,
      keydown: keydown,
      // For tests: what is waiting, as the screen reads it.
      items: function () {
        return items.map(function (x) {
          return { id: x.id, from: x.from, pages: x.pages.length, kind: x.match && x.match.kind, refused: x.refused };
        });
      },
    };
  }

  return { create: create, MAX_FILES: MAX_FILES };
})();
