import fs from "node:fs";
import type { CatalogTemplate } from "../packages/ranking-core/src/index.js";
import type { CatalogV1 } from "../packages/exercise-catalog/src/schema.js";
import { classifyCatalog } from "../packages/exercise-catalog/src/ranking-coverage.js";

const catalog = JSON.parse(fs.readFileSync(new URL("../packages/exercise-catalog/data/catalog.v1.json", import.meta.url), "utf8")) as CatalogV1;
const templates = JSON.parse(fs.readFileSync(new URL("../packages/ranking-core/src/legacy/data/exercise-templates.json", import.meta.url), "utf8")) as CatalogTemplate[];

const coverage = classifyCatalog(catalog, templates);
const out = coverage
  .filter((e) => e.status === "unmatched" || e.status === "ignored")
  .map((e) => ({
    exerciseId: e.exerciseId,
    reason:
      e.status === "ignored"
        ? "ranking engine deliberately skips this activity class (cardio/mobility/conditioning keyword)"
        : "engine cannot classify this title (reason: " + (e.reason ?? "unknown") + "); needs curated mapping (Phase 9) or custom exercise",
  }));
fs.writeFileSync(new URL("../packages/exercise-catalog/data/ranking-coverage-exceptions.json", import.meta.url), JSON.stringify(out, null, 2) + "\n", "utf8");
const count = (s: string): number => coverage.filter((e) => e.status === s).length;
console.log("eligible:", coverage.length, "template:", count("template"), "keyword:", count("keyword"), "unmatched:", count("unmatched"), "ignored:", count("ignored"), "exceptions written:", out.length);

