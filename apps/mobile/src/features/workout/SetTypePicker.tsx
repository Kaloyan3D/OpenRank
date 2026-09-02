import { StyleSheet, Text, View } from "react-native";
import type { SetType } from "@openrank/domain";
import { ModalShell } from "../../components/ui/ModalShell";
import { Chip } from "../../components/ui/Chip";
import { colors } from "../../design/colors";
import { type } from "../../design/typography";

export const SET_TYPES: SetType[] = ["normal", "warmup", "drop", "failure", "amrap"];

/** Set-type picker (Phase 8.1, spec 37): shared ModalShell + chips. The
 * current type is marked selected (amber) and announced via accessibility
 * state. Behavior-preserving: onPick/onClose semantics unchanged. */
export function SetTypeModal(props: { current: SetType; onPick: (t: SetType) => void; onClose: () => void }) {
  return (
    <ModalShell visible onClose={props.onClose} title="Set type">
      <View style={styles.typeRow}>
        {SET_TYPES.map((t) => (
          <Chip
            key={t}
            label={t}
            selected={props.current === t}
            onPress={() => props.onPick(t)}
            accessibilityLabel={"Set type " + t + (props.current === t ? ", currently selected" : "")}
          />
        ))}
      </View>
      <Text style={styles.hint}>Applies to this set only.</Text>
    </ModalShell>
  );
}

const styles = StyleSheet.create({
  typeRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: 8 },
  hint: { ...type.caption, color: colors.textMuted },
});
