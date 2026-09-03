import { Tabs } from "expo-router";
import { StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { TabBarIcon, TabBarLabel, TAB_ITEMS } from "../../components/ui/TabBar";
import { colors } from "../../design/colors";

/**
 * Bottom navigation (Phase 8.2B visual fidelity pass, guide section 15):
 * EXACTLY five primary tabs - Home, History, Workout, Ranks, Profile.
 * Workout is visually central (compact amber plate; never a giant floating
 * button, never glow). Exercises is NOT a permanent tab: href null keeps the
 * route reachable from Home and the workout flows. Active = amber; inactive
 * = muted; every item carries icon + label + accessibility label. The fixed
 * dark bar spans the bottom safe-area inset so gesture navigation never
 * overlaps the labels.
 */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: [styles.tabBar, { height: 58 + insets.bottom, paddingBottom: insets.bottom }],
      }}
    >
      {TAB_ITEMS.map((item) => (
        <Tabs.Screen
          key={item.name}
          name={item.name}
          options={{
            tabBarAccessibilityLabel:
              item.label + (item.name === "workout" ? " - central workout action" : " tab"),
            tabBarIcon: ({ focused, color }) => (
              <TabBarIcon route={item.name} focused={focused} color={String(color)} />
            ),
            tabBarLabel: ({ focused, color }) => (
              <TabBarLabel focused={focused} color={String(color)} label={item.label} />
            ),
          }}
        />
      ))}
      {/* Exercise catalog: reachable route, not a permanent tab (spec 17). */}
      <Tabs.Screen name="exercises" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    elevation: 0,
    shadowOpacity: 0,
    paddingTop: 6,
  },
});
