/**
 * OpenRank Design System v1 - barrel (Phase 8.1).
 * Import design primitives from here: "colors", "type", "spacing"/"space",
 * "radius", rank colors, elevation and the reduced-motion policy.
 */

export { colors, palette } from "./colors";
export { type } from "./typography";
export { space, spacing, SCREEN_PADDING, CARD_GAP, SECTION_GAP } from "./spacing";
export { radius } from "./radii";
export { RANK_COLORS, UNRANKED_COLOR, rankColor } from "./rank-colors";
export { elevation } from "./elevation";
export {
  shouldAnimate,
  animationDuration,
  REDUCED_MOTION_DURATION,
} from "./motion";
