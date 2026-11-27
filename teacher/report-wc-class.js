// @ts-check
/* report-wc-class.js — Write Comments: the For the Class box and the
   Required parts of an IE or goals comment (docs/plans/write-comments-plan.md,
   decision 3). The class's support line, closing sentence, late-work line
   and language goal are the class's, edited for the class as ever; this file
   draws each with the controls the main file's tqLine keeps. */
window.ReportWcClass = (function () {
  'use strict';

  var KEYS = { grade: ['grade', 'ieProblem'], next: ['iePlan', 'ieDeadline', 'ieMeeting'] };

  function btn(label, act, data, extra) {
    var d = Object.keys(data || {})
      .map(function (k) {
        return ` data-${k}="${esc(data[k])}"`;
      })
      .join('');
    return `<button type="button" class="wc-btn${(extra && extra.cls) || ''}" data-action="${act}"${d}${(extra && extra.attr) || ''}>${esc(label)}</button>`;
  }
  function say(kind) {
    return btn('Say This', 'tqSentences', { do: 'wcSayClass', kind: kind }, { cls: ' say' });
  }

  /* The save box of a line being edited for the class. */
  // html-safe: the course name and the text esc()'d; ids are fixed
  function editBox(rq, which, label, text, tip, saveDo) {
    var course = rq.courseName(rq.cid());
    return `<div class="wc-line-edit"><input type="text" class="qn-line-input" id="tq-line-${which}" data-tq-line-input="${which}" aria-label="${esc(label)} for ${esc(course)}" title="${esc(tip)}" value="${esc(text)}">
      <button type="button" class="wc-btn" data-action="tqLine" data-do="cancel">Cancel</button>
      <button type="button" class="wc-btn wc-btn-main" data-action="tqLine" data-do="${saveDo}" title="Saves this for every comment in ${esc(course)}.">Save for Class</button></div>`;
  }

  function supportHtml(rq, f, st, said) {
    var habits = CommentBank.effectiveHabits(rq.habitsOf(rq.cid(), st, f));
    var any = ((f.classLines && f.classLines.support) || []).length > 0;
    var choice = CommentBank.supportChoice(f, habits);
    var open = rq.supportMenu();
    var menu = open ? rq.supportMenuHtml(rq.cid(), st, f, choice) : '';
    var label = choice ? 'Support Line ▾' : '+ Support Line ▾';
    var course = rq.courseName(rq.cid());
    var first = rq.first(st);
    var tip = !any
      ? 'Tick the support lines you will do in ' + course + '. Until you do, the comment leaves this sentence out.'
      : f.classLines && f.classLines.pick === 'none'
        ? 'Left out of this comment. Pick a support line for ' + first + '.'
        : !choice
          ? 'None of the ticked lines fits ' +
            first +
            ', so the comment leaves this sentence out. Pick one for ' +
            first +
            '.'
          : 'Pick the support line for ' + first + ', or tick the lines you will do in ' + course + '.';
    var menuBtn = `<button type="button" class="wc-btn${open ? ' on' : ''}" data-action="tqLine" data-do="supportMenu" aria-haspopup="menu" aria-expanded="${open}" title="${esc(tip)}">${label}</button>`;
    return `<span class="wc-fact-main"><span class="wc-fact-name">Support Line</span>${choice ? `<span class="wc-fact-quote">${esc(choice.line.text)}</span>` : ''}</span>${choice && !said ? say('support') : ''}${menuBtn}${menu}`;
  }

  function closingHtml(rq, said) {
    var closing = CommentBank.classSettings(rq.cid()).closing;
    if (rq.lineEdit() === 'closing')
      return `<span class="wc-fact-main"><span class="wc-fact-name">Closing Sentence</span></span>${editBox(rq, 'closing', 'Closing sentence', closing, 'Used exactly as you type it, at the end of each new comment.', 'saveClosing')}${rq.sharedStepHtml(rq.cid())}`;
    var main = `<span class="wc-fact-main"><span class="wc-fact-name">Closing Sentence</span>${closing ? `<span class="wc-fact-quote">${esc(closing)}</span>` : ''}</span>`;
    var edit = btn(closing ? 'Change' : '+ Closing Sentence for the Class', 'tqLine', { do: 'editClosing' });
    return main + (closing && !said ? say('closing') : '') + edit;
  }

  function lateHtml(rq, said, hasMissing) {
    var late = String((COURSES[rq.cid()] && COURSES[rq.cid()].lateWorkPolicy) || '').trim();
    if (rq.lineEdit() === 'late')
      return `<span class="wc-fact-main"><span class="wc-fact-name">Late Work Line</span></span>${editBox(rq, 'late', 'Late work line', late, 'Used exactly as you type it, after the missing-work sentence.', 'saveLate')}`;
    var main = `<span class="wc-fact-main"><span class="wc-fact-name">Late Work Line</span>${late ? `<span class="wc-fact-quote">${esc(late)}</span>` : ''}</span>`;
    var edit = btn(late ? 'Change' : '+ Late Work Line for the Class', 'tqLine', { do: 'editLate' });
    return main + (late && hasMissing && !said ? say('late') : '') + edit;
  }

  function langHtml(rq, f, st, said) {
    var choice = CommentBank.languageGoalChoice(f);
    var open = rq.langMenu();
    var menu = open ? rq.langMenuHtml(rq.cid(), st, f, choice) : '';
    var text = choice ? CommentBank.fill({ text: choice.line.text }, rq.ctx(rq.cid(), st, f)) : '';
    var any = ((f.classLines && f.classLines.languageGoals) || []).length > 0;
    var first = rq.first(st);
    var why = choice
      ? 'Pick the language goal for ' + first + ', or tick the lines you use in the class.'
      : any
        ? 'No language goal picked for ' + first + '. The comment leaves this sentence out.'
        : 'Tick the language goal lines you use in the class. Until you do, the comment leaves this sentence out.';
    var b = `<button type="button" class="wc-btn${open ? ' on' : ''}" data-action="tqLine" data-do="langMenu" aria-haspopup="menu" aria-expanded="${open}" title="${esc(why)}">${choice ? 'Language Goal ▾' : '+ Language Goal ▾'}</button>`;
    return `<span class="wc-fact-main"><span class="wc-fact-name">Language Goals</span>${text ? `<span class="wc-fact-quote">${esc(text)}</span>` : ''}</span>${choice && !said ? say('lang') : ''}${b}${menu}`;
  }

  /* The facts of the For the Class box: each with the lines of the comment
     that are its sentence. */
  function facts(rq, st, f, mine, line) {
    var path = CommentBank.reportPath(f);
    var rows = function (step) {
      return mine
        .filter(function (x) {
          return x.row.step === step;
        })
        .map(line);
    };
    var make = function (id, step, html) {
      var lines = rows(step);
      return ReportWcBoxes.fact({ id: id, html: 'cls:' + id, lines: lines, look: html(!!lines.length) });
    };
    var out = [];
    if (path === 'language_goals') out.push(make('lang', 'languageGoals', say => langHtml(rq, f, st, say)));
    out.push(make('support', 'support', say => supportHtml(rq, f, st, say)));
    out.push(make('late', 'lateWork', say => lateHtml(rq, say, !!(f.notHandedIn && f.notHandedIn.count > 0))));
    out.push(make('closing', 'closer', say => closingHtml(rq, say)));
    return out;
  }

  /* The Required rows of an IE or goals comment for a box: the sentence the
     comment has, or the one Generate would write, with Pick a Date on the
     deadline. */
  function required(rq, st, f, rows, path, boxKey) {
    var keys = KEYS[boxKey];
    if (!path || !keys) return '';
    var ctx = rq.ctx(rq.cid(), st, f);
    var next = rq.previewSteps(rq.cid(), st, f);
    var meet = rq.meetingRowAt(rows, path);
    return CommentBank.requiredParts(ctx)
      .filter(function (p) {
        return keys.indexOf(p.key) >= 0;
      })
      .map(function (p) {
        var at = p.key === 'ieMeeting' ? meet : -1;
        if (at < 0)
          at = rows.findIndex(function (r) {
            return r.step === p.key;
          });
        var text = at >= 0 ? rows[at].text : p.text && next[p.key] ? next[p.key] : p.text;
        var mine = p.key === 'ieMeeting' && at >= 0 && !rows[at].s ? { source: 'Written by you' } : {};
        return rq.requiredRowHtml(rq.cid(), st, f, Object.assign({}, p, { text: text || '' }, mine), path, at, '');
      })
      .join('');
  }

  return { facts: facts, required: required };
})();
