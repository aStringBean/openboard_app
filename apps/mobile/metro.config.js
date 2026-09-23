/**
 * Metro in a workspace: watch the repo root so changes in
 * packages/aurora-protocol are picked up, and resolve modules from both the
 * app's and the root's node_modules (npm hoists most packages to the root).
 */
const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];
/* The codec declares its entry point through "exports", not "main". */
config.resolver.unstable_enablePackageExports = true;
config.resolver.disableHierarchicalLookup = true;

module.exports = config;
