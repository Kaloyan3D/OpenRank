import { useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useCanonicalRevision } from "../../local-data/useCanonicalRevision";
import { useUnits } from "../../ui/units";
import { formatDateTime } from "../../ui/format";
import { Screen } from "../../components/ui/Screen";
import { Card } from "../../components/ui/Card";
import { Chip } from "../../components/ui/Chip";
import { BarChart } from "../../features/charts/BarChart";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Profile (Phase 8.1 approved structure, spec 31): avatar initial, display
 * name, bodyweight hero with trend, then a quiet settings list (Progress,
 * Achievements, Training Schedule, Reminders, Units, Strength Standard)
 * and a DATA footer: "Stored locally on this device." No account, no
 * cloud, no sync UI - Phase 8.1 ships local-only. All existing semantics
 * preserved (standard change rebuilds ranks, never workouts/PRs; unit
 * change is display-only).
 */
export default function ProfileScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  const [weightInput, setWeightInput] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  // Canonical invalidation (Phase 8.2): profile/bodyweight/rank mutations
  // commit -> revision++ -> this screen re-renders and re-reads SQLite.
  useCanonicalRevision();

  const profile = repos.profile.getDefault();
  const history = profile ? repos.bodyweight.history(profile.id) : [];
  const latest = history[0] ?? null;
  const previous = history[1] ?? null;
  const trend =
    latest && previous
      ? latest.weightKg - previous.weightKg
      : 0;

  const addBodyweight = () => {
    if (!profile) return;
    const kg = units.fromDisplay(weightInput);
    if (kg == null || kg <= 0) {
      Alert.alert("Invalid bodyweight", "Enter a positive number.");
      return;
    }
    try {
      // Canonical write through the service layer (commit publishes the
      // revision; no manual refresh is needed or allowed).
      services.profile.addBodyweight(profile.id, kg, new Date().toISOString());
      setWeightInput("");
    } catch (err) {
      Alert.alert("Cannot save bodyweight", err instanceof Error ? err.message : String(err));
    }
  };

  const setStandard = (standard: "male" | "female") => {
    if (!profile || profile.strengthStandard === standard) return;
    try {
      services.profile.updateStrengthStandard(profile.id, standard);
      // Ranks rebuild on the next worker pass; trigger it right away.
      services.derived.processPending();
    } catch (err) {
      Alert.alert("Cannot change standard", err instanceof Error ? err.message : String(err));
    }
  };

  const setUnits = (system: "metric" | "imperial") => {
    if (!profile || profile.unitSystem === system) return;
    try {
      services.profile.updateUnitSystem(profile.id, system);
    } catch (err) {
      Alert.alert("Cannot change units", err instanceof Error ? err.message : String(err));
    }
  };

  if (!profile) {
    // The root routing gate owns this; corruption recovery only (spec 23).
    return (
      <Screen>
        <Text style={styles.errorTitle}>Internal state error</Text>
        <Text style={styles.muted}>The local profile is missing. Restart the app to recover.</Text>
      </Screen>
    );
  }

  const achievementViews = services.achievements.list(profile.id);
  const achievements = {
    unlocked: achievementViews.filter((a) => a.unlocked).length,
    total: achievementViews.length,
  };
  const initial = (profile.displayName.trim()[0] ?? "?").toUpperCase();

  const saveName = () => {
    try {
      services.profile.updateDisplayName(profile.id, nameDraft);
      setEditingName(false);
    } catch (err) {
      Alert.alert("Cannot rename", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>PROFILE</Text>
        <View style={styles.identityRow}>
          <View style={styles.avatar} accessible accessibilityLabel={"Profile avatar for " + profile.displayName}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={{ flex: 1 }}>
            {editingName ? (
              <View style={styles.nameRow}>
                <TextInput
                  style={styles.input}
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  autoFocus
                  maxLength={60}
                  accessibilityLabel="Display name"
                />
                <Pressable accessibilityRole="button" accessibilityLabel="Save name" onPress={saveName}>
                  <Text style={styles.linkText}>Save</Text>
                </Pressable>
              </View>
            ) : (
              <View style={styles.nameRow}>
                <Text style={styles.name} numberOfLines={1}>{profile.displayName}</Text>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Edit display name"
                  onPress={() => {
                    setNameDraft(profile.displayName);
                    setEditingName(true);
                  }}
                >
                  <Text style={styles.linkText}>Edit</Text>
                </Pressable>
              </View>
            )}
            <Text style={styles.muted}>Local profile on this device - no account required.</Text>
          </View>
        </View>

        <Text style={styles.section}>BODYWEIGHT</Text>
        <Card variant="elevated">
          <View style={styles.bwRow}>
            <View>
              <Text style={styles.bwValue}>
                {latest ? units.toDisplay(latest.weightKg) + " " + units.weightLabel : "\u2014"}
              </Text>
              <Text style={styles.muted}>
                {latest
                  ? "measured " + formatDateTime(latest.measuredAt)
                  : "Add bodyweight to calculate strength ranks."}
              </Text>
            </View>
            {Math.abs(trend) >= 0.05 ? (
              <Text
                style={[styles.trend, { color: trend < 0 ? colors.info : colors.accent }]}
                accessibilityLabel={
                  "Compared to previous measurement: " + (trend < 0 ? "down " : "up ") +
                  units.toDisplay(Math.abs(trend)) + " " + units.weightLabel
                }
              >
                {(trend < 0 ? "\u2212" : "+") + units.toDisplay(Math.abs(trend)) + " " + units.weightLabel}
              </Text>
            ) : null}
          </View>
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={weightInput}
              onChangeText={setWeightInput}
              placeholder={"current weight (" + units.weightLabel + ")"}
              placeholderTextColor={colors.textDisabled}
              keyboardType="decimal-pad"
              accessibilityLabel="New bodyweight"
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add bodyweight entry"
              onPress={addBodyweight}
              style={styles.addBtn}
            >
              <Text style={styles.addBtnText}>ADD</Text>
            </Pressable>
          </View>
          {history.length > 0 ? (
            <Text style={styles.muted}>
              {String(history.length) + " entries recorded - the newest at or before each workout is used for its ranks."}
            </Text>
          ) : null}
        </Card>
        {history.length > 1 ? (
          <BarChart
            points={services.analytics
              .bodyweightSeries(profile.id)
              .slice(-10)
              .map((pt) => ({
                label: pt.at.slice(5, 10),
                value: pt.weightKg,
                accessibilityLabel:
                  "Bodyweight " + units.toDisplay(pt.weightKg) + " " + units.weightLabel + " on " + pt.at.slice(0, 10),
              }))}
            unitLabel={"Recent measurements (" + units.weightLabel + ")"}
          />
        ) : null}

        <Text style={styles.section}>SETTINGS</Text>
        <Card>
          <SettingsRow label="Progress" hint="Charts, PRs, rank history" onPress={() => router.push("/progress")} />
          <SettingsRow
            label="Achievements"
            hint={String(achievements.unlocked) + " of " + String(achievements.total) + " unlocked"}
            onPress={() => router.push("/achievements")}
          />
          <SettingsRow label="Training Schedule" hint="Training days and routines" onPress={() => router.push("/schedule")} />
          <SettingsRow label="Reminders" hint="Local notifications" onPress={() => router.push("/notifications")} />
          <SettingsRow label="Streak" hint="Current streak, best streak, history" onPress={() => router.push("/streak")} />
        </Card>

        <Text style={styles.section}>UNITS</Text>
        <Card>
          <View style={styles.chipRow}>
            <Chip label="Metric (kg, km)" selected={profile.unitSystem === "metric"} onPress={() => setUnits("metric")} accessibilityLabel="Use metric units" />
            <Chip label="Imperial (lb, mi)" selected={profile.unitSystem === "imperial"} onPress={() => setUnits("imperial")} accessibilityLabel="Use imperial units" />
          </View>
          <Text style={styles.muted}>Display only - your data is stored in canonical units.</Text>
        </Card>

        <Text style={styles.section}>STRENGTH STANDARD</Text>
        <Card>
          <Text style={styles.muted}>
            Ranks compare your strength to the selected reference standard. Changing it recalculates ranks (never
            workouts or records).
          </Text>
          <View style={styles.chipRow}>
            <Chip label="Male reference" selected={profile.strengthStandard === "male"} onPress={() => setStandard("male")} accessibilityLabel="Use male reference standard" />
            <Chip label="Female reference" selected={profile.strengthStandard === "female"} onPress={() => setStandard("female")} accessibilityLabel="Use female reference standard" />
          </View>
        </Card>

        <Text style={styles.section}>DATA</Text>
        <Card>
          <Text style={styles.dataText}>Stored locally on this device.</Text>
          <Text style={styles.muted}>
            No account. No cloud. No analytics leaves this device. Uninstalling the app deletes your data.
          </Text>
        </Card>
      </ScrollView>
    </Screen>
  );
}

function SettingsRow(props: { label: string; hint?: string; onPress: () => void }) {
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.label + (props.hint ? ", " + props.hint : "")}
      onPress={props.onPress}
      style={rowStyles.row}
    >
      <View style={{ flex: 1 }}>
        <Text style={rowStyles.label}>{props.label}</Text>
        {props.hint ? <Text style={rowStyles.hint}>{props.hint}</Text> : null}
      </View>
      <Text style={rowStyles.chevron}>{"\u203A"}</Text>
    </Pressable>
  );
}

const rowStyles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: space[3], minHeight: 48 },
  label: { ...type.body, color: colors.text },
  hint: { ...type.caption, color: colors.textMuted },
  chevron: { ...type.bodyStrong, color: colors.textMuted },
});

const styles = StyleSheet.create({
  kicker: { ...type.label, color: colors.accent, letterSpacing: 1.2, marginBottom: space[2] },
  identityRow: { flexDirection: "row", alignItems: "center", gap: space[3], marginBottom: space[2] },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSubtle,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { ...type.sectionTitle, color: colors.accent },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  name: { ...type.sectionTitle, color: colors.text, flexShrink: 1 },
  muted: { ...type.caption, color: colors.textMuted },
  section: { ...type.label, color: colors.textSecondary, letterSpacing: 1.2, marginTop: space[4], marginBottom: space[1] },
  bwRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space[3] },
  bwValue: { ...type.metricMedium, color: colors.text, fontVariant: ["tabular-nums"] },
  trend: { ...type.label, fontWeight: "700", fontVariant: ["tabular-nums"] },
  inputRow: { flexDirection: "row", gap: space[2], marginTop: space[3] },
  input: {
    flex: 1,
    backgroundColor: colors.surfacePressed,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    paddingHorizontal: space[3],
    minHeight: 44,
    fontSize: 15,
  },
  addBtn: {
    backgroundColor: colors.accent,
    borderRadius: radius.sm,
    paddingHorizontal: space[4],
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnText: { ...type.label, color: colors.textOnAccent, letterSpacing: 1 },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginTop: space[2] },
  dataText: { ...type.bodyStrong, color: colors.text },
  linkText: { ...type.caption, color: colors.accent, fontWeight: "600" },
  errorTitle: { ...type.cardTitle, color: colors.danger },
});
