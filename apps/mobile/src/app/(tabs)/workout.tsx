import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  ActiveWorkoutConflictError,
  computeLogicalTrainingDate,
  resolveHomeSessionView,
} from "@openrank/database";
import { GROUPS } from "@openrank/ranking-core";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useCanonicalRevision } from "../../local-data/useCanonicalRevision";
import { countCompletedSets, useNow } from "../../hooks/workout";
import { RestTimerBar } from "../../ui/RestTimerBar";
import { formatDayShort, formatDuration, formatDurationRough } from "../../ui/format";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Divider } from "../../components/ui/Divider";
import { ProgressBar } from "../../components/ui/ProgressBar";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { EmptyState } from "../../components/ui/EmptyState";
import { colors } from "../../design/colors";
import { SCREEN_PADDING, space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Workout hub (Phase 8.2B pass 3, guide sections 18/19/37): the training
 * entry point. An active workout dominates (WORKOUT IN PROGRESS hero with
 * live timer, canonical set progress, RESUME WORKOUT + a visually separated
 * destructive Discard). Otherwise the single hero card answers "what do I
 * train?": today's planned session (TODAY + START WORKOUT), a rest day with
 * the next obligation (START BONUS WORKOUT - bonus stays explicit and never
 * moves the plan), completed or missed today (honest state, explicit bonus),
 * or no applicable session (freestyle first, quiet schedule link). Routines
 * stay a compact secondary list (name, canonical muscle groups, exercise
 * count, START); browse/manage lives behind "Manage".
 *
 * All Phase 6/7.1/8.2 semantics are preserved unchanged:
 *
 * - Today context uses the SAME pure resolver as Home (resolveHomeSessionView),
 *   so the hub can never advertise a future obligation as startable today and
 *   never reinterprets schedule truth.
 * - Start actions flow through WorkoutService; ActiveWorkoutConflictError
 *   keeps the explicit Resume / Discard & start new / Cancel choices - never
 *   silent overwrite. Freestyle (startEmptyWorkout) stays reachable in every
 *   no-active state.
 * - The hub stays mounted across tab switches and re-renders on every
 *   canonical commit via useCanonicalRevision, rereading SQLite during render.
 * - No invented stats: counts, titles and labels derive from canonical rows
 *   only (workout snapshots, routine details, primary muscle groups).
 * - Strength ranks and streaks are separate products (absent here); no
 *   overall rank; green appears only as the completed-state kicker.
 * - Navigation is untouched: Workout is the active tab with its established
 *   solid-amber central treatment; history stays behind the History tab.
 *
 * Visual-review iteration 1 repairs (REVISE, score 7; all findings accepted):
 * F1 - the active state no longer leaves the lower viewport empty: canonical
 *      Session (the active workout's own exercise list) and Recent (last
 *      completed sessions) sections fill it with real training context.
 * F2 - today's planned routine is conveyed while a workout is active via a
 *      quiet TODAY'S PLAN row (only when a pending today obligation exists
 *      and the active session is not already that routine); the Session list
 *      provides the "up next" exercises.
 * F3 - Discard leaves the hero card entirely: outline danger treatment below
 *      the card, separated from RESUME WORKOUT (accidental-tap separation).
 * F4 - audited: no floating settings element exists in the implementation
 *      (no floating/absolute views on this screen; the only bottom UI is the
 *      canonical five-tab bar).
 *
 * Visual-review iteration 2 repairs (REVISE, score 6; F5/F6 accepted):
 * F5 - the no-active lower viewport is recomposed from canonical training
 *      context only: the planned session's own exercise preview ("Today's
 *      plan", only when today has an assigned routine), a quiet canonical
 *      This-week strip (same approved week-strip language as Home, without
 *      the streak), quick routine access (Routines) and a compact Recent
 *      summary (canonical history rows; never a duplicated History feed).
 *      No filler cards, no invented metrics, no ranks/streaks/social.
 * F6 - a scheduled session is no longer titled "Freestyle session" when no
 *      routine is assigned (freestyle is the fallback execution mode, never
 *      an assignment): the hero reads TODAY / Training day / No routine
 *      assigned and states exactly what START WORKOUT does (begins a
 *      freestyle session). A deleted assigned routine says so honestly
 *      instead of crashing startWorkoutFromRoutine (which throws on missing
 *      routines). Rest-day and completed headlines reuse the same honest
 *      session copy.
 *
 * TASK-0010 visual iteration 1 repairs (REVISE, score 7; adjudicated):
 * - This week: rest days render as a quiet empty ring instead of a tiny
 *   dot (the dot read as ambiguous); planned keeps its brighter ring;
 *   completed/missed/paused/rescheduled keep their glyphs. Same canonical
 *   week-state semantics and colors as Home; no legend, no invented states.
 * - Recent: each row gains only canonical secondary descriptors derived
 *   from the logged session (exercise count, completed working-set count)
 *   when they exist - never invented workout types or focus labels. The
 *   "Freestyle session" title stays when nothing canonical differentiates.
 * - Floating gear: adjudicated as the Expo dev-client Tools overlay
 *   (emulator tooling, not product UI) - no product change.
 * - TODAY copy tightened to "No routine assigned. Starts a freestyle
 *   session." - the truthful "Training day" title and the freestyle
 *   execution path are unchanged.
 *
 * TASK-0010 visual iteration 2 repairs (REVISE, score 6; adjudicated):
 * - Recent rows render one uniform canonical format on every entry:
 *   day, duration, exercise count and completed working-set count - honest
 *   zeros included (an unlogged session shows "0 exercises · 0 working
 *   sets" instead of breaking the rhythm).
 * - The no-active state closes with a quiet utility row (Browse exercises,
 *   Training schedule) - Home's approved quick-link pattern - so the
 *   region below Recent is useful navigation, not blank space. The
 *   routine-less hero's own schedule link moved there (one link, one
 *   place). No banners, quotes, or filler.
 * - "Floating gear": still the Expo dev-client Tools overlay (rejected
 *   with deterministic evidence earlier); no product change.
 */

const WEEKDAY_LONG = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const WEEKDAY_SHORT = ["M", "T", "W", "T", "F", "S", "S"] as const;

// Canonical week-strip presentation (shared approved language with Home):
// green marks completed days only; today is the amber weekday letter;
// planned/rest render as rings (planned brighter), never as a bare dot.
const WEEK_STATE_GLYPH: Record<string, string> = {
  completed: "\u2713",
  missed: "\u2715",
  paused: "\u23F8",
  rescheduled: "\u21BB",
};
const WEEK_STATE_LABEL: Record<string, string> = {
  completed: "Completed",
  planned: "Planned",
  rest: "Rest day",
  missed: "Missed",
  paused: "Paused",
  rescheduled: "Rescheduled",
};
const WEEK_STATE_COLOR: Record<string, string> = {
  completed: colors.success,
  planned: colors.textSecondary,
  rest: colors.textMuted,
  missed: colors.danger,
  paused: colors.textMuted,
  rescheduled: colors.textMuted,
};

export default function WorkoutHubScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  // Canonical invalidation (Phase 8.2): start / discard / finish / rest-timer
  // / schedule mutations commit -> revision++ -> the hub re-renders with
  // fresh canonical state.
  useCanonicalRevision();

  const profile = repos.profile.getDefault();
  const active = profile ? services.workout.resumeActiveWorkout(profile.id) : null;
  const rest = profile ? services.restTimer.getActive(profile.id) : null;
  const now = useNow(active != null);
  const elapsedSec = active ? Math.max(0, Math.round((now - Date.parse(active.workout.startedAt)) / 1000)) : 0;

  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Internal state error</Text>
        <Text style={styles.errorMeta}>The local profile is missing. Restart the app to recover.</Text>
      </View>
    );
  }

  const offset = -new Date().getTimezoneOffset();
  const todayLogical = computeLogicalTrainingDate(new Date().toISOString(), offset);
  const schedule = services.schedule.getSchedule(profile.id);
  const week = services.schedule.getWeekState(profile.id, { timezoneOffsetMinutes: offset });
  const upcoming = services.schedule.getUpcomingSessions(profile.id, { timezoneOffsetMinutes: offset });
  const next = upcoming[0] ?? null;
  const stateFor = (date: string) => week.find((d) => d.date === date)?.state ?? "rest";
  const view = resolveHomeSessionView({
    todayLogical,
    todaysState: stateFor(todayLogical),
    next: next ? { id: next.id, scheduledDate: next.scheduledDate } : null,
  });

  // Completed-session history (canonical): today's entry feeds the TRAINING
  // COMPLETE hero (same reads as Home so both screens agree); the newest
  // entries also fill the active state's Recent section (visual review F1).
  const history = repos.workout.listHistory(profile.id, 5);
  const completedToday = history.find((d) => d.workout.logicalTrainingDate === todayLogical) ?? null;
  const recentSessions = history.slice(0, 3);
  const completedMeta = (() => {
    const workout = completedToday?.workout;
    if (!workout?.finishedAt) return null;
    const seconds = Math.max(0, (Date.parse(workout.finishedAt) - Date.parse(workout.startedAt)) / 1000);
    const workingSets = (completedToday?.exercises ?? []).reduce(
      (n, ex) => n + ex.sets.filter((s) => s.completedAt != null && s.setType !== "warmup").length,
      0,
    );
    if (seconds <= 0 && workingSets === 0) return null;
    const parts: string[] = [];
    if (seconds > 0) parts.push(formatDurationRough(seconds));
    if (workingSets > 0) parts.push(workingSets === 1 ? "1 working set" : String(workingSets) + " working sets");
    return parts.join(" \u00B7 ");
  })();

  const routineTitle = (routineId: string | null) =>
    routineId ? repos.routine.getById(routineId)?.routine.name ?? "Deleted routine" : "Freestyle session";

  const weekdayOf = (scheduledDate: string) =>
    WEEKDAY_LONG[(new Date(scheduledDate + "T00:00:00Z").getUTCDay() + 6) % 7] ?? "";

  /** Unique primary muscle-group labels of a routine ("Chest \u00B7 Shoulders"). */
  const routineGroupsLabel = (routineId: string | null): string | null => {
    if (!routineId) return null;
    const detail = repos.routine.getById(routineId);
    if (!detail) return null;
    const labels: string[] = [];
    for (const re of detail.exercises) {
      for (const group of repos.exercise.getPrimaryMuscleGroups(re.exerciseId)) {
        const label = GROUPS[group]?.label;
        if (label && !labels.includes(label)) labels.push(label);
      }
    }
    return labels.length > 0 ? labels.join(" \u00B7 ") : null;
  };

  const exerciseCountLabel = (n: number) =>
    n === 0 ? "No exercises" : n === 1 ? "1 exercise" : String(n) + " exercises";

  // F6: honest scheduled-session copy. A planned training day may have no
  // routine assigned (weekday enabled without one) or a deleted routine;
  // neither is "Freestyle session" - that is the fallback execution mode,
  // not an assignment. The hero states the truth instead.
  const plannedSessionCopy = (routineId: string | null): { title: string; note: string | null } => {
    if (!routineId) return { title: "Training day", note: "No routine assigned." };
    const detail = repos.routine.getById(routineId);
    if (!detail) return { title: "Training day", note: "The assigned routine was deleted." };
    return { title: detail.routine.name, note: null };
  };
  // The scheduled session's assigned routine, when one actually exists
  // (null for routine-less planned days and for deleted routines).
  const plannedDetail =
    view.kind === "today_planned" && next?.routineId ? repos.routine.getById(next.routineId) : null;

  // Compact secondary routine list: canonical snapshot data only.
  const routines = services.routine.list(profile.id).active.map((r) => {
    const detail = services.routine.get(r.id);
    return { routine: r, exerciseCount: detail.exercises.length, groups: routineGroupsLabel(r.id) };
  });

  // Conflict semantics unchanged: explicit Resume / Discard & start new /
  // Cancel - never a silent overwrite (WorkoutService owns the guarantee).
  const conflictChoices = (start: () => void) => {
    const current = services.workout.resumeActiveWorkout(profile.id);
    Alert.alert("Workout already active", "You already have an active workout.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Discard & start new",
        style: "destructive",
        onPress: () => {
          if (current) services.workout.discardWorkout(current.workout.id);
          start();
        },
      },
      {
        text: "Resume",
        onPress: () => {
          if (current) router.push("/workout/" + current.workout.id);
        },
      },
    ]);
  };

  const guardedStart = (startAttempt: () => void) => {
    try {
      startAttempt();
    } catch (err) {
      if (err instanceof ActiveWorkoutConflictError) {
        conflictChoices(startAttempt);
        return;
      }
      throw err;
    }
  };

  const startEmpty = () =>
    guardedStart(() => {
      const w = services.workout.startEmptyWorkout(profile.id, { timezoneOffsetMinutes: offset });
      router.push("/workout/" + w.id);
    });

  const startPlanned = () =>
    guardedStart(() => {
      if (!next) return;
      const w = next.routineId
        ? services.workout.startWorkoutFromRoutine(profile.id, next.routineId, { timezoneOffsetMinutes: offset })
        : services.workout.startEmptyWorkout(profile.id, { timezoneOffsetMinutes: offset });
      router.push("/workout/" + w.id);
    });

  const startFromRoutine = (routineId: string) =>
    guardedStart(() => {
      const w = services.workout.startWorkoutFromRoutine(profile.id, routineId, { timezoneOffsetMinutes: offset });
      router.push("/workout/" + w.id);
    });

  const openActive = () => {
    if (active) router.push("/workout/" + active.workout.id);
  };

  const discardActive = () => {
    if (!active) return;
    services.workout.discardWorkout(active.workout.id);
  };

  const confirmDiscard = () =>
    Alert.alert("Discard workout?", "This will permanently delete this active workout and its logged sets.", [
      { text: "Cancel", style: "cancel" },
      { text: "Discard", style: "destructive", onPress: discardActive },
    ]);

  // Hero content per state (guide sections 16.4 state discipline applied to
  // the hub, 18.1/18.2 structure). One dominant card, one primary action.
  const sets = active ? countCompletedSets(active.exercises) : null;
  const hero = (() => {
    if (active && sets) {
      const meta =
        active.exercises.length === 0
          ? "Freestyle session"
          : (active.exercises.length === 1 ? "1 exercise" : String(active.exercises.length) + " exercises") +
            " \u00B7 " +
            (sets.total > 0 ? String(sets.done) + " of " + String(sets.total) + " sets done" : "no sets logged yet");
      return (
        <>
          <Kicker tone="accent">WORKOUT IN PROGRESS</Kicker>
          <Text style={styles.heroTitle}>{active.workout.title ?? "Workout"}</Text>
          <Text style={styles.timer}>{formatDuration(elapsedSec)}</Text>
          <Text style={styles.heroMeta}>{meta}</Text>
          {sets.total > 0 ? (
            <View style={styles.progressWrap}>
              <ProgressBar
                value={sets.done / sets.total}
                height={5}
                accessibilityLabel={"Session progress: " + String(sets.done) + " of " + String(sets.total) + " sets completed"}
              />
            </View>
          ) : null}
          <Button
            label="RESUME WORKOUT"
            onPress={openActive}
            fullWidth
            accessibilityLabel={"Resume " + (active.workout.title ?? "workout")}
            style={styles.heroCta}
          />
          {/* F3: destructive discard lives OUTSIDE the hero card - outline
              danger treatment below the card, never adjacent to RESUME. */}
        </>
      );
    }
    if (view.kind === "today_planned" && next) {
      // F6: the hero answers three questions honestly - Is today a planned
      // training day? Is a routine assigned? What does START WORKOUT do?
      // A routine-less (or deleted-routine) planned day says so plainly and
      // never borrows the "Freestyle session" execution-mode label.
      if (!plannedDetail) {
        const copy = plannedSessionCopy(next.routineId);
        return (
          <>
            <Kicker tone="accent">TODAY</Kicker>
            <Text style={styles.heroTitle}>{copy.title}</Text>
            <Text style={styles.heroMeta}>
              {schedule.schedule.enabled
                ? copy.note
                  ? copy.note + " Starts a freestyle session."
                  : "Your planned session is ready."
                : "Schedule is disabled - obligations paused for now."}
            </Text>
            <Button
              label="START WORKOUT"
              onPress={startEmpty}
              fullWidth
              accessibilityLabel="Start today's freestyle workout"
              style={styles.heroCta}
            />
          </>
        );
      }
      const groups = routineGroupsLabel(next.routineId);
      return (
        <>
          <Kicker tone="accent">TODAY</Kicker>
          <Text style={styles.heroTitle}>{plannedDetail.routine.name}</Text>
          <Text style={styles.heroMeta} numberOfLines={2}>
            {schedule.schedule.enabled
              ? [groups, exerciseCountLabel(plannedDetail.exercises.length)].filter(Boolean).join(" \u00B7 ")
              : "Schedule is disabled - obligations paused for now."}
          </Text>
          <Button
            label="START WORKOUT"
            onPress={startPlanned}
            fullWidth
            accessibilityLabel={"Start today's planned workout: " + plannedDetail.routine.name}
            style={styles.heroCta}
          />
          {/* Freestyle stays explicitly reachable beside the planned session. */}
          <Button
            label="Start empty workout"
            variant="secondary"
            size="compact"
            onPress={startEmpty}
            fullWidth
            accessibilityLabel="Start an empty freestyle workout"
            style={styles.heroSecondary}
          />
        </>
      );
    }
    if (view.kind === "future" && next) {
      // Rest day with an upcoming obligation: bonus is the primary action and
      // the bonus-does-not-move-the-plan rule stays as restrained note copy.
      const plannedNext = plannedSessionCopy(next.routineId);
      return (
        <>
          <Kicker tone="neutral">REST DAY</Kicker>
          <Text style={styles.heroEyebrow}>NEXT</Text>
          <Text style={styles.heroTitle}>{weekdayOf(next.scheduledDate) + " \u00B7 " + plannedNext.title}</Text>
          {plannedNext.note ? <Text style={styles.heroMeta}>{plannedNext.note}</Text> : null}
          <Button
            label="START BONUS WORKOUT"
            onPress={startEmpty}
            fullWidth
            accessibilityLabel="Start a bonus workout"
            style={styles.heroCta}
          />
          <Text style={styles.heroNote}>A bonus workout today does not move the plan.</Text>
          <HeroLink label="View plan" accessibilityLabel="Open training schedule" onPress={() => router.push("/schedule")} />
        </>
      );
    }
    if (view.kind === "today_completed") {
      const title = completedToday
        ? routineTitle(completedToday.workout.routineId)
        : next
          ? plannedSessionCopy(next.routineId).title
          : null;
      return (
        <>
          <Kicker tone="success">TRAINING COMPLETE</Kicker>
          {title ? <Text style={styles.heroTitle}>{title}</Text> : null}
          <Text style={styles.heroMeta}>
            {completedMeta ?? "Today's session is done. Bonus training is always welcome."}
          </Text>
          <Button
            label="START BONUS WORKOUT"
            variant="secondary"
            size="compact"
            onPress={startEmpty}
            fullWidth
            accessibilityLabel="Start a bonus workout"
            style={styles.heroCta}
          />
        </>
      );
    }
    if (view.kind === "today_missed") {
      return (
        <>
          <Kicker tone="neutral">MISSED</Kicker>
          <Text style={styles.heroMeta}>
            {"Today's planned session was missed. The next planned session starts a fresh streak - no drama."}
          </Text>
          <Button
            label="START BONUS WORKOUT"
            variant="secondary"
            size="compact"
            onPress={startEmpty}
            fullWidth
            accessibilityLabel="Start a bonus workout"
            style={styles.heroCta}
          />
        </>
      );
    }
    // No applicable planned session (none / schedule disabled / empty plan).
    return (
      <>
        <Kicker tone="neutral">NO PLANNED SESSIONS</Kicker>
        <Text style={styles.heroMeta}>No upcoming planned sessions. Enable training days in your schedule.</Text>
        <Button
          label="START EMPTY WORKOUT"
          onPress={startEmpty}
          fullWidth
          accessibilityLabel="Start an empty freestyle workout"
          style={styles.heroCta}
        />
        <HeroLink
          label="Training schedule"
          accessibilityLabel="Open training schedule"
          onPress={() => router.push("/schedule")}
        />
      </>
    );
  })();

  // F1/F5: recent completed sessions (canonical history summary) - quiet
  // rows close the page in the active state AND in the no-active lower
  // viewport; history navigation stays in the History tab (never a
  // duplicated full History feed).
  const recentSection =
    recentSessions.length > 0 ? (
      <View style={styles.section}>
        <SectionHeader title="Recent" />
        <Card style={styles.listCard}>
          {recentSessions.map((d, i) => {
            const seconds = d.workout.finishedAt
              ? Math.max(0, (Date.parse(d.workout.finishedAt) - Date.parse(d.workout.startedAt)) / 1000)
              : 0;
            // Canonical secondary descriptors on EVERY row (visual review:
            // mixed formats read as an error) - logged exercise count and
            // completed working sets, honest zeros included. Never invented
            // workout types or focus labels.
            const loggedExercises = d.exercises.length;
            const workingSets = d.exercises.reduce(
              (n, ex) => n + ex.sets.filter((s) => s.completedAt != null && s.setType !== "warmup").length,
              0,
            );
            return (
              <View key={d.workout.id}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.recentRow}>
                  <View style={styles.routineBody}>
                    <Text style={styles.routineName}>{d.workout.title ?? routineTitle(d.workout.routineId)}</Text>
                    <Text style={styles.routineMeta} numberOfLines={1}>
                      {formatDayShort(d.workout.startedAt) +
                        (seconds > 0 ? " \u00B7 " + formatDurationRough(seconds) : "") +
                        " \u00B7 " +
                        (loggedExercises === 1 ? "1 exercise" : String(loggedExercises) + " exercises") +
                        " \u00B7 " +
                        (workingSets === 1 ? "1 working set" : String(workingSets) + " working sets")}
                    </Text>
                  </View>
                </View>
              </View>
            );
          })}
        </Card>
      </View>
    ) : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerBlock}>
        <Text style={styles.kicker}>WORKOUT</Text>
        <Text style={styles.title}>{active ? "In progress" : "Start training"}</Text>
      </View>

      <Card variant="hero" style={styles.heroCard}>{hero}</Card>

      {active && rest ? (
        <RestTimerBar
          rest={rest}
          onAdjust={(d) => services.restTimer.addSeconds(profile.id, d)}
          onSkip={() => services.restTimer.skip(profile.id)}
        />
      ) : null}

      {/* F3: destructive discard - secondary, danger tokens, visually separate
          from the primary RESUME action (outside the hero card entirely). */}
      {active ? (
        <Button
          label="Discard workout"
          variant="dangerSubtle"
          size="compact"
          fullWidth
          accessibilityLabel="Discard active workout"
          onPress={confirmDiscard}
        />
      ) : null}

      {/* F2: today's planned routine stays visible while a workout is active -
          quiet informational row, no CTA (a second start is a conflict). */}
      {active && view.kind === "today_planned" && next && active.workout.routineId !== next.routineId ? (
        <Card variant="subtle" style={styles.planCard}>
          <Text style={styles.planLabel}>{"TODAY'S PLAN"}</Text>
          <Text style={styles.planTitle}>{plannedSessionCopy(next.routineId).title}</Text>
        </Card>
      ) : null}

      {/* F1/F2: the active state fills the lower viewport with canonical
          training context - the session's own exercise list ("up next"). */}
      {active ? (
        <View style={styles.section}>
          <SectionHeader title="Session" />
          {active.exercises.length === 0 ? (
            <Card variant="subtle" style={styles.planCard}>
              <Text style={styles.planMeta}>No exercises logged yet.</Text>
            </Card>
          ) : (
            <Card style={styles.listCard}>
              {active.exercises.map((e, i) => {
                const name = repos.exercise.findById(e.workoutExercise.exerciseId)?.name ?? "Exercise";
                const done = e.sets.filter((s) => s.completedAt != null).length;
                return (
                  <View key={e.workoutExercise.id}>
                    {i > 0 ? <Divider /> : null}
                    <Pressable
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={name + " - resume workout"}
                      onPress={openActive}
                      style={styles.routineRow}
                    >
                      <View style={styles.routineBody}>
                        <Text style={styles.routineName}>{name}</Text>
                        <Text style={styles.routineMeta}>
                          {done === 0 ? "No sets yet" : String(done) + " of " + String(e.sets.length) + " sets"}
                        </Text>
                      </View>
                    </Pressable>
                  </View>
                );
              })}
            </Card>
          )}
        </View>
      ) : null}

      {/* F5: no-active lower viewport - canonical plan preview (only when
          today has an assigned routine; a routine-less day is never given
          invented content) and the canonical training week. Compact sections
          that already belong on the hub - no filler cards. */}
      {!active && view.kind === "today_planned" && plannedDetail ? (
        <View style={styles.section}>
          <SectionHeader title="Today's plan" />
          <Card
            style={styles.listCard}
            accessibilityLabel={"Today's planned session: " + plannedDetail.routine.name}
          >
            {plannedDetail.exercises.map((re, i) => {
              const exerciseName = repos.exercise.findById(re.exerciseId)?.name ?? "Exercise";
              const targetSets = re.targets.length;
              return (
                <View key={re.id}>
                  {i > 0 ? <Divider /> : null}
                  <View style={styles.routineRow}>
                    <View style={styles.routineBody}>
                      <Text style={styles.routineName}>{exerciseName}</Text>
                      <Text style={styles.routineMeta}>
                        {targetSets === 0 ? "No target sets" : targetSets === 1 ? "1 set" : String(targetSets) + " sets"}
                      </Text>
                    </View>
                  </View>
                </View>
              );
            })}
          </Card>
        </View>
      ) : null}

      {/* F5: quiet canonical week strip (the approved week-strip language,
          without the streak) - today's training context in one row. */}
      {!active ? (
        <View style={styles.section}>
          <SectionHeader title="This week" />
          <Card style={styles.weekCard}>
            <View style={styles.weekRow}>
              {week.map((day, i) => (
                <View
                  key={day.date}
                  accessible
                  accessibilityLabel={
                    WEEKDAY_LONG[i] + (day.date === todayLogical ? " (today)" : "") + ": " + (WEEK_STATE_LABEL[day.state] ?? day.state)
                  }
                  style={styles.weekCell}
                >
                  <Text
                    style={[
                      styles.weekLetter,
                      day.state === "rest" ? styles.weekLetterMuted : null,
                      day.date === todayLogical ? styles.weekLetterToday : null,
                    ]}
                  >
                    {WEEKDAY_SHORT[i]}
                  </Text>
                  <View style={styles.weekGlyphBox}>
                    {/* Rest = quiet empty ring (a tiny dot read as ambiguous);
                        planned = brighter ring; the other canonical states
                        keep their glyphs. No legend needed. */}
                    {day.state === "planned" || day.state === "rest" ? (
                      <View style={[styles.weekRing, { borderColor: WEEK_STATE_COLOR[day.state] ?? colors.textMuted }]} />
                    ) : (
                      <Text style={[styles.weekGlyph, { color: WEEK_STATE_COLOR[day.state] ?? colors.textMuted }]}>
                        {WEEK_STATE_GLYPH[day.state] ?? "\u00B7"}
                      </Text>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </Card>
        </View>
      ) : null}

      {/* Secondary actions live below the hero; while a workout is active the
          hub stays focused on it (starting another session is a conflict). */}
      {active ? null : (
        <View style={styles.section}>
          <SectionHeader
            title="Routines"
            actionLabel={"Manage \u2192"}
            onAction={() => router.push("/routines")}
            actionAccessibilityLabel="Manage routines"
          />
          {routines.length === 0 ? (
            <EmptyState
              icon="albums-outline"
              title="No routines yet"
              description={"Create a routine to start structured sessions - or just start an empty workout."}
              ctaLabel="Create a routine"
              onCta={() => router.push("/routines")}
              accessibilityLabel="No routines yet"
            />
          ) : (
            <Card style={styles.listCard}>
              {routines.map((entry, i) => (
                <View key={entry.routine.id}>
                  {i > 0 ? <Divider /> : null}
                  <Pressable
                    accessible
                    accessibilityRole="button"
                    accessibilityLabel={"Start workout from routine " + entry.routine.name}
                    onPress={() => startFromRoutine(entry.routine.id)}
                    style={styles.routineRow}
                  >
                    <View style={styles.routineBody}>
                      <Text style={styles.routineName}>{entry.routine.name}</Text>
                      <Text style={styles.routineMeta} numberOfLines={1}>
                        {entry.groups
                          ? entry.groups + " \u00B7 " + exerciseCountLabel(entry.exerciseCount)
                          : exerciseCountLabel(entry.exerciseCount)}
                      </Text>
                    </View>
                    <Text style={styles.routineStart}>START</Text>
                  </Pressable>
                </View>
              ))}
            </Card>
          )}
        </View>
      )}

      {/* F1/F5: recent completed sessions close the page in every state. */}
      {recentSection}

      {/* Visual review (iteration 2): the region below Recent read as blank.
          Close the no-active page with Home's approved quiet utility links -
          real navigation, no banners, no filler. */}
      {!active ? (
        <View style={styles.quickRow}>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Browse exercises"
            onPress={() => router.push("/(tabs)/exercises")}
            style={styles.quickLink}
          >
            <Text style={styles.quickLinkText}>Browse exercises ›</Text>
          </Pressable>
          <Pressable
            accessible
            accessibilityRole="button"
            accessibilityLabel="Open training schedule"
            onPress={() => router.push("/schedule")}
            style={styles.quickLink}
          >
            <Text style={styles.quickLinkText}>Training schedule ›</Text>
          </Pressable>
        </View>
      ) : null}
    </ScrollView>
  );
}

/** Hero eyebrow: tiny caps-style label; color carries the state semantics. */
function Kicker(props: { children: string; tone?: "accent" | "success" | "neutral" }) {
  const color =
    props.tone === "success" ? colors.success : props.tone === "neutral" ? colors.textSecondary : colors.accent;
  return <Text style={[styles.heroKicker, { color }]}>{props.children}</Text>;
}

/** Quiet in-hero action link: chevron affordance + pressed state, 44dp target. */
function HeroLink(props: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      onPress={props.onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.heroLink, pressed ? styles.linkPressed : null]}
    >
      <Text style={styles.heroLinkText}>
        {props.label}
        <Text style={styles.heroLinkChevron}>{" \u203A"}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: SCREEN_PADDING, paddingTop: space[5], gap: space[3], paddingBottom: space[12] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: space[5], gap: space[2] },
  errorTitle: { ...type.cardTitle, color: colors.danger },
  errorMeta: { ...type.caption, color: colors.textMuted, textAlign: "center" },

  headerBlock: { gap: 1, marginBottom: space[1] },
  kicker: { ...type.caption, fontWeight: "600" as const, letterSpacing: 1.2, color: colors.accent },
  title: { ...type.pageTitle, color: colors.text },

  // Hero (guide section 12): the ONE dominant card - compact padding, tight
  // vertical rhythm; the CTA carries the height, not the padding.
  heroCard: { padding: space[4], gap: 2 },
  heroKicker: { ...type.caption, fontWeight: "600" as const, letterSpacing: 1.2 },
  heroTitle: { ...type.metricMedium, fontSize: 22, lineHeight: 28, color: colors.text },
  heroEyebrow: { ...type.label, color: colors.textMuted, letterSpacing: 1, marginTop: 2 },
  heroMeta: { ...type.body, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  heroNote: { ...type.body, fontSize: 13, lineHeight: 18, color: colors.textSecondary, marginTop: space[1] },
  timer: { ...type.metricLarge, color: colors.text, fontVariant: ["tabular-nums"], marginTop: 2 },
  progressWrap: { marginTop: space[2] },
  heroCta: { marginTop: space[2] },
  heroSecondary: { marginTop: space[2] },
  heroLink: { minHeight: 44, marginTop: 2, alignItems: "center", justifyContent: "center" },
  heroLinkText: { ...type.body, fontWeight: "600", color: colors.accent },
  heroLinkChevron: { color: colors.textMuted },
  linkPressed: { opacity: 0.7 },

  section: { gap: space[2] },
  // Grouped routine rows: one surface, subtle separators - not a stack of
  // floating cards (guide sections 9/37).
  listCard: { paddingVertical: space[1], paddingHorizontal: space[4] },
  routineRow: { flexDirection: "row", alignItems: "center", gap: space[3], minHeight: 48, paddingVertical: space[1] },
  routineBody: { flex: 1, gap: 1 },
  routineName: { ...type.bodyStrong, color: colors.text },
  routineMeta: { ...type.caption, color: colors.textMuted },
  routineStart: { ...type.label, color: colors.accent, letterSpacing: 1 },
  // Quiet informational rows (TODAY'S PLAN / empty session note) - subtle
  // surface, no CTA, never competing with the hero (visual review F2).
  planCard: { paddingVertical: space[3], gap: 2 },
  planLabel: { ...type.label, color: colors.textMuted, letterSpacing: 1.2 },
  planTitle: { ...type.bodyStrong, color: colors.text },
  planMeta: { ...type.body, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  // Recent history rows (visual review F1): quiet static information.
  recentRow: { flexDirection: "row", alignItems: "center", paddingVertical: space[2] },

  // Quiet utility links (visual review, iteration 2): Home's approved
  // quick-link pattern as the page terminator - useful navigation, never
  // filler cards.
  quickRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space[2] },
  quickLink: { paddingVertical: space[2], paddingHorizontal: space[1], justifyContent: "center", minHeight: 44 },
  quickLinkText: { ...type.body, fontWeight: "600", color: colors.textSecondary },

  // Canonical week strip (visual review F5) - same approved cell language as
  // Home: today is the amber weekday letter; the glyph is the only state
  // marker (green = completed only, guide section 2).
  weekCard: { paddingVertical: space[3] },
  weekRow: { flexDirection: "row", justifyContent: "space-between" },
  weekCell: { alignItems: "center", flex: 1, gap: 3, paddingBottom: 4 },
  weekLetter: { ...type.label, color: colors.textSecondary, width: "100%", textAlign: "center" },
  weekLetterToday: { ...type.label, color: colors.accent, width: "100%", textAlign: "center" },
  weekLetterMuted: { color: colors.textMuted },
  weekGlyphBox: { width: 18, height: 16, alignItems: "center", justifyContent: "center" },
  weekGlyph: { fontSize: 12, lineHeight: 16, fontWeight: "600" as const },
  weekRing: { width: 9, height: 9, borderRadius: 4.5, borderWidth: 1.5 },
});
