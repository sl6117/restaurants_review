import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { OAuth2Client } from "google-auth-library";

/**
 * The Docs API cannot accept image bytes — `insertInlineImage` takes a URL and
 * fetches it server-side. So every screenshot must be uploaded to Drive and made
 * link-readable before it can appear in the doc.
 *
 * This is also why auth is OAuth-as-account-owner rather than a service account:
 * service accounts have no Drive storage quota of their own, and the usual
 * workaround (a Shared Drive) requires Google Workspace, not a personal account.
 */
export async function uploadPublicImage(
  auth: OAuth2Client,
  filePath: string,
): Promise<string> {
  const bytes = await readFile(filePath);
  const name = basename(filePath);

  const boundary = `bnd${Math.abs(hash(name))}`;
  const metadata = JSON.stringify({ name, mimeType: "image/png" });
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n` +
        `--${boundary}\r\nContent-Type: image/png\r\n\r\n`,
    ),
    bytes,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);

  const created = await auth
    .request<{ id: string }>({
      url: "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id",
      method: "POST",
      headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    })
    .catch(explainDriveError);

  const fileId = created.data.id;
  if (!fileId) throw new Error(`Drive upload of ${name} returned no file id.`);

  // Docs fetches the image anonymously, so "anyone with the link" is required.
  // These are screenshots of reviews that are already public on Google and Yelp.
  await auth.request({
    url: `https://www.googleapis.com/drive/v3/files/${fileId}/permissions`,
    method: "POST",
    data: { role: "reader", type: "anyone" },
  });

  return fileId;
}

/**
 * Candidate public URLs for a Drive image, best first.
 *
 * Google has changed which host serves Drive images to third-party fetchers
 * more than once, and `insertInlineImage` fails outright on a URL it cannot
 * fetch. The caller tries these in order rather than betting on one.
 */
export function imageUrlCandidates(fileId: string): string[] {
  return [
    `https://lh3.googleusercontent.com/d/${fileId}`,
    `https://drive.google.com/uc?export=view&id=${fileId}`,
  ];
}

/**
 * Granting the `drive.file` scope and enabling the Drive API are separate steps,
 * and the scope picker lists `drive.file` under the Docs API — so it is easy to
 * grant the scope, authorize successfully, and only discover the API was never
 * enabled here, at the first upload.
 */
function explainDriveError(error: unknown): never {
  const response = (error as { response?: { status?: number; data?: unknown } })
    ?.response;
  const message = JSON.stringify(response?.data ?? "");

  if (
    response?.status === 403 &&
    /has not been used in project|is disabled/i.test(message)
  ) {
    throw new Error(
      "Drive API is not enabled on this Google Cloud project. Granting the " +
        "drive.file scope is not the same as enabling the API — go to " +
        "APIs & Services > Library > Google Drive API > Enable, wait a minute, and retry.",
    );
  }
  if (response?.status === 403 || response?.status === 401) {
    throw new Error(
      "Drive rejected the upload (insufficient permission). The stored token " +
        "probably predates adding the drive.file scope: delete credentials/token.json " +
        "and run `npm run authorize` again — changing scopes does not upgrade an " +
        "existing refresh token.",
    );
  }
  throw error;
}

function hash(value: string): number {
  let out = 0;
  for (const char of value) out = (out * 31 + char.charCodeAt(0)) | 0;
  return out;
}
