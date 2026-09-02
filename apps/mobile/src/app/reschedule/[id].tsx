import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { RescheduleError, addDays, computeLogicalTrainingDate, isoWeekdayOf, startOfIsoWeek } from "@openrank/database";
import type { ScheduledSession } from "@openrank/domain";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Reschedule an upcoming planned session (Phase 6, spec U/V): v1 restricts
 * moves to the same ISO week. Occupied targets and past dates are rejected
 * with an explicit message - two required workouts are never silently merged.
 */

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

export default function RescheduleScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [nonce, setNonce] = useState(0);
  void nonce;

  const profile = repos.profile.getDefault();
  const session: ScheduledSession | null = id ? repos.scheduledSessions.getById(id) : null;
  if (!profile || !session) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Scheduled session not found.</Text>
      </View>
    );
  }

  const offset = -new Date().getTimezoneOffset();
  const todayLogical = computeLogicalTrainingDate(new Date().toISOString(), offset);
  const monday = startOfIsoWeek(session.scheduledDate);
  const candidates: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(monday, i);
    if (date >= todayLogical) candidates.push(date);
  }
  const occupied = new Set(
    candidates.filter((d) => {
      if (d === session.scheduledDate) return false;
      const active = repos.scheduledSessions.activeForDate(profile.id, d);
      return active != null;
    }),
  );

  const move = (target: string) => {
    try {
      services.schedule.rescheduleSession(session.id, target, { timezoneOffsetMinutes: offset });
      void services.notifications
        .reconcileNotifications(profile.id, {
          todayUtc: new Date().toISOString(),
          timezoneOffsetMinutes: offset,
        })
        .catch(() => {});
      Alert.alert("Session moved", "Your planned session moved to " + target + ".");
      router.back();
    } catch (err) {
      if (err instanceof RescheduleError) {
        Alert.alert("Cannot reschedule", err instanceof Error ? err.message : String(err));
        setNonce((n) => n + 1);
        return;
      }
      throw err;
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Move planned session</Text>
      <Text style={styles.muted}>
        Currently scheduled: {session.scheduledDate}. Moves stay inside the
        same week, and a session counts exactly once wherever it lands.
      </Text>
      {candidates.map((date) => {
        const isCurrent = date === session.scheduledDate;
        const isOccupied = occupied.has(date);
        return (
          <Pressable
            key={date}
            disabled={isCurrent || isOccupied}
            style={[styles.dayButton, (isCurrent || isOccupied) && styles.dayDisabled]}
            onPress={() => move(date)}
            accessibilityLabel={
              "Move to " + DAY_NAMES[isoWeekdayOf(date) - 1] + " " + date +
              (isOccupied ? " (already has a planned session)" : isCurrent ? " (current)" : "")
            }
          >
            <Text style={styles.dayText}>
              {DAY_NAMES[isoWeekdayOf(date) - 1] + "  " + date}
              {isCurrent ? "  (current)" : isOccupied ? "  (occupied)" : ""}
            </Text>
          </Pressable>
        );
      })}
      <Text style={styles.muted}>
        Completed or missed sessions cannot be moved - history stays history.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xs, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background },
  title: { ...typography.title, color: colors.text },
  muted: { ...typography.caption, color: colors.textMuted },
  dayButton: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    padding: spacing.md,
    marginTop: spacing.sm,
  },
  dayDisabled: { opacity: 0.4 },
  dayText: { color: colors.text, fontWeight: "600" },
});