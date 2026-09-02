import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { DatabaseGate, DatabaseProvider } from "../db/DatabaseProvider";
import { ServicesProvider } from "../services/ServicesProvider";
import { colors } from "../theme/tokens";

/**
 * Root layout (Phase 3/4): the database initializes on boot - open -> migrate
 * (schema v2) -> seed the bundled catalog - before any screen renders, with
 * explicit loading/error states. Screens then read through repositories and
 * mutate through the service layer (UI -> service -> repository -> SQLite).
 */
export default function RootLayout() {
  return (
    <DatabaseProvider>
      <ServicesProvider>
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
      </ServicesProvider>
    </DatabaseProvider>
  );
}