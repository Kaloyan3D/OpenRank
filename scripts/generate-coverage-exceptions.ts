import fs from "node:fs";
import type { CatalogV1 } from "../packages/exercise-catalog/src/schema.js";

/**
 * Regenerate packages/exercise-catalog/data/ranking-coverage-exceptions.json.
 *
 * Phase 3: the committed catalog embeds engine-backed ranking-support
 * metadata, so the exceptions file is derived directly from it (no engine
 * rerun): every strength exercise whose support is "unsupported" is listed
 * with the reason recorded at build time. A test asserts the file stays in
 * sync with the catalog.
 */
const catalog = JSON.parse(
  fs.readFileSync(
    new URL("../packages/exercise-catalog/data/catalog.v1.json", import.meta.url),
    "utf8",
  ),
) as CatalogV1;

const out = catalog.exercises
  .filter((e) => e.category === "strength" && e.ranking.support === "unsupported")
  .map((e) => ({
    exerciseId: e.id,
    name: e.name,
    anatomicalGroup: e.ranking.group,
    status: (e.ranking.reason ?? "").includes("deliberately skips")
      ? "engine-ignored"
      : "engine-unmatched",
    reason: e.ranking.reason ?? "unknown",
  }));

fs.writeFileSync(
  new URL("../packages/exercise-catalog/data/ranking-coverage-exceptions.json", import.meta.url),
  JSON.stringify(out, null, 2) + "\n",
  "utf8",
);
console.log("exceptions written:", out.length);
