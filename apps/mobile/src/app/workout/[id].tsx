import { ActiveWorkoutScreen } from "../../features/workout/ActiveWorkoutScreen";

/**
 * Active workout route (Phase 7.1): behavior-preserving extraction - the
 * implementation lives in features/workout and routes canonical mutations
 * through WorkoutService. The route remains a thin mount.
 */
export default function WorkoutRoute() {
  return <ActiveWorkoutScreen />;
}
