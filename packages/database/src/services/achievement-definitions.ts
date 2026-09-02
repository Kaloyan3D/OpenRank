/**
 * Phase 8: the achievement catalog. Achievements are DETERMINISTIC
 * PROJECTIONS over canonical + derived data (spec 69): evaluated on read,
 * never written to the database, never canonical, never paywalled, never
 * social. A rebuilt cache reproduces them exactly.
 */

/** Inputs every achievement evaluates against (collected once per read). */
export interface AchievementStats {
  completedWorkouts: number;
  cumulativeVolumeKg: number;
  /** Current standing personal records across all exercises. */
  personalRecords: number;
  bestStreak: number;
  /** Muscle groups holding a rank right now (0..6). */
  rankedGroups: number;
  bodyweightEntries: number;
}

export interface AchievementDefinition {
  id: string;
  label: string;
  description: string;
  /** Plain text glyph (no icon font dependency). */
  glyph: string;
  /** Human-facing target used for progress rendering. */
  target: number;
  /** Which stat the target measures. */
  stat: keyof AchievementStats;
}

export interface AchievementView {
  id: string;
  label: string;
  description: string;
  glyph: string;
  unlocked: boolean;
  /** 0..1 toward the target (1 when unlocked). */
  progress: number;
  current: number;
  target: number;
}

/**
 * The v1 catalog: honest milestone achievements only - no streak-shaming,
 * no daily-streak mechanics (rest days never break anything), no locked
 * ranks, no social comparison.
 */
export const ACHIEVEMENT_DEFINITIONS: readonly AchievementDefinition[] = [
  {
    id: "first_workout",
    label: "First Workout",
    description: "Complete your first workout.",
    glyph: "\u25B6",
    target: 1,
    stat: "completedWorkouts",
  },
  {
    id: "workouts_10",
    label: "Ten Sessions",
    description: "Complete 10 workouts.",
    glyph: "\u25B6\u25B6",
    target: 10,
    stat: "completedWorkouts",
  },
  {
    id: "workouts_25",
    label: "Twenty-Five Sessions",
    description: "Complete 25 workouts.",
    glyph: "\u25B6\u25B6\u25B6",
    target: 25,
    stat: "completedWorkouts",
  },
  {
    id: "volume_10t",
    label: "Ten Tonnes",
    description: "Lift a cumulative 10,000 kg across completed sets.",
    glyph: "\u2B21",
    target: 10000,
    stat: "cumulativeVolumeKg",
  },
  {
    id: "volume_100t",
    label: "Hundred Tonnes",
    description: "Lift a cumulative 100,000 kg across completed sets.",
    glyph: "\u2B21\u2B21",
    target: 100000,
    stat: "cumulativeVolumeKg",
  },
  {
    id: "first_pr",
    label: "First Record",
    description: "Set your first personal record.",
    glyph: "\u2605",
    target: 1,
    stat: "personalRecords",
  },
  {
    id: "prs_25",
    label: "Twenty-Five Records",
    description: "Hold 25 personal records across your exercises.",
    glyph: "\u2605\u2605",
    target: 25,
    stat: "personalRecords",
  },
  {
    id: "streak_4",
    label: "Consistent Month",
    description: "Reach a 4-session scheduled streak.",
    glyph: "\u25C9",
    target: 4,
    stat: "bestStreak",
  },
  {
    id: "streak_12",
    label: "Consistent Quarter",
    description: "Reach a 12-session scheduled streak.",
    glyph: "\u25C9\u25C9",
    target: 12,
    stat: "bestStreak",
  },
  {
    id: "first_rank",
    label: "First Rank",
    description: "Earn your first muscle-group strength rank.",
    glyph: "\u25B2",
    target: 1,
    stat: "rankedGroups",
  },
  {
    id: "all_six_ranks",
    label: "Full Profile",
    description: "Hold a rank in all six muscle groups.",
    glyph: "\u25B2\u25B2",
    target: 6,
    stat: "rankedGroups",
  },
  {
    id: "bodyweight_logged",
    label: "Measured",
    description: "Log a bodyweight measurement.",
    glyph: "\u2696",
    target: 1,
    stat: "bodyweightEntries",
  },
] as const;

/**
 * Pure evaluation: no I/O, no clocks, no writes. Rounding for progress is
 * floor(current / target) clamped to [0, 1] so a chart can never show
 * progress past the unlock point.
 */
export function evaluateAchievements(stats: AchievementStats): AchievementView[] {
  return ACHIEVEMENT_DEFINITIONS.map((def) => {
    const current = stats[def.stat];
    const ratio = def.target > 0 ? current / def.target : 0;
    const progress = Math.max(0, Math.min(1, ratio));
    return {
      id: def.id,
      label: def.label,
      description: def.description,
      glyph: def.glyph,
      unlocked: current >= def.target,
      progress,
      current,
      target: def.target,
    };
  });
}
