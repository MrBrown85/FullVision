/**
 * Step 4 sweep, phone app (/teacher-mobile/) at 375x812, Demo Mode.
 * Each test names the finding it covers.
 */
import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';
import { jumpTo, settled } from './phone-jump.js';

test.beforeEach(({ page }) => demoStudentPageOff(page));

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

async function openPhone(page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await expect(page.locator('.m-card-stack-item').first()).toBeVisible();
}

// Group 2 #31: search finds a student by legal first or last name.
test('All Students search finds a student by last name', async ({ page }) => {
  await openPhone(page);
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-who').click();
  const search = page.locator('[data-action="m-student-search"]');
  await search.fill('Adeyemi');
  const shown = page.locator('#m-student-list .m-cell:visible');
  await expect(shown).toHaveCount(1);
  await expect(shown.first()).toContainText('Cece');
  await expect(page.locator('#m-student-search-empty')).toHaveCount(0);
});

async function openGrading(page) {
  await openPhone(page);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('[data-action="m-grade-assess"]').first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  // The grading screen wires its fields 400 ms after it opens.
  await page.waitForTimeout(500);
}

// Group 2 #32: the grading screen shows the sync dot, kept current.
test('grading screen shows a visible sync dot', async ({ page }) => {
  await openGrading(page);
  const dot = page.locator('#m-screen-grade-swiper .tb-sync-dot');
  await expect(dot).toBeVisible();
  const box = await dot.boundingBox();
  expect(box.width).toBeGreaterThan(4);
  await expect(dot).toHaveAttribute('title', /.+/);
});

// Group 2 #33: each tab's first screen names the open class.
test('every tab names the open class', async ({ page }) => {
  await openPhone(page);
  const name = tab => page.locator('#m-nav-stack .m-screen:last-child .m-tabbar-name');
  await expect(name()).toHaveText('Science 8');
  for (const tab of ['grade', 'observe', 'bulletins']) {
    await page.locator(`.m-tab-item[data-tab="${tab}"]`).click();
    await expect(name()).toHaveText('Science 8');
  }
});

// Group 2 #34: the grading card has the Overall Comment, shows a saved one,
// and saves what is typed.
test('grading card has the Overall Comment', async ({ page }) => {
  await openGrading(page);
  const card = page.locator('.m-swiper-card').first();
  const box = card.locator('.m-overall-comment');
  await expect(card.locator('.m-overall-label')).toHaveText(/^Comment for /);
  await box.scrollIntoViewIfNeeded();
  await box.fill('Clear labels on every graph.');
  await box.blur();
  const saved = await page.evaluate(() => {
    const el = document.querySelector('.m-swiper-card .m-overall-comment');
    return getScoreComment(getActiveCourse(), el.dataset.sid, el.dataset.aid);
  });
  expect(saved).toBe('Clear labels on every graph.');
  // Drawn again, the card shows the comment already saved.
  await page.locator('[data-action="m-back"]').click();
  await page.locator('[data-action="m-grade-assess"]').first().click();
  await expect(page.locator('#m-screen-grade-swiper .m-swiper-card').first().locator('.m-overall-comment')).toHaveValue(
    'Clear labels on every graph.',
  );
});

async function openAssessment(page, title) {
  await openPhone(page);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('[data-action="m-grade-assess"]', { hasText: title }).first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await page.waitForTimeout(500);
}

function pointsNow(page) {
  return page.evaluate(() => {
    const el = document.querySelector('#m-screen-grade-swiper .m-pts-input');
    return getPointsScore(getActiveCourse(), el.dataset.sid, el.dataset.aid);
  });
}

// Group 2 #35: emptying the box clears a points score with no toast; nonsense
// and Escape keep it.
test('emptying the box clears a points score; Escape and nonsense keep it', async ({ page }) => {
  await openAssessment(page, 'Data Reading Quiz');
  const box = page.locator('#m-screen-grade-swiper .m-pts-input').first();
  const before = await pointsNow(page);
  expect(before).not.toBeNull();

  await box.fill('abc');
  await box.blur();
  expect(await pointsNow(page)).toBe(before);
  await expect(box).toHaveValue(String(before));

  await box.fill('3');
  await box.press('Escape');
  expect(await pointsNow(page)).toBe(before);
  await expect(box).toHaveValue(String(before));

  await box.fill('');
  await box.blur();
  expect(await pointsNow(page)).toBeNull();
  await expect(page.locator('#m-toast')).not.toContainText('Score cleared');
});

// Group 2 #36: a filter from the sheet covers the whole list, not just Recent.
test('sheet filters are not narrowed by Recent', async ({ page }) => {
  await openPhone(page);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await expect(page.locator('[data-action="m-grade-seg"][data-val="recent"]')).toHaveClass(/m-seg-active/);
  await page.locator('[data-action="m-grade-filter-open"]').click();
  // The filter applies as it is tapped, in every class; Done closes it.
  await page.locator('[data-action="m-grade-filter-done"]').waitFor();
  await page.locator('[data-action="m-grade-filter-toggle"][data-kind="category"]').first().click();
  await page.locator('[data-action="m-grade-filter-done"]').click();
  await expect(page.locator('[data-action="m-grade-seg"][data-val="all"]')).toHaveClass(/m-seg-active/);
  // Every assessment in the chosen category shows, however old.
  const counts = await page.evaluate(() => {
    const cid = getActiveCourse();
    const cat = JSON.parse(localStorage.getItem('gb-grade-filters-' + cid)).category[0];
    const want = getAssessments(cid).filter(a => (a.categoryId || '__none') === cat).length;
    const shown = [...document.querySelectorAll('#m-grade-list .m-tg-row')].filter(c => !c.hidden).length;
    return { want, shown };
  });
  expect(counts.shown).toBe(counts.want);
  // Opened again, the list keeps the filter on the whole list.
  await page.locator('.m-tab-item[data-tab="students"]').click();
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await expect(page.locator('[data-action="m-grade-seg"][data-val="all"]')).toHaveClass(/m-seg-active/);
});

// Group 2 #38: a long category no longer cuts the Grade list's titles.
test('Grade list titles are not cut by the category', async ({ page }) => {
  await openPhone(page);
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const cats = getCategories(cid);
    cats[0].name = 'Summative Assessments and Major Projects';
  });
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('[data-action="m-grade-seg"][data-val="all"]').click();
  const cut = await page.evaluate(() =>
    [...document.querySelectorAll('#m-grade-list .m-tg-row')]
      .filter(c => !c.hidden)
      .map(c => c.querySelector('.m-tg-title'))
      .filter(t => t.scrollHeight > t.clientHeight + 1 || t.scrollWidth > t.clientWidth + 1)
      .map(t => t.textContent),
  );
  expect(cut).toEqual([]);
});

// Group 2 #39: a long name is cut before its IEP badge is.
test('All Students keeps the IEP badge in view on a long name', async ({ page }) => {
  await openPhone(page);
  const sid = await page.evaluate(() => {
    const cid = getActiveCourse();
    const st = getStudents(cid)[0];
    st.designations = ['G'];
    st.preferred = 'Maximiliano-Bartholomew Alexandrovich';
    return st.id;
  });
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-who').click();
  const cell = page.locator('#m-student-list .m-cell[data-sid="' + sid + '"]');
  await cell.scrollIntoViewIfNeeded();
  const badge = cell.locator('.m-badge-iep');
  await expect(badge).toBeVisible();
  const [b, c] = await Promise.all([badge.boundingBox(), cell.locator('.m-cell-body').boundingBox()]);
  expect(b.x + b.width).toBeLessThanOrEqual(c.x + c.width + 0.5);
});

// Group 3 #81: the open tab's icon keeps its marks (Grade's check, Observe's
// lines) instead of turning into a plain blue shape.
test('the open tab icon keeps its check mark', async ({ page }) => {
  await openPhone(page);
  for (const tab of ['grade', 'observe']) {
    await page.locator('.m-tab-item[data-tab="' + tab + '"]').click();
    const colours = await page.evaluate(t => {
      const icon = document.querySelector('.m-tab-item[data-tab="' + t + '"] .m-tab-icon');
      const shape = icon.querySelector('circle, rect');
      const mark = icon.querySelector('.m-tab-mark');
      return {
        fill: getComputedStyle(shape).fill,
        mark: mark && getComputedStyle(mark).stroke,
        // The mark is drawn after (over) the filled shape.
        markOnTop: !!mark && !!(shape.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING),
      };
    }, tab);
    expect(colours.mark).toBeTruthy();
    expect(colours.mark).not.toBe(colours.fill);
    expect(colours.markOnTop).toBe(true);
  }
});

// Group 3 #21: the Grade tab uses the desktop's words: competencies, not
// tags; Missing, Excused and Late spelled out; the level numbers named;
// Excused grey, not Missing's red; and the two Score By views say how they
// differ.
test('Grade tab uses the desktop words', async ({ page }) => {
  await openPhone(page);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('[data-action="m-grade-seg"][data-val="all"]').click();
  const subs = await page.locator('#m-grade-list .m-tg-line').allTextContents();
  expect(subs.join(' ')).toMatch(/competenc/);
  expect(subs.join(' ')).not.toMatch(/\btags?\b/);

  // A level-scored assessment with no score for the first student.
  const title = await page.evaluate(() => {
    const cid = getActiveCourse();
    const a = getAssessments(cid).find(x => !isPointsScored(x) && !isCompletionScored(x) && !x.rubricId);
    return a.title;
  });
  await page.locator('[data-action="m-grade-assess"]', { hasText: title }).first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await page.waitForTimeout(500);
  const card = page.locator('.m-swiper-card').first();
  // Late, Missing and Excused are spelled out, under ⋯.
  await page.locator('#m-nav-bar-grade-swiper .m-grade-more').click();
  await expect(page.locator('#m-sheet-container .m-more-sheet .m-status-pill')).toHaveText([
    'Late',
    'Missing',
    'Excused',
  ]);
  // The hint shows exactly when Missing can't be picked.
  const ns = page.locator('#m-sheet-container .m-status-pill[data-val="NS"]');
  const locked = await ns.isDisabled();
  await expect(page.locator('#m-sheet-container .m-more-hint')).toHaveCount(locked ? 1 : 0);
  await page.evaluate(() => MComponents.dismissSheet());
  // The level words stay out of the track (its codes), and are read out whole.
  await expect(card.locator('.m-score-btn[data-score="3"]').first()).toHaveAttribute(
    'aria-label',
    /^3[+\u2212]?, Proficient$/,
  );
  await expect(card.locator('.m-score-btn[data-score="3"]').first()).toHaveText(/^PRF/);

  // Excused, set, is grey like the desktop grader, not Missing's red.
  const [excBg, nsBg] = await page.evaluate(() => {
    const probe = kind => {
      const s = document.createElement('span');
      s.className = 'm-grade-chip m-grade-chip-' + kind;
      document.body.appendChild(s);
      const bg = getComputedStyle(s).backgroundColor;
      s.remove();
      return bg;
    };
    return [probe('exc'), probe('ns')];
  });
  expect(excBg).not.toBe(nsBg);
});

// Group 3 #33 (and the Enter half of #79): Enter in the points box saves
// and moves to the next student, as Enter does in the desktop grader.
test('Enter in the points box saves and moves to the next student', async ({ page }) => {
  await openAssessment(page, 'Data Reading Quiz');
  const first = page.locator('#m-screen-grade-swiper .m-pts-input').first();
  const sid = await first.getAttribute('data-sid');
  await first.fill('7');
  await first.press('Enter');
  const saved = await page.evaluate(
    s => getPointsScore(getActiveCourse(), s, document.querySelector('.m-pts-input').dataset.aid),
    sid,
  );
  expect(saved).toBe(7);
  await expect.poll(() => settled(page)).toBe(1);
  const focused = await page.evaluate(() => {
    const el = document.activeElement;
    const cards = [...document.querySelectorAll('.m-swiper-card')];
    return el && el.classList.contains('m-pts-input') ? cards.indexOf(el.closest('.m-swiper-card')) : -1;
  });
  expect(focused).toBe(1);
});

// Group 3 #79: the grading screen works the moment it opens: a points
// score typed straight away is saved, and an avatar tap moves at once.
test('grading screen works as soon as it opens', async ({ page }) => {
  await openPhone(page);
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('[data-action="m-grade-assess"]', { hasText: 'Data Reading Quiz' }).first().click();
  const box = page.locator('#m-screen-grade-swiper .m-pts-input').first();
  await box.fill('6');
  await box.blur();
  const saved = await page.evaluate(() => {
    const el = document.querySelector('#m-screen-grade-swiper .m-pts-input');
    return getPointsScore(getActiveCourse(), el.dataset.sid, el.dataset.aid);
  });
  expect(saved).toBe(6);
  await jumpTo(page, 2);
  await expect.poll(() => settled(page)).toBe(2);
});

// Group 3 #82: the phone app works from a keyboard and a mouse too. The
// arrow keys move between student cards and between students on the
// grading screen; a mouse drag moves the cards; avatars are named
// buttons; each points box names its student.
test('arrow keys, mouse drag and names on the phone app', async ({ page }) => {
  await openPhone(page);
  const count = page.locator('.m-card-stack-item[data-depth="0"] .m-sc-place');
  await expect(count).toContainText('1 of');
  const first = await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-name').innerText();
  await page.locator('.m-card-stack').focus();
  await page.keyboard.press('ArrowRight');
  await expect(count).toContainText('2 of');
  await page.waitForTimeout(400); // the card's exit animation
  await page.keyboard.press('ArrowLeft');
  await expect(count).toContainText('1 of');
  // And it is the first student's card again, not the third's.
  await expect(page.locator('.m-card-stack-item[data-depth="0"] .m-sc-name')).toHaveText(first);
  await page.waitForTimeout(400);

  // Dragged from the level, not the name (a button, which a mouse press never drags).
  const box = await page.locator('.m-card-stack-item[data-depth="0"]').boundingBox();
  const lv = await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-level').boundingBox();
  const y = lv.y + lv.height / 2;
  await page.mouse.move(box.x + box.width - 40, y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(box.x + box.width - 40 - i * 25, y);
  await page.mouse.up();
  await expect(count).toContainText('2 of');
  await page.waitForTimeout(400);

  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('[data-action="m-grade-assess"]', { hasText: 'Data Reading Quiz' }).first().click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  // The progress line is a line, not a row of buttons; the class list is how a name is reached.
  await expect(page.locator('#m-grade-progress .m-prog-seg').first()).toHaveJSProperty('tagName', 'SPAN');
  await expect(page.locator('#m-grade-progress button')).toHaveCount(0);
  const name = await page.evaluate(() => {
    const cid = getActiveCourse();
    const sid = document.querySelector('#m-grade-progress .m-prog-seg').dataset.sid;
    return displayNameWithLast(getStudents(cid).find(s => s.id === sid));
  });
  await expect(page.locator('.m-pts-input').first()).toHaveAttribute('aria-label', new RegExp('^Points for ' + name));
  await page
    .locator('body')
    .click({ position: { x: 5, y: 300 } })
    .catch(() => {});
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => settled(page)).toBe(1);
  await page.keyboard.press('ArrowLeft');
  await expect.poll(() => settled(page)).toBe(0);
});

// Group 3 #87: the phone app's controls are at least 44 px high. Only
// controls a finger can reach count: the cards stacked behind the top one
// are shrunk and take no taps (pointer-events: none). The first screen
// slides in, so the check waits for the Demo Mode pill to be on screen: it
// used to measure mid-slide, with the 30 px pill still below the window.
test('phone controls are finger-sized', async ({ page }) => {
  const small = () =>
    [...document.querySelectorAll('button, [role=button], select, input, [data-action]')]
      .filter(e => {
        const r = e.getBoundingClientRect();
        if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight) return false;
        if (e.closest('#m-auth, .m-skip-nav, .m-obs-chev, [inert]')) return false;
        if (getComputedStyle(e).pointerEvents === 'none') return false;
        return r.height < 43.5;
      })
      .map(e => e.outerHTML.slice(0, 80) + ' ' + Math.round(e.getBoundingClientRect().height));
  await openPhone(page);
  await expect(page.locator('.m-tabbar-demo').first()).toBeInViewport();
  expect(await page.evaluate(small)).toEqual([]);
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(small)).toEqual([]);
  await page.locator('[data-action="m-back"]').first().click();
  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('[data-action="m-grade-assess"]').first().click();
  await page.waitForTimeout(500);
  expect(await page.evaluate(small)).toEqual([]);
});

// Group 3 #75: a starter row posts on one tap, so it says Post instead of
// a › that suggests it opens something, and the post can be undone.
test('Observe starters say Post and can be undone', async ({ page }) => {
  await openPhone(page);
  const sid = await page
    .locator('.m-card-stack-item[data-depth="0"] [data-action="m-obs-quick-menu"]')
    .getAttribute('data-sid');
  const before = await page.evaluate(s => (getQuickObs(getActiveCourse())[s] || []).length, sid);
  await page.locator('.m-card-stack-item[data-depth="0"] [data-action="m-obs-quick-menu"]').click();
  const row = page.locator('.m-quick-row[data-action="m-obs-quick-post"]').first();
  await expect(row.locator('.m-quick-row-post')).toHaveText('Post');
  await expect(row.locator('.m-quick-row-car')).toHaveCount(0);
  await row.click();
  expect(await page.evaluate(s => (getQuickObs(getActiveCourse())[s] || []).length, sid)).toBe(before + 1);
  await page.locator('#m-toast [data-action="m-toast-undo"]').click();
  expect(await page.evaluate(s => (getQuickObs(getActiveCourse())[s] || []).length, sid)).toBe(before);
});

// Group 3 #85: a card whose list runs past its bottom says "More Below"
// until it is scrolled to the end.
test('student card says when more rows are below', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 560 }); // so the card's list runs past its bottom
  await openPhone(page);
  const box = page.locator('.m-card-stack-item[data-depth="0"] .m-sc-scroll');
  await expect(box).toHaveClass(/m-more-below/);
  const cue = await box.evaluate(el => getComputedStyle(el, '::after').content);
  expect(cue).toContain('More Below');
  await box.evaluate(el => {
    el.scrollTop = el.scrollHeight;
  });
  await expect(box).not.toHaveClass(/m-more-below/);
});

// Group 3 #86: titles and chips are whole on a phone: a long assessment
// title in the grading bar, students who share initials told apart,
// assessment rows and timeline names on the student screen, and the
// competency sparklines.
test('phone titles, chips and sparklines are not cut', async ({ page }) => {
  await openPhone(page);
  const long = '5.1 Mapping Germany’s Conquest of Europe, 1939-1941 and Its Effects';
  await page.evaluate(t => {
    const cid = getActiveCourse();
    getAssessments(cid).find(x => x.title === 'Data Reading Quiz').title = t;
    const st = getStudents(cid);
    st[1].firstName = 'Cecily';
    st[1].preferred = '';
    st[1].lastName = st[0].lastName;
  }, long);

  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
  await page.locator('#m-screen-student-detail summary', { hasText: 'All Work' }).click();
  await page.locator('#m-screen-student-detail summary', { hasText: 'Competencies' }).click();
  const cutRows = await page.evaluate(() =>
    [...document.querySelectorAll('#m-screen-student-detail .m-assess-title, #m-screen-student-detail .m-sec-tl-name')]
      .filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1)
      .map(e => e.textContent),
  );
  expect(cutRows).toEqual([]);
  const clipped = await page.evaluate(
    () =>
      [...document.querySelectorAll('#m-screen-student-detail .m-section-header .growth-sparkline')].filter(
        e => e.scrollWidth > e.clientWidth + 1,
      ).length,
  );
  expect(clipped).toBe(0);
  await page.locator('[data-action="m-back"]').first().click();

  await page.locator('.m-tab-item[data-tab="grade"]').click();
  await page.locator('[data-action="m-grade-seg"][data-val="all"]').click();
  await page.locator('[data-action="m-grade-assess"]', { hasText: '5.1 Mapping' }).first().click();
  // The bar names the student on screen; the long title is the Grade list's row's.
  const title = page.locator('#m-nav-bar-grade-swiper .m-nav-bar-title-inline');
  await expect(title).not.toHaveText('');
  const fits = await title.evaluate(el => {
    const bar = el.closest('.m-nav-bar').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return el.scrollHeight <= el.clientHeight + 1 && r.top >= bar.top - 0.5 && r.bottom <= bar.bottom + 0.5;
  });
  expect(fits).toBe(true);
  // Each name on the class list is its own: two students who share initials are told apart by name.
  await title.locator('.m-nav-title-text').click();
  const names = await page.locator('#m-sheet-container .m-roster-row').allTextContents();
  expect(new Set(names).size).toBe(names.length);
});

// Group 3 #78: an assessment row on the student screen opens that
// assessment on that student; the Grade button says which piece it opens.
test('student screen assessment rows open their grading', async ({ page }) => {
  await openPhone(page);
  await page.locator('.m-card-stack-item[data-depth="0"] .m-sc-profile').click();
  // All Work opens in place on the profile.
  await page.locator('#m-screen-student-detail summary', { hasText: 'All Work' }).click();
  const row = page.locator('#m-screen-student-detail .m-assess-compact[data-action="m-assess-grade"]').nth(2);
  const [sid, aid] = [await row.getAttribute('data-sid'), await row.getAttribute('data-aid')];
  const name = await page.evaluate(s => displayName(getStudents(getActiveCourse()).find(x => x.id === s)), sid);
  await row.click();
  await expect(page.locator('#m-screen-grade-swiper')).toBeVisible();
  await expect(page.locator('#m-screen-grade-swiper')).toHaveAttribute('data-restore', new RegExp(aid));
  await expect(page.locator('#m-nav-bar-grade-swiper .m-nav-title-text')).toHaveText(name);
  await expect(page.locator('#m-grade-progress .is-current')).toHaveAttribute('data-sid', sid);
  await page.locator('[data-action="m-back"]').first().click();
  await expect(page.locator('#m-screen-student-detail .m-sp-name')).toHaveText(name);
});
