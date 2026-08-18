import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { OAuth2Client } from "google-auth-library";

/**
 * Deliberately ONE non-sensitive scope.
 *
 * `drive.file` grants access only to files this app itself creates. That is
 * enough to create the review doc, edit it, and upload screenshots — and it
 * means the app can never read or modify anything else the user owns.
 *
 * The obvious alternative, `documents`, means "see, edit, create and delete ALL
 * your Google Docs". Google classifies it as sensitive, which forces app
 * verification and shows users an "unverified app" warning. Avoiding it is both
 * least-privilege and far less setup friction.
 *
 * Consequence: the doc must be created BY the script (see ensureDocument).
 * A doc the operator made by hand is invisible to this scope.
 */
export const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

interface ClientSecretFile {
  installed?: { client_id: string; client_secret: string };
  web?: { client_id: string; client_secret: string };
}

export async function readClientSecret(
  path: string,
): Promise<{ clientId: string; clientSecret: string; kind: "installed" | "web" }> {
  let parsed: ClientSecretFile;
  try {
    parsed = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `OAuth client file not found at ${path}. Create one in Google Cloud ` +
          `Console > Credentials > Create credentials > OAuth client ID > Desktop app, ` +
          `then download the JSON.`,
      );
    }
    throw error;
  }

  const creds = parsed.installed ?? parsed.web;
  if (!creds?.client_id || !creds.client_secret) {
    throw new Error(
      `${path} is not an OAuth client file. It should contain an "installed" or ` +
        `"web" key — a service account JSON (client_email/private_key) will not work here.`,
    );
  }
  return {
    clientId: creds.client_id,
    clientSecret: creds.client_secret,
    kind: parsed.installed ? "installed" : "web",
  };
}

export function buildClient(
  clientId: string,
  clientSecret: string,
  redirectUri: string,
): OAuth2Client {
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

/** Loads the stored refresh token and returns a client ready to make calls. */
export async function loadAuthorizedClient(
  clientPath: string,
  tokenPath: string,
): Promise<OAuth2Client> {
  const { clientId, clientSecret } = await readClientSecret(clientPath);

  let refreshToken: string | undefined;
  try {
    refreshToken = JSON.parse(await readFile(tokenPath, "utf8")).refresh_token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `Not authorized yet — no token at ${tokenPath}. Run \`npm run authorize\` once.`,
      );
    }
    throw error;
  }

  if (!refreshToken) {
    throw new Error(
      `${tokenPath} has no refresh_token. Delete it and run \`npm run authorize\` again. ` +
        `If this keeps happening, the OAuth consent screen is probably still in ` +
        `"Testing" mode, which expires refresh tokens after 7 days — publish it.`,
    );
  }

  const client = buildClient(clientId, clientSecret, "http://localhost");
  client.setCredentials({ refresh_token: refreshToken });
  return client;
}

export async function saveToken(
  tokenPath: string,
  refreshToken: string,
): Promise<void> {
  await mkdir(dirname(tokenPath), { recursive: true });
  await writeFile(
    tokenPath,
    `${JSON.stringify({ refresh_token: refreshToken }, null, 2)}\n`,
    { mode: 0o600 },
  );
}
