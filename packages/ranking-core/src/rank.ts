/**
 * Public, version-stamped ranking entry point.
 *
 * The legacy engine's result shape is preserved exactly and extended with
 * rankingVersion (spec section 10: every ranking calculation must include the
 * ranking version that produced it). Golden compatibility comparisons strip
 * the extra field - see src/testing/normalize.ts.
 */
import { computeRankGroups } from "./port/computeRanks.js";
import type {
  RankCatalog,
  RankComputeOptions,
  RankResult,
  RankSession,
} from "./port/types.js";
import { RANKING_VERSION } from "./version.js";

export type VersionedRankResult = RankResult & { rankingVersion: string };

export function computeRanks(
  sessions: readonly RankSession[],
  catalog: RankCatalog,
  opts: RankComputeOptions = {},
): VersionedRankResult {
  return { ...computeRankGroups(sessions, catalog, opts), rankingVersion: RANKING_VERSION };
}
