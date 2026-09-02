import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GROUPS } from "@openrank/ranking-core";
import type { CatalogTemplate } from "@openrank/ranking-core";
import type { CatalogExercise, CatalogV1, RawExercise } from "./schema";
import { buildCatalogPipeline } from "./build";
import { classifyCatalog, classifyRankingSupport, templateIdFor } from "./ranking-coverage";

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
const participating = catalog.exercises.filter(
  (e) => e.ranking.support !== "unsupported" && e.ranking.group !== null,
);
const strength = catalog.exercises.filter((e) => e.category === "strength");
const unsupportedStrength = strength.filter((e) => e.ranking.support === "unsupported");
const byId = new Map(coverage.map((e) => [e.exerciseId, e]));
const classified = coverage.filter((e) => e.status === "template" || e.status === "keyword");
const unclassified = coverage.filter((e) => e.status === "unmatched" || e.status === "ignored");

describe("ranking-engine coverage over the generated catalog", () => {
  it("has rank-supported exercises to verify", () => {
    expect(participating.length).toBeGreaterThan(400);
    expect(coverage.length).toBe(participating.length);
  });

  it("embeds engine-backed support metadata in the catalog", () => {
    const bySupport: Record<string, number> = {};
    const byStrategy: Record<string, number> = {};
    for (const e of catalog.exercises) {
      bySupport[e.ranking.support] = (bySupport[e.ranking.support] ?? 0) + 1;
      byStrategy[e.ranking.strategy] = (byStrategy[e.ranking.strategy] ?? 0) + 1;
    }
    // The frozen engine stays authoritative: eligible + provisional are the
    // exercises the engine classifies (Phase 2 coverage: 488).
    expect((bySupport.eligible ?? 0) + (bySupport.provisional ?? 0)).toBe(488);
    expect(byStrategy.template ?? 0).toBe(61);
    expect(byStrategy.curated ?? 0).toBe(8);
    expect(byStrategy.keyword ?? 0).toBe(419);
    // Every unsupported exercise carries an explicit reason.
    for (const e of catalog.exercises) {
      if (e.ranking.support === "unsupported") {
        expect(e.ranking.reason, e.id).toBeTruthy();
        expect(e.ranking.engineGroup, e.id).toBeNull();
      } else {
        expect(e.ranking.engineGroup, e.id).not.toBeNull();
      }
    }
  });

  it("classifies every exercise that has a Hevy alias through the engine catalog", () => {
    // Templates with a primary the engine does not route (e.g. "full_body")
    // are a frozen-engine limitation; they stay unmatched and are documented
    // in the exceptions file.
    const enginePrimaries = new Set(Object.values(GROUPS).flatMap((g) => g.primaries));
    const withAlias = participating.filter((e) => {
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

  it("documents every unsupported strength exercise in the exceptions file", () => {
    // The exceptions file must exactly cover the strength exercises the
    // engine cannot (or deliberately does not) rank.
    const expected = new Set(unsupportedStrength.map((e) => e.id));
    expect([...exceptions].filter((id) => !expected.has(id)), "stale exception entries").toEqual([]);
    expect([...expected].filter((id) => !exceptions.has(id)), "missing exception entries").toEqual([]);
    // Every participating exercise is engine-classified (no undocumented gap).
    expect(
      unclassified.filter((e) => participating.some((p) => p.id === e.exerciseId)),
      "participating exercises cannot be unclassified",
    ).toEqual([]);
  });

  it("classifies the majority of the catalog", () => {
    const ratio = classified.length / participating.length;
    expect(
      ratio,
      "classified " + String(classified.length) + "/" + String(participating.length) +
        " (via Hevy template " + String(coverage.filter((e) => e.status === "template").length) +
        ", via keyword " + String(coverage.filter((e) => e.status === "keyword").length) +
        "; unmatched " + String(coverage.filter((e) => e.status === "unmatched").length) +
        ", engine-ignored " + String(coverage.filter((e) => e.status === "ignored").length) + ")",
    ).toBeGreaterThanOrEqual(0.6);
  });
});

describe("classifyRankingSupport (engine-backed, Phase 3 semantics)", () => {
  function exerciseOf(name: string, primaryMuscles: string[], category = "strength"): CatalogExercise {
    const raw: RawExercise = {
      id: name.replace(/[^a-zA-Z0-9]+/g, "_"),
      name,
      force: "push",
      mechanic: "compound",
      equipment: "barbell",
      primaryMuscles,
      secondaryMuscles: [],
      instructions: [],
      category,
      images: [],
    };
    const { catalog } = buildCatalogPipeline({
      upstream: [raw],
      hevyTemplates: templates,
      source: { name: "test", repositoryUrl: "https://example.test", commit: "deadbeef", license: "Unlicense", datasetSha256: "0".repeat(64) },
      aliasSources: [],
      rankingCompatibility: "test",
    });
    return catalog.exercises[0] as CatalogExercise;
  }

  /** Simulates a curated Hevy bridge: exercise -> a real template id. */
  function bridgeOf(templateTitle: string): (id: string) => string | null {
    const tpl = templates.find((x) => x.title === templateTitle);
    if (!tpl?.id) throw new Error("fixture template not found: " + templateTitle);
    return () => tpl.id as string;
  }

  it("routes an exact engine match to eligible with template strategy", () => {
    const ex = exerciseOf("Bench Press", ["chest"]);
    const support = classifyRankingSupport([ex], templates, {
      curatedExerciseIds: new Set<string>(),
      templateIdOf: bridgeOf("Bench Press (Barbell)"),
    });
    expect(support[ex.id]).toMatchObject({
      support: "eligible",
      strategy: "template",
      engineGroup: "chest",
      reason: null,
    });
  });

  it("marks keyword-classified exercises with agreeing group as eligible", () => {
    const ex = exerciseOf("Barbell Bench Press", ["chest"]);
    const support = classifyRankingSupport([ex], templates, {
      curatedExerciseIds: new Set<string>(),
      templateIdOf: () => null,
    });
    expect(support[ex.id]).toMatchObject({
      support: "eligible",
      strategy: "keyword",
      engineGroup: "chest",
      reason: null,
    });
  });

  it("marks keyword-classified exercises with disagreeing group as provisional", () => {
    // The engine routes the deadlift keyword family to legs; anatomy says back.
    const ex = exerciseOf("Snatch Deadlift", ["middle back"]);
    const support = classifyRankingSupport([ex], templates, {
      curatedExerciseIds: new Set<string>(),
      templateIdOf: () => null,
    });
    expect(support[ex.id]?.support).toBe("provisional");
    expect(support[ex.id]?.strategy).toBe("keyword");
    expect(support[ex.id]?.reason).toContain("disagrees");
  });

  it("marks curated bridges with the curated strategy", () => {
    const ex = exerciseOf("Pull Up", ["lats"]);
    const support = classifyRankingSupport([ex], templates, {
      curatedExerciseIds: new Set([ex.id]),
      templateIdOf: bridgeOf("Pull Up"),
    });
    expect(support[ex.id]).toMatchObject({ support: "eligible", strategy: "curated" });
  });

  it("marks unmatched titles as unsupported with the engine reason", () => {
    const ex = exerciseOf("Zzzqwyx Movement", ["chest"]);
    const support = classifyRankingSupport([ex], templates, {
      curatedExerciseIds: new Set<string>(),
      templateIdOf: () => null,
    });
    expect(support[ex.id]?.support).toBe("unsupported");
    expect(support[ex.id]?.strategy).toBe("none");
    expect(support[ex.id]?.reason).toContain("engine cannot classify");
  });

  it("marks non-strength categories as unsupported without ranking them", () => {
    const ex = exerciseOf("Walking Treadmill", [], "cardio");
    const support = classifyRankingSupport([ex], templates, {
      curatedExerciseIds: new Set<string>(),
      templateIdOf: () => null,
    });
    expect(support[ex.id]).toMatchObject({
      support: "unsupported",
      strategy: "none",
      engineGroup: null,
    });
    expect(support[ex.id]?.reason).toContain("not rank-supported");
  });
});