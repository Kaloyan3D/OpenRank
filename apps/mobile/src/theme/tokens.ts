/**
 * Design tokens (display only - no business logic may live in the UI layer).
 */
export const colors = {
  background: "#0e1116",
  surface: "#171b23",
  text: "#e8ecf1",
  textMuted: "#9aa1ab",
  accent: "#5ec8ff",
  success: "#2fe0c8",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const typography = {
  title: { fontSize: 24, fontWeight: "700" as const },
  body: { fontSize: 16 },
  caption: { fontSize: 12, color: colors.textMuted },
} as const;
