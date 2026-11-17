// @ts-check
/* Class Settings, Reflect tab: See Answers (docs/plans/reflect-plan.md,
   board 3). One reflection's answers, two ways: Summary, each question
   counted for the class, and By Student, one student's whole reflection.
   Print prints either on its own sheet.

   The Reflect tab (teacher/cm-questionnaires.js) shows render(cid, qid) in
   place of its list and hands over every sqAns… action and change. The
   way back (sqAnsBack) is the tab's: handleAction returns false for it.

   These are students' own words and self-ratings, not grades: nothing here
   goes near calc.js, a rating has no average, and no group of students is
   ever set against another. Every bar and cell shows its number, so
   nothing rests on colour. Answers are read through StudentVoice, which
   gives the same shapes for a signed-in class (list_course_responses) and
   Demo Mode (gb-responses-<cid>). */
var CmReflectAnswers = (function () {
  'use strict';

  // The other parts of the app this reads, as the page has them.
  var G = /** @type {any} */ (typeof window !== 'undefined' ? window : globalThis);

  var STEPS = ['Beginning', 'Growing', 'Confident', 'Leading'];
  var SHOWN = 3; // text answers shown before See All
  var PRINT_ROOT = 'ra-print-root';
  var PRINT_STYLE = 'ra-print-page';

  var _view = {}; // qid -> 'summary' | 'student'
  var _sid = {}; // qid -> the student By Student shows
  var _all = {}; // qid|key -> every text answer shown
  var _pick = {}; // qid|key -> the bar or cell whose students show

  /* ── Small helpers ─────────────────────────────────────────── */

  function _rerender(focusSel) {
    if (typeof G.DashClassManager !== 'undefined' && G.DashClassManager.renderClassManager) {
      G.DashClassManager.renderClassManager();
    }
    // The first of these still on the page takes the focus back.
    var sels = focusSel ? [].concat(focusSel) : [];
    for (var i = 0; i < sels.length && typeof document !== 'undefined'; i++) {
      var el = /** @type {HTMLElement | null} */ (document.querySelector(sels[i]));
      if (el && el.focus) {
        el.focus();
        return;
      }
    }
  }

  function _box(el) {
    return el && el.closest ? el.closest('.ra[data-qid]') : null;
  }

  function _str(x) {
    return x == null ? '' : String(x).trim();
  }

  function _shortName(st) {
    var first = _str(st.preferred || st.firstName);
    var last = _str(st.lastName);
    return (first + (last ? ' ' + last.charAt(0) + '.' : '')).trim() || 'Student';
  }

  function _longName(st) {
    return typeof displayNameWithLast === 'function'
      ? displayNameWithLast(st)
      : (_str(st.preferred || st.firstName) + ' ' + _str(st.lastName)).trim();
  }

  function _coreName(id) {
    return typeof G.LearnerProfile !== 'undefined' && G.LearnerProfile.coreName ? G.LearnerProfile.coreName(id) : id;
  }

  function _day(iso) {
    if (!iso) return '';
    var t = new Date(String(iso).length === 10 ? iso + 'T12:00:00' : iso);
    return isNaN(t.getTime()) ? '' : t.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' });
  }

  function _plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many);
  }

  function _sv() {
    return G.StudentVoice || null;
  }

  function _has(v) {
    var sv = _sv();
    if (sv && sv.hasAnswer) return sv.hasAnswer(v);
    return !!(v && (v.num != null || _str(v.text) || v.json));
  }

  function _words(q, v) {
    var sv = _sv();
    if (sv && sv.answerText) return sv.answerText(q, v);
    return v ? _str(v.text) : '';
  }

  /* ── Counting (pure: a question and its answers in, counts out) ──
     rows: [{ sid, v, at }], one per student who answered it. */

  // The texts a choice answer chose: value_json, or value_text as one.
  function _chosen(v) {
    if (!v) return [];
    if (Array.isArray(v.json)) return v.json.map(_str).filter(Boolean);
    var t = _str(v.text);
    return t ? [t] : [];
  }

  function _bars(labels, rows, keyOf) {
    var bars = labels.map(function (label) {
      return { label: label, n: 0, sids: [] };
    });
    rows.forEach(function (r) {
      keyOf(r).forEach(function (i) {
        if (i < 0 || !bars[i]) return;
        bars[i].n++;
        bars[i].sids.push(r.sid);
      });
    });
    return bars;
  }

  function _byCount(bars) {
    return bars
      .map(function (b, i) {
        return { b: b, i: i };
      })
      .sort(function (x, y) {
        return y.b.n - x.b.n || x.i - y.i;
      })
      .map(function (x) {
        return x.b;
      });
  }

  function _textList(rows, textOf) {
    return rows
      .map(function (r) {
        return { sid: r.sid, at: r.at, text: textOf(r) };
      })
      .filter(function (x) {
        return !!x.text;
      })
      .sort(function (a, b) {
        return String(b.at || '').localeCompare(String(a.at || ''));
      });
  }

  function summarise(q, rows) {
    q = q || {};
    rows = rows || [];
    var o = q.options || {};
    var sv = _sv();
    switch (q.kind) {
      case 'section':
        return { type: 'section' };
      case 'text':
        return { type: 'list', items: _textList(rows, r => _str(r.v && r.v.text) || _words(q, r.v)) };
      case 'short_set': {
        var labels = Array.isArray(o.labels) ? o.labels : [];
        return {
          type: 'list',
          items: _textList(rows, function (r) {
            var vals = r.v && Array.isArray(r.v.json) ? r.v.json : null;
            if (!vals) return _str(r.v && r.v.text);
            return vals
              .map(function (x, i) {
                var t = _str(x);
                return t ? (labels[i] ? labels[i] + ': ' : '') + t : '';
              })
              .filter(Boolean)
              .join(' · ');
          }),
        };
      }
      case 'choice': {
        var choices = (Array.isArray(o.choices) ? o.choices : []).map(_str);
        var other = [];
        var bars = _bars(choices, rows, function (r) {
          return _chosen(r.v).map(function (t) {
            var i = choices.indexOf(t);
            if (i < 0) other.push({ sid: r.sid, text: t, at: r.at });
            return i;
          });
        });
        bars = _byCount(bars);
        if (other.length) {
          bars.push({
            label: 'Other',
            n: other.length,
            sids: other.map(function (x) {
              return x.sid;
            }),
            other: true,
          });
        }
        return { type: 'bars', bars: bars, other: other };
      }
      case 'rating': {
        var levels = sv && sv.ratingLevels ? sv.ratingLevels(q) : Number(o.levels) || 5;
        var names = [];
        for (var n = levels; n >= 1; n--) {
          var end = n === levels ? _str(o.high) : n === 1 ? _str(o.low) : '';
          names.push(n + (end ? ' · ' + end : ''));
        }
        return {
          type: 'bars',
          bars: _bars(names, rows, function (r) {
            var x = sv && sv.ratingOf ? sv.ratingOf(r.v) : Number(r.v && r.v.num);
            return x >= 1 && x <= levels ? [levels - x] : [];
          }),
        };
      }
      case 'date': {
        var days = [];
        rows.forEach(function (r) {
          var d = _str(r.v && r.v.text);
          if (d && days.indexOf(d) < 0) days.push(d);
        });
        days.sort();
        var dateBars = _bars(
          days.map(function (d) {
            return sv && sv.dateWords ? sv.dateWords(d) : d;
          }),
          rows,
          function (r) {
            return [days.indexOf(_str(r.v && r.v.text))];
          },
        );
        return { type: 'bars', bars: dateBars };
      }
      case 'ranking': {
        var items = (Array.isArray(o.choices) ? o.choices : []).map(_str);
        var acc = items.map(function (label) {
          return { label: label, sum: 0, count: 0, first: 0, firstSids: [] };
        });
        rows.forEach(function (r) {
          var order = sv && sv.rankingOf ? sv.rankingOf(r.v) : [];
          order.forEach(function (c, pos) {
            var i = items.indexOf(c);
            if (i < 0) return;
            acc[i].sum += pos + 1;
            acc[i].count++;
            if (pos === 0) {
              acc[i].first++;
              acc[i].firstSids.push(r.sid);
            }
          });
        });
        var ranked = acc
          .map(function (a, i) {
            return {
              label: a.label,
              avg: a.count ? a.sum / a.count : null,
              first: a.first,
              firstSids: a.firstSids,
              i: i,
            };
          })
          .sort(function (a, b) {
            if (a.avg == null || b.avg == null) return (a.avg == null ? 1 : 0) - (b.avg == null ? 1 : 0) || a.i - b.i;
            return a.avg - b.avg || b.first - a.first || a.i - b.i;
          });
        return { type: 'ranking', rows: ranked };
      }
      case 'likert': {
        var statements = (Array.isArray(o.statements) ? o.statements : []).map(_str);
        var columns = (Array.isArray(o.choices) ? o.choices : []).map(_str);
        var cells = statements.map(function () {
          return columns.map(function () {
            return { n: 0, sids: [] };
          });
        });
        var max = 0;
        rows.forEach(function (r) {
          var got = sv && sv.likertOf ? sv.likertOf(r.v) : {};
          statements.forEach(function (s, si) {
            var ci = columns.indexOf(_str(got[s]));
            if (ci < 0) return;
            var cell = cells[si][ci];
            cell.n++;
            cell.sids.push(r.sid);
            if (cell.n > max) max = cell.n;
          });
        });
        return { type: 'grid', statements: statements, columns: columns, cells: cells, max: max };
      }
      case 'scale4': {
        var steps = Array.isArray(o.steps) && o.steps.length === 4 ? o.steps : STEPS;
        var cores = q.core_ids || [];
        if (!cores.length) {
          return {
            type: 'bars',
            bars: _bars(
              [1, 2, 3, 4].map(function (n) {
                return String(n);
              }),
              rows,
              function (r) {
                var x = Number(r.v && r.v.num);
                return x >= 1 && x <= 4 ? [x - 1] : [];
              },
            ),
            why: _textList(rows, function (r) {
              var j = (r.v && r.v.json) || {};
              return typeof j.why === 'string' ? _str(j.why) : _str(r.v && r.v.text);
            }),
          };
        }
        return {
          type: 'core',
          comps: cores.map(function (k) {
            return {
              id: k,
              name: _coreName(k),
              bars: _bars(steps, rows, function (r) {
                var lv = Number((((r.v && r.v.json) || {}).levels || {})[k]);
                return lv >= 1 && lv <= 4 ? [lv - 1] : [];
              }),
              why: _textList(rows, function (r) {
                var why = ((r.v && r.v.json) || {}).why;
                return why && typeof why === 'object' ? _str(why[k]) : '';
              }),
            };
          }),
        };
      }
      case 'goal_status': {
        var statuses = (Array.isArray(o.choices) ? o.choices : []).map(_str);
        return {
          type: 'bars',
          bars: _bars(statuses, rows, function (r) {
            var t = _str(r.v && r.v.text);
            var i = statuses.indexOf(t);
            if (i < 0 && r.v && r.v.num != null) i = Number(r.v.num) - 1;
            return [i];
          }),
        };
      }
      case 'core_pick': {
        var ids = (q.core_ids || []).slice();
        rows.forEach(function (r) {
          var t = _str(r.v && r.v.text);
          if (t && ids.indexOf(t) < 0) ids.push(t);
        });
        return {
          type: 'bars',
          bars: _byCount(
            _bars(ids.map(_coreName), rows, function (r) {
              return [ids.indexOf(_str(r.v && r.v.text))];
            }),
          ),
        };
      }
      default:
        return { type: 'list', items: _textList(rows, r => _words(q, r.v)) };
    }
  }

  /* ── The reflection and its answers ────────────────────────── */

  function _students(cid) {
    return typeof getStudents === 'function' ? getStudents(cid) || [] : [];
  }

  function _questionnaires(cid) {
    if (typeof G.Questionnaires === 'undefined') return [];
    // Demo Mode reads this device each time (G.StudentVoice.loaded does).
    var sv = _sv();
    if (sv && sv.loaded) sv.loaded(cid);
    return G.Questionnaires.list(cid);
  }

  /* A signed-in class reads its answers once (list_course_responses), and
     again when the copy is older than FRESH_MS; the view redraws when they
     arrive. True while they are on their way. */
  var FRESH_MS = 15000;
  function _waiting(cid) {
    var sv = _sv();
    if (!sv || !sv.load || !sv.loaded) return false;
    var redraw = function () {
      _rerender();
    };
    if (!sv.loaded(cid)) {
      sv.load(cid, redraw);
      return !sv.loaded(cid);
    }
    if (sv.refreshIfStale) sv.refreshIfStale(cid, FRESH_MS, redraw);
    return false;
  }

  /* Everything both views draw: { q, forms: [{ form, items, removed }],
     students, byId, answered (sids), missing (students), resp: {form id:
     {sid: response}} }. An item is { q, num, rows, sum }. A Goal Check-In
     (a questionnaire whose parent_id is this one) follows as a form of its
     own; only students on the class list are counted. */
  function model(cid, qid) {
    var list = _questionnaires(cid);
    var q = list.find(function (x) {
      return x.id === qid;
    });
    if (!q) return null;
    var students = _students(cid);
    var byId = {};
    students.forEach(function (s) {
      byId[s.id] = s;
    });
    var sv = _sv();
    var forms = [q].concat(
      list.filter(function (x) {
        return x.parent_id === q.id;
      }),
    );
    var resp = {};
    var num = 0;
    var out = forms.map(function (form) {
      var all = sv && sv.responses ? sv.responses(cid, form.id) : {};
      var mine = {};
      students.forEach(function (s) {
        if (all[s.id]) mine[s.id] = all[s.id];
      });
      resp[form.id] = mine;
      var rowsFor = function (id) {
        var rows = [];
        students.forEach(function (s) {
          var r = mine[s.id];
          var v = r && r.answers ? r.answers[id] : null;
          if (_has(v)) rows.push({ sid: s.id, v: v, at: r.submitted_at });
        });
        return rows;
      };
      var live = {};
      var archived = {};
      var items = [];
      (form.questions || []).forEach(function (x) {
        if (x.archived) {
          archived[x.id] = x;
          return;
        }
        live[x.id] = true;
        var rows = x.kind === 'section' ? [] : rowsFor(x.id);
        items.push({ q: x, num: x.kind === 'section' ? null : ++num, rows: rows, sum: summarise(x, rows) });
      });
      // Answers to questions taken out since: by the question's words when
      // the list still has it, otherwise as plain answers. For a signed-in
      // class the list never has it: the server's _questionnaire_json leaves
      // archived questions out, so `archived[id]` is never found and such an
      // answer shows as "A question since removed", read as text.
      var goneIds = [];
      Object.keys(mine).forEach(function (sid) {
        Object.keys(mine[sid].answers || {}).forEach(function (id) {
          if (!live[id] && goneIds.indexOf(id) < 0 && _has(mine[sid].answers[id])) goneIds.push(id);
        });
      });
      var removed = goneIds.map(function (id) {
        var x = archived[id] || { id: id, prompt: 'A question since removed', kind: 'text', options: {} };
        var rows = rowsFor(id);
        return { q: x, num: null, rows: rows, sum: summarise(x, rows) };
      });
      return { form: form, items: items, removed: removed };
    });
    var answered = students
      .filter(function (s) {
        return !!resp[q.id][s.id];
      })
      .map(function (s) {
        return s.id;
      });
    return {
      cid: cid,
      q: q,
      forms: out,
      students: students,
      byId: byId,
      answered: answered,
      missing: students.filter(function (s) {
        return !resp[q.id][s.id];
      }),
      resp: resp,
    };
  }

  /* ── Drawing: shared pieces ────────────────────────────────── */

  // A student's name, leading to their page (on paper, just the name).
  function _name(m, sid, print) {
    var st = m.byId[sid];
    if (!st) return '';
    if (print) return '<span class="ra-name">' + esc(_shortName(st)) + '</span>';
    return (
      '<button type="button" class="ra-name" data-action="cmOpenStudentPage" data-sid="' +
      esc(sid) +
      '" title="' +
      esc('Open ' + _longName(st) + '’s page') +
      '">' +
      esc(_shortName(st)) +
      '</button>'
    );
  }

  function _names(m, sids, print) {
    return sids
      .map(function (sid) {
        return _name(m, sid, print);
      })
      .filter(Boolean)
      .join('<span class="ra-sep">, </span>');
  }

  function _status(q) {
    if (typeof G.Questionnaires === 'undefined' || !G.Questionnaires.status) return '';
    var s = G.Questionnaires.status(q);
    if (s.state === 'open') return q.closes_on ? 'On until ' + _day(q.closes_on) : 'On until you turn it off';
    return s.text || '';
  }

  function _questionHead(it, count) {
    var q = it.q;
    var sub = q.options && q.options.subtitle;
    return (
      '<div class="ra-q-head"><h4 class="ra-q">' +
      esc((it.num ? it.num + '. ' : '') + (q.prompt || '')) +
      '</h4>' +
      (count != null ? '<span class="ra-q-count">' + esc(_plural(count, 'answer', 'answers')) + '</span>' : '') +
      '</div>' +
      (q.teacher_only ? '<div class="ra-private">Private note to you</div>' : '') +
      (sub ? '<div class="ra-q-sub">' + esc(sub) + '</div>' : '')
    );
  }

  /* ── Summary ───────────────────────────────────────────────── */

  function _key(m, k) {
    return m.q.id + '|' + k;
  }

  // The students behind a picked bar or cell, under the chart.
  function _who(m, label, sids, print) {
    return (
      '<div class="ra-who" role="status"><strong>' +
      esc(label + ' (' + sids.length + '):') +
      '</strong> ' +
      (sids.length ? _names(m, sids, print) : 'No one') +
      '</div>'
    );
  }

  function _barsHtml(m, k, bars, print) {
    var max = 0;
    bars.forEach(function (b) {
      if (b.n > max) max = b.n;
    });
    var picked = print ? null : _pick[_key(m, k)];
    var html = '<div class="ra-bars">';
    bars.forEach(function (b, i) {
      var pk = 'b' + i;
      // The bar's share of the longest, as a CSS fraction.
      var w = max ? (b.n * 100) / max : 0;
      var inner =
        '<span class="ra-bar-label">' +
        esc(b.label) +
        '</span><span class="ra-bar-track"><span class="ra-bar-fill" style="width:' +
        w +
        '%"></span></span><span class="ra-bar-n">' +
        b.n +
        '</span>';
      html += print
        ? '<div class="ra-bar">' + inner + '</div>'
        : '<button type="button" class="ra-bar' +
          (picked === pk ? ' is-picked' : '') +
          '" data-action="sqAnsPick" data-key="' +
          esc(k) +
          '" data-pick="' +
          pk +
          '" aria-expanded="' +
          (picked === pk) +
          '" aria-label="' +
          esc(b.label + ': ' + _plural(b.n, 'student', 'students')) +
          '">' +
          inner +
          '</button>';
    });
    html += '</div>';
    var shown = picked && /^b\d+$/.test(picked) ? bars[Number(picked.slice(1))] : null;
    if (shown) html += _who(m, shown.label, shown.sids, print);
    else if (!print && max) html += '<div class="ra-hint">Click a bar to see who chose it.</div>';
    return html;
  }

  function _listHtml(m, k, items, print) {
    if (!items.length) return '<div class="ra-none">No answers yet.</div>';
    var open = print || _all[_key(m, k)];
    var shown = open ? items : items.slice(0, SHOWN);
    var html =
      '<div class="ra-list">' +
      shown
        .map(function (x) {
          return _name(m, x.sid, print) + '<span class="ra-text">' + esc(x.text) + '</span>';
        })
        .join('') +
      '</div>';
    if (!print && items.length > SHOWN) {
      html +=
        '<div><button type="button" class="ra-more" data-action="sqAnsAll" data-key="' +
        esc(k) +
        '" aria-expanded="' +
        !!open +
        '">' +
        esc(open ? 'Show Fewer' : 'See All ' + items.length) +
        '</button></div>';
    }
    return html;
  }

  // Tints of the one blue: darker means more, the darkest with white text
  // (every step keeps its number at 4.5:1 or better).
  function _tint(n, max) {
    if (!n || !max) return 0;
    var r = n / max;
    return r > 0.9 ? 6 : r > 0.75 ? 5 : r > 0.5 ? 4 : r > 0.4 ? 3 : r > 0.15 ? 2 : 1;
  }

  function _gridHtml(m, k, s, print) {
    if (!s.statements.length || !s.columns.length) return '<div class="ra-none">No answers yet.</div>';
    var picked = print ? null : _pick[_key(m, k)];
    var html =
      '<table class="ra-grid-t"><thead><tr><td></td>' +
      s.columns
        .map(function (c) {
          return '<th scope="col">' + esc(c) + '</th>';
        })
        .join('') +
      '</tr></thead><tbody>';
    s.statements.forEach(function (st, si) {
      html += '<tr><th scope="row">' + esc(st) + '</th>';
      s.columns.forEach(function (c, ci) {
        var cell = s.cells[si][ci];
        var pk = 'g' + si + '-' + ci;
        var cls = 'ra-cell ra-t' + _tint(cell.n, s.max) + (picked === pk ? ' is-picked' : '');
        html += print
          ? '<td><span class="' + cls + '">' + cell.n + '</span></td>'
          : '<td><button type="button" class="' +
            cls +
            '" data-action="sqAnsPick" data-key="' +
            esc(k) +
            '" data-pick="' +
            pk +
            '" aria-expanded="' +
            (picked === pk) +
            '" aria-label="' +
            esc(st + ', ' + c + ': ' + _plural(cell.n, 'student', 'students')) +
            '">' +
            cell.n +
            '</button></td>';
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    var pm = picked && /^g(\d+)-(\d+)$/.exec(picked);
    var pc = pm && s.cells[Number(pm[1])] ? s.cells[Number(pm[1])][Number(pm[2])] : null;
    if (pc) html += _who(m, s.statements[Number(pm[1])] + ': ' + s.columns[Number(pm[2])], pc.sids, print);
    html +=
      '<div class="ra-hint">Each number is how many students chose it. Darker means more.' +
      (print ? '' : ' Click a number to see who chose it.') +
      '</div>';
    return html;
  }

  function _rankingHtml(m, k, s, print) {
    var picked = print ? null : _pick[_key(m, k)];
    var html =
      '<ol class="ra-rank">' +
      s.rows
        .map(function (r, i) {
          var pk = 'r' + i;
          var first = 'first for ' + r.first;
          return (
            '<li><span><strong>' +
            (i + 1) +
            '</strong> ' +
            esc(r.label) +
            '</span>' +
            (print || !r.first
              ? '<span class="ra-rank-first">' + esc(first) + '</span>'
              : '<button type="button" class="ra-rank-first ra-more" data-action="sqAnsPick" data-key="' +
                esc(k) +
                '" data-pick="' +
                pk +
                '" aria-expanded="' +
                (picked === pk) +
                '" aria-label="' +
                esc(r.label + ', first for ' + _plural(r.first, 'student', 'students')) +
                '">' +
                esc(first) +
                '</button>') +
            '</li>'
          );
        })
        .join('') +
      '</ol>';
    var pm = picked && /^r(\d+)$/.exec(picked);
    var pr = pm ? s.rows[Number(pm[1])] : null;
    if (pr) html += _who(m, pr.label + ' first', pr.firstSids, print);
    html += '<div class="ra-hint">The class’s order, from every student’s ranking.</div>';
    return html;
  }

  function _otherHtml(m, other, print) {
    if (!other || !other.length) return '';
    return (
      '<div class="ra-other"><div class="ra-hint">Other answers:</div><div class="ra-list">' +
      other
        .map(function (x) {
          return _name(m, x.sid, print) + '<span class="ra-text">“' + esc(x.text) + '”</span>';
        })
        .join('') +
      '</div></div>'
    );
  }

  function _cardHtml(m, it, print) {
    var s = it.sum;
    var k = it.q.id;
    if (s.type === 'section') {
      var sub = it.q.options && it.q.options.subtitle;
      return (
        '<div class="ra-section"><h3>' +
        esc(it.q.prompt || '') +
        '</h3>' +
        (sub ? '<div class="ra-q-sub">' + esc(sub) + '</div>' : '') +
        '</div>'
      );
    }
    var body = '';
    var wide = false;
    if (!it.rows.length) body = '<div class="ra-none">No answers yet.</div>';
    else if (s.type === 'list') {
      body = _listHtml(m, k, s.items, print);
      wide = true;
    } else if (s.type === 'bars') {
      body = _barsHtml(m, k, s.bars, print) + _otherHtml(m, s.other, print);
      if (s.why && s.why.length) body += '<div class="ra-hint">Why?</div>' + _listHtml(m, k + '|why', s.why, print);
    } else if (s.type === 'grid') {
      body = _gridHtml(m, k, s, print);
      wide = true;
    } else if (s.type === 'ranking') body = _rankingHtml(m, k, s, print);
    else if (s.type === 'core') {
      wide = true;
      body =
        '<div class="ra-core">' +
        s.comps
          .map(function (c) {
            return (
              '<div class="ra-core-one"><h5>' +
              esc(c.name) +
              '</h5>' +
              _barsHtml(m, k + '|' + c.id, c.bars, print) +
              (c.why.length
                ? '<div class="ra-hint">Why?</div>' + _listHtml(m, k + '|' + c.id + '|why', c.why, print)
                : '') +
              '</div>'
            );
          })
          .join('') +
        '</div>';
    }
    return (
      '<section class="ra-card' +
      (wide ? ' ra-wide' : '') +
      '">' +
      _questionHead(it, it.rows.length) +
      body +
      '</section>'
    );
  }

  function _missingHtml(m, print) {
    if (!m.students.length) return '';
    if (!m.missing.length) return '<div class="ra-missing"><strong>Everyone has answered.</strong></div>';
    return (
      '<div class="ra-missing"><strong>' +
      esc('Not Answered (' + m.missing.length + '):') +
      '</strong> ' +
      _names(
        m,
        m.missing.map(function (s) {
          return s.id;
        }),
        print,
      ) +
      '</div>'
    );
  }

  function summaryHtml(m, print) {
    var html = _missingHtml(m, print);
    var removed = [];
    m.forms.forEach(function (f, i) {
      if (i > 0) html += '<h3 class="ra-form">' + esc(f.form.title || 'Goal Check-In') + '</h3>';
      if (!f.items.length) html += '<div class="ra-none">This reflection has no questions.</div>';
      else
        html +=
          '<div class="ra-cards">' +
          f.items
            .map(function (it) {
              return _cardHtml(m, it, print);
            })
            .join('') +
          '</div>';
      removed = removed.concat(f.removed);
    });
    if (removed.length) {
      html +=
        '<h3 class="ra-form">Questions Since Removed</h3><div class="ra-cards">' +
        removed
          .map(function (it) {
            return _cardHtml(m, it, print);
          })
          .join('') +
        '</div>';
    }
    return html;
  }

  /* ── By Student ────────────────────────────────────────────── */

  function _current(m) {
    var sid = _sid[m.q.id];
    if (sid && m.byId[sid]) return sid;
    return m.answered[0] || (m.students[0] && m.students[0].id) || null;
  }

  function _answerHtml(q, v) {
    if (!v) return '<div class="ra-none">No answer</div>';
    var o = q.options || {};
    if (q.kind === 'scale4') {
      var j = v.json || {};
      var levels = j.levels || {};
      var why = j.why;
      var cores = (q.core_ids || []).length ? q.core_ids : [null];
      return cores
        .map(function (k) {
          var lv = Number(k ? levels[k] : v.num);
          var w = k ? (why && typeof why === 'object' ? why[k] : '') : typeof why === 'string' ? why : _str(v.text);
          return (
            '<div class="ra-ans-core">' +
            (k ? '<strong>' + esc(_coreName(k)) + ':</strong> ' : '') +
            esc(lv >= 1 && lv <= 4 ? STEPS[lv - 1] : 'No step chosen') +
            (w ? '<div class="ra-ans">' + esc(w) + '</div>' : '') +
            '</div>'
          );
        })
        .join('');
    }
    if (q.kind === 'short_set') {
      var labels = Array.isArray(o.labels) ? o.labels : [];
      var vals = Array.isArray(v.json) ? v.json : [_str(v.text)];
      return (
        '<dl class="ra-ans-set">' +
        vals
          .map(function (x, i) {
            return '<dt>' + esc(labels[i] || 'Answer ' + (i + 1)) + '</dt><dd>' + esc(_str(x) || 'No answer') + '</dd>';
          })
          .join('') +
        '</dl>'
      );
    }
    if (q.kind === 'core_pick') return '<div class="ra-ans">' + esc(_coreName(_str(v.text))) + '</div>';
    if (q.kind === 'goal_status') {
      var t = _str(v.text) || (Array.isArray(o.choices) && v.num ? o.choices[v.num - 1] : '');
      return '<div class="ra-ans">' + esc(t || _words(q, v)) + '</div>';
    }
    var sv = _sv();
    if (q.kind === 'ranking' && sv && sv.rankingOf) {
      return (
        '<ol class="ra-ans-rank">' +
        sv
          .rankingOf(v)
          .map(function (c) {
            return '<li>' + esc(c) + '</li>';
          })
          .join('') +
        '</ol>'
      );
    }
    if (q.kind === 'likert' && sv && sv.likertOf) {
      var got = sv.likertOf(v);
      var statements = Array.isArray(o.statements) ? o.statements : Object.keys(got);
      return (
        '<dl class="ra-ans-set">' +
        statements
          .map(function (s) {
            return '<dt>' + esc(s) + '</dt><dd>' + esc(_str(got[s]) || 'No answer') + '</dd>';
          })
          .join('') +
        '</dl>'
      );
    }
    return '<div class="ra-ans">' + esc(_words(q, v) || 'No answer') + '</div>';
  }

  function _raSheetHtml(m, sid) {
    var st = m.byId[sid];
    if (!st) return '<div class="ra-none">No students in this class yet.</div>';
    var html = '';
    var removed = [];
    m.forms.forEach(function (f, i) {
      var r = m.resp[f.form.id][sid];
      if (i > 0) html += '<h3 class="ra-form">' + esc(f.form.title || 'Goal Check-In') + '</h3>';
      if (r && r.submitted_at) html += '<div class="ra-when">' + esc('Sent ' + _day(r.submitted_at)) + '</div>';
      else
        html += '<div class="ra-when">' + esc(_str(st.preferred || st.firstName) + ' hasn’t answered yet.') + '</div>';
      f.items.forEach(function (it) {
        if (it.q.kind === 'section') {
          html += _cardHtml(m, it, true);
          return;
        }
        var v = r && r.answers ? r.answers[it.q.id] : null;
        html += '<div class="ra-one">' + _questionHead(it, null) + _answerHtml(it.q, _has(v) ? v : null) + '</div>';
      });
      f.removed.forEach(function (it) {
        var v = r && r.answers ? r.answers[it.q.id] : null;
        if (_has(v)) removed.push({ it: it, v: v });
      });
    });
    if (removed.length) {
      html += '<h3 class="ra-form">Questions Since Removed</h3>';
      removed.forEach(function (x) {
        html += '<div class="ra-one">' + _questionHead(x.it, null) + _answerHtml(x.it.q, x.v) + '</div>';
      });
    }
    return html;
  }

  function studentHtml(m) {
    if (!m.students.length) return '<div class="ra-none">No students in this class yet.</div>';
    var sid = _current(m);
    var idx = m.students.findIndex(function (s) {
      return s.id === sid;
    });
    var st = m.byId[sid];
    var answered = {};
    m.answered.forEach(function (id) {
      answered[id] = true;
    });
    return (
      '<div class="ra-stu-bar"><button type="button" class="btn btn-ghost ra-step" id="ra-prev" data-action="sqAnsPrev"' +
      (idx <= 0 ? ' disabled' : '') +
      '>‹ Previous</button><select class="ra-stu-pick" id="ra-stu-pick" aria-label="Student" data-action-change="sqAnsStudent">' +
      m.students
        .map(function (s) {
          return (
            '<option value="' +
            esc(s.id) +
            '"' +
            (s.id === sid ? ' selected' : '') +
            '>' +
            esc(_longName(s) + (answered[s.id] ? '' : ' · Not Answered')) +
            '</option>'
          );
        })
        .join('') +
      '</select><button type="button" class="btn btn-ghost ra-step" id="ra-next" data-action="sqAnsNext"' +
      (idx >= m.students.length - 1 ? ' disabled' : '') +
      '>Next ›</button><span class="ra-stu-count">' +
      esc(idx + 1 + ' of ' + m.students.length) +
      '</span><button type="button" class="ra-more" data-action="cmOpenStudentPage" data-sid="' +
      esc(sid) +
      '">' +
      esc('Open ' + _longName(st) + '’s Page') +
      '</button></div><div class="ra-sheet">' +
      _raSheetHtml(m, sid) +
      '</div>'
    );
  }

  /* ── The view ──────────────────────────────────────────────── */

  function _headHtml(m, view) {
    var seg = function (v, label) {
      return (
        '<button type="button" role="radio" class="seg-btn" id="ra-view-' +
        v +
        '" data-action="sqAnsView" data-view="' +
        v +
        '" aria-checked="' +
        (view === v) +
        '">' +
        label +
        '</button>'
      );
    };
    var status = _status(m.q);
    return (
      '<div class="ra-head"><div class="ra-title"><button type="button" class="ra-back" data-action="sqAnsBack" data-qid="' +
      esc(m.q.id) +
      '">‹ Reflections</button><h2>' +
      esc(m.q.title || 'Reflection') +
      '</h2><div class="ra-sub">' +
      esc(m.answered.length + ' of ' + m.students.length + ' answered' + (status ? ' · ' + status : '')) +
      '</div></div><div class="ra-tools"><div class="seg seg-sm" role="radiogroup" aria-label="View">' +
      seg('summary', 'Summary') +
      seg('student', 'By Student') +
      '</div><button type="button" class="btn btn-ghost" data-action="sqAnsPrint">Print</button></div></div>'
    );
  }

  // html-safe: every name, prompt and answer goes through esc; ids are escaped too.
  function render(cid, qid) {
    if (_waiting(cid)) {
      return (
        '<div class="ra" data-cid="' +
        esc(cid) +
        '" data-qid="' +
        esc(qid) +
        '"><button type="button" class="ra-back" data-action="sqAnsBack">‹ Reflections</button>' +
        '<div class="ra-none" role="status">Reading the answers…</div></div>'
      );
    }
    var m = model(cid, qid);
    if (!m) {
      return (
        '<div class="ra" data-cid="' +
        esc(cid) +
        '" data-qid="' +
        esc(qid) +
        '"><button type="button" class="ra-back" data-action="sqAnsBack">‹ Reflections</button>' +
        '<div class="ra-none">This reflection is no longer here.</div></div>'
      );
    }
    var view = _view[qid] === 'student' ? 'student' : 'summary';
    return (
      '<div class="ra" data-cid="' +
      esc(cid) +
      '" data-qid="' +
      esc(qid) +
      '">' +
      _headHtml(m, view) +
      (view === 'student' ? studentHtml(m) : summaryHtml(m, false)) +
      '</div>'
    );
  }

  /* ── Print ─────────────────────────────────────────────────── */

  function _course(cid) {
    return typeof COURSES !== 'undefined' && COURSES ? COURSES[cid] : null;
  }

  // html-safe: every name, prompt and answer goes through esc.
  function printHtml(m, view) {
    var course = _course(m.cid);
    var cls = typeof G.printClassName === 'function' ? G.printClassName(course) : (course && course.name) || '';
    var head = '<header class="ra-p-head"><h1>' + esc(m.q.title || 'Reflection') + '</h1><div>' + esc(cls) + '</div>';
    if (view === 'student') {
      var sid = _current(m);
      var st = m.byId[sid];
      return (
        head +
        '<div class="ra-p-who">' +
        esc(st ? _longName(st) : '') +
        '</div></header><div class="ra-sheet">' +
        _raSheetHtml(m, sid) +
        '</div>'
      );
    }
    return (
      head +
      '<div>' +
      esc(m.answered.length + ' of ' + m.students.length + ' answered') +
      '</div></header>' +
      summaryHtml(m, true)
    );
  }

  function print(cid, qid) {
    var m = model(cid, qid);
    if (!m || typeof document === 'undefined') return false;
    var view = _view[qid] === 'student' ? 'student' : 'summary';
    var root = document.getElementById(PRINT_ROOT);
    if (!root) {
      root = document.createElement('div');
      root.id = PRINT_ROOT;
      root.className = 'ra ra-print';
      document.body.appendChild(root);
    }
    // html-safe: printHtml escapes every name, prompt and answer.
    root.innerHTML = printHtml(m, view);
    var course = _course(cid);
    var cls = typeof G.printClassName === 'function' ? G.printClassName(course) : (course && course.name) || '';
    var st = view === 'student' ? m.byId[_current(m)] : null;
    var parts = [m.q.title || 'Reflection', st ? _longName(st) : 'Summary', cls];
    if (typeof G.setPrintMode === 'function')
      G.setPrintMode(PRINT_STYLE, 'ra-print-active', 'letter portrait', '0.5in');
    var done = function () {
      if (typeof G.clearPrintMode === 'function') G.clearPrintMode(PRINT_STYLE, 'ra-print-active');
      var r = document.getElementById(PRINT_ROOT);
      if (r) r.innerHTML = '';
    };
    if (typeof G.printThen === 'function') G.printThen(done, parts);
    else {
      window.print();
      done();
    }
    return true;
  }

  /* ── Events ────────────────────────────────────────────────── */

  function _step(cid, qid, by) {
    var m = model(cid, qid);
    if (!m || !m.students.length) return;
    var sid = _current(m);
    var idx = m.students.findIndex(function (s) {
      return s.id === sid;
    });
    var next = m.students[Math.max(0, Math.min(m.students.length - 1, idx + by))];
    _sid[qid] = next.id;
  }

  function _pickSel(key, pick) {
    var sel = '[data-action="sqAnsPick"][data-pick="' + pick + '"]';
    /** @type {any} */
    var all = typeof document !== 'undefined' ? document.querySelectorAll(sel) : [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].dataset.key === key) return all[i];
    }
    return null;
  }

  function handleAction(action, el) {
    if (!/^sqAns/.test(action || '') || action === 'sqAnsBack') return false;
    var box = _box(el);
    if (!box) return false;
    var cid = box.dataset.cid;
    var qid = box.dataset.qid;
    switch (action) {
      case 'sqAnsView':
        _view[qid] = el.dataset.view === 'student' ? 'student' : 'summary';
        _rerender('#ra-view-' + _view[qid]);
        return true;
      case 'sqAnsPick': {
        var k = qid + '|' + el.dataset.key;
        var pick = el.dataset.pick;
        if (_pick[k] === pick) delete _pick[k];
        else _pick[k] = pick;
        _rerender();
        var again = _pickSel(el.dataset.key, pick);
        if (again) again.focus();
        return true;
      }
      case 'sqAnsAll': {
        var ka = qid + '|' + el.dataset.key;
        _all[ka] = !_all[ka];
        _rerender();
        return true;
      }
      case 'sqAnsPrev':
        _step(cid, qid, -1);
        _rerender(['#ra-prev:not([disabled])', '#ra-stu-pick']);
        return true;
      case 'sqAnsNext':
        _step(cid, qid, 1);
        _rerender(['#ra-next:not([disabled])', '#ra-stu-pick']);
        return true;
      case 'sqAnsPrint':
        print(cid, qid);
        return true;
    }
    return false;
  }

  function handleChange(el) {
    if (!el || !el.dataset || el.dataset.actionChange !== 'sqAnsStudent') return false;
    var box = _box(el);
    if (!box) return false;
    _sid[box.dataset.qid] = el.value;
    _rerender('#ra-stu-pick');
    return true;
  }

  function _reset() {
    _view = {};
    _sid = {};
    _all = {};
    _pick = {};
  }

  return {
    render: render,
    handleAction: handleAction,
    handleChange: handleChange,
    summarise: summarise,
    model: model,
    printHtml: printHtml,
    print: print,
    _reset: _reset,
  };
})();
if (typeof window !== 'undefined') window.CmReflectAnswers = CmReflectAnswers;
