import { useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useCanonicalRevision } from "../../local-data/useCanonicalRevision";
import { useUnits } from "../../ui/units";
import { formatDateTime } from "../../ui/format";
import { Screen } from "../../components/ui/Screen";
import { Card } from "../../components/ui/Card";
import { Chip } from "../../components/ui/Chip";
import { Button } from "../../components/ui/Button";
import { ModalShell } from "../../components/ui/ModalShell";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { Divider } from "../../components/ui/Divider";
import { BarChart } from "../../features/charts/BarChart";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Profile (Phase 8.2B pass 5, guide section 28): a compact personal hub -
 * information-first, not form-first. Identity header (initial + display
 * name + a quiet edit action, never an oversized hero), one bodyweight
 * hero card (metric + trend; the add/update flow lives in a bottom sheet -
 * guide 28 forbids a permanently visible giant input field) with an
 * honest CTA when bodyweight is missing, grouped training destinations
 * (guide 9: grouped rows + hairline separators, not one card each),
 * preference rows (Units display-only; Strength Standard keeps the exact
 * rebuild-ranks service flow) and the DATA footer: "Stored locally on
 * this device." No account, no cloud, no sync UI - local-only by design.
 * All existing semantics preserved (standard change rebuilds ranks, never
 * workouts/PRs; unit change is display-only; bodyweight appends to
 * canonical history via ProfileService).
 */
export default function ProfileScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  const [weightInput, setWeightInput] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
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

  // Compact edit state (guide 28): the sheet opens pre-filled with the
  // current canonical value; saving APPENDS a new measurement - history
  // is kept and the newest at-or-before-workout entry feeds ranks.
  const openBodyweightSheet = () => {
    setWeightInput(latest ? units.toDisplay(latest.weightKg) : "");
    setSheetOpen(true);
  };

  const saveBodyweight = () => {
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
      setSheetOpen(false);
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

        {/* Identity header - compact: initial plate, name, quiet edit action. */}
        <View style={styles.identity}>
          <View style={styles.avatar} accessible accessibilityLabel={"Profile avatar for " + profile.displayName}>
            <Text style={styles.avatarText}>{initial}</Text>
          </View>
          <View style={styles.identityText}>
            {editingName ? (
              <View style={styles.nameEditRow}>
                <TextInput
                  style={styles.input}
                  value={nameDraft}
                  onChangeText={setNameDraft}
                  autoFocus
                  maxLength={60}
                  accessibilityLabel="Display name"
                />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Save name"
                  onPress={saveName}
                  style={styles.textAction}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.textActionLabel}>Save</Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Cancel name edit"
                  onPress={() => setEditingName(false)}
                  style={styles.textAction}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.textActionMuted}>Cancel</Text>
                </Pressable>
              </View>
            ) : (
              <Text style={styles.name} numberOfLines={1}>{profile.displayName}</Text>
            )}
            {!editingName ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit display name"
                onPress={() => {
                  setNameDraft(profile.displayName);
                  setEditingName(true);
                }}
                hitSlop={{ top: 8, bottom: 8, right: 16 }}
                style={styles.editAction}
              >
                <Text style={styles.editActionLabel}>Edit name {"\u2192"}</Text>
              </Pressable>
            ) : null}
            <Text style={styles.identityNote}>Local profile on this device - no account required.</Text>
          </View>
        </View>

        {/* Bodyweight - the one hero metric of this screen (guide 7.2/28). */}
        <SectionHeader
          title="Bodyweight"
          actionLabel={latest ? "Update" : undefined}
          onAction={latest ? openBodyweightSheet : undefined}
          actionAccessibilityLabel="Update bodyweight"
          style={styles.sectionHead}
        />
        {latest ? (
          <Card variant="hero" style={styles.heroCard}>
            <View style={styles.metricRow}>
              <View style={styles.metricMain}>
                <View style={styles.metricValueRow}>
                  <Text style={styles.metricValue}>{units.toDisplay(latest.weightKg)}</Text>
                  <Text style={styles.metricUnit}>{units.weightLabel}</Text>
                </View>
              </View>
              {Math.abs(trend) >= 0.05 ? (
                // A delta is informational, not an action or a success/failure
                // (guide 2.1): info blue with an explicit sign - never color alone.
                <Text
                  style={styles.trend}
                  accessibilityLabel={
                    "Compared to previous measurement: " + (trend < 0 ? "down " : "up ") +
                    units.toDisplay(Math.abs(trend)) + " " + units.weightLabel
                  }
                >
                  {(trend < 0 ? "\u2212" : "+") + units.toDisplay(Math.abs(trend)) + " " + units.weightLabel}
                </Text>
              ) : null}
            </View>
            <Text style={styles.metricCaption}>{"measured " + formatDateTime(latest.measuredAt)}</Text>
            {history.length > 0 ? (
              <Text style={styles.metricFootnote}>
                {String(history.length) + " entries recorded - the newest at or before each workout is used for its ranks."}
              </Text>
            ) : null}
          </Card>
        ) : (
          // Missing bodyweight: honest CTA - same promise as the Ranks screen.
          <Card variant="hero" style={styles.heroCard}>
            <Text style={styles.bwMissingTitle}>No bodyweight yet</Text>
            <Text style={styles.bwMissingText}>Add bodyweight to calculate strength ranks.</Text>
            <Button
              label="ADD BODYWEIGHT"
              size="compact"
              onPress={openBodyweightSheet}
              accessibilityLabel="Add bodyweight entry"
              style={styles.bwMissingCta}
            />
          </Card>
        )}
        {history.length > 1 ? (
          <View style={styles.chartBlock}>
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
              // Guide 25: amber default series - green is success-only (guide
              // 2.1) and a max-bar highlight is not a success state. The
              // shared component's green emphasis is a Progress-pass concern;
              // here every bar stays in the approved amber series.
              highlightFraction={1.001}
            />
          </View>
        ) : null}

        {/* Training destinations - grouped rows, hairline separators (guide 9). */}
        <SectionHeader title="Training" style={styles.sectionHead} />
        <Card style={styles.listCard}>
          <SettingsRow label="Progress" hint="Charts, PRs, rank history" onPress={() => router.push("/progress")} />
          <Divider />
          <SettingsRow
            label="Achievements"
            hint={String(achievements.unlocked) + " of " + String(achievements.total) + " unlocked"}
            onPress={() => router.push("/achievements")}
          />
          <Divider />
          <SettingsRow label="Training Schedule" hint="Training days and routines" onPress={() => router.push("/schedule")} />
          <Divider />
          <SettingsRow label="Reminders" hint="Local notifications" onPress={() => router.push("/notifications")} />
          <Divider />
          <SettingsRow label="Streak" hint="Current streak, best streak, history" onPress={() => router.push("/streak")} />
        </Card>

        {/* Preferences - Units (display-only) + Strength Standard (rebuilds
            ranks only, via the same service calls as before). */}
        <SectionHeader title="Preferences" style={styles.sectionHead} />
        <Card style={styles.listCard}>
          <View style={styles.prefBlock}>
            <Text style={styles.prefLabel}>Units</Text>
            <View style={styles.chipRow}>
              <Chip
                label="Metric (kg, km)"
                selected={profile.unitSystem === "metric"}
                onPress={() => setUnits("metric")}
                accessibilityLabel="Use metric units"
                hitSlop={{ top: 4, bottom: 4 }}
              />
              <Chip
                label="Imperial (lb, mi)"
                selected={profile.unitSystem === "imperial"}
                onPress={() => setUnits("imperial")}
                accessibilityLabel="Use imperial units"
                hitSlop={{ top: 4, bottom: 4 }}
              />
            </View>
            <Text style={styles.prefHint}>Display only - your data is stored in canonical units.</Text>
          </View>
          <Divider />
          <View style={styles.prefBlock}>
            <Text style={styles.prefLabel}>Strength Standard</Text>
            <Text style={styles.prefHint}>
              Ranks compare your strength to the selected reference standard. Changing it recalculates ranks (never
              workouts or records).
            </Text>
            <View style={styles.chipRow}>
              <Chip
                label="Male reference"
                selected={profile.strengthStandard === "male"}
                onPress={() => setStandard("male")}
                accessibilityLabel="Use male reference standard"
                hitSlop={{ top: 4, bottom: 4 }}
              />
              <Chip
                label="Female reference"
                selected={profile.strengthStandard === "female"}
                onPress={() => setStandard("female")}
                accessibilityLabel="Use female reference standard"
                hitSlop={{ top: 4, bottom: 4 }}
              />
            </View>
          </View>
        </Card>

        {/* DATA - local-first is the product's identity, stated as a fact,
            not a warning (guide 28: no account/cloud section). */}
        <SectionHeader title="Data" style={styles.sectionHead} />
        <Card variant="subtle" style={styles.dataCard}>
          <View style={styles.dataRow}>
            <View
              style={styles.dataIcon}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.textSecondary} />
            </View>
            <View style={styles.dataBody}>
              <Text style={styles.dataText}>Stored locally on this device.</Text>
              <Text style={styles.prefHint}>
                No account. No cloud. No analytics leaves this device. Uninstalling the app deletes your data.
              </Text>
            </View>
          </View>
        </Card>
      </ScrollView>

      {/* Bodyweight add/update flow (guide 28: modal / bottom sheet / compact
          edit state - never a permanently shown giant input field). */}
      <ModalShell visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Update bodyweight">
        <Text style={styles.sheetHint}>
          Adds a new measurement - history is kept. The newest at or before each workout is used for its ranks.
        </Text>
        <TextInput
          style={styles.input}
          value={weightInput}
          onChangeText={setWeightInput}
          placeholder={"current weight (" + units.weightLabel + ")"}
          placeholderTextColor={colors.textDisabled}
          keyboardType="decimal-pad"
          accessibilityLabel="New bodyweight"
          autoFocus
        />
        <Button
          label="SAVE BODYWEIGHT"
          fullWidth
          onPress={saveBodyweight}
          accessibilityLabel="Add bodyweight entry"
        />
      </ModalShell>
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
      style={({ pressed }) => [rowStyles.row, pressed ? rowStyles.rowPressed : null]}
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
  rowPressed: { backgroundColor: colors.surfacePressed },
  label: { ...type.body, color: colors.text },
  hint: { ...type.caption, color: colors.textMuted },
  chevron: { ...type.bodyStrong, color: colors.textMuted },
});

const styles = StyleSheet.create({
  kicker: { ...type.label, color: colors.accent, letterSpacing: 1.2, marginTop: space[2] },
  identity: { flexDirection: "row", alignItems: "center", gap: space[3], marginTop: space[3] },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    backgroundColor: colors.accentSubtle,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { ...type.metricSmall, color: colors.accent },
  identityText: { flex: 1 },
  name: { ...type.sectionTitle, color: colors.text },
  nameEditRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  editAction: { paddingVertical: space[1], alignSelf: "flex-start" },
  editActionLabel: { ...type.body, fontWeight: "600", color: colors.accent },
  textAction: { minHeight: 44, justifyContent: "center" },
  textActionLabel: { ...type.body, fontWeight: "600", color: colors.accent },
  textActionMuted: { ...type.body, color: colors.textSecondary },
  identityNote: { ...type.caption, color: colors.textMuted, marginTop: space[1] },
  sectionHead: { marginTop: space[5], marginBottom: space[1] },
  heroCard: { gap: space[2] },
  metricRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space[3] },
  metricMain: { flex: 1 },
  metricValueRow: { flexDirection: "row", alignItems: "baseline", gap: space[1] },
  metricValue: { ...type.metricLarge, color: colors.text, fontVariant: ["tabular-nums"] },
  metricUnit: { ...type.bodyStrong, color: colors.textSecondary },
  metricCaption: { ...type.caption, color: colors.textMuted },
  metricFootnote: { ...type.caption, color: colors.textMuted },
  trend: { ...type.bodyStrong, color: colors.info, fontVariant: ["tabular-nums"], paddingTop: space[1] },
  chartBlock: { marginTop: space[4] },
  bwMissingTitle: { ...type.cardTitle, color: colors.text },
  bwMissingText: { ...type.caption, color: colors.textSecondary },
  bwMissingCta: { alignSelf: "flex-start", marginTop: space[1] },
  listCard: { paddingVertical: space[2] },
  prefBlock: { paddingVertical: space[3], gap: space[2] },
  prefLabel: { ...type.bodyStrong, color: colors.text },
  prefHint: { ...type.caption, color: colors.textMuted },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2] },
  dataCard: { paddingVertical: space[3] },
  dataRow: { flexDirection: "row", alignItems: "flex-start", gap: space[3] },
  dataIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  dataBody: { flex: 1, gap: 2 },
  dataText: { ...type.bodyStrong, color: colors.text },
  sheetHint: { ...type.caption, color: colors.textMuted },
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
  muted: { ...type.caption, color: colors.textMuted },
  errorTitle: { ...type.cardTitle, color: colors.danger },
});
