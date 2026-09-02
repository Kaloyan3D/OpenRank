import { useState } from "react";
import { useRouter } from "expo-router";
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useRepos } from "../db/DatabaseProvider";
import { useServices } from "../services/ServicesProvider";
import { useCanonicalRevision } from "../local-data/useCanonicalRevision";
import { colors } from "../design/colors";
import { spacing, typography } from "../theme/tokens";

/**
 * Routine list (Phase 4, task R): active and archived sections; create via
 * dialog. Archived routines remain available historically.
 */
export default function RoutinesScreen() {
  const router = useRouter();
  const repos = useRepos();
  const services = useServices();
  // Canonical invalidation (Phase 8.2): routine create/edit/delete commits
  // -> revision++ -> this list re-renders when the builder screen returns.
  useCanonicalRevision();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");

  const profile = repos.profile.getDefault();
  const lists = profile ? services.routine.list(profile.id) : { active: [], archived: [] };

  const create = () => {
    if (!profile) return;
    try {
      const r = services.routine.create(profile.id, name);
      setCreateOpen(false);
      setName("");
      router.push("/routine/" + r.id);
    } catch (err) {
      Alert.alert("Cannot create routine", err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Pressable style={[styles.button, styles.primary]} onPress={() => setCreateOpen(true)}>
        <Text style={styles.primaryText}>+ Create Routine</Text>
      </Pressable>

      <Text style={styles.section}>Active routines</Text>
      {lists.active.length === 0 ? (
        <Text style={styles.muted}>No routines yet.</Text>
      ) : (
        lists.active.map((r) => (
          <Pressable key={r.id} style={styles.row} onPress={() => router.push("/routine/" + r.id)}>
            <Text style={styles.rowTitle}>{r.name}</Text>
            <Text style={styles.rowMeta}>{"\u2192"}</Text>
          </Pressable>
        ))
      )}

      <Text style={styles.section}>Archived</Text>
      {lists.archived.length === 0 ? (
        <Text style={styles.muted}>Nothing archived.</Text>
      ) : (
        lists.archived.map((r) => (
          <Pressable key={r.id} style={[styles.row, styles.archived]} onPress={() => router.push("/routine/" + r.id)}>
            <Text style={[styles.rowTitle, styles.archivedTitle]}>{r.name}</Text>
            <Text style={styles.rowMeta}>archived</Text>
          </Pressable>
        ))
      )}

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>New routine</Text>
            <TextInput
              style={styles.input}
              value={name}
              onChangeText={setName}
              placeholder="e.g. Push Day"
              placeholderTextColor={colors.textMuted}
              autoFocus
              onSubmitEditing={create}
            />
            <View style={styles.modalRow}>
              <Pressable style={[styles.button, styles.secondary]} onPress={() => setCreateOpen(false)}>
                <Text style={styles.secondaryText}>Cancel</Text>
              </Pressable>
              <Pressable style={[styles.button, styles.primary]} onPress={create}>
                <Text style={styles.primaryText}>Create</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.md, gap: spacing.sm, paddingBottom: 60 },
  button: { borderRadius: 10, paddingVertical: 14, paddingHorizontal: 16, alignItems: "center", minHeight: 48, justifyContent: "center" },
  primary: { backgroundColor: colors.accent },
  primaryText: { color: colors.textOnAccent, fontWeight: "700", fontSize: 15 },
  secondary: { borderWidth: 1, borderColor: colors.textMuted },
  secondaryText: { color: colors.text },
  section: { ...typography.body, color: colors.accent, fontWeight: "700", marginTop: spacing.sm },
  muted: { ...typography.caption, color: colors.textMuted },
  row: { backgroundColor: colors.surface, borderRadius: 10, padding: spacing.md, flexDirection: "row", alignItems: "center", minHeight: 52 },
  archived: { opacity: 0.6 },
  rowTitle: { ...typography.body, color: colors.text, flex: 1 },
  archivedTitle: { color: colors.textMuted },
  rowMeta: { color: colors.textMuted, fontSize: 13 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  modalCard: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.lg, width: "86%", gap: 12 },
  modalTitle: { ...typography.body, color: colors.text, fontWeight: "700" },
  input: { backgroundColor: colors.surfacePressed, color: colors.text, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44 },
  modalRow: { flexDirection: "row", gap: 8 },
});