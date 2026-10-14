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

export function launchAgentPath(homeDir: string): string {
  return join(homeDir, "Library", "LaunchAgents", "com.example.reviews.plist");
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
const CHROME_PATHS: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "/opt/google/chrome/chrome",
};

export function checkChrome(platform: NodeJS.Platform, exists: Exists): CheckResult {
  const path = CHROME_PATHS[platform];
  if (path && exists(path)) {
    return { name: "Google Chrome", status: "pass", detail: path };
  }
  return {
    name: "Google Chrome",
    status: "fail",
    detail: path
      ? `not found at ${path}; npm run check and diagnose need real Chrome`
      : `no known Chrome location on ${platform}`,
  };
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

/** Project-relative when inside the checkout, so output stays readable. */
function displayPath(path: string, projectRoot: string): string {
  const rel = relative(projectRoot, path);
  return rel && !rel.startsWith("..") ? rel : path;
}

/**
 * An overridden path is named by its env var, not printed: the value is
 * user-supplied and reaches the terminal unredacted otherwise.
 */
export function checkOAuthFiles(
  projectRoot: string,
  env: Env,
  clientPath: string,
  tokenPath: string,
  exists: Exists,
): CheckResult {
  const files = [
    [clientPath, "GOOGLE_OAUTH_CLIENT"],
    [tokenPath, "GOOGLE_OAUTH_TOKEN"],
  ] as const;
  const missing = files
    .filter(([path]) => !exists(path))
    .map(([path, key]) =>
      env[key] ? `the file ${key} points to` : displayPath(path, projectRoot),
    );
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
 * The doc id and the dedupe ledger must travel together. A doc without its
 * ledger gets every visible review appended again (loadLedger treats a missing
 * file as empty); a ledger without its doc id makes the next run start a
 * second doc and split the history.
 */
export function checkDocState(
  projectRoot: string,
  env: Env,
  exists: Exists,
): CheckResult {
  const name = "Review doc + ledger";
  const docRef = env.GOOGLE_DOC_ID
    ? "GOOGLE_DOC_ID"
    : exists(join(projectRoot, "data/document.json"))
      ? "data/document.json"
      : null;
  const hasLedger = exists(join(projectRoot, "data/seen.json"));

  if (docRef && !hasLedger) {
    return {
      name,
      status: "fail",
      detail:
        `${docRef} points at an existing doc but data/seen.json is missing; the next ` +
        `real run would re-append every visible review. Restore data/seen.json first`,
    };
  }
  if (!docRef && hasLedger) {
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
    detail: docRef
      ? `${docRef} and data/seen.json present`
      : "first real run will create the doc and save its id",
  };
}

/** Each inner list is "any one of these keys". */
const KEY_CHECKS: { name: string; needs: string[][]; hint?: string }[] = [
  {
    name: "check: health-check key",
    needs: [["GOOGLE_MAPS_API_KEY"]],
    hint: "an empty Google scrape cannot be told apart from a broken one",
  },
  { name: "report", needs: [["ANTHROPIC_API_KEY"]] },
  {
    name: "add-restaurant",
    needs: [["ANTHROPIC_API_KEY"], ["GOOGLE_MAPS_API_KEY", "YELP_API_KEY"]],
  },
];

export function checkApiKeys(env: Env): CheckResult[] {
  return KEY_CHECKS.map(({ name, needs, hint }): CheckResult => {
    const missing = needs
      .filter((anyOf) => !anyOf.some((key) => env[key]))
      .map((anyOf) => anyOf.join(" or "));
    return missing.length === 0
      ? { name, status: "pass", detail: "required keys set" }
      : {
          name,
          status: "warn",
          detail: `needs ${missing.join(" and ")}${hint ? `; ${hint}` : ""}`,
        };
  });
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

/** The <string> values under a plist key, whether a single string or an array. */
function plistStrings(xml: string, key: string): string[] {
  const value = xml.match(
    new RegExp(
      `<key>${key}</key>\\s*(<string>[^<]*</string>|<array>[\\s\\S]*?</array>)`,
    ),
  )?.[1];
  return [...(value ?? "").matchAll(/<string>([^<]*)<\/string>/g)].map((m) =>
    (m[1] ?? "").trim(),
  );
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

  const [workingDirectory] = plistStrings(xml, "WorkingDirectory");
  if (workingDirectory !== projectRoot) {
    problems.push(
      `WorkingDirectory is ${workingDirectory ?? "unset"}, this checkout is ${projectRoot}`,
    );
  }

  const [node, ...args] = plistStrings(xml, "ProgramArguments");
  if (!node || !exists(node)) {
    problems.push(
      `node binary ${node ?? "(none)"} does not exist (Node upgraded or moved?)`,
    );
  } else {
    // Only nvm paths carry a version; anything else would need executing node.
    const major = Number(node.match(/\/node\/v(\d+)\./)?.[1]);
    if (major < MIN_NODE_MAJOR) {
      problems.push(
        `node binary is v${major}; the job's flags need >= ${MIN_NODE_MAJOR}`,
      );
    }
  }
  // Node runs the first argument that is neither a flag nor --import's value.
  const script = args.find(
    (arg, i) => !arg.startsWith("-") && args[i - 1] !== "--import",
  );
  if (script !== "src/run.ts") {
    problems.push(`ProgramArguments run ${script ?? "no script"}, not src/run.ts`);
  }

  return problems.length === 0
    ? { name, status: "pass", detail: "matches this checkout" }
    : { name, status: "warn", detail: problems.join("; ") };
}

export function runChecks(input: DoctorInput): CheckResult[] {
  return [
    checkNodeVersion(input.nodeVersion),
    checkChrome(input.platform, input.exists),
    checkTargets(input.targets),
    checkOAuthFiles(
      input.projectRoot,
      input.env,
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
