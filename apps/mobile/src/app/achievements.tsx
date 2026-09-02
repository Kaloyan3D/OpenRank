import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { colors, spacing, typography } from "../theme/tokens";
import { AnimatedProgress } from "../ui/AnimatedProgress";

/**
 * Achievements (Phase 8): the local, deterministic milestone catalog. A pure
 * projection over canonical + derived data - evaluated on read, stored
 * nowhere, never paywalled, never social.
 */
export default function AchievementsScreen() {
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

  const views = services.achievements.list(profile.id);
  const unlocked = views.filter((a) => a.unlocked).length;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>ACHIEVEMENTS</Text>
      <Text style={styles.title}>
        {String(unlocked) + " of " + String(views.length) + " unlocked"}
      </Text>
      <Text style={styles.muted}>
        Milestones are calculated from your own logged training - always local,
        always yours.
      </Text>

      {views.map((a) => (
        <View key={a.id} style={[styles.card, a.unlocked ? styles.cardUnlocked : null]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.glyph, a.unlocked ? null : styles.glyphLocked]}>{a.glyph}</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>{a.label}</Text>
              <Text style={styles.desc}>{a.description}</Text>
            </View>
            <Text style={[styles.state, a.unlocked ? null : styles.stateLocked]}>
              {a.unlocked ? "DONE" : Math.round(a.progress * 100) + "%"}
            </Text>
          </View>
          {!a.unlocked ? <AnimatedProgress value={a.progress} /> : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: 48 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: 24 },
  kicker: { ...typography.caption, color: colors.accent, fontWeight: "700", letterSpacing: 1.5 },
  title: { ...typography.title, color: colors.text },
  muted: { ...typography.caption, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, gap: 8 },
  cardUnlocked: { borderWidth: 1, borderColor: colors.accent },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  glyph: { fontSize: 18, color: colors.accent, width: 44 },
  glyphLocked: { color: colors.textMuted },
  label: { ...typography.body, color: colors.text, fontWeight: "700" },
  desc: { ...typography.caption, color: colors.textMuted },
  state: { ...typography.caption, color: colors.accent, fontWeight: "700", fontVariant: ["tabular-nums"] },
  stateLocked: { color: colors.textMuted },
});
