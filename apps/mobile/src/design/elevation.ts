/**
 * OpenRank Design System v1 - elevation (Phase 8.1).
 * Dark UI relies on surface contrast + borders + spacing, not big shadows.
 */
export const elevation = {
  low: {
    shadowColor: "#000000",
    shadowOpacity: 0.25,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  medium: {
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
} as const;
