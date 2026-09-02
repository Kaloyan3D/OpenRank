/**
 * StreakService (Phase 6, spec R/S/T/AS).
 *
 * Canonical-first sequencing is preserved: a workout is durable BEFORE any
 * streak processing runs. The dedicated streak_dirty queue (option B - a
 * small, explicitly typed table; cleaner than overloading the strength
 * dirty queue with a second consumer's semantics) carries repair intent:
 * finishWorkout marks it in the same transaction as the canonical commit,
 * processPending consumes it, and failures keep the markers for retry.
 *
 * processPending per profile, in ONE transaction:
 *   1. reconcile the schedule ledger (generation/expiry/pause overlay);
 *   2. match completed workouts to pending obligations (logical training
 *      date, first-qualifying-wins, one workout satisfies one obligation);
 *   3. project the streak (pure computeStreakState over the ledger);
 *   4. delete satisfied markers.
 * Any failure rolls the whole unit back and is reported - restart-safe,
 * retry-safe, idempotent.
 */

import type {
  ScheduledSession,
  StreakCache,
  StreakEvent,
  StreakDirtyRecord,
} from "@openrank/domain";
import type { DatabaseDriver } from "../driver";
import type {
  ScheduleExceptionRepository,
  ScheduledSessionRepository,
  StreakCacheRepository,
  StreakDirtyRepository,
  StreakEventRepository,
  WorkoutRepository,
} from "@openrank/domain";
import type { ScheduleClockOptions, ScheduleService } from "./schedule-service";
import { computeStreakState } from "./streak-engine";

export interface StreakProcessReport {
  profilesProcessed: number;
  sessionsMatched: number;
  processedMarkers: number;
  errors: string[];
}

export interface StreakCurrentState {
  cache: StreakCache;
  lastMissedSessionDate: string | null;
  completedSinceLastMiss: number;
}

export interface StreakServiceRepos {
  sessions: ScheduledSessionRepository;
  exceptions: ScheduleExceptionRepository;
  cache: StreakCacheRepository;
  events: StreakEventRepository;
  dirty: StreakDirtyRepository;
  workout: WorkoutRepository;
}

export class StreakService {
  constructor(
    private readonly driver: DatabaseDriver,
    private readonly repos: StreakServiceRepos,
    private readonly schedule: ScheduleService,
    private readonly now: () => string = () => new Date().toISOString(),
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  /**
   * Consume the repair queue. Failures never propagate: they are reported
   * and the corresponding markers survive (repair happens on the next pass).
   */
  processPending(options: ScheduleClockOptions = {}): StreakProcessReport {
    const report: StreakProcessReport = { profilesProcessed: 0, sessionsMatched: 0, processedMarkers: 0, errors: [] };
    const markers = this.repos.dirty.list();
    if (markers.length === 0) {
      // Still run reconciliation so the rolling horizon stays materialized
      // on every app start (spec H) even without pending markers.
      for (const profileId of this.knownProfiles()) {
        try {
          this.driver.transaction(() => {
            this.schedule.reconcileUpcomingSessions(profileId, options);
          });
          report.profilesProcessed += 1;
        } catch (err) {
          report.errors.push(err instanceof Error ? err.message : String(err));
        }
      }
      return report;
    }
    const byProfile = new Map<string, StreakDirtyRecord[]>();
    for (const marker of markers) {
      const profileId = marker.profileId ?? this.resolveProfile(marker);
      if (!profileId) continue; // unresolvable (e.g. deleted entity): dropped
      const bucket = byProfile.get(profileId) ?? [];
      bucket.push(marker);
      byProfile.set(profileId, bucket);
    }
    for (const [profileId, profileMarkers] of byProfile) {
      try {
        this.driver.transaction(() => {
          // 1. materialize (generation + pause overlay) WITHOUT expiry...
          this.schedule.reconcileUpcomingSessions(profileId, options, { skipExpiry: true });
          // 2. ...so on-time workouts processed late still match (spec BB).
          report.sessionsMatched += this.matchCompletedWorkouts(profileId, profileMarkers);
          // 3. now resolve definitively passed windows (spec N).
          this.schedule.resolveExpiredScheduledSessions(profileId, options);
          // 4. project + release the repair intent.
          this.projectStreak(profileId);
          this.repos.dirty.clear(profileMarkers.map((m) => m.id));
          report.processedMarkers += profileMarkers.length;
        });
        report.profilesProcessed += 1;
      } catch (err) {
        report.errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    return report;
  }

  /** Workout -> obligation matching (spec K/L). Bonus workouts match nothing. */
  private matchCompletedWorkouts(profileId: string, markers: readonly StreakDirtyRecord[]): number {
    let matched = 0;
    for (const marker of markers) {
      if (marker.entityType !== "workout") continue;
      const detail = this.repos.workout.getById(marker.entityId);
      if (!detail || detail.workout.profileId !== profileId) continue;
      if (detail.workout.status !== "completed") continue;
      // Idempotency: already linked?
      if (this.repos.sessions.forWorkout(detail.workout.id)) continue;
      const session = this.repos.sessions.firstPendingOnDate(profileId, detail.workout.logicalTrainingDate);
      if (!session) continue; // bonus workout: no obligation on its logical day
      this.repos.sessions.linkCompletion(session.id, detail.workout.id, detail.workout.finishedAt ?? this.now(), this.now());
      matched += 1;
    }
    return matched;
  }

  /** Pure projection over the ledger; event appends are stable-identity. */
  private projectStreak(profileId: string): StreakCache {
    const sessions = this.repos.sessions.forProfile(profileId);
    const nowTs = this.now();
    const computed = computeStreakState(sessions, nowTs);
    const cache: StreakCache = {
      profileId,
      currentStreak: computed.currentStreak,
      bestStreak: computed.bestStreak,
      perfectWeeks: computed.perfectWeeks,
      lastCompletedSessionId: computed.lastCompletedSessionId,
      recalculatedAt: nowTs,
    };
    this.repos.cache.upsert(cache);
    for (const event of computed.events) {
      this.repos.events.append({ ...event, id: this.newId(), profileId, createdAt: nowTs });
    }
    const marks = new Map(computed.sessionStreaks.map((m) => [m.sessionId, m.streakAfter]));
    for (const session of sessions) {
      if (session.status !== "completed") continue;
      const after = marks.get(session.id) ?? null;
      if (after != null && session.streakAfter !== after) {
        this.repos.sessions.setStreakAfter(session.id, after);
      }
    }
    return cache;
  }

  private knownProfiles(): string[] {
    return this.driver
      .all("SELECT id FROM profiles")
      .map((r) => String(r.id));
  }

  private resolveProfile(marker: StreakDirtyRecord): string | null {
    if (marker.entityType === "workout") {
      const detail = this.repos.workout.getById(marker.entityId);
      return detail?.workout.profileId ?? null;
    }
    return null;
  }

  // ------------------------------------------------------------- reads --

  getCurrentState(profileId: string): StreakCurrentState {
    const sessions = this.repos.sessions.forProfile(profileId);
    const computed = computeStreakState(sessions, this.now());
    const stored = this.repos.cache.get(profileId);
    return {
      cache:
        stored ?? {
          profileId,
          currentStreak: computed.currentStreak,
          bestStreak: computed.bestStreak,
          perfectWeeks: computed.perfectWeeks,
          lastCompletedSessionId: computed.lastCompletedSessionId,
          recalculatedAt: null,
        },
      lastMissedSessionDate: computed.lastMissedSessionDate,
      completedSinceLastMiss: computed.completedSinceLastMiss,
    };
  }

  /** The full ledger, chronological (history UI + "why is my streak X?"). */
  getHistory(profileId: string): ScheduledSession[] {
    return this.repos.sessions.forProfile(profileId);
  }

  getMilestones(profileId: string): StreakEvent[] {
    return this.repos.events.listByType(profileId, "milestone");
  }

  getEvents(profileId: string): StreakEvent[] {
    return this.repos.events.listForProfile(profileId);
  }

  /**
   * Projection-only rebuild (spec T): recompute cache + events from the
   * ledger WITHOUT mutating ledger statuses or matching workouts. Event
   * identity is stable, so repeated rebuilds never duplicate history.
   */
  rebuild(profileId: string): StreakCache {
    return this.driver.transaction(() => this.projectStreak(profileId));
  }

  /** Full rebuild of ALL streak projection state for the profile. */
  rebuildAllStreakState(profileId: string): StreakCache {
    return this.rebuild(profileId);
  }
}