/**
 * @openrank/importers - import DTOs and parsers.
 *
 * Status: Phase 9 for parser implementations (Hevy CSV first). The common
 * DTO below is the architecture contract defined now: importers parse files
 * into `ImportedWorkout[]` and NEVER write to SQLite directly. The flow is
 *
 *   file -> parser -> ImportedWorkout[] -> validation -> mapping preview
 *        -> deduplication (fingerprint) -> ImportService -> database
 */
import type { SetType, TrackingType } from "@openrank/domain";

export interface ImportedSet {
  weightKg: number | null;
  reps: number | null;
  durationSeconds: number | null;
  distanceMeters: number | null;
  type?: SetType;
  rpe?: number | null;
  rir?: number | null;
}

export interface ImportedExercise {
  /** Title as it appears in the source file. */
  title: string;
  /** Source-specific template id when available (e.g. Hevy exercise_template_id). */
  templateId?: string;
  trackingType?: TrackingType;
  sets: ImportedSet[];
}

export interface ImportedWorkout {
  externalId?: string;
  /** Source identifier, e.g. "hevy_csv", "openrank_backup". */
  source: string;
  startedAt: string;
  finishedAt?: string;
  name?: string;
  exercises: ImportedExercise[];
}

export type { SetType, TrackingType };
