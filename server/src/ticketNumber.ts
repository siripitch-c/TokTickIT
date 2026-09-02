import type { Prisma } from "@prisma/client";

// Issue #13 — official Ticket Number generation (specification.md BR-01).
//
// Format: TKT-YYYY-NNNNNN — 4-digit year, 6-digit zero-padded sequence that
// restarts each calendar year. The sequence is owned by the database, never
// by application code: `nextTicketNumber` runs an atomic
// `UPDATE ... SET counter = counter + 1 RETURNING counter` against a single
// row of `TicketNumberCounter`, which Postgres serializes per row, so
// concurrent submissions can never be handed the same number (tests.md
// API-CREATE-08). "Read the current max and add one" is explicitly ruled out
// by BR-01 because it races outside a transaction.

export const TICKET_NUMBER_PATTERN = /^TKT-\d{4}-\d{6,}$/;

const SEQUENCE_PAD_WIDTH = 6;

/**
 * Pure formatter — tests.md UNIT-01. Padding is a display width, not a cap:
 * a sequence past 999999 keeps all its digits rather than being truncated
 * into a colliding value, since BR-01's uniqueness outranks fixed width.
 */
export function formatTicketNumber(year: number, sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 1) {
    throw new Error(`Ticket Number sequence must be a positive integer, got ${sequence}`);
  }
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error(`Ticket Number year must be a 4-digit integer, got ${year}`);
  }
  return `TKT-${year}-${String(sequence).padStart(SEQUENCE_PAD_WIDTH, "0")}`;
}

/**
 * Claims the next Ticket Number for `year` inside the caller's transaction
 * (BR-01). Must be called with the same `tx` that inserts the Ticket so the
 * number and the row commit or roll back together.
 */
export async function nextTicketNumber(
  tx: Prisma.TransactionClient,
  year: number,
): Promise<string> {
  const claimed = await claim(tx, year);
  if (claimed !== null) return formatTicketNumber(year, claimed);

  // First ticket of this year: create the counter row, then claim again.
  // ON CONFLICT DO NOTHING makes this safe when two transactions reach a new
  // year at the same moment — the loser waits on the winner's row lock in the
  // retry below rather than failing the request.
  await tx.$executeRaw`
    INSERT INTO "TicketNumberCounter" ("year", "counter") VALUES (${year}, 0)
    ON CONFLICT ("year") DO NOTHING
  `;

  const retried = await claim(tx, year);
  if (retried === null) {
    throw new Error(`Could not claim a Ticket Number for year ${year}`);
  }
  return formatTicketNumber(year, retried);
}

// Returns the newly-incremented counter, or null when the year has no row yet.
async function claim(tx: Prisma.TransactionClient, year: number): Promise<number | null> {
  const rows = await tx.$queryRaw<{ counter: number }[]>`
    UPDATE "TicketNumberCounter" SET "counter" = "counter" + 1
    WHERE "year" = ${year}
    RETURNING "counter"
  `;
  return rows.length > 0 ? rows[0].counter : null;
}
