import { Pressable, StyleSheet, Text, View } from "react-native";
import type { SetType } from "@openrank/domain";
import { colors, typography } from "../../theme/tokens";

export const SET_TYPES: SetType[] = ["normal", "warmup", "drop", "failure", "amrap"];

/** Set-type modal (Phase 7.1 extraction, behavior-preserving). */
export function SetTypeModal(props: { current: SetType; onPick: (t: SetType) => void; onClose: () => void }) {
  return (
    <View style={styles.modalBackdrop}>
      <Pressable style={styles.modalFill} onPress={props.onClose} accessibilityLabel="Close set type picker" />
      <View style={styles.modalCard}>
        <Text style={styles.modalTitle}>Set type</Text>
        <View style={styles.typeRow}>
          {SET_TYPES.map((t) => (
            <Pressable
              key={t}
              style={[styles.typeChip, props.current === t ? styles.typeChipActive : null]}
              onPress={() => props.onPick(t)}
            >
              <Text style={styles.typeChipText}>{t}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: { position: "absolute", inset: 0, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  modalFill: { position: "absolute", inset: 0 },
  modalCard: { backgroundColor: colors.surface, borderRadius: 14, padding: 24, width: "86%", gap: 10 },
  modalTitle: { ...typography.body, color: colors.text, fontWeight: "700" },
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  typeChip: { borderWidth: 1, borderColor: colors.textMuted, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  typeChipActive: { borderColor: colors.accent },
  typeChipText: { color: colors.text, fontSize: 12, textTransform: "capitalize" },
});
