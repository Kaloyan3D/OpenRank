import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { colors, spacing } from "../../theme/tokens";
import { useServices } from "../../services/ServicesProvider";
import { OnboardingShell } from "../../features/onboarding/OnboardingShell";

/**
 * Onboarding - Reminders (spec 17/18/19). Reuses the Phase 7 stack ONLY:
 * pre-permission explainer -> explicit choice -> NotificationService
 * requestPermission. Denial NEVER blocks onboarding.
 *
 * Zero training days: reminders are simply not requested here - the screen
 * explains they become available after a schedule is configured.
 *
 * Reminder times use the Phase 7 semantics (minutes after local midnight,
 * 04:00 logical day). A visible default (17:30) is suggested; applying it
 * requires the user's explicit confirmation below.
 */

const TIME_CHOICES = [630, 900, 1050, 1140, 1200]; // 10:30, 15:00, 17:30, 19:00, 20:00
const DEFAULT_TIME = 1050; // 17:30

function label(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
}

export default function OnboardingReminders() {
  const router = useRouter();
  const services = useServices();
  const profile = services.profile.getDefaultProfile();
  const days = profile ? services.schedule.getSchedule(profile.id).days.filter((d) => d.enabled) : [];
  const [chosen, setChosen] = useState<number | null>(DEFAULT_TIME);
  const [status, setStatus] = useState<string | null>(null);

  const enable = async () => {
    if (!profile) return;
    // Custom pre-permission explainer is THIS screen; the OS dialog follows
    // the explicit press. Continue regardless of the outcome.
    const result = await services.notifications.requestPermission(profile.id);
    if (result === "granted") {
      services.notifications.updatePreferences(profile.id, { trainingRemindersEnabled: true });
      const minutes = chosen ?? DEFAULT_TIME;
      for (const day of days) {
        services.notifications.setDayReminderTime(profile.id, day.weekday, minutes);
      }
      void services.notifications
        .reconcileNotifications(profile.id, {
          todayUtc: new Date().toISOString(),
          timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
        })
        .catch(() => {});
      setStatus("Enabled - " + label(minutes) + " on your training days.");
    } else {
      // Denied/undetermined: continue normally; changeable later in settings.
      setStatus("Reminders are off - you can enable them anytime in settings.");
    }
    router.push("/onboarding/ready");
  };

  const skip = () => {
    router.push("/onboarding/ready");
  };

  return (
    <OnboardingShell
      step="Step 6 of 6"
      title={days.length > 0 ? "Training reminders" : "Reminders"}
      onContinue={() => void enable()}
      continueLabel={days.length > 0 ? "ENABLE REMINDERS" : "CONTINUE"}
      secondaryLabel="NOT NOW"
      onSecondary={skip}
      onBack={() => router.push("/onboarding/review")}
    >
      {days.length === 0 ? (
        <Text style={styles.note}>
          You have no training days configured yet. Training reminders become
          available after you set up a schedule - configure it later from the
          schedule screen. Rest-timer notifications remain available in
          notification settings.
        </Text>
      ) : (
        <>
          <Text style={styles.note}>
            OpenRank can remind you on your training days only - never on rest
            days. Reminders respect completed sessions, pauses and
            reschedules. Your data stays on this device.
          </Text>
          <Text style={styles.section}>Reminder time</Text>
          <View style={styles.row}>
            {TIME_CHOICES.map((t) => (
              <Pressable
                key={t}
                onPress={() => setChosen(t)}
                style={[styles.chip, chosen === t && styles.chipOn]}
                accessibilityLabel={"Reminder at " + label(t)}
              >
                <Text style={[styles.chipText, chosen === t && styles.chipTextOn]}>{label(t)}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.note}>
            {days.length} training day(s): {days.map((d) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d.weekday - 1]!).join(" \u00B7 ")}
          </Text>
          {status ? <Text style={styles.status}>{status}</Text> : null}
        </>
      )}
    </OnboardingShell>
  );
}

const styles = StyleSheet.create({
  note: { color: colors.textMuted, fontSize: 13, marginTop: spacing.sm, lineHeight: 19 },
  section: { color: colors.text, fontWeight: "700", marginTop: spacing.md, fontSize: 13, textTransform: "uppercase" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.sm },
  chip: { borderWidth: 1, borderColor: "#2a3242", borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { borderColor: colors.accent, backgroundColor: "rgba(94,200,255,0.12)" },
  chipText: { color: colors.textMuted, fontWeight: "700" },
  chipTextOn: { color: colors.accent },
  status: { color: colors.accent, fontSize: 13, marginTop: spacing.sm },
});
