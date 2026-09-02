# OpenRank Design Guide v1
## Dark Amber — Product UI / UX Specification

**Status:** Approved design direction  
**Purpose:** Authoritative visual and interaction guide for all OpenRank mobile UI work  
**Audience:** Nexus / developers / reviewers  
**Scope:** Visual language, layout, components, navigation, screen hierarchy, states, accessibility, motion, and implementation discipline  
**Product:** OpenRank  
**Platform:** Mobile first — Android / iOS via Expo React Native  
**Design language:** Dark athletic / premium utilitarian / serious / clean  
**Primary accent:** Warm amber  
**Canonical product principles:** Free forever · Open source · No account required · Offline-first · No subscriptions · No ads · User data stays local

---

# 1. Design Intent

OpenRank should feel like a serious training tool, not a gamified toy.

The design should communicate:

- precision
- strength
- progress
- speed
- confidence
- transparency
- ownership

The app should feel premium without looking expensive, flashy, or artificial.

OpenRank is **not**:

- a casino interface
- a crypto dashboard
- a neon gamer HUD
- a glassmorphism showcase
- a social network
- a fitness influencer app
- an XP / coins economy
- a calorie tracker
- a subscription upsell funnel

The visual system should feel closer to a high-quality training instrument.

---

# 2. Core Visual Direction

## 2.1 Brand language

Primary visual identity:

**Near-black background + charcoal surfaces + warm amber action color**

Rank-specific colors are allowed only where rank meaning is being communicated.

### Hard semantic rule

- **Amber** = OpenRank / primary action / current selection / active navigation
- **Green** = success / completed / valid
- **Red** = danger / destructive / failure
- **Blue** = informational or Platinum rank when rank semantics apply
- **Rank colors** = rank identity only

Do not allow green to become the brand color.

Do not tint entire screens using a user's current rank.

---

# 3. Color System

## 3.1 Core tokens

| Token | Value | Usage |
|---|---|---|
| `background` | `#0B0D10` | Main app background |
| `surface` | `#12151A` | Standard cards / rows |
| `surfaceElevated` | `#181C22` | Hero cards / modals / elevated areas |
| `surfacePressed` | `#1D2128` | Press state |
| `surfaceSubtle` | `#101318` | Quiet secondary surfaces |
| `border` | `#262B33` | Standard subtle borders |
| `borderStrong` | `#343A44` | Focus / stronger separation |
| `textPrimary` | `#F5F7FA` | Main readable text |
| `textSecondary` | `#9CA3AF` | Secondary information |
| `textMuted` | `#6B7280` | Low-priority information |
| `textDisabled` | `#4B5563` | Disabled state |
| `accent` | `#F5B82E` | Primary OpenRank amber |
| `accentStrong` | `#FFBF2F` | Strong CTA / hero emphasis |
| `accentPressed` | `#D99A16` | Pressed amber |
| `success` | `#22C55E` | Completed / valid |
| `warning` | `#F59E0B` | Warning |
| `danger` | `#EF4444` | Delete / failure |
| `info` | `#60A5FA` | Information |
| `overlay` | `rgba(0,0,0,0.60)` | Modal overlay |

## 3.2 Subtle semantic fills

- `accentSubtle = rgba(245,184,46,0.12)`
- `successSubtle = rgba(34,197,94,0.12)`
- `dangerSubtle = rgba(239,68,68,0.12)`

Use subtle fills instead of bright full-card states.

---

# 4. Rank Color System

| Rank | Color |
|---|---|
| Bronze | `#C97A38` |
| Iron | `#8B92A0` |
| Gold | `#F5B82E` |
| Platinum | `#60A5FA` |
| Diamond | `#A78BFA` |
| Titan | `#8B5CF6` |
| Colossus | `#EC4899` |
| Olympian | `#F43F5E` |
| Mythic | `#FB7185` |
| Unranked | `#6B7280` |

Rank color may be used for:

- rank icon / badge
- tier label
- rank progress bar
- timeline point / band
- small edge accent

Rank color should **not** strongly tint the entire card.

Every rank state must include readable text.

Never communicate rank using color alone.

---

# 5. Spacing System

Use a fixed spacing rhythm.

| Token | px |
|---|---:|
| `space1` | 4 |
| `space2` | 8 |
| `space3` | 12 |
| `space4` | 16 |
| `space5` | 20 |
| `space6` | 24 |
| `space8` | 32 |
| `space10` | 40 |
| `space12` | 48 |
| `space16` | 64 |

### Screen rules

- horizontal padding: 16 px on small phones
- 20 px where width allows
- card gap: 12–16 px
- section gap: 24–32 px
- avoid giant empty gaps unless intentionally separating major sections

OpenRank should be **compact but not cramped**.

---

# 6. Radius System

| Token | px |
|---|---:|
| `radiusSm` | 8 |
| `radiusMd` | 12 |
| `radiusLg` | 16 |
| `radiusXl` | 20 |

Rules:

- default card: 12–16
- buttons: 10–12
- modal / sheet top radius: 16–20
- chips: pill radius
- do not make every component extremely rounded

---

# 7. Typography

Prefer a high-quality system sans unless a future brand font is formally adopted.

## 7.1 Type scale

| Role | Size / line-height | Weight |
|---|---|---|
| Display | 38 / 44 | 700 |
| Page title | 28 / 34 | 600–700 |
| Section title | 18 / 24 | 600 |
| Card title | 16 / 22 | 600 |
| Body | 15 / 21 | 400 |
| Body strong | 15 / 21 | 600 |
| Caption | 12 / 16 | 400 |
| Label | 11 / 14 | 600 |
| Metric large | 34 / 40 | 700 |
| Metric medium | 24 / 30 | 600–700 |
| Metric small | 18 / 24 | 600 |

## 7.2 Hierarchy rules

Large type should be reserved for:

- workout timer
- bodyweight hero
- current rank
- primary progress metric
- workout summary hero metric

Do not make all text bold.

Do not make metadata visually compete with primary content.

---

# 8. Iconography

Use one consistent icon family.

Preferred:

- Expo-supported icon package
- outline-first iconography
- filled variant for active tab where appropriate

Avoid:

- emoji as permanent navigation
- mixing multiple icon families
- heavy pictograms
- decorative icons without meaning

---

# 9. Surface and Border Discipline

Dark UI hierarchy should come from:

1. spacing
2. typography
3. surface contrast
4. subtle borders

Not from outlining every block.

### Avoid

- card-inside-card-inside-card
- thick borders
- glowing shadows
- giant rounded rectangles
- every row looking like a separate floating card

### Prefer

- grouped settings rows
- subtle separators
- controlled elevation
- compact cards only where grouping matters

---

# 10. Interaction States

Every interactive primitive must define:

- default
- pressed
- disabled
- selected
- destructive where relevant

Pressed state can use:

- `surfacePressed`
- opacity change
- restrained scale around `0.98`

No large bouncing or spring effects.

---

# 11. Buttons

## 11.1 Primary Button

Use for the single most important action.

Examples:

- START WORKOUT
- CONTINUE
- COMPLETE WORKOUT

Style:

- amber background
- dark text
- 48–52 px height
- radius 10–12
- full-width when dominant

## 11.2 Secondary Button

Style:

- dark / transparent surface
- border
- primary text

Examples:

- VIEW PLAN
- CANCEL
- SKIP

## 11.3 Danger Button

Use only for destructive actions:

- DISCARD WORKOUT
- DELETE ROUTINE

Use red or danger subtle styling.

---

# 12. Cards

Default card:

- `surface`
- optional 1 px border
- 12–16 radius
- 16 px padding

Hero card:

- `surfaceElevated`
- stronger hierarchy
- only one dominant hero card near top of viewport

Do not turn every screen into a stack of equal-size cards.

---

# 13. Chips

Used for:

- analytics ranges
- filters
- tracking type
- training day selection
- rank view mode

Default:

- dark surface
- muted text
- subtle border

Selected:

- amber text
- amber/subtle background
- visible selected state beyond color if needed

---

# 14. Progress Bars

Generic progress:

- amber fill

Rank progress:

- rank color fill

Height:

- 4–8 px

Always provide readable context such as:

`72% · Next Gold I`

---

# 15. Bottom Navigation

Exactly five primary destinations:

**Home · History · Workout · Ranks · Profile**

Workout is visually central.

### Approved direction

- dark fixed bar
- subtle top separator
- central amber Workout action
- not oversized
- no glow
- safe-area correct
- icon + label
- inactive = muted
- active = amber

Exercises must remain accessible through search / picker / detail routes, but not as a permanent tab.

---

# 16. Home Screen

## 16.1 Main question

Home must answer:

**“What should I do today?”**

## 16.2 Approved hierarchy

1. greeting
2. current day
3. Today / Training Complete hero card
4. streak + week strip
5. compact Strength Profile
6. Recent Wins
7. upcoming session where useful

## 16.3 Example layout

```text
Good evening,
Kaloyan

Wednesday, September 2

TODAY
PUSH DAY
Chest · Shoulders · Triceps

[ START WORKOUT ]

8 SESSION STREAK

M   T   W   T   F   S   S
✓   ✓   ✓   ●   ○   ○   ○

STRENGTH PROFILE                  View progress →

Chest                     Gold II
Back                 Platinum IV
Legs                       Gold I
Shoulders                Iron II
Arms                     Gold III
Core                       Iron I

RECENT WINS

PR
Bench Press
100 kg × 5

RANK UP
Chest
Gold I → Platinum IV
```

## 16.4 State rules

### Scheduled today

```text
TODAY
Push Day
[ START WORKOUT ]
```

### Rest day

```text
REST DAY

Next:
Thursday · Pull

[ START BONUS WORKOUT ]
```

### Completed today

```text
TRAINING COMPLETE
Push Day

42 min · 14 working sets
```

### Missed

Use honest neutral copy.

No guilt.

No “you broke your streak” humiliation.

---

# 17. History Screen

## 17.1 Goal

History should feel like a clean activity timeline, not a CRUD list.

## 17.2 Card structure

```text
Wed, Sep 2                         42:16
PUSH DAY                           14 sets
                                   PR
```

Optional metadata:

- exercise count
- genuine PR badge
- genuine rank-up badge

Cards should be compact.

Use virtualization.

Empty state:

```text
NO WORKOUTS YET

Your completed workouts will appear here.

[ START A WORKOUT ]
```

---

# 18. Workout Hub

## 18.1 No active workout

```text
WORKOUT

START TRAINING

[ START EMPTY WORKOUT ]

ROUTINES                         Manage →

Push Day
Chest · Shoulders · Triceps
6 exercises
START →

Pull Day
Back · Biceps
5 exercises
START →
```

## 18.2 Active workout

```text
WORKOUT IN PROGRESS

Push Day

42:16

[ RESUME WORKOUT ]
```

Discard must be secondary/destructive and visually separate.

---

# 19. Active Workout

This is the most operationally important screen.

It must be:

- fast
- compact
- one-hand friendly
- keyboard safe
- readable under fatigue
- stable while typing

## 19.1 Header

```text
‹   PUSH DAY                 Finish
    42:16
```

## 19.2 Exercise card

```text
Bench Press
Barbell · Chest

Previous: 80 kg × 8

SET   PREVIOUS   KG    REPS   RPE   ✓
1     80 × 8     82.5  8      8    ●
2     80 × 8     82.5  8      8    ○
3     80 × 7     82.5  7      9    ○

+ ADD SET
```

## 19.3 Tracking type adaptations

### weight_reps

`SET | PREVIOUS | KG/LB | REPS | RPE | DONE`

### bodyweight_weighted

`SET | PREVIOUS | +KG/+LB | REPS | DONE`

### bodyweight_assisted

`SET | PREVIOUS | ASSIST | REPS | DONE`

### bodyweight_reps / reps_only

`SET | PREVIOUS | REPS | DONE`

### duration

`SET | PREVIOUS | TIME | DONE`

### distance_duration

`SET | DISTANCE | TIME | DONE`

Do not display meaningless fields.

---

# 20. Rest Timer

Approved layout:

```text
REST
01:42

[-15]      [ SKIP ]      [+15]
```

Rules:

- large readable timer
- not visually blocking set entry
- persistent behavior unchanged
- `-15` may use danger subtle
- `+15` amber
- Skip neutral

---

# 21. Workout Summary

```text
PUSH DAY

Completed · Today, 2:38 PM

SUMMARY

Duration
42:16

Exercises
6

Working Sets
14

Loaded Volume
12.4 t

HIGHLIGHTS

PR
Bench Press
100 kg × 5

RANK UP
Chest
Gold I → Platinum IV

STREAK
8 sessions

[ DONE ]
```

Only show metrics that are semantically valid.

Highlights must be based on canonical events.

No invented celebration.

---

# 22. Ranks Screen

## 22.1 Concept

OpenRank has a **Strength Profile**, not an overall rank.

Exactly six groups:

- Legs
- Chest
- Back
- Shoulders
- Arms
- Core

## 22.2 Card

```text
[badge] CHEST                        72%
        GOLD II

        ███████████░░░

                              Next: Gold I
```

Unranked:

```text
LEGS
NO RANK

Log a qualifying exercise →
```

Keep unranked states compact and subdued.

Detailed explanation belongs in detail screen.

---

# 23. Rank Detail

```text
Chest

CURRENT
Gold II

PROGRESS
72%

NEXT
Gold I

[ rank timeline ]

RECENT CHANGES
Gold III → Gold II

QUALIFYING PERFORMANCES
Bench Press
Incline Press
...
```

Do not recreate ranking thresholds in UI.

Use engine-owned values.

---

# 24. Progress Screen

Top range control:

`4W · 12W · 6M · 1Y · ALL`

Approved modules:

- Workouts per week
- Volume per week where valid
- PRs
- Rank ups
- Longest streak
- Consistency
- Strength Profile
- Bodyweight
- Training Distribution

Avoid finance-dashboard density.

Use one or two charts per viewport, not five.

---

# 25. Chart Style

- dark transparent base
- subtle grid
- muted labels
- amber default series
- rank colors for rank timeline
- no bright green default line
- no gradient required
- max ~100–150 visible points
- textual accessibility summary required

Charts must handle:

- empty series
- one point
- constant values
- NaN protection
- Infinity protection

---

# 26. Exercise Picker

The picker must feel like a fast local command palette.

## Structure

```text
Search exercises...

[ All ] [ Chest ] [ Back ] [ Legs ] [...]
[ Barbell ] [ Dumbbell ] [ Machine ] [...]

876 exercises

Bench Press
Barbell · Weight

Incline Dumbbell Press
Dumbbell · Weight

Pull Up
Bodyweight · Bodyweight
```

Rules:

- All = no equipment filter
- `null` equipment = No equipment
- never label null as bodyweight
- all catalog entries remain searchable
- unsupported rank exercises remain loggable
- use FlatList virtualization

---

# 27. Exercise Detail

```text
Bench Press
Barbell · Chest

Estimated 1RM

102.5 kg
+5.0 kg vs 12W ago

[ chart ]

PERSONAL RECORD
100 kg × 5

BEST SET VOLUME
500 kg

CURRENT RANK
Gold II

RECENT PERFORMANCE
...
```

Secondary sections:

- instructions
- PR history
- rank history
- muscle metadata

Do not overload first viewport.

---

# 28. Profile

Profile is information-first, not form-first.

## Approved structure

```text
[K]
Kaloyan

View and edit profile →

BODYWEIGHT

82.5 kg
-0.3 kg vs last month

[ small trend ]

Progress
Achievements
Training Schedule
Reminders
Units
Strength Standard

DATA
Stored locally on this device.
```

Editing bodyweight should happen via:

- modal
- bottom sheet
- compact edit state

Do not permanently show a giant input field.

No account / cloud section.

---

# 29. Onboarding

Use the same design system from the first launch.

Example:

```text
Step 3 of 6

TRAINING SCHEDULE

Choose the days you plan to train.

M  T  W  T  F  S  S

Selected days use amber fill.

YOUR SCHEDULE

Mon, Tue, Thu

You can change this anytime.

[ CONTINUE ]

BACK
```

Rules:

- persistent step state unchanged
- optional bodyweight remains optional
- reminders remain opt-in
- no login
- no account requirement

---

# 30. Modals and Bottom Sheets

Use one shared shell.

- `surfaceElevated`
- 16–20 radius
- subtle handle
- no blur dependency required

Use for:

- exercise options
- routine picker
- bodyweight edit
- set type
- destructive confirmation
- schedule date selection

---

# 31. Empty States

Empty states should be quiet, useful, and actionable.

Examples:

```text
NO WORKOUTS YET

Your completed workouts will appear here.

[ START A WORKOUT ]
```

```text
NO BODYWEIGHT YET

Add bodyweight to calculate strength ranks.

[ ADD BODYWEIGHT ]
```

```text
NO RANK YET

Complete qualifying sessions to establish this rank.
```

Do not give missing data more visual weight than real data.

---

# 32. Error States

Use user-safe copy.

Good:

```text
We couldn't load your workout history.

[ TRY AGAIN ]
```

Bad:

```text
SQLITE_CONSTRAINT_FOREIGNKEY
```

Do not silently swallow canonical write failures.

---

# 33. Loading States

Because data is local SQLite:

- avoid full-screen loading when possible
- avoid white flashes
- prefer retained content
- use lightweight skeletons only where needed

---

# 34. Accessibility

Mandatory:

- accessible labels
- semantic button roles
- touch targets >= 44 px
- no color-only state
- readable contrast
- font scaling support
- screen-reader chart summaries
- reduced-motion support
- keyboard-safe input layout

Never globally disable font scaling.

---

# 35. Motion

Use motion sparingly.

Allowed:

- small press scale
- progress fill
- rank-up reveal
- set completion feedback
- chart draw-in

Not allowed:

- constant motion
- bouncing buttons
- glowing effects
- long blocking animations

If reduced motion is enabled:

- render final state immediately
- no decorative animation should be necessary to understand state

---

# 36. Reactive UI Contract

OpenRank uses SQLite as canonical state.

UI must update immediately after successful canonical mutations.

Approved conceptual flow:

```text
SQLite
  ↓
successful write
  ↓
LocalDataChangeStore revision++
  ↓
useSyncExternalStore
  ↓
mounted screens re-render
  ↓
fresh SQLite read
```

The invalidation store must not contain domain data.

No user workflow should require app restart to see current state.

---

# 37. Information Density Rules

The approved OpenRank design is more compact than the current early UI.

Target:

- smaller metadata gaps
- fewer giant rectangles
- strong hierarchy
- compact cards
- fewer borders
- visible data dominates empty-state explanations

Do not simply shrink controls.

Interactive targets remain at least 44 px.

---

# 38. Do / Don't

## DO

- use near-black background
- use amber as primary interaction color
- use compact information-dense layouts
- use typography before borders
- show genuine user progress clearly
- use rank color only where meaningful
- prioritize training actions
- preserve offline-first behavior
- keep settings visually quiet
- make workout logging fast

## DON'T

- use green as app accent
- make every section a giant card
- use giant empty bordered rectangles
- add fake metrics
- add overall rank
- add XP
- add coins
- add social pressure
- add subscription patterns
- use gradients everywhere
- use glassmorphism
- use neon glows
- use excessive explanation text in repeated cards
- require restart for data refresh

---

# 39. Visual Review Checklist

Before accepting a screen:

### Hierarchy
- Is the most important action obvious?
- Is the most important metric obvious?
- Are secondary details visually quieter?

### Density
- Is there avoidable empty space?
- Are repeated cards too tall?
- Are metadata rows too padded?

### Borders
- Does every border have a reason?
- Can spacing or surface contrast replace it?

### Typography
- Are hero metrics actually larger than labels?
- Is metadata smaller than primary content?

### Color
- Is amber reserved for action / selection?
- Is green only success?
- Are rank colors local to rank information?

### Interaction
- Is the primary action reachable?
- Are destructive actions separated?
- Are touch targets >= 44 px?

### State
- Does the screen update immediately after data changes?
- Are empty / loading / error states intentional?

---

# 40. Screen Acceptance Order

When implementing future visual changes, review in this order:

1. Home
2. Workout Hub
3. Active Workout
4. Ranks
5. History
6. Profile
7. Progress
8. Exercise Picker
9. Exercise Detail
10. Workout Summary
11. Onboarding
12. Settings / Schedule / Notifications

A screen is not considered complete from unit tests alone.

Final acceptance requires emulator or device screenshots.

---

# 41. Design Authority

For visual work, use this order of authority:

1. **This file — OpenRank Design Guide v1**
2. Approved OpenRank mockups from product review
3. Existing design-system tokens
4. Existing implementation
5. Developer judgement only when the above are silent

If existing implementation conflicts with this guide, the guide wins for visual behavior unless doing so would break canonical product semantics.

---

# 42. Frozen Product Semantics

The design layer must not modify:

- ranking thresholds
- tier names
- division logic
- PR definitions
- streak semantics
- 04:00 logical training-day boundary
- notification scheduling semantics
- onboarding persistence semantics
- SQLite canonical ownership
- exercise catalog source semantics

Visual work adapts to domain truth.

It does not redefine it.

---

# 43. Final Product Standard

OpenRank should ultimately feel like:

**“A serious, premium training tracker that happens to be completely free and open source.”**

The target is not visual novelty.

The target is:

**clarity + speed + confidence + consistency + strong product identity.**
