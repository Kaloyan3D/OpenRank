import { StyleSheet, View } from "react-native";
import type { ReactNode } from "react";
import { colors } from "../../design/colors";
import { SCREEN_PADDING, space } from "../../design/spacing";

/**
 * OpenRank screen shell (Phase 8.1): consistent background + horizontal
 * padding (16px) + bottom nav clearance. No per-screen one-off padding.
 */
export function Screen(props: { children: ReactNode; padded?: boolean; style?: object | object[] }) {
  return (
    <View style={[styles.root, props.style]}>
      <View style={[styles.inner, props.padded === false ? null : styles.padded]}>{props.children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  inner: { gap: space[3], paddingBottom: space[6] },
  padded: { paddingHorizontal: SCREEN_PADDING, paddingTop: space[4] },
});
