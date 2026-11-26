// @ts-check
/* assign-form-work.js — Assignments: Student Work, handouts and links on the form. Moved from teacher/page-assignments.js
   on 2026-11-26 with scripts/split/cut.mjs, as text, unchanged. PageAssignments hands
   over what this file uses through configure(). It loads before page-assignments.js. */
/** @type {any} */ (window).AssignFormWork = (function () {
  'use strict';

  /* Handed over by PageAssignments (configure). */
  var AC, pageState, _studentPageOn, _weekAfter;
  function configure(h) {
    if ('AC' in h) AC = h.AC;
    if ('pageState' in h) pageState = h.pageState;
    if ('_studentPageOn' in h) _studentPageOn = h._studentPageOn;
    if ('_weekAfter' in h) _weekAfter = h._weekAfter;
  }

  var WORK_SEND = [
    { value: 'nothing', label: 'Nothing' },
    { value: 'photos', label: 'Photos' },
    { value: 'photos_files', label: 'Photos and Files' },
  ];
  var WORK_GROUP = [
    { value: 'each', label: 'Each Student' },
    { value: 'group', label: 'One per Group' },
  ];
  var WORK_MARKUP = [
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ];

  function _hasChoice(list, value) {
    return list.some(function (c) {
      return c.value === value;
    });
  }

  function _formWorkOffered(cid) {
    return (
      typeof CmStudentPage !== 'undefined' &&
      typeof CmStudentPage.workSettings === 'function' &&
      CmStudentPage.workSettings(cid).send_work === true &&
      typeof getAssessmentStudentWork === 'function'
    );
  }

  function _formWorkFor(cid, assess) {
    var w = assess
      ? getAssessmentStudentWork(cid, assess.id)
      : {
          students_send: 'nothing',
          after_due: 'keep',
          accept_until: null,
          // One for the Group: groups are made so one student can send for them (Colin, Nov 11).
          group_work: 'group',
          students_see_markup: true,
        };
    return {
      students_send: w.students_send,
      after_due: w.after_due,
      accept_until: w.accept_until,
      group_work: w.group_work,
      students_see_markup: w.students_see_markup !== false,
    };
  }

  // The day Until starts at: a week after the due date (or today).
  function _formWorkUntilDefault(cid) {
    var due = /** @type {any} */ (document.getElementById('af-due') || {}).value;
    return _weekAfter(due || courseToday(cid));
  }

  // html-safe: fixed labels and values
  function _formWorkSegHtml(field, labelId, choices, chosen, action) {
    return (
      '<div class="seg af-work-seg" role="radiogroup" aria-labelledby="' +
      labelId +
      '">' +
      choices
        .map(function (c) {
          var on = c.value === chosen;
          return (
            '<button type="button" class="seg-btn' +
            (on ? ' active' : '') +
            '" role="radio" aria-checked="' +
            on +
            '" data-action="' +
            (action || 'setFormWork') +
            '" data-field="' +
            field +
            '" data-value="' +
            c.value +
            '">' +
            esc(c.label) +
            '</button>'
          );
        })
        .join('') +
      '</div>'
    );
  }

  /* One row of the Student Work list: the question and a line under it on
     the left, the choices on the right (board "Assessment Form" 2b). */
  // html-safe: question and hint are fixed text or go through esc
  function _formWorkRowHtml(field, question, hintText, control, extra) {
    var id = 'af-work-' + field + '-label';
    return (
      '<div class="af-work-row" data-work-row="' +
      field +
      '">' +
      '<div class="af-work-ask"><span class="af-work-q" id="' +
      id +
      '">' +
      esc(question) +
      '</span>' +
      (hintText ? '<span class="af-work-hint">' + esc(hintText) + '</span>' : '') +
      '</div>' +
      '<div class="af-work-answer">' +
      control(id) +
      (extra || '') +
      '</div>' +
      '</div>'
    );
  }

  // html-safe: built from fixed labels, esc'd dates and the form's own values
  function _formWorkCardHtml(cid) {
    var w = pageState._formWork;
    var dueEl = /** @type {any} */ (document.getElementById('af-due'));
    var due = dueEl ? dueEl.value || '' : pageState._formSeedDue;
    var sending = w.students_send !== 'nothing';
    var collab = typeof AC !== 'undefined' && AC.collaboration ? AC.collaboration : 'individual';
    var until = w.accept_until || _formWorkUntilDefault(cid);
    var rows = [];
    rows.push(
      _formWorkRowHtml(
        'students_send',
        'Do Students Send You Their Work?',
        w.students_send === 'photos_files' ? 'PDFs become pages, so Mark Up works on them.' : '',
        function (id) {
          return _formWorkSegHtml(
            'students_send',
            id,
            [
              { value: 'nothing', label: 'No' },
              { value: 'photos', label: 'Yes, Photos' },
              { value: 'photos_files', label: 'Yes, Photos or PDFs' },
            ].concat(window.QuizBuilder ? QuizBuilder.answers(cid) : []),
            window.QuizBuilder ? QuizBuilder.chosen(w.students_send) : w.students_send,
          );
        },
      ),
    );
    // With no due date there is nothing to be late for.
    if (sending && due) rows.push(_afterDueRowHtml(due, w.after_due, until));
    if (sending && collab !== 'individual' && (_formWorkDemo() || _formWorkLive()))
      rows.push(
        _formWorkRowHtml('group_work', 'Who Sends the Work?', '', function (id) {
          return _formWorkSegHtml(
            'group_work',
            id,
            [
              { value: 'group', label: collab === 'pair' ? 'One for the Pair' : 'One for the Group' },
              { value: 'each', label: 'Each Student' },
            ],
            w.group_work,
          );
        }),
      );
    if (sending && (_formWorkDemo() || _formWorkLive()))
      rows.push(
        _formWorkRowHtml(
          'students_see_markup',
          'Do Students See What You Write on Their Work?',
          'The ticks, notes and drawings you add to their photos while you assess.',
          function (id) {
            return _formWorkSegHtml(
              'students_see_markup',
              id,
              [
                { value: 'yes', label: 'Yes, When You Return It' },
                { value: 'no', label: 'No' },
              ],
              w.students_see_markup ? 'yes' : 'no',
            );
          },
        ),
      );
    return (
      '<section class="af-card af-card-work" aria-labelledby="af-work-title">' +
      '<div class="af-card-head"><span class="af-card-title" id="af-work-title">Student Work</span></div>' +
      '<div class="af-work-body">' +
      '<div class="af-work-list">' +
      rows.join('') +
      '</div>' +
      '<div class="af-work-peek" id="af-work-peek">' +
      _workPeekHtml(cid) +
      '</div>' +
      '</div>' +
      '</section>'
    );
  }

  /* Can Students Send After <due>?: Keep Accepting, Until a last day, or
     No. `to` names where a press goes; the Quiz card asks the same question
     through it (teacher/quiz-builder.js), with its own field, actions and
     date box. */
  // html-safe: fixed labels; the dates are esc'd or formatted
  function _afterDueRowHtml(due, chosen, until, to) {
    var t = to || { field: 'after_due', action: 'setFormWork', change: 'setFormWorkUntil', dateId: 'af-accept-until' };
    return _formWorkRowHtml(
      t.field,
      'Can Students Send After ' + formatShortDate(due) + '?',
      '',
      function (id) {
        return _formWorkSegHtml(
          t.field,
          id,
          [
            { value: 'keep', label: t.keepLabel || 'Yes, Marked Late' },
            { value: 'until', label: 'Until ' + formatShortDate(until) },
            { value: 'stop', label: 'No' },
          ],
          chosen,
          t.action,
        );
      },
      chosen === 'until'
        ? '<span class="af-work-until"><label class="af-work-until-label" for="' +
            t.dateId +
            '">Last Day</label>' +
            '<input type="date" class="af-input af-work-date" id="' +
            t.dateId +
            '" data-action-change="' +
            t.change +
            '" value="' +
            esc(until) +
            '"></span>'
        : '',
    );
  }

  /* "Cece Sees": the student page's card for this piece as the class's first
     student will see it, beside the settings (Colin, Nov 11). It reads the
     form as typed; nothing is saved. */
  // html-safe: every value goes through esc
  function _workPeekHtml(cid) {
    var w = pageState._formWork;
    if (!w) return '';
    var val = function (id) {
      return /** @type {any} */ (document.getElementById(id) || {}).value || '';
    };
    var students = typeof sortStudents === 'function' ? sortStudents(getStudents(cid) || [], 'lastName') : [];
    var first = students[0];
    var who = first ? (first.preferred || first.firstName || displayName(first)).split(' ')[0] : 'Your Student';
    var title = val('af-title').trim();
    var modSel = /** @type {any} */ (document.getElementById('af-module'));
    var unit = modSel && modSel.value ? modSel.options[modSel.selectedIndex].text : '';
    var catSel = /** @type {any} */ (document.getElementById('af-category'));
    var cat = catSel && catSel.value ? catSel.options[catSel.selectedIndex].text : '';
    var due = val('af-due');
    var dueText = '';
    if (due) {
      var d = new Date(due + 'T12:00:00');
      dueText = 'Due ' + d.toLocaleDateString('en-CA', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    var sending = w.students_send !== 'nothing';
    var facts = [];
    var excluded = typeof AC !== 'undefined' && AC.excluded ? AC.excluded.size : 0;
    if (excluded > 0 && students.length)
      facts.push('Only the ' + (students.length - excluded) + ' students chosen see it.');
    return (
      '<div class="af-peek-label">' +
      esc(who) +
      ' Sees</div>' +
      '<div class="af-peek-card">' +
      '<div class="af-peek-head"><span class="af-peek-unit">' +
      esc(unit) +
      '</span>' +
      (dueText ? '<span class="af-peek-due">' + esc(dueText) + '</span>' : '') +
      '</div>' +
      '<div class="af-peek-title' +
      (title ? '' : ' is-empty') +
      '">' +
      esc(title || 'Your Title') +
      '</div>' +
      (cat ? '<span class="af-peek-cat">' + esc(cat) + '</span>' : '') +
      (sending
        ? '<div class="af-peek-send"><span class="af-peek-btn">Use the Camera</span><span class="af-peek-btn is-tint">Choose a File</span>' +
          '<span class="af-peek-hint">' +
          esc(
            w.students_send === 'photos_files'
              ? 'Photos or PDFs. Working in Word, PowerPoint or Google? Save it as a PDF, then choose it here.'
              : 'Take a photo of each page.',
          ) +
          '</span></div>'
        : '') +
      '</div>' +
      facts
        .map(function (f) {
          return '<p class="af-peek-fact">' + esc(f) + '</p>';
        })
        .join('')
    );
  }

  // Cece Sees follows the form as it's typed.
  function _refreshWorkPeek() {
    var peek = document.getElementById('af-work-peek');
    if (!peek || !pageState._formWork) return;
    // html-safe: built by _workPeekHtml
    peek.innerHTML = _workPeekHtml(pageState.activeCourse);
  }

  // Redraws the card where it is; the rest of the form is left as typed.
  function _refreshFormWorkCard(focusSel) {
    var card = document.querySelector('.af-card-work');
    if (!card || !pageState._formWork) return;
    var tpl = document.createElement('template');
    // html-safe: built by _formWorkCardHtml
    tpl.innerHTML = _formWorkCardHtml(pageState.activeCourse);
    card.replaceWith(/** @type {any} */ (tpl.content.firstChild));
    var to = focusSel && document.querySelector(focusSel);
    if (to) to.focus({ preventScroll: true });
  }

  function _setFormWork(field, value) {
    if (!pageState._formWork) return;
    var again = function () {
      _setFormWork(field, value);
    };
    // They Answer a Quiz: Students Send stays Nothing (teacher/quiz-builder.js).
    if (field === 'students_send' && window.QuizBuilder && QuizBuilder.takeAnswer(value, pageState._formWork, again))
      return _refreshFormWorkCard('.af-card-work [data-field="students_send"][data-value="' + value + '"]');
    if (field === 'students_send' && _hasChoice(WORK_SEND, value)) pageState._formWork.students_send = value;
    else if (field === 'group_work' && _hasChoice(WORK_GROUP, value)) pageState._formWork.group_work = value;
    else if (field === 'students_see_markup' && (value === 'yes' || value === 'no'))
      pageState._formWork.students_see_markup = value === 'yes';
    else if (field === 'after_due' && ['keep', 'until', 'stop'].indexOf(value) >= 0) {
      pageState._formWork.after_due = value;
      if (value === 'until' && !pageState._formWork.accept_until)
        pageState._formWork.accept_until = _formWorkUntilDefault(pageState.activeCourse);
    } else return;
    _refreshFormWorkCard('.af-card-work [data-field="' + field + '"][data-value="' + value + '"]');
  }

  function _setFormWorkUntil(el) {
    if (!pageState._formWork || !el) return;
    var v = String(el.value || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return;
    pageState._formWork.accept_until = v;
    _refreshFormWorkCard('#af-accept-until');
  }

  // Demo Mode.
  function _formWorkDemo() {
    return typeof isDemoMode === 'function' && isDemoMode();
  }
  // Group Work and Students See Your Mark Up work in a signed-in class the server keeps rows for too (S9-W1, S12-W1).
  function _formWorkLive() {
    return typeof studentWorkLive === 'function' && studentWorkLive(pageState.activeCourse);
  }

  /* After a save: the card's choices for `aid` (saveAssessmentStudentWork).
     Nothing when the card was not drawn. `w` is the card's choices as read
     before the save: saving the assessment can draw the form again from
     what is stored. */
  function _saveFormWork(cid, aid, w) {
    if (!w || !aid || !_formWorkOffered(cid) || typeof saveAssessmentStudentWork !== 'function') return;
    // Who Sends only applies to pairs and groups.
    if (typeof AC !== 'undefined' && AC.collaboration === 'individual' && w.group_work !== 'each')
      w = Object.assign({}, w, { group_work: 'each' });
    saveAssessmentStudentWork(cid, aid, w);
  }

  var RES_MAX_PAGES = 20;
  var RES_ICON_DOC =
    '<svg class="af-res-icon af-res-icon-doc" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="M9 14h6M9 17h4"></path></svg>';
  var RES_ICON_LINK =
    '<svg class="af-res-icon af-res-icon-link" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"></path><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"></path></svg>';
  var RES_ICON_VIDEO =
    '<svg class="af-res-icon af-res-icon-video" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="4"></rect><path d="m10 9 5 3-5 3z" fill="currentColor"></path></svg>';
  var RES_ICON_REMOVE =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"></path></svg>';
  var RES_VIDEO_HOSTS = /^(youtube\.com|m\.youtube\.com|youtu\.be|vimeo\.com)$/;

  function _formResOffered(cid) {
    return _studentPageOn(cid) && typeof assessmentResourcesOffered === 'function' && assessmentResourcesOffered(cid);
  }

  function _formResFor(cid, assess) {
    var saved = assess && typeof getAssessmentResources === 'function' ? getAssessmentResources(cid, assess.id) : [];
    if (assess && typeof refreshAssessmentResources === 'function') refreshAssessmentResources(cid);
    return {
      cid: cid,
      aid: assess ? assess.id : null,
      items: saved.map(function (r, i) {
        return Object.assign({ key: 's' + i, saved: true, removed: false }, r);
      }),
      linkOpen: false,
      busy: false,
      msg: '',
      next: 0,
      fresh: '', // the item (or 'link', the link row) just added, which comes in once
    };
  }

  // What the field holds, for the form's unsaved-changes check.
  function _formResSnapshot() {
    if (!pageState._formRes) return '';
    return JSON.stringify(
      pageState._formRes.items
        .filter(function (it) {
          return !it.saved || it.removed;
        })
        .map(function (it) {
          return [it.key, !!it.removed];
        }),
    );
  }

  function _pagesWord(n) {
    return n === 1 ? '1 page' : n + ' pages';
  }

  var RES_FILE_WORDS = { html: 'Web Page', txt: 'Text File', epub: 'EPUB' };
  function _sizeWord(bytes) {
    return window.HandoutFiles ? HandoutFiles.sizeWord(bytes) : Math.max(1, Math.round((bytes || 0) / 1024)) + ' KB';
  }

  function _formResItemHtml(it) {
    var pdf = it.kind === 'pdf';
    var file = !!RES_FILE_WORDS[it.kind];
    var meta = pdf
      ? ' · PDF · ' + _pagesWord(it.pageCount) + (it.status === 'uploading' ? ' · Uploading' : '')
      : file
        ? ' · ' +
          RES_FILE_WORDS[it.kind] +
          ' · ' +
          _sizeWord(it.bytes) +
          (it.status === 'uploading' ? ' · Uploading' : '')
        : ' · ' + (it.host || '');
    return (
      '<li class="af-res-item' +
      (pageState._formRes && pageState._formRes.fresh === it.key ? ' af-res-in' : '') +
      '" data-key="' +
      esc(it.key) +
      '">' +
      (pdf || file ? RES_ICON_DOC : RES_VIDEO_HOSTS.test(it.host || '') ? RES_ICON_VIDEO : RES_ICON_LINK) +
      '<span class="af-res-name"' +
      (it.kind === 'link' ? ' title="' + esc(it.url || '') + '"' : '') +
      '>' +
      esc(it.title) +
      ' <span class="af-res-meta">' +
      esc(meta) +
      '</span></span>' +
      '<button type="button" class="af-res-remove" data-action="afResRemove" data-key="' +
      esc(it.key) +
      '" aria-label="' +
      esc('Remove ' + it.title) +
      '">' +
      RES_ICON_REMOVE +
      '</button></li>'
    );
  }

  function _formResHtml() {
    var res = pageState._formRes;
    var shown = res.items.filter(function (it) {
      return !it.removed;
    });
    return (
      '<div class="af-field af-res" id="af-res" role="group" aria-labelledby="af-res-label">' +
      '<span class="af-label" id="af-res-label">Handouts and Links</span>' +
      (shown.length ? '<ul class="af-res-list">' + shown.map(_formResItemHtml).join('') + '</ul>' : '') +
      (res.linkOpen
        ? '<div class="af-res-linkrow' +
          (res.fresh === 'link' ? ' af-res-in' : '') +
          '">' +
          '<input class="af-input af-res-url" id="af-res-url" type="url" inputmode="url" autocomplete="off" spellcheck="false" aria-label="Web Address" placeholder="Paste a web address">' +
          '<input class="af-input af-res-title" id="af-res-title" type="text" autocomplete="off" maxlength="200" aria-label="Name Students See (optional)" placeholder="Name Students See (optional)">' +
          '<button type="button" class="btn btn-primary af-res-linkadd" data-action="afResLinkAdd">Add Link</button>' +
          '<button type="button" class="btn btn-ghost af-res-linkcancel" data-action="afResLinkCancel">Cancel</button>' +
          '</div>'
        : '') +
      '<div class="af-res-adds">' +
      '<button type="button" class="af-res-add" data-action="afResAddFile"' +
      (res.busy ? ' disabled aria-disabled="true"' : '') +
      '>+ Add a File</button>' +
      '<button type="button" class="af-res-add" data-action="afResAddLink"' +
      (res.linkOpen ? ' aria-expanded="true"' : ' aria-expanded="false"') +
      '>+ Add a Link</button>' +
      '<span class="af-res-hint">A PDF can have up to 20 pages. A web page, text file or EPUB can be up to 20 MB; choose a web page together with its pictures.</span>' +
      '<input type="file" class="af-res-file" multiple accept="application/pdf,.pdf,text/html,.html,.htm,text/plain,.txt,application/epub+zip,.epub,image/*" hidden tabindex="-1" aria-hidden="true" data-action-change="afResFiles">' +
      '</div>' +
      '<p class="af-res-msg" id="af-res-msg" role="status"' +
      (res.msg ? '' : ' hidden') +
      '>' +
      esc(res.msg || '') +
      '</p>' +
      '</div>'
    );
  }

  // Draw the field again in place; `focus` is where the keyboard goes after.
  function _refreshFormRes(focus) {
    var el = document.getElementById('af-res');
    if (!el || !pageState._formRes) return;
    var keep = {};
    ['af-res-url', 'af-res-title'].forEach(function (id) {
      var input = /** @type {any} */ (document.getElementById(id));
      if (input) keep[id] = input.value;
    });
    // html-safe: built by _formResHtml, which escapes every name, address and line
    el.outerHTML = _formResHtml();
    pageState._formRes.fresh = '';
    Object.keys(keep).forEach(function (id) {
      var input = /** @type {any} */ (document.getElementById(id));
      if (input) input.value = keep[id];
    });
    var to = focus ? document.querySelector(focus) : null;
    if (to && typeof to.focus === 'function') to.focus({ preventScroll: true });
  }

  function _formResSay(text) {
    if (!pageState._formRes) return;
    pageState._formRes.msg = text || '';
    var p = document.getElementById('af-res-msg');
    if (!p) return;
    p.textContent = pageState._formRes.msg;
    p.hidden = !pageState._formRes.msg;
  }

  function _formResOpenLink() {
    if (!pageState._formRes) return;
    pageState._formRes.msg = '';
    if (!pageState._formRes.linkOpen) {
      pageState._formRes.linkOpen = true;
      pageState._formRes.fresh = 'link';
      _refreshFormRes('#af-res-url');
    } else {
      var url = document.getElementById('af-res-url');
      if (url) url.focus();
    }
  }

  function _formResCloseLink() {
    if (!pageState._formRes) return;
    pageState._formRes.linkOpen = false;
    pageState._formRes.msg = '';
    _refreshFormRes('[data-action="afResAddLink"]');
  }

  var RES_LINK_WORDS = {
    empty: 'Paste a web address first.',
    not_web: 'That isn’t a web address. Copy it from the browser’s address bar.',
    too_long: 'That address is too long to add.',
  };

  function _formResAddLink() {
    var res = pageState._formRes;
    if (!res || !res.linkOpen) return;
    var urlEl = /** @type {any} */ (document.getElementById('af-res-url'));
    var titleEl = /** @type {any} */ (document.getElementById('af-res-title'));
    var check = typeof assessmentLinkCheck === 'function' ? assessmentLinkCheck(urlEl ? urlEl.value : '') : null;
    if (!check || !check.ok) {
      _formResSay(RES_LINK_WORDS[(check && check.reason) || 'not_web'] || RES_LINK_WORDS.not_web);
      if (urlEl) {
        urlEl.setAttribute('aria-invalid', 'true');
        urlEl.focus();
      }
      return;
    }
    var name = String((titleEl && titleEl.value) || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200);
    res.next += 1;
    res.items.push({
      key: 'n' + res.next,
      saved: false,
      removed: false,
      kind: 'link',
      url: check.url,
      host: check.host,
      // With no name, students see the address (the data layer gives it the same).
      title:
        name ||
        check.url
          .replace(/^https?:\/\//i, '')
          .replace(/^www\./i, '')
          .replace(/\/$/, ''),
      named: name,
    });
    res.fresh = 'n' + res.next;
    res.linkOpen = false;
    res.msg = '';
    _refreshFormRes('[data-action="afResAddLink"]');
  }

  function _formResRemove(key) {
    var res = pageState._formRes;
    if (!res) return;
    var at = -1;
    res.items.forEach(function (it, i) {
      if (it.key === key) at = i;
    });
    if (at < 0) return;
    var it = res.items[at];
    if (it.saved) it.removed = true;
    else res.items.splice(at, 1);
    res.msg = '';
    // The keyboard goes to the next item's Remove, else the one before, else + Add a File.
    var shown = function (x) {
      return x && !x.removed;
    };
    var after = res.items.slice(at + (it.saved ? 1 : 0)).filter(shown)[0] || res.items.slice(0, at).filter(shown).pop();
    _refreshFormRes(
      after ? '.af-res-remove[data-key="' + CSS.escape(after.key) + '"]' : '[data-action="afResAddFile"]',
    );
  }

  function _formResRefusal(out) {
    var R = (window.PhotoShrink && PhotoShrink.REASONS) || {};
    if (out && out.reason === R.TOO_MANY_PAGES)
      return 'That PDF has more than 20 pages. A PDF can have up to 20 pages.';
    if (out && out.reason === R.PDF_TOO_LARGE) return 'That PDF is too large to add. Save a smaller copy, then add it.';
    if (out && out.locked) return 'That PDF has a password. Save a copy without one, then add it.';
    if (out && out.reason === R.NO_DECODER) return "The PDF reader couldn't load. Check the connection and try again.";
    if (out && out.reason === R.OFFICE) return 'Save it as a PDF first.';
    return "That PDF couldn't be read. Try another copy of it.";
  }

  // A PDF's name as students see it: the file's name without .pdf.
  function _formResPdfTitle(name) {
    var t = String(name || '')
      .replace(/\.pdf$/i, '')
      .replace(/[_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return (t || 'Handout').slice(0, 200);
  }

  /* One PDF made into pages (shared/photo-shrink.js): its item in the
     list, or the sentence saying why not. → Promise of '' or a sentence. */
  function _formResReadPdf(res, file) {
    if (!window.PhotoShrink)
      return Promise.resolve("The PDF reader couldn't load. Check the connection and try again.");
    return PhotoShrink.prepare(file, {
      openPdf: window.PhotoReaders && PhotoReaders.openPdf,
      maxPages: RES_MAX_PAGES,
    })
      .then(null, function () {
        return { ok: false };
      })
      .then(function (out) {
        if (!out || !out.ok) return _formResRefusal(out);
        if (out.kind !== 'pdf') return 'Choose a PDF. A photo can be added to a student’s work instead.';
        if (out.pages.length > RES_MAX_PAGES) return _formResRefusal({ reason: PhotoShrink.REASONS.TOO_MANY_PAGES });
        res.next += 1;
        res.items.push({
          key: 'n' + res.next,
          saved: false,
          removed: false,
          kind: 'pdf',
          title: _formResPdfTitle(file.name),
          pageCount: out.pages.length,
          pages: out.pages,
          original: file, // the PDF itself, kept beside its pages for students to save and print
        });
        res.fresh = 'n' + res.next;
        return '';
      });
  }

  /* + Add a File: what the teacher picked. Each PDF becomes pages; each
     web page (with the pictures picked beside it), text file and EPUB is
     kept as it is (HandoutFiles.prepare). What could not be added, and
     any picture a page names that was not picked, is said in the field. */
  function _formResFiles(input) {
    var res = pageState._formRes;
    var picked = input && input.files ? Array.prototype.slice.call(input.files) : [];
    if (input) input.value = '';
    if (!res || res.busy || !picked.length) return;
    if (!window.HandoutFiles) {
      _formResSay("The file reader couldn't load. Check the connection and try again.");
      return;
    }
    res.busy = true;
    res.msg = 'Reading the file' + (picked.length > 1 ? 's' : '') + '…';
    _refreshFormRes();
    var words = [];
    HandoutFiles.prepare(picked)
      .then(function (out) {
        if (pageState._formRes !== res) return;
        out.ready.forEach(function (f) {
          res.next += 1;
          res.items.push({
            key: 'n' + res.next,
            saved: false,
            removed: false,
            kind: f.kind,
            title: f.title,
            bytes: f.bytes,
            blob: f.blob,
          });
          res.fresh = 'n' + res.next;
        });
        var said = HandoutFiles.sayAbout(out);
        if (said) words.push(said);
        return out.pdfs.reduce(function (p, file) {
          return p.then(function () {
            if (pageState._formRes !== res) return;
            return _formResReadPdf(res, file).then(function (why) {
              if (why) words.push(out.pdfs.length > 1 || out.ready.length ? file.name + ': ' + why : why);
            });
          });
        }, Promise.resolve());
      })
      .then(null, function () {
        words.push("That file couldn't be read. Try another copy of it.");
      })
      .then(function () {
        if (pageState._formRes !== res) return;
        res.busy = false;
        res.msg = words.join(' ');
        _refreshFormRes('[data-action="afResAddFile"]');
      });
  }

  /* After a save: what was added and removed in the field, for `aid`. `res`
     is the field as read before the save: saving draws the page again. In
     the order the teacher added them, one after another. */
  function _saveFormRes(cid, aid, res) {
    if (!res || !aid || res.cid !== cid) return Promise.resolve();
    var steps = [];
    res.items.forEach(function (it) {
      if (it.saved && it.removed) {
        steps.push(function () {
          return removeAssessmentResource(cid, it.id);
        });
      } else if (!it.saved && it.kind === 'link') {
        steps.push(function () {
          return addAssessmentLink(cid, aid, it.url, it.named || '');
        });
      } else if (!it.saved && it.kind === 'pdf') {
        steps.push(function () {
          return addAssessmentHandout(cid, aid, it.title, it.pages, it.original);
        });
      } else if (!it.saved && RES_FILE_WORDS[it.kind] && typeof addAssessmentHandoutFile === 'function') {
        steps.push(function () {
          return addAssessmentHandoutFile(cid, aid, it.title, it.kind, it.blob);
        });
      }
    });
    return steps
      .reduce(function (p, step) {
        return p.then(step).then(function (out) {
          if (out && out.ok === false) console.warn('Handouts and Links: not kept:', out.reason);
        });
      }, Promise.resolve())
      .then(null, function (e) {
        console.warn('Handouts and Links: saving failed:', e);
      });
  }

  /* Before a save: a PDF still being read holds it until it is in the
     list, and an address typed in the open link row is added (or, when it
     is not a web address, holds the save with the reason), so neither is
     lost. */
  function _formResBusy() {
    if (!pageState._formRes) return false;
    if (pageState._formRes.busy) {
      _formResSay('The file is still being read. Save once it is in the list.');
      return true;
    }
    var url = /** @type {any} */ (document.getElementById('af-res-url'));
    if (pageState._formRes.linkOpen && url && url.value.trim()) {
      _formResAddLink();
      return !!pageState._formRes.linkOpen;
    }
    return false;
  }

  // Keys in the link row: Enter adds the link, Escape closes the row (not the form).
  function _formResKeydown(e) {
    var t = e.target;
    if (!t || !t.closest || !t.closest('.af-res-linkrow') || e.isComposing) return;
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      _formResAddLink();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      _formResCloseLink();
    }
  }

  /* The class's handouts and links changed (read from the server, an
     upload done): the field shows them, unless the teacher has changed
     it, which is kept as it is. A server without the calls hides it. */
  function _formResChanged(e) {
    var res = pageState._formRes;
    var d = e && e.detail;
    if (!res || !d || d.cid !== res.cid) return;
    var el = document.getElementById('af-res');
    if (!el) return;
    if (!_formResOffered(res.cid)) {
      pageState._formRes = null;
      el.remove();
      return;
    }
    var touched =
      res.busy ||
      res.linkOpen ||
      res.items.some(function (it) {
        return !it.saved || it.removed;
      });
    if (touched || !res.aid) return;
    var fresh = _formResFor(res.cid, { id: res.aid });
    res.items = fresh.items;
    var before = pageState._formStart && pageState._formStart.res;
    _refreshFormRes();
    if (pageState._formStart && before !== undefined) pageState._formStart.res = _formResSnapshot();
  }

  return {
    configure: configure,
    RES_LINK_WORDS: RES_LINK_WORDS,
    _afterDueRowHtml: _afterDueRowHtml,
    _formResAddLink: _formResAddLink,
    _formResBusy: _formResBusy,
    _formResChanged: _formResChanged,
    _formResCloseLink: _formResCloseLink,
    _formResFiles: _formResFiles,
    _formResFor: _formResFor,
    _formResHtml: _formResHtml,
    _formResKeydown: _formResKeydown,
    _formResOffered: _formResOffered,
    _formResOpenLink: _formResOpenLink,
    _formResRemove: _formResRemove,
    _formResSnapshot: _formResSnapshot,
    _formWorkCardHtml: _formWorkCardHtml,
    _formWorkDemo: _formWorkDemo,
    _formWorkFor: _formWorkFor,
    _formWorkOffered: _formWorkOffered,
    _formWorkUntilDefault: _formWorkUntilDefault,
    _refreshFormWorkCard: _refreshFormWorkCard,
    _refreshWorkPeek: _refreshWorkPeek,
    _saveFormRes: _saveFormRes,
    _saveFormWork: _saveFormWork,
    _setFormWork: _setFormWork,
    _setFormWorkUntil: _setFormWorkUntil,
  };
})();
