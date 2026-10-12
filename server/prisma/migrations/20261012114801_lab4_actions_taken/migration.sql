-- Lab 4, Issue #46 — Actions Taken (lab-04/specification.md §7).
--
-- Additive only: no existing row is read, rewritten or deleted. Tickets created
-- in Labs 2 and 3 simply have no Actions, which is a valid state — their detail
-- screen shows the empty log, the resolution gate (BR-18) passes trivially
-- because they have no open Actions, and the dashboards count them as zero
-- contributions rather than skipping them (AC-27, MIG-03).
--
-- `Ticket.version` arrives with DEFAULT 1, so every pre-existing Ticket is at
-- version 1 — exactly what a client that has never seen the column will read
-- and send back (BR-26, MIG-02).
--
-- Rollback (lab-04/specification.md §7, proven by MIG-04). Reversible without
-- loss for everything that existed before Lab 4; only Lab 4's own Actions go,
-- which is what rolling the sprint back means:
--
--   DROP TABLE "ActionTaken";
--   DROP TYPE "ActionStatus";
--   ALTER TABLE "Ticket" DROP COLUMN "version";
--
-- Unlike the Lab 3 rename migration, nothing here is hand-edited: the generated
-- SQL is already correct, and this header is the only addition.

-- CreateEnum
CREATE TYPE "ActionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ActionTaken" (
    "id" SERIAL NOT NULL,
    "ticketId" INTEGER NOT NULL,
    "actionAt" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "result" TEXT,
    "status" "ActionStatus" NOT NULL DEFAULT 'PLANNED',
    "performedById" INTEGER NOT NULL,
    "assignedToId" INTEGER NOT NULL,
    "followUpRequired" BOOLEAN NOT NULL DEFAULT false,
    "followUpNote" TEXT,
    "attachmentNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ActionTaken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActionTaken_ticketId_actionAt_id_idx" ON "ActionTaken"("ticketId", "actionAt", "id");

-- CreateIndex
CREATE INDEX "ActionTaken_assignedToId_status_idx" ON "ActionTaken"("assignedToId", "status");

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionTaken" ADD CONSTRAINT "ActionTaken_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
