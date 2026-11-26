// @ts-check
/* cm-competency-import.js — Class Settings: the review of incoming competencies (Re-link and CSV import). Moved from teacher/dash-class-manager.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. DashClassManager hands
   over what this file uses through configure(). It loads before dash-class-manager.js. */
/** @type {any} */ (window).CmCompetencyImport = (function () {
  'use strict';

  /* Handed over by DashClassManager (configure). */
  var CM_FOLDER_COUNT_SENT,
    _cmAttr,
    _cmCompTitle,
    _cmCrosswalkPairs,
    _cmGradeChangeMessage,
    _cmJoinNames,
    _cmRenderAndFocus,
    renderClassManager,
    state,
    _cmStdCode,
    _currentId;
  function configure(h) {
    if ('CM_FOLDER_COUNT_SENT' in h) CM_FOLDER_COUNT_SENT = h.CM_FOLDER_COUNT_SENT;
    if ('_cmAttr' in h) _cmAttr = h._cmAttr;
    if ('_cmCompTitle' in h) _cmCompTitle = h._cmCompTitle;
    if ('_cmCrosswalkPairs' in h) _cmCrosswalkPairs = h._cmCrosswalkPairs;
    if ('_cmGradeChangeMessage' in h) _cmGradeChangeMessage = h._cmGradeChangeMessage;
    if ('_cmJoinNames' in h) _cmJoinNames = h._cmJoinNames;
    if ('_cmRenderAndFocus' in h) _cmRenderAndFocus = h._cmRenderAndFocus;
    if ('renderClassManager' in h) renderClassManager = h.renderClassManager;
    if ('state' in h) state = h.state;
    if ('_cmStdCode' in h) _cmStdCode = h._cmStdCode;
    if ('_currentId' in h) _currentId = h._currentId;
  }

  /* ── Review: Re-link and CSV import ─────────────────────────
     Each incoming competency is matched to the class by curriculum wording,
     then code, then title. Matched and identical: stays. Matched and
     different: the teacher picks Keep Mine (the default) or the incoming
     version. Not in the class: added, or put back with its scores if the
     teacher removed it earlier. In the class but not incoming: kept unless
     the teacher picks Remove (scores kept either way). */
  function _cmNorm(s) {
    return String(s || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // Wording compared without its closing full stop or curly quotes.
  function _cmLoose(s) {
    return _cmNorm(s)
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[.\s]+$/, '');
  }

  function _cmSameList(a, b) {
    a = (a || []).map(_cmNorm);
    b = (b || []).map(_cmNorm);
    return (
      a.length === b.length &&
      a.every(function (x, i) {
        return x === b[i];
      })
    );
  }

  function _cmScoredAssessments(cid, tagId) {
    var seen = {};
    var scores = getScores(cid) || {};
    Object.keys(scores).forEach(function (sid) {
      (scores[sid] || []).forEach(function (s) {
        if (s && s.tagId === tagId && s.score > 0) seen[s.assessmentId] = true;
      });
    });
    return Object.keys(seen).length;
  }

  function _cmScoresNote(cid, tag) {
    var n = tag ? _cmScoredAssessments(cid, tag.id) : 0;
    return n ? 'Has scores in ' + n + (n === 1 ? ' assessment.' : ' assessments.') : 'No scores yet.';
  }

  function _cmIcanNote(n) {
    return n + (n === 1 ? ' I Can statement' : ' I Can statements');
  }

  // Pair incoming competencies with sections, one pass per key so a
  // wording match is never taken by an earlier code or title match.
  function _cmMatch(cands, secs, keys, start) {
    var pairs = start ? start.pairs : {};
    var used = start ? start.used : {};
    keys.forEach(function (key) {
      cands.forEach(function (c, ci) {
        if (pairs[ci] != null) return;
        var want = key.cand(c);
        if (!want) return;
        var si = secs.findIndex(function (s, i) {
          if (used[i]) return false;
          return key.sec(s).indexOf(want) >= 0;
        });
        if (si >= 0) {
          pairs[ci] = si;
          used[si] = true;
        }
      });
    });
    return { pairs: pairs, used: used };
  }

  var CM_MATCH_KEYS = [
    // The bank's own id: a class built from the rebuilt bank.
    {
      cand: function (c) {
        return c.bank_id || '';
      },
      sec: function (s) {
        var t = s.tags[0] || {};
        return t.bank_id ? [t.bank_id] : [];
      },
    },
    {
      cand: function (c) {
        return _cmNorm(c.source_text || c.text);
      },
      sec: function (s) {
        var t = s.tags[0] || {};
        return [_cmNorm(t.source_text), _cmNorm(t.text)].filter(Boolean);
      },
    },
    {
      cand: function (c) {
        return _cmNorm(c.code);
      },
      sec: function (s) {
        var code = _cmNorm(_cmStdCode(s.tags[0] || {}));
        return code ? [code] : [];
      },
    },
    {
      cand: function (c) {
        return _cmNorm(c.label);
      },
      sec: function (s) {
        var t = _cmNorm(_cmCompTitle(s));
        return t ? [t] : [];
      },
    },
  ];

  function _cmBuildCompReview(cid, cands, opts) {
    var secs = (getLearningMap(cid).sections || []).filter(function (s) {
      return s.tags && s.tags[0];
    });
    var removed = getRemovedSections(cid).filter(function (r) {
      return r && r.section && r.section.tags && r.section.tags[0];
    });
    // Bank ids first; then, for an older class, the crosswalk from the old
    // bank (its competencies match their old wording there, and the
    // curriculum's version is a replacement, not the teacher's edit); then
    // wording, code and title.
    var live = _cmMatch(cands, secs, CM_MATCH_KEYS.slice(0, 1));
    var crosswalk =
      opts.kind === 'curriculum' ? _cmCrosswalkPairs(cid, secs, live, cands, opts.tags || []) : { by: {}, exact: {} };
    var replacedBy = crosswalk.by;
    Object.keys(crosswalk.match).forEach(function (si) {
      live.used[si] = true;
      live.pairs[crosswalk.match[si]] = Number(si);
    });
    var takenCand = {};
    Object.keys(replacedBy).forEach(function (si) {
      live.used[si] = true;
      replacedBy[si].forEach(function (ci) {
        takenCand[ci] = true;
        live.pairs[ci] = -1;
      });
    });
    _cmMatch(cands, secs, CM_MATCH_KEYS.slice(1), live);
    var rest = [];
    cands.forEach(function (c, ci) {
      if (live.pairs[ci] == null) rest.push(ci);
    });
    var back = _cmMatch(
      rest.map(function (ci) {
        return cands[ci];
      }),
      removed.map(function (r) {
        return r.section;
      }),
      CM_MATCH_KEYS,
    );
    /** @type {any} */
    var review = {
      cid: cid,
      kind: opts.kind,
      fileName: opts.fileName || '',
      tags: opts.tags || [],
      add: [],
      changed: [],
      replaced: [],
      fill: [],
      onlyMine: [],
      same: [],
      showSame: false,
    };
    // A class built from the rebuilt bank left out what it doesn't have on
    // purpose, so new competencies start unticked there.
    var builtFromBank = secs.some(function (s) {
      return s.tags[0].bank_id;
    });
    cands.forEach(function (c, ci) {
      if (takenCand[ci]) return;
      var si = live.pairs[ci];
      if (si == null) {
        var ri = back.pairs[rest.indexOf(ci)];
        var removedSec = ri != null ? removed[ri].section : null;
        review.add.push({ cand: c, removed: removedSec, on: !!removedSec || !builtFromBank });
        return;
      }
      var sec = secs[si];
      var tag = sec.tags[0];
      var sameNameAndWording =
        _cmNorm(_cmCompTitle(sec)) === _cmNorm(c.label) &&
        // A competency with no wording yet differs only if the rest does.
        (!_cmNorm(tag.text) || _cmNorm(tag.text) === _cmNorm(c.text));
      // An older class's competency whose wording the Ministry kept already
      // matches, whatever name the old bank gave it.
      if (crosswalk.exact[si] && _cmLoose(tag.text) === _cmLoose(c.text)) sameNameAndWording = true;
      if (
        sameNameAndWording &&
        (crosswalk.exact[si] || _cmSameList(tag.i_can_statements, c.icans)) &&
        (tag.i_can_statements || []).length
      )
        review.same.push({ sec: sec });
      else if (sameNameAndWording && _cmSameList(tag.i_can_statements, c.icans)) review.same.push({ sec: sec });
      // No I Can statements yet, and the curriculum has some: an update.
      else if (sameNameAndWording && !(tag.i_can_statements || []).length && c.icans.length)
        review.fill.push({ sec: sec, cand: c });
      else review.changed.push({ sec: sec, cand: c, pick: 'mine' });
    });
    secs.forEach(function (sec, i) {
      if (replacedBy[i])
        // An older class's competency and the curriculum's replacement.
        review.replaced.push({
          sec: sec,
          cands: replacedBy[i].map(function (ci) {
            return cands[ci];
          }),
          pick: 'mine',
        });
      else if (!live.used[i]) review.onlyMine.push({ sec: sec, pick: 'keep' });
    });
    return review;
  }

  /* Open the review. A signed-in teacher's removed competencies come from
     the server too, so one removed on another device is offered back. */
  function _cmOpenCompReview(cid, cands, opts) {
    state.cmCompReview = _cmBuildCompReview(cid, cands, opts);
    state.cmCompReview.cands = cands;
    state.cmCompReview.opts = opts;
    renderClassManager();
    var opened = state.cmCompReview;
    if (window.v2 && typeof window.v2.listRemovedSections === 'function') {
      Promise.resolve(window.v2.listRemovedSections(cid))
        .then(function (res) {
          if (!res || !Array.isArray(res.data) || !res.data.length) return;
          var before = getRemovedSections(cid).length;
          mergeRemovedSectionsFromServer(cid, res.data);
          if (state.cmCompReview !== opened || getRemovedSections(cid).length === before) return;
          state.cmCompReview = _cmBuildCompReview(cid, cands, opts);
          state.cmCompReview.cands = cands;
          state.cmCompReview.opts = opts;
          renderClassManager();
        })
        .catch(function () {});
    }
  }

  function _cmIcanDiffNote(mine, theirs) {
    var t = {};
    (theirs || []).forEach(function (s) {
      t[_cmNorm(s)] = true;
    });
    var m = {};
    (mine || []).forEach(function (s) {
      m[_cmNorm(s)] = true;
    });
    var added = (mine || []).filter(function (s) {
      return !t[_cmNorm(s)];
    }).length;
    var dropped = (theirs || []).filter(function (s) {
      return !m[_cmNorm(s)];
    }).length;
    var parts = [];
    if (added) parts.push('you added ' + added);
    if (dropped) parts.push('you removed ' + dropped);
    return parts.length ? ' (' + parts.join(', ') + ')' : '';
  }

  function _cmRenderCompReview(cid) {
    var r = state.cmCompReview;
    if (!r) return '';
    var file = r.kind === 'file';
    var course = COURSES[cid];
    var linked = (r.tags || [])
      .map(function (t) {
        var c = CURRICULUM_INDEX ? CURRICULUM_INDEX[t] : null;
        return c ? c.course_name : t;
      })
      .join(', ');
    function chip(sec, code) {
      var color = (sec && sec.color) || (getLearningMap(cid).subjects || [{}])[0].color || 'var(--active)';
      return code ? '<span class="cm-std-code" style="--chip:' + color + '">' + esc(code) + '</span>' : '';
    }
    function group(title, items, body) {
      if (!items.length) return '';
      return (
        '<section class="cm-section cm-cr-group">' +
        '<div class="cm-import-group-head"><h3>' +
        title +
        '</h3><span>' +
        items.length +
        '</span></div>' +
        items.map(body).join('') +
        '</section>'
      );
    }
    var html =
      '<div class="cm-comp-review">' +
      '<button type="button" class="cm-back-link" data-action="cmCompReviewCancel">\u2039 Back to Competencies</button>' +
      '<div class="cm-cr-head">' +
      '<h1 class="cm-head-title">' +
      (file
        ? 'Import Competencies'
        : (course.curriculumTags || []).length
          ? 'Re-link Curriculum'
          : 'Link to BC Curriculum') +
      ': Review Changes</h1>' +
      '<div class="cm-cr-sub">' +
      esc(file ? r.fileName : linked) +
      '. Competencies are matched by code and curriculum wording, so nothing is added twice. Nothing changes until you press Apply.</div>' +
      '</div>';

    // An older class's competency and the curriculum's replacement for it.
    html += group('Replaced in the Curriculum', r.replaced, function (x, i) {
      var tag = x.sec.tags[0];
      var many = x.cands.length > 1;
      var note = !many ? 'Your scores stay with it.' : _cmReplacedNote(cid, x);
      function option(pick, label, inner) {
        return (
          '<label class="cm-cr-option' +
          (x.pick === pick ? ' on' : '') +
          '">' +
          '<input type="radio" name="cm-cr-replaced-' +
          i +
          '"' +
          (x.pick === pick ? ' checked' : '') +
          ' data-action-change="cmCompReviewPick" data-group="replaced" data-idx="' +
          i +
          '" data-pick="' +
          pick +
          '">' +
          '<span class="cm-cr-text"><span class="cm-cr-pick">' +
          label +
          '</span>' +
          inner +
          '</span>' +
          '</label>'
        );
      }
      return (
        '<div class="cm-cr-changed">' +
        '<div class="cm-cr-changed-head">' +
        chip(x.sec, _cmStdCode(tag)) +
        '<span class="cm-cr-note">' +
        _cmScoresNote(cid, tag) +
        (_cmScoredAssessments(cid, tag.id) ? ' Scores stay either way.' : '') +
        '</span></div>' +
        '<div class="cm-cr-options" role="radiogroup" aria-label="' +
        esc(_cmCompTitle(x.sec)) +
        '">' +
        option(
          'mine',
          'Keep Mine',
          '<span class="cm-cr-name">' +
            esc(_cmCompTitle(x.sec)) +
            '</span>' +
            (tag.text ? '<span class="cm-cr-wording">' + esc(tag.text) + '</span>' : ''),
        ) +
        option(
          'theirs',
          many ? 'Add the Curriculum Version' : 'Use the Curriculum Version',
          '<span class="cm-cr-note">' +
            esc(note) +
            '</span><span class="cm-cr-repl-list">' +
            x.cands
              .map(function (c) {
                return (
                  '<span class="cm-cr-repl-item">' +
                  chip(x.sec, c.code) +
                  '<span class="cm-cr-text"><span class="cm-cr-name">' +
                  esc(c.label || c.text) +
                  '</span><span class="cm-cr-wording">' +
                  esc(c.text) +
                  '</span></span></span>'
                );
              })
              .join('') +
            '</span>',
        ) +
        '</div>' +
        '</div>'
      );
    });

    html += group(
      file ? 'In the File, Not in Your Class' : 'In the Curriculum, Not in Your Class',
      r.add,
      function (a, i) {
        var src = a.removed || a.cand.section || {};
        var code = a.removed ? _cmStdCode(a.removed.tags[0]) : a.cand.code;
        var n = a.removed ? (a.removed.tags[0].i_can_statements || []).length : a.cand.icans.length;
        return (
          '<label class="cm-cr-row">' +
          '<input type="checkbox"' +
          (a.on ? ' checked' : '') +
          ' data-action-change="cmCompReviewToggle" data-idx="' +
          i +
          '">' +
          chip(src, code) +
          '<span class="cm-cr-text"><span class="cm-cr-name">' +
          esc(a.removed ? _cmCompTitle(a.removed) : a.cand.label || a.cand.text) +
          '</span>' +
          (a.removed
            ? '<span class="cm-cr-note">You removed this from the class earlier. ' + _cmIcanNote(n) + '.</span>'
            : a.cand.text && a.cand.text !== a.cand.label
              ? '<span class="cm-cr-wording">' + esc(a.cand.text) + '</span>'
              : '<span class="cm-cr-note">' + _cmIcanNote(n) + '.</span>') +
          '</span>' +
          '<span class="cm-cr-verb">' +
          (a.removed ? 'Add Back' : 'Add') +
          '</span>' +
          '</label>'
        );
      },
    );

    html += group('You Changed These', r.changed, function (c, i) {
      var tag = c.sec.tags[0];
      var mineIcans = tag.i_can_statements || [];
      var wording =
        _cmNorm(tag.text) === _cmNorm(c.cand.text) ? '' : tag.text ? ' \u00B7 wording edited' : ' \u00B7 no wording';
      function option(pick, label, name, note) {
        return (
          '<label class="cm-cr-option' +
          (c.pick === pick ? ' on' : '') +
          '">' +
          '<input type="radio" name="cm-cr-changed-' +
          i +
          '"' +
          (c.pick === pick ? ' checked' : '') +
          ' data-action-change="cmCompReviewPick" data-group="changed" data-idx="' +
          i +
          '" data-pick="' +
          pick +
          '">' +
          '<span class="cm-cr-text"><span class="cm-cr-pick">' +
          label +
          '</span><span class="cm-cr-name">' +
          esc(name) +
          '</span><span class="cm-cr-note">' +
          note +
          '</span></span>' +
          '</label>'
        );
      }
      return (
        '<div class="cm-cr-changed">' +
        '<div class="cm-cr-changed-head">' +
        chip(c.sec, _cmStdCode(tag)) +
        '<span class="cm-cr-note">' +
        _cmScoresNote(cid, tag) +
        (_cmScoredAssessments(cid, tag.id) ? ' Scores stay either way.' : '') +
        '</span></div>' +
        '<div class="cm-cr-options" role="radiogroup" aria-label="' +
        esc(_cmCompTitle(c.sec)) +
        '">' +
        option(
          'mine',
          'Keep Mine',
          _cmCompTitle(c.sec),
          _cmIcanNote(mineIcans.length) + _cmIcanDiffNote(mineIcans, c.cand.icans) + wording,
        ) +
        option(
          'theirs',
          file ? 'Use the File\u2019s Version' : 'Use the Curriculum Version',
          c.cand.label || c.cand.text,
          _cmIcanNote(c.cand.icans.length),
        ) +
        '</div>' +
        '</div>'
      );
    });

    html += group('Only in Your Class', r.onlyMine, function (o, i) {
      var tag = o.sec.tags[0];
      var why = file ? 'Not in the file.' : tag.source_text ? 'Not in this curriculum.' : 'One of your own.';
      function seg(pick, label) {
        return (
          '<label class="cm-cr-seg' +
          (o.pick === pick ? ' on' : '') +
          '"><input type="radio" name="cm-cr-only-' +
          i +
          '"' +
          (o.pick === pick ? ' checked' : '') +
          ' data-action-change="cmCompReviewPick" data-group="onlyMine" data-idx="' +
          i +
          '" data-pick="' +
          pick +
          '">' +
          label +
          '</label>'
        );
      }
      return (
        '<div class="cm-cr-row">' +
        chip(o.sec, _cmStdCode(tag)) +
        '<span class="cm-cr-text"><span class="cm-cr-name">' +
        esc(_cmCompTitle(o.sec)) +
        '</span><span class="cm-cr-note">' +
        why +
        ' ' +
        _cmScoresNote(cid, tag) +
        '</span></span>' +
        '<div class="cm-cr-segs" role="radiogroup" aria-label="' +
        esc(_cmCompTitle(o.sec)) +
        '">' +
        seg('keep', 'Keep') +
        seg('remove', 'Remove') +
        '</div>' +
        '</div>'
      );
    });

    if (r.same.length) {
      var codes = r.same.map(function (s) {
        return _cmStdCode(s.sec.tags[0]) || _cmCompTitle(s.sec);
      });
      html +=
        '<section class="cm-section cm-cr-same">' +
        '<div class="cm-cr-same-head"><div class="cm-cr-text"><h3>' +
        (file ? 'Already Match the File' : 'Already Match the Curriculum') +
        ' <span>' +
        r.same.length +
        '</span></h3><span class="cm-cr-note">' +
        esc(
          codes.length > 8 ? codes.slice(0, 8).join(', ') + ' and ' + (codes.length - 8) + ' more' : codes.join(', '),
        ) +
        (codes.length === 1 ? ' stays as it is.' : ' stay as they are.') +
        '</span></div>' +
        '<button type="button" class="cm-add-link" data-action="cmCompReviewShowSame" aria-expanded="' +
        r.showSame +
        '">' +
        (r.showSame ? 'Hide' : 'Show') +
        '</button></div>' +
        (r.showSame
          ? '<div class="cm-cr-same-list">' +
            r.same
              .map(function (s) {
                return (
                  '<div class="cm-cr-same-row">' +
                  chip(s.sec, _cmStdCode(s.sec.tags[0])) +
                  '<span>' +
                  esc(_cmCompTitle(s.sec)) +
                  '</span></div>'
                );
              })
              .join('') +
            '</div>'
          : '') +
        '</section>';
    }

    var s = _cmCompReviewSummary(r);
    html +=
      '<div class="cm-import-foot">' +
      '<div>' +
      s +
      '</div>' +
      '<div class="cm-import-buttons">' +
      '<button type="button" class="cm-action-btn" data-action="cmCompReviewCancel">Cancel</button>' +
      '<button type="button" class="btn btn-primary" data-action="cmCompReviewApply"' +
      (_cmCompReviewCount(r) === 0 && !_cmCompReviewLinkChanges(r) ? ' disabled' : '') +
      '>Apply Changes</button>' +
      '</div>' +
      '</div>' +
      '</div>';
    return html;
  }

  function _cmCompReviewLinkChanges(r) {
    if (r.kind === 'file') return false;
    var now = (COURSES[r.cid] && COURSES[r.cid].curriculumTags) || [];
    return now.slice().sort().join('|') !== (r.tags || []).slice().sort().join('|');
  }

  function _cmCompReviewParts(r) {
    var file = r.kind === 'file';
    return {
      back: r.add.filter(function (a) {
        return a.on && a.removed;
      }),
      add: r.add.filter(function (a) {
        return a.on && !a.removed;
      }),
      theirs: r.changed.filter(function (c) {
        return c.pick === 'theirs';
      }),
      replaced: (r.replaced || []).filter(function (x) {
        return x.pick === 'theirs';
      }),
      fill: r.fill || [],
      remove: r.onlyMine.filter(function (o) {
        return o.pick === 'remove';
      }),
      versionOf: file ? 'use the file\u2019s version of ' : 'use the curriculum version of ',
    };
  }

  function _cmCompReviewCount(r) {
    var p = _cmCompReviewParts(r);
    return p.back.length + p.add.length + p.theirs.length + p.replaced.length + p.fill.length + p.remove.length;
  }

  function _cmCompReviewSummary(r) {
    var p = _cmCompReviewParts(r);
    var n = _cmCompReviewCount(r);
    if (!n) {
      return _cmCompReviewLinkChanges(r)
        ? '<strong>No competency changes.</strong> Apply saves the new curriculum link.'
        : '<strong>No changes.</strong>';
    }
    function names(list, fn) {
      return list.map(fn);
    }
    var phrases = [];
    if (p.back.length)
      phrases.push(
        'add back ' +
          _cmJoinNames(
            names(p.back, function (a) {
              return _cmCompTitle(a.removed);
            }),
            'competencies',
          ),
      );
    if (p.add.length)
      phrases.push(
        'add ' +
          _cmJoinNames(
            names(p.add, function (a) {
              return a.cand.label || a.cand.text;
            }),
            'competencies',
          ),
      );
    if (p.theirs.length)
      phrases.push(
        p.versionOf +
          _cmJoinNames(
            names(p.theirs, function (c) {
              return _cmCompTitle(c.sec);
            }),
            'competencies',
          ),
      );
    var replacedOne = p.replaced.filter(function (x) {
      return x.cands.length === 1;
    });
    var replacedMany = p.replaced.filter(function (x) {
      return x.cands.length > 1;
    });
    if (replacedOne.length)
      phrases.push(
        'use the curriculum version of ' +
          _cmJoinNames(
            names(replacedOne, function (x) {
              return _cmCompTitle(x.sec);
            }),
            'competencies',
          ),
      );
    if (replacedMany.length)
      phrases.push(
        'add the curriculum version of ' +
          _cmJoinNames(
            names(replacedMany, function (x) {
              return _cmCompTitle(x.sec) + ' (' + x.cands.length + ' competencies)';
            }),
            'competencies',
          ),
      );
    if (p.fill.length)
      phrases.push(
        'add I Can statements to ' +
          _cmJoinNames(
            names(p.fill, function (x) {
              return _cmCompTitle(x.sec);
            }),
            'competencies',
          ),
      );
    if (p.remove.length)
      phrases.push(
        'remove ' +
          _cmJoinNames(
            names(p.remove, function (o) {
              return _cmCompTitle(o.sec);
            }),
            'competencies',
          ),
      );
    var tail =
      p.theirs.length || p.replaced.length || p.remove.length
        ? ' Scores are kept.'
        : r.onlyMine.length
          ? ' Your edits and your own competencies stay.'
          : ' Your edits stay.';
    // Removing one moves grades, as the Remove confirm says.
    if (p.remove.length) {
      var moved = previewCompetencyRemoval(
        r.cid,
        p.remove.map(function (o) {
          return _currentId('section', o.sec.id);
        }),
      );
      if (moved.changed)
        tail += ' The removals change the grade for ' + moved.changed + ' of your ' + moved.total + ' students.';
    }
    return '<strong>' + n + (n === 1 ? ' change:' : ' changes:') + '</strong> ' + esc(phrases.join('; ')) + '.' + tail;
  }

  function cmCompReviewToggle(idx, on) {
    if (!state.cmCompReview || !state.cmCompReview.add[idx]) return;
    state.cmCompReview.add[idx].on = !!on;
    _cmRenderAndFocus('[data-action-change="cmCompReviewToggle"][data-idx=' + _cmAttr(idx) + ']');
  }

  function cmCompReviewPick(group, idx, pick) {
    var list = state.cmCompReview && state.cmCompReview[group];
    if (!list || !list[idx]) return;
    list[idx].pick = pick;
    _cmRenderAndFocus(
      '[data-action-change="cmCompReviewPick"][data-group=' +
        _cmAttr(group) +
        '][data-idx=' +
        _cmAttr(idx) +
        '][data-pick=' +
        _cmAttr(pick) +
        ']',
    );
  }

  function cmCompReviewShowSame() {
    if (!state.cmCompReview) return;
    state.cmCompReview.showSame = !state.cmCompReview.showSame;
    _cmRenderAndFocus('[data-action="cmCompReviewShowSame"]');
  }

  function _cmCloseCompReview() {
    state.cmCompReview = null;
    state.cmRelinkCid = null;
    state.cmRelinkStep = 0;
    state.cwSelectedTags = [];
  }

  function cmCompReviewCancel() {
    _cmCloseCompReview();
    state.cmTab = 'competencies';
    renderClassManager();
  }

  /* Apply the review. Changes to the learning map that would move any
     student's overall proficiency ask first, with the count, as the
     grading settings do. */
  function cmCompReviewApply(confirmed) {
    var r = state.cmCompReview;
    if (!r) return;
    var cid = r.cid;
    var p = _cmCompReviewParts(r);
    var touchesMap = p.add.length || p.theirs.length || p.replaced.length || p.fill.length;
    var removeIds = p.remove.map(function (o) {
      return _currentId('section', o.sec.id);
    });

    if ((touchesMap || p.back.length || p.remove.length) && confirmed !== true) {
      // The copy gets the whole Apply, in its order: put back, map edits, removals.
      var preview = previewLearningMapChange(cid, function (copy) {
        if (!copy.sections) copy.sections = [];
        p.back.forEach(function (a) {
          var id = a.removed.id;
          if (
            !copy.sections.some(function (s) {
              return s.id === id;
            })
          )
            copy.sections.push(structuredClone(a.removed));
        });
        if (touchesMap) _cmApplyReviewToMap(cid, copy, p);
        var drop = {};
        removeIds.forEach(function (id) {
          drop[resolveLearningMapId(cid, 'section', id)] = true;
        });
        copy.sections = copy.sections.filter(function (s) {
          return !drop[s.id];
        });
      });
      if (preview.changed) {
        showConfirm(
          'Change Grades?',
          _cmGradeChangeMessage(cid, preview) + CM_FOLDER_COUNT_SENT,
          'Apply Changes',
          'primary',
          function () {
            cmCompReviewApply(true);
          },
        );
        return;
      }
    }

    // Put removed competencies back first: each brings its scores with it.
    p.back.forEach(function (a) {
      restoreCompetency(cid, a.removed.id);
    });

    if (touchesMap) {
      var map = ensureCustomLearningMap(cid);
      _cmApplyReviewToMap(cid, map, p);
      saveLearningMap(cid, map);
    }

    if (p.remove.length) removeCompetencies(cid, removeIds);

    if (r.kind !== 'file' && _cmCompReviewLinkChanges(r)) updateCourse(cid, { curriculumTags: r.tags.slice() });

    _cmCloseCompReview();
    state.cmTab = 'competencies';
    renderClassManager();
  }

  /* The review's changes to a learning map: Replaced in the Curriculum
     first (it makes the Ministry folders), then the additions, the I Can
     fills and the curriculum versions. */
  function _cmApplyReviewToMap(cid, map, p) {
    if (!map.subjects) map.subjects = [];
    if (!map.sections) map.sections = [];
    if (!map.competencyGroups) map.competencyGroups = [];
    var taken = {};
    map.sections.forEach(function (s) {
      taken[s.id] = true;
    });
    getRemovedSections(cid).forEach(function (x) {
      if (x && x.section) taken[x.section.id] = true;
    });
    function freshId(base) {
      var id = base && !taken[base] ? base : (base ? base + '_' : '') + uid();
      taken[id] = true;
      return id;
    }
    function findSec(id) {
      return map.sections.find(function (s) {
        return s.id === _currentId('section', id);
      });
    }
    // The class's folder with a Ministry folder's name, made if missing.
    function folderFor(name, color) {
      if (!name) return null;
      var grp = _cmFolderNamed(map, name);
      if (!grp) {
        grp = {
          id: 'grp_' + uid(),
          name: name,
          color: color || '#6366f1',
          sortOrder: map.competencyGroups.length,
        };
        map.competencyGroups.push(grp);
      }
      return grp;
    }
    // A curriculum competency as a new row of this class.
    function addFromCurriculum(c, grp) {
      var add = structuredClone(c.section);
      add.id = freshId('');
      add.tags[0].id = add.id;
      var subjectId = _cmClassSubjectFor(map, c.subject);
      if (subjectId) add.subject = add.tags[0].subject = subjectId;
      delete add.groupId;
      if (grp) add.groupId = grp.id;
      map.sections.push(add);
    }

    // Replaced in the Curriculum. One for one: the competency takes the
    // curriculum's name, code, wording and course in place, keeping its
    // scores. One for several: each statement goes in its own Ministry
    // folder, and the competency moves, unchanged, into the folder most of
    // them go to.
    p.replaced.forEach(function (x) {
      var sec = findSec(x.sec.id);
      if (!sec || !sec.tags[0]) return;
      var tag = sec.tags[0];
      var lead = x.cands[0];
      var subjectId = _cmClassSubjectFor(map, lead.subject);
      if (subjectId && sec.subject !== subjectId) {
        sec.subject = tag.subject = subjectId;
        sec.color = tag.color = lead.section.color;
      }
      if (x.cands.length === 1) {
        tag.label = lead.label;
        tag.code = lead.code;
        tag.text = lead.text;
        tag.source_text = lead.source_text;
        tag.i_can_statements = lead.icans.slice();
        tag.bank_id = lead.bank_id || null;
        sec.name = tag.name = lead.label;
        sec.shortName = tag.shortName = lead.section.shortName;
        return;
      }
      var home = _cmReplacedHome(x);
      if (home) sec.groupId = folderFor(home, sec.color).id;
      x.cands.forEach(function (c) {
        addFromCurriculum(c, folderFor(c.folder, c.section.color));
      });
    });

    p.add.forEach(function (a) {
      var c = a.cand;
      if (c.section) {
        // From the curriculum: the class's folder with its Ministry
        // folder's name takes it.
        addFromCurriculum(c, c.folder ? _cmFolderNamed(map, c.folder) : null);
        return;
      }
      if (!map.subjects.length) map.subjects.push({ id: 'subj1', name: 'General', color: '#6366f1' });
      var sub = map.subjects[0];
      var id = freshId('');
      var label = c.label || c.text.slice(0, 40);
      var short = label.split(' ')[0];
      var sec = {
        id: id,
        subject: sub.id,
        name: label,
        shortName: short,
        color: sub.color,
        tags: [
          {
            id: id,
            code: c.code || undefined,
            label: label,
            text: c.text,
            i_can_statements: c.icans.slice(),
            color: sub.color,
            subject: sub.id,
            name: label,
            shortName: short,
          },
        ],
      };
      if (!sec.tags[0].code) delete sec.tags[0].code;
      if (c.folder) sec.groupId = folderFor(c.folder, '#6366f1').id;
      map.sections.push(sec);
    });

    // No I Can statements yet: the curriculum's.
    p.fill.forEach(function (x) {
      var sec = findSec(x.sec.id);
      if (sec && sec.tags[0] && !(sec.tags[0].i_can_statements || []).length)
        sec.tags[0].i_can_statements = x.cand.icans.slice();
    });

    p.theirs.forEach(function (ch) {
      var sec = findSec(ch.sec.id);
      if (!sec || !sec.tags[0]) return;
      var tag = sec.tags[0];
      if (ch.cand.label) tag.label = ch.cand.label;
      tag.text = ch.cand.text;
      tag.i_can_statements = ch.cand.icans.slice();
      if (ch.cand.source_text) tag.source_text = ch.cand.source_text;
    });
    map._flatVersion = 2;
  }

  /* The class's course for a curriculum candidate's: the one with its id
     or its name, else a new one with a fresh id. */
  function _cmClassSubjectFor(map, subject) {
    if (!subject) return null;
    var own = (map.subjects || []).find(function (s) {
      return s.id === subject.id || _cmNorm(s.name) === _cmNorm(subject.name);
    });
    if (own) return own.id;
    var add = structuredClone(subject);
    add.id = uid();
    map.subjects.push(add);
    return add.id;
  }

  /* Where Add the Curriculum Version puts things, in words: each Ministry
     folder the statements go to, and where the old competency goes. */
  function _cmReplacedNote(cid, x) {
    var map = getLearningMap(cid);
    var folders = [];
    x.cands.forEach(function (c) {
      if (c.folder && folders.indexOf(c.folder) < 0) folders.push(c.folder);
    });
    var where = folders.map(function (name) {
      return _cmFolderNamed(map, name) ? 'your ' + name + ' folder' : 'a new folder, ' + name;
    });
    var home = _cmReplacedHome(x);
    return (
      'Adds these ' +
      x.cands.length +
      (where.length ? ' in ' + where.join(' and ') : '') +
      '. Your ' +
      (_cmStdCode(x.sec.tags[0]) || _cmCompTitle(x.sec)) +
      (home
        ? (where.length === 1 ? ' moves into the same folder' : ' moves into the ' + home + ' folder') +
          ' and keeps its scores.'
        : ' keeps its scores.') +
      ' Nothing is renamed.'
    );
  }

  // The Ministry folder most of a merged line's statements go to.
  function _cmReplacedHome(x) {
    var count = {};
    var best = '';
    x.cands.forEach(function (c) {
      if (!c.folder) return;
      count[c.folder] = (count[c.folder] || 0) + 1;
      if (!best || count[c.folder] > count[best]) best = c.folder;
    });
    return best;
  }

  function _cmFolderNamed(map, name) {
    return (map.competencyGroups || []).find(function (g) {
      return _cmNorm(g.name) === _cmNorm(name);
    });
  }

  /* The Remove confirm: what it does to grades, then that the scores are
     kept for putting it back. */
  function _cmRemoveMessage(cid, secIds, lead) {
    var preview = previewCompetencyRemoval(cid, secIds);
    var moves = preview.changed
      ? ' This changes the grade for ' +
        preview.changed +
        ' of your ' +
        preview.total +
        ' students' +
        (preview.example
          ? '. For example, ' +
            /** @type {any} */ (preview.example).name +
            ' goes from ' +
            /** @type {any} */ (preview.example).before +
            ' to ' +
            /** @type {any} */ (preview.example).after +
            '.'
          : '.') +
        ' Marks you\u2019ve already copied into MyEd won\u2019t change there.'
      : '';
    return (
      lead +
      moves +
      (secIds.length === 1
        ? ' Its scores are kept, so Re-link can put it back.'
        : ' Their scores are kept, so Re-link can put them back.')
    );
  }

  return {
    configure: configure,
    _cmLoose: _cmLoose,
    _cmNorm: _cmNorm,
    _cmOpenCompReview: _cmOpenCompReview,
    _cmRemoveMessage: _cmRemoveMessage,
    _cmRenderCompReview: _cmRenderCompReview,
    cmCompReviewApply: cmCompReviewApply,
    cmCompReviewCancel: cmCompReviewCancel,
    cmCompReviewPick: cmCompReviewPick,
    cmCompReviewShowSame: cmCompReviewShowSame,
    cmCompReviewToggle: cmCompReviewToggle,
  };
})();
