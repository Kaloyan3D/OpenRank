/**
 * Database initialization at app boot (Phase 3 task Q).
 *
 * Boots SQLite synchronously (open -> migrate -> seed the bundled catalog)
 * and exposes the repositories through context. Initialization errors are
 * explicit state (never swallowed): the UI shows a retry-able error screen
 * instead of silently falling back to React state or the bundled JSON.
 *
 * After the initial seed, SQLite is the source of truth for exercise catalog
 * access - screens read exclusively through the repositories.
 */

import { createContext, useCallback, useContext, useState } from "react";
import type { ReactNode } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import catalogJson from "@openrank/exercise-catalog/catalog.v1.json";
import type { CatalogV1 } from "@openrank/exercise-catalog";
import type { OpenDatabaseResult } from "@openrank/database";
import { openDatabase } from "@openrank/database";
import { ExpoSqliteDriver, newExpoId } from "@openrank/database/expo";

const catalog = catalogJson as unknown as CatalogV1;

export type DatabaseStatus =
  | { state: "loading" }
  | { state: "ready"; repos: OpenDatabaseResult }
  | { state: "error"; message: string };

/** One synchronous init pass: open -> pragmas -> migrate -> seed. */
function initializeDatabase(): DatabaseStatus {
  try {
    const driver = ExpoSqliteDriver.open();
    const repos = openDatabase(driver, { catalog, newId: newExpoId });
    // Attach the driver so the service layer can run cross-repository
    // transactions on the SAME connection (see ServicesProvider).
    (repos as OpenDatabaseResult & { __driver?: unknown }).__driver = driver;
    return { state: "ready", repos };
  } catch (err) {
    return {
      state: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

interface DatabaseContextValue {
  status: DatabaseStatus;
  retry: () => void;
}

const DatabaseContext = createContext<DatabaseContextValue | null>(null);

export function DatabaseProvider(props: { children: ReactNode }) {
  // SQLite open + migrate + seed are synchronous; initialize in the state
  // initializer (no effect needed) and re-run it on explicit retry.
  const [status, setStatus] = useState<DatabaseStatus>(() => initializeDatabase());

  const retry = useCallback(() => {
    setStatus(initializeDatabase());
  }, []);

  return (
    <DatabaseContext.Provider value={{ status, retry }}>
      {props.children}
    </DatabaseContext.Provider>
  );
}

/** Typed hook for screens. */
export function useDatabase(): DatabaseContextValue {
  const value = useContext(DatabaseContext);
  if (!value) throw new Error("useDatabase must be used inside <DatabaseProvider>");
  return value;
}

/** Hook for screens that require an initialized database. */
export function useRepos(): OpenDatabaseResult {
  const { status } = useDatabase();
  if (status.state !== "ready") {
    throw new Error("database not ready (state: " + status.state + ")");
  }
  return status.repos;
}

/** Boot gate: loading/error UI + children once the database is ready. */
export function DatabaseGate(props: { ready: ReactNode }) {
  const { status, retry } = useDatabase();
  if (status.state === "loading") {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#4a9eff" />
        <Text style={styles.muted}>Opening database...</Text>
      </View>
    );
  }
  if (status.state === "error") {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Database failed to initialize</Text>
        <Text style={styles.muted}>{status.message}</Text>
        <Pressable onPress={retry} style={styles.retryButton}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }
  return <>{props.ready}</>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8, padding: 24 },
  muted: { color: "#8a8f98", fontSize: 13, textAlign: "center" },
  errorTitle: { color: "#ff6b6b", fontSize: 16, fontWeight: "700" },
  retryButton: {
    marginTop: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#4a9eff",
  },
  retryText: { color: "#4a9eff", fontSize: 14 },
});