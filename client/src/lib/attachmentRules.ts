// Shared attachment rules — specification.md BR-26, BR-27, BR-28.
//
// Create Ticket (#13) and Ticket Detail (#15) both let a Requester attach
// files, and both have to refuse the same things for the same reasons. Kept in
// one place so the two screens cannot drift apart; the server re-validates
// regardless and stays authoritative (BR-23).

export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
export const ATTACHMENT_HELP = "JPG, PNG, WEBP, or PDF — up to 5 MB each, maximum 5 files.";
export const LIMIT_MESSAGE = `Maximum ${MAX_ATTACHMENTS} attachments per ticket.`;

/** Why this file cannot be attached, or null when it can be. */
export function rejectionReason(file: File): string | null {
  // A leading dot is not an extension: Node's path.extname(".png") is "", so
  // the server would reject what the client had accepted. Requiring a non-empty
  // basename keeps both sides on the same answer.
  const dot = file.name.lastIndexOf(".");
  const extension = dot > 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) return "Unsupported file type";
  if (file.size > MAX_FILE_BYTES) return "File exceeds 5 MB";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Local date/time, matching how Ticket Date is shown on Create Ticket. */
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString();
}
