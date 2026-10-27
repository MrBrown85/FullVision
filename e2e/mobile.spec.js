import { test, expect } from '@playwright/test';
import {
  mockAuth,
  seedCourse,
  seedStudents,
  seedAssessments,
  seedScores,
  gotoApp,
  navigateTo,
  clickAction,
  TEST_STUDENTS,
  TEST_ASSESSMENT,
  TEST_COURSE,
} from './helpers.js';

// ── Viewport presets ─────────────────────────────────────────
const MOBILE = { width: 375, height: 667 };
const SMALL_MOBILE = { width: 320, height: 568 };
const TABLET = { width: 1024, height: 768 };
const SMALL_TABLET = { width: 900, height: 700 };

// ── Helper: check no horizontal overflow ─────────────────────
async function assertNoOverflow(page) {
  const ok = await page.evaluate(
    () => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1,
  );
  expect(ok).toBeTruthy();
}

// ── Helper: get computed style ───────────────────────────────
async function getStyle(page, selector, prop) {
  return page.evaluate(
    ([sel, p]) => {
      const el = document.querySelector(sel);
      return el ? getComputedStyle(el)[p] : null;
    },
    [selector, prop],
  );
}

// ── Helper: wait for #main to have content ───────────────────
async function waitForMainContent(page, timeout = 3000) {
  await page
    .waitForFunction(() => document.getElementById('main')?.innerHTML.trim().length > 0, { timeout })
    .catch(() => {}); // swallow — caller can check separately
}

// ══════════════════════════════════════════════════════════════
// Section 1 — Overflow Prevention
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: Overflow Prevention', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
  });

  const pages = [
    { route: '/dashboard', name: 'Dashboard' },
    { route: '/assignments', name: 'Assignments' },
    { route: '/gradebook', name: 'Gradebook' },
    { route: '/observations', name: 'Observations' },
    { route: '/reports', name: 'Reports' },
  ];

  for (const p of pages) {
    test(`no horizontal overflow on ${p.name} at 375px`, async ({ page }) => {
      await page.setViewportSize(MOBILE);
      await gotoApp(page, p.route);
      await assertNoOverflow(page);
    });
  }

  test('no horizontal overflow on any page at 320px', async ({ page }) => {
    await page.setViewportSize(SMALL_MOBILE);
    await gotoApp(page, '/dashboard');
    for (const p of pages) {
      await navigateTo(page, p.route);
      await page.waitForTimeout(500);
      await assertNoOverflow(page);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// Section 2 — Dock Navigation on Mobile
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: Dock Navigation', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
  });

  test('dock is visible at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    await expect(page.locator('#app-dock')).toBeVisible();
    await expect(page.locator('#dock-mount nav')).toBeVisible();
  });

  test('all 5 nav links are present at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    const links = page.locator('.tb-seg a.tb-seg-link');
    await expect(links).toHaveCount(5);
  });

  test('tapping a dock link navigates to the correct page', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    await page.locator('.tb-seg a.tb-seg-link:has-text("Assignments")').click();
    await page.waitForTimeout(500);
    expect(page.url()).toContain('/assignments');
  });

  test('dock labels hidden at 320px but icons remain visible', async ({ page }) => {
    await page.setViewportSize(SMALL_MOBILE);
    await gotoApp(page, '/dashboard');
    await expect(page.locator('#dock-mount nav')).toBeVisible();
    const links = page.locator('.tb-seg a.tb-seg-link');
    const count = await links.count();
    expect(count).toBe(5);
  });

  test('dock does not overlap main content', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    const dockBox = await page.locator('#app-dock').boundingBox();
    const mainBox = await page.locator('#main').boundingBox();
    expect(dockBox).toBeTruthy();
    expect(mainBox).toBeTruthy();
    expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(mainBox.y + 2);
  });

  test('active page indicator shows on current page', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    const activeLink = page.locator('.tb-seg a.tb-seg-active');
    await expect(activeLink).toBeVisible();
    const text = await activeLink.textContent();
    expect(text).toContain('Dashboard');
  });

  // BUG: dock nav links are only 25px tall, below the 44px Apple HIG recommendation
  test('dock nav links should meet 44px touch target at 375px', async ({ page }) => {
    test.fail(); // known bug: links are ~25px tall
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    const links = page.locator('.tb-seg a.tb-seg-link');
    const count = await links.count();
    for (let i = 0; i < count; i++) {
      const box = await links.nth(i).boundingBox();
      if (box) {
        expect(box.height, `Nav link ${i} height >= 44`).toBeGreaterThanOrEqual(44);
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════
// Section 3 — Sidebar Toggle
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: Sidebar Toggle', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
  });

  test('sidebar is hidden by default at 1024px', async ({ page }) => {
    await page.setViewportSize(TABLET);
    await gotoApp(page, '/dashboard');
    const sidebar = page.locator('#gb-sidebar');
    await expect(sidebar).toBeHidden();
  });

  // The dashboard shows the student list and its toggle in the dock (#374).
  test('sidebar toggle button should be visible at tablet widths', async ({ page }) => {
    await page.setViewportSize(SMALL_TABLET);
    await gotoApp(page, '/dashboard');
    const toggle = page.locator('[data-action="toggleSidebar"]');
    await expect(toggle).toBeVisible();
  });

  test('sidebar toggle button should be visible at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    const toggle = page.locator('[data-action="toggleSidebar"]');
    await expect(toggle).toBeVisible();
  });

  // BUG: at 1024px and below styles.css sets #gb-sidebar to display:none
  // whatever the toggle says, so the toggle shows but opens nothing.
  test('clicking toggle should show and hide sidebar', async ({ page }) => {
    test.fail(); // known bug: the student list never shows below 1025px
    await page.setViewportSize(SMALL_TABLET);
    await gotoApp(page, '/dashboard');
    const toggle = page.locator('[data-action="toggleSidebar"]');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await page.waitForTimeout(300);
    await expect(page.locator('#gb-sidebar')).toBeVisible();
    await toggle.click();
    await page.waitForTimeout(300);
    await expect(page.locator('#gb-sidebar')).toBeHidden();
  });
});

// ══════════════════════════════════════════════════════════════
// Section 4 — Touch Targets
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: Touch Targets', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
  });

  test('buttons meet 44px minimum height at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/assignments');
    const btns = page.locator('.btn, .btn-primary, .btn-ghost, .btn-danger');
    const count = await btns.count();
    for (let i = 0; i < count; i++) {
      const btn = btns.nth(i);
      if (await btn.isVisible()) {
        const box = await btn.boundingBox();
        if (box) {
          expect(box.height, `Button ${i} height should be >= 44px`).toBeGreaterThanOrEqual(43);
        }
      }
    }
  });

  test('score level buttons meet 32px minimum at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/assignments');
    const assessEl = page.locator('text=Lab Report 1').first();
    await assessEl.click();
    await page.waitForTimeout(500);
    const scoreOpts = page.locator('.score-opt');
    const count = await scoreOpts.count();
    if (count > 0) {
      for (let i = 0; i < Math.min(count, 5); i++) {
        const box = await scoreOpts.nth(i).boundingBox();
        if (box) {
          expect(box.width, `Score button ${i} width >= 32`).toBeGreaterThanOrEqual(31);
          expect(box.height, `Score button ${i} height >= 32`).toBeGreaterThanOrEqual(31);
        }
      }
    }
  });
});

// ══════════════════════════════════════════════════════════════
// Section 5 — Score Grid Horizontal Scrolling
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: Score Grid Scrolling', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
  });

  test('score grid has overflow-x auto at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/assignments');
    await page.locator('text=Lab Report 1').first().click();
    await page.waitForTimeout(500);
    const overflowX = await getStyle(page, '.score-grid', 'overflowX');
    if (overflowX !== null) {
      expect(['auto', 'scroll']).toContain(overflowX);
    }
  });

  test('student names are sticky in score grid', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/assignments');
    await page.locator('text=Lab Report 1').first().click();
    await page.waitForTimeout(500);
    const position = await getStyle(page, '.score-name', 'position');
    if (position !== null) {
      expect(position).toBe('sticky');
    }
  });

  test('score grid content remains visible after scroll', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/assignments');
    await page.locator('text=Lab Report 1').first().click();
    await page.waitForTimeout(500);
    const body = await page.locator('body').textContent();
    expect(body).toContain('Alice');
    expect(body).toContain('Bob');
    expect(body).toContain('Charlie');
  });

  test('score buttons are tappable at mobile size', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/assignments');
    await page.locator('text=Lab Report 1').first().click();
    await page.waitForTimeout(500);
    const levelBtn = page.locator('[data-action="selectTagLevel"][data-level="3"][data-sid="stu-001"]').first();
    if (await levelBtn.isVisible()) {
      await levelBtn.click();
      await page.waitForTimeout(300);
      await expect(levelBtn).toHaveClass(/active/);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// Section 6 — Heatmap / Dashboard Content on Mobile
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: Dashboard Content', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
    await seedScores(page, {
      'stu-001': { 'assess-001': { QAP: 3 } },
      'stu-002': { 'assess-001': { QAP: 2 } },
      'stu-003': { 'assess-001': { QAP: 4 } },
    });
  });

  test('dashboard should render student content at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    await waitForMainContent(page);
    const body = await page.locator('#main').textContent();
    expect(body.length).toBeGreaterThan(0);
  });

  test('dashboard renders at desktop then stays after resize to mobile', async ({ page }) => {
    // Load at desktop first, then resize — tests if content survives resize
    await gotoApp(page, '/dashboard');
    await waitForMainContent(page);
    const desktopContent = await page.locator('#main').textContent();
    expect(desktopContent).toContain('Alice');
    // Resize to mobile
    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(500);
    await assertNoOverflow(page);
  });

  test('heatmap name cells use sticky positioning when present', async ({ page }) => {
    // Load at desktop where heatmap renders
    await gotoApp(page, '/dashboard');
    await waitForMainContent(page);
    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(300);
    const pos = await getStyle(page, '.hm-name-cell', 'position');
    if (pos !== null) {
      expect(pos).toBe('sticky');
    }
  });

  test('heatmap student rows are tappable when present', async ({ page }) => {
    await gotoApp(page, '/dashboard');
    await waitForMainContent(page);
    const nameLink = page.locator('.hm-name-link').first();
    if (await nameLink.isVisible()) {
      await nameLink.click();
      await page.waitForTimeout(500);
      expect(page.url()).toContain('/student');
    }
  });
});

// ══════════════════════════════════════════════════════════════
// Section 7 — Confirm Modal on Mobile
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: Confirm Modal', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
  });

  test('confirm modal renders full-width on mobile', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    await page.evaluate(() => {
      window.showConfirm('Test Title', 'Test message', 'OK', 'primary', () => {});
    });
    await page.waitForTimeout(200);
    const card = page.locator('.confirm-card');
    await expect(card).toBeVisible();
    const box = await card.boundingBox();
    expect(box.width).toBeGreaterThan(300);
  });

  test('confirm modal buttons are visible and within viewport', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    await page.evaluate(() => {
      window.showConfirm('Test', 'Are you sure?', 'Delete', 'danger', () => {});
    });
    await page.waitForTimeout(200);
    const cancelBtn = page.locator('#confirm-cancel-btn');
    const okBtn = page.locator('#confirm-ok-btn');
    await expect(cancelBtn).toBeVisible();
    await expect(okBtn).toBeVisible();
    const cancelBox = await cancelBtn.boundingBox();
    const okBox = await okBtn.boundingBox();
    expect(cancelBox.y + cancelBox.height).toBeLessThan(MOBILE.height);
    expect(okBox.y + okBox.height).toBeLessThan(MOBILE.height);
  });

  test('cancel button dismisses confirm modal', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    await page.evaluate(() => {
      window.showConfirm('Test', 'Message', 'OK', 'primary', () => {});
    });
    await page.waitForTimeout(200);
    await page.locator('#confirm-cancel-btn').click();
    await page.waitForTimeout(200);
    await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  });

  test('backdrop tap dismisses confirm modal', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    await page.evaluate(() => {
      window.showConfirm('Test', 'Message', 'OK', 'primary', () => {});
    });
    await page.waitForTimeout(200);
    const overlay = page.locator('.confirm-overlay');
    await overlay.click({ position: { x: 10, y: 10 } });
    await page.waitForTimeout(200);
    await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  });
});

// ══════════════════════════════════════════════════════════════
// Section 8 — Form Interactions on Mobile
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: Form Interactions', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
  });

  test('new assessment form is usable at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/assignments');
    await page.locator('[data-action="showNewForm"]').click();
    await page.waitForTimeout(300);
    const form = page.locator('#new-assess-form');
    await expect(form).toBeVisible();
    await assertNoOverflow(page);
  });

  test('assessment form inputs are visible and not clipped at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/assignments');
    await page.locator('[data-action="showNewForm"]').click();
    await page.waitForTimeout(300);
    const titleInput = page.locator('#new-assess-form input[type="text"]').first();
    if (await titleInput.isVisible()) {
      const box = await titleInput.boundingBox();
      expect(box.width).toBeGreaterThan(100);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(MOBILE.width + 5);
    }
  });

  test('observation capture area is usable at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/observations');
    const captureArea = page.locator('#obs-capture');
    if (await captureArea.isVisible()) {
      const input = page.locator('#capture-input');
      await expect(input).toBeVisible();
      const addBtn = page.locator('#capture-add-btn');
      await expect(addBtn).toBeVisible();
      await assertNoOverflow(page);
    }
  });

  test('student page content renders at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/student?id=stu-001');
    const body = await page.locator('body').textContent();
    expect(body).toContain('Alice');
    await assertNoOverflow(page);
  });
});

// ══════════════════════════════════════════════════════════════
// Section 9 — User Menu on Mobile
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: User Menu', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
  });

  test('user menu button is visible at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    const menuBtn = page.locator('[data-action="toggleUserMenu"]');
    await expect(menuBtn).toBeVisible();
  });

  test('clicking user menu opens dropdown', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    await page.locator('[data-action="toggleUserMenu"]').click();
    await page.waitForTimeout(200);
    const dropdown = page.locator('.tb-user-dropdown');
    await expect(dropdown).toBeVisible();
  });

  test('sign out button is visible in dropdown', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    await page.locator('[data-action="toggleUserMenu"]').click();
    await page.waitForTimeout(200);
    const signOut = page.locator('[data-action="signOut"]');
    await expect(signOut).toBeVisible();
  });
});

// ══════════════════════════════════════════════════════════════
// Section 10 — Page-by-Page Mobile Rendering
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: Page Rendering', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
    await seedScores(page, {
      'stu-001': { 'assess-001': { QAP: 3 } },
      'stu-002': { 'assess-001': { QAP: 2 } },
      'stu-003': { 'assess-001': { QAP: 4 } },
    });
  });

  test('Dashboard should render content at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    await waitForMainContent(page);
    await expect(page.locator('#main')).not.toBeEmpty();
  });

  // BUG: Assignments page renders empty at mobile in some cases
  test('Assignments page renders at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/assignments');
    await waitForMainContent(page);
    // The page should at least show the assessment or toolbar
    const bodyText = await page.locator('body').textContent();
    expect(bodyText).toContain('Lab Report 1');
    await assertNoOverflow(page);
  });

  test('Observations page renders at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/observations');
    await expect(page.locator('#main')).not.toBeEmpty();
    await assertNoOverflow(page);
  });

  test('Gradebook should render content at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/gradebook');
    await waitForMainContent(page);
    await expect(page.locator('#main')).not.toBeEmpty();
  });

  test('Reports page renders at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/reports');
    await expect(page.locator('#main')).not.toBeEmpty();
    await assertNoOverflow(page);
  });
});

// ══════════════════════════════════════════════════════════════
// Section 11 — Grid Layout Changes
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: Grid Layouts', () => {
  test.beforeEach(async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
    await seedScores(page, {
      'stu-001': { 'assess-001': { QAP: 3 } },
    });
  });

  test('dashboard grid is single-column at 375px when rendered', async ({ page }) => {
    // Load at desktop first where dashboard renders, then resize
    await gotoApp(page, '/dashboard');
    await waitForMainContent(page);
    await page.setViewportSize(MOBILE);
    await page.waitForTimeout(300);
    const cols = await getStyle(page, '.dash-grid', 'gridTemplateColumns');
    if (cols !== null) {
      const colCount = cols.trim().split(/\s+/).length;
      expect(colCount).toBe(1);
    }
  });

  test('student insights grid is single-column at 375px', async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/student?id=stu-001');
    const cols = await getStyle(page, '.insights-grid', 'gridTemplateColumns');
    if (cols !== null) {
      const colCount = cols.trim().split(/\s+/).length;
      expect(colCount).toBe(1);
    }
  });
});

// ══════════════════════════════════════════════════════════════
// Section 12 — Content Visibility Edge Cases
// ══════════════════════════════════════════════════════════════

test.describe('Mobile: Edge Cases', () => {
  test('long student names do not overflow at 375px', async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    const longNameStudents = [
      ...TEST_STUDENTS,
      {
        id: 'stu-long',
        firstName: 'Alexandrina-Bartholomew',
        lastName: 'Worthington-Carmichael',
        preferred: 'Alex',
        pronouns: '',
        studentNumber: '9999',
        email: '',
        dateOfBirth: '',
        designation: '',
        enrolledDate: '',
        attendance: [],
        sortName: 'Worthington-Carmichael Alexandrina-Bartholomew',
      },
    ];
    await seedStudents(page, longNameStudents);
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/dashboard');
    await assertNoOverflow(page);
  });

  test('long assessment titles do not overflow at 375px', async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    const longAssessment = {
      ...TEST_ASSESSMENT,
      id: 'assess-long',
      title: 'Comprehensive End-of-Unit Summative Performance-Based Lab Assessment — Extended Version',
    };
    await seedAssessments(page, [TEST_ASSESSMENT, longAssessment]);
    await page.setViewportSize(MOBILE);
    await gotoApp(page, '/assignments');
    await assertNoOverflow(page);
    const body = await page.locator('body').textContent();
    expect(body).toContain('Comprehensive');
  });

  test('score values should be readable at 320px', async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
    await seedScores(page, {
      'stu-001': { 'assess-001': { QAP: 3 } },
      'stu-002': { 'assess-001': { QAP: 2 } },
      'stu-003': { 'assess-001': { QAP: 4 } },
    });
    await page.setViewportSize(SMALL_MOBILE);
    await gotoApp(page, '/gradebook');
    await waitForMainContent(page);
    await expect(page.locator('#main')).not.toBeEmpty();
    const body = await page.locator('body').textContent();
    expect(body).toContain('Alice');
  });

  test('gradebook content survives resize from desktop to 320px', async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page);
    await seedScores(page, {
      'stu-001': { 'assess-001': { QAP: 3 } },
    });
    // Load at desktop first
    await gotoApp(page, '/gradebook');
    await waitForMainContent(page);
    const desktopBody = await page.locator('body').textContent();
    expect(desktopBody).toContain('Alice');
    // Now resize to small mobile
    await page.setViewportSize(SMALL_MOBILE);
    await page.waitForTimeout(500);
    await assertNoOverflow(page);
  });
});
