import { useEffect, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { colors } from "../../design/colors";
import { type } from "../../design/typography";

/**
 * Pure-RN animated bar chart (Phase 8). No chart library, no SVG, no native
 * dependency - deterministic bars scaled to the series max. Data comes from
 * AnalyticsService projections; this component never computes values.
 */
export interface BarPoint {
  /** Short caption under the bar (may be empty). */
  label: string;
  value: number;
  /** Accessibility text for the bar (full description). */
  accessibilityLabel: string;
}

export function BarChart(props: {
  points: BarPoint[];
  unitLabel: string;
  /** Bars at or above this fraction of max get accent color. */
  highlightFraction?: number;
  emptyText?: string;
}) {
  const { points } = props;
  // Render-stable Animated.Value list (useState initializer runs once).
  const [animations] = useState(() => points.map(() => new Animated.Value(0)));

  useEffect(() => {
    Animated.stagger(
      30,
      animations.map((a) => Animated.timing(a, { toValue: 1, duration: 420, useNativeDriver: false })),
    ).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points.length]);

  if (points.length === 0) {
    return <Text style={styles.empty}>{props.emptyText ?? "No data yet."}</Text>;
  }

  const max = Math.max(...points.map((p) => p.value), 1);
  const highlight = props.highlightFraction ?? 0.999;

  return (
    <View
      accessible
      accessibilityLabel={points.map((p) => p.accessibilityLabel).join("; ")}
    >
      <View style={styles.rowWrap}>
        {points.map((p, i) => {
          const ratio = p.value / max;
          return (
            <View key={String(i)} style={styles.barCol}>
              <View style={styles.barTrack}>
                <Animated.View
                  style={[
                    styles.barFill,
                    { height: (Math.max(ratio > 0 ? 4 : 0, ratio * 100) + "%") as `${number}%` },
                    ratio >= highlight ? styles.barFillHot : null,
                    { opacity: animations[i] },
                  ]}
                />
              </View>
              <Text style={styles.barValue} numberOfLines={1}>
                {p.value > 0 ? formatShort(p.value) : ""}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={styles.rowWrap}>
        {points.map((p, i) => (
          <Text key={String(i)} style={styles.barLabel} numberOfLines={1}>
            {p.label}
          </Text>
        ))}
      </View>
      <Text style={styles.unit}>{props.unitLabel}</Text>
    </View>
  );
}

/** Deterministic compact value formatting for bar captions. */
export function formatShort(value: number): string {
  if (value >= 100000) return String(Math.round(value / 1000)) + "k";
  if (value >= 10000) return (value / 1000).toFixed(1) + "k";
  if (value >= 1000) return String(Math.round(value));
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(1);
}

const styles = StyleSheet.create({
  rowWrap: { flexDirection: "row", alignItems: "flex-end", gap: 5 },
  barCol: { flex: 1, alignItems: "center", gap: 2 },
  barTrack: { height: 96, width: "100%", justifyContent: "flex-end", backgroundColor: colors.surfacePressed, borderRadius: 6 },
  barFill: { backgroundColor: colors.accent, borderRadius: 6, minHeight: 2 },
  barFillHot: { backgroundColor: colors.success },
  barValue: { ...type.caption, color: colors.textMuted, fontSize: 9, fontVariant: ["tabular-nums"] },
  barLabel: { ...type.caption, color: colors.textMuted, fontSize: 9, flex: 1, textAlign: "center" },
  unit: { ...type.caption, color: colors.textMuted, fontSize: 10 },
  empty: { ...type.caption, color: colors.textMuted },
});
