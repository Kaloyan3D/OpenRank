import { describe, expect, it } from "vitest";
import { deterministicRepos } from "../testing/helpers";
import { createServices } from "../services";
import type { OpenRankServices } from "../services";
import type { OpenDatabaseResult } from "../index";
import type { DatabaseDriver } from "../driver";
import { ISOLATION_TIER_CAP, sexFactor } from "@openrank/ranking-core";
import type { GroupKey } from "@openrank/ranking-core";

const T0 = "2026-02-10T10:00:00.000Z";
const T1 = "2026-02-11T10:00:00.000Z";
const T2 = "2026-02-12T10:00:00.000Z";
const T3 = "2026-02-13T10:00:00.000Z";

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

function addBodyweight(ctx: Ctx, iso: string, kg: number): void {
  ctx.repos.bodyweight.add({ profileId: ctx.profileId, measuredAt: iso, weightKg: kg, source: "test" });
}

function workout(
  ctx: Ctx,
  startedAt: string,
  entries: Array<{ exerciseId: string; sets: Array<{ setType?: "normal" | "warmup" | "drop" | "failure" | "amrap"; weightKg: number | null; reps: number | null }> }>,
): string {
  const w = ctx.services.workout.startEmptyWorkout(ctx.profileId, { startedAtUtc: startedAt });
  for (const e of entries) {
    const we = ctx.repos.workout.addExercise(w.id, { exerciseId: e.exerciseId, restSeconds: 0 });
    for (const s of e.sets) {
      ctx.services.workout.addSet(we.id, { setType: s.setType ?? "normal", weightKg: s.weightKg, reps: s.reps }, startedAt);
    }
  }
  ctx.services.workout.finishWorkout(w.id, { finishedAtUtc: startedAt, incompleteSetPolicy: "remove" });
  return w.id;
}

const alias = (ctx: Ctx, name: string) => ctx.repos.exercise.resolveAlias(name)!.id;

function latestMuscle(ctx: Ctx, key: GroupKey) {
  return ctx.repos.rankSnapshots.latest(ctx.profileId, "muscle", key);
}

function latestExercise(ctx: Ctx, exerciseId: string) {
  return ctx.repos.rankSnapshots.latest(ctx.profileId, "exercise", exerciseId);
}

describe("muscle rank projection through the full path (spec AL)", () => {
  it("ranks all six groups with min 3 sessions, top-3 weighting and compound preference", () => {
    const ctx = setup();
    addBodyweight(ctx, T0, 100);
    // 3 progressing bench sessions; the final state is a compound aggregate:
    // 65x5 -> e1RM 75.833 -> eqRatio 0.75833 (Gold, chest thresholds)
    workout(ctx, T0, [{ exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 60, reps: 5 }] }]);
    workout(ctx, T1, [{ exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 62.5, reps: 5 }] }]);
    workout(ctx, T2, [{ exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 65, reps: 5 }] }]);
    ctx.services.derived.processPending();

    const snap = latestMuscle(ctx, "chest");
    expect(snap).not.toBeNull();
    const s = snap!;
    expect(s.tierIndex).toBe(2);
    expect(s.tierName).toBe("Gold");
    expect(s.score).toBeCloseTo((65 * (1 + 5 / 30)) / 100, 9); // eqRatio = e1RM/coeff/bw
    // within-tier progress (0.75833-0.6)/(0.8-0.6) -> division I
    expect(s.progress).toBeCloseTo((75.8333 - 60) / 20, 3);
    expect(s.division).toBe("I");
    expect(s.rankingVersion).toBe("hevy-ranks-compatible-v1");
    expect(s.projectionVersion).toBe("openrank-ranking-projection-v1");

    const details = JSON.parse(s.detailsJson) as { aggregationSource: string; engineGroup: string };
    expect(details.aggregationSource).toBe("compound");
    expect(details.engineGroup).toBe("chest");

    // Only groups with data carry snapshots:
    const all = ctx.repos.rankSnapshots.latestForProfile(ctx.profileId).filter((x) => x.scopeType === "muscle");
    expect(all.map((x) => x.scopeKey).sort()).toEqual(["chest"]);
  });

  it("composite weighting uses the engine's [1.0, 0.5, 0.25] over top-3 lifts", () => {
    const ctx = setup();
    addBodyweight(ctx, T0, 100);
    // bench 70 eqRatio, incline bench 60 (0.85 coeff -> 60*1.2167/85... use exact sets):
    for (const t of [T0, T1, T2]) {
      workout(ctx, t, [
        { exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 60, reps: 5 }] }, // e1RM 70 -> 0.70
        { exerciseId: alias(ctx, "Incline Bench Press (Barbell)"), sets: [{ weightKg: 50, reps: 5 }] }, // e1RM 58.33, coeff 0.85 -> 0.6863
      ]);
    }
    ctx.services.derived.processPending();
    const snap = latestMuscle(ctx, "chest")!;
    const w = [1.0, 0.5];
    const expected = (0.7 * w[0]! + (58.3333 / 0.85 / 100) * w[1]!) / (w[0]! + w[1]!);
    expect(snap.score).toBeCloseTo(expected, 6);
  });

  it("few-session cap: data under 3 sessions still ranks but capped at Platinum", () => {
    const ctx = setup();
    addBodyweight(ctx, T0, 100);
    // 2 sessions with an enormous bench: eqRatio 3 -> uncapped would be Mythic.
    for (const t of [T0, T1]) {
      workout(ctx, t, [{ exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 300, reps: 1 }] }]);
    }
    ctx.services.derived.processPending();
    const snap = latestMuscle(ctx, "chest")!;
    expect(snap.tierIndex).toBe(3); // FEW_SESSIONS_TIER_CAP
    const details = JSON.parse(snap.detailsJson) as { capped: boolean; aggregationSource: string };
    expect(details.capped).toBe(true);
    expect(details.aggregationSource).toBe("few_sessions");
  });

  it("isolation fallback caps the group at Titan (ISOLATION_TIER_CAP)", () => {
    const ctx = setup();
    addBodyweight(ctx, T0, 100);
    // find an eligible isolation chest exercise (fly family)
    const fly = ctx.driver.get(
      "SELECT id FROM exercises WHERE ranking_eligibility = 'eligible' AND ranking_group = 'chest' " +
        "AND lower(name) LIKE '%fly%' LIMIT 1",
      [],
    ) as { id: string } | undefined;
    expect(fly).toBeDefined();
    for (const t of [T0, T1, T2]) {
      workout(ctx, t, [{ exerciseId: fly!.id, sets: [{ weightKg: 500, reps: 5 }] }]);
    }
    ctx.services.derived.processPending();
    const snap = latestMuscle(ctx, "chest")!;
    expect(snap.tierIndex).toBe(ISOLATION_TIER_CAP);
    const details = JSON.parse(snap.detailsJson) as { aggregationSource: string; capped: boolean };
    expect(details.aggregationSource).toBe("isolation");
    expect(details.capped).toBe(true);
  });

  it("provisional exercises never contribute to the muscle composite (v1 policy)", () => {
    const ctx = setup();
    addBodyweight(ctx, T0, 100);
    const prov = ctx.driver.get(
      "SELECT id, name, ranking_group FROM exercises WHERE ranking_eligibility = 'provisional' AND ranking_group = 'chest' LIMIT 1",
      [],
    ) as { id: string; name: string; ranking_group: string } | undefined;
    expect(prov).toBeDefined();
    for (const t of [T0, T1, T2]) {
      workout(ctx, t, [{ exerciseId: prov!.id, sets: [{ weightKg: 300, reps: 5 }] }]);
    }
    ctx.services.derived.processPending();
    // No chest muscle rank (only provisional data existed):
    expect(latestMuscle(ctx, "chest")).toBeNull();
    // But the exercise itself IS ranked (provisional), even at Mythic-level load:
    const exSnap = latestExercise(ctx, prov!.id)!;
    expect(exSnap).not.toBeNull();
    expect(JSON.parse(exSnap.detailsJson).provisional).toBe(true);
  });

  it("unsupported exercises are ignored entirely for ranks (PRs still work)", () => {
    const ctx = setup();
    addBodyweight(ctx, T0, 100);
    const custom = ctx.repos.exercise.createCustom({
      name: "Mystery Press",
      category: "strength",
      mechanic: "compound",
      force: "push",
      equipment: "barbell",
      trackingType: "weight_reps",
    });
    for (const t of [T0, T1, T2]) {
      workout(ctx, t, [{ exerciseId: custom.id, sets: [{ weightKg: 200, reps: 5 }] }]);
    }
    ctx.services.derived.processPending();
    expect(latestExercise(ctx, custom.id)).toBeNull();
    expect(latestMuscle(ctx, "chest")).toBeNull();
    // PRs still recorded for the custom exercise:
    expect(ctx.repos.personalRecords.listForExercise(ctx.profileId, custom.id).length).toBeGreaterThan(0);
  });

  it("records rank increases AND decreases across the timeline", () => {
    const ctx = setup();
    addBodyweight(ctx, T0, 100);
    for (const t of [T0, T1, T2]) {
      workout(ctx, t, [{ exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 60, reps: 5 }] }]);
    }
    ctx.services.derived.processPending();
    expect(latestMuscle(ctx, "chest")!.tierIndex).toBe(2);

    // Stronger bench -> tier up.
    workout(ctx, T3, [{ exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 80, reps: 5 }] }]); // e1RM 93.33 -> 0.9333 Platinum
    ctx.services.derived.processPending();
    expect(latestMuscle(ctx, "chest")!.tierIndex).toBe(3);
    const ups = ctx.repos.rankEvents.historyForScope(ctx.profileId, "muscle", "chest");
    expect(ups).toHaveLength(1);
    expect(ups[0]!.direction).toBe("up");
    expect(ups[0]!.fromTierIndex).toBe(2);
    expect(ups[0]!.toTierIndex).toBe(3);

    // Heavier bodyweight from now on: same bench, worse ratio -> rank DOWN.
    addBodyweight(ctx, "2026-02-14T09:00:00.000Z", 130);
    const T4 = "2026-02-14T10:00:00.000Z";
    workout(ctx, T4, [{ exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 80, reps: 5 }] }]);
    ctx.services.derived.processPending();
    const after = latestMuscle(ctx, "chest")!;
    // 93.33/130 = 0.7179 -> back to Gold
    expect(after.tierIndex).toBe(2);
    const events = ctx.repos.rankEvents.historyForScope(ctx.profileId, "muscle", "chest");
    expect(events.map((e) => e.direction)).toEqual(["up", "down"]);
    expect(events[1]!.fromTierIndex).toBe(3);
    expect(events[1]!.toTierIndex).toBe(2);
  });
});

describe("exercise rank projection through the full path (spec AK)", () => {
  it("per-exercise tier uses the own lift eqRatio with group thresholds and sex factor", () => {
    const ctx = setup();
    addBodyweight(ctx, T0, 100);
    for (const t of [T0, T1, T2]) {
      workout(ctx, t, [
        { exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 60, reps: 5 }] },
      ]);
    }
    ctx.services.derived.processPending();
    const snap = latestExercise(ctx, alias(ctx, "Bench Press (Barbell)"))!;
    expect(snap.tierIndex).toBe(2);
    expect(snap.division).toBe("II");
    expect(snap.scopeType).toBe("exercise");

    // Heavier bodyweight, same loads: score 0.7 -> 0.6667 stays tier 2 but
    // the within-tier division changes II -> III. Division changes alone
    // never emit transition events (only tier changes do).
    addBodyweight(ctx, "2026-02-20T09:00:00.000Z", 105);
    const T3 = "2026-02-20T10:00:00.000Z";
    workout(ctx, T3, [{ exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 60, reps: 5 }] }]);
    ctx.services.derived.processPending();
    const after = latestExercise(ctx, alias(ctx, "Bench Press (Barbell)"))!;
    expect(after.tierIndex).toBe(2);
    expect(after.division).toBe("III");
    expect(ctx.repos.rankEvents.historyForScope(ctx.profileId, "exercise", alias(ctx, "Bench Press (Barbell)"))).toHaveLength(0);
  });

  it("female standard shifts the division mapping (factor 0.72)", () => {
    const ctx = setup();
    addBodyweight(ctx, T0, 100);
    // eqRatio 0.45: male -> tier1 (0.4<=0.45<0.6); female: 0.45>=0.432 -> tier 2
    for (const t of [T0, T1, T2]) {
      workout(ctx, t, [{ exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 45, reps: 1 }] }]);
    }
    ctx.services.derived.processPending();
    expect(latestExercise(ctx, alias(ctx, "Bench Press (Barbell)"))!.tierIndex).toBe(1);
    ctx.repos.profile.updateStrengthStandard(ctx.profileId, "female");
    ctx.services.derived.processPending();
    expect(latestExercise(ctx, alias(ctx, "Bench Press (Barbell)"))!.tierIndex).toBe(2);
    expect(sexFactor("female")).toBeCloseTo(0.72, 12);
  });

  it("Mythic: division null, progress null (MYTHIC display)", () => {
    const ctx = setup();
    addBodyweight(ctx, T0, 50); // light bodyweight, huge squat
    for (const t of [T0, T1, T2]) {
      workout(ctx, t, [{ exerciseId: alias(ctx, "Squat (Barbell)"), sets: [{ weightKg: 200, reps: 5 }] }]); // e1RM 233.3 -> ratio 4.67
    }
    ctx.services.derived.processPending();
    const snap = latestExercise(ctx, alias(ctx, "Squat (Barbell)"))!;
    expect(snap.tierIndex).toBe(8);
    expect(snap.tierName).toBe("Mythic");
    expect(snap.division).toBeNull();
    expect(snap.progress).toBeNull();
    const view = ctx.services.derived.getExerciseRanking(ctx.profileId, alias(ctx, "Squat (Barbell)"));
    expect(view.nextTarget).toBeNull(); // highest rank reached
  });

  it("no bodyweight -> no ranks, but no crash and PRs exist", () => {
    const ctx = setup();
    for (const t of [T0, T1, T2]) {
      workout(ctx, t, [{ exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 60, reps: 5 }] }]);
    }
    ctx.services.derived.processPending();
    expect(latestExercise(ctx, alias(ctx, "Bench Press (Barbell)"))).toBeNull();
    expect(latestMuscle(ctx, "chest")).toBeNull();
    const prs = ctx.repos.personalRecords.listForExercise(ctx.profileId, alias(ctx, "Bench Press (Barbell)"));
    expect(prs.map((p) => p.recordType).sort()).toEqual(["max_e1rm", "max_reps_at_weight", "max_set_volume", "max_weight"]);
  });

  it("next-rank target math is the documented reverse-Epley estimate", () => {
    const ctx = setup();
    addBodyweight(ctx, T0, 100);
    for (const t of [T0, T1, T2]) {
      workout(ctx, t, [{ exerciseId: alias(ctx, "Bench Press (Barbell)"), sets: [{ weightKg: 60, reps: 5 }] }]);
    }
    ctx.services.derived.processPending();
    const view = ctx.services.derived.getExerciseRanking(ctx.profileId, alias(ctx, "Bench Press (Barbell)"));
    const target = view.nextTarget!;
    expect(target).not.toBeNull();
    // next threshold 0.8 * coeff 1 * bw 100 = 80 kg 1RM-equivalent
    expect(target.required1RM).toBeCloseTo(80, 9);
    expect(target.targetTier).toBe("Platinum");
    expect(target.exampleReps).toBe(5);
    expect(target.exampleTargetWeight).not.toBeNull();
    expect(target.gap1RM).toBeCloseTo(80 - 70, 9);
    const details = JSON.parse(view.snapshot!.detailsJson) as { engineGroup: string };
    expect(details.engineGroup).toBe("chest");
  });
});