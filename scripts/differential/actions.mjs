/* global document, getActiveCourse, getStudents, location, setActiveCourse, window -- page.evaluate code runs in the app page. */
/**
 * The teacher actions a differential run takes, each picked with the run's
 * seeded sequence (prng.mjs) from the state build A shows (probe.mjs
 * readView), then done the same way in build A and build B.
 *
 * Each action is { kind, weight, modes, pick(rng, view, ctx), run(page,
 * args, ctx) }. pick answers the action's arguments, or null when the class
 * has nothing to do it to (the run then picks again). run does it in one
 * tab.
 *
 * Marks go through window.Grader, the one module every screen writes a grade
 * through (shared/grader.js), with the arguments the screens pass it; where
 * a screen builds a whole score list first (fills, Undo, delete), run builds
 * it the way that screen's code does, named beside it. Some actions use the
 * real screens: the gradebook's grader dialog, its Cmd+Z, and the class's
 * switch. docs/differential-run.md lists which is which.
 */

import { closeOverlays, go, tick, until } from './probe.mjs';

const LEVELS = [1, 2, 3, 4];
const MODS = [0, 0, 1, -1];

function levelPieces(view) {
  return view.assessments.filter(
    a => !a.rubricId && a.scoreMode !== 'points' && a.scoreMode !== 'complete' && a.scoreMode !== 'dibels',
  );
}
const pointsPieces = view => view.assessments.filter(a => a.scoreMode === 'points');
const completePieces = view => view.assessments.filter(a => a.scoreMode === 'complete');
const rubricPieces = view => view.assessments.filter(a => a.rubricId && a.criteria.length);
const groupPieces = view => view.assessments.filter(a => a.collaboration === 'pair' || a.collaboration === 'group');

/* One of the cells the last steps touched (ctx.recent, newest first) that
   is still in the class and that `ok` allows, `chance` of the time; else
   null. Going back is how a change is followed by a clear, a comment by its
   removal, a returned grade by a new draft. */
function again(rng, view, ctx, chance, ok) {
  const live = ((ctx && ctx.recent) || []).filter(c => {
    const a = view.assessments.find(x => x.id === c.aid);
    return !!a && view.students.some(st => st.id === c.sid) && (!ok || ok(c, a));
  });
  if (!rng.chance(chance) || !live.length) return null;
  return rng.pick(live.slice(0, 8));
}

/* A cell of one of `pieces`: a recent one `chance` of the time, else any. */
function pickCell(rng, view, pieces, ctx, chance = 0) {
  const back = chance ? again(rng, view, ctx, chance, (c, a) => pieces.includes(a)) : null;
  if (back) return { sid: back.sid, aid: back.aid };
  const a = rng.pick(pieces);
  const s = rng.pick(view.students);
  if (!a || !s) return null;
  return { sid: s.id, aid: a.id };
}

/* In the page: the score keys of a piece, as the screens work them out. */
const KEYS_SRC = `
  function __keysFor(cid, aid) {
    const a = getAssessments(cid).find(x => x.id === aid);
    if (!a) return [];
    if (a.rubricId) {
      const r = getRubricById(cid, a.rubricId);
      return r ? r.criteria.flatMap(c => rubricCriterionScoreKeys(c)) : [];
    }
    return scoreTagIds(a, cid);
  }`;

/* Run `fn` in the page with the page's helpers in scope. */
function inPage(page, body, args) {
  return page.evaluate(
    ({ src, args }) => {
      // eslint-disable-next-line no-new-func
      return new Function('args', src)(args);
    },
    { src: KEYS_SRC + '\n' + body, args },
  );
}

/* The gradebook's Scores view, with the column menu of piece `aid` open
   (Return on the column title), as a teacher opens it. Answers null when
   the menu is open, or what was missing. */
async function openColumnMenu(page, aid) {
  await closeOverlays(page);
  const cid = await page.evaluate(() => getActiveCourse());
  if (!(await page.evaluate(() => location.pathname === '/gradebook'))) await go(page, '/gradebook?course=' + cid);
  const tab = page.locator('[data-action="setView"][data-mode="scores"]');
  if ((await tab.count()) && (await tab.getAttribute('aria-selected')) !== 'true') {
    await tab.click();
    await tick(page);
  }
  const label = page.locator('#gb-colheads .gb-grid-colhead[data-aid="' + aid + '"] .gb-grid-colhead-label');
  if (!(await label.count())) return 'no column';
  await label.focus();
  await page.keyboard.press('Enter');
  if (!(await until(page, () => !!document.querySelector('.gb-ctx-menu [data-ctx="deleteAssess"]')))) return 'no menu';
  return null;
}

export const ACTIONS = [
  /* ── Marks ─────────────────────────────────────────────────────── */
  {
    kind: 'level',
    weight: 14,
    pick(rng, view, ctx) {
      const c = pickCell(rng, view, levelPieces(view), ctx, 0.3);
      if (!c) return null;
      return { ...c, keyIndex: rng.int(4), level: rng.pick([0, ...LEVELS]), mod: rng.pick(MODS) };
    },
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const keys = __keysFor(cid, args.aid); if (!keys.length) return 'no keys';
         const key = keys[args.keyIndex % keys.length];
         Grader.setLevel(cid, args.sid, args.aid, key, args.level, args.level ? args.mod : 0); return key;`,
        a,
      ),
  },
  {
    kind: 'plusMinus',
    weight: 6,
    pick(rng, view, ctx) {
      const c = pickCell(rng, view, levelPieces(view), ctx, 0.3);
      return c && { ...c, mod: rng.pick([1, -1, 0]) };
    },
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const keys = __keysFor(cid, args.aid); if (!keys.length) return 'no keys';
         const e = (getScores(cid)[args.sid] || []).find(x => x.assessmentId === args.aid && x.tagId === keys[0]);
         if (!e || !(e.score > 0)) return 'no level';
         Grader.setPlusMinus(cid, args.sid, args.aid, keys[0], e.score, args.mod); return 'ok';`,
        a,
      ),
  },
  {
    kind: 'tagByTag',
    weight: 5,
    pick(rng, view, ctx) {
      const pieces = levelPieces(view).filter(a => a.tagIds.length > 1);
      const c = pickCell(rng, view, pieces.length ? pieces : levelPieces(view), ctx, 0.2);
      return (
        c && {
          ...c,
          levels: [rng.pick(LEVELS), rng.pick([0, ...LEVELS]), rng.pick(LEVELS)],
          mods: [rng.pick(MODS), rng.pick(MODS), 0],
        }
      );
    },
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const keys = __keysFor(cid, args.aid);
         keys.forEach((k, i) => Grader.setLevel(cid, args.sid, args.aid, k, args.levels[i % 3], args.levels[i % 3] ? args.mods[i % 3] : 0));
         return keys.length;`,
        a,
      ),
  },
  {
    kind: 'rubric',
    weight: 7,
    pick(rng, view, ctx) {
      const c = pickCell(rng, view, rubricPieces(view), ctx, 0.3);
      return (
        c && {
          ...c,
          levels: [rng.pick([0, ...LEVELS]), rng.pick(LEVELS), rng.pick(LEVELS)],
          mods: [rng.pick(MODS), rng.pick(MODS), 0],
        }
      );
    },
    run: (page, a) =>
      // Criterion by criterion, as the grader's rubric rows (page-assignments.js selectRubricScore).
      inPage(
        page,
        `const cid = getActiveCourse(); const keys = __keysFor(cid, args.aid);
         keys.forEach((k, i) => Grader.setLevel(cid, args.sid, args.aid, k, args.levels[i % 3], args.levels[i % 3] ? args.mods[i % 3] : 0));
         return keys.length;`,
        a,
      ),
  },
  {
    kind: 'points',
    weight: 8,
    pick(rng, view, ctx) {
      const pieces = pointsPieces(view);
      const c = pickCell(rng, view, pieces, ctx, 0.35);
      if (!c) return null;
      const a = pieces.find(p => p.id === c.aid);
      const max = a.maxPoints || 10;
      const r = rng.next();
      return { ...c, points: r < 0.2 ? null : r < 0.3 ? 0 : r < 0.4 ? max + 1 : Math.round(rng.next() * max * 2) / 2 };
    },
    run: (page, a) =>
      inPage(page, `return Grader.setPoints(getActiveCourse(), args.sid, args.aid, args.points);`, a).then(() => 'ok'),
  },
  {
    kind: 'complete',
    weight: 5,
    pick(rng, view, ctx) {
      const c = pickCell(rng, view, completePieces(view), ctx, 0.35);
      return c && { ...c, mark: rng.pick(['complete', 'incomplete', null]) };
    },
    run: (page, a) => inPage(page, `Grader.setMark(getActiveCourse(), args.sid, args.aid, args.mark); return 'ok';`, a),
  },
  {
    kind: 'status',
    weight: 8,
    pick(rng, view, ctx) {
      // Four in ten go back to a cell whose status was just set: mostly to
      // clear it, sometimes to change it.
      const back = again(rng, view, ctx, 0.4, c => c.kind === 'status');
      if (back) return { sid: back.sid, aid: back.aid, status: rng.pick([null, null, null, 'LATE', 'NS', 'EXC']) };
      const c = pickCell(rng, view, view.assessments, ctx, 0.2);
      return c && { ...c, status: rng.pick(['NS', 'EXC', 'LATE', null, null]) };
    },
    // As the grader's status buttons: Missing and Excused only where canSetAssignmentStatus allows.
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse();
         if (args.status && !canSetAssignmentStatus(cid, args.sid, args.aid, args.status)) return 'not allowed';
         Grader.setStatus(cid, args.sid, args.aid, args.status); return 'ok';`,
        a,
      ),
  },
  {
    kind: 'comment',
    weight: 7,
    pick(rng, view, ctx) {
      const texts = ['Good work on the lab.', '', 'Check your units.', 'See me about this one.'];
      // Nearly half go back to a cell just commented on, the same comment
      // (overall, competency or criterion): mostly to clear it.
      const back = again(rng, view, ctx, 0.45, c => c.kind === 'comment');
      if (back) {
        return {
          sid: back.sid,
          aid: back.aid,
          where: back.did,
          crit: back.crit || 0,
          text: rng.chance(0.6) ? '' : rng.pick(texts),
        };
      }
      const where = rng.pick(['overall', 'overall', 'tag', 'criterion', 'criterion']);
      let pieces = where === 'criterion' ? rubricPieces(view) : where === 'tag' ? levelPieces(view) : view.assessments;
      if (!pieces.length) pieces = view.assessments;
      const a = rng.pick(pieces);
      const any = rng.pick(view.students);
      if (!a || !any) return null;
      // A criterion comment goes half the time to a student with no score
      // on the piece: a comment on an unscored criterion.
      const blank = where === 'criterion' ? (view.unscored && view.unscored[a.id]) || [] : [];
      const sid = blank.length && rng.chance(0.5) ? rng.pick(blank) : any.id;
      return { sid, aid: a.id, where, crit: rng.int(4), text: rng.pick(texts) };
    },
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const keys = __keysFor(cid, args.aid);
         const piece = getAssessments(cid).find(x => x.id === args.aid);
         if (args.where === 'criterion' && piece && piece.rubricId) {
           const r = getRubricById(cid, piece.rubricId);
           const c = r && r.criteria[args.crit % r.criteria.length];
           if (c) { Grader.setCriterionComment(cid, args.sid, args.aid, c.id, args.text); return 'criterion'; }
         }
         if (args.where === 'tag' && keys.length && piece && !piece.rubricId && piece.scoreMode !== 'points' && piece.scoreMode !== 'complete') {
           Grader.setCompetencyComment(cid, args.sid, args.aid, keys[args.crit % keys.length], args.text); return 'tag';
         }
         Grader.setOverallComment(cid, args.sid, args.aid, args.text); return 'overall';`,
        a,
      ),
  },
  {
    kind: 'graderDialog',
    screen: true,
    weight: 8,
    pick(rng, view, ctx) {
      const c = pickCell(rng, view, levelPieces(view), ctx, 0.2);
      return (
        c && { ...c, level: rng.pick(LEVELS), mod: rng.pick([0, 0, 1, -1]), status: rng.chance(0.2) ? 'LATE' : null }
      );
    },
    // The real screen: the gradebook's Scores cell opens the grader dialog,
    // a level is pressed, + or − after it, Late on or off, then Done.
    async run(page, a) {
      await closeOverlays(page);
      const cid = await page.evaluate(() => getActiveCourse());
      if (!(await page.evaluate(() => location.pathname === '/gradebook'))) {
        await page.evaluate(p => window.Router.navigate(p), '/gradebook?course=' + cid);
        await tick(page);
      }
      const sel = '#gb-data td.gb-scores-cell[data-sid="' + a.sid + '"][data-aid="' + a.aid + '"]';
      const cell = page.locator(sel);
      if (!(await cell.count())) {
        const tab = page.locator('[data-action="setView"][data-mode="scores"]');
        if (await tab.count()) await tab.click();
        await tick(page);
      }
      if (!(await cell.count())) return 'no cell';
      await closeOverlays(page);
      await cell.scrollIntoViewIfNeeded();
      await cell.click();
      if (!(await until(page, () => !!document.querySelector('.grader-dialog')))) return 'no grader';
      const dlg = page.locator('.grader-dialog');
      const level = dlg.locator('[data-action="graderTagLevel"][data-level="' + a.level + '"]').first();
      if ((await level.count()) && (await level.isEnabled())) {
        if ((await level.getAttribute('aria-pressed')) !== 'true') await level.click();
        await tick(page, 100);
        if (a.mod) {
          const mod = dlg.locator('[data-action="graderTagMod"][data-mod="' + a.mod + '"]').first();
          // A − on Emerging or a + on Extending is offered but cannot be pressed.
          if ((await mod.count()) && (await mod.isEnabled())) await mod.click();
          await tick(page, 100);
        }
      }
      if (a.status) {
        const st = dlg.locator('[data-action="toggleStudentStatus"][data-status="' + a.status + '"]');
        if ((await st.count()) && (await st.isEnabled())) await st.click();
        await tick(page, 100);
      }
      await dlg.locator('[data-grader="close"]').click({ timeout: 5000 });
      await until(page, () => !document.querySelector('.grader-dialog'));
      const left = await closeOverlays(page);
      return left ? 'ok, then closed the ' + left : 'ok';
    },
  },
  {
    kind: 'gradebookUndo',
    screen: true,
    weight: 3,
    pick: () => ({}),
    // The real key: Cmd+Z on the gradebook undoes its last score.
    async run(page) {
      if (!(await page.evaluate(() => location.pathname === '/gradebook'))) return 'not on the gradebook';
      await page
        .locator('body')
        .click({ position: { x: 5, y: 5 } })
        .catch(() => {});
      await page.keyboard.press('ControlOrMeta+z');
      return 'ok';
    },
  },
  {
    kind: 'gradebookKey',
    screen: true,
    weight: 4,
    pick(rng, view, ctx) {
      // Half the time, + or − on a cell given an Overall Comment in the
      // last steps: the key sends the comment again with the level.
      const commented = again(rng, view, ctx, 0.5, (c, a) => c.kind === 'comment' && levelPieces(view).includes(a));
      if (commented) return { sid: commented.sid, aid: commented.aid, key: rng.pick(['+', '-']), cell: 0 };
      const c = pickCell(rng, view, levelPieces(view).concat(completePieces(view)), ctx, 0.3);
      return (
        c && { ...c, key: rng.pick(['1', '2', '3', '4', '+', '-', '+', '0', 'Backspace', 'c', 'i']), cell: rng.int(4) }
      );
    },
    // The real keys on the gradebook's Competencies view: the cell is
    // selected as the arrows or a click leave it (page-gradebook.js
    // _selectCell), then a key: a level (Grader.typeLevel), + or − with the
    // cell's comment (Grader.typePlusMinus), 0 or Backspace to clear, C or I
    // on Complete/Incomplete work.
    async run(page, a) {
      await closeOverlays(page);
      const cid = await page.evaluate(() => getActiveCourse());
      if (!(await page.evaluate(() => location.pathname === '/gradebook'))) await go(page, '/gradebook?course=' + cid);
      const tab = page.locator('[data-action="setView"][data-mode="detailed"]');
      if ((await tab.count()) && (await tab.getAttribute('aria-selected')) !== 'true') {
        await tab.click();
        await tick(page);
      }
      const sel = '#gb-data td.gb-score[data-sid="' + a.sid + '"][data-aid="' + a.aid + '"]';
      const picked = await page.evaluate(
        ({ sel, i }) => {
          const cells = document.querySelectorAll(sel);
          if (!cells.length) return null;
          const td = cells[i % cells.length];
          document.querySelectorAll('#gb-data .gb-focus').forEach(el => el.classList.remove('gb-focus'));
          td.classList.add('gb-focus');
          td.tabIndex = 0;
          td.focus({ preventScroll: true });
          return td.dataset.kb ? 'a cell that opens on Return' : 'ok';
        },
        { sel, i: a.cell },
      );
      if (!picked) return 'no cell';
      await page.keyboard.press(a.key);
      await tick(page, 100);
      return picked;
    },
  },
  {
    kind: 'markBlank',
    screen: true,
    weight: 2,
    pick(rng, view) {
      // The last pieces are the ones with blank cells (fixtures.mjs).
      const a = rng.pick(rng.chance(0.7) ? view.assessments.slice(-12) : view.assessments);
      return (
        a && { aid: a.id, status: rng.pick(['NS', 'EXC']), undo: rng.chance(0.4) ? rng.pick(['toast', 'menu']) : '' }
      );
    },
    // The real screen: the column menu's Mark Blank Cells Missing or
    // Excused (Grader.markBlankCells), then its Undo from the toast or the
    // menu's Undo Marking Blank Cells (Grader.undoMarkBlankCells).
    async run(page, a) {
      const opened = await openColumnMenu(page, a.aid);
      if (opened) return opened;
      await page.locator('.gb-ctx-menu [data-ctx="markUngraded' + a.status + '"]').click();
      await tick(page, 100);
      if (a.undo === 'toast') {
        const btn = page.locator('#undo-toast .undo-toast-btn');
        if (!(await btn.count())) return 'marked, no toast';
        await btn.click();
        await tick(page, 100);
        return 'undone from the toast';
      }
      if (a.undo === 'menu') {
        const again = await openColumnMenu(page, a.aid);
        if (again) return 'marked, then ' + again;
        const item = page.locator('.gb-ctx-menu [data-ctx="undoBulkStatus"]');
        if (!(await item.count())) {
          await closeOverlays(page);
          return 'marked, nothing to undo';
        }
        await item.click();
        await tick(page, 100);
        return 'undone from the menu';
      }
      return 'marked';
    },
  },
  {
    kind: 'setEveryone',
    weight: 3,
    pick(rng, view) {
      const a = rng.pick(levelPieces(view).concat(rubricPieces(view)));
      return a && { aid: a.id, level: rng.pick(LEVELS), undo: rng.chance(0.5) };
    },
    // page-assignments.js fillScores(aid, …, 'all'): every cell its plan
    // names gets the level, then the toast's Undo is Grader.undo.
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const keys = __keysFor(cid, args.aid);
         const prev = structuredClone(getScores(cid));
         const statuses = getAssignmentStatuses(cid);
         const scores = getScores(cid);
         getStudents(cid).forEach(st => {
           if (statuses[st.id + ':' + args.aid]) return;
           const has = (scores[st.id] || []).some(e => e.assessmentId === args.aid && e.score > 0);
           if (has) return;
           keys.forEach(k => Grader.setLevel(cid, st.id, args.aid, k, args.level));
         });
         const filled = structuredClone(getScores(cid));
         if (args.undo) Grader.undo(cid, prev, filled);
         return 'ok';`,
        a,
      ),
  },
  {
    kind: 'rowFill',
    weight: 4,
    pick(rng, view) {
      const c = pickCell(rng, view, levelPieces(view).concat(rubricPieces(view)));
      return c && { ...c, level: rng.pick([0, ...LEVELS]), undo: rng.chance(0.4) };
    },
    // page-assignments.js fillScores(aid, sid, value, 'row'): a row's fill,
    // or its Clear (0), and the toast's Undo.
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const keys = __keysFor(cid, args.aid);
         const prev = structuredClone(getScores(cid));
         if (!getAssignmentStatuses(cid)[args.sid + ':' + args.aid]) keys.forEach(k => Grader.setLevel(cid, args.sid, args.aid, k, args.level));
         const filled = structuredClone(getScores(cid));
         if (args.undo) Grader.undo(cid, prev, filled);
         return 'ok';`,
        a,
      ),
  },
  {
    kind: 'columnFill',
    weight: 2,
    pick(rng, view) {
      const a = rng.pick(levelPieces(view));
      return a && { aid: a.id, keyIndex: rng.int(3), level: rng.pick([0, ...LEVELS]), undo: rng.chance(0.5) };
    },
    // page-assignments.js fillScores(aid, tagId, value, 'col').
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const keys = __keysFor(cid, args.aid); if (!keys.length) return 'no keys';
         const key = keys[args.keyIndex % keys.length];
         const prev = structuredClone(getScores(cid));
         const statuses = getAssignmentStatuses(cid);
         getStudents(cid).forEach(st => { if (!statuses[st.id + ':' + args.aid]) Grader.setLevel(cid, st.id, args.aid, key, args.level); });
         const filled = structuredClone(getScores(cid));
         if (args.undo) Grader.undo(cid, prev, filled);
         return 'ok';`,
        a,
      ),
  },
  {
    kind: 'clearScore',
    weight: 4,
    pick(rng, view, ctx) {
      // Half go back to a cell just scored, commented on or returned.
      const c = pickCell(rng, view, view.assessments, ctx, 0.5);
      return c && { ...c, undo: rng.chance(0.4) };
    },
    // The gradebook's Clear Score (page-gradebook.js): the keys come off
    // the cell's entries and the list is saved, then the server is asked
    // to clear the cell; its Undo puts the old list back (Grader.undoCell).
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const piece = getAssessments(cid).find(x => x.id === args.aid); if (!piece) return 'gone';
         const before = structuredClone(getScores(cid));
         const keys = (getScores(cid)[args.sid] || []).filter(e => e.assessmentId === args.aid).map(e => e.tagId);
         const scores = getScores(cid);
         Grader.clearScore(cid, scores, args.sid, piece, keys);
         Grader.clearScoreOnServer(cid, args.sid, args.aid);
         if (args.undo) Grader.undoCell(cid, args.sid, args.aid, structuredClone(getScores(cid)), before);
         return 'ok';`,
        a,
      ),
  },
  {
    kind: 'groupMark',
    weight: 4,
    pick(rng, view, ctx) {
      // A kind of scoring first (levels, points, Complete/Incomplete), so
      // the one points piece and the one Complete piece are not rare; then,
      // most of the time, a student who is in a pair or group.
      const kinds = [
        groupPieces(view).filter(a => !a.scoreMode),
        groupPieces(view).filter(a => a.scoreMode === 'points'),
        groupPieces(view).filter(a => a.scoreMode === 'complete'),
      ].filter(list => list.length);
      const pieces = kinds.length ? rng.pick(kinds) : [];
      let c = pickCell(rng, view, pieces, ctx, 0.2);
      const a = c && view.assessments.find(x => x.id === c.aid);
      const inGroup = a ? view.students.filter(s => a.members.includes(s.id)) : [];
      if (c && inGroup.length && rng.chance(0.8)) c = { ...c, sid: rng.pick(inGroup).id };
      return c && { ...c, level: rng.pick([0, ...LEVELS]), separate: rng.chance(0.15), back: rng.chance(0.1) };
    },
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const keys = __keysFor(cid, args.aid);
         if (args.separate) Grader.gradeSeparately(cid, args.aid, args.sid);
         else if (args.back) Grader.backToGroupGrade(cid, args.aid, args.sid);
         const piece = getAssessments(cid).find(x => x.id === args.aid) || {};
         if (piece.scoreMode === 'points') { Grader.setPoints(cid, args.sid, args.aid, args.level ? 4 * args.level : null); return 'points'; }
         if (piece.scoreMode === 'complete') {
           Grader.setMark(cid, args.sid, args.aid, args.level ? (args.level > 2 ? 'complete' : 'incomplete') : null); return 'mark';
         }
         keys.forEach(k => Grader.setLevel(cid, args.sid, args.aid, k, args.level));
         return keys.length;`,
        a,
      ),
  },
  {
    kind: 'override',
    weight: 3,
    pick(rng, view, ctx) {
      // Half the time one of the students whose screens are read, so a
      // hand-set level that does not reach a screen is seen.
      const focus = view.students.filter(s => (ctx.focus || []).includes(s.id));
      const s = focus.length && rng.chance(0.5) ? rng.pick(focus) : rng.pick(view.students);
      const sec = rng.pick(view.sections);
      return s && sec && { sid: s.id, sec, level: rng.pick([0, 1, 2, 3, 4]) };
    },
    // teacher/student-overrides.js: setSectionOverride, or 0 to clear.
    run: (page, a) =>
      inPage(
        page,
        `setSectionOverride(getActiveCourse(), args.sid, args.sec, args.level, args.level ? 'Seen in class' : ''); return 'ok';`,
        a,
      ),
  },
  {
    kind: 'termRating',
    weight: 2,
    pick(rng, view) {
      const s = rng.pick(view.students);
      return (
        s && {
          sid: s.id,
          term: rng.pick(['term-1', 'term-2']),
          habits: rng.int(5),
          text: rng.pick(['Works hard.', 'Asks good questions.', '']),
        }
      );
    },
    run: (page, a) =>
      inPage(
        page,
        `upsertTermRating(getActiveCourse(), args.sid, args.term, { workHabits: args.habits, narrative: args.text }); return 'ok';`,
        a,
      ),
  },
  {
    kind: 'returnGrades',
    weight: 5,
    pick(rng, view) {
      // Mostly a piece with drafts waiting, so a Return returns something.
      // Return to All goes to the piece with the most drafts half the time,
      // as after a fill, so most of the class is returned at once. One
      // student's Return goes to a student whose grade is waiting.
      const drafts = view.drafts || {};
      const count = a => (drafts[a.id] || []).length;
      const waiting = view.assessments.filter(count);
      const most = waiting.slice().sort((x, y) => count(y) - count(x))[0];
      const all = rng.chance(0.5);
      const r = rng.next();
      const a = !waiting.length
        ? rng.pick(view.assessments)
        : all && r < 0.5
          ? most
          : r < 0.9
            ? rng.pick(waiting)
            : rng.pick(view.assessments);
      const any = rng.pick(view.students);
      if (!a || !any) return null;
      const sid = count(a) && rng.chance(0.8) ? rng.pick(drafts[a.id]) : any.id;
      return { aid: a.id, all, sid };
    },
    // Return for one student, or Return to All on the piece (the grader's
    // Return and the gradebook's Return to All both end in
    // Grader.returnGrades). Signed in this is return_work with Send Work
    // on, return_grades with it off.
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse();
         const ids = args.all ? getStudents(cid).map(s => s.id) : [args.sid];
         const out = Grader.returnGrades(cid, args.aid, args.all ? ids : args.sid);
         return 'returned ' + ((out && out.returned) || 0);`,
        a,
      ),
  },
  {
    kind: 'revision',
    weight: 3,
    pick(rng, view, ctx) {
      // Half go back to a cell just returned for revision: Take Back, or
      // the same piece asked for again.
      const back = again(rng, view, ctx, 0.5, c => c.kind === 'revision');
      const by = () => rng.pick([null, '2026-11-20']);
      if (back) return { sid: back.sid, aid: back.aid, level: rng.pick(LEVELS), by: by(), takeBack: rng.chance(0.6) };
      const c = pickCell(rng, view, levelPieces(view), ctx, 0.3);
      return c && { ...c, level: rng.pick(LEVELS), by: by(), takeBack: false };
    },
    // Return for Revision, then a revised mark on the same piece once the
    // request is answered; or Take Back of the request that is open. Signed
    // in these are return_work, return_for_revision and cancel_revision.
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse();
         if (args.takeBack) {
           const open = typeof getRevisionRequest === 'function' ? getRevisionRequest(cid, args.sid, args.aid) : null;
           if (!open || !open.id) return 'nothing to take back';
           Grader.cancelRevision(cid, args.sid, args.aid, open.id, crypto.randomUUID());
           return 'taken back';
         }
         const before = window.__diffRevision || 'none';
         const p = Grader.returnForRevision(cid, args.sid, args.aid, { what_to_fix: 'Show your working.', revise_by: args.by, criterion_ids: [] }, crypto.randomUUID());
         Promise.resolve(p).then(r => {
           window.__diffRevision = (r && r.result) || 'no answer';
           __keysFor(cid, args.aid).forEach(k => Grader.setLevel(cid, args.sid, args.aid, k, args.level));
         });
         return 'asked (the one before: ' + before + ')';`,
        a,
      ),
  },
  {
    kind: 'sendWork',
    weight: 1,
    pick: rng => ({ on: rng.chance(0.75) }),
    // Class Settings' Send Work switch (cm-student-page.js). Off, a Return
    // is return_grades and Return for Revision is not offered.
    run: (page, a) =>
      inPage(
        page,
        `const out = setCourseSendWork(getActiveCourse(), { send_work: args.on }); return out && out.ok ? 'ok' : 'not changed';`,
        a,
      ),
  },

  /* ── Pieces ────────────────────────────────────────────────────── */
  {
    kind: 'createPiece',
    weight: 2,
    pick(rng, view, ctx) {
      const two = [rng.pick(view.students), rng.pick(view.students), rng.pick(view.students)].filter(Boolean);
      return {
        kind: rng.pick(['level', 'points', 'complete', 'rubric']),
        n: rng.int(1000),
        cat: rng.pick(view.categories.map(c => c.id).concat([''])),
        // Six in ten are graded at once, before the server has answered
        // with the piece's id: two students' marks and a third's Late, all
        // under the id made here, re-keyed when the create lands.
        graded: !!(ctx && ctx.forced) || rng.chance(0.6),
        sids: two.map(st => st.id),
      };
    },
    // As the assessment form saves a new piece: the list with it at the end.
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const list = getAssessments(cid).slice();
         const tags = getAllTags(cid).map(t => t.id);
         const rubric = (getRubrics(cid) || [])[0];
         const piece = { id: typeof uid === 'function' ? uid() : 'x' + args.n, title: 'New Piece ' + args.n, date: courseToday(cid), type: 'summative',
           tagIds: args.kind === 'level' ? tags.slice(0, 1) : args.kind === 'rubric' && rubric ? rubric.criteria.flatMap(c => c.tagIds || []) : [],
           evidenceType: '', notes: '', coreCompetencyIds: [], rubricId: args.kind === 'rubric' && rubric ? rubric.id : '',
           scoreMode: args.kind === 'points' ? 'points' : args.kind === 'complete' ? 'complete' : '', maxPoints: args.kind === 'points' ? 25 : 0,
           weight: 1, dueDate: '', collaboration: 'individual', moduleId: '', pairs: [], groups: [], excludedStudents: [], created: new Date().toISOString() };
         if (args.cat) piece.categoryId = args.cat;
         list.push(piece); saveAssessments(cid, list);
         if (args.graded) {
           const keys = __keysFor(cid, piece.id);
           args.sids.slice(0, 2).forEach((sid, i) => {
             if (piece.scoreMode === 'points') Grader.setPoints(cid, sid, piece.id, 10 + i);
             else if (piece.scoreMode === 'complete') Grader.setMark(cid, sid, piece.id, i ? 'incomplete' : 'complete');
             else keys.forEach(k => Grader.setLevel(cid, sid, piece.id, k, 2 + i, 0));
           });
           if (args.sids[2]) Grader.setStatus(cid, args.sids[2], piece.id, 'LATE');
         }
         return piece.id;`,
        a,
      ),
  },
  {
    kind: 'editPiece',
    weight: 5,
    pick(rng, view) {
      const a = rng.pick(view.assessments);
      return (
        a && {
          aid: a.id,
          field: rng.pick([
            'title',
            'points',
            'category',
            'date',
            'rubric',
            'weight',
            'weight',
            'dueDate',
            'description',
            'coreCompetencies',
          ]),
          n: rng.int(100),
          cat: rng.pick(view.categories.map(c => c.id).concat([''])),
        }
      );
    },
    // As the assessment form saves an edit: a changed copy of the piece in the list.
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const list = getAssessments(cid).map(x => x.id === args.aid ? Object.assign({}, x) : x);
         const p = list.find(x => x.id === args.aid); if (!p) return 'gone';
         if (args.field === 'title') p.title = p.title.replace(/ \\(.*\\)$/, '') + ' (v' + args.n + ')';
         else if (args.field === 'points') { if (p.scoreMode !== 'points') return 'not points'; p.maxPoints = 10 + (args.n % 30); }
         else if (args.field === 'category') { if (args.cat) p.categoryId = args.cat; else delete p.categoryId; }
         else if (args.field === 'date') p.date = '2026-10-' + String(1 + (args.n % 28)).padStart(2, '0');
         else if (args.field === 'weight') { const w = [0.5, 2, 3, 1].filter(x => x !== Number(p.weight)); p.weight = w[args.n % w.length]; }
         else if (args.field === 'dueDate') p.dueDate = p.dueDate && args.n % 3 === 0 ? '' : '2026-11-' + String(1 + (args.n % 28)).padStart(2, '0');
         else if (args.field === 'description') p.description = p.description && args.n % 3 === 0 ? '' : 'Bring your lab notes (' + args.n + ').';
         else if (args.field === 'coreCompetencies') {
           const all = CORE_COMPETENCIES.map(c => c.id);
           const two = [all[args.n % all.length], all[(args.n + 2) % all.length]];
           p.coreCompetencyIds = (p.coreCompetencyIds || []).length && args.n % 3 === 0 ? [] : all.filter(id => two.includes(id));
         }
         else if (args.field === 'rubric') {
           const r = (getRubrics(cid) || [])[0]; if (!r || p.scoreMode === 'points' || p.scoreMode === 'complete') return 'no rubric';
           if (p.rubricId) { p.rubricId = ''; } else { p.rubricId = r.id; p.tagIds = r.criteria.flatMap(c => c.tagIds || []); }
         }
         saveAssessments(cid, list); return args.field;`,
        a,
      ),
  },
  {
    kind: 'deletePiece',
    weight: 3,
    screen: true,
    pick(rng, view) {
      if (view.assessments.length < 8) return null;
      const a = rng.pick(view.assessments);
      return a && { aid: a.id, undo: rng.chance(0.4) };
    },
    // The real screen: the gradebook's column menu (Return on the column
    // title), Delete Assessment, Delete in the dialog; then the toast's Undo,
    // or the toast left to time out (the run's clock), which commits the
    // delete (page-gradebook.js _deleteAssessWithUndo, _commitDeleteAssess).
    async run(page, a) {
      const opened = await openColumnMenu(page, a.aid);
      if (opened) return opened;
      const item = page.locator('.gb-ctx-menu [data-ctx="deleteAssess"]');
      await item.click();
      if (!(await until(page, () => !!document.getElementById('confirm-ok-btn')))) return 'no dialog';
      await page.locator('#confirm-ok-btn').click();
      if (!(await until(page, () => !!document.querySelector('#undo-toast .undo-toast-btn')))) return 'no toast';
      if (a.undo) {
        await page.locator('#undo-toast .undo-toast-btn').click();
        await tick(page, 100);
        return 'undone';
      }
      return 'deleted';
    },
  },

  /* ── Students ──────────────────────────────────────────────────── */
  {
    kind: 'addStudent',
    weight: 1,
    pick(rng, view, ctx) {
      const a = rng.pick(levelPieces(view));
      // Six in ten are given a mark at once, under the id made here.
      return { n: rng.int(1000), aid: (!!(ctx && ctx.forced) || rng.chance(0.6)) && a ? a.id : '' };
    },
    // teacher/dash-class-manager.js's Add Student: the roster with one more.
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const list = getStudents(cid).slice(); const id = uid();
         list.push({ id, firstName: 'New' + args.n, lastName: 'Student', preferred: '', pronouns: '', studentNumber: String(9000 + args.n),
           dateOfBirth: '', email: '', designations: [], attendance: [], sortName: 'Student New' + args.n, enrolledDate: new Date().toISOString().slice(0, 10) });
         saveStudents(cid, list);
         if (args.aid) __keysFor(cid, args.aid).forEach(k => Grader.setLevel(cid, id, args.aid, k, 3, 0));
         return 'ok';`,
        a,
      ),
  },
  {
    kind: 'editStudent',
    weight: 1,
    pick(rng, view) {
      const s = rng.pick(view.students);
      return s && { sid: s.id, pronouns: rng.pick(['she/her', 'he/him', 'they/them', '']) };
    },
    // teacher/student-edit-dialog.js: the roster with the student's copy changed.
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const list = getStudents(cid).map(s => s.id === args.sid ? Object.assign({}, s, { pronouns: args.pronouns }) : s);
         saveStudents(cid, list); return 'ok';`,
        a,
      ),
  },
  {
    kind: 'withdraw',
    weight: 2,
    pick(rng, view) {
      if (view.students.length < 20) return null;
      const s = rng.pick(view.students);
      return s && { sid: s.id };
    },
    run: (page, a) => inPage(page, `return !!withdrawStudent(getActiveCourse(), args.sid);`, a),
  },
  {
    kind: 'reenrol',
    weight: 2,
    pick(rng, view) {
      const sid = rng.pick(view.withdrawn);
      return sid ? { sid } : null;
    },
    run: (page, a) => inPage(page, `return !!reenrolStudent(getActiveCourse(), args.sid);`, a),
  },

  /* ── The class ─────────────────────────────────────────────────── */
  {
    kind: 'gradingStyle',
    weight: 1,
    pick: (rng, view) => ({ style: rng.pick(['proficiency', 'letter', 'both'].filter(s => s !== view.gradingSystem)) }),
    run: (page, a) => inPage(page, `updateCourse(getActiveCourse(), { gradingSystem: args.style }); return 'ok';`, a),
  },
  {
    kind: 'calcMethod',
    weight: 1,
    pick: (rng, view) => ({
      method: rng.pick(['mostRecent', 'highest', 'mode', 'decayingAvg'].filter(s => s !== view.calcMethod)),
    }),
    run: (page, a) => inPage(page, `updateCourse(getActiveCourse(), { calcMethod: args.method }); return 'ok';`, a),
  },
  {
    kind: 'category',
    weight: 1,
    pick(rng, view) {
      return {
        add: view.categories.length < 4 && rng.chance(0.5),
        weights: view.categories.map(() => 10 + rng.int(60)),
        n: rng.int(100),
      };
    },
    // Class Settings' Grading tab: a category added, or the weights changed.
    run: (page, a) =>
      inPage(
        page,
        `const cid = getActiveCourse(); const list = getCategories(cid).map((c, i) => Object.assign({}, c, { weight: args.weights[i] != null ? args.weights[i] : c.weight }));
         if (args.add) list.push({ id: uid(), name: 'Projects ' + args.n, weight: 20, displayOrder: list.length });
         saveCategories(cid, list); return 'ok';`,
        a,
      ),
  },
  {
    kind: 'switchClass',
    screen: true,
    weight: 1,
    pick(rng, view) {
      const other = view.courseIds.filter(c => c !== view.cid);
      return other.length ? { to: rng.pick(other), back: view.cid } : null;
    },
    // The sidebar's class picker, there and back.
    async run(page, a) {
      for (const cid of [a.to, a.back]) {
        await page.evaluate(cid => {
          setActiveCourse(cid);
          window.Router.navigate('/gradebook?course=' + cid);
        }, cid);
        if (!(await until(page, cid => getActiveCourse() === cid && getStudents(cid).length > 0, cid, 12)))
          return 'did not switch';
      }
      return 'ok';
    },
  },
];

export const ACTION_KINDS = ACTIONS.map(a => a.kind);
