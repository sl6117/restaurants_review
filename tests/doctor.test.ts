import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkApiKeys,
  checkChrome,
  checkDocState,
  checkLaunchdPlist,
  checkNodeVersion,
  checkOAuthFiles,
  checkProjectLocation,
  checkTargets,
  exitCodeFor,
  launchAgentPath,
  runChecks,
  type CheckResult,
  type DoctorInput,
  type Exists,
} from "../src/doctor.ts";

const HOME = "/Users/owner";
const ROOT = "/Users/owner/restaurants_review";
const NODE = "/Users/owner/.nvm/versions/node/v22.11.0/bin/node";
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

function existing(...paths: string[]): Exists {
  const set = new Set(paths);
  return (path) => set.has(path);
}

function plist(workingDirectory: string, node: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- <key>WorkingDirectory</key><string>/from/a/comment</string> -->
<plist version="1.0">
  <dict>
    <key>ProgramArguments</key>
    <array>
      <string>${node}</string>
      <string>src/run.ts</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${workingDirectory}</string>
  </dict>
</plist>`;
}

describe("checkNodeVersion", () => {
  test("passes on the engines minimum and fails below it", () => {
    assert.equal(checkNodeVersion("22.0.0").status, "pass");
    assert.equal(checkNodeVersion("20.18.1").status, "fail");
  });
});

describe("checkChrome", () => {
  test("passes when Chrome is where Playwright's chrome channel looks", () => {
    const result = checkChrome("darwin", {}, existing(MAC_CHROME));
    assert.equal(result.status, "pass");
    assert.equal(result.detail, MAC_CHROME);
  });

  test("fails and names the expected path when Chrome is missing", () => {
    const result = checkChrome("linux", {}, existing());
    assert.equal(result.status, "fail");
    assert.match(result.detail, /\/opt\/google\/chrome\/chrome/);
  });
});

describe("checkTargets", () => {
  test("passes through loadTargets' error message on failure", () => {
    assert.equal(checkTargets({ ok: true, count: 2 }).status, "pass");
    const result = checkTargets({ ok: false, error: "must be an ARRAY of targets" });
    assert.equal(result.status, "fail");
    assert.match(result.detail, /ARRAY/);
  });
});

describe("checkOAuthFiles", () => {
  test("fails naming only the missing file, and points at authorize", () => {
    const result = checkOAuthFiles(
      ROOT,
      `${ROOT}/credentials/oauth-client.json`,
      `${ROOT}/credentials/token.json`,
      existing(`${ROOT}/credentials/oauth-client.json`),
    );
    assert.equal(result.status, "fail");
    assert.match(result.detail, /missing credentials\/token\.json;/);
    assert.doesNotMatch(result.detail, /oauth-client/);
    assert.match(result.detail, /npm run authorize/);
  });
});

describe("checkDocState", () => {
  test("warns when a ledger exists without the doc id: next run would split history", () => {
    const result = checkDocState(ROOT, {}, existing(`${ROOT}/data/seen.json`));
    assert.equal(result.status, "warn");
    assert.match(result.detail, /NEW doc/);
  });

  test("passes with the stored id, the env override, or a truly fresh checkout", () => {
    assert.equal(
      checkDocState(ROOT, {}, existing(`${ROOT}/data/document.json`)).status,
      "pass",
    );
    assert.equal(
      checkDocState(ROOT, { GOOGLE_DOC_ID: "abc" }, existing(`${ROOT}/data/seen.json`))
        .status,
      "pass",
    );
    assert.equal(checkDocState(ROOT, {}, existing()).status, "pass");
  });
});

describe("checkApiKeys", () => {
  const byName = (results: CheckResult[]) =>
    Object.fromEntries(results.map((r) => [r.name, r]));

  test("add-restaurant accepts either search key alongside Anthropic", () => {
    const results = byName(checkApiKeys({ ANTHROPIC_API_KEY: "x", YELP_API_KEY: "y" }));
    assert.equal(results["add-restaurant"]?.status, "pass");
    assert.equal(results["report"]?.status, "pass");
    assert.equal(results["check: health-check key"]?.status, "warn");
  });

  test("missing keys are warnings, never failures", () => {
    const results = checkApiKeys({});
    assert.ok(results.every((r) => r.status === "warn"));
  });

  test("never echoes a key's value", () => {
    const secret = "sk-ant-should-never-appear";
    const output = JSON.stringify(
      checkApiKeys({
        ANTHROPIC_API_KEY: secret,
        GOOGLE_MAPS_API_KEY: secret,
        YELP_API_KEY: secret,
      }),
    );
    assert.ok(!output.includes(secret));
  });
});

describe("checkProjectLocation", () => {
  test("warns under macOS-protected folders", () => {
    const result = checkProjectLocation(
      "darwin",
      `${HOME}/Desktop/restaurants_review`,
      HOME,
    );
    assert.equal(result.status, "warn");
    assert.match(result.detail, /~\/Desktop/);
  });

  test("passes elsewhere, and skips off macOS", () => {
    assert.equal(checkProjectLocation("darwin", ROOT, HOME).status, "pass");
    assert.equal(
      checkProjectLocation("linux", `${HOME}/Desktop/restaurants_review`, HOME).status,
      "skip",
    );
  });
});

describe("checkLaunchdPlist", () => {
  test("skips off macOS and when no plist is installed", () => {
    assert.equal(
      checkLaunchdPlist("linux", HOME, ROOT, plist(ROOT, NODE), existing()).status,
      "skip",
    );
    const result = checkLaunchdPlist("darwin", HOME, ROOT, null, existing());
    assert.equal(result.status, "skip");
    assert.match(result.detail, /com\.example\.reviews\.plist/);
  });

  test("passes when the plist matches this checkout", () => {
    const result = checkLaunchdPlist(
      "darwin",
      HOME,
      ROOT,
      plist(ROOT, NODE),
      existing(NODE),
    );
    assert.equal(result.status, "pass");
  });

  test("warns when the plist still points at an old project path", () => {
    const old = `${HOME}/t_house_review`;
    const result = checkLaunchdPlist(
      "darwin",
      HOME,
      ROOT,
      plist(old, NODE),
      existing(NODE),
    );
    assert.equal(result.status, "warn");
    assert.match(result.detail, /t_house_review/);
    assert.doesNotMatch(result.detail, /from\/a\/comment/);
  });

  test("warns when the pinned nvm node binary no longer exists", () => {
    const result = checkLaunchdPlist(
      "darwin",
      HOME,
      ROOT,
      plist(ROOT, NODE),
      existing(),
    );
    assert.equal(result.status, "warn");
    assert.match(result.detail, /v22\.11\.0/);
  });

  test("looks in the LaunchAgents path SETUP.md installs to", () => {
    assert.equal(
      launchAgentPath(HOME),
      `${HOME}/Library/LaunchAgents/com.example.reviews.plist`,
    );
  });
});

describe("runChecks + exitCodeFor", () => {
  const ready: DoctorInput = {
    nodeVersion: "22.11.0",
    platform: "darwin",
    projectRoot: ROOT,
    homeDir: HOME,
    env: { ANTHROPIC_API_KEY: "a", GOOGLE_MAPS_API_KEY: "g", YELP_API_KEY: "y" },
    exists: existing(
      MAC_CHROME,
      NODE,
      `${ROOT}/credentials/oauth-client.json`,
      `${ROOT}/credentials/token.json`,
      `${ROOT}/data/document.json`,
    ),
    targets: { ok: true, count: 1 },
    oauthClientPath: `${ROOT}/credentials/oauth-client.json`,
    oauthTokenPath: `${ROOT}/credentials/token.json`,
    plistXml: plist(ROOT, NODE),
  };

  test("a fully set-up Mac passes every check and exits 0", () => {
    const results = runChecks(ready);
    assert.deepEqual(
      results.filter((r) => r.status !== "pass"),
      [],
    );
    assert.equal(exitCodeFor(results), 0);
  });

  test("warnings alone exit 0; any failure exits 1", () => {
    assert.equal(exitCodeFor(runChecks({ ...ready, env: {} })), 0);
    assert.equal(
      exitCodeFor(runChecks({ ...ready, targets: { ok: false, error: "x" } })),
      1,
    );
  });
});
