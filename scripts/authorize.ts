/**
 * One-time OAuth consent. Run `npm run authorize`, approve in the browser, done.
 *
 * Uses a loopback redirect (the flow Google recommends for desktop apps) rather
 * than copy-pasting a code, because the out-of-band code flow was discontinued.
 */
import { createServer } from "node:http";
import { once } from "node:events";
import { spawn } from "node:child_process";
import {
  readClientSecret,
  buildClient,
  saveToken,
  SCOPES,
} from "../src/store/googleAuth.ts";
import { loadEnv } from "../src/config.ts";

async function main(): Promise<void> {
  const env = loadEnv();
  const { clientId, clientSecret, kind } = await readClientSecret(env.oauthClientPath);

  // A "Web application" client does not accept loopback redirects unless the exact
  // http://127.0.0.1:PORT is pre-registered — and the port here is random. The
  // browser would show redirect_uri_mismatch while this script waits, blind, for a
  // callback that can never arrive.
  if (kind === "web") {
    throw new Error(
      'credentials/oauth-client.json is a "Web application" OAuth client.\n' +
        "This flow needs a Desktop app client: Cloud Console > Credentials >\n" +
        "Create credentials > OAuth client ID > Application type: Desktop app.\n" +
        "Download it and replace credentials/oauth-client.json.",
    );
  }

  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as { port: number };
  const redirectUri = `http://127.0.0.1:${port}`;

  const client = buildClient(clientId, clientSecret, redirectUri);
  const authUrl = client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
    // Without this, Google omits the refresh token on every consent after the
    // first, and the daily run has no way to renew itself.
    prompt: "consent",
  });

  console.log("\nOpening your browser to authorize.\nIf it doesn't open, visit:\n");
  console.log(`${authUrl}\n`);
  spawn("open", [authUrl], { stdio: "ignore", detached: true }).unref();

  const code = await new Promise<string>((resolve, reject) => {
    // Generous: a first-time consent on an unverified app means an account
    // chooser, a warning screen, and an Advanced > Go to (unsafe) detour.
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            "Timed out after 10 minutes waiting for the browser callback.\n" +
              "Re-run `npm run authorize` — each run listens on a NEW port, so an " +
              "older tab's redirect will not be received.",
          ),
        ),
      600_000,
    );
    server.on("request", (req, res) => {
      const url = new URL(req.url ?? "/", redirectUri);
      const received = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(
        `<html><body style="font-family:system-ui;padding:3rem">
       <h2>${received ? "Authorized." : "Authorization failed."}</h2>
       <p>${received ? "You can close this tab and return to the terminal." : (error ?? "")}</p>
       </body></html>`,
      );
      clearTimeout(timer);
      if (received) resolve(received);
      else reject(new Error(`Authorization denied: ${error ?? "no code returned"}`));
    });
  });

  const { tokens } = await client.getToken({ code, redirect_uri: redirectUri });
  // close() alone waits for the browser's keep-alive connection to end, which
  // leaves the process hanging after the work is done. Drop live sockets too.
  server.closeAllConnections();
  server.close();

  if (!tokens.refresh_token) {
    console.error(
      "\nGoogle returned no refresh token. Revoke this app's access at\n" +
        "https://myaccount.google.com/permissions and run `npm run authorize` again.",
    );
    process.exit(1);
  }

  await saveToken(env.oauthTokenPath, tokens.refresh_token);
  console.log(`Saved refresh token to ${env.oauthTokenPath} (mode 600).`);
  console.log(
    '\nIf the OAuth consent screen is still in "Testing" rather than published,\n' +
      "this token expires in 7 days and the daily run will stop with no obvious\n" +
      "error. Check Google Auth Platform > Audience.",
  );
}

// A setup script's error message is the whole point of the script; a stack
// trace here just means the user cannot tell what to fix.
main()
  // Explicit exit: a stray listening socket or keep-alive connection would
  // otherwise keep this CLI alive after its work is finished.
  .then(() => process.exit(0))
  .catch((error: Error) => {
    console.error(`\n${error.message}`);
    process.exit(1);
  });
