// @ts-check
/* cm-std-help.js — Class Settings: Where These Appear, the help panel for a
   competency's title, code, wording and I Can statements. Moved from
   teacher/dash-class-manager.js on 2026-11-13 (move only). It keeps no state of
   its own. DashClassManager hands it three things through configure(): how to
   read the selected course, _cmStdCode and _currentId. The course is read each
   time the panel opens, never at load. */
window.CmStdHelp = (function () {
  'use strict';

  /** @typedef {{ selectedCourse: () => (string | null), stdCode: (tag: any) => string, currentId: (kind: string, id: string) => string }} CmStdHelpHost */
  /** @type {CmStdHelpHost | null} */
  var _host = null;
  /** @type {string | null} */
  var cmSelectedCourse = null;
  // The same document, seen through the narrower type in types/globals.d.ts.
  var document = /** @type {CmHelpDocument} */ (/** @type {unknown} */ (window.document));
  /** @param {CmStdHelpHost} opts */
  function configure(opts) {
    _host = opts;
  }
  /** @param {any} tag */
  function _cmStdCode(tag) {
    return _host ? _host.stdCode(tag) : '';
  }
  /**
   * @param {string} kind
   * @param {string} id
   */
  function _currentId(kind, id) {
    return _host ? _host.currentId(kind, id) : id;
  }
  /** @param {string} secId */
  function show(secId) {
    cmSelectedCourse = _host ? _host.selectedCourse() : null;
    return cmShowStdHelp(secId);
  }

  /* ── Where These Appear: one picture per field, drawn with the app's own
     gradebook and report styles and this competency's own words. ── */
  function _cmHelpSiblings(lm, sec) {
    var out = [];
    (lm.sections || []).forEach(function (s) {
      if (s.id === sec.id || out.length >= 3) return;
      if ((sec.groupId || null) !== (s.groupId || null)) return;
      if (s.tags && s.tags[0]) out.push(s.tags[0]);
    });
    return out;
  }

  // html-safe: codes and tip text go through esc, colours through cssColor; levels are fixed numbers.
  function _cmHelpGradebook(cid, sec, tag, siblings, withTip) {
    var color = sec.color || 'var(--active)';
    var cols = [tag].concat(siblings).slice(0, 4);
    var levels = [3, 2, 4, 3];
    var head = cols
      .map(function (t, i) {
        var c = cssColor((i === 0 ? sec.color : null) || color);
        return (
          '<div class="gb-grid-tag-header cm-help-col' +
          (i === 0 ? ' cm-help-hl' : '') +
          '" style="border-bottom-color:' +
          c +
          ';color:' +
          c +
          '">' +
          esc(_cmStdCode(t)) +
          '</div>'
        );
      })
      .join('');
    var row = cols
      .map(function (t, i) {
        return '<div class="cm-help-cell"><span class="gb-score-val s' + levels[i] + '">' + levels[i] + '</span></div>';
      })
      .join('');
    return (
      '<div class="cm-help-gb">' +
      '<div class="cm-help-gb-row"><div class="cm-help-gb-name cm-help-gb-th">Student</div>' +
      head +
      '</div>' +
      '<div class="cm-help-gb-row"><div class="cm-help-gb-name">' +
      'Student 1' +
      '</div>' +
      row +
      '</div>' +
      (withTip ? '<div class="cm-help-tip cm-help-hl">' + esc(tag.text || 'Recognize and explain…') + '</div>' : '') +
      '</div>'
    );
  }

  // A sample level worded the way this class's report card words it.
  function _cmHelpLevel(cid, n) {
    try {
      if (courseGradeMode(cid) === 'letter') return formatLevel(cid, n);
    } catch (e) {
      /* fall through to the scale name */
    }
    return PROF_LABELS[n] || '';
  }

  // html-safe: competency names and level words go through esc; levels and dots are fixed.
  function _cmHelpReportTable(cid, sec, tag, siblings) {
    var rows = [tag].concat(siblings).slice(0, 3);
    return (
      '<div class="report-block-box report-competency-table cm-help-report">' +
      '<div class="report-block-title">Curricular Competencies</div>' +
      '<table class="report-ct"><thead><tr><th>Competency</th><th>Level</th></tr></thead><tbody>' +
      rows
        .map(function (t, i) {
          var n = [3, 2, 3][i];
          return (
            '<tr' +
            (i === 0 ? ' class="cm-help-hl"' : '') +
            '><td class="report-ct-name">' +
            esc(t.label || t.name || '') +
            '</td><td class="report-ct-level" data-prof="' +
            n +
            '"><span class="report-dots" aria-hidden="true">' +
            '●'.repeat(n) +
            '○'.repeat(4 - n) +
            '</span>' +
            esc(_cmHelpLevel(cid, n)) +
            '</td></tr>'
          );
        })
        .join('') +
      '</tbody></table></div>'
    );
  }

  // html-safe: the competency label, level word and I Can statements go through esc.
  function _cmHelpNextSteps(cid, sec, tag) {
    var icans = tag.i_can_statements || [];
    if (!icans.length) {
      return '<p class="cm-help-empty">Add an I Can statement on the card and it appears here.</p>';
    }
    return (
      '<div class="report-block-box cm-help-report">' +
      '<div class="report-block-title">Suggested Next Steps</div>' +
      '<div class="report-next-step-item">' +
      '<div class="report-next-step-bullet" style="background:var(--score-2)">1</div>' +
      '<div><strong>' +
      esc(tag.label || '') +
      '</strong> — ' +
      esc(_cmHelpLevel(cid, 2)) +
      '. <span style="color:var(--text-2)">Focus areas:</span>' +
      '<ul class="report-ican-list cm-help-hl">' +
      icans
        .slice(0, 2)
        .map(function (s) {
          return '<li class="report-ican-item">' + esc(s) + '</li>';
        })
        .join('') +
      '</ul></div></div></div>'
    );
  }

  function cmShowStdHelp(secId) {
    secId = _currentId('section', secId);
    var cid = cmSelectedCourse;
    if (!cid) return;
    var lm = getLearningMap(cid);
    var sec = (lm.sections || []).find(function (s) {
      return s.id === secId;
    });
    if (!sec || !sec.tags || !sec.tags[0]) return;
    var tag = sec.tags[0];
    var siblings = _cmHelpSiblings(lm, sec);
    var parts = [
      {
        name: 'Title',
        where: 'Report card',
        text: 'The competency’s name on report cards and throughout FullVision.',
        picture: _cmHelpReportTable(cid, sec, tag, siblings),
      },
      {
        name: 'Code',
        where: 'Gradebook',
        text: 'Labels the competency’s column in the gradebook.',
        picture: _cmHelpGradebook(cid, sec, tag, siblings, false),
      },
      {
        name: 'Curricular Competency',
        where: 'Gradebook',
        text: 'Appears when you point at the column’s code.',
        picture: _cmHelpGradebook(cid, sec, tag, siblings, true),
      },
      {
        name: 'I Can Statements',
        where: 'Report card',
        text: 'Print as next steps on report cards.',
        picture: _cmHelpNextSteps(cid, sec, tag),
      },
    ];
    var triggerEl = document.activeElement;
    var overlay = document.createElement('div');
    overlay.className = 'confirm-overlay cm-help-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'cm-help-title');
    // html-safe: tab names are escaped; the rest is fixed markup and tab indexes.
    overlay.innerHTML =
      '<div class="cm-help-card">' +
      '<div class="cm-help-head">' +
      '<h2 class="cm-help-title" id="cm-help-title">Where These Appear</h2>' +
      '<button type="button" class="cm-help-close" aria-label="Close">×</button>' +
      '</div>' +
      '<div class="cm-help-body">' +
      '<div class="cm-help-tabs" role="tablist" aria-orientation="vertical">' +
      parts
        .map(function (p, i) {
          return (
            '<button type="button" class="cm-help-tab" role="tab" id="cm-help-tab-' +
            i +
            '" aria-controls="cm-help-panel" aria-selected="' +
            (i === 0 ? 'true' : 'false') +
            '" tabindex="' +
            (i === 0 ? '0' : '-1') +
            '" data-idx="' +
            i +
            '"><span class="cm-help-tab-name">' +
            esc(p.name) +
            '</span><span class="cm-help-tab-where">' +
            esc(p.where) +
            '</span></button>'
          );
        })
        .join('') +
      '</div>' +
      '<div class="cm-help-panel" id="cm-help-panel" role="tabpanel" aria-labelledby="cm-help-tab-0"></div>' +
      '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    var panel = overlay.querySelector('.cm-help-panel');
    var tabs = overlay.querySelectorAll('.cm-help-tab');
    function show(i) {
      tabs.forEach(function (t, j) {
        t.setAttribute('aria-selected', j === i ? 'true' : 'false');
        t.tabIndex = j === i ? 0 : -1;
      });
      panel.setAttribute('aria-labelledby', 'cm-help-tab-' + i);
      // html-safe: pictures come from the checked _cmHelp* builders; name and text are escaped.
      panel.innerHTML =
        '<div class="cm-help-picture" aria-hidden="true">' +
        parts[i].picture +
        '</div>' +
        '<div class="cm-help-caption"><span class="cm-help-caption-name">' +
        esc(parts[i].name) +
        '</span><span class="cm-help-caption-text">' +
        esc(parts[i].text) +
        '</span></div>';
    }
    function close() {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
      try {
        if (triggerEl && typeof triggerEl.focus === 'function') triggerEl.focus();
      } catch (e) {
        /* trigger may be gone after a re-render */
      }
    }
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      var cur = Array.prototype.indexOf.call(tabs, document.activeElement);
      if (cur >= 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        e.preventDefault();
        var next = (cur + (e.key === 'ArrowDown' ? 1 : tabs.length - 1)) % tabs.length;
        show(next);
        tabs[next].focus();
        return;
      }
      if (e.key === 'Tab') {
        var focusable = [overlay.querySelector('.cm-help-close')].concat(
          Array.prototype.filter.call(tabs, function (t) {
            return t.tabIndex === 0;
          }),
        );
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    tabs.forEach(function (t) {
      t.addEventListener('click', function () {
        show(Number(t.dataset.idx));
      });
    });
    overlay.querySelector('.cm-help-close').addEventListener('click', close);
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) close();
    });
    document.addEventListener('keydown', onKey);
    show(0);
    tabs[0].focus();
  }

  return { configure: configure, cmShowStdHelp: show };
})();
