---
name: openrank-product-invariants
description: >
  Use whenever a task modifies OpenRank product architecture, persistence,
  accounts, monetization, networking, privacy, onboarding, workout ownership,
  or core user experience — especially any proposal that would make ranks or
  core features require an online account, subscription, payment, ad view, or
  connectivity. Encodes OpenRank's non-negotiable product promises and
  requires an explicit invariant evaluation before an architectural change is
  accepted. Not needed for pure visual polish, copy edits, or test-only work.
---

# OpenRank Product Invariants

These product promises are constraints on every architectural decision. They
are not aspirations: a change that breaks one is wrong even when the code is
clean.

## What OpenRank is

- Free forever.
- Open source.
- Offline-first.
- Local-first for core product behavior.
- Usable without an account.
- Usable without a backend.
- No subscription required for ranks or core features.
- No locked ranks.
- No ads required for core functionality.
- Workout data belongs to the user.

## Hard rules

1. Core functionality must never silently become dependent on:
   - authentication
   - cloud availability
   - paid APIs
   - subscriptions
   - network connectivity
2. Network/cloud features may exist later as optional layers, but they must
   never become the canonical source of truth for core workout data. The
   local device store stays authoritative; any cloud is an optional
   sync/enhancement layer on top of it.
3. Workout data belongs to the user. Never introduce a design that makes
   workout history hostage to an account, a server, or a paid tier.
4. Ranks are never locked behind a paywall, account, ad view, or online
   check.

## Required evaluation step

When this skill triggers, evaluate the proposal explicitly against the
invariants and state the result in the plan or report:

- Does any core feature become dependent on auth, cloud, paid APIs,
  subscriptions, or connectivity?
- Does any network/cloud layer become canonical for core workout data?
- Are ranks or core features gated behind accounts, payments, or ads?
- Does offline usability regress?
- Does user data ownership or exportability regress?

If any answer is yes, the change violates a product promise. Stop, surface
the conflict, and require an explicit user decision before proceeding.
"Temporarily" violating an invariant is not allowed; silent drift is the
exact failure mode this skill exists to prevent.

## Interaction with other skills

- Persistence or state-flow changes: pair with `openrank-local-first`.
- Native or dependency changes: pair with `openrank-native-build`.
- UI changes: add `openrank-design-fidelity` only when the product behavior
  also changes, not for pure styling.
- Generic Expo/React Native skills cover platform mechanics; this skill wins
  wherever platform advice conflicts with a product invariant.
