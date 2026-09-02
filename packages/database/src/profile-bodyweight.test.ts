import { describe, expect, it } from "vitest";
import { deterministicRepos } from "./testing/helpers";

describe("ProfileRepository", () => {
  it("creates a default profile idempotently (first launch)", () => {
    const { repos } = deterministicRepos();
    expect(repos.profile.getDefault()).toBeNull();
    const first = repos.profile.ensureDefault();
    const second = repos.profile.ensureDefault();
    expect(first.id).toBe(second.id);
    expect(first.displayName).toBe("Athlete");
    expect(first.onboardingCompleted).toBe(false);
    expect(first.unitSystem).toBe("metric");
  });

  it("updates unit system, strength standard, display name and onboarding", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    repos.profile.updateUnitSystem(p.id, "imperial");
    repos.profile.updateStrengthStandard(p.id, "female");
    repos.profile.updateDisplayName(p.id, "Milena");
    repos.profile.completeOnboarding(p.id);
    const updated = repos.profile.getDefault()!;
    expect(updated.unitSystem).toBe("imperial");
    expect(updated.strengthStandard).toBe("female");
    expect(updated.displayName).toBe("Milena");
    expect(updated.onboardingCompleted).toBe(true);
  });

  it("rejects updates for an unknown profile id", () => {
    const { repos } = deterministicRepos();
    expect(() => repos.profile.updateUnitSystem("nope", "metric")).toThrow(/not found/);
  });
});

describe("BodyweightRepository", () => {
  it("stores kilograms and returns history newest-first", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    repos.bodyweight.add({ profileId: p.id, measuredAt: "2026-02-01T08:00:00.000Z", weightKg: 82.5, source: "manual" });
    repos.bodyweight.add({ profileId: p.id, measuredAt: "2026-02-03T08:00:00.000Z", weightKg: 82.0, source: "manual" });
    repos.bodyweight.add({ profileId: p.id, measuredAt: "2026-02-02T08:00:00.000Z", weightKg: 82.8, source: "scale" });
    const history = repos.bodyweight.history(p.id);
    expect(history.map((h) => h.measuredAt)).toEqual([
      "2026-02-03T08:00:00.000Z", "2026-02-02T08:00:00.000Z", "2026-02-01T08:00:00.000Z",
    ]);
    expect(history[1]!.weightKg).toBeCloseTo(82.8);
  });

  it("resolves bodyweight: latest at-or-before, else earliest, else null", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    // 3. No data at all -> null (never an assumed bodyweight).
    expect(repos.bodyweight.resolve(p.id, "2026-01-01T00:00:00.000Z")).toBeNull();

    repos.bodyweight.add({ profileId: p.id, measuredAt: "2026-02-01T08:00:00.000Z", weightKg: 82.5, source: "manual" });
    repos.bodyweight.add({ profileId: p.id, measuredAt: "2026-02-10T08:00:00.000Z", weightKg: 81.5, source: "manual" });

    // 1. Latest at or before the instant.
    expect(repos.bodyweight.resolve(p.id, "2026-02-05T00:00:00.000Z")?.weightKg).toBeCloseTo(82.5);
    expect(repos.bodyweight.resolve(p.id, "2026-02-10T08:00:00.000Z")?.weightKg).toBeCloseTo(81.5);

    // 2. Before every measurement -> earliest known.
    expect(repos.bodyweight.resolve(p.id, "2026-01-15T00:00:00.000Z")?.weightKg).toBeCloseTo(82.5);
  });

  it("marks derived state dirty on bodyweight changes", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    const before = repos.dirty.count();
    const entry = repos.bodyweight.add({
      profileId: p.id, measuredAt: "2026-02-01T08:00:00.000Z", weightKg: 82.5, source: "manual",
    });
    const markers = repos.dirty.list();
    // The add contributes the bodyweight marker (profile_changed from
    // ensureDefault is already inside "before").
    expect(repos.dirty.count() - before).toBe(1);
    expect(markers.filter((m) => m.reason === "bodyweight_changed").map((m) => m.entityId)).toContain(entry.id);
  });

  it("rejects non-positive weight", () => {
    const { repos } = deterministicRepos();
    const p = repos.profile.ensureDefault();
    expect(() =>
      repos.bodyweight.add({ profileId: p.id, measuredAt: "2026-02-01T08:00:00.000Z", weightKg: 0, source: "test" }),
    ).toThrow(/positive/);
  });
});