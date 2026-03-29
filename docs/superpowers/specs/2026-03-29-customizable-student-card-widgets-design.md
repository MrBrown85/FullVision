# Customizable Student Card Widgets

**Date:** 2026-03-29
**Scope:** Teacher mobile app — student card stack view

## Problem

The student card on iPhone 14 has ~150pt of dead space between the observation snippet and action buttons. The card shows a fixed layout (hero, section bars, observation, actions) with no way to surface the rich questionnaire, disposition, and reflection data available in the system. Teachers have no control over what the card shows.

## Solution

A widget system where every card element is a toggleable, reorderable block. Teachers long-press the card to enter edit mode and customize which widgets appear and in what order. Configuration is global (applies across all courses) and persisted in localStorage.

## Design Philosophy

The card answers one question: **"Who is this student right now?"**

- Defaults are minimal and beautiful: 4 widgets (hero, section bars, observation, actions)
- All other widgets are off by default, discoverable through long-press customization
- Each widget has a visually distinct treatment — no two look alike
- Widgets that have no data for a given student render at zero height
- The card does not scroll with defaults. When additional widgets are enabled, the middle zone scrolls while hero and actions stay pinned

## Data Model

### Widget Configuration

Stored in localStorage under key `m-card-widgets`:

```javascript
{
  order: ['hero', 'sectionBars', 'completion', 'obsSnippet', 'actions'],
  disabled: ['missingWork', 'growth', 'obsSummary', 'flagStatus', 'reflection',
             'dispositions', 'traits', 'concerns', 'workHabits', 'growthAreas', 'narrative']
}
```

- `order` — Array of enabled widget keys, in display order
- `disabled` — Array of disabled widget keys (not shown on card)
- When a new widget is added to the registry in a future release, it appears at the end of `disabled` automatically (absent keys default to disabled, appended to bottom)

### Default State

On first load (no localStorage entry), the config is:

```javascript
{
  order: ['hero', 'sectionBars', 'obsSnippet', 'actions'],
  disabled: ['completion', 'missingWork', 'growth', 'obsSummary', 'flagStatus',
             'reflection', 'dispositions', 'traits', 'concerns', 'workHabits',
             'growthAreas', 'narrative']
}
```

## Widget Registry

| # | Key | Label | Default | Empty Behaviour |
|---|-----|-------|---------|-----------------|
| 0 | `hero` | Name & Proficiency | on | Fallback: always shows name even if toggled off |
| 1 | `sectionBars` | Section Progress | on | Hidden if no sections |
| 2 | `completion` | Completion | off | Shows "—" if no assessments |
| 3 | `missingWork` | Missing Work | off | Hidden if 0 missing |
| 4 | `growth` | Growth Journey | off | Hidden if no scored work |
| 5 | `obsSnippet` | Latest Observation | on | "No observations yet" italic |
| 6 | `obsSummary` | Observation Insights | off | Hidden if 0 observations |
| 7 | `flagStatus` | Flag | off | Hidden if not flagged |
| 8 | `reflection` | Student Voice | off | Hidden if no reflections/goals |
| 9 | `dispositions` | Learner Dispositions | off | Hidden if no term rating |
| 10 | `traits` | Character Strengths | off | Hidden if no positive traits |
| 11 | `concerns` | Concerns | off | Hidden if no concerns |
| 12 | `workHabits` | Work Habits & Participation | off | Hidden if no term rating |
| 13 | `growthAreas` | Growth Areas | off | Hidden if none set |
| 14 | `narrative` | Teacher Narrative | off | Hidden if no narrative |
| 15 | `actions` | Action Buttons | on | Always renders |

## Widget Visual Treatments

Each widget uses a distinct visual language so no two can be confused at a glance.

### `hero` — Identity block (pinned top)

Avatar (64px circle, color-coded initials), name (20px 700-weight), pronouns (13px muted), IEP/MOD badges. Proficiency score right-aligned: 36px 800-weight number colored by level, proficiency label underneath in 11px uppercase.

When `flagStatus` is enabled, an orange flag icon (16px) renders inside the hero between badges and proficiency. `flagStatus` augments the hero rather than adding its own row.

**Safety rail:** If hero is toggled off, a minimal fallback line still renders (avatar 32px + name 15px, no proficiency) so the teacher always knows which student they're looking at.

### `sectionBars` — Horizontal fill bars

Colored section dot (8px), section name (12px muted), 60px fill bar with proficiency-colored fill. One row per curriculum section. Existing treatment, unchanged.

### `completion` — Arc ring metric tile

Mini arc ring (28px diameter) with completion percentage inside in bold (14px 700-weight). "Complete" label below in 11px uppercase muted. Left-aligned with subtle `var(--bg)` rounded background (10px radius, 10px padding).

Color thresholds: green (>=80%), amber (>=50%), red (<50%).

When `missingWork` is also enabled and adjacent, they share a row as a 2-up layout (flex, gap:10px, each flex:1). When alone, single tile left-aligned.

### `missingWork` — Alert metric tile

Bold count number in `var(--priority)` red (18px 800-weight). "Missing" label below in 11px uppercase. Same tile treatment as completion (rounded `var(--bg)` background).

Only renders when missing count > 0. When count is 0, zero height.

### `growth` — Journey pill

Rounded pill (full-width, `var(--bg)` background, 10px radius, 10px 14px padding). Shows the learning arc in words using proficiency labels from first scored work to most recent: "Emerging -> Developing".

Arrow colored: green (`var(--score-3)`) if improving, red (`var(--score-1)`) if declining, muted (`var(--text-3)`) if flat.

Single data point: "Developing -- 1 assessment". No data: hidden (zero height).

### `obsSnippet` — Story block

Rounded `var(--bg)` box (10px radius, 10px 12px padding). Observation text in 13px, relative timestamp in 12px muted preceding the text. Truncated at 80 chars with ellipsis. Empty state: "No observations yet" in 13px italic muted.

Existing treatment, unchanged.

### `obsSummary` — Context sentence

Single line of 13px muted text. Derived by counting observation `context` values and finding the most frequent: "5 observations -- strongest in small-group".

If all contexts are equal: "5 observations across settings". No dots, no charts — just a readable sentence. Hidden if zero observations.

### `flagStatus` — Inline hero badge

Not a standalone row. Renders a 16px orange flag icon inside the hero row, positioned between badges and proficiency score. Zero height as a widget — it augments `hero`.

**Ordering note:** `flagStatus` position in the `order` array is ignored — it always renders inside hero when enabled. In the editor, it appears in the toggle list but has no drag handle (cannot be reordered, only toggled).

Hidden when student is not flagged.

### `reflection` — Student voice block

Left border accent: 3px solid `var(--active)` on the left edge, 12px left padding. Student's own words in 13px italic. "Student voice" label above in 11px uppercase muted with target icon inline.

Truncated at 60 chars with ellipsis. Sources: `getReflections(cid)` first, falls back to `getGoals(cid)`. Hidden if neither exists.

### `dispositions` — Petal chart + summary

A single tiny radar/petal shape (48px x 48px SVG) with 6 axes representing the disposition dimensions, filled proportionally to ratings (1-4 scale). Next to it (flex row), the two strongest dimensions as text in 13px: "Strong in Collaboration, Curiosity".

This is the only widget that uses a geometric shape — visually distinct from all other widgets.

Hidden if no term rating exists for the student.

Dimensions: Engagement, Collaboration, Self-Regulation, Resilience, Curiosity, Respect.

### `traits` — Blue chip row

Small rounded chips (11px 500-weight, 6px 10px padding, 14px border-radius). Background: `var(--active-light)`, text: `var(--active)`. Shows up to 4 trait labels, "+N more" overflow chip in muted style.

No header label — content is self-describing ("leader", "empathetic", "persistent").

Hidden if no positive social traits.

### `concerns` — Red alert chips

Same chip layout as traits. Background: `var(--priority-light)`, text: `var(--priority)`. Sensitive data — off by default, teacher deliberately opts in.

Hidden if no concern traits.

### `workHabits` — Dual segmented bar

Always renders as a 2-up row: Work Habits on left, Participation on right (flex, gap:10px, each flex:1).

Each shows a segmented bar: 4 small rectangles (pips), filled up to the rating level. Filled pips use proficiency color, unfilled use `var(--bg-secondary)`. Label underneath in 11px uppercase muted.

Visually distinct from section bars (segmented pips vs continuous fill) and from completion (pips vs arc ring).

Hidden if no term rating exists.

### `growthAreas` — Dot-prefixed tag chips

"Growth Areas" label in 11px uppercase muted above. Curriculum tag names as chips with neutral `var(--bg)` background, each prefixed with its section color dot (6px circle). 11px 500-weight text.

Max 3 shown, "+N more" overflow. Hidden if no growth areas set.

### `narrative` — Shadowed excerpt card

Rounded card (12px radius) with subtle box-shadow (`0 1px 4px rgba(0,0,0,0.06)`). "Term Report" label in 11px uppercase muted above. First ~80 chars of teacher narrative, HTML stripped, in 13px. Truncated with ellipsis.

This is the only widget with a shadow — signals it's a formal document excerpt, distinct from the observation block.

Hidden if no narrative exists.

### `actions` — Button row (pinned bottom)

Observe + View Profile buttons. Slimmed: 8px vertical padding, 13px font, 12px border-radius, 600-weight. Observe: `var(--active-light)` background, `var(--active)` text. View Profile: `var(--bg-secondary)` background, `var(--text)` text.

## Visual Distinctness Matrix

| Visual Language | Widget |
|-----------------|--------|
| Horizontal fill bars | `sectionBars` |
| Arc ring | `completion` |
| Bold alert number | `missingWork` |
| Text pill with arrow | `growth` |
| Rounded background box | `obsSnippet` |
| Plain sentence | `obsSummary` |
| Inline icon (no row) | `flagStatus` |
| Left-border accent + italic | `reflection` |
| Radar/petal SVG shape | `dispositions` |
| Blue chips | `traits` |
| Red chips | `concerns` |
| Segmented pip bar | `workHabits` |
| Dot-prefixed neutral chips | `growthAreas` |
| Shadowed card | `narrative` |

## Card Layout

### Structure

```
┌────────────────────────────────────┐
│  hero (pinned, never scrolls)      │
├────────────────────────────────────┤
│                                    │
│  widget zone (scrollable when      │
│  content exceeds available space)  │
│                                    │
│  Renders enabled widgets from      │
│  config.order, skipping hero       │
│  and actions                       │
│                                    │
├────────────────────────────────────┤
│  actions (pinned, never scrolls)   │
└────────────────────────────────────┘
```

### CSS approach

The `.m-scard` container becomes a flex column with hero and actions as fixed children. The middle zone is a `div.m-scard-widgets` with `overflow-y:auto` and `flex:1`. With default widgets (section bars + observation), this zone does not scroll. With additional widgets enabled, it scrolls naturally.

Scroll indicator: a subtle 8px gradient fade at the bottom of the widget zone when scrollable, so the teacher knows there's more below.

### 2-up pairing logic

When both `completion` and `missingWork` are enabled, they always render as a single 2-up flex row regardless of their individual positions in the order array. The pair renders at the position of whichever comes first in the order. In the editor, they appear as separate toggles but reorder as a unit when both are enabled.

`workHabits` is always internally 2-up (Work Habits + Participation are not independently toggleable).

## Edit Mode UX

### Activation

Long-press (500ms) on the card triggers edit mode. The card dims slightly (opacity:0.85), and a bottom sheet slides up with the widget editor.

### Editor Sheet

The sheet shows all 16 widgets in their current order, with enabled widgets first, disabled widgets in a "More Widgets" section below a divider.

Each row in the editor:

```
┌──────────────────────────────────────┐
│  ☰  [icon]  Section Progress    [●] │
│  drag       label               toggle
└──────────────────────────────────────┘
```

- **Drag handle** (hamburger icon, left) — touch-drag to reorder
- **Widget icon** — small visual hint (dot for sections, ring for completion, etc.)
- **Label** — human-readable name
- **Toggle switch** (right) — on/off, iOS-style

### Reordering

Drag-and-drop within the enabled list reorders widgets. Toggling a widget on moves it from "More Widgets" to the bottom of the enabled list. Toggling off moves it to "More Widgets".

Implementation: touch-based drag using `touchstart`/`touchmove`/`touchend`. The dragged row gets `position:fixed`, other rows animate to fill the gap (200ms ease). No external library — lightweight inline implementation matching existing MCardStack touch handling patterns.

### Persistence

On every change (toggle or reorder), the config is immediately written to localStorage key `m-card-widgets`. The card re-renders live behind the sheet so the teacher sees changes in real-time.

### Dismissal

- Tap "Done" button at top of sheet
- Swipe sheet down
- Tap outside the sheet

All dismiss the editor. No explicit save — changes are already persisted.

### Reset

"Reset to Defaults" link at the bottom of the editor sheet. Confirms with a small inline prompt ("Reset card layout?") before clearing localStorage and restoring defaults.

## Safety Rails

1. **Hero fallback:** If `hero` is disabled, a minimal 32px avatar + 15px name line always renders so the teacher knows which student they're viewing
2. **Empty widgets:** Widgets with no data render at zero height — no "No data" placeholders cluttering the card
3. **Scroll indicator:** Gradient fade at bottom of widget zone when content overflows
4. **Sensitive data:** `concerns` is off by default — teacher must deliberately enable it
5. **Future-proof:** Unknown widget keys in localStorage are ignored. New widgets added in future releases appear in "More Widgets" automatically

## Files to Modify

| File | Changes |
|------|---------|
| `teacher-mobile/tab-students.js` | Refactor `_renderStudentCard` into widget system, add new widget render functions, add edit mode logic |
| `teacher-mobile/styles.css` | Widget-specific styles, edit mode styles, scroll indicator, editor sheet |
| `teacher-mobile/shell.js` | Long-press event handler for edit mode activation |
| `shared/data.js` | Possibly add `getCardWidgetConfig()` / `saveCardWidgetConfig()` helpers |
| `shared/constants.js` | Widget registry definition (keys, labels, defaults, order) |

## Out of Scope

- Per-course widget configuration (global only)
- Widget sizing options (all widgets have fixed, designed sizes)
- Direct navigation to Reports page from widgets
- Editing questionnaire data from mobile
- Attendance widget (no input data layer)
