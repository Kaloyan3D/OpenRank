import { useEffect, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { rankColor } from "../../design/rank-colors";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";
import { formatRankLabel } from "../../ui/format";
import { formatShort } from "./BarChart";
import { useReducedMotion } from "../../ui/useReducedMotion";
import { animationDuration } from "../../design/motion";

/**
 * Rank score timeline (Phase 8; Phase 8.1 styling): one bar per rank
 * snapshot, chronological, colored by the rank color of its tier (spec 30).
 * Consumes AnalyticsService.rankTimeline points; the component renders, it
 * never ranks. Reduced motion renders the final state immediately.
 */
export interface TierPoint {
  at: string;
  score: number;
  tierIndex: number;
  tierName: string;
  division: string | null;
  progress: number | null;
}

export function TierTimeline(props: { points: TierPoint[]; emptyText?: string }) {
  const { points } = props;
  const reduced = useReducedMotion();
  const [progress] = useState(() => new Animated.Value(reduced ? 1 : 0));

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: animationDuration(reduced), useNativeDriver: false }).start();
  }, [points.length, progress, reduced]);

  if (points.length === 0) {
    return <Text style={styles.empty}>{props.emptyText ?? "No rank history yet."}</Text>;
  }

  const max = Math.max(...points.map((p) => p.score), 1);

  return (
    <View
      accessible
      accessibilityLabel={
        "Rank history: " +
        points
          .map((p) => formatRankLabel(p.tierName, p.division) + " at " + p.at.slice(0, 10))
          .join(", then ")
      }
    >
      <View style={styles.row}>
        {points.map((p, i) => (
          <View key={String(i)} style={styles.col}>
            <View style={styles.track}>
              <Animated.View
                style={[
                  styles.fill,
                  {
                    height: (Math.max(6, (p.score / max) * 100) + "%") as `${number}%`,
                    backgroundColor: rankColor(p.tierName),
                    opacity: progress,
                  },
                ]}
              />
            </View>
            <Text style={styles.score}>{formatShort(p.score)}</Text>
            <Text style={[styles.tier, { color: rankColor(p.tierName) }]}>{formatRankLabel(p.tierName, p.division)}</Text>
            <Text style={styles.date}>{p.at.slice(0, 10).slice(5)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 6, marginTop: space[1] },
  col: { flex: 1, alignItems: "center", gap: 2 },
  track: { height: 88, width: "100%", justifyContent: "flex-end", backgroundColor: colors.surfacePressed, borderRadius: 6 },
  fill: { borderRadius: 6, minHeight: 6 },
  score: { ...type.caption, color: colors.textSecondary, fontSize: 10, fontVariant: ["tabular-nums"] },
  tier: { ...type.caption, fontWeight: "700", fontSize: 9 },
  date: { ...type.caption, color: colors.textMuted, fontSize: 8 },
  empty: { ...type.caption, color: colors.textMuted },
});
