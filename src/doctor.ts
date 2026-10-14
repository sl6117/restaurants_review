import { join, relative, sep } from "node:path";

/**
 * Pre-flight checks behind `npm run doctor`.
 *
 * Every check is a pure function over inputs gathered by scripts/doctor.ts, so
 * tests can exercise macOS-only paths on any machine. Read-only by design:
 * nothing here writes, touches the network, or calls launchctl, and env vars
 * are reported as set/unset — never by value.
 */
export type CheckStatus = "pass" | "warn" | "fail" | "skip";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

export type Env = Record<string, string | undefined>;
export type Exists = (path: string) => boolean;

export type TargetsResult = { ok: true; count: number } | { ok: false; error: string };

export interface DoctorInput {
  nodeVersion: string;
  platform: NodeJS.Platform;
  projectRoot: string;
  homeDir: string;
  env: Env;
  exists: Exists;
  targets: TargetsResult;
  oauthClientPath: string;
  oauthTokenPath: string;
  /** Contents of the installed launchd plist, or null when none is installed. */
  plistXml: string | null;
}

export const MIN_NODE_MAJOR = 22;
export const PLIST_LABEL = "com.example.reviews";

export function launchAgentPath(homeDir: string): string {
  return join(homeDir, "Library", "LaunchAgents", `${PLIST_LABEL}.plist`);
}

export function checkNodeVersion(version: string): CheckResult {
  const major = Number(version.split(".")[0]);
  return major >= MIN_NODE_MAJOR
    ? { name: "Node version", status: "pass", detail: `v${version}` }
    : {
        name: "Node version",
        status: "fail",
        detail: `v${version}; need >= ${MIN_NODE_MAJOR} for --import and --env-file-if-exists`,
      };
}

/** Where Playwright's `channel: "chrome"` (src/browser.ts) looks for Chrome. */
export function chromeCandidates(platform: NodeJS.Platform, env: Env): string[] {
  switch (platform) {
    case "darwin":
      return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
    case "linux":
      return ["/opt/google/chrome/chrome"];
    case "win32":
      return [env.LOCALAPPDATA, env.PROGRAMFILES, env["PROGRAMFILES(X86)"]]
        .filter((dir): dir is string => Boolean(dir))
        .map((dir) => `${dir}\\Google\\Chrome\\Application\\chrome.exe`);
    default:
      return [];
  }
}

export function checkChrome(
  platform: NodeJS.Platform,
  env: Env,
  exists: Exists,
): CheckResult {
  const candidates = chromeCandidates(platform, env);
  const found = candidates.find(exists);
  if (found) return { name: "Google Chrome", status: "pass", detail: found };
  return {
    name: "Google Chrome",
    status: "fail",
    detail:
      candidates.length > 0
        ? `not found at ${candidates.join(" or ")}; npm run check and diagnose need real Chrome`
        : `no known Chrome location on ${platform}`,
  };
}

/** Project-relative when inside the checkout, so output stays readable. */
function displayPath(path: string, projectRoot: string): string {
  const rel = relative(projectRoot, path);
  return rel && !rel.startsWith("..") ? rel : path;
}

export function checkTargets(targets: TargetsResult): CheckResult {
  return targets.ok
    ? {
        name: "config/targets.json",
        status: "pass",
        detail: `${targets.count} target(s)`,
      }
    : { name: "config/targets.json", status: "fail", detail: targets.error };
}

export function checkOAuthFiles(
  projectRoot: string,
  clientPath: string,
  tokenPath: string,
  exists: Exists,
): CheckResult {
  const missing = [clientPath, tokenPath]
    .filter((path) => !exists(path))
    .map((path) => displayPath(path, projectRoot));
  if (missing.length === 0) {
    return { name: "OAuth files", status: "pass", detail: "client and token present" };
  }
  return {
    name: "OAuth files",
    status: "fail",
    detail:
      `missing ${missing.join(", ")}; see SETUP.md, then npm run authorize. ` +
      `npm run check -- --dry-run still works without them`,
  };
}

/**
 * The Doc id lives only in data/document.json. A ledger without it means the
 * next real run creates a second Doc and splits the review history.
 */
export function checkDocState(
  projectRoot: string,
  env: Env,
  exists: Exists,
): CheckResult {
  const name = "Review doc id";
  if (env.GOOGLE_DOC_ID) {
    return { name, status: "pass", detail: "GOOGLE_DOC_ID override is set" };
  }
  if (exists(join(projectRoot, "data/document.json"))) {
    return { name, status: "pass", detail: "data/document.json present" };
  }
  if (exists(join(projectRoot, "data/seen.json"))) {
    return {
      name,
      status: "warn",
      detail:
        "data/seen.json exists but data/document.json does not; the next real run " +
        "will create a NEW doc. Restore data/document.json first",
    };
  }
  return {
    name,
    status: "pass",
    detail: "first real run will create the doc and save its id",
  };
}

export function checkApiKeys(env: Env): CheckResult[] {
  const set = (key: string) => Boolean(env[key]);
  const results: CheckResult[] = [];

  results.push(
    set("GOOGLE_MAPS_API_KEY")
      ? {
          name: "check: health-check key",
          status: "pass",
          detail: "GOOGLE_MAPS_API_KEY set",
        }
      : {
          name: "check: health-check key",
          status: "warn",
          detail:
            "GOOGLE_MAPS_API_KEY not set; an empty Google scrape cannot be told apart from a broken one",
        },
  );

  results.push(
    set("ANTHROPIC_API_KEY")
      ? { name: "report", status: "pass", detail: "ANTHROPIC_API_KEY set" }
      : { name: "report", status: "warn", detail: "needs ANTHROPIC_API_KEY" },
  );

  const missing: string[] = [];
  if (!set("ANTHROPIC_API_KEY")) missing.push("ANTHROPIC_API_KEY");
  if (!set("GOOGLE_MAPS_API_KEY") && !set("YELP_API_KEY")) {
    missing.push("GOOGLE_MAPS_API_KEY and/or YELP_API_KEY");
  }
  results.push(
    missing.length === 0
      ? { name: "add-restaurant", status: "pass", detail: "required keys set" }
      : {
          name: "add-restaurant",
          status: "warn",
          detail: `needs ${missing.join(" plus ")}`,
        },
  );

  return results;
}

const PROTECTED_FOLDERS = ["Desktop", "Documents", "Downloads"];

/** launchd jobs die at getcwd under these folders (see the plist comment). */
export function checkProjectLocation(
  platform: NodeJS.Platform,
  projectRoot: string,
  homeDir: string,
): CheckResult {
  const name = "Project location";
  if (platform !== "darwin") {
    return { name, status: "skip", detail: "macOS-only check" };
  }
  const top = relative(homeDir, projectRoot).split(sep)[0];
  if (top && PROTECTED_FOLDERS.includes(top)) {
    return {
      name,
      status: "warn",
      detail: `under ~/${top}; launchd cannot run it there. Move it, e.g. to ~/restaurants_review`,
    };
  }
  return { name, status: "pass", detail: projectRoot };
}

function plistString(xml: string, key: string): string | null {
  const match = xml.match(new RegExp(`<key>${key}</key>\\s*<string>([^<]*)</string>`));
  return match?.[1]?.trim() ?? null;
}

function plistFirstArgument(xml: string): string | null {
  const match = xml.match(
    /<key>ProgramArguments<\/key>\s*<array>\s*<string>([^<]*)<\/string>/,
  );
  return match?.[1]?.trim() ?? null;
}

/**
 * Compares the installed plist with this checkout. Reads the file only; whether
 * the job is loaded is launchctl's business, and this never calls it.
 */
export function checkLaunchdPlist(
  platform: NodeJS.Platform,
  homeDir: string,
  projectRoot: string,
  plistXml: string | null,
  exists: Exists,
): CheckResult {
  const name = "launchd plist";
  if (platform !== "darwin") {
    return { name, status: "skip", detail: "macOS-only check" };
  }
  if (plistXml === null) {
    return {
      name,
      status: "skip",
      detail: `not installed at ${launchAgentPath(homeDir)}`,
    };
  }

  const xml = plistXml.replace(/<!--[\s\S]*?-->/g, "");
  const problems: string[] = [];

  const workingDirectory = plistString(xml, "WorkingDirectory");
  if (!workingDirectory) {
    problems.push("no WorkingDirectory");
  } else if (workingDirectory !== projectRoot) {
    problems.push(
      `WorkingDirectory is ${workingDirectory}, this checkout is ${projectRoot}`,
    );
  }

  const node = plistFirstArgument(xml);
  if (!node) {
    problems.push("no ProgramArguments");
  } else if (!exists(node)) {
    problems.push(`node binary ${node} does not exist (Node upgraded or moved?)`);
  }

  return problems.length === 0
    ? { name, status: "pass", detail: "paths match this checkout" }
    : { name, status: "warn", detail: problems.join("; ") };
}

export function runChecks(input: DoctorInput): CheckResult[] {
  return [
    checkNodeVersion(input.nodeVersion),
    checkChrome(input.platform, input.env, input.exists),
    checkTargets(input.targets),
    checkOAuthFiles(
      input.projectRoot,
      input.oauthClientPath,
      input.oauthTokenPath,
      input.exists,
    ),
    checkDocState(input.projectRoot, input.env, input.exists),
    ...checkApiKeys(input.env),
    checkProjectLocation(input.platform, input.projectRoot, input.homeDir),
    checkLaunchdPlist(
      input.platform,
      input.homeDir,
      input.projectRoot,
      input.plistXml,
      input.exists,
    ),
  ];
}

export function exitCodeFor(results: CheckResult[]): number {
  return results.some((r) => r.status === "fail") ? 1 : 0;
}

export function formatResults(results: CheckResult[]): string {
  const width = Math.max(...results.map((r) => r.name.length));
  return results
    .map(
      (r) =>
        `${r.status.toUpperCase().padEnd(4)}  ${r.name.padEnd(width)}  ${r.detail}`,
    )
    .join("\n");
}
