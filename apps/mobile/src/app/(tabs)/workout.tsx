import { useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import type { Routine } from "@openrank/domain";
import { ActiveWorkoutConflictError } from "@openrank/database";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { countCompletedSets, useNow } from "../../hooks/workout";
import { RestTimerBar } from "../../ui/RestTimerBar";
import { formatDuration } from "../../ui/format";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Workout hub (Phase 4, tasks B/T): resume banner when a workout is active
 * (recoverable immediately - the user does not need to know which screen to
 * open), or start options: empty workout or from a routine. Conflicts offer
 * explicit Resume / Discard & start / Cancel choices - never silent
 * overwrite.
 */
export default function WorkoutHubScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const [nonce, setNonce] = useState(0);
  void nonce; // re-render trigger after discard

  const profile = repos.profile.getDefault();
  const active = profile ? services.workout.resumeActiveWorkout(profile.id) : null;
  const rest = profile ? services.restTimer.getActive(profile.id) : null;
  const routines: Routine[] = profile ? services.routine.list(profile.id).active : [];
  const now = useNow(active != null);
  const elapsedSec = active ? Math.max(0, Math.round((now - Date.parse(active.workout.startedAt)) / 1000)) : 0;

  const openActive = () => {
    if (active) router.push("/workout/" + active.workout.id);
  };

  const startEmpty = () => {
    if (!profile) return;
    try {
      const w = services.workout.startEmptyWorkout(profile.id, {
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      router.push("/workout/" + w.id);
    } catch (err) {
      if (err instanceof ActiveWorkoutConflictError) {
        const current = services.workout.resumeActiveWorkout(profile.id);
        Alert.alert("Workout already active", "You already have an active workout.", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard & start new",
            style: "destructive",
            onPress: () => {
              if (current) services.workout.discardWorkout(current.workout.id);
              const w = services.workout.startEmptyWorkout(profile.id, {
                timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
              });
              router.push("/workout/" + w.id);
            },
          },
          {
            text: "Resume",
            onPress: () => {
              if (current) router.push("/workout/" + current.workout.id);
            },
          },
        ]);
        return;
      }
      throw err;
    }
  };

  const startFromRoutine = (routine: Routine) => {
    if (!profile) return;
    try {
      const w = services.workout.startWorkoutFromRoutine(profile.id, routine.id, {
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      router.push("/workout/" + w.id);
    } catch (err) {
      if (err instanceof ActiveWorkoutConflictError) {
        const current = services.workout.resumeActiveWorkout(profile.id);
        Alert.alert("Workout already active", "You already have an active workout.", [
          { text: "Cancel", style: "cancel" },
          {
            text: "Discard & start new",
            style: "destructive",
            onPress: () => {
              if (current) services.workout.discardWorkout(current.workout.id);
              const w = services.workout.startWorkoutFromRoutine(profile.id, routine.id, {
                timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
              });
              router.push("/workout/" + w.id);
            },
          },
          {
            text: "Resume",
            onPress: () => {
              if (current) router.push("/workout/" + current.workout.id);
            },
          },
        ]);
        return;
      }
      throw err;
    }
  };

  const discardActive = () => {
    if (!active) return;
    services.workout.discardWorkout(active.workout.id);
    setNonce((n) => n + 1);
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {active ? (
        <>
          <Pressable
            style={styles.resumeCard}
            accessibilityLabel="Resume active workout"
            onPress={openActive}
          >
            <Text style={styles.resumeKicker}>WORKOUT IN PROGRESS</Text>
            <Text style={styles.resumeTitle}>{active.workout.title ?? "Workout"}</Text>
            <Text style={styles.resumeMeta}>
              {formatDuration(elapsedSec)} elapsed -{" "}
              {String(active.exercises.length)} exercise
              {active.exercises.length === 1 ? "" : "s"} -{" "}
              {String(countCompletedSets(active.exercises).done)} set
              {countCompletedSets(active.exercises).done === 1 ? "" : "s"} done
            </Text>
            <View style={styles.resumeActions}>
              <Pressable style={[styles.button, styles.primary]} onPress={openActive}>
                <Text style={styles.primaryText}>Resume Workout</Text>
              </Pressable>
              <Pressable
                style={[styles.button, styles.danger]}
                accessibilityLabel="Discard active workout"
                onPress={() =>
                  Alert.alert(
                    "Discard workout?",
                    "This will permanently delete this active workout and its logged sets.",
                    [
                      { text: "Cancel", style: "cancel" },
                      { text: "Discard", style: "destructive", onPress: discardActive },
                    ],
                  )
                }
              >
                <Text style={styles.dangerText}>Discard</Text>
              </Pressable>
            </View>
          </Pressable>
          {rest ? (
            <RestTimerBar
              rest={rest}
              onAdjust={(d) => {
                if (profile) services.restTimer.addSeconds(profile.id, d);
                setNonce((n) => n + 1);
              }}
              onSkip={() => {
                if (profile) services.restTimer.skip(profile.id);
                setNonce((n) => n + 1);
              }}
            />
          ) : null}
        </>
      ) : (
        <>
          <Pressable style={[styles.button, styles.primary, styles.big]} onPress={startEmpty}>
            <Text style={styles.primaryText}>Start Empty Workout</Text>
          </Pressable>

          <Text style={styles.sectionTitle}>Start from routine</Text>
          {routines.length === 0 ? (
            <Text style={styles.muted}>
              No routines yet - create one under Manage Routines, or start an empty workout.
            </Text>
          ) : (
            routines.map((r) => (
              <Pressable
                key={r.id}
                style={styles.routineRow}
                accessibilityLabel={"Start workout from routine " + r.name}
                onPress={() => startFromRoutine(r)}
              >
                <Text style={styles.routineName}>{r.name}</Text>
                <Text style={styles.routineMeta}>start {"\u2192"}</Text>
              </Pressable>
            ))
          )}
        </>
      )}

      <View style={styles.links}>
        <Pressable style={[styles.button, styles.secondary]} onPress={() => router.push("/routines")}>
          <Text style={styles.secondaryText}>Manage Routines</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.md },
  resumeCard: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: spacing.lg,
    gap: 6,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  resumeKicker: { color: colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  resumeTitle: { ...typography.title, color: colors.text },
  resumeMeta: { ...typography.caption, color: colors.textMuted },
  resumeActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  button: {
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 18,
    alignItems: "center",
    minHeight: 48,
    justifyContent: "center",
  },
  big: { paddingVertical: 22 },
  primary: { backgroundColor: colors.accent, flex: 1 },
  primaryText: { color: "#0b1220", fontWeight: "700", fontSize: 16 },
  secondary: { borderWidth: 1, borderColor: colors.textMuted, flex: 1 },
  secondaryText: { color: colors.text, fontWeight: "600" },
  danger: { borderWidth: 1, borderColor: "#a05a5a" },
  dangerText: { color: "#e8a0a0", fontWeight: "600" },
  sectionTitle: { ...typography.body, color: colors.accent, fontWeight: "700", marginTop: spacing.sm },
  muted: { ...typography.caption, color: colors.textMuted },
  routineRow: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    flexDirection: "row",
    alignItems: "center",
  },
  routineName: { ...typography.body, color: colors.text, flex: 1 },
  routineMeta: { color: colors.accent, fontSize: 13 },
  links: { flexDirection: "row", marginTop: spacing.sm },
});
