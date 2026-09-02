import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "../../design/colors";
import { type } from "../../design/typography";

/**
 * OpenRank bottom navigation (Phase 8.1, spec 17): exactly five tabs -
 * HOME, HISTORY, WORKOUT, RANKS, PROFILE - Workout visually central. Active
 * = amber, inactive = TEXT_MUTED. Every item has icon + label + a11y label.
 * Exercises is NOT a permanent tab (reachable from Home + workout flows).
 */
export const TAB_ITEMS = [
  { name: "index", label: "Home", icon: "home-outline", iconActive: "home", position: 1 },
  { name: "history", label: "History", icon: "time-outline", iconActive: "time", position: 2 },
  { name: "workout", label: "Workout", icon: "barbell-outline", iconActive: "barbell", position: 3 },
  { name: "ranks", label: "Ranks", icon: "trophy-outline", iconActive: "trophy", position: 4 },
  { name: "profile", label: "Profile", icon: "person-outline", iconActive: "person", position: 5 },
] as const;

type IconName = (typeof TAB_ITEMS)[number]["icon"];

export function TabBarIcon(props: {
  route: string;
  focused: boolean;
  color: string;
}) {
  const item = TAB_ITEMS.find((t) => t.name === props.route);
  if (!item) return null;
  if (item.name === "workout") {
    return <WorkoutIcon focused={props.focused} color={props.color} />;
  }
  return (
    <Ionicons
      name={(props.focused ? item.iconActive : item.icon) as IconName}
      size={22}
      color={props.color}
    />
  );
}

export function TabBarLabel(props: { focused: boolean; color: string; label: string }) {
  return <Text style={[styles.label, { color: props.color }]}>{props.label}</Text>;
}

/** Workout: softly rounded amber plate, visually central, no glow. */
function WorkoutIcon(props: { focused: boolean; color: string }) {
  const filled = props.focused;
  return (
    <View style={[styles.workoutPlate, filled ? styles.workoutPlateActive : null]}>
      <Ionicons
        name={filled ? "barbell" : "barbell-outline"}
        size={19}
        color={filled ? colors.textOnAccent : props.color}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...type.label, textTransform: "none" },
  workoutPlate: {
    width: 30,
    height: 30,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  workoutPlateActive: { backgroundColor: colors.accent, borderColor: colors.accent },
});
