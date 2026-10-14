/**
 * Read-only pre-flight: is this checkout ready for `npm run check`, `report`,
 * `add-restaurant` and (on macOS) the launchd job?
 *
 *   npm run doctor
 *
 * Exits 1 if any check FAILs; WARNs alone exit 0. Checks live in src/doctor.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { loadEnv, loadTargets, PROJECT_ROOT } from "../src/config.ts";
import {
  exitCodeFor,
  formatResults,
  launchAgentPath,
  runChecks,
  type TargetsResult,
} from "../src/doctor.ts";

const homeDir = homedir();

const targets: TargetsResult = await loadTargets().then(
  (list) => ({ ok: true as const, count: list.length }),
  (error: Error) => ({ ok: false as const, error: error.message }),
);

const plistPath = launchAgentPath(homeDir);
const plistXml =
  process.platform === "darwin" && existsSync(plistPath)
    ? readFileSync(plistPath, "utf8")
    : null;

const env = loadEnv();
const results = runChecks({
  nodeVersion: process.versions.node,
  platform: process.platform,
  projectRoot: PROJECT_ROOT,
  homeDir,
  env: process.env,
  exists: existsSync,
  targets,
  oauthClientPath: env.oauthClientPath,
  oauthTokenPath: env.oauthTokenPath,
  plistXml,
});

console.log(formatResults(results));
process.exit(exitCodeFor(results));
