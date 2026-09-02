/**
 * Unit display helpers (Phase 4, task AE).
 *
 * Persistence is ALWAYS kilograms / meters / seconds (canonical). Conversions
 * happen only here, using the shared helpers. Round-trip tolerance is covered
 * by packages/shared/src/units.test.ts.
 */

import { useMemo } from "react";
import { kgToLb, lbToKg } from "@openrank/shared";
import type { UnitSystem } from "@openrank/shared";
import { useRepos } from "../db/DatabaseProvider";
import { useCanonicalRevision } from "../local-data/useCanonicalRevision";

export interface Units {
  system: UnitSystem;
  weightLabel: string;
  /** kg (canonical) -> display number string. */
  toDisplay: (kg: number | null) => string;
  /** Display text -> kg (canonical); null when empty/invalid. */
  fromDisplay: (text: string) => number | null;
  /** Distance: canonical meters -> display (km metric / mi imperial). */
  distanceToDisplay: (meters: number | null) => string;
  distanceFromDisplay: (text: string) => number | null;
  distanceLabel: string;
}

const METERS_PER_MILE = 1609.344;

export function useUnits(): Units {
  const repos = useRepos();
  // Canonical invalidation (Phase 8.2): a unit-system change publishes ->
  // every consumer of useUnits re-renders with the persisted system.
  useCanonicalRevision();
  const system = repos.profile.getDefault()?.unitSystem ?? "metric";
  return useMemo(() => buildUnits(system), [system]);
}

function buildUnits(system: UnitSystem): Units {
  if (system === "imperial") {
    return {
      system,
      weightLabel: "lb",
      toDisplay: (kg) => (kg == null ? "" : trimNumber(kgToLb(kg), 1)),
      fromDisplay: (text) => positive(parse(text), (lb) => lbToKg(lb)),
      distanceLabel: "mi",
      distanceToDisplay: (m) => (m == null ? "" : trimNumber(m / METERS_PER_MILE, 2)),
      distanceFromDisplay: (text) => positive(parse(text), (mi) => mi * METERS_PER_MILE),
    };
  }
  return {
    system,
    weightLabel: "kg",
    toDisplay: (kg) => (kg == null ? "" : trimNumber(kg, 1)),
    fromDisplay: (text) => positive(parse(text), (kg) => kg),
    distanceLabel: "km",
    distanceToDisplay: (m) => (m == null ? "" : trimNumber(m / 1000, 2)),
    distanceFromDisplay: (text) => positive(parse(text), (km) => km * 1000),
  };
}

function parse(text: string): number {
  return parseFloat(text.trim().replace(",", "."));
}

function positive(v: number, convert: (n: number) => number): number | null {
  return Number.isFinite(v) && v >= 0 ? convert(v) : null;
}

function trimNumber(v: number, digits: number): string {
  const rounded = Math.round(v * 10 ** digits) / 10 ** digits;
  return String(rounded);
}
