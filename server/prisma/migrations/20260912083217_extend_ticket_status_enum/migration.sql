-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CurrentStatus" ADD VALUE 'OPEN';
ALTER TYPE "CurrentStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "CurrentStatus" ADD VALUE 'WAITING_FOR_REQUESTER';
ALTER TYPE "CurrentStatus" ADD VALUE 'RESOLVED';
ALTER TYPE "CurrentStatus" ADD VALUE 'CLOSED';
ALTER TYPE "CurrentStatus" ADD VALUE 'REOPENED';
ALTER TYPE "CurrentStatus" ADD VALUE 'CANCELLED';
