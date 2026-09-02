import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useUnits } from "../../ui/units";
import { formatDateTime, formatProgressPercent, formatRankLabel } from "../../ui/format";
import { Screen } from "../../components/ui/Screen";
import { Card } from "../../components/ui/Card";
import { Chip } from "../../components/ui/Chip";
import { RankBadge } from "../../components/ui/RankBadge";
import { AnimatedProgress } from "../../ui/AnimatedProgress";
import { rankColor } from "../../design/rank-colors";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Ranks (Phase 8.1 approved structure, spec 28/29): the Strength Profile -
 * exactly the six muscle groups (Legs / Chest / Back / Shoulders / Arms /
 * Core), plus a By Exercise view (all ranked exercises). There is NO
 * overall rank anywhere on this screen. Rank accent appears ONLY on the
 * badge, the progress bar and the tier label - never tints whole screens
 * or cards. Recent rank changes read canonical rank_events.
 */
const MUSCLE_LABELS: Record<string, string> = {
  legs: "Legs",
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  arms: "Arms",
  core: "Core",
};

export default function RanksScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  const [mode, setMode] = useState<"muscle" | "exercise">("muscle");
  const [reloadKey] = useState(0);
  void reloadKey;

  const profile = repos.profile.getDefault();
  const view = profile ? services.derived.getStrengthProfile(profile.id) : null;
  const recent = profile ? services.derived.recentRankEvents(profile.id, 12) : [];
  const exerciseSnapshots = useMemoSafe(() => {
    if (!profile || mode !== "exercise") return [];
    void reloadKey;
    return repos.rankSnapshots.latestForProfile(profile.id).filter((s) => s.scopeType === "exercise");
  });
  const exerciseById = useMemoSafe(() => {
    if (mode !== "exercise") return new Map<string, string>();
    void reloadKey;
    return new Map(repos.exercise.listRankSupported().map((e) => [e.id, e.name]));
  });

  if (!view) {
    return (
      <Screen>
        <Text style={styles.kicker}>RANKS</Text>
        <Text style={styles.muted}>Create your profile to see your strength ranks.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={styles.kicker}>RANKS</Text>
        <Text style={styles.pageTitle}>Strength Profile</Text>

        <View style={styles.modeRow}>
          <Chip label="By Muscle Group" selected={mode === "muscle"} onPress={() => setMode("muscle")} accessibilityLabel="Show ranks by muscle group" />
          <Chip label="By Exercise" selected={mode === "exercise"} onPress={() => setMode("exercise")} accessibilityLabel="Show ranks by exercise" />
        </View>

        {!view.hasBodyweight ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Add bodyweight to calculate strength ranks"
            onPress={() => router.push("/(tabs)/profile")}
            style={styles.cta}
          >
            <Text style={styles.ctaText}>Add bodyweight to calculate strength ranks.</Text>
          </Pressable>
        ) : (
          <Text style={styles.meta}>
            {"Bodyweight " +
              (view.bodyweightKg != null ? units.toDisplay(view.bodyweightKg) + " " + units.weightLabel : "-") +
              (view.bodyweightMeasuredAt ? " - measured " + formatDateTime(view.bodyweightMeasuredAt) : "")}
          </Text>
        )}

        {mode === "muscle"
          ? view.groups.map((g) => (
              <Pressable
                key={g.key}
                accessible
                accessibilityRole="button"
                accessibilityLabel={
                  MUSCLE_LABELS[g.key] + " rank " +
                  (g.tierName ? formatRankLabel(g.tierName, g.division) : "not ranked") +
                  (g.progress != null ? ", " + formatProgressPercent(g.progress) + " to next division" : "") +
                  ". Open detail."
                }
                onPress={() => router.push("/muscle/" + g.key)}
              >
                <Card>
                  <View style={styles.cardHeader}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.groupLabel}>{MUSCLE_LABELS[g.key]}</Text>
                      {g.tierName ? (
                        <Text style={[styles.tierLabel, { color: rankColor(g.tierName) }]}>
                          {formatRankLabel(g.tierName, g.division)}
                        </Text>
                      ) : (
                        <Text style={styles.tierMuted}>No rank yet</Text>
                      )}
                    </View>
                    <RankBadge tierName={g.tierName} division={g.division} size="sm" />
                  </View>
                  {g.tierName && g.progress != null ? (
                    <AnimatedProgress value={g.progress ?? 0} fillColor={rankColor(g.tierName)} />
                  ) : null}
                  <Text style={styles.meta}>
                    {g.tierName && g.progress != null
                      ? formatProgressPercent(g.progress) + " to next division - score " + (g.score != null ? g.score.toFixed(3) : "-")
                      : view.hasBodyweight
                        ? "Log a ranked exercise to place this group."
                        : "Strength ranks need a bodyweight entry."}
                  </Text>
                </Card>
              </Pressable>
            ))
          : exerciseSnapshots.length === 0
            ? (
              <Text style={styles.meta}>No exercise ranks yet. Finish a ranked exercise to place one.</Text>
            )
            : exerciseSnapshots.map((s) => (
                <Pressable
                  key={s.scopeKey}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={exerciseById.get(s.scopeKey) + " rank " + formatRankLabel(s.tierName, s.division) + ". Open detail."}
                  onPress={() => router.push("/exercise/" + s.scopeKey)}
                >
                  <Card>
                    <View style={styles.cardHeader}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.groupLabel}>{exerciseById.get(s.scopeKey) ?? s.scopeKey}</Text>
                        <Text style={[styles.tierLabel, { color: rankColor(s.tierName) }]}>
                          {formatRankLabel(s.tierName, s.division)}
                        </Text>
                      </View>
                      <RankBadge tierName={s.tierName} division={s.division} size="sm" />
                    </View>
                    <Text style={styles.meta}>{"Strength score " + s.score.toFixed(3) + (s.progress != null ? " - " + formatProgressPercent(s.progress) + " to next division" : "")}</Text>
                  </Card>
                </Pressable>
              ))}

        <Text style={styles.section}>RECENT RANK CHANGES</Text>
        {recent.length === 0 ? (
          <Text style={styles.meta}>No rank changes yet. Finish workouts to climb.</Text>
        ) : (
          recent.map((e) => {
            const c = rankColor(e.toTier);
            return (
              <View key={e.id} style={styles.eventRow}>
                <Text style={[styles.eventArrow, { color: e.direction === "up" ? c : colors.textMuted }]}>
                  {e.direction === "up" ? "\u2191" : "\u2193"}
                </Text>
                <Text style={[styles.eventText, { color: e.direction === "up" ? c : colors.textMuted }]}>
                  {formatRankLabel(e.toTier, e.toDivision) +
                    " - " +
                    (e.scopeType === "muscle" ? MUSCLE_LABELS[e.scopeKey] ?? e.scopeKey : exerciseById.get(e.scopeKey) ?? "exercise") +
                    " - " +
                    formatDateTime(e.createdAt)}
                </Text>
              </View>
            );
          })
        )}

        <Text style={styles.note}>
          Ranks use the hevy-ranks-compatible-v1 engine: reference-lift strength per group, top-3 weighting, no overall
          score. Ranks are derived data and rebuild from your workout history at any time.
        </Text>
      </ScrollView>
    </Screen>
  );
}

/** Tiny guard so per-mode memo reads never crash the screen. */
function useMemoSafe<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    return [] as unknown as T;
  }
}

const styles = StyleSheet.create({
  kicker: { ...type.label, color: colors.accent, letterSpacing: 1.2 },
  pageTitle: { ...type.pageTitle, color: colors.text, marginBottom: space[2] },
  modeRow: { flexDirection: "row", gap: space[2], marginBottom: space[3] },
  meta: { ...type.caption, color: colors.textMuted },
  section: { ...type.label, color: colors.textSecondary, letterSpacing: 1.2, marginTop: space[4], marginBottom: space[1] },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: space[2] },
  groupLabel: { ...type.cardTitle, color: colors.text },
  tierLabel: { ...type.caption, fontWeight: "700" },
  tierMuted: { ...type.caption, color: colors.textMuted },
  cta: {
    backgroundColor: colors.accentSubtle,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 12,
    padding: space[3],
    marginBottom: space[3],
  },
  ctaText: { ...type.caption, color: colors.accent, fontWeight: "600" },
  eventRow: { flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[1] },
  eventArrow: { ...type.bodyStrong, width: 16 },
  eventText: { ...type.caption, flex: 1 },
  note: { ...type.caption, color: colors.textMuted, marginTop: space[4] },
  muted: { ...type.caption, color: colors.textMuted },
});
