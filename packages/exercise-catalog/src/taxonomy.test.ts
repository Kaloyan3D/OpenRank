import { describe, expect, it } from "vitest";
import {
  FREE_DB_MUSCLE_TO_ID,
  MAJOR_GROUPS,
  MUSCLES,
  MUSCLES_BY_GROUP,
  MUSCLE_IDS,
  majorGroupForMuscles,
} from "./taxonomy";

describe("muscle taxonomy", () => {
  it("has unique muscle ids", () => {
    expect(new Set(MUSCLES.map((m) => m.id)).size).toBe(MUSCLES.length);
  });
  it("exposes exactly the six major rank groups", () => {
    expect([...MAJOR_GROUPS].sort()).toEqual(["arms", "back", "chest", "core", "legs", "shoulders"]);
  });
  it("maps every muscle into exactly one major group", () => {
    const grouped = Object.values(MUSCLES_BY_GROUP).flat();
    expect(grouped.length).toBe(MUSCLES.length);
    expect(new Set(grouped).size).toBe(MUSCLES.length);
  });
  it("aligns with ranking-core group keys", async () => {
    const ranking = await import("@openrank/ranking-core");
    expect([...MAJOR_GROUPS].sort()).toEqual(Object.keys(ranking.GROUPS).sort());
  });
  it("maps the Free Exercise DB muscle names onto canonical ids", () => {
    expect(FREE_DB_MUSCLE_TO_ID["middle back"]).toBe("upper_back");
    expect(FREE_DB_MUSCLE_TO_ID["lower back"]).toBe("lower_back");
    for (const id of Object.values(FREE_DB_MUSCLE_TO_ID)) {
      expect(MUSCLE_IDS.has(id)).toBe(true);
    }
  });
  it("derives the major group from primary muscles", () => {
    expect(majorGroupForMuscles(["quadriceps"])).toBe("legs");
    expect(majorGroupForMuscles(["chest"])).toBe("chest");
    expect(majorGroupForMuscles(["abdominals"])).toBe("core");
    expect(majorGroupForMuscles([])).toBeNull();
  });
});