import { useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useUnits } from "../../ui/units";
import { formatDateTime } from "../../ui/format";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Profile (Phase 5 scope): bodyweight management (ranks REQUIRE a bodyweight
 * entry - the CTA wording mirrors the Ranks tab), strength standard
 * (male/female ranking reference - changing it rebuilds ranks, never workouts
 * or PRs) and display units. Changing display units does NOT touch rankings.
 */
export default function ProfileScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  const [weightInput, setWeightInput] = useState("");
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [nonce, setNonce] = useState(0);
  void nonce;

  const profile = repos.profile.getDefault();
  const history = profile ? repos.bodyweight.history(profile.id) : [];
  const latest = history[0] ?? null;

  const addBodyweight = () => {
    if (!profile) return;
    const kg = units.fromDisplay(weightInput);
    if (kg == null || kg <= 0) {
      Alert.alert("Invalid bodyweight", "Enter a positive number.");
      return;
    }
    try {
      repos.bodyweight.add({
        profileId: profile.id,
        measuredAt: new Date().toISOString(),
        weightKg: Math.round(kg * 1000) / 1000,
        source: "manual entry",
      });
      setWeightInput("");
      setNonce((n) => n + 1);
    } catch (err) {
      Alert.alert("Cannot save bodyweight", err instanceof Error ? err.message : String(err));
    }
  };

  const setStandard = (standard: "male" | "female") => {
    if (!profile || profile.strengthStandard === standard) return;
    try {
      repos.profile.updateStrengthStandard(profile.id, standard);
      // Ranks rebuild on the next worker pass; trigger it right away.
      services.derived.processPending();
      setNonce((n) => n + 1);
    } catch (err) {
      Alert.alert("Cannot change standard", err instanceof Error ? err.message : String(err));
    }
  };

  const setUnits = (system: "metric" | "imperial") => {
    if (!profile || profile.unitSystem === system) return;
    try {
      repos.profile.updateUnitSystem(profile.id, system);
      setNonce((n) => n + 1);
    } catch (err) {
      Alert.alert("Cannot change units", err instanceof Error ? err.message : String(err));
    }
  };

  if (!profile) {
    // The root routing gate owns this; corruption recovery only (spec 23).
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Internal state error</Text>
        <Text style={styles.muted}>The local profile is missing. Restart the app to recover.</Text>
      </View>
    );
  }

  const saveName = () => {
    try {
      services.profile.updateDisplayName(profile.id, nameDraft);
      setEditingName(false);
      setNonce((n) => n + 1);
    } catch (err) {
      Alert.alert("Cannot rename", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.kicker}>PROFILE</Text>
      {editingName ? (
        <View style={styles.row}>
          <TextInput
            style={styles.input}
            value={nameDraft}
            onChangeText={setNameDraft}
            autoFocus
            maxLength={60}
            accessibilityLabel="Display name"
          />
          <Pressable style={styles.button} onPress={saveName}>
            <Text style={styles.buttonText}>Save</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.row}>
          <Text style={styles.title}>{profile.displayName}</Text>
          <Pressable
            onPress={() => {
              setNameDraft(profile.displayName);
              setEditingName(true);
            }}
            accessibilityLabel="Edit display name"
          >
            <Text style={styles.linkText}>Edit</Text>
          </Pressable>
        </View>
      )}
      <Text style={styles.meta}>Local profile on this device - no account required.</Text>

      <Text style={styles.section}>Bodyweight</Text>
      {!latest ? (
        <Text style={styles.callout}>Add bodyweight to calculate strength ranks.</Text>
      ) : (
        <Text style={styles.body}>
          {units.toDisplay(latest.weightKg) + " " + units.weightLabel + " - measured " + formatDateTime(latest.measuredAt)}
        </Text>
      )}
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={weightInput}
          onChangeText={setWeightInput}
          placeholder={"current weight (" + units.weightLabel + ")"}
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
        />
        <Pressable style={styles.button} onPress={addBodyweight}>
          <Text style={styles.buttonText}>Add</Text>
        </Pressable>
      </View>
      {history.length > 0 ? (
        <Text style={styles.meta}>
          {String(history.length) + " entries recorded - the newest at or before each workout is used for its ranks."}
        </Text>
      ) : null}

      <Text style={styles.section}>Ranking reference</Text>
      <Text style={styles.meta}>
        {profile.strengthStandard === "male" ? "Male reference" : "Female reference"} - used to calculate your strength ranks.
      </Text>

      <Text style={styles.section}>Ranking standard</Text>
      <Text style={styles.meta}>
        Ranks compare your strength to the selected reference standard.
        Changing it recalculates ranks (never workouts or records).
      </Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.button, profile.strengthStandard === "male" && styles.buttonActive]}
          onPress={() => setStandard("male")}
        >
          <Text style={styles.buttonText}>Male reference</Text>
        </Pressable>
        <Pressable
          style={[styles.button, profile.strengthStandard === "female" && styles.buttonActive]}
          onPress={() => setStandard("female")}
        >
          <Text style={styles.buttonText}>Female reference</Text>
        </Pressable>
      </View>

      <Text style={styles.section}>Notifications</Text>
      <Text style={styles.meta}>Local reminders for planned sessions and rest timers.</Text>
      <Pressable style={styles.button} onPress={() => router.push("/notifications")}>
        <Text style={styles.buttonText}>Notification settings</Text>
      </Pressable>

      <Text style={styles.section}>Training schedule</Text>
      <Text style={styles.meta}>Set your weekly training days, pauses and planned sessions.</Text>
      <Pressable style={styles.button} onPress={() => router.push("/schedule")}>
        <Text style={styles.buttonText}>Edit training schedule</Text>
      </Pressable>

      <Text style={styles.section}>Display units</Text>
      <Text style={styles.meta}>
        Display only - all data is stored in canonical units and ranks are unaffected.
      </Text>
      <View style={styles.row}>
        <Pressable
          style={[styles.button, profile.unitSystem === "metric" && styles.buttonActive]}
          onPress={() => setUnits("metric")}
        >
          <Text style={styles.buttonText}>kg</Text>
        </Pressable>
        <Pressable
          style={[styles.button, profile.unitSystem === "imperial" && styles.buttonActive]}
          onPress={() => setUnits("imperial")}
        >
          <Text style={styles.buttonText}>lb</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.xs, paddingBottom: 60 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.background, padding: spacing.lg },
  kicker: { color: colors.accent, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  title: { ...typography.title, color: colors.text },
  section: { ...typography.title, color: colors.text, fontSize: 18, marginTop: spacing.md },
  body: { ...typography.body, color: colors.text },
  meta: { ...typography.caption },
  muted: { ...typography.caption, color: colors.textMuted },
  callout: { ...typography.body, color: colors.accent },
  row: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, flexWrap: "wrap" },
  input: {
    flex: 1,
    minWidth: 140,
    backgroundColor: colors.surface,
    borderRadius: 8,
    color: colors.text,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  button: {
    backgroundColor: colors.surface,
    borderRadius: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    justifyContent: "center",
  },
  buttonActive: { borderColor: colors.accent, borderWidth: 1 },
  buttonText: { color: colors.accent, fontWeight: "700" },
  linkText: { color: colors.accent, fontWeight: "700", marginLeft: spacing.sm },
  errorTitle: { color: "#ff6b6b", fontSize: 16, fontWeight: "700" },
});