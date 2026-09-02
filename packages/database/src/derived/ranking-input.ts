/**
 * RankingInputBuilder (Phase 5, spec G): the single pure/testable translation
 * layer from canonical SQLite workout data to ranking-core compatible inputs.
 * No ranking input conversion lives in services or screens.
 *
 * Determinism contract: the same canonical database state always produces
 * byte-identical builder output (stable ORDER BY everywhere; no wall-clock
 * reads; no map-iteration-order dependence).
 *
 * Eligibility filtering (spec F, conservative v1 policy):
 * - unsupported exercises: EXCLUDED from ranking inputs entirely (they keep
 *   full workout logging + PR support; no fabricated rank, no contribution).
 * - provisional exercises: included in the EXERCISE-rank pass (deterministic
 *   engine classification from Phase 2), EXCLUDED from the MUSCLE-aggregation
 *   pass so they never silently influence canonical muscle ranks.
 * - eligible exercises: both passes.
 *
 * Engine catalog note: templates are synthesized for every rankable exercise
 * from its STORED Phase 2 classification (engine group + equipment + title +
 * tracking type). The engine routes by the group's Hevy primary value and
 * still matches coefficients with its own frozen keyword tables - no
 * coefficient is invented here. Keyword inference remains available in the
 * engine but our inputs always carry the stored, verified group.
 */

import { buildCatalog } from "@openrank/ranking-core";
import type { CatalogTemplate, RankCatalog, RankSession } from "@openrank/ranking-core";
import { GROUPS } from "@openrank/ranking-core";
import type { DatabaseDriver } from "../driver";
import type { TrackingType } from "@openrank/domain";

export type EligibilityFilter = "rankable" | "eligible_only";

export interface BuilderExerciseInfo {
  exerciseId: string;
  title: string;
  engineGroup: string;
  eligibility: "eligible" | "provisional";
  strategy: string;
}

export interface RankingInputBuild {
  /** Sessions of completed workouts, chronological (started_at, id). */
  sessions: RankSession[];
  /** Parallel array: session i was produced by this completed workout id. */
  sessionWorkoutIds: string[];
  catalog: RankCatalog;
  /** engine lift title -> exercise metadata (for snapshot attribution). */
  titleToExercise: Map<string, BuilderExerciseInfo>;
  /** Titles shared by multiple distinct exercises - unattributable. */
  ambiguousTitles: Set<string>;
  /** Per-workout: has at least one completed non-warmup set of a rankable exercise? */
  workoutHasRankRelevantSets: Map<string, boolean>;
  /** Catalog fingerprint from catalog_meta (provenance for snapshots). */
  catalogFingerprint: string | null;
}

interface CanonicalSetRow {
  setType: string;
  weightKg: number | null;
  reps: number | null;
  completedAt: string | null;
}

interface CanonicalExerciseRow {
  workoutId: string;
  exerciseId: string;
  position: number;
  name: string;
  trackingType: TrackingType;
  eligibility: string;
  engineGroup: string | null;
  strategy: string;
  equipment: string | null;
  sets: CanonicalSetRow[];
}

export class RankingInputBuilder {
  constructor(private readonly driver: DatabaseDriver) {}

  /**
   * Build the full ranking input for one profile.
   * @param filter "rankable" includes eligible + provisional (exercise-rank
   *               pass); "eligible_only" restricts to eligible (muscle pass).
   */
  build(profileId: string, filter: EligibilityFilter): RankingInputBuild {
    const workouts = this.driver.all(
      "SELECT id, started_at, title FROM workouts " +
        "WHERE profile_id = ? AND status = 'completed' " +
        "ORDER BY started_at, id",
      [profileId],
    ) as Record<string, unknown>[];

    const exerciseRows = this.driver.all(
      "SELECT we.workout_id AS workout_id, we.position AS position, e.id AS exercise_id, " +
        "e.name AS name, e.tracking_type AS tracking_type, e.ranking_eligibility AS eligibility, " +
        "e.ranking_group AS engine_group, e.ranking_strategy AS strategy, e.equipment AS equipment " +
        "FROM workout_exercises we " +
        "JOIN exercises e ON e.id = we.exercise_id " +
        "JOIN workouts w ON w.id = we.workout_id " +
        "WHERE w.profile_id = ? AND w.status = 'completed' " +
        "ORDER BY w.started_at, w.id, we.position",
      [profileId],
    ) as Record<string, unknown>[];

    const setRows = this.driver.all(
      "SELECT we.workout_id AS workout_id, we.position AS we_position, s.set_type AS set_type, " +
        "s.weight_kg AS weight_kg, s.reps AS reps, s.completed_at AS completed_at " +
        "FROM workout_sets s " +
        "JOIN workout_exercises we ON we.id = s.workout_exercise_id " +
        "JOIN workouts w ON w.id = we.workout_id " +
        "WHERE w.profile_id = ? AND w.status = 'completed' " +
        "ORDER BY w.started_at, w.id, we.position, s.position",
      [profileId],
    ) as Record<string, unknown>[];

    // Hevy template ids (Phase 2 alias bridge): exercise_id -> template id.
    const templateIds = new Map<string, string>();
    for (const row of this.driver.all(
      "SELECT exercise_id, source_id FROM exercise_aliases WHERE source = 'hevy-templates' AND source_id IS NOT NULL",
      [],
    ) as Record<string, unknown>[]) {
      templateIds.set(String(row.exercise_id), String(row.source_id));
    }

    // Group canonical sets per (workout, exercise position).
    const setsByExercise = new Map<string, CanonicalSetRow[]>();
    for (const row of setRows) {
      const key = String(row.workout_id) + ":" + String(row.we_position);
      let list = setsByExercise.get(key);
      if (!list) {
        list = [];
        setsByExercise.set(key, list);
      }
      list.push({
        setType: String(row.set_type),
        weightKg: row.weight_kg == null ? null : Number(row.weight_kg),
        reps: row.reps == null ? null : Number(row.reps),
        completedAt: row.completed_at == null ? null : String(row.completed_at),
      });
    }

    // Assemble canonical exercise blocks per workout.
    const exercisesByWorkout = new Map<string, CanonicalExerciseRow[]>();
    for (const row of exerciseRows) {
      const workoutId = String(row.workout_id);
      let list = exercisesByWorkout.get(workoutId);
      if (!list) {
        list = [];
        exercisesByWorkout.set(workoutId, list);
      }
      list.push({
        workoutId,
        exerciseId: String(row.exercise_id),
        position: Number(row.position),
        name: String(row.name),
        trackingType: String(row.tracking_type) as TrackingType,
        eligibility: String(row.eligibility),
        engineGroup: row.engine_group == null ? null : String(row.engine_group),
        strategy: String(row.strategy),
        equipment: row.equipment == null ? null : String(row.equipment),
        sets: setsByExercise.get(workoutId + ":" + String(row.position)) ?? [],
      });
    }

    // Distinct rankable exercises (deduped across workouts), deterministic
    // order by exerciseId. Templates + attribution maps.
    const rankable = new Map<string, CanonicalExerciseRow>();
    for (const list of exercisesByWorkout.values()) {
      for (const ex of list) {
        if (ex.eligibility !== "eligible" && ex.eligibility !== "provisional") continue;
        if (ex.engineGroup == null) continue;
        if (filter === "eligible_only" && ex.eligibility !== "eligible") continue;
        if (!rankable.has(ex.exerciseId)) rankable.set(ex.exerciseId, ex);
      }
    }
    const sortedRankable = [...rankable.values()].sort((a, b) => (a.exerciseId < b.exerciseId ? -1 : a.exerciseId > b.exerciseId ? 1 : 0));

    const templates: CatalogTemplate[] = [];
    const titleToExercise = new Map<string, BuilderExerciseInfo>();
    const ambiguousTitles = new Set<string>();
    for (const ex of sortedRankable) {
      if (titleToExercise.has(ex.name)) {
        ambiguousTitles.add(ex.name);
        continue;
      }
      titleToExercise.set(ex.name, {
        exerciseId: ex.exerciseId,
        title: ex.name,
        engineGroup: ex.engineGroup as string,
        eligibility: ex.eligibility as "eligible" | "provisional",
        strategy: ex.strategy,
      });
      const groupConfig = GROUPS[ex.engineGroup as keyof typeof GROUPS];
      const primary = groupConfig ? groupConfig.primaries[0] : undefined;
      const templateId = templateIds.get(ex.exerciseId);
      templates.push({
        id: templateId ?? ex.exerciseId,
        title: ex.name,
        type: ex.trackingType,
        primary,
        equipment: ex.equipment ?? undefined,
      });
    }

    const sessions: RankSession[] = [];
    const sessionWorkoutIds: string[] = [];
    const workoutHasRankRelevantSets = new Map<string, boolean>();
    for (const w of workouts) {
      const workoutId = String(w.id);
      const startedAt = String(w.started_at);
      const blocks = exercisesByWorkout.get(workoutId) ?? [];
      const engineExercises: RankSession["exercises"] = [];
      let rankRelevant = false;
      for (const ex of blocks) {
        const included =
          (ex.eligibility === "eligible" || ex.eligibility === "provisional") &&
          ex.engineGroup != null &&
          (filter !== "eligible_only" || ex.eligibility === "eligible");
        const qualifyingSets = ex.sets
          .filter((s) => s.completedAt != null && s.setType !== "warmup")
          .map((s) => ({ weight: s.weightKg, reps: s.reps, type: s.setType }));
        if (included && qualifyingSets.length > 0) rankRelevant = true;
        if (!included) continue;
        engineExercises.push({ title: ex.name, type: ex.trackingType, sets: qualifyingSets });
      }
      workoutHasRankRelevantSets.set(workoutId, rankRelevant);
      sessions.push({
        date: startedAt.slice(0, 10),
        title: w.title == null ? "" : String(w.title),
        exercises: engineExercises,
      });
      sessionWorkoutIds.push(workoutId);
    }

    const fingerprintRow = this.driver.get("SELECT value FROM catalog_meta WHERE key = 'fingerprint'", []);
    return {
      sessions,
      sessionWorkoutIds,
      catalog: buildCatalog(templates),
      titleToExercise,
      ambiguousTitles,
      workoutHasRankRelevantSets,
      catalogFingerprint: fingerprintRow ? String(fingerprintRow.value) : null,
    };
  }
}