/** Exercise repository (SQLite implementation of the catalog + custom exercises). */

import { normalizeAlias, slugify } from "@openrank/exercise-catalog";
import type {
  CustomExerciseInput,
  Exercise,
  ExerciseAliasItem,
  ExerciseDetail,
  ExerciseMediaItem,
  ExerciseMuscle,
  ExerciseRepository,
  ExerciseSearchOptions,
  MajorGroup,
} from "@openrank/domain";
import type { DatabaseDriver } from "../driver";
import { mapExercise, nowUtc } from "../rows";

export class SqliteExerciseRepository implements ExerciseRepository {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly newId: () => string,
  ) {}

  findById(id: string): Exercise | null {
    const row = this.driver.get("SELECT * FROM exercises WHERE id = ?", [id]);
    return row ? mapExercise(row) : null;
  }

  findBySlug(slug: string): Exercise | null {
    const row = this.driver.get("SELECT * FROM exercises WHERE slug = ?", [slug]);
    return row ? mapExercise(row) : null;
  }

  search(options: ExerciseSearchOptions): Exercise[] {
    // SQL does the structured filtering; the free-text query reuses the
    // Phase 2 tiered matcher (alias exact > alias prefix > name substring)
    // over the filtered candidate set.
    const clauses: string[] = [];
    const params: (string | number | null)[] = [];
    if (options.majorGroup != null) {
      clauses.push(
        "EXISTS (SELECT 1 FROM exercise_muscles em JOIN muscles m ON m.id = em.muscle_id " +
          "WHERE em.exercise_id = exercises.id AND em.role = 'primary' AND m.major_group = ?)",
      );
      params.push(options.majorGroup);
    }
    if (options.equipment !== undefined) {
      // "IS ?" matches both the value and NULL (bind null directly).
      clauses.push("exercises.equipment IS ?");
      params.push(options.equipment);
    }
    if (options.trackingType != null) {
      clauses.push("exercises.tracking_type = ?");
      params.push(options.trackingType);
    }
    if (options.rankSupportedOnly === true) {
      clauses.push("exercises.ranking_eligibility IN ('eligible', 'provisional')");
    }
    const where = clauses.length > 0 ? "WHERE " + clauses.join(" AND ") : "";
    const rows = this.driver.all(
      "SELECT * FROM exercises " + where + " ORDER BY name, id",
      params,
    );
    let results = rows.map(mapExercise);

    const q = options.query ? normalizeAlias(options.query) : "";
    if (q !== "") {
      const aliasIndex = new Map<string, string[]>();
      for (const row of this.driver.all("SELECT exercise_id, normalized_alias FROM exercise_aliases")) {
        const exId = String(row.exercise_id);
        const list = aliasIndex.get(exId) ?? [];
        list.push(String(row.normalized_alias));
        aliasIndex.set(exId, list);
      }
      results = results
        .map((ex) => {
          const aliases = aliasIndex.get(ex.id) ?? [];
          if (normalizeAlias(ex.name) === q || aliases.includes(q)) return { ex, tier: 2 as const };
          if (aliases.some((a) => a.startsWith(q))) return { ex, tier: 1 as const };
          if (normalizeAlias(ex.name).includes(q)) return { ex, tier: 0 as const };
          return null;
        })
        .filter((x): x is { ex: Exercise; tier: 0 | 1 | 2 } => x !== null)
        .sort((a, b2) => b2.tier - a.tier || cmp(a.ex.name, b2.ex.name) || cmp(a.ex.id, b2.ex.id))
        .map((x) => x.ex);
    } else {
      results.sort((a, b2) => cmp(a.name, b2.name) || cmp(a.id, b2.id));
    }
    return options.limit != null ? results.slice(0, options.limit) : results;
  }

  listRankSupported(): Exercise[] {
    return this.driver
      .all(
        "SELECT * FROM exercises WHERE ranking_eligibility IN ('eligible', 'provisional') ORDER BY name, id",
      )
      .map(mapExercise);
  }

  resolveAlias(name: string): Exercise | null {
    const key = normalizeAlias(name);
    if (key === "") return null;
    const alias = this.driver.get(
      "SELECT exercise_id FROM exercise_aliases WHERE normalized_alias = ?",
      [key],
    );
    return alias ? this.findById(String(alias.exercise_id)) : null;
  }

  getMuscles(exerciseId: string): (ExerciseMuscle & { name: string | null })[] {
    return this.driver
      .all(
        "SELECT m.id, m.name, em.role FROM exercise_muscles em " +
          "LEFT JOIN muscles m ON m.id = em.muscle_id WHERE em.exercise_id = ? " +
          "ORDER BY CASE em.role WHEN 'primary' THEN 0 ELSE 1 END, m.id",
        [exerciseId],
      )
      .map((row) => ({
        exerciseId,
        muscleId: String(row.id),
        role: String(row.role) as ExerciseMuscle["role"],
        name: row.name == null ? null : String(row.name),
      }));
  }

  getPrimaryMuscleGroups(exerciseId: string): MajorGroup[] {
    const groups: MajorGroup[] = [];
    for (const row of this.driver.all(
      "SELECT DISTINCT m.major_group FROM exercise_muscles em JOIN muscles m ON m.id = em.muscle_id " +
        "WHERE em.exercise_id = ? AND em.role = 'primary' ORDER BY m.major_group",
      [exerciseId],
    )) {
      if (row.major_group != null) groups.push(String(row.major_group) as MajorGroup);
    }
    return groups;
  }

  getInstructions(exerciseId: string): string[] {
    return this.driver
      .all("SELECT step FROM exercise_instructions WHERE exercise_id = ? ORDER BY position", [exerciseId])
      .map((row) => String(row.step));
  }

  getMedia(exerciseId: string): ExerciseMediaItem[] {
    return this.driver
      .all("SELECT * FROM exercise_media WHERE exercise_id = ? ORDER BY id", [exerciseId])
      .map((row) => ({
        id: String(row.id),
        exerciseId: String(row.exercise_id),
        kind: String(row.kind),
        localPath: row.local_path == null ? null : String(row.local_path),
        remoteUrl: row.remote_url == null ? null : String(row.remote_url),
        source: String(row.source),
        license: row.license == null ? null : String(row.license),
        attribution: row.attribution == null ? null : String(row.attribution),
      }));
  }

  getAliases(exerciseId: string): ExerciseAliasItem[] {
    return this.driver
      .all(
        "SELECT id, alias, normalized_alias, source FROM exercise_aliases WHERE exercise_id = ? " +
          "ORDER BY source, alias",
        [exerciseId],
      )
      .map((row) => ({
        id: String(row.id),
        alias: String(row.alias),
        normalizedAlias: String(row.normalized_alias),
        source: String(row.source),
      }));
  }

  getDetail(exerciseId: string): ExerciseDetail | null {
    const exercise = this.findById(exerciseId);
    if (!exercise) return null;
    const muscles = this.getMuscles(exerciseId);
    return {
      exercise,
      muscles,
      primaryMuscles: muscles.filter((m) => m.role === "primary").map((m) => m.muscleId),
      secondaryMuscles: muscles.filter((m) => m.role === "secondary").map((m) => m.muscleId),
      instructions: this.getInstructions(exerciseId),
      media: this.getMedia(exerciseId),
      aliases: this.getAliases(exerciseId),
    };
  }

  createCustom(input: CustomExerciseInput): Exercise {
    const id = this.newId();
    const now = nowUtc();
    this.driver.transaction(() => {
      const slug = this.uniqueSlug(slugify(input.name));
      this.driver.run(
        "INSERT INTO exercises (id, slug, name, category, mechanic, force, equipment, tracking_type, " +
          "is_custom, source, source_id, ranking_eligibility, ranking_strategy, ranking_group, " +
          "ranking_reason, created_at, updated_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'user', NULL, 'unsupported', 'none', NULL, ?, ?, ?)",
        [
          id, slug, input.name, input.category, input.mechanic, input.force, input.equipment,
          input.trackingType, "user-created exercise", now, now,
        ],
      );
      (input.primaryMuscles ?? []).forEach((muscleId, i) => {
        this.driver.run(
          "INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, 'primary')",
          [id, muscleId],
        );
        void i;
      });
      (input.secondaryMuscles ?? []).forEach((muscleId) => {
        this.driver.run(
          "INSERT INTO exercise_muscles (exercise_id, muscle_id, role) VALUES (?, ?, 'secondary')",
          [id, muscleId],
        );
      });
      (input.instructions ?? []).forEach((step, position) => {
        this.driver.run(
          "INSERT INTO exercise_instructions (exercise_id, position, step) VALUES (?, ?, ?)",
          [id, position, step],
        );
      });
      (input.aliases ?? []).forEach((alias) => {
        this.driver.run(
          "INSERT INTO exercise_aliases (id, exercise_id, alias, normalized_alias, locale, source) " +
            "VALUES (?, ?, ?, ?, 'en', 'user')",
          [this.newId(), id, alias, normalizeAlias(alias)],
        );
      });
    });
    const created = this.findById(id);
    if (!created) throw new Error("failed to create custom exercise");
    return created;
  }

  private uniqueSlug(base: string): string {
    let candidate = base;
    let n = 1;
    while (this.driver.get("SELECT 1 FROM exercises WHERE slug = ?", [candidate]) != null) {
      n += 1;
      candidate = base + "-" + String(n);
    }
    return candidate;
  }
}

const cmp = (x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0);