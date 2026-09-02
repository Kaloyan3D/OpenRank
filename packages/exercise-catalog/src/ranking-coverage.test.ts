import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUPS } from "@openrank/ranking-core";
import type { CatalogTemplate } from "@openrank/ranking-core";
import type { CatalogV1 } from "./schema";
import { classifyCatalog, templateIdFor } from "./ranking-coverage";

const catalog = JSON.parse(
  readFileSync(new URL("../data/catalog.v1.json", import.meta.url), "utf8"),
) as CatalogV1;
const templates = JSON.parse(
  readFileSync(new URL("../../ranking-core/src/legacy/data/exercise-templates.json", import.meta.url), "utf8"),
) as CatalogTemplate[];

interface ExceptionEntry {
  exerciseId: string;
  reason: string;
}
const exceptionsFile = JSON.parse(
  readFileSync(new URL("../data/ranking-coverage-exceptions.json", import.meta.url), "utf8"),
) as ExceptionEntry[];
const exceptions = new Set(exceptionsFile.map((e) => e.exerciseId));

const coverage = classifyCatalog(catalog, templates);
const eligible = catalog.exercises.filter((e) => e.ranking.eligible && e.ranking.group !== null);
const byId = new Map(coverage.map((e) => [e.exerciseId, e]));
const classified = coverage.filter((e) => e.status === "template" || e.status === "keyword");
const unclassified = coverage.filter((e) => e.status === "unmatched" || e.status === "ignored");

describe("ranking-engine coverage over the generated catalog", () => {
  it("has rank-eligible exercises to verify", () => {
    expect(eligible.length).toBeGreaterThan(400);
    expect(coverage.length).toBe(eligible.length);
  });

  it("classifies every exercise that has a Hevy alias through the engine catalog", () => {
    // Templates with a primary the engine does not route (e.g. "full_body")
    // are a frozen-engine limitation; they stay unmatched and are documented
    // in the exceptions file.
    const enginePrimaries = new Set(Object.values(GROUPS).flatMap((g) => g.primaries));
    const withAlias = eligible.filter((e) => {
      const tid = templateIdFor(catalog, e.id);
      if (tid === null) return false;
      const tpl = templates.find((x) => x.id === tid);
      return tpl?.primary != null && enginePrimaries.has(tpl.primary);
    });
    expect(withAlias.length).toBeGreaterThanOrEqual(50);
    const failures: string[] = [];
    for (const ex of withAlias) {
      const entry = byId.get(ex.id);
      if (!entry || entry.status === "unmatched" || entry.status === "ignored") {
        failures.push(ex.id + " status " + (entry?.status ?? "missing"));
      }
    }
    expect(failures, failures.slice(0, 10).join("; ")).toEqual([]);
  });

  it("accounts for every rank-eligible exercise (classified or documented exception)", () => {
    const unknownExceptions = [...exceptions].filter((id) => !eligible.some((e) => e.id === id));
    expect(unknownExceptions, "exceptions file lists non-eligible exercises").toEqual([]);
    expect(
      unclassified.filter((e) => !exceptions.has(e.exerciseId)),
      "unclassified exercises missing from ranking-coverage-exceptions.json",
    ).toEqual([]);
  });

  it("classifies the majority of the catalog", () => {
    const ratio = classified.length / eligible.length;
    expect(
      ratio,
      "classified " + String(classified.length) + "/" + String(eligible.length) +
        " (via Hevy template " + String(coverage.filter((e) => e.status === "template").length) +
        ", via keyword " + String(coverage.filter((e) => e.status === "keyword").length) +
        "; unmatched " + String(coverage.filter((e) => e.status === "unmatched").length) +
        ", engine-ignored " + String(coverage.filter((e) => e.status === "ignored").length) + ")",
    ).toBeGreaterThanOrEqual(0.6);
  });
});