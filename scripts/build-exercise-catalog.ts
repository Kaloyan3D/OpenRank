/**
 * Build the offline exercise catalog from the pinned upstream dataset.
 *
 * Pipeline (spec section 5):
 *   datasets/sources.lock.json (pinned commit + integrity)
 *   -> vendored Free Exercise DB snapshot (datasets/upstream/free-exercise-db)
 *   -> validation
 *   -> normalization
 *   -> canonical OpenRank exercise schema (+ aliases, ranking hints)
 *   -> packages/exercise-catalog/data/catalog.v1.json (byte-stable)
 *
 * No network access: the upstream snapshot is vendored at the pinned commit.
 * The build fails loudly on validation issues or lock-file drift.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildCatalogPipeline } from "../packages/exercise-catalog/src/build.js";
import { classifyRankingSupport } from "../packages/exercise-catalog/src/ranking-coverage.js";
import type {
  CatalogSourceInfo,
  HevyTemplate,
  RawExercise,
} from "../packages/exercise-catalog/src/schema.js";
import { RANKING_VERSION } from "../packages/ranking-core/src/version.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const LOCK_PATH = resolve(ROOT, "datasets/sources.lock.json");
const UPSTREAM_JSON = resolve(ROOT, "datasets/upstream/free-exercise-db/exercises.json");
const TEMPLATES_JSON = resolve(
  ROOT,
  "packages/ranking-core/src/legacy/data/exercise-templates.json",
);
const OVERRIDES_JSON = resolve(
  ROOT,
  "packages/exercise-catalog/data/hevy-alias-overrides.json",
);
const OUTPUT_PATH = resolve(ROOT, "packages/exercise-catalog/data/catalog.v1.json");

interface SourceLockEntry {
  name: string;
  role: string;
  repositoryUrl: string;
  commit: string;
  license: string;
  vendoredPath: string;
  vendoredSha256: string;
}

interface SourceLock {
  schemaVersion: number;
  sources: SourceLockEntry[];
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function main(): void {
  const lock = JSON.parse(readFileSync(LOCK_PATH, "utf8")) as SourceLock;
  const fdbLock = lock.sources.find((s) => s.name === "free-exercise-db");
  const hevyLock = lock.sources.find((s) => s.name === "hevy-ranks-exercise-templates");
  if (!fdbLock || !hevyLock) throw new Error("sources.lock.json is missing required entries");

  // Integrity gate: the vendored snapshot must match the pinned checksum.
  const actualSha = sha256File(UPSTREAM_JSON);
  if (actualSha !== fdbLock.vendoredSha256) {
    throw new Error(
      "vendored free-exercise-db snapshot does not match sources.lock.json (" +
        actualSha +
        " != " +
        fdbLock.vendoredSha256 +
        ")",
    );
  }

  const upstream = JSON.parse(readFileSync(UPSTREAM_JSON, "utf8")) as RawExercise[];
  const hevyTemplates = JSON.parse(readFileSync(TEMPLATES_JSON, "utf8")) as HevyTemplate[];

  const source: CatalogSourceInfo = {
    name: fdbLock.name,
    repositoryUrl: fdbLock.repositoryUrl,
    commit: fdbLock.commit,
    license: fdbLock.license,
    datasetSha256: actualSha,
  };
  const aliasSource: CatalogSourceInfo = {
    name: hevyLock.name,
    repositoryUrl: hevyLock.repositoryUrl,
    commit: hevyLock.commit,
    license: hevyLock.license,
    datasetSha256: hevyLock.vendoredSha256,
  };

  const overridesFile = JSON.parse(readFileSync(OVERRIDES_JSON, "utf8")) as {
    overrides: { title: string; exerciseSlug: string }[];
  };

  const { catalog, stats } = buildCatalogPipeline({
    upstream,
    hevyTemplates,
    overrides: overridesFile.overrides,
    source,
    aliasSources: [aliasSource],
    rankingCompatibility: RANKING_VERSION,
    // Phase 3: engine-backed ranking-support classification (frozen engine
    // stays authoritative; no coefficients are invented here).
    classify: ({ exercises, curatedExerciseIds, templateIdOf }) =>
      classifyRankingSupport(exercises, hevyTemplates, {
        curatedExerciseIds,
        templateIdOf,
      }),
  });

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  // Trailing newline; keys are inserted in construction order (stable).
  writeFileSync(OUTPUT_PATH, JSON.stringify(catalog, null, 2) + "\n", "utf8");

  const outSha = sha256File(OUTPUT_PATH);
  console.log(
    "wrote " +
      OUTPUT_PATH +
      " (" +
      stats.exercises +
      " exercises, " +
      stats.aliases.total +
      " aliases) sha256=" +
      outSha,
  );
  console.log("categories:      " + JSON.stringify(stats.byCategory));
  console.log("equipment:       " + JSON.stringify(stats.byEquipment));
  console.log("mechanic:        " + JSON.stringify(stats.byMechanic));
  console.log("trackingType:    " + JSON.stringify(stats.byTrackingType));
  console.log(
    "rank-supported:  " +
      String(stats.rankSupported) +
      " bySupport=" +
      JSON.stringify(stats.bySupport),
  );
  console.log("byStrategy:      " + JSON.stringify(stats.byStrategy));
  console.log("alias sources:   " + JSON.stringify(stats.aliases.bySource));
  console.log("alias kinds:     " + JSON.stringify(stats.aliases.byKind));
  console.log(
    "hevy templates:  " +
      stats.hevyTemplatesMapped +
      " mapped, " +
      stats.hevyTemplatesUnmapped +
      " unmapped, " +
      stats.aliasAmbiguitiesDropped +
      " ambiguous dropped",
  );
  console.log(
    "missing metadata: " + stats.missingInstructions + " without instructions, " + stats.missingImages + " without images",
  );
}

main();