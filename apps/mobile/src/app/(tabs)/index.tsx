import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import {
  ActiveWorkoutConflictError,
  computeLogicalTrainingDate,
  resolveHomeSessionView,
} from "@openrank/database";
import { GROUPS } from "@openrank/ranking-core";
import { type PersonalRecordEvent } from "@openrank/domain";
import { useRepos } from "../../db/DatabaseProvider";
import { useServices } from "../../services/ServicesProvider";
import { useCanonicalRevision } from "../../local-data/useCanonicalRevision";
import { Badge } from "../../components/ui/Badge";
import { Button } from "../../components/ui/Button";
import { Card } from "../../components/ui/Card";
import { Divider } from "../../components/ui/Divider";
import { RankBadge } from "../../components/ui/RankBadge";
import { SectionHeader } from "../../components/ui/SectionHeader";
import { colors } from "../../design/colors";
import { rankColor } from "../../design/rank-colors";
import { SCREEN_PADDING, space } from "../../design/spacing";
import { type } from "../../design/typography";
import { formatDurationRough, formatVolume } from "../../ui/format";
import { useUnits } from "../../ui/units";

/**
 * Home (Phase 8.2B visual fidelity pass - guide sections 2/5/7/9/12/16/37):
 * "What should I do today?". Approved hierarchy: greeting -> date -> TODAY
 * hero (the one dominant card) -> streak + compact week strip -> compact
 * Strength Profile (exactly six rows; rank color lives only in the badge) ->
 * Recent Wins (canonical events only) -> quiet utility links. Hierarchy
 * comes from typography, spacing and surface contrast - not from borders.
 *
 * All Phase 6/7.1/8.2 correctness semantics are preserved unchanged:
 *
 * - The root onboarding gate owns profile state; corruption shows a
 *   recoverable error and NEVER fabricates a profile.
 * - Future obligations are never silently reinterpreted (NEXT WORKOUT +
 *   VIEW PLAN + explicit bonus only; satisfaction requires an explicit
 *   reschedule). Early training never satisfies a future obligation.
 * - Recent wins are CANONICAL events only: personal-record events, rank
 *   events, streak state. Achievements never redefine these systems.
 * - Home stays mounted across tab switches and re-renders on every canonical
 *   commit via useCanonicalRevision, rereading SQLite during render.
 * - No overall rank. Exactly six strength groups. Rank colors stay local to
 *   rank badges; green appears only as completed state on the week strip.
 */

const WEEKDAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"] as const;
const WEEKDAY_LONG = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

const WEEK_STATE_GLYPH: Record<string, string> = {
  completed: "\u2713",
  rest: "\u00B7",
  missed: "\u2715",
  paused: "\u23F8",
  rescheduled: "\u21BB",
};
const WEEK_STATE_LABEL: Record<string, string> = {
  completed: "Completed",
  planned: "Planned",
  rest: "Rest day",
  missed: "Missed",
  paused: "Paused",
  rescheduled: "Rescheduled",
};
/** Green = completed only (guide section 2); everything else neutral/amber-today. */
const WEEK_STATE_COLOR: Record<string, string> = {
  completed: colors.success,
  planned: colors.textSecondary,
  rest: colors.textMuted,
  missed: colors.danger,
  paused: colors.textMuted,
  rescheduled: colors.textMuted,
};

interface WinItem {
  key: string;
  badge: string;
  badgeColor?: string;
  title: string;
  details: string[];
}

export default function HomeScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  const units = useUnits();
  // Canonical invalidation (Phase 8.2): Home stays mounted across tab
  // switches, so it MUST re-render when any canonical mutation commits
  // (workout finished, schedule changed, streak/PR/rank derived updates...).
  useCanonicalRevision();

  const profile = repos.profile.getDefault();
  if (!profile) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Internal state error</Text>
        <Text style={styles.muted}>The local profile is missing. Restart the app to recover.</Text>
      </View>
    );
  }

  const offset = -new Date().getTimezoneOffset();
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const dateLabel = now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  const schedule = services.schedule.getSchedule(profile.id);
  const week = services.schedule.getWeekState(profile.id, { timezoneOffsetMinutes: offset });
  const upcoming = services.schedule.getUpcomingSessions(profile.id, { timezoneOffsetMinutes: offset });
  const next = upcoming[0] ?? null;
  const streak = services.streak.getCurrentState(profile.id);
  const cache = streak.cache;
  const strength = services.derived.getStrengthProfile(profile.id);
  const recentPrs = repos.personalRecords.listEventsForProfile(profile.id, 3);
  const recentRankUps = services.derived.recentRankEvents(profile.id, 6).filter((e) => e.direction === "up").slice(0, 3);

  const todayLogical = computeLogicalTrainingDate(now.toISOString(), offset);
  const stateFor = (date: string) => week.find((d) => d.date === date)?.state ?? "rest";
  const view = resolveHomeSessionView({
    todayLogical,
    todaysState: stateFor(todayLogical),
    next: next ? { id: next.id, scheduledDate: next.scheduledDate } : null,
  });

  const routineFor = (routineId: string | null) =>
    routineId ? repos.routine.getById(routineId)?.routine.name ?? "Deleted routine" : "Freestyle session";

  /** Unique primary muscle-group labels of a routine ("Chest \u00B7 Shoulders"). */
  const routineGroupsLabel = (routineId: string | null): string | null => {
    if (!routineId) return null;
    const detail = repos.routine.getById(routineId);
    if (!detail) return null;
    const labels: string[] = [];
    for (const re of detail.exercises) {
      for (const group of repos.exercise.getPrimaryMuscleGroups(re.exerciseId)) {
        const label = GROUPS[group]?.label;
        if (label && !labels.includes(label)) labels.push(label);
      }
    }
    return labels.length > 0 ? labels.join(" \u00B7 ") : null;
  };

  /** Reps of the record-setting set, when still resolvable from canonical data. */
  const prSourceReps = (pr: PersonalRecordEvent): number | null => {
    const detail = repos.workout.getById(pr.sourceWorkoutId);
    if (!detail) return null;
    for (const ex of detail.exercises) {
      const set = ex.sets.find((s) => s.id === pr.sourceSetId);
      if (set?.reps != null) return set.reps;
    }
    return null;
  };

  // Each PR record type gets its own explicit label so grouped events read as
  // distinct achievements, not repeated rows. qualifierKey ("w=<kg>") supplies
  // the load for reps-at-weight records; w=0 means no added load.
  const qualifierWeightLabel = (qualifierKey: string | null | undefined): string => {
    const m = /^w=(-?[\d.]+)$/.exec(qualifierKey ?? "");
    if (!m) return "";
    const kg = Number(m[1]);
    if (!Number.isFinite(kg) || kg <= 0) return " (bodyweight)";
    return " @ " + units.toDisplay(kg) + " " + units.weightLabel;
  };
  const prDetailText = (pr: PersonalRecordEvent): string => {
    if (pr.recordType === "max_weight") {
      const reps = prSourceReps(pr);
      const weight = units.toDisplay(pr.value) + " " + units.weightLabel;
      return "Heaviest set " + (reps != null ? weight + " \u00D7 " + String(reps) : weight);
    }
    if (pr.recordType === "max_e1rm") {
      return "Est. 1RM " + units.toDisplay(pr.value) + " " + units.weightLabel;
    }
    if (pr.recordType === "max_set_volume") {
      return "Set volume " + formatVolume(pr.value, units.weightLabel);
    }
    return String(Math.round(pr.value)) + " reps" + qualifierWeightLabel(pr.qualifierKey);
  };

  /** Recent wins: canonical PR events + rank-up events only. */
  const wins: WinItem[] = [];
  for (const pr of recentPrs) {
    const title = repos.exercise.findById(pr.exerciseId)?.name ?? "Exercise";
    const last = wins[wins.length - 1];
    // Consecutive PR events for one exercise read as a single achievement
    // block, not near-duplicate rows; the record types label the lines.
    if (last && last.badge === "PR" && last.title === title) {
      last.details.push(prDetailText(pr));
      continue;
    }
    wins.push({ key: pr.id, badge: "PR", title, details: [prDetailText(pr)] });
  }
  for (const e of recentRankUps) {
    const scopeLabel =
      e.scopeType === "muscle"
        ? strength.groups.find((g) => g.key === e.scopeKey)?.label ?? e.scopeKey
        : repos.exercise.findById(e.scopeKey)?.name ?? e.scopeKey;
    const fromLabel = e.fromTier == null ? "Unranked" : e.fromTier + (e.fromDivision ? " " + e.fromDivision : "");
    const toLabel = e.toTier + (e.toDivision ? " " + e.toDivision : "");
    wins.push({
      key: e.id,
      badge: "RANK UP",
      badgeColor: rankColor(e.toTier),
      title: scopeLabel,
      details: [fromLabel + " \u2192 " + toLabel],
    });
  }
  const hasWins = wins.length > 0;

  // Today's completed session (canonical): duration + working-set count for
  // the TRAINING COMPLETE hero (guide section 16.4). Never invented metrics.
  const completedToday =
    repos.workout.listHistory(profile.id, 5).find((d) => d.workout.logicalTrainingDate === todayLogical) ?? null;
  const completedMeta = (() => {
    const workout = completedToday?.workout;
    if (!workout?.finishedAt) return null;
    const seconds = Math.max(0, (Date.parse(workout.finishedAt) - Date.parse(workout.startedAt)) / 1000);
    const workingSets = (completedToday?.exercises ?? []).reduce(
      (n, ex) => n + ex.sets.filter((s) => s.completedAt != null && s.setType !== "warmup").length,
      0,
    );
    if (seconds <= 0 && workingSets === 0) return null;
    const parts: string[] = [];
    if (seconds > 0) parts.push(formatDurationRough(seconds));
    if (workingSets > 0) {
      parts.push(workingSets === 1 ? "1 working set" : String(workingSets) + " working sets");
    }
    return parts.join(" \u00B7 ");
  })();

  const startBonus = () => {
    try {
      const w = services.workout.startEmptyWorkout(profile.id, { timezoneOffsetMinutes: offset });
      router.push("/workout/" + w.id);
    } catch (err) {
      if (err instanceof ActiveWorkoutConflictError) {
        router.push("/(tabs)/workout");
        return;
      }
      throw err;
    }
  };

  const startPlanned = () => {
    if (!next) return;
    try {
      const w = next.routineId
        ? services.workout.startWorkoutFromRoutine(profile.id, next.routineId, { timezoneOffsetMinutes: offset })
        : services.workout.startEmptyWorkout(profile.id, { timezoneOffsetMinutes: offset });
      router.push("/workout/" + w.id);
    } catch (err) {
      if (err instanceof ActiveWorkoutConflictError) {
        router.push("/(tabs)/workout");
        return;
      }
      throw err;
    }
  };

  const weekdayOf = (scheduledDate: string) =>
    WEEKDAY_LONG[(new Date(scheduledDate + "T00:00:00Z").getUTCDay() + 6) % 7] ?? "";

  // Today hero content per approved state variants (guide section 16.4).
  const hero = (() => {
    if (view.kind === "today_planned" && next) {
      const groups = routineGroupsLabel(next.routineId);
      return (
        <>
          <Kicker tone="accent">TODAY</Kicker>
          <Text style={styles.heroTitle}>{routineFor(next.routineId)}</Text>
          <Text style={styles.heroMeta} numberOfLines={2}>
            {schedule.schedule.enabled
              ? groups ?? "Your planned session is ready."
              : "Schedule is disabled - obligations paused for now."}
          </Text>
          <Button
            label="START WORKOUT"
            onPress={startPlanned}
            size="compact"
            fullWidth
            accessibilityLabel="Start today's planned workout"
            style={styles.heroCta}
          />
          <HeroLink
            label="Reschedule"
            accessibilityLabel="Reschedule this session"
            onPress={() => router.push("/reschedule/" + next.id)}
          />
        </>
      );
    }
    if (view.kind === "future" && next) {
      // Rest day with an upcoming session (guide section 16.4): calm kicker,
      // canonical weekday + routine title, bonus as the primary action. The
      // bonus-does-not-move-the-plan rule stays as restrained note copy, never
      // as the headline. Weekday only - no ISO dates in hero copy.
      return (
        <>
          <Kicker tone="neutral">REST DAY</Kicker>
          <Text style={styles.heroEyebrow}>NEXT</Text>
          <Text style={styles.heroTitle}>{weekdayOf(next.scheduledDate) + " \u00B7 " + routineFor(next.routineId)}</Text>
          <Button
            label="START BONUS WORKOUT"
            onPress={startBonus}
            size="compact"
            fullWidth
            accessibilityLabel="Start a bonus workout"
            style={styles.heroCta}
          />
          <Text style={styles.heroNote}>A bonus workout today does not move the plan.</Text>
          <HeroLink label="View plan" accessibilityLabel="Open training schedule" onPress={() => router.push("/schedule")} />
          <HeroLink
            label="Reschedule"
            accessibilityLabel="Reschedule this session"
            onPress={() => router.push("/reschedule/" + next.id)}
          />
        </>
      );
    }
    if (view.kind === "today_completed") {
      const title = completedToday
        ? routineFor(completedToday.workout.routineId)
        : next
          ? routineFor(next.routineId)
          : null;
      return (
        <>
          <Kicker tone="success">TRAINING COMPLETE</Kicker>
          {title ? <Text style={styles.heroTitle}>{title}</Text> : null}
          <Text style={styles.heroMeta}>
            {completedMeta ?? "Today's session is done. Bonus training is always welcome."}
          </Text>
          <Button label="START BONUS WORKOUT" variant="secondary" size="compact" onPress={startBonus} fullWidth style={styles.heroCta} />
        </>
      );
    }
    if (view.kind === "today_missed") {
      return (
        <>
          <Kicker tone="neutral">REST DAY</Kicker>
          <Text style={styles.heroMeta}>
            Today was a planned training day. The next planned session starts a fresh streak - no drama.
          </Text>
          <Button label="START BONUS WORKOUT" variant="secondary" size="compact" onPress={startBonus} fullWidth style={styles.heroCta} />
        </>
      );
    }
    if (view.kind === "none" && next) {
      return (
        <>
          <Kicker tone="neutral">REST DAY</Kicker>
          <Text style={styles.heroEyebrow}>NEXT</Text>
          <Text style={styles.heroTitle}>{weekdayOf(next.scheduledDate) + " \u00B7 " + routineFor(next.routineId)}</Text>
          <Button label="START BONUS WORKOUT" onPress={startBonus} size="compact" fullWidth style={styles.heroCta} />
        </>
      );
    }
    return (
      <>
        <Kicker tone="neutral">NO PLANNED SESSIONS</Kicker>
        <Text style={styles.heroMeta}>No upcoming planned sessions. Enable training days in your schedule.</Text>
        <Button label="EDIT SCHEDULE" variant="secondary" size="compact" onPress={() => router.push("/schedule")} fullWidth style={styles.heroCta} />
      </>
    );
  })();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.headerBlock}>
        <Text style={styles.greeting}>{greeting},</Text>
        <Text style={styles.name}>{profile.displayName}</Text>
        <Text style={styles.date}>{dateLabel}</Text>
      </View>

      <Card variant="hero" style={styles.heroCard}>
        {hero}
      </Card>

      <Card>
        <View style={styles.streakRow}>
          <Text style={styles.streakNumber}>{String(cache.currentStreak)}</Text>
          <View style={styles.streakLabels}>
            <Text style={styles.streakLabel}>SESSION STREAK</Text>
            <Text style={styles.streakMeta}>
              {"Best " + String(cache.bestStreak) + " \u00B7 " + String(cache.perfectWeeks) + " perfect weeks"}
            </Text>
          </View>
          <Pressable
            onPress={() => router.push("/streak")}
            accessibilityLabel="Open streak history"
            hitSlop={6}
            style={styles.streakLink}
          >
            <Text style={styles.streakLinkText}>{"Streak history \u203A"}</Text>
          </Pressable>
        </View>
        <Divider style={styles.streakDivider} />
        <View style={styles.weekRow}>
          {week.map((day, i) => (
            <View
              key={day.date}
              accessible
              accessibilityLabel={
                WEEKDAY_LONG[i] + (day.date === todayLogical ? " (today)" : "") + ": " + (WEEK_STATE_LABEL[day.state] ?? day.state)
              }
              style={styles.weekCell}
            >
              <Text
                style={[
                  styles.weekLetter,
                  day.state === "rest" ? styles.weekLetterMuted : null,
                  day.date === todayLogical ? styles.weekLetterToday : null,
                ]}
              >
                {WEEKDAY_LABELS[i]}
              </Text>
              <View style={styles.weekGlyphBox}>
                {day.state === "planned" ? (
                  <View
                    style={[styles.weekRing, { borderColor: WEEK_STATE_COLOR[day.state] ?? colors.textMuted }]}
                    testID={"week-ring-" + WEEKDAY_LONG[i]}
                  />
                ) : (
                  <Text style={[styles.weekGlyph, { color: WEEK_STATE_COLOR[day.state] ?? colors.textMuted }]}>
                    {WEEK_STATE_GLYPH[day.state] ?? "\u00B7"}
                  </Text>
                )}
              </View>
            </View>
          ))}
        </View>
      </Card>

      <View style={styles.section}>
        <SectionHeader
          title="Strength profile"
          actionLabel={"View progress \u2192"}
          onAction={() => router.push("/progress")}
          actionAccessibilityLabel="View progress hub"
        />
        <Card style={styles.listCard}>
          {strength.groups.map((g, i) => (
            <View key={g.key}>
              {i > 0 ? <Divider /> : null}
              <Pressable
                accessible
                accessibilityRole="button"
                accessibilityLabel={
                  g.label + ": " + (g.tierName ? g.tierName + (g.division ? " " + g.division : "") : "no rank") + ", open rank detail"
                }
                onPress={() => router.push("/muscle/" + g.key)}
                style={styles.profileRow}
                hitSlop={{ top: 7, bottom: 7 }}
              >
                <View style={styles.profileLabel}>
                  <Text style={styles.profileGroup}>{g.label}</Text>
                </View>
                <View style={styles.profileBadge}>
                  <RankBadge tierName={g.tierName} division={g.division} size="sm" />
                </View>
              </Pressable>
            </View>
          ))}
        </Card>
      </View>

      {hasWins ? (
        <View style={styles.section}>
          <SectionHeader title="Recent wins" />
          <Card style={styles.listCard}>
            {wins.map((win, i) => (
              <View key={win.key}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.winRow}>
                  <Badge label={win.badge} color={win.badgeColor} />
                  <View style={styles.winBody}>
                    <Text style={styles.winTitle}>{win.title}</Text>
                    {win.details.map((d, di) => (
                      <Text key={d} style={di === 0 ? styles.winDetailFirst : styles.winDetail}>
                        {d}
                      </Text>
                    ))}
                  </View>
                </View>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      <View style={styles.quickRow}>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Browse the exercise catalog"
          onPress={() => router.push("/(tabs)/exercises")}
          style={({ pressed }) => [styles.quickLink, pressed ? styles.linkPressed : null]}
          hitSlop={{ top: 4, bottom: 4 }}
        >
          <Text style={styles.quickLinkText}>
            {"Browse exercises "}
            <Text style={styles.quickLinkChevron}>{"\u203A"}</Text>
          </Text>
        </Pressable>
        <Pressable
          accessible
          accessibilityRole="button"
          accessibilityLabel="Open training schedule"
          onPress={() => router.push("/schedule")}
          style={({ pressed }) => [styles.quickLink, pressed ? styles.linkPressed : null]}
          hitSlop={{ top: 4, bottom: 4 }}
        >
          <Text style={styles.quickLinkText}>
            {"Training schedule "}
            <Text style={styles.quickLinkChevron}>{"\u203A"}</Text>
          </Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

/** Hero eyebrow: tiny caps-style label; color carries the state semantics. */
function Kicker(props: { children: string; tone?: "accent" | "success" | "neutral" }) {
  const color =
    props.tone === "success" ? colors.success : props.tone === "neutral" ? colors.textSecondary : colors.accent;
  return <Text style={[styles.kicker, { color }]}>{props.children}</Text>;
}

/** Quiet in-hero action link: chevron affordance + pressed state, 44dp target. */
function HeroLink(props: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  return (
    <Pressable
      accessible
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      onPress={props.onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.heroLink, pressed ? styles.linkPressed : null]}
    >
      <Text style={styles.heroLinkText}>
        {props.label}
        <Text style={styles.heroLinkChevron}>{" \u203A"}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: SCREEN_PADDING, paddingTop: space[5], gap: space[3], paddingBottom: space[12] },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg, padding: space[5], gap: space[2] },
  errorTitle: { ...type.cardTitle, color: colors.danger },
  muted: { ...type.caption, color: colors.textMuted },

  headerBlock: { gap: 1, marginBottom: space[2] },
  // Header secondary labels keep the quiet hierarchy but stay legible on the
  // near-black background (visual-review F2): the greeting reads at full text
  // color (caption size keeps it subordinate to the name) and the date lifts
  // from muted to secondary instead of sinking toward the disabled tone.
  greeting: { ...type.caption, color: colors.text },
  name: { ...type.pageTitle, color: colors.text },
  date: { ...type.caption, color: colors.textSecondary, marginTop: 2 },

  // Hero (guide section 12): the ONE dominant card - compact padding, tight
  // vertical rhythm; the CTA carries the height, not the padding.
  heroCard: { padding: space[4], gap: 2 },
  // Hero state kicker ("TODAY" / "REST DAY" / "TRAINING COMPLETE"): 600
  // weight + wide tracking at caption size so the state headline reads at a
  // glance instead of as quiet small print.
  kicker: { ...type.caption, fontWeight: "600" as const, letterSpacing: 1.2 },
  heroTitle: { ...type.metricMedium, fontSize: 22, lineHeight: 28, color: colors.text },
  heroMeta: { ...type.body, fontSize: 13, lineHeight: 18, color: colors.textSecondary },
  heroCta: { marginTop: space[2] },
  heroEyebrow: { ...type.label, color: colors.textMuted, letterSpacing: 1 },
  // Supporting note keeps textSecondary (not muted) so it stays legible
  // against the hero card without competing with the title.
  heroNote: { ...type.body, fontSize: 13, lineHeight: 18, color: colors.textSecondary, marginTop: space[1] },
  heroLink: { minHeight: 36, marginTop: 2, alignItems: "center", justifyContent: "center" },
  heroLinkText: { ...type.body, fontWeight: "600", color: colors.accent },
  heroLinkChevron: { color: colors.textMuted },
  linkPressed: { opacity: 0.7 },

  // Streak metric block: number + label left, quiet history link right.
  streakRow: { flexDirection: "row", alignItems: "center", gap: space[3] },
  streakNumber: { ...type.metricMedium, color: colors.text, fontVariant: ["tabular-nums"], minWidth: 30, textAlign: "center" },
  streakLabels: { flex: 1, gap: 2 },
  streakLabel: { ...type.label, color: colors.textSecondary, letterSpacing: 1 },
  streakMeta: { ...type.caption, color: colors.textMuted },
  streakLink: { paddingVertical: space[2], justifyContent: "center" },
  streakLinkText: { ...type.caption, color: colors.textMuted, fontWeight: "600" },
  streakDivider: { marginTop: space[3] },
  weekRow: { flexDirection: "row", justifyContent: "space-between", marginTop: space[3] },
  // One indicator per concern in the week strip: today is marked
  // typographically (amber weekday letter); the ring/dot below stays the
  // ONLY session-state glyph, so state and "today" never share a marker.
  weekCell: { alignItems: "center", flex: 1, gap: 3, paddingBottom: 4 },
  // Week strip alignment (visual-review F4): the weekday letter stretches the
  // full cell and centers its glyph, and the state glyph uses the box height
  // as its line box, so every letter center and every indicator share one
  // optical centerline across all seven columns.
  weekLetter: { ...type.label, color: colors.textSecondary, width: "100%", textAlign: "center" },
  weekLetterToday: { ...type.label, color: colors.accent, width: "100%", textAlign: "center" },
  weekLetterMuted: { color: colors.textMuted },
  // One fixed box per status glyph keeps every indicator on the same
  // centerline and at the same optical size.
  weekGlyphBox: { width: 18, height: 16, alignItems: "center", justifyContent: "center" },
  weekGlyph: { fontSize: 12, lineHeight: 16, fontWeight: "600" },
  weekRing: { width: 9, height: 9, borderRadius: 4.5, borderWidth: 1.5 },

  section: { gap: space[2] },
  listCard: { paddingVertical: space[1], paddingHorizontal: space[4] },
  // Strict two-column rows: label flexes, badges share one right-aligned
  // column so the list reads as a grid (stable width >= widest badge).
  profileRow: { flexDirection: "row", alignItems: "center", minHeight: 30, paddingVertical: 3 },
  profileLabel: { flex: 1 },
  profileBadge: { minWidth: 76, flexDirection: "row", justifyContent: "flex-end", alignItems: "center" },
  profileGroup: { ...type.body, color: colors.text },

  winRow: { flexDirection: "row", alignItems: "center", gap: space[3], paddingVertical: space[2] },
  winBody: { flex: 1, gap: 2 },
  winTitle: { ...type.bodyStrong, color: colors.text },
  winDetail: { ...type.caption, color: colors.textSecondary },
  winDetailFirst: { ...type.caption, color: colors.text },

  quickRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: space[2] },
  quickLink: { paddingVertical: space[2], paddingHorizontal: space[1], justifyContent: "center" },
  quickLinkText: { ...type.body, fontWeight: "600", color: colors.textSecondary },
  quickLinkChevron: { color: colors.accent },
});
