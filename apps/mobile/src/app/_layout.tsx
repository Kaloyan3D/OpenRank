import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { DatabaseGate, DatabaseProvider } from "../db/DatabaseProvider";
import { ServicesProvider } from "../services/ServicesProvider";
import { NotificationTapHandler } from "../services/notifications/NotificationTapHandler";
import { RoutingGate } from "../features/onboarding/RoutingGate";
import { colors } from "../design/colors";

/**
 * Root layout (Phase 3/4/7.1): the database initializes on boot - open ->
 * migrate (schema v6) -> seed the bundled catalog - before any screen
 * renders. Above the navigator sit two gates: NotificationTapHandler (Phase
 * 7 deep links) and the Phase 7.1 RoutingGate, which owns the onboarding
 * invariant (no profile / incomplete profile never reaches the main tabs).
 */
export default function RootLayout() {
  return (
    <DatabaseProvider>
      <ServicesProvider>
        <StatusBar style="light" />
        <DatabaseGate
          ready={
            <NotificationTapHandler>
              <RoutingGate>
                <Stack
                  screenOptions={{
                    headerStyle: { backgroundColor: colors.surface },
                    headerTintColor: colors.text,
                    contentStyle: { backgroundColor: colors.bg },
                  }}
                >
                  <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
                  <Stack.Screen name="onboarding/index" options={{ headerShown: false }} />
                  <Stack.Screen name="onboarding/name" options={{ title: "Your profile", headerShown: false }} />
                  <Stack.Screen name="onboarding/units" options={{ headerShown: false }} />
                  <Stack.Screen name="onboarding/standard" options={{ headerShown: false }} />
                  <Stack.Screen name="onboarding/bodyweight" options={{ headerShown: false }} />
                  <Stack.Screen name="onboarding/days" options={{ headerShown: false }} />
                  <Stack.Screen name="onboarding/review" options={{ headerShown: false }} />
                  <Stack.Screen name="onboarding/reminders" options={{ headerShown: false }} />
                  <Stack.Screen name="onboarding/ready" options={{ headerShown: false }} />
                  <Stack.Screen name="onboarding/resume" options={{ headerShown: false }} />
                  <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
        <Stack.Screen name="progress" options={{ headerShown: false }} />
        <Stack.Screen name="achievements" options={{ headerShown: true, title: "Achievements", headerStyle: { backgroundColor: colors.bg }, headerTintColor: colors.text }} />
                  {/* Human titles for routes that do not self-configure a header
                      (raw route names like "reschedule/[id]" leak otherwise).
                      Dedicated screen passes may override these later. */}
                  <Stack.Screen name="schedule" options={{ title: "Training schedule" }} />
                  <Stack.Screen name="routines" options={{ title: "Routines" }} />
                  <Stack.Screen name="routine/[id]" options={{ title: "Routine" }} />
                  <Stack.Screen name="history/[id]" options={{ title: "Workout details" }} />
                  <Stack.Screen name="muscle/[group]" options={{ title: "Rank detail" }} />
                  <Stack.Screen name="streak" options={{ title: "Streak" }} />
                  <Stack.Screen name="workout/[id]" options={{ title: "Workout" }} />
                  <Stack.Screen name="exercise-picker" options={{ title: "Exercises" }} />
                  <Stack.Screen name="exercise/[id]" options={{ title: "Exercise" }} />
                  <Stack.Screen name="reschedule/[id]" options={{ title: "Reschedule session" }} />
                </Stack>
              </RoutingGate>
            </NotificationTapHandler>
          }
        />
      </ServicesProvider>
    </DatabaseProvider>
  );
}
