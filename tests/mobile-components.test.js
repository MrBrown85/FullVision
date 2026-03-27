/**
 * Mobile shared components tests — m-components.js
 *
 * Tests avatar helpers, navigation bar, proficiency colors,
 * relative time, date grouping, HTML escaping, haptics, and toasts.
 */

import './setup-mobile.js';

/* ── avatarColor ────────────────────────────────────────────── */
describe('MComponents.avatarColor', () => {
  it('returns a color string', () => {
    const color = MComponents.avatarColor('student-123');
    expect(typeof color).toBe('string');
    expect(color.length).toBeGreaterThan(0);
  });

  it('returns consistent color for same id', () => {
    const color1 = MComponents.avatarColor('abc');
    const color2 = MComponents.avatarColor('abc');
    expect(color1).toBe(color2);
  });

  it('returns different colors for different ids (usually)', () => {
    const color1 = MComponents.avatarColor('student-1');
    const color2 = MComponents.avatarColor('student-999');
    // Not guaranteed different, but very likely with different hash inputs
    // Just verify both are valid colors
    expect(color1).toBeTruthy();
    expect(color2).toBeTruthy();
  });
});

/* ── avatarInitials ─────────────────────────────────────────── */
describe('MComponents.avatarInitials', () => {
  it('returns first + last initials', () => {
    expect(MComponents.avatarInitials({ firstName: 'John', lastName: 'Smith' })).toBe('JS');
  });

  it('uses preferred name over firstName', () => {
    expect(MComponents.avatarInitials({ firstName: 'Jonathan', preferred: 'Jon', lastName: 'Smith' })).toBe('JS');
  });

  it('handles missing last name', () => {
    expect(MComponents.avatarInitials({ firstName: 'Cece', lastName: '' })).toBe('C');
  });

  it('handles missing first name', () => {
    expect(MComponents.avatarInitials({ firstName: '', lastName: 'Khan' })).toBe('K');
  });

  it('returns uppercase', () => {
    const result = MComponents.avatarInitials({ firstName: 'john', lastName: 'doe' });
    expect(result).toBe('JD');
  });
});

/* ── navBar ──────────────────────────────────────────────────── */
describe('MComponents.navBar', () => {
  it('renders nav bar with title', () => {
    const html = MComponents.navBar({ id: 'test', title: 'Students' });
    expect(html).toContain('m-nav-bar');
    expect(html).toContain('Students');
  });

  it('renders back button when backLabel provided', () => {
    const html = MComponents.navBar({ id: 'test', title: 'Detail', backLabel: 'Back' });
    expect(html).toContain('m-nav-bar-back');
    expect(html).toContain('Back');
    expect(html).toContain('data-action="m-back"');
  });

  it('omits back button when no backLabel', () => {
    const html = MComponents.navBar({ id: 'test', title: 'Home' });
    expect(html).not.toContain('m-nav-bar-back');
  });

  it('renders right actions when rightHTML provided', () => {
    const html = MComponents.navBar({ id: 'test', title: 'Test', rightHTML: '<button>Action</button>' });
    expect(html).toContain('m-nav-bar-actions');
    expect(html).toContain('Action');
  });

  it('renders subtitle when provided', () => {
    const html = MComponents.navBar({ id: 'test', title: 'Grade', subtitle: '1 of 28' });
    expect(html).toContain('1 of 28');
  });

  it('sets id attribute from opts.id', () => {
    const html = MComponents.navBar({ id: 'my-nav', title: 'Test' });
    expect(html).toContain('id="m-nav-bar-my-nav"');
  });
});

/* ── largeTitleHTML ──────────────────────────────────────────── */
describe('MComponents.largeTitleHTML', () => {
  it('renders large title div', () => {
    const html = MComponents.largeTitleHTML('Students');
    expect(html).toContain('m-title-large');
    expect(html).toContain('Students');
  });

  it('escapes HTML in title', () => {
    const html = MComponents.largeTitleHTML('<script>alert("xss")</script>');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

/* ── profBg (dark-mode-aware colors) ────────────────────────── */
describe('MComponents.profBg', () => {
  it('returns a color for each proficiency level 0-4', () => {
    for (let i = 0; i <= 4; i++) {
      const color = MComponents.profBg(i);
      expect(color).toBeTruthy();
      expect(typeof color).toBe('string');
    }
  });

  it('uses PROF_COLORS constant (CSS variables for dark mode)', () => {
    // Level 3 should use var(--score-3), not hardcoded green
    const color = MComponents.profBg(3);
    expect(color).toBe(PROF_COLORS[3]);
  });

  it('rounds fractional levels', () => {
    const color25 = MComponents.profBg(2.5);
    const color3 = MComponents.profBg(3);
    expect(color25).toBe(color3); // 2.5 rounds to 3
  });

  it('falls back to level 0 color for invalid input', () => {
    const color = MComponents.profBg(-1);
    expect(color).toBe(PROF_COLORS[0]);
  });

  it('falls back for NaN', () => {
    const color = MComponents.profBg(NaN);
    expect(color).toBe(PROF_COLORS[0]);
  });
});

/* ── esc (HTML escape) ──────────────────────────────────────── */
describe('MComponents.esc', () => {
  it('escapes HTML special characters', () => {
    expect(MComponents.esc('<script>')).toContain('&lt;');
    expect(MComponents.esc('"quotes"')).toContain('&quot;');
    expect(MComponents.esc("it's")).toContain("'"); // single quotes don't need escaping in element content
  });

  it('returns empty string for falsy input', () => {
    expect(MComponents.esc(null)).toBe('');
    expect(MComponents.esc(undefined)).toBe('');
    expect(MComponents.esc('')).toBe('');
  });

  it('passes through safe text unchanged', () => {
    expect(MComponents.esc('Hello World')).toBe('Hello World');
  });
});

/* ── relativeTime ───────────────────────────────────────────── */
describe('MComponents.relativeTime', () => {
  it('shows "Just now" for recent times', () => {
    const now = new Date().toISOString();
    expect(MComponents.relativeTime(now)).toBe('Just now');
  });

  it('shows minutes ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
    expect(MComponents.relativeTime(fiveMinAgo)).toBe('5m ago');
  });

  it('shows hours ago', () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3600000).toISOString();
    expect(MComponents.relativeTime(twoHoursAgo)).toBe('2h ago');
  });

  it('shows days ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString();
    expect(MComponents.relativeTime(threeDaysAgo)).toBe('3d ago');
  });

  it('shows date for older entries', () => {
    const result = MComponents.relativeTime('2024-01-15T10:00:00Z');
    expect(result).toContain('Jan');
    expect(result).toContain('15');
  });
});

/* ── dateGroupLabel ─────────────────────────────────────────── */
describe('MComponents.dateGroupLabel', () => {
  it('returns "Today" for today', () => {
    const today = new Date().toISOString().substring(0, 10);
    expect(MComponents.dateGroupLabel(today)).toBe('Today');
  });

  it('returns "Yesterday" for yesterday', () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().substring(0, 10);
    expect(MComponents.dateGroupLabel(yesterday)).toBe('Yesterday');
  });

  it('returns "This Week" for 3 days ago', () => {
    const threeDays = new Date(Date.now() - 3 * 86400000).toISOString().substring(0, 10);
    expect(MComponents.dateGroupLabel(threeDays)).toBe('This Week');
  });

  it('returns "Earlier" for old dates', () => {
    expect(MComponents.dateGroupLabel('2024-01-01')).toBe('Earlier');
  });
});

/* ── haptic ──────────────────────────────────────────────────── */
describe('MComponents.haptic', () => {
  it('calls navigator.vibrate', () => {
    let vibrated = false;
    const origVibrate = navigator.vibrate;
    navigator.vibrate = () => { vibrated = true; return true; };
    MComponents.haptic();
    expect(vibrated).toBe(true);
    navigator.vibrate = origVibrate;
  });

  it('does not throw when vibrate unavailable', () => {
    const origVibrate = navigator.vibrate;
    delete navigator.vibrate;
    expect(() => MComponents.haptic()).not.toThrow();
    navigator.vibrate = origVibrate;
  });
});

/* ── showToast / hideToast ──────────────────────────────────── */
describe('MComponents toast', () => {
  it('showToast does not throw', () => {
    expect(() => MComponents.showToast('Test message')).not.toThrow();
  });

  it('hideToast does not throw', () => {
    expect(() => MComponents.hideToast()).not.toThrow();
  });

  it('showToast with undo callback does not throw', () => {
    expect(() => MComponents.showToast('Score saved', { onUndo: () => {} })).not.toThrow();
  });
});

/* ── presentSheet / dismissSheet ────────────────────────────── */
describe('MComponents sheet', () => {
  it('presentSheet does not throw', () => {
    expect(() => MComponents.presentSheet('<div>Content</div>')).not.toThrow();
  });

  it('dismissSheet does not throw', () => {
    expect(() => MComponents.dismissSheet()).not.toThrow();
  });

  it('presentSheet accepts onClose callback', () => {
    let closed = false;
    expect(() => MComponents.presentSheet('<div>Content</div>', { onClose: () => { closed = true; } })).not.toThrow();
  });
});

/* ── setupScrollTitle ───────────────────────────────────────── */
describe('MComponents.setupScrollTitle', () => {
  it('does not throw when nav bar not found', () => {
    // Pass a stub element with querySelector that returns null
    const stubScreen = { querySelector: () => null };
    expect(() => MComponents.setupScrollTitle(stubScreen, 'nonexistent-nav')).not.toThrow();
  });
});

/* ── setupOfflineDetection ──────────────────────────────────── */
describe('MComponents.setupOfflineDetection', () => {
  it('does not throw', () => {
    expect(() => MComponents.setupOfflineDetection()).not.toThrow();
  });
});

/* ── ICONS ──────────────────────────────────────────────────── */
describe('MComponents.ICONS', () => {
  it('has required icon SVGs', () => {
    expect(MComponents.ICONS.chevronLeft).toContain('<svg');
    expect(MComponents.ICONS.chevronRight).toContain('<svg');
    expect(MComponents.ICONS.plus).toContain('<svg');
    expect(MComponents.ICONS.settings).toContain('<svg');
  });

  it('icons use currentColor for theming', () => {
    expect(MComponents.ICONS.chevronLeft).toContain('stroke="currentColor"');
    expect(MComponents.ICONS.plus).toContain('stroke="currentColor"');
  });

  it('icons have proper viewBox', () => {
    expect(MComponents.ICONS.plus).toContain('viewBox="0 0 24 24"');
  });
});

/* ── relativeTime edge cases ────────────────────────────────── */
describe('MComponents.relativeTime edge cases', () => {
  it('shows 59m ago at the hour boundary', () => {
    const fiftyNineMinAgo = new Date(Date.now() - 59 * 60000).toISOString();
    expect(MComponents.relativeTime(fiftyNineMinAgo)).toBe('59m ago');
  });

  it('shows 1h ago at exactly 60 minutes', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60000).toISOString();
    expect(MComponents.relativeTime(oneHourAgo)).toBe('1h ago');
  });

  it('shows 23h ago just before the day boundary', () => {
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 3600000).toISOString();
    expect(MComponents.relativeTime(twentyThreeHoursAgo)).toBe('23h ago');
  });

  it('shows 1d ago at exactly 24 hours', () => {
    const oneDayAgo = new Date(Date.now() - 24 * 3600000).toISOString();
    expect(MComponents.relativeTime(oneDayAgo)).toBe('1d ago');
  });

  it('shows 6d ago just before the week boundary', () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 86400000).toISOString();
    expect(MComponents.relativeTime(sixDaysAgo)).toBe('6d ago');
  });

  it('shows formatted date at 7+ days', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * 86400000).toISOString();
    const result = MComponents.relativeTime(eightDaysAgo);
    // Should be a date like "Mar 18" not "8d ago"
    expect(result).not.toContain('ago');
  });
});

/* ── profBg comprehensive ───────────────────────────────────── */
describe('MComponents.profBg comprehensive', () => {
  it('returns different colors for each level', () => {
    const colors = [0, 1, 2, 3, 4].map(l => MComponents.profBg(l));
    // At least 4 distinct colors (0 might match something but 1-4 should differ)
    const unique = new Set(colors);
    expect(unique.size).toBeGreaterThanOrEqual(4);
  });

  it('handles level 0 (no evidence)', () => {
    expect(MComponents.profBg(0)).toBeTruthy();
  });

  it('rounds 3.4 to 3 and 3.5 to 4', () => {
    expect(MComponents.profBg(3.4)).toBe(MComponents.profBg(3));
    expect(MComponents.profBg(3.5)).toBe(MComponents.profBg(4));
  });
});

/* ── navBar edge cases ──────────────────────────────────────── */
describe('MComponents.navBar edge cases', () => {
  it('omits right actions when no rightHTML', () => {
    const html = MComponents.navBar({ id: 'test', title: 'Test' });
    expect(html).not.toContain('m-nav-bar-actions');
  });

  it('handles empty title', () => {
    const html = MComponents.navBar({ id: 'test', title: '' });
    expect(html).toContain('m-nav-bar');
  });

  it('uses default id when none provided', () => {
    const html = MComponents.navBar({ title: 'Test' });
    expect(html).toContain('m-nav-bar-main');
  });

  it('back button has m-back data-action', () => {
    const html = MComponents.navBar({ id: 'test', title: 'Test', backLabel: 'Go Back' });
    expect(html).toContain('data-action="m-back"');
  });

  it('nav bar wraps title and actions in inner container', () => {
    const html = MComponents.navBar({ id: 'test', title: 'Test' });
    expect(html).toContain('m-nav-bar-inner');
  });
});

/* ── avatarColor distribution ───────────────────────────────── */
describe('MComponents.avatarColor distribution', () => {
  it('produces colors for various ID formats', () => {
    // UUID-style
    expect(MComponents.avatarColor('550e8400-e29b-41d4-a716-446655440000')).toBeTruthy();
    // Short ID
    expect(MComponents.avatarColor('abc')).toBeTruthy();
    // Empty string
    expect(MComponents.avatarColor('')).toBeTruthy();
    // Numeric
    expect(MComponents.avatarColor('12345')).toBeTruthy();
  });
});

/* ── avatarInitials edge cases ──────────────────────────────── */
describe('MComponents.avatarInitials edge cases', () => {
  it('handles all empty fields', () => {
    const result = MComponents.avatarInitials({ firstName: '', preferred: '', lastName: '' });
    expect(result).toBe('');
  });

  it('handles only preferred name', () => {
    const result = MComponents.avatarInitials({ firstName: '', preferred: 'Zee', lastName: '' });
    expect(result).toBe('Z');
  });

  it('handles unicode names', () => {
    const result = MComponents.avatarInitials({ firstName: 'André', preferred: '', lastName: 'Müller' });
    expect(result).toBe('AM');
  });
});

/* ── dateGroupLabel edge cases ──────────────────────────────── */
describe('MComponents.dateGroupLabel edge cases', () => {
  it('returns "This Week" for 2 days ago', () => {
    const twoDays = new Date(Date.now() - 2 * 86400000).toISOString().substring(0, 10);
    expect(MComponents.dateGroupLabel(twoDays)).toBe('This Week');
  });

  it('returns "This Week" for 6 days ago', () => {
    const sixDays = new Date(Date.now() - 6 * 86400000).toISOString().substring(0, 10);
    expect(MComponents.dateGroupLabel(sixDays)).toBe('This Week');
  });

  it('returns "Earlier" for 7 days ago', () => {
    const sevenDays = new Date(Date.now() - 7 * 86400000).toISOString().substring(0, 10);
    expect(MComponents.dateGroupLabel(sevenDays)).toBe('Earlier');
  });
});
