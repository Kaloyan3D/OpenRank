import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { useCanonicalRevision } from "../local-data/useCanonicalRevision";
import { colors } from "../design/colors";
import { radius } from "../design/radii";
import { space } from "../design/spacing";
import { type } from "../design/typography";
import { AnimatedProgress } from "../ui/AnimatedProgress";

/**
 * Achievements (Phase 8): the local, deterministic milestone catalog. A pure
 * projection over canonical + derived data - evaluated on read, stored
 * nowhere, never paywalled, never social.
 */
export default function AchievementsScreen() {
  const repos = useRepos();
  const services = useServices();
  useCanonicalRevision(); // canonical invalidation (Phase 8.2)
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
          {!a.unlocked ? <AnimatedProgress value={a.progress} fillColor={colors.textMuted} /> : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.md, gap: space.sm, paddingBottom: 48 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: space[6] },
  kicker: { ...type.label, color: colors.accent, letterSpacing: 1.5 },
  title: { ...type.sectionTitle, color: colors.text },
  muted: { ...type.caption, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: space.md, gap: space[2] },
  cardUnlocked: { borderWidth: 1, borderColor: colors.success, backgroundColor: colors.successSubtle },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 10 },
  glyph: { ...type.body, fontSize: 18, color: colors.success, width: 44 },
  glyphLocked: { color: colors.textMuted },
  label: { ...type.bodyStrong, color: colors.text },
  desc: { ...type.caption, color: colors.textMuted },
  state: { ...type.caption, color: colors.success, fontWeight: "700", fontVariant: ["tabular-nums"] },
  stateLocked: { color: colors.textMuted },
});
