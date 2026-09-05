import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { RANK_TIERS } from "@openrank/ranking-core";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useCanonicalRevision } from "../../local-data/useCanonicalRevision";
import { useUnits } from "../../ui/units";
import { formatDateTime, formatDayShort, formatProgressPercent, formatRankLabel } from "../../ui/format";
import { Screen } from "../../components/ui/Screen";
import { Card } from "../../components/ui/Card";
import { Chip } from "../../components/ui/Chip";
import { Badge } from "../../components/ui/Badge";
import { RankBadge } from "../../components/ui/RankBadge";
import { AnimatedProgress } from "../../ui/AnimatedProgress";
import { rankColor } from "../../design/rank-colors";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Ranks (Phase 8.2B pass 4, guide sections 4/22/23/37): the Strength
 * Profile - exactly the six muscle groups (Legs / Chest / Back / Shoulders /
 * Arms / Core) as compact scannable rows, plus a By Exercise view. There is
 * NO overall rank anywhere on this screen. Rank color appears ONLY on
 * rank-semantic UI: the badge, the tier label, the progress bar and the
 * destination tier of a rank change - never a whole-card tint, never neon.
 * Next-division labels reuse the engine-owned IV->III->II->I within-tier
 * sequence (packages/database divisions.ts) - no thresholds, scores or math
 * are recomputed here. Recent rank changes read canonical rank_events and
 * stay secondary progression evidence. Unranked, provisional and missing-
 * bodyweight states remain honest; every displayed value is engine output.
 */
const MUSCLE_LABELS: Record<string, string> = {
  legs: "Legs",
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  arms: "Arms",
  core: "Core",
};

/** Engine-owned within-tier division sequence (divisions.ts): IV -> I. */
const DIVISION_SEQUENCE: readonly string[] = ["IV", "III", "II", "I"];

/**
 * The division label that follows the current one. Reaching past "I" enters
 * the next tier at its entry division IV; the top tier has no next step.
 * Presentation of engine state only - never a threshold computation.
 */
function formatNextDivisionLabel(tierIndex: number, tierName: string, division: string): string | null {
  const at = DIVISION_SEQUENCE.indexOf(division);
  if (at < 0) return null;
  if (at + 1 < DIVISION_SEQUENCE.length) return tierName + " " + DIVISION_SEQUENCE[at + 1];
  const nextTier = RANK_TIERS[tierIndex + 1];
  return nextTier ? nextTier.name + " IV" : null;
}

/** Canonical provisional flag of a rank snapshot (projection details). */
function snapshotProvisional(s: { detailsJson: string }): boolean {
  try {
    return JSON.parse(s.detailsJson).provisional === true;
  } catch {
    return false;
  }
}

export default function RanksScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  const [mode, setMode] = useState<"muscle" | "exercise">("muscle");
  // Canonical invalidation (Phase 8.2): rank/PR rebuilds and bodyweight adds
  // publish -> this screen re-renders with fresh snapshots.
  useCanonicalRevision();

  const profile = repos.profile.getDefault();
  const view = profile ? services.derived.getStrengthProfile(profile.id) : null;
  const recent = profile ? services.derived.recentRankEvents(profile.id, 12) : [];
  // Exercise names resolve in BOTH modes: recent rank changes reference
  // exercise scopes too, and the fallback must never degrade to raw ids.
  const exerciseById = useMemoSafe(
    () => {
      if (!profile) return new Map<string, string>();
      return new Map(repos.exercise.listRankSupported().map((e) => [e.id, e.name]));
    },
    new Map<string, string>(),
  );
  const exerciseSnapshots = useMemoSafe(() => {
    if (!profile || mode !== "exercise") return [];
    return repos.rankSnapshots.latestForProfile(profile.id).filter((s) => s.scopeType === "exercise");
  }, []);
  // Scannable order for exercise rows: strongest tier first, then the
  // canonical strength score, then the name - presentation ordering of
  // engine-owned values, never a re-ranking.
  const sortedExerciseSnapshots = [...exerciseSnapshots].sort((a, b) => {
    if (a.tierIndex !== b.tierIndex) return b.tierIndex - a.tierIndex;
    if (a.score !== b.score) return b.score - a.score;
    return (exerciseById.get(a.scopeKey) ?? a.scopeKey).localeCompare(exerciseById.get(b.scopeKey) ?? b.scopeKey);
  });

  // Quiet profile summary from canonical snapshots only ("4 of 6 groups
  // ranked - Best: Diamond II"). Identifies the strongest group; it is NOT
  // an overall rank and never becomes one.
  let rankedCount = 0;
  let best: { tierIndex: number; label: string } | null = null;
  if (view) {
    for (const g of view.groups) {
      if (g.tierName == null || g.tierIndex == null) continue;
      rankedCount += 1;
      if (!best || g.tierIndex > best.tierIndex) {
        best = { tierIndex: g.tierIndex, label: formatRankLabel(g.tierName, g.division) };
      }
    }
  }

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
          <Text style={styles.bodyweightLine}>
            {"Bodyweight " +
              (view.bodyweightKg != null ? units.toDisplay(view.bodyweightKg) + " " + units.weightLabel : "-") +
              (view.bodyweightMeasuredAt ? " - measured " + formatDateTime(view.bodyweightMeasuredAt) : "")}
          </Text>
        )}

        {mode === "muscle" ? (
          <>
            {rankedCount > 0 ? (
              <Text style={styles.summary}>
                {rankedCount + " of " + view.groups.length + " groups ranked" + (best ? " - Best: " + best.label : "")}
              </Text>
            ) : null}
            {view.groups.map((g) => {
              const label = MUSCLE_LABELS[g.key] ?? g.key;
              const nextLabel =
                g.tierIndex != null && g.tierName != null && g.division != null
                  ? formatNextDivisionLabel(g.tierIndex, g.tierName, g.division)
                  : null;
              const scoreLabel = g.score != null ? "score " + g.score.toFixed(3) : null;
              return (
                <Pressable
                  key={g.key}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={
                    label + " rank " +
                    (g.tierName != null && g.tierIndex != null ? formatRankLabel(g.tierName, g.division) : "not ranked") +
                    (g.tierName != null && g.progress != null ? ", " + formatProgressPercent(g.progress) + " to next division" : "") +
                    ". Open detail."
                  }
                  onPress={() => router.push("/muscle/" + g.key)}
                >
                  <Card style={styles.rowCard}>
                    <View style={styles.rowHeader}>
                      <View style={styles.rowMain}>
                        <Text style={styles.groupLabel}>{label}</Text>
                        {g.tierName != null ? (
                          <Text style={[styles.tierLabel, { color: rankColor(g.tierName) }]}>
                            {formatRankLabel(g.tierName, g.division)}
                          </Text>
                        ) : (
                          <Text style={styles.tierMuted}>No rank yet</Text>
                        )}
                      </View>
                      <RankBadge tierName={g.tierName} division={g.division} size="sm" />
                    </View>
                    {g.tierName != null && g.progress != null ? (
                      <>
                        <AnimatedProgress value={g.progress} fillColor={rankColor(g.tierName)} />
                        <View style={styles.rowFooter}>
                          <Text style={styles.footerPrimary}>
                            {formatProgressPercent(g.progress) + (nextLabel ? " - Next " + nextLabel : "")}
                          </Text>
                          {scoreLabel ? <Text style={styles.footerMuted}>{scoreLabel}</Text> : null}
                        </View>
                      </>
                    ) : g.tierName != null ? (
                      // Mythic (top tier): the engine defines no next
                      // threshold, so progress simply does not exist here.
                      <View style={styles.rowFooter}>
                        <Text style={styles.footerPrimary}>Top tier reached</Text>
                        {scoreLabel ? <Text style={styles.footerMuted}>{scoreLabel}</Text> : null}
                      </View>
                    ) : (
                      <Text style={styles.contextMuted}>
                        {view.hasBodyweight
                          ? "Log a ranked exercise to place this group."
                          : "Strength ranks need a bodyweight entry."}
                      </Text>
                    )}
                  </Card>
                </Pressable>
              );
            })}
          </>
        ) : exerciseSnapshots.length === 0 ? (
          <Text style={styles.contextMuted}>No exercise ranks yet. Finish a ranked exercise to place one.</Text>
        ) : (
          <>
            <Text style={styles.summary}>
              {exerciseSnapshots.length + (exerciseSnapshots.length === 1 ? " ranked exercise" : " ranked exercises")}
            </Text>
            {sortedExerciseSnapshots.map((s) => {
              const name = exerciseById.get(s.scopeKey) ?? s.scopeKey;
              const provisional = snapshotProvisional(s);
              const nextLabel = s.division != null ? formatNextDivisionLabel(s.tierIndex, s.tierName, s.division) : null;
              return (
                <Pressable
                  key={s.scopeKey}
                  accessible
                  accessibilityRole="button"
                  accessibilityLabel={
                    name + " rank " + formatRankLabel(s.tierName, s.division) +
                    (provisional ? ", provisional" : "") +
                    (s.progress != null ? ", " + formatProgressPercent(s.progress) + " to next division" : "") +
                    ". Open detail."
                  }
                  onPress={() => router.push("/exercise/" + s.scopeKey)}
                >
                  <Card style={styles.rowCard}>
                    <View style={styles.rowHeader}>
                      <View style={styles.rowMain}>
                        <View style={styles.nameRow}>
                          <Text style={styles.groupLabel} numberOfLines={1} ellipsizeMode="tail">
                            {name}
                          </Text>
                          {provisional ? <Badge label="PROVISIONAL" color={colors.textSecondary} style={styles.provisionalBadge} /> : null}
                        </View>
                        <Text style={[styles.tierLabel, { color: rankColor(s.tierName) }]}>
                          {formatRankLabel(s.tierName, s.division)}
                        </Text>
                      </View>
                      <RankBadge tierName={s.tierName} division={s.division} size="sm" />
                    </View>
                    <View style={styles.rowFooter}>
                      <Text style={styles.footerPrimary}>
                        {s.division == null
                          ? "Top tier reached"
                          : s.progress != null
                            ? formatProgressPercent(s.progress) + (nextLabel ? " - Next " + nextLabel : "")
                            : ""}
                      </Text>
                      <Text style={styles.footerMuted}>{"score " + s.score.toFixed(3)}</Text>
                    </View>
                  </Card>
                </Pressable>
              );
            })}
          </>
        )}

        <Text style={styles.section}>RECENT RANK CHANGES</Text>
        {recent.length === 0 ? (
          <Text style={styles.contextMuted}>No rank changes yet. Finish workouts to climb.</Text>
        ) : (
          <Card variant="subtle" style={styles.eventsCard}>
            {recent.map((e) => {
              // Destination tier color ONLY on the destination tier (and the
              // arrow when climbing) - rank-down rows stay quiet neutral.
              const c = rankColor(e.toTier);
              const climbing = e.direction === "up";
              return (
                <View key={e.id} style={styles.eventRow}>
                  <Text style={[styles.eventArrow, { color: climbing ? c : colors.textMuted }]}>
                    {climbing ? "\u2191" : "\u2193"}
                  </Text>
                  <Text style={[styles.eventTier, { color: climbing ? c : colors.textMuted }]}>
                    {formatRankLabel(e.toTier, e.toDivision)}
                  </Text>
                  <Text style={styles.eventScope} numberOfLines={1}>
                    {e.scopeType === "muscle"
                      ? MUSCLE_LABELS[e.scopeKey] ?? e.scopeKey
                      : exerciseById.get(e.scopeKey) ?? "exercise"}
                  </Text>
                  <Text style={styles.eventDate}>{formatDayShort(e.createdAt)}</Text>
                </View>
              );
            })}
          </Card>
        )}

        <Text style={styles.note}>
          Ranks use the hevy-ranks-compatible-v1 engine: reference-lift strength per group, top-3 weighting, no overall
          score. Ranks are derived data and rebuild from your workout history at any time.
        </Text>
      </ScrollView>
    </Screen>
  );
}

/** Tiny guard so per-mode reads never crash the screen. */
function useMemoSafe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

const styles = StyleSheet.create({
  kicker: { ...type.label, color: colors.accent, letterSpacing: 1.2 },
  pageTitle: { ...type.pageTitle, color: colors.text, marginBottom: space[2] },
  modeRow: { flexDirection: "row", gap: space[2], marginBottom: space[2] },
  summary: { ...type.caption, color: colors.textSecondary, marginBottom: space[1] },
  bodyweightLine: { ...type.caption, color: colors.textMuted, marginBottom: space[1] },
  section: { ...type.label, color: colors.textSecondary, letterSpacing: 1.2, marginTop: space[5], marginBottom: space[1] },
  rowCard: { paddingVertical: space[3], paddingHorizontal: space[4], marginBottom: space[2] },
  rowHeader: { flexDirection: "row", alignItems: "flex-start", gap: space[2] },
  rowMain: { flex: 1, gap: 1 },
  nameRow: { flexDirection: "row", alignItems: "center", gap: space[2] },
  groupLabel: { ...type.cardTitle, color: colors.text, flexShrink: 1 },
  tierLabel: { ...type.caption, fontWeight: "700" },
  tierMuted: { ...type.caption, color: colors.textMuted },
  rowFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  footerPrimary: { ...type.caption, color: colors.textSecondary, fontVariant: ["tabular-nums"] },
  footerMuted: { ...type.caption, color: colors.textMuted, fontVariant: ["tabular-nums"] },
  contextMuted: { ...type.caption, color: colors.textMuted },
  provisionalBadge: { alignSelf: "center" },
  cta: {
    backgroundColor: colors.accentSubtle,
    borderColor: colors.accent,
    borderWidth: 1,
    borderRadius: 12,
    padding: space[3],
    marginBottom: space[2],
  },
  ctaText: { ...type.caption, color: colors.accent, fontWeight: "600" },
  eventsCard: { paddingVertical: space[2], paddingHorizontal: space[3] },
  eventRow: { flexDirection: "row", alignItems: "center", gap: space[2], paddingVertical: space[1] },
  eventArrow: { ...type.bodyStrong, width: 14, textAlign: "center" },
  eventTier: { ...type.caption, fontWeight: "700" },
  eventScope: { ...type.caption, color: colors.textSecondary, flex: 1 },
  eventDate: { ...type.caption, color: colors.textMuted, fontVariant: ["tabular-nums"] },
  note: { ...type.caption, color: colors.textMuted, marginTop: space[5] },
  muted: { ...type.caption, color: colors.textMuted },
});
