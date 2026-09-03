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

/**
 * Workout: the central OpenRank action (guide section 15). A compact plate
 * keeps it visually central in every state - but color emphasis belongs to
 * the ACTIVE tab only: idle = quiet outlined plate with a muted glyph,
 * active = solid amber with a dark glyph. Never a giant floating button,
 * never a glow.
 */
function WorkoutIcon(props: { focused: boolean; color: string }) {
  const filled = props.focused;
  return (
    <View style={[styles.workoutPlate, filled ? styles.workoutPlateActive : styles.workoutPlateRest]}>
      <Ionicons
        name={filled ? "barbell" : "barbell-outline"}
        size={20}
        color={filled ? colors.textOnAccent : colors.textSecondary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  label: { ...type.label, textTransform: "none" },
  workoutPlate: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  workoutPlateRest: { backgroundColor: "transparent", borderColor: colors.border },
  workoutPlateActive: { backgroundColor: colors.accent, borderColor: colors.accent },
});
