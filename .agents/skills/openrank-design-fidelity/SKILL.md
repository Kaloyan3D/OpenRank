---
name: openrank-design-fidelity
description: >
  Use whenever implementing, reviewing, or modifying OpenRank UI/UX —
  screens, components, layouts, colors, typography, cards, navigation,
  visual hierarchy, or screenshot fidelity. Procedural gateway to the
  authoritative OpenRank Design Guide: it defines WHEN the guide must be
  consulted, WHICH sections apply to which screen type, HOW visual work is
  verified (emulator/device acceptance for significant UI work), and the
  rule that token compliance is not design fidelity. Not needed for
  non-visual logic, data, or build tasks.
---

# OpenRank Design Fidelity

This skill is a procedural gateway. It deliberately does not duplicate the
design specification. The canonical visual source is:

`docs/design/OPENRANK_DESIGN_GUIDE_v1.md`

Read the routed sections of that guide before implementing or reviewing
any OpenRank visual work. This skill defines when, what, and how; the
guide defines the design itself.

## Approved direction (identity anchor)

Premium athletic. Dark. Restrained. Clean. Dense enough to feel
professional. Not generic CRUD. Not neon gaming UI. Green is semantic
success ONLY — it is NOT an OpenRank brand color.

## Authority order for visual work

1. `docs/design/OPENRANK_DESIGN_GUIDE_v1.md`
2. Approved OpenRank mockups
3. Existing design-system tokens
4. Existing implementation
5. Developer judgement — only when everything above is silent

If the implementation conflicts with the guide, the guide wins for visual
behavior — unless following it would violate frozen product/domain
semantics (see `openrank-product-invariants`, `openrank-ranking-engine`).

## Critical invariant

TOKEN COMPLIANCE != DESIGN FIDELITY. A screen can use every correct color
and token and still fail visually. Always evaluate: composition,
hierarchy, density, spacing, grouping, typography, information priority,
interaction prominence, native mobile feel, accessibility, and consistency
with surrounding screens.

## Section routing (consult, never copy)

| Work area                      | Design Guide sections |
|--------------------------------|-----------------------|
| Home                           | 16, 37, 39, 40        |
| History                        | 17, 37, 39            |
| Workout Hub / Active Workout   | 18, 19, 20, 37, 39    |
| Ranks                          | 4, 22, 23             |
| Progress / charts              | 24, 25                |
| Exercise Picker / Detail       | 26, 27                |
| Profile                        | 28                    |
| Onboarding                     | 29                    |
| Accessibility / motion         | 34, 35                |
| Reactive UI behavior           | 36                    |

Load only the routed sections plus any section the guide itself requires
for context. If a screen type is not listed, read the guide's core
sections (intent, visual direction, color, spacing, typography, surfaces)
and the visual review checklist.

## Required workflow

1. Identify the affected screen / interaction.
2. Read the relevant Design Guide sections.
3. Inspect the current implementation.
4. Preserve frozen product semantics.
5. Implement.
6. Run the real app.
7. Inspect emulator/device output.
8. Review hierarchy, density, spacing, typography, borders/surfaces,
   interaction prominence, accessibility, and OpenRank identity.
9. Iterate until visually accepted.

## Verification rule

Significant UI work remains UNVERIFIED until it has been inspected on an
emulator or device. Do not claim visual fidelity from source inspection or
token checks alone. If emulator/device inspection is impossible in the
current environment, report the work as UNVERIFIED with that reason —
never as PASS.

## Interaction

- `mobile-design`, `expo-design-system`, `expo-native-ui` cover generic
  platform conventions; OpenRank's approved identity overrides generic
  visual preferences.
- `openrank-local-first` governs reactive UI behavior (guide section 36
  aligns with it); this skill governs how it looks.
- `openrank-product-invariants` wins whenever a visual choice would
  violate a product promise.
