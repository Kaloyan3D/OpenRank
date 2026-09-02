import { useEffect } from "react";
import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { resolveRootRoute } from "@openrank/database";
import { useServices } from "../../services/ServicesProvider";
import { useCanonicalRevision } from "../../local-data/useCanonicalRevision";
import { colors } from "../../design/colors";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";

/**
 * ROOT APPLICATION ROUTING GATE (Phase 7.1, spec 7/8; Phase 8.1 restyle
 * only - tokens swapped, zero logic change).
 *
 * After SQLite open -> migrate -> seed -> service init, the profile state
 * decides where the app can go. The gate OWNS this invariant - main screens
 * may assume a valid completed profile:
 *
 *   no profile                          -> /onboarding
 *   profile, onboarding_completed=false -> /onboarding/resume
 *   profile, onboarding_completed=true  -> render (main app)
 *
 * Deep links / direct destinations (workout, schedule, ranks, history,
 * notification payloads, ...) are covered by the same gate: while
 * onboarding is incomplete the destination is NEVER rendered (this component
 * returns null for that render), and a redirect to onboarding fires instead.
 * v1 policy: the requested destination is NOT replayed after completion -
 * after onboarding the app opens Home (docs/ONBOARDING_SPEC.md). A deep link
 * never creates a workout and never mutates canonical state on its own.
 *
 * If the main tabs somehow render with a missing profile (corruption), the
 * gate shows a recoverable internal-state error - it NEVER silently creates
 * a replacement profile (spec 23).
 */
export function RoutingGate(props: { children: ReactNode }) {
  const router = useRouter();
  const services = useServices();
  const pathname = usePathname();
  // Canonical invalidation (Phase 8.2): onboarding step writes publish, so
  // the gate re-evaluates the root route from fresh canonical state.
  useCanonicalRevision();

  const profile = services.profile.getDefaultProfile();
  const target = resolveRootRoute(profile);
  const inOnboarding = pathname.startsWith("/onboarding");
  const needsRedirect = !inOnboarding && target !== "/(tabs)";

  useEffect(() => {
    if (needsRedirect) {
      router.replace(target === "/onboarding" ? "/onboarding" : "/onboarding/resume");
    }
  }, [needsRedirect, target, router]);

  if (needsRedirect) {
    // The gated destination must not flash: render nothing for this frame.
    return null;
  }

  if (!inOnboarding && profile == null) {
    // Unreachable in normal flow - corruption path (spec 23).
    return (
      <View style={styles.center}>
        <Text style={styles.error}>Internal state error: the local profile is missing.</Text>
        <Text style={styles.muted}>Restart the app to recover. No data was changed.</Text>
      </View>
    );
  }

  return <>{props.children}</>;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg,
    padding: space[6],
    gap: space[2],
  },
  error: { ...type.cardTitle, color: colors.danger, textAlign: "center" },
  muted: { ...type.caption, color: colors.textMuted, textAlign: "center" },
});
