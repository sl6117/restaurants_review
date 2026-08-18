import type { OAuth2Client } from "google-auth-library";
import type { NormalizedReview } from "../normalize.ts";

/** Minimal shape of the Docs API requests we emit. */
export type DocRequest = Record<string, unknown>;

const SOURCE_LABEL: Record<string, string> = { google: "Google Maps", yelp: "Yelp" };

export function formatHeading(review: NormalizedReview): string {
  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const source = SOURCE_LABEL[review.source] ?? review.source;
  return `${review.author} — ${stars} — ${source} — ${review.reviewDate}`;
}

/**
 * Builds the Docs batchUpdate requests for one review.
 *
 * `endOfSegmentLocation: {}` appends to the end of the body, which avoids
 * tracking character indexes across a growing document — index arithmetic is
 * the usual source of Docs API corruption, since every insert shifts every
 * index after it.
 *
 * Requests within a batch apply in order, so heading -> text -> image -> rule
 * comes out in that order.
 */
export function buildReviewRequests(
  review: NormalizedReview,
  imageUrl: string | null,
): DocRequest[] {
  const requests: DocRequest[] = [
    { insertText: { text: `${formatHeading(review)}\n`, endOfSegmentLocation: {} } },
  ];

  const body = review.text.trim();
  requests.push({
    insertText: {
      text: `${body.length > 0 ? body : "(no written review — rating only)"}\n`,
      endOfSegmentLocation: {},
    },
  });

  if (imageUrl) {
    requests.push({
      insertInlineImage: {
        uri: imageUrl,
        endOfSegmentLocation: {},
        // Constrains width so a tall screenshot cannot run off the page. Docs
        // preserves aspect ratio when only one dimension is given.
        objectSize: { width: { magnitude: 420, unit: "PT" } },
      },
    });
    requests.push({ insertText: { text: "\n", endOfSegmentLocation: {} } });
  }

  if (review.url) {
    requests.push({
      insertText: { text: `${review.url}\n`, endOfSegmentLocation: {} },
    });
  }

  requests.push({
    insertText: { text: "\n───────────\n\n", endOfSegmentLocation: {} },
  });
  return requests;
}

export type DocumentSource =
  { kind: "env"; id: string } | { kind: "stored"; id: string } | { kind: "create" };

/**
 * Decides which document to write to. Kept separate from the API calls so the
 * precedence is testable: an explicit GOOGLE_DOC_ID always wins, so project owner can
 * point the run at a different doc without deleting local state.
 */
export function chooseDocumentSource(
  envId: string | undefined,
  storedId: string | undefined,
): DocumentSource {
  if (envId) return { kind: "env", id: envId };
  if (storedId) return { kind: "stored", id: storedId };
  return { kind: "create" };
}

/**
 * Creates the doc via Drive rather than Docs `documents.create`, because
 * `drive.file` unambiguously covers Drive-created files. The new document is
 * owned by authenticated user and accessible to this app forever after.
 */
export async function createDocument(
  auth: OAuth2Client,
  title: string,
): Promise<string> {
  const created = await auth.request<{ id: string }>({
    url: "https://www.googleapis.com/drive/v3/files?fields=id",
    method: "POST",
    data: { name: title, mimeType: "application/vnd.google-apps.document" },
  });
  const id = created.data.id;
  if (!id) throw new Error("Drive created the document but returned no id.");
  return id;
}

export function documentUrl(documentId: string): string {
  return `https://docs.google.com/document/d/${documentId}/edit`;
}

export interface DocClient {
  append(requests: DocRequest[]): Promise<void>;
  assertReachable(): Promise<void>;
}

export function createDocClient(auth: OAuth2Client, documentId: string): DocClient {
  const base = `https://docs.googleapis.com/v1/documents/${documentId}`;

  const explain = (error: unknown): never => {
    const status = (error as { response?: { status?: number } })?.response?.status;
    if (status === 404) {
      throw new Error(
        `Docs API returned 404 for document ${documentId}. Check GOOGLE_DOC_ID — ` +
          `it is the long string in the doc URL between /document/d/ and /edit.`,
      );
    }
    if (status === 403) {
      throw new Error(
        `Docs API returned 403 for document ${documentId}.\n` +
          `This app uses only the drive.file scope, which grants access to documents ` +
          `it created itself — a doc you made by hand is invisible to it, even though ` +
          `you own it.\n` +
          `Fix: unset GOOGLE_DOC_ID in .env and let the next run create its own doc.`,
      );
    }
    throw error;
  };

  return {
    async assertReachable() {
      try {
        await auth.request({ url: `${base}?fields=documentId` });
      } catch (error) {
        explain(error);
      }
    },

    async append(requests) {
      if (requests.length === 0) return;
      try {
        await auth.request({
          url: `${base}:batchUpdate`,
          method: "POST",
          data: { requests },
        });
      } catch (error) {
        explain(error);
      }
    },
  };
}
