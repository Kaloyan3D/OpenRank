/**
 * Rest timer service (Phase 4, tasks O/P).
 *
 * Authoritative state is the persisted `ends_at` instant (rest_timer table,
 * migration v2) - never a ticking counter in React state. The visible
 * remaining time is derived on every read from the caller's clock, so the
 * timer keeps running while the app is backgrounded, survives navigation
 * and survives process death.
 */

import type { RestTimerRepository, RestTimerState } from "@openrank/domain";
import type { DatabaseDriver } from "../driver";
import { nowUtc } from "../rows";

export class RestTimerService {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly repo: RestTimerRepository,
    private readonly now: () => string = nowUtc,
  ) {}

  /** Start (or restart) the profile's rest timer. */
  start(
    profileId: string,
    workoutId: string,
    durationSeconds: number,
    workoutExerciseId?: string | null,
  ): void {
    this.repo.start(profileId, {
      workoutId,
      workoutExerciseId: workoutExerciseId ?? null,
      durationSeconds,
      startedAtUtc: this.now(),
    });
  }

  /** +15 s / -15 s adjustments (UI chips). */
  addSeconds(profileId: string, seconds: number): void {
    this.driver.transaction(() => {
      this.repo.adjustEnd(profileId, seconds);
    });
  }

  /** Skip: clear the timer entirely. */
  skip(profileId: string): void {
    this.repo.clear(profileId);
  }

  /** Current state with derived remaining/expired fields, or null. */
  getActive(profileId: string): RestTimerState | null {
    return this.repo.get(profileId, this.now());
  }

  /** Clear when the timer belongs to the given workout (finish/discard). */
  clearForWorkout(profileId: string, workoutId: string): void {
    this.repo.clearIfWorkout(profileId, workoutId);
  }
}
