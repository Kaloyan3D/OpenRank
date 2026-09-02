import { StyleSheet, Text, View } from "react-native";
import { Modal, Pressable } from "react-native";
import type { ReactNode } from "react";
import { colors } from "../../design/colors";
import { radius } from "../../design/radii";
import { space } from "../../design/spacing";
import { type } from "../../design/typography";
import { elevation } from "../../design/elevation";

/**
 * Shared modal / bottom sheet shell (Phase 8.1, spec 38): SURFACE_ELEVATED,
 * rounded top corners, subtle handle, scrim tap-to-close. Used by the
 * routine picker, set-type picker, exercise options and danger confirms.
 */
export function ModalShell(props: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <Pressable
        accessibilityLabel="Close"
        accessibilityRole="button"
        onPress={props.onClose}
        style={styles.scrim}
      >
        <Pressable
          accessible={false}
          onPress={(e) => e.stopPropagation()}
          style={[styles.sheet, elevation.medium]}
        >
          <View style={styles.handle} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
          {props.title ? <Text style={styles.title}>{props.title}</Text> : null}
          <View style={styles.body}>{props.children}</View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.surfaceElevated,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: space[4],
    paddingTop: space[2],
    paddingBottom: space[6],
    maxHeight: "80%",
  },
  handle: {
    alignSelf: "center",
    width: 40,
    height: 4,
    borderRadius: 999,
    backgroundColor: colors.borderStrong,
    marginBottom: space[3],
  },
  title: { ...type.sectionTitle, color: colors.text, marginBottom: space[2] },
  body: { gap: space[2] },
});
