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
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Screen } from "../../components/ui/Screen";
import { EmptyState } from "../../components/ui/EmptyState";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Workout hub (Phase 8.1 approved structure, spec 21). Active workout =
 * WORKOUT IN PROGRESS elevated card with live timer + RESUME WORKOUT +
 * destructive Discard (danger tokens, never amber). No active workout =
 * START TRAINING + START EMPTY WORKOUT + compact ROUTINES list. Conflict
 * semantics are unchanged: explicit Resume / Discard & start / Cancel -
 * never silent overwrite.
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
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>WORKOUT</Text>
        {active ? (
          <>
            <Text style={styles.title}>In progress</Text>
            <Card variant="elevated" style={styles.resumeCard}>
              <Text style={styles.resumeKicker}>WORKOUT IN PROGRESS</Text>
              <Pressable accessible accessibilityRole="button" accessibilityLabel={"Resume " + (active.workout.title ?? "workout")} onPress={openActive}>
                <Text style={styles.resumeTitle}>{active.workout.title ?? "Workout"}</Text>
              </Pressable>
              <Text style={styles.timer}>{formatDuration(elapsedSec)}</Text>
              <Text style={styles.resumeMeta}>
                {String(active.exercises.length) + " exercise" + (active.exercises.length === 1 ? "" : "s") +
                  " - " + String(countCompletedSets(active.exercises).done) + " set" +
                  (countCompletedSets(active.exercises).done === 1 ? "" : "s") + " done"}
              </Text>
              <Button label="RESUME WORKOUT" onPress={openActive} fullWidth />
              <Button
                label="Discard workout"
                variant="dangerSubtle"
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
              />
            </Card>
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
            <Text style={styles.title}>Start training</Text>
            <Button label="START EMPTY WORKOUT" onPress={startEmpty} fullWidth accessibilityLabel="Start an empty workout" />
            <Pressable
              accessible
              accessibilityRole="button"
              accessibilityLabel="Manage routines"
              onPress={() => router.push("/routines")}
            >
              <Text style={styles.linkText}>Manage routines</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>ROUTINES</Text>
            {routines.length === 0 ? (
              <EmptyState
                icon="albums-outline"
                title="No routines yet"
                description={"Create a routine to start structured sessions - or just start an empty workout."}
              />
            ) : (
              <View style={styles.routineList}>
                {routines.map((r) => (
                  <Card key={r.id}>
                    <Pressable
                      accessible
                      accessibilityRole="button"
                      accessibilityLabel={"Start workout from routine " + r.name}
                      onPress={() => startFromRoutine(r)}
                      style={styles.routineRow}
                    >
                      <View style={{ flex: 1 }}>
                        <Text style={styles.routineName}>{r.name}</Text>
                        <Text style={styles.routineMeta}>{String(services.routine.get(r.id).exercises.length) + " exercises"}</Text>
                      </View>
                      <Text style={styles.routineStart}>START</Text>
                    </Pressable>
                  </Card>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: { ...type.label, color: colors.accent, letterSpacing: 1.2 },
  title: { ...type.pageTitle, color: colors.text, marginBottom: space[2] },
  sectionTitle: { ...type.label, color: colors.textSecondary, letterSpacing: 1.2, marginTop: space[4] },
  resumeCard: { gap: space[2] },
  resumeKicker: { ...type.label, color: colors.accent, letterSpacing: 1.2 },
  resumeTitle: { ...type.cardTitle, color: colors.text },
  timer: { ...type.metricLarge, color: colors.text, fontVariant: ["tabular-nums"] },
  resumeMeta: { ...type.caption, color: colors.textMuted },
  linkText: { ...type.caption, color: colors.accent, fontWeight: "600", paddingVertical: space[2], alignSelf: "flex-start" },
  routineList: { gap: space[2] },
  routineRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  routineName: { ...type.cardTitle, color: colors.text },
  routineMeta: { ...type.caption, color: colors.textMuted },
  routineStart: { ...type.label, color: colors.accent, letterSpacing: 1 },
});
