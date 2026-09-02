# OpenRank Design System v1 (Phase 8.1)

The approved visual direction for the OpenRank mobile app: **dark athletic,
premium, utilitarian, serious, clean**. Near-black canvas, charcoal surfaces,
one warm amber primary accent, and rank colors used only where rank meaning
matters. No neon, no gaming HUD, no glassmorphism, no glow, no decorative
gradients or shadows, no gratuitous animation.

This document is normative for all product UI. Components must consume
semantic tokens from `apps/mobile/src/design/` - never scattered hex values.

## 1. Color tokens (`src/design/colors.ts`)

| Token | Value | Usage |
| --- | --- | --- |
| BACKGROUND | #0B0D10 | App canvas |
| SURFACE | #12151A | Cards, sheets, tab bar |
| SURFACE_ELEVATED | #181C22 | Hero cards, modals, rest bar |
| SURFACE_PRESSED | #1D2128 | Inputs, tracks, pressed rows |
| SURFACE_SUBTLE | #101318 | Alt sections, dividers |
| BORDER | #262B33 | Hairlines, card borders |
| BORDER_STRONG | #343A44 | Input borders, prominent dividers |
| TEXT_PRIMARY | #F5F7FA | Primary text |
| TEXT_SECONDARY | #9CA3AF | Secondary text |
| TEXT_MUTED | #6B7280 | Captions, inactive nav |
| TEXT_DISABLED | #4B5563 | Disabled text, placeholders |
| ACCENT | #F5B82E | Brand/primary/selection/nav emphasis |
| ACCENT_STRONG | #FFBF2F | Hover/pressed-forward state |
| ACCENT_PRESSED | #D99A16 | Pressed accent |
| ACCENT_SUBTLE | rgba(245,184,46,0.12) | Amber plates, PR badges |
| SUCCESS | #22C55E | Completed / success ONLY (never brand/nav) |
| SUCCESS_SUBTLE | rgba(34,197,94,0.12) | Completed set rows |
| WARNING | #F59E0B | Warnings |
| DANGER | #EF4444 | Destructive actions and errors ONLY |
| DANGER_SUBTLE | rgba(239,68,68,0.12) | Destructive plates |
| INFO | #60A5FA | Informational (also Platinum rank) |
| OVERLAY | rgba(0,0,0,0.60) | Scrims |

Rules:
- Amber = brand, primary actions, selection, active nav. Green = success /
  completed states only. Red = destructive only. Blue = informational.
- Rank colors appear ONLY on rank badges, rank progress bars, tier labels
  and rank timeline bars - never as screen/card tinting.
- Never color alone: rank badges always show tier text (+ division); week
  strip glyphs carry text labels for accessibility.

## 2. Rank colors (`src/design/rank-colors.ts`)

| Tier | Color |
| --- | --- |
| Bronze | #C97A38 |
| Iron | #8B92A0 |
| Gold | #F5B82E |
| Platinum | #60A5FA |
| Diamond | #A78BFA |
| Titan | #8B5CF6 |
| Colossus | #EC4899 |
| Olympian | #F43F5E |
| Mythic | #FB7185 |
| Unranked | #6B7280 |

Tier names, divisions, thresholds and all ranking math are owned by the
ranking engine and are NOT changed by the design system.

## 3. Spacing (`src/design/spacing.ts`)

4 px base grid: `space[1..16]` = 4/8/12/16/20/24/32/40/48/64.
Screen horizontal padding 16 (20 where the layout permits), card gaps 12-16,
section gaps 24-32.

## 4. Radii (`src/design/radii.ts`)

sm 8 / md 12 / lg 16 / xl 20 / pill 999. Cards use 12-16, buttons 10-12,
sheets 20 (top corners), chips/badges pill or 8.

## 5. Typography (`src/design/typography.ts`)

System sans only (no font dependency). Tokens: display 38/44 700,
pageTitle 28/34, sectionTitle 18/24 600, cardTitle 16/22 600, body 15/21,
bodyStrong 600, caption 12/16, label 11/14 600 (uppercase kickers),
metricLarge 34/40 700, metricMedium 24/30 700, metricSmall 18/24 600.
Font scaling is never disabled; numeric readouts use tabular numerals.

## 6. Components (`src/components/ui/`)

- **Screen** - canvas + padded content.
- **Card** - surface card (default/elevated/subtle), radius 12, border.
- **Button** - primary (amber, dark label), secondary (surface + strong
  border), danger (solid red), dangerSubtle (red plate, dark text), ghost.
  Min touch height 44-50. Loading state spinner.
- **Chip** - filters/segments; selected = amberSubtle + amber border/text +
  accessibilityState selected.
- **SectionHeader** - uppercase label + optional amber action link.
- **ProgressBar / AnimatedProgress** - 4-8 px rounded track; rank progress
  uses the tier color, generic progress amber; reduced motion snaps to final.
- **RankBadge** - tier + division text on a 12 % plate of the rank color.
- **EmptyState** - icon, honest title, one CTA (e.g. History "No workouts
  yet.").
- **InlineError** - user-safe messages only; never raw SQLite/internal text.
- **ModalShell** - bottom sheet: SURFACE_ELEVATED, radius 20 top, subtle
  handle, scrim tap-to-close. Used by set-type picker, exercise options,
  routine pickers and danger confirms.
- **TabBar** (five tabs) - see below.

## 7. Navigation (spec 17)

Exactly **five** primary tabs: **Home, History, Workout, Ranks, Profile**.
Workout sits visually central with a soft amber plate when active - never an
oversized FAB, never glow. Active = amber; inactive = TEXT_MUTED. Every item
has icon + label + accessibility label. **Exercises is NOT a tab** but stays
reachable (Home quick link "Browse exercises", exercise links from rank and
workout surfaces).

## 8. Screen structures (approved)

- **Home**: greeting/date; TODAY card (START WORKOUT / honest state copy;
  future plans show NEXT WORKOUT + VIEW PLAN + explicit bonus - never
  reinterpreted as today); streak + week strip (green check = completed,
  amber = today marker, danger x = missed, muted dot = rest; textual a11y
  labels); strength profile mini list with RankBadges + "View progress";
  Recent Wins built from canonical PR + rank events only.
- **History**: compact cards (date, name, duration, sets, PR badge),
  virtualized FlatList, honest empty state.
- **Workout hub**: no-active -> START EMPTY WORKOUT + routines list; active
  -> WORKOUT IN PROGRESS + timer + RESUME WORKOUT + Discard (danger).
- **Active workout**: header with back arrow, name, amber timer, notes;
  exercise cards with PREVIOUS reference line, PR badges (canonical events),
  set rows (SET / PREVIOUS / per-mode columns / RPE / delete / check),
  inline + ADD SET; rest timer bar [-15 danger, SKIP neutral, +15 amber]
  with large white value.
- **Ranks**: six muscle groups (Legs/Chest/Back/Shoulders/Arms/Core),
  By Muscle Group / By Exercise selector, no overall rank anywhere, rank
  accent only on badge/bar/label, recent rank changes.
- **Progress**: range chips 4W/12W/6M/1Y/ALL (amber selected); WORKOUTS PER
  WEEK + VOLUME PER WEEK bars; PRs / Rank Ups / Longest Streak /
  Consistency metric cards; Training Distribution (last 12 sessions -
  bounded read); Strength Profile; Bodyweight. Reads only AnalyticsService.
- **Exercise detail**: Overview (canonical fields/muscles/instructions),
  est. 1RM hero + delta vs 12 weeks, PRs + history, Rank (current, next
  target, rank history; PROVISIONAL handled honestly).
- **Profile**: avatar initial, name, bodyweight hero + trend, settings list
  (Progress, Achievements, Training Schedule, Reminders, Streak), Units
  (display-only), Strength Standard (rebuilds ranks only), DATA section:
  "Stored locally on this device." No account/cloud UI.
- **Onboarding**: same design language; step kickers, amber filled day
  circles, summary card, CONTINUE/BACK. Semantics and persistence unchanged.

## 9. Motion & accessibility

- `src/design/motion.ts` is a **pure** reduced-motion policy
  (`shouldAnimate`, `animationDuration`, `REDUCED_MOTION_DURATION = 0`);
  `src/ui/useReducedMotion.ts` reacts to the OS setting. With reduced
  motion, components render their final state immediately.
- Touch targets >= 44; every interactive element carries role/label/state;
  charts ship textual summaries; font scaling is never disabled.

## 10. Charts

No chart library, no SVG dependency: bars rendered with views
(`features/charts/BarChart.tsx`), rank timelines colored via
`rankColor()` (`features/charts/TierTimeline.tsx`). Deviation note: the
approved reference showed a volume line chart; implemented as clean amber
bars because react-native-svg is intentionally not added.

## 11. Compatibility shim

`src/theme/tokens.ts` re-maps the old import surface to the new palette so
screens migrate incrementally without blue remnants. New code imports from
`src/design/` directly.
