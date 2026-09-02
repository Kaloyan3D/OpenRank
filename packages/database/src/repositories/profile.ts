/** Profile + bodyweight repositories (SQLite implementation). */

import type {
  BodyweightAddInput,
  BodyweightRepository,
  BodyweightEntry,
  DerivedStateRepository,
  Profile,
  ProfileRepository,
} from "@openrank/domain";
import type { DatabaseDriver } from "../driver";
import { mapBodyweight, mapProfile, nowUtc } from "../rows";

export class SqliteProfileRepository implements ProfileRepository {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly dirty: DerivedStateRepository,
    private readonly newId: () => string,
  ) {}

  getDefault(): Profile | null {
    const row = this.driver.get(
      "SELECT * FROM profiles ORDER BY created_at, id LIMIT 1",
    );
    return row ? mapProfile(row) : null;
  }

  ensureDefault(): Profile {
    const existing = this.getDefault();
    if (existing) return existing;
    const now = nowUtc();
    const id = this.newId();
    this.driver.run(
      "INSERT INTO profiles (id, display_name, strength_standard, unit_system, onboarding_completed, created_at, updated_at) " +
        "VALUES (?, ?, 'male', 'metric', 0, ?, ?)",
      [id, "Athlete", now, now],
    );
    this.dirty.mark(id, "profile", id, "profile_changed");
    const profile = this.getDefault();
    if (!profile) throw new Error("failed to create the default profile");
    return profile;
  }

  updateDisplayName(id: string, displayName: string): void {
    this.update(id, { display_name: displayName });
  }

  updateUnitSystem(id: string, unitSystem: "metric" | "imperial"): void {
    // Display units only - canonical kg and ranking math are unaffected, so
    // this must NOT invalidate derived ranking state (Phase 5 spec rule I).
    this.update(id, { unit_system: unitSystem }, { markDirty: false });
  }

  updateStrengthStandard(id: string, strengthStandard: "male" | "female"): void {
    this.update(id, { strength_standard: strengthStandard });
  }

  completeOnboarding(id: string): void {
    this.update(id, { onboarding_completed: 1 });
  }

  private update(
    id: string,
    fields: Record<string, string | number>,
    opts: { markDirty?: boolean } = {},
  ): void {
    const keys = Object.keys(fields);
    if (keys.length === 0) return;
    const set = keys.map((k) => k + " = ?").join(", ");
    const result = this.driver.run(
      "UPDATE profiles SET " + set + ", updated_at = ? WHERE id = ?",
      [...keys.map((k) => fields[k] as string | number), nowUtc(), id],
    );
    if (result.changes === 0) throw new Error("profile not found: " + id);
    if (opts.markDirty !== false) {
      this.dirty.mark(id, "profile", id, "profile_changed");
    }
  }
}

export class SqliteBodyweightRepository implements BodyweightRepository {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly dirty: DerivedStateRepository,
    private readonly newId: () => string,
  ) {}

  add(input: BodyweightAddInput): BodyweightEntry {
    if (!(input.weightKg > 0) || !Number.isFinite(input.weightKg)) {
      throw new Error("bodyweight must be a positive finite number of kilograms");
    }
    const id = this.newId();
    // Bodyweight feeds the ranking eqRatio - always mark derived state dirty.
    this.driver.transaction(() => {
      this.driver.run(
        "INSERT INTO bodyweight_entries (id, profile_id, measured_at, weight_kg, source, note, created_at) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?)",
        [id, input.profileId, input.measuredAt, input.weightKg, input.source, input.note ?? null, nowUtc()],
      );
      this.dirty.mark(input.profileId, "bodyweight_entry", id, "bodyweight_changed");
    });
    const row = this.driver.get("SELECT * FROM bodyweight_entries WHERE id = ?", [id]);
    if (!row) throw new Error("failed to insert bodyweight entry");
    return mapBodyweight(row);
  }

  history(profileId: string): BodyweightEntry[] {
    return this.driver
      .all("SELECT * FROM bodyweight_entries WHERE profile_id = ? ORDER BY measured_at DESC, id DESC", [profileId])
      .map(mapBodyweight);
  }

  resolve(profileId: string, atUtc: string): BodyweightEntry | null {
    // 1. Latest measurement at or before the requested instant.
    let row = this.driver.get(
      "SELECT * FROM bodyweight_entries WHERE profile_id = ? AND measured_at <= ? " +
        "ORDER BY measured_at DESC, id DESC LIMIT 1",
      [profileId, atUtc],
    );
    // 2. Otherwise the earliest known measurement (never an assumed weight).
    if (!row) {
      row = this.driver.get(
        "SELECT * FROM bodyweight_entries WHERE profile_id = ? ORDER BY measured_at ASC, id ASC LIMIT 1",
        [profileId],
      );
    }
    // 3. Otherwise null.
    return row ? mapBodyweight(row) : null;
  }

  delete(id: string): void {
    const row = this.driver.get("SELECT profile_id FROM bodyweight_entries WHERE id = ?", [id]);
    this.driver.run("DELETE FROM bodyweight_entries WHERE id = ?", [id]);
    if (row?.profile_id != null) {
      this.dirty.mark(String(row.profile_id), "bodyweight_entry", id, "bodyweight_changed");
    }
  }
}