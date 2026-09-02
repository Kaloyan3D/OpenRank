import { Tabs } from "expo-router";
import { colors } from "../../theme/tokens";

/**
 * Bottom navigation (spec section 48): HOME, WORKOUT, RANKS, HISTORY, PROFILE.
 * WORKOUT is visually emphasized as the center action.
 * Phase 2 adds the EXERCISES tab as the entry point for the offline catalog
 * (documented deviation: extends the section 48 tab list by one entry).
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        sceneStyle: { backgroundColor: colors.background },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home" }} />
      <Tabs.Screen name="exercises" options={{ title: "Exercises" }} />
      <Tabs.Screen name="workout" options={{ title: "Workout" }} />
      <Tabs.Screen name="ranks" options={{ title: "Ranks" }} />
      <Tabs.Screen name="history" options={{ title: "History" }} />
      <Tabs.Screen name="profile" options={{ title: "Profile" }} />
    </Tabs>
  );
}