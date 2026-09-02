import type { ExpoConfig } from "expo/config";

/**
 * OpenRank - free, open-source, offline-first strength training.
 * UI shell only: all business logic lives in packages/*.
 */
const config: ExpoConfig = {
  name: "OpenRank",
  slug: "openrank",
  scheme: "openrank",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: {
    bundleIdentifier: "app.openrank.mobile",
    supportsTablet: false,
  },
  android: {
    package: "app.openrank.mobile",
  },
  plugins: ["expo-router"],
  experiments: {
    typedRoutes: false,
  },
};

export default config;
