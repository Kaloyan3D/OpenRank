/**
 * @openrank/ranking-core - versioned strength ranking engine.
 *
 * The strict TypeScript port of the Hevy Ranks engine lives in ./port and is
 * the only public implementation. The untouched upstream copy in ./legacy is
 * the characterization baseline exercised by golden tests, not public API.
 *
 * Every ranking calculation result is stamped with RANKING_VERSION.
 */
export { RANKING_VERSION } from "./version.js";
export { RANKING_CONFIG } from "./config.js";
export type {
  OverallRankCalculator,
  OverallRankInput,
  OverallRankResult,
} from "./config.ts";

export {
  GROUPS,
  MIN_SESSIONS,
  RANK_TIERS,
} from "./port/constants.js";
export type {
  CatalogTemplate,
  ExcludedLift,
  GroupConfig,
  GroupKey,
  GroupResult,
  GroupSource,
  Lift,
  MatchStats,
  NextTierInfo,
  NextTierRecommendation,
  RankCatalog,
  RankComputeOptions,
  RankResult,
  RankSex,
  RankSession,
  RankSetInput,
  RankTier,
  UnmatchedDetail,
} from "./port/types.js";

export { estimate1RM, weightForReps } from "./port/math.js";
export { effectiveLoad } from "./port/load.js";
export { sexFactor } from "./port/math.js";
export { inferGroupFromTitle } from "./port/text.js";
export { buildCatalog } from "./port/catalog.js";
export { workoutsToSessions } from "./port/computeRanks.js";
export { computeRanks } from "./rank.js";
export type { VersionedRankResult } from "./rank.js";
export { nextTierRecommendation } from "./port/recommendation.js";
