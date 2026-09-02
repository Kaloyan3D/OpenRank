/**
 * Metro configuration: the mobile app imports TypeScript source from the
 * workspace packages (@openrank/*), so Metro must transpile them.
 */
// Metro configs are CommonJS; a require() here is the documented pattern.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require("expo/metro-config");

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.transpilePackages = [
  "@openrank/exercise-catalog",
  "@openrank/domain",
  "@openrank/shared",
  "@openrank/database",
];

module.exports = config;