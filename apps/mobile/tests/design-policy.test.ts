import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RANK_COLORS, UNRANKED_COLOR, rankColor } from "../src/design/rank-colors";
import { space, SCREEN_PADDING, CARD_GAP, SECTION_GAP } from "../src/design/spacing";
import { radius } from "../src/design/radii";
import { REDUCED_MOTION_DURATION, animationDuration, shouldAnimate } from "../src/design/motion";
import { RANGE_OPTIONS, rangeToWeeks } from "../src/features/progress/ranges";
import { fieldsForTracking } from "../src/ui/tracking";

/** Read a mobile source file for policy assertions (spec 52 source tests). */
function src(...segments: string[]): string {
  return readFileSync(join(__dirname, "..", "..", "..", ...segments), "utf8");
}
const MOBILE = ["apps", "mobile", "src"];

describe("Phase 8.1 design tokens", () => {
  it("uses the exact approved palette hex values", () => {
    const c = src(...MOBILE, "design", "colors.ts");
    expect(c).toContain('"#0B0D10"'); // BACKGROUND
    expect(c).toContain('"#12151A"'); // SURFACE
    expect(c).toContain('"#181C22"'); // SURFACE_ELEVATED
    expect(c).toContain('"#1D2128"'); // SURFACE_PRESSED
    expect(c).toContain('"#101318"'); // SURFACE_SUBTLE
    expect(c).toContain('"#262B33"'); // BORDER
    expect(c).toContain('"#343A44"'); // BORDER_STRONG
    expect(c).toContain('"#F5F7FA"'); // TEXT_PRIMARY
    expect(c).toContain('"#9CA3AF"'); // TEXT_SECONDARY
    expect(c).toContain('"#6B7280"'); // TEXT_MUTED
    expect(c).toContain('"#4B5563"'); // TEXT_DISABLED
    expect(c).toContain('"#F5B82E"'); // ACCENT
    expect(c).toContain('"#FFBF2F"'); // ACCENT_STRONG
    expect(c).toContain('"#D99A16"'); // ACCENT_PRESSED
    expect(c).toContain('"rgba(245,184,46,0.12)"'); // ACCENT_SUBTLE
    expect(c).toContain('"#22C55E"'); // SUCCESS
    expect(c).toContain('"rgba(34,197,94,0.12)"'); // SUCCESS_SUBTLE
    expect(c).toContain('"#F59E0B"'); // WARNING
    expect(c).toContain('"#EF4444"'); // DANGER
    expect(c).toContain('"rgba(239,68,68,0.12)"'); // DANGER_SUBTLE
    expect(c).toContain('"#60A5FA"'); // INFO
    expect(c).toContain('"rgba(0,0,0,0.60)"'); // overlay
  });

  it("maps every rank tier to its approved color", () => {
    expect(RANK_COLORS.Bronze).toBe("#C97A38");
    expect(RANK_COLORS.Iron).toBe("#8B92A0");
    expect(RANK_COLORS.Gold).toBe("#F5B82E");
    expect(RANK_COLORS.Platinum).toBe("#60A5FA");
    expect(RANK_COLORS.Diamond).toBe("#A78BFA");
    expect(RANK_COLORS.Titan).toBe("#8B5CF6");
    expect(RANK_COLORS.Colossus).toBe("#EC4899");
    expect(RANK_COLORS.Olympian).toBe("#F43F5E");
    expect(RANK_COLORS.Mythic).toBe("#FB7185");
    expect(UNRANKED_COLOR).toBe("#6B7280");
    expect(rankColor("Gold")).toBe("#F5B82E");
    expect(rankColor(null)).toBe(UNRANKED_COLOR);
    expect(rankColor(undefined)).toBe(UNRANKED_COLOR);
    expect(rankColor("NotATier" as never)).toBe(UNRANKED_COLOR);
  });

  it("keeps the spacing scale, screen padding and gaps approved", () => {
    expect(space[1]).toBe(4);
    expect(space[2]).toBe(8);
    expect(space[3]).toBe(12);
    expect(space[4]).toBe(16);
    expect(space[6]).toBe(24);
    expect(space[16]).toBe(64);
    expect(SCREEN_PADDING).toBe(16);
    expect(CARD_GAP).toBe(12);
    expect(SECTION_GAP).toBe(24);
  });

  it("keeps the approved radii scale", () => {
    expect(radius.sm).toBe(8);
    expect(radius.md).toBe(12);
    expect(radius.lg).toBe(16);
    expect(radius.xl).toBe(20);
    expect(radius.pill).toBe(999);
  });
});

describe("Phase 8.1 navigation policy (spec 52)", () => {
  it("renders exactly five primary tabs with Workout central", () => {
    const tabs = src(...MOBILE, "components", "ui", "TabBar.tsx");
    expect(tabs).toContain('"index"');
    expect(tabs).toContain('"history"');
    expect(tabs).toContain('"workout"');
    expect(tabs).toContain('"ranks"');
    expect(tabs).toContain('"profile"');
    // Workout is position 3 of 5 (visually central).
    expect(tabs).toMatch(/workout.*position: 3/s);
    const layout = src(...MOBILE, "app", "(tabs)", "_layout.tsx");
    expect(layout).toContain('name="exercises"');
    expect(layout).toContain("href: null");
  });

  it("keeps the exercise catalog reachable outside the tab bar", () => {
    const home = src(...MOBILE, "app", "(tabs)", "index.tsx");
    expect(home).toContain('"/(tabs)/exercises"');
  });
});

describe("Phase 8.1 semantics policy (spec 52)", () => {
  it("never reinterprets future workouts on Home", () => {
    const home = src(...MOBILE, "app", "(tabs)", "index.tsx");
    expect(home).toContain("resolveHomeSessionView");
    expect(home).toContain("does not move the plan");
    expect(home).toContain("START BONUS WORKOUT");
  });

  it("keeps the rest-day bonus explicit and honest", () => {
    const home = src(...MOBILE, "app", "(tabs)", "index.tsx");
    expect(home).toContain("REST DAY");
    // future / rest states never pretend to be today (no START WORKOUT label
    // outside the today_planned branch is enforced by the view resolver).
    expect(home.match(/START WORKOUT/g)?.length).toBe(1);
  });

  it("renders no overall rank on the Ranks screen", () => {
    const ranks = src(...MOBILE, "app", "(tabs)", "ranks.tsx");
    expect(ranks.toLowerCase()).not.toContain("overall rank score");
    expect(ranks).toContain("no overall");
  });

  it("colors the week strip by state with green only for completed", () => {
    const home = src(...MOBILE, "app", "(tabs)", "index.tsx");
    expect(home).toContain("completed: colors.success");
    expect(home).toContain("planned: colors.textSecondary");
  });

  it("uses the completed-check styling (success token, never bright green rows)", () => {
    const setRow = src(...MOBILE, "features", "workout", "SetRow.tsx");
    expect(setRow).toContain("colors.successSubtle");
    expect(setRow).toContain("colors.success");
    expect(setRow).not.toMatch(/backgroundColor: colors.success(?!Subtle)/);
  });

  it("keeps empty states on History and Progress", () => {
    const history = src(...MOBILE, "app", "(tabs)", "history.tsx");
    expect(history).toContain("No workouts yet");
    const progress = src(...MOBILE, "app", "progress.tsx");
    expect(progress).toContain("No ranks yet");
  });

  it("uses canonical events for PR and RANK UP badges", () => {
    const home = src(...MOBILE, "app", "(tabs)", "index.tsx");
    expect(home).toContain("listEventsForProfile");
    expect(home).toContain("recentRankEvents");
    const active = src(...MOBILE, "features", "workout", "ActiveWorkoutScreen.tsx");
    expect(active).toContain("getWorkoutHighlights");
  });
});

describe("Phase 8.1 tracking-mode columns (spec 25)", () => {
  it("maps tracking modes to honest column labels", () => {
    expect(fieldsForTracking("weight_reps").map((f) => f.label)).toEqual(["kg", "reps"]);
    expect(fieldsForTracking("bodyweight_weighted").map((f) => f.label)).toEqual(["+kg", "reps"]);
    expect(fieldsForTracking("bodyweight_assisted").map((f) => f.label)).toEqual(["kg assist", "reps"]);
    expect(fieldsForTracking("reps_only").map((f) => f.label)).toEqual(["reps"]);
    expect(fieldsForTracking("duration").map((f) => f.label)).toEqual(["min", "sec"]);
    expect(fieldsForTracking("distance_duration").map((f) => f.label)).toEqual(["km", "min", "sec"]);
    // lb display units relabel without changing storage semantics
    expect(fieldsForTracking("weight_reps", "lb").map((f) => f.label)).toEqual(["lb", "reps"]);
    expect(fieldsForTracking("bodyweight_weighted", "lb").map((f) => f.label)).toEqual(["+lb", "reps"]);
  });
});

describe("Phase 8.1 reduced motion (spec 52)", () => {
  it("pure policy: reduced renders final state immediately", () => {
    expect(REDUCED_MOTION_DURATION).toBe(0);
    expect(shouldAnimate(true)).toBe(false);
    expect(shouldAnimate(false)).toBe(true);
    expect(animationDuration(true)).toBe(0);
    expect(animationDuration(false)).toBeGreaterThan(0);
  });
});

describe("Phase 8.1 analytics ranges (spec 52)", () => {
  it("maps range chips to AnalyticsService week counts", () => {
    expect(RANGE_OPTIONS).toEqual(["4W", "12W", "6M", "1Y", "ALL"]);
    expect(rangeToWeeks("4W")).toBe(4);
    expect(rangeToWeeks("12W")).toBe(12);
    expect(rangeToWeeks("6M")).toBe(26);
    expect(rangeToWeeks("1Y")).toBe(52);
    expect(rangeToWeeks("ALL")).toBe(260);
  });
});
