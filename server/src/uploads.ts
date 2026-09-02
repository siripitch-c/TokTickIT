import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import multer from "multer";

// Issue #13 — attachment storage rules (specification.md BR-26, BR-27, BR-32;
// api-spec.md §5).
//
// Files are buffered in memory rather than streamed straight to disk so that a
// rejected upload (wrong type, unowned ticket, limit reached) never leaves a
// file behind: nothing touches the filesystem until every check has passed.
// The 5 MB cap keeps that buffering bounded.

export const MAX_FILE_BYTES = 5 * 1024 * 1024;

// BR-26: both the declared type and the extension must be on the list. Checking
// only one lets `payload.exe` through as `image/png`, or an `image/png` through
// as `payload.svg`.
const ALLOWED_TYPES: Record<string, string[]> = {
  "image/jpeg": [".jpg", ".jpeg"],
  "image/png": [".png"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
};

export const ATTACHMENT_TYPE_HELP = "JPG, PNG, WEBP, or PDF only.";

/** Resolved per call so tests can point UPLOAD_DIR at a temporary directory. */
export function getUploadDir(): string {
  return path.resolve(process.env.UPLOAD_DIR ?? "uploads");
}

/**
 * BR-32: strips any directory part a client may have put in the filename, so
 * the retained display name can never carry a traversal sequence.
 */
export function toDisplayFilename(originalname: string): string {
  const lastSeparator = Math.max(originalname.lastIndexOf("/"), originalname.lastIndexOf("\\"));
  return lastSeparator === -1 ? originalname : originalname.slice(lastSeparator + 1);
}

/** Returns the validated extension, or null when the type/extension pair is not allowed. */
export function allowedExtensionFor(mimeType: string, displayFilename: string): string | null {
  const extensions = ALLOWED_TYPES[mimeType];
  if (!extensions) return null;
  const extension = path.extname(displayFilename).toLowerCase();
  return extensions.includes(extension) ? extension : null;
}

/**
 * BR-32: the name on disk is randomly generated, never derived from user
 * input, so uploads can neither collide nor escape the uploads directory.
 * Returns the stored filename to record alongside the display name.
 */
export function storeAttachmentFile(buffer: Buffer, extension: string): string {
  const directory = getUploadDir();
  fs.mkdirSync(directory, { recursive: true });
  const storedFilename = `${randomUUID()}${extension}`;
  fs.writeFileSync(path.join(directory, storedFilename), buffer);
  return storedFilename;
}

/** Best-effort cleanup so a failed database write leaves no orphan file (BR-33). */
export function deleteStoredFile(storedFilename: string): void {
  try {
    fs.rmSync(path.join(getUploadDir(), storedFilename), { force: true });
  } catch (error) {
    console.error("Could not clean up stored attachment file:", error);
  }
}

// Type and count checks live in the route rather than in multer's fileFilter,
// because they need the api-spec.md §5 status codes (415/409) that a filter
// cannot express. multer enforces only the size cap it can apply while reading.
export const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
});
