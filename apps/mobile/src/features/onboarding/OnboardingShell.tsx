import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";
import { Button } from "../../components/ui/Button";

/**
 * Shared onboarding chrome (Phase 8.1 restyle): step kicker, page title,
 * caption body copy and a consistent primary/secondary action area on the
 * approved dark athletic design system. Every step persists BEFORE the
 * continue callback routes onward - resumability is a service-layer fact,
 * never React state. No semantics changed by the restyle.
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
          <Button
            label={"← Back"}
            variant="ghost"
            size="compact"
            onPress={back}
            accessibilityLabel="Go back"
          />
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
          <Button
            label={props.secondaryLabel}
            variant="secondary"
            onPress={props.onSecondary}
            fullWidth
            accessibilityLabel={props.secondaryLabel}
          />
        ) : null}
        {props.onContinue ? (
          <Button
            label={props.continueLabel ?? "CONTINUE"}
            variant="primary"
            onPress={props.onContinue}
            fullWidth
            disabled={props.continueDisabled === true}
            style={props.continueDisabled ? styles.disabled : undefined}
            accessibilityLabel={props.continueLabel ?? "Continue"}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space[4], paddingTop: space[2] },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 40,
    marginTop: space[1],
  },
  step: { ...type.label, color: colors.accent, letterSpacing: 1.2, textTransform: "uppercase" },
  body: { flex: 1, gap: space[3], paddingTop: space[2] },
  title: { ...type.pageTitle, color: colors.text },
  subtitle: { ...type.caption, color: colors.textMuted },
  actions: { gap: space[2], paddingBottom: space[6] },
  disabled: { opacity: 0.4 },
});
