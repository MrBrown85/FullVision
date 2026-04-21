# FullVision Design System — Extracted from Existing Code

This document catalogs the design system **already implemented** in the FullVision frontend. It is descriptive, not prescriptive. The rebuild is surgical — we are attaching the existing UI to the new backend and adding new elements for the new features. The existing design choices are **locked** unless explicitly revisited.

Source files audited: `teacher/styles.css`, `teacher/gradebook.css`, `teacher/observations.css`, `teacher/reports.css`, `teacher-mobile/styles.css` (as `mobile.css`), `login.css`, `login.html`.

If anything below is wrong or drifts from current code, the code wins — update this doc, don't fight the code.

---

## 1. Color palette

### 1.1 Core semantic tokens (`teacher/styles.css:6–141`)

```css
--bg: #f5f5f7                     /* light gray app background */
--bg-secondary: #ececf0
--surface: #ffffff                /* primary surface (cards, panels) */
--surface-2: #e5e5ea
--surface-glass: rgba(255,255,255,0.82) /* frosted-glass with blur */
--border: #d1d1d6
--border-2: #c7c7cc
--text: #1d1d1f                   /* primary text */
--text-2: #636366                 /* secondary */
--text-3: #58585D                 /* tertiary / disabled */
```

### 1.2 Brand & interactive

```css
--active: #007AFF                 /* Apple system blue — primary actions */
--active-light: rgba(0,122,255,0.08)
--btn-hover-blue: #0066DD
```

### 1.3 Status / alert

```css
--late: #FF9500                   /* orange — late submissions */
--priority: #FF3B30               /* bright red — urgent */
--priority-light: rgba(255,59,48,0.08)
--danger: #c62828                 /* dark red — destructive */
--toast-error: #c0392b
--toast-success: #1a7a34
```

### 1.4 Badge / semantic

```css
--iep-badge: #e08600              /* IEP indicator — orange */
--mod-badge: #5856d6              /* MOD indicator — purple */
```

### 1.5 Proficiency level colors — **two scales co-exist**

**Global / semantic scale** (`teacher/styles.css:8–18`) — used everywhere outside the main gradebook grid:

```css
--score-0: #bbb       /* Not Assessed */
--score-1: #d32f2f    /* Emerging — red */
--score-2: #c07a00    /* Developing — orange */
--score-3: #2e7d32    /* Proficient — green */
--score-4: #1565c0    /* Extending — blue */

/* Paired bg/text for pills */
--score-1-bg: #FEE2E2; --score-1-text: #991B1B
--score-2-bg: #FEF3C7; --score-2-text: #92400E
--score-3-bg: #BBF7D0; --score-3-text: #166534
--score-4-bg: #DBEAFE; --score-4-text: #1E40AF
```

**Earthy scale, scoped to `.gb-grid`** (`teacher/gradebook.css:362–377`) — used inside the gradebook only:

```css
--score-1: #C2584A    /* warm rust */
--score-2: #B8893A    /* warm brown */
--score-3: #548C5A    /* sage green */
--score-4: #3E7D91    /* teal */

--score-1-bg: #F6E2DE; --score-1-text: #8A3D33
--score-2-bg: #F3ECDA; --score-2-text: #7A5A1E
--score-3-bg: #DDE9DE; --score-3-text: #365C3A
--score-4-bg: #DAEAEE; --score-4-text: #2A5868
```

The gradebook intentionally uses warmer, quieter tones so a grid of 30×15 cells doesn't overwhelm. The semantic scale appears on dashboards, reports, pills elsewhere.

### 1.6 Observation sentiment (`teacher/reports.css:778–788`)

```css
/* Strength + Growth active state */
background: rgba(52,199,89,0.14)
color: rgb(36,138,61)             /* green */

/* Concern active state */
background: rgba(255,149,0,0.12)
color: rgb(175,82,0)               /* warm orange */
```

### 1.7 Accent / decorative

```css
--focus-banner-bg: #e8f0fe
--focus-banner-border: #c4d7f2
--section-hover: #f0ede4
--accent-purple: #7b1fa2
--accent-purple-light: rgba(142,68,173,0.10)
--report-block-bg: #f5f3ef
--report-callout-bg: #fef9f0
--report-callout-border: #e8d5a8
--toolbar-bg-start: #F6F6F6
--toolbar-bg-end: #ECECEC
```

### 1.8 Dividers / overlays (opacity scale)

```css
--overlay-hover: rgba(0,0,0,0.04)
--overlay-pressed: rgba(0,0,0,0.08)
--divider-subtle: rgba(0,0,0,0.06)
--divider-medium: rgba(0,0,0,0.09)
--divider-strong: rgba(0,0,0,0.12)
--divider-heavy: rgba(0,0,0,0.14)
```

### 1.9 Dark mode

Full palette inversion defined under `@media (prefers-color-scheme: dark)` at `teacher/styles.css:1262–1321`. All tokens above have dark-mode equivalents. **Dark mode is fully supported and auto-detected.**

---

## 2. Typography

```css
--font-base: -apple-system, BlinkMacSystemFont, 'SF Pro Text',
             'Helvetica Neue', system-ui, sans-serif
/* monospace inline: 'SF Mono', ui-monospace, 'Menlo', monospace */
```

### 2.1 Type scale (Apple HIG-aligned)

```css
--text-2xs: 0.625rem    /* 10px */
--text-xs:  0.6875rem   /* 11px — Apple minimum */
--text-sm:  0.75rem     /* 12px — labels, badges */
--text-base:0.8125rem   /* 13px — standard UI */
--text-md:  0.875rem    /* 14px — card titles */
--text-lg:  1rem        /* 16px — section headings */
--text-xl:  1.125rem    /* 18px — page headings */
--text-2xl: 1.5rem      /* 24px — large display */
--text-3xl: 1.75rem     /* 28px — hero stat */
--text-4xl: 2.25rem     /* 36px — jumbo */
```

### 2.2 Weights in use
400 body · 500 UI labels · 600 active/titles · 700 headings · 800 snapshot-item values.

### 2.3 Line heights
`1` compact · `1.1` tight · `1.2` normal UI · `1.35` evidence · `1.4` mobile body · `1.5` body/card.

### 2.4 Letter spacing

```css
--tracking-tight: -0.01em   /* header compression */
--tracking-normal: 0
--tracking-wide: 0.04em     /* labels, monospace */
```

---

## 3. Spacing & layout

### 3.1 Spacing scale (4px grid)

```css
--space-0:0 --space-1:4 --space-2:8 --space-3:12 --space-4:16
--space-5:20 --space-6:24 --space-8:32 --space-10:40 --space-12:48
```

### 3.2 Border radius

```css
--radius-xs: 4px      /* tight / small controls */
--radius-sm: 8px      /* buttons, inputs */
--radius:    12px     /* cards, popovers */
--radius-lg: 16px     /* modals, auth card */
--radius-xl: 20px     /* pills, large badges */
```

### 3.3 Shadows

```css
--shadow-sm: 0 1px 3px rgba(0,0,0,.08), 0 1px 2px rgba(0,0,0,.04)
--shadow-md: 0 4px 12px rgba(0,0,0,.08), 0 2px 4px rgba(0,0,0,.04)
--shadow-lg: 0 8px 32px rgba(0,0,0,.12), 0 4px 8px rgba(0,0,0,.04)
```

Dark mode variants multiply alpha for visibility.

### 3.4 Layout dimensions

```css
--dock-h: 52px        /* top toolbar */
--toolbar-h: 52px     /* secondary toolbar */
--sidebar-w: 240px    /* desktop sidebar */

/* Responsive */
@media (max-width: 1200px) { --sidebar-w: 180px; }
@media (max-width: 1024px) { sidebar hidden (width: 0); }
```

Mobile tab bar: `49px + env(safe-area-inset-bottom)`.

---

## 4. Components

### 4.1 Buttons (`teacher/styles.css:805–821`)

Base: `padding 8px 16px · min-height 32px (44px mobile) · radius var(--radius-sm) · font-weight 500–600 · transition all 0.15s`.

Variants:
- `.btn-primary` — background `var(--active)`, white text, hover `filter: brightness(0.92)`
- `.btn-ghost` — background `var(--divider-subtle)`, hover `var(--overlay-hover)`
- `.btn-danger` — no background, text `var(--priority)`, hover brightness

Special: `.gb-add-btn`, `.obs-capture-add`, `.auth-submit` — variations on primary.

### 4.2 Inputs

Auth input: `padding 10px 14px · radius 10px · border 1px solid var(--border)`. Focus: `border var(--active); box-shadow 0 0 0 3px rgba(0,122,255,0.12)`.

Observation capture input: `padding 8px 12px · radius 8px`; background transparent → surface on focus.

Search inputs: `padding 5px 12px 5px 28px` (icon left); expand on focus (130 → 180/200px).

### 4.3 Cards (`teacher/styles.css:474–482`)

`background var(--surface) · border 1px solid var(--border) · radius 12px`. Typical padding 10–14px. Title: `var(--text-md)` weight 600.

Observation card: `padding 10px 14px · border-left 3px solid var(--border)` (left accent bar). Hover: subtle shadow.

### 4.4 Modal (`teacher/styles.css:963+`)

`padding 24px · max-width 400px · width 90% · radius var(--radius-lg)`, shadow `var(--shadow-lg)`. Overlay `rgba(0,0,0,0.5)`. Z-index 10000.

### 4.5 Pills / badges (`teacher/observations.css:76–82`)

`padding 2px 7px 2px 5px · radius 20px · background var(--divider-subtle) · color var(--text-2) · font-size var(--text-sm)`.

Notification badge: inline-flex `min-width 16px · height 16px · padding 0 4px · background var(--active)` (white text, radius 8px).

Filter pills: `padding 2px 6px 2px 5px · font-size var(--text-xs) · background rgba(0,122,255,0.08)` hover to `0.14`.

### 4.6 Segmented control (iOS-style, `teacher/gradebook.css:41–54`)

Container `gap 2px · background var(--divider-subtle) · radius 8px · padding 2px`.
Inactive: transparent, weight 500, color `var(--text-2)`.
Active: `background var(--surface) · weight 600 · shadow 0 1px 3px rgba(0,0,0,0.1)`.

### 4.7 Toasts (`teacher/styles.css:1091–1110`)

Animation `toast-in 0.2s ease-out`:
```css
@keyframes toast-in {
  from { transform: translateY(12px); opacity: 0; }
  to   { transform: translateY(0);    opacity: 1; }
}
```
Success `background var(--toast-success)`; error `background var(--toast-error)`.

---

## 5. Navigation

- **Desktop sidebar**: 240px wide, collapses at 1200px (180px) and 1024px (hidden). Course switcher at top.
- **Top dock**: 52px, background `var(--surface)`, bottom border `var(--divider-subtle)`, padding `0 16px`. Left / center / right flex groups. User menu at right.
- **Mobile tab bar**: 49px + safe-area-inset-bottom. Glass background (`surface-glass` + 20px blur). Five tabs (Grade / Observe / Students / Reports / Menu). Icon 25×25px, label 11px. Active color shifts to `var(--active)`.
- **Mobile screen stack**: iOS push/pop animations — `transform: translateX(100%)`, cubic-bezier `(0.2, 0.9, 0.3, 1)`, 0.35s.

---

## 6. Icons

**Inline SVG, hand-embedded.** No icon library. Sprite/data-URI patterns for small decorative icons (dropdown arrows, search). Typical sizes 14–25px. `pointer-events: none` on decorative SVGs.

---

## 7. Breakpoints

```css
@media (max-width: 1200px) { /* sidebar collapses to 180px */ }
@media (max-width: 1024px) { /* sidebar hidden */ }
@media (max-width: 768px)  { /* mobile-optimized */ }
@media (max-width: 480px)  { /* ultra-compact */ }
```

Mobile CSS scoped under `body.mobile-mode` (`teacher-mobile/styles.css`).

---

## 8. Animations & motion

```css
--ease-out:    cubic-bezier(0.25, 0.1, 0.25, 1.0)
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1)
--duration-micro:  0.15s
--duration-fast:   0.25s
--duration-normal: 0.35s
```

Keyframes defined: `toast-in`, `fade-in`, `slide-up`, `obsSlideIn`.

**Reduced motion is respected.** `@media (prefers-reduced-motion: reduce)` at `teacher/styles.css:1326–1332` and `teacher-mobile/styles.css:155–166` sets all durations to 0.01ms.

---

## 9. Accessibility

- **`:focus-visible`**: `outline: 2px solid var(--active); outline-offset: 2px`. Mobile: 3px outline.
- **`:focus:not(:focus-visible)`**: `outline: none` (hides default on touch).
- **Skip links** (`teacher/styles.css:161–168`): hidden until focus, then `top: 8px`, primary background.
- **Z-index system**: layered 50 → 9900, documented in the CSS.
- **ARIA**: `role="tab"` + `aria-selected`, `role="alert"` / `role="status"` with live regions, `aria-label` on icon buttons.
- **Skip links + reduced motion + focus management** indicates WCAG AA is being targeted in spirit even without a formal audit.

---

## 10. Distinctive traits

- **Glassmorphism** on mobile tab bar (`surface-glass` + 20px backdrop-filter blur).
- **Apple HIG alignment** throughout: system font, 11px minimum, 44px touch targets, segmented controls, safe-area insets.
- **Empty states** are icon + text only (no illustrations). `.empty-state-icon: font-size var(--text-4xl); opacity 0.5`.
- **Print stylesheet** exists: `@media print` keeps thead on each page, hides sidebar, avoids row breaks.
- **Vanilla CSS with custom properties** — no Tailwind, no PostCSS, no Sass. Build is `cp` to dist/ (`scripts/build.sh`).
- **No external dependencies** for typography (system fonts) or icons (inline SVG).

---

## Implication for the rebuild

The design system is **mature, cohesive, and Apple HIG-aligned.** The rebuild does not touch visual language. New UI (Category management, rubric weights + level values, `grading_system` toggle, offline badge + banner, Welcome Class banner, session-expired draft-preservation modal) **must use existing tokens and component patterns.** Do not introduce new component styles when an existing one fits.

Design questions that remain open are strictly about **how the new elements slot into the existing system**, not about the system itself. See `INSTRUCTIONS.md` §12 for the final content strings and placement, and `TASKS.md` for the Claude Code implementation queue.
