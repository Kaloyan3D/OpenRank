import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useCanonicalRevision } from "../../local-data/useCanonicalRevision";
import { useUnits } from "../../ui/units";
import { formatDateTime, formatProgressPercent, formatRankLabel, formatWeight } from "../../ui/format";
import { equipmentLabel } from "../../ui/equipment";
import { Screen } from "../../components/ui/Screen";
import { Card } from "../../components/ui/Card";
import { Chip } from "../../components/ui/Chip";
import { RankBadge } from "../../components/ui/RankBadge";
import { BarChart, formatShort } from "../../features/charts/BarChart";
import { rankColor } from "../../design/rank-colors";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * Exercise details (spec 34/36; Phase 8.1 approved structure):
 * Overview (canonical fields + muscles + instructions), History (PRs +
 * e1RM progression with est.1RM hero + delta vs 12 weeks ago) and Rank
 * (current rank + next target + rank history). Provisional ranks carry an
 * explicit PROVISIONAL label; unsupported exercises get honest "not
 * ranked" messaging - no fabricated numbers, no invented formulas.
 */
export default function ExerciseDetailScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  useCanonicalRevision(); // canonical invalidation (Phase 8.2)
  const params = useLocalSearchParams<{ id: string }>();
  const slug = typeof params.id === "string" ? decodeURIComponent(params.id) : "";

  // Snapshot "now" once per mount (pure render; WorkoutTimer precedent).
  const [nowTs] = useState(() => Date.now());
  const bySlug = repos.exercise.findBySlug(slug);
  const detail = bySlug ? repos.exercise.getDetail(bySlug.id) : null;
  const profile = repos.profile.getDefault();

  if (!detail) {
    return (
      <Screen>
        <Text style={styles.pageTitle}>Exercise not found</Text>
        <Text style={styles.meta}>{slug}</Text>
      </Screen>
    );
  }

  const { exercise } = detail;
  const aliases = detail.aliases
    .map((a) => a.alias)
    .filter((alias) => alias !== exercise.name)
    .slice(0, 8);
  const ranking = profile ? services.derived.getExerciseRanking(profile.id, exercise.id) : null;
  const s = ranking?.snapshot ?? null;

  // est. 1RM hero (spec 36): best e1RM + delta vs 12 weeks ago (bounded read).
  const e1rmPoints = profile ? services.analytics.e1rmProgression(profile.id, exercise.id, 50) : [];
  const bestE1rm = e1rmPoints.length > 0 ? e1rmPoints[e1rmPoints.length - 1]!.e1rmKg : null;
  const twelveWAgo = new Date(nowTs - 84 * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const windowPoints = e1rmPoints.filter((p) => p.at.slice(0, 10) >= twelveWAgo);
  const e1rmDelta =
    windowPoints.length > 1
      ? windowPoints[windowPoints.length - 1]!.e1rmKg - windowPoints[0]!.e1rmKg
      : 0;

  const prLine = (recordType: string, qualifierKey: string): string => {
    switch (recordType) {
      case "max_weight":
        return "Max weight";
      case "max_e1rm":
        return "Best estimated 1RM";
      case "max_set_volume":
        return "Best set volume";
      case "max_reps_at_weight":
        return "Most reps @ " + qualifierLabel(qualifierKey, units.weightLabel);
      default:
        return recordType;
    }
  };

  return (
    <Screen>
      <ScrollView showsVerticalScrollIndicator={false}>
        <View style={styles.headerRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back"
            onPress={() => router.back()}
            style={styles.backBtn}
          >
            <Text style={styles.backText}>{"\u2190"}</Text>
          </Pressable>
          <Text style={[styles.pageTitle, styles.pageTitleFlex]} numberOfLines={1}>
            {exercise.name}
          </Text>
        </View>

        {bestE1rm != null ? (
          <Card variant="elevated" style={styles.heroCard}>
            <Text style={styles.kicker}>ESTIMATED 1RM</Text>
            <View style={styles.heroRow}>
              <Text style={styles.heroValue}>
                {units.toDisplay(bestE1rm) + " " + units.weightLabel}
              </Text>
              {Math.abs(e1rmDelta) >= 0.05 ? (
                <Text
                  style={[
                    styles.heroDelta,
                    { color: e1rmDelta > 0 ? colors.success : colors.danger },
                  ]}
                  accessibilityLabel={
                    "Change over the last 12 weeks: " +
                    (e1rmDelta > 0 ? "up " : "down ") + formatWeight(Math.abs(e1rmDelta), units.weightLabel)
                  }
                >
                  {(e1rmDelta > 0 ? "+" : "\u2212") + formatWeight(Math.abs(e1rmDelta), units.weightLabel) + " / 12W"}
                </Text>
              ) : null}
            </View>
          </Card>
        ) : null}

        <View style={styles.badgeRow}>
          <Chip label={exercise.category} />
          {exercise.mechanic ? <Chip label={exercise.mechanic} /> : null}
          {exercise.force ? <Chip label={exercise.force} /> : null}
          <Chip label={equipmentLabel(exercise.equipment)} />
          <Chip label={exercise.trackingType.replace(/_/g, " ")} />
        </View>

        {ranking && exercise.rankingEligibility === "unsupported" ? (
          <>
            <Text style={styles.section}>RANK</Text>
            <Text style={styles.meta}>
              This exercise is not part of the ranked strength catalog, so it has no rank. Your sets still count toward
              personal records below.
            </Text>
          </>
        ) : ranking ? (
          <>
            <Text style={styles.section}>RANK</Text>
            {s ? (
              <Card>
                <View style={styles.rankRow}>
                  <RankBadge tierName={s.tierName} division={s.division} />
                  {ranking.provisional ? <Chip label="PROVISIONAL" /> : null}
                  <Text style={[styles.tierText, { color: rankColor(s.tierName) }]}>
                    {formatRankLabel(s.tierName, s.division)}
                  </Text>
                </View>
                {s.progress != null ? (
                  <Text style={styles.meta}>
                    {formatProgressPercent(s.progress) + " to next division - score " + s.score.toFixed(3)}
                  </Text>
                ) : (
                  <Text style={styles.meta}>Highest rank reached.</Text>
                )}
                {ranking.nextTarget ? (
                  <Text style={styles.meta}>
                    {"Next rank (" + ranking.nextTarget.targetTier + "): about " +
                      formatWeight(ranking.nextTarget.required1RM, "kg") + " of 1RM on this exercise's reference" +
                      (ranking.nextTarget.exampleTargetWeight != null
                        ? " - e.g. " + formatWeight(ranking.nextTarget.exampleTargetWeight, units.weightLabel) +
                          " x " + String(ranking.nextTarget.exampleReps)
                        : "") +
                      ". An estimate, not a prescription."}
                  </Text>
                ) : null}
                {ranking.provisional ? (
                  <Text style={styles.meta}>
                    This exercise's rank is provisional: its classification needs review, so it never influences muscle
                    group ranks.
                  </Text>
                ) : null}
              </Card>
            ) : (
              <Text style={styles.meta}>{unrankedReason(ranking.unavailableReason)}</Text>
            )}

            {ranking.rankEvents.length > 0 ? (
              <>
                <Text style={styles.subsection}>RANK HISTORY</Text>
                {ranking.rankEvents.map((e) => (
                  <Text
                    key={e.id}
                    style={[styles.meta, { color: e.direction === "up" ? rankColor(e.toTier) : colors.textMuted }]}
                  >
                    {(e.direction === "up" ? "\u2191 " : "\u2193 ") +
                      formatRankLabel(e.toTier, e.toDivision) +
                      " - " +
                      formatDateTime(e.createdAt)}
                  </Text>
                ))}
              </>
            ) : null}
          </>
        ) : null}

        {profile ? (
          <>
            <Text style={styles.section}>EST. 1RM PROGRESSION</Text>
            <BarChart
              points={services.analytics
                .e1rmProgression(profile.id, exercise.id, 12)
                .map((p) => ({
                  label: p.at.slice(5, 10),
                  value: p.e1rmKg,
                  accessibilityLabel:
                    "Estimated 1RM " + formatShort(p.e1rmKg) + " " + units.weightLabel + " on " + p.at.slice(0, 10),
                }))}
              unitLabel={"Best estimated 1RM (" + units.weightLabel + ") - each bar is a new personal record"}
              highlightFraction={0.999}
              emptyText="Complete sets on this exercise to build your estimated 1RM history."
            />
          </>
        ) : null}

        {ranking && ranking.records.length > 0 ? (
          <>
            <Text style={styles.section}>PERSONAL RECORDS</Text>
            <Card>
              {ranking.records.map((r) => (
                <View key={r.id + r.recordType + r.qualifierKey} style={styles.prRow}>
                  <Text style={styles.body}>{prLine(r.recordType, r.qualifierKey)}</Text>
                  <Text style={styles.prValue}>
                    {formatPrValue(r.recordType, r.value, r.sourceReps, units.weightLabel)}
                  </Text>
                </View>
              ))}
            </Card>
            {ranking.prEvents.length > 0 ? (
              <>
                <Text style={styles.subsection}>PR HISTORY</Text>
                {ranking.prEvents.map((e) => (
                  <Text key={e.id} style={styles.meta}>
                    {formatPrValue(e.recordType, e.value, null, units.weightLabel) +
                      " - " +
                      (e.previousValue == null ? "first record" : "up from " + formatPrValue(e.recordType, e.previousValue, null, units.weightLabel)) +
                      " - " +
                      formatDateTime(e.achievedAt)}
                  </Text>
                ))}
              </>
            ) : null}
          </>
        ) : null}

        <Text style={styles.section}>MUSCLES</Text>
        <Text style={styles.body}>
          {"Primary: " + (detail.primaryMuscles.join(", ") || "none")}
          {detail.secondaryMuscles.length > 0
            ? "\nSecondary: " + detail.secondaryMuscles.join(", ")
            : ""}
        </Text>

        <Text style={styles.section}>HOW TO</Text>
        {detail.instructions.length === 0 ? (
          <Text style={styles.meta}>No instructions in the source dataset.</Text>
        ) : (
          detail.instructions.map((step, i) => (
            <Text key={String(i)} style={styles.body}>
              {String(i + 1) + ". " + step}
            </Text>
          ))
        )}

        {aliases.length > 0 ? (
          <>
            <Text style={styles.section}>ALSO KNOWN AS</Text>
            <Text style={styles.body}>{aliases.join(", ")}</Text>
          </>
        ) : null}

        <Text style={styles.section}>MEDIA</Text>
        <Text style={styles.meta}>
          {detail.media.length > 0
            ? String(detail.media.length) + " images available via the media pack (not bundled)."
            : "No images in the source dataset."}
        </Text>
        <Text style={styles.source}>
          Source: {exercise.source} ({exercise.sourceId ?? "local"})
        </Text>
      </ScrollView>
    </Screen>
  );
}

function qualifierLabel(qualifierKey: string, weightLabel: string): string {
  const kg = Number(qualifierKey.slice(2));
  if (!Number.isFinite(kg)) return qualifierKey;
  return kg === 0 ? "bodyweight" : Math.round(kg * 100) / 100 + " " + weightLabel;
}

function formatPrValue(
  recordType: string,
  value: number,
  reps: number | null,
  weightLabel: string,
): string {
  const rounded = Math.round(value * 100) / 100;
  switch (recordType) {
    case "max_weight":
      return rounded + " " + weightLabel;
    case "max_e1rm":
      return Math.round(value * 10) / 10 + " " + weightLabel + " (est.)";
    case "max_set_volume":
      return rounded + " " + weightLabel;
    case "max_reps_at_weight":
      return String(reps ?? Math.round(value)) + " reps";
    default:
      return String(Math.round(value * 100) / 100);
  }
}

function unrankedReason(reason: string | null): string {
  switch (reason) {
    case "no_bodyweight":
      return "Add a bodyweight entry on the Profile tab to unlock ranks.";
    case "no_sets":
      return "Finish a workout with this exercise to earn its first rank.";
    default:
      return "Not ranked yet - finish a workout with this exercise.";
  }
}

const styles = StyleSheet.create({
  headerRow: { flexDirection: "row", alignItems: "center", gap: space[2], marginBottom: space[3] },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  backText: { ...type.bodyStrong, color: colors.text },
  pageTitle: { ...type.pageTitle, color: colors.text },
  pageTitleFlex: { flex: 1 },
  heroCard: { gap: space[1], marginBottom: space[3] },
  kicker: { ...type.label, color: colors.accent, letterSpacing: 1.2 },
  heroRow: { flexDirection: "row", alignItems: "baseline", gap: space[3] },
  heroValue: { ...type.metricLarge, color: colors.text, fontVariant: ["tabular-nums"] },
  heroDelta: { ...type.label, fontWeight: "700" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: space[2], marginBottom: space[2] },
  section: { ...type.label, color: colors.textSecondary, letterSpacing: 1.2, marginTop: space[4], marginBottom: space[1] },
  subsection: { ...type.label, color: colors.textMuted, letterSpacing: 1, marginTop: space[3], marginBottom: space[1] },
  rankRow: { flexDirection: "row", alignItems: "center", gap: space[3], marginBottom: space[2] },
  tierText: { ...type.bodyStrong },
  prRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: space[1] },
  prValue: { ...type.bodyStrong, color: colors.text, fontVariant: ["tabular-nums"] },
  body: { ...type.body, color: colors.text },
  meta: { ...type.caption, color: colors.textMuted },
  source: { ...type.caption, color: colors.textDisabled, marginTop: space[4] },
});
