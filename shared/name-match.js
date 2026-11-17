// @ts-check
/* ── name-match.js — which student a file is named for ─────────────────
   Add Work for the Class (docs/plans/add-work-for-class-plan.md, B3): a
   teacher drops a folder of files named for students, and each file finds
   its student. The name is read here, in the browser, and never kept or
   sent anywhere: this file has no HTML, no DOM and no data calls.

   NameMatch.match(fileName, students) → one of
     { kind: 'one', sid }                    certain: placed on the student
     { kind: 'close', sid, why, word? }      offered, never taken
     { kind: 'many', sids, word? }           two or more students fit
     { kind: 'none', why }                   nobody fits
   students: [{ id, firstName, lastName, preferred }] (a student record
   will do). `why` says what to tell the teacher: for close, 'spelling'
   (a letter or two off), 'part' (one name fits, another word doesn't;
   `word` is that word as written) or 'other' (another student's name is
   in it too); for none, 'no_name' (nothing name-like is left) or
   'unknown'. For many, `word` is the name they share ("Chen") when they
   all fit by the same name.

   How a file name is read
   - The folder and the extension are dropped.
   - Capitals and accents don't matter ("INÈS" is "ines"); an apostrophe
     joins ("O'Brien" is "obrien").
   - Spaces, dashes, underscores, dots, commas, brackets and the like are
     breaks, and so is a change from small to capital letters ("AveryChen").
   - Numbers are ignored, and so is a word with a number in it that isn't
     a name once the number goes ("p3", "pg2", "scan0017").
   - The filler words a scan or a copy adds are ignored (FILLER below).
   - A name of two parts matches written together or apart: "Al-Rashid",
     "Al Rashid" and "alrashid" are all Noor Al-Rashid's last name.
   - A preferred name counts as a first name.

   What is certain ('one')
   1. The first and last name both there, in either order ("Kaur, Priya").
      Other words beside them don't matter ("Priya Kaur essay"), unless one
      is another student's name: then it is only offered ('other').
   2. A first name with a last initial ("Priya K"), or a last name with a
      first initial ("P. Kaur"), when only one student fits, and nothing
      else name-like is in the file name.
   3. A first name alone, or a last name alone, when only one student in
      the class has it as either, and nothing else name-like is in the
      file name ("Blackwood.pdf"). With another word that doesn't fit that
      student ("Sam Jones" in a class whose only Sam is Sam Blackwood) it is
      only offered ('part').
   What is offered ('close')
   4. A spelling one letter off (two for a name of seven letters or more)
      from exactly one student's name ("Matteo C" for Mateo Cruz). Words
      shorter than three letters are never read as a close spelling.
   Two or more students fit ('many'): two who share the name ("Chen" with
   Avery Chen and Liam Chen), two students' full names in one file name,
   or a close spelling of two students. Nothing else is 'none'
   ("SCAN0017.pdf", "IMG_4471.jpg"). A doubtful match is never certain.

   NameMatch.compare(a, b)  file names in natural order ("2" before "10").
   NameMatch.plain(text)    text without accents, for type-to-find. */
/** @type {any} */ (window).NameMatch = (function () {
  'use strict';

  // The words a scan, a phone or a copy adds to a file name. Kept short.
  var FILLER = [
    'scan',
    'scanned',
    'scans',
    'img',
    'image',
    'photo',
    'pic',
    'dsc',
    'page',
    'pages',
    'pg',
    'copy',
    'final',
    'draft',
    'file',
    'doc',
    'document',
    'pdf',
    'jpg',
    'jpeg',
    'png',
    'heic',
    'and',
    'of',
    'the',
  ];
  var IS_FILLER = {};
  FILLER.forEach(function (w) {
    IS_FILLER[w] = true;
  });
  // The longest run of file-name words read as one name ("van der berg").
  var MAX_RUN = 4;

  function _plain(text) {
    var s = String(text || '');
    try {
      s = s.normalize('NFD');
    } catch (e) {
      /* an old browser: accents stay */
    }
    return s.replace(/[̀-ͯ]/g, '').replace(/['’‘`]/g, '');
  }

  // A name's words, as the file name's are read: ["al", "rashid"].
  function _words(text) {
    return _plain(text)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
  }

  /* The file name's words: [{ w, shown }], `shown` as written (for the
     screen). Numbers and filler go. */
  function _read(fileName) {
    var base =
      String(fileName || '')
        .split(/[\\/]/)
        .pop() || '';
    base = base.replace(/\.[A-Za-z0-9]{1,5}$/, '');
    var out = [];
    _plain(base)
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(/[^A-Za-z0-9]+/)
      .forEach(function (raw) {
        if (!raw) return;
        var had = /[0-9]/.test(raw);
        var letters = raw.replace(/[0-9]+/g, '');
        var w = letters.toLowerCase();
        if (!w || IS_FILLER[w]) return;
        // "p3", "pg2", "v2": a short word stuck to a number is no name.
        if (had && w.length < 3) return;
        out.push({ w: w, shown: letters });
      });
    return out;
  }

  // Every run of the file's words that spells `name` (its words joined).
  function _runs(words, name) {
    var out = [];
    if (!name) return out;
    for (var i = 0; i < words.length; i++) {
      var joined = '';
      for (var j = i; j < words.length && j < i + MAX_RUN; j++) {
        joined += words[j].w;
        if (joined.length > name.length) break;
        if (joined === name) out.push({ from: i, to: j });
      }
    }
    return out;
  }

  function _overlap(a, b) {
    return a.from <= b.to && b.from <= a.to;
  }

  function _used(runs) {
    var used = {};
    runs.forEach(function (r) {
      for (var k = r.from; k <= r.to; k++) used[k] = true;
    });
    return used;
  }

  // One student's names, read as a file name is.
  function _names(st) {
    var firsts = [];
    [st.firstName, st.preferred].forEach(function (n) {
      var w = _words(n).join('');
      if (w && firsts.indexOf(w) < 0) firsts.push(w);
    });
    var lastWords = _words(st.lastName);
    return {
      id: st.id,
      firsts: firsts,
      last: lastWords.join(''),
      shownFirst: String(st.preferred || st.firstName || ''),
      shownLast: String(st.lastName || ''),
    };
  }

  function _firstRuns(words, n) {
    var out = [];
    n.firsts.forEach(function (f) {
      out = out.concat(_runs(words, f));
    });
    return out;
  }

  // A single letter in the file name that is `letter`.
  function _initials(words, letter) {
    var out = [];
    if (!letter) return out;
    words.forEach(function (x, i) {
      if (x.w.length === 1 && x.w === letter) out.push({ from: i, to: i });
    });
    return out;
  }

  // The first pair of runs, one from each list, that don't share a word.
  function _pair(a, b) {
    for (var i = 0; i < a.length; i++)
      for (var j = 0; j < b.length; j++) if (!_overlap(a[i], b[j])) return [a[i], b[j]];
    return null;
  }

  /* How one student fits the file name: { level, runs, by } or null.
     level 3 the first and last name, 2 a name and the other's initial,
     1 one name alone. `by` the name part that fit, for a single name. */
  function _fit(words, n) {
    var fr = _firstRuns(words, n);
    var lr = _runs(words, n.last);
    var both = _pair(fr, lr);
    if (both) return { level: 3, runs: both };
    var withInitial =
      _pair(fr, _initials(words, n.last.charAt(0))) ||
      _pair(
        lr,
        n.firsts.reduce(function (acc, f) {
          return acc.concat(_initials(words, f.charAt(0)));
        }, /** @type {any[]} */ ([])),
      );
    if (withInitial) return { level: 2, runs: withInitial };
    if (fr.length) return { level: 1, runs: [fr[0]], by: 'first' };
    if (lr.length) return { level: 1, runs: [lr[0]], by: 'last' };
    return null;
  }

  // The file's words not used by `runs` that could be a name (one letter included).
  function _left(words, runs) {
    var used = _used(runs);
    return words.filter(function (x, i) {
      return !used[i];
    });
  }

  /* ── Close spellings ── */
  function _distance(a, b) {
    if (a === b) return 0;
    var prev = [];
    var cur = [];
    for (var j = 0; j <= b.length; j++) prev[j] = j;
    for (var i = 1; i <= a.length; i++) {
      cur = [i];
      for (var k = 1; k <= b.length; k++) {
        var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
        cur[k] = Math.min(prev[k] + 1, cur[k - 1] + 1, prev[k - 1] + cost);
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function _allowed(name) {
    return name.length >= 7 ? 2 : 1;
  }

  // Whether a word (or a run of the file's words) is a close spelling of `name`.
  function _closeTo(word, name) {
    if (!name || word.length < 3 || name.length < 3 || word === name) return false;
    if (Math.abs(word.length - name.length) > _allowed(name)) return false;
    return _distance(word, name) <= _allowed(name);
  }

  function _closeAny(words, name) {
    for (var i = 0; i < words.length; i++) {
      var joined = '';
      for (var j = i; j < words.length && j < i + MAX_RUN; j++) {
        joined += words[j].w;
        if (_closeTo(joined, name)) return true;
        if (joined.length > name.length + 2) break;
      }
    }
    return false;
  }

  function _closeStudent(words, n) {
    var parts = n.firsts.concat(n.last ? [n.last] : []);
    return parts.some(function (p) {
      return _closeAny(words, p);
    });
  }

  // Whether any word is another student's name, exactly.
  function _namesAnother(words, names, sid) {
    return names.some(function (n) {
      if (n.id === sid) return false;
      return _firstRuns(words, n).length > 0 || _runs(words, n.last).length > 0;
    });
  }

  // The name several students share, as the first of them writes it.
  function _sharedWord(fits) {
    var by = fits[0].fit.by;
    if (!by) return '';
    var same = fits.every(function (f) {
      return f.fit.by === by && f.fit.runs[0].from === fits[0].fit.runs[0].from;
    });
    if (!same) return '';
    var n = fits[0].n;
    return by === 'last' ? n.shownLast : n.shownFirst;
  }

  function match(fileName, students) {
    var words = _read(fileName);
    if (!words.length) return { kind: 'none', why: 'no_name' };
    var names = (students || [])
      .filter(function (st) {
        return st && st.id;
      })
      .map(_names);
    var fits = [];
    names.forEach(function (n) {
      var fit = _fit(words, n);
      if (fit) fits.push({ n: n, fit: fit });
    });
    var best = fits.reduce(function (m, f) {
      return Math.max(m, f.fit.level);
    }, 0);
    var top = fits.filter(function (f) {
      return f.fit.level === best;
    });
    if (top.length > 1) {
      var shared = _sharedWord(top);
      var many = {
        kind: 'many',
        sids: top.map(function (f) {
          return f.n.id;
        }),
      };
      if (shared) many.word = shared;
      return many;
    }
    if (top.length === 1) {
      var f = top[0];
      var sid = f.n.id;
      var left = _left(words, f.fit.runs);
      if (f.fit.level === 3) {
        // The full name: other words don't matter unless one is another student's name.
        return _namesAnother(left, names, sid) ? { kind: 'close', sid: sid, why: 'other' } : { kind: 'one', sid: sid };
      }
      // A name with an initial, or one name alone: anything else name-like is a doubt.
      if (!left.length) return { kind: 'one', sid: sid };
      // Another student fits a word that is left: two students could be meant.
      var others = fits.filter(function (o) {
        return (
          o !== f &&
          o.fit.runs.some(function (r) {
            return !_used(f.fit.runs)[r.from];
          })
        );
      });
      if (others.length)
        return {
          kind: 'many',
          sids: [sid].concat(
            others.map(function (o) {
              return o.n.id;
            }),
          ),
        };
      if (_closeStudent(left, f.n)) return { kind: 'close', sid: sid, why: 'spelling' };
      var word = left.filter(function (x) {
        return x.w.length > 1;
      })[0];
      return { kind: 'close', sid: sid, why: 'part', word: (word || left[0]).shown };
    }
    // Nobody fits exactly: a close spelling of one student is offered.
    var close = names.filter(function (n) {
      return _closeStudent(words, n);
    });
    if (close.length === 1) return { kind: 'close', sid: close[0].id, why: 'spelling' };
    if (close.length > 1)
      return {
        kind: 'many',
        sids: close.map(function (n) {
          return n.id;
        }),
      };
    var nameLike = words.some(function (x) {
      return x.w.length > 1;
    });
    return { kind: 'none', why: nameLike ? 'unknown' : 'no_name' };
  }

  /* File names in their natural order: "Avery Chen 2" before "Avery Chen
     10". Capitals and accents don't matter. */
  /** @type {Intl.Collator | null} */
  var _collator = null;
  function compare(a, b) {
    var x = String(a || '');
    var y = String(b || '');
    if (!_collator && typeof Intl !== 'undefined' && Intl.Collator)
      _collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    return _collator ? _collator.compare(x, y) : x.localeCompare(y);
  }

  // Text with its accents and apostrophes gone, for type-to-find.
  function plain(text) {
    return _plain(text);
  }

  return { match: match, compare: compare, plain: plain, FILLER: FILLER.slice() };
})();
