import { useState } from "react";
import { StyleSheet, Text, TextInput } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing } from "../../theme/tokens";
import { useServices } from "../../services/ServicesProvider";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Local profile (spec 10). The display name creates the LOCAL
 * profile row the moment it is submitted: from here on a profile exists with
 * onboarding_completed = false, and process death resumes from the DB.
 * Trimmed, non-empty, Unicode-safe, capped at 40 code points. No legal or
 * full-name requirement, no account.
 */
export default function OnboardingName() {
  const router = useRouter();
  const services = useServices();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const existing = services.profile.getDefaultProfile();
  const initial = existing && !existing.onboardingCompleted ? existing.displayName : "";

  const submit = () => {
    try {
      const result = services.profile.createLocalProfile({ displayName: name });
      // "reused" is expected when resuming; "conflict" cannot happen here
      // because the root gate never routes a completed profile to onboarding.
      void result;
      router.push("/onboarding/units");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <OnboardingShell
      step="Step 1 of 6"
      title="What should OpenRank call you?"
      subtitle="A local name only - no account, no email, nothing leaves this device."
      onContinue={() => submit()}
      continueDisabled={name.trim().length === 0}
      onBack={() => router.replace("/onboarding")}
    >
      <TextInput
        style={styles.input}
        value={initial && name === "" ? initial : name}
        onChangeText={setName}
        placeholder="Kaloyan"
        placeholderTextColor={colors.textMuted}
        maxLength={60}
        autoFocus
        accessibilityLabel="Display name"
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 18,
    marginTop: spacing.sm,
  },
  error: { color: "#e8a0a0", fontSize: 13 },
});
