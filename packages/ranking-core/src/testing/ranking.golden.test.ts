/**
 * Golden compatibility harness (Phase 1 exit criterion).
 *
 * (a) legacy engine output === committed fixture  (characterization)
 * (b) TypeScript port output === committed fixture (100% golden compatibility)
 * (c) TypeScript port output === legacy engine output, per scenario
 *
 * Plus a catalog-wide sweep: for every template title in the Hevy catalog,
 * both engines must produce identical results.
 */
import { describe, expect, it } from "vitest";
import { buildCatalog as legacyBuildCatalog } from "../legacy/engine.js";
import { computeRanks as legacyComputeRanks } from "../legacy/engine.js";
import legacyTemplates from "../legacy/data/exercise-templates.json";
import { buildCatalog } from "../port/catalog.js";
import type { RankComputeOptions, RankSession } from "../port/types.js";
import { computeRanks as portComputeRanks } from "../rank.js";
import { normalizeRankResult } from "./normalize.js";
import type { JsonSafe } from "./normalize.js";

import sixGroupsCompound from "./fixtures/six-groups-compound.json";
import compoundAggregation from "./fixtures/compound-aggregation-top3.json";
import isolationFallback from "./fixtures/isolation-fallback-capped-titan.json";
import fewSessions from "./fixtures/few-sessions-capped-platinum.json";
import bodyweightAssisted from "./fixtures/bodyweight-assisted.json";
import bodyweightWeighted from "./fixtures/bodyweight-weighted.json";
import bodyweightRepsFraction from "./fixtures/bodyweight-reps-fraction.json";
import thresholdsMale from "./fixtures/thresholds-male.json";
import thresholdsFemale from "./fixtures/thresholds-female.json";
import missingBodyweight from "./fixtures/missing-bodyweight.json";
import warmupIgnoredRepCap from "./fixtures/warmup-ignored-rep-cap.json";
import unmatchedAndSkipped from "./fixtures/unmatched-and-skipped.json";
import catalogMatching from "./fixtures/catalog-matching.json";
import tierLadder0 from "./fixtures/tier-ladder-0.json";
import tierLadder1 from "./fixtures/tier-ladder-1.json";
import tierLadder2 from "./fixtures/tier-ladder-2.json";
import tierLadder3 from "./fixtures/tier-ladder-3.json";
import tierLadder4 from "./fixtures/tier-ladder-4.json";
import tierLadder5 from "./fixtures/tier-ladder-5.json";
import tierLadder6 from "./fixtures/tier-ladder-6.json";
import tierLadder7 from "./fixtures/tier-ladder-7.json";
import tierLadder8 from "./fixtures/tier-ladder-8.json";

interface Fixture {
  name: string;
  description: string;
  opts: RankComputeOptions;
  sessions: RankSession[];
  expected: JsonSafe;
}

const fixtures = [
  sixGroupsCompound,
  compoundAggregation,
  isolationFallback,
  fewSessions,
  bodyweightAssisted,
  bodyweightWeighted,
  bodyweightRepsFraction,
  thresholdsMale,
  thresholdsFemale,
  missingBodyweight,
  warmupIgnoredRepCap,
  unmatchedAndSkipped,
  catalogMatching,
  tierLadder0,
  tierLadder1,
  tierLadder2,
  tierLadder3,
  tierLadder4,
  tierLadder5,
  tierLadder6,
  tierLadder7,
  tierLadder8,
].map((f) => f as unknown as Fixture);

type TemplateList = {
  id?: string;
  title?: string;
  type?: string;
  primary?: string;
  equipment?: string;
}[];

const templates = legacyTemplates as TemplateList;
const legacyCatalog = legacyBuildCatalog(templates);
const portCatalog = buildCatalog(templates);

describe("ranking golden fixtures", () => {
  it("has committed characterization fixtures", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(15);
    for (const f of fixtures) {
      expect(f.name).toBeTruthy();
      expect(Array.isArray(f.sessions)).toBe(true);
      expect(f.expected).toBeTruthy();
    }
  });

  for (const fixture of fixtures) {
    describe(fixture.name, () => {
      it("legacy engine matches the committed fixture (characterization)", () => {
        const legacy = legacyComputeRanks(fixture.sessions, legacyCatalog, fixture.opts);
        expect(normalizeRankResult({ ...legacy, rankingVersion: "x" })).toEqual(fixture.expected);
      });

      it("TypeScript port matches the committed fixture (100% golden compatibility)", () => {
        const port = portComputeRanks(fixture.sessions, portCatalog, fixture.opts);
        expect(normalizeRankResult(port)).toEqual(fixture.expected);
      });

      it("port output equals legacy output exactly", () => {
        const legacy = legacyComputeRanks(fixture.sessions, legacyCatalog, fixture.opts);
        const port = portComputeRanks(fixture.sessions, portCatalog, fixture.opts);
        expect(normalizeRankResult(port)).toEqual(
          normalizeRankResult({ ...legacy, rankingVersion: "x" }),
        );
      });

      it("port stamps the ranking version", () => {
        const port = portComputeRanks(fixture.sessions, portCatalog, fixture.opts);
        expect(port.rankingVersion).toBe("hevy-ranks-compatible-v1");
      });
    });
  }
});

describe("catalog-wide sweep (453 template titles)", () => {
  it("port and legacy agree for every catalog exercise", () => {
    const titles = templates
      .filter((t) => typeof t.title === "string")
      .map((t) => t.title as string);
    expect(titles.length).toBeGreaterThanOrEqual(400);

    for (const title of titles) {
      const sessions: RankSession[] = [
        { date: "2026-05-01", title: "S1", exercises: [{ title, sets: [{ weight: 100, reps: 5, type: "normal" }] }] },
        { date: "2026-05-02", title: "S2", exercises: [{ title, sets: [{ weight: 102.5, reps: 4, type: "normal" }] }] },
        { date: "2026-05-03", title: "S3", exercises: [{ title, sets: [{ weight: 97.5, reps: 8, type: "normal" }] }] },
      ];
      const opts: RankComputeOptions = { bodyweightKg: 80, sex: "male" };
      const legacy = legacyComputeRanks(sessions, legacyCatalog, opts);
      const port = portComputeRanks(sessions, portCatalog, opts);
      expect(
        normalizeRankResult(port),
        `divergence for template title: ${title}`,
      ).toEqual(normalizeRankResult({ ...legacy, rankingVersion: "x" }));
    }
  });
});
