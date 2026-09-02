import { describe, expect, it } from "vitest";
import { deterministicRepos } from "../testing/helpers";
import { createServices } from "../services";
import type { OpenRankServices } from "../services";
import type { OpenDatabaseResult } from "../index";
import type { DatabaseDriver } from "../driver";

const T = [
  "2026-02-03T10:00:00.000Z",
  "2026-02-05T10:00:00.000Z",
  "2026-02-07T10:00:00.000Z",
  "2026-02-09T10:00:00.000Z",
  "2026-02-11T10:00:00.000Z",
];

interface Ctx {
  driver: DatabaseDriver;
  repos: OpenDatabaseResult;
  services: OpenRankServices;
  profileId: string;
}

function setup(): Ctx {
  const db = deterministicRepos();
  const services = createServices(db.driver, db.repos, {
    now: (() => {
      let n = 0;
      const base = Date.parse("2026-03-01T00:00:00.000Z");
      return () => new Date(base + (n++) * 1000).toISOString();
    })(),
  });
  const profile = db.repos.profile.ensureDefault();
  return { driver: db.driver, repos: db.repos, services, profileId: profile.id };
}

const alias = (ctx: Ctx, name: string) => ctx.repos.exercise.resolveAlias(name)!.id;

/** Representative mixed history: PRs, tier changes, repeat sets, warmups, bw change. */
function buildHistory(ctx: Ctx): void {
  ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: T[0] as string, weightKg: 100, source: "test" });
  const bench = alias(ctx, "Bench Press (Barbell)");
  const squat = alias(ctx, "Squat (Barbell)");
  const fly = (ctx.driver.get(
    "SELECT id FROM exercises WHERE ranking_eligibility = 'eligible' AND ranking_group = 'chest' AND lower(name) LIKE '%fly%' LIMIT 1",
    [],
  ) as { id: string }).id;

  type PlannedSet = { weightKg: number | null; reps: number | null; setType?: "normal" | "warmup" | "drop" | "failure" | "amrap" };
  const plan: Array<{ startedAt: string; exerciseId: string; sets: PlannedSet[] }> = [
    { startedAt: T[0] as string, exerciseId: bench, sets: [{ weightKg: 40, reps: 10, setType: "warmup" as const }, { weightKg: 60, reps: 5 }, { weightKg: 60, reps: 5 }] },
    { startedAt: T[1] as string, exerciseId: bench, sets: [{ weightKg: 62.5, reps: 5 }] },
    { startedAt: T[2] as string, exerciseId: squat, sets: [{ weightKg: 100, reps: 5 }] },
    { startedAt: T[3] as string, exerciseId: bench, sets: [{ weightKg: 65, reps: 5 }] },
    { startedAt: T[4] as string, exerciseId: fly, sets: [{ weightKg: 30, reps: 12 }] },
  ];
  for (const item of plan) {
    const startedAt = item.startedAt;
    const w = ctx.services.workout.startEmptyWorkout(ctx.profileId, { startedAtUtc: startedAt });
    const we = ctx.repos.workout.addExercise(w.id, { exerciseId: item.exerciseId, restSeconds: 0 });
    for (const s of item.sets) {
      ctx.services.workout.addSet(we.id, { setType: s.setType ?? "normal", weightKg: s.weightKg, reps: s.reps }, startedAt);
    }
    ctx.services.workout.finishWorkout(w.id, { finishedAtUtc: startedAt, incompleteSetPolicy: "remove" });
  }
  // A later bodyweight entry (affects only workouts after it):
  ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: "2026-02-10T08:00:00.000Z", weightKg: 104, source: "test" });
}

function normalize(rows: Array<Record<string, unknown>>, drop: string[]): Array<Record<string, unknown>> {
  const cleaned = rows.map((r) => {
    const c: Record<string, unknown> = { ...r };
    for (const d of drop) delete c[d];
    return c;
  });
  cleaned.sort((a, b) => JSON.stringify(a) < JSON.stringify(b) ? -1 : 1);
  return cleaned;
}

function captureDerived(ctx: Ctx): {
  prs: Array<Record<string, unknown>>;
  prEvents: Array<Record<string, unknown>>;
  snaps: Array<Record<string, unknown>>;
  rankEvents: Array<Record<string, unknown>>;
} {
  const prs = normalize(ctx.driver.all("SELECT * FROM personal_records", []) as Record<string, unknown>[], ["id", "created_at", "updated_at"]);
  const prEvents = normalize(ctx.driver.all("SELECT * FROM personal_record_events", []) as Record<string, unknown>[], ["id", "created_at"]);
  const snaps = normalize(ctx.driver.all("SELECT * FROM rank_snapshots", []) as Record<string, unknown>[], ["id"]);
  const rankEvents = normalize(ctx.driver.all("SELECT * FROM rank_events", []) as Record<string, unknown>[], ["id", "created_at"]);
  return { prs, prEvents, snaps, rankEvents };
}

describe("rebuild == incremental parity (spec R)", () => {
  it("rebuildAll over processed history reproduces the identical derived state", () => {
    const ctx = setup();
    buildHistory(ctx);
    ctx.services.derived.processPending();
    const incremental = captureDerived(ctx);
    expect((incremental.prs as unknown[]).length).toBeGreaterThan(0);
    expect((incremental.snaps as unknown[]).length).toBeGreaterThan(0);

    ctx.services.derived.rebuildAll(ctx.profileId);
    const rebuilt = captureDerived(ctx);
    expect(rebuilt).toEqual(incremental);
  });

  it("rebuild-only database equals incrementally-processed database", () => {
    const a = setup();
    buildHistory(a);
    a.services.derived.processPending();
    const aState = captureDerived(a);

    const b = setup();
    buildHistory(b);
    // No processPending: straight to the full rebuild oracle.
    b.services.derived.rebuildAll(b.profileId);
    const bState = captureDerived(b);
    expect(bState).toEqual(aState);
  });

  it("rebuild is idempotent (running it twice changes nothing)", () => {
    const ctx = setup();
    buildHistory(ctx);
    ctx.services.derived.rebuildAll(ctx.profileId);
    const first = captureDerived(ctx);
    ctx.services.derived.rebuildAll(ctx.profileId);
    expect(captureDerived(ctx)).toEqual(first);
  });

  it("canonical workout/bodyweight data is byte-identical after derivation", () => {
    const ctx = setup();
    buildHistory(ctx);
    const canonicalBefore = {
      workouts: ctx.driver.all("SELECT * FROM workouts ORDER BY id", []),
      sets: ctx.driver.all("SELECT * FROM workout_sets ORDER BY id", []),
      bw: ctx.driver.all("SELECT * FROM bodyweight_entries ORDER BY id", []),
    };
    ctx.services.derived.processPending();
    const canonicalAfter = {
      workouts: ctx.driver.all("SELECT * FROM workouts ORDER BY id", []),
      sets: ctx.driver.all("SELECT * FROM workout_sets ORDER BY id", []),
      bw: ctx.driver.all("SELECT * FROM bodyweight_entries ORDER BY id", []),
    };
    expect(canonicalAfter).toEqual(canonicalBefore);
  });
});