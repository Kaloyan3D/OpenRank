/**
 * Application services context (Phase 4, task A).
 *
 * Builds the service layer (WorkoutService, RoutineService, RestTimerService)
 * once over the opened database. Screens consume services through
 * useServices() - never repositories directly, never ad-hoc SQL.
 *
 * Layering: UI -> services -> repositories -> SQLite.
 */

import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type { OpenDatabaseResult } from "@openrank/database";
import { createServices } from "@openrank/database";
import type { OpenRankServices } from "@openrank/database";
import { useRepos } from "../db/DatabaseProvider";

const ServicesContext = createContext<OpenRankServices | null>(null);

export function ServicesProvider(props: { children: ReactNode }) {
  const repos: OpenDatabaseResult = useRepos();
  const services = useMemo(() => createServices(containerDriver(repos), repos), [repos]);
  return <ServicesContext.Provider value={services}>{props.children}</ServicesContext.Provider>;
}

export function useServices(): OpenRankServices {
  const value = useContext(ServicesContext);
  if (!value) throw new Error("useServices must be used inside <ServicesProvider>");
  return value;
}

/**
 * createServices needs the driver for cross-repository transactions; the
 * OpenDatabaseResult does not expose it. The services only use it inside
 * transaction() calls, which are reentrant no-ops around repository calls -
 * but they must be the SAME connection. We therefore thread the driver
 * through the repos container at creation time (see DatabaseProvider).
 */
import type { DatabaseDriver } from "@openrank/database";

const DRIVER_KEY = "__driver";
function containerDriver(repos: OpenDatabaseResult): DatabaseDriver {
  const withDriver = repos as OpenDatabaseResult & { [DRIVER_KEY]?: DatabaseDriver };
  const driver = withDriver[DRIVER_KEY];
  if (!driver) throw new Error("database container is missing its driver");
  return driver;
}
