/**
 * Engine-level types for the ranking port.
 *
 * These describe the exact shapes the legacy Hevy Ranks engine produces (the
 * golden fixtures pin them). They are engine types - the canonical domain
 * model lives in `@openrank/domain`.
 */

export type GroupKey = "legs" | "chest" | "back" | "shoulders" | "arms" | "core";

/** The legacy engine accepts any string; "f..." selects female standards. */
export type RankSex = string;

export interface RankTier {
  name: string;
  img: string;
  color: string;
}

export interface GroupConfig {
  key: GroupKey;
  label: string;
  /** Reference lift (coefficient = 1.0). */
  ref: string;
  /** Hevy `primary_muscle_group` values mapped to this group. */
  primaries: string[];
  /** Nine thresholds: reference 1RM equivalent / bodyweight (index = tier). */
  thresholds: number[];
  /** Default coefficient for exercises not matched by keywords. */
  def: number;
}

export interface RankSetInput {
  weight: number | null | undefined;
  reps: number | null | undefined;
  type?: string;
}

export interface RankExerciseInput {
  title: string;
  templateId?: string | null;
  /** Optional exercise-level tracking type (wins over the template type). */
  type?: string;
  sets: RankSetInput[];
}

export interface RankSession {
  date: string;
  title: string;
  exercises: RankExerciseInput[];
}

/** A template from the exercise catalog (see legacy data/exercise-templates.json). */
export interface CatalogTemplate {
  id?: string;
  title?: string;
  type?: string;
  primary?: string;
  equipment?: string;
  secondary?: string[];
}

export interface RankCatalog {
  byId: Map<string, CatalogTemplate>;
  byTitle: Map<string, CatalogTemplate>;
  byCanonical: Map<string, CatalogTemplate>;
  norm: (s: string) => string;
  canon: (title: string) => string | null;
}

/** A single aggregated lift (best set of an exercise across all sessions). */
export interface Lift {
  title: string;
  best1RM: number;
  /** Effective load of the best set. */
  load: number;
  /** Logged reps of the best set (NOT capped - the cap only affects e1RM). */
  reps: number;
  date: string | null;
  coeff: number;
  isolation: boolean;
  sessionsCount: number;
  /** best1RM / coeff / bodyweight (null without bodyweight). */
  eqRatio: number | null;
}

export interface ExcludedLift extends Lift {
  reason: "few_sessions" | "isolation";
}

export interface NextTierInfo {
  tier: RankTier;
  /** Next threshold (reference 1RM equivalent / bodyweight). */
  ratio: number;
  remaining: number;
}

export interface NextTierRecommendation {
  nextTier: RankTier;
  topLift: {
    title: string;
    best1RM: number;
    coeff: number;
    currentReps: number;
  };
  required1RM: number;
  delta1RM: number;
  targetForReps: { reps: number; weight: number };
  currentForReps: { reps: number; weight: number };
  tooFar: boolean;
}

export type GroupSource = "compound" | "isolation" | "few_sessions" | null;

export interface GroupResult {
  group: GroupConfig;
  lifts: Lift[];
  used: Lift[];
  excluded: ExcludedLift[];
  /** Highest-eqRatio lift among `used` (CLI compatibility field). */
  best: Lift | null;
  eqRatio: number | null;
  source: GroupSource;
  capped: boolean;
  hasData: boolean;
  tierIndex: number | null;
  tier: RankTier | null;
  next: NextTierInfo | null;
  progress: number;
  recommendation: NextTierRecommendation | null;
  /**
   * The legacy recommendation function reads `group.bodyweightKg` as a
   * fallback when callers omit `opts.bodyweightKg`; computeRanks never sets
   * it. Kept optional to mirror the legacy dynamic shape exactly.
   */
  bodyweightKg?: number | undefined;
}

export interface MatchStats {
  catalog: number;
  inferred: number;
  total: number;
}

export interface UnmatchedDetail {
  title: string;
  sessions: Set<string>;
  reason: "unknown" | "no_load";
}

export interface RankResult {
  bodyweightKg: number | null;
  sex: string;
  minSessions: number;
  groups: Record<GroupKey, GroupResult>;
  unmatched: Set<string>;
  unmatchedDetails: Map<string, UnmatchedDetail>;
  matchStats: MatchStats;
}

export interface RankComputeOptions {
  bodyweightKg?: number | null;
  sex?: string;
  minSessions?: number;
}
