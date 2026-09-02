/**
 * OpenRank Design System v1 - spacing scale (Phase 8.1).
 * 4px base grid. Screens use 16px horizontal padding (20 where layout
 * permits); card gaps 12-16; section gaps 24-32. Access numerically
 * (space[4] === 16) or by alias (space.lg === 16).
 */

export const space = {
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

/** Alias for the full scale. */
export const spacing = space;

/** Preferred screen horizontal padding. */
export const SCREEN_PADDING = 16;
/** Primary card gaps. */
export const CARD_GAP = 12;
/** Section gaps. */
export const SECTION_GAP = 24;
