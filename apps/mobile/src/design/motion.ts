/**
 * OpenRank Design System v1 - reduced-motion policy (Phase 8.1, spec 43).
 *
 * PURE policy: when the OS reduce-motion preference is on, animations
 * render their final state immediately (duration 0); no animation is ever
 * required to understand state. UI components consult shouldAnimate();
 * the pure function is unit-tested.
 */

export const REDUCED_MOTION_DURATION = 0;
const NORMAL_DURATION = 420;

export function shouldAnimate(reduceMotion: boolean): boolean {
  return !reduceMotion;
}

export function animationDuration(reduceMotion: boolean): number {
  return reduceMotion ? REDUCED_MOTION_DURATION : NORMAL_DURATION;
}
