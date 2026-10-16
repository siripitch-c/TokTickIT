-- Lab 4, Issue #49 — `Ticket.resolvedAt` (lab-04/specification.md §7).
--
-- Why a column at all. The IT Staff Dashboard counts Tickets that *became*
-- Resolved in the last seven days (BR-21). `updatedAt` cannot answer that
-- question: it moves when the IT Priority changes, when the owner changes, and
-- when the Requester's resolution signal is recorded, so a Ticket resolved a
-- month ago and edited yesterday would be counted as this week's work. A
-- timestamp written only by the status transition is the smallest thing that
-- answers it honestly.
--
-- Additive, and the backfill is a best effort that is stated as such. A Ticket
-- already sitting in RESOLVED gets `updatedAt` as its `resolvedAt`, which is
-- exactly right when the resolution was the last thing done to it and an
-- over-estimate otherwise. No pre-Lab-4 row records the real moment, so there
-- is nothing better to recover; the alternative — leaving them NULL — would
-- report every migrated Ticket as never resolved, which is worse. A Ticket in
-- any other status is left NULL, including one that was resolved and then
-- reopened, because for those the column says "not resolved now" and the
-- dashboard only ever reads it alongside `currentStatus = 'RESOLVED'`
-- (MIG-01..MIG-04: no earlier row is deleted, and every screen still loads).
--
-- Rollback. Reversible without loss: the column holds nothing that is not
-- derivable from the row it sits on, and dropping it returns the database to
-- the Issue #46 shape.
--
--   DROP INDEX "Ticket_currentStatus_resolvedAt_idx";
--   ALTER TABLE "Ticket" DROP COLUMN "resolvedAt";
--
-- The generated SQL is unchanged; the backfill below and this header are the
-- additions.

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- Backfill: every Ticket that is Resolved right now is treated as having been
-- resolved when it was last touched. Runs once, before the index exists, and
-- touches no other row.
UPDATE "Ticket" SET "resolvedAt" = "updatedAt" WHERE "currentStatus" = 'RESOLVED';

-- CreateIndex
CREATE INDEX "Ticket_currentStatus_resolvedAt_idx" ON "Ticket"("currentStatus", "resolvedAt");
