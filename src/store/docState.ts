import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Remembers which document the script created.
 *
 * Under the `drive.file` scope the app can only touch documents it created, so
 * losing this id means the next run creates a *second* doc and the review
 * history is split across two files. It is local state, not a secret.
 */
export interface DocState {
  documentId: string;
  createdAt: string;
}

export async function readDocState(path: string): Promise<DocState | null> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as Partial<DocState>;
    return parsed.documentId
      ? { documentId: parsed.documentId, createdAt: parsed.createdAt ?? "" }
      : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function writeDocState(path: string, state: DocState): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
