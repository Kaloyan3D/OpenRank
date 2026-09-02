/**
 * Metro configuration: the mobile app imports TypeScript source from the
 * workspace packages (@openrank/*), so Metro must transpile them.
 *
 * ranking-core uses Node-ESM style ".js" specifiers inside its TypeScript
 * sources (Node/Vitest resolve them to the sibling ".ts"); Metro does not.
 * The resolver below delegates to Metro's default algorithm first and only
 * falls back to the ".ts" variant when the original specifier cannot be
 * resolved - real ".js" files (node_modules) keep working.
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
  "@openrank/ranking-core",
];

config.resolver.resolveRequest = (context, moduleName, platform) => {
  try {
    return context.resolveRequest(context, moduleName, platform);
  } catch (err) {
    if (moduleName.startsWith(".") && moduleName.endsWith(".js")) {
      try {
        return context.resolveRequest(context, moduleName.slice(0, -3) + ".ts", platform);
      } catch {
        // fall through to the original error
      }
    }
    throw err;
  }
};

module.exports = config;
