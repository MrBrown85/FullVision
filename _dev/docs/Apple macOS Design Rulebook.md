# Apple macOS Design Rulebook

## Comprehensive Reference for macOS and Apple Design Philosophy

---

## Table of Contents

1. [Core Design Principles](#core-design-principles)
2. [Typography System](#typography-system)
3. [Color and Dark Mode](#color-and-dark-mode)
4. [Layout and Spacing](#layout-and-spacing)
5. [Controls and UI Components](#controls-and-ui-components)
6. [SF Symbols Iconography](#sf-symbols-iconography)
7. [Animation and Motion](#animation-and-motion)
8. [Materials and Depth](#materials-and-depth)
9. [Information Architecture](#information-architecture)
10. [Empty States, Onboarding, and Error States](#empty-states-onboarding-and-error-states)
11. [macOS-Specific Patterns](#macos-specific-patterns)
12. [Data Tables, Lists, and Grid Views](#data-tables-lists-and-grid-views)
13. [Accessibility](#accessibility)
14. [Design Evolution](#design-evolution)
15. [Consistency Across Apple Apps](#consistency-across-apple-apps)

---

## Core Design Principles

### The Three Pillars

Apple's Human Interface Guidelines (HIG) are built on three foundational principles:

#### 1. **Clarity**

- Text must be readable at any size
- Icons must be precise and lucid
- Adornments should be kept to a minimum
- Every visual element must convey meaning
- If a button doesn't look like a button, it has failed the clarity test
- Focus is on functionality, not decoration

#### 2. **Deference**

- UI elements should not distract users from the essential content
- Design should fluidly guide the user's attention without overshadowing content
- Content takes precedence over chrome
- Interface should know when to fade into the background

#### 3. **Depth**

- Use layers, shadows, and motion to create clear hierarchy
- Visual layering helps users understand where they are and how they got there
- Smooth transitions and logical hierarchy create spatial depth
- Depth makes navigation intuitive

### Apple's Design Philosophy Framework

- **Inputs**: How humans interact with devices—mouse, keyboard, gestures, haptics, voice
- **Foundations**: Visual and sensory core of apps—color palette, typography, spacing
- **Integration**: How design adapts across different contexts and devices

---

## Typography System

### Font Stack

```
Primary Font: SF Pro (San Francisco Pro)
Fallback: Helvetica Neue, Helvetica, Arial, sans-serif
Font Stack: "SF Pro Display", "SF Pro Icons", "Helvetica Neue", Helvetica, Arial, sans-serif
```

### SF Pro Variants

| Variant            | Use Case                                 | Weights                        |
| ------------------ | ---------------------------------------- | ------------------------------ |
| **SF Pro Display** | Sizes 20pt and above                     | 9 weights: Ultralight to Black |
| **SF Pro Text**    | Sizes below 20pt                         | 9 weights: Ultralight to Black |
| **SF Pro Rounded** | Friendly, approachable interfaces        | 9 weights: Ultralight to Black |
| **SF Mono**        | Code, technical content, monospace needs | Variable weights               |

### Font Weight System

SF Pro includes **9 weight variants**:

- Ultralight
- Thin
- Light
- Regular
- Medium
- Semibold
- Bold
- Heavy
- Black

Each weight has corresponding italic variants.

### Optical Sizing

- SF Pro is a variable font with dynamic optical sizes
- **SF Text** (below 20pt): Optimized for small sizes with tighter tracking
- **SF Display** (20pt and above): Optimized for larger sizes with refined letterforms
- Size-specific outlines ensure optimal legibility at every point size and screen resolution
- Variable widths work in conjunction with weights and grades

### Font Size Specifications (iOS/macOS Standard)

| Style           | Typical Size | Weight   | Use                    |
| --------------- | ------------ | -------- | ---------------------- |
| **Large Title** | 34pt         | Regular  | Main screen title      |
| **Title 1**     | 28pt         | Regular  | Section headers        |
| **Title 2**     | 22pt         | Regular  | Subsection headers     |
| **Title 3**     | 20pt         | Regular  | Card titles            |
| **Headline**    | 17pt         | Semibold | Bold text emphasis     |
| **Body**        | 17pt         | Regular  | Primary reading text   |
| **Callout**     | 16pt         | Regular  | Additional information |
| **Subheadline** | 15pt         | Regular  | Secondary text         |
| **Footnote**    | 13pt         | Regular  | Small details          |
| **Caption 1**   | 12pt         | Regular  | Captions, labels       |
| **Caption 2**   | 11pt         | Regular  | Secondary captions     |

**Minimum Font Size**: 11pt for iOS and iPadOS apps

### Dynamic Type Support

- Apple recommends incorporating Dynamic Type text styles
- Allows users to choose preferred text size on devices
- Spans from xSmall to xxxLarge standard sizes
- Accessibility sizes labeled AX1 through AX5 for those requiring even larger text
- Text styles automatically scale while maintaining visual hierarchy

### Line Height

- Text line height should maintain readability (typically 1.2 to 1.5× font size)
- Adequate spacing prevents text from appearing cramped
- Proportional to font size for consistency

---

## Color and Dark Mode

### System Color Architecture

Apple has engineered UIKit and AppKit around **semantic and dynamic colors** that automatically adapt to Light and Dark modes.

#### Label Colors (Text)

Use system-provided label colors for text content:

- **Primary Label Color**: Main text (high contrast)
- **Secondary Label Color**: Supporting text
- **Tertiary Label Color**: Placeholder or disabled text
- **Quaternary Label Color**: Very subtle text

These adapt automatically to Light and Dark modes.

#### Background Colors

Two sets of dynamic background colors:

**System Background Colors**:

- Primary (most prominent)
- Secondary (secondary UI)
- Tertiary (tertiary UI elements)

**Grouped Background Colors**:

- Primary (grouped content background)
- Secondary (secondary grouped content)
- Tertiary (tertiary grouped content)

### Text Contrast Ratios

- **Minimum Text Contrast Ratio**: 4.5:1 between foreground text and background
- Based on W3C's Web Content Accessibility Guidelines (WCAG)
- Small or light-weight text requires greater contrast to maintain legibility
- **Non-Text UI Elements**: Minimum 3:1 contrast ratio
- Both Light and Dark modes must meet contrast minimums

### Vibrancy Effects

Apple introduced vibrancy in iOS 13, continued in macOS:

**4 Blur Effect Types**:

- Thick
- Regular
- Thin
- Ultrathin

**Vibrancy Effect Types**:

- 4 vibrancy effects for text (Labels)
- 3 vibrancy effects for overlay (Fills)
- 1 specific vibrancy effect for separators

**Effect**: Vibrancy pulls color forward from behind materials to enhance depth sense

### Accent Colors

- System automatically picks best accent colors to maximize contrast with dark mode
- Respects multiple layers of interface shown onscreen
- Should maintain semantic meaning across color modes

### Dark Mode Strategy

- **Dark Color Palettes**: Provide comfortable viewing in low-light environments
- **Elevated Colors**: Stand out against dark backgrounds
- **Combined with Vibrancy**: Keeps text legible and provides separation between apps
- **Automatic Adaptation**: Apps using semantic colors get Dark Mode support automatically

### Color Specifications for Implementation

When implementing colors, use semantic names rather than absolute RGB values:

- `systemRed`, `systemGreen`, `systemBlue`, `systemOrange`, `systemYellow`, `systemPink`, `systemPurple`, `systemTeal`, `systemIndigo`
- Colors automatically adapt to Light/Dark modes
- Avoid hardcoding hex color values for system colors

---

## Layout and Spacing

### 8-Point Grid System

Apple's design approach uses an **8-point baseline grid** for spacing consistency.

#### Core Principle

All spacing, padding, and margins should be multiples of 8 pixels:

```
8, 16, 24, 32, 40, 48, 56, 64, 72, 80, 88, 96...
```

#### Why 8pt?

- Divides neatly into common screen sizes
- Works well across devices with different pixel densities
- Flexible enough for tiny gaps and large whitespace without breaking rhythm
- Recommended by both Apple and Google
- Creates visual harmony and alignment

#### Spacing Values

| Value     | Use Case                                                |
| --------- | ------------------------------------------------------- |
| **8px**   | Minimal spacing, icon-text gaps, sub-element padding    |
| **16px**  | Standard padding, component spacing, inter-element gaps |
| **24px**  | Section spacing, large padding, container margins       |
| **32px**  | Significant spacing, section separation                 |
| **40px+** | Major layout divisions, page margins                    |

### Content Margins

- **Typical Grid Margins**: 16px or 20px on mobile
- Creates breathing room and prevents cramped layouts
- Maintains balance between content and screen edges

### Internal ≤ External Rule

- Space **within** elements (padding) ≤ Space **around** them (margins)
- External space should equal or exceed internal space for clear distinction
- Aids in group cohesion and element separation

### Visual Density

The 8pt grid provides more space than Android's Material Design 4pt grid, suitable for:

- iOS designs
- Web applications seeking clarity
- macOS applications where readability is paramount
- Contrast with Android's more tightly-packed density expectations

### Layout Breakpoints (Desktop)

- **Desktop**: max-width 1068px
  - Font size: 40px
  - Width: 692px

- **Tablet**: max-width 735px
  - Font size: 32px
  - Width: 87.5%
  - Max width: 330px

### Responsive Spacing

- **Desktop**: 92px top margin, 140px bottom margin
- **Tablet**: 90px top margin, 120px bottom margin
- **Mobile**: 45px top margin, 60px bottom margin

---

## Controls and UI Components

### macOS Control Sizes

AppKit provides three primary control size designations:

| Size        | Use Case                     | Context                      |
| ----------- | ---------------------------- | ---------------------------- |
| **Regular** | Default, standard UI         | Normal application interface |
| **Small**   | Compact interfaces, toolbars | Secondary controls, density  |
| **Mini**    | Very compact, tight spaces   | Minimal interface spaces     |

Note: SwiftUI also provides `.large` size option. Actual rendered size varies by control type and platform context—sizes convey intent rather than fixed pixel values.

### Buttons

- **Minimum Touch Target Size**: 44×44 points (iOS/multi-touch)
- macOS has no strict minimum but should maintain usability
- A button initiates an instantaneous action
- Text should be action-oriented ("Save", "Cancel", "Delete")
- Use verb phrases, not nouns

#### Button Types

- **Primary**: Call-to-action, most important action
- **Secondary**: Alternative actions
- **Tertiary**: Destructive or less common actions

### Touch Target Specifications

- **iOS Minimum**: 44×44 points matches average fingertip width
- Provides comfortable interaction across different hand sizes
- Accounts for accessibility and usability research
- macOS has flexibility but should maintain reasonable sizes

### Toggles

- A toggle lets users choose between opposing states: on/off, enabled/disabled
- Provide clear visual differentiation between states
- Use consistent styling and positioning

### Sliders

- Horizontal track with thumb control between minimum and maximum value
- Provide clear value indication (numbers, labels)
- Support for range sliders when needed

### Pickers

- Display one or more scrollable lists of distinct values
- Enable users to select from defined options
- Can include date pickers, color pickers, dropdown selections

### Segmented Controls

- Linear set of two or more segments, each functioning as a button
- Within the control, all segments are equal width
- Segments can contain text or images
- Available in three sizes: regular, small, and mini
- **iPhone limitation**: Maximum 5 segments per control for optimal usability
- Large size available for segmented controls in toolbars

### Text Fields and Search Fields

- Large size available for text fields in toolbars
- Provide clear placeholder text indicating expected input
- Support autocomplete when applicable

---

## SF Symbols Iconography

### Overview

SF Symbols provides thousands of consistent, highly configurable symbols that integrate seamlessly with the San Francisco system font. Automatically aligns with text in all weights and sizes.

**Current Version**: SF Symbols 7 with 6,900+ symbols

### Weight System

Each symbol is available in **9 weights**:

- Ultralight (thin strokes)
- Thin
- Light
- Regular
- Medium
- Semibold
- Bold
- Heavy
- Black (thick strokes)

**Weight Values**: Range from 22 to 202 (stroke thickness axis)

Each weight corresponds to an equivalent San Francisco system font weight for perfect matching.

### Scales

Each symbol available in **3 scales**:

- **Small**: For compact layouts
- **Medium**: Default, standard size
- **Large**: Prominent display

Scales defined relative to San Francisco cap height.

### Optical Alignment

- Symbols automatically vertically centered to San Francisco's cap-height in all scales and weights
- Automatically optically vertically-centered for baseline alignment
- Simplifies vertical layout between symbols and text
- Automatic for all weight and scale combinations

### Optical Adjustments for Size

Small icons appear too dense and dark with same stroke thickness as larger sizes. SF Symbols includes optical adjustments:

- Small icons get thinner strokes than larger sizes
- Maintains consistent optical appearance across scales
- Called "optical adjustment" in typography

### Horizontal Alignment

- SF Symbols supports negative side margins for optical horizontal alignment
- Helps align stacks of symbols with badges or other width-increasing elements
- Example: Folder symbols with and without badges align horizontally

### Custom Symbols

Designers can create custom SF Symbols matching the system style:

- Created in vector graphics tools (Glyphs app recommended)
- Must follow weight and scale guidelines
- Can be exported and integrated into projects
- Maintain consistency with system symbol aesthetic

### Integration with Text

- Always use scales and weights for consistent alignment
- Symbol weight should match adjacent text weight for visual harmony
- Automatic vertical centering eliminates manual alignment work
- Seamless integration with San Francisco font system

---

## Animation and Motion

### Fundamental Principle

**Motion should reinforce the relationship between actions and results.**

### Spring Animations (Default)

As of **iOS 17**, Apple made spring animation the default animation for the system.

#### Physics-Based Approach

Spring animations are based on real physical behavior:

- Animation starts with any initial velocity
- Maintains natural feeling throughout motion
- Picks up where gesture ends for continuity
- Springs are the only animation type maintaining continuity for both static and velocity-based cases
- Elements settle into place with subtle rebounds suggesting physical behavior

#### Spring Parameters

The spring animation uses physics parameters:

- **Stiffness**: 170 (typical)
- **Damping**: 26 (typical)
- **Mass**: 1.0 (default)

### Timing Curves and Motion

Animations use easing curves controlling acceleration and deceleration:

- Creates sensation of natural movement
- Exponential decay curve gives gradual feeling of coming to rest
- Bounce decreases by adding friction/damping to the spring

#### Standard Timing Functions

- **easeInEaseOut**: Begin slowly, accelerate through middle, slow before completing
- **easeIn**: Slow start, rapid completion
- **easeOut**: Rapid start, slow completion
- **linear**: Constant speed (rarely used, feels mechanical)

#### Core Animation Timing

For CABasicAnimation:

```
timingFunction = CAMediaTimingFunction(name: kCAMediaTimingFunctionEaseInEaseOut)
animation.duration = 0.3 // 300 milliseconds
```

### Animation Duration Guidelines

| Duration      | Use Case                                  |
| ------------- | ----------------------------------------- |
| **200-300ms** | Microinteractions, instant feedback       |
| **300-500ms** | Standard transitions (HIG recommendation) |
| **500-800ms** | Substantial transitions                   |
| **800ms+**    | Only for complex, multi-step animations   |

**HIG Recommendation**: 300ms–500ms with deceleration curves for final states

**Spring Physics Default**: Stiffness 170, Damping 26 for bounce effects

### Motion Design Process

Apple relies heavily on internal prototyping tools:

- Designers build motion sequences before engineering handoff
- Supports rapid adjustments to timing curves, opacity, scale, layering
- Motion adjustments happen during design phase, not post-hoc
- Emphasis on getting motion right during design, not retrofitting

### Do's and Don'ts

#### Do:

- Use spring animations for natural, physical feeling
- Keep animations under 500ms for responsiveness
- Match animation to gesture velocity
- Use motion to clarify relationships and hierarchy
- Provide visual feedback for every action

#### Don't:

- Use overly-long animations (feels sluggish)
- Use linear timing (feels mechanical, unnatural)
- Animate unnecessary elements (distraction)
- Use motion just for decoration (violates deference principle)
- Ignore motion preferences on operating system

---

## Materials and Depth

### What is a Material?

A material is a visual effect creating sense of depth, layering, and hierarchy between foreground and background elements. System supplies several materials for conveying depth without distracting from content.

### Material Types

Apple provides materials ranging from ultra thin to ultra thick:

- **Ultra Thin**: Minimal blur, maximum content visibility
- **Thin**: Light blur effect
- **Regular**: Standard material (default)
- **Thick**: Strong blur, more prominent layering
- **Ultra Thick**: Maximum blur, strong depth separation

### Adaptive Materials

Some materials adapt to appearance mode (Light/Dark), others are always light or always dark:

- **Adaptive**: Change appearance based on system mode
- **Light**: Always appear light
- **Dark**: Always appear dark

### Vibrancy Effects

Vibrancy applies to foreground content on top of a material:

- Pulls color forward from behind material
- Enhances sense of depth
- Works with text, symbols, and fills
- Automatically optimizes contrast

### macOS Big Sur Materials Update

macOS Big Sur (2020) introduced:

- Enhanced materials with richer, more vibrant appearance
- New full-height sidebars using materials
- Progressive blur (gradient blur levels instead of opacity/shadow)
- Visual complexity reduction while maintaining hierarchy depth

### Implementation (macOS)

**NSVisualEffectView** (AppKit):

```swift
let effectView = NSVisualEffectView()
effectView.material = .selection // or .menu, .popover, .sidebar, etc.
effectView.blendingMode = .withinWindow
effectView.state = .active
```

### Design Philosophy

- **Depth, Shading & Translucency**: Create hierarchy
- **Rich & Vibrant Materials**: Enhance visual appeal
- **Minimalist Approach**: Reduce unnecessary visual complexity
- **Content Focus**: Materials support content, never compete with it

---

## Information Architecture

### Progressive Disclosure

Progressive disclosure is a technique to reduce cognitive load by gradually revealing more complex information as users progress through interface.

#### Core Concept

- Present only most relevant data at each step
- Decreases cognitive overload
- Layer content in UI with important information first
- Less important information revealed on interaction

#### Apple's Implementation Example

**iOS Settings**:

- Basic information presented first (e.g., battery health)
- Advanced details tucked away in deeper levels
- Users accessing app-by-app usage navigate to additional layer
- Users get details they need without overwhelming initial view

### Information Hierarchy

Clear information hierarchy is basis of progressive disclosure:

- Determine what information is necessary upfront
- Identify what information can wait
- Create layers with most important first, least important deepest

### Breaking Complex Tasks

- Divide complex tasks into smaller, manageable steps
- Present steps one at a time
- Allow users to complete large tasks without information overwhelm
- Maintain context and progress indication

### Cognitive Load Reduction Strategy

1. **Prioritize Content**: Feature most important information prominently
2. **Progressive Reveal**: Show details on demand
3. **Clear Pathways**: Obvious navigation to deeper levels
4. **Consistent Structure**: Familiar patterns across app
5. **Visual Hierarchy**: Use typography, color, spacing to indicate importance

---

## Empty States, Onboarding, and Error States

### Empty States

An empty state occurs when no data is available or no results from search query.

#### Design Pattern Categories

1. **Onboarding/First Use**: Blank canvas with instructions to get started
2. **No Data State**: System has no data to display
3. **Error State**: User encounters roadblock during interaction

#### Importance

Empty states are "in-between" moments often overlooked but leave significant impressions. They're as important as full content states and drive engagement/delight opportunities.

#### Design Best Practices

**Guideline**: Two parts instruction, one part delight

- Little personality is good but not at cost of clarity
- Don't sacrifice usability for decoration

#### Complete Empty State Components

Combine for optimal UX:

1. **Illustration**: Visual representation of empty state
2. **Headline**: Clear, concise explanation (one line)
3. **Body Text**: Supporting explanation if needed
4. **Call to Action**: Clear next step (button/link)

Users won't have questions about cause and immediately know what to do.

### Onboarding Strategy

#### Show or Tell Format

- **Show**: Demonstrate what screen looks like when filled with content
- **Tell**: Clear instructions on how to create/add content

#### Effective Onboarding

- Sets expectations for upcoming interactions
- Builds confidence in using app
- Shows value proposition
- Provides clear entry point

### Error States

When connection fails or error occurs:

#### Error State Rules

- **Inform**: Communicate error occurred
- **Don't Overwhelm**: Avoid detailed technical explanations
- **Provide Solution**: Give short comment and clear instruction on recovery
- **Enable Retry**: Obvious way to retry/recover

#### Error Message Structure

1. **Headline**: What happened (simple language)
2. **Body**: Brief explanation
3. **Action**: Clear recovery path ("Try Again", "Check Connection")

---

## macOS-Specific Patterns

### NSWindow Configurations

#### Window Structure Components

- **Title Bar**: Window title and controls
- **Content Area**: Main app content
- **Split Views**: Divided content areas

#### Full-Size Content View

Use `.fullSizeContentView` style mask for NSWindow to:

- Extend content into title bar area
- Enable modern macOS design aesthetic
- Support full-height sidebars

Configuration:

```swift
window.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
window.titlebarAppearsTransparent = true
window.displayMode = .automatic
```

### NSToolbar System

#### Toolbar Item Types

- **Standard Items**: Buttons, segmented controls, text fields
- **Search Fields**: Integrated search functionality
- **Tracking Separator**: Aligns with split view dividers

#### Unified Toolbar Style

Large controls in modern macOS:

- Large size buttons and controls
- Cleaner, modern appearance
- Full-height sidebar integration

### Split Views and Sidebars

#### Sidebar Pattern (Mail, Finder)

Modern full-height sidebar:

- Navigation/collection access on left
- Main content on right
- `NSSplitViewController` framework

#### Components

```swift
// Sidebar item
NSSplitViewItem(sidebarWithViewController: sidebarVC)

// Content item
NSSplitViewItem(contentListWithViewController: contentVC)

// Inspector (right panel)
NSSplitViewItem(inspectorWithViewController: inspectorVC)
```

#### Tracking Separator

`NSTrackingSeparatorToolbarItem`:

- Visually aligns toolbar separator with split view divider
- Extends separator line from split view through toolbar
- Usage:

```
NSToolbarItem.Identifier.sidebarTrackingSeparator
```

### Three-Pane Pattern

Supported by NSSplitViewController:

1. **Sidebar** (left): Navigation/collections
2. **Content List** (middle): Item list from selected category
3. **Inspector** (right): Details about selected item

### Window Specifications

#### Corner Radius

- **Standard macOS Window Corner Radius**: 24 points
- Applied by system automatically
- Defines modern macOS aesthetic

#### Drop Shadow

macOS window drop shadow specifications:

- **Blur**: `drop-shadow(0 25px 45px rgba(0,0,0,.40))`
- **Detail Shadow**: `drop-shadow(0 0 2px rgba(0,0,0,.50))`
- **Alternative**: `0 22px 70px 4px rgba(0,0,0,0.56)`

#### Window Border

- **Subtle 1-point border**
- **Light Mode**: #D9D9D9
- **Dark Mode**: #636363

---

## Data Tables, Lists, and Grid Views

### Finder View Modes

Finder supports four customizable view modes:

#### 1. Icon View

- Files and folders displayed as icons
- Customizable: icon size, grid spacing, text size
- Desktop-like interaction metaphor
- Good for visual recognition

#### 2. List View

- Simple table of rows and columns
- Fully sortable by any column
- Display details: size, date modified, kind
- Power-user interface for file management
- Default sorting capability

#### 3. Column View

- Hierarchical display showing folders/files in separate columns
- See files within context of hierarchy
- Navigate through folder structure visually
- Folder levels displayed left to right

#### 4. Gallery View (Newer)

- Thumbnail-based view
- Adjustable thumbnail size
- File names displayed with thumbnails
- Good for visual content (images, videos)

### macOS Table View

**SwiftUI Table View** (introduced WWDC 2021):

- Exclusive to macOS
- Native SwiftUI component
- Replaces NSTableView for modern apps
- Supports sorting, selection, editing

### Customization Options

Each view mode supports:

- Column/attribute selection
- Sorting orders
- Custom metadata display
- Spacing and sizing adjustments
- Hidden files/folders toggle

### Data Display Principles

- **Sortable Columns**: Alphabetical, size, date options
- **Metadata Visibility**: Customizable attribute display
- **Visual Scanning**: Clear visual hierarchy aids finding items
- **Keyboard Navigation**: Full keyboard support for power users
- **Multi-Selection**: Select multiple items for batch operations

---

## Accessibility

### Core Accessibility Principles

Apple treats accessibility as fundamental design principle, not afterthought. Accessible user interfaces empower everyone to have great experience.

### Color and Contrast

#### Text Contrast

- **Minimum Ratio**: 4.5:1 between foreground text and background
- Based on W3C Web Content Accessibility Guidelines (WCAG)
- Small/light-weight text needs greater contrast for legibility

#### UI Element Contrast

- **Non-Text Elements**: Minimum 3:1 contrast ratio
- Buttons, icons, controls need clear contrast

#### Testing

- Use online color calculators based on WCAG formula
- Test both light and dark modes
- Verify at all text sizes

### Dynamic Type (Scalable Text)

Dynamic Type allows users to adjust system-wide text size based on preferences.

#### Text Style Ranges

- **Standard Sizes**: xSmall to xxxLarge (covers most users)
- **Accessibility Sizes**: AX1 through AX5 (for those requiring larger text)
- **Each text style**: Automatically scales across entire range

#### Implementation Requirements

- Use system text styles instead of fixed font sizes
- Example styles: Title1, Body, Caption2
- Text automatically adjusts with system size preference
- Visual hierarchy maintained at all scales

#### Benefits

- Helpful for people with reduced vision
- Allows users to fit more content (smaller text)
- Easier to read for extended periods (larger text)
- Maintains app usability across user needs

### Touch Target Sizes

- **iOS/Touch Minimum**: 44×44 points
- Matches average fingertip width
- Provides comfortable interaction
- Accounts for accessibility needs

### Semantic Colors

Use system semantic colors instead of hardcoded values:

- `systemLabel` (primary text)
- `secondaryLabel` (supporting text)
- `systemBackground` (primary background)
- Automatically adapt to light/dark modes
- Optimize for contrast and usability

### WCAG 2.1 Compliance Alignment

Apple's accessibility approach aligns with WCAG 2.1 standards:

#### WCAG Principles (POUR)

- **Perceivable**: Information must be perceivable (contrast, alternatives)
- **Operable**: Users must be able to operate interface (keyboard, touch)
- **Understandable**: Content and operations must be understandable
- **Robust**: Compatible with current and future technologies

#### WCAG Compliance Levels

- **Level A**: Basic compliance
- **Level AA**: Recommended standard (often organizational goal)
- **Level AAA**: Highest compliance level

#### Apple's Assistive Access

Apple's Assistive Access feature overlaps significantly with WCAG goals, particularly WCAG's Third Principle (Content must be understandable).

---

## Design Evolution

### Skeuomorphism Era (2007-2013)

**Characteristics**:

- Highly textured interfaces
- Leather-stitched looks in apps
- Real-world object metaphors
- Heavy visual styling

**Examples**: iOS iCal with leather texture, Notes with lined paper

**Why**: Helped bridge digital/physical for early users

### Flat Design Transition (2013-2014)

**Catalyst Event**: WWDC 2013 announced iOS 7

- **Death of Skeuomorphism**: Official shift away from textured design
- **iOS 7 Release**: Apple's first flat design system
- **macOS Yosemite (2014)**: Extended flat design to desktop

**Characteristics**:

- Minimalist aesthetic
- No decorative textures
- Flat colors
- Emphasis on content
- Cleaner, modern look

**Design Rationale**:

- Response to design trends
- Desire for cleaner, more modern appearance
- Preparation for responsive design needs
- Focus on content over decoration

### Flat Design Era (2014-2020)

Pure flat design paradigm:

- Continued from iOS 7 through iOS 12
- macOS Yosemite through Catalina
- Minimal depth cues
- Maximum simplicity

### Modern Era: Materials and Depth Return (2020+)

#### macOS Big Sur (2020)

- Reintroduction of depth and materiality
- **Neumorphism Elements**: Soft shadows, highlights
- Blends flat design with subtle skeuomorphic principles
- **New Materials**: Rich, vibrant materials system
- **Progressive Blur**: Gradient blur levels instead of opacity
- **Visual Refinement**: Reduced complexity while adding depth

#### Liquid Glass Era (WWDC 2025)

Most ambitious visual overhaul in over a decade:

- **New Design Language**: Liquid Glass
- **Applies To**:
  - iOS 26
  - iPadOS 26
  - macOS Tahoe
  - watchOS 26
  - tvOS 26
  - visionOS
- **Visual**: Translucent surface reflecting and refracting light
- **Effect**: Sense of depth and dynamism in UI
- **Impact**: Will define Apple ecosystem look for years

#### AppKit Updates (WWDC25)

- Establish common foundation for macOS app look and feel
- Refreshed materials and controls throughout system
- Scroll edge effect for legibility
- Updated appearance and layout of controls
- New design system across visual design, information architecture, core components

### Design Philosophy Evolution

**Pattern**: Apple cycles between:

1. **Ornamentation** (Skeuomorphism) → Too heavy
2. **Minimalism** (Flat) → Too cold
3. **Balanced Materiality** (Current) → Sweet spot

**Current Philosophy**: Use materials and depth strategically to enhance clarity and hierarchy, not decoration.

---

## Consistency Across Apple Apps

### Design Resources

Apple provides official design tools for consistency:

- Design templates
- Icon production templates
- Color guides
- Component libraries
- SF Symbols library (6,900+ symbols)

### SF Symbols System

**Version**: SF Symbols 7
**Symbol Count**: 6,900+ symbols

**Features**:

- Seamless integration with San Francisco
- 9 weights matching text weights
- 3 scales for different contexts
- 100% customizable
- Exportable and editable in vector tools

### Consistent Layout Philosophy

- **Layout Adaptability**: Consistent layout adapting to various contexts makes experience approachable
- **Cross-Device Consistency**: Favorite apps work consistently on Mac, iPhone, iPad
- **Unified Experience**: Interconnected design eliminates juggling multiple apps

### Apple App Consistency Examples

#### Mail

- Sidebar navigation pattern
- Three-pane layout (sidebar, list, content)
- Consistent toolbar with standard controls
- Unified color scheme across macOS and iOS

#### Finder

- Four customizable view modes (Icon, List, Column, Gallery)
- Consistent toolbar patterns
- Standard macOS window styling
- Semantic file organization

#### Notes

- Consistent interface across platforms
- Sidebar-based organization
- Standard document editing patterns
- Integrated search functionality

#### Calendar

- Consistent view modes (Day, Week, Month, Year)
- Standard controls and interactions
- Semantic color coding for calendars
- Unified across iOS and macOS

#### Xcode

- Professional development environment
- Consistent panel-based layout
- Integrated tools within unified window
- Complex information organized hierarchically

### Principles for Consistency

1. **Use System Components**: Build with native controls
2. **Follow HIG**: Adhere to Human Interface Guidelines
3. **Semantic Naming**: Use system colors, styles
4. **Standard Patterns**: Sidebar, toolbar, sheet, alert patterns
5. **Symbol Library**: Use SF Symbols for consistency
6. **Dynamic Adaptation**: Support light/dark modes
7. **Accessibility First**: Implement at design time, not retrofit

### Cross-Device Consistency

Apps designed for consistency work well:

- **iOS**: Optimized for touch and portrait orientation
- **iPadOS**: Tablet optimizations while maintaining iOS patterns
- **macOS**: Mouse/keyboard optimizations with same architecture
- **Shared Code**: SwiftUI enables single codebase across platforms

---

## WWDC Design Talks Reference

### Recent Design Sessions

#### WWDC 2025 (Latest)

1. **"Build an AppKit app with the new design"** (Session 310)
   - Covers new macOS design system
   - Liquid Glass materials and controls
   - AppKit updates for modern design

2. **"Get to know the new design system"** (Session 356)
   - Visual design system overview
   - Information architecture patterns
   - Core system components

#### WWDC 2024

- **"What's new in AppKit"** (Session 10124)
- Continued evolution of macOS design

#### WWDC 2023

- **"What's new in AppKit"** (Session 10054)
- Design system updates

#### WWDC 2022

- **"What's new in AppKit"** (Session 10074)
- **"Meet the expanded San Francisco font family"** (Session 110381)

#### WWDC 2021

- **"Create custom symbols"** (Session 10250)
- **"What's new in SF Symbols"** (Session 10097)

#### WWDC 2020

- **"Adopt the new look of macOS"** (Session 10104)
  - Big Sur design system introduction
  - Materials and depth
  - New sidebar patterns
  - Control updates

#### WWDC 2019

- **"Introducing SF Symbols"** (Session 206)
  - SF Symbols system overview
  - Weight and scale system
  - Integration with San Francisco

#### WWDC 2016

- **"Crafting Modern Cocoa Apps"** (Session 239)

### Recommended Design Sessions

For comprehensive understanding of Apple design:

1. Watch most recent WWDC25 sessions first
2. Review "Adopt the new look of macOS" (WWDC20) for Big Sur principles
3. Study SF Symbols sessions for iconography
4. Review "Designing with typography" for text systems
5. Watch animation sessions for motion principles

---

## Summary: Key Metrics and Specifications

### Quick Reference Table

| Element                | Specification                   |
| ---------------------- | ------------------------------- |
| **Minimum Font Size**  | 11pt                            |
| **Body Text Size**     | 17pt Regular                    |
| **Headline Size**      | 17pt Semibold                   |
| **Touch Target**       | 44×44pt (iOS), flexible (macOS) |
| **8pt Grid**           | All spacing multiples of 8      |
| **Text Contrast**      | 4.5:1 minimum                   |
| **UI Contrast**        | 3:1 minimum                     |
| **Animation Duration** | 300-500ms standard              |
| **Spring Stiffness**   | 170                             |
| **Spring Damping**     | 26                              |
| **Corner Radius**      | 24pt (windows)                  |
| **Sidebar Width**      | Variable, typically 200-300pt   |
| **SF Symbols Weights** | 9 weights (Ultralight to Black) |
| **SF Symbols Scales**  | 3 scales (Small, Medium, Large) |
| **Font Family**        | SF Pro (Display/Text/Rounded)   |
| **Color Mode**         | Automatic Light/Dark adaptation |
| **Control Sizes**      | Regular, Small, Mini (macOS)    |

---

## Implementation Checklist

### Before Starting Design

- [ ] Understand target platform (iOS/macOS/iPadOS)
- [ ] Review latest WWDC design sessions
- [ ] Set up SF Pro font family
- [ ] Establish 8pt grid in design tool
- [ ] Prepare light and dark mode color palettes

### During Design

- [ ] Use semantic color names
- [ ] Follow 8pt grid spacing
- [ ] Implement SF Symbols for icons (not custom)
- [ ] Apply text styles (not custom fonts)
- [ ] Plan for Dynamic Type scaling
- [ ] Design for accessibility (contrast, touch targets)
- [ ] Plan animations (300-500ms)
- [ ] Progressive disclosure for complex features

### Before Development

- [ ] Verify contrast ratios (4.5:1 text, 3:1 UI)
- [ ] Create style guide with specifications
- [ ] Export all color specifications as semantic values
- [ ] Prepare SF Symbols in all weights needed
- [ ] Document animation timing functions
- [ ] Establish empty state design patterns
- [ ] Plan onboarding flow

### During Development

- [ ] Implement semantic colors (system colors)
- [ ] Support Dynamic Type
- [ ] Apply system text styles
- [ ] Use SF Symbols library
- [ ] Implement spring animations
- [ ] Test light/dark mode adaptation
- [ ] Verify accessibility compliance
- [ ] Test on multiple devices/sizes

---

## Sources and Further Reading

### Apple Developer Documentation

- [Human Interface Guidelines - Apple Developer](https://developer.apple.com/design/human-interface-guidelines/)
- [SF Symbols - Apple Developer](https://developer.apple.com/sf-symbols/)
- [Typography Guidelines](https://developer.apple.com/design/human-interface-guidelines/typography)
- [Color Guidelines](https://developer.apple.com/design/human-interface-guidelines/color)
- [Materials Guidelines](https://developer.apple.com/design/human-interface-guidelines/foundations/materials/)
- [Accessibility Guidelines](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Fonts - Apple Developer](https://developer.apple.com/fonts/)
- [Apple Design Resources](https://developer.apple.com/design/resources/)

### WWDC Videos

- [Animate with springs - WWDC23](https://developer.apple.com/videos/play/wwdc2023/10158/)
- [The details of UI typography - WWDC20](https://developer.apple.com/videos/play/wwdc2020/10175/)
- [Adopt the new look of macOS - WWDC20](https://developer.apple.com/videos/play/wwdc2020/10104/)
- [Implementing Dark Mode on iOS - WWDC19](https://developer.apple.com/videos/play/wwdc2019/214/)
- [Introducing SF Symbols - WWDC19](https://developer.apple.com/videos/play/wwdc2019/206/)
- [Get started with Dynamic Type - WWDC24](https://developer.apple.com/videos/play/wwdc2024/10074/)

### Design System References

- [Apple HIG Design System Overview](https://designsystems.surf/design-systems/apple)
- [Apple Colors - Figma Community](https://www.figma.com/community/file/1300774326837694638/apple-system-colors-modes-configured-variants-library)
- [SF Pro Display - Figma](https://www.figma.com/community/file/976541707845800013/sf-pro-display)
- [Apple Fonts Documentation - GitHub](https://github.com/yell0wsuit/Apple-Fonts-Documentation)

### Design Philosophy Resources

- [The Essence of Apple Design - Encyclopedia of Design](https://encyclopedia.design/2025/02/03/the-essence-of-apple-design-a-deep-dive-into-human-centered-innovation/)
- [Backdrop - History of Apple HIG](https://modelessdesign.com/backdrop/401)
- [Evolution of macOS UI/UX Design](https://medium.com/@mcfarlanematthias/the-evolution-of-macos-ui-ux-design-a-journey-through-skeuomorphism-and-neomorphism-6b5174ef1352)
- [Is Skeuomorphism Back on the Menu?](https://blog.simone.computer/is-skeumorphism-back)

### Implementation Guides

- [Navigating Apple's HIG - Dev Community](https://dev.to/matheussricardoo/navigating-apple-human-interface-guidelines-hig-a-practical-guide-26ka)
- [Design for macOS Big Sur - iOS Design Handbook](https://designcode.io/ios-design-handbook-design-for-macos-big-sur/)
- [Control Sizing in SwiftUI](https://fleetingpixels.com/articles/2022/control-size/)
- [Dark Side of the Mac](https://mackuba.eu/2018/07/04/dark-side-mac-1/)

### Accessibility Resources

- [Applying WCAG 2.1 Standards to iOS Apps](https://www.accessibleresources.com/post/applying-wcag-2-1-standards-to-ios-mobile-apps-a-comprehensive-guide)
- [WCAG 2.1 Standards](https://accessible.org/wcag/)

---

## Document Information

**Created**: March 2026
**Scope**: Comprehensive reference for macOS and Apple design philosophy
**Target Audience**: Designers, developers, product managers designing for Apple platforms
**Coverage**: HIG principles, typography, color, spacing, controls, animation, accessibility, and macOS-specific patterns

This rulebook synthesizes research from:

- Apple's official Human Interface Guidelines
- WWDC design talks (2016-2025)
- Official Apple Developer documentation
- Design system analyses and implementation guides

**Note**: This document should be updated annually to reflect WWDC announcements and HIG updates.
