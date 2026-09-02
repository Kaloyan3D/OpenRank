import { useEffect, useState } from "react";
import { Animated, StyleSheet, Text, View } from "react-native";
import { colors, typography } from "../../theme/tokens";
import { formatRankLabel } from "../../ui/format";
import { formatShort } from "./BarChart";

/**
 * Rank score timeline (Phase 8): one bar per rank snapshot, chronological,
 * colored by tier band. Consumes AnalyticsService.rankTimeline points; the
 * component renders, it never ranks.
 */
export interface TierPoint {
  at: string;
  score: number;
  tierIndex: number;
  tierName: string;
  division: string | null;
  progress: number | null;
}

const TIER_BAND_COLORS: readonly string[] = ["#8a6d3b", "#9aa5b1", "#d4af37", "#7fc7d9", "#7ee0c9", "#b28dd9", "#e08a5a", "#e0b45a", "#ffd700"];

export function TierTimeline(props: { points: TierPoint[]; emptyText?: string }) {
  const { points } = props;
  const [progress] = useState(() => new Animated.Value(0));

  useEffect(() => {
    Animated.timing(progress, { toValue: 1, duration: 500, useNativeDriver: false }).start();
  }, [points.length, progress]);

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
                    backgroundColor: TIER_BAND_COLORS[Math.min(p.tierIndex, TIER_BAND_COLORS.length - 1)],
                    opacity: progress,
                  },
                ]}
              />
            </View>
            <Text style={styles.score}>{formatShort(p.score)}</Text>
            <Text style={styles.tier}>{formatRankLabel(p.tierName, p.division)}</Text>
            <Text style={styles.date}>{p.at.slice(0, 10).slice(5)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "flex-end", gap: 6 },
  col: { flex: 1, alignItems: "center", gap: 2 },
  track: { height: 88, width: "100%", justifyContent: "flex-end", backgroundColor: "rgba(255,255,255,0.04)", borderRadius: 6 },
  fill: { borderRadius: 6, minHeight: 6 },
  score: { ...typography.caption, color: colors.text, fontSize: 10, fontVariant: ["tabular-nums"] },
  tier: { ...typography.caption, color: colors.accent, fontSize: 9 },
  date: { ...typography.caption, color: colors.textMuted, fontSize: 8 },
  empty: { ...typography.caption, color: colors.textMuted },
});
