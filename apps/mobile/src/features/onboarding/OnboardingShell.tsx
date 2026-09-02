import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing, typography } from "../../theme/tokens";

/**
 * Shared onboarding chrome (Phase 7.1): step kicker, title, body copy and a
 * consistent primary/secondary action area. Every step persists BEFORE the
 * continue callback routes onward - resumability is a service-layer fact,
 * never React state.
 */
export function OnboardingShell(props: {
  step: string;
  title: string;
  subtitle?: string;
  children?: ReactNode;
  onBack?: () => void;
  onContinue?: () => void;
  continueLabel?: string;
  continueDisabled?: boolean;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  const router = useRouter();
  const back = props.onBack ?? (() => router.back());
  return (
    <View style={styles.container}>
      <View style={styles.topBar}>
        {props.onBack !== null ? (
          <Pressable onPress={back} accessibilityLabel="Go back" hitSlop={12}>
            <Text style={styles.backText}>{"\u2190 Back"}</Text>
          </Pressable>
        ) : (
          <View />
        )}
        <Text style={styles.step}>{props.step}</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.title}>{props.title}</Text>
        {props.subtitle ? <Text style={styles.subtitle}>{props.subtitle}</Text> : null}
        {props.children}
      </View>

      <View style={styles.actions}>
        {props.secondaryLabel && props.onSecondary ? (
          <Pressable style={styles.secondaryButton} onPress={props.onSecondary}>
            <Text style={styles.secondaryText}>{props.secondaryLabel}</Text>
          </Pressable>
        ) : null}
        {props.onContinue ? (
          <Pressable
            style={[styles.primaryButton, props.continueDisabled && styles.disabled]}
            onPress={props.onContinue}
            disabled={props.continueDisabled}
            accessibilityLabel={props.continueLabel ?? "Continue"}
          >
            <Text style={styles.primaryText}>{props.continueLabel ?? "CONTINUE"}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, padding: spacing.lg, gap: spacing.lg },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.md },
  backText: { color: colors.accent, fontWeight: "700" },
  step: { color: colors.textMuted, fontSize: 11, fontWeight: "700", letterSpacing: 1.5, textTransform: "uppercase" },
  body: { flex: 1, gap: spacing.sm },
  title: { ...typography.title, color: colors.text, fontSize: 26 },
  subtitle: { ...typography.body, color: colors.textMuted },
  actions: { gap: spacing.sm, paddingBottom: spacing.lg },
  primaryButton: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: "center",
    minHeight: 52,
    justifyContent: "center",
  },
  primaryText: { color: "#0b1220", fontWeight: "800", letterSpacing: 1.2 },
  secondaryButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a3242",
  },
  secondaryText: { color: colors.textMuted, fontWeight: "700", letterSpacing: 0.5 },
  disabled: { opacity: 0.4 },
});
