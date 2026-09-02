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
                </Stack>
              </RoutingGate>
            </NotificationTapHandler>
          }
        />
      </ServicesProvider>
    </DatabaseProvider>
  );
}
