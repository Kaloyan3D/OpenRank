/** Formatting helpers for the workout UI (Phase 4). */

/** Seconds -> "52:14" or "1:12:03" (h:mm:ss past one hour). */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const two = (n: number) => (n < 10 ? "0" + String(n) : String(n));
  if (h > 0) return String(h) + ":" + two(m) + ":" + two(sec);
  return String(m) + ":" + two(sec);
}

/** ISO timestamp -> "Mon 3 Feb 2026, 10:00" style local string. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** ISO timestamp -> "Wed, Sep 2" style short journal date (no year/time). */
export function formatDayShort(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

/** Seconds -> "57 min" / "42 s" for summaries. */
export function formatDurationRough(totalSeconds: number): string {
  if (totalSeconds >= 3600) {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.round((totalSeconds % 3600) / 60);
    return m > 0 ? String(h) + " h " + String(m) + " min" : String(h) + " h";
  }
  if (totalSeconds >= 60) return String(Math.round(totalSeconds / 60)) + " min";
  return String(Math.round(totalSeconds)) + " s";
}

/** kg volume -> "7,482 kg" style with thin grouping. */
export function formatVolume(volumeKg: number, unitLabel: string): string {
  return Math.round(volumeKg).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",") + " " + unitLabel;
}
/**
 * Rank display helpers (Phase 5). Formatting only - no ranking math.
 * "Diamond II" for tiers with divisions; "MYTHIC" for the top tier, which
 * has no division or progress representation.
 */
export function formatRankLabel(tierName: string, division: string | null): string {
  if (tierName === "Mythic" || division == null) return "MYTHIC";
  return tierName + " " + division;
}

/** 0..1 -> "42%". */
export function formatProgressPercent(progress: number | null): string {
  if (progress == null) return "-";
  return String(Math.round(Math.min(1, Math.max(0, progress)) * 100)) + "%";
}

/** Canonical kg -> display weight string with unit label. */
export function formatWeight(kg: number, unitLabel: string): string {
  return Math.round(kg * 10) / 10 + " " + unitLabel;
}

/** One-line human summary of a logged set ("60 x 8", "5:00", "5 km 25:30"). */
export function formatSetSummary(
  s: {
    weightKg: number | null;
    reps: number | null;
    durationSeconds: number | null;
    distanceMeters: number | null;
  },
  units: {
    toDisplay: (kg: number | null) => string;
    distanceToDisplay: (m: number | null) => string;
    distanceLabel: string;
  },
): string {
  if (s.reps != null && s.weightKg != null) return units.toDisplay(s.weightKg) + " x " + String(s.reps);
  if (s.reps != null && s.durationSeconds == null) return String(s.reps) + " reps";
  if (s.durationSeconds != null && s.distanceMeters != null) {
    return units.distanceToDisplay(s.distanceMeters) + " " + units.distanceLabel + " " + formatDuration(s.durationSeconds);
  }
  if (s.durationSeconds != null) return formatDuration(s.durationSeconds);
  return "-";
}