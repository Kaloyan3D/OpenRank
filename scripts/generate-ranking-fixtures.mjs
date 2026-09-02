#!/usr/bin/env node
/**
 * Characterization fixture generator (Phase 1, spec section 9 step two).
 *
 * Feeds known workouts into the ORIGINAL legacy engine and saves exact
 * expected outputs as JSON golden fixtures. Fixtures are committed; the
 * golden tests then pin both the legacy engine and the TypeScript port to
 * these exact outputs (100% golden compatibility = Phase 1 exit criterion).
 *
 * Run: pnpm fixtures:generate
 *
 * NOTE: normalizeValue here must stay in sync with
 * packages/ranking-core/src/testing/normalize.ts (same transformation).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildCatalog,
  computeRanks,
} from "../packages/ranking-core/src/legacy/engine.js";
import templates from "../packages/ranking-core/src/legacy/data/exercise-templates.json" with { type: "json" };

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(
  repoRoot,
  "packages",
  "ranking-core",
  "src",
  "testing",
  "fixtures",
);

function byString(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeValue(v) {
  if (v instanceof Set) return [...v].map((x) => String(x)).sort(byString);
  if (v instanceof Map) {
    return [...v.entries()]
      .map(([k, val]) => [String(k), normalizeValue(val)])
      .sort((a, b) => byString(a[0], b[0]));
  }
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (v !== null && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) {
      out[k] = normalizeValue(val);
    }
    return out;
  }
  if (v === undefined) return null;
  return v;
}

// ---------------------------------------------------------------------------
// Scenario helpers
// ---------------------------------------------------------------------------

const BW = 84.7;
const catalog = buildCatalog(templates);

function session(date, exercises, title = `Session ${date}`) {
  return { date, title, exercises };
}

function lift(title, sets, templateId = null) {
  return { title, templateId, sets };
}

function set(weight, reps, type = "normal") {
  return { weight, reps, type };
}

/** Three sessions of a single exercise, one set per session. */
function threeSessions(exercise, dates = ["2026-01-05", "2026-01-07", "2026-01-09"]) {
  return dates.map((d) => session(d, [exercise]));
}

// ---------------------------------------------------------------------------
// Scenarios (spec section 68.8 coverage)
// ---------------------------------------------------------------------------

const scenarios = [];

// All six muscle groups with compound lifts (3+ sessions each).
{
  const sessions = [
    ...threeSessions(lift("Bench Press (Barbell)", [set(100, 5)])),
    ...threeSessions(lift("Squat (Barbell)", [set(140, 5)])),
    ...threeSessions(lift("Barbell Row", [set(95, 5)])),
    ...threeSessions(lift("Overhead Press (Barbell)", [set(55, 5)])),
    ...threeSessions(lift("Barbell Curl", [set(40, 8)])),
    ...threeSessions(lift("Cable Crunch", [set(70, 10)])),
  ];
  scenarios.push({
    name: "six-groups-compound",
    description:
      "All 6 muscle groups ranked from compound lifts with >= 3 sessions each.",
    opts: { bodyweightKg: BW, sex: "male" },
    sessions,
  });
}

// Compound aggregation: 4 qualifying compounds in one group - top 3 weighted [1, .5, .25].
{
  const sessions = [
    ...threeSessions(lift("Bench Press (Barbell)", [set(120, 5)])),
    ...threeSessions(lift("Incline Dumbbell Press", [set(70, 5)])),
    ...threeSessions(lift("Weighted Dip", [set(15, 5)])),
    ...threeSessions(lift("Machine Chest Press", [set(90, 8)])),
  ];
  scenarios.push({
    name: "compound-aggregation-top3",
    description:
      "Four qualifying chest compounds: composite uses the top 3 with weights 1.0/0.5/0.25.",
    opts: { bodyweightKg: BW, sex: "male" },
    sessions,
  });
}

// Isolation fallback: only isolation lifts qualify -> capped at Titan.
{
  const sessions = [
    ...threeSessions(lift("Leg Curl", [set(60, 10)])),
    ...threeSessions(lift("Leg Extension", [set(65, 10)])),
    ...threeSessions(lift("Standing Calf Raise", [set(100, 12)])),
  ];
  scenarios.push({
    name: "isolation-fallback-capped-titan",
    description:
      "Legs trained with isolation lifts only: rank comes from isolation, capped at Titan.",
    opts: { bodyweightKg: BW, sex: "male" },
    sessions,
  });
}

// Few-sessions cap: nothing reaches MIN_SESSIONS -> capped at Platinum.
{
  const sessions = [
    session("2026-02-01", [lift("Barbell Row", [set(90, 6)]), lift("Lat Pulldown", [set(70, 8)])]),
    session("2026-02-03", [lift("Barbell Row", [set(92.5, 6)]), lift("Lat Pulldown", [set(72.5, 8)])]),
  ];
  scenarios.push({
    name: "few-sessions-capped-platinum",
    description:
      "Two sessions only for every back exercise: source few_sessions, capped at Platinum.",
    opts: { bodyweightKg: BW, sex: "male" },
    sessions,
  });
}

// Assisted bodyweight: effective load = bw - assistance; over-assistance skipped.
{
  const sessions = [
    ...threeSessions(lift("Pull Up (Assisted)", [set(40, 8)])),
    session("2026-03-01", [lift("Pull Up (Band)", [set(90, 10)])]),
  ];
  scenarios.push({
    name: "bodyweight-assisted",
    description:
      "Assisted pull-ups: 40 kg assistance subtracts from bodyweight; 90 kg (>= bw) yields no usable set.",
    opts: { bodyweightKg: BW, sex: "male" },
    sessions,
  });
}

// Weighted bodyweight: effective load = bw + added weight.
{
  const sessions = [...threeSessions(lift("Weighted Pull Up", [set(30, 6)]))];
  scenarios.push({
    name: "bodyweight-weighted",
    description: "Weighted pull-ups: added weight adds to bodyweight.",
    opts: { bodyweightKg: BW, sex: "male" },
    sessions,
  });
}

// Bodyweight reps (no load): scored via bodyweight fraction.
{
  const sessions = [
    ...threeSessions(lift("Hanging Leg Raise", [set(0, 12)], "reps-only")),
    ...threeSessions(lift("Push Up", [set(0, 20)])),
  ];
  scenarios.push({
    name: "bodyweight-reps-fraction",
    description:
      "Reps-only core/chest movements scored through bodyweight fractions (core 0.25, push up 0.35).",
    opts: { bodyweightKg: BW, sex: "male" },
    sessions,
  });
}

// Male vs female thresholds on identical data.
{
  const sessions = [
    ...threeSessions(lift("Bench Press (Barbell)", [set(100, 5)])),
    ...threeSessions(lift("Overhead Press (Barbell)", [set(50, 5)])),
  ];
  scenarios.push({
    name: "thresholds-male",
    description: "Male standards (factor 1.0).",
    opts: { bodyweightKg: BW, sex: "male" },
    sessions,
  });
  scenarios.push({
    name: "thresholds-female",
    description: "Female standards (thresholds x 0.72) on identical workouts.",
    opts: { bodyweightKg: BW, sex: "female" },
    sessions,
  });
}

// Missing bodyweight: ranking unavailable, no silent default.
{
  const sessions = [...threeSessions(lift("Bench Press (Barbell)", [set(100, 5)]))];
  scenarios.push({
    name: "missing-bodyweight",
    description:
      "No bodyweight: eqRatio null, hasData false, bodyweightKg null - never assume a default.",
    opts: { sex: "male" },
    sessions,
  });
}

// Warmup sets ignored; rep cap at 12 for e1RM.
{
  const sessions = [
    session("2026-04-01", [
      lift("Bench Press (Barbell)", [set(60, 8, "warmup"), set(100, 13)]),
    ]),
    session("2026-04-03", [lift("Bench Press (Barbell)", [set(100, 12)])]),
  ];
  scenarios.push({
    name: "warmup-ignored-rep-cap",
    description:
      "Warmup sets are skipped; 13 reps counts as 12 for Epley (100x13 -> 140 kg e1RM).",
    opts: { bodyweightKg: BW, sex: "male" },
    sessions,
  });
}

// Unmatched titles: unknown exercises and no-load strength work.
{
  const sessions = [
    ...threeSessions(lift("Super Secret Machine Xyz", [set(80, 5)])),
    ...threeSessions(lift("Plank", [set(0, 0)])),
    ...threeSessions(lift("Running", [set(0, 1)])),
  ];
  scenarios.push({
    name: "unmatched-and-skipped",
    description:
      "Unknown strength title lands in unmatched (reason unknown); Plank has no load (reason no_load); Running is cardio and silently skipped.",
    opts: { bodyweightKg: BW, sex: "male" },
    sessions,
  });
}

// Catalog matching: templateId, exact title, canonical (word-order) fuzzy.
{
  const benchId = templates.find((t) => t.title === "Bench Press (Barbell)").id;
  const sessions = [
    ...threeSessions(lift("Bench Press (Barbell)", [set(100, 5)], benchId)),
    ...threeSessions(lift("Barbell Bench Press", [set(102.5, 5)])),
    ...threeSessions(lift("Squat Barbell", [set(140, 5)])),
  ];
  scenarios.push({
    name: "catalog-matching",
    description:
      "Resolves by template id, exact title, and canonical word-order fuzzy match; matchStats splits catalog vs inferred.",
    opts: { bodyweightKg: BW, sex: "male" },
    sessions,
  });
}

// Tier ladder: nine engineered ranks on one group (Bench Press, 1-rep sets so
// e1RM == weight exactly).
{
  const targets = [0.2, 0.5, 0.7, 0.9, 1.1, 1.35, 1.65, 2.0, 2.5];
  targets.forEach((ratio, tier) => {
    const weight = Math.round(ratio * BW * 100) / 100;
    scenarios.push({
      name: `tier-ladder-${tier}`,
      description: `Bench Press composite engineered for tier index ${tier} (ratio ~${ratio} x BW).`,
      opts: { bodyweightKg: BW, sex: "male" },
      sessions: threeSessions(lift("Bench Press (Barbell)", [set(weight, 1)])),
    });
  });
}

// ---------------------------------------------------------------------------
// Generate
// ---------------------------------------------------------------------------

mkdirSync(outDir, { recursive: true });
let count = 0;
for (const scenario of scenarios) {
  const legacyResult = computeRanks(scenario.sessions, catalog, scenario.opts);
  const fixture = {
    name: scenario.name,
    description: scenario.description,
    opts: scenario.opts,
    sessions: scenario.sessions,
    expected: normalizeValue(legacyResult),
  };
  const file = join(outDir, `${scenario.name}.json`);
  writeFileSync(file, JSON.stringify(fixture, null, 2) + "\n", "utf8");
  count += 1;
  console.log(`fixture: ${scenario.name}`);
}
console.log(`wrote ${count} fixtures to ${outDir}`);
