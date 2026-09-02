import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";

/**
 * Reactive OS reduce-motion preference (Phase 8.1, spec 43). Pair with the
 * pure shouldAnimate()/animationDuration() policy in src/design/motion.
 */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let active = true;
    const update = (value: boolean) => {
      if (active) setReduced(value);
    };
    void AccessibilityInfo.isReduceMotionEnabled().then(update).catch(() => {});
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", update);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduced;
}
