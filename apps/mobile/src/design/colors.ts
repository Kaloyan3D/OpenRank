/**
 * OpenRank Design System v1 - semantic color tokens (Phase 8.1).
 *
 * Approved direction: DARK ATHLETIC / PREMIUM / UTILITARIAN / SERIOUS /
 * CLEAN. Near-black background, charcoal surfaces, warm amber primary
 * accent. Green is reserved for success/completed states - never brand or
 * navigation. Screens must consume these semantic tokens; raw hex values
 * live ONLY here and in rank-colors.ts.
 */

export const palette = {
  background: "#0B0D10",
  surface: "#12151A",
  surfaceElevated: "#181C22",
  surfacePressed: "#1D2128",
  surfaceSubtle: "#101318",

  border: "#262B33",
  borderStrong: "#343A44",

  textPrimary: "#F5F7FA",
  textSecondary: "#9CA3AF",
  textMuted: "#6B7280",
  textDisabled: "#4B5563",

  accent: "#F5B82E",
  accentStrong: "#FFBF2F",
  accentPressed: "#D99A16",
  accentSubtle: "rgba(245,184,46,0.12)",

  success: "#22C55E",
  successSubtle: "rgba(34,197,94,0.12)",

  warning: "#F59E0B",
  danger: "#EF4444",
  dangerSubtle: "rgba(239,68,68,0.12)",
  info: "#60A5FA",

  overlay: "rgba(0,0,0,0.60)",
} as const;

/**
 * Semantic aliases used across screens. Selection/brand = amber; success =
 * green (completed states only); danger = destructive; info = informational
 * (and Platinum where rank semantics apply).
 */
export const colors = {
  bg: palette.background,
  bgSubtle: palette.surfaceSubtle,
  surface: palette.surface,
  surfaceElevated: palette.surfaceElevated,
  surfacePressed: palette.surfacePressed,

  border: palette.border,
  borderStrong: palette.borderStrong,

  text: palette.textPrimary,
  textSecondary: palette.textSecondary,
  textMuted: palette.textMuted,
  textDisabled: palette.textDisabled,
  textOnAccent: "#0B0D10",

  accent: palette.accent,
  accentStrong: palette.accentStrong,
  accentPressed: palette.accentPressed,
  accentSubtle: palette.accentSubtle,

  success: palette.success,
  successSubtle: palette.successSubtle,
  warning: palette.warning,
  danger: palette.danger,
  dangerSubtle: palette.dangerSubtle,
  info: palette.info,

  overlay: palette.overlay,
} as const;

/**
 * Deterministic subtle plate from a solid hex color (guide section 3.2):
 * shared by badges and rank tints so translucent fills stay consistent.
 */
export function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  if (!m) return hex;
  const r = parseInt(m[1]!.slice(0, 2), 16);
  const g = parseInt(m[1]!.slice(2, 4), 16);
  const b = parseInt(m[1]!.slice(4, 6), 16);
  return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
}

export type ColorToken = keyof typeof colors;
