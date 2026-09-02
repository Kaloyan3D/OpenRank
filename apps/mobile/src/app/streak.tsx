import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { colors } from "../design/colors";
import { radius } from "../design/radii";
import { space } from "../design/spacing";
import { type } from "../design/typography";

/**
 * Streak history (Phase 6, spec AQ/AR): full transparency. The ledger is the
 * truth, so the screen answers "why is my streak X?" with the exact history:
 * every planned session, its status and the running streak value.
 */

const STATUS_GLYPH: Record<string, string> = {
  completed: "\u2713",
  missed: "\u2715",
  pending: "\u25CB",
  paused: "\u23F8",
  rescheduled: "\u21BB",
  cancelled: "\u00D7",
};
const STATUS_LABEL: Record<string, string> = {
  completed: "Completed",
  missed: "Planned workout missed",
  pending: "Planned",
  paused: "Paused (vacation)",
  rescheduled: "Moved to another day",
  cancelled: "Cancelled (schedule off)",
};
const STATUS_COLOR: Record<string, string> = {
  completed: colors.success,
  missed: colors.danger,
  pending: colors.textSecondary,
  paused: colors.textMuted,
  rescheduled: colors.textMuted,
  cancelled: colors.textMuted,
};

export default function StreakHistoryScreen() {
  const repos = useRepos();
  const services = useServices();
  const profile = repos.profile.getDefault();
  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.muted}>Internal state error - the local profile is missing. Restart the app to recover.</Text>
      </View>
    );
  }

  const state = services.streak.getCurrentState(profile.id);
  const history = services.streak.getHistory(profile.id);
  const milestones = services.streak.getMilestones(profile.id);
  const relevant = history.filter((s) => s.status !== "cancelled");
  const shown = relevant.slice(-60).reverse();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heroNumber}>{String(state.cache.currentStreak)}</Text>
      <Text style={styles.heroCaption}>{"\u{1F525} session streak"}</Text>
      <Text style={styles.muted}>
        {"Best: " + String(state.cache.bestStreak) + "  \u00B7  Perfect weeks: " + String(state.cache.perfectWeeks)}
      </Text>
      <Text style={styles.muted}>
        A streak counts planned training sessions - rest days and bonus
        workouts are always neutral.
      </Text>

      {state.lastMissedSessionDate ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Why is my streak {String(state.cache.currentStreak)}?</Text>
          <Text style={styles.muted}>
            {"Last miss: " + state.lastMissedSessionDate + ". Completed since: " +
              String(state.completedSinceLastMiss) + " planned session" +
              (state.completedSinceLastMiss === 1 ? "" : "s") + "."}
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No missed planned sessions recorded.</Text>
        </View>
      )}

      {milestones.length > 0 ? (
        <>
          <Text style={styles.section}>MILESTONES</Text>
          {milestones.map((m) => (
            <Text key={m.id} style={styles.body}>
              {"\u{1F3C6} " + String(m.value) + "-session streak reached" + (m.occurredAt ? "" : "")}
            </Text>
          ))}
        </>
      ) : null}

      <Text style={styles.section}>HISTORY</Text>
      {shown.map((s) => (
        <View key={s.id} style={styles.row}>
          <Text style={[styles.glyph, { color: STATUS_COLOR[s.status] }]}>{STATUS_GLYPH[s.status]}</Text>
          <Text style={styles.body}>
            {s.scheduledDate + "  " + (STATUS_LABEL[s.status] ?? s.status)}
            {s.status === "completed" && s.streakAfter != null ? "  (streak " + String(s.streakAfter) + ")" : ""}
            {s.status === "rescheduled" && s.rescheduledFromDate ? " from " + s.rescheduledFromDate : ""}
          </Text>
        </View>
      ))}
      {shown.length === 0 ? <Text style={styles.muted}>No planned sessions yet.</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.xs, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  heroNumber: { ...type.metricLarge, color: colors.text, fontVariant: ["tabular-nums"] },
  heroCaption: { ...type.label, color: colors.textSecondary, letterSpacing: 1.2 },
  section: { ...type.sectionTitle, color: colors.text, fontSize: 14, marginTop: space.md, letterSpacing: 1 },
  body: { ...type.body, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, marginTop: space.sm, gap: space.xs },
  cardTitle: { ...type.body, color: colors.text, fontWeight: "700" },
  row: { flexDirection: "row", gap: space.sm, alignItems: "center", marginTop: space.xs },
  glyph: { ...type.bodyStrong, fontSize: 16, width: 20, textAlign: "center" },
});
