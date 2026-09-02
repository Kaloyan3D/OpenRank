---
name: openrank-native-build
description: >
  Use whenever changing OpenRank's Expo SDK integration, React Native native
  dependencies, Expo modules, Reanimated, Worklets, Gradle, Kotlin, Android
  or iOS native project configuration, development builds, or release/build
  configuration — especially when a Gradle or dev build broke after adding
  or upgrading an Expo native dependency. Encodes the rule that JS/TS
  success does not prove native correctness and defines the required native
  verification gates. Not needed for JS-only changes with no native
  footprint.
---

# OpenRank Native Build Discipline

OpenRank runs Expo / React Native with a validated native dependency graph.
That working graph is an asset: preserve it unless the task explicitly
requires changing it.

## Before changing native dependency versions

- Identify why the change is necessary for THIS task.
- Inspect compatibility with the installed Expo SDK.
- Prefer Expo-supported versions.
- Assess native build impact.
- Avoid speculative package upgrades.

Do not casually upgrade native dependencies while solving unrelated tasks.

## The distinction that matters

```
Metro works
  != Expo export works
  != development build works
  != Android Gradle build works
```

A JavaScript/TypeScript success does NOT prove native correctness. Never
claim a native dependency change is verified because only `expo export`
(or Metro bundling) passed.

## Verification gates

For native-affecting changes, run the relevant subset of:

- TypeScript.
- Unit/integration tests.
- `expo-doctor`.
- Expo dependency compatibility checks.
- Actual Android native build / Gradle gate.
- Real dev-build/runtime acceptance when needed.

If a gate could not run, report it as UNVERIFIED with the reason — never as
PASS.

## Working rules

- Use `expo-dev-client` development builds for runtime acceptance.
- Follow Expo official guidance for module and config changes.
- Keep Kotlin/Gradle/plugin versions aligned with the Expo SDK
  recommendation.
- When a native change is genuinely required: make it minimal, document
  why, and include compatibility evidence in the report.

## When a native build breaks after a dependency change

- Revert to the last known-good dependency graph first, then re-apply the
  change one dependency at a time to isolate what actually broke the build.
- Check the failing package's peer/compatibility requirements against the
  installed Expo SDK before touching Gradle or Kotlin files.
- Do not "fix" a native breakage by bumping unrelated native packages; that
  trades one unknown graph for another.
- Record exactly which versions changed, why each was necessary, and which
  gates were run in the task report.

## Interaction

- Pair with `expo-dev-client` for the dev-build workflow.
- Pair with `react-native-best-practices` for runtime performance work.
- This skill does not apply to pure JS/TS changes with no native footprint;
  do not treat native gates as required for them.
