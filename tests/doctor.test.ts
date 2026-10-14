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
  runChecks,
  type DoctorInput,
  type Exists,
} from "../src/doctor.ts";

const HOME = "/Users/owner";
const ROOT = "/Users/owner/restaurants_review";
const NODE = "/Users/owner/.nvm/versions/node/v22.11.0/bin/node";
const MAC_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const LEDGER = `${ROOT}/data/seen.json`;
const DOC_STATE = `${ROOT}/data/document.json`;

function existing(...paths: string[]): Exists {
  const set = new Set(paths);
  return (path) => set.has(path);
}

function plist(workingDirectory: string, node: string, script = "src/run.ts"): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- <key>WorkingDirectory</key><string>/from/a/comment</string> -->
<plist version="1.0">
  <dict>
    <key>ProgramArguments</key>
    <array>
      <string>${node}</string>
      <string>--import</string>
      <string>tsx</string>
      <string>${script}</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${workingDirectory}</string>
  </dict>
</plist>`;
}

const mac = (xml: string, exists: Exists) =>
  checkLaunchdPlist("darwin", HOME, ROOT, xml, exists);

describe("single-input checks", () => {
  test("Node passes on the engines minimum and fails below it", () => {
    assert.equal(checkNodeVersion("22.0.0").status, "pass");
    assert.equal(checkNodeVersion("20.18.1").status, "fail");
  });

  test("Chrome passes where Playwright's chrome channel looks, else names the path", () => {
    assert.equal(checkChrome("darwin", existing(MAC_CHROME)).status, "pass");
    const missing = checkChrome("linux", existing());
    assert.equal(missing.status, "fail");
    assert.match(missing.detail, /\/opt\/google\/chrome\/chrome/);
  });

  test("targets pass through loadTargets' error message on failure", () => {
    assert.equal(checkTargets({ ok: true, count: 2 }).status, "pass");
    const result = checkTargets({ ok: false, error: "must be an ARRAY of targets" });
    assert.equal(result.status, "fail");
    assert.match(result.detail, /ARRAY/);
  });

  test("OAuth fails naming only the missing file, and points at authorize", () => {
    const result = checkOAuthFiles(
      ROOT,
      {},
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

describe("OAuth path overrides", () => {
  test("OAuth names an overridden path by its env var instead of printing it", () => {
    const secretish = "/secrets/sk-should-not-print/token.json";
    const result = checkOAuthFiles(
      ROOT,
      { GOOGLE_OAUTH_TOKEN: secretish },
      `${ROOT}/credentials/oauth-client.json`,
      secretish,
      existing(`${ROOT}/credentials/oauth-client.json`),
    );
    assert.equal(result.status, "fail");
    assert.match(result.detail, /the file GOOGLE_OAUTH_TOKEN points to/);
    assert.ok(!result.detail.includes("sk-should-not-print"));
  });
});

describe("checkDocState", () => {
  test("fails when a doc exists without its ledger: next run would duplicate rows", () => {
    for (const [env, exists] of [
      [{}, existing(DOC_STATE)],
      [{ GOOGLE_DOC_ID: "abc" }, existing()],
    ] as const) {
      const result = checkDocState(ROOT, env, exists);
      assert.equal(result.status, "fail");
      assert.match(result.detail, /re-append every visible review/);
    }
  });

  test("warns when a ledger exists without the doc id: next run would split history", () => {
    const result = checkDocState(ROOT, {}, existing(LEDGER));
    assert.equal(result.status, "warn");
    assert.match(result.detail, /NEW doc/);
  });

  test("passes with both, with the env override plus ledger, or a fresh checkout", () => {
    assert.equal(checkDocState(ROOT, {}, existing(DOC_STATE, LEDGER)).status, "pass");
    assert.equal(
      checkDocState(ROOT, { GOOGLE_DOC_ID: "abc" }, existing(LEDGER)).status,
      "pass",
    );
    assert.equal(checkDocState(ROOT, {}, existing()).status, "pass");
  });
});

describe("checkApiKeys", () => {
  test("add-restaurant accepts either search key alongside Anthropic", () => {
    const results = checkApiKeys({ ANTHROPIC_API_KEY: "x", YELP_API_KEY: "y" });
    assert.deepEqual(
      results.map((r) => [r.name, r.status]),
      [
        ["check: health-check key", "warn"],
        ["report", "pass"],
        ["add-restaurant", "pass"],
      ],
    );
  });

  test("missing keys are warnings that name what is needed", () => {
    const results = checkApiKeys({});
    assert.ok(results.every((r) => r.status === "warn"));
    assert.match(
      results[2]?.detail ?? "",
      /ANTHROPIC_API_KEY and GOOGLE_MAPS_API_KEY or YELP_API_KEY/,
    );
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

describe("macOS checks", () => {
  test("project location warns under protected folders, skips off macOS", () => {
    const desktop = `${HOME}/Desktop/restaurants_review`;
    const result = checkProjectLocation("darwin", desktop, HOME);
    assert.equal(result.status, "warn");
    assert.match(result.detail, /~\/Desktop/);
    assert.equal(checkProjectLocation("darwin", ROOT, HOME).status, "pass");
    assert.equal(checkProjectLocation("linux", desktop, HOME).status, "skip");
  });

  test("plist skips off macOS and when not installed", () => {
    const linux = checkLaunchdPlist("linux", HOME, ROOT, plist(ROOT, NODE), existing());
    assert.equal(linux.status, "skip");
    const none = checkLaunchdPlist("darwin", HOME, ROOT, null, existing());
    assert.equal(none.status, "skip");
    assert.match(none.detail, /LaunchAgents\/com\.example\.reviews\.plist/);
  });

  test("plist passes when it matches this checkout", () => {
    assert.equal(mac(plist(ROOT, NODE), existing(NODE)).status, "pass");
  });

  test("plist warns on an old project path, ignoring paths inside comments", () => {
    const result = mac(plist(`${HOME}/t_house_review`, NODE), existing(NODE));
    assert.equal(result.status, "warn");
    assert.match(result.detail, /t_house_review/);
    assert.doesNotMatch(result.detail, /from\/a\/comment/);
  });

  test("plist warns when the pinned nvm node is missing or too old", () => {
    assert.match(mac(plist(ROOT, NODE), existing()).detail, /does not exist/);
    const old = "/Users/owner/.nvm/versions/node/v18.20.4/bin/node";
    const result = mac(plist(ROOT, old), existing(old));
    assert.equal(result.status, "warn");
    assert.match(result.detail, /v18; the job's flags need >= 22/);
  });

  test("plist warns when it runs some other script, even with src/run.ts as an argument", () => {
    for (const script of [
      "scripts/diagnose.ts",
      "scripts/diagnose.ts</string><string>src/run.ts",
    ]) {
      const result = mac(plist(ROOT, NODE, script), existing(NODE));
      assert.equal(result.status, "warn");
      assert.match(result.detail, /run scripts\/diagnose\.ts, not src\/run\.ts/);
    }
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
      DOC_STATE,
      LEDGER,
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
