/**
 * OpenRank Design System v1 - semantic typography (Phase 8.1).
 * System sans (no font dependency added this phase). Numeric metrics get
 * strong hierarchy; NOT everything is bold.
 */

export const type = {
  display: { fontSize: 38, lineHeight: 44, fontWeight: "700" as const },
  pageTitle: { fontSize: 28, lineHeight: 34, fontWeight: "700" as const },
  sectionTitle: { fontSize: 18, lineHeight: 24, fontWeight: "600" as const },
  cardTitle: { fontSize: 16, lineHeight: 22, fontWeight: "600" as const },
  body: { fontSize: 15, lineHeight: 21, fontWeight: "400" as const },
  bodyStrong: { fontSize: 15, lineHeight: 21, fontWeight: "600" as const },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: "400" as const },
  label: { fontSize: 11, lineHeight: 14, fontWeight: "600" as const },
  metricLarge: { fontSize: 34, lineHeight: 40, fontWeight: "700" as const },
  metricMedium: { fontSize: 24, lineHeight: 30, fontWeight: "700" as const },
  metricSmall: { fontSize: 18, lineHeight: 24, fontWeight: "600" as const },
} as const;

export type TypeToken = keyof typeof type;
