import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { DatabaseGate, DatabaseProvider } from "../db/DatabaseProvider";
import { colors } from "../theme/tokens";

/**
 * Root layout (Phase 3): the database initializes on boot - open -> migrate
 * (schema v1) -> seed the bundled catalog - before any screen renders, with
 * explicit loading/error states. All screens then read through repositories.
 */
export default function RootLayout() {
  return (
    <DatabaseProvider>
      <StatusBar style="light" />
      <DatabaseGate
        ready={
          <Stack
            screenOptions={{
              headerStyle: { backgroundColor: colors.surface },
              headerTintColor: colors.text,
              contentStyle: { backgroundColor: colors.background },
            }}
          >
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          </Stack>
        }
      />
    </DatabaseProvider>
  );
}
