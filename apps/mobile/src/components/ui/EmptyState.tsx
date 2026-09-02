import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { radius } from "../../design/radii";
import { type } from "../../design/typography";
import { Button } from "./Button";

/**
 * Empty state (Phase 8.1, spec 39): simple icon, strong title, short
 * explanation, one obvious CTA. Honest copy - no gamified hype.
 */
export function EmptyState(props: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  description?: string;
  ctaLabel?: string;
  onCta?: () => void;
  accessibilityLabel?: string;
}) {
  return (
    <View
      accessible
      accessibilityLabel={props.accessibilityLabel ?? props.title}
      style={styles.wrap}
    >
      {props.icon ? (
        <View style={styles.iconPlate}>
          <Ionicons name={props.icon} size={22} color={colors.textMuted} />
        </View>
      ) : null}
      <Text style={styles.title}>{props.title}</Text>
      {props.description ? <Text style={styles.description}>{props.description}</Text> : null}
      {props.ctaLabel && props.onCta ? (
        <View style={styles.ctaWrap}>
          <Button label={props.ctaLabel} variant="secondary" size="compact" onPress={props.onCta} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: space[2], paddingVertical: space[8], paddingHorizontal: space[4] },
  iconPlate: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: space[1],
  },
  title: { ...type.cardTitle, color: colors.text, textAlign: "center" },
  description: { ...type.caption, color: colors.textMuted, textAlign: "center", maxWidth: 280 },
  ctaWrap: { marginTop: space[2] },
});
