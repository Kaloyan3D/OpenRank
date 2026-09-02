import { describe, expect, it } from "vitest";
import {
  computeLogicalTrainingDate,
  computeStartLocalDate,
  LOGICAL_DAY_BOUNDARY_MINUTES,
} from "./logical-date";

describe("logical training date (04:00 boundary)", () => {
  it("uses a 04:00 local boundary", () => {
    expect(LOGICAL_DAY_BOUNDARY_MINUTES).toBe(240);
  });

  it("keeps the same local day at or after 04:00", () => {
    // 2026-02-01T10:00:00Z with UTC+0 -> local 10:00 -> same day.
    expect(computeLogicalTrainingDate("2026-02-01T10:00:00.000Z", 0)).toBe("2026-02-01");
    // Exactly 04:00 local belongs to the new day.
    expect(computeLogicalTrainingDate("2026-02-01T04:00:00.000Z", 0)).toBe("2026-02-01");
  });

  it("moves early-morning sessions to the previous training day", () => {
    // 03:59:59 local -> previous day.
    expect(computeLogicalTrainingDate("2026-02-01T03:59:59.000Z", 0)).toBe("2026-01-31");
    // Late-evening session crossing local midnight: 2026-02-01 23:30 local.
    expect(computeLogicalTrainingDate("2026-02-01T23:30:00.000Z", 0)).toBe("2026-02-01");
    // 2026-02-02 01:30 local -> still the 2026-02-01 training day.
    expect(computeLogicalTrainingDate("2026-02-02T01:30:00.000Z", 0)).toBe("2026-02-01");
  });

  it("respects the local UTC offset", () => {
    // UTC+2: 2026-02-01T23:30Z is 2026-02-02 01:30 local -> training day 02-01.
    expect(computeLogicalTrainingDate("2026-02-01T23:30:00.000Z", 120)).toBe("2026-02-01");
    // UTC-5 (New York): 2026-02-02T08:00Z is 03:00 local on 02-02 -> training day 02-01.
    expect(computeLogicalTrainingDate("2026-02-02T08:00:00.000Z", -300)).toBe("2026-02-01");
    // UTC+13 (NZDT): 2026-01-31T12:00Z is 2026-02-01 01:00 local -> training day 01-31.
    expect(computeLogicalTrainingDate("2026-01-31T12:00:00.000Z", 780)).toBe("2026-01-31");
  });

  it("startLocalDate is the plain local calendar date (no boundary shift)", () => {
    expect(computeStartLocalDate("2026-02-02T01:30:00.000Z", 0)).toBe("2026-02-02");
    expect(computeStartLocalDate("2026-02-02T01:30:00.000Z", 0))
      .not.toBe(computeLogicalTrainingDate("2026-02-02T01:30:00.000Z", 0));
  });

  it("month and year boundaries roll correctly", () => {
    // Jan 1st 02:00 local -> Dec 31st training day.
    expect(computeLogicalTrainingDate("2027-01-01T02:00:00.000Z", 0)).toBe("2026-12-31");
    // Leap-day boundary: Mar 1st 03:00 local 2028 -> Feb 29th.
    expect(computeLogicalTrainingDate("2028-03-01T03:00:00.000Z", 0)).toBe("2028-02-29");
  });

  it("rejects invalid input", () => {
    expect(() => computeLogicalTrainingDate("not-a-date", 0)).toThrow(/invalid ISO/);
    expect(() => computeLogicalTrainingDate("2026-02-01T00:00:00.000Z", Number.NaN)).toThrow(/finite/);
  });
});
